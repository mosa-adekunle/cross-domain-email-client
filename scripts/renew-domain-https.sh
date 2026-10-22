#!/usr/bin/env bash
set -Eeuo pipefail

# Obtain and renew public HTTPS for mail.madenorth.dev on the existing EC2.
# TLS-ALPN-01 needs port 443 only; use a DNS-only A record (not an HTTP proxy).
cd "$(dirname "$0")/.."
[[ "$EUID" -eq 0 ]] || { echo 'Run with sudo: sudo bash scripts/renew-domain-https.sh' >&2; exit 1; }

DOMAIN='mail.madenorth.dev'
IP='52.14.33.209'
BASE="$PWD/runtime/domain-https"
ACME="$BASE/acme"
TLS="$BASE/tls"
EMAIL_FILE="$BASE/contact-email"
IMAGE='goacme/lego:v5.0.1'

umask 077
mkdir -p "$ACME" "$TLS"
chmod 700 "$BASE" "$ACME" "$TLS"
if [[ -n "$(printenv ACME_EMAIL 2>/dev/null || true)" ]]; then
    printf '%s\n' "$ACME_EMAIL" > "$EMAIL_FILE"
    chmod 600 "$EMAIL_FILE"
elif [[ ! -s "$EMAIL_FILE" && -s "$PWD/runtime/ip-https/contact-email" ]]; then
    cp "$PWD/runtime/ip-https/contact-email" "$EMAIL_FILE"
    chmod 600 "$EMAIL_FILE"
fi
[[ -s "$EMAIL_FILE" ]] || {
    echo 'Supply ACME_EMAIL with a reachable email address (sudo ACME_EMAIL=you@example.com bash scripts/renew-domain-https.sh).' >&2
    exit 1
}

# Wait for existing IP renewal rather than interrupting the same TLS listener.
exec 9> "$PWD/runtime/https-renew.lock"
flock -w 300 9 || { echo 'Another certificate renewal is still in progress.' >&2; exit 1; }

# Normal checks do not interrupt the web container until 30 days remain.
if [[ -s "$TLS/fullchain.pem" && -s "$TLS/privkey.pem" ]] &&
    openssl x509 -in "$TLS/fullchain.pem" -checkend 2592000 -noout >/dev/null 2>&1; then
    echo "$DOMAIN certificate valid for more than 30 days; renewal not needed."
    exit 0
fi

# Fail before stopping the website if DNS is missing or Cloudflare is proxied.
RESOLVED="$(getent ahostsv4 "$DOMAIN" | awk '$2=="STREAM" {print $1}' | sort -u || true)"
if [[ "$RESOLVED" != "$IP" ]]; then
    [[ -n "$RESOLVED" ]] || RESOLVED='none'
    echo "DNS for $DOMAIN must resolve directly and ONLY to $IP before TLS-ALPN issuance." >&2
    echo "Current IPv4 result(s): $RESOLVED. Set Cloudflare to DNS only if applicable." >&2
    exit 1
fi

WEB_ID="$(docker compose ps -q web)"
STOPPED=0
restore_web() {
    if [[ "$STOPPED" -eq 1 ]]; then
        docker start "$WEB_ID" >/dev/null || echo 'WARNING: Could not restart web container.' >&2
    fi
}
trap restore_web EXIT

if [[ -n "$WEB_ID" && "$(docker inspect -f '{{.State.Running}}' "$WEB_ID")" == 'true' ]]; then
    docker stop --time 15 "$WEB_ID" >/dev/null
    STOPPED=1
fi

# lego v5 removed the 'renew' command and moved CLI flags after 'run'.
# The same 'run' command issues a new certificate or renews the existing one.
docker run --rm --network host \
    -v "$ACME:/data" \
    "$IMAGE" run \
    --server letsencrypt --accept-tos \
    --email "$(cat "$EMAIL_FILE")" \
    --domains "$DOMAIN" --tls --path /data

SOURCE_CERT="$ACME/certificates/$DOMAIN.crt"
SOURCE_KEY="$ACME/certificates/$DOMAIN.key"
[[ -s "$SOURCE_CERT" && -s "$SOURCE_KEY" ]] || { echo 'No domain certificate or key was issued.' >&2; exit 1; }
openssl x509 -in "$SOURCE_CERT" -checkend 2592000 -noout >/dev/null || {
    echo 'Issued domain certificate expires in less than 30 days.' >&2
    exit 1
}
openssl x509 -in "$SOURCE_CERT" -noout -ext subjectAltName | grep -Fq "DNS:$DOMAIN" || {
    echo 'Issued certificate does not cover requested hostname.' >&2
    exit 1
}
install -m 0644 "$SOURCE_CERT" "$TLS/fullchain.pem.new"
install -m 0600 "$SOURCE_KEY" "$TLS/privkey.pem.new"
mv -f "$TLS/fullchain.pem.new" "$TLS/fullchain.pem"
mv -f "$TLS/privkey.pem.new" "$TLS/privkey.pem"
echo "Trusted HTTPS certificate installed for $DOMAIN"
openssl x509 -in "$TLS/fullchain.pem" -noout -dates
