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
            "catchall": {"source": "api", "enabled": enabled,
                         "matchers": [{"type": "all"}],
                         "actions": [{"type": "drop"}] if actions is None else actions},
            "rules": rules or []}

class MadeNorthR2Tests(unittest.TestCase):
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
        with self.assertRaisesRegex(RuntimeError, "Unexpected active"):
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

if __name__ == "__main__":
    unittest.main()
