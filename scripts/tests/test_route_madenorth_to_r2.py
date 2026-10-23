"""Local offline tests for madenorth.dev-only inbound Cloudflare R2 routing."""
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "route-madenorth-to-r2.py"
spec = importlib.util.spec_from_file_location("test_made_r2_route", SCRIPT)
app = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = app
spec.loader.exec_module(app)

ZONE = "a" * 32
RULE_ID = "b" * 32
WORKER = [{"type": "worker", "value": ["cdec-inbound-archive"]}]

def rule(address, action=None, enabled=True):
    return {"id": RULE_ID, "source": "api", "enabled": enabled,
            "name": "Preexisting", "matchers": [
                {"type": "literal", "field": "to", "value": address}],
            "actions": WORKER if action is None else action}

def state(actions=None, enabled=False, rules=None):
    return {"domain": "madenorth.dev", "zone_id": ZONE,
            "catchall": {"id": "c" * 32, "source": "api", "enabled": enabled,
                         "matchers": [{"type": "all"}],
                         "actions": [{"type": "drop"}] if actions is None else actions},
            "rules": rules or []}

class MadeNorthR2Tests(unittest.TestCase):
    def test_listed_echo_of_catchall_is_verified_and_skipped(self):
        snapshot = state(WORKER, True, [rule(x) for x in app.ADDRESSES])
        echo = dict(snapshot["catchall"])
        snapshot["rules"].insert(0, echo)
        planned = app.plan(snapshot)
        self.assertEqual(planned["changes"], [])
        self.assertFalse(planned["catchall"])
        self.assertEqual(len(app.exact_address_rules(snapshot)), 3)

    def test_listed_disabled_catchall_echo_does_not_block_preview(self):
        snapshot = state()
        snapshot["rules"] = [dict(snapshot["catchall"])]
        planned = app.plan(snapshot)
        self.assertEqual([x[0] for x in planned["changes"]], ["create"] * 3)
        self.assertTrue(planned["catchall"])

    def test_other_wildcard_rule_still_fails_closed(self):
        snapshot = state(WORKER, True)
        wrong = dict(snapshot["catchall"])
        wrong["id"] = "d" * 32
        snapshot["rules"] = [wrong]
        with self.assertRaisesRegex(RuntimeError, "additional wildcard"):
            app.plan(snapshot)

    def test_catchall_echo_with_different_delivery_is_rejected(self):
        snapshot = state(WORKER, True)
        wrong = dict(snapshot["catchall"])
        wrong["actions"] = [{"type": "forward", "value": ["previous@example.com"]}]
        snapshot["rules"] = [wrong]
        with self.assertRaisesRegex(RuntimeError, "differs"):
            app.plan(snapshot)

    def test_missing_wildcard_identity_is_rejected(self):
        snapshot = state(WORKER, True)
        wrong = dict(snapshot["catchall"])
        wrong.pop("id")
        snapshot["rules"] = [wrong]
        with self.assertRaisesRegex(RuntimeError, "no verifiable Cloudflare ID"):
            app.plan(snapshot)

    def test_unsupported_active_matcher_has_actionable_diagnostics(self):
        snapshot = state(WORKER, True)
        weird = rule("hello@madenorth.dev")
        weird["matchers"] = [{"type": "all"}]
        snapshot["rules"] = [weird]
        with self.assertRaisesRegex(RuntimeError, "additional wildcard"):
            app.plan(snapshot)
        weird["matchers"] = [{"type": "regexp", "field": "to", "value": "*"}]
        with self.assertRaisesRegex(RuntimeError, "Unsupported Cloudflare Email Routing rule matcher"):
            app.plan(snapshot)

    def test_unrelated_disabled_rule_cannot_bypass_matcher_validation(self):
        snapshot = state(WORKER, True)
        weird = rule("hello@madenorth.dev", enabled=False)
        weird["matchers"] = []
        snapshot["rules"] = [weird]
        with self.assertRaisesRegex(RuntimeError, "Unsupported Cloudflare"):
            app.plan(snapshot)

    def test_builds_three_business_routes_and_catchall(self):
        planned = app.plan(state())
        self.assertEqual([x[1] for x in planned["changes"]], list(app.ADDRESSES))
        self.assertEqual([x[0] for x in planned["changes"]], ["create"] * 3)
        self.assertTrue(planned["catchall"])

    def test_existing_worker_rules_are_idempotent(self):
        planned = app.plan(state(WORKER, True, [rule(x) for x in app.ADDRESSES]))
        self.assertFalse(planned["catchall"])
        self.assertEqual(planned["changes"], [])

    def test_replacing_active_forward_requires_opt_in(self):
        forward = [{"type": "forward", "value": ["somewhere@example.com"]}]
        with self.assertRaisesRegex(RuntimeError, "replace-existing"):
            app.plan(state(WORKER, True, [rule("hello@madenorth.dev", forward)]))
        planned = app.plan(state(WORKER, True, [rule("hello@madenorth.dev", forward)]), True)
        self.assertEqual(planned["changes"][0][:2], ("update", "hello@madenorth.dev"))
        self.assertEqual(app.target_rule("hello@madenorth.dev")["actions"], WORKER)

    def test_active_forwarding_catchall_is_guarded(self):
        forward = [{"type": "forward", "value": ["destination@example.com"]}]
        with self.assertRaisesRegex(RuntimeError, "Active catch-all"):
            app.plan(state(forward, True))
        self.assertTrue(app.plan(state(forward, True), True)["catchall"])

    def test_all_domains_other_than_made_north_are_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "zone identity"):
            app.plan({**state(), "domain": "receiptboss.ca"})

    def test_migrates_unknown_explicit_address_too(self):
        forward = [{"type": "forward", "value": ["elsewhere@example.com"]}]
        old = rule("contact@madenorth.dev", forward)
        self.assertIn(("update", "contact@madenorth.dev", old),
                      app.plan(state(rules=[old]), True)["changes"])

    def test_overlap_and_invalid_matchers_fail_closed(self):
        with self.assertRaisesRegex(RuntimeError, "Overlapping"):
            app.plan(state(rules=[rule("hello@madenorth.dev"), rule("hello@madenorth.dev")]))
        malformed = rule("hello@madenorth.dev")
        malformed["matchers"] = [{"type": "all"}]
        with self.assertRaisesRegex(RuntimeError, "additional wildcard"):
            app.plan(state(rules=[malformed]))

    def test_disabled_business_rule_requires_review(self):
        with self.assertRaisesRegex(RuntimeError, "Disabled rule"):
            app.plan(state(rules=[rule("hello@madenorth.dev", enabled=False)]))

    def test_wranger_managed_active_forward_refused(self):
        old = rule("hello@madenorth.dev", [{"type": "drop"}])
        old["source"] = "wrangler"
        with self.assertRaisesRegex(RuntimeError, "Wrangler-managed"):
            app.plan(state(rules=[old]), True)

    def test_backup_is_0600_and_never_overwritten(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "backup.json"
            with patch.object(app, "BACKUP", path):
                app.save_backup(state())
                first = path.read_bytes()
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                app.save_backup(state(WORKER, True))
                self.assertEqual(path.read_bytes(), first)

    def test_rule_api_uses_only_the_selected_zone(self):
        def api(method, path, token):
            self.assertIn(ZONE, path)
            return {"result": [], "result_info": {"total_pages": 1}}
        with patch.object(app.helpers.deploy, "api", side_effect=api):
            self.assertEqual(app.list_rules("redacted", ZONE), [])

    def test_local_brand_mailbox_preview_blocks_incomplete_onboarding(self):
        from subprocess import CompletedProcess
        okay = CompletedProcess([], 0, stdout="Preview: 0 domain(s) to create, 0 mailbox(es) to stage.", stderr="")
        pending = CompletedProcess([], 0, stdout="Preview: 0 domain(s) to create, 1 mailbox(es) to stage.", stderr="")
        snapshot = state(WORKER, True, [rule(x) for x in app.ADDRESSES])
        with patch.object(app.helpers, "check_local_mailboxes"), \
             patch.object(app.subprocess, "run", return_value=pending), \
             patch.object(app.helpers.deploy, "deploy_worker") as deploy:
            with self.assertRaisesRegex(RuntimeError, "Stage Made North"):
                app.apply("redacted", snapshot, app.plan(snapshot))
            deploy.assert_not_called()
        with patch.object(app.helpers, "check_local_mailboxes"), \
             patch.object(app.subprocess, "run", side_effect=[okay, okay]), \
             patch.object(app.helpers.deploy, "deploy_worker"), \
             patch.object(app.helpers, "verify_live_worker"), \
             patch.object(app, "inspect", return_value=snapshot), \
             patch.object(app, "save_backup"):
            app.apply("redacted", snapshot, app.plan(snapshot))

if __name__ == "__main__":
    unittest.main()
