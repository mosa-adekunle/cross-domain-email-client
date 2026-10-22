"""Safety tests for guarded Privacy dual-delivery migration."""
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "migrate-receiptboss-privacy.py"
spec = importlib.util.spec_from_file_location("cdec_privacy_migration", SCRIPT)
m = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = m
spec.loader.exec_module(m)

def rule(name, action, id_suffix=""):
    import hashlib
    identifier = hashlib.md5((name+id_suffix).encode()).hexdigest()
    return {
        "id": identifier,
        "name": "Route " + name,
        "source": "api",
        "enabled": True,
        "matchers": [{"type": "literal", "field": "to", "value": name}],
        "actions": [action],
        "priority": 10,
    }

def forward(address):
    return rule(address, {"type": "forward", "value": ["verified@gmail.com"]})

def worker(address):
    return rule(address, {"type": "worker", "value": ["cdec-inbound-archive"]})

class PrivacyRolloutTests(unittest.TestCase):
    def test_requires_exact_single_enabled_address_rule(self):
        r = forward(m.TARGET)
        self.assertEqual(m.rule_for([r], m.TARGET)["id"], r["id"])
        with self.assertRaisesRegex(RuntimeError, "exactly one"):
            m.rule_for([], m.TARGET)
        with self.assertRaisesRegex(RuntimeError, "exactly one"):
            m.rule_for([r, r], m.TARGET)
        r["enabled"] = False
        with self.assertRaisesRegex(RuntimeError, "exactly one"):
            m.rule_for([r], m.TARGET)

    def test_disallows_worker_managed_or_catch_all_rules(self):
        r = forward(m.TARGET)
        r["source"] = "wrangler"
        with self.assertRaisesRegex(RuntimeError, "Worker-managed"):
            m.rule_for([r], m.TARGET)
        r["source"] = "api"
        r["matchers"] = [{"type": "all"}]
        with self.assertRaisesRegex(RuntimeError, "unexpected match"):
            m.rule_for([r], m.TARGET)

    def test_exact_gmail_forwarding_only(self):
        self.assertEqual(m.forward_address(forward(m.TARGET)), "verified@gmail.com")
        self.assertIsNone(m.forward_address(worker(m.TARGET)))
        self.assertIsNone(m.forward_address(rule(m.TARGET, {"type": "forward", "value": ["other@example.org"]})))
        self.assertIsNone(m.forward_address(rule(m.TARGET, {"type": "forward", "value": []})))

    def test_original_rule_fields_remain_in_payload(self):
        source = forward(m.TARGET)
        payload = m.original_payload(source)
        self.assertEqual(payload["actions"], source["actions"])
        self.assertEqual(payload["priority"], source["priority"])
        self.assertEqual(payload["matchers"], source["matchers"])
        self.assertNotIn("id", payload)

    def test_snapshot_is_private_and_rollbacks_preserve_gmail_destination(self):
        with tempfile.TemporaryDirectory() as td:
            location = Path(td)/"private"/"backup.json"
            with patch.object(m, "BACKUP", location):
                original = forward(m.TARGET)
                m.save_backup(original)
                self.assertEqual(location.stat().st_mode & 0o777, 0o600)
                self.assertEqual(location.parent.stat().st_mode & 0o777, 0o700)
                saved = json.loads(location.read_text())
                self.assertEqual(saved["actions"], original["actions"])
                m.save_backup(original)  # rerun is idempotent
                with self.assertRaisesRegex(RuntimeError, "differs"):
                    m.save_backup(forward(m.TARGET + "x"))

    def test_protected_legal_and_support_detect_unexpected_changes(self):
        legal = forward("legal@receiptboss.ca")
        support = forward("support@receiptboss.ca")
        original = [legal, support]
        protected = m.protected_snapshot(original)
        m.verify_unchanged(protected, original)
        changed = [worker("legal@receiptboss.ca"), support]
        with self.assertRaisesRegex(RuntimeError, "Unexpected change"):
            m.verify_unchanged(protected, changed)

    def test_worker_secrets_verified_without_reading_secret_value(self):
        requested = []
        def api(method, path, token):
            requested.append(path)
            if path.endswith("/secrets/LEGACY_FORWARD_DESTINATION"):
                return {"result": {"name": "LEGACY_FORWARD_DESTINATION", "type": "secret_text"}}
            return {"result": {"bindings": [
                {"name": "MAIL_ARCHIVE", "type": "r2_bucket", "bucket_name": "cdec-inbound-mail"},
                {"name": "ALLOWED_RECIPIENTS", "type": "plain_text",
                 "text": "inbox-test@receiptboss.ca,privacy@receiptboss.ca"},
                {"name": "LEGACY_FORWARD_RECIPIENTS", "type": "plain_text",
                 "text": "legal@receiptboss.ca,privacy@receiptboss.ca"},
                {"name": "LEGACY_FORWARD_DESTINATION", "type": "secret_text"},
            ]}}
        with patch.object(m.deploy, "api", side_effect=api):
            m.check_worker_secret("redacted-token")
        self.assertEqual(len(requested), 2)

    def test_missing_or_wrong_secret_binding_blocks_migration(self):
        def api(method, path, token):
            return {"result": {"name": "LEGACY_FORWARD_DESTINATION", "type": "plain_text"}}
        with patch.object(m.deploy, "api", side_effect=api):
            with self.assertRaisesRegex(RuntimeError, "Encrypted forwarding"):
                m.check_worker_secret("redacted-token")


if __name__ == "__main__":
    unittest.main()
