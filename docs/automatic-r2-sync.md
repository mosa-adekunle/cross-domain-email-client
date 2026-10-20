# Automatic R2-to-PostgreSQL synchronization

## Design and guarantees

Cloudflare Email Routing → existing Email Worker → **private R2** (original RFC 5322 MIME) → EC2 Laravel importer → PostgreSQL → authenticated inbox. The R2 original is never deleted by the importer.

New messages use sortable object keys: ~~~incoming/v2/YYYY/MM/DD/YYYYMMDDHHmmssSSS-UUID.eml~~~. Older archived UUID keys remain under ~~~incoming/YYYY/MM/DD/UUID.eml~~~ and are not renamed. The incremental job calls S3-compatible ListObjectsV2 with Prefix=incoming/v2/ and StartAfter set to the durable PostgreSQL checkpoint. It downloads only unprocessed objects.

Every minute a systemd timer invokes Laravel in the running api Docker Compose container. An independent daily timer performs full reconciliation of incoming/ (both legacy and v2). A late completion with an earlier sort key may be delayed until the daily scan. Both jobs and manual imports share one PostgreSQL advisory lock, so overlapping runs do not interfere.

The new r2_sync_checkpoints table stores the incremental last_object_key, last_poll_at, and last_reconcile_at. The new r2_import_retries table durably records failed object identities, keys, sanitized exception types, attempt counts, and next_attempt_at (exponential delay starting at 60 seconds, capped at 1 hour). The importer advances the cursor only after successfully importing or durably queuing a failure; an untracked failure aborts the job and leaves the checkpoint behind. R2 remains the recovery source; imported messages use existing database uniqueness constraints.

## Cloudflare setup and minimum permissions

- Account ID: 48dfb24066b584a497e26f6fdb1c222d. Bucket: cdec-inbound-mail (private); Worker: cdec-inbound-archive. Binding MAIL_ARCHIVE → that bucket. Variable ALLOWED_RECIPIENTS → inbox-test@receiptboss.ca. No bucket public access, dev URL, or catch-all is needed.
- The Cloudflare **Worker deployment token** is different from the R2 S3 API credentials. For an existing Worker, grant a Workers **Editor** role scoped to cdec-inbound-archive (Admin is for creating Workers). Workers Routes Write on the receiptboss.ca zone is only needed when creating/changing zone routes; account/binding read permissions may be required by Wrangler. A Worker R2 binding does not need a stored access key. Avoid broad Admin scope.
- On Cloudflare R2 → Overview → Manage API tokens, create **Object Read only** scoped only to cdec-inbound-mail, and securely capture its Access Key ID and Secret Access Key. Those two R2 S3 values, along with R2_ACCOUNT_ID and R2_BUCKET=cdec-inbound-mail, belong only in the application EC2 .env file (mode 0600). They are NOT the Cloudflare cfat_ deployment token. Docker Compose injects them into the api container; never copy secrets to GitHub, Terraform state, Worker source, shell history or logs.
- Cloudflare Email Routing → receiptboss.ca → Routing rules: inbox-test@receiptboss.ca must be active with action Send to Worker → cdec-inbound-archive. Leave support/privacy/legal Gmail forwarding unchanged. MX/DKIM/SPF configuration does not need edits for this synchronization feature.
- For the new ordered key format, deploy the updated source at workers/email-archive/src/index.js with Wrangler and a properly scoped deployment token, or use Cloudflare → Workers & Pages → cdec-inbound-archive → Edit code → Deploy when AWS browser terminal paste is unreliable. Preserve the R2 binding and allowlist. Verify a new email writes to incoming/v2/ in the private bucket; old incoming/YYYY/ keys are expected to remain.

Cloudflare references: https://developers.cloudflare.com/r2/api/tokens/ ; https://developers.cloudflare.com/r2/api/s3/api/ ; https://developers.cloudflare.com/workers/authorization/workers/ .

## Deploy on the *application* EC2 host (not receiptboss-dev)

~~~bash
cd ~/cross-domain-email-client
git pull --ff-only origin main
git rev-parse --short HEAD
sudo docker compose config --quiet
sudo docker compose build api
sudo docker compose up -d --no-deps --force-recreate api
sudo docker compose exec -T api php artisan migrate --force
sudo docker compose exec -T api php artisan migrate:status
sudo docker compose exec -T api php artisan mail:sync-r2 --mode=reconcile --limit=500
~~~

Deploy the updated Worker (as above) **before enabling the one-minute timer**; otherwise legacy-keyed emails are discovered by the daily reconciliation, not the fast incremental stream.

~~~bash
cd ~/cross-domain-email-client
sudo install -m 0644 systemd/cdec-r2-incremental.service /etc/systemd/system/
sudo install -m 0644 systemd/cdec-r2-incremental.timer /etc/systemd/system/
sudo install -m 0644 systemd/cdec-r2-reconcile.service /etc/systemd/system/
sudo install -m 0644 systemd/cdec-r2-reconcile.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cdec-r2-incremental.timer cdec-r2-reconcile.timer
systemctl list-timers 'cdec-r2-*'
sudo systemctl start cdec-r2-incremental.service
sudo journalctl -u cdec-r2-incremental.service --no-pager -n 40
~~~

The incremental timer runs every minute, and full reconciliation daily at 03:20 UTC. The root-owned systemd units access only the local Docker socket; Laravel remains in the existing api container, and PostgreSQL stays private. If api is restarting or R2 cannot be listed, that run fails visibly in journald and later runs retry. No new open ports, Redis, extra EC2 or managed scheduler are required.

## Status and recovery

~~~bash
cd ~/cross-domain-email-client
sudo docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT name,last_poll_at,last_reconcile_at FROM r2_sync_checkpoints"'
sudo docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT count(*) AS pending_retries,min(next_attempt_at) FROM r2_import_retries"'
sudo docker compose exec -T api php artisan mail:sync-r2 --mode=incremental --limit=100
sudo docker compose exec -T api php artisan mail:sync-r2 --mode=reconcile --limit=500
sudo systemctl status cdec-r2-incremental.timer cdec-r2-reconcile.timer --no-pager
sudo journalctl -u cdec-r2-reconcile.service --no-pager -n 40
~~~

Rollback automation without deleting data: sudo systemctl disable --now cdec-r2-incremental.timer cdec-r2-reconcile.timer. The saved checkpoint, retry ledger, PostgreSQL messages, and private R2 objects remain intact. Never reset state or drop tables merely to correct a transient mail failure. For a historical recovery, run --mode=reconcile manually.

## AWS Terraform and IAM

The current app EC2 i-0cdc14756641487d3 is t4g.small in us-east-2, with Elastic IP 52.14.33.209. Existing Terraform already manages the EIP, security group, SSH/HTTPS ingress, outbound IPv4 connectivity and encrypted EBS. **Automatic R2 polling requires no new AWS resources, security-group rules, IAM permissions or Terraform apply.** Cloudflare R2 S3 credentials are independent from AWS IAM S3 permissions. Do not give this EC2 instance AWS administrative permissions to run the poller.

Terraform runs from the separate receiptboss-dev **runner only**, with the existing cross-domain-email-terraform role and its committed IAM policy snapshots (documentation-only):

~~~bash
ssh receiptboss-dev
cd ~/cross-domain-email-client/infrastructure/terraform/aws-ec2
export AWS_PROFILE=cross-domain-email-terraform
aws sts get-caller-identity
terraform validate
terraform plan
~~~

Expected for these in-guest systemd/application changes: **No changes**. Do not remove prevent_destroy or ignore_changes=[ami,associate_public_ip_address], reapply stale plans, replace the EC2 instance, or commit local .tfvars, backend.hcl, Terraform state, keys or secrets. Remote state is the versioned/private cdec-tfstate-234768038939-us-east-2 S3 bucket with lockfile support. Existing IAM exports reside in infrastructure/iam/role/ and are not automatically applied by Terraform.

## Resource usage

An empty R2 check once per minute makes approximately **43,200 ListObjectsV2 requests in 30 days**. Listings are Class A R2 operations; daily reconciliation adds roughly one page per 200 archived objects. The Laravel job briefly uses EC2 CPU and the existing database. Costs depend on the Cloudflare account's shared allowances, object count, retry volume and real AWS compute-credit usage. At large volumes, replace daily full scans with date-sharded reconciliation or an event-driven durable queue.