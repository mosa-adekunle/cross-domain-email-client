# mail.madenorth.dev: HTTPS through the shared Made North Caddy gateway

> Current architecture, October 2026. This supersedes the older standalone
> Nginx/IP-certificate procedure in the repository.

Made North's shared **Caddy gateway** owns public TCP/443, HTTPS certificates, SNI routing, and the public https://mail.madenorth.dev hostname. The Cross Domain Email Client is an **internal HTTP upstream** on 127.0.0.1:8080, served by its Nginx web container. Laravel (api) and PostgreSQL (db) stay on the private Docker network.

The mail application remains in GitHub repository mosa-adekunle/cross-domain-email-client, server directory /home/ubuntu/cross-domain-email-client. The corporate website and its Caddy gateway are maintained separately. Do not modify the website Caddy configuration from the mail repository without inspecting its source.

## Network model

    Browser → https://mail.madenorth.dev:443 → Caddy gateway
                                                      ↓ HTTP
                                        127.0.0.1:8080 → mail Nginx
                                                      ↓ FastCGI
                                                  Laravel API → PostgreSQL

Cloudflare DNS retains the mail A record pointing to the host. Do **not** modify business-domain root A/AAAA, website DNS, MX, SPF, DKIM, DMARC, Email Routing rules or R2 to deploy app changes.

## Verification

On the application EC2 host:

    cd ~/cross-domain-email-client
    git pull --ff-only origin main
    bash scripts/verify-domain-https.sh
    sudo docker compose ps

The script verifies:
1. The **trusted** certificate and SNI hostname through Caddy at 127.0.0.1:443 (no bypass of certificate checks).
2. GET /api/status responds ready with PostgreSQL connected.
3. Anonymous /api/mailboxes returns HTTP **401**.
4. The mail container is bound to **loopback-only** 127.0.0.1:8080 and serves /healthz.

It does **not** test https://52.14.33.209: direct-IP HTTPS was intentionally retired. The legacy verify-ip-https.sh exits with a clear deprecation message. Previous Docker/lego TLS renewal scripts are safe no-ops; **Caddy handles public certificate renewal**. Do not issue a second certificate by stopping the mail web container.

## Mailbox rollout

New cross-brand mailbox records can be provisioned independently of HTTPS and DNS, using php artisan mail:provision-brand-mailboxes --apply. This saves them **inactive and pending**; it does not deliver email until the Cloudflare Worker and per-recipient routing rules are configured and tested.

See [Multi-brand mailbox onboarding](multi-brand-mail-onboarding.md). Existing forwarding for business-critical inboxes must be inspected and preserved.
