# Cross Domain Email Client

A self-hosted, cost-conscious email dashboard for sending, receiving, and managing messages across multiple custom domains without requiring Google Workspace or Microsoft 365 mailboxes.

> **Status:** Planning and initial setup. The application has not been implemented yet.
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
| Raw email and attachments | Local storage or Cloudflare R2 | Private, durable message content and files |
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

## License

No open-source license has been selected yet. Public source visibility does not itself grant permission for unrestricted reuse, modification, or redistribution.
