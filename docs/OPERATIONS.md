# Operations

Updated September 18, 2026. [AGENTS.md](../AGENTS.md) defines routine delivery authorization.

## Environments

| Environment | Worker | Data/storage | Release |
|---|---|---|---|
| Connect production | `timothy-connect` | `timothy-connect-db`, `KV`, `timothy-connect-photos`; daily cron | `deploy.yml`, manual dispatch |
| Connect staging | `timothy-connect-staging` | Separate D1/KV/R2; no cron | Staging workflow/config |
| Finance production | `timothy-finance-app` | Separate `timothy-finance-db`, Connect and Website service bindings | `deploy-finance.yml`, manual dispatch |
| Finance staging | `timothy-finance-app-staging` | Separate Finance D1; fixtures explicit | Finance staging workflow/config |

Main merges do not automatically deploy either production Worker. Dispatch the affected
workflow with the tested full main SHA and an accurate release reason. Connect repeats
`npm test` and the built-script check; Finance runs `npm run validate:finance:prod`.
Verify completion. A requested routine release needs no additional signoff.

[Connect release](https://github.com/timothystl/chms/actions/runs/35352987006) succeeded at
`7e93e60f3`; [Finance release](https://github.com/timothystl/chms/actions/runs/35351838490)
succeeded at `582c72a8f` on September 18. Finance infrastructure is deployed; its authoritative
data/user cutover remains unfinished. See [the runbook](FINANCE_PRODUCTION_CUTOVER.md).

## Data and rollback

Inspect target configuration and live schema before migrations. Connect's current production
source is `timothy-connect-db`, not retained `tlc-volunteer-db`. Finance schema migrations
and synthetic fixtures are separate operations; never load fixtures into production.
A data move needs a usable backup and reconciliation, with deliberate reader/writer cutover.
Do not enable unfinished feature flags merely because their code has deployed.

Rollback uses a known-good Cloudflare deployment or tested source redeployment, followed by
relevant smoke checks. Worker rollback does not undo D1/KV/R2 changes.

## Recovery and monitoring

The recorded Connect backup policy includes encrypted source/D1/R2/configuration inventory,
weekly and month-end retention, and disposable restore exercises. Sole-operator continuity
was accepted; do not restart it as an approval gate. A historical drill or policy does not prove
today's backup freshness. Verify the actual backup when a data move depends on it.

Monitor Worker/D1 logs, query attribution, scheduled jobs, import state, and error references.
Keep personal, financial, and credential values out of logs/issues. Use the relevant Wrangler
config for dry runs and releases; do not deploy against historical resource names.
