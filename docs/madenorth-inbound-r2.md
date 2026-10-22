# Receive all madenorth.dev email directly into private Cloudflare R2

## What this does (and does not do)

Incoming `anything@madenorth.dev` -> Cloudflare Email Routing -> existing Email Worker `cdec-inbound-archive` -> existing **private** bucket `cdec-inbound-mail` -> existing Laravel R2 importer -> https://mail.madenorth.dev.

**No SMTP listener or mailbox server is installed on EC2.** Cloudflare receives inbound SMTP from the public internet and the Worker saves the original, unmodified MIME bytes to R2. SMTP sending, newsletter confirmations, and corporate website form notifications are **separate outbound tasks**; receiving messages in R2 does not send email.

The Worker stores objects as `incoming/v2/YYYY/MM/DD/TIMESTAMP-UUID.eml` with `recipient`, `envelope_from` and `received_at` custom metadata. It allows only the five configured owned domains. For `madenorth.dev`, explicitly created mailboxes (`mosa`, `hello`, `sales`) are resolved first; any other local part lands under a **single** `catchall@madenorth.dev` inbox with the actual recipient retained for display and replies. This does not create a new R2 bucket, new VM, or mailbox for every address.

## Preflight — EC2 and Cloudflare

Run on the **Cross Domain Email Client** EC2 host (not the Made North corporate website directory):

```bash
cd ~/cross-domain-email-client
git pull --ff-only origin main
python3 -m unittest discover -s scripts/tests -p 'test_*.py' -v
sudo docker compose config --quiet
sudo docker compose build api
sudo docker compose up -d --no-deps --force-recreate api
sudo docker compose exec -T api php artisan migrate --force
sudo docker compose exec -T api php artisan mail:provision-catchalls --domain=madenorth.dev
```

The last command is read-only and lists the missing Made North catch-all mailbox, if any. Provision **only this domain** after verifying the output:

```bash
sudo docker compose exec -T api php artisan mail:provision-catchalls --domain=madenorth.dev --apply
sudo docker compose exec -T api php artisan mail:provision-catchalls --domain=madenorth.dev
```

The final preview should show **0 domain(s)** and **0 catch-all mailbox(es)** to create. It does not change routing or activate outbound sending.

Run a read-only Cloudflare Email Routing readiness check:

```bash
python3 scripts/configure-domain-catchalls.py --domain madenorth.dev --status
```

The script expects a private Cloudflare API token from `~/.config/cdec/cloudflare-worker-token` (or the existing private configuration). Never put tokens in chat, screenshots, shell commands or Git. It needs zone read, Email Routing rules read/write and Worker deployment rights for the targeted resources.

### If the script reports NOT READY

First run the domain-scoped, **read-only DNS preflight** (never the all-five-domains command):

```bash
python3 scripts/activate-owned-email-routing.py --domain madenorth.dev
```

If it says `madenorth.dev: activate`, the selected zone has no conflicting root MX/SPF records according to Cloudflare's API. You can explicitly activate **only that domain** with:

```bash
python3 scripts/activate-owned-email-routing.py --domain madenorth.dev --apply
```

This deploys and verifies the existing Worker before enabling Cloudflare-managed root MX/SPF, rechecks for DNS conflicts before writing, and refuses to edit DNS for any other domain. **Only run `--apply` after reviewing the preview**. If existing MX/SPF records are detected, the script refuses the change: inspect them instead of deleting them.

Alternatively, open **Cloudflare Dashboard -> madenorth.dev -> Compute -> Email Service -> Email Routing** and use Cloudflare's guided onboarding. Review the Cloudflare-provided MX/TXT records and any existing provider, SPF, DKIM and DMARC configuration; do not duplicate SPF or replace working third-party MX without a mail transition plan.

Repeat `--status` until it reports `madenorth.dev: READY`. The R2 **Objects** tab is storage only; the bucket itself does not configure domain delivery.

## Preview, then activate only madenorth.dev

```bash
python3 scripts/configure-domain-catchalls.py --domain madenorth.dev
```

This audits the zone's existing catch-all and **all active exact-address rules**. An existing active catch-all to another destination is a hard stop. Existing exact-address rules sending to Gmail or other Workers are listed and preserved; they **take precedence over** the catch-all. For *every* address at the domain to reach R2, migrate those explicit rules separately after preserving any required existing forwarding.

If the preview is clean and you have confirmed the domain's MX, Worker, R2 binding and mailbox, enable only the selected catch-all:

```bash
python3 scripts/configure-domain-catchalls.py --domain madenorth.dev --apply
```

This first runs the existing Worker test/dry-run/deploy flow, verifies the live Worker has `MAIL_ARCHIVE` and the exact five-domain allowlist, creates an owner-only local backup of the selected zone's previous catch-all, and switches **only `madenorth.dev`** to `cdec-inbound-archive`. It never modifies ReceiptBoss, Santa's Bag, madekunle.com or delishearsentertainment.com routing rules, and it does not change MX records.

After applying, re-run the preview and check the Cloudflare Email Routing dashboard to confirm the catch-all action is **Send to a Worker: cdec-inbound-archive**, not **Drop**.

## End-to-end verification

1. Send a new small, non-sensitive test message from a completely separate provider to `hello@madenorth.dev`. Send another to a previously nonexistent address such as `routing-probe-20261022@madenorth.dev`.
2. Cloudflare Dashboard -> **R2 Object Storage -> cdec-inbound-mail -> Objects -> incoming/v2/**. Look for *two new* `.eml` objects. Check timestamps and object metadata `recipient`, without making the bucket public. Cloudflare Email Routing activity can corroborate Worker execution.
3. If the existing one-minute systemd importer is running, check `systemctl list-timers 'cdec-r2-*'`. Otherwise, manually import without touching archived originals:

   ```bash
   cd ~/cross-domain-email-client
   sudo docker compose exec -T api php artisan mail:sync-r2 --mode=incremental --limit=100
   sudo docker compose exec -T api php artisan mail:sync-r2 --mode=reconcile --limit=500
   ```

4. Log into `https://mail.madenorth.dev`. Confirm the `hello@` test appears in its exact mailbox, and the arbitrary-recipient test appears under `catchall@madenorth.dev` with the **original destination address displayed**. Test reading and downloading the original attachments if any.
5. Inspect Worker logs, retry records and Email Routing delivery status if an object is absent. Do not claim full delivery until both R2 archival and inbox import succeed.

The Worker rejects oversized messages above the Cloudflare Email Routing size limit; test with small mail first. Cloudflare Email Routing is **inbound only**; sending and replying from branded identities require a separately configured sending provider (potentially a sending API instead of SMTP). Website contact forms currently save enquiries to PostgreSQL; they do **not** automatically create inbound email and are not affected by this configuration.

## Existing safeguards

- Five owned-domain allowlist; unknown domains rejected.
- R2 private; authenticated inbox and read-only R2 importer credentials.
- Catch-all backup at `~/.config/cdec/owned-domain-catchalls-original.json` (file mode 0600).
- Existing active forwarding and exact-address rules are never overwritten by catch-all rollout.
- No changes to other zones, root website, TLS gateway, outbound email providers, or SMTP listener.
