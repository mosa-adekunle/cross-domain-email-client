# Outbound SMTP: Compose, Drafts and Sent

Cross Domain Email Client supports authenticated plain-text Compose, To/CC/BCC, Reply, Forward text, saved and editable Drafts, and Sent messages. Sending is **off by default** until the administrator configures a real SMTP provider and explicitly allows verified sending domains. This release does not support outbound attachments, HTML composing, or forwarded attachments.

## SMTP provider and domain

Use a provider that accepts authenticated SMTP from your configured domain: Resend, SES, Postmark, Mailgun, etc. For receiptboss.ca, a separately verified Resend sending domain is available; **create a dedicated API key for this client** and do not reuse the ReceiptBoss application's transactional-mail secret. Resend SMTP uses host **smtp.resend.com**, port **587**, username **resend**, and the dedicated API key as password. Check your Resend verified sender/domain status first.

Preserve existing Cloudflare Email Routing inbound **MX** records, Worker and R2 bucket. Add only the provider's exact SPF/DKIM/return-path/DMARC sender-authorization records and avoid duplicate root SPF records. Never guess DNS records or change Cloudflare Email Routing to enable outgoing SMTP.

## Server configuration

Run on the Cross Domain Email EC2 server (not receiptboss-dev):

```bash
cd ~/cross-domain-email-client
git pull --ff-only origin main
chmod 600 .env
nano .env
```

Put private credentials only in the server .env (never in Git or chat):

```dotenv
MAIL_HOST=smtp.resend.com
MAIL_PORT=587
MAIL_SCHEME=smtp
MAIL_USERNAME=resend
MAIL_PASSWORD=YOUR_NEW_DEDICATED_SMTP_KEY
OUTBOUND_PROVIDER_LABEL=Resend
OUTBOUND_ALLOWED_DOMAINS=receiptboss.ca,santasbag.ca
```

SMTP port 587 uses STARTTLS where the provider advertises it; use smtps and 465 for implicit TLS as required by a different provider. Only listed domains and addresses that exist in the configured mailbox table can be used as sender identities. A mailbox may still be inactive for inbound routing; **outbound** authorization is independent and explicit. No Laravel log-mail fallback is enabled.

## Deployment

```bash
cd ~/cross-domain-email-client
git pull --ff-only origin main
sudo docker compose config --quiet
sudo docker compose build api web
sudo docker compose up -d --no-deps --force-recreate api web
sudo docker compose exec -T api php artisan route:list --path=api/drafts
sudo docker compose exec -T api php artisan route:list --path=api/outbound
sudo docker compose exec -T api php tests/outbound-smoke.php
bash scripts/verify-ip-https.sh
sudo docker compose ps
git rev-parse --short HEAD
```

No database migration: existing mail_messages, mail_recipients, and mail_delivery_attempts tables store drafts, accepted messages, recipient addresses, and delivery attempts. Incoming email ingestion/R2 and TLS renewal timers are unchanged.

## First send and safety

1. Verify the sending domain in your provider, create a dedicated SMTP credential, and restart the API with the new .env.
2. Sign in at https://52.14.33.209, click Compose, choose a configured sender, and send plain text to an address you own.
3. Check the confirmation and Sent folder; also confirm actual delivery in the recipient inbox or provider dashboard. SMTP 'accepted' is **not** proof of final delivery.
4. Test CC/BCC and Reply. Forward currently forwards text only.
5. If delivery is 'unknown', do not resend automatically. SMTP may have accepted the message before losing the connection. Investigate the provider before manually composing another.

## API and security

The existing authenticated web session and CSRF protection guard the endpoints: GET /api/outbound/status, POST /api/drafts, PATCH /api/drafts/{id}, DELETE /api/drafts/{id}, and POST /api/drafts/{id}/send. The last route is rate limited. The backend validates recipients, enforces a configured sender identity and allowed verified domain, records the SMTP attempt in PostgreSQL, and locks each draft before network submission. No automatic retries or silent duplicate sends. SMTP credentials, raw bodies, and server responses are not logged; only a generic error status and exception class are recorded.

## AWS, Terraform and Cloudflare

No new AWS IAM policies, security groups, inbound SMTP ports, Terraform resources, state changes, R2 write tokens, Cloudflare Workers or Email Routing modifications are required. The EC2 instance already permits outbound SMTP submission by security-group egress. Outbound sending is through an external authenticated SMTP service on port 587; no server port 25 is exposed. Keep provider API secrets out of Terraform state and GitHub.

## Approving existing named senders (October 23, 2026)

As verified directly in Resend on October 23, **receiptboss.ca** and **santasbag.ca** are verified for sending. **madenorth.dev** is still `not_started` and must remain unable to send; the other catch-all domains are not approved senders. Recheck provider status before operating, because verification can change.

The explicitly approved sender inventory is in `backend/config/brand_mailboxes.php`:

- ReceiptBoss: `sales@`, `legal@`, `privacy@`, `hello@receiptboss.ca`.
- Santa's Bag: `sales@`, `legal@`, `privacy@`, `hello@santasbag.ca`.
- Made North's `mosa@`, `hello@`, and `sales@madenorth.dev` remain **pending** until its Resend status is Verified. The backend now supports approving them with an explicit confirmation flag after verification; see [the complete Made North activation instructions](madenorth-outbound-activation.md).

Existing `support@receiptboss.ca` and `inbox-test@receiptboss.ca` are unaffected. Catch-all inboxes are **never** valid senders. Inbound Cloudflare readiness does not prove outbound verification, and outbound approval never alters Gmail forwarding, inbox activation, DNS, Worker routes or R2.

The new `settings.outbound_enabled` boolean is a separate authorization flag. Only eligible named mailboxes receive `outbound_enabled: true`. Their `onboarding_pending` and `is_active` settings are preserved unchanged. An explicit `outbound_enabled: false` revokes sending; older mailboxes without this flag retain their existing behavior unless they are catch-all mailboxes. The API and backend send action both enforce these rules.

On the existing mail EC2 host (not ReceiptBoss EC2):

```bash
cd ~/cross-domain-email-client
git pull --ff-only origin main

# Edit only if needed. Keep the existing dedicated SMTP credentials; never print them.
# Keep OUTBOUND_ALLOWED_DOMAINS=receiptboss.ca,santasbag.ca until Made North is verified; then append madenorth.dev.
sudo docker compose config --quiet
sudo docker compose build api
sudo docker compose up -d --no-deps --force-recreate api
sudo docker compose exec -T api php artisan config:clear

# Preview exactly what would change. Does not send email.
sudo docker compose exec -T api php artisan mail:authorize-outbound

# If any approved mailbox is missing, stage the known inventory first:
# sudo docker compose exec -T api php artisan mail:provision-brand-mailboxes --apply
# Then preview again before the following step.

# Explicitly authorize the currently verified domains (DB flags only).
sudo docker compose exec -T api php artisan mail:authorize-outbound --domain=receiptboss.ca --apply
sudo docker compose exec -T api php artisan mail:authorize-outbound --domain=santasbag.ca --apply

# Verify policy and deployment (no message sent).
sudo docker compose exec -T api php tests/outbound-sender-authorization-smoke.php
sudo docker compose ps api
git log -1 --oneline
```

The authorization command intentionally fails with no partial modifications if the approved mailboxes are missing, the allowed-domain configuration is incomplete, or Resend SMTP is not configured. Do not bypass its safety checks, authorize catch-all addresses or add unverified domains to `OUTBOUND_ALLOWED_DOMAINS`. To verify success, sign in at `https://mail.madenorth.dev`, open Compose and confirm that named sender identities appear. Send one deliberate test email to an inbox you control, then check final provider delivery; nothing above sends a message automatically.


## Authorizing any specific named mailbox (October 23, 2026)

The Compose **From** menu is populated from `GET /api/outbound/status`. It shows **every existing mailbox that is independently authorized for outbound sending on an allowed domain**, not just the fixed brand-mailbox inventory. An inbox does not need to be activated for *incoming* mail to be used for outbound sending. The backend validates the same permissions again when sending a draft, so the browser selector is not a security boundary.

The `mail:authorize-outbound` command supports two workflows:

- Existing bulk approvals: `--domain=receiptboss.ca` or `--domain=santasbag.ca`, restricted to the previously approved four named addresses in each brand manifest.
- An individually chosen existing non-catch-all address, including a newly created one: `--address=billing@receiptboss.ca` (preview) and then `--address=billing@receiptboss.ca --apply`. This does **not** amend the manifest or enable other addresses.

The address must already exist in the `mailboxes` table. If it does not, add it first in Mailbox Settings. The individual command does not create domains or mailboxes, change `is_active`, activate a forwarding rule, update DNS, or modify any other email address. Approval sets only that mailbox's JSON `settings.outbound_enabled=true`, preserving `settings.onboarding_pending`. Catch-all identities, including a mailbox marked as catch-all in settings, are rejected.

Resend currently verifies **receiptboss.ca** and **santasbag.ca** for outbound delivery; `madenorth.dev` remains **not_started**. The CLI also supports Made North approvals but **only after provider verification**; its `--apply` action additionally requires `--confirm-madenorth-verified` for that domain, configured Resend SMTP, and the domain in private `OUTBOUND_ALLOWED_DOMAINS`. Without explicit individual approval, existing Made North mailboxes (including legacy rows with missing settings) cannot send. Follow [Made North's DNS and SMTP checklist](madenorth-outbound-activation.md) for exact Cloudflare records and commands.

### Deploy this backend-only change

On the mail server, not the Made North website directory:

```bash
cd ~/cross-domain-email-client
git pull --ff-only origin main

# In the private .env, retain your existing dedicated SMTP credentials.
# Make sure this setting includes both currently verified domains:
# OUTBOUND_ALLOWED_DOMAINS=receiptboss.ca,santasbag.ca
# If you edit .env, use nano .env and never echo its credentials.

# Only the API source changed; do not rebuild the React frontend or database.
sudo docker compose config --quiet
sudo docker compose build api
sudo docker compose up -d --no-deps --force-recreate api
sudo docker compose exec -T api php artisan config:clear

sudo docker compose exec -T api php tests/outbound-smoke.php
sudo docker compose exec -T api php tests/outbound-sender-authorization-smoke.php
sudo docker compose exec -T api php artisan mail:authorize-outbound --help
sudo docker compose ps api
```

If you change **only** `.env` at a later time and do not pull new backend code, `sudo docker compose up -d --no-deps --force-recreate api` is enough; no image rebuild is needed.

### Enable one chosen sender

```bash
cd ~/cross-domain-email-client

# Preview: does not modify data or send any email.
sudo docker compose exec -T api php artisan mail:authorize-outbound --address=billing@receiptboss.ca

# After confirming that the exact mailbox exists and the domain is verified:
sudo docker compose exec -T api php artisan mail:authorize-outbound --address=billing@receiptboss.ca --apply

# Reopen Compose at https://mail.madenorth.dev to refresh its sender list.
```

Substitute the exact existing address you intend to send from. The per-address authorization command is idempotent: re-approving an already approved mailbox is a no-op. When a new mailbox is created in a currently approved domain, it still requires this explicit per-address approval; this is intentionally **not** a wildcard send-as privilege.

To authorize the original eight predefined ReceiptBoss / Santa's Bag addresses instead, continue using the previous `--domain=...` commands. Made North uses `--domain=madenorth.dev --confirm-madenorth-verified --apply` **only after** Resend verification. The existing `support@receiptboss.ca` and `inbox-test@receiptboss.ca` pilot senders remain unchanged. Test one manually chosen email addressed to an inbox you control and confirm its provider delivery state; the CLI performs no sends.
