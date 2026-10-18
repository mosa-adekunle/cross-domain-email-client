# Cross Domain Email Client: application foundation (review proposal)

This is **proposed application code** for the existing repository. Do not commit it until it is reviewed and approved. It does not modify Terraform or AWS IAM resources.

## What this stage establishes

- PHP 8.4 with Laravel 13 framework and a single GET `/api/status` endpoint that checks the PostgreSQL connection without disclosing any secrets.
- React 19 + Vite 8 static frontend with working API status display and navigation shell; no sample real email.
- PostgreSQL 17 Alpine on a private Docker network, with persistent `postgres_data` Docker volume and health checks.
- Nginx serving the static frontend, forwarding `/api/` and `/up` internally to PHP-FPM.
- Web port bound to `127.0.0.1:8080` **only**. It is not available to unauthenticated Internet users.
- Random local `.env` secret generation; `.env` is ignored by Git and Docker build contexts.
- Intentional memory caps: db 512 MiB, api 768 MiB, web 128 MiB, suitable starting targets for the 2 GiB VM.

## Not yet implemented

No administrator authentication, actual inbox, email database schema, message ingestion, Cloudflare R2, sending provider, public access or TLS. The preview must remain SSH-tunnel-only until auth and HTTPS are implemented.

## Deployment sequence after code is approved and published to GitHub

On the existing **cross-domain-email** EC2 server only, from `~/cross-domain-email-client`:

```bash
git pull --ff-only origin main
bash scripts/init-env.sh
sudo docker compose config --quiet
sudo docker compose build api
sudo docker compose build web
sudo docker compose up -d
bash scripts/verify-foundation.sh
```

On your Mac, establish a secure tunnel using a **separate terminal**:

```bash
ssh -N -L 8080:127.0.0.1:8080 cross-domain-email
```

Then open `http://127.0.0.1:8080` locally. No public inbound firewall ports are required at this stage.

## Important development follow-ups

- Generate and commit `backend/composer.lock` and `frontend/package-lock.json` from a successful dependency resolution, then switch both builds to locked installs before treating builds as reproducible.
- Add automated tests, database migrations, single-admin authentication, production sessions, and rate limits **before exposing public HTTPS**.
- Add regular encrypted off-host PostgreSQL backups; Docker volumes alone are not backups.
- Never publish `.env`, Terraform state or keys; do not confuse `receiptboss-dev` (Terraform control host) with the actual application host.
- Complete Cloudflare R2 canonical mail archival before changing any production domain MX record.
