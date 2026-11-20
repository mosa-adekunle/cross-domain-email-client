#!/usr/bin/env bash
# Fast rollout of email HTML rendering. Do not rebuild/recreate API or web.
# Run from EC2 after git pull, using: sudo bash scripts/deploy-html-preview-fast.sh
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose ps -q api >/dev/null
docker compose ps -q web >/dev/null

echo "Compiling only the React frontend with the cached Node build stage..."
docker build --target frontend-build --file docker/web/Dockerfile --tag cdec-mail-frontend-assets .
web_build_container="$(docker create cdec-mail-frontend-assets)"
temp_assets="$(mktemp -d)"
cleanup() {
  docker rm -f "$web_build_container" >/dev/null 2>&1 || true
  rm -rf "$temp_assets"
}
trap cleanup EXIT

docker cp "$web_build_container:/build/dist/." "$temp_assets/"
test -s "$temp_assets/index.html"
test -d "$temp_assets/assets"

echo "Copying changed PHP files into the running API container..."
docker compose cp backend/app/Support/ArchivedHtmlPreview.php api:/var/www/html/app/Support/ArchivedHtmlPreview.php
docker compose cp backend/app/Http/Controllers/MessageDetailController.php api:/var/www/html/app/Http/Controllers/MessageDetailController.php
docker compose restart api

echo "Validating the Nginx configuration before reloading..."
docker compose exec -T web sh -c 'cp /etc/nginx/conf.d/default.conf /tmp/default.conf.mail-backup'
docker compose cp docker/web/nginx.conf web:/etc/nginx/conf.d/default.conf
if ! docker compose exec -T web nginx -t; then
  docker compose exec -T web sh -c 'cp /tmp/default.conf.mail-backup /etc/nginx/conf.d/default.conf'
  echo "Nginx configuration rejected; previous config restored." >&2
  exit 1
fi

echo "Copying the new static frontend without recreating the web container..."
docker compose cp "$temp_assets/." web:/usr/share/nginx/html/
docker compose exec -T web nginx -s reload

echo "Checking existing web and API health endpoints..."
curl --fail --silent --show-error http://127.0.0.1:8080/healthz >/dev/null
curl --fail --silent --show-error http://127.0.0.1:8080/api/status >/dev/null
echo "Email HTML viewer files deployed; no application container images recreated."
