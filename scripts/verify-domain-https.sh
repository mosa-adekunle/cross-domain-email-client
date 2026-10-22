#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."

DOMAIN='mail.madenorth.dev'
IP='52.14.33.209'
TLS='runtime/domain-https/tls/fullchain.pem'

# The ACME directory is root-only (0700). Read the public certificate
# through sudo without weakening the directory or private-key permissions.
sudo test -s "$TLS" || { echo 'Domain HTTPS certificate has not been issued.' >&2; exit 1; }
sudo openssl x509 -in "$TLS" -noout -ext subjectAltName | grep -Fq "DNS:$DOMAIN" || {
    echo 'The domain certificate does not include the mail hostname.' >&2
    exit 1
}
echo '=== Trusted hostname certificate, Nginx, Laravel and database ==='
curl --fail --silent --show-error --max-time 15 \
    --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/api/status" |
    python3 -c 'import json,sys; v=json.load(sys.stdin); assert v["status"]=="ready" and v["database"]=="connected"; print("Hostname HTTPS and PostgreSQL verified")'
echo '=== Mailbox access is private ==='
STATUS="$(curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{http_code}' \
    --resolve "$DOMAIN:443:127.0.0.1" -H 'Accept: application/json' "https://$DOMAIN/api/mailboxes")"
[[ "$STATUS" == 401 ]] || { echo "Expected 401, got $STATUS" >&2; exit 1; }
echo 'Anonymous mailbox request: 401, expected'
echo '=== Current direct IP HTTPS remains valid ==='
bash scripts/verify-ip-https.sh
echo "Verified https://$DOMAIN locally with full certificate validation."
