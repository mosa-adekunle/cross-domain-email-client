#!/usr/bin/env bash
set -Eeuo pipefail

# Public HTTPS is now provided by the shared Made North Caddy gateway using
# madenorth.dev and mail.madenorth.dev. Direct-IP HTTPS is intentionally
# retired. This legacy entry point is kept as a safe no-op so any previously
# installed systemd timer cannot interrupt the web container or contend for
# public TCP/443.
echo 'Direct-IP HTTPS renewal is retired; HTTPS is managed by the shared Caddy gateway.'
exit 0
