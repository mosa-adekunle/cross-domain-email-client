#!/usr/bin/env python3
"""Safely route inbound @madenorth.dev email to the existing Cloudflare R2 Worker.

Dry-run by default; --apply makes only zone-scoped Email Routing rule changes.
--replace-existing additionally authorizes replacement of active non-R2 routes.
MX/DNS, outbound SMTP/Resend, and all other domains are NEVER modified.
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

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("made_routing_helpers", HERE / "configure-domain-catchalls.py")
helpers = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = helpers
spec.loader.exec_module(helpers)

DOMAIN = "madenorth.dev"
ADDRESSES = ("mosa@madenorth.dev", "hello@madenorth.dev", "sales@madenorth.dev")
ACTION = [{"type": "worker", "value": [helpers.deploy.WORKER_NAME]}]
BACKUP = Path.home() / ".config" / "cdec" / "madenorth-inbound-before-r2.json"


def list_rules(token, zone):
    rules = []
    for page in range(1, 101):
        url = f"/zones/{zone}/email/routing/rules?" + urlencode({"page": page, "per_page": 50})
        response = helpers.deploy.api("GET", url, token)
        batch = response.get("result")
        if not isinstance(batch, list):
            raise RuntimeError("Cloudflare rules inventory is unavailable.")
        rules.extend(batch)
        info = response.get("result_info") or {}
        pages = info.get("total_pages")
        if pages is not None:
            if not isinstance(pages, int) or pages < 1 or pages > 100:
                raise RuntimeError("Unexpected Cloudflare pagination.")
            if page >= pages:
                return rules
        elif len(batch) < 50:
            return rules
        if not batch:
            return rules
    raise RuntimeError("Incomplete routing-rule inventory; refusing write.")


def inspect(token):
    zone = helpers.zone_id(token, DOMAIN)
    helpers.routing_state(token, zone, DOMAIN)
    return {
        "domain": DOMAIN, "zone_id": zone,
        "catchall": helpers.existing_catchall(token, zone),
        "rules": list_rules(token, zone),
    }


def recipient(rule):
    matchers = rule.get("matchers") or []
    if len(matchers) != 1 or matchers[0].get("type") != "literal" or matchers[0].get("field") != "to":
        raise RuntimeError("Unexpected active routing-rule matcher.")
    address = str(matchers[0].get("value", "")).strip().lower()
    if not re.fullmatch(r"[a-z0-9_.+%-]+@madenorth\.dev", address):
        raise RuntimeError("Unexpected exact-address rule outside madenorth.dev.")
    return address


def plan(snapshot, replace_existing=False):
    if snapshot.get("domain") != DOMAIN or not re.fullmatch(r"[a-f0-9]{32}", str(snapshot.get("zone_id"))):
        raise RuntimeError("Cloudflare Made North zone identity cannot be verified.")
    catch = snapshot["catchall"]
    if catch.get("source", "api") != "api" or catch.get("matchers") != [{"type": "all"}]:
        raise RuntimeError("Catch-all is not API-managed with expected matchers.")
    if catch.get("actions") != ACTION and catch.get("enabled") and not replace_existing:
        raise RuntimeError("Active catch-all delivers elsewhere; preview with --replace-existing.")
    if catch.get("actions") not in (ACTION, [], [{"type": "drop"}]) and not replace_existing:
        raise RuntimeError("Catch-all destination needs explicit --replace-existing approval.")

    existing = {}
    changes = []
    disabled = set()
    for rule in snapshot["rules"]:
        if not rule.get("enabled"):
            # Other disabled rules do not intercept live delivery. Disabled rules
            # for a required identity must be inspected to avoid duplicates.
            try:
                address = recipient(rule)
            except RuntimeError:
                continue
            disabled.add(address)
            continue
        address = recipient(rule)
        if address in existing:
            raise RuntimeError("Overlapping active Cloudflare routing rules for " + address)
        existing[address] = rule
        if rule.get("actions") == ACTION:
            continue
        if rule.get("source", "api") != "api":
            raise RuntimeError("Wrangler-managed address rule requires manual review: " + address)
        if not replace_existing:
            raise RuntimeError("Active rule bypasses R2 for " + address + "; preview with --replace-existing.")
        if not re.fullmatch(r"[a-f0-9]{32}", str(rule.get("id", ""))):
            raise RuntimeError("Rule cannot be safely updated (missing ID): " + address)
        changes.append(("update", address, rule))
    for address in ADDRESSES:
        if address not in existing:
            if address in disabled:
                raise RuntimeError("Disabled rule for " + address + " needs manual review.")
            changes.append(("create", address, None))
    return {"changes": changes, "catchall": not (catch.get("enabled") and catch.get("actions") == ACTION)}


def target_rule(address, existing=None):
    result = {
        "name": (existing or {}).get("name") or ("Archive " + address + " in Made North Mail"),
        "enabled": True,
        "matchers": [{"type": "literal", "field": "to", "value": address}],
        "actions": ACTION,
    }
    if existing is not None and isinstance(existing.get("priority"), int):
        result["priority"] = existing["priority"]
    return result


def save_backup(snapshot):
    BACKUP.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(BACKUP.parent, 0o700)
    if BACKUP.exists():
        existing = json.loads(BACKUP.read_text())
        if existing.get("domain") != DOMAIN or existing.get("zone_id") != snapshot["zone_id"]:
            raise RuntimeError("Existing backup refers to another Cloudflare zone.")
        print("Original backup preserved: " + str(BACKUP))
        return
    fd, path = tempfile.mkstemp(dir=BACKUP.parent, prefix=".madenorth-original-")
    try:
        os.chmod(path, 0o600)
        with os.fdopen(fd, "w") as handle:
            json.dump(snapshot, handle, indent=2)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(path, BACKUP)
        os.chmod(BACKUP, 0o600)
    finally:
        if os.path.exists(path):
            os.unlink(path)
    print("Original routing saved privately: " + str(BACKUP))


def apply(token, before, intended, replace_existing=False):
    helpers.check_local_mailboxes((DOMAIN,))
    # This read-only importer preflight verifies that the R2 bucket is accessible.
    subprocess.run(
        ["sudo", "docker", "compose", "exec", "-T", "api", "php", "artisan",
         "mail:sync-r2", "--mode=incremental", "--dry-run", "--limit=1"],
        cwd=helpers.deploy.ROOT, check=True,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    helpers.deploy.deploy_worker(token)
    helpers.verify_live_worker(token)
    if inspect(token) != before:
        raise RuntimeError("Cloudflare routing changed during preflight. No rules modified.")
    if plan(before, replace_existing) != intended:
        raise RuntimeError("Cloudflare migration plan changed. No rules modified.")
    save_backup(before)
    zone = before["zone_id"]
    for operation, address, old in intended["changes"]:
        state = inspect(token)
        found = [rule for rule in state["rules"] if rule.get("enabled") and recipient(rule) == address]
        if operation == "create":
            if found:
                raise RuntimeError("Conflicting new route appeared for " + address)
            helpers.deploy.api("POST", f"/zones/{zone}/email/routing/rules", token, target_rule(address))
        else:
            if found != [old]:
                raise RuntimeError("Original rule changed for " + address + "; stop.")
            helpers.deploy.api("PUT", f"/zones/{zone}/email/routing/rules/{old['id']}",
                               token, target_rule(address, old))
        verified = [rule for rule in list_rules(token, zone)
                    if rule.get("enabled") and recipient(rule) == address]
        if len(verified) != 1 or verified[0].get("actions") != ACTION:
            raise RuntimeError("Could not verify R2 Worker for " + address)
        print("Verified: " + address + " -> " + helpers.deploy.WORKER_NAME)

    if intended["catchall"]:
        fresh = helpers.existing_catchall(token, zone)
        if fresh != before["catchall"]:
            raise RuntimeError("Catch-all changed during cutover; review original backup.")
        helpers.deploy.api("PUT", f"/zones/{zone}/email/routing/rules/catch_all",
                           token, helpers.target_rule(fresh))
    final = plan(inspect(token))
    if final["changes"] or final["catchall"]:
        raise RuntimeError("Final Cloudflare route audit failed. Review the saved backup.")
    print("VERIFIED: All active @madenorth.dev exact and catch-all rules target private R2 Worker.")
    print("Next: external test emails -> new R2 .eml files -> Laravel importer -> inbox.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Change selected-zone rules after checks")
    parser.add_argument("--replace-existing", action="store_true",
                        help="Explicit approval to replace active forwarding or drop routes")
    args = parser.parse_args()
    helpers.deploy.validate_source()
    token = helpers.deploy.credential()
    before = inspect(token)
    intended = plan(before, args.replace_existing)
    print("Scope: ONLY madenorth.dev. No DNS, Resend, SMTP or other-domain changes.")
    for operation, address, old in intended["changes"]:
        if old and old.get("actions") != ACTION:
            print("  replace active destination: " + address)
        else:
            print("  " + operation + ": " + address)
    print("Catch-all: " + ("route to Worker" if intended["catchall"] else "already Worker"))
    if not args.apply:
        print("READ-ONLY PREVIEW: Cloudflare was not modified.")
        return
    apply(token, before, intended, args.replace_existing)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, AssertionError, ValueError, OSError, subprocess.CalledProcessError) as error:
        print("STOP: " + str(error), file=sys.stderr)
        sys.exit(1)
