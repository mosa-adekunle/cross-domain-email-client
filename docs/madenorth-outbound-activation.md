# Made North outbound sending: manual verification and activation

Status checked against Resend on October 23, 2026: `madenorth.dev` was `not_started` (not verified). `receiptboss.ca` and `santasbag.ca` were `verified`. Do not enable Made North mailboxes merely by adding a domain to the SMTP allowlist; complete provider verification first.

## 1. Add the exact Resend DNS records to Cloudflare

Resend account: **Domains → madenorth.dev → DNS Records**.
Cloudflare account: **madenorth.dev → DNS → Records → Add record**.
Confirm the current values in Resend before adding. These were returned by Resend on October 23, 2026:

| Type | Cloudflare Name | Value/Target | Priority | Proxy/TTL |
| --- | --- | --- | --- | --- |
| TXT (DKIM) | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDHJ7cJJrPtnF/CRfLKgee/qhCSpqjN1Vz9suiGYnJnNKqsONaBrUYSXiRFE87otNclhmMPJz2UajldZUDjCn66dY1PmFyLvvNnboiIPqRxLpWWhKEn8q0ypfdmL3rUMF3VKbo4fT/xzMPeXnafNYKR3ItZU/pCVgwdUvcme0NGEQIDAQAB` | n/a | Auto |
| MX (SPF subdomain) | `send` | `feedback-smtp.us-east-1.amazonses.com` | 10 | Auto |
| TXT (SPF subdomain) | `send` | `v=spf1 include:amazonses.com ~all` | n/a | Auto |
| CNAME (return path) | `rsend` | `send.forge.rmta.net` | n/a | DNS only / Auto |

Each short Cloudflare Name above is relative to the `madenorth.dev` DNS zone: do not append `.madenorth.dev` twice if Cloudflare automatically adds it. Keep CNAME **DNS only**, not orange-cloud proxied.

**Do not change** the root `@` MX or SPF TXT, any Cloudflare Email Routing record, Cloudflare Worker, Gmail forwarding, or HTTPS / website DNS records. Do not create a second root SPF TXT. First inspect preexisting records at these *specific* names: if there is a conflict, resolve it rather than overwriting blindly.

Check publicly visible DNS from macOS Terminal:

```bash
dig +short TXT resend._domainkey.madenorth.dev
dig +short MX send.madenorth.dev
dig +short TXT send.madenorth.dev
dig +short CNAME rsend.madenorth.dev
```

Then in Resend open the same domain and select **Verify DNS records / Verify domain** (wording may vary). **Stop until Resend shows `Verified` for madenorth.dev**. If verification is still pending, recheck the exact values and allow time for DNS propagation; do not bypass the server-side confirmation flag.

## 2. Deploy the backend-only code

Run in a Mac terminal (using the SSH host alias configured for the email server):

```bash
ssh cross-domain-email
```

Then on the email EC2 host:

```bash
cd ~/cross-domain-email-client
pwd
git status --short
git pull --ff-only origin main
git log -1 --oneline
sudo docker compose config --quiet
sudo docker compose build api
sudo docker compose up -d --no-deps --force-recreate api
sudo docker compose exec -T api php artisan config:clear
sudo docker compose exec -T api php -l app/Console/Commands/AuthorizeOutboundMailboxes.php
sudo docker compose exec -T api php tests/outbound-sender-authorization-smoke.php
sudo docker compose exec -T api php tests/outbound-smoke.php
sudo docker compose ps api
```

These commands do not rebuild the web frontend or database, send messages, or change DNS.

## 3. Add Made North to the private allowlist ONLY after Resend verification

First preserve the existing `MAIL_HOST`, `MAIL_PORT`, `MAIL_SCHEME`, `MAIL_USERNAME`, `MAIL_PASSWORD`, and `OUTBOUND_PROVIDER_LABEL` values. Never paste passwords or full `.env` in chat.

```bash
cd ~/cross-domain-email-client
chmod 600 .env
nano .env
```

Find exactly one `OUTBOUND_ALLOWED_DOMAINS=` line and change its entire value to:

```dotenv
OUTBOUND_ALLOWED_DOMAINS=receiptboss.ca,santasbag.ca,madenorth.dev
```

Save Nano: `Ctrl+O`, `Enter`, `Ctrl+X`. Recreate only the API so Docker Compose passes the new environment into it (no image rebuild required when only `.env` changes):

```bash
sudo docker compose config --quiet
sudo docker compose up -d --no-deps --force-recreate api
sudo docker compose exec -T api php artisan config:clear
sudo docker compose exec -T api php artisan about --only=environment
sudo docker compose ps api
```

## 4. Approve the exact Made North mailboxes

The `backend/config/brand_mailboxes.php` manifest contains `mosa@`, `hello@`, and `sales@madenorth.dev`. These rows may still be marked `onboarding_pending` for receiving, which must not be changed simply to send.

Preview before applying; this does not send mail:

```bash
sudo docker compose exec -T api php artisan mail:authorize-outbound --domain=madenorth.dev
```

If the output says a domain or named mailbox is missing, preview the staged provisioning first, then apply it and repeat the authorization preview:

```bash
sudo docker compose exec -T api php artisan mail:provision-brand-mailboxes
sudo docker compose exec -T api php artisan mail:provision-brand-mailboxes --apply
sudo docker compose exec -T api php artisan mail:authorize-outbound --domain=madenorth.dev
```

Only if Resend now shows `Verified`:

```bash
sudo docker compose exec -T api php artisan mail:authorize-outbound --domain=madenorth.dev --confirm-madenorth-verified --apply
```

Or authorize exactly one existing named Made North address instead:

```bash
sudo docker compose exec -T api php artisan mail:authorize-outbound --address=hello@madenorth.dev
sudo docker compose exec -T api php artisan mail:authorize-outbound --address=hello@madenorth.dev --confirm-madenorth-verified --apply
```

The authorization updates only each mailbox's JSON setting `outbound_enabled=true`; incoming routing and mailbox activation remain unchanged. Catch-all inboxes cannot be approved.

## 5. Verify that Compose can send as the selected address

1. Sign in at `https://mail.madenorth.dev`.
2. In a browser tab with the same authenticated session, visit `https://mail.madenorth.dev/api/outbound/status`. Confirm `configured: true` and the three Made North mailbox addresses among `senders`. (Never publish the full response from your authenticated account.)
3. Return to the dashboard. Select **Compose → From** and choose, for example, `hello@madenorth.dev`.
4. Manually send one short test to an email address you control.
5. Check **Sent** and Resend delivery logs, then check the recipient inbox. `accepted` only means SMTP provider acceptance.
6. If status is `unknown`, do not resend immediately; inspect Resend first to avoid duplicates.

## 6. Optional: approve the other two already verified domains

The default preview and bulk approvals intentionally continue to refer to the two previously verified domains, *not* Made North. Review and authorize those separately:

```bash
sudo docker compose exec -T api php artisan mail:authorize-outbound
sudo docker compose exec -T api php artisan mail:authorize-outbound --domain=receiptboss.ca --apply
sudo docker compose exec -T api php artisan mail:authorize-outbound --domain=santasbag.ca --apply
```

No Cloudflare routing or EC2 infrastructure changes are required for these two already verified sending domains.
