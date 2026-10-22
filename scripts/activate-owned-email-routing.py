#!/usr/bin/env python3
"""Safely activate Cloudflare Email Routing for the user's five approved zones.

The Cloudflare API POST /zones/{id}/email/routing/dns creates and locks
the necessary MX/SPF records. This does NOT enable catch-all routing:
run configure-domain-catchalls.py --apply afterward.

Default mode is a read-only preflight. --apply enables only when every
currently unconfigured zone has *no conflicting apex MX or SPF records*.
Requires Zone Settings Read/Write and existing email-routing permissions.
Uses Cloudflare DNS Read when available; otherwise requires two independent
public DNS-over-HTTPS resolvers to agree before enabling an unconfigured zone.
Existing DNS records are never changed directly by this program.
"""
import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

BASE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("cdec_domain_catchalls", BASE / "configure-domain-catchalls.py")
catchalls = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = catchalls
spec.loader.exec_module(catchalls)

DOMAINS = catchalls.DOMAINS



def public_apex_records(domain, kind):
    """Fail-closed DNS inventory when the Cloudflare DNS API returns 403.

    Two independent public DNS resolvers must agree on published apex MX and
    SPF TXT records. Unrelated TXT records cannot conflict with MX/SPF and
    may differ due to DNS propagation; ignore those, never ignore SPF drift.
    We *never* trust the Email Routing required-DNS endpoint as a current
    DNS inventory. If relevant results conflict/are invalid, refuse activation.
    """
    qtype = {"MX": 15, "TXT": 16}[kind]
    urls = (
        "https://cloudflare-dns.com/dns-query",
        "https://dns.google/resolve",
    )
    inventories = []
    for endpoint in urls:
        query = urlencode({"name": domain, "type": kind})
        req = Request(endpoint + "?" + query, headers={"Accept": "application/dns-json"})
        try:
            with urlopen(req, timeout=12) as response:
                dns = json.load(response)
        except (HTTPError, URLError, TimeoutError, ValueError, OSError) as exc:
            raise RuntimeError(f"Cannot independently verify published {kind} DNS at {domain}; no DNS changed.") from None
        if not isinstance(dns, dict) or dns.get("Status") != 0 or dns.get("TC") or not isinstance(dns.get("Answer", []), list):
            raise RuntimeError(f"DNS resolver did not return a complete successful {kind} response for {domain}.")
        answers = dns.get("Answer", [])
        if any(item.get("type") == 5 for item in answers if isinstance(item, dict)):
            raise RuntimeError(f"Unexpected DNS alias (CNAME) at {domain}; cannot safely activate Email Routing.")
        records = set()
        for item in answers:
            if not isinstance(item, dict):
                raise RuntimeError(f"Invalid DNS answer at {domain}.")
            if item.get("type") != qtype:
                continue
            if str(item.get("name", "")).rstrip(".").lower() != domain:
                raise RuntimeError(f"DNS answer refers to an unexpected hostname at {domain}.")
            if not isinstance(item.get("data"), str) or not item["data"]:
                raise RuntimeError(f"DNS answer has no valid {kind} record at {domain}.")
            records.add(item["data"].strip().lower())
        # Only MX and SPF TXT records can conflict with Email Routing.
        # Unrelated TXT records can differ across caches during propagation.
        # Keep failing closed when SPF differs between resolvers.
        if kind == "TXT":
            records = {value for value in records if re.search(
                r'(?i)(?:^|[\\"])\\s*v=spf1(?:\\s|$)', value
            )}
        inventories.append(records)

    if inventories[0] != inventories[1]:
        raise RuntimeError(
            f"Independent resolvers disagree on published apex {kind} DNS for {domain}; "
            "wait for DNS propagation or review records before activation."
        )
    checked = "SPF TXT" if kind == "TXT" else "MX"
    print(f"{domain}: DNS API unavailable; both resolvers agree on {len(inventories[0])} apex {checked} record(s).")
    return [{"name": domain, "type": kind, "content": value} for value in sorted(inventories[0])]


def list_apex_records(token, zone_id, domain, kind):
    # Filtering at the DNS API prevents accidentally interpreting subdomain
    # sender MX/SPF (e.g. Resend 'send') as an apex conflict.
    try:
        result = catchalls.deploy.api(
            "GET", f"/zones/{zone_id}/dns_records?" +
            urlencode({"type": kind, "name": domain, "page": 1, "per_page": 100}),
            token,
        )
    except RuntimeError as error:
        # DNS Read is not mandatory for the Email Routing activation API.
        # Fall back only for this specific denied inventory request.
        if f"/zones/{zone_id}/dns_records failed (HTTP 403" not in str(error):
            raise
        return public_apex_records(domain, kind)
    items = result.get("result")
    if not isinstance(items, list):
        raise RuntimeError(f"Could not audit {kind} DNS at {domain}.")
    info = result.get("result_info") or {}
    if int(info.get("total_pages") or 1) > 1 or len(items) == 100:
        raise RuntimeError(f"Cannot fully audit {kind} DNS at {domain}; refusing enable.")
    return [r for r in items if r.get("type") == kind and
            str(r.get("name", "")).rstrip(".").lower() == domain]


def preflight_zone(token, domain):
    zone = catchalls.zone_id(token, domain)
    settings = catchalls.deploy.api(
        "GET", f"/zones/{zone}/email/routing", token,
    ).get("result") or {}
    if settings.get("name") != domain:
        raise RuntimeError(f"Unexpected Email Routing zone identity at {domain}.")

    state = settings.get("status")
    enabled = settings.get("enabled")
    if enabled is True and state == "ready":
        return {"domain": domain, "zone": zone, "action": "already ready"}
    if enabled is not False or state != "unconfigured":
        raise RuntimeError(
            f"{domain} Email Routing is {state!r} (enabled={enabled!s}); refusing automatic DNS changes."
        )

    mx = list_apex_records(token, zone, domain, "MX")
    txt = list_apex_records(token, zone, domain, "TXT")
    spf = [r for r in txt if re.search(r"(?i)(?:^|[\"])\s*v=spf1(?:\s|$)", str(r.get("content", "")))]
    # Activation may remove/replace conflicting MX and SPF records.
    # Refuse to override even a Cloudflare SPF: future sender setup may depend on it.
    if mx or spf:
        raise RuntimeError(
            f"{domain} has {len(mx)} existing apex MX and {len(spf)} existing apex SPF record(s). "
            "Cloudflare activation could replace these. Review DNS manually; no changes made."
        )
    return {"domain": domain, "zone": zone, "action": "activate"}


def preflight(token, domains=DOMAINS):
    results = []
    errors = []
    for domain in domains:
        try:
            results.append(preflight_zone(token, domain))
        except RuntimeError as error:
            errors.append(str(error))
    for row in results:
        print(f"{row['domain']}: {row['action']}")
    for error in errors:
        print(f"BLOCKED: {error}")
    return results, errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Enable only the selected safe unconfigured domains")
    parser.add_argument("--domain", choices=DOMAINS, help="Limit DNS/routing preflight and activation to one owned domain")
    args = parser.parse_args()
    domains = (args.domain,) if args.domain else DOMAINS
    catchalls.deploy.validate_source()
    token = catchalls.deploy.credential()
    results, errors = preflight(token, domains)
    if errors or len(results) != len(domains):
        raise RuntimeError("One or more domains failed safety preflight. Nothing changed.")
    if not args.apply:
        print("PREVIEW ONLY. No DNS/Email Routing changes performed.")
        return

    # Deploy updated Worker *before* enabling new mail delivery, so no new
    # domain is pointed at an R2 Worker that would reject all its recipients.
    if any(r["action"] == "activate" for r in results):
        catchalls.deploy.deploy_worker(token)
        catchalls.verify_live_worker(token)

    for row in results:
        if row["action"] == "already ready":
            print(f"Unchanged: {row['domain']} already enabled.")
            continue
        zone = row["zone"]
        domain = row["domain"]
        # Recheck DNS immediately before mutation to reduce stale-preflight risk.
        again = preflight_zone(token, domain)
        if again["action"] == "already ready":
            print(f"Unchanged: {domain} became ready.")
            continue
        if again["action"] != "activate":
            raise RuntimeError(f"Unexpected domain status for {domain}; stopping.")

        result = catchalls.deploy.api("POST", f"/zones/{zone}/email/routing/dns", token)
        settings = result.get("result") or {}
        if settings.get("name") != domain:
            raise RuntimeError(f"{domain} returned unexpected routing identity after enable.")
        final = catchalls.deploy.api("GET", f"/zones/{zone}/email/routing", token).get("result") or {}
        if final.get("name") != domain or final.get("enabled") is not True or final.get("status") != "ready":
            raise RuntimeError(
                f"{domain} Email Routing was requested but not confirmed ready; stop and inspect DNS."
            )
        print(f"Enabled: {domain} Cloudflare Email Routing with managed MX/SPF.")

    print("Cloudflare Email Routing confirmed ready for: " + ", ".join(domains))
    selector = " --domain " + domains[0] if args.domain else ""
    print("Next: python3 scripts/configure-domain-catchalls.py" + selector + " --apply")
    print("Note: address-specific forward rules still require their own cutover.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, AssertionError, ValueError, OSError) as error:
        print(f"STOP: {error}", file=sys.stderr)
        sys.exit(1)
