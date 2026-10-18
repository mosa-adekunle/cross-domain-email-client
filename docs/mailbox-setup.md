# Domain, mailbox, and message-list setup

This stage adds **authenticated setup records** to the existing PostgreSQL schema. The UI's Settings page can create domains and mailbox addresses, and the inbox, sent, drafts, and archive screens read metadata from their real database tables.

## Security and limitations

- Only logged-in administrators can list/create domains or mailboxes or list message metadata.
- Session-backed POST requests require Laravel's CSRF token and are throttled.
- Domain names are converted to lowercase IDNA ASCII form. Mailbox names support conservative, lowercase ASCII dot-atom addresses; full internationalized local parts are not yet supported.
- Domains are created with `verification_status=pending`, `is_active=false`. Mailboxes are created inactive even if the schema's default is true. Adding a record does not prove domain ownership or activate mail routing.
- Nothing changes Cloudflare DNS, Email Routing, Workers, R2, outbound SMTP, or MX records. No external mail will arrive until verified live integrations are built.
- The message listing API returns metadata only, not raw MIME, HTML bodies, or R2 attachments. Pagination is limited to 25 messages per page.
- No deletions or activation endpoints are exposed yet. The existing schema/migrations are reused; no new migrations are required.

## APIs (authenticated unless noted)

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/domains` | List saved domains and mailbox counts |
| POST | `/api/domains` | Add pending domain `{ "domain_name": "example.com" }` |
| GET | `/api/mailboxes` | List saved mailbox addresses and parent domain status |
| POST | `/api/mailboxes` | Add inactive mailbox `{ "mail_domain_id": 1, "local_part": "support", "display_name": "Support" }` |
| GET | `/api/messages?folder=inbox&mailbox_id=1&page=1` | Paginated read-only message metadata |

Allowed folders: `inbox`, `sent`, `drafts`, `archive`. `mailbox_id` is optional for a unified view.

## Deployment on cross-domain-email

```bash
cd ~/cross-domain-email-client
git pull --ff-only origin main
sudo docker compose config --quiet
sudo docker compose build api web
sudo docker compose up -d --no-deps --force-recreate api web
sudo docker compose exec -T api php artisan migrate --force
bash scripts/verify-mailbox-setup.sh
sudo docker compose ps
```

Use the existing SSH tunnel from your Mac (`ssh -N -L 8080:127.0.0.1:8080 cross-domain-email`) and open `http://127.0.0.1:8080`. Create a test domain you own in Settings, then a mailbox on that domain. Check the mailbox sidebar and empty inbox. Domain/mailbox records are persistent.

**Do not** run `docker compose down -v`. Docker volumes are not off-host backups, so configure encrypted backup/restore tests before actual mail ingestion. Leave public ports closed until HTTPS and full security tests are complete.
