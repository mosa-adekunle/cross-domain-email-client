#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  echo "Existing .env preserved; no secrets were changed."
  exit 0
fi

command -v openssl >/dev/null || { echo 'OpenSSL is required' >&2; exit 1; }
umask 077
cp .env.example .env
DB_PASSWORD=$(openssl rand -hex 24)
APP_SECRET=$(openssl rand -base64 32 | tr -d '\n')
python3 - "$DB_PASSWORD" "$APP_SECRET" <<'PY'
from pathlib import Path
import sys
path = Path('.env')
text = path.read_text()
text = text.replace('POSTGRES_PASSWORD=\n', f'POSTGRES_PASSWORD={sys.argv[1]}\n')
text = text.replace('APP_KEY=\n', f'APP_KEY=base64:{sys.argv[2]}\n')
path.write_text(text)
PY
chmod 600 .env
echo 'Generated .env with random secrets. Do not upload or commit it.'
