# Single-administrator authentication and mail schema

## Status and constraints

This stage adds database-backed administrator sessions, server-side CSRF checks, login throttling, and empty email-schema tables. It **does not** enable inbound delivery, sending, message retrieval, attachment downloads, user registration, or public HTTPS. Keep Nginx listening on `127.0.0.1:8080` and access through the Mac SSH tunnel until HTTPS and authorization tests are complete.

## Administrator setup

Run on the application EC2 host (`cross-domain-email`, not `receiptboss-dev`):

```bash
cd ~/cross-domain-email-client
git pull --ff-only origin main
sudo docker compose config --quiet
sudo docker compose build api web
sudo docker compose up -d --force-recreate api web
sudo docker compose exec -T api php artisan migrate --force
sudo docker compose exec api php artisan admin:create you@example.com
bash scripts/verify-auth-schema.sh
```

The `admin:create` command prompts for the display name and a password (minimum 14 characters) and refuses to add a second account. Replace the email address with your chosen administrator email. Passwords are not entered as command-line arguments and must not be put in `.env` or GitHub. Password recovery from the host uses `sudo docker compose exec api php artisan admin:reset-password you@example.com`, which clears existing sessions.

The frontend requests `GET /api/auth/csrf`, sends the returned token as `X-CSRF-TOKEN` for login/logout, and uses a SameSite Strict, HttpOnly, encrypted Laravel session cookie. Authentication and session data are stored in PostgreSQL. `POST /api/auth/login` is throttled; application-level failed-login limits also use the PostgreSQL cache. The token is deliberately kept in JS memory rather than localStorage. Only `GET /api/status`, `GET /api/auth/csrf`, and login are available anonymously.

The preview uses `SESSION_SECURE_COOKIE=false` solely because browser connections use `http://127.0.0.1:8080` over the SSH tunnel. **Before exposing this publicly**, add HTTPS, switch `SESSION_SECURE_COOKIE=true`, review proxy/cookie settings and CSP, implement multi-factor authentication and additional auditing, and run end-to-end auth/CSRF/session tests.

## Database tables

- `users`: one operator only; email/password hash, role and active flag.
- `sessions`, `cache`, `cache_locks`: database-backed session state and cross-request login throttling.
- `mail_domains`: custom domains, verification state, Cloudflare zone reference.
- `mailboxes`: unique normalized address, associated domain and workspace details.
- `sending_identities`: per-mailbox from-address and provider label (never provider credentials).
- `incoming_objects`: raw MIME metadata and durable R2 object locator, SHA-256 object identity for replay/deduplication, processing status and attempts.
- `mail_threads`: mailbox-scoped conversation groups.
- `mail_messages`: inbox/draft/outgoing message metadata, threading headers and references to inbound R2 archive.
- `mail_recipients`: To, CC and BCC recipients.
- `mail_attachments`: metadata, content ID, size, SHA-256 and optional R2 key; raw binary contents not in PostgreSQL.
- `mail_delivery_attempts`: outbound provider delivery ledger.

**Data integrity:** `mail_messages(mailbox_id,incoming_object_id)` is unique when the inbound object is present. A raw inbound object can fan out into one message in each mailbox without duplication. `incoming_objects.object_identity_sha256` is sha256(bucket name + NUL + R2 key), calculated before inserting, with unique constraint for idempotent Worker retries. Use normalized ASCII/IDNA domain and normalized email addresses in future write APIs. Database foreign keys prevent accidental deletion of domains/mailboxes with stored mail, while the mail attachment and delivery logs restrict message deletion. R2 objects must never be removed as a side effect of a simple SQL row deletion.

**Not yet implemented:** creation APIs, mailbox ownership invariants, body rendering/sanitization, email storage lifecycle, async R2 replay, message search, attachment authorization, and outbound sending. The read-only `GET /api/mailboxes` route is available only to an authenticated administrator.

## Follow-up safeguards

- Pin Composer and npm dependencies using reviewed lockfiles, then build using locked dependencies.
- Implement and test actual authenticated create/read/update APIs and per-mailbox authorization rules.
- Configure encrypted off-host PostgreSQL backups and restore tests before storing real email.
- Never expose a public port for PostgreSQL, never place real credentials in GitHub, and do not alter production MX until R2 archival is tested.
