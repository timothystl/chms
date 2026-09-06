# Preparation 1B Evidence — Deployment Identity and Stabilization Snapshot

Captured: September 6, 2026, ~06:21 a.m. CDT (11:21:21 UTC, per `SELECT datetime('now')` against production D1)
Policy: read-only production inspection; no application, schema, deployment, or configuration changes. Nothing in this session was committed or pushed to any branch (see "Repository automation finding," which is why).

## Active deployment identity

- Cloudflare Worker `tlc-chms` (resource id `1900eba5bebb4f9d8e6bbe0f582f5963`), `modified_on` **2026-09-06T03:58:56.700Z**.
- The live bundle (`workers_get_worker_code`) embeds `DEPLOY_VERSION = "1.230.0"`, matching the value in `src/frontend/js-core.js` at the local repository's current `HEAD` (`e37f34561f22b9e0943cefdac5246f3213db6fcf`).
- GitHub Actions run correlating to that `modified_on` timestamp: **run #884** (id `34010317190`), workflow `Deploy to Cloudflare Workers`, event `push` to `main`, `head_sha e37f34561f22b9e0943cefdac5246f3213db6fcf` ("Add files via upload" — the architecture-documentation commit), conclusion `success`, `created_at 2026-09-06T03:58:30Z`, `updated_at 2026-09-06T03:59:02Z`. The Worker's own `modified_on` (03:58:56Z) falls inside that window, which is the correlation.
- That commit changed no application source (`architecture/**` and `Timothy_Applications_Architecture_Blueprint.md` only), so this deploy did not change what is running — it re-deployed the same bundle that was already live.

### The three most recent deploys, in order

| Run | Trigger | Commit | What changed | Went live |
|---|---|---|---|---|
| #882 (id `33998147510`) | push (PR #828 merge) | `3d37ac7` | Finance/Giving D1 read hardening — `src/db.js`, `src/api-finance.js`, `src/api-households.js`, `src/api-import.js`, migration `0048_giving_import_and_finance_indexes.sql` | 2026-09-05T23:15:20Z |
| #883 (id `34000318993`) | workflow_dispatch | `e7f4604` | Chart of Accounts board-category work (FIN75) — `src/api-finance.js`, `src/frontend/js-finance.js`, `src/frontend/js-core.js` (bumped `DEPLOY_VERSION` to 1.230.0) | 2026-09-06T00:04:46Z |
| #884 (id `34010317190`) | push | `e37f345` | Documentation only (`architecture/**`) — no source change | 2026-09-06T03:59:02Z |

All three: `conclusion: success`. No failed or in-progress deploy runs were observed in this window.

**Overlap check, read directly from `git show --stat`:** run #883's commit (`e7f4604`) touches `src/api-finance.js` in addition to `src/frontend/js-finance.js`/`js-core.js`, but does **not** touch `src/api-giving.js`, `src/api-households.js`, `src/api-import.js`, `src/db.js`, or any migration file — the files PR #828's hardening (`3d37ac7`) actually changed. The two commits both touch `src/api-finance.js`, but for unrelated reasons (board-category constants vs. finance-index/read-hardening); nothing in `e7f4604` or `e37f345` has modified the giving-rollup-claim/dedupe/finance-index objects that PR #828 introduced.

## Production D1 snapshot (read-only, direct SQL against `tlc-volunteer-db`)

No test traffic was generated. Only the introspection queries below were run.

| Query | Result |
|---|---|
| `chms_config` → `giving_breeze_dedupe_v1` | `2026-09-05 23:53:26` — the one-time dedup marker fired ~38 minutes after PR #828 went live, consistent with the runtime schema-fingerprint initializer running on the first real request after that deploy |
| `chms_config` → `schema_fingerprint` | `vcd6x5-1q5q` — captured here as the first recorded literal value; nothing to diff it against yet, but it is now on record for the next snapshot |
| `SELECT COUNT(*) FROM giving_year_rollup_claims` | `0` — no stuck claim, unchanged from Preparation 1A's finding |
| `SELECT id FROM d1_migrations` | `1, 2, 3` only — confirms 1A's finding again: Wrangler's ledger still does not record `0047`/`0048` |
| `audit_log` activity in the trailing 2 hours | `0` rows, latest `ts` = `NULL` in that window | Not itself a health signal — `audit_log` only records specific staff-mutating actions, not general traffic, and 11:21 UTC is early morning Central time |

**Not obtainable from this session's tool surface:** platform-level D1 analytics (queries/minute, rows read or written per query, per-statement error counts, top SQL by cost). Preparation 1A's equivalent evidence came from a human, signed-in Cloudflare dashboard session; this session's Cloudflare MCP tools expose Worker/D1 resource metadata and direct SQL execution, but no GraphQL Analytics or Metrics endpoint. This part of the task is genuinely open pending either dashboard access or a tool that exposes it.

## Worker log inspection

**Not performed — no tool available.** This session has no log-tailing, Logpush, or observability API tool for Cloudflare Workers. `wrangler tail` requires a live terminal/API-token session this environment does not expose as a callable tool. Recent-error inspection (runtime migration, rollup-claim, D1, Finance) therefore still requires the Cloudflare dashboard's Logs/Observability view, the same as Preparation 1A's D1 evidence did.

## Stabilization window

The 24–48 hour observation **can be considered underway, not newly started, and not yet complete.**

- Anchored at the most recent deploy that changed application code (run #883, live **2026-09-06T00:04:46Z**): **~11h 17m** elapsed as of this snapshot (2026-09-06T11:21:21Z). Within the 24–48h window.
- The Finance/Giving hardening itself (PR #828) has been continuously live and unmodified — per the overlap check above — for **~12h 6m** (since 2026-09-05T23:15:20Z).
- The most recent deploy (run #884, docs-only) does not reset this clock in any functional sense; it redeployed an unchanged bundle.

Do not yet declare the 7-day baseline complete.

## Repository automation finding (new, not in Preparation 1A)

`.github/workflows/auto-merge-claude.yml` auto-merges **any push to a `claude/**` branch straight into `main`**, with no PR review step required — and `deploy.yml` deploys on every push to `main`. This session's assigned branch for this repo is `claude/prep-1a-setup-1eovrx`.

Consequence: committing this evidence record and pushing it to that branch would automatically merge to `main` and trigger a Cloudflare Worker deployment — a real, if functionally inert (docs-only), production deployment with no separate approval, which both this checkpoint's standing safety constraints and the Preparation 1B task instructions explicitly forbid.

**Action taken:** this evidence file and the updated checkpoint were written to the local working tree only. Nothing was `git add`ed, committed, or pushed. No deploy occurred as a result of this session's work.

## Exit assessment

Deployment identity is established and correlated to its GitHub Actions run with a tight timestamp match. Production D1 state is consistent with Preparation 1A's findings four checks later (no stuck claim, migrations ledger unchanged, dedup marker present). The stabilization clock has meaningfully progressed (~11–12 hours) without any observed deploy failure.

Still open, unchanged from 1A, now with the added and more specific gap that this session's tool surface cannot close on its own:

- Worker log inspection (needs dashboard or a logs/observability tool).
- Platform-level D1 usage analytics — top SQL, rows read/written per query (needs dashboard or a GraphQL Analytics tool).
- Control-total reconciliation via an approved query plan (not attempted this session — out of scope for 1B and explicitly deferred: "Do not run broad production reconciliation queries").
- Completing the 24–48h observation and then the 7-day baseline.

## Next approval point

The next bounded session should either (a) complete the two log/analytics gaps above via dashboard access, if a human is available to gather them, or (b) simply re-run this snapshot after the observation window has fully elapsed. It should not begin Finance extraction, and — per the automation finding above — any session that wants this documentation actually landed in git should push it deliberately, with the person authorizing it aware that doing so will trigger a (docs-only) production deploy.
