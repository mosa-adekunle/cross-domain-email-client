#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo '=== Container state ==='
sudo docker compose ps
echo
echo '=== Laravel/PostgreSQL status ==='
curl --fail --silent --show-error http://127.0.0.1:8080/api/status
echo
echo '=== Web health ==='
curl --fail --silent --show-error http://127.0.0.1:8080/healthz
echo
echo '=== Confirm no public binding ==='
BIND=$(sudo docker compose port web 80)
[[ "$BIND" == "127.0.0.1:8080" ]] || { echo "Unexpected gateway binding: $BIND" >&2; exit 1; }
echo "Web gateway only listens on $BIND"
