# Finance Extraction — Scoping Work

Captured: September 6, 2026 (session continuation of Preparation 1B)
Policy: analysis and documentation only. No application code, schema, configuration, or deployment was changed to produce this document. Nothing here was committed or pushed (see the repository automation finding in the Preparation 1B evidence record — pushing to this session's branch is itself a production deploy).

This is the scoping deliverable for "pulling the Finance section out to its own app," read against `architecture/11-overhaul-readiness-and-execution-plan.md`'s Implementation phases 3–6 and grounded in the actual current `chms` code, not just the plan's prose.

## 1. What this document is and isn't

- It **is** an inventory of the current Finance surface area, mapped against what Implementation 3–6 actually ask for, so that a future bounded session can pick up one exit gate at a time instead of re-deriving the shape of the problem.
- It **is not** the start of Implementation 3. No Finance module boundaries, route files, query budgets, or deployment configuration were created. No data was copied or reconciled.
- It resolves — rather than leaves ambiguous — the standing question from the prior checkpoint about which gate actually governs "beginning the Finance extraction." See §2.

## 2. Gate status: what actually blocks starting extraction, resolved

The plan's "Immediate safety rules" (verbatim) reads:

> Until Preparation Phase 6 is signed off: ... Do not begin the Finance extraction, repository renames, shared-auth rollout, payroll move, or documentation deletion.

This is a **named, specific gate on Preparation 6** ("Draft the documentation reset"), not on Preparation 2 (the seven-day baseline) and not on Preparation 7 (final Phase 0 go/no-go, which itself only authorizes starting *Implementation 1*, several steps before Finance extraction in the numbered sequence).

Cross-checking against Preparation 6's own text: its work items (review 46 Markdown files against source/config/schema, resolve `SECRETS.md` through credential rotation, draft replacement docs, assign a disposition to every old file, test every documented command/link) have **no stated dependency on Preparation 2's seven-day clock**. They depend on Finance stabilization being real (Preparation 1) and, sensibly, on the operational map and ownership decisions (Preparations 4–5) being far enough along that the new docs describe something true — but nothing ties Preparation 6 to seven consecutive stable days.

**Conclusion, stated plainly:**

- Andrew's waiver ("the seven day window... was just to collect usage data and not needed now") lifts Preparation 2's exit gate for its own stated purpose. It does **not**, on its own, satisfy Preparation 6, which is the gate the plan actually names for extraction.
- Preparation 6 has not been done. Nobody has reviewed the 46 Markdown files against source, resolved `SECRETS.md`, or drafted replacement documentation.
- Preparations 3 (backup/restore), 4 (operational map), and 5 (ownership/permissions/report registry) are also still open, and each one directly informs how extraction should be sequenced (you want the backup/restore of `tlc-volunteer-db` proven before copying `finance_*` history anywhere; you want the ownership matrix resolved before deciding who administers `finance.timothystl.org`'s auth).
- **What this document does is not gated by any of that.** It is read-only analysis — the same character of work the plan's own Executive Summary sanctions as "protection and evidence" happening now: "...finish the ownership/security/report inventories, and only then start separating Finance." Producing the scoping map is part of getting ready to start, not starting.

If a future session is asked to actually **begin** Implementation 3 (create Finance modules/routes/query budgets in the repo), that request should be met with: Preparation 6 is the specific named blocker, it is not done, and here is what it would take (§8 covers a rough size for it, since it was read in full this session).

## 3. Current Finance surface — what actually exists today

Grounded directly in the code, not just CLAUDE.md prose:

| Fact | Value |
|---|---|
| Backend module | `src/api-finance.js` — 4,783 lines |
| Frontend module | `src/frontend/js-finance.js` — 10,865 lines |
| Route dispatch | `src/api-chms.js:619` — `if (seg.startsWith('finance')) handleFinanceApi(...)`. Finance already has a **single, clean route-prefix boundary** in the dispatcher. |
| Frontend bundling | Already split into its own lazily-loaded bundle, `CHMS_APP_FINANCE_JS` served at `/admin/app-finance.js` (P25-E, 2026-08-23) — a real, already-shipped step toward Implementation 3's "Finance can be built/tested/observed independently" exit gate, on the frontend side only. |
| D1 database | One shared database (`DB` binding → `tlc-volunteer-db`, `wrangler.toml:41-43`). No separate Finance datastore exists. |
| Worker | One shared Worker (`tlc-chms`). No separate Finance deployment target exists. |
| Auth/roles | Shared role system: `admin \| finance \| staff \| council \| member \| volunteer`. The `finance` role and the granular per-item permission matrix (`giving`, `finance`, `tuitionaid`, etc.) already exist and are enforced centrally in `api-chms.js`'s `ACCESS_GATE` — this is a real asset for Implementation 4's "authentication integration" work, since the permission *model* Finance would carry into its own app already exists and is tested. |

### Finance-owned D1 tables (all in the shared database today)

`finance_budget_plan`, `finance_church_balances`, `finance_church_entries`, `finance_daycare_entries`, `finance_daycare_rooms`, `finance_import_log`, `finance_property_budget_monthly`, `finance_property_capital_ledger`, `finance_property_distributions`, `finance_property_monthly`, `finance_property_repairs`, `finance_property_reserve_disbursements`, `finance_property_reserves`, `finance_qb_connection`, `finance_qb_snapshot`.

Additionally, several newer Finance features (Chart of Accounts board categories, purpose tags, revenue-stream classification, reserve policy) are stored as JSON blobs inside the **shared** `chms_config` key/value table rather than their own tables (per FIN70/FIN72/FIN57 in `CLAUDE.md`). That is a real complication for Implementation 5 (data move): `chms_config` is not Finance-owned — Connect, Giving, Register, and other features store unrelated settings there too. Splitting Finance's data cleanly means separating out its `chms_config` keys, not just moving the `finance_*` tables.

### Cross-boundary reads — the actual coupling Implementation 2/5 need to solve

Confirmed by grep against `api-finance.js`: Finance reads `funds` and `giving_monthly_fund_totals` directly — both **Giving/Connect-owned** tables, not Finance's own. This is exactly the shape Implementation 2 (versioned contracts) and Implementation 5 ("Connect remains the Giving system of record and sends versioned summaries rather than raw ownership") are written to address. Today there is no contract — Finance does a live JOIN/read against Connect's own giving-rollup tables. Any Finance extraction that changes *where* Finance's code runs (Implementation 4) but leaves this direct-D1-read pattern in place would either require Finance's new Worker to keep a cross-Worker binding into `tlc-volunteer-db`, or would require the summary contract from Implementation 2 to exist first. The plan's own ordering (Implementation 2 before 3) reflects this.

### Non-`finance_*` Finance-adjacent surface, not yet inventoried above

- **Tuition Aid Planner** (`tuition_students`, `tuition_config`, `tuition_history`, `tuition_year_rates`, `tuition_student_years`) — finance-adjacent (aid budgeting), reads People records, gated by the `tuitionaid` permission item. Its own module boundary already exists at the code level (mentioned throughout `CLAUDE.md`'s TAP-series entries) but was not counted in the line totals above; it is a design question for a later session whether it moves with Finance or stays with Connect (it touches individual student/family records, which is more "People" than "Finance").
- **QuickBooks OAuth integration** — largely abandoned per `CLAUDE.md` (`FIN2`): live QuickBooks API sync was set aside in favor of month-by-month CSV/Excel imports after repeated `5020 Permission Denied` failures on the `BudgetVsActuals` report endpoint, confirmed unsupported by Intuit. `finance_qb_connection`/`finance_qb_snapshot` still exist and the connect/disconnect UI is still live, but it is not load-bearing for current Finance workflows. Worth a deliberate decision (retire vs. keep) rather than silently carrying it into a new app.
- **Commercial Property (3277 Ivanhoe)** — a real, actively-used sub-area (reserves, capital ledger, repairs, valuation calculator, mortgage amortization) entirely inside `finance_property_*` tables. Self-contained; no cross-references found outside Finance's own module.
- **Payroll** — does **not** exist in `chms` at all today. It is a completely separate system in the `website` repository's admin (`admin.timothystl.org`), backed by its own Supabase project (`dahdstopsumxnqvdclmy`), proxied through a `/sb/` reverse-proxy authenticated by session plus fourteen narrow `SECURITY DEFINER` Postgres RPC functions gated by a shared secret. This is Implementation 6's entire scope, and it is a different repository, different datastore, and different auth model than everything else described in this document. It should be treated as its own, later, and largely independent piece of work — moving it "into Finance" per Implementation 6 means building a bridge between two systems that share no code today, not extending anything already in `chms`.

## 4. Mapping to Implementation 3 — "Separate Finance inside the existing repository"

Exit gate: *Finance can be built, tested, and observed independently; Connect behavior is unchanged.*

What's already true:
- Route-prefix boundary exists (`seg.startsWith('finance')`).
- Frontend bundle boundary exists and is already lazy-loaded independently of the rest of the app.
- Role/permission model for `finance` is already a first-class, tested concept.

What Implementation 3 would still require, if a future session is authorized to do it:
1. **Query budgets.** The plan's own D1 evidence names Finance-adjacent queries (a fund-total aggregation reading ~406k rows across 12 calls, an import-status lookup reading ~71k rows across 6 calls) as the largest contributors to the read-amplification incident PR #828 addressed. Implementation 3 asks for *explicit* query budgets per Finance action — this has not been done; PR #828 fixed specific hot paths but did not establish a named, monitored budget per action the way Preparation 2 (still open) is meant to produce.
2. **Deployment configuration split.** There is currently one `wrangler.toml`. Implementation 3 keeps the same hostname and database but wants Finance's code path to be independently deployable/observable — this likely means either a second `wrangler.toml`/Worker-within-the-repo pattern, or CI/test gating that can run Finance's own test suite in isolation. Not yet designed.
3. **Test isolation.** Finance already has a large body of tests (dozens of `test/finance-*.test.js` files per `CLAUDE.md`'s changelog), but they run inside the same `npm test` suite as everything else. Whether "observed independently" requires a separate CI job is an open design choice, not yet decided.
4. **The `chms_config` split** (§3) needs a decision: either give Finance-owned config keys their own table now, or explicitly accept that Implementation 3 will still share `chms_config` and defer the split to Implementation 5.

This is the phase Preparation 6's sign-off gates. Nothing above should be built until that sign-off exists.

## 5. Mapping to Implementation 4 — "Stand up `finance.timothystl.org` read-only"

Exit gate: *report totals, permissions, errors, latency, and D1 usage reconcile over an agreed observation window.*

This is the first phase that requires a genuinely new deployment target (separate Worker/app, separate hostname, its own auth integration in staging then shadow production). Because the existing `finance` role and permission-gate logic is already centralized and tested (§3), the *authorization* half of this is comparatively low-risk to reproduce. The harder half is that "read-only shadow mode... consume existing data/contracts" runs straight into §3's cross-boundary-read finding: today Finance's own backend reads Connect's `funds`/`giving_monthly_fund_totals` tables directly via the shared D1 binding. A shadow-mode Finance Worker would need either its own binding into the same `tlc-volunteer-db` (extending the shared-database blast radius Implementation 5 exists to end, just to a second Worker) or a real Giving-summary contract (Implementation 2) to consume instead. Sequencing this before Implementation 2 exists would mean building the shadow app against an interface that is about to change.

## 6. Mapping to Implementation 5 — "Move Finance-owned data"

Exit gate: *Finance owns its database and failures no longer consume Connect's D1 budget or block Connect workflows.*

The fourteen `finance_*` tables listed in §3 are the direct copy target. Two things this scoping pass surfaces that the plan's generic wording doesn't call out by name:
1. **The `chms_config` blob keys** (board categories, purpose tags, revenue-stream classification, reserve policy) are not `finance_*` tables and will be missed by a naive "copy every `finance_*` table" migration. They need to be identified and either migrated or left in place with Finance reading them cross-database (which reintroduces exactly the coupling Implementation 5 is meant to remove).
2. **Commercial Property and Tuition Aid** are the two sub-areas most likely to have a real ownership question at data-move time — Commercial Property is unambiguously Finance's; Tuition Aid touches individual People records and may belong with Connect regardless of where its budgeting UI lives. This should be an explicit decision in Preparation 5 (duplication/ownership audit), not discovered during the data move.

## 7. Mapping to Implementation 6 — "Move payroll into Finance"

Exit gate: *exact reconciliation and permission review pass; Website Admin payroll is retired only after stabilization.*

As noted in §3, this is not an extension of anything currently in `chms` — it is a separate repository (`website`), a separate datastore (Supabase, project `dahdstopsumxnqvdclmy`), and a separate auth path (`/sb/` proxy + RPC functions with a shared secret). This phase should be scoped as its own project once Implementations 3–5 have actually landed and Finance has a real, independent home to move payroll *into*. Attempting to fold it into an early Finance-extraction session would mean designing against a Finance app that doesn't exist yet.

## 8. What Preparation 6 (the actual current gate) would take

Since this session read Preparation 6's full text (see Preparation 1B's sibling checkpoint, `AI_SESSION_START_HERE.md`, for the phase list), it's worth recording its rough shape here for whoever picks it up next:

- Review of 46 Markdown files (43,207 lines, per the "Where preparation stands" table) against source, deployed config, schema, and staff workflow — this is a large, multi-session task on its own, not a quick pass.
- `chms/SECRETS.md` needs to go through credential inventory and rotation, not just deletion.
- Draft canonical replacement docs (README, AGENTS, Architecture, Data Ownership, Operations, Security, Testing, ADRs, verified user manuals) *outside* the active repository trees.
- A retain/rewrite/merge/convert/remove disposition for every one of the 46 files.
- Every documented command and link tested.

This is realistically several bounded sessions on its own, separate from and not blocked by the seven-day baseline Andrew waived.

## 9. Recommended next bounded sessions, in order

1. **Preparation 6, split by product** — given the 46-file/43k-line size, this likely wants the same "one product per session" treatment Preparation 4 already prescribes for itself: Website docs, Connect docs, Finance docs, myMDO docs, cross-cutting docs (SECRETS.md, README, AGENTS) as separate sessions.
2. **Preparation 3 (backup/restore) and Preparation 4 (operational map)** can run in parallel with #1, per the plan's own "Session 3" guidance ("work can alternate between one backup/restore packet and one operational-inventory packet").
3. **Preparation 5 (ownership/permissions/duplication/report registry)** — the Tuition Aid and `chms_config`-key ownership questions raised in §6 belong here.
4. Only after 1–3 (and Preparation 7's formal go/no-go) should a session be bounded to actually *begin* Implementation 1 (safe deployment boundaries) and Implementation 2 (cross-product contracts) — both of which are explicit prerequisites the plan places *before* Implementation 3, and both of which this scoping pass shows are genuinely needed (the query-budget and Giving-summary-contract gaps in §4–§5 are not paperwork; they are real technical dependencies).

## 10. What was and wasn't done this session

- Read: the full architecture plan (`11-overhaul-readiness-and-execution-plan.md`), the Preparation 1B evidence record, and targeted greps/line-counts against the live `chms` source tree (file sizes, table names, route dispatch, wrangler bindings) — no broad repository survey, no test runs, no D1 queries beyond what was already captured in the Preparation 1B record.
- Not done: any code, schema, configuration, or deployment change; any git commit or push; any Preparation 6/3/4/5 work itself (only its shape was mapped, per this document).
