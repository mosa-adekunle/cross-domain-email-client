#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

BASE_URL="http://127.0.0.1:8080"
printf '%s\n' '=== Containers and migrations ==='
sudo docker compose ps
sudo docker compose exec -T api php artisan migrate:status

printf '%s\n' '=== Authenticated-only mailbox APIs ==='
for path in /api/domains /api/mailboxes /api/messages?folder=inbox; do
    STATUS=$(curl -sS -o /dev/null -w '%{http_code}' -H 'Accept: application/json' "$BASE_URL$path")
    if [[ "$STATUS" != '401' ]]; then
        echo "FAILED: $path returned $STATUS to an anonymous request (expected 401)" >&2
        exit 1
    fi
    echo "PASS: $path denied anonymous access (HTTP 401)"
done

printf '%s\n' '=== Mutations must require a CSRF token ==='
for path in /api/domains /api/mailboxes; do
    STATUS=$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'Accept: application/json' -H 'Content-Type: application/json' --data '{}' "$BASE_URL$path")
    if [[ "$STATUS" != '419' ]]; then
        echo "FAILED: $path returned $STATUS without CSRF (expected 419)" >&2
        exit 1
    fi
    echo "PASS: $path rejected missing CSRF (HTTP 419)"
done

printf '%s\n' '=== Health and localhost-only publishing ==='
curl --fail --silent --show-error "$BASE_URL/api/status" | python3 -c 'import json,sys; r=json.load(sys.stdin); assert r["status"]=="ready" and r["database"]=="connected"; print("API and PostgreSQL ready")'
BIND=$(sudo docker compose port web 80)
[[ "$BIND" == '127.0.0.1:8080' ]] || { echo "FAILED: unexpected web binding $BIND" >&2; exit 1; }
echo 'PASS: web port is bound to loopback only'
