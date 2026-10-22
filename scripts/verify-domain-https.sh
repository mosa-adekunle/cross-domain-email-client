#!/usr/bin/env bash
set -Eeuo pipefail

# The shared Made North Caddy gateway owns public TCP/443, SNI and trusted
# certificate renewal. Email Client Nginx is an internal HTTP upstream only.
# Do not test legacy IP HTTPS: the IP TLS identity has been retired.
cd "$(dirname "$0")/.."
DOMAIN='mail.madenorth.dev'
ORIGIN='127.0.0.1'

echo '=== Shared Caddy gateway: trusted mail hostname HTTPS and API ==='
# --resolve stays on this EC2 instance, while sending proper hostname/SNI.
# No -k: verify the real certificate trust chain and hostname.
RESPONSE="$(curl --fail --silent --show-error --max-time 15 \
    --resolve "$DOMAIN:443:$ORIGIN" \
    "https://$DOMAIN/api/status")"
python3 -c 'import json,sys; v=json.load(sys.stdin); assert v["status"]=="ready" and v["database"]=="connected"; print("Hostname HTTPS and PostgreSQL verified")' <<< "$RESPONSE"

echo '=== Mailbox access is private ==='
STATUS="$(curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{http_code}' \
    --resolve "$DOMAIN:443:$ORIGIN" -H 'Accept: application/json' \
    "https://$DOMAIN/api/mailboxes")"
[[ "$STATUS" == 401 ]] || { echo "Expected 401, got $STATUS" >&2; exit 1; }
echo 'Anonymous mailbox request: 401, expected'

echo '=== Email Nginx is reachable only through loopback ==='
UPSTREAM="$(sudo docker compose port web 80)"
[[ "$UPSTREAM" == '127.0.0.1:8080' ]] || {
    echo "Expected loopback-only 127.0.0.1:8080, got $UPSTREAM" >&2
    exit 1
}
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:8080/healthz >/dev/null
echo 'Private email upstream: healthy, bound to 127.0.0.1:8080'
echo "Verification passed for https://$DOMAIN via shared Caddy."
