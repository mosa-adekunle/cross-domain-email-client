"""Offline tests: route rollout must not modify existing mail forwarding."""
import importlib.util
import json
import sys
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "deploy-receiptboss-mail.py"
spec = importlib.util.spec_from_file_location("receiptboss_mail_deploy", SCRIPT)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


def rule(address, action="worker", enabled=True, destination="cdec-inbound-archive"):
    return {
        "enabled": enabled,
        "matchers": [{"type": "literal", "field": "to", "value": address}],
        "actions": [{"type": action, "value": [destination]}],
    }


class ReceiptBossMailDeploymentTests(unittest.TestCase):
    def setUp(self):
        self.pilot = rule("inbox-test@receiptboss.ca")
        self.support = rule("support@receiptboss.ca", "forward", destination="previous@example.org")
        self.legal = rule("legal@receiptboss.ca", "forward", destination="previous@example.org")
        self.privacy = rule("privacy@receiptboss.ca", "forward", destination="previous@example.org")

    def test_approved_worker_config_has_all_addresses_and_private_secret(self):
        module.validate_source()

    def test_preview_creates_only_sales_and_hello(self):
        self.assertEqual(module.plan([self.pilot, self.support, self.legal, self.privacy]), {
            "sales@receiptboss.ca": "create", "hello@receiptboss.ca": "create",
        })

    def test_repeat_execution_is_idempotent(self):
        self.assertEqual(module.plan([self.pilot, self.support, self.legal, self.privacy,
                                      rule("sales@receiptboss.ca"), rule("hello@receiptboss.ca")]), {
            "sales@receiptboss.ca": "already active", "hello@receiptboss.ca": "already active",
        })

    def test_fails_when_pilot_not_present(self):
        with self.assertRaisesRegex(RuntimeError, "pilot rule not found"):
            module.plan([self.support])

    def test_fails_if_existing_sales_is_forwarded_elsewhere(self):
        with self.assertRaisesRegex(RuntimeError, "conflicting"):
            module.plan([self.pilot, rule("sales@receiptboss.ca", "forward", destination="other@example.org")])

    def test_fails_if_existing_hello_worker_is_disabled(self):
        with self.assertRaisesRegex(RuntimeError, "inactive"):
            module.plan([self.pilot, rule("hello@receiptboss.ca", enabled=False)])

    def test_fails_if_duplicate_rule_exists(self):
        with self.assertRaisesRegex(RuntimeError, "conflicting"):
            module.plan([self.pilot, rule("sales@receiptboss.ca"), rule("sales@receiptboss.ca")])

    def test_payload_targets_only_explicit_address_and_worker(self):
        result = module.new_rule("sales@receiptboss.ca")
        self.assertEqual(result["matchers"], [{"type": "literal", "field": "to", "value": "sales@receiptboss.ca"}])
        self.assertEqual(result["actions"], [{"type": "worker", "value": ["cdec-inbound-archive"]}])
        self.assertTrue(result["enabled"])
        self.assertNotIn("priority", result)

    def test_zone_and_account_ids(self):
        self.assertEqual(len(module.ACCOUNT_ID), 32)
        self.assertEqual(len(module.RECEIPTBOSS_ZONE_ID), 32)
        int(module.ACCOUNT_ID, 16)
        int(module.RECEIPTBOSS_ZONE_ID, 16)


if __name__ == "__main__":
    unittest.main()
