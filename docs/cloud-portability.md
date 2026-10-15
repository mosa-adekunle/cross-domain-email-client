# Cloud portability and cost-first hosting

**Status:** Project architecture requirement, established October 2026. This document describes design constraints, not a completed implementation or migration.

## Requirement

Cross Domain Email Client must remain deployable on **AWS, Microsoft Azure, Google Cloud, or another standard Linux VM** without rewriting core application code or email data formats. The hosting provider should be chosen by the **total real monthly cost** at the time of deployment: compute, disk, public IP, bandwidth/egress, backups, taxes, and any billable supporting services, rather than provider loyalty.

The initial plan is AWS EC2 `t4g.small` with applicable trial compute hours, followed by a potential move to Lightsail. **Lightsail is an option, not a commitment:** the destination may instead be Azure or Google Cloud if a better cost/reliability tradeoff is available.

## Provider-neutral application layer

- **Laravel API, React frontend, PostgreSQL, Docker Compose** on a single Linux host for the initial single-user workload. Deploy the same versioned application on any destination VM.
- Use published Docker image architecture(s) appropriate to the target, e.g., `linux/arm64` for Graviton and `linux/amd64` if a destination VM is x86. Prefer multi-platform images or reproducible source builds; never depend on copying an architecture-specific container image.
- Store every durable email message's original raw MIME in **private Cloudflare R2**, independent of the app VM. Keep attachments there or in another provider-neutral object-storage abstraction. Do not lose data when the VM changes.
- Keep **PostgreSQL schema/migrations and logical backups** portable; don't use a database feature without confirming availability on a self-hosted PostgreSQL instance elsewhere.
- Use standard HTTP(S), SMTP/API, and S3-compatible object storage interfaces. Keep vendor API usage in replaceable adapters instead of embedding it throughout the application.
- Use a configurable outbound-mail provider (e.g., SMTP or API) rather than requiring SES or any other cloud-specific mail service; all domains must retain SPF/DKIM/DMARC configuration during changes.
- Keep website mail receiving at **Cloudflare Email Routing + Worker** and persist messages before acknowledgment, so inbound receipt doesn't depend on whether the current application host is available. Process raw messages idempotently on the active backend.
- Maintain environment-specific configuration outside public GitHub. Preserve Laravel encryption keys, application secrets, database credentials, and provider credentials through secure, separate backup/secret handling.
- Use basic stdout/container logs and lightweight health checks. Vendor monitoring is optional, not required for application correctness.
- Avoid hard dependencies on AWS IAM identities, EBS snapshots, EC2 instance metadata, AWS-only queue services, Amazon RDS, or AWS-specific file paths in Laravel code. Cloud provider identity and firewall controls may differ in infrastructure modules, which is expected.

## Infrastructure as code

Terraform infrastructure will be **separated by provider/target**. It should provision VM, disks, network/security rules, and relevant configuration without entangling application data with one provider.

Proposed layout (create as needed, not all at once):

```text
infrastructure/terraform/
  aws-ec2/
  aws-lightsail/
  azure-vm/
  google-compute/
deploy/
  compose.yaml
  scripts/
docs/
  cloud-portability.md
  hosting-migration-plan.md
  terraform-aws-deployment.md
```

Only add Azure and Google Cloud Terraform code **when evaluating or actually provisioning there**; avoid complexity or paid resources before then. Each target must have **independent state** stored privately. Terraform backend location is a management concern, not a dependency of the application; an AWS S3 state backend for AWS hosting does not lock Laravel/PostgreSQL into AWS. Never commit state files, local secrets, plans containing sensitive values, or production email content.

## Data migration checklist (between any two providers)

1. Review actual target VM cost, CPU architecture, minimum usable RAM, disk capacity, transfer costs, public IPv4/IPv6, and API/provider accessibility.
2. Deploy a new target from the same GitHub commit/containers and Terraform root, using independently provided secrets.
3. Perform a **test restore** of a PostgreSQL backup, verify schema/migrations, decryptability, sample messages and attachments, and memory performance.
4. Keep Cloudflare receiving into R2. Pause active application database writes and outbound processing before a final consistent logical PostgreSQL backup.
5. Restore the final database backup and any non-R2 durable files; validate backup checksums. Start exactly one active database writer.
6. Replay pending R2 emails idempotently; compare counts and identifiers, check representative attachments, and verify that messages received during downtime are visible.
7. Point the public dashboard/API hostname or Cloudflare proxy at the new origin. Verify login, search, replies, sending identity, inbound/outbound delivery, TLS, and error reporting.
8. Retain the source VM and backups during a short rollback verification window. Reconcile new messages and outbound delivery before any rollback.
9. After explicit signoff, destroy the former provider's billable VM/disks/IPs while **retaining** R2, backups, and state per their separate lifecycle policies.

**Reliability:** Design for **no acknowledged message loss** with durable inbound archival and controlled cutover. Don't claim guaranteed zero loss/downtime until failure, replay, and restore drills have passed. Brief dashboard/outbound downtime may be acceptable for a single user.

## Cost policy

- Avoid continuous staging, load balancers, managed databases, Kubernetes, and high-cost networking for the initial single-user workload.
- Compare the **all-in monthly bill** (including egress and public IPs), not just the listed VM price.
- Track real measurements: CPU, RAM, disk, email volume, and storage usage before upgrading or moving.
- Remain free to **start on EC2, migrate to Lightsail, Azure, Google Cloud, or move again later** without losing access to historical mail.
