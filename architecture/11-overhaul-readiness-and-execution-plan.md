# Overhaul Readiness and Execution Plan

Status snapshot: September 5, 2026, updated 10:09 p.m. CDT  
Scope: `website`, `chms` (Connect/Finance/Serve/Scheduler), and `childcare-portal` / myMDO  
Change policy: diagnosis and documentation only in this assessment

## Executive Summary

- **The architecture direction is ready; the systems are not yet ready to move.** The four-product model—Church Website, Connect, Finance, and myMDO—is coherent and should remain the target.
- **Finance remediation is merged but still needs verification.** Finance/Giving hardening, including the formerly local work, was merged through PR #828. The current task is to verify the merged `origin/main` state, production migration status, tests, and control totals—not to preserve or recreate old local commits.
- **The seven-day baseline must restart.** The Cloudflare 24-hour window includes both old and newly deployed behavior. It shows the original amplification clearly but cannot measure the effect of the final fixes.
- **The next work is protection and evidence, not extraction.** Preserve the local Finance work, finish its stabilization safely, prove backups through restoration, collect a clean baseline, finish the ownership/security/report inventories, and only then start separating Finance.

## Where preparation stands

| Area | State | Evidence | Gate before overhaul |
|---|---|---|---|
| Product boundaries | Substantially decided | Four-product architecture and domain ownership documents exist | Confirm owners and unresolved overlaps |
| Current deployment map | Partially documented | Source configs identify Website's three Workers, shared `tlc-chms`, two D1 databases, R2/KV, and myMDO Worker/Supabase | Verify every live route, binding, cron, deployment path, and owner against production |
| Finance D1 remediation | Active stabilization | PR #828 merged the Finance/Giving hardening; the old local tree matches merged commit `2b4e22f`; 121 focused tests previously passed | Verify current main, rerun focused/full tests, confirm migration status, reconcile totals, and monitor |
| D1 baseline | Invalid/mixed | Latest snapshot spans pre-fix and post-fix behavior | Seven consecutive stable days after the final stabilization deployment |
| Backups | Procedure defined; completion not evidenced | Backup/restore document exists; no completed restore record was found | Restore both D1 databases, Cloudflare object stores as applicable, and Supabase into disposable targets |
| Authentication/permissions | Direction decided; matrix incomplete | Shared identity principles exist; permission matrix still contains `TBD` values | Named role matrix approved by responsible staff |
| Duplication audit | Skeleton only | Major overlapping domains are listed | Field/workflow-level decisions with authoritative writers and migration disposition |
| Reporting inventory | Skeleton only | Report areas are listed | Every active report, definition, owner, source, permission, and control total recorded |
| Repository documentation | Structural inventory complete | 46 Markdown files / 43,207 lines classified provisionally | Verify content and approve a disposition for every file before replacement |
| Deployment safety | Needs tightening | Several merge workflows deploy automatically to production | Manual overhaul release gate, environment proof, immutable rollback point, and post-deploy checks |

## What the current D1 evidence says

The controlling metric for this diagnosis is **rows read**, not request count. Cloudflare bills and limits D1 around rows scanned, so a small number of broad queries can cost more than thousands of indexed lookups.

At approximately 5:45 p.m. CDT on September 5, the Cloudflare last-24-hours views showed:

| Database | Queries | Rows read | Approx. rows read/query | Interpretation |
|---|---:|---:|---:|---|
| `tlc-volunteer-db` (Connect/Finance) | 4.71k | 2.30M | 488 | Lower request volume but high scan amplification |
| `tlc-newsletter-db` (Website Admin) | 15.51k | 217.01k | 14 | More requests, far fewer rows scanned per request |

Connect/Finance therefore read about **10.6 times** as many rows despite processing less than one-third as many queries. Its approximate rows-read-per-query rate was about **35 times** Website Admin's.

The largest visible Connect/Finance contributors in that mixed window included:

- a fund-total aggregation: about 406k rows across 12 calls;
- an import-status lookup: about 71k rows across 6 calls; and
- a Giving identifier scan: about 85k rows across 5 calls.

Those observations support the read-amplification diagnosis, but they do not yet judge the fixes. The final merged Finance optimization deployed around 5:35 p.m. CDT, only about ten minutes before the snapshot. The dashboard also rounded headline cards differently from detailed chart totals; this plan uses the chart totals and treats the discrepancy as a reporting caveat.

## Immediate safety rules

Until Preparation Phase 6 is signed off:

- Do not apply or redeploy migration `0047` until its current production status is established, the merged branch is fully tested, and approval is recorded.
- Do not reset or rebase the existing local `chms` checkout merely to make it match main; verification should use a disposable worktree.
- Do not begin the Finance extraction, repository renames, shared-auth rollout, payroll move, or documentation deletion.
- Do not add unrelated Finance features while stabilization and baseline measurement are open.
- Emergency production fixes must be narrowly scoped, separately recorded, and restart the affected baseline window.
- Continue ordinary staff use. Record unusual imports, repeated Finance refreshes, bulk work, errors, or slow pages when practical; missing manual activity notes do not invalidate authoritative platform metrics.

## Preparation phases

Each phase is designed to be one manageable work packet or a small number of clearly bounded sessions. A phase ends with a written checkpoint; finishing tasks is not enough if the exit evidence is absent.

### Preparation 0 — Confirm Finance work is preserved — COMPLETE

**Goal:** confirm the formerly local Finance hardening is recoverable from the remote repository.

Work:

Completed evidence:

1. PR #828 merged as `3d37ac7`; the feature tip `2b4e22f` is reachable from `origin/main`.
2. The clean local branch tip is `3098677`. Its tree is identical to `2b4e22f` (`git diff --stat 3098677 2b4e22f` is empty).
3. Remote Git history now provides the independent recovery path. Production application status of migration `0047` remains to be verified in Preparation 1.

Exit gate: met for source preservation. Migration/deployment verification remains open.

### Preparation 1 — Finish Finance stabilization in place — IN PROGRESS

**Goal:** close the D1 incident without mixing in the future architecture move.

Work:

1. Start from current `origin/main`, which already contains the merged optimizations.
2. Reapply or cherry-pick only the additional rollup-claim/concurrency change after reviewing it against migrations `0045` and `0046`.
3. Retain the successful 121-test focused run as evidence, then run the full suite, migration-forward test, failure/retry test, and control-total reconciliation.
5. Apply to staging first; test simultaneous first-loads, a mid-refresh write, a failed rebuild, and stale-claim recovery.
6. Obtain explicit production go/no-go approval, deploy once, and record SHA, migration, time, and rollback steps.
7. Observe errors and reconciliations for 24–48 hours.

Exit gate: tests are green or any exception is formally accepted; staging and production control totals match; no stuck claim or repeated broad rebuild is observed.

Preparation 1A was completed on September 5 at 10:27 p.m. CDT. Current main passed all 146 test files in deterministic single-worker mode; production contains the expected rollup-claim and index objects with no stuck claim. See `evidence/2026-09-05-preparation-1a-finance-verification.md`. Deployment identity, recent error review, usage snapshot, aggregate reconciliation, and the 24–48 hour observation remain open.

### Preparation 2 — Freeze and collect a clean baseline

**Goal:** establish the normal post-remediation cost and behavior of each database.

Work:

1. Start the clock only after Preparation 1's last deployment and stabilization check.
2. For seven consecutive full days, capture per database: total queries, read queries, write queries, rows read, rows written, latency percentiles, errors, and top SQL statements.
3. Record known operator activity without expecting perfect manual coverage.
4. Separate Website Admin from Connect/Finance and distinguish ordinary staff use from imports or bulk jobs.
5. Establish healthy query budgets for opening Connect, opening each Finance tab, changing year, importing data, and refreshing summaries.
6. Flag any query whose rows-read/rows-returned ratio or repeated execution remains disproportionate.

Exit gate: seven stable days with no architecture-affecting deployment, plus an approved baseline and per-action Finance query budget.

### Preparation 3 — Prove backups and recovery

**Goal:** know that every system can be restored before moving data or ownership.

Complete one datastore per session:

1. Git repositories and production SHAs/tags.
2. `tlc-newsletter-db` full schema/data export and disposable restore.
3. `tlc-volunteer-db` full schema/data export and disposable restore, including monetary control totals.
4. Cloudflare KV and both R2 buckets: inventory, export/replication method, and restore sampling.
5. myMDO Supabase Postgres: schema, data, functions, grants, RLS, Auth configuration, and disposable restore.
6. Supabase Storage and Edge Functions/configuration separately.
7. Record encrypted backup location, operator, duration, commands/procedure, counts, checksums, and restore result.

Exit gate: each backup has passed a restore test; “downloaded successfully” is not sufficient.

### Preparation 4 — Complete the operational map

**Goal:** turn repository discoveries into an authoritative operating catalog.

Review one product per session:

1. Church Website and Website Admin.
2. Connect, Giving, Serve, and Scheduler within `tlc-chms`.
3. Finance within `tlc-chms`.
4. myMDO Worker, Supabase, and payment/messaging dependencies.
5. Cross-product service calls and failure paths.

For every live surface record:

`hostname → product → Worker/Function → repository/SHA → route → bindings → datastore → deploy workflow → owner → runbook → rollback`

Exit gate: every production hostname, Worker, service binding, D1/Supabase store, KV/R2 bucket, cron, webhook, and deployer has one named owner and recovery path.

### Preparation 5 — Finish ownership, permissions, reports, and duplication decisions

**Goal:** decide what moves before designing how it moves.

Work packets:

1. Resolve every `TBD` in the role/permission matrix.
2. Complete the field-level duplication audit for people/staff, Giving/Finance, payroll/PTO, events, messaging, documents, facilities, and audit history.
3. Name the authoritative writer and permitted readers for each fact.
4. Populate the report registry, beginning with every Finance screen/export and its control totals.
5. Define retention, sensitivity, and audit requirements for HR, payroll, giving, children/families, and payments.
6. Confirm staff workflow ownership with the Website editor, MDO administrator, clock-in staff, treasurer/finance operator, and cross-system administrator.

Exit gate: no data or workflow selected for migration has an unresolved owner, writer, permission, or report definition.

### Preparation 6 — Draft the documentation reset

**Goal:** prepare trustworthy replacement documentation without erasing evidence.

Work:

1. Review all 46 Markdown files against source, deployed configuration, schema, and staff workflow.
2. Resolve `chms/SECRETS.md` through credential inventory and rotation; deletion alone is not remediation.
3. Draft canonical README, AGENTS, Architecture, Data Ownership, Operations, Security, Testing, ADRs, and verified user manuals outside the active repository trees.
4. Give each old document a final retain/rewrite/merge/convert/remove decision.
5. Test every documented command and link.

Exit gate: replacement drafts are approved, every old file has a traceable disposition, and no secret value appears in active documentation.

### Preparation 7 — Phase 0 signoff

**Goal:** make a deliberate go/no-go decision for the overhaul.

Required packet:

- post-fix D1 baseline and query budgets;
- Finance stabilization evidence;
- verified backup/restore record;
- operational/dependency catalog;
- approved domain and permission matrices;
- duplication decisions and report registry;
- documentation disposition manifest;
- implementation risk register, release gate, and rollback owners.

Exit gate: written approval to start only the first implementation phase. Approval does not authorize every later phase.

## Overhaul implementation phases

### Implementation 1 — Establish safe deployment boundaries

Add production release approval, environment checks, migrations preview, rollback capture, and post-deploy smoke checks. Keep product behavior unchanged. Do not split repositories yet.

Exit gate: an architecture change cannot auto-merge directly into production without a deliberate release decision.

### Implementation 2 — Define cross-product contracts

Version the narrow interfaces for Giving summaries, Finance projections, myMDO finance/payroll summaries, person references, facility submissions, and message delivery. Add contract/reconciliation tests without moving authoritative ownership.

Exit gate: producers and consumers agree on schema, permissions, failure behavior, versioning, and deprecation.

### Implementation 3 — Separate Finance inside the existing repository

Create explicit Finance modules, route boundaries, query budgets, tests, and deployment configuration while retaining the existing database and production hostname. This is a code-ownership split, not a data cutover.

Exit gate: Finance can be built, tested, and observed independently; Connect behavior is unchanged.

### Implementation 4 — Stand up `finance.timothystl.org` read-only

Deploy a separate Finance Worker/application and authentication integration in staging, then production read-only shadow mode. Initially consume existing data/contracts and compare every report to the current Finance screens.

Exit gate: report totals, permissions, errors, latency, and D1 usage reconcile over an agreed observation window.

### Implementation 5 — Move Finance-owned data

Create the Finance datastore, copy current `finance_*` history, dual-validate or shadow-read, reconcile monetary totals, and cut over one bounded domain at a time. Connect remains the Giving system of record and sends versioned summaries rather than raw ownership.

Exit gate: Finance owns its database and failures no longer consume Connect's D1 budget or block Connect workflows.

### Implementation 6 — Move payroll into Finance

Inventory and reproduce Website Admin payroll calculations, myMDO input/approval, HR terms, period close, exports, and audit behavior. Shadow multiple periods before cutover.

Exit gate: exact reconciliation and permission review pass; Website Admin payroll is retired only after stabilization.

### Implementation 7 — Consolidate staff identity

Prove shared standards-based identity in staging, retain product-specific authorization, test account linking, MFA, recovery, session revocation, and offboarding, then migrate one product at a time.

Exit gate: one staff sign-in does not broaden access, and old authentication paths/sessions are safely retired.

### Implementation 8 — Add or re-home church capabilities one at a time

Order:

1. Facilities, beginning with existing gym rental and adding repairs/providers.
2. Governance/council document records.
3. Restricted church HR.
4. Communications and texting.
5. Reporting improvements tied to the completed registry.

Re-home existing workflows before building replacements. myMDO remains the MDO work surface and does not receive a separate HR application.

Exit gate: each module has one owner, permission model, report set, backup, and rollback before the next begins.

### Implementation 9 — Split Serve/Scheduler only if evidence supports it

Keep staff management inside Connect. Separate backends only if measured load, failure isolation, security, deployment cadence, or ownership justifies the added operational cost.

Exit gate: a written decision records either the proven benefit of separation or the reason to keep the shared deployment.

### Implementation 10 — Rename repositories and complete documentation replacement

Rename `childcare-portal` to `mymdo` as a dedicated non-functional change. Consider `chms` to `connect` only after Finance extraction. Replace approved documentation one repository at a time, preserve licenses/manuals, update remotes/CI/routes/runbooks, and retain rollback tags.

Exit gate: names match ownership, links and deployers work, fresh-developer orientation succeeds, and obsolete documents no longer compete as sources of truth.

## The next three manageable work sessions

### Session 1 — Verify merged Finance stabilization — COMPLETE

- Use a disposable worktree at current `origin/main`.
- Inspect only PR #828’s change set and directly related tests, migrations, and deploy configuration.
- Rerun focused and full tests, determine migration `0047` production status without applying it, and write a compact evidence record.
- Do not normalize the existing checkout or deploy.

### Session 2 — Record deployment identity and stabilization snapshot

- Read the Preparation 1A evidence without rerunning its survey or tests.
- Correlate the active Cloudflare Worker version and timestamp to GitHub deployment evidence.
- Inspect relevant recent errors and capture one post-hardening D1 usage/top-SQL snapshot without generating traffic.
- Decide whether the 24–48 hour stabilization observation can begin, then stop without code or deployment changes.

### Session 3 — Close stabilization and start the new clock

- After approved staging validation, deploy the narrow fix once.
- Record the exact production SHA/migration/time.
- Complete the 24–48 hour error and reconciliation check.
- Declare the clean seven-day baseline start only when stable.

After these sessions, work can alternate between one backup/restore packet and one operational-inventory packet while the seven-day clock runs. Do not wait idly, but do not change production behavior during that measurement window.

## Further decisions needed later

- Which identity provider and account-recovery model will serve church staff?
- Who is the product owner and release approver for Website, Connect, Finance, and myMDO?
- What exact D1 budget is acceptable for each common Finance action after the stable baseline?
- Which issue tracker will replace long Markdown backlogs and implementation diaries?
- Does the current Finance concurrency claim mechanism remain necessary after observing real post-fix contention?
- Which myMDO website changes truly need staff controls beyond the current seasonal switches?

## Caveats and assumptions

- The D1 snapshot is an authoritative dashboard view but covers a mixed pre/post-deployment 24-hour period; it diagnoses concentration, not improvement.
- Successful GitHub workflow runs establish that automation completed, not that business totals, permissions, or every user workflow were validated.
- Source configuration describes intended deployment. Phase 0 still requires production confirmation of all routes, bindings, secrets by name, and versions.
- No completed external backup/restore evidence was found in the architecture output set; existing private evidence may exist and should be added rather than repeated.
- The local `chms` changes belong to the user. They became five clean local commits during this assessment, including rollup serialization and a DST correction; this assessment did not push or otherwise preserve them outside the current repository.
