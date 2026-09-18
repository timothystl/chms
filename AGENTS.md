# Timothy Connect and Finance — Agent Instructions

Updated September 18, 2026, at Andrew's request to remove unnecessary approval and incremental-work restrictions.

## Working agreement

Andrew's request authorizes the implementation, tests, documentation, commits, PR merge, and
routine deployment needed to finish that request. This applies equally to Codex, Claude, and
other agents. Carry the work through to a usable result; do not stop at a draft PR or ask again
for approval already given. Follow an explicit review-only, no-deploy, or other scope limit.

Deliver a coherent feature or fix in a sensible batch. Do not manufacture tiny increments,
separate approvals for each file, numbered preparation gates, or evidence packets. Split work
only when dependencies, rollback risk, or a real product decision justify it. Update useful
documentation when behavior or ownership changes; normal commits and PRs are the work record.

Ask only when a material decision is missing, the work would expand the requested scope, or an
action would destroy data, irreversibly affect people, or create a new financial commitment
not already authorized. Complete independent work while that decision is pending. A routine
production release is not, by itself, a reason to ask. Do not send real messages or initiate
real charges merely to test an application.

Preserve unrelated work and shared history. Use a branch/worktree as useful, inspect concurrent
changes, and resolve routine conflicts. Do not force-push or reset someone else's work.
Current code, configuration, tests, and observed deployments outrank dated prose.

## Verification and reporting

Match verification to the change. Run meaningful tests for changed behavior and required CI;
do not invent tests or rebuild applications solely for Markdown edits. For documentation-only
work, review the diff, validate links and factual claims, and let applicable CI run.
For releases, confirm the deployed revision and relevant checks. Report what shipped and any
material limitation honestly; a green build is not proof of data migration or user acceptance.

## Documentation policy

This is the current agent policy; `CLAUDE.md` imports it. Read only task-relevant references.
Older approval language in plans, runbooks, comments, and archived evidence is superseded by
this working agreement. Keep useful technical procedures and data protections, but do not
revive retired preparation gates, waived baselines, or repeated release signoffs.
The current overhaul status is maintained in
[the architecture plan](https://github.com/timothystl/digital-architecture/blob/main/architecture/11-overhaul-readiness-and-execution-plan.md).
Keep durable instructions here and detailed progress there.

## Runtime and ownership

- `connect-worker.js` serves Connect, Giving, Serve/Scheduler, and legacy Finance as
  `timothy-connect`. Production binds `DB` to `timothy-connect-db`, `KV` to the
  `timothy-connect-kv` namespace, and `PHOTOS` to `timothy-connect-photos`.
- `apps/finance/shell.js` deploys separately as `timothy-finance-app`, with its own
  `timothy-finance-db`. Both applications also have isolated staging configurations.
- Giving stays authoritative in Connect. Finance consumes versioned summaries and relays
  Giving writes to Connect. Payroll currently relays to Website's backend. Finance-owned
  accounting data/writers are being migrated; separate infrastructure is already deployed.
- Legacy Finance settings use `finance_settings`. Runtime `initDb()` and
  `schema_fingerprint` still participate in Connect schema setup; numbered migrations alone
  are not the complete production ledger. Check actual state before schema changes.
- QuickBooks has a historical successful connection; do not repeat “never connected.”
  A stored token or historical sync does not prove current connectivity. Avoid competing
  refresh-token writers when moving that integration.
- TinyMCE is self-hosted from `vendor/tinymce/`; preserve the self-hosted editor.

## Data and authorization

Enforce the server-side permission matrix. UI visibility is not authorization. Council Giving
is aggregate/anonymous only; preserve compensation visibility and per-user draft isolation.
Never expose secrets or personal/giving/payroll records in logs, fixtures, or documentation.
Use managed secrets; read security-sensitive references only when needed, without copying values.

For real data moves, verify the current source/target, take a usable backup, reconcile counts
and financial controls, preserve provenance, and switch authoritative writers deliberately.
Do not seed production with synthetic Finance data or enable unfinished writers as a side
effect of a documentation task. Keep fixtures and production clearly separate.

## Tests and releases

Use Node 22. For application changes run `npm test` and
`node .github/scripts/check-built-scripts.js`; Finance changes also use
`npm run validate:finance` or `npm run validate:finance:prod` for the target configuration.
Add focused regression coverage when useful.

Main merges do not deploy Connect or Finance automatically. Complete a requested application
release by dispatching `.github/workflows/deploy.yml` (Connect) or
`.github/workflows/deploy-finance.yml` (Finance), with the exact tested main SHA and a real
release reason. The working agreement above supplies routine release authorization; the
workflow's “approved SHA” wording does not require another question. Deploy only the affected
application. Documentation-only changes normally need no manual Worker deployment.
