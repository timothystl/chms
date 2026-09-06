# Timothy Digital Architecture Documentation

Status: Phase 0 documentation; no implementation authorized  
Last updated: September 5, 2026  
Architecture owner: Timothy Lutheran Church

For a new AI session, begin only with [`AI_SESSION_START_HERE.md`](../AI_SESSION_START_HERE.md). This directory is reference material and should not be loaded in full.

## Purpose

This documentation explains where each Timothy application and business capability belongs, which system owns each kind of data, how applications may integrate, and how future changes must be backed up, measured, and rolled back.

## Product model

Timothy has four staff-facing products:

| Product | Purpose | Primary staff surface |
|---|---|---|
| Church Website | Public communication, content, newsletters, public forms | `admin.timothystl.org` |
| Connect | People, Giving, Communications, Volunteers, Scheduling, Facilities, Governance, restricted HR | `connect.timothystl.org` |
| Finance | Accounting, budgets, planning, property finance, payroll processing, financial reporting | Proposed `finance.timothystl.org` |
| myMDO | Complete MDO operations and narrow MDO website controls | Existing myMDO admin/parent/staff surfaces |

Public surfaces such as `timothystl.org`, `give.timothystl.org`, and `serve.timothystl.org` do not imply separate staff applications.

## Documents

1. [Current State](01-current-state.md)
2. [Target Architecture](02-target-architecture.md)
3. [Domain and Data Ownership](03-domain-ownership.md)
4. [Identity, Authorization, and Security Boundaries](04-identity-and-security.md)
5. [Operations, Backup, and Recovery](05-operations-backup-recovery.md)
6. [Migration Roadmap](06-migration-roadmap.md)
7. [Duplication Audit Register](07-duplication-audit.md)
8. [Reporting Registry](08-reporting-registry.md)
9. [Repository Documentation Reset](09-repository-documentation-reset.md)
10. [Repository Document Inventory](10-repository-document-inventory.md)
11. [Overhaul Readiness and Execution Plan](11-overhaul-readiness-and-execution-plan.md)

The earlier consolidated plan remains available at [Timothy Applications Architecture Blueprint](../Timothy_Applications_Architecture_Blueprint.md).

## Governing rules

- One authoritative owner and writer for each business fact.
- Shared staff identity does not mean shared permissions.
- Backend services may separate without creating more staff-facing destinations.
- Cross-product consumers use narrow, versioned APIs or projections—not unrestricted database access.
- No architecture migration begins before verified backups, restore tests, ownership review, and a measured baseline.
- During Phase 0, no application code, production schema, route, binding, authentication, or deployment changes are authorized.
