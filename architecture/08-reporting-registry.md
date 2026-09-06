# Reporting Registry

## Reporting policy

Reports remain owned by their product. A cross-product report receives read-only, versioned projections. It must not gain unrestricted access to every production database.

## Registry fields

| Field | Meaning |
|---|---|
| Report | Staff-facing name |
| Business question | Decision the report supports |
| Product owner | Website, Connect, Finance, or myMDO |
| Audience/permission | Who may view/export |
| Source of truth | Tables/API/projection |
| Grain | One row represents what |
| Metrics | Exact calculations/units |
| Filters/exclusions | Date, status, population, omissions |
| Refresh | Live, event-driven, scheduled, manual |
| Query cost | Queries/rows/latency where measured |
| Sensitive fields | PII, giving, payroll, child/family data |
| Export | CSV/PDF/print/API |
| Last reconciled | Date and evidence |
| Status | Current, duplicate, needs review, retire |

## Initial registry

| Report area | Owner | Status | Phase 0 work |
|---|---|---|---|
| Website/newsletter/content reports | Website | needs inventory | Enumerate screens, exports, metrics, definitions |
| People/household/attendance reports | Connect | needs inventory | Reconcile populations and permissions |
| Giving statements and giving reports | Connect Giving | needs inventory | Separate transactional reports from Finance summaries |
| Finance Health/Church/Balance/Planning reports | Finance | known high-cost | Record queries, duplicate loads, definitions, control totals |
| Payroll reports | Future Finance | split across systems | Reconcile Website output with myMDO inputs and Finance terms |
| Serve/Scheduler reports | Connect UI; domain owner | needs inventory | Define signup versus assignment metrics |
| Facilities/Gym reports | Future Connect Facilities | partial | Inventory bookings, invoices, utilization, repairs/providers |
| myMDO enrollment/attendance/staff/billing reports | myMDO | needs inventory | Enumerate and classify sensitivity/query cost |
| Council-facing summaries | Finance/Governance by fact | sporadic | Identify recurring decisions and authoritative sources |

## Report acceptance rule

A report is trusted only after its definition, permission, source, and control totals are documented and reconciled. Visual similarity or matching titles do not prove two reports calculate the same population.

