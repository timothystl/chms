# Duplication Audit Register

Status values: `unreviewed`, `investigating`, `owner-decided`, `reconciled`, `migration-planned`, `complete`.

| Capability | Known locations | Preliminary owner | Status | Required investigation |
|---|---|---|---|---|
| Staff authentication | Website D1; Connect D1; Supabase admin Auth | Shared identity; product authorization | investigating | Accounts, roles, recovery, sessions, MFA, offboarding |
| Staff/person records | Website bios; Connect people; Finance compensation; Supabase `staff`/`church_staff` | Connect People, HR, or myMDO depending fact | investigating | Field-level comparison and identifiers |
| Payroll/PTO | Website Payroll; myMDO clocks/PTO/approval; Connect Finance planning | Finance processing; HR terms; myMDO operations | owner-decided | Calculations, approvals, closed periods, exports, audit |
| Contact card | Website form; Connect intake/follow-up | Connect workflow | owner-decided | Confirm no duplicate private storage |
| Prayer | Website form; Website intake path; Connect prayer records | Connect workflow | owner-decided | Retention, privacy, delivery failure behavior |
| Events/calendars | Website; Serve; Scheduler; Gym; myMDO | Domain-specific | investigating | Record meanings, IDs, publication/handoff |
| Volunteers | Serve signups/roles; Scheduler assignments; Connect people | Serve/Scheduler with Connect person refs | investigating | Duplicate roles/people and handoff states |
| Facilities | Website Gym; Finance property; Council Drive files | Connect Facilities | owner-decided | Existing tables, bookings, invoices, providers, repairs |
| Messaging | Website/Brevo; Connect email/SMS/push; Scheduler; myMDO Functions | Initiating product + delivery service | investigating | Vendors, preferences, templates, logs, retries |
| Documents | Website R2; Connect R2; Council Drive; Supabase Storage | Owning domain | investigating | Sensitivity, retention, versioning, backup, export |
| Giving/finance | Website Give/Gym invoices; Connect Giving/Finance; myMDO billing | Giving, Finance, myMDO by fact | investigating | Transaction versus accounting/projection boundary |
| Reports | All repositories | Owning product | investigating | Populate report registry and reconcile definitions |
| Audit history | Website; Connect; myMDO | Owning product; optional projection | investigating | Events, retention, actor IDs, cross-service correlation |

## Audit record template

For each row capture:

- business meaning;
- current physical tables/files/routes;
- authoritative owner and writer;
- readers;
- identifiers and correspondence rules;
- sensitivity and retention;
- whether each copy is authoritative, projection, cache, export, or accidental duplicate;
- integrations and failure behavior;
- current discrepancies;
- disposition: keep, project, migrate, archive, or retire;
- validation and rollback requirements.

Do not merge similarly named facts automatically. Website events, Serve opportunities, Scheduler services, gym bookings, and MDO closures are distinct unless the audit proves otherwise.

