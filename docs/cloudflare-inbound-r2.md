# Cloudflare inbound email and private R2 archive

> **Update (October 2026):** The manual-only stage below describes the original archive/import rollout. **One-minute scheduled import, persistent checkpoint/retries, daily reconciliation and ordered R2 keys are now specified in [Automatic R2 sync](automatic-r2-sync.md).** Deployment requires updating the Worker and installing timers on the app EC2; do not run its installer on receiptboss-dev.\n\nThis stage introduces a **safe-by-default Email Worker** and an optional, **manual** Laravel R2 importer. Publishing the repository or rebuilding Docker does not enable inbound routing, change MX records, create an R2 bucket, or enable a background poller.

## Architecture

```text
Cloudflare Email Routing (only after MX/rules are approved)
        |
        v
Email Worker (recipient allowlist, max 25 MiB)
        | await R2.put(original MIME stream)
        v
Private R2 bucket (raw .eml is the durable source of truth)
        |
        | S3-compatible API, outbound HTTPS from EC2 only
        v
php artisan mail:sync-r2 --limit=100
        |
        v
incoming_objects + mail_messages + mail_threads + mail_recipients
        |
        v
Existing authenticated React inbox (metadata/preview only)
```

The Worker persists **unaltered raw RFC 5322 MIME bytes** (including attachments) under `incoming/YYYY/MM/DD/<uuid>.eml`. It includes the SMTP envelope recipient/from and archive time in R2 object custom metadata. There is no HTTP fetch handler and `workers_dev` is disabled. An empty `ALLOWED_RECIPIENTS` list rejects all mail. The Worker does not call EC2 or depend on a public Laravel port. If the R2 write fails, the handler throws instead of reporting successful processing. Test Cloudflare's delivery/failure behavior before changing production MX; do not assume a failed handler will always cause an SMTP retry.

**Privacy and safety:** R2 must be private; do not enable public buckets or issue public object URLs. The Worker has R2 binding access, while Laravel uses a separate **read/list-only** Cloudflare R2 API token with S3 credentials. Never put these secrets in Wrangler `vars`, Git, logs or browser JavaScript. Use a dedicated bucket for raw email, with appropriate retention and access policies. 

## Step A: deploy the application update first (no Cloudflare account required)

On `ssh cross-domain-email`:

```bash
cd ~/cross-domain-email-client
git pull --ff-only origin main
sudo docker compose config --quiet
sudo docker compose build api
sudo docker compose up -d --no-deps --force-recreate api web
sudo docker compose exec -T api php artisan migrate --force
bash scripts/verify-r2-stage.sh
```

This leaves PostgreSQL data intact. Until R2 credentials are added, the `mail:sync-r2` command intentionally refuses to run. Nothing else needs to change in the running dashboard.

## Step B: prepare Cloudflare R2, without modifying DNS

1. In the **Cloudflare dashboard**, create a **private** R2 bucket named `cdec-inbound-mail` in the intended account. If the name differs, update `workers/email-archive/wrangler.jsonc` and the server's `R2_BUCKET` to the **same** name before deploying the Worker.
2. Create a separate R2 S3-compatible **read/list-only API token**, limited to this bucket where Cloudflare supports it. Record the Account ID, Access Key ID, and Secret Access Key securely. Cloudflare R2's S3 API endpoint is `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
3. On the EC2 host, edit the existing `~/cross-domain-email-client/.env` (do not regenerate it) and add: 

   ```dotenv
   R2_ACCOUNT_ID=YOUR_CLOUDFLARE_ACCOUNT_ID
   R2_ACCESS_KEY_ID=YOUR_R2_READ_ACCESS_KEY
   R2_SECRET_ACCESS_KEY=YOUR_R2_READ_SECRET
   R2_BUCKET=cdec-inbound-mail
   ```

   Run `chmod 600 .env` and `sudo docker compose up -d --no-deps --force-recreate api`. **Do not share the populated .env or run `docker compose config` without `--quiet` in public logs**, because Compose environment output can reveal secrets.
4. Verify R2 listing without changing the database:

   ```bash
   sudo docker compose exec -T api php artisan mail:sync-r2 --dry-run --limit=1
   ```

## Step C: deploy the Worker, still without changing routing

Use Node.js and authenticated Wrangler **in the Cloudflare account** (a local workstation is sufficient; do not install Wrangler on the EC2 web server just to deploy):

```bash
cd workers/email-archive
npm install
npm test
npx wrangler login
npx wrangler deploy --dry-run
npx wrangler deploy
```

Before deploy, set `ALLOWED_RECIPIENTS` in `wrangler.jsonc` to a comma-separated list of **only the addresses created in this application's Settings screen**, e.g. `"support@example.com,billing@example.com"`. The provided value is empty and rejects everything until explicitly configured. Do not use a broad catch-all. The Wrangler configuration contains **no `addresses` property**, so deployment does not automatically take over Email Routing rules or DNS. Verify the Worker is associated with the correct R2 bucket before using it.

## Step D: explicit controlled mail-routing cutover (not automated)

Only after the archive Worker, S3 access, inbox import and backup procedures are confirmed with a test domain you own:

1. In Cloudflare Email Routing, verify/enable the domain and inspect its current MX records and active mail service. **Changing MX records can interrupt existing email**; keep working routes untouched until ready.
2. Create a **specific address** routing rule (e.g. `support@example.com`) with destination **Send to a Worker → cdec-inbound-archive**. Never enable a blanket catch-all by default.
3. Send one small test email to this address from an independent provider. Verify exactly one raw `.eml` object exists in private R2 (and note its custom `recipient` metadata). Only then run the importer:

   ```bash
   sudo docker compose exec -T api php artisan mail:sync-r2 --limit=100
   ```

4. Refresh the authenticated inbox. The message metadata/preview should appear under the configured mailbox. Rerun the same command to verify idempotency (no duplicate rows).
5. Confirm a loss-of-R2 failure is **not** silently acknowledged by Cloudflare before using this as the sole live receiving path.

## Limits / follow-up requirements

- Import is **manual** in this stage. Do not create an hourly cron until verified imports, retry monitoring, encrypted off-host PostgreSQL backups, and restoration have been tested.
- Importer polls R2 from the beginning with paginated list operations, skipping processed object IDs. For large archives, replace this with a resumable cursor and recent-object retry windows to reduce list costs.
- The importer preserves raw MIME in R2, indexes one delivery per envelope recipient, and extracts subject, sender and a **plain-text** preview only. It does not display HTML, parse/store attachment metadata, implement comprehensive conversation threading, or support downloading raw MIME. No original objects are deleted from R2.
- A missing mailbox leaves the raw object available for reprocessing after creating that mailbox. There are no automatic mailbox/domain activation or DNS changes.
- No outbound SMTP is configured; no messages can yet be sent. No public EC2 web ingress is needed.
- Build dependencies are not locked yet; create and review Composer/npm lockfiles before reproducible production builds.

References: https://developers.cloudflare.com/email-service/api/route-emails/email-handler/ , https://developers.cloudflare.com/r2/api/workers/workers-api-reference/ , https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/
