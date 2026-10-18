#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

printf '%s\n' '=== Container status ==='
sudo docker compose ps
printf '%s\n' '=== Applied migrations ==='
sudo docker compose exec -T api php artisan migrate:status
printf '%s\n' '=== Anonymous mailbox request must be unauthorized ==='
STATUS=$(curl -sS -o /dev/null -w '%{http_code}' -H 'Accept: application/json' http://127.0.0.1:8080/api/mailboxes)
if [[ "$STATUS" != 401 ]]; then echo "FAILED: expected 401, got $STATUS" >&2; exit 1; fi
printf 'Protected mailboxes returned HTTP %s\n' "$STATUS"
printf '%s\n' '=== Anonymous profile request must be unauthorized ==='
PROFILE=$(curl -sS -o /dev/null -w '%{http_code}' -H 'Accept: application/json' http://127.0.0.1:8080/api/auth/me)
[[ "$PROFILE" == 401 ]] || { echo "FAILED: expected 401, got $PROFILE" >&2; exit 1; }
printf '%s\n' '=== Mutation without CSRF must fail ==='
CSRF_FAILURE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -H 'Accept: application/json' --data '{"email":"nobody@example.com","password":"invalid"}' http://127.0.0.1:8080/api/auth/login)
[[ "$CSRF_FAILURE" == 419 ]] || { echo "FAILED: expected 419, got $CSRF_FAILURE" >&2; exit 1; }
printf '%s\n' '=== CSRF token endpoint ==='
curl --fail --silent --show-error http://127.0.0.1:8080/api/auth/csrf | python3 -c 'import json,sys; v=json.load(sys.stdin); assert isinstance(v.get("csrf_token"),str) and len(v["csrf_token"])>=32; print("CSRF endpoint ready")'
printf '%s\n' '=== Laravel API health ==='
curl --fail --silent --show-error http://127.0.0.1:8080/api/status
echo
