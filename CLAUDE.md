# CLAUDE.md — TLC ChMS App

Read this at the start of every session. Update NOTES.md (and this file if needed) as items are discovered, fixed, or queued.

---

## What This App Is

**TLC Gather** — the Church Management System (ChMS) for Timothy Lutheran Church. Built on **Cloudflare Workers + D1 (SQLite)**. Single-page admin app assembled from per-tab modules under `src/frontend/` (shell in `src/html-chms.js`). API routes live in domain modules under `src/` — all delegated from `src/api-chms.js` — plus `src/api-admin.js` (auth, users, scheduler).

The same Worker also serves the **public volunteer signup site** at `volunteer.timothystl.org`, assembled from per-ministry modules under `src/public/`.

**Live at:**
- `https://chms.timothystl.org` — admin app (old `volunteer.timothystl.org/chms` redirects here)
- `https://volunteer.timothystl.org` — public ministry signup
- Brand: TLC Gather (navy/teal/gold three-pillar system: People / Ministry / Giving). PWA icons under `icons/`.

---

## Key Files

| File | Purpose |
|------|---------|
| `manual.html` | Standalone operator reference manual (all 14 sections, no external CSS) |
| `tlc-volunteer-worker.js` | Worker entry point — routes all requests |
| `src/api-admin.js` | Auth, user management, scheduler API |
| `src/api-chms.js` | ACL checks, dashboard, delegation to domain modules |
| `src/api-people.js` | People CRUD, archive, Brevo sync, photo upload, follow-ups |
| `src/api-giving.js` | Giving entries, batches, quick entry |
| `src/api-households.js` | Households, organizations, tags, funds |
| `src/api-reports.js` | Reports, engagement queue, prayer requests, reconcile tools |
| `src/api-import.js` | Import/sync, config, register, export, Breeze sync |
| `src/api-utils.js` | Shared utilities (disambiguateHHName, isoWeekKey) |
| `src/html-chms.js` | Admin SPA shell (~300 lines) — imports & concatenates the per-tab modules below |
| `src/frontend/*.js` | Per-tab admin modules: `html-head.js`, `html-tabs.js`, `js-core.js`, `js-{settings,dashboard,people,register,households,giving,reports,export-import,attendance,volunteers}.js` |
| `src/html-templates.js` | Login page HTML + assembly of `PUBLIC_HTML` (volunteer.timothystl.org) from `src/public/` modules |
| `src/public/{head,landing,footer,scripts}.js` | Public site shell: head/CSS, landing card grid, footer, JS |
| `src/public/ministries/*.js` | One file per ministry detail page (worship, education, acceptance, outreach, wol, lasm, cfna, transportation, events, general) |
| `src/auth.js` | Cookie auth, PBKDF2 password hashing, helpers |
| `icons/` | PWA icons (16/32/180/192/512/512-maskable) + `tlc-gather-icon.svg` source |
| `NOTES.md` | Full backlog, resolved issues, recent changes |
| `wrangler.toml` | Cloudflare Worker config |

---

## Architecture Notes

- **Auth**: Cookie-based HMAC-SHA256. Login checks `app_users` table first (per-user DB accounts), falls back to `ADMIN_PASSWORD` env-var for break-glass admin access only.
- **Roles**: `admin | finance | staff | member` — enforced in `api-chms.js` ACL block; domain modules receive pre-computed `isAdmin/isFinance/isStaff/canEdit` flags.
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

### Phase 1 — Housekeeping & Data Verification ✅ DONE 2026-04-24
**Goal:** Zero-risk cleanup and data confirmation. No code changes to prod logic.

- [x] **IN6** — `SECRETS.md` written: all 7 secrets + 3 bindings documented with purpose and rotation steps.
- [x] **IN10** — D1 backup/restore runbook written (see `## D1 Backup & Restore` section below).
- [x] **G11** — Verified. All four entries confirmed correct.
- [x] **G12** — Verified. Leah Sieveking fund change confirmed correct.
- [x] **G13** — Verified. Ghost fund entries resolved, no duplicates.
- [x] **G14** — Verified. Old entry gone, General Fund entry correct.
- [x] **G15** — Verified. Ron Rall split amounts correct.
- [x] **G16** — Verified. Kathy Carr TUB Bees fund correct.

---

### Phase 2 — Code Quality Prep ✅ DONE 2026-04-24
**Goal:** Reduce noise and isolate Breeze logic before the big refactor. No behavior changes.

- [x] **IN12** — Dead-code sweep: removed debug `console.log` from Breeze per-person sync and dead `setFdTag` function (no callers). Done 2026-04-24 (v113).
- [x] **IN5** — Extract Breeze API client into `src/breeze.js` (consolidates field-ID quirks, enables mocking for IN11). Done 2026-04-24 (v114).

**Done when:** No `console.log` artifacts in prod files; all Breeze HTTP calls live in `src/breeze.js`.

---

### Phase 3 — Infrastructure Safety ✅ DONE 2026-04-24
**Goal:** Establish a staging environment and clean up the Worker name before any further risky changes.

- [x] **IN9** — Staging environment live at `https://breeze-proxy-worker-staging.timothystl.workers.dev/chms`. Separate `wrangler.staging.toml` config (avoids wrangler v4 route inheritance bug). D1: `tlc-volunteer-db-staging`, KV: staging RSVP_STORE, shared R2, crons disabled. Deploy: `wrangler deploy --config wrangler.staging.toml`. Done 2026-04-24.
- [x] **IN1** — Worker renamed to `tlc-chms`. Added `chms.timothystl.org` as dedicated ChMS subdomain (root serves app directly; `volunteer.timothystl.org/chms` redirects). `tlc-newsletter-admin` service binding updated to `tlc-chms`. Old `breeze-proxy-worker` deleted. Done 2026-04-24.

**Done when:** Staging URL exists and responds; prod Worker is named `tlc-chms`. ✅ Phase 3 complete 2026-04-24.

---

### Phase 4 — Refactoring ✅ DONE 2026-04-25
**Goal:** Break the two monolith files into maintainable modules. No behavior changes.

- [x] **IN4** — Split `api-chms.js` into domain modules: `src/api-people.js`, `src/api-giving.js`, `src/api-households.js`, `src/api-reports.js`, `src/api-import.js`, `src/api-utils.js` — all delegated from `api-chms.js`. Done 2026-04-24 (v114–v118).
- [x] **IN3** — Split `html-chms.js` into per-tab frontend modules under `src/frontend/`: `html-head.js`, `html-tabs.js`, `js-core.js`, `js-settings.js`, `js-dashboard.js`, `js-people.js`, `js-register.js`, `js-households.js`, `js-giving.js`, `js-reports.js`, `js-export-import.js`, `js-attendance.js`, `js-volunteers.js`. `html-chms.js` reduced from 9,443 → 311 lines. Done 2026-04-25 (v120).

**Done when:** `html-chms.js` and `api-chms.js` no longer exist as monoliths; IDE can syntax-highlight and navigate the embedded JS/CSS.

---

### Phase 5 — Test Harness ✅ DONE 2026-04-25
**Goal:** Regression coverage for the highest-risk logic, now that code is modular enough to test.

- [x] **IN11** — Vitest setup; 37 tests across 3 files. Done 2026-04-25 (v121).
  - `test/utils.test.js` — `disambiguateHHName` (8 cases: falsy head, Family suffix, case-insensitive, plain name, org names)
  - `test/auth.test.js` — `hashPassword`/`verifyPassword` (7 cases: format, round-trip, wrong password, empty, unique salts, malformed stored, unicode)
  - `test/csv-import.test.js` — `parseFundSplits`, `givingEntryId`, `isGivingDup` (22 cases: nan/blank, numeric prefix, multi-fund split, colon format, nth-occurrence dedup)
  - `parseFundSplits`, `givingEntryId`, `isGivingDup` extracted from `api-import.js` to `api-utils.js` as exported functions

**Done when:** `npm test` passes; CI runs tests on every PR.

---

### Phase 6 — New Features
**Goal:** Add capabilities that have been scoped and are ready to build.

- [ ] **G3** — Gift entry workflow improvements (user has detail — schedule a dedicated scoping session first)
- [x] **R4** — Member tenure report: closed — `member_since`/`join_date` not available in Breeze field mapping; deferred indefinitely. (2026-05-01)
- [x] **BR1** — Reverse sync (app → Breeze): auto-push on person create, auto-update on contact field change. Done 2026-04-26 (v133).

**Done when:** Each item either shipped or formally deferred with a reason.

---

### Phase 7 — Large Features (needs scoping first)
**Goal:** Substantial new capabilities that require design decisions before coding starts.

- [x] **R6** — Per-person attendance tracking: closed — out of scope for now; service-total tracking is sufficient. (2026-05-01)
- [x] **IN2** — App merge strategy: closed — Decision: Option C (absorb scheduler, leave website admin separate) is the right long-term direction but not active work; website admin stays separate. No action needed until SC1 is revisited. (2026-05-01)
- [ ] **PM1** — Person merge: deduplicate records by moving giving, tags, and household membership to the canonical record then deleting the duplicate; needs a confirmation UI with diff view. (noted 2026-04-26)
- [ ] **PL1b** — Pledge tracking: new `pledges` table (person, year, amount); pledge vs. actual giving shown on profile and in a Giving Insights section. (noted 2026-04-26)

**Done when:** Each item either has a design doc / scoping decision logged here, or is in active implementation.

---

### Phase 8 — Critical Security Fixes ✅ DONE 2026-05-20
**Goal:** Eliminate SQL injection, broken auth fallback, and missing role guards. Zero behavior change for legitimate users. Ship as a single hotfix PR.

- [x] **SEC1** — Closed — already fixed. `api-households.js` validates `hhMemberType` against allowlist and uses `.bind()`. (2026-05-20)
- [x] **SEC2** — SQL injection: `api-people.js` line ~766 — `entry.field` interpolated into column position. Closed — strict allowlist check immediately before the interpolation (`allowedFields.includes(entry.field)`) makes injection impossible in practice. Style could be improved to a `switch`, but no exploitable path exists. (2026-05-19)
- [x] **SEC3** — Closed — already fixed. `api-reports.js` prayer CSV export validates status against allowlist and uses parameterized bind. (2026-05-20)
- [x] **SEC4** — Closed — already fixed. `role || 'admin'` pattern no longer exists in `api-chms.js`. (2026-05-20)
- [x] **SEC5** — Closed — already fixed. `api-giving.js` line 6: `if (method !== 'GET' && !isFinance) return json({error:'Access denied'},403)` guards all write handlers. (2026-05-20)
- [x] **SEC6** — Closed — already fixed. `POST /people/bulk-member-type` has `if (!isStaff)` guard. (2026-05-20)
- [x] **SEC7** — Closed — already fixed. `POST /audit/undo` requires `isAdmin`. (2026-05-20)
- [x] **SEC8** — Closed — already fixed. `POST /utils/validate-address` requires `canEdit`. (2026-05-20)

**Done when:** All eight items fixed, `npm test` passes, manual smoke test of auth + giving + audit-undo confirms correct 403 behavior.

---

### Phase 9 — XSS Fixes ✅ DONE 2026-05-20
**Goal:** Eliminate all cross-site scripting vectors. None of these change any feature behavior.

- [x] **XSS1** — Closed — already fixed. `esc()` in `js-core.js` encodes `'` → `&#39;`. (2026-05-20)
- [x] **XSS2** — Closed — already fixed. `pvField()` wraps `val` in `esc()`; `pvFieldHtml()` variant exists for pre-built HTML. (2026-05-20)
- [x] **XSS3** — Closed — already fixed. Org website uses `/^https?:\/\//i.test(o.website)` guard before building anchor. (2026-05-20)
- [x] **XSS4** — Closed — already fixed. `printRegister()` uses `esc()` on all fields. (2026-05-20)

**Done when:** All four items fixed; verify with a test person whose name contains `<script>` and `'` that no JS executes in any view.

---

### Phase 10 — High-Priority Bug Fixes
**Goal:** Fix correctness bugs that cause wrong data, silent failures, or broken UI. No schema changes required.

- [x] **BF1** — Hard-delete orphaned rows. Done 2026-05-19 (v218). Added `DELETE FROM giving_entries`, `DELETE FROM follow_up_items`, and `DELETE FROM audit_log WHERE entity_type='person'` inside the hard-delete block. (`api-people.js`)
- [x] **BF2** — Anniversary email partial send dedup. Done 2026-05-19 (v218). Track `atLeastOneSent`; write audit log if at least one email succeeded regardless of partial failure. (`api-emails.js`)
- [x] **BF3** — Anniversary audit log null `household_id`. Done 2026-05-19 (v218). Extract `hhKey = p1.household_id || p1.id` and use it consistently in all anniversary audit log `.bind()` calls. (`api-emails.js`)
- [x] **BF4** — Birthday emails sent to deceased. Done 2026-05-19 (v218). Added `AND (deceased=0 OR deceased IS NULL)` to birthday email query. (`api-emails.js`)
- [x] **BF5** — Register CSV/TSV import broken by `String.raw` double-escaping. Done 2026-05-19 (v218). Fixed all affected patterns: `split('\\t')` → `split('\t')`, `/\\r\\n/g` → `/\r\n/g`, `/\\s+/g` → `/\s+/g`, `/\\d/` → `/\d/` in all date-parsing regexes, `\\.?` → `\.?`, etc. (`src/frontend/js-register.js`)
- [x] **BF6** — Closed — `'sunday'` is correct; the backend stores `service_type='sunday'` for regular Sunday services. The documented enum `regular|special|midweek` was incorrect in the original review finding. Chart works as intended. (2026-05-19)
- [x] **BF7** — People Insights block titles show "undefined". Done 2026-05-19 (v218). Moved `var scopeLabel` declaration to before Block 1. (`src/frontend/js-reports.js`)
- [x] **BF8** — Fund create active flag always 1. Done 2026-05-19 (v218). Changed `b.active?1:1` to `b.active==null?1:b.active?1:0`. (`api-households.js`)
- [x] **BF9** — Soft-delete leaves `status='active'`. Done 2026-05-19 (v218). Soft-delete now sets both `active=0` and `status='archived'`. (`api-people.js`)
- [x] **BF10** — Anniversary audit log null `household_id` (write side). Done 2026-05-19 (v218). Covered by BF3 fix — `hhKey` used in all write paths. (`api-emails.js`)
- [x] **BF11** — Closed — already correct. The profile-view tag chip render (line ~909) sets `data-picked="1"` when `on` is true. The `getSelectedTagIds` bug (FH7) is a separate issue in the person edit *modal* picker (`openPersonEdit`), tracked under FH7. (2026-05-19)
- [x] **BF12** — `normalizePhone()` crashes on non-string. Done 2026-05-19 (v218). Changed guard to `if (!raw || typeof raw !== 'string') return ''`. Closes **BUG1**. (`api-utils.js`)
- [x] **BF13** — `followupEditNotes` onclick notes injection. Done 2026-05-19 (v218). Store notes in `data-notes` on the row element; `followupEditNotes(id)` reads `row.dataset.notes` instead of taking a string argument. (`src/frontend/js-dashboard.js`)
- [x] **BF14** — Closed — intentional. Each Sunday creates 2 service records (8am + 10:45am), so `d.inserted / 2` correctly reports Sunday count, not service count. Never produces a fraction because the API always inserts in pairs. (2026-05-19)

**Done when:** All fourteen items fixed, `npm test` passes, manual verification of: attendance chart renders, People Insights titles show scope, birthday emails skip deceased, register import processes a real CSV.

---

### Phase 11 — Performance & N+1 Query Fixes
**Goal:** Eliminate patterns that will timeout the Cloudflare Worker under real data volumes (>200 people, >50 tags, >100 services) and remove unnecessary repeat round-trips in the frontend.

- [x] **PF1** — `api-admin.js` lines ~286–343 — bulk-fetch all slots, people, roles, fill-counts in 3 queries total instead of 2N+2M serial calls. Done 2026-05-19 (v219).
- [x] **PF2** — `api-import.js` line ~226 — attendance sync batches Breeze API calls with `Promise.allSettled` in groups of 25; DB updates collected then flushed via `db.batch()`. Done 2026-05-19 (v219).
- [x] **PF3** — `api-import.js` lines ~1830–1888 — pre-scan pass 1 collects all new batches/funds, bulk-creates them before the main insert loop. Done 2026-05-19 (v219).
- [x] **PF4** — `api-import.js` lines ~2093–2184 — tag-sync `phase=list` pre-loads all local tags into Maps, batches all UPDATE/INSERT statements. Done 2026-05-19 (v219).
- [x] **PF5** — `api-people.js` line ~270 — `bulk-member-type` chunks IDs at 89 to stay under D1 param limit. Done 2026-05-19 (v219).
- [x] **PF6** — `api-households.js` lines ~124–131 — `fix-heads` fetches best candidate per household in one aggregated query, batches all UPDATEs. Done 2026-05-19 (v219).
- [x] **PF7** — `api-utils.js` lines ~415–418 — `normalize-phones` collects all changes then fires as a single `db.batch()`. Done 2026-05-19 (v219).
- [x] **PF8** — `api-reports.js` lines ~619–635 — 5-year trend runs all 5 queries in parallel with `Promise.all`. Done 2026-05-19 (v219).
- [x] **PF9** — `api-reports.js` line ~1149 — giving-by-method replaces correlated subquery with explicit `JOIN giving_batches`. Done 2026-05-19 (v219).
- [x] **PF10** — `api-people.js` lines ~169–174 — household_size filter uses pre-aggregated JOIN subquery instead of per-row correlated subqueries. Done 2026-05-19 (v219).
- [x] **PF11** — `js-giving.js` line ~25 — `filterBatchSearch` caches last batch list and filters client-side without API call. Done 2026-05-19 (v219).
- [x] **PF12** — Closed — current pattern (calling both `openBatch` and `loadBatches` after entry add/delete) is correct. Both refreshes are needed: `openBatch` updates the entry table, `loadBatches` updates the batch sidebar total. No change needed. (2026-05-19)
- [x] **PF13** — `api-people.js` lines ~255–257 and ~417–419 — tag inserts on create/update use `db.batch()`. Done 2026-05-19 (v219).

**Done when:** All items fixed; verify that a full Breeze attendance sync, a tag sync, and a 500-person giving-by-method report all complete within the 30-second Worker limit.

---

### Phase 12 — Frontend Hygiene & API Consistency
**Goal:** Bring all API calls through the `api()` helper (for 401-redirect handling), eliminate redundant network round-trips, and fix low-severity UX/logic bugs.

- [x] **FH1** — `js-volunteers.js` — all 16+ `fetch()` calls replaced with `api()`. Done 2026-05-19 (v220).
- [x] **FH2** — `js-export-import.js` — `runBreezeGivingSync`, `runBreezeGivingAll`, `importGivingCSV`, `importPeopleCSV`, `importAttendanceTSV` raw `fetch()` calls replaced with `api()`. Done 2026-05-19 (v220).
- [x] **FH3** — `js-people.js` lines ~984–1173 — photo upload/delete/copy and household photo upload/delete converted to `api()` for 401 detection. Done 2026-05-19 (v220).
- [x] **FH4** — Closed — stale duplicate entry. Already fixed via **PR2/FH4** in Phase 16 (`POST /admin/api/people/bulk-tags`, single round-trip); this line just never got checked off. Re-verified directly against current code 2026-07-11.
- [x] **FH5** — Closed — `createHouseholdFromPerson` reads directly from form fields; no intermediate GET person call exists. Original finding was incorrect. (2026-05-19)
- [x] **FH6** — Closed — stale duplicate entry. Already fixed under the Auth/Login queued items (`PATCH /admin/api/people/:id` sparse update); this line just never got checked off. Re-verified directly against current code 2026-07-11 — all three functions use PATCH with only the changed field(s).
- [x] **FH7** — `js-people.js` lines ~1980–1988 — `getSelectedTagIds` now reads `el.dataset.picked === '1'` instead of fragile `style.borderColor` comparison. Done 2026-05-19 (v220).
- [x] **FH8** — `js-people.js` lines ~2017–2036 — removed duplicate `gender` and `marital_status` assignments in `savePerson`. Done 2026-05-19 (v220).
- [x] **FH9** — `js-attendance.js` resize handler — Christmas marker now uses most recent year from `_lastGivingTrendData.years` instead of hardcoded `2026`. Done 2026-05-19 (v220).
- [x] **FH10** — Closed — resize handlers properly call `document.removeEventListener` for both `mousemove` and `mouseup` inside the `mouseup` callback. No accumulation occurs. (2026-05-19)
- [x] **FH11** — `js-households.js` and `js-giving.js` — added `.catch()` handlers to `loadHouseholds`, `loadOrganizations`, and `openBatch`; "Loading…" now clears on error. Done 2026-05-19 (v220).
- [x] **FH12** — `js-export-import.js` — `doSendBatch` no-email early-exit now increments `skipped` not `failed`; final message shows separate sent/skipped/failed counts. Done 2026-05-19 (v220).
- [x] **FH13** — `js-export-import.js` — `runBreezeTagSync` accepts explicit `btnEl` parameter; `html-tabs.js` onclick passes `this`; programmatic call passes nothing (btn guards with `if (btn)`). Done 2026-05-19 (v220).
- [x] **FH14** — `js-volunteers.js` — volunteer "To:" button passes name/email via `data-sig-*` attributes; `volOpenSendEmail(btn)` reads them from `btn.dataset.*` — no more entity literals in UI. Done 2026-05-19 (v220).
- [x] **FH15** — Closed — intentional by design. Empty fields are excluded from the payload so they don't overwrite existing stored values (documented with a comment in the code). This is correct UX: blank = "leave unchanged". (2026-05-19)

**Done when:** All items fixed; verify volunteers tab works after session expiry (redirect to login), bulk tag apply sends one request, and giving batch search filters without a network call.

---

### Phase 13 — Low-Priority Polish & Robustness ✅ DONE 2026-05-20
**Goal:** Minor correctness gaps, dead code, hardcoded values, and defense-in-depth improvements. Low risk; no urgency.

- [x] **LP1** — Archive audit log null name. Done 2026-05-20 (v221). `[person.first_name, person.last_name].filter(Boolean).join(' ')` for all three archive/unarchive/deceased paths. (`api-people.js`)
- [x] **LP2** — Audit undo integer validation. Done 2026-05-20 (v221). Added `if (!Number.isInteger(b.id)) return json({ error: 'Invalid id' }, 400)` before the DB lookup. (`api-people.js`)
- [x] **LP3** — `reply_to` hardcoded. Done 2026-05-20 (v221). Changed to `env.REPLY_TO_EMAIL || 'office@timothystl.org'`. (`api-emails.js`)
- [x] **LP4** — `register/clear` allowlist. Done 2026-05-20 (v221). Added `'funeral'` and `'anniversary'` to `validTypes`. (`api-import.js`)
- [x] **LP5** — CSV `""` double-quote handling. Done 2026-05-20 (v221). When inside a quoted field and next char is also `"`, consume both as one literal `"` per RFC 4180. (`api-import.js`)
- [x] **LP6** — `ghostFundContribs` LIMIT. Done 2026-05-20 (v221). Added `LIMIT 50` to the ghost-fund scan query. (`api-import.js`)
- [x] **LP7** — Census geocoder `source`. Done 2026-05-20 (v221). Added `source: 'census'` to the Census geocoder response. (`api-utils.js`)
- [x] **LP8** — Break-glass comment. Done 2026-05-20 (v221). Added comment explaining env-var bypass behavior and deactivated-admin interaction. (`api-admin.js`)
- [x] **LP9** — `GET /followup` and `GET /audit` role guards. Done 2026-05-20 (v221). Added `if (!isStaff) return json({ error: 'Access denied' }, 403)` to both. (`api-people.js`)
- [x] **LP10** — `deleteUser` username injection. Done 2026-05-20 (v221). Signature changed to `deleteUser(uid)`; username looked up from `_usersData` inside the function. (`src/frontend/js-settings.js`)
- [x] **LP11** — `_pendingOpenBatchId` stale on error. Done 2026-05-20 (v221). Captured and cleared `pendingId` before the API call so an error never leaves it set. (`src/frontend/js-giving.js`)
- [x] **LP12** — `createHouseholdFromPerson` missing Content-Type. Done 2026-05-20 (v221). Added `headers: {'Content-Type':'application/json'}`. (`src/frontend/js-households.js`)
- [x] **LP13** — `dateStr` raw `p.dob` in innerHTML. Done 2026-05-20 (v221). Fallback is now `esc(p.dob||'')`. (`src/frontend/js-dashboard.js`)
- [x] **LP14** — Stray `</script></body></html>` in volunteers template. Done 2026-05-20 (v221). Removed dead closing tags. (`src/frontend/js-volunteers.js`)
- [x] **LP15** — `openPersonDetail`/`goToProfile` duplication. Done 2026-05-20 (v221). `goToProfile` is now a thin wrapper: `showTab('people'); openPersonDetail(id)`. (`src/frontend/js-core.js`)
- [x] **LP16** — Chunk import error message. Done 2026-05-20 (v221). Message now: `"Error on chunk N of M (after X rows): <error>"`. (`src/frontend/js-export-import.js`)
- [x] **LP17** — Non-Sunday edit row delete button. Done 2026-05-20 (v221). Added Delete button matching the Sunday path pattern. (`src/frontend/js-attendance.js`)

**Done when:** All items resolved; each either fixed or formally documented as intentional with a reason.

---

### Phase 14 — Cron correctness & email safety ✅ DONE 2026-05-20
**Goal:** Make daily cron paths correct under all timezones and resilient to scale.

- [x] **BG1** — `tlc-volunteer-worker.js:86` Saturday check used `getUTCDay()`. Now uses `centralDayOfWeek()` (Intl + America/Chicago) so push reminders fire on Central Saturday regardless of UTC offset. Done 2026-05-20 (v224).
- [x] **BG2** — Birthday/anniversary MM-DD query was UTC-based. Now uses `centralTodayMMDD()`. Fixes edge-of-day misses when run outside the cron window (e.g. admin test buttons). Done 2026-05-20 (v224).
- [x] **BG3** — `birthdayHtml()` / `anniversaryHtml()` now escape names before embedding (defense-in-depth). Done 2026-05-20 (v224).
- [x] **PR1** — Birthday/anniversary email + SMS loops batched with `Promise.all`; audit log writes collected into a single `db.batch()`. Replaces serial awaits that risked the 30s Worker timeout on large recipient lists. Done 2026-05-20 (v224).

**Done when:** All four resolved; tests pass.

---

### Phase 15 — Intake & upload hardening ✅ DONE 2026-05-20
**Goal:** Close remaining input-validation gaps on unauthenticated/lightly-authenticated endpoints.

- [x] **SC1** — `api-intake.js` now rate-limits per IP (10/15 min) via `RSVP_STORE` for both `/api/intake/connect-card` and `/api/intake/prayer`. 20 KB max body. Done 2026-05-20 (v224).
- [x] **SC2** — `api-people.js` photo uploads (person + household) now validate via magic-byte sniffing and enforce 8 MB cap. New `validateImageUpload()` helper. Done 2026-05-20 (v224).
- [x] **SC3** — Giving CSV import enforces 10 MB cap via Content-Length and post-read size check. Done 2026-05-20 (v224).
- [x] **SC4** — `GET /admin/api/config/church` now omits `church_ein` for non-admins (was previously exposed to staff/finance). Done 2026-05-20 (v224).
- [x] **BG4** — Closed; reviewed agent's claim about hardcoded Breeze pagination `offset=50`. The first call uses `limit=50&offset=0`, so the second-page fetch at `offset=50` is correct cursor pagination, not a skip. No change. (2026-05-20)

**Done when:** All four hardenings shipped; intake key + photo upload smoke-tested.

---

### Phase 16 — Performance follow-ups ✅ DONE 2026-05-20
**Goal:** Eliminate the remaining N+1 patterns and add the missing giving index.

- [x] **PR2 / FH4** — New `POST /admin/api/people/bulk-tags` endpoint (`{ ids, add, remove }`) writes via `db.batch()`. Frontend `applyBulkTags()` is now a single round-trip instead of 2N. Closes FH4 from Phase 12. Done 2026-05-20 (v224).
- [x] **PR4** — Added `idx_giving_breeze` on `giving_entries(breeze_id)` (migration `0007_giving_breeze_index.sql` + `db.js` runtime migration). Speeds up sync dedup, orphan cleanup, and reconcile-diagnose. Done 2026-05-20 (v224).
- [x] **PR3** — Closed as intentional. The pre-sync caches (`SELECT breeze_id FROM giving_entries WHERE breeze_id != ''` and similar for people) need full results to correctly dedup. Capacity is small enough (~50k rows max) that a LIMIT would risk skipping matches. (2026-05-20)

**Done when:** Bulk tag apply confirmed single request; index appears after deploy.

---

### Phase 17 — Mobile readiness ✅ DONE 2026-05-20
**Goal:** Make charts, tables, modals, and buttons usable on phones.

- [x] **MO1** — Chart resize handles in `js-attendance.js` now register `touchstart/move/end/cancel` alongside mouse events. Handle height bumped to 14px; `touch-action:none` added. Both `attChartResizeStart` and `_rptResizeStart` updated. Done 2026-05-20 (v224).
- [x] **MO2** — Register table now wrapped in `<div style="overflow-x:auto">` so the nowrap date column scrolls instead of overflowing. Done 2026-05-20 (v224).
- [x] **MO3** — `.btn-primary/secondary/danger` get 11px vertical padding + 44px min-height under `@media(max-width:600px)`, hitting WCAG 2.5.5 touch-target minimum. Done 2026-05-20 (v224).
- [x] **MO4** — `.modal` padding reduced to 18/16 and `max-height:95vh` under `@media(max-width:480px)` so modals fit in landscape phones. Done 2026-05-20 (v224).
- [x] **MO5** — Deferred. Sidebar `.s-item` SVGs have visible text labels alongside, so missing `aria-label` is not blocking screen-reader users. Will revisit alongside a dedicated a11y pass. (2026-05-20)

**Done when:** Chart resizing works on touch, register table scrolls, button taps reliable.

---

### Phase 18 — Hygiene ✅ DONE 2026-05-20
**Goal:** Reduce duplication in scheduler code without expanding scope.

- [x] **HG2** — Service-time + RSVP-status ternaries in `api-scheduler.js` (lines 385/390/441) deduplicated into `formatServiceTime()` and `formatRsvpStatus()` helpers at top of file. Done 2026-05-20 (v224).
- [x] **HG3** — `office@timothystl.org` literals at scheduler lines 126/581 now route through new `officeEmail(env)` helper that respects `REPLY_TO_EMAIL`. Signature footer + ICS ORGANIZER intentionally left as static strings (church-identity, not technical reply-to). Done 2026-05-20 (v224).
- [x] **HG1/HG4/HG5** — Closed. HG1 (entries SELECT in `api-giving.js`) used twice — extracting to a constant adds indirection for marginal gain. HG4 (long inline ternary returns) is locally readable and the extraction would just add another file boundary. HG5 (error message wording) is cosmetic; leaving as-is. (2026-05-20)

**Done when:** Scheduler helpers in place; no behavior change.

---

### Phase 19 — Post-v1.8.1 Review Fixes
**Goal:** Close the review gap that let v1.7.0–v1.8.1 (mobile landing redesign, event short-links, Ministry Roles collapsing, Transportation→Acceptance migration) ship without a formal pass. 4 parallel review agents + hand verification (executed the actual generated/served code, not just read it) found 3 confirmed high-severity bugs, fixed below; the rest are queued.

- [x] **REV1** — Stored XSS in the event short-link "Sign Up" button (`escH()`-then-`onclick` quote-context mismatch, same class as VUXBUG2). Fixed with the existing `data-*` + delegated-click pattern. Done 2026-07-11 (v1.8.2). (`src/public/scripts.js`)
- [x] **REV2** — No role guard on event/ministry-role write endpoints (any authenticated role, including `member`, could create/edit events and roles — the reachability path for REV1). Added `admin`/`staff` guards to all 6 write routes; also dropped `transportation` from the `ministry-roles` POST allowlist. Done 2026-07-11 (v1.8.2). (`src/api-admin.js`)
- [x] **REV3** — Ministry Roles duplication: `_doInitDb` seeded before reclassifying transportation→acceptance, racing the seed's dedup check and leaving 6 rows instead of 3 on any DB that cold-started mid-migration (confirmed against a real local D1 instance). Reordered + added a self-healing one-time dedup DELETE; `migrations/0013_dedupe_transportation_acceptance_roles.sql` for the record. Done 2026-07-11 (v1.8.2). (`src/db.js`)
- [x] **REV4** — Slug validation gaps closed: `normalizeSlug()` now caps at 64 chars to match the route matcher's regex; new `RESERVED_SLUGS` denylist (`scheduler`, `chms`, `portal`, `admin`, `api`, `rsvp`, `volunteer`, `email`, `member`) checked on create/update with a friendly 409. Done 2026-07-11 (v1.8.3). (`src/api-admin.js`)
- [x] **REV5** — Slug uniqueness race now returns the same friendly 409 to the losing concurrent request instead of a generic 500 — event create/update writes are wrapped in a try/catch that recognizes the DB's own `UNIQUE constraint` failure. Verified against a real local D1 race. Done 2026-07-11 (v1.8.4). (`src/api-admin.js`)
- [x] **REV6** — Ministry Roles group-collapse: a collapsed group containing the actively-selected/edited role now shows a small teal dot + tooltip on its header, so the selection is never silently hidden. Done 2026-07-11 (v1.8.5). (`src/frontend/js-volunteers.js`, `html-head.js`)
- [x] **REV7** — Stale `transportation` option removed from the Outreach Email Templates ministry filter dropdown. Done 2026-07-11 (v1.8.3). (`src/frontend/html-tabs.js`)
- [x] **REV8** — `npm audit fix` applied: routine `wrangler` bump within its existing `^4.84.1` range resolved all 6 dev-tooling advisories (esbuild/undici/vite/ws). `npm audit` now reports 0 vulnerabilities. Done 2026-07-11 (v1.8.5). (`package-lock.json`)
- [x] **REV9** — Reconfirmed and closed alongside **SC5** below.

**Done when:** REV6/REV8 each fixed or formally deferred with a reason; REV9 stays pointed at SC5. ✅ Phase 19 complete 2026-07-11 (REV1–REV9; REV9/SC5 closed together via the scheduler resync below).

---

### Phase 20 — Ground-Up Code Sweep (pre-redesign)
**Goal:** A full ground-up (not diff-based) review of the entire codebase, requested ahead of a planned cross-app UI/UX redesign, so structural/correctness issues aren't baked around by a visual pass. 8 parallel review agents covered every backend and frontend file; findings got SW-codes (bugs/fixes) and RD-codes (redesign-readiness notes, not bugs). The 7 critical/high items plus SW8 are fixed and verified below; the rest are queued.

- [x] **SW1** — Scheduler data/config endpoints (`/admin/api/scheduler/data`, `/config`) had no role check — any `member`-level account could read the scheduler's own raw Breeze/Resend/worker secrets (`ws_breeze_settings`) or overwrite the whole schedule. Added `admin`/`staff` guard. Done 2026-07-11 (v1.9.0). (`src/api-admin.js`)
- [x] **SW2** — Same gap on signups DELETE/status, `push-broadcast`, `volunteer-templates` writes, signup link-person/send-email. Added `admin`/`staff` guards (reads stay open to any authenticated role). Done 2026-07-11 (v1.9.0). (`src/api-admin.js`)
- [x] **SW3** — No session revocation: deactivating/demoting a user didn't invalidate their existing cookie. `getAuthInfo()` now live-checks `active`/`role` against `app_users` for any username-bearing cookie and returns the current DB role, not the cookie's stale claim; break-glass env-var sessions are unaffected (rotate `ADMIN_PASSWORD` per LP8). Verified with a mock-DB test. Done 2026-07-11 (v1.9.0). (`src/auth.js`)
- [x] **SW4** — `api-chms.js` called `handleHouseholdsApi` with 10 args against an 8-arg signature, so `isFinance`'s value silently landed in the `canEdit` slot — staff users were wrongly denied on 2 household-photo endpoints. Fixed the call site. Done 2026-07-11 (v1.9.0). (`src/api-chms.js`)
- [x] **SW5** — Volunteer outreach emails always sent blank `{{roles}}`/`{{service}}`/`{{sundays}}`/`{{notes}}` — a string-vs-number signup ID comparison never matched. Fixed. Done 2026-07-11 (v1.9.0). (`src/frontend/js-volunteers.js`)
- [x] **SW6** — Giving by Fund report silently dropped active funds with $0 given in the period (LEFT JOIN downgraded to INNER by a WHERE-clause date filter). Moved the filter into a subquery. Verified against real local D1. Done 2026-07-11 (v1.9.0). (`src/api-reports.js`)
- [x] **SW7** — Acceptance ministry's driving-availability answers were captured but never shown in the Confirm & submit read-back step. Added a summary block; extracted a shared `getAccTransFields()` helper. Done 2026-07-11 (v1.9.0). (`src/public/scripts.js`)
- [x] **SW8** — `sendBirthdayTexts` was missing the deceased filter present on its 3 siblings — fixed. Also audited anniversary pairing: people whose spouse died or whose partner's anniversary_date is missing/mismatched get silently skipped by every send path with zero visibility. New year-round audit classifies these (`deceased_partner`/`no_partner`/`date_mismatch`) and a new "Anniversary Data Issues" dashboard card (editors+, on by default) surfaces them. Done 2026-07-11 (v1.9.0). (`src/api-emails.js`, `src/api-chms.js`, `src/frontend/js-dashboard.js`)
- [x] **SW9** — Birthday/anniversary dedup now compares Central-calendar-day (via new `alreadySentTodayCentral()` helper) instead of raw UTC `date(ts)=date('now')`, fixing evening-manual-retrigger duplicate sends. Verified against the exact reported scenario. Done 2026-07-11 (v1.9.2). (`src/api-emails.js`)
- [x] **SW10** — RSVP tokens (scheduler) now use `crypto.getRandomValues()` via new shared `genRsvpToken()` (160-bit) instead of `Math.random()`. `scheduler/index.html` resynced. Done 2026-07-11 (v1.9.1). (`src/scheduler-html.js`)
- [x] **SW11** — HTML-attribute injection in Settings' member-type mapping dropdown fixed — switched from inline `onchange="..."` string-building to the `data-*` + delegated-listener pattern. Done 2026-07-11 (v1.9.1). (`src/frontend/js-settings.js`)
- [x] **SW12** — Bulk pre-loaded household + existing-person lookups (chunked maps, PF3/PF4 pattern) instead of ~200 per-page sequential SELECTs. Household creation and the person INSERT/UPDATE deliberately stay per-row (causally ordered + `locally_edited` CASE/WHEN logic). Verified the same-page duplicate-household edge case against real local D1. Done 2026-07-11 (v1.9.3). (`src/api-import.js`)
- [x] **SW13** — Breeze giving-sync deletion detection: `contribution_deleted`/`bulk_contributions_deleted` now abort the sync on failure (matching `contribution_added`), since a silent empty-array fallback there risked a deleted Breeze contribution quietly reappearing. The other 2 (non-deletion-gating) log fetches stay best-effort but now surface failures via `diagnostics.warnings`. Done 2026-07-11 (v1.9.2). (`src/api-import.js`, `src/frontend/js-export-import.js`)
- [x] **SW14** — `POST giving/batches/:id/entries` now validates amount/fund, matching sibling endpoints. Done 2026-07-11 (v1.9.1). (`src/api-giving.js`)
- [x] **SW15** — Giving-diagnose CSV export now guards against Excel formula injection (leading `=`/`+`/`-`/`@` prefixed with `'`). Done 2026-07-11 (v1.9.1). (`src/frontend/js-reports.js`)
- [x] **SW16** — Deleted 15 dead functions (7 in `js-export-import.js`, 1 in `js-settings.js`, 7 in `scheduler-html.js`) after independently re-verifying zero call sites for each. `scheduler/index.html` resynced. Done 2026-07-11 (v1.9.4).
- [x] **SW17** — Giving Trend chart logic was duplicated (`js-reports.js` and `js-attendance.js`) and had already drifted (one had a hardcoded Christmas-marker year, the other derived it correctly). Fixed: Attendance tab's resize-drag handler now calls the single shared `renderGivingTrendChart()` instead of a second hand-inlined copy; the underlying hardcoded-year bug in the shared renderer itself was also fixed (now derives from `d.years`) so consolidating didn't just make the bug universal. Done 2026-07-12 (v1.9.5). (`src/frontend/js-attendance.js`, `src/frontend/js-reports.js`)
- [ ] **RD1** — Three separate CSS token systems coexist in the admin app (legacy `--steel-anchor`/`--linen`, newer `--warm-*`, and a distinct `--ev-*` palette for Volunteers/Events) — a redesign needs to reconcile all three. **User decision 2026-07-12: adopt Palette A (navy/teal/gold brand tokens) as the sole system; retire the others.** In progress.
- [ ] **RD2** — Two incompatible theming mechanisms: `js-volunteers.js` uses real CSS classes; most other tabs (`js-giving.js`, `js-reports.js`, `js-attendance.js`, `js-settings.js`, most of `js-people.js`) build UI via inline `style="..."` strings. **User decision 2026-07-12: use the system-wide palette/class approach everywhere; stop hand-writing inline colors.** In progress.
- [x] **RD3** — Closed 2026-07-12. The standalone `/scheduler` page shipped its own distinct "Steel & Amber" visual language, inconsistent with the rest of the app. **User decision: retire the standalone route — only the embedded ChMS tab is used.** Done — `/scheduler` now 302-redirects to the embedded tab (`https://chms.timothystl.org/#scheduler`); `/scheduler/lcms_calendar.json` (a live data dependency of the embedded tab) still works. (v1.9.5)
- [ ] **RD4** — Hardcoded hex colors instead of design tokens are pervasive across chart code (`js-reports.js`/`js-attendance.js`) and public ministry pages — a brand-token change would need a manual find/replace, not a variable swap. **User decision 2026-07-12: eliminate inline hex colors app-wide (same decision as RD2).** In progress — 171 hardcoded hex values identified (138 admin + 33 public).
- [x] **RD5** — Two giving-chart copies (SW17) consolidated 2026-07-12. Person-renderer consolidation (3 implementations in `js-people.js`) explicitly deferred to the actual redesign — unlike the chart, these are legitimately different layouts with no single canonical form, so merging now risks doing the work twice.

**Done when:** SW9–SW17 each fixed or formally deferred with a reason; RD1–RD5 are decisions logged here for the redesign, not fix targets. ✅ SW9–SW17 all fixed. RD1/RD2/RD4 (palette consolidation) decided 2026-07-12 and tracked as active work under Queued Items below; RD3/RD5 closed.

---

## Queued Items (add new ones here during sessions)

### App Visual Redesign — Design Handoff (2026-07-14)
Design package delivered (`ChMS Redesign.dc.html` + `README.md`, Turn 3/#3a + Turn 4/#4a are the agreed direction) proposing one unified visual language across Dashboard/People/Households/Person Profile/Giving/Reports/Scheduler/Volunteers. Per the handoff's own README, this is **visual/UI restyle only** — no functionality, data flow, API, or routing changes. Three structural decisions were confirmed with the user rather than guessed (the handoff explicitly asks for this):
- **Sidebar**: stays hamburger-everywhere (no persistent desktop icon rail, which the mockup shows but which would partially reverse VUX10). Retheme colors/spacing only.
- **People tab**: WILL get a master-detail quick-view side panel (list grouped by household + right-side preview pane), replacing today's click-straight-to-full-profile pattern. "Full Profile" button in the panel still opens the existing Person Profile page.
- **Giving tab**: keeps the existing batch-centric workflow (batch list → open batch → entries table) as one view; add a toggle to a flatter transaction view with fund + date-range filters, rather than replacing batches outright. Scoped as its own phase, not pure reskin.

Rollout is phased, each phase visually verified (Playwright against the built HTML with mocked API responses, since this environment has no live D1/auth backend) before starting the next:
- [x] **RDS1** — Foundation + Dashboard pilot. Token alignment (`--warm-white`/`--bg`, `--warm-gray`, `--linen` updated to the mockup's exact finalized hex — `--color-navy`/`--color-teal`/`--color-gold` already matched, no change needed); `AVATAR_TINTS` (`js-core.js`) updated to the mockup's exact 6-tint rotation, also fixing a found duplicate-palette bug where Dashboard had its own one-off avatar color array instead of using the shared `avatarTint()` helper; Dashboard `.dash-stat`/`.dash-card` converted from bordered flat cards to the mockup's borderless soft-shadow cards. No markup/behavior changes — Dashboard already rendered via reusable classes. Done 2026-07-14 (v1.13.0). See NOTES.md for full detail.
- [x] **RDS2** — People tab: added the master-detail quick-view side panel. Clicking a person (List or Card view) shows a right-side preview (avatar, contact info, household member chips, Call/Full Profile actions) without leaving the list; "Full Profile" still opens the existing Person Profile page. Scoped as additive: existing filters/pagination/sort/List-Card toggle/multi-select/bulk actions are all unchanged; the list itself was **not** regrouped by household (that would have required changing the server-side pagination model — deferred, see note below). No backend changes needed — reused the existing People-list household fields and the existing Households API. Done 2026-07-14 (v1.15.0). See NOTES.md for full detail.
- [x] **RDS2b** — Added a third "Household" toggle to the People tab (alongside List/Card, which are unchanged) instead of regrouping the existing paginated person list. Reuses the Households tab's existing card grid/endpoint entirely (`renderHouseholds()`, `GET /admin/api/households`) rather than building a new household-grouped-and-paginated people endpoint — sidesteps the original pagination-model blocker since it's a separate dataset/pagination track, not a regroup of the person list. Filtered by the People tab's own search box + Members/All toggle; hides the RDS2 quick-view panel while active (clicking a card opens the full Household View page). Done 2026-07-15 (v1.18.0). See NOTES.md for full detail.
- [x] **RDS3** — Households + Person Profile: applied the borderless soft-shadow card treatment (`.h-card`, `.pv-section`) matching Phase 1's card system; `.card-grid` gap bumped to match the mockup. Nested/chrome elements (`.pv-field-card`, `.pv-aside`, Household View) intentionally left as-is — not top-level cards, not shown in the mockup. Done 2026-07-14 (v1.16.0). See NOTES.md for full detail.
- [x] **RDS4 (Giving half)** — Giving tab: added a "Batches / Transactions" toggle (new `GET /admin/api/giving/transactions?fund_id=&from=&to=` endpoint, flat donor/fund/method/date/amount table, reuses existing `.entries-table`/`.field` classes), a stat-tile row (new `GET /admin/api/giving/stats` — This Week/This Month/YTD/Givers YTD, reuses Phase 1's `.dash-stat` classes), and wrapped the existing batch list/detail split-panel in the Phase-1 soft-shadow card look. Batches remain the unchanged default workflow. Done 2026-07-14 (v1.14.0). See NOTES.md for full detail. **Reports half of RDS4 not yet done** — still queued.
- [x] **RDS4b** — Reports: `.report-tile`/`.report-output`/`.rpt-stat` converted to the borderless soft-shadow card system (tiles get a lighter single-layer shadow matching the mockup's smaller tiles; the report-output preview panel gets the full two-layer shadow at 20px radius). The ~18 individually inline-styled sub-blocks inside specific report renderers (Giving Insights, People Insights, etc.) were intentionally not swept — same "needs visual verification" class of work as the still-open SVG chart-fill items in PAL5. Done 2026-07-14 (v1.16.0). See NOTES.md for full detail.
- [x] **RDS5** — Volunteers: `--ev-navy`/`--ev-teal`/`--ev-ink` aliased to `--color-navy`/`--color-teal`/`--charcoal` (exact hex matches, zero visual change); `.vol-shell` converted to the Phase 1 borderless soft-shadow card system. Scheduler: no changes needed — the embedded tab already inherits current tokens automatically (`scheduler-inline.js` strips its own `:root` on embed). Considered and declined a full native rewrite of Scheduler (~5,872 lines, ~8x `js-people.js`) as part of this pass — the visual win is already captured via token inheritance; a native rewrite is a distinct, much larger migration project, tracked separately (see "Native Scheduler Rewrite" below) rather than folded into this redesign. Done 2026-07-15 (v1.17.1). See NOTES.md for full detail. **This closes out RDS1–RDS5.**

### Tuition Aid Planner (2026-07-14)
- [x] **TAP1** — New "Tuition Aid" tab (finance/admin only), built from an uploaded mockup and wired to real D1 tables (`tuition_students`, `tuition_config`, `tuition_history`; migration `0014`) instead of hardcoded session-only data. Roster rows can be linked to real People records via a search picker. Full planner algorithm ported (family-share-% sliders, $2,000/student floor, 50%-cap Apply Policy, Auto-Balance, pipeline birth-year tracking) with debounced auto-save. 4 charts (History, Composition, Projection, Enrollment) hand-rolled in SVG, no Chart.js dependency. Done 2026-07-14 (v1.12.0). See NOTES.md for full detail.
- [x] **TAP2** — Closed via bug fix below: the lack of live-browser verification at build time is exactly what let this ship broken. **TAP2-BUG** — reported "tab won't load" 2026-07-14, traced to the tab-panel markup being appended after `.content-area`/`.app-shell`'s closing marker instead of before it (a pure HTML-structure bug from the original build, confirmed pre-existing by reproducing against commit 0903a86 directly) — the tab-panel rendered ~1000px below the viewport with no flex parent to size it. Fixed by moving the 147-line block to the correct position; the two Tuition Aid modals were already correctly placed (modals are `position:fixed` and don't need `.content-area` nesting). Done 2026-07-14 (v1.16.1). See NOTES.md for the full debugging trace and a technique note for future "won't load" reports that aren't JS syntax errors.
- [x] **TAP2-BUG2** — Reported "still not working" 2026-07-15, after TAP2-BUG's fix (v1.16.1) had already shipped. Root cause was a merge-order regression, not a repeat of the original bug: the fix (29d5245) correctly placed `#tab-tuitionaid` right before `.content-area`'s closing tag, but merging that branch together with the independent RDS2 branch (`ad400ce`, People filter drawer — added new markup at that exact same location) at `5babf16` re-interleaved the content so the People filter drawer ended up between the household-view close and `.content-area`'s close, pushing the tuition-aid block back out after the close tag — same failure mode (`.tab-panel` with no flex parent to size it) via a different path. Fixed by moving the block back before `</div><!-- /content-area -->` (the People filter drawer legitimately stays after, since it's `position:fixed`). Re-verified with the same technique as TAP2-BUG: byte-offset scan confirms `#tab-tuitionaid` now falls between `.content-area`'s open/close tags, `node --check` on all 3 built `<script>` blocks, and `npm test` (37/37). Done 2026-07-15 (v1.16.2). (`src/frontend/html-tabs.js`)
- [x] **TAP2-BUG3** — Reported "still can't load tuition data" 2026-07-15, immediately after TAP2-BUG2 shipped (v1.16.2) fixed the tab from rendering blank. Different bug, unrelated to the HTML-nesting issues: `src/api-admin.js`'s `handleAdminApi()` has an explicit allowlist of `seg.startsWith(...)` prefixes that get dispatched into `handleChmsApi()` (and from there into `handleTuitionAidApi()`) — `tuition-aid` was never added to that list when TAP1 was built, so every `/admin/api/tuition-aid/*` request fell through to the generic `return json({error:'Not found'},404)` at the bottom of the function, never reaching the handler that actually reads `tuition_students`/`tuition_config`/`tuition_history`. The frontend's `api()` helper correctly rejects on that 404, which `loadTuitionAid()`'s catch handler renders as "Could not load tuition aid data." — matching the report exactly. Fixed by adding `seg.startsWith('tuition-aid')` to the dispatch allowlist alongside the other domain prefixes. `npm test` (37/37), `node --check` on `api-admin.js`. Done 2026-07-15 (v1.16.3). (`src/api-admin.js`)
- [ ] **TAP3** — Config knobs (K-8 budget, tuition base/growth rate, LHS standard rate, $2,000 floor, 50% cap) are only editable via direct API calls (`PATCH /admin/api/tuition-aid/config`) — no Settings UI yet. Add one if these need to change without a code deploy.
- [x] **TAP5** — Multi-year editing, requested 2026-07-15: (1) view past years, (2) edit a year's actual tuition rate once known, (3) edit awards per year, (4) per-family year-over-year history, (5) outside aid that varies year to year. New tables `tuition_year_rates` (school_year → actual tuition rate, overrides the 6%/yr growth formula for that year once set) and `tuition_student_years` (per-student per-year "pin" — outside aid / family % / exact award overrides; survives a student's row later going inactive, so history isn't lost when a family graduates or leaves) — migration `0015_tuition_year_history.sql`, runtime safety-net in `db.js`, seeded once from the existing `tuition_history` rows. Year selector (`tap-year-select`) now spans base_school_year−5..+5 instead of only 0..+5. New "Year Navigator" card: switch years, and set/see the actual tuition rate for whichever year is selected. **Current year (offset 0)** keeps its existing behavior exactly — edits still write straight to the `tuition_students` master row, no behavior change for the primary day-to-day view. **Any other year** — editing outside aid, family share %, or LHS award pins a `tuition_student_years` row for that specific (student, school year) instead, so tuning next year's numbers can never leak into this year's (or vice versa); Apply Aid Policy / Auto-Balance / Reset to Current Awards all route the same way based on which year is being viewed. **Past years** (offset < 0) can't be reconstructed from today's roster (a graduated/removed student simply isn't in it) — they render straight from the pin ledger instead of the grade-progression engine, with an honest empty state for years that predate this feature (no data existed to backfill). New "History" button on every roster row opens a per-student modal listing every pinned year plus today's live numbers, with a "Jump" link back into the main view. Verified with `npm test` (37/37), `node --check` on all 3 built `<script>` blocks, a byte-offset div-balance scan of the new `#tap-planner-current`/`#tap-planner-past` markup, and a standalone Node harness that evaluated the actual served tuition-math functions (`tapSplitFor`/`tapTuitionForYear`/pin isolation) against hand-computed expected values — no live-browser check was possible in this environment. Done 2026-07-15 (v1.17.0). (`migrations/0015_tuition_year_history.sql`, `src/db.js`, `src/api-tuition-aid.js`, `src/frontend/js-tuition-aid.js`, `src/frontend/html-tabs.js`)
- [ ] **TAP6 (known, scoped limitation)** — Pins are keyed by school-year label, not by year-offset, so a pin set while a year was still in the future stays intact and still applies once that year becomes current (offset 0) *as long as it's read through the normal pin-aware helpers* — but offset-0 reads/writes intentionally bypass the pin layer (see TAP5) to keep today's editing behavior byte-for-byte unchanged, so a pin made for "next year" does **not** automatically become editable as "this year"'s master-row defaults once `base_school_year` is manually advanced at the start of a new school year. The pinned data itself isn't lost (still visible/editable via the History modal or by selecting that year directly), it just isn't promoted to the master row automatically. Workaround until this is built: after bumping `base_school_year`, re-apply Apply Aid Policy / re-enter that year's numbers directly rather than assuming last year's pre-planning carried over. A full fix would mean making offset-0 pin-aware too (reads prefer a pin if one exists for the current label, else fall back to the master row) — deliberately not done now since it touches the most heavily-used, best-tested path in the planner; revisit if the yearly rollover friction becomes a real complaint. (noted 2026-07-15)
- [x] **TAP7** — Reported "past year data didn't import" 2026-07-15, immediately after TAP5 shipped. Not a bug — confirmed by clarifying with the user that this meant the per-family list on a past year's panel, which was correctly showing its documented empty state (TAP5 explicitly scoped out backfilling per-student history for years before this feature existed, since no such data exists anywhere in the app). Two real fixes followed once the user uploaded their source workbook (`Timothy_Tuition_Aid_Master.xlsx`): (1) **`+ Add Family Record` button** added to the past-year panel — creates an `active=0` `tuition_students` row (so it never pollutes the live roster) purely to anchor a `tuition_student_years` pin for the year being viewed; `POST /tuition-aid/students` extended to accept `active` in the body (default unchanged: `1`). (2) **Verified against the actual source data** that no genuine per-student breakdown exists for any year before 2026-27 — confirmed by reading all 7 sheets of the uploaded workbook; its own "Read Me" tab admits 2024-25 was partially estimated and years before that are aggregate-only (already covered by `tuition_history`/`tuition_year_rates`). Found and imported the one real exception: the K-8 Aid Detail sheet's "Parent 2025-26" column, giving actual prior-year family-payment figures for 17 currently-enrolled students — seeded as `tuition_student_years` pins for `2025-26` via a new idempotent `seedParent2025_26(db)` (matched by family+child against the existing `TUITION_SEED_K8` rows, `INSERT OR IGNORE` against the unique constraint). `npm test` (37/37), `node --check` on all 3 built `<script>` blocks, and a Node harness that evaluated the served JS and called `tapOpenPastAdd()` directly to confirm no runtime errors. Rebased past v1.17.1–v1.20.0 (other work that landed on `main` while this was in progress — RDS5 token consolidation, RDS2b household view, two mobile/card fixes, Organization View, best-guess Person-match suggestions); confirmed no real overlap beyond the `DEPLOY_VERSION` line, since that work touches the Link-to-Person modal while this touches the past-year panel. Done 2026-07-16 (v1.20.1). (`src/api-tuition-aid.js`, `src/db.js`, `src/frontend/js-tuition-aid.js`, `src/frontend/html-tabs.js`)
- [x] **TAP8** — Reported "the WOL kids dont have an LHSA award that is high school only" 2026-07-16, in response to a follow-up "current awards are not accurate" report. Real bug in the new History modal (TAP5's `tapOpenHistory()`), not the underlying data — cross-checked `TUITION_SEED_K8` against the source workbook's K-8 Aid Detail sheet row-by-row and confirmed all 20 current-year figures match exactly, so this was never a data problem. The modal's "current" row unconditionally called `tapSplitFor(s,0)` and gated the LHS Award column on `s.attendsLHS` — which defaults `true` for every student including K-8/WOL ones (it means "still planning to attend LHS once they get there," not "currently in LHS"), so every K-8 student's live row wrongly showed the seeded $1,200 placeholder LHS rate. Mirror-image bug for LHS students: their row ran K-8 split math against inputs that don't apply to them (LHS aid is a flat `lhs_award_cents`, not a tuition/outside-aid/family-% split), producing a nonsense computed "Timothy Award." Fixed by branching on the student's actual current bucket (`tapBucketFor(tapGradeAt(s,0))`) — K-8 shows Outside Aid/Timothy Award/Family Owed with LHS Award blank; LHS shows LHS Award with the other three blank. Verified with a Node harness constructing one of each student type and confirming the rendered HTML. `npm test` (37/37), `node --check` on all 3 built `<script>` blocks. Done 2026-07-16 (v1.20.2). (`src/frontend/js-tuition-aid.js`)

<!-- Add items here as they come up. Format: - [ ] Description (noted YYYY-MM-DD) -->

### Pre-Redesign Palette Consolidation (2026-07-12)
User reviewed the Phase 20 visual-system-audit document and made 4 decisions (see RD1–RD5 above): adopt Palette A app-wide, eliminate hand-written inline colors, retire the standalone `/scheduler` route (done — see RD3), defer person-renderer consolidation to the actual redesign (done — see RD5). This section tracks the remaining palette work.

- [x] **PAL-DONE1** — Standalone `/scheduler` route retired; embedded tab is now the only supported path. Done 2026-07-12 (v1.9.5). See RD3.
- [x] **PAL1** — Canonical extended Palette A token set defined as a documented comment block above `:root` in `src/frontend/html-head.js`: maps every existing legacy/`--ev-*` token to its role as a shade/tint of the 4 core brand colors (navy `#1E2D4A`, teal `#2E7EA6`, gold `#C9973A`, cream `#F8F4EE`), and explicitly flags `--sage` vs `--ev-moss` as two legitimately distinct status greens (not a duplicate to merge) so PAL2/PAL3 don't flatten them. Also fixed one genuine duplicate found in the process: `--ev-danger` (#c0392b) now aliases `var(--danger)` (#B85C3A), matching the color already used everywhere else including the scheduler's own `--danger-btn`. Done 2026-07-12 (v1.9.6). (`src/frontend/html-head.js`)
- [ ] **PAL2** — Consolidate the admin app (`src/frontend/html-head.js` and all `js-*.js` tabs) onto the Palette A token set; remove the legacy Steel and `--ev-*` variable definitions once nothing references them.
- [x] **PAL3 (partial)** — Deleted the dead mockup-only CSS in `src/public/head.js` (`.annotation-bar`, `.annotation-pill`, `.page-divider` — never applied to any real markup, confirmed via grep). Audited the rest of the public site for raw hex and found nothing else safely convertible: every core-brand-color usage outside `:root` already uses `var(--navy)`/`var(--teal)`/etc. — the public site was already fully tokenized for its own palette. Done 2026-07-12 (v1.9.7). Full PAL3 (reconciling the public site's *own* token set — navy-pale/teal-light/moss/slate/plum-light etc. — with the admin app's) still open.
- [x] **PAL4** — Scheduler's own `:root` token *values* in `src/scheduler-html.js` aligned to the admin app's Palette-A-derived legacy tokens (`--steel-anchor` #0A3C5C→#1E2D4A, `--amber` #D4922A→#C9973A, `--charcoal` #3D3530→#1A1A2A, fonts Lora/Source Sans 3→DM Sans/Source Sans 3, etc.). Confirmed zero-risk to the live embedded tab (`scheduler-inline.js` strips this whole `:root` block on embed — ChMS's own tokens were already what render); this just fixes what the source/retired-standalone-route would show and removes the confusing "two token sets that happen to converge" indirection. `scheduler/index.html` resynced. Done 2026-07-12 (v1.9.6). (`src/scheduler-html.js`)
- [ ] **PAL5** — Sweep and eliminate the ~171 hardcoded inline hex colors identified in the audit (138 admin-app occurrences, mostly in `js-reports.js`/`js-attendance.js` chart code and inline `style="..."` strings across `js-giving.js`/`js-reports.js`/`js-attendance.js`/`js-settings.js`/most of `js-people.js`; 33 public-site occurrences), converting to references against the consolidated token set — classes where practical, CSS custom properties where a class isn't a good fit (e.g. dynamically-generated chart SVG colors). **First pass done 2026-07-12 (v1.9.7)**, scoped strictly to zero-visual-risk exact-value substitutions in `<style>` rules / `style="..."` attributes / JS `.style.property` assignments: `html-head.js` (4 CSS-rule hex + 48× `#fff`→`var(--white)`), `html-tabs.js` (22× `#fff` + 11 Volunteers/Events `#1E2D4A`/`#8A8898`→`var(--ev-navy)`/`var(--ev-muted)`), `js-core.js` (`TYPE_COLORS` turned out to be an exact undiscovered duplicate of the `--status-*` tokens — now aliases them instead of repeating the hex; plus `AVATAR_TINTS`, `filterChip()`, error banner). Explicitly NOT touched: SVG `fill=`/`stroke=` attributes (var() support there needs a visual check to confirm, so all of `js-reports.js`/`js-attendance.js`/`js-dashboard.js` chart code — the bulk of the remaining count — is still open) and any hex with no exact existing token match (e.g. `#e74c3c`/`#c0392b`, a second red distinct from `--danger` — merging those is a design decision, not a mechanical substitution).

**Scope note:** What remains of PAL2/PAL3/PAL5 — SVG chart-fill colors, `js-people.js`/`js-giving.js`/`js-settings.js` inline styles, the public site's own token-set reconciliation, and any hex with no exact token match — changes real rendered output and needs visual verification, not just `node --check`/`npx vitest run`. Expect several more batches, ideally with a live-render check (Playwright or manual) before shipping each.

### Volunteer / Events UX Redesign (2026-07)
- [x] **VUX1** — Public event sign-up: contact-first flow (day-toggle pills + contact card no longer gated behind picking a day), 3-tier capacity badges. Done 2026-07-06 (v1.5.0). (`src/public/scripts.js`, `head.js`)
- [x] **VUX2** — Public landing: "Not sure where to start?" CTA → 2-tap Find Your Fit guided flow. Done 2026-07-06 (v1.5.0). (`src/public/findfit.js`)
- [x] **VUX3** — Ministry role sign-up: new Confirm & submit step (read-back summary + reminder opt-in). Done 2026-07-06 (v1.5.0).
- [x] **VUX4** — Admin Events tab: master-detail shell + Add/Edit shift modal, replacing the always-editable inline-row table. Done 2026-07-06 (v1.5.0). (`src/frontend/js-volunteers.js`)
- [x] **VUX5** — Admin Ministry Roles tab: searchable master-detail list + side panel, all ministries at once. Done 2026-07-06 (v1.5.0).
- [x] **VUX6** — Admin Signups: status workflow (new/contacted/confirmed/declined), filter pills, inline status select. New `signups.status` column (migration `0010_signup_status.sql`). Done 2026-07-06 (v1.5.0).
- [x] **VUX7** — Admin Settings: "Volunteer Site & Notifications" card; office-notification-on-new-signup wired for real via Resend. Done 2026-07-06 (v1.5.0).
- [x] **VUX8** — Admin Volunteers tab: snapshot stat row (open/filled shifts, new signups, upcoming events). Done 2026-07-06 (v1.5.0).
- [x] **VUXBUG1** — `vol-link-person-modal`/`vol-send-email-modal` used a dead `.modal-box` class (no CSS) plus a hardcoded `style="display:none"` that permanently defeated the `.open` toggle — both modals never actually showed their card styling. Fixed by switching to the shared `.modal` class with no inline display override. Found via Playwright verification, not inspection. Done 2026-07-06 (v1.5.0).
- [x] **VUXBUG2** — "Link to Person" button's `onclick` embedded `JSON.stringify(...)` output (double-quoted) inside a double-quoted HTML attribute, truncating the handler for every signup. New `volJsAttr()` helper HTML-entity-encodes the quotes. Done 2026-07-06 (v1.5.0). (`src/frontend/js-volunteers.js`)
- [x] **VUX9** — Second pixel-fidelity pass on Ministry Roles/Events admin screens: v1.5.1 still substituted this app's existing warm tokens for the mockup's own literal hex values instead of using them exactly. Rewrote `.ev-*` CSS with the mockup's literal navy/muted/cream/moss/danger hex values, added Lora as a third loaded font, fixed exact wording ("Open on site"/"Add role"/"Show event"/"Hide event"), fixed a `.ev-fields label` uppercase rule that was also collapsing the visibility-toggle `<label>` to `display:block` (splitting "Visible" with a floating toggle knob), and replaced the stacked/scrolling Signups+Ministry Roles+Events layout with a `Signups | Ministry Roles | Events` sub-tab switcher (`volShowSection()`) so only one section shows at a time — matching the mockup's sidebar → list → detail three-pane structure instead of a continuous run of panels. Done 2026-07-06 (v1.5.2). (`src/frontend/html-head.js`, `html-tabs.js`, `js-volunteers.js`)
- [x] **VUX10** — Converted the always-present, hover-to-expand sidebar rail into an off-canvas hamburger drawer at all screen sizes (previously this only happened under a `max-width:700px` media query; desktop kept a persistent 54px rail that hover-expanded to 200px). That fixed rail was silently narrowing every admin screen's usable width below what the design mockups assume. `.content-area` no longer reserves `margin-left:54px`; the hamburger button (already wired to the existing `openSidebar()`/`closeSidebar()`/backdrop/close-on-navigate JS) is now visible at every screen size instead of only under 700px. Done 2026-07-06 (v1.5.3). (`src/frontend/html-head.js`)
- [x] **VUX11** — Removed the four Volunteers snapshot stat cards (not in any mockup) and converted the Signups/Ministry Roles/Events sub-nav from a horizontal tab row into a left-side vertical navy menu matching the mockup's inner "TLC Admin" sidebar exactly — sitting inside the same shell card as the active panel (sidebar → list → detail, all one card) instead of a horizontal strip above a separately-carded panel. Done 2026-07-06 (v1.5.4). (`src/frontend/html-tabs.js`, `html-head.js`, `js-volunteers.js`, `js-core.js`)
- [x] **VUX12** — Folded "Outreach Email Templates" into the same left sub-nav as Signups/Ministry Roles/Events, with a divider line beneath Events — content now folds out into the shared shell via `volShowSection()` instead of always sitting visible below the card. Done 2026-07-06 (v1.5.5). (`src/frontend/html-tabs.js`, `html-head.js`, `js-volunteers.js`)
- [x] **VUX13** — Static-to-dynamic ministry roles migration. Root cause of the "we lost all the ministry roles" report: not data loss — VUX5 built the `ministry_roles` table + admin CRUD but never migrated the roles hardcoded as static HTML in the public ministry pages, so the admin tab only ever had the one manually-added role. Extracted all 21 static roles (Worship 7, Christian Ed 4, Acceptance 4, Outreach 6) into `MINISTRY_ROLES_SEED` + `seedMinistryRolesFromStatic(db)` in `src/db.js` (per-role `WHERE NOT EXISTS` guard, called from `_doInitDb`), removed the now-redundant static markup from `src/public/ministries/{worship,education,acceptance,outreach}.js` (role cards now render entirely from the existing dynamic fetch), and grouped the admin Ministry Roles list by ministry with section headers. Done 2026-07-06 (v1.6.0).
- [x] **VUX14** — Made the Ministry Roles group headers collapsible: click a ministry section header to collapse/expand its roles (chevron indicator). The group containing the currently-selected role always stays expanded; collapse state is bypassed while searching so matches are never hidden. Done 2026-07-06 (v1.6.1). (`src/frontend/js-volunteers.js`, `html-head.js`)
- [x] **VUX15** — Admin Volunteers tab mobile layout fix. The VUX11 left-side navy sub-nav (Signups/Ministry Roles/Events/Templates) had no mobile breakpoint — a fixed 170px rail was crushing the content pane on phones (same class of bug VUX10 fixed for the outer app sidebar, but never applied to this newer inner rail). Below 700px the shell now stacks into a column and the rail becomes a horizontal scrollable pill row above full-width content. Also fixed a compounding bug where an inline `style="width:290px"` on the Ministry Roles list column was silently defeating the existing `.ev-master-detail` mobile stacking rule (inline styles beat media-query class rules) — moved to a `.ev-list-col-wide` class so the responsive override applies. Verified with a static Playwright render at 390px. Done 2026-07-07 (v1.6.8). (`src/frontend/html-tabs.js`, `src/frontend/html-head.js`)
- [x] **VUX16** — Removed the "All / Worship / Events / Education / Acceptance / Outreach / General" ministry filter pill row above the Signups list — clutter, especially on mobile. Deleted `#vol-ministry-tabs` and the now-dead `volSetTab()` handler; status pills (New/Contacted/Confirmed) and per-row ministry labels are unaffected. Done 2026-07-08 (v1.6.9). (`src/frontend/html-tabs.js`, `src/frontend/js-volunteers.js`)
- [x] **VUX17** — Transportation Ministry converted to dynamic role cards, closing the gap where it showed on the public site but had no admin editing surface (it predated VUX13's Ministry Roles system — no `role-grid`, zero seeded roles, not wired into dynamic role loading). Seeded 3 default roles, added the role-grid + "Selected roles" preview to the public page matching Worship/Education/Acceptance/Outreach, wired `showPageAndLoad()`/`updatePreviews()`/the submit handler. Left off `_STEP_CFGS` (multi-step wizard) since its extra fields don't fit that flow. Also fixed a regression of the SC3-BUG1 syntax-error class in `src/scheduler-html.js` (7 new unescaped `\'Source Sans 3\'`/`\'Lora\'`/`here\'s` occurrences breaking the whole embedded `<script>` block), found incidentally while verifying the built HTML still parses — pre-existing on `main`, not introduced this session. `scheduler/index.html` was not resynced (separate follow-up — see NOTES.md). Done 2026-07-10 (v1.7.3). (`src/db.js`, `src/public/ministries/transportation.js`, `src/public/scripts.js`, `src/scheduler-html.js`)
- [ ] **VUX-DEFER1** — Weekly digest to ministry leaders: Settings toggle exists and saves the preference, but no digest cron/sending logic was built (needs ministry-leader contact mapping, which doesn't exist yet). (noted 2026-07-06)
- [ ] **VUX-DEFER2** — Automated SMS/text reminder before a volunteer's first Sunday: the confirm-step checkbox stores `sms_reminder_opt_in` for staff visibility only — no automated send exists (ministry-role signups are recurring with no specific date to schedule a reminder against). (noted 2026-07-06)

### Branding / Public Site (2026-05)
- [x] **BR2** — TLC Gather rebrand. Done 2026-05 (PRs #454–#457). Three-pillar identity (People/Ministry/Giving), Cormorant Garamond + DM Sans, navy/teal/gold tokens, sidebar mark + wordmark lockup, topbar pill driven by `showTab()`, PWA icons + manifest under `icons/`.
- [x] **VS1** — Public volunteer page (`volunteer.timothystl.org`): added Transportation Ministry signup card. Done 2026-05 (PR #452).
- [x] **VS2** — `PUBLIC_HTML` split into per-section modules under `src/public/`, mirroring the IN3 split of `html-chms.js`. Each ministry is now a ~100-line file editable without sub-agent. Done 2026-05 (PR #453).
- [x] **BX1** — `member_type` case bug: Breeze returns "Member" (capitalized). All write sites now lowercase at the JS binding level + defensive `LOWER()` pass at end of each batch sync. Done 2026-05.

### Auth / Login
- [x] **AU1** — Done 2026-05-21 (v226). New `email` column on `app_users` (migration `0008_app_users_email.sql` + runtime). Login page has a "Forgot password?" link that toggles an inline form (username or email). `POST /admin/forgot-password` always returns 200 (no account enumeration), rate-limited 5/15min per IP. Reset token (32 random bytes hex) stored in `RSVP_STORE` with 1-hour TTL. Email sent via Resend with a branded button to `/admin/reset?token=...`. The reset page validates the token, requires matching new passwords (≥8 chars), updates `password_hash`, deletes the token. Settings → Users gains an Email column and an Email field in the create/edit modal.
- [x] **FH6** — Done 2026-05-20 (v225). New `PATCH /admin/api/people/:id` sparse-update endpoint that only writes fields present in the body (plus `tag_ids` array if present). `markSeenToday`, `savePvTags`, `confirmAddToHh` switched from PUT-with-full-snapshot to PATCH-with-only-the-changed-field. No more clobbering of concurrent edits.
- [x] **RI2** — Done 2026-05-20 (v225). Breeze sync now finds a separate boolean/dropdown field for "Baptized"/"Confirmed" (when a sibling field exists alongside the date field) and sets `baptized=1`/`confirmed=1` if either the date OR the dropdown is truthy. Both bulk and per-person sync paths updated; new `isYes`/`isYesPS` helpers handle "Yes"/"true"/"1"/"baptized"/"confirmed"/"on" values. Existing rows pick up the flag on next sync.
- [x] **BUG2** — Partial 2026-05-20 (v225). Improved validate-address error surfacing in both per-person and contact-editor buttons — `.catch` handlers now show the real error and prompt admin to set USPS keys. Documented `USPS_CLIENT_ID`/`USPS_CLIENT_SECRET`/`USPS_USER_ID`/`LOB_API_KEY` as optional secrets in `SECRETS.md` with provisioning steps. (Bulk-validate already exists in Settings → Import/Export.) The underlying error itself is "no real provider configured" — fix is to set USPS OAuth keys on the worker.

### Settings
- [x] **ST1** — Hide testing sections in Settings tab from non-admin users (birthday/anniversary/SMS test buttons, etc.) — done 2026-05-01 (v165). Added `require-admin` class to EM2 and SMS1 import-cards.

### People List
- [x] **PL1** — Members-first people list: default view shows Members only; "Members" toggle button in toolbar switches to all-types view. Done 2026-04-20 (v82).
- [x] **PL2** — Archive/Deceased people: `status` column (`active|archived|deceased`) added; archived/deceased hidden from default list; "Archived" toggle button in toolbar; Archive/Deceased/Reactivate buttons on profile; anniversary cards exclude deceased. Done 2026-04-20 (v81).
- [x] **PL3** — People Directory / Person Profile / Household View visual redesign (warm navy/teal/gold palette, larger high-contrast type, real mobile Call/Email/Map buttons, List/Card toggle, Household View converted from modal to full page). See NOTES.md 2026-07-03 entry for full detail. Done 2026-07-03 (v1.4.0).

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
- [x] **G20** — Sync removes orphans automatically. The conservative same-person+same-date "current replacement" gate on the sync's orphan cleanup pass was leaving permanent extras whenever Breeze edits changed the contribution date or fully deleted a payment via `bulk_contributions_deleted`. Removed the gate: any DB row whose `breeze_id` is absent from `giving/list` for the window is deleted. Safeguards: skip cleanup if `giving/list` returned `>= 10000` rows (truncation) or if `> 50%` of in-window rows would go (likely API failure). Split-suffix `pid-N` legacy rows are matched against their base pid. Done 2026-04-27 (v148).
- [x] **G18** — Reconcile Diagnose tool. The 2025 discrepancy (+$9,743.50 across 4 funds, 43 entries) persisted after v86's Reconcile Orphans and after a full delete+resync. New read-only `GET /admin/api/giving/reconcile-diagnose?from=...&to=...` returns every DB entry in the range classified by whether its `breeze_id` still exists in Breeze's giving/list, plus per-fund extras totals, classification counts, twin-row detection (person+date+amount siblings with different `breeze_id`), and a `missing_from_db` inverse list. "Diagnose" button on Giving by Fund report renders the results table; "Export Extras CSV" dumps the extras for review. Surgical tool — no mutations — to identify *what* the 43 extras are before choosing a permanent fix. Candidates to expect: entries with empty `breeze_id` (manual/quick-entry — Reconcile Orphans can't see them), split-suffix rows `pid-2`/`pid-3` from the legacy CSV importer, or duplicate imports where audit-log `object_json` and giving/list `id` disagree. Done 2026-04-21 (v88).
- [x] **G8** — Re-import all giving years (2022–2026) after G6 fixes. Completed 2026-04-17 — all years 2021–2026 verified correct.
- [x] **G10** — Correction pass bug fixed (v85, 2026-04-21). Added orphan cleanup pass: after sync, DB entries in the window whose `breeze_id` no longer appears in giving/list are deleted if a current replacement exists for the same person+date. The supplement pass (v74) already imports the corrected version; this cleans up the stale old entry. Handles all cases where Breeze creates a new payment ID on edit.
- [x] **G11** — Verified 2026-04-24. All four entries (Anne Gonzalez, Pat Hunt, Horst Herrmann, John Hagan) confirmed correct after sync.
- [x] **G12** — Verified 2026-04-24. Leah Sieveking fund change confirmed correct.
- [x] **G13** — Verified 2026-04-24. Sue Koch and Thanh Nguyen ghost fund entries resolved; no duplicates.
- [x] **G14** — Verified 2026-04-24. Entry 488482959 gone; 514675972 (General Fund) correct.
- [x] **G15** — Verified 2026-04-24. Ron Rall split confirmed ($3,735.45 General + $1,500 PNG Mission).
- [x] **G16** — Verified 2026-04-24. Kathy Carr TUB Bees fund confirmed correct.

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
- [x] **PF2** — Filter people by positive attributes: age range and gender added to filter drawer (2026-05-01, v165). Gender radio (Any/Male/Female/Not set) and Age Range radio (Any/Under 18/18-29/30-44/45-64/65+) — both backend and frontend wired. Household type and sacramental status deferred (less commonly needed).

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
- [x] **SC3** — "Focus Week" redesign (week-rail + single-week detail pane, role-row + picker popover, People tab List/By Role/Availability switcher, toggle-chip Edit panel). Done 2026-07-06 — see NOTES.md entry for full detail. **`scheduler/index.html` and `src/scheduler-html.js` were found ~1,645 lines drifted apart** (the latter is what's actually served — `scheduler/index.html` is a design-reference copy only) and were re-synced; keep them identical going forward, or edits to `scheduler/index.html` alone will never go live.
- [x] **SC3-BUG1** — Closed 2026-07-07 (v1.6.6). The "schedule area is blank" report survived three prior attempted fixes (v1.6.3/v1.6.4/v1.6.5) because the true cause was a load-time `SyntaxError` in the scheduler's embedded `<script>`, not a runtime logic bug — no amount of try/catch reasoning could have found it, and it doesn't show in Chrome's Issues panel (only `Uncaught SyntaxError` in the plain Console tab). Cause: `\'Source Sans 3\'` / `\'Lora\'` font-family strings inside `SCHEDULER_HTML`'s outer template literal used a single backslash, which the outer literal itself consumes at module-load time, emitting an unescaped `'` into the served script and breaking its string literal — aborting the whole `<script>` block, including the `schedInitScheduler` definition. **Debugging technique that finally found it**: extract the `<script>...</script>` bodies from the built `CHMS_HTML` output and run `node --check` on each — this catches parse errors statically, before ever touching a browser. Do this FIRST on any future "nothing renders / silently does nothing" scheduler report, before chasing runtime logic. (`src/scheduler-html.js`)
- [x] **SC3-POLISH1** — Done 2026-07-07 (v1.6.7). Three Focus Week tweaks: default rail selection to the next upcoming Sunday (`focusWeekDefaultIdx()`), remove per-person initials avatar from role rows, and show lectionary sub-labels as "(Proper 10)" instead of raw "(prop10)". Mirrored into `scheduler/index.html`.
- [x] **SC3-BUG2** — Closed 2026-07-10 (v1.7.3). Regression of SC3-BUG1: 7 new unescaped `\'Source Sans 3\'`/`\'Lora\'`/`here\'s` occurrences in newer email-template functions (open-slot notification, weekly reminder) broke the whole embedded `<script>` block again, on `main`, before this session touched anything — found incidentally while verifying an unrelated change with the `node --check`-on-extracted-`<script>` technique documented in SC3-BUG1. Fixed by doubling the backslash, same as before. (`src/scheduler-html.js`)
- [x] **SC5** — Full resync done 2026-07-11. Regenerated `scheduler/index.html` by evaluating `SCHEDULER_HTML` through its module (not copying the raw template-literal source, which still carries doubled backslashes meant to survive that evaluation step — see SC3-BUG1) and writing the resulting served string verbatim. Confirmed the extracted `<script>` block parses (`node --check`). This is the actual served content, byte-for-byte, so the two files can't drift on syntax again — only on new features added directly to `src/scheduler-html.js` without a follow-up resync, same as before. (`scheduler/index.html`)
- [ ] **SC4** — Mobile self-service "My Schedule" (mockup's other mobile pane): a volunteer confirms/declines/swaps their own assignment from their phone. Deferred during SC3 — this scheduler has no per-volunteer login today (one shared staff/admin login), so there's no way to know which person is "me." Needs a volunteer identity/login system (magic-link or a lightweight PIN tied to a person record) before this can be built for real; explicitly not scoped as part of SC3. (noted 2026-07-06)
- [ ] **SC6 — Native Scheduler rewrite (considered, not started)** — Discussed during RDS5 (2026-07-15): rewrite Scheduler's frontend as native ChMS modules (assembled into `html-chms.js`/`html-tabs.js` like every other tab, using the shared `api()`/`openModal()`/`acSearch()` helpers and card classes) instead of the current embed-and-transform approach (`scheduler-inline.js` strips/rescopes `SCHEDULER_HTML` at load time). Would eliminate the `scheduler-html.js` ↔ `scheduler/index.html` resync risk that caused SC3-BUG1/SC3-BUG2, and end the duplicate reimplementation of things the rest of the app already has. **Declined for now**: `scheduler-html.js` is ~5,872 lines (~4,764 of that JS, 176 functions) — roughly 8x `js-people.js`, the largest tab converted in the RDS-redesign — and Scheduler is a live, actively-relied-on feature (weekly volunteer scheduling, RSVP, ICS export, reminder emails), so this is a real migration project with real regression risk, not a redesign-pass task. The *visual* motivation for it is largely already moot: the embedded tab already inherits current CSS tokens automatically. If revisited, start with a full feature-inventory pass (no code changes) before any porting, given the size.

### Breeze Integration
- [x] **BR1** — Reverse sync (app → Breeze). Done 2026-04-26 (v133). Auto-push new people to Breeze on create (no `breeze_id`); auto-update Breeze when name/contact fields change on people who have a `breeze_id`. `updatePerson` added to `breeze.js`. Field-ID discovery/building extracted to shared helpers. Manual "Push to Breeze" button remains as fallback.
- [x] **BR3** — Reverse sync of **date/sacramental fields** (app → Breeze). Done 2026-07-13 (v1.11.0). Extends BR1 so setting or **clearing** `dob`/`baptism_date`/`confirmation_date`/`anniversary_date` on a person with a `breeze_id` pushes to Breeze on save (PUT + PATCH). Closes the loop from the v1.10.0 anniversary-deletion fix — a clear now propagates instead of being re-imported. New `getBreezeDateFieldIds()` (cached in `chms_config.breeze_date_field_ids`) + `buildBreezeDateFields()` (only changed fields; empty value = clear = format-safe; `0001-` sentinels + unknown field-ids skipped). Fire-and-forget; writes `reverse_sync_breeze` audit rows. **⚠ Needs live-Breeze verification** — no Breeze API access in-session and dates had never been written to Breeze before; the *set* path assumes `YYYY-MM-DD` and the discovered `field_type`. Verify in prod, adjust `buildBreezeDateFields()` if Breeze rejects the format. (`src/api-people.js`)

### Reports / Insights (noted 2026-04-22)
- [x] **R1** — Age group breakdown across Membership Summary, Giving. Done 2026-04-22 (v102). Default buckets: Under 18, 18–29, 30–44, 45–64, 65+, Unknown (no DOB). Membership Summary gets an "By Age Group" table with count + share %. Giving by Fund gets a "By Age Group" table with givers, gifts, total, avg/giver, share %. Attendance age-groups deferred — we only track service totals, not per-person attendance (would require R6).
- [x] **R2** — Giving insights report: top givers (top N by year), lapsed givers (gave in prior year, nothing this year), giving frequency distribution, average gift amount trends. Done 2026-04-22 (v99). New `GET /admin/api/reports/giving-insights?year=YYYY` endpoint; new "Giving Insights" tile in Reports tab. Renders four blocks: top 25 givers (clickable to profile), lapsed givers (prior-year donors absent this year, sortable by prior total), frequency histogram (1 / 2-5 / 6-12 / 13-26 / 27+ gifts per giver this year), and 5-year trend table (givers/gifts/total/avg gift/avg per giver).
- [x] **R3** — People insights report. Done 2026-04-23 (v110). New `GET /admin/api/reports/people-insights` endpoint; new "People Insights" tile. Six sections: new contacts bar chart (24 months), new people by year × member type cross-tab, age distribution bars (6 buckets), gender pie chart, household composition bars (single/couple/small/large/none), sacramental pipeline bars (members only: neither/baptized/confirmed/both).
- [x] **R4** — Member tenure report. Closed — `member_since`/`join_date` not in Breeze field mapping; deferred indefinitely. (2026-05-01)
- [x] **RI1** — People Insights: default scope to Members only. Done 2026-05-01 (v165). Backend accepts `scope=member|active` param (default `member`); frontend shows "Members Only / All Active" toggle buttons; all six chart block titles updated to reflect scope.
- [x] **RI2** — Closed — stale duplicate entry. Already fixed under the Auth/Login queued items (Breeze sync sets `baptized`/`confirmed` booleans; `src/db.js` also backfills them from existing `baptism_date`/`confirmation_date` text columns on cold start); this line just never got checked off. Re-verified directly against current code 2026-07-11.
- [x] **R5** — Contact info completeness report: counts of people missing email / phone / address / dob / photo; drill-down list per category. Done 2026-04-22 (v99). New `GET /admin/api/reports/contact-completeness?scope=active|member&field=...` endpoint. New "Contact Completeness" tile renders progress bars (green = complete) for each field with scope toggle (all active vs. members only); clicking a row drills to the list of missing records (clickable to profile).
- [x] **R6** — Person-by-person attendance tracking. Closed — out of scope; service-total tracking is sufficient for now. (2026-05-01)
- [x] **R7** — Easter/Christmas markers on Giving Trend chart. Done 2026-04-22 (v99). Easter computed per-year via Meeus/Jones/Butcher Gregorian algorithm, rendered as dashed vertical line in that year's color with "E" label. Christmas is shared Dec 25 dashed line in warm-gray with "C" label. Legend updated to explain the markers.
- [x] **R8** — Giving × Attendance overlay chart. Done 2026-04-22 (v102). New `GET /admin/api/reports/giving-vs-attendance?from=&to=` endpoint. Groups both datasets by Sunday-of-week. New "Giving × Attendance" tile on Reports tab. Chart: green bars (attendance, left axis) + teal line (giving, right axis). Overview stats include Weeks, Total Attendance, Total Given, Avg per Attender, and Pearson correlation coefficient with a qualitative label (Strong+/Moderate+/Weak+/None/Weak−/etc.).
- [x] **R9** — Pie chart for Giving by Method. Done 2026-04-22 (v99). New reusable `renderPieChart(items, diameter)` helper (SVG slices with hover tooltips + legend). Added "Share by Method" block above the existing table on the Giving by Method report.
- [x] **R10** — Average giving stats overlay. Done 2026-04-22 (v102). Giving by Fund overview now has 5 tiles (added "Avg / Giver" = total / distinct givers, relabeled "Average Gift" → "Avg / Gift"). "Avg / Giver" also appears per age-group row in the new R1 table. Giving Insights already had both avg stats in its 5-year trend table (from v99). Giving Trend chart stats deferred — the per-year tile total in its legend already serves the year-level averages context.

### Bugs (noted 2026-05-01)
- [x] **BUG1** — `normalizePhone()` throws on non-string input. Fixed 2026-05-19 (v218) via BF12.
- [x] **BUG2** — Re-traced 2026-07-11. Bulk-validate mode already existed (confirmed, matches the note in the earlier partial fix above). Re-checked the "no real provider configured" diagnosis from that fix and found it's incomplete: `validateAddressCore()` already falls back to a free Census geocoder (no key required) rather than hard-failing, so a bare "gives an error" report doesn't fully square with "no provider configured." Found and fixed a real, separate bug along the way: when the Census fallback is used, the UI said "✕ Address not found by **USPS**" even though USPS was never queried. New shared `validateAddrResultMsg()` helper labels Census-sourced results correctly and points the admin at the actual fix (add a USPS/Lob key) instead of the misleading message. Could not reproduce the original hard-error report directly — this session has no network path to census.gov/USPS/Lob to observe a live failure, and no production secrets/logs. If it recurs, capture the exact error text shown (now more specific per-provider) for a fast diagnosis. (`src/frontend/js-people.js`)
- [x] **BUG3** — "Can't delete anniversary from a person even if they have no partner." Done 2026-07-13 (v1.10.0). Root cause was **two** things, neither of them the edit itself (confirmed the frontend already sends `null` and the `PUT` stores `''`, verified against real SQLite + the actual served payload): (1) native `<input type="date">` has no obvious clear affordance, so staff had no discoverable way to remove a date — added an explicit **Clear** link to all date fields in the profile inline Demographics editor (`pedDateField`) and the person-edit modal via a new shared `clearDateField(inputId, cbId)` helper; (2) the household anniversary-propagation passes (bulk Breeze sync in `api-import.js`, immediate PUT in `api-people.js`) could refill a just-cleared anniversary from a partner (including a *deceased* one) with no `locally_edited` guard — added `AND locally_edited=0` and a deceased-partner exclusion to both. Not changed: per-person "Sync Breeze" still re-imports Breeze's value verbatim by design. (`src/frontend/js-people.js`, `src/frontend/html-tabs.js`, `src/frontend/html-head.js`, `src/api-import.js`, `src/api-people.js`)

### Engagement & Data Quality (noted 2026-04-22)
- [x] **FU1** — Prayer request tracking. Done 2026-04-23 (v107/v108). API dispatch bug fixed (prayer-requests and engagement routes were missing from api-admin.js dispatch list — all status changes returned 404). Cancel guard bug fixed in prayerSetStatus. Dashboard card now has Praying/Answered/Close buttons (working), + Add modal, and "↓ CSV" export button (`GET /admin/api/prayer-requests/export.csv?status=all|open|praying|active|answered|closed`). Website contact and prayer forms wired end-to-end via service binding (timothystl/website) — submissions create person records and prayer_requests rows in this DB.
- [x] **WC1** — Electronic contact card intake. Done 2026-04-23. Website contact form → admin worker → service binding → `/api/intake/connect-card` creates Visitor + follow_up_items row. Website prayer form → `/api/intake/prayer` creates prayer_requests row. Both confirmed working end-to-end.

### Infrastructure / Backend Cleanup (noted 2026-04-22)
- [x] **IN1** — Worker renamed to `tlc-chms`. Done 2026-04-24 (Phase 3).
- [x] **IN2** — App merge strategy decided: Option C (absorb scheduler, leave website admin separate). No active work needed now. Done 2026-05-01.
- [x] **IN3** — Split `html-chms.js` into per-tab modules. Done 2026-04-25 (v120). `html-chms.js` reduced from 9,443 → 311 lines; 13 string-fragment modules in `src/frontend/` (`html-head.js`, `html-tabs.js`, `js-core.js`, `js-settings.js`, `js-dashboard.js`, `js-people.js`, `js-register.js`, `js-households.js`, `js-giving.js`, `js-reports.js`, `js-export-import.js`, `js-attendance.js`, `js-volunteers.js`). Shell assembles them; `CHMS_HTML` unchanged byte-for-byte.
- [x] **IN4** — Split `api-chms.js` into domain modules. Done 2026-04-24 (v114–v118). `api-chms.js` now 533 lines (was 5,151); domains in `api-people.js`, `api-giving.js`, `api-households.js`, `api-reports.js`, `api-import.js`, `api-utils.js`.
- [x] **IN5** — Extract Breeze API client into `src/breeze.js`. Done 2026-04-24 (v114). New `makeBreezeClient(env)` factory returns null when env vars missing; all 9 endpoints wrapped; raw `Response` objects returned so all caller error handling is unchanged. `subdomain` exposed on client for photo CDN URL construction. All 12 Breeze-calling handlers in `api-chms.js` updated; `filter_json` pre-encoding preserved.
- [x] **IN6** — Secrets inventory doc. Done 2026-04-24 — see `SECRETS.md`.
- [x] **IN7** — D1 schema migrations system. Done 2026-04-23. `migrations/` directory created with `0001_baseline.sql` (complete schema as of today). `wrangler.toml` updated with `migrations_dir = "migrations"`. **To add a new column going forward**: (1) create `migrations/NNNN_description.sql` with the `ALTER TABLE ADD COLUMN` statement, (2) also add the same statement to the `migrations` array in `src/db.js` with a try/catch (keeps cold-start safety net working), (3) run `wrangler d1 migrations apply tlc-volunteer-db --remote` to apply to prod.
- [x] **IN8** — Audit log retention / pruning. Done 2026-04-23. `pruneAuditLog(db)` added to `tlc-volunteer-worker.js`, called from the existing `0 14 * * *` daily cron. Retention: `birthday_email_sent` / `anniversary_email_sent` → 60 days; all other rows → 365 days. Logged under `audit_prune` in cron output.
- [x] **IN9** — Staging environment live at `https://breeze-proxy-worker-staging.timothystl.workers.dev/chms`. Separate `wrangler.staging.toml` config; D1: `tlc-volunteer-db-staging`, KV: staging RSVP_STORE, shared R2, crons disabled. Deploy: `wrangler deploy --config wrangler.staging.toml`. Done 2026-04-24.
- [x] **IN10** — D1 backup/restore runbook. Done 2026-04-24 — see `## D1 Backup & Restore` section in this file.
- [x] **IN11** — Test harness. Done 2026-04-25 (v121). Vitest; 37 tests in `test/`: `utils.test.js` (disambiguateHHName), `auth.test.js` (hashPassword/verifyPassword), `csv-import.test.js` (parseFundSplits/givingEntryId/isGivingDup). `npm test` passes.
- [x] **IN12** — Dead-code sweep. Done 2026-04-24 (v113). Removed debug `console.log('[Breeze Sync]…')` from per-person Breeze sync in `html-chms.js` and dead `setFdTag` function (comment said "keep for legacy callers" but no callers existed). Both `api-chms.js` and `html-chms.js` were otherwise clean — comments are explanatory, `console.error` calls are the intentional global error boundary.

---

## D1 Backup & Restore

### Recovery options

**Option 1 — Cloudflare Point-in-Time Recovery (PITR)**
Cloudflare retains D1 backups for ~30 days. This is the fastest path for recent accidental data loss.

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → Workers & Pages → D1 → `tlc-volunteer-db`
2. Click **Backups** tab → select a timestamp before the incident
3. Click **Restore** — this overwrites the live DB with the selected snapshot
4. Verify in the app (dashboard stats, spot-check a person record)

**Option 2 — Manual export via Wrangler (any-time snapshot)**
```bash
# Export the live DB to a local SQL file
wrangler d1 export tlc-volunteer-db --remote --output backup-$(date +%Y%m%d).sql

# Restore from that file to a fresh/existing DB
wrangler d1 execute tlc-volunteer-db --remote --file backup-20260424.sql
```

**Option 3 — Export to R2 for long-horizon retention (manual, monthly)**
```bash
# Export, then upload to the tlc-chms-photos bucket under a backups/ prefix
wrangler d1 export tlc-volunteer-db --remote --output /tmp/db-backup.sql
wrangler r2 object put tlc-chms-photos/backups/db-$(date +%Y%m%d).sql --file /tmp/db-backup.sql
```
R2 backups persist beyond the 30-day PITR window. Recommended before any risky migration or sync operation.

### Before any risky operation
Always export a snapshot before: running bulk giving sync, applying new migrations, or running Force Remove Orphans.

```bash
wrangler d1 export tlc-volunteer-db --remote --output pre-op-backup-$(date +%Y%m%d-%H%M).sql
```

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
- [ ] `DEPLOY_VERSION` bumped in `src/frontend/js-core.js` on every commit that changes the frontend (use semver `major.minor.patch` — bump patch for bug fixes, minor for new features, major for breaking changes)
- [ ] New tabs added to `showTab()` labels map and trigger their load function

### Data Integrity
- [ ] Any query returning a household name uses COALESCE fallback for `head_first_name` (not all members have `family_role='head'`)
- [ ] Giving amounts stored and retrieved as **integer cents**, converted to dollars only at display time (`/ 100`)
- [ ] New person/household fields default to `''` (empty string) not NULL where possible — avoids COALESCE boilerplate everywhere

### Before Every Push
- [ ] `DEPLOY_VERSION` is bumped (semver `major.minor.patch`)
- [ ] `NOTES.md` Recent Changes has an entry for this version
- [ ] `CLAUDE.md` Queued Items updated — new items added, completed items checked off
- [ ] Pushed to a `feature/<short-description>` branch, not main

---

## Gotchas & Patterns

- **NEVER run `wrangler deploy` from a local terminal.** The GitHub Actions workflow (`deploy.yml`) deploys automatically when any PR merges to `main`. Running wrangler locally risks deploying stale code from the wrong folder and overwriting the correct production version. If a deploy looks wrong, re-run the Action from GitHub → Actions tab instead.
- **Local `~/Desktop/volunteer` folder is the old repo clone** — remote was originally `timothystl/volunteer`, renamed to `timothystl/chms`. If ever needed: `git remote set-url origin https://github.com/timothystl/chms.git`. But prefer GitHub Actions over local deploys entirely.
- `disambiguateHHName(name, headFirst)` — shared helper at top of `api-chms.js`. Always use COALESCE fallback in `head_first_name` subqueries (not all members have `family_role='head'`).
- **Breeze giving CSV format quirks**: (1) Split-fund donations appear as multiple rows with the same Payment ID (one row per fund). The importer handles this with nth-occurrence tracking (`pid`, `pid-2`, `pid-3`). (2) Sub-fund names like "40085 Christmas Offering" are stored as separate fund records — they are NOT rolled into "40085 General Fund". The Giving by Fund report groups them by numeric prefix. (3) Negative entries are valid (refunds/adjustments) and are imported. (4) "nan" fund name = blank field from Excel export → maps to General Fund. (5) Person IDs may have `.0` float suffix — stripped on import.
- **Anniversary secondary lookup**: only requires `active=1` and non-deceased — does NOT filter by `family_role` or `member_type`, since the qualifying person already passed those checks and their partner may be a visitor or have no role set.
- Dashboard birthday/anniversary: two separate cards since v23. Copy functions: `dashCopyBirthdays()` / `dashCopyAnniversaries()`. Anniversary rows are couple-paired by household+date in the API before returning.
- `api()` helper in frontend handles 401→redirect. Always use it instead of raw `fetch` for `/admin/api/*` calls.
- All modals have specific IDs (e.g. `person-modal`, `hh-modal`). There is no generic `modal-overlay`. Use `openModal(id)` / `closeModal(id)`.
- DEPLOY_VERSION is at the top of `src/frontend/js-core.js` (moved from `html-chms.js` after IN3 split). Bump it on every commit that changes the frontend. Format: `major.minor.patch` semver — patch for fixes, minor for new features, major for breaking changes. Started at `1.0.0` (2026-06-01, formerly v233).
- **Editing volunteer.timothystl.org**: do NOT search/edit `src/html-templates.js` for ministry copy — the public page is assembled from `src/public/` modules. To tweak a ministry, edit `src/public/ministries/<name>.js` directly. Global CSS lives in `src/public/head.js`; all JS (form handlers, routing) in `src/public/scripts.js`.
- **Brand tokens** (TLC Gather): `--color-navy:#1E2D4A`, `--color-teal:#2E7EA6`, `--color-gold:#C9973A`, `--color-cream:#F8F4EE`. Fonts: Cormorant Garamond (display) + DM Sans (head/body). Three-pillar pill system in topbar driven by `pillars` map in `js-core.js` `showTab()`.
- **member_type** is stored lowercased. Both Breeze write paths (per-person at line ~2442, bulk at line ~2777 of `api-import.js`) call `.toLowerCase()` before binding; a defensive `UPDATE … SET member_type=LOWER(member_type)` runs at end of each sync batch as a safety net. Frontend filters use `LOWER()` comparison.

---

## GitHub Repo

**Repo**: `timothystl/chms` (renamed from `timothystl/volunteer` 2026-04-25 — Worker is `tlc-chms`, D1 is `tlc-volunteer-db`)

## Dev Branch

Create a new branch for each session's work using the pattern `feature/<short-description>` (e.g. `feature/anniversary-widowed-fix`). Do not push directly to main.

**PR workflow:** When working in a cloud session (feature branch required by session config), create the PR using the GitHub MCP tool and immediately merge it — do not leave it as a draft for the user to merge. GitHub Actions deploys on merge to `main`. Always paste the PR URL in the chat so it's visible.
