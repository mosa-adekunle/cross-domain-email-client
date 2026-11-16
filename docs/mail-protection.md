# Mail protection: code-only deployment

This code adds an authenticated Spam folder, manual Spam / Not spam feedback, block/trust rules, incoming receiving aliases, and a conservative content-based classifier. Incoming originals remain in private R2; nothing here deletes or rejects the raw archived messages.

## Deploy the existing EC2 stack (no Cloudflare changes)

From ~/cross-domain-email-client, pull main and rebuild only the API and web containers. Run the new migration **before** starting the new API and any automatic importer:

```bash
cd ~/cross-domain-email-client
git pull --ff-only origin main
sudo docker compose build api web
sudo docker compose run --rm --no-deps api php artisan migrate --force
sudo docker compose up -d --no-deps api web
sudo docker compose exec -T api php artisan route:list --path=mail-protection
```

The R2 import systemd timers, database and archive bucket are preserved. For PHP heuristics run `sudo docker compose exec -T api php tests/spam-classifier-smoke.php`. Frontend tests can run in a checkout with `cd frontend && npm test`.

## Behavior and limitations

* New incoming messages are scored on multiple content indicators, plus administrator block/trust rules and manual feedback. Default quarantine score is 60; existing Inbox messages are NOT retroactively reclassified.
* Quarantined messages are stored with `folder=spam`, `is_spam=true` and bounded score/reasons; Inbox unread counts exclude Spam. Mark Not spam moves the message to Inbox and lowers future scores for that sender. Mark spam increases the score for future messages.
* Sender-blocking rules match the **visible From address**, which can be spoofed. Do not treat an allow rule as cryptographic sender authentication.
* The optional Authentication-Results scoring hook is **off by default**. Do not set `MAIL_TRUSTED_AUTHSERV_ID` until ingress validation guarantees those headers are not attacker-controlled. Cloudflare/DNS SPF, DKIM, DMARC changes are not performed.
* The strict recipient list defaults to `madenorth.dev`. Guessed addresses on that domain are still archived by Cloudflare Worker in R2 but imported as ignored objects without creating inbox mail. Existing named mailboxes and configured receiving aliases continue working. A recipient ignored before its alias was configured is not automatically re-imported; it remains in R2 for manual recovery.
* The alias Settings UI maps `contact@madenorth.dev` or another owned-domain address into an **existing active mailbox** without adding a new mailbox. Do not advertise an alias until an external test confirms the live Cloudflare rules deliver it. Alias replies still send from the destination mailbox until an outgoing alias identity is separately verified with your SMTP provider.
* Cloudflare Email Routing, Worker deploy, DNS records, SPF, DKIM, DMARC, catch-all SMTP acceptance, existing legacy forwards, and domain registration are untouched. The new strict-recipient behavior applies on Laravel import, **not** as SMTP rejection.
* Set `MAIL_SPAM_FILTER_ENABLED=false` to disable heuristic quarantine temporarily; an explicit blocked sender still goes to Spam. `MAIL_SPAM_QUARANTINE_SCORE` can be tuned upward to reduce false positives. Changes to these variables require recreating API service, not the web.
