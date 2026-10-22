#!/usr/bin/env bash
set -Eeuo pipefail

# Direct-IP HTTPS is intentionally retired. Public 443 and certificates are
# served by the shared Made North Caddy gateway, not the mail Docker container.
echo 'Direct-IP HTTPS was retired when mail.madenorth.dev moved behind the shared Caddy gateway.' >&2
echo 'Use: bash scripts/verify-domain-https.sh' >&2
exit 2
