#!/usr/bin/env python3
"""Inspect five owned domains, then optionally enable safe catch-all → Worker rules.

Explicit address-specific rules remain untouched. No MX/DNS modifications.
Refuses to replace an existing active catch-all forwarding destination.
"""
import argparse
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlencode

BASE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("cdec_receiptboss_deploy", BASE / "deploy-receiptboss-mail.py")
deploy = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = deploy
spec.loader.exec_module(deploy)

DOMAINS = (
    "receiptboss.ca", "santasbag.ca", "madenorth.dev",
    "madekunle.com", "delishearsentertainment.com",
)
BACKUP = Path.home() / ".config" / "cdec" / "owned-domain-catchalls-original.json"


def zone_id(token, domain):
    result = deploy.api("GET", "/zones?" + urlencode({
        "name": domain, "account.id": deploy.ACCOUNT_ID,
    }), token).get("result")
    if not isinstance(result, list) or len(result) != 1:
        raise RuntimeError(f"Expected exactly one Cloudflare zone for {domain}; cannot proceed.")
    zone = result[0]
    if zone.get("name") != domain or not re.fullmatch(r"[0-9a-f]{32}", str(zone.get("id", ""))):
        raise RuntimeError(f"Unexpected Cloudflare zone identity for {domain}.")
    return zone["id"]


def routing_state(token, zone, domain):
    settings = deploy.api("GET", f"/zones/{zone}/email/routing", token).get("result") or {}
    if settings.get("name") != domain or not settings.get("enabled") or settings.get("status") != "ready":
        raise RuntimeError(f"Email Routing is not confirmed ready for {domain}. Inspect existing MX/provider before cutover.")
    return settings


def report_all_domains(token, domains=DOMAINS):
    """Read-only onboarding audit. Reports every domain, even if one is not ready."""
    ready = 0
    for domain in domains:
        try:
            zone = zone_id(token, domain)
            settings = deploy.api("GET", f"/zones/{zone}/email/routing", token).get("result") or {}
            if settings.get("name") != domain:
                print(f"{domain}: UNVERIFIED (settings returned unexpected domain)")
                continue
            enabled = settings.get("enabled")
            status = settings.get("status") or "unknown"
            if enabled is True and status == "ready":
                ready += 1
                print(f"{domain}: READY (Email Routing enabled)")
            else:
                print(f"{domain}: NOT READY (enabled={enabled!s}, status={status})")
        except RuntimeError as error:
            # Do not let one unconfigured domain conceal the state of others.
            print(f"{domain}: CHECK FAILED ({error})")
    print(f"Summary: {ready}/{len(domains)} domains confirmed ready. Read-only: nothing changed.")
    return ready == len(domains)


def existing_catchall(token, zone):
    rule = deploy.api("GET", f"/zones/{zone}/email/routing/rules/catch_all", token).get("result") or {}
    if rule.get("source", "api") != "api":
        raise RuntimeError("Existing catch-all is managed by Wrangler; stop rather than overwrite.")
    if rule.get("matchers") != [{"type": "all"}]:
        raise RuntimeError("Unexpected catch-all matchers; refusing mutation.")
    return rule


def classify(rule):
    actions = rule.get("actions", [])
    worker = [{"type": "worker", "value": [deploy.WORKER_NAME]}]
    if rule.get("enabled"):
        if actions == worker:
            return "already active"
        raise RuntimeError("Active catch-all delivers elsewhere; preserving existing delivery.")
    if not actions or actions == [{"type": "drop"}] or actions == worker:
        return "enable"
    if actions[0].get("type") == "drop":
        return "enable"
    raise RuntimeError("Disabled catch-all has unexpected action; refusing change.")


def plan(snapshot):
    return {domain: classify(data["catchall"]) for domain, data in snapshot.items()}


def target_rule(rule):
    # Cloudflare's documented catch-all update endpoint accepts an 'all'
    # matcher and exactly one Worker action.
    return {
        "name": "Send all other inbound mail to Cross Domain Email Client",
        "enabled": True,
        "matchers": [{"type": "all"}],
        "actions": [{"type": "worker", "value": [deploy.WORKER_NAME]}],
    }


def inspect(token, domains=DOMAINS):
    snapshot = {}
    for domain in domains:
        zone = zone_id(token, domain)
        routing_state(token, zone, domain)
        catch = existing_catchall(token, zone)
        # Rules for specific addresses take precedence over the catch-all.
        rules_response = deploy.api("GET", f"/zones/{zone}/email/routing/rules?per_page=50&page=1", token)
        rules = rules_response.get("result")
        if not isinstance(rules, list):
            raise RuntimeError(f"Could not audit explicit rules at {domain}.")
        result_info = rules_response.get("result_info") or {}
        if int(result_info.get("total_pages") or 1) > 1 or len(rules) == 50:
            raise RuntimeError(f"Too many explicit rules at {domain}; audit pagination before enabling catch-all.")
        exceptions = sorted({
            recipient
            for rule in rules if rule.get("enabled")
            for recipient in deploy.recipients(rule)
            if rule.get("actions") != [{"type": "worker", "value": [deploy.WORKER_NAME]}]
        })
        snapshot[domain] = {"zone_id": zone, "catchall": catch, "exceptions": exceptions}
    return snapshot


def verify_live_worker(token):
    settings = deploy.api(
        "GET", f"/accounts/{deploy.ACCOUNT_ID}/workers/scripts/{deploy.WORKER_NAME}/settings", token,
    ).get("result") or {}
    bindings = {b.get("name"): b for b in settings.get("bindings", []) if isinstance(b, dict)}
    if bindings.get("MAIL_ARCHIVE", {}).get("type") != "r2_bucket":
        raise RuntimeError("Live Worker has no private R2 binding.")
    allowed = bindings.get("ALLOWED_DOMAINS", {})
    if allowed.get("type") != "plain_text" or allowed.get("text", "").split(",") != list(DOMAINS):
        raise RuntimeError("Deployed Worker domain list does not match the approved five domains.")


def check_local_mailboxes(domains=DOMAINS):
    """Refuse routing unless each selected domain already has its catch-all inbox."""
    for domain in domains:
        process = subprocess.run(
            ["sudo", "docker", "compose", "exec", "-T", "api",
             "php", "artisan", "mail:provision-catchalls", f"--domain={domain}"],
            cwd=deploy.ROOT, capture_output=True, text=True, check=True,
        )
        if "0 catch-all mailbox(es)" not in process.stdout or "0 domain(s)" not in process.stdout:
            raise RuntimeError(
                f"Provision catchall@{domain} in PostgreSQL before enabling Cloudflare routing."
            )


def backup(snapshot):
    """Atomically preserve each selected zone's original rule, without erasing others."""
    BACKUP.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(BACKUP.parent, 0o700)
    saved = json.loads(BACKUP.read_text()) if BACKUP.exists() else {}
    if not isinstance(saved, dict):
        raise RuntimeError("Existing catch-all backup format is invalid; stopping.")
    for domain, details in snapshot.items():
        old = saved.get(domain)
        if old is not None and old.get("zone_id") != details["zone_id"]:
            raise RuntimeError("Saved backup belongs to another Cloudflare zone; stopping.")
        if old is None:
            saved[domain] = {"zone_id": details["zone_id"], "catchall": details["catchall"]}
    fd, temporary = tempfile.mkstemp(prefix=".catchall-backup-", dir=BACKUP.parent)
    try:
        os.chmod(temporary, 0o600)
        with os.fdopen(fd, "w") as handle:
            json.dump(saved, handle, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, BACKUP)
        os.chmod(BACKUP, 0o600)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--apply", action="store_true", help="Deploy Worker and enable safe domain catch-all rules")
    modes.add_argument("--status", action="store_true", help="Report Email Routing readiness without changes")
    parser.add_argument("--domain", choices=DOMAINS, help="Limit audit or activation to one approved domain")
    args = parser.parse_args()
    domains = (args.domain,) if args.domain else DOMAINS
    deploy.validate_source()
    token = deploy.credential()
    if args.status:
        report_all_domains(token, domains)
        return
    snapshot = inspect(token, domains)
    intended = plan(snapshot)
    for domain, action in intended.items():
        exceptions = snapshot[domain]["exceptions"]
        print(f"{domain}: catch-all {action}; {len(exceptions)} explicit non-Worker routes")
        for address in exceptions:
            print(f"  Existing rule still delivers outside Cross Domain Email Client: {address}")
    if not args.apply:
        print("PREVIEW: No Worker, catch-all or specific routing rule changed.")
        return

    check_local_mailboxes(domains)
    # Before any rules point to a new catch-all, deploy the source with all
    # owned domains; Worker tests and dry-run are run by deploy_worker().
    deploy.deploy_worker(token)
    verify_live_worker(token)
    backup(snapshot)

    for domain in domains:
        zone = snapshot[domain]["zone_id"]
        updated = existing_catchall(token, zone)
        action = classify(updated)
        if action == "already active":
            print(f"Unchanged: {domain} catch-all already points to Worker.")
            continue
        deploy.api("PUT", f"/zones/{zone}/email/routing/rules/catch_all", token, target_rule(updated))
        if classify(existing_catchall(token, zone)) != "already active":
            raise RuntimeError(f"Catch-all could not be verified for {domain}.")
        print(f"Enabled: *@{domain} -> {deploy.WORKER_NAME}")
    print("Catch-all rules verified for: " + ", ".join(domains))
    print("IMPORTANT: Existing explicit forwarding rules listed above still bypass the Worker.")
    print("Continue migrating those routes individually while preserving any required forwarding.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, AssertionError, ValueError, OSError, subprocess.CalledProcessError) as error:
        print("STOP: " + str(error), file=sys.stderr)
        sys.exit(1)
