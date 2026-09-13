# Operations

## Environments

| Environment | Worker | Data/storage | Release boundary |
|---|---|---|---|
| Production | `tlc-chms` | Production D1, KV, and R2; daily cron | Manual approved-main SHA workflow only |
| Connect staging | `timothy-connect-staging` (renamed 2026-09-09 from `breeze-proxy-worker-staging`) | Separate staging D1, KV, and R2; no cron | Manual Wrangler operation |
| Finance staging | `timothy-finance-app-staging` | Separate Finance D1; synthetic data only | Manual reviewed alpha release |
| Finance production | `timothy-finance-app` (not yet deployed) | Separate Finance D1; not yet created | Not started — see [`FINANCE_PRODUCTION_CUTOVER.md`](FINANCE_PRODUCTION_CUTOVER.md) |

## Production release

`.github/workflows/deploy.yml` is dispatch-only. It verifies the requested full SHA is on `main`,
installs with Node 22, runs the full tests and built-script parser, and deploys through the protected
`production` environment. Never dispatch it without explicit production-release approval.

Rollback uses a known-good Cloudflare deployment or a reviewed redeployment of the recorded commit,
followed by bounded smoke checks and datastore/control-total verification appropriate to the event.
Application rollback does not roll back D1, KV, or R2 state.

## Staging commands

Inspect before changing anything:

```sh
npx wrangler whoami
npx wrangler deploy --dry-run --config wrangler.staging.toml
npx wrangler deploy --dry-run --config wrangler.finance.staging.jsonc
```

Finance schema and fixtures have separate commands by design:

```sh
npx wrangler d1 migrations apply timothy-finance-db-staging --remote --config wrangler.finance.staging.jsonc
npx wrangler d1 execute timothy-finance-db-staging --remote --config wrangler.finance.staging.jsonc --file apps/finance/fixtures/0001_synthetic_staging.sql
```

Those commands mutate staging and must be run only against the verified staging database UUID.
Never point them at `tlc-volunteer-db` or copy production rows into the alpha.

## Backup and recovery

The retained CHMS package includes source, D1, R2 objects, and configuration inventory, encrypted
with `age` and stored in a restricted SharePoint location. Weekly retention, pre-migration exports,
eight weekly copies, twelve month-end copies, and quarterly disposable restore tests are the
recorded policy. Andrew is the sole operator by accepted decision.

Monitor GitHub Actions, Cloudflare Worker/D1 logs and analytics, scheduled-job status, import state,
and application error references. Never put personal, financial, or credential values in logs or
issues.
