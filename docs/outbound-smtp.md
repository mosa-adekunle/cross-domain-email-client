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
OUTBOUND_ALLOWED_DOMAINS=receiptboss.ca
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