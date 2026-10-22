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
            domain = path.split("/")[2].replace("zone-for-", "")
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

    def test_scoped_audit_checks_only_requested_domain(self):
        from io import StringIO
        from contextlib import redirect_stdout
        out = StringIO()
        with patch.object(module, "zone_id", return_value="made-zone") as resolve, \
             patch.object(module.deploy, "api", return_value={"result": {
                 "name": "madenorth.dev", "enabled": True, "status": "ready"}}), \
             redirect_stdout(out):
            success = module.report_all_domains("redacted", ("madenorth.dev",))
        self.assertTrue(success)
        resolve.assert_called_once_with("redacted", "madenorth.dev")
        self.assertIn("Summary: 1/1 domains confirmed ready", out.getvalue())

    def test_scoped_inspection_does_not_touch_other_zones(self):
        rule_response = {"result": [], "result_info": {"total_pages": 1}}
        with patch.object(module, "zone_id", return_value="made-zone") as resolve, \
             patch.object(module, "routing_state", return_value={"name": "madenorth.dev"}), \
             patch.object(module, "existing_catchall", return_value=rule()), \
             patch.object(module.deploy, "api", return_value=rule_response):
            result = module.inspect("redacted", ("madenorth.dev",))
        self.assertEqual(list(result), ["madenorth.dev"])
        resolve.assert_called_once_with("redacted", "madenorth.dev")
        self.assertEqual(result["madenorth.dev"]["exceptions"], [])

    def test_scoped_mailbox_preflight_uses_only_selected_domain(self):
        from subprocess import CompletedProcess
        success = CompletedProcess([], 0, stdout="Preview new: 0 domain(s), 0 catch-all mailbox(es).", stderr="")
        with patch.object(module.subprocess, "run", return_value=success) as run:
            module.check_local_mailboxes(("madenorth.dev",))
        args = run.call_args.args[0]
        self.assertIn("--domain=madenorth.dev", args)
        self.assertNotIn("receiptboss.ca", " ".join(args))
        bad = CompletedProcess([], 0, stdout="Preview new: 0 domain(s), 1 catch-all mailbox(es).", stderr="")
        with patch.object(module.subprocess, "run", return_value=bad):
            with self.assertRaisesRegex(RuntimeError, "catchall@madenorth.dev"):
                module.check_local_mailboxes(("madenorth.dev",))

    def test_single_domain_backup_preserves_other_domain_originals(self):
        import json
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as temp:
            filename = Path(temp) / "original.json"
            first = {"receiptboss.ca": {"zone_id": "receipt-zone", "catchall": rule()}}
            filename.write_text(json.dumps(first))
            with patch.object(module, "BACKUP", filename):
                module.backup({"madenorth.dev": {
                    "zone_id": "made-zone", "catchall": rule()}})
                saved = json.loads(filename.read_text())
                self.assertEqual(saved["receiptboss.ca"], first["receiptboss.ca"])
                self.assertEqual(saved["madenorth.dev"]["zone_id"], "made-zone")
                self.assertEqual(len(saved), 2)
                self.assertEqual(filename.stat().st_mode & 0o777, 0o600)

    def test_apply_scoped_to_madenorth_does_not_modify_other_routing(self):
        from io import StringIO
        from contextlib import redirect_stdout
        snapshot = {"madenorth.dev": {
            "zone_id": "made-zone", "catchall": rule(), "exceptions": []}}
        cloudflare_puts = []
        def api(method, path, token, payload=None):
            if method == "PUT":
                cloudflare_puts.append((path, payload))
            return {"result": {}}
        with patch.object(module.sys, "argv", ["script", "--domain", "madenorth.dev", "--apply"]), \
             patch.object(module.deploy, "validate_source"), \
             patch.object(module.deploy, "credential", return_value="redacted"), \
             patch.object(module, "inspect", return_value=snapshot) as inspect, \
             patch.object(module, "check_local_mailboxes") as check, \
             patch.object(module.deploy, "deploy_worker"), \
             patch.object(module, "verify_live_worker"), \
             patch.object(module, "backup") as backup, \
             patch.object(module, "existing_catchall", side_effect=[
                 rule(), rule("worker", True)]), \
             patch.object(module.deploy, "api", side_effect=api), \
             redirect_stdout(StringIO()):
            module.main()
        inspect.assert_called_once_with("redacted", ("madenorth.dev",))
        check.assert_called_once_with(("madenorth.dev",))
        backup.assert_called_once_with(snapshot)
        self.assertEqual(len(cloudflare_puts), 1)
        self.assertEqual(cloudflare_puts[0][0],
                         "/zones/made-zone/email/routing/rules/catch_all")
        self.assertEqual(cloudflare_puts[0][1]["actions"],
                         [{"type": "worker", "value": ["cdec-inbound-archive"]}])

if __name__ == "__main__":
    unittest.main()
