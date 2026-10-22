#!/usr/bin/env bash
set -Eeuo pipefail

# Public-IP certs are short-lived (~160 hours). TLS-ALPN-01 works over
# HTTPS/443 without opening HTTP/80 or adding a domain name.
# Renewal briefly stops only the web container so ACME can own TCP/443.
cd "$(dirname "$0")/.."
[[ "$EUID" -eq 0 ]] || { echo 'Run with sudo: sudo bash scripts/renew-ip-https.sh' >&2; exit 1; }

IP='52.14.33.209'
BASE="$PWD/runtime/ip-https"
ACME="$BASE/acme"
TLS="$BASE/tls"
EMAIL_FILE="$BASE/contact-email"
LOCK="$PWD/runtime/https-renew.lock"
IMAGE='goacme/lego:v5.0.1'

umask 077
mkdir -p "$ACME" "$TLS"
chmod 700 "$BASE" "$ACME" "$TLS"
if [[ -n "$(printenv ACME_EMAIL 2>/dev/null || true)" ]]; then
    printf '%s\n' "$ACME_EMAIL" > "$EMAIL_FILE"
    chmod 600 "$EMAIL_FILE"
fi
if [[ ! -s "$EMAIL_FILE" ]]; then
    echo 'First run: sudo ACME_EMAIL=you@example.com bash scripts/renew-ip-https.sh' >&2
    exit 1
fi

exec 9> "$LOCK"
flock -n 9 || { echo 'Certificate renewal already running.'; exit 0; }

# No web interruption while more than 72 hours remain.
if [[ -s "$TLS/fullchain.pem" && -s "$TLS/privkey.pem" ]] &&
    openssl x509 -in "$TLS/fullchain.pem" -checkend 259200 -noout >/dev/null 2>&1; then
    echo 'IP HTTPS certificate valid for more than three days; renewal not needed.'
    exit 0
fi

# Stop the existing web container, not the API or PostgreSQL. Always restart
# that exact same container, including on ACME failure.
WEB_ID="$(docker compose ps -q web)"
STOPPED=0
restore_web() {
    if [[ "$STOPPED" -eq 1 ]]; then
        docker start "$WEB_ID" >/dev/null || echo 'WARNING: Could not restart the web container.' >&2
    fi
}
trap restore_web EXIT
if [[ -n "$WEB_ID" && "$(docker inspect -f '{{.State.Running}}' "$WEB_ID")" == 'true' ]]; then
    docker stop --time 15 "$WEB_ID" >/dev/null
    STOPPED=1
fi

docker run --rm --network host \
    -v "$ACME:/data" \
    "$IMAGE" run \
    --server letsencrypt \
    --accept-tos \
    --email "$(cat "$EMAIL_FILE")" \
    --domains "$IP" \
    --tls \
    --profile shortlived \
    --path /data

SOURCE_CERT="$ACME/certificates/$IP.crt"
SOURCE_KEY="$ACME/certificates/$IP.key"
[[ -s "$SOURCE_CERT" && -s "$SOURCE_KEY" ]] || { echo 'ACME did not produce a certificate and key.' >&2; exit 1; }
openssl x509 -in "$SOURCE_CERT" -checkend 259200 -noout >/dev/null || {
    echo 'Issued certificate expires too soon.' >&2
    exit 1
}
openssl x509 -in "$SOURCE_CERT" -noout -ext subjectAltName | grep -Fq "IP Address:$IP" || {
    echo "Certificate is missing IP subject alternative name: $IP" >&2
    exit 1
}

install -m 0644 "$SOURCE_CERT" "$TLS/fullchain.pem.new"
install -m 0600 "$SOURCE_KEY" "$TLS/privkey.pem.new"
mv -f "$TLS/fullchain.pem.new" "$TLS/fullchain.pem"
mv -f "$TLS/privkey.pem.new" "$TLS/privkey.pem"
echo "Trusted IP HTTPS certificate installed for $IP"
openssl x509 -in "$TLS/fullchain.pem" -noout -dates
