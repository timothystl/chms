# Timothy Connect and Finance

This repository contains production Connect, Giving, Serve/Scheduler and the legacy Finance
module, plus the independently deployed Finance application under `apps/finance/`.
Connect remains authoritative for people and Giving. New Finance has separate staging and
production Workers/databases, real contract reads and Giving/payroll relays, alongside synthetic
readers and unfinished pages. It is no longer accurately described as synthetic-only or read-only.

The [production runbook](docs/FINANCE_PRODUCTION_CUTOVER.md) records deployed infrastructure.
Finance released again September 18 with expanded report/edit paths. Missing-fixture page crashes
and runtime role-failure behavior have been improved; data/writer cutover, complete permissions,
and workflow parity remain open. New Finance-owned writes are off by default.
See [Finance scope and limitations](apps/finance/README.md).

Start with [AGENTS.md](AGENTS.md) for development and release boundaries. Current reference docs:

- [Architecture](docs/ARCHITECTURE.md)
- [Data ownership](docs/DATA-OWNERSHIP.md)
- [Operations](docs/OPERATIONS.md)
- [Security](docs/SECURITY.md)
- [Testing](docs/TESTING.md)
- [Finance alpha](apps/finance/README.md)

Use Node 22. Install and validate with:

```sh
npm ci
npm test
node .github/scripts/check-built-scripts.js
```

Connect and Finance have separate manual-dispatch production workflows requiring the exact main
SHA and a release reason. Complete routine requested releases under [AGENTS.md](AGENTS.md);
no repeat approval is required. Documentation-only changes need no manual Worker deployment.
