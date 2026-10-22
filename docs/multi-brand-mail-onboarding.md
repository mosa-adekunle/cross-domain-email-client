# Multi-brand mailbox onboarding: ReceiptBoss, Santa's Bag and Made North

The app is already capable of storing multiple mail domains, mailboxes and viewing them together. **Do not replace any domain's existing MX records without an inventory and tested migration.**

## Confirmed domains and sending

| Domain | Resend sending | Cloudflare receiving |
| --- | --- | --- |
| receiptboss.ca | Verified and enabled | Existing Cloudflare/R2 pilot, inspect each production route |
| santasbag.ca | Verified and enabled | Inventory production MX and address-specific routes before changing |
| madenorth.dev | Registered but needs verification | DNS for mail.madenorth.dev hosts the application only; it does not create incoming email |

Resend receiving stays disabled for all three. A verified sending domain alone does **not** create or host receiving mailboxes.

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
