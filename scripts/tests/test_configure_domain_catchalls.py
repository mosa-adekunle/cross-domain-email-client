"""Offline guard tests for domain-wide catch-all Cloudflare routing."""
import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "configure-domain-catchalls.py"
spec = importlib.util.spec_from_file_location("cdec_domain_catchalls", SCRIPT)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

def rule(action="drop", enabled=False, worker="cdec-inbound-archive"):
    return {
        "enabled": enabled,
        "source": "api",
        "matchers": [{"type": "all"}],
        "actions": [{"type": action, "value": [worker]}] if action == "worker" else [{"type": action}],
    }

class DomainCatchallTests(unittest.TestCase):
    def test_all_five_owned_domains_only(self):
        self.assertEqual(module.DOMAINS, (
            "receiptboss.ca", "santasbag.ca", "madenorth.dev",
            "madekunle.com", "delishearsentertainment.com",
        ))

    def test_disabled_drop_can_be_enabled_safely(self):
        self.assertEqual(module.classify(rule()), "enable")
        self.assertEqual(module.classify(rule("worker")), "enable")

    def test_existing_worker_routing_remains_idempotent(self):
        self.assertEqual(module.classify(rule("worker", True)), "already active")

    def test_refuses_to_overwrite_active_forwarding(self):
        with self.assertRaisesRegex(RuntimeError, "Active catch-all"):
            module.classify(rule("forward", True))
        with self.assertRaisesRegex(RuntimeError, "Active catch-all"):
            module.classify(rule("drop", True))

    def test_refuses_unexpected_disabled_action(self):
        with self.assertRaisesRegex(RuntimeError, "unexpected action"):
            module.classify(rule("forward", False))

    def test_target_rule_is_a_worker_catchall_not_a_specific_address(self):
        result = module.target_rule(rule())
        self.assertEqual(result["matchers"], [{"type": "all"}])
        self.assertEqual(result["actions"], [{"type": "worker", "value": ["cdec-inbound-archive"]}])
        self.assertTrue(result["enabled"])

    def test_live_worker_must_match_all_approved_domains(self):
        def valid(method, path, token):
            return {"result": {"bindings": [
                {"name": "MAIL_ARCHIVE", "type": "r2_bucket"},
                {"name": "ALLOWED_DOMAINS", "type": "plain_text",
                 "text": ",".join(module.DOMAINS)},
            ]}}
        with patch.object(module.deploy, "api", side_effect=valid):
            module.verify_live_worker("redacted")
        def wrong(method, path, token):
            return {"result": {"bindings": [
                {"name": "MAIL_ARCHIVE", "type": "r2_bucket"},
                {"name": "ALLOWED_DOMAINS", "type": "plain_text", "text": "receiptboss.ca"},
            ]}}
        with patch.object(module.deploy, "api", side_effect=wrong):
            with self.assertRaisesRegex(RuntimeError, "domain list"):
                module.verify_live_worker("redacted")

    def test_catchall_source_must_not_be_wranger_managed(self):
        bad = rule()
        bad["source"] = "wrangler"
        def mocked(method, path, token):
            return {"result": bad}
        with patch.object(module.deploy, "api", side_effect=mocked):
            with self.assertRaisesRegex(RuntimeError, "managed by Wrangler"):
                module.existing_catchall("token", "zone")

    def test_status_audit_reports_all_domains_when_one_is_unconfigured(self):
        from io import StringIO
        from contextlib import redirect_stdout

        def zone(token, name):
            return "zone-for-" + name

        def api(method, path, token):
            domain = path.rsplit("/", 2)[-2].replace("zone-for-", "")
            return {"result": {"name": domain, "enabled": domain != "santasbag.ca",
                               "status": "unconfigured" if domain == "santasbag.ca" else "ready"}}

        out = StringIO()
        with patch.object(module, "zone_id", side_effect=zone), \
             patch.object(module.deploy, "api", side_effect=api), redirect_stdout(out):
            all_ready = module.report_all_domains("redacted")
        self.assertFalse(all_ready)
        self.assertIn("santasbag.ca: NOT READY (enabled=False, status=unconfigured)", out.getvalue())
        self.assertIn("delishearsentertainment.com: READY", out.getvalue())
        self.assertIn("Summary: 4/5 domains confirmed ready.", out.getvalue())

    def test_status_audit_continues_after_per_zone_api_failure(self):
        from io import StringIO
        from contextlib import redirect_stdout

        def zone(token, name):
            if name == "madenorth.dev":
                raise RuntimeError("Cloudflare rejected zone inspection")
            return name

        def api(method, path, token):
            return {"result": {"name": path.split("/")[2], "enabled": True, "status": "ready"}}

        out = StringIO()
        with patch.object(module, "zone_id", side_effect=zone), \
             patch.object(module.deploy, "api", side_effect=api), redirect_stdout(out):
            all_ready = module.report_all_domains("redacted")
        self.assertFalse(all_ready)
        self.assertIn("madenorth.dev: CHECK FAILED", out.getvalue())
        self.assertIn("Summary: 4/5 domains confirmed ready.", out.getvalue())

if __name__ == "__main__":
    unittest.main()
