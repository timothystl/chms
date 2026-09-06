# Timothy Digital Applications Architecture and Migration Plan

Status: planning document; no production changes authorized  
Rebuilt: September 4, 2026

## 1. Decisions reached

Timothy's systems will be organized around four staff-facing products:

1. **Church Website** — public communication, publishing, newsletters, and public forms.
2. **Connect** — people, households, giving records, communications, volunteers, scheduling, facilities, governance, and restricted church HR.
3. **Finance** — a separate application at the proposed `finance.timothystl.org`, owning accounting, budgets, planning, property finance, payroll processing, and financial reporting.
4. **myMDO** — the complete MDO product: public site, registration, families, parent portal, classrooms, staff operations, billing, MDO payroll inputs, and narrow seasonal website controls. General public-page content is currently developer-managed. Eventually rename repository `childcare-portal` to `mymdo` in a dedicated non-functional change.

Decisions and principles:

- Finance should separate because it has distinct work, users, permissions, integrations, load, sensitivity, and failure behavior.
- Giving remains in Connect because gifts, batches, funds, statements, people, and households form one transactional domain.
- Finance consumes summarized Giving projections; it does not repeatedly scan or write Connect's giving ledger.
- Serve remains a public hostname and may become a separate backend, but staff manage it through Connect.
- Scheduler may become a separate backend, but staff use it through Connect.
- The Church Website is a peer of Connect, not its child.
- myMDO remains one product and does not need a separate MDO HR application.
- Website Admin, Connect, and Finance should share a standards-based church-staff identity. Each product still owns authorization.
- Payroll should ultimately live in Finance, not Website Admin.
- HR owns the employment relationship; myMDO owns how MDO staff work; Finance owns processing their pay.
- A full duplication and ownership audit must precede feature or data movement.

## 2. Safety controls

### Architecture freeze

Until Phase 0 is signed off, permitted work is limited to architecture documentation, read-only inventory and diagnostics, non-mutating backup/restore tooling, read-only telemetry/alerts, and separately approved emergency fixes.

Do not move features or routes, rename production resources, change authentication or database bindings, apply schema migrations, split Workers or repositories, or copy records into a new source of truth during Phase 0.

After Phase 0, only the files and systems named in the active phase may change. Use one phase per pull request/deployment sequence. Do not include opportunistic cleanup.

### Backup and restore gate

Before production-changing work:

1. Record production commit SHAs, application versions, and deployed Worker/Pages/Edge Function versions.
2. Create immutable pre-migration Git tags.
3. Export complete schema-and-data SQL backups of both production D1 databases.
4. Record current D1 Time Travel bookmarks.
5. Export Supabase Postgres schemas, data, functions, triggers, grants, and Auth data where supported.
6. Back up Supabase Storage separately; database backups do not contain Storage objects.
7. Record Supabase Auth settings, redirects, Functions, cron jobs, webhooks, policies, extensions, and secret names—never secret values.
8. Inventory Cloudflare routes, domains, service bindings, D1/KV/R2 bindings, Pages projects, cron triggers, variables, and secret names.
9. Restore every backup into a disposable non-production target.
10. Validate counts, financial control totals, permissions, sampled records, functions, and application reads.
11. Record restore duration, operator, procedure, results, and encrypted backup location.

A backup is accepted only after a successful restore test.

### Rollback rule

Every phase must identify its last known-good versions, database bookmarks, success/failure thresholds, write-reconciliation method, rollback procedure, maximum cutover window, and person authorized to order rollback.

Avoid dual-write. If unavoidable, require idempotency, one declared source of truth, a reconciliation report, and a tested replay/discard procedure.

## 3. Current production topology

| Capability | Repository | Runtime/surface | Primary data |
|---|---|---|---|
| Public church site | `timothystl/website` | Worker `timothystl-site`; `timothystl.org` | Published Website Admin data |
| Website administration | `timothystl/website` | Worker `tlc-newsletter-admin`; `admin.timothystl.org` | D1 `tlc-newsletter-db`, R2 |
| Give and Links | `timothystl/website` | `give.timothystl.org`, Worker `tlc-links` | Website settings/external links |
| Connect/People/Giving | `timothystl/chms` | Worker `tlc-chms`; `connect.timothystl.org` | D1 `tlc-volunteer-db`, KV, R2 |
| Finance | `timothystl/chms` | Same `tlc-chms` Worker | Same D1 `tlc-volunteer-db` |
| Serve | `timothystl/chms` | Same Worker; `serve.timothystl.org` | Same D1 `tlc-volunteer-db` |
| Scheduler | `timothystl/chms` | Same Worker; embedded in Connect | Same D1 `tlc-volunteer-db` |
| Payroll | `timothystl/website` | Website Admin Payroll | Supabase payroll RPCs/tables |
| myMDO | `timothystl/childcare-portal` | Cloudflare Worker deployed by GitHub Actions + Supabase Functions | Supabase project `dahdstopsumxnqvdclmy` |
| MDO website controls | `timothystl/childcare-portal` | myMDO Admin → Settings → Website | Narrow seasonal settings; general content is developer-managed |

Known cross-system calls:

- Website Admin binds to `tlc-chms` as `VOLUNTEER_WORKER`.
- Website contact and prayer forms feed Connect-owned follow-up/prayer workflows.
- CHMS Finance calls myMDO's `finance-summary` Supabase Function.
- Website Admin payroll reads church and MDO payroll data from the myMDO Supabase project.

## 4. Target architecture

```text
Timothy Digital
│
├── Shared Church-Staff Identity
│   ├── Website Admin
│   ├── Connect
│   ├── Finance
│   └── optional myMDO director federation later
│
├── Church Website
│   ├── timothystl.org / admin.timothystl.org
│   ├── give.timothystl.org / links.timothystl.org
│   └── pages, media, news, newsletters, sermons, public events/forms
│
├── Connect
│   ├── connect.timothystl.org
│   ├── People and Households
│   ├── Giving
│   ├── Communications
│   ├── Serve management and Scheduler interface
│   ├── Facilities
│   ├── Governance
│   └── restricted Staff & HR
│
├── Finance
│   ├── finance.timothystl.org
│   ├── QuickBooks, budgets, planning, balances
│   ├── property finance and payroll processing
│   └── finance reporting and cached Connect/myMDO projections
│
└── myMDO
    ├── public MDO site, registration, parent portal
    ├── classrooms, care calendars, MDO staff operations
    ├── billing, payments, payroll inputs/approval
    └── parent/staff communication and MDO content
```

Not every internal box needs a separate repository or staff-facing hostname. Backend isolation can improve reliability while staff stay in the appropriate product.

## 5. Authentication

Website Admin, Connect, and Finance should delegate sign-in to one standards-based identity provider. Do not create a custom central-authentication Worker unless no suitable provider exists.

Shared authentication establishes identity; each product separately assigns permissions. A person who can sign into Finance does not automatically receive Website or Connect privileges.

Separate identities remain appropriate for myMDO parents, MDO PIN/kiosk workflows, public Website/Give/Serve visitors, and server-to-server machine credentials.

## 6. Ownership by domain

### Church Website

Owns public content, revisions, menus, navigation, branding, media, news, newsletters, sermons, public event presentation, subscriptions, and public form presentation. It does not own the internal record produced by a prayer request, contact card, facility request, volunteer signup, or payment.

### Connect Core and Giving

Owns people, households, membership, contact preferences, digital contact-card follow-up, prayer workflow, giving batches, entries, deposits, funds, donor history, statements, and immutable cross-system person/household identifiers. Finance is never a second writer of the giving ledger.

### Finance

Owns QuickBooks connections/imports, current `finance_*` records, budgets, actuals, balances, forecasts, planning assumptions, property financial records, payroll processing, board finance reporting, and cached/versioned projections from Connect and myMDO.

Finance does not own individual people, gifts, MDO invoices, raw MDO clock records, or HR case files.

### Facilities in Connect

Grow this from the existing Gym Rental workflow. Facilities owns spaces, availability, internal reservations, public facility requests, gym rentals, agreements, insurance, work orders, repairs, preventive maintenance, inspections, service providers, quotes, warranties, contracts, keys/access, and service history.

Finance receives approved costs/accounting information. Website presents public forms. Facilities owns the operational record.

### Governance in Connect

Owns council/voters meetings, agendas, minutes, packets, resolutions, policies, committee records, document metadata, permissions, retention categories, and approvals. Initially index/link Council Files in Google Drive; do not rebuild Drive until versioning, search, permission, retention, and export requirements justify it.

### Restricted Church HR in Connect

Owns legal employee identity, employee ID, employment status/dates, position/supervisor, compensation terms, benefits eligibility, official PTO policy/balance, background-check status, policies/acknowledgments, employment documents, and church employee performance/disciplinary records.

Congregational People records are not HR records. HR may eventually use a separately protected backend/database without creating another staff-facing application.

### myMDO staff operations

Owns MDO schedules, classroom assignments, clock events, MDO PTO requests/approval, childcare credentials/training, MDO-specific workplace documentation, and MDO payroll-period approval. It publishes approved summaries and does not need a separate MDO HR product.

**Ownership rule:** myMDO owns how MDO staff work; Church HR owns the employment relationship; Finance owns processing their pay.

### Payroll in Finance

```text
Church HR ───── employment/pay terms ─┐
Connect ─────── approved church time ─┼─→ Finance Payroll
myMDO ───────── approved MDO time ────┘
```

Finance Payroll owns period preparation, gross-pay calculations, allowances/deductions, approval/close state, provider export, and reconciliation. It does not own raw MDO clock history or HR cases.

Do not move current Website Admin payroll until all calculations, permissions, approvals, and period-close behavior have been inventoried and reproduced in staging.

### Communications in Connect

Staff manage church email, SMS, push, groups, templates, schedules, preferences, opt-outs, and delivery history in Connect. Delivery may use an isolated queue/service. The initiating product owns purpose and recipients: Website newsletters; Connect member/volunteer communication; Scheduler reminders; myMDO parent/staff messages; tightly controlled Finance notices.

### Reporting

Reporting remains within each product. Build a report registry before considering a central reporting application. Every report documents its question, owner, audience, permissions, source, definitions, filters, sensitive fields, query cost, refresh behavior, export, and reconciliation date. Cross-product reports consume read-only projections rather than joining production databases directly.

## 7. Required duplication audit

| Capability | Locations to compare |
|---|---|
| Authentication | Website D1; Connect D1; Supabase admins/parents; PIN flows |
| Staff | Website bios; Connect people; Finance compensation; Supabase `staff`/`church_staff` |
| Payroll/PTO | Website Payroll; myMDO clocks/PTO/approval; Connect Finance planning |
| People/contact | Website submissions; Connect people/households; MDO families |
| Events/calendars | Website events; Serve events; Scheduler services; gym bookings; MDO dates/closures |
| Prayer/contact | Website forms/intake; Connect prayer/follow-up |
| Volunteers | Serve signups/roles; Connect/Scheduler assignments |
| Facilities | Website Gym Rentals; Finance property; future repair/provider records |
| Messaging | Website/Brevo; Connect email/SMS/push; Scheduler; myMDO Functions |
| Files | Website R2; Council Drive; Connect R2; Supabase Storage |
| Finance | Gym invoices/payroll; Connect Giving/Finance; myMDO billing/summaries |
| Reports | Website, Connect, Finance, and myMDO reports/exports |
| Audits | Separate Website, Connect, and myMDO audit histories |

For each workflow/record, document meaning, owner, physical location, readers/writers, identifiers, sensitivity, retention, dependencies, whether copies are authoritative/projections/caches/exports/accidental duplicates, and disposition: keep, project, migrate, archive, or retire.

Do not merge records because names resemble one another. A Website event, Serve opportunity, Scheduler service, gym booking, and MDO closure are different business facts.

## 8. Integration and observability standards

- One authoritative writer per business fact.
- No unrestricted shared database credentials across products.
- Prefer versioned APIs/projections over cross-database access.
- Use immutable IDs, not names/emails, across systems.
- Document timeouts, retries, idempotency, cache, staleness, and fallback behavior.
- Projections include source owner, version, and generation time.
- Website publishing remains available if Connect/Finance fails.
- Finance failure cannot block People, Giving entry, Serve intake, or Website editing.
- myMDO remains independently operable except for marked optional integrations.

Every service must be traceable through:

`hostname → product → service → repository → deployment → database/storage → owner → runbook`

Structured telemetry should include product/service/version, environment, hostname, route, correlation ID, role category, status, latency, error class, database, query/row counts where available, cache status, downstream calls, and job/cron identity.

## 9. Where future work goes

| Requirement | Home |
|---|---|
| Church content, news, newsletter, sermon, SEO | Church Website |
| Contact card or prayer submission | Website presents; Connect owns workflow |
| Person, household, membership, preferences | Connect Core |
| Gift, batch, fund, deposit, statement | Connect Giving |
| Church/member/volunteer email, text, push | Connect Communications |
| Volunteer opportunity/signup/schedule | Connect interface; Serve/Scheduler backend |
| Room, gym rental, repair, work order, provider | Connect Facilities |
| Council packet, minutes, policy | Connect Governance |
| Church employment or HR record | Restricted Connect HR |
| QuickBooks, budget, balance, forecast, payroll | Finance |
| MDO family, classroom, billing, staff operations | myMDO |
| MDO homepage content | myMDO Website editor |
| Cross-product report | Governed read-only projections |

## 10. Migration sequence

### Phase 0 — Freeze, inventory, duplication audit, backups, baselines

Deliver operational catalog, duplication/ownership matrix, authentication/permission matrix, verified backup/restore record, dependency diagram, report registry, seven-day baseline by database/route/query, and accepted owner for each workflow. Exit only when every datastore is restorable and every overlap has an owner or explicit unresolved decision.

### Phase 1 — Stop current Finance D1 amplification in place

Allow only Finance lazy loading, request deduplication, shared in-flight results, cache/invalidation, instrumentation, and evidence-based indexes. Move no tables/routes. Exit when one annual computation serves a year/session, hidden panels do not load, results reconcile, and quiet/active budgets are met.

### Phase 2 — Shared staff identity design and staged proof

Select provider, map roles, prove staging sign-in, account linking, recovery, and rollback. Do not remove production auth until staged permissions are proven.

### Phase 3 — Define domain contracts in current repositories

Create documented/versioned contracts for Giving summaries, MDO finance/payroll summaries, people references, facility submissions, and message delivery. Transfer no ownership yet.

### Phase 4 — Extract Finance

Create Finance deployment/repository boundary, `finance.timothystl.org`, Finance database, historical copy, shadow reads, and controlled cutover. Connect stays sole Giving writer; myMDO stays sole raw MDO writer. Exit with separate metrics, reconciled figures/permissions, and lossless rollback.

### Phase 5 — Move Payroll to Finance

Reproduce existing payroll behavior, ingest approved church/MDO inputs, shadow multiple periods, then cut over. Exit when periods reconcile exactly, approvals/audit persist, and Website Admin has no payroll dependency.

### Phase 6 — Consolidate production staff authentication

Cut over one application at a time while preserving application authorization. Exit with one staff identity, recovery, no widened permissions, and safe old-session revocation.

### Phase 7 — Establish Facilities, Governance, Communications, and HR

Move one module at a time; re-home existing workflows rather than rebuilding. Gym Rental begins Facilities. Google Drive is indexed before any file migration.

### Phase 8 — Separate Serve/Scheduler backends only if justified

Use measured load, security, deployment, and reliability evidence. Retain Connect management UI and avoid duplicate people records.

### Phase 9 — Rename resources after boundaries stabilize

Rename `childcare-portal` to `mymdo` separately. Consider `chms` to `connect` only after Finance extraction. Preserve redirects/aliases and update CI, Pages, docs, remotes, dashboards, and runbooks.

## 11. Validation at every phase

- Automated regression and contract tests.
- Production-shaped staging without production credentials.
- Read-only shadow comparison where possible.
- Counts, monetary control totals, sampled records, and each-role permission tests.
- Downstream failure/timeout testing.
- Usage comparison with Phase 0 baseline.
- Security review for identity, payroll, HR, giving, child/family, or payment data.
- Written go/no-go and rollback decision.
- Post-deployment observation window before the next phase.

## 12. Open decisions

- Shared staff identity provider.
- Whether Connect HR needs a separate protected backend/database.
- Whether Finance first becomes a deployable package or immediately a separate repository.
- Pull-cached versus push-generated Giving projections.
- Boundary between Facilities receivables and Finance accounting.
- Whether Council files eventually leave Google Drive.
- Whether cross-product reporting ever needs its own surface.
- Whether Serve/Scheduler merit physical extraction after Finance stabilizes.

Decide these from Phase 0 evidence, not aesthetics.

## 13. Immediate next step

Do not begin extraction. Complete and review:

1. operational catalog;
2. duplication/ownership matrix;
3. authentication/permission matrix;
4. verified backup-and-restore record;
5. report registry; and
6. baseline plus Finance Phase 1 query budget.

Only then authorize implementation.
