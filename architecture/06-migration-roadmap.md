# Migration Roadmap

This document retains the high-level migration sequence. The current readiness assessment, Finance stabilization work, reset baseline, and smaller execution packets are maintained in [Overhaul Readiness and Execution Plan](11-overhaul-readiness-and-execution-plan.md). Where timing or readiness differs, that dated plan controls until Phase 0 signoff.

## Phase 0 — Inventory, audit, backups, and baseline

Allowed: documentation, read-only diagnostics/telemetry, non-mutating backup/restore work.  
Required: operational catalog, duplication/ownership matrix, permission matrix, verified backups/restores, dependency map, report registry, seven-day baseline, Finance Phase 1 query budget, and a complete repository-document disposition manifest.  
Exit: every datastore is restorable and every overlap has an owner or documented unresolved decision.

Every repository instruction, setup, plan, status, fix, handoff, security, and operations document is inventoried during this phase. No source-repository document is deleted or replaced before the Phase 0 exit gate. The controlled procedure is defined in [Repository Documentation Reset](09-repository-documentation-reset.md).

## Phase 1 — Stop Finance D1 amplification in place

Allowed: Finance lazy loading, duplicate-request coalescing, shared results, cache/invalidation, instrumentation, and evidence-based indexes. Move no tables/routes.  
Exit: one annual computation per year/session; hidden panels do not load; results reconcile; approved quiet/active budgets are met.

## Phase 2 — Shared staff identity staged proof

Select provider, map roles, test staging sign-in, linking, MFA/recovery, offboarding, and rollback. Production authentication remains until proof is complete.

## Phase 3 — Define versioned domain contracts

Create contracts for Giving summaries, MDO finance/payroll summaries, person references, facility submissions, and message delivery. Transfer no ownership yet.

## Phase 4 — Extract Finance

Create `finance.timothystl.org`, Finance deployment/package or repository, Finance database, historical copy, shadow reads, reconciliation, and controlled cutover. Connect remains sole Giving writer; myMDO remains sole raw MDO writer.

## Phase 5 — Move Payroll to Finance

Reproduce current calculations, permissions, approvals, closed periods, exports, and audits. Shadow multiple periods, reconcile exactly, then cut over. Remove Website Admin payroll dependency only after stabilization.

## Phase 6 — Consolidate production staff authentication

Cut over one product at a time while retaining product-owned authorization. Confirm recovery, offboarding, no privilege expansion, and old-session revocation.

## Phase 7 — Establish Facilities, Governance, Communications, and HR

One module at a time. Re-home existing workflows rather than rewriting. Gym Rental starts Facilities. Council Drive is indexed before considering file migration.

## Phase 8 — Separate Serve/Scheduler backends only if justified

Use measured security, load, deployment, and reliability evidence. Retain Connect management UI and avoid duplicate people.

## Phase 9 — Rename resources

Rename `childcare-portal` to `mymdo` as a dedicated change. Consider `chms` to `connect` only after Finance extraction. Preserve redirects and update CI, Pages, remotes, documentation, dashboards, and runbooks.

## Every-phase controls

- One phase per change sequence.
- Production-shaped staging.
- Contract/regression/permission/security tests.
- Read-only shadow comparison where possible.
- Counts, monetary totals, and sampled-record reconciliation.
- Failure/timeout tests.
- Usage comparison with baseline.
- Written go/no-go and rollback decision.
- Stabilization window before the next phase.
