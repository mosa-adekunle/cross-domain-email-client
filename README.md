# Cross Domain Email Client

A self-hosted, cost-conscious email dashboard for sending, receiving, and managing messages across multiple custom domains without requiring Google Workspace or Microsoft 365 mailboxes.

> **Status (October 2026):** Laravel API, PostgreSQL, administrator authentication, HTTPS inbox, private Cloudflare Worker → R2 email archive and secure message reader are deployed. One-minute automatic sync is implemented in source and requires the deployment steps below.
>
> **Guiding principle:** Minimize recurring costs while maintaining secure access, reliable email delivery, and recoverable message storage.

## Overview

This project aims to provide one central dashboard for emails sent to and from several websites. For example:

- `support@domain-one.com`
- `info@domain-two.com`
- `billing@domain-three.com`

Rather than paying for a traditional mailbox for each address, the platform will provide inboxes and sender identities backed by an independently managed application.

Initially the application is for **one administrator**. Multi-user and shared inbox support may be added later, but will not drive upfront hosting costs or complexity.

## Planned features

- Manage multiple domains and email addresses in one dashboard.
- View a unified inbox or a specific domain/mailbox inbox.
- Compose, send, reply, and forward from each verified sending identity.
- Support To, CC, BCC, drafts, attachments, and Sent messages.
- Group related messages using standard email threading headers.
- Search and filter messages.
- Archive, trash, restore, and permanently delete messages.
- Basic spam quarantine and safe rendering of inbound email.
- Later: signatures, rules, notifications, staff access, website integrations, and optional AI assistance.

## Proposed architecture

| Component | Choice | Purpose |
| --- | --- | --- |
| Frontend | React | Unified inbox, composer, search, and settings |
| Backend | Laravel (PHP) | API, authentication, message processing, delivery, and jobs |
| Database | PostgreSQL | Domains, identities, messages, threads, users, and metadata |
| Incoming mail | Cloudflare Email Routing + Email Workers | Route mail from managed domains to the application |
| Raw email and attachments | Private Cloudflare R2 | Durable original MIME independent of EC2 |
| Sending | Pluggable SMTP/API provider | Send from verified domain identities |
| Deployment | Docker Compose, one host | Straightforward maintenance at minimal cost |

Possible outbound providers include Amazon SES, Resend, and Cloudflare Email Sending where availability, usage policy, and attachment limits fit the use case. The provider will be interchangeable so we can choose based on verified delivery suitability and costs.

```text
Custom domains
    |
    +-- Incoming: Cloudflare Email Routing + Worker
    |                 |
    |                 v
    |          Secure ingestion
    |                 |
    |                 v
    |          Laravel backend <----> PostgreSQL
    |                 |
    |                 +-------------> Raw emails / attachments
    |
    +-- Outgoing: Laravel backend ---> SMTP / email API provider
                          ^
                          |
                     React dashboard
```

**Cloudflare Email Routing is not a traditional hosted mailbox service.** The application will maintain its own mailbox records and message storage. We will test all domain MX changes, provider limitations, authentication requirements, and sending eligibility before activating mail for an important domain.

Incoming messages should be stored durably before acknowledging delivery and processed idempotently to prevent duplicates when a delivery is retried.

## Cost-first design rules

1. **One production environment only.** No staging server and no staging domain.
2. **Single administrator first.** Avoid building multi-tenant infrastructure until needed.
3. **Local development and tests.** Test before deploying changes to production.
4. **Reuse existing hosting when feasible.** Evaluate an existing AWS EC2 server before adding resources.
5. **Single Docker Compose deployment.** Avoid Kubernetes, load balancers, and unnecessary managed services.
6. **Self-host PostgreSQL at first.** Avoid separate database hosting fees unless justified.
7. **Choose storage and delivery providers by real usage.** Favor free allowances and low pay-as-you-go costs where reliable.
8. **Preserve essential safeguards.** Keep backups, authentication, secure configuration, migrations, and operational health checks.

**Cost objective:** The lowest practical *incremental* monthly cost. Zero recurring costs are not guaranteed; evaluate compute, storage, email sending, and backups before deployment.

## Roadmap

### Phase 1: Core single-user email client

- [ ] Initialize Laravel, React, PostgreSQL, and Docker Compose.
- [ ] Add single-admin authentication and secure configuration management.
- [ ] Design tables for domains, mailboxes, identities, messages, threads, attachments, and delivery records.
- [ ] Add domain registration/verification and mailbox identity management.
- [ ] Implement Cloudflare inbound routing and secure email ingestion.
- [ ] Store messages and attachments privately and reliably.
- [ ] Build unified inbox, per-mailbox views, message reader, and search.
- [ ] Build composer, drafts, replies, forwards, attachments, CC, and BCC.
- [ ] Implement outbound sending through a replaceable provider interface.
- [ ] Add standard conversation threading, Sent, Archive, Trash, and basic spam handling.
- [ ] Configure SPF, DKIM, DMARC, delivery logging, and bounce/error tracking.
- [ ] Implement backups, restore testing, and basic server monitoring.
- [ ] Deploy to the single production host.

### Phase 2: Productivity and mailbox management

- [ ] Per-identity signatures and mailbox preferences.
- [ ] Labels, filters, rules, and notifications.
- [ ] Improved spam detection, message auditing, and delivery diagnostics.
- [ ] Shared inboxes and scoped staff permissions if additional users are added.

### Phase 3: Website integrations and automation

- [ ] Integrate website forms and support workflows.
- [ ] Optional email-to-ticket features and automated categorization.
- [ ] Optional AI-assisted email summaries and reply drafts.
- [ ] Consider IMAP compatibility only if external mail clients are needed.

## Hosting plan and migration strategy (October 2026)

Our cost-first strategy is to **start on AWS EC2 `t4g.small` (2 GB RAM) during eligible free-trial compute hours through December 31, 2026**, then compare hosting costs across **AWS Lightsail, Microsoft Azure, and Google Cloud**. Lightsail Micro, dual-stack IPv4 + IPv6 (1 GB RAM, currently US$7/month), is a possible destination **only if performance tests confirm it is sufficient**. The destination will be selected by total recurring cost, compatibility, and reliability, not provider loyalty.

- **Separate infrastructure:** Terraform configurations and state for EC2 and Lightsail must stay independent of ReceiptBoss and one another.
- **Portable app:** Run the same Laravel, React, PostgreSQL, and Docker Compose deployment on either platform; accommodate ARM64 versus the target server architecture.
- **Durable mail:** Cloudflare Email Routing/Worker archives incoming raw email to private R2 before acknowledgment. PostgreSQL stores metadata and can replay unprocessed R2 messages idempotently.
- **Data-safe migration:** Run verified off-host backups and a controlled, read-only database transfer. Keep receiving email through Cloudflare during a short application cutover window, verify the restore and replay, then switch the dashboard origin.
- **No early EC2 deletion:** Keep the source host and its backups until the destination is verified.
- **Budget:** Trial EC2 compute may be free within the shared allowance, but EBS, public IPv4, backups, R2, and outbound email can incur charges.

See the [cloud portability requirements](docs/cloud-portability.md) and [EC2-to-Lightsail migration design](docs/hosting-migration-plan.md) for our deployment constraints and migration procedure. **This is an intended deployment sequence, not a completed migration or guarantee of zero downtime/data loss.** All provider costs and trial usage will be verified before any `terraform apply`.

## Suggested repository structure

```text
cross-domain-email-client/
├── backend/             # Laravel API
├── frontend/            # React dashboard
├── docker/              # Docker-related files
├── compose.yaml         # Single-host application services
├── .env.example         # Safe, non-secret configuration template
├── .gitignore           # Exclude credentials and runtime data
└── README.md
```

This layout is **planned**, not yet created.

## Security and privacy

The source repository is public, but email data, configuration, and credentials must remain private.

- Never commit `.env`, API credentials, database passwords, private keys, raw emails, or backups.
- Use authenticated and authorized backend endpoints, secure sessions, and strong administrator credentials; use MFA when practical.
- Verify inbound integration requests and prevent unauthorized email ingestion.
- Treat inbound messages, HTML, and attachments as untrusted; sanitize content and block active scripts.
- Store attachments privately; limit message sizes and processing rates.
- Configure SPF, DKIM, and DMARC for outbound domains.
- Use HTTPS, scoped service credentials, audit logs, and automated off-host backups.
- Test recovery and deployment rollback procedures.

## Development and deployment approach

Develop locally, store code in GitHub, test changes, then deploy to the **single production environment**. Production should support controlled Laravel migrations, application/container restarts, health checks, and recovery. No separate staging infrastructure is planned.

## Deployed AWS infrastructure, Terraform, and IAM (verified October 18, 2026)

The **single production EC2 server is provisioned** with Docker Engine, Laravel, React, PostgreSQL, HTTPS and Cloudflare R2 inbound archiving. As of October 20, 2026, three historical test emails were imported successfully. Automatic synchronization is implemented in source and requires the systemd timer installation and Worker update documented below. The project uses a single production server and keeps its raw-email archive independent of the VM for migration and recovery.

### Live AWS deployment

| Component | Deployed configuration |
| --- | --- |
| Account and region | `234768038939`, `us-east-2` (Ohio) |
| EC2 | `i-0cdc14756641487d3`, `t4g.small` (ARM64, 2 vCPU, 2 GiB memory) |
| AMI and OS | Ubuntu 24.04.5 LTS (`aarch64`); Terraform selects latest Canonical Ubuntu 24.04 arm64 AMI |
| Storage | Encrypted 16 GiB gp3 EBS root volume; `delete_on_termination = true` |
| VPC / subnet | Default VPC `vpc-07aaea246f8683096`; subnet `subnet-0285d94b63fcf8219`; private IP `172.31.2.3` |
| Elastic IP | `52.14.33.209`, allocation `eipalloc-06b4ed2019474dcb3` |
| Security group | `sg-04b2fdedc5edcff95`; inbound TCP/22 from `0.0.0.0/0`, all IPv4 outbound |
| HTTP/HTTPS | Public HTTPS/443 is enabled; HTTP/80, port 8080 and PostgreSQL/5432 remain private |
| SSH | From a Mac: `ssh cross-domain-email`; private key remains on the Mac at `~/.ssh/cross-domain-email` |
| Docker | Engine 29.9.1, Compose v5.6.0, successful ARM64 `hello-world` verification |
| Terraform execution host | Existing `receiptboss-dev` EC2 VM (runner only); **not** the application host |

The existing open-to-world SSH rule is documented, **not recommended as the final firewall configuration**. Narrow it to trusted sources or use SSM when access patterns allow. Neither `receiptboss-dev` nor the email application server should be used as an alternative Terraform backend without explicitly initializing and verifying the existing remote state.

### Checked-in source and remote Terraform state

The following Terraform source directories are proposed for the public GitHub repository after review:

- [`infrastructure/terraform/bootstrap/`](infrastructure/terraform/bootstrap/) provisions the private, versioned, SSE-S3 `AES256` state bucket, public-access blocking, HTTPS-only bucket policy, and `prevent_destroy` protection.
- [`infrastructure/terraform/aws-ec2/`](infrastructure/terraform/aws-ec2/) defines the EC2 instance, ED25519 SSH key resource, security group/rules, and Elastic IP. It uses the existing default VPC and a Canonical Ubuntu 24.04 ARM64 AMI data source.
- [`infrastructure/iam/role/`](infrastructure/iam/role/) contains **exported snapshots** of the IAM trust document and five currently configured inline policy JSON documents. These files document existing AWS IAM configuration. **They are not yet managed by Terraform**, and editing a JSON snapshot does not alter permissions in AWS.

Terraform runtime on the original runner was `1.16.6`; root configurations require `>= 1.10.0, < 2.0.0` and `hashicorp/aws ~> 6.0`. The exported source did not include `.terraform.lock.hcl`, `admin-ssh.pub`, or backend initialization arguments. Preserve the original private inputs and copy reviewed provider lock files separately before running Terraform from a different host.

| State concern | Live configuration |
| --- | --- |
| S3 bucket | `cdec-tfstate-234768038939-us-east-2` |
| State region | `us-east-2` |
| Bootstrap state key | `bootstrap/terraform.tfstate` |
| EC2 state key | `cross-domain-email/aws-ec2/terraform.tfstate` |
| Locking | S3 lock file: `use_lockfile = true` |
| State safeguards | S3 versioning, SSE-S3, block public access, deny non-TLS, `force_destroy = false`, `prevent_destroy = true` |

The application EC2 instance has:

```hcl
associate_public_ip_address = false

lifecycle {
  prevent_destroy = true
  ignore_changes  = [ami, associate_public_ip_address]
}
```

The `ignore_changes` on `associate_public_ip_address` resolves an AWS provider drift after attaching the separately managed Elastic IP without replacing the live instance. Keep the lifecycle protection intact. EC2 CPU credits are `standard`; IMDSv2 is required; cloud-init disables root login, password authentication, and keyboard-interactive authentication. `terraform validate` succeeded and the last `terraform plan` reported **No changes**.

**Safety:** State, lock files, private keys, `.tfvars`, generated plans, `backend.hcl`, application `.env`, credentials, backups, and raw email never belong in public GitHub. The original `admin-ssh.pub` input is runner-local, and **must not be silently replaced** with the dedicated key installed later through EC2 Instance Connect; a key-pair input change can trigger unwanted infrastructure replacement. Verify the original S3 backend before any plan or apply and do not remove `prevent_destroy`.

The existing Terraform runner uses:

```bash
ssh receiptboss-dev
cd ~/cross-domain-email-client/infrastructure/terraform/aws-ec2
export AWS_PROFILE=cross-domain-email-terraform
aws sts get-caller-identity
terraform fmt -check
terraform validate
terraform plan
```

Application access is separately via `ssh cross-domain-email`. Do not install application containers on `receiptboss-dev`.

### AWS IAM role and exact policies (exported October 18, 2026)

The role `arn:aws:iam::234768038939:role/cross-domain-email-terraform-role` is assumed from `receiptboss-dev` using AWS CLI profile `cross-domain-email-terraform`. The **live exported trust policy** allows only principal `arn:aws:iam::234768038939:role/receiptboss-dev-ec2-role` to call `sts:AssumeRole`; see [`trust-policy.json`](infrastructure/iam/role/trust-policy.json).

All **five** exported policies are **inline policies on that role**, and AWS returned **no attached managed policies**. The policy documents below are the exact exported JSON snapshots, not guessed replacements:

| Inline policy | Verified permissions summary |
| --- | --- |
| [`cross-domain-email-terraform-rolePolicy`](infrastructure/iam/role/cross-domain-email-terraform-rolePolicy.json) | EC2 resource-discovery `Describe*` actions for VPC, instances, images, subnets, networking, key pairs, EBS volumes, and related attributes |
| [`CrossDomainEmailEC2Provisioning`](infrastructure/iam/role/CrossDomainEmailEC2Provisioning.json) | Region-scoped EC2 discovery; allowed project-tagged `t4g.small` instance and network/key/EBS resources; security-group and SG-rule changes; tags; Elastic IP allocation/association; project instance/volume management |
| [`CrossDomainEmailIAMPolicyReadOnly`](infrastructure/iam/role/CrossDomainEmailIAMPolicyReadOnly.json) | Inspect own IAM role/trust and inline/attached policy lists and definitions; read account/AWS managed-policy documents |
| [`CrossDomainEmailInstanceConnect`](infrastructure/iam/role/CrossDomainEmailInstanceConnect.json) | `ec2-instance-connect:SendSSHPublicKey` limited to instance `i-0cdc14756641487d3`, OS user `ubuntu` |
| [`CrossDomainEmailTerraformS3Access`](infrastructure/iam/role/CrossDomainEmailTerraformS3Access.json) | Access only the Terraform state bucket; object get/put and `.tflock` deletion for S3 backend locking |

**Access scope cautions:** Some discovery calls use `Resource: "*"`; EC2 write access is restricted through combinations of ARNs, project resource/request tags, allowed instance type, and region, as specified in the actual JSON. The provisioning policy's `ec2:RunInstances` image ARN is pinned to the original AMI, so rebuilding with a newer Canonical AMI may require a reviewed IAM update. Some actions can allow management or deletion of project resources even though Terraform's `prevent_destroy` blocks Terraform-managed destruction; IAM itself does not enforce that Terraform lifecycle safeguard. Review the exported policies and applicable AWS account boundaries before treating them as a security guarantee.

The IAM policy JSON files are **documentation snapshots** and should not be fed blindly into `terraform apply`. Avoid embedding AWS credentials or SSH private keys in the repository. Role inspection completed without `AccessDenied` after adding `CrossDomainEmailIAMPolicyReadOnly`.

### Project and publication workflow

The repository is currently public. Push approved project changes to GitHub and provide deployment commands. The Laravel, React, and PostgreSQL foundation is deployed on its own EC2 server. IAM role resources are documented but are not managed by this Terraform source; publishing source files does not itself provision additional cloud resources.

## Direct EC2-IP HTTPS

The application can be published directly at **https://52.14.33.209** on TCP/443 with a publicly trusted six-day Let's Encrypt IP certificate, using Terraform-managed AWS ingress, Nginx TLS termination, and automatic certificate renewal. It does **not** require Cloudflare Tunnel, DNS, or publicly exposed HTTP/80. The web app remains protected by administrator login, while PostgreSQL is private.

For the **required deployment sequence and renewal setup**, see [Direct IP HTTPS deployment](docs/direct-ip-https.md). Changes are committed to GitHub, but the Terraform ingress rule and EC2 web configuration require separate deployment; merely merging this code does not make the public URL live.

## License

No open-source license has been selected yet. Public source visibility does not itself grant permission for unrestricted reuse, modification, or redistribution.


### Reading archived email

The authenticated inbox now opens an individual message when its row is clicked, with a back button and browser history. Laravel fetches the original MIME from private R2 on demand, parses its safe text body and headers, and marks the message read via a CSRF-protected request. The original MIME and attachments stay private in R2. HTML-only messages are converted to plain text; HTML rendering and attachment downloads are not yet supported.

No migration or re-import is required. On the Cross Domain Email Client EC2 host, run: git pull --ff-only origin main; sudo docker compose build api web; sudo docker compose up -d --no-deps --force-recreate api web; then verify the new routes and HTTPS inbox.


## Automatic R2 synchronization (October 2026)

The [one-minute R2 synchronization guide](docs/automatic-r2-sync.md) documents a checkpointed incremental importer, daily full reconciliation for old and late objects, persistent retry queue with exponential backoff, PostgreSQL advisory locking, and EC2 systemd timers. It includes the exact app-EC2 deploy/install/rollback commands, Cloudflare Worker and read-only R2 token permissions, and the division of responsibilities between the existing AWS Terraform runner and Cloudflare. This is an **app/runtime deployment**, not a Terraform infrastructure change: AWS security groups, IAM role permissions, S3 state, and existing routing rules should not be modified. The new ordered Worker archive keys require deploying the updated Worker before enabling the one-minute timer.


## Received-email attachments

[View and download archived attachments](docs/attachments.md) adds a private, authenticated attachment list to the email reader. Previously imported `.eml` files are parsed on demand from Cloudflare R2; JPG/PNG/GIF/WebP images, PDFs and safe text can be previewed, and all supported MIME parts can be downloaded without a database migration. HTML and arbitrary binary attachments are download-only. No Terraform/IAM/Worker changes are necessary for this app-only deployment.


### Browser attachment preview compatibility

PDFs are rendered locally with [Mozilla PDF.js](https://mozilla.github.io/pdf.js/) instead of Chrome's sandboxed iframe-based PDF plugin. Image previews use validated `blob:` image URLs permitted by the narrowly scoped Nginx `img-src` policy; `object-src` and `frame-src` remain disabled. See [attachments](docs/attachments.md) for the app-only web deployment and troubleshooting steps.
