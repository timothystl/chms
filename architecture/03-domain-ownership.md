# Domain and Data Ownership

## Ownership matrix

| Business fact | Authoritative owner | Permitted consumers |
|---|---|---|
| Public church content and revisions | Church Website | Public Website |
| Newsletters and subscribers | Church Website | Public Website; approved delivery provider |
| People, households, membership, preferences | Connect Core | Giving, Communications, Scheduler, Serve, narrow external APIs |
| Individual gifts, batches, deposits, funds, statements | Connect Giving | Finance receives aggregates only |
| QuickBooks, budgets, balances, forecasts, planning | Finance | Finance users and approved reports |
| Payroll-period processing and provider export | Finance | Authorized payroll/finance staff |
| Church employment relationship | Connect HR | Finance and approved supervisors via narrow views |
| MDO schedules, clock events, MDO PTO approval | myMDO | Finance receives approved payroll inputs; HR receives employment summaries |
| MDO families, children, registration, billing, incidents | myMDO | MDO users and parents under Supabase authorization |
| Volunteer opportunities and public signups | Serve domain | Connect/Scheduler through explicit contracts |
| Schedules and assignments | Scheduler domain | Connect interface; Serve where needed |
| Facility requests, reservations, repairs, providers | Connect Facilities | Website presentation; Finance cost summaries |
| Council records and document metadata | Connect Governance | Authorized leadership |

## Key domain rules

### Website versus Connect

The Website presents the digital contact card and prayer form. Connect owns the resulting private follow-up and prayer records. Website editors control presentation, not pastoral workflow data.

### Giving versus Finance

Connect owns every individual giving transaction. Finance consumes a versioned summary containing totals by period/fund, household counts/bands where authorized, generation time, and source version. Finance cannot directly mutate Giving tables.

### Facilities versus Finance

Facilities owns the request, booking, work order, provider, quote, repair, warranty, document, and completion status. Finance owns accounting classification, budget effect, payment/reconciliation, and financial reporting.

### HR, myMDO, and Payroll

- Church HR owns employment identity, employment terms, official policy, benefits eligibility, and formal HR records.
- myMDO owns classroom work, schedules, clocking, MDO PTO workflow, childcare credentials, and director approval.
- Finance owns payroll preparation, gross calculations, deductions/allowances, close state, provider export, and reconciliation.

### Reporting

Each product owns its reports. Cross-product reporting uses read-only projections with documented definitions; it does not directly join production databases.

## Where new work belongs

| Requirement | Home |
|---|---|
| Page, menu, media, news, newsletter, sermon, SEO | Church Website |
| Contact card or prayer workflow | Website presents; Connect owns |
| Person, household, membership, preference | Connect Core |
| Gift, batch, fund, deposit, donor statement | Connect Giving |
| Church/member/volunteer email, text, push | Connect Communications |
| Volunteer opportunity/signup/schedule | Connect UI; Serve/Scheduler domain |
| Room, gym rental, repair, work order, provider | Connect Facilities |
| Council packet, minutes, policy | Connect Governance |
| Church employment/HR record | Restricted Connect HR |
| QuickBooks, budget, balance, forecast, payroll | Finance |
| MDO family, classroom, billing, staff operation | myMDO |
| MDO homepage content | myMDO Website editor |

