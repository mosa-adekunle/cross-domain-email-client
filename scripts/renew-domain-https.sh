#!/usr/bin/env bash
set -Eeuo pipefail

# HTTPS for mail.madenorth.dev is managed by the shared Made North Caddy
# gateway. This legacy renewal entry point intentionally does nothing so an
# installed systemd timer cannot stop the Email Client web container or try to
# bind public TCP/443 after the gateway cutover.
echo 'mail.madenorth.dev HTTPS is managed by the shared Caddy gateway; no legacy renewal is required.'
exit 0
