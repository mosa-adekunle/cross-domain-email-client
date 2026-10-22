import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "activate-owned-email-routing.py"
spec = importlib.util.spec_from_file_location("cdec_enable_email_routing", SCRIPT)
m = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = m
spec.loader.exec_module(m)


class ActivateEmailRoutingTests(unittest.TestCase):
    def test_exact_owned_domains(self):
        self.assertEqual(m.DOMAINS, (
            'receiptboss.ca', 'santasbag.ca', 'madenorth.dev',
            'madekunle.com', 'delishearsentertainment.com'
        ))

    def test_existing_ready_domain_is_unchanged_without_dns_api(self):
        def api(method, path, token):
            return {'result': {'name': 'receiptboss.ca', 'enabled': True, 'status': 'ready'}}
        with patch.object(m.catchalls, 'zone_id', return_value='abcd'), \
             patch.object(m.catchalls.deploy, 'api', side_effect=api), \
             patch.object(m, 'list_apex_records') as inventory:
            row = m.preflight_zone('redacted', 'receiptboss.ca')
        self.assertEqual(row['action'], 'already ready')
        inventory.assert_not_called()

    def test_unconfigured_clean_zone_is_safe_to_activate(self):
        def api(method, path, token):
            return {'result': {'name': 'santasbag.ca', 'enabled': False, 'status': 'unconfigured'}}
        with patch.object(m.catchalls, 'zone_id', return_value='abcd'), \
             patch.object(m.catchalls.deploy, 'api', side_effect=api), \
             patch.object(m, 'list_apex_records', return_value=[]):
            row = m.preflight_zone('redacted', 'santasbag.ca')
        self.assertEqual(row['action'], 'activate')

    def test_active_external_mx_blocks_change(self):
        def api(method, path, token):
            return {'result': {'name': 'santasbag.ca', 'enabled': False, 'status': 'unconfigured'}}
        def records(token, zone, domain, kind):
            return [{'type': 'MX', 'name': domain, 'content': 'old.provider.example'}] if kind == 'MX' else []
        with patch.object(m.catchalls, 'zone_id', return_value='abcd'), \
             patch.object(m.catchalls.deploy, 'api', side_effect=api), \
             patch.object(m, 'list_apex_records', side_effect=records):
            with self.assertRaisesRegex(RuntimeError, 'existing apex MX'):
                m.preflight_zone('redacted', 'santasbag.ca')

    def test_existing_spf_blocks_change(self):
        def api(method, path, token):
            return {'result': {'name': 'madenorth.dev', 'enabled': False, 'status': 'unconfigured'}}
        def records(token, zone, domain, kind):
            return [{'type': 'TXT', 'name': domain, 'content': '"v=spf1 include:old.example ~all"'}] if kind == 'TXT' else []
        with patch.object(m.catchalls, 'zone_id', return_value='abcd'), \
             patch.object(m.catchalls.deploy, 'api', side_effect=api), \
             patch.object(m, 'list_apex_records', side_effect=records):
            with self.assertRaisesRegex(RuntimeError, 'existing apex SPF'):
                m.preflight_zone('redacted', 'madenorth.dev')

    def test_other_txt_does_not_count_as_spf(self):
        def api(method, path, token):
            return {'result': {'name': 'madenorth.dev', 'enabled': False, 'status': 'unconfigured'}}
        def records(token, zone, domain, kind):
            return [{'type': 'TXT', 'name': domain, 'content': '"google-site-verification=abc"'}] if kind == 'TXT' else []
        with patch.object(m.catchalls, 'zone_id', return_value='abcd'), \
             patch.object(m.catchalls.deploy, 'api', side_effect=api), \
             patch.object(m, 'list_apex_records', side_effect=records):
            self.assertEqual(m.preflight_zone('redacted', 'madenorth.dev')['action'], 'activate')

    def test_misconfigured_zone_fails_closed(self):
        def api(method, path, token):
            return {'result': {'name': 'santasbag.ca', 'enabled': True, 'status': 'misconfigured'}}
        with patch.object(m.catchalls, 'zone_id', return_value='abcd'), \
             patch.object(m.catchalls.deploy, 'api', side_effect=api):
            with self.assertRaisesRegex(RuntimeError, 'refusing automatic DNS changes'):
                m.preflight_zone('redacted', 'santasbag.ca')

    def test_dns_inventory_must_not_include_subdomain_sender_mx(self):
        observed = []
        def api(method, url, token):
            observed.append(url)
            return {'result': [{'type': 'MX', 'name': 'send.santasbag.ca', 'content': 'resend.example'},
                               {'type': 'MX', 'name': 'santasbag.ca', 'content': 'mx.cloudflare.net'}],
                    'result_info': {'total_pages': 1}}
        with patch.object(m.catchalls.deploy, 'api', side_effect=api):
            result = m.list_apex_records('redacted', '123abc', 'santasbag.ca', 'MX')
        self.assertEqual(len(result), 1)
        self.assertIn('name=santasbag.ca', observed[0])
        self.assertIn('type=MX', observed[0])

    def test_partial_cloudflare_dns_inventory_fails_closed(self):
        def api(method, url, token):
            return {'result': [], 'result_info': {'total_pages': 2}}
        with patch.object(m.catchalls.deploy, 'api', side_effect=api):
            with self.assertRaisesRegex(RuntimeError, 'fully audit'):
                m.list_apex_records('redacted', 'abcd', 'santasbag.ca', 'MX')


    def test_selected_domain_preflight_does_not_inspect_other_zones(self):
        from io import StringIO
        from contextlib import redirect_stdout
        with patch.object(m, "preflight_zone", return_value={
             "domain": "madenorth.dev", "zone": "made-zone", "action": "activate"}) as check, \
             redirect_stdout(StringIO()):
            results, errors = m.preflight("redacted", ("madenorth.dev",))
        check.assert_called_once_with("redacted", "madenorth.dev")
        self.assertEqual([r["domain"] for r in results], ["madenorth.dev"])
        self.assertEqual(errors, [])

    def test_apply_selected_domain_never_writes_other_zone_dns(self):
        from io import StringIO
        from contextlib import redirect_stdout
        writes = []
        def api(method, path, token):
            if method == "POST":
                writes.append(path)
                return {"result": {"name": "madenorth.dev"}}
            return {"result": {"name": "madenorth.dev", "enabled": True, "status": "ready"}}
        with patch.object(m.sys, "argv", ["script", "--domain", "madenorth.dev", "--apply"]), \
             patch.object(m.catchalls.deploy, "validate_source"), \
             patch.object(m.catchalls.deploy, "credential", return_value="redacted"), \
             patch.object(m, "preflight_zone", return_value={
                 "domain": "madenorth.dev", "zone": "made-zone", "action": "activate"}) as inspected, \
             patch.object(m.catchalls.deploy, "deploy_worker") as worker, \
             patch.object(m.catchalls, "verify_live_worker"), \
             patch.object(m.catchalls.deploy, "api", side_effect=api), \
             redirect_stdout(StringIO()):
            m.main()
        self.assertEqual(inspected.call_count, 2)
        for call in inspected.call_args_list:
            self.assertEqual(call.args, ("redacted", "madenorth.dev"))
        worker.assert_called_once_with("redacted")
        self.assertEqual(writes, ["/zones/made-zone/email/routing/dns"])

    def test_public_dns_fallback_on_specific_cloudflare_403(self):
        from io import BytesIO
        import json
        answers = {"Status": 0, "TC": False, "Answer": [
            {"type": 15, "name": "santasbag.ca.", "data": "10 existing.mail.example."}
        ]}
        calls = []
        def blocked(method, path, token):
            raise RuntimeError("Cloudflare API GET /zones/abcd/dns_records failed (HTTP 403, Cloudflare code 10000).")
        def public(req, timeout=12):
            calls.append(req.full_url)
            return BytesIO(json.dumps(answers).encode())
        with patch.object(m.catchalls.deploy, "api", side_effect=blocked), \
             patch.object(m, "urlopen", side_effect=public):
            result = m.list_apex_records("redacted", "abcd", "santasbag.ca", "MX")
        self.assertEqual(len(calls), 2)
        self.assertEqual(result[0]["type"], "MX")
        self.assertIn("existing.mail.example", result[0]["content"])

    def test_independent_resolvers_agree_when_apex_has_no_mx_or_spf(self):
        from io import BytesIO
        import json
        def public(req, timeout=12):
            return BytesIO(json.dumps({"Status": 0, "Answer": []}).encode())
        with patch.object(m, "urlopen", side_effect=public):
            self.assertEqual(m.public_apex_records("santasbag.ca", "MX"), [])
            self.assertEqual(m.public_apex_records("santasbag.ca", "TXT"), [])

    def test_disagreement_between_public_resolvers_stops_cutover(self):
        from io import BytesIO
        import json
        responses = iter([
            {"Status": 0, "Answer": []},
            {"Status": 0, "Answer": [
                {"type": 15, "name": "santasbag.ca.", "data": "10 existing.mail.example."}]},
        ])
        with patch.object(m, "urlopen", side_effect=lambda *a, **kw: BytesIO(json.dumps(next(responses)).encode())):
            with self.assertRaisesRegex(RuntimeError, "resolvers disagree"):
                m.public_apex_records("santasbag.ca", "MX")

    def test_public_resolver_dns_failure_stops_activation(self):
        from io import BytesIO
        import json
        with patch.object(m, "urlopen", return_value=BytesIO(json.dumps({"Status": 3}).encode())):
            with self.assertRaisesRegex(RuntimeError, "complete successful"):
                m.public_apex_records("santasbag.ca", "MX")

    def test_public_spf_records_are_detected_as_existing_conflicts(self):
        from io import BytesIO
        import json
        def public(req, timeout=12):
            return BytesIO(json.dumps({"Status": 0, "Answer": [
                {"type": 16, "name": "madenorth.dev.",
                 "data": '\\"v=spf1 include:some.sender.example ~all\\"'}
            ]}).encode())
        with patch.object(m, "urlopen", side_effect=public):
            records = m.public_apex_records("madenorth.dev", "TXT")
        self.assertRegex(records[0]["content"], "v=spf1")

    def test_other_api_failures_must_not_use_public_fallback(self):
        def blocked(method, path, token):
            raise RuntimeError("Cloudflare API GET /zones/abcd/dns_records failed (HTTP 401).")
        with patch.object(m.catchalls.deploy, "api", side_effect=blocked), \
             patch.object(m, "public_apex_records") as fallback:
            with self.assertRaisesRegex(RuntimeError, "HTTP 401"):
                m.list_apex_records("redacted", "abcd", "santasbag.ca", "MX")
        fallback.assert_not_called()

    def test_unrelated_txt_disagreement_does_not_block_spf_safety_check(self):
        from io import BytesIO
        import json
        replies = iter([
            {"Status": 0, "Answer": [
                {"type": 16, "name": "delishearsentertainment.com.",
                 "data": '"google-site-verification=old-token"'}]},
            {"Status": 0, "Answer": [
                {"type": 16, "name": "delishearsentertainment.com.",
                 "data": '"google-site-verification=new-token"'}]},
        ])
        with patch.object(m, "urlopen", side_effect=lambda *a, **kw: BytesIO(json.dumps(next(replies)).encode())):
            self.assertEqual(m.public_apex_records("delishearsentertainment.com", "TXT"), [])

    def test_spf_disagreement_still_blocks_activation(self):
        from io import BytesIO
        import json
        replies = iter([
            {"Status": 0, "Answer": [
                {"type": 16, "name": "delishearsentertainment.com.",
                 "data": '"v=spf1 include:sender.example ~all"'}]},
            {"Status": 0, "Answer": [
                {"type": 16, "name": "delishearsentertainment.com.",
                 "data": '"google-site-verification=site-key"'}]},
        ])
        with patch.object(m, "urlopen", side_effect=lambda *a, **kw: BytesIO(json.dumps(next(replies)).encode())):
            with self.assertRaisesRegex(RuntimeError, "resolvers disagree"):
                m.public_apex_records("delishearsentertainment.com", "TXT")

    def test_existing_matching_spf_still_blocks_activation(self):
        from io import BytesIO
        import json
        response = {"Status": 0, "Answer": [
            {"type": 16, "name": "delishearsentertainment.com.",
             "data": '"v=spf1 include:sender.example ~all"'}]}
        with patch.object(m, "urlopen", side_effect=lambda *a, **kw: BytesIO(json.dumps(response).encode())):
            records = m.public_apex_records("delishearsentertainment.com", "TXT")
            self.assertEqual(len(records), 1)
            self.assertIn("v=spf1", records[0]["content"])

if __name__ == "__main__":
    unittest.main()
