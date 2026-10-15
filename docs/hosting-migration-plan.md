# EC2 to Lightsail migration plan

**Status:** Architecture plan, not yet tested or executed. Record actual verified commands separately as infrastructure work progresses.

## Goal

Begin on an EC2 `t4g.small` in AWS Ohio (`us-east-2`), using eligible T4g trial hours where available (AWS states 750 shared free compute hours per month through 2026-12-31). After the trial, move to a Lightsail Linux Micro **dual-stack IPv4 + IPv6** 1 GB bundle (currently listed at US$7/month) if load testing supports the smaller memory size. If the application does not fit, use the 2 GB bundle (currently US$12/month) or reconsider remaining on EC2. Trial eligibility, bundle availability, credits, and current pricing must be checked in the account before applying Terraform.

**Design objective:** No loss of acknowledged incoming mail or historical messages during migration, with a short, controlled window when the dashboard and outbound sending may be unavailable. No absolute zero-loss guarantee is possible without a tested restore and cutover procedure.

## Portable application architecture

- Keep the same Laravel API, React static build, PostgreSQL schema, and Docker Compose configuration on both hosts.
- Do **not** rely on cloning an EC2 EBS volume or AMI into Lightsail. AWS supports exporting Lightsail snapshots **to** EC2, but the reverse is not the migration method for this design.
- Keep deployment code in GitHub and production environment secrets outside Git.
- Make Docker builds portable across host CPU architectures. EC2 `t4g.small` is ARM64; verify the Lightsail instance architecture and rebuild images appropriately (or publish multi-platform images). Do not copy compiled architecture-specific binaries blindly.
- Store incoming raw RFC 5322 / MIME email, including attachments, durably in a **private Cloudflare R2 bucket** via a Cloudflare Email Worker **before acknowledging receipt**. R2 becomes the canonical raw-message archive, independent of the EC2/Lightsail host.
- PostgreSQL holds inbox views, domains and recipient identities, threads, message metadata, processed-R2-object identifiers, folders, drafts, sent-mail records, and per-mailbox preferences. Application ingestion must be idempotent, so replaying stored messages after an interruption does not duplicate them.
- Store non-email local uploads and necessary application-generated files in R2, or include them in the migration backup explicitly. Do not depend on undocumented files inside a Docker container.
- Keep Cloudflare MX records pointed to Cloudflare Email Routing through migration. Only the **dashboard/API hostname** needs a target change at cutover, where required.
- Create verified encrypted database backups and a separate off-host backup copy. Preserve required application encryption keys and provider settings securely to allow decryption after restore.
- Avoid auto-deleting raw email from R2 without a verified retention policy and backup. Restrict R2 permissions and verify object reads before switching.
- The outbound email provider is external to the instance, with a persistent sent-message ledger; pause outbound queues during migration to avoid duplicate sends.

## Terraform repository organization

```text
infrastructure/
  terraform/
    bootstrap/   # private state backend setup, if needed
    ec2/         # temporary hosting deployment and its own state
    lightsail/   # eventual target deployment, separate state
docs/
  hosting-migration-plan.md
  terraform-aws-deployment.md  # only tested instructions as work proceeds
```

The two Terraform roots/states must be independent. Destroying the old EC2 infrastructure must not delete the Lightsail instance, the private email archive, backups, Cloudflare domain configuration, or shared state storage. Set safeguards for persistent resources and never commit `.tfstate`, private `.tfvars`, secrets, email content, or raw backups to public GitHub.

## Migration runbook (to test before the trial expires)

1. **Before migration:** measure EC2 memory, database size, R2 footprint, mail volume, and backup restore duration. Check the latest AWS prices and available trial balance. Keep an extra safety window before 2026-12-31.
2. **Create target:** provision the dual-stack Lightsail Micro from the independent Terraform root. Configure Docker, HTTPS, private secrets, logging, storage integration, and minimal network exposure.
3. **Trial restoration:** restore a recent PostgreSQL backup on Lightsail and confirm Laravel migrations, email rendering, R2 attachment access, searches, login, and sending with a test identity. Measure real memory headroom on the 1 GB plan; switch to 2 GB if necessary.
4. **Enter controlled cutover:** temporarily put the old dashboard into read-only mode, stop outbound mail jobs, and stop backend ingestion that writes to PostgreSQL. **Leave the Cloudflare Worker receiving and durably storing raw messages in R2** during the transition.
5. **Final database capture:** create a transactionally consistent, encrypted PostgreSQL dump from EC2 after writes have stopped. Transfer securely; verify checksum; restore on Lightsail with the same database version compatibility/migrations and application encryption keys.
6. **Catch up inbound email:** replay unprocessed R2 objects idempotently and verify counts, message identifiers, status, and representative attachments. Confirm R2 access and mail processing on the target. Prevent two active database writers during cutover.
7. **Switch dashboard traffic:** change only the required Cloudflare-proxied dashboard/API origin or DNS target to Lightsail. Test HTTPS, login, multiple domains, inbound delivery, reply/send behavior, and bounces.
8. **Resume outbound:** once tests pass, enable outbound jobs on Lightsail, ensuring the old host remains disabled as a sender/worker.
9. **Rollback window:** preserve the old EC2 instance, database snapshot, and final backup until cutover is verified. If rollback is needed after live writes resume, reconcile messages and outbound status before redirecting traffic; never blindly restore older data over newer data.
10. **Finalize:** take post-cutover backups, verify restore capability, remove the EC2 host and associated billable resources via the EC2 Terraform root only after explicit confirmation, and record actual costs and tested commands.

## Budget notes

- EC2 `t4g.small`: eligible trial compute can be free through 2026-12-31, **but EBS, public IPv4, snapshots, and other resources can still cost money**; the 750-hour monthly trial allowance is shared across the account.
- Lightsail Micro dual-stack: AWS currently lists US$7/month for 1 GB RAM and 40 GB SSD; Lightsail Small dual-stack is US$12/month for 2 GB RAM.
- Cloudflare R2, backup copies, outgoing email delivery, domain names, and other services may incur charges depending on usage.
- Brief overlap of both servers during a safe migration is intentional and adds temporary cost. Do not optimize away the verification/rollback window.

## Validation requirement

Before calling this a successful zero-loss migration, deliberately test receiving new mail **while Laravel is offline**, restore from backup into a clean host, replay messages from R2, compare message counts and checksums, and verify that no message disappears or duplicates. Track the last processed cursor and audit all provider sending results.

## Sources

- AWS EC2 T4g free-trial FAQ: https://aws.amazon.com/ec2/faqs/
- Lightsail bundles: https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html
- Lightsail snapshot export direction: https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-faq-export-to-ec2.html
- Cloudflare email routing to Workers: https://developers.cloudflare.com/email-service/configuration/email-routing-addresses/
- Cloudflare R2 Workers API: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
