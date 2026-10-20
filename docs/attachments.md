# Viewing and downloading received email attachments

Implementation: authenticated React message reader + Laravel attachment endpoint backed by existing **private** Cloudflare R2 raw RFC 5322 messages. It reads MIME attachment parts from the archived email itself, so **previously imported emails work without a database migration or re-import**.

## How to use

1. Sign in at https://52.14.33.209 and open a message in the Unified inbox.
2. An **Attachments** section appears when that email has MIME attachment parts. Each entry shows the filename, declared MIME type and size when available.
3. Click **Preview** to inspect supported files in a private overlay; click **Download** to save the original decoded bytes. PDFs are rendered with Mozilla PDF.js into a canvas; the viewer supports page navigation and zoom. It does not embed PDFs in an iframe or depend on a browser PDF extension. The attachment section is also shown when the message has no readable text body.

Inline previews are restricted to JPG, PNG, GIF, WebP, PDF with a matching file signature, and valid UTF-8 plain text/CSV/JSON up to 1 MiB. HTML, SVG, executable files, Office documents, ZIPs and other untrusted formats are **download-only**. Treat all received files as potentially malicious even when their MIME type looks harmless.

## Privacy and security

- Routes are nested under Laravel's existing **auth:web** middleware. `GET /api/messages/{id}` returns metadata plus attachment descriptors. `GET /api/messages/{id}/attachments/{index}` downloads the selected MIME attachment; add `?preview=1` to request a restricted preview.
- Requests never accept client-selected R2 bucket, object key, path or filename. Laravel looks up the authorized, non-deleted message in PostgreSQL, retrieves its original MIME through the existing R2 read-only credentials, and selects the attachment by server-computed zero-based part index.
- Raw MIME remains in private R2. No new objects, presigned public URLs or separate attachment buckets are created. No R2 write/delete scope is needed. The API does not forward raw MIME to the browser.
- HTML or arbitrary files are always served as `application/octet-stream` with forced `attachment` disposition. Validated previews use the original file bytes with a strictly controlled content type. Responses include `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, `Cross-Origin-Resource-Policy: same-origin`, and no-referrer headers. React renders text in an escaped `<pre>`; it never injects email attachment HTML.
- Attachment filenames are sanitized to avoid directory traversal, CR/LF header injection and bidirectional Unicode overrides. MIME binary streams are decoded using the parser without text charset conversion. Maximum decoded attachment size is 25 MiB; maximum MIME size is controlled by existing `mailarchive.max_bytes`. The metadata list is capped at 100 attachment parts.
- Errors give generic responses while the backend reports retrieval failures privately. Attachment GETs are rate-limited to 60 per minute.

## Deployment on the Cross Domain Email application EC2 host

```bash
cd ~/cross-domain-email-client
git pull --ff-only origin main
git rev-parse --short HEAD
sudo docker compose config --quiet
sudo docker compose build api web
sudo docker compose up -d --no-deps --force-recreate api web
sudo docker compose exec -T api php artisan route:list --path=api/messages
sudo docker compose exec -T api php tests/attachment-smoke.php
bash scripts/verify-ip-https.sh
sudo docker compose ps
```

Open the existing **Attachment Test** email (`message=4`) and verify that its attachment appears. Test both **Preview** (image/PDF/text) and **Download**. Other file formats intentionally offer Download only. If the email has only attachments, the body may say there is no readable text; that is normal.

No schema migration, Cloudflare Worker redeployment, DNS change, AWS Terraform apply, IAM permission change, or extra public port is required. The EC2 API already uses the separate read/list-only Cloudflare R2 credentials in its private `.env`. Do not confuse these with the Cloudflare Worker deployment token. Terraform is managed separately from the `receiptboss-dev` runner; this is application-only code.

## Limitations

- Attachment previews are not antivirus scanning or a guarantee of safe content.
- PDFs use a lazy-loaded, pinned pdfjs-dist dependency and same-origin Web Worker. PDF.js processes authenticated bytes in-memory (without fetching external assets or exposing R2 credentials). The PDF parser runs with JavaScript evaluation disabled and a bounded canvas raster size. The existing browser PDF iframe was blocked by the application's CSP and iframe sandbox, so it is no longer used.
- Nginx CSP remains restrictive: `object-src 'none'`, `frame-src 'none'`, `worker-src 'self'`; the necessary `blob:` exception is limited to `img-src` for in-memory validated images. No third-party document viewer or public Cloudflare R2 URLs are enabled.
- For security, arbitrary HTML, SVG and office documents are not rendered inside the authenticated origin. Download them and open with appropriate software after checking the sender.
- Large attachments are decoded on demand from the original email; the UI does not cache attachments, and refreshing the reader may fetch the original archived MIME again. For very large mail volumes or shared users, migrate to per-file indexes and dedicated authorized storage endpoints.

PHP MIME parser method references: https://mail-mime-parser.org/api/4.0/classes/ZBateson-MailMimeParser-Message.html and https://mail-mime-parser.org/api/4.0/classes/ZBateson-MailMimeParser-Message-IMessagePart.html .
## PDF/image preview repair (October 20, 2026)

An original PDF preview used an embedded `<iframe sandbox="allow-downloads">` pointing to an in-memory `blob:` URL. Chrome displayed **"This content is blocked"**, since the site CSP allows only same-origin frames and the PDF plugin is incompatible with that restrictive iframe sandbox. The replacement **PDF.js canvas viewer** eliminates the iframe and preserves the CSP restrictions on embedded content. Nginx also adds `blob:` only to `img-src` to enable safe image blob previews. The PDF worker is served from the same application origin through Vite-generated assets (no third-party request).

**Deploy only the web image** (API, PostgreSQL, Cloudflare Workers and Terraform are unchanged):

```bash
cd ~/cross-domain-email-client
git pull --ff-only origin main
sudo docker compose config --quiet
sudo docker compose build web
sudo docker compose up -d --no-deps --force-recreate web
bash scripts/verify-ip-https.sh
sudo docker compose ps
```

Then hard-refresh `https://52.14.33.209/?message=4` and click **Preview** beside `dcc.pdf` and the JPG. PDF navigation uses **Previous/Next** and zoom +/- buttons. If a malformed PDF cannot be rendered, **Download PDF** remains available from the same modal. In Chrome DevTools → Network, verify the PDF worker is loaded from `/assets/`, not from another domain. In DevTools → Console, there should be no Content Security Policy errors for attachment previews.
