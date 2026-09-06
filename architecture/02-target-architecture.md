# Target Architecture

## Product topology

```text
Timothy Digital
│
├── Shared Church-Staff Identity
│   ├── Website Admin
│   ├── Connect
│   ├── Finance
│   └── optional myMDO director/admin federation later
│
├── Church Website
│   ├── timothystl.org
│   ├── admin.timothystl.org
│   ├── give.timothystl.org
│   ├── links.timothystl.org
│   └── publishing, newsletters, media, public presentation/forms
│
├── Connect
│   ├── connect.timothystl.org
│   ├── People and Households
│   ├── Giving
│   ├── Communications
│   ├── Serve management
│   ├── Scheduler interface
│   ├── Facilities
│   ├── Governance
│   └── restricted Staff & HR
│
├── Finance
│   ├── finance.timothystl.org
│   ├── QuickBooks and accounting imports
│   ├── budgets, planning, balances, and property finance
│   ├── payroll processing
│   └── finance reporting and cached Connect/myMDO projections
│
└── myMDO
    ├── public MDO website and registration
    ├── parent portal
    ├── classroom and staff operations
    ├── billing and payments
    ├── MDO payroll inputs/approval
    └── narrow MDO seasonal website controls; broader content remains developer-managed unless future usage justifies an editor
```

## Staff experience

The architecture deliberately limits staff destinations:

| Work | Destination |
|---|---|
| Website, news, newsletters, public content | Website Admin |
| People, Giving, communication, volunteers, schedules, facilities, governance, HR | Connect |
| Accounting, budgets, payroll processing, finance reports | Finance |
| MDO work | myMDO |

Serve and Scheduler may become separately deployed services, but their management interfaces remain inside Connect.

## Physical-boundary guidance

- Finance should eventually align hostname, deployment, repository/package, and database ownership.
- Giving remains authoritative in Connect. Finance receives summarized, versioned projections.
- A Worker split without database ownership does not provide complete D1 attribution.
- myMDO stays on its Supabase boundary and is not folded into Connect.
- The Website stays independent of Connect and Finance availability.
- Repositories may contain multiple deployable packages while boundaries are established. Repository separation is performed only when deployment, security, data, and operational ownership justify it.

## Failure boundaries

- Finance failure must not block Connect People, Giving entry, Website editing, or Serve intake.
- Connect failure must not block Website publishing.
- Website failure must not corrupt Connect or myMDO records.
- myMDO remains functional when church systems are unavailable, except for explicitly optional integrations.
- Message-provider failure queues or reports messages; it does not block ordinary application work.
