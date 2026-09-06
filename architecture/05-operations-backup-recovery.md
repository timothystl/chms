# Operations, Backup, and Recovery

## Phase 0 freeze

No application refactors, route changes, binding changes, authentication changes, repository renames, or production data moves are authorized during Phase 0. Emergency D1 remediation occurred on September 5, 2026 and invalidated the originally planned baseline window. The clean seven-day baseline begins only after the last Finance stabilization deployment and a 24–48 hour error/reconciliation check. Its end date must be recorded from that actual start; September 11 is no longer a valid automatic exit date.

## Backup inventory

### Git and deployments

- Record production commit SHA and version for `website`, `chms`, and `childcare-portal`.
- Record each deployed Worker, Pages build, and Supabase Function version.
- Create immutable pre-migration tags when implementation is authorized.
- Record CI/CD configuration and required secret names.

### Cloudflare D1

- Export full schema and data for `tlc-newsletter-db` and `tlc-volunteer-db`.
- Record Time Travel bookmarks immediately before each production phase.
- Retain independent encrypted exports outside the live database account.
- Restore exports into disposable databases and validate them.

### Cloudflare KV and R2

- Inventory keys/namespaces and retention requirements for KV.
- Inventory R2 buckets, object counts, sizes, prefixes, lifecycle policies, and access bindings.
- Back up material objects using a repeatable process.

### Supabase

- Export Postgres schemas, data, functions, triggers, grants, and Auth data where supported.
- Back up Storage objects separately.
- Record Auth configuration, redirect URLs, Edge Functions, Function secret names, cron jobs, webhooks, extensions, RLS policies, grants, and storage policies.
- Restore to a disposable project/database and validate application reads, functions, permissions, and sampled records.

## Restore validation

For each restored store, record:

- table/object counts;
- monetary control totals;
- latest/oldest timestamps;
- sampled parent/child, person/household, giving, payroll, finance, content, and booking records as applicable;
- expected indexes/functions/triggers/policies;
- each-role access checks;
- application smoke reads; and
- restore duration and any manual steps.

## Observability catalog

Each resource must map through:

`hostname → product → service → repository → deployment → database/storage → owner → runbook`

Telemetry should include product/service/version, environment, route, correlation ID, role category, status, latency, error class, database, query/row counts when exposed, cache result, downstream call, and job/cron identity.

Required dashboards: account-wide health, product health, Worker/Function health, database usage, expensive routes/queries, dependency errors, and alert history.

## Activity-log limitation

The operator activity log is optional context, not a measurement source. Cloudflare/Supabase metrics remain authoritative for usage. Record only notable Finance opens/reloads, payroll, imports, bulk messaging, major publishes, and observed errors when practical. Unattributed activity remains explicitly unattributed.
