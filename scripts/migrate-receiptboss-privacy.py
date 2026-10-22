#!/usr/bin/env python3
"""Carefully migrate ONLY privacy@receiptboss.ca from Gmail-only to
Cloudflare Worker dual delivery (R2 archive followed by verified Gmail forwarding).

Default: read-only preflight. --apply: make one guarded change and keep a private
rollback snapshot. --rollback: restore the exact previous Gmail forwarding rule.
Legal and Support routes are never modified.
"""
import argparse
import importlib.util
import json
import os
import re
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("cdec_receiptboss_deploy", BASE / "deploy-receiptboss-mail.py")
deploy = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = deploy
spec.loader.exec_module(deploy)

TARGET = "privacy@receiptboss.ca"
PROTECTED = ("legal@receiptboss.ca", "support@receiptboss.ca")
BACKUP = Path.home() / ".config" / "cdec" / "receiptboss-privacy-original-route.json"


def rule_for(rules, address):
    candidates = [r for r in rules if address in deploy.recipients(r)]
    if len(candidates) != 1 or not candidates[0].get("enabled"):
        raise RuntimeError(f"Expected exactly one enabled rule for {address}. No changes made.")
    rule = candidates[0]
    if not re.fullmatch(r"[a-fA-F0-9]{32}", str(rule.get("id", ""))):
        raise RuntimeError("Routing rule lacks a valid Cloudflare identifier.")
    if rule.get("source", "api") != "api":
        raise RuntimeError("Worker-managed rules cannot be edited by this script.")
    if rule.get("matchers") != [{"type": "literal", "field": "to", "value": address}]:
        raise RuntimeError("Refusing to alter a rule with unexpected match conditions.")
    return rule


def forward_address(rule):
    acts = rule.get("actions")
    if not isinstance(acts, list) or len(acts) != 1 or acts[0].get("type") != "forward":
        return None
    targets = acts[0].get("value")
    if not isinstance(targets, list) or len(targets) != 1:
        return None
    value = str(targets[0]).strip()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value) or not value.lower().endswith("@gmail.com"):
        return None
    return value


def worker_actions(rule):
    return rule.get("actions") == [{"type": "worker", "value": [deploy.WORKER_NAME]}]


def original_payload(rule):
    payload = {
        "name": rule.get("name") or f"Forward {TARGET}",
        "enabled": True,
        "matchers": [{"type": "literal", "field": "to", "value": TARGET}],
        "actions": rule["actions"],
    }
    if rule.get("priority") is not None:
        payload["priority"] = rule["priority"]
    return payload


def check_worker_secret(token):
    # Cloudflare does not expose the secret's value. Confirm that the binding
    # exists and is secret_text, without printing the destination or credentials.
    secret = deploy.api(
        "GET",
        f"/accounts/{deploy.ACCOUNT_ID}/workers/scripts/{deploy.WORKER_NAME}/secrets/LEGACY_FORWARD_DESTINATION",
        token,
    ).get("result") or {}
    if secret.get("name") != "LEGACY_FORWARD_DESTINATION" or secret.get("type") != "secret_text":
        raise RuntimeError("Encrypted forwarding destination secret is not installed.")
    settings = deploy.api(
        "GET",
        f"/accounts/{deploy.ACCOUNT_ID}/workers/scripts/{deploy.WORKER_NAME}/settings",
        token,
    ).get("result") or {}
    bindings = settings.get("bindings") or []
    by_name = {b.get("name"): b for b in bindings if isinstance(b, dict)}
    needed = {
        "MAIL_ARCHIVE": "r2_bucket",
        "ALLOWED_RECIPIENTS": "plain_text",
        "LEGACY_FORWARD_RECIPIENTS": "plain_text",
        "LEGACY_FORWARD_DESTINATION": "secret_text",
    }
    for name, kind in needed.items():
        if by_name.get(name, {}).get("type") != kind:
            raise RuntimeError(f"Production Worker binding {name} is missing or has wrong type.")
    if by_name["MAIL_ARCHIVE"].get("bucket_name") != "cdec-inbound-mail":
        raise RuntimeError("Unexpected production R2 bucket.")
    allowed = by_name["ALLOWED_RECIPIENTS"].get("text", "").split(",")
    forwarded = by_name["LEGACY_FORWARD_RECIPIENTS"].get("text", "").split(",")
    if TARGET not in allowed or TARGET not in forwarded or "legal@receiptboss.ca" not in forwarded:
        raise RuntimeError("Production Worker recipient allowlist/forwarding settings do not match.")
    print("Production Worker R2 binding, allowlists, and encrypted forwarding secret verified.")
    print("Note: Cloudflare does not reveal secret contents; its destination cannot be independently compared here.")


def save_backup(rule):
    if BACKUP.exists():
        stored = json.loads(BACKUP.read_text())
        if stored.get("id") != rule["id"] or stored.get("actions") != rule.get("actions"):
            raise RuntimeError("Existing private rollback file differs from live Gmail route; aborting.")
        return
    BACKUP.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(BACKUP.parent, 0o700)
    payload = {"id": rule["id"], **original_payload(rule)}
    fd = os.open(BACKUP, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as target:
        json.dump(payload, target, indent=2)
        target.write("\n")
    os.chmod(BACKUP, 0o600)
    print("Saved original Gmail-only route to a private 0600 rollback file.")


def protected_snapshot(rules):
    return {
        address: rule_for(rules, address)
        for address in PROTECTED
    }


def verify_unchanged(before, after):
    for address, original in before.items():
        if rule_for(after, address) != original:
            raise RuntimeError(f"Unexpected change in protected {address} route; inspect immediately.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--apply", action="store_true", help="Switch Privacy to Worker dual delivery")
    modes.add_argument("--rollback", action="store_true", help="Restore original Privacy Gmail-only forwarding")
    args = parser.parse_args()

    deploy.validate_source()
    token = deploy.credential()
    before = deploy.list_rules(token)
    deploy.plan(before)  # Must retain the working ReceiptBoss pilot and Sales/Hello.
    protected = protected_snapshot(before)
    current = rule_for(before, TARGET)

    if args.rollback:
        if not BACKUP.exists():
            raise RuntimeError("No private Gmail-only route backup found; refusing to guess destination.")
        stored = json.loads(BACKUP.read_text())
        if stored.get("id") != current["id"] or not forward_address({"actions": stored.get("actions")}):
            raise RuntimeError("Rollback backup is invalid or does not match the current rule.")
        if current["actions"] == stored["actions"]:
            print("Privacy rule is already Gmail-only; nothing changed.")
            return
        if not worker_actions(current):
            raise RuntimeError("Privacy no longer points to expected Worker. Refusing to overwrite.")
        deploy.api("PUT", f"/zones/{deploy.RECEIPTBOSS_ZONE_ID}/email/routing/rules/{current['id']}", token,
                   {k: v for k, v in stored.items() if k != "id"})
        after = deploy.list_rules(token)
        verify_unchanged(protected, after)
        if rule_for(after, TARGET)["actions"] != stored["actions"]:
            raise RuntimeError("Cloudflare did not confirm Gmail forwarding restoration.")
        print("ROLLED BACK: Privacy restored to its original Gmail-only rule.")
        return

    if worker_actions(current):
        print("Privacy already points to Worker. Confirm Gmail and R2 delivery using a fresh test.")
        return
    if not forward_address(current):
        raise RuntimeError("Privacy is not a single verified Gmail forward rule. Refusing to change it.")

    check_worker_secret(token)
    print("Preflight: existing Privacy Gmail-only rule found; Legal and Support unchanged.")
    if not args.apply:
        print("PREVIEW ONLY. Add --apply to switch Privacy to Worker dual delivery.")
        return

    save_backup(current)
    deploy.api(
        "PUT", f"/zones/{deploy.RECEIPTBOSS_ZONE_ID}/email/routing/rules/{current['id']}",
        token, {**original_payload(current), "actions": [{"type": "worker", "value": [deploy.WORKER_NAME]}]},
    )
    after = deploy.list_rules(token)
    verify_unchanged(protected, after)
    if not worker_actions(rule_for(after, TARGET)):
        raise RuntimeError("Cloudflare did not confirm Privacy Worker rule; use --rollback if necessary.")
    print("Privacy now routes to the Worker for R2 archival + Gmail forwarding.")
    print("IMMEDIATE TEST: Send a new external message to privacy@receiptboss.ca and verify BOTH Gmail and Made North Mail.")
    print("If either copy is missing, run: python3 scripts/migrate-receiptboss-privacy.py --rollback")
    print("Do NOT move Legal until Privacy dual delivery is fully verified.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, AssertionError, OSError, ValueError) as error:
        print(f"STOP: {error}", file=sys.stderr)
        sys.exit(1)
