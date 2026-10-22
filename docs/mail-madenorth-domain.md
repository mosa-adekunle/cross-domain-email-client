# mail.madenorth.dev: secure direct HTTPS on existing EC2

Use the existing single Ubuntu 24.04 ARM64 EC2 instance and Elastic IP `52.14.33.209`. The application's code remains in `mosa-adekunle/cross-domain-email-client`, and the web browser title remains **Mail - Made North Technologies**. This is **not a Cloudflare Tunnel**. The existing direct-IP browser URL also remains functional.

## 1. DNS record (at madenorth.dev's authoritative DNS provider)

| Type | Host/name | IPv4 / content | TTL | Proxy |
| --- | --- | --- | --- | --- |
| A | mail | 52.14.33.209 | Auto | **DNS only** (if Cloudflare) |

Do not change the apex `madenorth.dev`, its `www` address, or any MX / TXT mail records. Do not add an AAAA record pointing somewhere else. Check existing `mail` records for conflicts. In Cloudflare, a **gray-cloud DNS-only** record is necessary because direct Let's Encrypt TLS-ALPN-01 on port 443 must reach this EC2 host for both issuance and renewal. Cloudflare's HTTP reverse proxy would otherwise intercept the ALPN handshake. If the domain's DNS is managed elsewhere, create the same direct A record there. Wait until DNS resolves *only* to `52.14.33.209`.

## 2. On the application EC2 host

Run the following in a normal shell after step 1. The mail service and PostgreSQL will remain on the same server. **Certificate issuance/renewal briefly stops the web container**, but does not stop the API or PostgreSQL.

```bash
set -e
cd ~/cross-domain-email-client
git pull --ff-only origin main
git rev-parse --short HEAD
sudo docker compose config --quiet
# Reuses the email previously saved for the IP certificate; only on first-time
# machines without one, run with ACME_EMAIL=your-real-contact@example.com.
sudo bash scripts/renew-domain-https.sh
sudo docker compose build api web
sudo docker compose up -d --no-deps --force-recreate api web
sudo install -m 0644 systemd/cdec-domain-https-renew.service /etc/systemd/system/
sudo install -m 0644 systemd/cdec-domain-https-renew.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cdec-domain-https-renew.timer
bash scripts/verify-domain-https.sh
sudo docker compose ps
```

If `runtime/ip-https/contact-email` does not exist, use `sudo ACME_EMAIL=your-reachable-address@example.com bash scripts/renew-domain-https.sh` for first issuance. Avoid placing passwords or tokens in the repo or shell history.

The newly issued public certificate is mounted read-only at `/etc/nginx/domain-tls`. The existing IP certificate remains under `/etc/nginx/tls`; Nginx selects by SNI. The `APP_URL` setting points to the hostname, but host-only Secure session cookies continue to work independently for IP and hostname; sign in again at the new URL.

No public port 80, alternate port, proxy service, tunnel, database migration, or additional EC2 server is required. TCP/443 is already allowed. New domain certificate renewal checks run twice daily. Unlike the short-lived IP certificate, the domain certificate follows Let's Encrypt's normal expiration policy; the script renews when within 30 days of expiry.

## 3. Verify

- Visit `https://mail.madenorth.dev` from a separate device; the URL must be trusted and show the Mail app.
- `bash scripts/verify-domain-https.sh` verifies both the new certificate and the original IP endpoint without `curl -k`.
- `systemctl list-timers 'cdec-*-https-renew.timer'` shows certificate checks.
- `sudo journalctl -u cdec-domain-https-renew.service -n 40 --no-pager` provides renewal status.
- `openssl x509 -in runtime/domain-https/tls/fullchain.pem -noout -dates -ext subjectAltName` shows the new certificate details (public cert only).

If DNS has not propagated, `renew-domain-https.sh` stops *before* touching the live web container and explains the mismatch. Do not rebuild/recreate `web` until domain certificate issuance succeeds or the new SNI configuration will not start. Existing IP certificate renewal uses the same lock and remains scheduled separately.

Both the app's session cookie and CSRF token are same-origin. Do not set `SESSION_DOMAIN=.madenorth.dev` merely for this migration; host-only cookies avoid sharing authentication with unrelated subdomains.
