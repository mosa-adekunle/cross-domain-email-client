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


if __name__ == "__main__":
    unittest.main()
