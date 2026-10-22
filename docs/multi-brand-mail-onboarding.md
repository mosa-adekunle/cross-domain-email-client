# Multi-brand mailbox onboarding: ReceiptBoss, Santa's Bag and Made North

The app is already capable of storing multiple mail domains, mailboxes and viewing them together. **Do not replace any domain's existing MX records without an inventory and tested migration.**

## Confirmed domains and sending

| Domain | Resend sending | Cloudflare receiving |
| --- | --- | --- |
| receiptboss.ca | Verified and enabled | Existing Cloudflare/R2 pilot, inspect each production route |
| santasbag.ca | Verified and enabled | Inventory production MX and address-specific routes before changing |
| madenorth.dev | Registered but needs verification | DNS for mail.madenorth.dev hosts the application only; it does not create incoming email |

Resend receiving stays disabled for all three. A verified sending domain alone does **not** create or host receiving mailboxes.

## Approved eleven-address rollout (2026-10-22)

The administrator explicitly approved these addresses:

| Business | New addresses |
| --- | --- |
| ReceiptBoss | sales@receiptboss.ca, legal@receiptboss.ca, privacy@receiptboss.ca, hello@receiptboss.ca |
| Santa's Bag | sales@santasbag.ca, legal@santasbag.ca, privacy@santasbag.ca, hello@santasbag.ca |
| Made North Technologies | mosa@madenorth.dev, hello@madenorth.dev, sales@madenorth.dev |

The existing `inbox-test@receiptboss.ca` Worker recipient remains allowed, but is **not** provisioned anew. The app's approved mailbox manifest is `backend/config/brand_mailboxes.php`; the Cloudflare Worker allowlist is `workers/email-archive/wrangler.jsonc`.

### Stage database records — safe to run before DNS changes

The Laravel command is repeatable and preserves every existing mailbox and domain record, including forwarding state:

```bash
set -e
cd ~/cross-domain-email-client
git pull --ff-only origin main
git rev-parse --short HEAD
sudo docker compose config --quiet
sudo docker compose build api
sudo docker compose run --rm --no-deps api php tests/brand-mailboxes-smoke.php
sudo docker compose run --rm --no-deps api php tests/outbound-smoke.php
sudo docker compose up -d --no-deps --force-recreate api
sudo docker compose exec -T api php artisan mail:provision-brand-mailboxes
sudo docker compose exec -T api php artisan mail:provision-brand-mailboxes --apply
bash scripts/verify-domain-https.sh
sudo docker compose ps
```

The first invocation previews planned changes. `--apply` creates only missing records. Newly created domains are **pending/inactive**; newly created addresses are **inactive and marked onboarding_pending**. Existing rows are never made inactive or modified. A pending identity is excluded from the outgoing sender list and its send attempts are rejected. This command **does not** configure forwarding, DNS, routing, or verify inbound delivery.

### Cloudflare Worker recipient allowlist

The source `wrangler.jsonc` now allows precisely these 11 addresses plus `inbox-test@receiptboss.ca`. Updating GitHub or deploying the Laravel API **does not deploy the Cloudflare Worker**. From a workstation authenticated to the correct Cloudflare account, verify the Worker config and R2 binding and run:

```bash
cd workers/email-archive
# Run on a computer with a browser (not the mail production EC2).
# This Worker has no committed package-lock.json, so use npm install, not npm ci.
npm install --no-audit --no-fund
npm test
npx wrangler whoami || npx wrangler login
# Ensure live dashboard variables do not include intentional extra settings.
# Configured repository vars are authoritative; Worker secrets are preserved.
npx wrangler deploy --dry-run
npx wrangler deploy
```

These commands publish the Worker code and allowlist; they do **not** create Email Routing rules. Preserve and test the existing ReceiptBoss `support`, `legal`, and `privacy` forwarding arrangements before changing the respective Cloudflare actions. Adding a Worker action can replace existing forwarding behavior if you edit an active rule.

### One-command ReceiptBoss sales/hello activation

Once the eleven database records are provisioned and the Cloudflare secret `LEGACY_FORWARD_DESTINATION` is present, deploy the Worker and safely activate **only** `sales@receiptboss.ca` and `hello@receiptboss.ca` from the existing Ubuntu EC2 host:

```bash
cd ~/cross-domain-email-client
git pull --ff-only origin main
python3 -m unittest discover -s scripts/tests -p 'test_*.py' -v
python3 scripts/deploy-receiptboss-mail.py
python3 scripts/deploy-receiptboss-mail.py --apply
```

This is a single-script, idempotent deployment using Dockerized Node/Wrangler. Preview lists what would change; `--apply` first deploys the Worker, then creates only the missing address-specific rules. It requires a Cloudflare API token authorized for **Workers Editor** (existing Worker), **Email Routing Rules Read/Write** (ReceiptBoss zone). A general Cloudflare R2 S3 key is **not** a Worker deployment token. The script looks for `CLOUDFLARE_API_TOKEN` in the shell, the project `.env`, then the private owner-only file `~/.config/cdec/cloudflare-worker-token`. If none exists, it prompts once without echo and saves the token with permissions `0600` for future deployments; never paste a token into chat or a GitHub commit.

Safety gates: verify the current source Worker name/allowlist/R2 binding, inspect Cloudflare's actual routing rules, require an active `inbox-test@receiptboss.ca → cdec-inbound-archive` pilot, refuse duplicates or conflicts, and recheck rules immediately before creation. The script **never modifies** the existing support/legal/privacy forward routes, MX records, website, or direct-host HTTPS gateway. A successful API rule creation must be confirmed by a second inventory check. Stop if any guard fails.

Afterward, send an external test email to each address and confirm an R2 original plus correct imported inbox view in `https://mail.madenorth.dev`. Nothing is considered live/tested until both checks succeed. Legal/privacy dual-delivery migration is a later separate task.

### ReceiptBoss routing audit and dual delivery (2026-10-22)

Verified from the Cloudflare Email Routing screenshot:

| Rule | Current action | Keep until tested |
| --- | --- | --- |
| Catch-all (disabled) | Drop | Yes; do not turn on catch-all |
| inbox-test@receiptboss.ca | Send to cdec-inbound-archive | Yes; working pilot |
| support@receiptboss.ca | Forward to previously verified Gmail | Yes; not requested for onboarding |
| privacy@receiptboss.ca | Forward to previously verified Gmail | Yes; **requires dual delivery** |
| legal@receiptboss.ca | Forward to previously verified Gmail | Yes; **requires dual delivery** |

No active rules for sales@receiptboss.ca or hello@receiptboss.ca were shown. Add them **only after** confirming that the Worker is deployed with the updated explicit allowlist and the private R2 binding works.

**Cloudflare only uses the first matching rule.** Do not create two rules for the same email address. Use the existing Email Worker with both operations for the old Gmail-forwarded accounts.

#### Deploy the Worker safely before rerouting any production legal/privacy mail

- In the Cloudflare account used by ReceiptBoss, verify the Gmail destination is already confirmed in **Email Routing → Destination addresses** (the existing active rules strongly suggest that it is).
- Store that destination **only** as a Cloudflare Worker Secret named `LEGACY_FORWARD_DESTINATION` for `cdec-inbound-archive`, via Workers & Pages → Worker → Settings → Variables and Secrets → Add → **Secret**. Enter the same verified Gmail destination used by the existing legal/privacy rules. Do **not** commit its value to Git, Wrangler `vars`, an issue, or logs.
- Wrangler source controls `ALLOWED_RECIPIENTS` (the 11 approved new identities plus the test address) and `LEGACY_FORWARD_RECIPIENTS=legal@receiptboss.ca,privacy@receiptboss.ca`. The Worker fails closed if a legacy recipient is routed without its verified destination secret or message.forward API.
- From a trusted machine with Node and a Cloudflare login authorized for the correct account, execute:

  ```bash
  git pull --ff-only origin main
  cd workers/email-archive
  npm install --no-audit --no-fund
  npm test
  npx wrangler whoami
  npx wrangler deploy --dry-run
  npx wrangler deploy
  ```

  **Do not use `--keep-vars`** for this rollout: the repository config is the source of truth for `ALLOWED_RECIPIENTS` and `LEGACY_FORWARD_RECIPIENTS`, and the flag can retain stale dashboard values. Cloudflare states that deployment preserves Worker **secrets**. Verify no other intentional dashboard-only plaintext variables need preservation before proceeding.

- R2 and forwarding happen **in sequence**: the Worker archives the original MIME in private R2, and then calls `await message.forward(verifiedDestination)`. A failed R2 write prevents forwarding; a forwarding error propagates after archival. Test with controlled messages before changing a real forwarding rule. Downstream Gmail filters and Cloudflare delivery statuses must be checked.
- Create **sales@receiptboss.ca** and **hello@receiptboss.ca** explicit Send-to-Worker rules first. Test an external message to each; confirm R2 object metadata and imported inbox appearance.
- Switch **privacy@receiptboss.ca** to Send to Worker by **editing the existing rule** (not adding a duplicate) only after verifying the secret and code are deployed, then test that the same message arrives in **both** Gmail and Made North Mail. Restore the previous Gmail-only action if either destination fails, and investigate before switching **legal@receiptboss.ca**.
- Keep `support@receiptboss.ca` forwarding as-is; preserve existing rules on other domains until individually reviewed.

### ReceiptBoss Privacy: reversible first dual-delivery test

**Do not migrate Legal and Privacy together.** Privacy is the first address to move after Sales and Hello are receiving successfully.

The new `scripts/migrate-receiptboss-privacy.py` script checks production Cloudflare Worker bindings, the encrypted forwarding secret (existence/type only), the enabled `inbox-test` pilot, the existing Gmail-forwarding rule for Privacy, and the unchanged Legal and Support rules. Cloudflare never reveals the secret's value via its API, so this does **not** establish that its destination is correct; the full delivery test remains essential.

From the existing EC2 host, using the previously stored private Cloudflare deploy token:

```bash
cd ~/cross-domain-email-client
git pull --ff-only origin main
python3 -m unittest discover -s scripts/tests -p 'test_*.py' -v
python3 scripts/migrate-receiptboss-privacy.py          # preview only
python3 scripts/migrate-receiptboss-privacy.py --apply  # migrate ONLY Privacy
```

The live rule is updated with Cloudflare's zone-scoped Email Routing Rules API. Before that write, the exact Gmail-forwarding route is backed up at `~/.config/cdec/receiptboss-privacy-original-route.json` (mode `0600`). Legal, Support, and Sales/Hello remain untouched.

Immediately send a **new** email to `privacy@receiptboss.ca` from an unrelated provider. Verify the message arrives in **both** the existing Gmail inbox and the Privacy mailbox at `mail.madenorth.dev` after the R2 importer runs. If either copy fails or Cloudflare reports an error, restore the former rule immediately:

```bash
cd ~/cross-domain-email-client
python3 scripts/migrate-receiptboss-privacy.py --rollback
```

Do not switch Legal until the Privacy dual-delivery test has passed.

### Live routing must be verified address-by-address

For each domain, confirm that Cloudflare Email Routing already owns the relevant incoming MX records. If not, migrate deliberately and only after identifying the current provider and any dependent mailboxes. For each approved address create or update the explicit per-recipient route to `cdec-inbound-archive`, *only when preserving any required existing forwarding*. Never use a catch-all. Test each address from an unrelated provider, confirm raw MIME in R2 and a successful import, and check arrival in the unified mailbox UI. Do not enable outgoing for `madenorth.dev` until Resend reports verified. After testing delivery, clear the pending flag for each new identity through a separately reviewed activation procedure.

This rollout does not grant access to old external Gmail message history; transferring that historical mail would require an explicit import.

## Existing known addresses, not an exhaustive list

- receiptboss.ca: inbox-test@receiptboss.ca and support@receiptboss.ca have appeared in the deployed mail client. Independently confirm privacy@receiptboss.ca and legal@receiptboss.ca and preserve existing Gmail forwarding rules.
- santasbag.ca: address inventory required. Do not guess local parts (e.g. support@) or change its existing email delivery.
- madenorth.dev: address inventory required. Do not confuse mail.madenorth.dev (web app hostname) with actual desired email addresses.

## Made North Resend verification DNS

Domain added to Resend 2026-10-22, sending enabled, receiving disabled. **Verification status: not_started.** Add the following records in Cloudflare zone `madenorth.dev` (names relative to the zone):

| Type | Name | Value | Priority |
| --- | --- | --- | --- |
| TXT | resend._domainkey | p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDHJ7cJJrPtnF/CRfLKgee/qhCSpqjN1Vz9suiGYnJnNKqsONaBrUYSXiRFE87otNclhmMPJz2UajldZUDjCn66dY1PmFyLvvNnboiIPqRxLpWWhKEn8q0ypfdmL3rUMF3VKbo4fT/xzMPeXnafNYKR3ItZU/pCVgwdUvcme0NGEQIDAQAB | — |
| MX | send | feedback-smtp.us-east-1.amazonses.com | 10 |
| TXT | send | v=spf1 include:amazonses.com ~all | — |
| CNAME | rsend | send.forge.rmta.net | — |

TTL Auto; CNAME DNS-only if a proxy option appears. `send.madenorth.dev` is the **Resend bounce/return-path subdomain**, not the incoming mailbox MX. Preserve root `madenorth.dev` A, `www`, `mail` A, Email Routing MX, existing SPF/DKIM/DMARC, and Worker/R2 configuration. Inspect for any existing `send`, `resend._domainkey` and `rsend` records before creating conflicts. Request verification only after DNS is correct.

## Onboarding each receiving address

1. Confirm the exact existing email address, where it currently receives mail, and whether forwarding must remain.
2. Save domain and mailbox through authenticated Settings. Creation is intentionally pending/inactive until delivery verification. Avoid duplicates. No blanket catch-all.
3. Inspect domain's current DNS MX records and Email Routing destinations. A domain might be served by a different provider. Never replace MX blindly.
4. If Cloudflare Email Routing already receives for this domain, configure one explicit address-specific `Send to Worker → cdec-inbound-archive` route and add its normalized address to Worker `ALLOWED_RECIPIENTS`. Deploy Worker changes **before** enabling the route, or an unallowed recipient will be rejected. The Worker must keep its private `MAIL_ARCHIVE` R2 binding and V2 archival keys.
5. **Critical:** A Cloudflare rule with a single Worker action cannot be assumed to also forward the same email to the previous destination. For addresses that already forward to Gmail, design and test dual delivery / forwarding explicitly before switching. Do not interrupt existing production flows.
6. Run an outside-provider inbound test to each address. Verify a V2 object in private R2, successful incremental import, message in the correct mailbox and no duplicate import. Then test a reply from that address after sending verification. Preserve originals in R2.
7. Configure `OUTBOUND_ALLOWED_DOMAINS` on the EC2 host for **only Resend-verified domains**. Keep SMTP credentials secret; do not commit them. Changes to the environment require recreating the API container.
8. Update mailbox/domain active and verified states **only after delivery tests**. Current Settings creates records as pending/inactive and has no activation endpoint; onboarding needs a guarded explicit activation workflow rather than directly opening unaudited SQL access.

## Operational checks

- `sudo systemctl list-timers --all 'cdec-r2-*'` confirms incremental and reconciliation polling
- `sudo docker compose exec -T api php artisan mail:sync-r2 --mode=incremental --limit=100` checks new archives
- `sudo docker compose exec -T api php artisan mail:sync-r2 --mode=reconcile --limit=500` recovers older-layout archives
- Never print `.env`, private R2 keys, API keys or full email message bodies in diagnostic logs.
- New mailbox addresses should be reviewed individually and their existing receive paths verified before cutover.
