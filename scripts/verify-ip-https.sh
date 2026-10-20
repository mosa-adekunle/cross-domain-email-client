#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
IP=52.14.33.209
TARGET="https://$IP"
LOCAL=127.0.0.1
echo '=== Docker services ==='
sudo docker compose ps
echo '=== Public-IP certificate and API, checked against local TLS listener ==='
curl --fail --show-error --silent --connect-to "$IP:443:$LOCAL:443" "$TARGET/api/status" |
    python3 -c 'import json,sys; r=json.load(sys.stdin); assert r["status"] == "ready" and r["database"] == "connected"; print("HTTPS and PostgreSQL verified")'
echo '=== Anonymous mailbox data must remain protected ==='
CODE="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --connect-to "$IP:443:$LOCAL:443" -H 'Accept: application/json' "$TARGET/api/mailboxes")"
[[ "$CODE" == 401 ]] || { echo "FAIL: Anonymous mailbox request returned HTTP $CODE" >&2; exit 1; }
echo 'HTTP 401, as expected'
echo '=== Only 443 is publicly published ==='
sudo docker compose port web 443
[[ "$(sudo docker compose port web 443)" == "0.0.0.0:443" ]] || exit 1
[[ "$(sudo docker compose port web 80)" == "127.0.0.1:8080" ]] || exit 1
echo 'Direct EC2 IP HTTPS verification complete.'
