# Timothy Connect and Finance — Agent Instructions

This is the only AI startup instruction file for this repository. Claude reads it through
`CLAUDE.md`; Codex reads it directly. Do not preload or inventory other Markdown files.
Open a reference only when the current task specifically requires it, and verify dated claims
against current source, tests, GitHub, deployed configuration, and live behavior.

## Product boundary

This repository currently serves Connect, Giving, Finance, Serve, and Scheduler from the
Cloudflare Worker `tlc-chms`. Production uses D1 `tlc-volunteer-db`, KV `RSVP_STORE`, R2
`tlc-chms-photos`, and a daily `14:00 UTC` cron. Staging uses a separate D1 database and no cron.

The target architecture has four staff products: Church Website, Connect, Finance, and myMDO.

- Connect owns people, households, Giving, communications, volunteers, scheduling,
  facilities, governance, and restricted church HR.
- Finance owns accounting imports, budgets, actuals, balances, forecasts, property finance,
  compensation planning, and future payroll processing.
- Giving remains authoritative in Connect. Finance must eventually consume versioned summaries,
  not become a second writer of gifts, batches, deposits, funds, or donor records.
- myMDO owns raw childcare operations, billing, schedules, clock events, and MDO payroll inputs.
- Repository or database boundaries change only when ownership, security, load, or failure
  isolation justifies them.

## Settled operational facts

- Finance is already a separate backend/frontend module, but it still shares the Worker and D1
  database with Connect.
- Finance currently has fifteen `finance_*` tables plus Finance-owned JSON settings mixed into
  shared `chms_config`.
- Finance directly reads Connect-owned `funds` and `giving_monthly_fund_totals`. A versioned
  Giving-summary contract must exist before physical Finance extraction.
- QuickBooks Budget API never connected successfully. Budget data is maintained through the
  working CSV/Excel import path. Do not describe QuickBooks Budget API as active, depend on it
  for current workflows, or spend time reconnecting it unless Andrew explicitly reopens that
  product decision. Existing OAuth/sync code and tables require a deliberate retirement change.
- TinyMCE is self-hosted from `vendor/tinymce/`. The subscription has lapsed. Do not add cloud
  scripts, cloud API keys, paid editor loads, or a CDN dependency.
- Production schema initialization is currently coupled to runtime `initDb()` and
  `schema_fingerprint`; the numbered migration folder is not the complete production ledger.
  Do not “fix” that during unrelated work.

## Access and data safety

- Roles are `admin`, `finance`, `staff`, `council`, `member`, `volunteer`, and `compensation`
  (view+edit access to the Compensation Planner sub-tab of Finance only, saved separately from
  the shared admin/finance roster); feature access is resolved by the server-side permission
  matrix. UI hiding is never authorization.
- Council Giving access is aggregate/anonymous only. New anonymous endpoints are denied until
  explicitly allowlisted.
- Never expose credentials or personal, giving, payroll, HR, child/family, or payment data.
- `SECRETS.md` is security-sensitive reference material, not startup reading. Do not reproduce
  values. Any removal requires credential inventory, rotation decisions, and Git-history review.
- Documentation changes and read-only production queries do not require separate approval.
- Ask Andrew before changing application source code. Production migrations, deployments,
  authentication or configuration changes, data moves, and destructive cleanup also require his
  explicit approval for that operation.

## Git, deployment, and verification

- Automatic Claude-branch merging was removed. Branches and pull requests validate without
  deploying.
- Production deployment is manual-only through `.github/workflows/deploy.yml`. It requires the
  full approved `main` commit SHA and a release reason. Never dispatch it without explicit
  production-release approval.
- Preserve unrelated concurrent work. Do not reset, rebase, force-push, or overwrite shared
  history. Use a branch or disposable worktree.
- Use Node 22. Run `npm test` and `node .github/scripts/check-built-scripts.js` before merge.
  Add focused tests for the changed path and verify regression tests are non-vacuous.
- Current code and live evidence outrank documentation. Search callers and tests before removing
  routes, schema, configuration keys, or compatibility paths.

## Timothy Digital overhaul checkpoint

Andrew retired the old preparation-gate/implementation-phase ceremony on September 9, 2026. The
current plan is a plain task list in the private `digital-architecture` repository's
`architecture/11-overhaul-readiness-and-execution-plan.md` — read it before starting overhaul work
here, not the retired gate language this section used to carry. In short, the goals are: Finance
becomes its own application; shared staff login across products; code normalized and functions
(and legacy names like `tlc-volunteer-db`, `tlc-chms-photos`, `RSVP_STORE`) moved/renamed to match
current scope; real developer documentation; and better observability so a resource spike (like
the earlier hard-to-diagnose D1 usage spike) is easy to root-cause. None of these are gated behind
each other — pick up whichever is asked for. CHMS's own backup/restore is real and tested (a
disposable database restore drill passed); Website and myMDO do not have an equivalent yet.
Renaming any live D1 database, R2 bucket, or KV namespace needs a deploy that repoints bindings —
batch those with other planned deploys and back up first. myMDO's authorization migrations are
already live and synchronized to source through childcare-portal PR #328; do not reapply them.

## Documentation discipline

`CLAUDE.md` only imports this file. `AI_SESSION_START_HERE.md`, `NOTES.md`, `PLAN.md`, the
architecture packet, and dated evidence remain reference/history—not startup instructions or
competing current status. Read the smallest task-relevant source only. Preserve licenses and
evidence. Keep durable rules here, work items in the issue tracker, and history in Git. Keep this
file below 200 lines and update the checkpoint whenever overhaul status materially changes.
