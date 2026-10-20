#!/usr/bin/env bash
set -euo pipefail

# Run after rebuilding the 'web' service on the Cross Domain Email EC2 host.
# Verifies the actual Vite-emitted PDF.js worker path and Nginx MIME response.
cd "$(dirname "$0")/.."

asset_path="$(sudo docker compose exec -T web sh -c 'find /usr/share/nginx/html/assets -type f -name "pdf.worker*.mjs" -print -quit' | tr -d '\r')"
if [[ -z "$asset_path" ]]; then
  echo "FAIL: PDF.js worker .mjs file not found in web container." >&2
  exit 1
fi

asset_name="${asset_path##*/}"
case "$asset_name" in
  pdf.worker*.mjs) ;;
  *) echo "FAIL: Unexpected worker asset filename." >&2; exit 1 ;;
esac

echo "PDF.js worker asset: /assets/$asset_name"
headers="$(curl --fail --silent --show-error --head --max-time 15 \
  --resolve '52.14.33.209:443:127.0.0.1' \
  "https://52.14.33.209/assets/$asset_name" | tr -d '\r')"

printf '%s\n' "$headers" | grep -Ei '^(HTTP/|content-type:|content-security-policy:)'
if ! printf '%s\n' "$headers" | grep -Eiq '^content-type: *(application|text)/javascript([;[:space:]]|$)'; then
  echo "FAIL: Nginx did not serve the PDF.js module worker with a JavaScript MIME type." >&2
  exit 1
fi

echo "PASS: PDF.js module worker served successfully with a JavaScript MIME type."
