#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

printf '%s\n' '=== Service health ==='
sudo docker compose ps
curl --fail --silent --show-error http://127.0.0.1:8080/api/status | python3 -c 'import json,sys; result=json.load(sys.stdin); assert result["status"] == "ready" and result["database"] == "connected"; print("Laravel and PostgreSQL ready")'
printf '\n%s\n' '=== R2 integration dependencies ==='
sudo docker compose exec -T api php -r 'foreach (["Aws\\S3\\S3Client", "ZBateson\\MailMimeParser\\Message"] as $class) { if (!class_exists($class)) { fwrite(STDERR, "Missing dependency: $class\n"); exit(1); } echo "$class available\n"; }'
sudo docker compose exec -T api php artisan list --raw | grep -q 'mail:sync-r2'
echo 'R2 import command registered'

printf '\n%s\n' '=== R2 access (only when configured) ==='
if [[ -f .env ]] && grep -Eq '^R2_ACCOUNT_ID=.+' .env && grep -Eq '^R2_ACCESS_KEY_ID=.+' .env && grep -Eq '^R2_SECRET_ACCESS_KEY=.+' .env && grep -Eq '^R2_BUCKET=.+' .env; then
  sudo docker compose exec -T api php artisan mail:sync-r2 --dry-run --limit=1
else
  echo 'R2 access not yet configured; no connection attempted.'
fi

printf '\n%s\n' '=== Local-only web binding ==='
BIND=$(sudo docker compose port web 80)
[[ "$BIND" == '127.0.0.1:8080' ]] || { echo "Unexpected public binding: $BIND" >&2; exit 1; }
echo "Web bound to $BIND only"
