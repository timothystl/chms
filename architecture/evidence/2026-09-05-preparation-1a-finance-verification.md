# Preparation 1A Evidence — Finance/Giving Stabilization

Verified: September 5, 2026, 10:27 p.m. CDT  
Policy: read-only production inspection; no application, schema, deployment, or configuration changes

## Source state

- Verification used a disposable detached worktree at `origin/main` commit `e7f4604b74e6d4b8fe69db596fd6c67c3a21e512`.
- Existing Website, `chms`, and myMDO checkouts were not modified.
- PR #828 merged as `3d37ac7c98160233913d13b64c8f53830d70a8c2` with parents `6ff257a` and `2b4e22f`.
- The PR changed eight functional/test files plus `NOTES.md` and added migration `0048_giving_import_and_finance_indexes.sql`.
- Migration `0047_giving_rollup_claims.sql` is reachable from `origin/main` through commit `c64deab`.

## Automated verification

| Check | Result |
|---|---|
| Focused six-file Finance/Giving run | 6 files passed; 36 tests passed |
| First full parallel run | 145 files passed, 1 failed; 2,238 tests passed, 1 timed out, 5 skipped |
| Isolated rerun of timed-out test | 26/26 passed; the specific 20,000-row guard completed in 917 ms |
| Full run with `--maxWorkers=1` | 146/146 files passed; 2,239 passed, 5 skipped |
| Built HTML script parser | Both script blocks passed |

The only first-run failure was a five-second timeout in `test/giving-offerings.test.js` while the full suite ran concurrently. It passed immediately in isolation and the complete suite passed with one worker. This is evidence of test-suite timing sensitivity, not a reproduced functional failure, but the timeout should remain visible rather than being silently described as an unconditional green parallel run.

## Production D1 evidence

Read-only queries were run through the signed-in Cloudflare D1 console for `tlc-volunteer-db`.

Present in `sqlite_master`:

- table `giving_year_rollup_claims`;
- trigger `trg_giving_year_rollup_claim_begin`;
- index `idx_church_balances_source_synced`; and
- index `idx_giving_breeze`.

The `chms_config` rows `schema_fingerprint` and `giving_breeze_dedupe_v1` are present. `giving_year_rollup_claims` contained zero rows, so no claim was stuck at the time of inspection.

## Migration architecture finding

Cloudflare’s `d1_migrations` table records only migrations `0001` through `0003`. It does not record `0047` or `0048` as Wrangler-applied migrations.

This does not mean the new schema is absent: the relevant production table, trigger, indexes, and one-time marker are present. Source inspection explains why. `.github/workflows/deploy.yml` deploys the Worker but does not call `wrangler d1 migrations apply`. Instead, `src/db.js` hashes a large runtime schema initializer and, when the fingerprint changes, applies guarded DDL and data-maintenance statements on the first Worker request.

Consequences to address later:

1. The numbered migration directory is not the authoritative production ledger.
2. A new deploy can make the first request perform a large collection of schema/data operations.
3. Deployment success does not independently prove that runtime initialization completed without logged errors.
4. Schema rollback and environment comparison are harder because code deployment and schema application are coupled.

Do not change this mechanism during stabilization. Design its replacement under a separately approved deployment-architecture phase.

## Exit assessment

Preparation 1A is complete:

- merged source is independently recoverable;
- current main passes the full suite in deterministic single-worker mode;
- production contains the expected Finance/Giving hardening objects and markers; and
- no stuck rollup claim was observed.

Still open before declaring Finance stabilized:

- identify and record the exact active Cloudflare Worker deployment/version and its Git commit;
- inspect recent Worker logs for runtime migration, rollup-claim, and Finance errors;
- collect a clean post-hardening D1 usage snapshot, including top SQL and rows read per query;
- reconcile aggregate Finance/Giving control totals using a deliberately approved query plan; and
- observe stability for 24–48 hours before starting the seven-day baseline.

## Next approval point

The next bounded session should perform read-only **Preparation 1B: production deployment identity and stabilization snapshot**. It should not edit code or deploy.
