# CLAUDE.md — TLC Volunteer / ChMS App

Read this at the start of every session. Update NOTES.md (and this file if needed) as items are discovered, fixed, or queued.

---

## What This App Is

Church Management System (ChMS) for Timothy Lutheran Church. Built on **Cloudflare Workers + D1 (SQLite)**. Single-page app served from `src/html-chms.js` (renders as one large HTML string). API routes live in `src/api-chms.js` (people, giving, households, dashboard) and `src/api-admin.js` (auth, users, scheduler).

**Live at:** `https://[subdomain].timothystl.org/chms`

---

## Key Files

| File | Purpose |
|------|---------|
| `tlc-volunteer-worker.js` | Worker entry point — routes all requests |
| `src/api-admin.js` | Auth, user management, scheduler API |
| `src/api-chms.js` | People, households, giving, dashboard, import |
| `src/html-chms.js` | Entire frontend SPA (HTML + CSS + JS as a string) |
| `src/auth.js` | Cookie auth, PBKDF2 password hashing, helpers |
| `src/html-templates.js` | Login page HTML |
| `NOTES.md` | Full backlog, resolved issues, recent changes |
| `wrangler.toml` | Cloudflare Worker config |

---

## Architecture Notes

- **Auth**: Cookie-based HMAC-SHA256. Login checks `app_users` table first (per-user DB accounts), falls back to `ADMIN_PASSWORD` env-var for break-glass admin access only.
- **Roles**: `admin | finance | staff | member` — enforced per endpoint in both API files.
- **Photos**: Stored in R2 bucket `tlc-chms-photos`; served via `/admin/r2photo/` proxy.
- **Breeze ChMS sync**: `POST /admin/api/import/breeze` (bulk) and `POST /admin/api/import/breeze-sync-person` (per-person). See NOTES.md for field ID quirks.
- **D1 param limit**: ~100 per statement. Use chunked queries for large IN/NOT IN lists.

---

## Multi-App Architecture — Current State & Options

The church currently runs three separate Cloudflare Worker apps:

| App | Purpose | Key Services |
|-----|---------|-------------|
| **ChMS** (this app) | People, giving, households, attendance | D1, R2, Breeze API |
| **Scheduler** | Volunteer scheduling for services | Resend (emails to volunteers) |
| **Website admin** | Website content, news/events, newsletter | Brevo (newsletter to subscribers) |

### The Question
These apps share a common subject (church members/people) but are currently siloed. EM1/EM2/SMS, plus SC1 (native scheduler), raise the question of how tightly to integrate them.

### Options

**Option A — Keep separate, add direct integrations (recommended near-term)**
Each app stays its own Worker. ChMS talks directly to Brevo and Resend APIs via their REST APIs (no inter-app calls needed). Scheduler stays separate until SC1 is scoped. Website admin stays separate (content management is a different concern from membership).
- Pros: No migration risk, can ship EM1/EM2 quickly, each app fails independently
- Cons: Person data is duplicated across apps; Brevo/Resend config duplicated

**Option B — ChMS as people source-of-truth; other apps call ChMS API**
Other apps query ChMS for member data instead of maintaining their own. Scheduler checks ChMS for volunteer info; website admin pulls member emails from ChMS for newsletter sync.
- Pros: One source of truth for people data, no drift
- Cons: Adds cross-Worker API calls and auth between apps; breaking ChMS breaks others
- This is the right long-term direction but requires adding a service API layer to ChMS

**Option C — Absorb scheduler into ChMS (SC1)**
Move all scheduler logic into this app. Reuse ChMS person records, D1 DB, and Resend config already in ChMS. Most natural merge since scheduler is tightly coupled to people/roles.
- Pros: Single login, shared person data, one deployment
- Cons: Large effort; scheduler may have its own DB schema and frontend
- SC1 is already on the backlog — this would be the implementation approach

**Option D — Full merge of all three apps**
Combine ChMS + Scheduler + Website admin into one Worker.
- Not recommended: website admin (CMS/content) is a genuinely different domain from membership management. Merging adds complexity without much benefit.

### Recommended Path
1. ~~**Now**: Build EM1/EM2~~ ✅ Done (v83/v84).
2. **Next**: Absorb Scheduler into ChMS (SC1, Option C) — backend already merged, UI integration remaining.
3. **Long term**: Consider a thin "people API" in ChMS that website admin and any future apps can query (Option B) — but only when the pain of duplicated data is actually felt.

### Prerequisites for EM1/EM2
- `RESEND_API_KEY` — **already in this worker** (used by `src/api-scheduler.js`)
- `EMAIL_FROM` — **already in this worker** (e.g. `Timothy Lutheran <noreply@timothystl.org>`)
- `BREVO_API_KEY` — **already in this worker** (added 2026-04-20)
- `BREVO_LIST_ID` — **already in this worker** (added 2026-04-20)

### EM1 — Done (v84)
Brevo sync built: "Add to Newsletter" button on profile, bulk sync + reconciliation view in Settings, auto-sync on member email change.

### EM2 — Done (v83)
Birthday/anniversary emails built: daily cron at 9am Central, Resend, dedup via audit_log, admin test buttons in Settings.

---

## Current Backlog Status

Full detail in `NOTES.md`. Summary:

- **Phases 1–5c**: All complete as of 2026-04-16 (v25).
- **Phase 6**: H1 (Organizations) and H3 (Household giving) done as of 2026-04-17 (v26). Remaining: N2 Scheduler integration, I1 Subdomain rename.
- **Anything added below this line was noted mid-session and not yet scheduled.**

---

## Development Phases

Use this as the session-to-session roadmap. Complete one phase fully before starting the next. Each phase has a clear goal, bounded scope, and "done" criteria.

---

### Phase 1 — Housekeeping & Data Verification
**Goal:** Zero-risk cleanup and data confirmation. No code changes to prod logic.

- [ ] **IN6** — Write `SECRETS.md` listing every env var, what it does, and rotation steps (`ADMIN_PASSWORD`, `RESEND_API_KEY`, `EMAIL_FROM`, `BREVO_API_KEY`, `BREVO_LIST_ID`, Breeze creds)
- [ ] **IN10** — Write D1 backup/restore runbook (Cloudflare PITR + weekly R2 export option)
- [ ] **G11** — Re-run 2025 sync; verify Anne Gonzalez Mar 2 ($47), Pat Hunt Sep 14 ($100), Horst Herrmann Dec 7 ($900), John Hagan Dec 7 ($50)
- [ ] **G12** — Re-run 2025 sync; verify Leah Sieveking Nov 2 fund change
- [ ] **G13** — Re-run 2025/2026 sync; verify Sue Koch Apr 27 and Thanh Nguyen Feb 22 (ghost fund → General Fund, no duplicates)
- [ ] **G14** — Re-run 2025 sync; verify $68.43 fund change (entry 488482959 gone, 514675972 General Fund remains)
- [ ] **G15** — Re-run 2025 sync; verify Ron Rall May 25 split ($3,735.45 General + $1,500 PNG Mission)
- [ ] **G16** — Re-run 2025 sync; verify Kathy Carr Feb 2 TUB Bees fund change

**Done when:** Secrets doc exists, runbook exists, all 6 giving entries verified correct (or manually corrected via Edit Gift modal).

---

### Phase 2 — Code Quality Prep
**Goal:** Reduce noise and isolate Breeze logic before the big refactor. No behavior changes.

- [ ] **IN12** — Dead-code sweep: remove commented-out code, unused variables, leftover `console.log`s from `api-chms.js` and `html-chms.js`
- [ ] **IN5** — Extract Breeze API client into `src/breeze.js` (consolidates field-ID quirks, enables mocking for IN11)

**Done when:** No `console.log` artifacts in prod files; all Breeze HTTP calls live in `src/breeze.js`.

---

### Phase 3 — Infrastructure Safety
**Goal:** Establish a staging environment and clean up the Worker name before any further risky changes.

- [ ] **IN9** — Add `[env.staging]` block to `wrangler.toml` with its own D1 DB; add `staging.volunteer.timothystl.org` (or `*.workers.dev`) route
- [ ] **IN1** — Rename Worker: change `name=` in `wrangler.toml` → `tlc-chms`; `wrangler deploy`; re-add all secrets; move custom domain route; verify cron; delete old Worker. Brief ≤1 min downtime.

**Done when:** Staging URL exists and responds; prod Worker is named `tlc-chms`.

---

### Phase 4 — Refactoring
**Goal:** Break the two monolith files into maintainable modules. No behavior changes.

- [ ] **IN4** — Split `api-chms.js` into domain modules: `src/api-people.js`, `src/api-giving.js`, `src/api-households.js`, `src/api-reports.js`, `src/api-import.js` — all still mounted from worker entry
- [ ] **IN3** — Split `html-chms.js` into per-tab frontend modules: `src/frontend/{shell,people,giving,households,scheduler,reports,settings}.js` concatenated at build (or one string-returning module per tab)

**Done when:** `html-chms.js` and `api-chms.js` no longer exist as monoliths; IDE can syntax-highlight and navigate the embedded JS/CSS.

---

### Phase 5 — Test Harness
**Goal:** Regression coverage for the highest-risk logic, now that code is modular enough to test.

- [ ] **IN11** — Vitest + Miniflare setup; priority test targets:
  - Breeze CSV importer quirks (split-fund nth-occurrence, float person IDs, `"nan"` fund, negatives)
  - `hashPassword` / `verifyPassword` round-trip
  - `disambiguateHHName` edge cases (same last name, missing head, org names)
  - Giving sync orphan cleanup logic

**Done when:** `npm test` passes; CI runs tests on every PR.

---

### Phase 6 — New Features
**Goal:** Add capabilities that have been scoped and are ready to build.

- [ ] **G3** — Gift entry workflow improvements (user has detail — schedule a dedicated scoping session first)
- [ ] **R4** — Member tenure report: check if `member_since`/`join_date` field exists in Breeze mapping; add report if data is available
- [ ] **BR1** — Reverse sync (app → Breeze): scope to narrow workflows first (new person push, walk-in gift batch push); needs scoping conversation before implementation

**Done when:** Each item either shipped or formally deferred with a reason.

---

### Phase 7 — Large Features (needs scoping first)
**Goal:** Substantial new capabilities that require design decisions before coding starts.

- [ ] **R6** — Per-person attendance tracking: schema (attendance record per person per service) + check-in UI — dedicated scoping session required
- [ ] **IN2** — Decide on app merge strategy: Option C (absorb scheduler fully) vs Option B (thin people-API); audit monorepo vs split-repo; document decision in CLAUDE.md

**Done when:** Each item either has a design doc / scoping decision logged here, or is in active implementation.

---

## Queued Items (add new ones here during sessions)

<!-- Add items here as they come up. Format: - [ ] Description (noted YYYY-MM-DD) -->

### People List
- [x] **PL1** — Members-first people list: default view shows Members only; "Members" toggle button in toolbar switches to all-types view. Done 2026-04-20 (v82).
- [x] **PL2** — Archive/Deceased people: `status` column (`active|archived|deceased`) added; archived/deceased hidden from default list; "Archived" toggle button in toolbar; Archive/Deceased/Reactivate buttons on profile; anniversary cards exclude deceased. Done 2026-04-20 (v81).

### Giving / Finance
- [x] **G1** — Fund import: pre-fetches `/api/funds` from Breeze to resolve real names; retroactively renames any "Breeze Fund XXXXX" placeholders on next sync. Done 2026-04-17.
- [x] **G2** — Edit individual gifts from person profile: click batch number → opens that batch; click a gift row → modal to edit that individual gift (amount, fund, date, method, check #, note). Done 2026-04-17 (v27).
- [ ] **G3** — Overall gift entry workflow improvements (user has more detail — revisit in dedicated session). (noted 2026-04-17)
- [x] **G9** — Late-entry contributions: 45-day grace window added to sync — Dec contributions logged in Jan are now imported with their actual Dec contribution date. seenIds guard prevents double-import. Audit log limit raised to 10000. Done 2026-04-19 (v71).
- [x] **G4** — Reopen batch button is broken/dead — fixed 2026-04-17 (v37).
- [x] **G5** — Export data: persons, giving (year-by-year), and register data. Done 2026-04-17 (v38).
- [x] **G6** — Giving CSV import reconciliation fixes (v47, v51, 2026-04-17): (1) Negative entries (refunds/adjustments) were silently dropped — fixed. (2) "nan" fund name (blank exported by Excel) now maps to General Fund. (3) Float person IDs (`43826663.0`) now stripped. (4) Split-fund multi-row payments: Breeze exports one row per fund with same Payment ID; second row was treated as duplicate and fund allocation dropped — fixed with nth-occurrence tracking. Import now shows expandable list of skipped payment IDs as diagnostic.
- [x] **G7** — Giving by Fund report now groups funds by numeric code prefix (e.g., all "40085 *" variants under one collapsible group with subtotal). Done 2026-04-17 (v48).
- [x] **G17** — Giving by Fund report enhancements: (1) Total Givers count shown below report title. (2) "Reconcile Orphans" button fetches Breeze giving/list for the report's date range and removes stale DB entries (same safety logic as sync orphan pass — only deletes if a current replacement exists for same person+date). Endpoint: `POST /admin/api/giving/reconcile-orphans`. Use to fix the 2025 discrepancy ($547,367 app vs $537,624 Breeze): run the report for 1/1/2025–12/31/2025, click Reconcile Orphans. Done 2026-04-21 (v86).
- [x] **G19** — Force Remove Orphans. Diagnose confirmed all 43 entries of the 2025 discrepancy were "orphan" class (valid `breeze_id`, missing from Breeze's current giving/list). Root cause: Breeze's `bulk_contributions_deleted` event references the batch, not the payment IDs, so the sync's dedup never sees them as deleted. New admin-only `POST /admin/api/giving/force-remove-orphans` (`{start, end, confirm_count, confirm_cents}`) deletes those rows without the "current replacement exists" safety check. Guards: confirmation count/cents must match server recomputation; refuses if giving/list < 100 payments (truncation); only touches `breeze_id != ''` rows; writes an `audit_log` row `force_remove_orphans` with the removed id list. Red "Force Remove N" button shown on Diagnose view (admin only). Done 2026-04-21 (v89).
- [x] **G18** — Reconcile Diagnose tool. The 2025 discrepancy (+$9,743.50 across 4 funds, 43 entries) persisted after v86's Reconcile Orphans and after a full delete+resync. New read-only `GET /admin/api/giving/reconcile-diagnose?from=...&to=...` returns every DB entry in the range classified by whether its `breeze_id` still exists in Breeze's giving/list, plus per-fund extras totals, classification counts, twin-row detection (person+date+amount siblings with different `breeze_id`), and a `missing_from_db` inverse list. "Diagnose" button on Giving by Fund report renders the results table; "Export Extras CSV" dumps the extras for review. Surgical tool — no mutations — to identify *what* the 43 extras are before choosing a permanent fix. Candidates to expect: entries with empty `breeze_id` (manual/quick-entry — Reconcile Orphans can't see them), split-suffix rows `pid-2`/`pid-3` from the legacy CSV importer, or duplicate imports where audit-log `object_json` and giving/list `id` disagree. Done 2026-04-21 (v88).
- [x] **G8** — Re-import all giving years (2022–2026) after G6 fixes. Completed 2026-04-17 — all years 2021–2026 verified correct.
- [x] **G10** — Correction pass bug fixed (v85, 2026-04-21). Added orphan cleanup pass: after sync, DB entries in the window whose `breeze_id` no longer appears in giving/list are deleted if a current replacement exists for the same person+date. The supplement pass (v74) already imports the corrected version; this cleans up the stale old entry. Handles all cases where Breeze creates a new payment ID on edit.
- [ ] **G11** — Wrong-amount entries: re-run 2025 sync; if user corrected these in Breeze (new payment IDs), orphan cleanup should auto-resolve. Verify: Anne Gonzalez Mar 2 2025 ($47), Pat Hunt Sep 14 2025 ($100), Horst Herrmann Dec 7 2025 ($900), John Hagan Dec 7 2025 ($50). Use Edit Gift modal only if still wrong after sync.
- [ ] **G12** — Leah Sieveking Nov 2 2025 fund change: re-run 2025 sync; orphan cleanup should auto-resolve if corrected in Breeze. Verify; use Edit Gift modal if still wrong.
- [ ] **G13** — Sue Koch Apr 27 2025 and Thanh Nguyen Feb 22 2026 (ghost fund): re-run sync for those years; orphan cleanup should remove old entries and supplement pass should add new ones with General Fund. Verify no duplicates remain.
- [ ] **G14** — $68.43 fund change test (Feb 9 2025): re-run 2025 sync; orphan cleanup should remove old entry 488482959 and new entry 514675972 (General Fund) should remain. Verify.
- [ ] **G15** — Ron Rall split to verify: May 25 2025, audit log shows `contribution_updated` with split change to $3,735.45 General Fund + $1,500 PNG Mission Fund (total $5,235.45). Re-run 2025 sync and confirm DB has correct split amounts and both funds. (noted 2026-04-19)
- [ ] **G16** — Kathy Carr fund change to verify: Feb 2 2025, audit log shows update to TUB Bees fund (1718237). Re-run 2025 sync and confirm DB has correct fund. (noted 2026-04-19)

### Dashboard
- [x] **DB5** — Last worship card: show both services AND the combined total on a single card (not two separate cards). Done 2026-04-17 (v27).
- [x] **DB6** — Dashboard customization: ability to add, remove, and reorder/move cards on the dashboard. Done 2026-04-20 (v79) — show/hide cards via "⚙ Customize" button; preferences in localStorage.
- [x] **DB7** — Anniversary dashboard spouse pairing misses some households — fixed 2026-04-17 (v42). Secondary household lookup finds partner when only one spouse has anniversary_date set.
- [x] **DB8** — Anniversary pairing: further fixes 2026-04-17 (v49, v50). (v49) Secondary lookup broadened beyond head/spouse family_role. (v50) Removed member_type filter from secondary lookup — common pattern is one member + one visitor spouse; visitor was excluded and partner showed solo.

### Households / Data Quality
- [x] **HQ4** — Household head robustness scan: Settings card shows count of headless households; "Fix Household Heads" promotes spouse or first member. API: GET /admin/api/households/no-head-count and POST /admin/api/households/fix-heads. Done 2026-04-17 (v46).

### Photos
- [x] **PH1** — Household picture: upload photo for a household via hh-modal upload button → R2 → DB. Done 2026-04-17 (v46).
- [x] **PH2** — Crop profile picture: add a crop/resize tool when uploading a profile photo. Done 2026-04-20 (v79).
- [x] **PH3** — Black bar appearing above some household cards — fixed 2026-04-17 (v45). Wrapped photo img in a container div with background:var(--linen); onerror hides the whole container.

### People / Filters
- [x] **PF1** — Filter people by missing data fields: checkboxes organized by category with AND logic. Done 2026-04-17 (v46).

### Attendance / Reports
- [x] **AT1** — Attendance table collapse/expand toggle. Done 2026-04-17 (v46).
- [x] **AT2** — Attendance graph direction fixed: ORDER BY ASC so oldest dates plot left. Done 2026-04-17 (v46).
- [x] **AT3** — Attendance graphs: drag to resize charts. Done 2026-04-20 (v79).
- [x] **AT4** — Year-over-year giving/attendance report: overlapping graphs to compare current year vs prior year on the same chart. Done 2026-04-20 (v79) — Giving Trend tile in Reports tab; YoY attendance was already implemented.
- [x] **AT5** — Christmas/Easter markers on attendance chart + separate Special/Midweek bar chart. Done 2026-04-23 (v109). Easter/Christmas dashed markers on Sunday chart use `xAtAnyDate` interpolation so Dec 24/25 always render even when not Sunday. New `renderSpecialServicesChart` below the main chart shows amber (special) and purple (midweek) bars; midweek/special services excluded from Sunday average. New "+ Special" button adds `service_type=special` or `midweek` entries.
- [x] **AT6** — Attendance by Service report: multi-year comparison. Date Range / Multi-Year toggle buttons on tile; year checkboxes (last 5 years, 2 most recent pre-checked); `years=` param on API runs parallel D1 queries; `renderMultiYearServiceChart` draws grouped bar chart (X = service times, one bar per year). Done 2026-04-24 (v112).

### Communications / Email
- [x] **EM1** — Brevo newsletter sync: (1) "Add to newsletter" button on person profile → Brevo Contacts API, (2) bulk sync in Settings, (3) auto-sync on person save if email changes, (4) reconciliation view shows ChMS vs Brevo comparison with "Add All Missing" button. Done 2026-04-20 (v84).
- [x] **EM2** — Automated birthday/anniversary emails via Resend. Daily cron (`0 14 * * *`), birthday to member, anniversary to couple (shared email → one combined email). Dedup via audit_log. Admin test buttons in Settings. Done 2026-04-20 (v83).
- [x] **SMS1** — Birthday/anniversary SMS via Brevo Transactional SMS. `sms_opt_in` column added to `people` (`migrations/0002_add_sms_opt_in.sql`). `normalizePhone()` (E.164), `sendBrevoSms()`, `sendBirthdayTexts()`, `sendAnniversaryTexts()` in `src/api-emails.js`. Admin test buttons in Settings. Cron sends daily alongside emails. Person edit form: SMS opt-in checkbox. Done 2026-04-24 (v112).

### Scheduler
- [x] **SC1** — Scheduler integrated as a tab inside the ChMS SPA. `/scheduler?embedded=1` hides own header/tabs; ChMS sidebar "Scheduler" tab lazy-loads it in an iframe. Done 2026-04-21 (v92, fully working at v98).
- [x] **SC2** — Inline scheduler into ChMS SPA (no iframe). Done 2026-04-23 (v111). New `src/scheduler-inline.js` transforms `SCHEDULER_HTML` at module load time: CSS scoped with `.sched-root`, HTML stripped of login screen and header, conflicting IDs renamed (`sched-tab-*`, `sched-current-month-label`, `sched-app-content`), JS has 4 renamed functions (`schedFmtDate/ShowTab/SavePerson/DeletePerson`), `checkAuth()` + INIT block deferred to `window.schedInitScheduler()` (called on first Scheduler tab visit). Standalone `/scheduler` route unchanged.

### Breeze Integration
- [ ] **BR1** — Reverse sync (app → Breeze): Breeze API supports write operations (add/update people, add contributions). Feasible for narrow workflows (e.g. new person entered here → push to Breeze, or walk-in gift batch → push to Breeze). Full bidirectional sync is complex due to conflict resolution. Needs scoping conversation: which specific data entry workflows would benefit? (noted 2026-04-19)

### Reports / Insights (noted 2026-04-22)
- [x] **R1** — Age group breakdown across Membership Summary, Giving. Done 2026-04-22 (v102). Default buckets: Under 18, 18–29, 30–44, 45–64, 65+, Unknown (no DOB). Membership Summary gets an "By Age Group" table with count + share %. Giving by Fund gets a "By Age Group" table with givers, gifts, total, avg/giver, share %. Attendance age-groups deferred — we only track service totals, not per-person attendance (would require R6).
- [x] **R2** — Giving insights report: top givers (top N by year), lapsed givers (gave in prior year, nothing this year), giving frequency distribution, average gift amount trends. Done 2026-04-22 (v99). New `GET /admin/api/reports/giving-insights?year=YYYY` endpoint; new "Giving Insights" tile in Reports tab. Renders four blocks: top 25 givers (clickable to profile), lapsed givers (prior-year donors absent this year, sortable by prior total), frequency histogram (1 / 2-5 / 6-12 / 13-26 / 27+ gifts per giver this year), and 5-year trend table (givers/gifts/total/avg gift/avg per giver).
- [x] **R3** — People insights report. Done 2026-04-23 (v110). New `GET /admin/api/reports/people-insights` endpoint; new "People Insights" tile. Six sections: new contacts bar chart (24 months), new people by year × member type cross-tab, age distribution bars (6 buckets), gender pie chart, household composition bars (single/couple/small/large/none), sacramental pipeline bars (members only: neither/baptized/confirmed/both).
- [ ] **R4** — Member tenure report. Needs `member_since` / `join_date` field — check if we have it on the person schema; may require Breeze field mapping.
- [x] **R5** — Contact info completeness report: counts of people missing email / phone / address / dob / photo; drill-down list per category. Done 2026-04-22 (v99). New `GET /admin/api/reports/contact-completeness?scope=active|member&field=...` endpoint. New "Contact Completeness" tile renders progress bars (green = complete) for each field with scope toggle (all active vs. members only); clicking a row drills to the list of missing records (clickable to profile).
- [ ] **R6** — Person-by-person attendance tracking. Currently we track service totals only. Needs schema (attendance record per person per service) + check-in UI. Substantial new feature — worth a dedicated scoping conversation.
- [x] **R7** — Easter/Christmas markers on Giving Trend chart. Done 2026-04-22 (v99). Easter computed per-year via Meeus/Jones/Butcher Gregorian algorithm, rendered as dashed vertical line in that year's color with "E" label. Christmas is shared Dec 25 dashed line in warm-gray with "C" label. Legend updated to explain the markers.
- [x] **R8** — Giving × Attendance overlay chart. Done 2026-04-22 (v102). New `GET /admin/api/reports/giving-vs-attendance?from=&to=` endpoint. Groups both datasets by Sunday-of-week. New "Giving × Attendance" tile on Reports tab. Chart: green bars (attendance, left axis) + teal line (giving, right axis). Overview stats include Weeks, Total Attendance, Total Given, Avg per Attender, and Pearson correlation coefficient with a qualitative label (Strong+/Moderate+/Weak+/None/Weak−/etc.).
- [x] **R9** — Pie chart for Giving by Method. Done 2026-04-22 (v99). New reusable `renderPieChart(items, diameter)` helper (SVG slices with hover tooltips + legend). Added "Share by Method" block above the existing table on the Giving by Method report.
- [x] **R10** — Average giving stats overlay. Done 2026-04-22 (v102). Giving by Fund overview now has 5 tiles (added "Avg / Giver" = total / distinct givers, relabeled "Average Gift" → "Avg / Gift"). "Avg / Giver" also appears per age-group row in the new R1 table. Giving Insights already had both avg stats in its 5-year trend table (from v99). Giving Trend chart stats deferred — the per-year tile total in its legend already serves the year-level averages context.

### Engagement & Data Quality (noted 2026-04-22)
- [x] **FU1** — Prayer request tracking. Done 2026-04-23 (v107/v108). API dispatch bug fixed (prayer-requests and engagement routes were missing from api-admin.js dispatch list — all status changes returned 404). Cancel guard bug fixed in prayerSetStatus. Dashboard card now has Praying/Answered/Close buttons (working), + Add modal, and "↓ CSV" export button (`GET /admin/api/prayer-requests/export.csv?status=all|open|praying|active|answered|closed`). Website contact and prayer forms wired end-to-end via service binding (timothystl/website) — submissions create person records and prayer_requests rows in this DB.
- [x] **WC1** — Electronic contact card intake. Done 2026-04-23. Website contact form → admin worker → service binding → `/api/intake/connect-card` creates Visitor + follow_up_items row. Website prayer form → `/api/intake/prayer` creates prayer_requests row. Both confirmed working end-to-end.

### Infrastructure / Backend Cleanup (noted 2026-04-22)
- [ ] **IN1** — Rename Worker `breeze-proxy-worker` → something intuitive (candidate: `tlc-chms`). Name is legacy — Breeze is one integration among many now (Resend, Brevo, R2, D1, scheduler). Cloudflare has no rename button, so this is a mini-migration: change `name=` in `wrangler.toml`, `wrangler deploy` to create the new Worker, re-add every secret (`ADMIN_PASSWORD`, `RESEND_API_KEY`, `EMAIL_FROM`, `BREVO_API_KEY`, `BREVO_LIST_ID`, Breeze keys — secrets don't carry), move the `volunteer.timothystl.org/*` custom domain route off the old Worker onto the new one, verify the cron (`0 14 * * *`) lands on the new Worker, delete the old Worker. D1/KV/R2 bindings reference resources by ID so data is unaffected. Brief (≤1 min) downtime during route cutover.
- [ ] **IN2** — Evaluate merging Workers and/or repos. Three Workers share a common subject (people) but live separately: ChMS (this), Scheduler (backend merged, UI embedded via iframe per SC1; SC2 tracks inline rewrite), Website admin. See "Multi-App Architecture" section above for options A–D. Decision needed: pursue Option C (absorb scheduler fully, leave website admin separate — currently recommended) vs Option B (thin people-API in ChMS, others stay separate). Adjacent: audit whether the three Workers live in one monorepo or three repos and consolidate if split.
- [ ] **IN3** — Split `html-chms.js` into per-tab modules. The whole SPA is one enormous HTML-as-string file; diffs are noisy, IDE tooling can't see the embedded JS/CSS, code review is painful. Candidate: break into `src/frontend/{people,giving,households,scheduler,reports,settings,shell}.js` concatenated at build, or one string-returning module per tab imported by a shell.
- [ ] **IN4** — Split `api-chms.js` into domain modules. Mixed concerns (people, giving, households, dashboard, reports, imports) in one file. Split along natural nouns, all still mounted from the same router in the worker entry.
- [ ] **IN5** — Extract Breeze API client into `src/breeze.js`. Breeze calls currently scattered between `api-chms.js` (sync, giving) and `api-admin.js` (import). Pulling into one module (a) collects field-ID quirks in one place, (b) makes mocking possible for tests, (c) sets up the boundary if BR1 (reverse sync) ever happens.
- [ ] **IN6** — Secrets inventory doc. No single source of truth for which secrets the Worker needs. Add a `SECRETS.md` (or section in CLAUDE.md) listing every env var, what it's for, and rotation steps. Grep-current-list: `ADMIN_PASSWORD`, `RESEND_API_KEY`, `EMAIL_FROM`, `BREVO_API_KEY`, `BREVO_LIST_ID`, plus any Breeze creds.
- [x] **IN7** — D1 schema migrations system. Done 2026-04-23. `migrations/` directory created with `0001_baseline.sql` (complete schema as of today). `wrangler.toml` updated with `migrations_dir = "migrations"`. **To add a new column going forward**: (1) create `migrations/NNNN_description.sql` with the `ALTER TABLE ADD COLUMN` statement, (2) also add the same statement to the `migrations` array in `src/db.js` with a try/catch (keeps cold-start safety net working), (3) run `wrangler d1 migrations apply tlc-volunteer-db --remote` to apply to prod.
- [x] **IN8** — Audit log retention / pruning. Done 2026-04-23. `pruneAuditLog(db)` added to `tlc-volunteer-worker.js`, called from the existing `0 14 * * *` daily cron. Retention: `birthday_email_sent` / `anniversary_email_sent` → 60 days; all other rows → 365 days. Logged under `audit_prune` in cron output.
- [ ] **IN9** — Staging environment. No `[env.staging]` block in `wrangler.toml`; risky changes (giving migrations, sync logic) go straight to prod. Add staging with its own D1 DB + a `staging.volunteer.timothystl.org` (or `*.workers.dev`) route.
- [ ] **IN10** — D1 backup/restore runbook. Cloudflare provides point-in-time recovery for D1 (~30 days) but the restore procedure isn't documented here. Write a short runbook + consider a weekly export to R2 for longer-horizon backups.
- [ ] **IN11** — Test harness. No tests in the repo. Highest-value targets: (a) Breeze CSV quirks (split-fund nth-occurrence, float person IDs, "nan" fund, negatives) — giving import has had multiple late-caught bugs (G6); (b) `hashPassword`/`verifyPassword`; (c) `disambiguateHHName`. Vitest + Miniflare works for Workers.
- [ ] **IN12** — Dead-code sweep. Five-pass review mentions removing commented-out code, unused imports, leftover `console.log`s. No periodic cleanup has been done. One focused pass across `api-chms.js` / `html-chms.js` would likely shrink both meaningfully.

---

## Code Review Standards

Before finalizing any code in this project, perform a structured five-pass review:

**Pass 1 — Logic & Bugs**
Check that every function does what its name says. Look for edge cases:
null/undefined values, empty inputs, unexpected data types, non-exhaustive
conditionals. Trace the logic path for failure scenarios, not just happy paths.

**Pass 2 — Privacy & Security**
Flag any exposed secrets, API keys, or credentials. Check that user input is
validated before use. Ensure personal data (names, contact info, financial
records) is handled with intentional access control. Never log sensitive data.

**Pass 3 — Performance**
Identify loops inside loops, unnecessary re-renders, unthrottled/undebounced
event handlers, synchronous operations that should be async, and repeated
data fetches that could be cached or combined.

**Pass 4 — Efficiency & Clarity**
Remove redundant variables and duplicate logic. Extract repeated patterns into
helper functions. Simplify overly complex conditionals. Code should read like
clear prose — if a line requires re-reading, rewrite it.

**Pass 5 — Dead Code & Cleanup**
Remove commented-out code, unused imports, leftover console.log statements,
and completed TODO comments. Leave no debugging artifacts in production code.

After each session, summarize what changed and why — treat this as a commit
message for future reference.

---

## Daily Code Review Checklist

Run through this at the end of any session before pushing, or at the start of a session when picking up from someone else.

### Security
- [ ] Every new API endpoint checks role (`isAdmin`, `isFinance`, `isStaff`, `canEdit`) before doing anything
- [ ] No raw user input passed into SQL — always use `.bind()` parameterized queries
- [ ] HTML output always runs through `esc()` — never concatenate raw user data into innerHTML
- [ ] No secrets or API keys hardcoded — all from `env.*` (Cloudflare secrets)
- [ ] New endpoints that touch giving data are gated behind `isFinance`

### Cloudflare Worker Limits
- [ ] No single DB query uses more than ~90 parameters in an IN/NOT IN — chunk if needed
- [ ] Any loop that does per-row DB queries is replaced with a bulk SELECT + JS grouping (avoid 30s timeouts)
- [ ] Large import/sync operations return early with `done: true` and let the frontend re-trigger if needed

### API Correctness
- [ ] New endpoints return `json({ error: '...' }, 4xx)` on bad input, not a 200 with an error field
- [ ] All new endpoints are wrapped in try/catch so uncaught exceptions return JSON, not Cloudflare's HTML error page
- [ ] New routes added to the correct file (`api-chms.js` for ChMS data, `api-admin.js` for auth/users/scheduler)

### Frontend Consistency
- [ ] New API calls use `api('/admin/api/...')` wrapper, not raw `fetch()`
- [ ] New modals have a unique ID and use `openModal(id)` / `closeModal(id)`
- [ ] `DEPLOY_VERSION` bumped in `html-chms.js` on every commit that changes the frontend
- [ ] New tabs added to `showTab()` labels map and trigger their load function

### Data Integrity
- [ ] Any query returning a household name uses COALESCE fallback for `head_first_name` (not all members have `family_role='head'`)
- [ ] Giving amounts stored and retrieved as **integer cents**, converted to dollars only at display time (`/ 100`)
- [ ] New person/household fields default to `''` (empty string) not NULL where possible — avoids COALESCE boilerplate everywhere

### Before Every Push
- [ ] `DEPLOY_VERSION` is bumped
- [ ] `NOTES.md` Recent Changes has an entry for this version
- [ ] `CLAUDE.md` Queued Items updated — new items added, completed items checked off
- [ ] Pushed to `claude/review-claude-md-f62iL`, not main

---

## Gotchas & Patterns

- `disambiguateHHName(name, headFirst)` — shared helper at top of `api-chms.js`. Always use COALESCE fallback in `head_first_name` subqueries (not all members have `family_role='head'`).
- **Breeze giving CSV format quirks**: (1) Split-fund donations appear as multiple rows with the same Payment ID (one row per fund). The importer handles this with nth-occurrence tracking (`pid`, `pid-2`, `pid-3`). (2) Sub-fund names like "40085 Christmas Offering" are stored as separate fund records — they are NOT rolled into "40085 General Fund". The Giving by Fund report groups them by numeric prefix. (3) Negative entries are valid (refunds/adjustments) and are imported. (4) "nan" fund name = blank field from Excel export → maps to General Fund. (5) Person IDs may have `.0` float suffix — stripped on import.
- **Anniversary secondary lookup**: only requires `active=1` and non-deceased — does NOT filter by `family_role` or `member_type`, since the qualifying person already passed those checks and their partner may be a visitor or have no role set.
- Dashboard birthday/anniversary: two separate cards since v23. Copy functions: `dashCopyBirthdays()` / `dashCopyAnniversaries()`. Anniversary rows are couple-paired by household+date in the API before returning.
- `api()` helper in frontend handles 401→redirect. Always use it instead of raw `fetch` for `/admin/api/*` calls.
- All modals have specific IDs (e.g. `person-modal`, `hh-modal`). There is no generic `modal-overlay`. Use `openModal(id)` / `closeModal(id)`.
- DEPLOY_VERSION is at the top of the `<script>` block in `html-chms.js`. Bump it on every commit.

---

## Dev Branch

Working branch: `claude/review-codebase-docs-ka3vu`
Push to this branch. Do not push directly to main.
