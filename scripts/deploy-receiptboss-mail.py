#!/usr/bin/env python3
"""Deploy the existing email Worker and activate ONLY new ReceiptBoss sales/hello routes.

Rerunnable, guarded, and does not edit support/legal/privacy or any other rule.
Requires a Cloudflare API token with Worker edit and Email Routing Rules write access.
"""
import argparse
import getpass
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
WORKER_DIR = ROOT / "workers" / "email-archive"
ACCOUNT_ID = "48dfb24066b584a497e26f6fdb1c222d"
RECEIPTBOSS_ZONE_ID = "64f7293ef26ef3ba4521368571aec92e"
WORKER_NAME = "cdec-inbound-archive"
ADDRESSES = ("sales@receiptboss.ca", "hello@receiptboss.ca")
PILOT = "inbox-test@receiptboss.ca"
TOKEN_FILE = Path.home() / ".config" / "cdec" / "cloudflare-worker-token"


def validate_source():
    data = json.loads((WORKER_DIR / "wrangler.jsonc").read_text())
    allow = data.get("vars", {}).get("ALLOWED_RECIPIENTS", "").split(",")
    assert data["name"] == WORKER_NAME, "Wrong Worker name"
    assert all(address in allow for address in (PILOT, *ADDRESSES)), "Missing approved recipient"
    assert data.get("vars", {}).get("LEGACY_FORWARD_RECIPIENTS") == "legal@receiptboss.ca,privacy@receiptboss.ca", "Legacy forwarding not configured"
    assert "LEGACY_FORWARD_DESTINATION" not in data["vars"], "Gmail destination must remain a Cloudflare secret"
    assert {"binding": "MAIL_ARCHIVE", "bucket_name": "cdec-inbound-mail"} in data.get("r2_buckets", []), "Unexpected R2 bucket binding"


def credential():
    value = os.environ.get("CLOUDFLARE_API_TOKEN", "").strip()
    if value:
        return value
    # Reuse existing project env without ever printing or exporting the file.
    envfile = ROOT / ".env"
    if envfile.is_file():
        for line in envfile.read_text().splitlines():
            if line.strip().startswith("CLOUDFLARE_API_TOKEN="):
                value = line.split("=", 1)[1].strip().strip('"').strip("'")
                if value:
                    return value
    if TOKEN_FILE.is_file():
        value = TOKEN_FILE.read_text().strip()
        if value:
            return value
    # One-time setup only. Never store token in Git or a shell-history command.
    if not sys.stdin.isatty():
        raise RuntimeError("No Cloudflare deployment token configured. Run interactively once.")
    print("A Cloudflare Worker/Email Routing API token is required once.")
    value = getpass.getpass("Cloudflare API token (input hidden): ").strip()
    if not value:
        raise RuntimeError("No token provided; nothing deployed or routed.")
    TOKEN_FILE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(TOKEN_FILE.parent, 0o700)
    descriptor = os.open(TOKEN_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as target:
        target.write(value + "\n")
    os.chmod(TOKEN_FILE, 0o600)
    print("Token stored at ~/.config/cdec/cloudflare-worker-token (permissions 0600).")
    return value


def api(method, url_path, token, payload=None):
    url = "https://api.cloudflare.com/client/v4" + url_path
    headers = {"Authorization": "Bearer " + token, "Accept": "application/json"}
    body = None
    if payload is not None:
        body = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"
    try:
        with urlopen(Request(url, data=body, headers=headers, method=method), timeout=20) as response:
            data = json.load(response)
    except HTTPError as exc:
        # Path and Cloudflare numeric error codes are safe diagnostics. Never
        # print HTTP headers, token values or untrusted API error descriptions.
        try:
            failure = json.loads(exc.read(16384))
            codes = ", ".join(str(item.get("code")) for item in failure.get("errors", [])
                              if isinstance(item, dict) and isinstance(item.get("code"), int))
        except (ValueError, OSError, AttributeError, TypeError):
            codes = ""
        target = url_path.split("?", 1)[0]
        hint = (
            "Zone → Zone Read permission for the selected domains."
            if target == "/zones" else
            "Zone → Zone Settings Read permission for this domain."
            if target.endswith("/email/routing") else
            "Zone → Email Routing Rules Read/Edit permission for this domain."
            if "/email/routing/rules" in target else
            "Account Workers permission or zone-scoped permissions."
        )
        raise RuntimeError(
            f"Cloudflare API {method} {target} failed (HTTP {exc.code}" +
            (f", Cloudflare code {codes}" if codes else "") +
            f"). Check {hint} No routing changed by this failed API call."
        ) from None
    except (URLError, TimeoutError):
        raise RuntimeError("Cloudflare API connection failed; no existing routing rules were modified.") from None
    if not isinstance(data, dict) or not data.get("success", False):
        errs = data.get("errors", []) if isinstance(data, dict) else []
        codes = ", ".join(str(x.get("code")) for x in errs if isinstance(x, dict))
        raise RuntimeError(f"Cloudflare rejected {method} {url_path} (error codes: {codes or 'unknown'}).")
    return data


def list_rules(token):
    rules = []
    for page in range(1, 101):
        params = urlencode({"page": page, "per_page": 50})
        result = api("GET", f"/zones/{RECEIPTBOSS_ZONE_ID}/email/routing/rules?{params}", token)
        batch = result.get("result")
        if not isinstance(batch, list):
            raise RuntimeError("Cloudflare returned unexpected Email Routing rule data.")
        rules.extend(batch)
        info = result.get("result_info") or {}
        if page >= int(info.get("total_pages") or 1):
            # If the API omits pagination metadata, a full page may have a next page.
            if info.get("total_pages") or len(batch) < 50:
                return rules
        if len(batch) == 0:
            return rules
    raise RuntimeError("Cloudflare rule inventory exceeded safety pagination limit.")


def recipients(rule):
    return [
        str(m.get("value", "")).lower()
        for m in (rule.get("matchers") or [])
        if m.get("type") == "literal" and m.get("field") == "to"
    ]


def is_target_worker(rule):
    return bool(rule.get("enabled")) and rule.get("actions") == [{"type": "worker", "value": [WORKER_NAME]}]


def plan(rules):
    # The known pilot rule anchors us to the correct ReceiptBoss Cloudflare zone
    # even for tokens with no additional Zone Read privilege.
    if not any(PILOT in recipients(rule) and is_target_worker(rule) for rule in rules):
        raise RuntimeError("Existing active ReceiptBoss pilot rule not found. Refusing to modify this zone.")
    result = {}
    for address in ADDRESSES:
        matches = [rule for rule in rules if address in recipients(rule)]
        if not matches:
            result[address] = "create"
        elif len(matches) == 1 and is_target_worker(matches[0]):
            result[address] = "already active"
        else:
            raise RuntimeError(f"Existing conflicting or inactive rule for {address}. No change made.")
    return result


def deploy_worker(token):
    env = os.environ.copy()
    env["CLOUDFLARE_API_TOKEN"] = token
    env["CLOUDFLARE_ACCOUNT_ID"] = ACCOUNT_ID
    arguments = [
        "sudo", "--preserve-env=CLOUDFLARE_API_TOKEN,CLOUDFLARE_ACCOUNT_ID",
        "docker", "run", "--rm",
        "--user", f"{os.getuid()}:{os.getgid()}",
        "-e", "CLOUDFLARE_API_TOKEN", "-e", "CLOUDFLARE_ACCOUNT_ID",
        "-e", "HOME=/tmp", "-e", "npm_config_cache=/tmp/npm-cache",
        "-v", f"{WORKER_DIR}:/app", "-w", "/app",
        "node:22-bookworm-slim", "sh", "-ec",
        "npm install --no-package-lock --no-audit --no-fund && "
        "npm test && "
        "npx --no-install wrangler deploy --dry-run && "
        "npx --no-install wrangler deploy",
    ]
    subprocess.run(arguments, env=env, check=True)


def new_rule(address):
    return {
        "name": f"Deliver {address} to Made North Mail",
        "enabled": True,
        "matchers": [{"type": "literal", "field": "to", "value": address}],
        "actions": [{"type": "worker", "value": [WORKER_NAME]}],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Deploy Worker and add only sales/hello rules")
    args = parser.parse_args()
    validate_source()
    token = credential()
    before = list_rules(token)
    intended = plan(before)
    for address, action in intended.items():
        print(f"{address}: {action}")
    if not args.apply:
        print("Preview only. No Worker deployment or Cloudflare rule changes.")
        return
    print("Deploying Worker with tests before enabling any new delivery rule.")
    deploy_worker(token)
    # Recheck immediately before writes to avoid overwriting a new/conflicting rule.
    for address in ADDRESSES:
        state = plan(list_rules(token))[address]
        if state == "already active":
            print(f"Unchanged: {address} is already routed to {WORKER_NAME}.")
            continue
        if state != "create":
            raise RuntimeError(f"Unexpected state for {address}: {state}")
        api("POST", f"/zones/{RECEIPTBOSS_ZONE_ID}/email/routing/rules", token, new_rule(address))
        print(f"Created route: {address} -> {WORKER_NAME}")
    final = plan(list_rules(token))
    if any(value != "already active" for value in final.values()):
        raise RuntimeError("New routing rules could not be verified after creation.")
    print("Success: sales and hello routes enabled; support/legal/privacy and MX untouched.")
    print("Next: send external test emails to both addresses, confirm raw R2 and inbox import.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, AssertionError, subprocess.CalledProcessError) as error:
        print(f"STOP: {error}", file=sys.stderr)
        sys.exit(1)
