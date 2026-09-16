# Timothy Connect and Finance

This repository contains production Connect, Giving, Serve/Scheduler and the legacy Finance
module, plus the independently deployed Finance application under `apps/finance/`.
Connect remains authoritative for people and Giving. New Finance has separate staging and
production Workers/databases, real contract reads and Giving/payroll relays, alongside synthetic
readers and unfinished pages. It is no longer accurately described as synthetic-only or read-only.

The [production infrastructure runbook](docs/FINANCE_PRODUCTION_CUTOVER.md) records the September 15
deployment. Financial data/user cutover and retirement of legacy Finance remain open. Source review
also found synthetic-row dependencies and incomplete section authorization in the new shell;
see [Finance scope and limitations](apps/finance/README.md). Deployment success is not report parity.

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

Production deployment is manual-only and requires an explicitly approved full `main` SHA and
release reason. An ordinary branch or pull request does not deploy production.
