# CLAUDE.md — TLC ChMS App

Read this at the start of every session. Update NOTES.md (and this file if needed) as items are discovered, fixed, or queued.

---

## What This App Is

**Connect** — the Church Management System for Timothy Lutheran Church, used by both staff (full admin access) and members (a filtered, read-only directory view via `role='member'`, tab-hidden in the frontend — see the Connect section under Queued Items). Built on **Cloudflare Workers + D1 (SQLite)**. Single-page admin app assembled from per-tab modules under `src/frontend/` (shell in `src/html-chms.js`). API routes live in domain modules under `src/` — all delegated from `src/api-chms.js` — plus `src/api-admin.js` (auth, users, scheduler).

The same Worker also serves the **public volunteer signup site**, branded **Serve** at `serve.timothystl.org`, assembled from per-ministry modules under `src/public/`.

**Live at:**
- `https://connect.timothystl.org` — the app, for both staff and members. `https://chms.timothystl.org` (the app's old name/hostname) still resolves and 301-redirects here — see CONN6 under Queued Items.
- `https://serve.timothystl.org` — public ministry signup, branded "Serve". Renamed 2026-07-20 from `volunteer.timothystl.org` as a full cutover (not a redirect) — the old hostname's Cloudflare route was renamed in place rather than kept alongside the new one, since nothing was publicized under it yet. `volunteer.timothystl.org` no longer resolves at all.
- Brand: **Connect** (was "Timothy ChMS," renamed 2026-07-22 alongside the `connect.timothystl.org` hostname replacing `chms.timothystl.org` — see CONN6; before that, "TLC Gather," renamed 2026-07-20). Navy/teal/gold three-pillar system: People / Ministry / Giving. PWA icons under `icons/` (icon files themselves not renamed, just the manifest name/short_name and page titles).

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
| `src/html-templates.js` | Login page HTML + assembly of `PUBLIC_HTML` (serve.timothystl.org) from `src/public/` modules |
| `src/public/{head,landing,footer,scripts}.js` | Public site shell: head/CSS, landing card grid, footer, JS |
| `src/public/ministries/*.js` | One file per ministry detail page (worship, education, acceptance, outreach, wol, lasm, cfna, transportation, events, general) |
| `src/auth.js` | Cookie auth, PBKDF2 password hashing, helpers |
| `icons/` | PWA icons (16/32/180/192/512/512-maskable) + `tlc-gather-icon.svg` source |
| `NOTES.md` | Full backlog, resolved issues, recent changes |
| `wrangler.toml` | Cloudflare Worker config |

---

## Architecture Notes

- **Auth**: Cookie-based HMAC-SHA256. Login checks `app_users` table first (per-user DB accounts), falls back to `ADMIN_PASSWORD` env-var for break-glass admin access only.
- **Roles**: `admin | finance | staff | office | member` — enforced in `api-chms.js` ACL block. As of 2026-07-27 (v1.85.0) Role Permissions is a **granular per-feature, tri-state matrix** (Settings → Role Permissions): each configurable role (`finance/staff/office/member`) gets, per feature ITEM (`giving`, `tuitionaid`, `finance`, `attendance`, `followups`, `audit`, `register`, `reports`), one LEVEL — `none`/`view`/`edit`. Stored in `chms_config.role_permissions_json`; see `ROLE_PERMISSION_ITEMS`/`DEFAULT_ROLE_PERMISSIONS`/`resolveRolePermissions()`/`permissionsForRole()` in `src/api-utils.js`. The old coarse 4-boolean shape (`finance/staff/register/reports`) is auto-migrated forward on read. Enforcement is a **central per-item view+edit gate** in `api-chms.js` (`ACCESS_GATE`): `none`→403 always, `view`→reads only (any write 403s before dispatch), `edit`→read+write. Domain modules still receive pre-computed `isAdmin/isFinance/isStaff/canEdit/canRegister` flags derived from the matrix (permissive-for-reads within an already-gated segment). Read-only items (`audit`, `reports`) cap at `view`. **People/Households editing is NOT in this matrix** — it stays the blanket `canEdit` flag (every non-member role). admin is always full access (never configurable). member is the filtered, read-only directory view: it can never be granted `edit` and only its safe extra (`reports`) is toggleable — `clampMemberRow()` enforces this regardless of what's stored.
- **Photos**: Stored in R2 bucket `tlc-chms-photos`; served via `/admin/r2photo/` proxy.
- **Breeze ChMS sync**: `POST /admin/api/import/breeze` (bulk) and `POST /admin/api/import/breeze-sync-person` (per-person). See NOTES.md for field ID quirks.
- **D1 param limit**: ~100 per statement. Use chunked queries for large IN/NOT IN lists.
- **App JS is served as 2 external, long-cached files, not inlined** (since v1.35.0): `CHMS_HTML` itself (the per-user, auth-gated shell) stays `Cache-Control: no-store`, but the ~968KB of actual app JS lives in two exported constants (`CHMS_APP_CORE_JS`, `CHMS_APP_EXT_JS`, assembled in `src/html-chms.js`) served at `/admin/app-core.js`/`/admin/app-ext.js` with `Cache-Control: public, max-age=31536000, immutable`. `CHMS_HTML` references them via `<script src="...?v=${DEPLOY_VERSION}">`, so **`DEPLOY_VERSION` (now a plain exported const at the top of `js-core.js`, interpolated into the page rather than hardcoded twice) is what busts the browser cache on every version bump** — forgetting to bump it on a JS change means returning visitors keep the stale cached file even though the deploy itself succeeded. This is a *different* staleness class than the CI/deploy-pipeline gap documented below — check both if "my change isn't showing up live" recurs: first whether `deploy.yml` actually fired (below), then whether `DEPLOY_VERSION` was bumped so the cached JS URL actually changed.

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
- [x] **RD3** — Closed 2026-07-12. The standalone `/scheduler` page shipped its own distinct "Steel & Amber" visual language, inconsistent with the rest of the app. **User decision: retire the standalone route — only the embedded ChMS tab is used.** Done — `/scheduler` now 302-redirects to the embedded tab (`https://connect.timothystl.org/#scheduler`, updated 2026-07-22 from `chms.timothystl.org` — see CONN6); `/scheduler/lcms_calendar.json` (a live data dependency of the embedded tab) still works. (v1.9.5)
- [ ] **RD4** — Hardcoded hex colors instead of design tokens are pervasive across chart code (`js-reports.js`/`js-attendance.js`) and public ministry pages — a brand-token change would need a manual find/replace, not a variable swap. **User decision 2026-07-12: eliminate inline hex colors app-wide (same decision as RD2).** In progress — 171 hardcoded hex values identified (138 admin + 33 public).
- [x] **RD5** — Two giving-chart copies (SW17) consolidated 2026-07-12. Person-renderer consolidation (3 implementations in `js-people.js`) explicitly deferred to the actual redesign — unlike the chart, these are legitimately different layouts with no single canonical form, so merging now risks doing the work twice.

**Done when:** SW9–SW17 each fixed or formally deferred with a reason; RD1–RD5 are decisions logged here for the redesign, not fix targets. ✅ SW9–SW17 all fixed. RD1/RD2/RD4 (palette consolidation) decided 2026-07-12 and tracked as active work under Queued Items below; RD3/RD5 closed.

---

## Queued Items (add new ones here during sessions)

### FIN58 — Revenue mix read 100% earned; four income streams; one shared classification (2026-08-07, DONE)
Reported live: the Financial Health mix bar showed `EARNED $621,462 · 100%` with `$0` donor and
`$0` passive, next to a banner naming exactly one unconfirmed group called "Income" — and a donor
card reading `$0` beside `129 giving households`. **Root cause: `computeRevenueStreams()` took the
account group as `category_path.split(':')[0]`, but every parser puts the CLASSIFICATION in segment
0** (`path = [classification]` at depth 0 — `parseBudgetVsActualsGrid`,
`parseIncomeStatementMultiYearGrid`, `flattenReportTree`), so the group a human can classify is
segment 1. All revenue collapsed into one group named `Income`, matched no rule, and fell to the
deliberate `earned` default. The tests passed because their fixtures used `'40 Offerings:41 Plate'`
— a shape no importer produces. New `revenueGroupLabel()` skips a leading classification segment.
- **Four streams now** (user decision): Donor · Earned · Passive · **Restricted**, matching
  `funds.category` on the Giving tab so both sides of the app agree. `\brestricted\b` is word-
  bounded so it cannot match "Unrestricted"; `altar guild`/`designated` moved off the donor rule.
  New `.fin-stream-grid` (1100/767 tiers only, no new breakpoint) and `.fin-chip-neutral`.
- **One mapping drives both pages** (user decision). The saved classification
  (`chms_config.finance_revenue_streams`, Data & Imports → Classification & policy) always
  persisted across imports — it was only useless because the editor had one bogus row to map.
  `computeRevenueStreams()` now returns `map`, and `finReorganizeChurchTree()` groups the Church
  Report's tree from it instead of its hardcoded regexes (falling back to them verbatim when no map
  is loaded, so the four tests pinning that behaviour pass unchanged).
- **v1.149.1 — the "Sales" special-casing is gone.** Asked where "Sales" came from; this church
  has no such account. Traced to FIN14 (2026-07-20), which hid any account named exactly "Sales"
  from the Church Report tree while the Total Revenue card kept counting it — a known limitation
  recorded at the time. Removed the hide rule, the now-unused `finRemoveNodesByLabel()`, and
  `sales` from the earned regex (a no-op: an unmatched group already defaults to `earned`). The
  tree now hides nothing and so cannot disagree with the total. **If a "Sales" row ever shows up
  in the classification editor, it is real data, not this rule.**
- **Import dates read `never` because nothing backfills the log.** `finance_import_log`
  (migration 0034) shipped a day earlier and only records runs after it. **No re-import needed** —
  the data is still there. New `deriveImportDates()` reads a date off the imported rows'
  `synced_at`/`updated_at`/`created_at` for any importer with no log row, marked `from the data`.
  Two pairs share one timestamp and say so; `daycare_bulk` is left as `never` because it inserts
  with the default `source='manual'`, indistinguishable from hand entry.
- `npm test` (849/849, 22 new); **every new test verified non-vacuous** by injecting the exact
  regression it guards (4 injections, 16 correct failures). Plus `node --check` on both bundles, a
  `vm` harness running all four render paths out of the real built bundle across four streams / an
  empty restricted stream / zero revenue with div-balance asserted, and all seven derived-import
  queries run against the real schema in in-memory SQLite. **Not verified**: a live browser or real
  D1. **Follow-up for an admin**: walk Data & Imports → *Review revenue-stream classification* once
  — it now lists the real groups, and anything still marked `guessed` is name-matching, not a
  confirmed answer. (`src/api-finance.js`, `src/frontend/{js-finance,html-head,js-core}.js`,
  `test/finance-health.test.js`, `test/finance-church-tree.test.js`)

### TinyMCE editor-load limit — NOT this app; it's the website repo (2026-08-07)
A Tiny automated email warned the account hit 50% of its monthly **Editor Load** limit (overage
charges past 100%). **Connect contributes zero cloud loads and always has** — since v1.64.0 the
giving-letter editor is self-hosted from `vendor/tinymce/` via the `/admin/vendor/tinymce/*`
Worker route with `license_key: 'gpl'`, no API key, and a CSP (`script-src 'self'`) that would
block a cloud load anyway. Verified by scan, not assumption: the only `tiny.cloud` strings in this
repo outside `vendor/` are prose, and the ones inside the vendored bundle are doc URLs in warning
text, not a metering endpoint. **Don't re-investigate this app when the next email arrives.**
- **The real source**: `timothystl/website` (`tlc-newsletter-admin`, admin.timothystl.org).
  `admin/db.js:6` loads `https://cdn.tiny.cloud/1/<key>/tinymce/7/tinymce.min.js`. Injected on
  editor screens only, but `tinymceField()` (`admin/helpers.js:940`) fires **one `tinymce.init()`
  per rich-text field** — the newsletter screens build six before extra notes (pastor, secondary,
  WoL, LASM, tertiary, quick), so one open of the newsletter editor is ~7 loads, repeated on every
  reload or failed save.
- [ ] **TINY1** — Self-host TinyMCE in the website repo, the same way this repo already does
  (vendor a minimal subset + serve it same-origin off its own Worker; TinyMCE 7 is GPL v2+ for
  self-hosting, so no key and no paid tier). Needs `table` in the vendored plugin set on top of
  this repo's `code/image/link/lists` — `blockquote` is a core format, not a plugin file. **Not
  started — that repo was read-only in this session and pushing to it was not authorised.**
- [ ] **TINY2** — Cheaper interim mitigation if TINY1 is deferred: lazy-init each editor on first
  focus, so opening a newsletter costs one load instead of seven.
- [ ] **TINY3** — Manual, for an admin: the Tiny key is hardcoded in a public repo
  (`admin/db.js:5`). A cloud key is inherently public (it ships in client-side HTML), so the
  protection is Tiny's approved-domains list, not secrecy — confirm in the Tiny account that the
  list is restricted to admin.timothystl.org, so the quota can only be consumed by this church.

### Admin push notifications from the Scheduler/Serve side (2026-08-04)
Requested: ring the same admin devices that admin.timothystl.org's web push already
reaches, for (1) a new volunteer sign-up and (2) a scheduler notification — clarified via
follow-up as "volunteer confirms/declines and unconfirmed, unfilled." Per the website
repo's own CLAUDE.md ("The admin is a PWA, with web push"), this repo does **not** build
its own push-sending implementation or `push_subscriptions` table — it calls the website
repo's existing `POST /api/push/notify` relay (new, added there as part of this change),
gated by a new shared secret `ADMIN_PUSH_API_KEY` (same pattern as `CHMS_INTAKE_API_KEY`,
reversed direction), via a small `notifyAdminPush(env, {title, body, tag, url})` helper in
`src/api-scheduler.js` — a plain best-effort `fetch()` + `.catch()`, no service binding
(none exists to the website Worker in `wrangler.toml`, and none was added — a normal HTTPS
call matches this repo's existing cross-Worker pattern, e.g. `getChmsFundSuggestions` on
the other side).
- **New volunteer sign-up** — wired into `handleSignup()` (`src/api-scheduler.js`), right
  after the existing office-notification email, independent of the `notify_new_signup`
  Settings toggle (that toggle is a different audience — the office inbox — from the
  sidebar's per-device "Notifications" opt-in this push rides).
- **A volunteer confirms/declines** — wired into `handleSchedRsvp()`, the `/rsvp` public
  link handler. Only fires for `confirmed`/`declined`, not `needs_changes` — the latter is
  still an open conversation, not a resolved outcome worth a buzz.
- **Unfilled shifts** — new `checkUnfilledShifts(env)` in `tlc-volunteer-worker.js`, run
  daily off the existing cron (`scheduled()`, alongside `sendScheduleReminders`). Reads the
  same `ws_schedule_v2` KV blob `sendScheduleReminders` already reads and pushes one summary
  whenever any Sunday in the next 7 days still has a blank assignment slot. Fires daily
  while unfilled, same shape as `sendScheduleReminders`'s own reminder — no separate dedup
  table.
- **⚠ "Unconfirmed" was scoped OUT, deliberately, not overlooked.** An "unconfirmed"
  assignment (a slot that's filled on paper but the RSVP link was never clicked) would need
  enumerating every outstanding RSVP token in `RSVP_STORE` — but tokens are stored as bare
  keys with no prefix/index tying a token back to which schedule row it belongs to (see
  `schedKvGet`/`schedKvPut`), so there's no reliable way to answer "which assignments are
  still pending" from the Worker side without building a real index first. That's a genuine
  new piece of work, not a quick addition to this pass — flag if it's wanted, since it would
  need its own schema/KV-key-shape decision.
- **Manual step needed outside this repo** (same shape as `CHMS_INTAKE_API_KEY` before it):
  `ADMIN_PUSH_API_KEY` must be set as a secret on **both** Workers with the identical value —
  `wrangler secret put ADMIN_PUSH_API_KEY` here (`tlc-chms`) and
  `wrangler secret put ADMIN_PUSH_API_KEY --name tlc-newsletter-admin` on the website side.
  Until both are set, the push call is a silent no-op (fails open, per the file's own
  best-effort convention) — nothing else in either app is affected.
- `node --check` on both touched files (`src/api-scheduler.js`, `tlc-volunteer-worker.js`)
  and the website repo's `tlc-admin-worker.js`. **Not verified**: `npm test` in either repo
  (no `node_modules` installed in this session), and no live call to the real relay endpoint
  (needs both `ADMIN_PUSH_API_KEY` secrets set, which is the manual step above). Done
  2026-08-04. (`src/api-scheduler.js`, `tlc-volunteer-worker.js`, and on the website repo:
  `tlc-admin-worker.js`, `SECRETS.md` equivalent doc in this repo, `CLAUDE.md`)


### Board Report — General Fund KPI split, Finance-sourced budget (2026-08-04, DONE)
Follow-up to the same-day attendance/print/projection fixes — see NOTES.md v1.123.0. Confirmed
with the user and implemented server-side: "General Fund" = every fund sharing the same leading
numeric code as the fund literally named "General Fund" (e.g. "40085 General Fund", "40085
Christmas Offering", "40085 Advent Offering" ...) — the same numeric-prefix grouping convention
the Giving by Fund report already uses (G22), not a name-only match. `GET
/admin/api/reports/giving-board` now returns a `general_fund` object (YTD/prior/projection/budget,
all scoped to just that fund family) alongside the existing all-funds `kpis`. Vs. Budget YTD now
pulls from Finance → Church Report's own account sharing the same numeric code (e.g. "40085 Sunday
Offering" — same code, different title) via `finance_church_entries`, instead of requiring a
separate fund-level budget in Settings → Manage Funds. Year-End Projection is now computed on the
General-Fund-only monthly shape (a new fund_id-broken-out monthly query), not the all-funds total
— fixes a real inconsistency where the projection card didn't track with the YTD card's own trend
whenever other funds moved differently. `npm test` (504/504, 4 new integration tests against a
real in-memory SQLite DB in `test/giving-board-general-fund.test.js`). Not verified in a live
browser. (`src/api-reports.js`, `src/frontend/js-giving.js`)

### Connect directory in the Tithe.ly Church App — VIABLE, confirmed on a device (2026-08-03)
Scoped, built, and verified end to end in one session. **Outcome: a `role='member'` session in the
Tithe.ly Church App's in-app browser survives a full app shutdown and restart.** The directory can
live in a Tithe.ly **weblink tab** — no external browser, no PWA install required.
- **How it's wired:** Tithe.ly → Apps → Tabs → Addable Tabs → **Link**, pointed at
  `connect.timothystl.org`. A weblink is a top-level navigation, so the app's
  `X-Frame-Options: DENY` / `frame-ancestors 'none'` don't apply. **An App Page *iframe* embed is
  blocked and should stay blocked** — that's the clickjacking protection on an authenticated app,
  and iOS blocks third-party cookies in iframes anyway, so the login wouldn't stick regardless.
- **What made it work:** v1.119.0's role-split session lifetime — `role='member'` gets a
  persistent cookie (`Max-Age`) and a 30-day sliding window; every other role keeps the 8-hour
  session cookie. See `idleTimeoutForRole()` in `src/auth.js`.
- **⚠ Correction worth carrying forward:** an intermediate diagnosis (v1.120.0's entry in NOTES.md)
  concluded Tithe.ly's webview used a non-persistent in-memory cookie jar that no cookie attribute
  could survive. **That was wrong.** The first failing test was almost certainly signed in as a
  non-member account, which correctly gets a session cookie and correctly dies on force-quit. The
  general trap: a role-conditional behavior reads as a platform limitation unless the test
  account's role is pinned down first.
- **No SSO exists** between the Tithe.ly app and a third-party site — members sign into Tithe.ly
  and into Connect separately. That's one login each, not a blocker, but don't promise otherwise.
- [ ] **TLY1 — the remaining gate is organizational, not technical: member accounts have to
  exist.** CONN2's invite flow is built (`POST /admin/api/people/:id/invite`, "Invite to Connect"
  on the People tab, 7-day token, account created only on completed setup) but nobody has been
  invited at scale, so the directory currently has an audience of one. This is the next real step.
- [ ] **TLY2 — not verified:** which link-open mode (Default / External in browser / Stay in the
  app) was in effect for the successful test, so it's unknown whether persistence comes from an
  in-app `SFSafariViewController` sharing Safari's jar or a persistent `WKWebView` store. Works
  either way; only matters if it regresses after a Tithe.ly update.

### Mobile Readiness — scoping pass (2026-08-03)
Asked what it would take to make this a mobile-friendly app. Scoped only — **nothing implemented**.
Full write-up with all measurements in **`MOBILE_SCOPE.md`**; summary here so it's visible from the
backlog. Every figure was scripted against the source at v1.118.0, not estimated. **No live browser
or device was involved** — the standing caveat on all frontend work here.
Headline: the foundation is better than the ask implies (viewport meta, off-canvas sidebar at all
widths per VUX10, 29 media queries, 44px touch targets per MO3, adapted modals per MO4, charts that
scale via `viewBox`). What's missing is two defects that break pages outright on a phone, plus one
structural problem that makes a *systematic* pass expensive and a *targeted* one cheap.
- [x] **MOB1 (M1) — DONE 2026-08-04 (v1.125.0).** One `@media(max-width:767px)` block setting
  `font-size:16px` on text inputs/selects/textareas, at the END of the stylesheet, with
  `!important` — 56 inputs carry an inline `font-size` that would otherwise defeat it (VUX15),
  and a media query adds no specificity so placement decides the cascade (v1.121.4). `.att-input`
  (deliberately 1.65rem) is restored rather than shrunk; non-text controls excluded; the one
  56px-wide number input widened. 9 tests assert the winning declaration, verified against three
  separate breakages. Not verified on a real iPhone. **Original note follows.** ~~Every input in
  the app is under 16px, so iOS zooms the viewport on every field focus, on every form, on every
  tab.~~ Measured: `.9rem`/`.84rem`/`13px`/`.82rem`/`.78rem` across
  `.field`, `select`, scheduler inputs, and number inputs. One media query setting `font-size:16px`
  under ~768px fixes it app-wide; the number inputs pinned to `width:56px` need widening alongside.
  Highest impact-per-effort item available.
- [x] **MOB2 (M2) — DONE 2026-08-04 (v1.127.0).** One phone-scoped descendant rule
  (`.content-area table:not(.dir-table), .modal table:not(.dir-table){display:block;
  overflow-x:auto;max-width:100%;}`) rather than 55 markup edits — 65 of the 99 tables carry no
  class, so a class-targeted rule would reach a third. `.dir-table` excluded (sticky header,
  already hidden on phones); no `nowrap`, so a table that fits still fits. 11 tests; a first
  placement test proved vacuous on deliberate breakage and was rewritten around the real
  mechanism (specificity, not source order). Not verified on a device. **Original note follows.**
  ~~55 of 99 tables have no horizontal scroll container~~, so they widen the page
  instead of scrolling (`js-reports.js` 20 bare of 23, `js-finance.js` 16 of 40, `js-attendance.js`
  5 of 5). Complication: **65 of the 99 tables carry no CSS class at all** (inline-styled in JS
  string concat), so a class-targeted rule reaches only a third. Two candidate approaches, both in
  the doc — a `.tab-panel table` descendant rule (one rule, covers all 99, but `display:block`
  needs a device check) or a boot-time wrap pass (preserves layout, costs a DOM pass per render).
  **Do not hand-edit 55 call sites** — expensive and regression-prone.
- [x] **MOB3 (M4) — DONE 2026-08-04 (v1.126.0).** Eleven breakpoints → **767 (phone) / 900
  (tablet) / 1100 (wide)**, documented at the top of the stylesheet. Verified by script first
  that no two blocks landing on the same tier declare the same selector. Blocks were rewritten
  **in place, not merged** — a media query adds no specificity, so relocating one past a base
  rule changes which wins (v1.121.3's bug). `test/breakpoints.test.js` fails if a fourth tier
  appears. Exposed and fixed a latent test-helper bug: the media-block regex couldn't handle
  single-line blocks and was silently reading unrelated CSS. Not verified on a device — some
  layouts now switch at a different width, which is the intended effect.
- [x] **MOB4 (M5) — DONE 2026-08-03 (v1.120.0).** Service worker revived. All three defects
  confirmed by running the *old* generated `SW_JS` in a harness, not by reading it: `/` fell
  through unhandled (the branch gated on the pre-CONN6 `/chms`), the shell was never cached so
  the fallback could never hit, and the three `?v=`-versioned assets weren't intercepted at all.
  Now: both paths handled, shell network-first *and* cached with a real offline page, assets
  cache-first (cached on first fetch, not precached — they're already fetched by the registering
  page load), cache name versioned by `DEPLOY_VERSION` so `activate` evicts the prior deploy.
  Caching the auth-gated shell is deliberate and reasoned in NOTES.md — the markup interpolates
  nothing per-user. 14 new tests execute the real generated worker. Not verified on a device.
  **Original note follows.** ~~The service worker is dead on the primary hostname.~~ `SW_JS`
  (`src/html-chms.js`) gates its navigation fallback on `url.pathname === '/chms'`, but since CONN6
  the app serves at `/` on `connect.timothystl.org` (`tlc-volunteer-worker.js:286`) — leftover from
  the rename. Also `STATIC_ASSETS` precaches only the manifest, not `/admin/app-core.js`,
  `/admin/app-ext.js`, `/admin/app.css` (~1.3 MB, already `immutable`, the ideal precache targets).
  Net: installable but behaves like a website. Small, self-contained; worth it given the church's
  known-slow network (AU2).
- **(M3/M6/M7) — deliberately NOT scoped as mobile work.** The 3,752 inline `style="…"` attributes
  (`html-tabs.js` 977, `js-finance.js` 958, …) are the reason a systematic pass is expensive — an
  inline style beats a media-query rule, which is exactly the VUX15 bug. That's CR4/RD2/RD4/PAL5 and
  should ride with the redesign that owns it. Load-time work is AU2/CR1b/CR3. Finance (958 inline
  styles, 40 tables) and Scheduler (6 media queries, 6 fixed `min-width`s) are multi-year-grid
  workflows — honest target is tablet-minimum, not phone-native.
- **Open decision, for the user:** MOB1–MOB4 are defect fixes worth doing regardless. The question
  is whether to follow with a phone-first pass (Phase C in the doc) on Dashboard / People / Attendance
  entry / Giving quick entry — including a mobile equivalent for the People quickview panel, which
  currently just vanishes under 767px. The strongest argument for it is the **member tier**: the one
  role whose users are mostly on phones, and the smallest surface to get right.

### Code Review — UI consistency / load speed / security (2026-08-02)
A review pass across the three axes. Five items were fixed and shipped in v1.116.0 (see NOTES.md
for the full write-up): the `/admin/r2photo/` bucket-wide read (the significant one), `/admin/backlog`
role gate, dev-board `esc()`, a recurrence of the SC3-BUG1 escaping bug in `BACKLOG_HTML`/`ADMIN_HTML`,
per-request auth memoization, and dashboard query batching. What follows is what the review found but
deliberately did **not** change, because each is architectural and needs its own scoped session.

- [x] **CR1 — DONE 2026-08-03 (v1.118.0). Shell cut from 622 KB to 200 KB.** Two of the three big
  pieces moved out to immutable `?v=DEPLOY_VERSION` routes, same trick as the v1.35.0 app-JS split:
  the **Scheduler embed (321 KB)** is now lazy-loaded on first tab open via
  `/admin/scheduler-embed.html` + `/admin/scheduler-embed.js` (and since the tab is admin-only, most
  sessions never fetch it at all), and the **app CSS (101 KB)** is now `/admin/app.css` referenced by
  `<link>`. `HTML_TABS_1/2` (~192 KB) deliberately stayed inline — see CR1b. Verified the
  scheduler bundle is byte-identical to before the split and the CSS extraction round-trips exactly;
  lazy-load flow (including the failure/retry path) exercised against the real `showTab` in a `vm`
  harness. See NOTES.md. (`src/html-chms.js`, `src/scheduler-inline.js`, `tlc-volunteer-worker.js`,
  `src/frontend/js-core.js`)
- [ ] **CR1b — The remaining ~192 KB of the shell is `HTML_TABS_1/2`**, every tab's markup, all
  present at load. It's static (role visibility is CSS-driven), so it *could* be served as a cached
  fragment — but unlike the Scheduler it has no natural lazy trigger: it would have to be fetched and
  injected during boot, which delays first paint and puts the `getElementById` calls that run in the
  `load` handler at risk of firing against an empty DOM. Worth doing only alongside a real look at
  the boot sequence (see CR3), not as another mechanical extraction. (noted 2026-08-03)
- [x] **CR8 — Closed 2026-08-03, not worth doing.** Benchmarked the people-search scan against a
  realistic fixture at this church's actual scale (1,000 people / 340 households): the 7-column
  leading-wildcard `LIKE` runs in **0.2–0.5 ms**. An FTS5 virtual table or prefix-match fast path
  would add real sync complexity to save half a millisecond. The original note was calibrated for a
  dataset orders of magnitude larger than this one. Revisit only if the row count grows by ~100×.
  Also worth remembering: the People tab defaults to Members-only (`mt:'member'`), so a typical
  search is already scoped to ~300 rows, not 1,000.
- [ ] **CR1-OLD — original write-up, kept for context: `CHMS_HTML` was 622 KB and served
  `Cache-Control: no-store`, so it was re-downloaded in full on every single page load.** v1.35.0 moved ~1.2 MB of app JS out to long-cached
  `/admin/app-core.js` + `/admin/app-ext.js` for exactly this reason, but the *shell* was never
  revisited and has since grown to be the dominant uncached cost. Breakdown: `getSchedulerInline()`
  **321 KB** (the entire Scheduler UI — markup, CSS and JS — inlined into the page, for a tab most
  sessions never open), `HTML_HEAD` 108 KB (all app CSS), `HTML_TABS_1/2` 192 KB (every tab's markup,
  all present at load). The page must stay `no-store` (it is per-user and auth-gated), so the fix is
  to move the static parts *out* of it, the same trick already used for the JS: serve the CSS and the
  Scheduler bundle as `?v=${DEPLOY_VERSION}` immutable assets and leave the shell as the small
  per-user part. Biggest single available load-time win, especially on the church's slower networks.
- [ ] **CR2 — Login page first paint is blocked on Google Fonts.** Same root cause as AU2 above, which
  is already queued against the redesign — noting here only that the review independently confirmed
  it, and that the CSP would get to drop its `fonts.googleapis.com`/`fonts.gstatic.com` allowances if
  the fonts were self-hosted, which is a security tidy-up as well as a speed one.
- [ ] **CR3 — Boot is a serial waterfall.** `js-core.js`'s `load` handler awaits `/admin/api/me` and
  only then, in `.finally()`, fires `loadTags()` / `loadFunds()` / `loadMemberTypes()` / `showTab()`.
  The role is needed before the UI renders, but tags/funds/member-types do not depend on it and could
  be in flight concurrently — currently they cost a second round trip after the first completes. With
  CR5 also in play the landing sequence is: 622 KB HTML → JS parse → `/me` → dashboard.
- [ ] **CR4 — 3,752 inline `style="…"` attributes across `src/frontend/`** (`html-tabs.js` 977,
  `js-finance.js` 958, `js-reports.js` 441, `js-people.js` 304, `js-giving.js` 247…), plus 746
  hardcoded hex colours, 113 of them inside those inline styles. This is RD2/RD4/PAL5 restated with
  current numbers — the count has grown substantially since PAL5 recorded 171, because Finance and the
  Giving redesign were both built in the inline-style idiom. Worth knowing before the redesign that
  the surface is now roughly 4× what the tracked estimate says.
- [ ] **CR5 — The dashboard still issues 11 serial D1 queries after the v1.116.0 batching.** What is
  left is genuinely dependency-ordered (anniversary partner pairing, the chunked `annIssueCandidates`
  household lookup, weekly-task seeding, prayer counts). Getting further would mean restructuring
  those into `db.batch()` or a single query with joins, which is a real change to logic rather than a
  mechanical reorder — hence deferred rather than done blind with no live D1 to test against.
- [ ] **CR6 — Seven `fetch()` calls in `js-finance.js` hand-roll the `api()` helper.** Checked all
  seven: every one *does* handle 401 correctly, so this is duplication rather than a defect (they use
  `FormData`, which is presumably why they skipped the helper — though `api()` passes `opts` straight
  through and would work). Left alone deliberately: touching seven file-upload flows with no browser
  to test them is not worth it for a style fix.
- [x] **PS1 — People search: stale-response guard + fewer round trips.** Asked whether the search bar
  re-scans on every keystroke. It doesn't — `debouncePeople()` has debounced at 300ms all along — but
  a real bug meant a slow broad query ("s") could land *after* a fast narrow one ("smith") and repaint
  the list with the wrong results, which reads as slowness. Fixed with a sequence-number guard. Also
  cut the per-search D1 round trips from 4 to 2: `COUNT(*)` is skipped when a short first page makes it
  derivable, tags + household disambiguation now share one `db.batch()`, and the disambiguation query
  no longer `GROUP BY`s the entire `households` table per request (bounded `EXISTS` instead, verified
  identical against real SQLite). Done 2026-08-03 (v1.117.0). See NOTES.md. (`src/frontend/js-people.js`,
  `src/api-people.js`)
- [ ] **CR8 — People search's remaining floor is the unindexable `LIKE '%q%'` scan** across 7 columns
  (`first_name`, `last_name`, `preferred_name`, `email`, `phone`, `envelope_number`,
  `envelope_history`). A leading wildcard means no index can ever serve it, so every search is a full
  scan of `people` no matter how few round trips wrap it. PS1 removed the duplicated scan and the
  extra latency; going further means an actual index — an FTS5 virtual table over the searchable
  columns kept in sync by trigger, or a prefix-match fast path (`q%`, index-servable via
  `idx_people_name`) tried before falling back to the substring scan. Worth doing only if search still
  drags at the church's real row count; not worth the sync complexity blind. (noted 2026-08-03)
- [ ] **CR7 — Minor, noted for completeness.** (a) The `X-Intake-Key` check in `api-intake.js` uses
  `!==` rather than a constant-time compare; over a network, against a high-entropy key, this is not
  realistically exploitable, but it is the one shared secret compared this way. (b) The blanket
  `OPTIONS → SCHED_CORS` handler in the worker answers preflight for *every* path with
  `Access-Control-Allow-Origin: *`; not exploitable today (only the scheduler routes echo CORS headers
  on real responses, and `vol_auth` is `SameSite=Lax`), but it is broader than the scheduler routes it
  exists for. (c) `ADMIN_HTML` in `html-templates.js` is imported but never routed — dead code, and
  the review only noticed because its dead inline script showed up in the syntax sweep.

**What the review checked and found clean**, so it does not get re-litigated next time: SQL injection
(every dynamic `SET`/`ORDER BY`/table name traces to a hardcoded allowlist or a map lookup — the
`entry.field` audit-undo path, the sparse-update builders, `SORT_COLS`, `sortDir`, and
`CLEAR_TABLES` were each confirmed individually); frontend XSS (`esc()` is applied consistently —
the sweep for unescaped person data in attribute and `innerHTML` contexts turned up only the dev
board, now fixed); loading/error states (every `Loading…` path checked has a matching `.catch`, so
the FH11 work held); and the SW1/SW2 scheduler role guards.


### GIV-BUG1 — Emailed giving letter showed a blank logo "blob" and a raw base64 text dump (2026-07-28)
Reported: a mid-year giving letter emailed to a donor rendered with (1) the church logo showing as
just a blank blob, and (2) a huge literal base64 string visible as text at the very bottom of the
email instead of a picture. Root cause of (2), confirmed against the exact TinyMCE editor
(`initLetterEditor()`, `js-settings.js`) used for the two letter templates: the toolbar's Insert Link
and Insert Image buttons sit right next to each other, and an image dropped/pasted into the **Link**
dialog instead of Image produces `<a href="data:image/...;base64,...">` whose visible link text
defaults to the href itself — the entire base64 payload renders as literal text. A bare base64 string
pasted directly as plain text (no tag at all) hits the same failure. Neither is recoverable as "the
image the admin meant," so new `sanitizeLetterTemplateHtml()` (`src/api-utils.js`) strips both forms
entirely — a whole `<a href="data:...">` anchor, or a stray un-tagged `data:...;base64,` run 200+
chars long — while explicitly protecting a real `<img src="data:...">` (the one path, via the
toolbar's file-picker, that already worked correctly) so a legitimately embedded logo image is left
alone. Wired in two places in `api-import.js`'s `config/church` handler: **on save** (`PUT`, prevents
recurrence) and **on read** (`GET`, self-heals the already-corrupted stored template the first time
it's loaded after this ships — no manual DB fix needed). Root cause of (1) is less certain without
seeing the live template, but the most likely mechanism is the same oversized photo being *also*
present as an `<img>` (not just leaked as link text) — `letterheadImgHtml()` (`src/frontend/js-reports.js`)
had no `width`/`height` attributes, only a `max-height` CSS style; most email clients block remote
images by default and use `width`/`height` attributes (not CSS) to size the blocked-image placeholder,
so a missing attribute (or an oversized source photo) renders as an oversized blank box instead of a
small logo-sized placeholder. Added explicit `width`/`height` attributes matching the existing
`max-height`. `npm test` (356/356, 8 new tests in `test/giving-letter-sanitize.test.js` reproducing
the exact reported Link-dialog and bare-paste cases), `node --check` on both built app-JS bundles.
**Not verified**: an actual sent email in a live mail client — the email-client image-blocking
behavior described above is standard behavior, not something directly observable in this environment.
If the logo still shows blank after this ships, check Settings → Letterhead Logo for whether an
oversized/EXIF-heavy photo is uploaded there (no server-side resizing exists in the R2 upload path)
and consider re-uploading a smaller, cleanly-cropped logo file. Done 2026-07-28 (v1.104.0).
(`src/api-utils.js`, `src/api-import.js`, `src/frontend/js-reports.js`, `test/giving-letter-sanitize.test.js`)

### GIV-BUG2 — Warn on an oversized letterhead logo upload (2026-07-28)
Follow-up to GIV-BUG1: that fix addressed the base64-leak half of the reported bug, but flagged the
logo-blob half as "less certain without seeing the live template" and suggested the uploaded logo
photo itself might be the oversized/EXIF-heavy culprit. Requested: warn (not silently accept) when
that's the case. New `logoSizeWarning()`/`LOGO_WARN_BYTES` (`src/api-utils.js`, 300 KB soft
threshold) — a pure, unit-tested function, not a hard cap, since a large-but-otherwise-fine image
should still be allowed to upload. Wired into `POST /admin/api/config/letterhead-logo`
(`src/api-import.js`): the response now always includes a `warning` field (empty string when under
the threshold). Settings UI (`uploadLetterheadLogo()`, `src/frontend/js-settings.js`) shows this
twice — an immediate client-side check before the upload even starts (using the browser's own
`file.size`, no round-trip needed), and again from the server's own warning after upload completes
(covers the same check from a source of truth, in case the client-side check is ever bypassed).
Uses the existing `.import-status.warn` CSS class (already defined in `html-head.js`, amber). `npm
test` (360/360, 4 new tests for `logoSizeWarning` in `test/giving-letter-sanitize.test.js`), `node
--check` on both built app-JS bundles. Not verified in a live browser. Done 2026-07-28 (v1.106.0).
(`src/api-utils.js`, `src/api-import.js`, `src/frontend/js-settings.js`, `test/giving-letter-sanitize.test.js`)

### Giving Consolidation — 8 sub-tabs → 4, batch↔deposit links, fund lens (2026-08-05, DONE)
Second design handoff for the Giving tab (`design_handoff_giving_consolidation`: README + a
`Giving Today.dc.html` before-state + a `Giving Redesign.dc.html` prototype), following the
July redesign below. Sub-nav collapsed to **Offerings · Reports · Communications · Settings**;
every retired view name still resolves via an alias map in `givSetView()` (and lands on the right
*pane*, not just the parent tab), so bookmarks and in-app deep links keep working.
- **GIVC1 — Offerings.** Batches + Transactions + Deposits are one workflow: a derived work-queue
  strip (`GET /giving/offerings-summary`), a master/detail with derived batch status badges
  (`batchDepositStatus()`/`batchDepositStatusFromCounts()`, `api-utils.js`), and a Bank deposits
  panel inside the batch detail with a coverage bar, per-deposit editable amount/bank-received/fees,
  and the reverse direction of each link. New `giving_deposit_lines(deposit_id, batch_id,
  amount_cents)` (migration `0032`) gives true many-to-many: a batch can split across deposits and a
  deposit can hold several batches. A deposit's given total is Σ lines when it has lines, Σ assigned
  gifts otherwise — never their sum. New `POST`/`DELETE /giving/deposit-lines`,
  `GET /giving/deposit-options`, `GET /giving/offerings-summary`. The old flat gift and deposit
  tables survive as pills (the handoff's fallback option A); the gift table gained a Deposit column.
  **Bug caught while building**: joining `giving_entries` and `giving_deposit_lines` in one GROUP BY
  multiplies rows and doubles a split batch's total — correlated subqueries instead, with a
  regression test that splits a batch across two deposits.
- **GIVC2 — Fund lens on Reports.** New `funds.category` (`general|earned|passive|restricted`,
  migration `0033`), edited in a new **Settings → Fund categories** card (`POST /funds/categories`,
  admin-only, explicit save). `giving-board` returns a fully-computed block per category plus `all`
  via one pure `buildBoardCategoryBlock()`, so the four categories provably add up to All giving
  (asserted in a test). Lens scopes KPIs, chart, navy panel, fund table (categories-as-rows under
  All giving, funds under a category), narrative, subtitle and print. Replaces the name-regex
  General-Fund split; a DB with the column but no backfill falls back to the old numeric-prefix
  rule so the headline number can't read $0 mid-deploy. `db.js` backfills once, marker-gated.
  **Two real bugs fixed**: the month chart's fixed 50k-step/100k-minimum axis rendered small
  categories (passive income, ~$2k/yr) as a flat line — now a 1/2/5 nice-step ladder; and
  `boardNarrativeHtml()` indexed `mix.check.pct` directly and would blank the whole narrative page
  for a missing method bucket.
- **GIVC3 — Communications + Analysis.** Letters and Receipts behind one tab, switched by pills.
  Analysis is the third mode-toggle position; the Plateaus and Bands cards moved out of the board
  page into it, so the board page ends at the fund table. Lens and period persist across modes.
  "Print board page" drops out of Analysis first — otherwise it prints a `display:none` body.
- **Three more real bugs found by a review pass and fixed** (each with a regression test verified
  non-vacuous): the board's household/method-mix queries grouped by `f.category` in SQL while the
  legacy General-Fund fallback lives in JS, so an un-backfilled DB showed a General Fund YTD next
  to zero households and a blank navy panel — both now group by `fund_id` and map through the same
  JS `catOf` map; `fees_ytd` used `Σ lines − bank`, going large-negative for a deposit built the
  older per-gift way (no lines) — now lines-else-gifts, matching the deposit list; and "Awaiting
  deposit" counted every batch without a deposit line, i.e. *every historical batch* on day one —
  now windowed to 90 days (`?awaiting_days=`), with the window named on the card.
- **A second review pass found four more, all fixed with regression tests**: the Deposits pane read
  `gross_cents` and so showed `$0 given` and a fee of *minus the bank amount* for any deposit built
  by the Offerings workflow (which links batches, not gifts) — it now reads the `given_cents` the
  backend was already returning, and lists the batches a lines-built deposit holds; deleting a
  batch orphaned its deposit links at all seven sites batches can be removed (including the orphan
  purge after every Breeze sync and CSV import), leaving the deposit's list and detail views
  permanently disagreeing — and that exposed a further hole where an emptied-but-banked deposit
  yielded `0 − bank` as a fee; the Attendance tab's "Giving × Attendance → Open" landed on the
  board page rather than Analysis; and `unreconciled_deposits` was unbounded while its sibling card
  had a window. Plus: the search placeholder promised gift/donor search a batch-only filter can't
  do, and the `funds/categories` comment claimed a sparseness guarantee the loop lacks.
- **Hardening**: `applyPermissionUI()` hides `.require-finance` panels with an inline
  `display:none` that the view-switching loop used to undo, so an alias/deep link could park an
  office-level user on an empty Reports panel. `givSetView()`/`givOffSetPane()` now refuse a
  finance-only view for a role that can't see it (server gating was already correct; this is
  about not showing an empty screen).
- `npm test` (689/689, 79 new in 3 files; each checked for vacuity by injecting the regression it
  guards), `node --check` on both built bundles + every touched backend file, div-balance scan of
  the rebuilt `#tab-giving` markup. Dead CSS removed with the markup it styled. **Not verified**:
  a live browser or real D1 — same standing caveat as all frontend work here. (`migrations/0032*`,
  `migrations/0033*`, `src/api-giving.js`, `src/api-households.js`, `src/api-reports.js`,
  `src/api-utils.js`, `src/db.js`, `src/frontend/html-head.js`, `src/frontend/html-tabs.js`,
  `src/frontend/js-core.js`, `src/frontend/js-giving.js`)

### Giving Tab Redesign — board reports, donor letters, receipts (2026-07-27 → 2026-07-28, COMPLETE, phased)
Design handoff (`design_handoff_giving_reports/`: README + 9 HTML prototypes + screenshots)
reorganized the Giving tab from ten flat report tiles into a per-view sub-nav and added four new
capabilities. Two decisions taken with the user up front: **receipts** (handoff Section 8, an
explicit church choice) → build **both A (batch-close queue) and B (envelope + quarterly) scaffolding**;
**delivery** → **phased PRs, foundation first**, reviewed between phases. **All four phases shipped and
are live** (as of v1.115.2). The live sub-nav grew past the original six-item target to eight:
`Batches · Transactions · Deposits · Board Report · Letters · Receipts · Analysis · Settings` — the
extra **Deposits** view is the native deposit-reconciliation system (GIV-DEP, below), and Analysis is
the renamed "Reports" slot. Per-phase specifics/versions are in NOTES.md; the checkboxes below are a
retroactive reconciliation of the tracking doc to the shipped code (phases R2–R4 were completed across
subsequent sessions after R1).
- [x] **GIV-R1 — Phase 1: Sub-nav restructure + Board Report (1A dashboard + 1B narrative).** Done
  2026-07-27 (v1.86.0). `.view-toggle`→`.fin-subnav`; new finance-gated `#giv-view-board` with a
  Dashboard/Narrative toggle; new `GET /admin/api/reports/giving-board` (pure math in `api-utils.js`,
  unit-tested); new `funds.budget_annual_cents` (migration 0028) editable in the Manage Funds card;
  `printBoardPage()` uses `body.printing-board` in-place print. Board Report later also absorbed the
  Giving Plateaus & Nudges card (v1.89.0→v1.108.0) and the Giving-by-Weekly/Monthly-Band card
  (v1.93.0) as the home for strategic/leadership giving analysis. See NOTES.md for full detail.
- [x] **GIV-R2 — Phase 2: Letters & Statements (1C workspace + 1D letters).** Done. New
  `#giv-view-letters` workspace (`givLetters*` in `js-giving.js`) with per-letter-type cards
  (year_end / midyear / quarterly / thank_you / appeal), real per-recipient send status, select-all,
  email/print channel toggle, and no "Load Givers" step (recipients resolved server-side). Migration
  `0029_giving_letters_workspace.sql` extends the send ledger; endpoints `GET /giving/letters/status`
  and `POST /giving/letters/mark` (idempotent, resumable) back it. Editable letter templates + gift
  table (1D) via the existing TinyMCE editor / `renderLetterHTML()`/`buildGiftTable()`.
- [x] **GIV-R3 — Phase 3: Analysis (2A) + Trends (3A/3B).** Done. The "Reports" nav slot is now
  **Analysis** (`#giv-view-reports`, `givAnalysis*`): giving distribution (mode/median/tier table +
  amount-band histogram, `GET /reports/giving-distribution`) and a five-year trend with a real
  inflation-adjusted (CPI-U) column (`GET /reports/giving-multiyear`, inflation helper in
  `api-utils.js`). `GET /reports/giving-vs-attendance` retained for the per-attender / come-apart view.
- [x] **GIV-R4 — Phase 4: Receipts (both A + B scaffolding).** Done. New `#giv-view-receipts`
  (`givReceipts*`) with a threshold ($250 default) + first-gift receipt queue (`GET /giving/receipts/queue`),
  manual send/print writing `thank_you` rows via `giving/letters/mark` — **Approach A**. **Approach B**
  pew-envelope-number history lives on the person record via migration `0030_envelope_history.sql`.
- [x] **GIV-DEP — Native deposit reconciliation (beyond the original handoff).** New **Deposits**
  sub-nav view (finance-gated, master-detail like Batches) for deposit-centered reconciliation;
  migration `0031_giving_deposits.sql`; endpoints `GET`/`POST /giving/deposits`,
  `GET /giving/unassigned-gifts`. Frontend done v1.100.0.
- Design bundle lives at `design_handoff_giving_reports/` (in the uploaded zip, not committed).
  All prototype figures are illustrative; use the app's own `:root` tokens, not the prototype hex.
- **Doc reconciliation only (this edit):** verified each phase's migrations/endpoints/view functions
  are present in the deployed code (v1.115.2), not via a live-browser click-through.


### Connect — Tiered Member Login (2026-07-20, in progress, phased)
Follow-up to the App Family Rename below. Two different member-facing mechanisms existed
in this codebase: (1) a standalone `/portal` mini-app with its own `tlc-member` cookie,
own minimal UI, no tab/permission tiers; (2) `app_users.role='member'` — a role tier
*inside the real ChMS admin app* that already does exactly the Breeze-style "level of
user opens up more tabs" model (filtered, read-only People/directory view, all writes
blocked, other tabs hidden via a `role-member` CSS class) — this already existed in the
code but nothing populated real accounts into it. **Decision: build on (2), retire (1).**
No small standalone app — Connect is a tiered login into the same app, not a separate product.
- [x] **CONN1 — Phase 1: Foundation (superseded by CONN6, 2026-07-22 — see below).** Added
  `connect.timothystl.org` as a new route on
  the same Worker (`wrangler.toml`). New `isConnectHost` check in `tlc-volunteer-worker.js`:
  the root path and `/chms` alias now look up the caller's real role and enforce the
  split — a `role='member'` account hitting `chms.timothystl.org` gets redirected to
  `connect.timothystl.org`, and any non-member role hitting `connect.timothystl.org` gets
  redirected back to `chms.timothystl.org`. Both hostnames serve the exact same
  `CHMS_HTML`/login shell; the existing `role-member` tab-hiding in the frontend is what
  actually restricts what a member sees, unchanged. **This dual-host design caused real
  confusion adding the second Cloudflare route and was dropped two days later in favor of a
  single-host replacement — see CONN6.** Retired the standalone `/portal`
  system: removed all its routes (`/portal`, `/portal/verify/*`, `/portal.webmanifest`,
  `/portal-sw.js`, `/member/*`, `/member/r2photo/*`) and the "Invite to Portal" trigger
  (`people/:id/invite` endpoint + the People-tab button that called it) — that whole flow
  pointed at the now-unrouted `/portal/verify/` and would have silently sent broken invite
  emails otherwise. Its source (`src/api-member.js`, `src/portal-html.js`,
  `src/portal-sw-js.js`) was deliberately **not deleted** — left unimported/unrouted so
  its invite-token/email-verification logic can be adapted for the real Phase 2 invite
  flow instead of rewritten from scratch. One known side effect: the scheduler's
  "you're serving tomorrow" push-notification reminder (`tlc-volunteer-worker.js`,
  queries `app_users.push_subscription`) will silently stop finding any subscribers,
  since the only push-subscription flow lived in the now-retired portal's service worker
  — this was never populated in practice (portal was never publicly launched), so nothing
  regresses for a real user; just flagging it so it isn't mysterious later. Added `connect`
  to `RESERVED_SLUGS`. Done 2026-07-20 (v1.41.0). (`wrangler.toml`, `tlc-volunteer-worker.js`,
  `src/api-chms.js`, `src/api-admin.js`, `src/frontend/js-people.js`)
- [x] **CONN2 — Phase 2: Real invite flow.** New `POST /admin/api/people/:id/invite`
  (canEdit/staff+ only) generates a 7-day token via `RSVP_STORE`, same pattern as the
  existing forgot-password flow — not the old `/portal` system's D1-table tokens, and not
  created-up-front: the `app_users` row is only inserted (or reactivated, if the person
  already has one) when the invited person actually completes setup, so an invite that's
  never opened never leaves a half-account with an unusable password. New public
  `GET`/`POST /member-setup?token=...` page (`handleMemberSetup`) collects the password and
  activates the account as `role='member'`, `username` defaulting to the person's email.
  Restored the People-tab "Invite to Connect" button (removed in Phase 1) pointing at the
  same endpoint. Extracted the shared unauth token-page shell (`authCardPage`/`escLite`/
  `randHex`) into `api-utils.js` so both this and `handleResetPassword` use it — also fixed
  a leftover rebrand miss found in the process (`handleResetPassword`'s page still said
  "Gather" instead of "ChMS"). The invite/setup functions live in `api-people.js`, not
  `api-admin.js`, specifically to avoid a circular import (`api-admin.js` → `api-chms.js` →
  back to `api-admin.js`) that adapting the old code in place would have created.
- [x] **CONN3 — Phase 2: Security pass on the member-role People view.** Found a real gap,
  not just a frontend one: the person-detail endpoint already redacted
  address/phone/email/dob/anniversary per each person's own `dir_hide_*` opt-out, but still
  spread the *entire* row — including `notes` (free-text, staff/pastoral) and `tags`
  (staff-assigned labels) — to member-role viewers. The **list** endpoint (the one that
  actually powers the directory) had no redaction at all, not even the `dir_hide_*`
  opt-outs. New `memberSafeView()` in `api-people.js` is an explicit allowlist (not a
  blacklist), so a future new `people` column defaults to *not* being exposed to members
  until someone deliberately adds it — applied to both the list and detail endpoints; tag
  queries are now skipped entirely (not fetched then discarded) for member-role requests.
  Verified with a Node harness against real SQLite: confirmed `notes`/`breeze_id`/
  `locally_edited`/`tags` are absent from the member-role JSON response, and that
  `dir_hide_phone` correctly blanks a phone number in the list view (previously leaked).
- [x] **CONN4 — Branding differentiation, closed via CONN6.** Resolved not by giving
  `connect.timothystl.org` a separate identity alongside "Timothy ChMS" (the dual-host
  premise this item assumed), but by the whole product renaming to "Connect" — see CONN6.
- [x] **CONN5 — Manual Cloudflare follow-up, superseded by CONN6's own follow-up.** The
  dual-host `connect.timothystl.org` Route added under CONN1 is being replaced by
  `connect.timothystl.org` as the primary Custom Domain — see CONN6's own Cloudflare step.

### CONN6 — Single-host replacement: connect.timothystl.org replaces chms.timothystl.org (2026-07-22)
The CONN1 two-host design (chms.timothystl.org for staff, connect.timothystl.org for
members, with role-based redirects keeping each on their own host) caused real confusion
adding the second Cloudflare route — including a brief production DNS-caching-related
outage on `chms.timothystl.org` while the second route was being added — and was dropped
two days later for something simpler. **`connect.timothystl.org` now fully replaces
`chms.timothystl.org`** as the single hostname for the whole app, both staff and members —
the existing `role='member'` tab-hiding in the frontend (unrelated to hostname) is what
limits what a member sees, same as it always was meant to. No more dual-host redirect
logic. `chms.timothystl.org` is kept alive purely as a 301 redirect to
`connect.timothystl.org` (new `isLegacyChmsHost` check in `tlc-volunteer-worker.js`,
mirroring the `volunteer.timothystl.org`→`serve.timothystl.org` pattern), since staff have
it bookmarked from months of daily use. `wrangler.toml`: `connect.timothystl.org` is now
the primary Custom Domain (`custom_domain = true`); `chms.timothystl.org` is now a Route
(`custom_domain = false`) purely so the Worker still receives requests on it to redirect.
Full rebrand from "Timothy ChMS" to "Connect": page titles, PWA manifest name/short_name,
login page (`LOGIN_HTML`'s wordmark), password-reset email copy, `EMAIL_FROM`, the
operator manual, and `src/legal-pages.js` — which needed a real content rewrite, not just
a name swap, since its old text said the system was "not offered to or used by the general
public" and "solely for use by staff and volunteers," both now inaccurate now that member
accounts are a real, intended tier of the same app. Done 2026-07-22 (v1.54.0).
**Still needed, manual, outside code, flagged for an admin**: in the Cloudflare dashboard,
Workers & Pages → `tlc-chms` → Domains → **`+ Add Domain`** → `connect.timothystl.org` —
purely additive, does not require touching or removing the existing `chms.timothystl.org`
entry. (`tlc-volunteer-worker.js`, `wrangler.toml`, `src/html-templates.js`,
`src/html-chms.js`, `src/legal-pages.js`, `src/api-admin.js`, `src/api-utils.js`,
`src/frontend/html-head.js`, `src/frontend/html-tabs.js`, `src/frontend/js-export-import.js`,
`src/frontend/js-core.js`, `manual.html`)

### Branding — App Family Rename (2026-07-20)
Prompted by a design review of a proposed "app family" branding concept across the church's
digital properties (website, ChMS, volunteer site). Full fragmentation into 7 separate
subdomains was scoped down to two concrete, low-risk moves since nothing about these apps
is widely known publicly yet: (1) rename the public volunteer/ministry signup site from
`volunteer.timothystl.org` to `serve.timothystl.org`, with the old hostname 301-redirecting
browser page views (root + event short-links) to the new one — every non-page route (API,
intake, RSVP, Breeze proxy, etc.) still answers identically on both hostnames since it's the
same Worker (`tlc-volunteer-worker.js`'s new `isLegacyServeHost` check), so nothing server-to-
server broke. (2) Dropped the internal "TLC Gather" brand — not known to anyone outside the
admin — in favor of "Timothy ChMS" everywhere: login page, page titles, PWA manifest
name/short_name, password-reset emails, legal pages, and the handful of admin-UI strings that
said "TLC Gather" by name. Also added `serve` to `RESERVED_SLUGS` (`api-admin.js`) so a future
event short-link can't collide with the new brand word. Icon files themselves were not
renamed (`icons/tlc-gather-icon.svg` etc. stay as filenames — only user-visible text changed).
Done 2026-07-20 (v1.40.0). (`wrangler.toml`, `tlc-volunteer-worker.js`, `src/html-templates.js`,
`src/html-chms.js`, `src/legal-pages.js`, `src/api-admin.js`, `src/db.js`,
`src/frontend/html-head.js`, `src/frontend/html-tabs.js`, `src/frontend/js-export-import.js`,
`src/frontend/js-volunteers.js`, `manual.html`)
- [x] **BRND1** — Companion website-repo change: `/volunteer` nav links, the links.timothystl.org
  card, and the contact/prayer intake form targets now point at `serve.timothystl.org`. Done
  2026-07-20 (`timothystl/website` PR #315, merged).
- [x] **BRND2** — Internal API paths renamed to match: `/volunteer/signup`, `/volunteer/calendar/:id`,
  `/volunteer/pending`, `/volunteer/general-pending`, `/volunteer/event-pending` are now
  `/serve/signup`, `/serve/calendar/:id`, `/serve/pending`, `/serve/general-pending`,
  `/serve/event-pending` — old paths kept working as aliases (same handlers), so nothing
  breaks for an already-open tab running stale cached JS. `PUBLIC_HTML` (`scripts.js`) and the
  embedded Scheduler tab (`scheduler-html.js`) both call the new paths now; `scheduler/index.html`
  resynced. The pre-existing dead `/volunteer/claim`/`general-claim`/`event-claim` calls in
  `scheduler-html.js` (calling a route that hasn't existed since the old `breeze-proxy-worker`
  was deleted — unrelated to this rename) were left as-is. Done 2026-07-20 (v1.40.1).
  (`tlc-volunteer-worker.js`, `src/api-scheduler.js`, `src/public/scripts.js`, `src/scheduler-html.js`)
- [ ] **BRND3** — Two manual follow-ups outside code, flagged for an admin: (1) create a
  `serve.timothystl.org` DNS record in the Cloudflare zone (Type "Worker", same target as the
  existing `volunteer` record) so the hostname actually resolves — the Worker route added to
  `wrangler.toml` alone doesn't create DNS. (2) Update the `/volunteer` short-URL redirect's
  target in the website's Redirects admin tab from `volunteer.timothystl.org` to
  `serve.timothystl.org` — that's D1 data, not code, so it can't be changed from this repo.
- [ ] **BRND1** — Companion website-repo change needed in the same pass: `/volunteer` redirect
  and the contact/prayer intake form targets should point at `serve.timothystl.org` (see that
  repo's own CLAUDE.md queued items).
### Scheduler (2026-07-20)
- [x] **SC7** — Scheduler print view redesign, implemented from a design handoff bundle. Clicking Print (More ▸ Print) no longer calls `window.print()` directly — it opens a print-preview picker with a 3-way mode switch: **Single Sunday** (one roster page, portrait letter, big centered date/ordinal header + per-service role rows + a Both Services section), **Full Month** (a 9-column color-coded table, landscape letter, replaces the old default print output), and **Bulletin Insert** (a black-and-white 7in×8.5in half-sheet for the coming Sunday only, sized for this church's physical bulletin fold). A Sunday `<select>` (Single Sunday / Bulletin Insert only) defaults to whichever Sunday is selected in Focus Week. The old grid-based `@media print` rules are left in place untouched as a harmless fallback for a raw Ctrl+P outside this flow. Done 2026-07-20 (v1.40.0). (`src/scheduler-html.js`, `scheduler/index.html`)
  - **SC7-FIX1** (v1.40.3): two follow-up requests after first use. (1) The picker was an in-page full-screen overlay with no obvious way to dismiss it (no title bar, no native close button) — switched to a real popup window (`window.open`), which has its own browser chrome including a close button, and removed the in-page-overlay CSS/markup and the `beforeprint`/`afterprint` sibling-hiding hack it needed (no longer necessary — a popup only ever prints its own content, so there's nothing else to hide). Per-mode `@page` sizing still works the same way (rewriting a `<style>` element's content in JS), just now inside the popup's own self-contained document instead of the host page's `<head>`. (2) Added **Copy Image** / **Download Image** buttons so a bulletin editor can paste the rendered sheet directly into Word/Publisher/Google Docs instead of re-typing it. No third-party screenshot library (this app has none anywhere) — draws the `.pp-page` element's HTML into an SVG `<foreignObject>`, then that SVG into a `<canvas>`, then exports the canvas as a PNG blob (Clipboard API for Copy, a download link for Download). This requires the exported markup to be well-formed XML, which the design's own literal HTML entities (`&mdash;`, `&middot;`) and unclosed void tags (`<br>`, `<col>`) are not — fixed by using real Unicode characters (`—`, `·`) and self-closing tags (`<br/>`, `<col .../>`) in the three `ppBuild*Html()` functions instead. Verified with a Node harness (using `@xmldom/xmldom` as a throwaway dev-time check, not a dependency) confirming the exported wrapper markup parses as valid XML, plus the existing coverage (XSS-escaping, unfilled-role rendering, label pill, Preacher/Children's Message split) re-run against the new script. `npm test` (111/111), `node --check` on both the standalone and embedded built `<script>` blocks, `scheduler/index.html` resynced. **Not verified**: an actual browser/print dialog, or a real clipboard-paste into bulletin software.
- [x] **SC8** — Reported "if I've saved something, then click Auto-Fill, the auto-fill saves automatically" — confirmed the same pattern also applied to Generate Month. Both `autoFillSchedule()` and `generateSchedule()` called `saveCurrentMonth()`/`saveSchedule()` (persisting to localStorage + queuing a D1 push) unconditionally at the end of the function, unlike every manual per-cell edit in the scheduler (which only call `setDirty(true)` and wait for an explicit "Save Changes" click) — an inconsistency, not an intentional design choice per any prior note. Fixed both to call `setDirty(true)` like a manual edit instead of saving immediately, so a fill or a freshly generated month is reviewable/discardable (including via the existing "unsaved changes" confirm on switching months) before being committed; Auto-Fill's status message now says "Click Save Changes to keep them." `npm test` (111/111), `node --check` on the built script, `scheduler/index.html` resynced. **Not verified**: an actual browser. (`src/scheduler-html.js`)
- [x] **SC9** — Reported "when I auto fill it says it is using volunteer history, it should only use the programmed availability." Confirmed: `autoFillSchedule()` picked among each slot's eligible pool (already filtered by `eligible()` — preferred Sundays/role-Sunday-overrides, service preference, blackout dates, absences, i.e. the actual "programmed availability") via `pickBestWithHistory()`, which additionally sorted by `ws_last_served` — a cross-month history of when each person last filled that role — before falling back to even distribution. This was inconsistent with `generateSchedule()` (Generate Month), which already picks purely by even distribution within the run via the plain `pickBest()`, no history. Fixed Auto-Fill to call the same `pickBest()` as Generate Month, deleted the now-dead `pickBestWithHistory()` (zero remaining call sites), and updated the button title/status copy to stop claiming "volunteer history." The `ws_last_served` tracking itself (`getLastServed`/`saveLastServed`/`updateLastServedFromRows`) is untouched — it's still written on every save for the D1 backup export, just no longer read by Auto-Fill. `npm test` (118/118), `node --check` on the built script, `scheduler/index.html` resynced. **Not verified**: an actual browser. (`src/scheduler-html.js`)
- [x] **SC7-FIX2** — Reported "the download image or print image is not working for the scheduler for the bulletin page" (SC7-FIX1's Copy/Download Image feature, which had shipped with an explicit "not verified in a real browser" caveat). Root cause: `ppExportCanvas()` grabbed the rendered content via `pageEl.outerHTML` instead of the original HTML string — but a browser's HTML serializer always re-emits void elements like `<col>`/`<br>` WITHOUT a self-closing slash no matter how they were authored, so the self-closed `<col .../>` that SC7-FIX1 deliberately wrote into `ppBuildBulletinHtml()`/`ppBuildMonthHtml()` (specifically so the foreignObject SVG would be valid XML) got silently un-self-closed on the `outerHTML` round-trip — breaking the SVG's XML well-formedness and failing the image generation for exactly the two modes (Bulletin Insert's `<colgroup>`, Full Month's `<br/>`) that use void elements; Single Sunday has neither, which is why this wasn't caught by re-checking that mode alone. Fixed by building the foreignObject content straight from `ppBuildPageHtml()` (the same string the preview itself rendered from, already self-closed/entity-safe) instead of re-serializing the live DOM. Also wrapped the canvas draw/`toBlob` step in try/catch so a future failure surfaces the existing "Could not generate an image" message instead of silently hanging with no feedback. `npm test` (187/187, no test changes needed — only touches DOM/canvas code with no Node-testable surface), `node --check` on both the standalone and embedded built `<script>` blocks, `scheduler/index.html` resynced. **Not verified**: an actual browser/print dialog — same standing caveat as SC7-FIX1, now narrowed to just this one fix. Done 2026-07-22 (v1.55.3). (`src/scheduler-html.js`)
  - **SC7-FIX3** — User reported the exact same "Could not generate an image. Try Download instead." error still live after SC7-FIX2 shipped, meaning the XML fix wasn't the whole story. Found a second, independent bug in the same function: the SVG's blob URL was minted via the opener window's global `URL.createObjectURL`, but consumed by an `Image` instantiated from the **popup** window (`ppWin.Image` — deliberately, so the popup's own loaded Google Fonts apply during rasterization). Recent Chrome partitions `blob:` URLs per-Document, so a blob URL created in one document is not reliably loadable by an `<img>` living in a different document even when same-origin — exactly the img-fails-silently-then-`onerror`-fires pattern the user hit. Fixed by minting and revoking the URL through `ppWin.URL` instead of the opener's `URL`, keeping creation and consumption in the same realm. `npm test` (187/187), `node --check` on both built `<script>` blocks, `scheduler/index.html` resynced. **Not verified**: an actual browser — same standing caveat, now narrowed further; if this recurs, next thing to check is whether `document.fonts.ready` in the popup ever resolves for the loaded Google Fonts link, and whether the SVG-in-`<img>` foreignObject rasterization technique itself is supported in the browser being tested. Done 2026-07-22 (v1.55.4). (`src/scheduler-html.js`)
  - **SC7-FIX4** — User confirmed the exact same error live at v1.55.4 (after SC7-FIX3's blob-URL-realm fix deployed and was verified via `deploy.yml`'s own run history to have actually gone out — ruling out the CI/deploy-pipeline gap documented elsewhere in this file). Actual root cause, found this time: the app's Content-Security-Policy header (`SEC_HEADERS` in `src/auth.js`) sets `img-src * data:` — and per the CSP spec, the `*` wildcard source explicitly does **not** cover the `blob:`/`data:`/`filesystem:` schemes (they must be listed by name even when `*` is present). `data:` was already listed, but `blob:` was not — so every `<img src="blob:...">` load was silently blocked by CSP the whole time, independent of both the XML-well-formedness fix (SC7-FIX2) and the cross-document blob-URL-realm fix (SC7-FIX3), which is exactly why neither of those actually resolved it: this bug was present underneath both. The print-preview popup (`window.open('')` + `document.write()`) inherits its opener's CSP, so this applied there too. Fixed by adding `blob:` to `img-src`. This is the one directive in `SEC_HEADERS` that needed it — `connect-src` governs fetch/XHR, not `<img>` loads, so it was never in play. `npm test` (187/187), `node --check` on both built app-JS bundles and the worker entry point. **Not verified**: an actual browser — if this still doesn't resolve it, next check whether the browser's dev tools Console/Network tab shows any remaining CSP violation or a different failure entirely (the SVG-in-`<img>`-via-foreignObject rasterization technique itself, per SC7-FIX3's note). Done 2026-07-22 (v1.55.5). (`src/auth.js`)
  - **SC7-FIX5** — User confirmed the CSP fix deployed (v1.55.5) but the exact same generic error is still shown; clarified the on-screen preview itself renders fine (the always-worked `.pp-page` HTML/CSS, unrelated to the export pipeline) — it's specifically the save/export step that fails, with no way from the generic message to tell which of several remaining possibilities is the actual cause. Rather than guess a fourth time, added real diagnostics: `ppExportCanvas()`'s callback now carries a `reason` string (surfaced directly in the on-page status line, e.g. "Could not generate an image (SecurityError: ...)", plus `console.error`'d for anyone who does have devtools open) instead of the prior bare `cb(null)` that discarded the actual failure. Also instrumented the one remaining, most-likely suspect: `canvas.toBlob()` returning no data with no thrown exception (which the prior try/catch wouldn't have caught, since it's not an exception) now reports "toBlob returned no data (canvas may be tainted)" — some browsers set a canvas's origin-clean flag to false for any SVG image containing `<foreignObject>` content, even fully local/same-origin content, which would make `toBlob()`/`getImageData()` permanently unable to read the canvas back regardless of CSP or blob-URL realm; this is the next real bug to look for once the specific `reason` text from a live retry is known — SC7-FIX2/FIX3/FIX4 already ruled out well-formedness, blob-URL realm, and CSP as at least partial causes. `npm test` (187/187), `node --check` on the built script and both app-JS bundles, `scheduler/index.html` resynced. **Not verified**: an actual browser. Done 2026-07-23 (v1.55.6). (`src/scheduler-html.js`)

### People / Households (2026-07-20)
- [x] **PN1** — Added `middle_name`/`preferred_name` fields to People (create/edit modal, PATCH/PUT/POST API, profile header + demographics display, search). Added a "Hyphenate from members' last names" helper button to the household edit modal for households where spouses keep separate surnames (`households.name` was already free text, so no schema change was needed there — the button just auto-fills it from the household's actual member last names). Done 2026-07-20 (v1.38.0). Not verified in a live browser. (`src/db.js`, `migrations/0021_person_middle_preferred_name.sql`, `src/api-people.js`, `src/frontend/js-people.js`, `src/frontend/js-households.js`, `src/frontend/html-tabs.js`)

### Finance Overview (2026-07-16)
- [x] **FIN1** — New "Finance" tab (finance/admin only): unified view of QuickBooks Online (Budget vs Actual + account balances, real OAuth sync) and daycare app financials, so staff don't have to dig through QuickBooks' full report set for the two numbers they actually check. Scoped like the Tuition Aid Planner. Done 2026-07-16 (v1.23.0). See NOTES.md for full detail. `src/quickbooks.js`, `src/daycare.js`, `src/api-finance.js`, `src/frontend/js-finance.js`, `migrations/0016_finance.sql`.
- [ ] **FIN2** — Live QuickBooks verification in progress (sandbox company, 2026-07-16). OAuth connect/disconnect/reconnect all confirmed working (the `vol_auth` `SameSite=Strict`→`Lax` cookie fix, v1.24.1, resolved an initial "Unauthorized" bug on the callback). Account balances sync fine. **Budget vs Actual is currently blocked**: the sandbox consistently returns a QuickBooks "5020 Permission Denied" error on this specific report, even with a verified Budget (renders correctly in the QuickBooks UI) and Primary Admin access — ruled out plan tier (tried Advanced), user permissions, and stale tokens (full disconnect/reconnect). A support ticket is filed with Intuit (tid/error code included); no ETA. v1.24.4 added an automatic fallback that reconstructs the same data from the raw `Budget` entity + `ProfitAndLoss` report when the direct report call fails. **v1.26.1**: the user compared that reconstruction against a real exported "Budget vs. Actuals" report and found it lost QuickBooks' Income/COGS/Expenses categorization (flat alphabetized list) and was silently merging two different accounts that share a leaf name across different categories — rewrote the merge to work directly on the real ProfitAndLoss tree instead of flattening it (see NOTES.md for full detail); verified against a Node harness replicating the real export's exact structure, but still not verified against a live re-sync (5020 error still blocking). Still needs: see whether the fallback returns correct data once tried against the sandbox for real, and re-test the whole flow (including Budget vs Actual) against the real Production company/keys once Intuit approves. If the live fallback still looks wrong, the user's suggested plan B — export Budget vs Actual from QuickBooks as Excel and import it into ChMS directly — is the next thing to try.

**2026-07-28 update — confirmed against the real Production company, not just sandbox.** After completing Production OAuth (real `QB_CLIENT_ID`/`QB_CLIENT_SECRET`/`QB_ENVIRONMENT=production`, redirect URI registered under both Intuit app tabs), a real sync against the real church QuickBooks company hit the **identical** `5020 Permission Denied` error on the Budget vs Actual report endpoint (new `intuit_tid`, same error code) — ruling out "sandbox-only artifact" as the explanation for good. The automatic fallback (raw `Budget` entity query + `ProfitAndLoss` report merge, `src/quickbooks.js`/`src/api-finance.js`) fired as designed and the sync still completed with reconstructed data. User confirmed: the 2026 Budget is Published and is a `ProfitAndLoss`-type budget (matches the Budget entity spec exactly — `BudgetType: "ProfitAndLoss"` is the only value QuickBooks supports); the connected user has full Company Admin access. **Intuit will not open a support ticket** for this app/tier, so the earlier "ticket filed, no ETA" status is dead — no formal path to a fix from Intuit is currently available. Given the fallback already reconstructs the same shape from a real, always-accessible endpoint (`SELECT * FROM Budget`, confirmed reachable — only the packaged `BudgetVsActuals` *report* endpoint 5020s), **treat the direct report call as permanently unavailable for this app and the reconstruction path as the primary, not a fallback** — next step is verifying the reconstructed numbers look right against this real company's real data (not just the earlier hand-built fixture/Node harness check), not chasing the report endpoint further. Community research (Intuit Developer Community forum, Stack Overflow `quickbooks-online-api` tag) is the remaining avenue if a fix is wanted later, since the formal support-ticket path is closed off.

**2026-07-28 continued — root-caused two real bugs, both fixed, plus a Budget picker.** Same session, later the same day, after `CHURCH_SOURCE_PRIORITY` was flipped (qbo_sync now outranks a file import — see the entry above this one) so live-synced data actually rendered for the first time. Two concrete findings, not just workarounds:
1. **Wrong endpoint name, the whole time.** `client.budgetVsActual()` (`src/quickbooks.js`) called `/reports/BudgetVsActual` (singular). The user found a community source confirming QuickBooks' real report name is `BudgetVsActuals` (plural) — and that this report is genuinely **undocumented and unsupported by Intuit** (an open Intuit developer-community request literally asks Intuit to document it). Fixed to the plural name. Worth re-testing on the next real sync, but given it's officially unsupported, don't be surprised if it still fails — the entity+P&L reconstruction (below) is the sanctioned path either way, not a fallback of last resort.
2. **A live-sync-only classification bug, caused by exposing qbo_sync data for the first time.** This church's live QuickBooks report labels its top-level sections "Revenue"/"Expenditures" (matches their Excel export wording, already handled for imports via `normalizeChurchClassification()`) — but `flattenReportTree()` (the live-sync path) never ran the label through that same normalizer, so Income silently sorted to the bottom and the Revenue/Earned-Income/Restricted-Income regrouping (`finReorganizeChurchTree`) never fired for synced years. This is exactly what the user reported ("it reordered all the funds moving income to the bottom again"). Fixed; regression test added (`test/finance-church.test.js`).
3. **Budget picker shipped**, since a company can have more than one `Budget` object in QuickBooks and the merge was silently guessing. `GET`/`PATCH /admin/api/finance/qb/budgets` + a "Choose Budget…" control on the Overview card's QuickBooks Connection card, admin-gated. `chms_config` key `finance_qb_selected_budget_id`.

**Still open / for the next session working this:**
- **Query vs Read, investigated, likely not the cause.** User asked whether `SELECT * FROM Budget` (Query, what this app uses) vs `GET /budget/<id>` (Read, never tried) could explain anything. Both are Data API (`/query`, `/<entity>/<id>`) — architecturally separate from the Reports API (`/reports/<name>`), which is what 5020s. Balance Sheet (also Reports API) succeeding while BudgetVsActuals fails is strong evidence the failure is specific to that one canned report, not a Query-vs-Read distinction, and not Reports API access broadly. Worth a quick Read-by-ID smoke test for completeness, but don't expect it to explain the 5020.
- **Test-budget creation, deliberately not automated.** User wants to try creating a small throwaway Budget via the API as a permission diagnostic (Create is a real, different write-permission surface than Query). **Recommendation: do this by hand in the QuickBooks UI** (Settings → Budgeting → New Budget, a 1-month/$1 test budget, delete when done) rather than building an automated write-test into this app — QuickBooks' Update operation nulls any writable field omitted from the request body (per Intuit's own docs), so a scripted write test against a real company's real Budget object carries real corruption risk for a one-time diagnostic that doesn't need to touch production data at all.
- **LiveFlow** — a third-party QuickBooks reporting/budgeting tool the user found that may cover this gap commercially. Not evaluated or integrated; flagging as an option if the in-house reconstruction path (see below) ever proves insufficient, rather than a current recommendation.
- **Deposit-entity fee matching (ties to the earlier "link giving deposits to QB" discussion).** User shared a QuickBooks deposit screenshot showing real per-deposit fee breakdown (Donor Income + Restricted Income − Bank Fees = net). `Deposit` is its own queryable QuickBooks Data API entity (`SELECT * FROM Deposit`, same pattern as `Budget` — not yet called anywhere in this app). Matching real QuickBooks `Deposit` line items against ChMS's `giving_deposits` by date/amount could auto-populate both the bank amount *and* the real fee line in the existing Deposits reconciliation UI (`src/frontend/js-giving.js`), instead of the bookkeeper typing the bank total by hand. Scoped as an idea, not started — the precedence-vs-toggle question for how sync interacts with prior data (already resolved this session — sync wins) would need an analogous decision for how far to trust auto-matched deposits vs. manual entry, if this gets built.
- **Bottom line on the 5020 report itself**: treat `BudgetVsActuals` as permanently unofficial/unreliable for this app regardless of the endpoint-name fix. The real, supported path is Budget entity (Query, confirmed working) + ProfitAndLoss report (confirmed working) merged client-side — already built (`mergeCurrentYearBudgetAndActual`) and now also respects the new Budget picker. Next actual step is verifying those reconstructed numbers against this company's real 2026 data, not further chasing the report endpoint.

**2026-07-28 continued again — native report responded but its numbers were wrong; switched to reconstruction-only.** After the endpoint-name fix (plural `BudgetVsActuals`) shipped, a live sync got a response from the native report for the first time ever — but with implausible figures (e.g. an "Actual" ~8.8x its own "Budget" for the same account, and the column headers didn't render because the generic renderer wasn't built for that report's real shape). Matching the "since inception, not since Jan 1" hypothesis the user raised, and consistent with Intuit's own confirmation this report is unsupported, the sync now **never displays the native report's numbers, only the reconstruction** — the native call still runs so a real failure still surfaces as a warning, but its Rows/Columns are discarded either way. Also shipped: comma-formatted dollar cells in the Budget vs Actual table, and a From/To year-range picker on the Multi-Year Church Report view (the view was hardcoded to a rolling 5-year window, so an older import like 2018 saved fine but was never visible anywhere — not a save bug, a display-range bug).

**User's stated fallback plan, if the live sync path still isn't trustworthy enough**: skip live sync/native-report chasing entirely and just import CSV/Excel exports month-by-month back to 2018 — the user has these reports on hand. This is **already fully supported** by the existing importers, no new work needed to enable it:
- `finance/church/import-preview` + `import-commit` — annual "Budget vs. Actuals" Excel export (`source='import'`), no year restriction.
- `finance/church/monthly-import-preview` + `monthly-import-commit` — month-by-month P&L Excel export (`source='monthly_import'`), also no year restriction.
- Both import buttons live on the Church Report card. Per `CHURCH_SOURCE_PRIORITY`/`CHURCH_MONTHLY_SOURCE_PRIORITY`, `qbo_sync` outranks `import` for any year sync actually covers (currently a rolling 5-year window: `PNL_YEARS_BACK = 4`) — so a 2018 import would never be shadowed by sync regardless, since sync doesn't reach that far back. The new Multi-Year year-range picker (this update) is what makes an old imported year actually visible after import.
- If the user goes this route for real, worth double-checking: does `parseBudgetVsActualsGrid`'s year-detection regex (`/(\d{4})/` scanning lines above the header) correctly read whatever header text an older/different-vintage QuickBooks export uses for its date range — it was only ever verified against a 2026-era export.

**2026-07-28 continued a third time — found and fixed why the reconstruction's Budget column was always $0.** User reported live: Actual populated correctly in the reconstruction but Budget showed $0 on every line, and asked whether this could be from summing every Budget object ever (not just 2026's). Traced the code: `mergeCurrentYearBudgetAndActual()` only ever reads the *one* selected Budget object's own `BudgetDetail[]` — the "every budget ever" theory doesn't hold given the actual code. The real cause: `mergeLeafCells()` matched a P&L account to its budget by **exact string name** with no fallback — QuickBooks can (and evidently does, for this company) display the same account with a slightly different label in the P&L report than in the Budget entity, silently failing every match. Fixed by adding account-id matching (`.id` on a report ColData cell, standard QBO Reports API behavior) as the primary key, falling back to the existing name match only when no id is present. `budgetByAccountId` map added alongside the existing name-keyed maps. 2 new regression tests. Worth re-testing on the next live sync to confirm Budget now populates for real — if it still doesn't, the next thing to check is whether QuickBooks' report ColData actually carries `.id` for this company/report shape (never directly observed live, based on documented QBO Reports API behavior).

**2026-07-28 continued a fourth time — found and fixed a real duplicate-write bug inflating the Overview KPI cards.** With the $0-budget fix live, the ID-match confirmed working (Sunday Offering: $225,843.68 actual / $425,000 budget, plausible) — but the Overview tab's KPI cards (Income YTD/Expenses YTD/Net Position) showed roughly double the correct total (~$1.18M expenses) compared to the same sync's own Budget vs Actual reconstruction (~$605K, independently verified plausible from the same sync). Root cause: `finance_church_entries` is built from three flatten passes per sync (multi-year actuals, current-year budget-merge, monthly) sharing one `UNIQUE(fiscal_year, period_month, category_path, source)` key — the multi-year pass and current-year pass both write period_month=0 rows for the current year, relying on the second pass's `ON CONFLICT DO UPDATE` to overwrite the first. That self-heals only when both passes produce byte-identical `category_path` strings for the same account; QuickBooks' multi-year summarized report (`summarize_column_by:'Year'`) doesn't reliably match the single-year report's account tree shape, so a mismatched path became a second, un-overwritten row instead of a correction — silently doubling the total. Fixed by excluding the current year from the multi-year pass entirely (the current-year pass already covers it, with real budget data the multi-year pass doesn't have). Also fixed, from the same screenshots: "Net Operating Revenue"/"Net Revenue" showed $0.00 budget because `mergeProfitAndLossTree`'s combined-budget special case and the running-subtotal filter only ever matched the literal English string "Net Income" — this church's real report uses "Revenue" wording throughout, same as `normalizeChurchClassification` already handles for section labels, now extended to the bottom-line rows too. 4 new regression tests.

**2026-07-28 — decision: live QuickBooks API sync set aside.** After this full chain of real bugs (wrong report endpoint name, unnormalized live-sync classification, $0 budget matching, the duplicate-write inflation above), the user decided to stop pursuing live sync and instead re-download reports directly from QuickBooks and re-upload them **month-by-month** via the existing CSV/Excel import tools (`finance/church/monthly-import-preview`/`monthly-import-commit`, already built, no year restriction). All the fixes above are still shipped and correct — they'd make live sync work properly if ever revisited — but this is no longer the active path. A new admin-only **"Clear Budget & Report Data…"** tool (Finance → Overview → Danger Zone) was built to give a clean slate: clears only `finance_church_entries` + `finance_qb_snapshot` (the church budget/actuals and their cached Overview-card blob) — explicitly, per the user's own correction, **not** Daycare Report, Balance Sheet, or Budget Planning data, and never Commercial Property or giving data. Confirm-count safety pattern matching `giving/force-remove-orphans`. **Not yet exercised live** — this session has no D1/wrangler access, so the tool is built but nothing has actually been cleared; that click has to happen from the live app.
- [ ] **FIN3** — Daycare app's finance endpoint is now live (a Supabase Edge Function, 2026-07-16) — see SECRETS.md for the exact URL/contract as actually implemented. Fixed a real mismatch in `src/daycare.js` while wiring it up: the client assumed `DAYCARE_API_URL` was a base domain and appended `/api/finance/summary` itself, but the daycare app's real endpoint is a complete, specific Supabase function URL — fixed to fetch `DAYCARE_API_URL` directly with no path appended. Still needs: `DAYCARE_API_URL`/`DAYCARE_API_KEY` set as Worker secrets, then click "Sync Daycare App" in the Finance tab to confirm the real data renders correctly (categories: Tuition Income, Payroll, Payroll Taxes, Workers Comp, Other Payroll Expenses, Other Expenses — `accounts` is always `[]`, balances stay manual-entry only).
- [ ] **FIN4** — No Settings UI for QB_CLIENT_ID/QB_CLIENT_SECRET/DAYCARE_API_URL/DAYCARE_API_KEY (Worker secrets only, same as Breeze/Brevo/Resend) — consistent with how every other integration in this app is configured, but flagging in case that changes.
- [x] **FIN5** — Board-level reporting: Finance tab split into Overview/Church Report/Daycare Report sub-tabs, both year-by-year (calendar year), on-screen + printable/exportable. Daycare Report aggregates the flat sync rows client-side (Actual/Budget by category and year, Income/Expense/Net summary rows). Church Report adds a new QBO multi-year Profit & Loss sync with 3 daycare tie-in lines (Tuition Income/Payroll wages/Total Expenses) shown for reference alongside QuickBooks' own totals, not merged into them. Done 2026-07-17 (v1.26.0). See NOTES.md for full detail. **Superseded by FIN6** — Church Report's data source changed from a live blob cache to a persisted table.
- [ ] **FIN6 — Church Report v2 (in progress, staged rollout)**. Full plan (schema, live-sync flattening, Excel-import hierarchy detection, This Year/Multi-Year view design, Finance nav consolidation) written up before implementation — see the session's plan doc for the complete design. **This slice done 2026-07-17 (v1.28.0)**: new persisted `finance_church_entries` table (one row per real account's own non-cumulative actual+budget amount — never a QuickBooks "Total for X" subtotal — so roll-ups are always safely re-derivable, avoiding the exact double-counting bug just fixed in v1.26.1), live sync now populates it (multi-year actuals-only flattened first, current-year budget-merge flattened second so the richer row wins), new `finance/church/this-year`/`finance/church/multi-year` endpoints with per-year `import`-wins-over-`qbo_sync` source precedence, and a This Year/Multi-Year toggle in the Church Report UI (This Year: summary cards + remaining-budget progress bars + a ChMS-giving reference line + collapsible full account detail; Multi-Year: same year-by-year table, now read from the persisted table instead of the live blob cache). See NOTES.md for full detail including two real bugs caught and fixed before shipping (a `NULL != NULL` UNIQUE-constraint gap that would have silently duplicated rows on every sync, and a client-side tree-rebuild bug that dropped nested accounts out of their ancestor's rollup when an intermediate grouping label had no own row). **Next slice done 2026-07-17 (v1.29.0)**: (1) the giving reference line now breaks out per-fund (`givingByFund`, joined against `funds`) instead of one lump total, shown as a small table under the existing reference caption. (2) Monthly-granularity sync added for current+prior year only (`profitAndLoss({summarize_column_by:'Month'})`, bounded per the original plan to avoid syncing a full 5-year monthly window) via new `parseMonthColTitle()`/`makeMonthlyExtractor()`, tagging rows with `period_month` 1-12 instead of `0`. (3) New pure function `computeYtdComparison()` (This-Year-YTD vs. Same-Period-Last-Year vs. Last-Year-Full, prior-year-ratio projection with a straight-line fallback) wired into `finance/church/this-year`, rendered as a new "This year vs. last year" table with the board-facing caveat caption from the plan; gracefully shows "not yet available" until the first post-upgrade sync populates monthly rows. Caught and fixed, before shipping, a repeat of the exact backtick-in-`String.raw`-comment bug documented elsewhere in this file (SC3-BUG1/TAP2-BUG class) via the established extract-and-`node --check` verification step. See NOTES.md for full detail.
**Charts done 2026-07-17**: `renderGroupedBarChart()` extracted from Attendance's `renderMultiYearServiceChart` (verified byte-for-byte identical output on the original before anything else built on it), now backing a This-Year-vs-Last-Year-YTD chart and a Multi-Year Income/Expenses/Net trend chart.

**Nav consolidation — shipped, RESOLVED 2026-07-18: was never a code/design bug, was a stalled deploy pipeline.** Collapsed the Giving/Tuition Aid/Finance sidebar entries into one "Finance" item with a shared flat sub-nav bar across all three tab-panels, and physically moved the 8 giving-related report tiles out of the Reports tab into a new "Giving Reports" section under Finance. User reported the live site still showed the old 3-item nav even in incognito. A screenshot confirmed the exact old structure was still live. Root cause, found by checking `deploy.yml`'s actual run history against `main`'s commit history: **GitHub does not fire other `on: push` workflows for a push made using the default `GITHUB_TOKEN`** (an anti-recursion safeguard) — so every push `auto-merge-claude.yml` (recreated earlier the same day, see the entry above) made to `main` via `git push origin HEAD:main` silently never triggered `deploy.yml`'s own `on: push: [main]` trigger. Several real, correct commits (the nav consolidation, the charts, the daycare-entries Edit-button fix) sat merged-but-undeployed on `main` for ~2 hours before this was diagnosed — nothing was ever wrong with the shipped code itself. Fixed: `auto-merge-claude.yml` now explicitly dispatches `deploy.yml` via `gh workflow run deploy.yml --ref main` (`workflow_dispatch` fired via the API with `GITHUB_TOKEN` is allowed, unlike an implicit push-triggered run) as its final step, plus a `permissions: actions: write` grant to allow that dispatch. Manually triggered a catch-up deploy for the current `main` tip to get everything already-merged actually live. **Lesson for next time a "my change isn't showing up live" report comes in**: check `deploy.yml`'s actual run history against `main`'s commit log FIRST — a gap there means the deploy pipeline itself is broken, which looks identical to a caching issue or a real code bug from the user's side until you check.

**CSV/Excel budget import — DONE 2026-07-18 (v1.31.0).** Built against the user's real uploaded "Budget vs. Actuals" QuickBooks export (not a hand-built fixture) — server-side `.xlsx` reader (ported from Tuition Aid's client-side ZIP+DEFLATE reader) + a leading-space-indentation hierarchy parser + classification-label normalization (this export uses "Revenue"/"Expenditures", not QuickBooks' internal "Income"/"Expenses" — a real, easy-to-miss quirk this file surfaced) + a preview-then-commit UI (new "Import Budget" button on the Church Report card). See NOTES.md for full detail. **Not verified**: an actual live upload through the real deployed Worker, or a real browser (see nav-consolidation note above — this is the recurring gap) — an actual live QuickBooks sync is separately still blocked by the 5020 Permission Denied error (FIN2), which is exactly the gap this import feature exists to work around.

**Balance Sheet import — DONE 2026-07-18 (v1.32.0).** The two other uploaded files (Statement of Financial Position / Balance Sheet without zero acct) turned out to be the same underlying report — confirmed the real dollar amounts balance exactly (Assets = Liabilities + Equity) — but exported with two genuinely different formatting conventions (real cell-indent metadata + "Total for X", vs. leading-space + "Total X"); `parseBalanceSheetGrid()` handles both. New "Balance Sheet" third view + "Import Balance Sheet" button on the Church Report card, its own `finance_church_balances` table (migration `0019`), and a visible Assets-vs-Liabilities+Equity balance check in the UI. Per the user's explicit choice, this is scoped to its own Church Report section only — the Overview tab's existing live-QuickBooks account-balances card is untouched for now, left for later. See NOTES.md for full detail, including a real bug caught before shipping (a trailing footer/timestamp line was silently mis-filed as a bogus account).

- [x] **FIN6-BUG1** — Real Balance Sheet import (`FIN6`'s Balance Sheet slice) silently imported every account as $0. Root cause: this particular "Balance Sheet without zero acct" export writes each leaf account's dollar amount as literal text inside the `<f>` (formula) tag with a stale, never-recalculated `<v>0.0</v>` cache — the xlsx cell reader only read `<v>`. Fixed to prefer a plain-numeric `<f>` over a stale `<v>`; verified against the real re-uploaded file (balances to the cent, `balancedCents: 0`). Done 2026-07-20 (v1.36.1) — see NOTES.md. (`src/api-finance.js`)
- [x] **FIN8** — Commercial Property section: new "Commercial Property" sub-tab in Finance (alongside Overview/Church Report/Daycare Report) for 3277 Ivanhoe, a commercial rental property the church owns, managed by AHRA. Built from a structured data export delivered 2026-07-20 (28 months of financials Dec 2023–May 2026, annual rollup, income-capitalization valuation $686,315, LCEF loan balance $297,336, 3 years of confirmed distributions to the church). New `finance_property_monthly`/`finance_property_distributions` tables (migration `0022`, keyed by `property_key` for a possible future second property) seeded idempotently from the export; static valuation/loan/property info stored as a JSON blob in the existing `chms_config` table. New `GET/POST/DELETE /admin/api/finance/property/ivanhoe/*` routes (reads need `isFinance`, writes need `isAdmin`); annual summary is computed server-side from the monthly rows so it can't drift from what's on screen. UI: stat tiles (valuation/mortgage/equity/LTV), an editable Monthly Financials table with an Add/Edit modal for future AHRA reports, and a Distributions-to-Church list. `npm test` (111/111, 8 new tests). Not verified in a live browser. Done 2026-07-20 (v1.40.0). See NOTES.md for full detail. (`migrations/0022_finance_property.sql`, `src/db.js`, `src/api-finance.js`, `src/frontend/js-core.js`, `src/frontend/js-finance.js`, `src/frontend/html-tabs.js`)
- [x] **FIN9** — Commercial Property: added reserves-for-property-taxes-and-capital-expenses tracking, closing the gap flagged right after FIN8 shipped. New generic `finance_property_reserves`/`finance_property_reserve_disbursements` tables (keyed by `reserve_key`, so the same mechanism covers the Property Tax Reserve today and could cover other named buckets later) seeded with AHRA's real 28-month tax reserve schedule + 3 confirmed tax-bill payments; the monthly write endpoint auto-carries `reserve_before` forward from the prior month. New `finance_property_capital_ledger` (7-entry real ledger, $33,947.75 total, with a hand-curated 4-project rollup in the meta blob) and `finance_property_repairs` (13-entry non-capitalized repair log) tables, each with admin add/delete routes and UI forms. Also added a read-only Insurance Allocation card (3277 Ivanhoe's TIV share of the church's one GuideOne policy, ~$15,263/yr) and corrected the mortgage balance to $279,691.13 (was $297,336) via a one-time marker-gated upgrade seed. The MDO utility-cost-share data (a different building/fund) was captured in the meta blob but deliberately not surfaced in this UI — needs its own home, flagged as a follow-up rather than guessed at. `npm test` (118/118, 15 new tests). Not verified in a live browser. Done 2026-07-20 (v1.41.0). See NOTES.md for full detail. (`migrations/0023_finance_property_reserves.sql`, `src/db.js`, `src/api-finance.js`, `src/frontend/js-finance.js`, `test/finance-property.test.js`)
- [x] **FIN10** — Daycare MDO note (moved from Commercial Property per FIN9's flag) + a daycare past-year bulk-import textarea (new `POST /admin/api/finance/daycare/bulk`, all-or-nothing). Commercial Property gained: 3 charts (Revenue vs Expenses, Occupancy %, Property Tax Reserve balance — all reusing the existing `renderGroupedBarChart` helper), a Cash Flow & Mortgage Payoff Forecast card (amortizes the loan forward to a projected payoff date + "potential annual net income after payoff," with an explicit on-screen caveat about the debt-service assumption behind that number), and an editable income-capitalization Valuation Calculator (no separate raw AHRA valuation worksheet was ever uploaded — this replaces needing one, saving via the existing meta PATCH route). `npm test` (124/124, 6 new tests including a closed-form cross-check of the amortization math). Not verified in a live browser. Done 2026-07-20 (v1.42.0). See NOTES.md for full detail. (`src/api-finance.js`, `src/frontend/js-finance.js`, `src/frontend/html-tabs.js`, `test/finance-property.test.js`, `test/finance-property-forecast.test.js`)
- [x] **FIN11** — Valuation Calculator rebuilt from the real AHRA worksheet (`3277_Ivanhoe_Valuation_2.xlsx`, uploaded right after FIN10 shipped a simplified version) — turns out the raw worksheet does exist and wasn't uploaded earlier in the session. Real per-tenant rent roll (editable, add/remove rows) + itemized operating costs (Utilities/Trash/Maintenance/Landscaping/Legal/Taxes/Insurance) + Vacancy Rate %/Management Fee %/Cap Rate, live-recomputing Gross Rental Income → NOI → Capitalized Value. New pure `finComputePropertyValuation()` backs both the live UI and the save, unit-tested against the real worksheet numbers (reconciles to $686,314.86 within a few cents). New marker-gated `seedIvanhoePropertyValuationV3()` seed. Still saves via the existing meta PATCH route. `npm test` (128/128, 4 new tests). Not verified in a live browser. Done 2026-07-20 (v1.42.1). See NOTES.md for full detail. (`src/db.js`, `src/frontend/js-finance.js`, `test/finance-property-forecast.test.js`)
- [x] **FIN12** — Church Budget Planning: new "Planning" sub-tab in Finance. Scoped with the user first via 2 quick questions rather than guessing: it needed to be both a forward what-if projection tool AND able to commit its output as a real future budget, and 3277 Ivanhoe's own forecasting needed to stay a separate section (different mechanics — the property has no internal budget to plan against, only AHRA-reported actuals). New `finance_budget_plan` table (migration `0024`, freeform category names — not tied to a specific QuickBooks account) with `generate` (compounding growth projection), `override` (single-year manual correction), delete, and `commit` (writes a fiscal year's plan into `finance_church_entries` as `source='plan_committed'`, wholesale-replacing any prior commit for that year) endpoints. `resolveChurchYearPrecedence()` redesigned from a 2-way check into an explicit 3-tier priority (`import` > `qbo_sync` > `plan_committed`) so a committed plan automatically steps aside the moment real data exists for that year. 3277 Ivanhoe Multi-Year Forecast is a separate, read-only, client-side-only extension of the existing single-year payoff forecast (adjustable growth rate + year count). `npm test` (139/139, 10 new tests). Not verified in a live browser. Done 2026-07-20 (v1.43.0). See NOTES.md for full detail. (`migrations/0024_finance_budget_plan.sql`, `src/db.js`, `src/api-finance.js`, `src/frontend/js-core.js`, `src/frontend/js-finance.js`, `src/frontend/html-tabs.js`, `test/finance-budget-plan.test.js`, `test/finance-church.test.js`)
- [x] **FIN13** — Church Budget Planning rebuilt around the real chart of accounts, per feedback right after FIN12 shipped: table now renders the same account tree Church Report already builds (`finBuildTreeFromFlatRows`, reused, not reimplemented) instead of freeform typed categories, with 3 columns (FY Budget / FY Actual / FY+1 Projected) and a Base Year / Projecting-For-Year picker. New `generate-all` (bulk-projects every real account from its own actual, falling back to budget) and `override-bulk` (saves the whole hand-edited table in one call) endpoints replace the old one-category-at-a-time flow. Salary & Benefits shows as a normal line for now with a callout explaining the formula + Concordia Plan Services comparison the user described are still to come — not guessed at. `npm test` (143/143, 4 new tests). Not verified in a live browser. Done 2026-07-20 (v1.44.0). See NOTES.md for full detail. (`src/api-finance.js`, `src/frontend/js-finance.js`, `test/finance-budget-plan.test.js`)
- [x] **FIN14** — Church chart-of-accounts reorganized for presentation (display-only, no data model change): "Income" relabeled "Revenue" and sorted before Expenses everywhere it's shown (Church Report stat cards, YoY chart/table, 5-year Multi-Year table/chart, CSV export, Planning table); Facility Rental/Fundraisers/MDO grouped under a new "Earned Income" heading; Altar Guild grouped under "Restricted Income"; "Sales" hidden from the account tree (its dollars still count in the server-computed Total Revenue stat card, flagged as a known limitation rather than silently fixed — say if it should be excluded from that total too). New pure `finReorganizeChurchTree()` shared by Church Report's This Year view, its pie charts, its CSV export, and Planning, so all four stay visually consistent; recomputes rolled-up totals bottom-up after re-parenting rather than patching them incrementally (a stale-total bug class this avoided). Planning also gained a bolded Net (Revenue − Expenses) row, colored red/green, for both the base year (straight from the server's own totals) and the projected target year (summed client-side from the table). `npm test` (148/148, 5 new tests). Not verified in a live browser. Done 2026-07-20 (v1.45.0). See NOTES.md for full detail. (`src/frontend/js-finance.js`, `test/finance-church-tree.test.js`)
- [x] **FIN15** — Salary & Benefits Calculator, replacing the FIN13 placeholder callout. Learned the real formula from the user-uploaded LCMS Missouri District FY2026-2027 Compensation Guidelines PDF (base salary-by-year table × a role/education/experience multiplier — separate published tables for Pastors, Commissioned Ministers by education track, and Other Church Workers by role — plus optional responsibility stipend and pastor-only attendance bonus) and reproduced it as tested pure functions (`finLcmsBaseSalaryCents`, `finLcmsMultiplierFor`, `finComputeLcmsSalary`) that exactly reconcile every worked example and table value in the source document (one real discrepancy found and resolved: the PDF's own prose says "the base salary set for 2026 is $51,529" but its own Base Salary History table lists 2026=$50,028/2027=$51,529 — using $51,529, i.e. year 2027, is what actually reproduces both worked examples, so the "2026" in that one sentence is treated as a carried-over typo, not a data source). New editable worker roster in the Planning sub-tab (name/role/years/education-track/responsibility-stipend/attendance-bonus, add/remove rows) computes each worker's salary live and totals into a "Total Salary & Benefits" figure (salary + employer FICA + a plain entered Benefits figure — CPS benefits have no published formula, quoted directly per congregation), with an "Apply to account" button that writes the total into the existing Planning FY+1 Projected column for a chosen real expense account. **FICA/SECA employer-cost distinction**, added from 3 real Concordia Plans Compensation Decision Support Tool estimates the user provided for this church's actual Pastor ($103,608.98 LCMS-range midpoint), DCE ($69,367.03), and Director of Parish Music ($73,473.75): Pastors and Commissioned Ministers (e.g. DCEs) default to self-employed for Social Security ("Ministers of Religion" — the church pays no employer FICA share, the worker pays their own full SECA), Other Church Workers default to regular-employee (church pays the standard 7.65% employer FICA). This is a **per-worker override, not a rigid role rule** — the user's explicit real-world correction is that this church's Director of Parish Music, despite nominally qualifying for minister tax treatment under the generic guideline language, is actually treated as a regular W-2 employee with employer-paid FICA, so a "Self-Employed (SECA)" checkbox per roster row lets the default be overridden either way; the roster table gained an Employer FICA column reflecting the toggle. New pure `finDefaultSelfEmployedFica()`/`finComputeEmployerFicaCents()`. **Bug caught and fixed before shipping**: two comment lines using markdown-style backtick code-formatting (`` `growBeyond` ``/`` `capped` ``) were literal backticks sitting inside the file's single outer `String.raw` template literal, prematurely closing it and breaking the entire served script — the exact bug class documented under SC3-BUG1/TAP-series elsewhere in this file, recurred here for backticks instead of backslashes; caught by `npm test` itself (a Rolldown parse error), not just the usual `node --check` step, since the built script is imported into a Vite-run test file. `npm test` (160/160, 12 new tests). Not verified in a live browser (same standing caveat as the rest of Finance). Done 2026-07-21 (v1.46.0). (`src/frontend/js-finance.js`, `test/finance-salary-calculator.test.js`)
- [x] **FIN16** — Health Insurance Renewal Options added to Church Budget Planning, from the real Concordia Plans quote #0560500326 (effective 2027) for this church's group medical/dental/vision enrollment (2 Family-tier employee contracts). New `HEALTH_PLAN_QUOTE_2027` reference data (Current, Renewal "stay in current plan," and 3 alternate medical options — Dental/Vision are identical across Renewal/Option 1/2/3, only Current has an older, lower Dental rate, a real quirk of the quote, not simplified) + pure `finComputeHealthPlanTotalCents()`, unit-tested against the quote's own printed totals for all 5 options. New card in Planning (same reference-data + "Apply to account" pattern as the Salary Calculator): a Plan Option picker, Medical/Dental/Vision/Total breakdown, and a button to write the total into the Planning FY+1 Projected column for a chosen real account. This is one congregation-wide premium, not a per-worker figure — deliberately kept separate from the Salary Calculator's per-worker roster. Default plan selection went through a real cost/benefit discussion with the user (church currently pays the full Current-plan premium for both employees, both Family-tier): Option B (Healthy Me HSA-B) initially looked like the better buy-up over C for the church to fully absorb — cheaper and better-protected than Option A, and its lower non-embedded family OOP max ($8,500 vs. Renewal's embedded $16,000) helps a lot in a bad year where costs spread across family members. But the user confirmed neither employee's household has ever hit the current plan's $8,000 individual OOP max — meaning actual usage sits in the range where Option B is *worse*: its non-embedded deductible threshold for a lone claimant ($6,000) is $2,000 above the current plan's embedded individual deductible ($4,000), so a typical moderate (non-catastrophic) year would cost more out-of-pocket under B, on top of the guaranteed $3,296.40/yr extra premium for both employees. Default left on Renewal (Option C) accordingly — worth revisiting only if a specific high-cost year becomes likely for either household. `npm test` (163/163, 3 new tests). Not verified in a live browser. Done 2026-07-21 (v1.47.1). (`src/frontend/js-finance.js`, `test/finance-salary-calculator.test.js`)
- [x] **FIN17** — "Is it worth it?" breakeven analysis added to the Health Insurance card, quantifying the exact question the user asked after FIN16: what dollar amount of medical expenses would a household need to hit for a richer (costlier-premium) plan option to actually pay for itself. New pure `finComputePlanOOPCents()` (plain deductible-then-coinsurance-to-OOP-max out-of-pocket formula, shared by both calcs below), `finComputeHealthPlanFamilyBreakevenCents()` (binary-searches, given a per-household premium difference, for the family-wide annual spend — assumed spread across 2+ family members, using each plan's FAMILY deductible/OOP-max — at which the selected option's lower out-of-pocket costs start outweighing its extra premium; returns null if it never does), and `finComputeHealthPlanSingleClaimantDeltaCents()` (the opposite, worse-case framing: if one family member alone accounts for all the costs, a non-embedded option's aggregate deductible/OOP-max applies to that person directly instead of a smaller embedded individual cap — this is the concrete answer to the user's non-embedded question). All three reproduce the numbers worked out by hand with the user for Renewal→Option B exactly: a single-claimant year never breaks even (tops out $500 worse), but a family-wide spend of **$18,741/yr spread across 2+ members** is the exact breakeven, growing to a $7,500/yr net saving once both plans are fully saturated. Rendered as a new "Is it worth it?" callout under the plan breakdown, shown automatically whenever a costlier-than-Renewal option is selected. `npm test` (167/167, 4 new tests locking in the hand-computed breakeven and worst-case figures). Not verified in a live browser. Done 2026-07-21 (v1.47.2). (`src/frontend/js-finance.js`, `test/finance-salary-calculator.test.js`)
- [x] **FIN18** — Extended the "is it worth it?" callout to Options A and D, and fixed a genuine wording ambiguity the user caught: "total spend" read as if it were capped by the OOP max, when it actually means total cost of care billed by providers (what the family pays stays capped well below that number) — copy now says "total cost of care for the year" and spells out that the family's own payment stays capped separately. Also added the missing symmetric case: a *cheaper* option (D) isn't a breakeven question at all — it's a guaranteed premium saving traded against a *worse* deductible/OOP-max, so the callout now computes both sides and states outright whether the worst-case extra out-of-pocket exposure is smaller or larger than the guaranteed savings. Confirmed: Option A costs $4,045.80/yr more per household and breaks even at $28,229 in family-wide total cost of care (vs. B's $18,741 — A is a worse deal than B on every axis, as already known); a lone claimant under A ties Renewal exactly ($8,000 vs. $8,000, both embedded-equivalent at that number). Option D actually saves $2,545.68/yr per household in premium, and even its worst-case exposure (up to $1,000 more in a fully-saturated bad year) is smaller than that guaranteed saving — so Option D comes out ahead overall in every realistic scenario, not just on average. `npm test` (169/169, 2 new tests). Not verified in a live browser. Done 2026-07-21 (v1.47.3). (`src/frontend/js-finance.js`, `test/finance-salary-calculator.test.js`)
- [x] **FIN19** — Added a "What the family would actually pay" table to the "is it worth it?" callout, per the user's follow-up ask — the prior version only showed abstract breakeven/delta dollar amounts, not the concrete out-of-pocket figure a family would actually see under each plan. New pure `finHealthPlanEffectiveLoneClaimantTermsCents()` (the deductible/OOP-max that actually applies to a lone claimant — a plan's own individual figures if embedded, its family figures if not) backs a 3-row comparison table (at the breakeven point if one exists, worst case spread across the family, worst case for one family member alone) showing Renewal's actual dollar figure side-by-side with the selected option's, for both the costlier (A/B) and cheaper (D) framings. `npm test` (169/169, extended existing tests to cover the new helper). Not verified in a live browser. Done 2026-07-21 (v1.47.4). (`src/frontend/js-finance.js`, `test/finance-salary-calculator.test.js`)
- [x] **FIN20** — Three Salary Calculator improvements plus a real UX bug fix, all requested together. (1) **Last year's actual pulled in**: the card now shows FY base-year actual (and budget, if set) across whichever real accounts match the salary/payroll/compensation guess-regex, as a reference figure next to this year's computed roster total — can't prefill the roster itself (no per-worker breakdown exists in the account data), but gives the comparison point the user asked for. (2) **Social Security COLA option**: `finLcmsBaseSalaryCents()` gained an optional `colaPct` param — when the target year has no published district base salary yet, it now compounds the most recent known year's base forward at an admin-entered COLA % instead of always freezing flat; omitting it (or 0) preserves the exact prior flat-fallback behavior, so nothing changed for anyone not using the new field. (3) **FICA shown as compensation, both directions**: self-employed (SECA) workers' row now also shows the hypothetical employer-FICA amount they're personally paying instead (labeled "not a church cost, for reference"), and non-self-employed workers' employer-FICA cell is now labeled "compensation benefit" — making explicit, per the user's ask, that the church's FICA payment is value an employee receives that a self-employed coworker doesn't, and vice versa. New `finSalaryComputeAll()` centralizes the per-worker calc (salary + real employer FICA + hypothetical FICA) so the roster rows, footer totals, and Apply-to-Plan button all read from one source instead of three duplicated reduce() calls. (4) **Bug fix**: every keystroke in a roster text/number field (name, years experience, benefits, COLA %) fully rebuilt the Planning card's innerHTML on every `oninput`, which destroyed and recreated the focused input — losing keyboard focus and, since nothing recaptured it, resetting the whole page's scroll position to the top on every character typed. New `finRerenderPlanningPreserveFocus()` captures the focused element's id, cursor/selection position, and scroll position (both `window.scrollY` and `.content-area`'s own scrollTop) before re-rendering and restores all three after; every Salary Calculator and Health Insurance handler that used to call `finRenderPlanning()` directly now calls this wrapper instead, and the roster's Name/Years-Experience inputs gained stable `id`s so they can be found again post-render. `npm test` (171/171, 2 new COLA tests). Not verified in a live browser — the focus/scroll bug fix in particular needs a real browser check to confirm the `document.activeElement`/`setSelectionRange` restoration behaves as expected; the underlying pure-function changes (COLA growth math) are fully covered by tests. Done 2026-07-21 (v1.48.0). (`src/frontend/js-finance.js`, `test/finance-salary-calculator.test.js`)
- [x] **FIN21** — Three follow-ups on FIN20. (1) **COLA became a 3-option picker** instead of one free-text field, per the user's explicit ask ("give several choices and we select one to use"): a "Base Salary Growth Method" dropdown offers **LCMS District Historical Average** (new pure `finLcmsHistoricalAvgGrowthPct()` — a real CAGR computed directly from `LCMS_MO_BASE_SALARY_BY_YEAR` itself, 2016→2027, ~2.35%/yr, so it never needs separate updating when the table grows), **Social Security COLA** (new `SSA_COLA_REFERENCE_PCT` = 2.8%, the last officially announced rate for 2026 — the SSA doesn't announce a given year's COLA until each October, so this needs a manual bump once the 2027 figure is announced; commented with the projected 3.7-3.8% range as of this writing), and **Custom / Concordia Plans figure** (free-text, since Concordia's own tool gives a congregation-specific number with no single value to hardcode) — plus "None (flat, default)" preserving the original behavior. Picking a preset fills the adjacent %-used number field, which stays freely editable (editing it directly flips the selector to "Custom"). (2) **Pension Contribution %**: added a new employer-cost line, structurally identical to FICA (new pure `finComputePensionCents()`, a straight % of salary) but always admin-entered — the LCMS guidelines PDF confirms the Concordia Retirement Plan pension is "based on a percentage of reported salary" without stating the rate, since Concordia sets it annually. New "Pension" column in the roster table, added into the footer total and the "Total Salary & Benefits" stat. (3) **Health Insurance last-year pull-in**: the Health Insurance card gained the same "FY{base year} actual across matching accounts" reference line the Salary Calculator got in FIN20, using the card's existing health/insurance/medical/benefit account-matching regex. `npm test` (174/174, 5 new tests including a hand-verified CAGR check and a sanity bound on the COLA constant). Not verified in a live browser. Done 2026-07-21 (v1.49.0). (`src/frontend/js-finance.js`, `test/finance-salary-calculator.test.js`)
- [ ] **FIN27 — Finance Workspace redesign (in progress, phased)**. A design handoff (5-tab prototype: Overview/Church Report/Property/Planning/Compensation) was scoped with the user before implementation since it visibly conflicted with real logic already built here: the mockup's Compensation math is generic/invented (a flat district-guideline formula, 3 flat-price health tiers) where this app already has the real LCMS Missouri District salary tables + real Concordia pension/disability/health-quote breakeven math (FIN15-22) — **decision: restyle only, keep all real math, no regression**. The mockup's Overview also had a giving-fund `<select>` that doesn't map to anything real (Church Report data is one QuickBooks ledger, not fund-split) — **resolved into a Church Operating / Daycare / Commercial Property domain switcher** per the user's own suggestion, not a fund. Church Report and Property restyle to keep every existing sub-view (multi-year, balance sheet, reserves, capital ledger, valuation calculator, forecast, etc.) — visual restyle only, nothing existing removed. Compensation will eventually split out of Planning into its own tab (user's preference, matching the mockup's 5-tab structure) once its turn comes.
  - **Phase 1 done 2026-07-22 (v1.56.0)**: Overview tab rebuilt — KPI cards, click-to-drill "Are we on budget?" pace panel, income-vs-expense trend chart, year-end projection, balances row, all above the existing (untouched, just relocated) QuickBooks Connection/Board Packet/Daycare Sync operational cards. New backend `computeIncomeExpenseMonthlyTrend()`. New **AHRA "Budget Detail" property-budget import** (a real file the user provided, genuinely different export shape from every QuickBooks import already handled) — new `finance_property_budget_monthly` table + `POST /admin/api/finance/property/ivanhoe/budget-import`, feeding a Revenue vs. Budget vs. Expenses vs. Budget 4-series chart in both the Overview and (once Phase 3 restyles it) the Property tab. See NOTES.md for full detail including the token-audit finding that 6 of the handoff's ~12 net-new hex values were already exact matches for existing brand tokens.
  - **Phase 2 done 2026-07-22 (v1.57.0)**: Church Report visual restyle — KPI cards, cream table header band, sign-aware variance mini-bars, and a navy "Net Income" footer bar replacing the old table row. All sub-views preserved (This Year/Multi-Year/Balance Sheet toggle, Supplies chart, YoY block, pie charts, Board Packet, imports) — restyle only, no behavior change. See NOTES.md for full detail.
  - **Phase 3 done 2026-07-22 (v1.58.0)**: Property tab restyle — shared KPI grid (Occupancy/Monthly Net/Annual Net/Reserves On-Hand, same source as the Overview's Property domain), the existing Valuation/Equity stats kept as a secondary row, a new "Available for Distribution" navy bar (annual net minus this year's reserve contributions and capital spend, explicitly an estimate distinct from the actual Distributions-to-Church record), and a small on-hand-vs-target progress bar on the Property Tax Reserve section. All existing sub-views (reserves table, capital ledger, repairs log, valuation calculator, forecast, insurance allocation) preserved. See NOTES.md for full detail.
  - **Phase 4 done 2026-07-22 (v1.59.0)**: Planning tab restyle — cream-header budget builder table with a new Δ% column, editable Plan input restyled, a "Projected Net" navy card, and a new Three-Year Outlook bar chart (income +2.5%/yr, expenses +3%/yr beyond the target year, per the handoff's own stated assumption). Generate/Save/Commit logic unchanged. Salary Calculator/Health Insurance stay as-is for now — they move into their own tab in Phase 5. See NOTES.md for full detail.
  - **Phase 5 done 2026-07-22 (v1.60.0) — FIN27 complete.** Compensation split out of Planning into its own sub-nav tab (new `fin-panel-compensation`); Salary Calculator and Health Insurance restyled into `.fin-card` containers with real LCMS/Concordia math unchanged (confirmed — `test/finance-salary-calculator.test.js`, which unit-tests the underlying pure functions directly, needed zero changes). New manual "Concordia Decision Support estimate" reference block per worker (collapsible, 4 ranges × Low/Mid/High + metadata, persisted via the existing roster save) from the user's real Concordia Compensation Decision Support Tool PDF for Rev. Dinger — confirms the $103,609 LCMS midpoint FIN15 already used narratively. The mockup's separate generic "District Guideline Calculator" tool was deliberately not built as a parallel redundant calculator — the real system already computes this per roster row with real data; see NOTES.md for the full reasoning. RD1/RD2/RD4 (app-wide palette consolidation) remain separately queued.
- [x] **FIN57 — Finance Workspace v3: the tab answers "how are we doing?" (2026-08-06).** Implemented
  the `design_handoff_finance_workspace` bundle ("Finance overview framing") — six screens.
  **Compensation was explicitly out of scope and is byte-for-byte untouched** (verified: its panel
  markup is an identical string and all 126 `finComp*`/salary/Concordia/health-plan functions are
  unchanged). Nav becomes Financial Health · Church · Daycare · Property · Planning · Compensation │
  **Data & Imports**; `_finActiveNavId` defaults to `health` and a stale `overview` redirects there.
  **Financial Health** (new, replaces Overview) reads the money by *who controls it*: mix bar +
  control band, three stream cards, a flow diagram recomputed from real figures, three entity cards
  naming what the board decides about each, giving-vs-budget pace, a cash runway against an
  admin-set floor, five years of the mix, an appeal card with scope pills and an ask ladder, lever
  cards, decisions. **Church Report** gets mode pills, reconciling variance arithmetic, revenue bars
  instead of a pie, a variance-sorted top-five expense panel, and a **zero-baseline five-year net
  income chart** (`renderGroupedBarChart` draws a deficit as an invisible sliver — its own comments
  say so — and that is the year a board needs to see); **its seven import buttons moved to Data &
  Imports**, functions untouched. **Property** leads with the AHRA cash-minus-reserves hero and a
  does-it-fund-itself P&L, collapses three ledger strips, and now contains no file input at all.
  **Planning** gains a navy strip ending in *Revenue needed to balance* and the handoff's five-year
  line chart (expenses at 3% vs. flat revenue). **Data & Imports** (new) shows a **last-import date
  per importer** — staleness visible without opening a report. **Daycare** is built for room-level
  data but **degrades honestly**: the daycare app publishes no per-room endpoint yet, so it falls
  back to the category table and says so, rather than drifting into a blanket "we are full."
  New server work: `computeRevenueStreams` (config-driven, admin-editable, **unrecognised groups
  default to `earned` not `donor`** — overstating donor revenue overstates the board's own leverage,
  the one claim the page exists to make honestly — with every guess surfaced in `unmapped`),
  restricted/unrestricted split reusing `funds.category`, `computeMoneyFlow`, `computeCashRunway`,
  `computeRoomOccupancy`, `finance_import_log` + `recordImport()` in all ten importers, migration
  `0034`. `npm test` (834/834, 28 new); **every new test verified non-vacuous** by injecting the
  exact regression it guards (five injections, five correct failures). Plus a `vm` harness running
  all eighteen render paths incl. every degraded state, tag-balance on all seven views, and a
  div-balance scan of the assembled `CHMS_HTML`. **Not verified**: a live browser or real D1.
  **Two follow-ups for an admin**: set `DAYCARE_ROOMS_API_URL` once that endpoint exists, and walk
  **Data & Imports → Classification & policy** once to confirm the revenue-stream mapping and the
  reserve policy floor — the Health page's headline rests on both. (`migrations/0034_*`,
  `src/api-finance.js`, `src/daycare.js`, `src/db.js`, `src/frontend/{html-head,html-tabs,js-core,js-finance}.js`,
  `test/finance-health.test.js`, `test/finance-planning-outlook.test.js`)
- [x] **FIN28** — Follow-up on the redesign: (1) direct-editable MDO budget fields, and (2) Utilities/Insurance daycare lines computed live from a percentage of the church side's actual expense (user confirmed: 50%/50%, live-recalculated every time, against the church's full Utilities/Insurance actuals). New `computeChurchCategoryActualCents()`/`computeMdoUtilityInsuranceAllocation()` (`api-finance.js`, matches on `category_path` since real postings live on leaf accounts like "Electric"/"Gas" that don't contain the word "Utilities" themselves) back a new `GET finance/daycare/allocation` (live) + `GET`/`PUT finance/daycare/allocation-config` (the editable percentages, default 50/50). **v1.61.0's first cut at part (1) was wrong** — a whole-year Actual+Budget entry form — and was replaced same-day (v1.61.1) after the user clarified with a screenshot: Actual should always come from the existing "Import from Church Budget (MDO accounts)" tool, never be hand-typed; only a past year's **Budget** needed direct editing, cell by cell, right in the existing Daycare Report table. New `POST finance/daycare/budget-override` (admin, one cell at a time, source `manual_budget_override`) replaces (not adds to) whatever budget a church import may already have brought in for that same cell — required an aggregation-precedence fix in `finAggregateDaycareByYear()` so the two sources can't silently sum together. **Follow-up (v1.62.1):** asked where the numbers actually come from — turned out Actual/Budget were a blind sum across `church_budget_import` + `daycare_api` (app sync) + one-off `manual` rows, real double-count risk. User's decision: church import only. `finAggregateDaycareByYear()` now excludes `daycare_api`/`manual` from every total (new `FIN_DAYCARE_COUNTED_SOURCES` allowlist); a new warning banner (`finDaycareOtherSourceTotals()`) surfaces any excluded-source data still sitting around per year rather than silently hiding it. Done 2026-07-23 (v1.62.1). See NOTES.md for full detail. (`src/api-finance.js`, `src/frontend/js-finance.js`)
- [x] **FIN40** — Follow-up on FIN25's scenario comparison table: reported that (1) "None (flat)" was actually pulling in next year's already-published district figure instead of staying flat off the current year — a real "no raise" outcome wasn't representable; (2) the district base salary and LCMS "average" growth figures needed to be a live, editable entry (the district hands over a new paper each year — it's not a formula), while the role/track/stipend/attendance multiplier tables were confirmed by the user to stay fixed year to year and don't need the same treatment; (3) "Use this" under any scenario visibly did nothing. Root cause of (3), confirmed the same root cause as (1): `finRenderSalaryScenarioComparison()` always computed every scenario column against `_finPlanTargetYear`, so once that year had a published base figure, all 4 columns were mathematically identical by construction — "Use this" toggled internal state but there was nothing different to switch to. Fixed together: new `finSalaryScenarioYear()` — "None" resolves against the *base* year (a real no-raise option), every other scenario against the *target* year — and `finLcmsBaseSalaryCents()` now takes an optional `referenceByYear` map, checked before falling back to the historical hardcoded table (which stays intact for old years). New "District Reference Data" editor (base salary + a new Health Insurance opt-out cash figure, both per fiscal year) persists into the existing salary-planner JSON blob (`_finSalaryReferenceByYear`, via the existing `finance/planning/salary` PUT endpoint — no migration needed). Also built the requested per-worker **Total Compensation** breakdown (new section table: Cash Salary / Pension / Health Insurance (or opt-out cash) / Disability / Employer FICA / Total Compensation), with a new "Health Plan" enrolled/opt-out checkbox per roster row; Apply-to-Plan and the "Total Salary & Benefits" stat tile now sum from this total instead of a formula that never included health insurance at all. Verified end-to-end with a harness reproducing the real bug (all 3 scenarios identical with no reference data entered) and the fix (None diverges from LCMS/SSA once scenario-year separation is in place; entering FY2026/FY2027 district figures via the new editor correctly overrides the hardcoded table for both years). `npm test` (187/187), `node --check` on both built app-JS bundles. Not verified in a live browser. Done 2026-07-27 (v1.87.0). (`src/frontend/js-finance.js`)
- [x] **FIN43** — Correction to FIN41's $5 rounding: the user clarified the intended formula was per-pay-period, not per-year — divide the annual salary by the pay period count (26, biweekly), round THAT figure to the nearest $5, then multiply back by 26, so the annual salary is always an exact whole multiple of a clean per-period paycheck. `finRoundSalaryCents()` rewritten accordingly (new `FIN_SALARY_PAY_PERIODS = 26` constant); previously it rounded the annual figure directly, which left the per-period amount just as uneven as before (the original complaint). Verified against the actual served (built) script: every seeded worker's per-period paycheck now lands on an exact $5 multiple and `perPeriod * 26` reconciles exactly to the annual figure with zero leftover cents. `npm test` (421/421, no test changes needed — `finComputeLcmsSalary` itself is untouched). Not verified in a live browser. Done 2026-07-27 (v1.115.2). (`src/frontend/js-finance.js`)
- [x] **FIN41** — Two follow-ups on the Compensation tab, reported after further use. (1) **A single "bottom line" total was missing** — the user wanted one number capturing what all the Compensation decisions (salary growth scenario, pension %, health plan choice) add up to, against last year's real spend. New `finRenderCompensationBottomLine()`, rendered after both cards: sums `finSalaryComputeAll()`'s per-worker `totalCompCents` (already includes salary + FICA + pension + disability + health, so no double-counting against the Health Insurance card's own total) plus Other Benefits, and compares it to FY{base}'s real actual across the same matching salary + health accounts — shown as a navy "Net Change to Budget" card (red for an increase, green for a decrease, matching the existing Projected Net card's color convention). (2) **Computed salaries didn't divide evenly into pay periods** (e.g. $104,308.38 → $4,011.86/period × 26 ≠ the annual figure, off by a few cents) — per the user's explicit preference, round to the nearest $5 instead of chasing exact per-period division. New `finRoundSalaryCents()` rounds to the nearest 500 cents, applied in `finSalaryComputeAll()` (feeding the roster table, FICA/pension/disability, Total Compensation, and the new bottom line) and in the scenario comparison table — but deliberately NOT inside `finComputeLcmsSalary()` itself, since that function's exactness is what the FIN15 tests reconcile against the LCMS guideline PDF's own worked examples; rounding only touches the "real compensation" computation path, not the pure formula. Verified with a harness against the actual served (built) script: all three seeded workers' computed salaries land on exact $5 multiples (`% 500 === 0`), and Dinger's reported $104,308.38 now rounds to a clean $104,310. `npm test` (290/290, no test changes needed — the PDF-reconciliation tests call `finComputeLcmsSalary` directly, untouched by the rounding). Not verified in a live browser. Done 2026-07-27 (v1.92.0). (`src/frontend/js-finance.js`)
- [x] **FIN42** — Three follow-ups on FIN40, reported after first use. (1) **District Reference Data inputs unusable while typing**: the base-salary/opt-out-cash `<input>`s reformatted their own value to `.toFixed(2)` on every keystroke (the whole card re-renders on every `oninput`), so after the first digit the field snapped to "X.00" and every further digit landed inside an already-reformatted string instead of being appended — scrambling multi-digit amounts and silently dropping any cents typed. Fixed by displaying the raw number (no forced 2-decimal formatting) while editing, matching the pre-existing Benefits Total field's pattern, which never had this problem. (2) **Health Insurance's "FY{year} actual across matching accounts" reference line showed an implausible $106,700 budget** — traced to the account-matching regex (`/health|insurance|medical|benefit/i`) matching a bare "52040 Insurance" account, almost certainly general property/liability coverage, not employee health insurance, purely because it contains the generic word "insurance". Tightened to `/health|medical|dental|vision|disability/i` (drops the standalone "insurance"/"benefit" terms) — still correctly matches "59035 Health Insurance" and "59016 Disability & Accident Insurance", no longer pulls in the unrelated general Insurance account. (3) **Reframed the "Is it worth it?" breakeven analysis** from a church-budget question to a worker's-own-decision question, per the user's clarification: the church only fully covers Renewal (Option C) — a worker who wants a costlier or cheaper option pays/keeps the premium difference themselves (e.g. via payroll deduction), so the copy throughout now says "is it worth it for the worker" instead of framing it as the church's cost/benefit call. The underlying breakeven math (`finComputeHealthPlanFamilyBreakevenCents` et al.) was already computed at the per-household-premium-difference level and needed no changes — a premium difference is a premium difference regardless of who pays it, only the narrative copy changed. **Noted for later, not built now** (explicitly framed by the user as a future idea, not an immediate ask): making `HEALTH_PLAN_QUOTE_2027`'s per-plan Medical/Dental/Vision premium figures editable data (like the salary base-salary fix) instead of hardcoded, since the plan structure/options recur every year with just updated numbers. `npm test` (268/268, no test changes — only UI-layer formatting/copy and one regex changed), `node --check` on both built app-JS bundles, a harness confirming the tightened regex excludes "52040 Insurance" while still matching the two real health/disability accounts, and a harness confirming the un-reformatted input value round-trips through repeated keystrokes without corruption. Not verified in a live browser. Done 2026-07-27 (v1.87.1). (`src/frontend/js-finance.js`)
- [x] **FIN26** — Reported "the auto populated budget doesn't seem to work" (Church Budget Planning's "Generate All" — no numbers appeared at all). Root cause: the Growth Assumption % input only had a **placeholder** of "3", not a real `value` — leaving the field untouched (the field looked filled-in since the placeholder text is visually similar to a real value) meant the field was actually empty, so `finPlanGenerateAll()` silently bailed out with `isFinite(NaN)` false and never called the server at all, showing only a small gray "Enter a growth % first." line easy to miss under the buttons — exactly matching "no numbers show." Fixed: the input now has a real default `value="3"` so leaving it as-is actually sends 3%; both the abort message and the success/error outcome are now also shown via `finToast()` (the floating toast used elsewhere in Finance) since the plain `#fin-plan-msg` line lives inside `#fin-plan-root`, which `finLoadPlanning()` immediately blanks to "Loading…" right after a successful generate — so a same-element text update could flash and vanish before being seen. Also fixed the "Generate All (fills every blank line)" button label, which was inaccurate — it actually overwrites every account's Projected value unconditionally (confirmed via a backend+frontend integration harness reproducing the real category-path matching end-to-end, which showed the underlying generate/match mechanism itself works correctly) — relabeled to "overwrites every Projected value below" so it no longer promises blank-only behavior it doesn't have. `npm test` (187/187, no test changes — only the UI-layer strings/defaults changed), `node --check` on both built app-JS bundles. Not verified in a live browser. Done 2026-07-22 (v1.55.2). (`src/frontend/js-finance.js`)
- [x] **FIN25** — Reported "when I select different options/scenarios for salary recommendations I don't see the values changing." Root cause: the Salary Calculator's "Base Salary Growth Method" dropdown only ever affects `finLcmsBaseSalaryCents()` when the target year has no published LCMS base salary yet — but the Planning tab's target year defaults to base year + 1, which right now is FY2027, and `LCMS_MO_BASE_SALARY_BY_YEAR` already has a published, exact rate for 2027 ($51,529). So the dropdown was silently inert for the one year most people would actually be looking at — not a bug in the math (confirmed correct — a published year should ignore a growth guess), just a UI that gave no sign the control had no effect. Per the user's own suggested fix, replaced the single dropdown + "% used" input with an always-visible **per-worker scenario comparison table** (`finRenderSalaryScenarioComparison()`): every worker's computed salary shown side by side under all 4 methods (None/flat, LCMS District Avg, SSA COLA, Custom), with a "Use this" link per column to make it the active scenario feeding the roster table, FICA/Pension math, the Total Salary & Benefits figure, and Apply-to-Plan. For a published year (FY2027 today) all 4 columns correctly show the identical number, with a caption explaining why; verified with a harness that FY2030 (past the published table) correctly diverges across columns ($86,053 flat vs. $92,270 LCMS avg vs. $93,486 SSA COLA). `npm test` (187/187, no test changes needed — only pure functions were under test), `node --check` on both built app-JS bundles. Not verified in a live browser. Done 2026-07-22 (v1.55.1). (`src/frontend/js-finance.js`)
- [x] **FIN22** — Real Concordia Plans Pension and Disability & Survivor rates, from the church's own uploaded "Overview of your Concordia Plans Participation" statement (as of July 2026) — corrects FIN20/FIN21's guess that Pension had no available real rate. New `CONCORDIA_PENSION_RATE_BY_YEAR` (Traditional Option: 10.70% for 2026, 11.70% for 2027) and `CONCORDIA_DISABILITY_RATE_BY_YEAR` (1.20% without dependents / 1.75% with dependents, same both years) — both real, by-year tables with the same flat-fallback-to-most-recent-year pattern as the LCMS base salary table (`finConcordiaPensionRateFor()`/`finConcordiaDisabilityRateFor()`). The Pension % field now defaults to the real looked-up rate for the target year instead of blank, while staying an editable override (with a "↺ use Concordia rate" reset link) since future years' rates aren't published yet. Disability & Survivor is a new employer-cost line entirely (previously missing) — its rate depends on a new per-worker "Has Dependents" checkbox, since the published rate itself depends on that status; corrects the user's clarification that Pension and Disability are two separate benefits, not one. Both apply to every salaried worker uniformly (not conditioned on FICA self-employment status, unlike the FICA/SECA split), per the user's explicit statement that "all salaried employees...get" both. `npm test` (179/179, 5 new tests using the real statement figures, including a cross-check against the Director of Parish Music's real $73,473.75 salary example from FIN16). Not verified in a live browser. Done 2026-07-21 (v1.50.0). (`src/frontend/js-finance.js`, `test/finance-salary-calculator.test.js`)
- [x] **FIN23** — Four Planning improvements requested together. (1) **Roster seeded with real staff**: Dinger/Knapp/Thompson pre-populate the Salary Calculator (once, only if nothing has ever been saved), each tied to their real payroll account code (58001/58002/58003) — a new Acct # column per row pulls in that specific account's FY base-year actual/budget as a reference (not just the aggregate salary-account total already shown below the table). (2) **Persistence**: new `GET`/`PUT /admin/api/finance/planning/salary`, storing the whole roster + COLA/pension settings + Health Insurance selection as one JSON blob in the existing `chms_config` key/value table (same pattern as the Commercial Property meta) — a new "Save Salary & Benefits Data" button writes it explicitly, matching this app's established no-silent-autosave convention; loaded once per page visit, not re-fetched on every base-year change. (3) **Projections now annualize a partial-year actual before growing it** — Generate All previously treated a mid-year actual as if it were the whole year's total; it now multiplies by 12/(months elapsed) first, only when the base year is the real current year and still in progress (a past, complete year is unaffected). Caught and fixed a real latent bug in the process: `finance_church_entries` mixes annual (period_month=0) and monthly (period_month 1-12) rows sharing the same source/fiscal_year, and 4 separate read queries (This Year, Multi-Year, Board Packet, and this new Generate-All base) were pulling both without filtering — silently vulnerable to a single month's figure clobbering the true annual total once monthly-granularity sync data exists for a year. All 4 now explicitly filter `period_month=0`. Also reordered `FIN_CHURCH_CLASS_ORDER` so Income/Other Income group together before Cost of Goods Sold/Expenses/Other Expenses (previously interleaved), needed for item 4. (4) **Group rows auto-sum their children, plus Total Revenue/Total Expenses subtotal rows**: a category like "42 Passive Income" is no longer independently typable — its FY+1 Projected cell is now always the live sum of its own leaf descendants, computed via a new `projectedCentsByPath` pass before rendering; a bolded "Total Revenue" row now sits right after the revenue section and "Total Expenses" right after the expense section (both summing Budget/Actual/Projected across their respective roots), with the existing bottom "Net" row unchanged. `npm test` (181/181, 2 new proration tests using an explicit `through_month` override param added specifically so tests aren't coupled to the real wall-clock date). Not verified in a live browser. Done 2026-07-22 (v1.51.0). (`src/frontend/js-finance.js`, `src/api-finance.js`, `test/finance-budget-plan.test.js`)
- [x] **FIN24** — First step of "connect supplies between myMDO and chms," scoped down from the user's original ask after two-repo investigation: childcare-portal's (myMDO) "Other Expenses" line is just a manually-typed number with no real Supplies breakdown anywhere, and there's no outward-facing CHMS endpoint an external app could pull from yet — building that full connection was decided to be a separate later step. This slice stays inside chms only, matching the user's "start with the visuals" scope-down: a new **Supplies by month** chart in Church Report's This Year view, styled after myMDO's own monthly bar+line dashboard visuals (grouped bars, This Year vs Last Year, teal/gold). New pure `computeSuppliesMonthlyBreakdown(currentMonthlyRows, priorMonthlyRows)` (`src/api-finance.js`) matches any account whose name contains "supplies" (case-insensitive — covers the real `50160 MDO Supplies`/`57160 MDO - Supplies` QuickBooks accounts already confirmed to exist per `classifyMdoAccountCategory`'s comment, which still deliberately lumps them into Other Expenses for the Daycare Report; this chart is presentation-only, doesn't change that classification or any totals) against the same period_month 1-12 `qbo_sync` monthly rows already fetched for the existing YTD-comparison feature — no new query. `GET /admin/api/finance/church/this-year` now also returns a `supplies` field; new `finRenderSuppliesChart()` (`src/frontend/js-finance.js`) reuses the existing `renderGroupedBarChart` SVG helper (this app hand-rolls charts, no Chart.js) and renders under the This-year-vs-last-year block, gracefully rendering nothing when there's no matching data for a year. `npm test` (187/187, 2 new tests using the real MDO account name fixtures). Verified the actual served (built) chart function end-to-end against mock data (correct bar count, correct YTD caption, empty-state fallback) and `node --check` on both built app-JS bundles. Not verified in a live browser. Full cross-repo connection (a new CHMS outward API endpoint + childcare-portal pulling it into its own dashboard) intentionally deferred — flagged to revisit if wanted. Done 2026-07-22 (v1.53.0). (`src/api-finance.js`, `src/frontend/js-finance.js`, `test/finance-church.test.js`)
- [x] **FIN29** — June 2026 AHRA property management report ingested for 3277 Ivanhoe, delivered as a structured extract (`report_summary.md` + `monthly_financials_row.csv` + `extract.json`). New marker-gated `seedIvanhoePropertyJune2026(db)`: (1) appends the June monthly-financials row (`total_expenses_cents` combines operating + non-operating so revenue minus expenses reconciles exactly to the source's own net income, $9,765.27 − $4,462.48 = $5,302.79); (2) appends the next property-tax-reserve-schedule row, keyed `2026-07` per the source's own stated `report_month` (this report computes July's contribution off June's data) — recalculated as the remaining $6,650.00 gap spread over 6 months ($1,108.33/mo) rather than the flat $950/mo used earlier in the year, with a note that no distinct June contribution appears anywhere in the source (the $4,750.00 "before" balance is unchanged from April/May, the same carryover gap already flagged on the 2026-05 row); (3) records the source's own flagged data-quality items (security-deposit ledger not tying to the GL by $475 with an unexplained "Daniel Pica" refund, Magnatone's lease showing expired but tenant still current, 2 open plumbing work orders) as a new `meta.open_items_2026_06` array — documentation only, not yet rendered in the UI, matching how `insurance.correction_log`/`insurance.open_items` are already handled. Mortgage balance deliberately untouched — already correct ($279,691.13) per FIN9; this report's own $100,785.68 MRI-migration figure is explicitly not used, per the source's own flag. No frontend changes needed (the existing Commercial Property tab already renders whatever's in `finance_property_monthly`). `npm test` (185/185, no regressions — consistent with prior Ivanhoe seed functions, which also aren't unit-tested directly, only reconciled by hand in comments). Done 2026-07-23. (`src/db.js`)
- [x] **FIN30** — Follow-up on the June 2026 Ivanhoe report, per Andrew's own read of the flagged items. (1) **Mortgage confusion resolved with an exact reconciliation, not just relabeled as an artifact**: the AHRA/MRI "Mortgage Payable One" GL account genuinely does grow every month, and Andrew's theory (it's tracking cumulative payments, not the live balance) checks out exactly — June's $2,830.98 period debit matches, dollar for dollar, that month's real principal payment derived straight from the source ($3,783.03 loan payment − $952.05 interest = $2,830.98). Recorded as `meta.loan.principal_payment_history` for the audit trail; the confirmed $279,691.13 running balance (as of 2026-07-20) is untouched, since it already postdates June's payment. (2) **Daniel Pica note corrected**: per Andrew, a former tenant who moved out and may not have gotten his full security deposit back — explains both the $475 ledger/GL gap and why he doesn't appear elsewhere in the report. (3) **New "Amount Dispersed" card**: this calendar year's actual confirmed distributions (from the existing Distributions-to-Church record) now show right alongside the "Available for Distribution" estimate, via new pure `finComputeDistributedThisYear()`. (4) Relabeled the "Mortgage Balance" stat to "Mortgage Remaining" (with its as-of date) to match Andrew's own terminology — the "Available for Distribution," "Reserves On-Hand," and mortgage stats he asked for as "big cards" already existed from FIN27's KPI grid; this was the one genuinely missing piece. `npm test` (236/236, 2 new tests for the distributed-this-year helper). Not verified in a live browser. Done 2026-07-23. (`src/db.js`, `src/frontend/js-finance.js`, `test/finance-property-distribution.test.js`)
- [x] **FIN31** — Wired up the automatic mortgage-balance rollforward flagged as a follow-up in FIN30. New `loan_payment_cents`/`interest_expense_cents` columns on `finance_property_monthly` (migration `0026`) — the two real per-month figures (bank rec loan payment, income statement interest expense) needed to derive that month's actual principal paid, exposed as two new optional fields in the existing "+ Add Month" / Edit modal. New pure `finComputeMortgageRemainingCents(loan, monthly)`: starting from the last lender-CONFIRMED balance + its as-of date, subtracts principal (loan payment − interest expense) for every subsequent month that has both figures filled in, applied in chronological order — a month at or before the confirmed date is left alone (already reflected in the anchor), exactly matching the reasoning already established for June 2026 in FIN30. The "Mortgage Remaining"/Equity/Loan-to-Value stat cards now compute from this rolled-forward figure instead of the static `loan.balance_cents`, with a small caption naming which months were applied — so a fresh lender confirmation is no longer needed every time a new AHRA report comes in; filling in the two new fields on each new month is enough. June 2026's own report data backfilled the two new columns automatically (before/after this feature, its own payment stays correctly excluded from the rollforward since it predates the anchor date). `npm test` (241/241, 5 new tests including an exact reproduction of the June reconciliation and a multi-month chronological-order check). Not verified in a live browser. Done 2026-07-23. (`migrations/0026_finance_property_loan_payments.sql`, `src/db.js`, `src/api-finance.js`, `src/frontend/js-finance.js`, `src/frontend/html-tabs.js`, `test/finance-property.test.js`, `test/finance-property-distribution.test.js`)
- [x] **FIN7** — Daycare Sync: derive historical daycare (MDO) financial data from an already-imported Church Budget year, instead of hand-entering it. New name-pattern matcher (`/mdo|mother'?s day out/i` against account name/path — account numbering for MDO accounts is inconsistent even within one real file, so text matching is the only robust approach) classifies matched accounts into the Daycare Report's existing categories and imports them as `finance_daycare_entries` rows (`source:'church_budget_import'`, wholesale-replaced per year on re-import). New "Import from Church Budget (MDO accounts)" preview/import UI in the Overview tab's Daycare Sync card. Done 2026-07-19 (v1.36.0) — see NOTES.md for full detail. (`src/api-finance.js`, `src/frontend/js-finance.js`, `src/frontend/html-tabs.js`)
- [x] **FIN36** — One-time historical actuals upload + per-fiscal-year QuickBooks actuals sync, requested to route around the Budget vs. Actuals report/import saga (FIN2/FIN6/FIN27/FIN32/FIN33) entirely: "never upload the budget, that part is broken... just upload the activity" and "sync from QuickBooks Statement of Activity for periods I designate, not budgets." Built in parallel with another session that independently shipped the multi-year "Statement of Activity" import (`findActivityMultiYearSheet`/`parseActivityMultiYearGrid`/`persistChurchEntriesActivityImport`, source `'import_activity'`, `CHURCH_SOURCE_PRIORITY = ['qbo_sync', 'import', 'import_activity', 'plan_committed']`) plus a companion multi-year "Statement of Financial Position" (Balance Sheet) import — reconciled on merge rather than duplicated: kept that session's naming/routes/UI (already wired end-to-end, and its Balance Sheet counterpart was a superset this session never attempted), and layered this session's real, verified contributions on top. **Bug found and fixed in the already-merged parser**: `parseActivityMultiYearGrid` detected row depth via leading-space indentation only (`indentDepthOf`) — but two real Statement of Activity exports from this exact church confirmed the report carries **no leading-space indentation at all**, only cell-indent style metadata, so every real-file row read as depth 0 and the entire import silently stored zero rows (confirmed by running the pre-fix code directly against both real uploaded files — 179 rows, 0 imported). Fixed by switching to `balanceRowDepth()`/`nextNonBlankRowIndex()` (colAIndent-aware, leading-space-first with a style-indent fallback) — the same convention `parseBalanceSheetGrid` already established for exactly this situation; `parseActivityMultiYearGrid` now takes an optional `colAIndent` param and the route passes `sheet.colAIndent` through. `parseYearColTitle` extended to also recognize a trailing partial year-to-date **range** column (e.g. "Jan 1 - Jul 1 2026", present in the real file) — deliberately requires a date-range dash before the year so it can never be confused with a Monthly P&L column title ("Jan 2026"). **Two more real bugs found and fixed** (pre-existing, not specific to the multi-year import — affect every Church Report import path): (1) `IMPORT_SKIP_LABEL_RE` never matched "Net Other Revenue" (only had "Net Other Income" and "Net (Income|Revenue)", never their cross product) — collapsed to `Net (Operating |Other )?(Income|Revenue)`. (2) `CHURCH_CLASSIFICATION_SYNONYMS` had `'other expenditures'` but no `'other revenue'` entry — silently left this church's real "Other Revenue" section un-normalized, dropping it out of `netOtherIncome`/`netIncome` entirely (confirmed: 2021's Net Other Revenue read as −$478,540.14, the Other Expenses figure alone with Other Revenue never added in, instead of the correct −$123,736.37). **New, net-new feature**: `finance/qb/sync-years` (admin, POST `{fiscal_years:[...]}`) is a narrower sibling of the existing `finance/qb/sync` — one `profitAndLoss()` call per user-picked year (a fiscal-year checkbox picker, "Sync Selected Years (Actuals Only)…", on the Overview tab's QuickBooks Connection card), no Budget entity, no native `BudgetVsActuals` report call, no `finance_qb_snapshot` writes — sidesteps the permanently-unsupported report endpoint entirely rather than working around it. New `makeSingleYearActualExtractor()` (2-column plain P&L shape, budget always null) backs it; reuses the unchanged `persistChurchEntries()` (already scoped per-year, so unselected years are untouched). **Verification**: ran the fixed parser end-to-end against both real uploaded files (`Statement_of_Activity_1.xlsx`, a single lifetime-total export found not usable for this feature — no per-year breakdown — and `Statement_of_Activity_3.xlsx`, the real per-year-column export) — every one of the 8 years' Income/Expenses/Net Operating/Other Income/Other Expenses/Net Income totals reconciled exactly to the penny against the source file's own printed subtotals, both before persisting and after a full persist+`resolveChurchYearPrecedence`+`computeYearSummary` round-trip through real SQLite; new regression tests reproduce this exact fixture (colAIndent, no leading spaces) so the depth-detection bug can't silently regress. `npm test` (399/399), `node --check` on both built app-JS bundles. Not verified in a live browser or against a live QuickBooks connection (the sync-years route itself). Done 2026-07-28 (v1.111.0). (`src/api-finance.js`, `src/frontend/js-finance.js`, `src/frontend/html-tabs.js`, `test/finance-church.test.js`)
- [x] **FIN37** — Continuation of FIN36, built in the same window by a parallel session working
  directly against the three real uploaded files (`Timothy_Statement_of_Activity_RESTRUCTURED_2.xlsx`,
  `Timothy_Budget_by_Year_2.xlsx`, `Timothy_Statement_of_Financial_Position_by_Year.xlsx`) — merged
  together rather than duplicated: FIN36's `balanceRowDepth`/`parseYearColTitle`/classification-
  synonym fixes were kept as the base, with this session's additional real-file findings layered on
  top. (1) **Critical, app-wide bug**: `finXlsxFindSheetPath()` always prepended `'xl/'` to a
  sheet's rels Target, but the real Statement of Activity file uses an absolute zip-rooted Target
  (`/xl/worksheets/sheet1.xml`), producing an unresolvable double-prefixed path and silently
  returning `grid: null` with no error — affects every importer in the app, not just these. Fixed:
  `target.startsWith('/') ? target.slice(1) : 'xl/' + target`. (2) Both real files carry a trailing
  free-text commentary section ("NOTES ON THIS RESTRUCTURING…"/"NOTES ON THIS BUDGET DOCUMENT…",
  indented like real accounts) that would otherwise be misread as line items — new `NOTES_SECTION_RE`
  sentinel stops the parse loop outright the moment it's hit. (3) **Budget by Year is a genuinely
  separate file from Statement of Activity** (Actual-only vs. Budget-only, confirmed against the
  real files, not one combined shape) — `persistChurchEntriesActivityImport()` rewritten from
  delete-then-insert to a field-preserving UPSERT (`CASE WHEN ?=1 THEN excluded... ELSE
  finance_church_entries...`/`COALESCE`) so the two merge into one row per account/year regardless
  of upload order, verified both orders; new shared `parseIncomeStatementMultiYearGrid(grid,
  colAIndent, field)` backs both `parseActivityMultiYearGrid`/`parseBudgetMultiYearGrid`; new
  routes `finance/church/budget-multi-year-import-preview`/`budget-multi-year-import`; new "Import
  Budget by Year (multi-year)" button/modal. (4) Statement of Financial Position now reconciles
  exactly (Assets = Liabilities + Equity, $0.00 diff) for all 8 real years. (5) **Drag-and-drop**
  added to all 6 Church Report import modals, per explicit request — new shared
  `finDropZoneOver()`/`finDropZoneLeave()`/`finDropZoneDrop()` helpers assign the dropped
  `DataTransfer`'s `FileList` onto the existing `<input>`'s `.files` and dispatch a real `change`
  event, so drag-and-drop runs through the exact same `*FileSelected()` handler as click-to-browse.
  Other upload flows elsewhere in the app (photos, letterhead logo, giving/register CSV, Tuition
  Aid) use a different hidden-input-behind-a-button pattern and weren't touched — flag if wanted
  there too. `npm test` (397/397), `node --check` on `api-finance.js` and both built app-JS
  bundles, full div-balance scan of the built `CHMS_HTML`, and — verified directly against the real
  uploaded file bytes via a Node harness importing the actual served parser functions (not just
  synthetic fixtures) — all three files parse completely, with known real dollar figures (e.g.
  Sunday Offering) matching previously-observed live app data. Not verified in a live browser. Done
  2026-07-28 (v1.112.0). See NOTES.md for full detail. (`src/api-finance.js`,
  `src/frontend/js-finance.js`, `src/frontend/html-tabs.js`, `src/frontend/html-head.js`,
  `test/finance-church.test.js`, `test/finance-property.test.js`)
- [x] **FIN39** — Follow-up on FIN38, same day: walked through the numbers year-by-year with
  Pastor Dinger and found the original spec's Section 3b ("Purpose/Time Restricted" — 12019
  Thrivent-Bequests, 12020 Edward Jones, 12021 Reserve for Caring Ministry) was wrong — those
  three are NOT donor-restricted. The real restricted-accounts list is exactly the endowment six
  (12010/11/12/13/14/15) + the unchanged "25000 Funds" designated list. Moved 12019/12020/12021
  into `EQUITY_RECLASS_IGNORE_CODES` (confirmed-not-restricted, not "needs review") alongside
  12016/17/18 (already excluded pending review) — the `purpose_time` bucket is now empty.
  **Verified against the real reference workbook**: the corrected 2019 split ($401,449.78 Donor-
  Restricted / $439,786.11 Without Donor Restrictions) matches Pastor Dinger's own hand-computed
  figure ($146,354.75 + $255,095.03) to the penny, for every one of the 8 real years. `npm test`
  (421/421, rewrote `test/finance-equity-reclass.test.js`'s fixture to match the real row set and
  added a direct regression for the corrected split), `node --check` on `api-finance.js` and both
  built app-JS bundles. Not verified in a live browser. Done 2026-07-29 (v1.114.0). See NOTES.md
  for full detail. (`src/api-finance.js`, `test/finance-equity-reclass.test.js`)
- [x] **FIN38** — Equity reclassification: Donor-Restricted vs. Without Donor Restrictions, from
  `Timothy_Equity_Reclassification_Spec.md` (user-provided spec) — replaces QuickBooks' four-way
  equity split (Unrestricted/Board Restricted/Temp. Restricted/Perm. Restricted) with the real
  post-ASU-2016-14 two-bucket model, computed bottom-up from real account balances rather than the
  legacy equity lines, which have drifted from reality (32000 Perm. Restricted has been frozen at
  exactly $223,828.47 every year since 2019 despite the underlying endowments moving with the
  market). New `computeEquityReclassification()` + the spec's Section 3 classification table
  (`EQUITY_RECLASS_ACCOUNTS`) in `src/api-finance.js` — Unrestricted is always the residual against
  real Total Equity, never a direct sum of the legacy lines, per the spec's explicit instruction.
  **Verified against the real reference workbook the spec itself names**
  (`Timothy_Statement_of_Financial_Position_by_Year.xlsx`) — 2026's designated-funds total matches
  the spec's own stated baseline ($119,049.51) to the penny, and reconciles for all 8 real years.
  **Found a real gap in the spec's own table**: 5 accounts under the real "12000 Investment
  Accounts" group (structurally identical to already-classified accounts) aren't in Section 3 —
  surfaced as an "unclassified accounts" review list per the spec's Section 5.4, not silently
  defaulted into either bucket. Also flags Cash-vs-Accrual basis on import (2025's real export was
  Accrual while every other year is Cash). Wired into both Balance Sheet import routes (preview +
  commit) and both read routes; new frontend cards showing the two buckets, a breakdown table, and
  any unclassified accounts needing a human decision. `npm test` (419/419, 17 new tests in
  `test/finance-equity-reclass.test.js`), `node --check` on `api-finance.js` and both built app-JS
  bundles. Not verified in a live browser. Done 2026-07-28 (v1.113.0). See NOTES.md for full
  detail. (`src/api-finance.js`, `src/frontend/js-finance.js`, `test/finance-equity-reclass.test.js`)
- [x] **FIN35** — Reported "there is no Distribution amount (cash minus reserves) $9,321.77. that should be a dashboard feature" — AHRA's monthly report states this exact figure verbatim, and it was already being imported (`available_for_distribution_cents`, from the CSV's `distribution_amount` column) but never displayed anywhere: not in the Monthly Financials table, not in any KPI card — the field only existed as a hidden value in the Edit-month modal's form. New pure `finComputeLatestDistributionAmount(d)` (walks the monthly rows back-to-front for the most recent one with a recorded figure) backs a new "Distribution Amount" KPI tile added to `finComputePropertyKpis()` — shared by both the Overview tab's Property domain and the Property tab's own KPI row, so it's genuinely a dashboard feature as asked, not buried one tab deep. Labeled and chipped with AHRA's own wording ("cash minus reserves", plus the source period) to keep it visually distinct from the pre-existing "Available for Distribution" navy-bar card, which is a deliberately different ANNUAL ESTIMATE (this year's net income less reserve contributions and capital spend) — not this report's literal monthly cash figure; left that alone. Also added a "Distribution" column to the Monthly Financials table so the full per-month history is visible, not just the latest month. `npm test` (375/375, 3 new tests including an exact reproduction of the real July 2026 report's $9,321.77), `node --check` on both built app-JS bundles. Not verified in a live browser. Done 2026-07-28 (v1.110.0). (`src/frontend/js-finance.js`, `test/finance-property-distribution.test.js`)
- [x] **FIN45** — Reported the "FY2026 Projected" column's annualization looked off (user's own
  hand-check — actual ÷ 7 completed months × 12 — gave $411,215, not the $359,814 shown). Root
  cause: the code annualized off the current calendar month number (8, since Aug 5) rather than
  completed months (7) — a partial month is ambiguous either way. Switched to **weeks elapsed**
  (days since Jan 1 ÷ 7, capped at 52) per the user's suggestion — unambiguous and closer to this
  church's weekly giving rhythm; `weeksElapsedInYear()` (`src/api-finance.js`, `generate-all`
  endpoint, param renamed `through_month`→`through_week`) + a duplicate `finWeeksElapsedInYear()`
  in `js-finance.js` (no module system in this file). Same conversation, two more real bugs: (1)
  the FY{base} Projected column had no edit affordance despite being asked for — added a real
  editable input per leaf, `_finPlanBaseProjEdits` (unsaved) + new `GET`/`PUT
  /admin/api/finance/planning/base-projection` (saved, keyed by base year, chms_config JSON blob,
  same pattern as the salary planner). (2) editing a Plan or Projected cell never updated the
  group/subtotal/Δ%/Net rows above it — `finPlanEditCell` only mutated state with no re-render at
  all, so bold rollup rows stayed stale until a full reload. Fixed by wiring both edit handlers to
  a new `finRerenderPlanTablePreserveFocus()` (same focus-preserving re-render technique FIN20
  built for Compensation, now applied to the Planning table itself). Also made both editable dollar
  columns whole-dollars-only end to end (`finPlanSanitizeWholeDollarInput()` strips anything but
  digits/leading "-" as typed; server-side rounds to the nearest dollar before cents on both
  `override-bulk` and the new `base-projection` PUT). `npm test` (580/580, 26 new/updated tests
  incl. an exact reproduction of the reported Aug-5 example), `node --check` on both built app-JS
  bundles. Caught and fixed, before shipping, a real instance of this project's own known
  backtick-in-comment-breaks-the-outer-String.raw bug class (a stray backtick in a new comment) —
  found by running the test suite, not by reading the diff — plus a leftover `baseThroughMonth`
  reference in the column header tooltip that would have thrown at render time. Not verified in a
  live browser. Done 2026-08-05 (v1.128.0). (`src/api-finance.js`, `src/frontend/js-finance.js`,
  `test/finance-budget-plan.test.js`)
- [x] **FIN55 — Compensation: part-time staff (2026-08-06).** Asked for a checkbox to exclude
  part-time employees from health/disability/etc — "they are just cash salary, very part time" —
  then for a percentage-of-time marker. **`cashOnly`** removes pension, disability and health but
  deliberately **not employer FICA**, which is owed on any W-2 wage however few the hours; dropping
  it would understate the real church cost (a minister's FICA is the separate SECA toggle — tax
  status, not hours). Flagged to the user rather than decided silently. **`ftePct`** scales the
  district **benchmark**, never the salary: without it a 20%-time worker on $8,000 reads as **15% of
  scale** on the Council report — alarming and meaningless — where pro-rated the same salary reads
  as **75%**, a real question; a fairly-paid part-timer can now come out green. Second-order
  consequences handled: the LCMS median comparison is **suppressed** for a part-timer (Concordia's
  ranges are full-time figures), cost-to-full-scale adds no pension/disability for a cash-only
  worker, the health view shows "Not eligible" rather than enrolled-at-$0 and they are out of the
  group total, the Council report says why, and a part-timer left benefits-eligible gets a nudge
  rather than an automatic coupling (Concordia's hours floor is roughly half time, so FTE and
  eligibility are related but not the same). `npm test` (778/778, 16 new in
  `test/finance-part-time.test.js`); **every new test verified non-vacuous** by injecting the exact
  regression it guards (all three failed as they should). One assertion was corrected rather than
  forced — the fixture worker genuinely is below their own pro-rated scale, so the test now pins the
  real demonstration (15% → 75%) with a second test for the fairly-paid case. **Not verified**: a
  live browser. (`src/frontend/js-finance.js`, `test/finance-part-time.test.js`)
- [x] **FIN56 — Compensation: current pay by hand, and health priced by coverage tier (2026-08-06).**
  Two follow-ups on FIN54/FIN55. **(a) Current pay.** A worker whose wages sit INSIDE a budget line
  shared with other staff — the daycare director paid out of the daycare payroll account — could
  not be costed. Linking them to that account read the whole line, several people's wages, as one
  person's pay; leaving them unlinked read nothing. Either way "No raise", COLA and Custom were
  computed off a wrong number with nothing on screen saying so. New FY-base **current pay** box on
  the worker drawer writing `w.actualSalaryCents` — the read side already existed in
  `finCompCurrentPayCents()` but nothing had ever set it, a field orphaned by the redesign. An
  entered figure beats the account lookup for that worker only; the account figure is the
  placeholder and a link clears back to it. Saves with the roster, so no endpoint or migration. The
  drawer note was also factually wrong ("the plan total is applied back to it" — Send to budget
  writes one grand total to a single chosen account, never per-worker) and is corrected.
  **(b) Health by tier.** The card took one ANNUAL group medical figure per option split evenly
  across a hand-typed contracts count; the renewal packet publishes a **monthly** rate per coverage
  tier (Self / Self & Spouse / Self & Child / Family). The even split was only ever right because
  this church has two Family contracts and nothing else — one worker on Self and it charges them a
  Family share. Now `tiersMonthlyCents` per option (the packet's Enrollment and Rates block
  verbatim), a per-worker tier, and cost = own tier rate x 12 + an even share of dental and vision
  (not tier-priced in the packet). Enrolment is counted off the roster, not typed. The contracts
  box, `finCompContractCount()` and `finHealthPlanPerContractCents()` are deleted and
  `healthPlanContracts` no longer loads from the save — a stored count with no UI left to clear it
  is the invisible-stuck-state class. **The transcription is self-checking**: tier rates x real
  enrolment reconstruct the packet's own Total Monthly ($4,102.00) and Total Annual ($49,224.00)
  exactly, and every pre-existing planner health figure reproduces unchanged. Also: the breakeven's
  per-household gap now reads off the two tier rates rather than dividing a group total (still
  $4,045.80 Renewal to Option 1); the dependents checkbox no longer moves anyone between tiers
  (with four tiers a dependents flag no longer implies one); premiums show to the cent; and a
  legacy annual `medicalCents` override is dropped when a tier rate is typed over it.
  `npm test` (803/803, 25 new across `test/finance-health-tiers.test.js` and the planner file),
  every one verified non-vacuous by injecting the regression it guards. Plus `node --check` on both
  built bundles, a div-balance scan of the assembled `CHMS_HTML` and all five rendered views, and a
  mixed-roster harness confirming the enrolled workers' health lines sum exactly to the group quote.
  **Not verified**: a live browser. (`src/frontend/js-finance.js`,
  `test/finance-health-tiers.test.js`, `test/finance-compensation-planner.test.js`,
  `test/finance-salary-calculator.test.js`, `test/finance-part-time.test.js`)
- [x] **FIN54 — Compensation Planner redesign + Council report (2026-08-06).** Built from the
  `design_handoff_compensation_planner` bundle (README + an interactive planner prototype carrying
  the whole calculation engine + a printable Council report). Replaces `finRenderCompensation()`
  and everything under it: four stacked cards and several hundred words of prose become **five
  views behind one sub-nav** (`1 · Set pay` / `2 · Check fairness` / `3 · Health plan` /
  `This year's rates` / `Council summary`) under a persistent navy totals strip, so no input is
  ever on a different screen from its consequence. **The one deliberate maths change**: COLA and
  Custom now grow the worker's **current pay**; only District Scale runs the district formula.
  Before, all three growth methods computed from the district table, so for a year with a
  published base salary (which FY2027 has) they showed the identical number — reading as a bug and
  making a COLA inexpressible. **Every pure function is untouched** — `finComputeLcmsSalary`,
  `finLcmsMultiplierFor`, `finRoundSalaryCents`, `finComputeEmployerFicaCents`,
  `finComputePensionCents`, the Concordia rate lookups, the four health breakeven functions,
  `finAccountBudgetCentsForCode`; `test/finance-salary-calculator.test.js` (which reconciles them
  against the published PDFs) needed no changes. Every annual figure now lives in one place:
  `_finSalaryReferenceByYear[year]` gained `pensionPct`/`ficaPct`/`disabilityDepsPct`/
  `disabilityNoDepsPct`/`ssaColaPct` + provenance strings, resolved entered-year → most recent
  earlier entered year → code constant, with the UI naming which it used rather than silently
  substituting. The old roster-wide pension/disability overrides and the `colaSource` key migrate
  into that shape on read (`finCompMigrateSavedShape`) — left as globals they would have kept
  applying with no UI left to clear them. The Council report is a purpose-built flowing document
  (drafted motion, cost-to-full-scale alternative labelled as an alternative, a page per worker,
  group health plan, reference figures with sources), not the workspace with its chrome hidden.
  **Three real problems the tests caught before shipping**: the new CSS added a fourth breakpoint
  (600px), which `test/breakpoints.test.js` correctly rejected — this codebase has exactly three
  tiers (MOB3); removing a worker left `_finCompPerWorkerMethod`/`_finCompOverrides` keyed by the
  old indexes, silently shifting every later worker's settings onto their neighbour; and the
  employee-only/opt-out premium boxes were editable for a non-admin. `npm test` (729/729; the
  compensation test file rewritten to 42 tests covering the handoff's §10 acceptance checks, with
  §5.12's worked example reproduced to the cent — $103,600 / $107,380 / $106,470 / $107,250,
  church cost $147,661, 99% of scale, 103% of median). **Every new test verified non-vacuous** by
  injecting the exact regression it guards (all five failed as they should). Plus `node --check` on
  both built bundles, a tag-balance scan of the assembled `CHMS_HTML` and of all five rendered
  views, confirmation `#fin-panel-compensation` still sits inside `.content-area` (the TAP2-BUG
  class), that all 29 inline handlers named in the markup exist, and that all 32 run without
  throwing; the served bundle swept for the `String.raw` escaping bug class (3 hits, all
  pre-existing, all in `js-giving.js`). **Not verified**: a live browser or a real print dialog —
  same standing caveat as all frontend work here. **Deliberately dropped**: the old "Other Benefits
  ($/yr, entered)" free figure, which is not in the handoff's data model and had no home in the new
  layout — say if it needs to come back. (`src/frontend/js-finance.js`,
  `src/frontend/html-head.js`, `src/frontend/html-tabs.js`,
  `test/finance-compensation-planner.test.js`, `test/finance-input-typing.test.js`)
- [x] **FIN53** — Four reported Compensation Planner problems, plus one real bug found while fixing
  them. (1) **The "None (flat)" column is no longer editable** — it is the current budget, imported
  from the worker's linked payroll account, and an edit box on an already-correct figure invited
  people to type over it. A stored legacy override still resolves and keeps a "use account figure"
  link; new ones can't be created. (2) **The roster table is now the "MO District Calculator" and
  actually calculates for the target year.** Reported as "it ends up with 2026 numbers": its Salary
  column rendered `finSalaryComputeAll`'s ACTIVE-scenario figure, and the active scenario is
  normally "None (flat)", which resolves to the BASE year's account budget — so a table whose whole
  purpose is a FY2027 district-formula proposal displayed FY2026 budget figures. New pure
  `finDistrictProposalCents(w)` runs the formula for the target year unconditionally, regardless of
  active scenario; column labelled "FY2027 District Proposal", footer totals the proposals. The
  redundant "FY2026 Acct Actual" column is gone (the same figure already drives None above), and
  the three per-worker benefit toggles (SECA / Has Dependents / Health Plan) moved down to Total
  Compensation next to the costs they drive, so the calculator's inputs are formula inputs only.
  (3) The scenario table is labelled **"Salary Options."** (4) New **"Concordia Plans Comparisons"**
  card from the three real Compensation Decision Support Tool reports run 2026-07-21 (Dinger —
  Pastor-Senior Administrative 20 yrs Masters; Knapp — Director of Parish Music 20 yrs; Thompson —
  Director of Christian Education 22 yrs), transcribed verbatim. Per-worker horizontal range chart
  (hand-rolled SVG — the grouped-bar helper can't express low/mid/high) plotting every published
  range on one shared dollar scale, with dashed markers for what the church budgets today and the
  FY2027 district proposal; each range's midpoint also carried up as a reference column in Salary
  Options. Concordia's parish-professional report has no District section, so those two ranges are
  absent (not zero-filled) for the non-pastor workers — 4 range bars for the pastor, 2 each for the
  others — while the editable table still offers all four rows for a future report that does carry
  them. Every figure editable, persisted through the existing Save button (no new endpoint, no
  migration); the seed only fills a worker with no Concordia data yet, so an admin edit is never
  overwritten; inputs disabled for non-admins. **Real bug found by the new tests:** FIN43's
  per-paycheck $5 rounding was also being applied to the *imported* budget figure, so $74,516 of
  real budget displayed as $74,490 and $73,034 as $73,060 — rounding now applies only to a
  proposal, never to an imported figure, and a proposal is still an exact whole multiple of a clean
  $5 paycheck. `npm test` (706/706, 17 new in `test/finance-compensation-planner.test.js`, which
  loads the real built bundle in a `vm`; every assertion checked for vacuity against the pre-change
  code), `node --check` on both built app-JS bundles, tag-balance scan of the rendered tab. Not
  verified in a live browser. Done 2026-08-05 (v1.141.0). (`src/frontend/js-finance.js`,
  `test/finance-compensation-planner.test.js`)
- [x] **FIN52** — Root-caused the recurring "the health opt-out text boxes don't type correctly"
  report, after being told explicitly to find the cause before coding again (FIN42/FIN48/FIN49/FIN50
  each fixed a real but different symptom and left the cause in place). Reproduced by simulating
  keystrokes through the shipped `finSanitizeDecimalInput` instead of reasoning about it: typing
  `1234.56` gave **$123,456** (per-worker Opt-Out box) or **$56** (District Reference Data Health
  Opt-Out box). **Cause: a lossy controlled-input round-trip, not a browser quirk** — each keystroke
  converts the text to canonical cents, then the card re-renders and writes `cents/100` back into the
  box, so typing `.` yields `"1234."`→`parseFloat`→`1234`→ the box is rewritten `"1234"`, the decimal
  point is deleted, and the next digits land as whole dollars. Compounded on the boxes still using
  `type="number"` (including the reported one, which FIN50 never converted) by two more defects:
  `.value` returns `""` for a mid-typed `"1234."` so the figure is deleted and the box **blanks**,
  and `selectionStart` is `null` there so the caret-restore was silently skipped and the cursor
  jumped to the end every keystroke (the "typing backward" feel). **Fixed** by (1) having
  `finRerenderPlanningPreserveFocus()` and `finRerenderPlanTablePreserveFocus()` capture/restore the
  focused element's raw text alongside focus/caret/scroll — one change covering every field, state
  still updates live so totals recompute — and (2) converting the 7 remaining `type="number"` boxes
  in the Compensation card to `type="text"` + `inputmode` + the live sanitizer. **Audited every
  Finance tab: the bug was confined to Compensation** (the user expected it app-wide) — Planning
  cells already store the raw typed string per FIN45, and the Property Valuation Calculator /
  Multi-Year Forecast only rewrite output elements, never their own inputs; every other
  `type="number"` in the file is read on blur or a button click, so those were left alone rather than
  churned for symmetry. New `test/finance-input-typing.test.js` (10 tests) runs the real
  sanitizer/handler from the built bundle, pins the pre-fix failure, and asserts structurally that no
  Compensation input is `type="number"` and both wrappers restore the focused value — verified
  non-vacuous by reverting each half of the fix and confirming the matching tests fail. `npm test`
  (590/590), `node --check` on both built bundles. Not verified in a live browser. Done 2026-08-05
  (v1.136.0). (`src/frontend/js-finance.js`, `test/finance-input-typing.test.js`)
- [x] **FIN51** — Two more follow-ups on FIN50, reported after testing it live. (1) **"Still not
  calculating the next year salary using the district's multiplier table"**: "None (flat)" correctly
  showed the real budget ($98,800) — but LCMS/SSA/Custom had also been changed to grow FROM that real
  figure by a flat %, producing a lower number than the actual district formula the user hand-computed
  ($106,149.74). Reverted: `finWorkerScenarioSalaryCents()` uses the real figure only for "None";
  every other scenario is unconditionally the pure `finComputeLcmsSalary()` formula for the target
  year, exactly like before "grow from actual" existed. Verified with a harness reproducing the exact
  user numbers: None=$98,800 (budget), LCMS/SSA=$106,149.74 (formula, matches the hand-calc,
  identical to each other since FY2027 has an exact published base — expected). (2) **"Changes aren't
  saving when I checkbox or change a field"**: the whole Compensation tab never autosaved. Added one
  `finSalaryScheduleAutoSave()` call inside the single shared rerender function every mutator already
  calls, covering every field/checkbox at once; also found and fixed `finConcordiaFieldChange()`,
  which never called ANY save function at all — those fields were unsavable outright, not just
  missing autosave. `npm test` (580/580), `node --check`, harnesses for both fixes. Not verified in a
  live browser. Done 2026-08-05 (v1.135.0). (`src/frontend/js-finance.js`)
- [x] **FIN50** — Two follow-ups on FIN49, reported after testing it live. (1) **Real bug**: the
  account lookup used `totalActualCents` (YTD spend so far this fiscal year) instead of
  `totalBudgetCents` (the full-year budgeted figure) — for a still-in-progress year this understated
  the salary badly (Dinger showed $56,848, the YTD actual, instead of his real $98,800 budget).
  Renamed to `finAccountBudgetCentsForCode()`, now reads the Budget line (falling back to Actual only
  when an account has no budget entered at all); copy/captions updated to say "budget" throughout.
  (2) **"Boxes still don't type correctly" even after the id fix**: switched all 4 dollar-value
  inputs from this round (Opt-Out payment, Employee-Only premium, actual-salary override, Health
  Premium lines) from `type="number"` to `type="text" inputmode="decimal"` with a new
  `finSanitizeDecimalInput()` — the same "sanitize as typed" pattern already proven for the Church
  Budget Planning cells (`finPlanSanitizeWholeDollarInput`), sidestepping `type="number"`'s
  documented cross-browser selection/reformatting quirks entirely rather than continuing to chase
  which specific one was still misbehaving. `npm test` (580/580), `node --check`, harnesses
  confirming the budget figure is now used and that typed input (including a trailing decimal point)
  round-trips exactly. Not verified in a live browser. Done 2026-08-05 (v1.134.0).
  (`src/frontend/js-finance.js`)
- [x] **FIN49** — Two follow-ups on FIN48, requested after walking through exactly how the numbers
  get computed. (1) **"The flat FY2026 rate should be what's currently budgeted ($98,800 for Dinger),
  not the formula's $104,260"**: the roster table already had an "FY{base} Acct Actual" reference
  column pulling each worker's real actual salary via their linked payroll account — but it was only
  ever a side-by-side reference, never the actual computation basis. New
  `finAccountActualCentsForCode()` lets `finWorkerScenarioSalaryCents()` use it automatically as the
  default basis (no typing required), with an explicit 3-tier priority: typed override > linked
  account's real FY actual (new) > LCMS formula (last resort). Explanatory copy above the scenario
  table rewritten to state this order plainly and name the exact source under each worker's name.
  (2) **"Every editable box has the same typing bug as Disability"**: traced to a second, more
  widespread bug — every input added in the FIN48 session (Opt-Out override, Employee-Only Premium,
  the "None" actual-salary override, Health Premium overrides) had no `id` attribute, so
  `finRerenderPlanningPreserveFocus()`'s `getElementById(activeId)` lookup silently failed and the
  field lost focus after every keystroke. Added stable ids to all 4; confirmed every other editable
  box on the page either already had one or is never rerendered mid-edit (e.g. the Valuation
  Calculator only updates 4 output spans, never its own inputs). `npm test` (580/580), `node --check`,
  harnesses confirming the account-actual basis and the id fixes. Not verified in a live browser. Done
  2026-08-05 (v1.133.0). (`src/frontend/js-finance.js`)
- [x] **FIN48** — Three follow-ups on FIN46, reported together. (1) **Real bug**: typing into the
  Disability % (and Custom growth %) inputs reformatted mid-keystroke, reading as "typing backward"
  — the value was forced through `.toFixed(2)` on every full-card rerender, and since it's a fraction
  round-tripped through float math, redisplaying it produced garbage like `11.700000000000001`. New
  `finFmtPctInput()` (a rounded number, not a padded string) replaces `.toFixed(2)` on both inputs.
  (2) **"Changing the percentage does nothing, everything's the same"**: FY2027 already has an exact
  published LCMS district base figure, so every formula-based scenario resolves to that fixed number
  regardless of growth rate — compounding the earlier $104,260-vs-real-$98,800 complaint. New
  `finWorkerScenarioSalaryCents()`: when a worker has an entered actual salary (editable input right
  in the "None (flat)" scenario column, placeholder shows the formula estimate), every scenario grows
  the REAL number by its rate instead of touching the LCMS formula — a percentage change now visibly
  changes the result regardless of whether the target year is already published. (3) **Family /
  employee-only / opt-out health tiers per worker**: "Has Dependents" now doubles as the health-family
  flag (confirmed default: one checkbox, not two) — family-coverage workers still draw from the real
  group Family-tier quote; since no Employee-Only premium data exists anywhere in the app, a
  non-family enrolled worker gets a plain editable Employee-Only premium input instead. An opted-out
  worker can now optionally get a per-worker opt-out cash override (blank falls back to the existing
  shared per-year figure). All three roll into a new "Total Health Plan Cost (all workers)" line.
  Verified with harnesses for all three: keystroke-by-keystroke typing round-trips clean, LCMS vs SSA
  diverge correctly once an actual salary is entered, and all three health tiers resolve independent,
  correct figures. `npm test` (580/580), `node --check`, confirmed new function names in the
  assembled bundle. Not verified in a live browser. Done 2026-08-05 (v1.132.0).
  (`src/frontend/js-finance.js`)
- [x] **FIN47** — Reported: editing a Church Budget Planning cell (Plan or Projected) and then
  navigating away lost the edit — nothing saved until the explicit "Save Changes" click. Every cell
  edit now schedules a debounced (~800ms) background save, so a change reaches the server within
  about a second regardless of whether "Save Changes" is ever clicked; refactored the row-collecting
  logic shared by the new autosave path and the still-present manual Save button (which still does a
  full reload-and-confirm, unlike the background autosave, which deliberately doesn't reload
  mid-typing). Also flushes any pending autosave immediately before the base-year/target-year
  selectors change context or before Commit, so a fast navigation or an immediate commit-after-typing
  can't silently drop or use stale data. `npm test` (580/580), `node --check`, harness against the
  served bundle confirming the debounce timing and the immediate flush-on-year-switch. Not verified
  in a live browser. Done 2026-08-05 (v1.131.0). (`src/frontend/js-finance.js`)
- [x] **FIN46** — Reported the Compensation tab only had one editable rate box (Pension
  Contribution %) — no override for Disability & Survivor's rate, and no way to edit the Health
  Insurance card's Medical/Dental/Vision premium figures or the opt-out cash amount. Traced: the
  Health Opt-Out Cash figure already existed and was already editable (District Reference Data box,
  per fiscal year) — just easy to miss, grouped with Base Salary rather than near Pension. The other
  two were real gaps. Added: (1) a "Disability & Survivor Rate %" override input beside Pension, same
  null-means-auto-with-reset-link pattern — overriding applies one flat rate to every worker instead
  of the two Concordia dependents-based rates. (2) Editable Medical/Dental/Vision premium inputs for
  the selected plan option on the Health Insurance card — blank uses the quote's own 2027 figure
  (shown as placeholder), a typed figure overrides just that option's line, with a reset link; a
  quote-figure fallback and per-option override map (`_finHealthPlanPremiumOverrides`) back
  `finComputeHealthPlanTotalCents`, so every downstream calc (per-worker Total Compensation, the
  breakeven "is it worth it?" analysis) picks up an override automatically. Both new figures persist
  through the existing salary-planner save/load endpoint. `npm test` (580/580 — a pre-existing test
  harness that evals an isolated extract of `finComputeHealthPlanTotalCents` needed a `typeof` guard
  added since it doesn't declare the new override global; fixed), `node --check` on both touched
  files, confirmed the new function/variable names appear in the assembled bundle. Not verified in a
  live browser. Done 2026-08-05 (v1.130.0). (`src/frontend/js-finance.js`)
- [x] **FIN44** — Reported "numbers here dont match" from two Commercial Property screenshots. **Every figure reconciled exactly against the seeded AHRA data — no arithmetic bug**; three labeling problems, all real. (1) **Two different quantities were both labeled "Reserves"**: the `Reserves On-Hand` KPI tile ($10,358.33) is AHRA's total reserve *balance* (tax $5,858.33 + the $4,500 base-minimum cushion carried over from prior years, per FIN33), while the "Available for Distribution" bar's `− Reserves` ($5,858.33) is only *this year's* contributions — differing by exactly the base minimum, and extra confusable because the tax reserve was zeroed in Nov 2025 and rebuilt entirely within 2026, so "2026 contributions" coincidentally equals "current tax-reserve balance" to the cent. (2) **`Monthly Net (avg)` × 12 ≠ `Annual Net`** — trailing-12-month window (reaching back into 2025's three negative months) vs. calendar-2026 YTD; $3,583.65 × 12 = $43,003.75, not $33,835.55, and neither label stated its window while the adjacent chip said "12 months tracked." (3) **The `Reserves On-Hand` chip was factually wrong** on the path the figure comes from — always claimed "tax + capital + base minimum," but AHRA's own Total Property Reserve has no capital bucket (none is even seeded; only `property_tax`). Fixed: every tile/bar line now names its own window and year (`Annual Net (2026 YTD)`, `− Reserve contributions (2026)`, `− Capital spend (2026)`, `trailing 12 mo`), new `finPropertyReservesChip()`/`finPropertyLatestReserveMonth()` name the real reserve source per path and share the latest-month check with `finComputePropertyReservesOnHandCents()` so chip and number can't drift, and the bar carries a reconciliation note explaining why it differs from both the tile and AHRA's own monthly `Distribution Amount` ($9,321.77 — single-month cash figure vs. full-year accrual estimate). Verified by running the *built* bundles' `finComputePropertyKpis()`/`finRenderAvailableForDistributionBar()` in a `vm` harness against the real seeded 2026 data, plus hand-reconciliation of every figure against `src/db.js`. `npm test` (422/422, 1 new), `node --check` on both bundles. Not verified in a live browser (labels/copy only, no computation changed). **Two decisions deliberately left to the user**: whether `Available for Distribution` should also deduct the $4,500 base minimum (never-releasable cash, so $23,977.22 is arguably that optimistic — but it was funded in a prior year, so excluding it from *this* year's deduction is defensible), and confirming that `− Capital spend $4,000.00` / `Amount Dispersed $4,000.00` being identical is the verified coincidence it appears to be (2026-04-08 Vail Contracting washer/dryer final payment vs. the 2026-04 church distribution — two separate source entries, but equal amounts in the same month are the shape a double-entry would take). Done 2026-07-30 (v1.115.3). (`src/frontend/js-finance.js`, `test/finance-property-distribution.test.js`)
- [x] **FIN34** — Follow-up on FIN33 (below), same day: the user asked how next month stays correct without repeating this, and how to trust the rest of the currently-stored property data. Answer led to a real design improvement, not just an explanation — `finance_property_monthly.reserve_balance_cents` (already imported verbatim from each report's "Total Property Reserve" line, via the CSV/xlsx importers or the "+ Add Month" modal) was sitting unused by the "Reserves On-Hand" KPI, which instead reconstructed a total from the reserve-schedule ledger + the new base-minimum figure — a second, manually-maintained path that could silently drift from the report's own number if a future month's reserve ledger row is forgotten. `finComputePropertyReservesOnHandCents(d)` now prefers the latest month's `reserve_balance_cents` whenever one is recorded (so simply keeping Monthly Financials current each month is now sufficient — no separate reserve-ledger bookkeeping step required to keep this KPI right), falling back to the ledger+base-minimum reconstruction only for a period with no recorded monthly total yet. Output for the already-seeded June/July data is unchanged ($10,358.33 either way — the two paths agree, since they're built from the same source numbers), confirmed by rerunning the existing reconciliation test unchanged plus two new tests proving the monthly-row figure wins even over a deliberately-stale ledger, and that the fallback still fires when no monthly row is entered yet. `npm test` (362/362), `node --check` on both built app-JS bundles. Not verified in a live browser. Done 2026-07-28 (v1.109.0). (`src/frontend/js-finance.js`, `test/finance-property-distribution.test.js`)
- [x] **FIN33** — Reported the app's "Reserves On-Hand" KPI ($5,858.33) didn't match the real July 2026 AHRA report's "Total Property Reserve" ($10,358.33) or its "Distribution amount (cash minus reserves)" ($9,321.77). Investigated with the actual report PDF: its "Property Reserve and Distribution Report" page (Month of July 2026) shows the math explicitly — **Final Reserve Amount Calculations**: Total Prior Months Accumulated Reserve ($4,750.00) + Current Month Reserve ($1,108.33) + **Base Minimum Reserve ($4,500.00)** = Total Property Reserve ($10,358.33). The first two terms are exactly the Property Tax Reserve's own `reserve_after_cents` ($5,858.33, already correctly tracked in `finance_property_reserves` — confirmed accurate, not a bug) — the missing piece is AHRA's flat **$4,500 "Base Minimum Reserve"**, a constant operating-cash cushion it always holds back before computing a distribution, which isn't an accumulating bucket like the tax reserve and had no home anywhere in the schema. (The $9,321.77 distribution figure was already correctly stored — `available_for_distribution_cents` on the June monthly row, from the CSV's `distribution_amount` column — just not the number being compared against; the app's own "Available for Distribution" navy-bar estimate is a deliberately different, already-labeled annual estimate, not this report's literal monthly cash calc, so left untouched.) Fixed: new `meta.reserves.base_minimum_cents` (PATCH `/finance/property/ivanhoe/meta` allowlist extended to accept a `reserves` section, reusing the existing generic section-merge pattern), seeded to $450000 (the real July figure) via a new marker-gated `seedIvanhoePropertyBaseMinimumReserve(db)`. New shared pure `finComputePropertyReservesOnHandCents(d)` (sum of every reserve bucket's latest `reserve_after_cents`, plus the base minimum) now backs both places that computed this inline and had drifted into duplicated logic (`finRenderBalancesRow` on the Overview tab, `finComputePropertyKpis` on the Property tab) — confirmed reconciles to the report's own $10,358.33 exactly. New "Base Minimum Reserve" card (admin-editable) added to the Property tab, right above Property Tax Reserve, so the figure is visible and adjustable instead of a silent constant; "Reserves On-Hand" chip relabeled "tax + capital + base minimum". `npm test` (282/282, 5 new tests including an exact reproduction of the report's own reconciliation), `node --check` on both built app-JS bundles. Not verified in a live browser. Done 2026-07-28 (v1.89.0). (`src/api-finance.js`, `src/db.js`, `src/frontend/js-finance.js`, `test/finance-property.test.js`, `test/finance-property-distribution.test.js`)
- [x] **FIN32** — Reported "this is the budget i have, but the upload won't take it. i can't upload new month data that i have here also" with a real `budget_detail20260126_2.xlsx` file attached. **Real bug found and fixed**: `finXlsxListSheetNames()`/`finXlsxFindSheetPath()` (the generic zip/xlsx reader every Finance import uses) assumed every `<sheet>` tag in `workbook.xml` is self-closing (`<sheet .../>`) — but this real AHRA "Budget Detail" export instead writes an explicit open/close tag (`<sheet ...></sheet>`), which the old `[^>]*\/>` regex never matched, silently returning zero sheet names and making `findPropertyBudgetDetailSheet()` always fail with "Could not find a Budget Detail sheet" — for this file specifically, and for any future xlsx from any source using this equally-valid tag style. Fixed both functions to match just the opening `<sheet ...>` tag (self-closed or not) and read its `name`/`r:id` attributes independently of order or closing style. Verified against the real uploaded file end-to-end (extracted its zip/XML by hand to confirm the exact tag shape, then ran the actual `parseXlsxAllSheets`/`findPropertyBudgetDetailSheet`/`parsePropertyBudgetDetailGrid` pipeline against it in Node) — correctly reads all 12 months' Total Budgeted Operating Income/Expense rows once fixed. New regression tests build a minimal in-memory ZIP (both a self-closing and an explicit-close `<sheet>` variant) so this exact bug class can't silently regress. **Also added, for "can't upload new month data"**: a CSV bulk-import path for `finance_property_monthly` (new `parsePropertyMonthlyCsv()` + `POST /admin/api/finance/property/ivanhoe/monthly-import-csv`, admin-only), reading the exact CSV row shape AHRA's own reports already ship with (`period,occupancy_pct,total_revenue,operating_expenses,net_operating_income,non_operating_expenses,net_income,...`) — verified against the real June 2026 `monthly_financials_row.csv` reconciling exactly to the already-seeded row (FIN29). This lets a new report's month be pasted in directly instead of retyped field-by-field into the "+ Add Month" modal; a new "Import CSV" toggle button next to "+ Add Month" reveals a paste-and-import panel. `loan_payment_cents`/`interest_expense_cents` (FIN31) aren't in this CSV shape and are left untouched on an upsert rather than wiped. `npm test` (251/251, 10 new tests), `node --check` on both built app-JS bundles. Not verified in a live browser. Done 2026-07-27 (v1.69.0). (`src/api-finance.js`, `src/frontend/js-finance.js`, `test/finance-property.test.js`)
- [x] **FIN33** — Church Budget Planning: added an auto-computed "FY{base} Projected" column (base-year year-end projection) between `FY{base} Actual` and the untouched `FY{target} Plan` column. Scoped with the user first (they chose auto-compute a fresh year-end projection over re-keying the existing Plan data to the base year). Each leaf account's actual-to-date is annualized by `12/throughMonth` — the identical proration `generate-all` uses server-side, so the Projected column shows the exact base amount the Plan column was grown from; `throughMonth` = current month for the in-progress current year, else 12; group rows roll up as the sum of their leaves so subtotals/Net reconcile. Display-only, nothing stored, no data moved (`finRenderPlanning` only). `npm test` (288/288), `node --check` on both built app-JS bundles, vm harness render check. Not verified in a live browser. Done 2026-07-27 (v1.90.0). (`src/frontend/js-finance.js`)

### Security Hardening (2026-07-16)
Raised while answering QuickBooks' Developer app security questionnaire (FIN1/FIN2). Discussed and deliberately deferred rather than rushed in to check a form box — see reasoning below each item.

- [ ] **SEC9 — MFA (multi-factor authentication) for login.** Worth doing for real, especially now that `admin` accounts can connect/disconnect the QuickBooks integration and `finance` accounts see real financial data. Not a quick toggle — needs a proper scoped build: TOTP secret + QR code setup flow, a verification step at login, recovery codes, and a decision on whether to require it for every role or just `admin`/`finance`. Scope this as its own session before building.
- [ ] **SEC10 — CAPTCHA on login.** Considered and deprioritized: the login already rate-limits to 10 attempts/15 min per IP, which covers the realistic threat (brute-forcing passwords) for a small, internal, non-public login page. Cloudflare Turnstile would be the natural fit if this becomes worth doing (same platform, no new vendor), but the added friction on every login isn't justified without evidence of actual attack attempts in the logs. Revisit if that changes.

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
- [x] **TAP9** — User's coworker updated the source workbook and added a brand-new "Student Tuition History" sheet — genuine per-student, per-year family-payment figures back to 2019-20 (blank = not enrolled that year), cross-referenced against original records by whoever built the workbook. This is exactly the per-student historical data TAP7 confirmed didn't exist anywhere at the time. Extracted via a Python script (not hand-transcribed, to avoid copy errors) covering 19 currently-enrolled students (63 pin-years, 2019-20→2025-26) and 3 no-longer-enrolled students (10 pin-years) who needed new `active=0` shell `tuition_students` rows to anchor their pins (same pattern as the `+ Add Family Record` UI). The 2026-27 column and cells the workbook itself flags as unreconciled (`'?'` for Annette/Evelyn Crim, and Michael Hawkins' 2024-25 per its footnote) were excluded rather than guessed at. Replaces (supersedes, same idempotent `INSERT OR IGNORE` pattern so no migration needed) the narrower `seedParent2025_26` from TAP7 with `seedStudentTuitionHistory(db)` in `src/db.js` — spot-checked several rows against the raw sheet dump by hand before writing the extraction script's output into the seed constants. `npm test` (37/37), `node --check`. Done 2026-07-16 (v1.20.3). (`src/db.js`)
- [x] **TAP10** — Requested a real UI import feature (not another hand-extraction) so staff can re-upload an updated workbook themselves in the future without a code change. Built a dependency-free `.xlsx` reader in `js-tuition-aid.js`: XLSX is a ZIP of XML files, so this reads the ZIP container directly (hand-rolled central-directory/local-header parsing) and decompresses the DEFLATE payloads with the browser's native `DecompressionStream` — no bundled third-party parsing library (this app has zero external JS dependencies anywhere, hand-rolling SVG charts etc. for the same reason), and no `DOMParser` either (a tag-scanning text extractor instead), which happened to make the whole pipeline testable end-to-end in plain Node before ever touching a browser. Entirely client-side — the file never leaves the browser until the user reviews a preview and clicks Import. Generalized the TAP9 one-time extraction into a reusable parser: reads year columns dynamically from the header row (`/Parent\s*\n?\s*(\d{4}-\d{2})/`) instead of a hardcoded year list, so a future workbook with more year columns just works; skips whichever school year is currently `base_school_year` (dynamic, not a hardcoded "2026-27"); and — since a general tool can't know a given cell is one a source workbook's footnote flags as an estimate — deliberately dropped the one-time "Hawkins/Michael" hardcoded skip from TAP9 in favor of a preview table with a checkbox per row so a human can exclude anything before committing. New `POST /admin/api/tuition-aid/import-history` endpoint upserts (overwrites, tracking created/updated/unchanged counts) rather than the seed's insert-or-ignore, since a deliberate re-import should be able to correct a previously-wrong figure. **Verification**: extracted the parser into a standalone Node harness and ran it against the real uploaded workbook — confirmed byte-for-byte identical output (23 students, 74 pin-years) to the already-shipped TAP9 Python extraction; separately re-ran the exact same test against the code as `String.raw`-served (built `CHMS_HTML`, extracted the live `<script>` block, `eval()`'d it, called the real functions) to confirm the templating layer didn't corrupt anything — this was the same technique used to catch the SC3-BUG1 backslash-escaping class of bug earlier in this project, applied proactively here instead of after a report. **Not verified**: an actual browser — `DecompressionStream`/`DataView`/`TextDecoder`/`File.arrayBuffer()` are all standard, well-supported Web APIs, but this environment has no live browser to click through the real upload flow. `npm test` (37/37), `node --check` on all touched files and all 3 built `<script>` blocks. Done 2026-07-16 (v1.21.0). (`src/frontend/js-tuition-aid.js`, `src/frontend/html-tabs.js`, `src/api-tuition-aid.js`)
- [x] **TAP11** — Three requests in the same message: (1) an explicit Enroll action for pipeline entrants ("a kid might be in the pipeline but not enrolled yet even if the right age"), (2) link LHS students to Person records (previously only K-8 rows had a Link button), (3) sortable columns on the planner tables. **(1)** was a real gap: `tapBucketFor`/`tapActiveForYear` treated a pipeline entrant as a real K-8/LHS student the moment their birth year math said they were old enough, with no actual enrollment decision — they'd silently start getting real awards assigned. New `tapEnrolledActiveForYear()` (excludes `is_pipeline` regardless of computed age) now backs every *operational* view (planner tables, budget gauges, KPIs, Apply Policy/Auto-Balance, Pathway, Composition chart, K-8 Detail table) — deliberately **not** the Budget Projection / Enrollment Mix charts, which still use the original `tapActiveForYear()` since counting anticipated pipeline arrivals is the entire point of those two. New "Enroll" button in the Pipeline list (shown once age-eligible) calls `tapEnrollPipeline()`, which PATCHes `is_pipeline:false` + `base_grade:<computed grade>` — the only thing that now moves a pipeline entrant into the real planner. **(2)** — the LHS row template was simply missing the `Link` button the K-8 row already had; added, same `tapOpenLinkPerson()` flow. **(3)** — `tapRenderPlannerTables()` refactored to build row data first (was pushing HTML strings directly while iterating), sort by the active column/direction, then render; sortable `<thead>` gets its own `tapRenderPlannerHeaders()` re-render with a ▲/▼ indicator on the active column. Deliberately used 11 tiny per-column wrapper functions (`tapSortK8Family()`, etc.) instead of embedding a quoted string argument in the `onclick` HTML (`tapSortK8('family')`) — the latter is exactly the escaping pattern that caused real bugs earlier in this project (VUXBUG2, SC3-BUG1-class); the wrapper functions have zero quote-escaping surface at all. Verified all three end-to-end with a Node harness against the actual served (`String.raw`-processed) code: confirmed a pipeline student never leaks into the K-8 table regardless of computed grade, both LHS rows show Link buttons, sorting K-8 by Family flips Alpha/Zebra order correctly in both directions, the Enroll button renders only for the age-eligible pipeline student, and `tapEnrollPipeline()` sends the correct PATCH body. `npm test` (37/37), `node --check` on all touched files and all 3 built `<script>` blocks. Done 2026-07-16 (v1.22.0). (`src/frontend/js-tuition-aid.js`, `src/frontend/html-tabs.js`)
- [x] **TAP12** — User uploaded the school's real per-year award workbook (`Tuition_Awards_2026.xlsx`, one sheet per school year) and asked whether it could be imported as-is, whether it would capture grade, and whether it would total the Timothy-funded grants (Partnership/Access/Soldiers of the Cross) separately from outside scholarships — i.e. everything TAP10's simple "Student Tuition History" ledger format didn't capture. Rather than have the user or a coworker hand-reformat the file (the original plan), built a second importer path that reads the real workbook directly: `tapParseWorkbookAllSheets()` lists and parses every sheet; `tapDetectAwardSheetLayout()` locates the header row by exact cell text ("Last Name"/"Grade"/"Child"/"Parent Portion…") rather than fixed column position, since the offset varies per sheet (2 leading payment-plan columns in some years, not others); `tapYearLabelFromSheetName()` derives the school year from the tab name itself ("26-27" → "2026-27", "Timothy Member Tuition 2022-23" → "2022-23"). Verified against the real uploaded file that `tuition − outside_aid − timothy_award = family_owed` holds exactly, confirming the column-classification (Today & Tomorrow/Building Blocks/CFNA/Other/MO Scholars/LASE Scholarship/ACE → Outside Aid; Partnership Grant/Access Grant/Soldiers of the Cross → Timothy Award) is correct, not guessed. LHS awards are pulled from each sheet's separate high-school block by anchoring on a "LHSA Aid" total row and scanning upward while grade is 9–12 — reuses the same column positions detected for the K-8 header (verified: the LHS block's award figure always lands in the same column as "Partnership Grant"). The LHS block has no last name, only first (or occasionally full) name, so `tapMatchLhsName()` matches against the *current* roster (`_tapRoster`, per the user's explicit choice over an AskUserQuestion) — full "First Last" match tried first, falling back to first-name-only; anything with zero or 2+ matches is listed in the import preview as unresolved rather than guessed. Only 4 of the 8 sheets in the real file have the clean single-child-per-row layout the parser recognizes (`26-27`, `2025-26`, `Timothy Member Tuition 2023-24`, `2022-23`); the 3 oldest (`2021-22`, `2020-21`, `2019`) use an incompatible one-row-per-family-with-multiple-children shape and a different scholarship vocabulary — these are skipped and named in the import status message rather than parsed wrong. Testing surfaced a genuine data-quality issue in the user's own file: two different real students are both named "John Hawkins" (one currently K-8, one currently LHS) — since matching only has the name string to go on, this would have silently merged their histories into one `tuition_students` row. Added a post-merge collision check (a K-8-shaped entry and an LHS-shaped entry landing on the same school year for the same matched name) that flags the record in the preview (highlighted row, unchecked by default, explicit warning) instead of importing it blind. Backend `POST /tuition-aid/import-history` extended from writing only `family_owed_cents` to merging whichever of `grade`/`outside_aid_cents`/`timothy_award_cents`/`family_owed_cents`/`lhs_award_cents` a given entry provides against the existing per-year row (same merge pattern as the `year-pins/bulk` endpoint), so a K-8-only or LHS-only re-import can never blow away the other kind of data already pinned for a different year. The simple "Student Tuition History" sheet format from TAP10 still works unchanged (checked first; only falls through to the raw-workbook parser if that sheet isn't present). **Verification**: ran the actual served (`String.raw`-processed, extracted-and-`eval()`'d) code against the real uploaded workbook — confirmed 62 K-8 history entries and 16 LHS entries extracted across the 4 recognized sheets, spot-checked several dollar totals by hand against the source cells, confirmed the Hawkins/John collision is caught, confirmed zero negative amounts, confirmed the 3 legacy-format sheets are correctly skipped and named. `npm test` (37/37), `node --check` on all touched files and all 3 built `<script>` blocks. **Not verified**: an actual browser, and the roster-matching logic against the *real* current roster (only tested against a small hand-built fake roster standing in for `_tapRoster`) — worth a careful first real run. Done 2026-07-16 (v1.24.0). (`src/frontend/js-tuition-aid.js`, `src/frontend/html-tabs.js`, `src/api-tuition-aid.js`)
- [x] **TAP13** — User asked their coworker (Cowork) to also capture Outside Aid/Timothy Award per year (raised right after TAP12, since that file's history only had family-owed totals) and re-uploaded a rebuilt workbook. Cowork's fix restructured the *existing* "Student Tuition History" sheet itself — same sheet name TAP10 already recognized, but each year is now a 5-column group (Grade / Tuition Billed / Outside Aid / Timothy Aid / Family Owed) instead of one "Parent YYYY-YY" column, with the year label merged across the group one row above the column headers. New `tapDetectMultiYearHistoryLayout()` finds the group columns by scanning the row above the header for `YYYY-YY` labels and validating the 4 sub-headers at each match (`grade`/`outside…`/`timothy…`/`family…`, prefix-matched so wording drift doesn't break it); `tapExtractMultiYearHistory()` reads whichever of grade/outside/timothy/family-owed a cell actually has a number in (a `'?'` sentinel, same convention as the user's earlier "unreconciled" cells, is simply omitted rather than guessed at) and still records the grade alone when everything else is `'?'`. Tried first on any "Student Tuition History" sheet; falls back to TAP10's original single-column-per-year format if the group columns aren't found, so older-style uploads still work. Added a non-blocking reconciliation check (`tuition − outside aid − Timothy award` should equal family owed) that caught a real problem in the test file: Hawkins/John and Hawkins/Michael have *identical* 2019-20 figures ($6,200 tuition, $6,200 Timothy award, $3,100 family owed on both) — almost certainly one brother's row got copy-pasted onto the other during reconstruction. Mismatched entries are highlighted (amber, distinct from the red identity-collision highlight) and listed with the actual numbers in the preview, but left checked by default since family-owed is usually the more trustworthy figure — the call on which number to trust is left to the user, not guessed. **Verification**: ran the real re-uploaded workbook through the actual served code — confirmed the new column-group detection reads all 8 year groups, correctly excludes the current year (2026-27, 0 leaked), correctly imports 26 students/85 entries with grade+aid populated, correctly reproduces the Oschwald/Jadon figures already cross-verified in TAP12, correctly omits `'?'`-flagged fields while still keeping the grade, and correctly flags the 7 reconciliation mismatches (including the Hawkins duplicate) without blocking them. Re-ran the TAP12 raw-workbook-parser harness against the original file too, to confirm no regression to that code path. `npm test` (37/37), `node --check` on all touched files and all 3 built `<script>` blocks. Done 2026-07-17 (v1.25.0). (`src/frontend/js-tuition-aid.js`)
- [x] **TAP14** — Two requests in one message: (1) type an exact dollar Timothy Award directly for a K-8 student, the same way Outside Aid already can be, instead of only being derivable from the Family Share % slider; (2) a combined "Total Timothy Aid" field/gauge spanning both the K-8 (WOL) budget and LHS awards. A third message ("the percentage... I think is backwards") turned out not to be a bug on investigation — confirmed with the user via a concrete example (an 80%-share student with heavy outside aid can owe *less* in dollars than a 20%-share student with none, since the % is the family's share of tuition *before* outside aid is netted out, not their final out-of-pocket %) — no code change needed, just confirmed understanding. **(1)**: new `timothy_award_override_cents`/`family_owed_override_cents` columns on `tuition_students` (migration `0017_tuition_timothy_override.sql` + `db.js` runtime safety net) — distinct from the pre-existing `timothy_award_exact_cents`/`family_owed_exact_cents` (the original Breeze/manual seed snapshot, read-only after first touch; mutating those in place would have broken "Reset to Current Awards," which relies on them staying the untouched original baseline). `tapSplitFor()` gives the new override top priority for the current year whenever set, regardless of `touched`. The Timothy Award cell in the K-8 planner table is now a live number input (`tapTimothyAwardChange`) instead of a read-only span, with a "↺ auto" link to clear back to %-driven computation (`tapClearTimothyOverride`). Changing Outside Aid while an override is active keeps the typed Timothy Award fixed and only recomputes Family Owed (`tapOutsideAidChange`); dragging the Family Share % slider clears the override (the two are mutually exclusive, most-recent-control-wins, same UX model already used elsewhere in this planner). Reset to Current Awards, Apply Aid Policy, and Auto-Balance (`tapResetAwards`/`tapBulkSaveForYear`, shared by the latter two) all explicitly clear the override too — otherwise a previously-overridden student would silently ignore a fresh bulk-computed % forever, since the override always wins in `tapSplitFor`. Also works for non-current years by routing through the existing per-year pin mechanism (`timothy_award_cents`/`family_owed_cents` on `tuition_student_years`), which already had this exact "exact figure wins over %" priority built in from TAP5 — the current-year override is really the same concept finally extended to the one place (offset 0) that didn't have it. **Found and fixed a pre-existing bug while in this code**: `tapSliderChange`'s DOM-sync logic queried `input[type=number]` across the *whole table row* and grabbed index `[0]`, assuming the Family Share %'s paired number box was the only one — but Outside Aid's number input sits earlier in the row and was already silently claiming that slot even before this session's changes (adding the new Timothy Award input would have made a second collision, not created the first one). Fixed by scoping the query to the slider's own `.tap-slider-row` container instead of the whole row. **(2)**: new `timothy_total_budget_cents` config value (no schema change needed — `tuition_config` is a generic key/value table, and the existing `PATCH /tuition-aid/config` endpoint already accepts arbitrary keys), a new gauge card (K-8 Timothy Award total + LHS Award total vs. this one combined budget) sitting alongside — not replacing — the two existing individual gauges, per the user's explicit choice. Shows a neutral "set a budget" prompt instead of a misleading 0%-vs-$0 bar until the admin sets a value via the new inline input (`tapSaveTotalBudget`). **Verification**: 11-case Node harness run against the actual served (`String.raw`-processed) code covering the full priority chain (default computed → typed override → outside-aid-sync-while-overridden → slider-clears-override → Reset-clears-override → bulk-save-clears-override → explicit clear), the future-year pin path, and both gauge states (unset/set) with the exact PATCH bodies asserted — all passed. `npm test` (37/37), `node --check` on all touched files and all 3 built `<script>` blocks, div-balance check on the new HTML section. **Not verified**: an actual browser (same standing caveat as every other Tuition Aid change this session). Done 2026-07-17 (v1.27.0). (`src/frontend/js-tuition-aid.js`, `src/frontend/html-tabs.js`, `src/api-tuition-aid.js`, `src/db.js`, `migrations/0017_tuition_timothy_override.sql`)
- [x] **TAP15** — Follow-up feedback on TAP14, four items. **(1) Real bug found**: the new "Total Timothy Aid" budget/gauge stored the input as raw cents but read it back as if it were dollars in three places (`tapRenderTotalBudgetBox`, `tapK8BudgetFor`, `tapUpdateGauges`'s caption) — a $100,000 entry displayed and computed as $10,000,000, a 100x error. Fixed all three to consistently divide by 100. **(2) Design correction**: the combined Timothy Aid figure isn't a third independent number tracked alongside the K-8 and LHS budgets — it's *one* shared pool, with LHS drawing its $1,200/kid first (LHS enrollment isn't something set directly, it varies year to year) and whatever's left becoming the actual K-8 budget. New `tapK8BudgetFor(lhsTotal)` helper (`max(0, totalPool − lhsTotal)`, falling back to the old standalone `k8_budget_cents` when no pool is set) now backs the K-8 gauge, its caption, **and** Apply Aid Policy / Auto-Balance's actual budget math (both previously read the old fixed config directly, so they weren't respecting the shared-pool model at all) — verified with a scenario where shrinking the pool below LHS + minimum-award floor correctly constrains what Apply Policy assigns. **(3) Real persistence bug found and fixed**: `tapDebouncedSave`/`tapSavePinDebounced` keyed their pending-save timer by student (or student+year), and a *second* call within the 500ms debounce window `clearTimeout`'d the first timer and replaced its field payload outright — so editing two different fields on the same student in quick succession (e.g. unchecking "Plans to attend LHS" then adjusting outside aid) silently dropped the first field's save. The local UI state was always right (each handler mutates `_tapRoster`/`_tapPinsByKey` directly before debouncing), so this was invisible during a live session and only surfaced as data missing after a reload — exactly matching the report. Fixed both functions to merge into a shared pending-fields map instead of replacing it, verified with a harness firing two rapid calls and confirming both fields land in the single resulting PATCH/PUT body. **(4)**: pipeline entrants (not-yet-enrolled kids, tracked by birth year) can now optionally get an explicit grade at add time — birth year alone assumes a fixed age cutoff that breaks down for a kid close to the cutoff date or one a family is intentionally holding back a year. `tapGradeAt()` now checks for an explicit `base_grade` on a pipeline row first, only falling back to the birth-year formula when it's blank; the pipeline chip's caption switches from "K expected `<year>`" to "grade `<X>` now" when an override is set. No backend change needed — `base_grade` was already an accepted field on the create endpoint, just never surfaced for pipeline entries in the UI. **Also**: the K-8/LHS planner tables' Grade column sort (from TAP11) was comparing grade strings alphabetically, which puts "K" after "8" and "10" before "9" — fixed to sort by `TAP_GRADE_SEQ` index instead, and made Grade the default sort column for both tables (previously unsorted/insertion-order until a header was clicked) per the request for the K-8 table to "be sorted." **Verified**: harness tests against the actual served code for all four items — confirmed the $100k round-trip now displays/computes correctly, Apply Policy respects a shrunk derived budget, a two-field rapid edit produces one merged PATCH with both fields present, an explicit pipeline grade override wins over and progresses correctly from the birth-year formula, and the K-8/LHS tables render in natural grade order by default. `npm test` (37/37), `node --check` on all touched files and all 3 built `<script>` blocks. **Not verified**: an actual browser. Done 2026-07-17 (v1.29.1). (`src/frontend/js-tuition-aid.js`, `src/frontend/html-tabs.js`)
- [x] **TAP16** — Reported: a pipeline entrant (Lawrence Knapp) doesn't show up when navigating the
  year selector to the year he should reach Kindergarten — the only way to see him was to first
  click Enroll for the *current* year (enrolling him as a PK grade he isn't actually attending,
  invisible either way since PK is filtered from the table, but reads as a false enrollment). By
  design (TAP11), pipeline entrants never appear in the real planner tables for any year until
  formally Enrolled. Added a future-year-only preview: viewing a year other than the current one now
  also shows any pipeline entrant whose birth-year-projected grade for that year is a real K-8/LHS
  grade, as a dimmed "pipeline" badge row with estimated award figures and its own inline Enroll
  button — display-only, doesn't touch `tapEnrolledActiveForYear`/budget gauges, so nothing is
  double-counted. Verified against the served script with a harness (absent this year, previewed
  with a working Enroll button once K-eligible, previewed with no Enroll button while still too
  young to enroll). `npm test` (580/580), `node --check`. Not verified in a live browser. Done
  2026-08-05 (v1.129.0). (`src/frontend/js-tuition-aid.js`)
  - **TAP16-FIX1** — Follow-up same day: the preview row was read-only estimates plus an Enroll
    button; asked to instead be able to click into a future year and actually adjust outside aid /
    family share / a manual Timothy Award for that not-yet-enrolled kid, planning a real "what if
    enrolled this year" scenario. Preview rows now use the exact same editable inputs a real row
    has — they already save into the same per-year pin a real student's future-year edit uses
    (`tapOutsideAidChange`/`tapSliderChange` already routed there for any non-current year,
    regardless of enrollment); only `tapTimothyAwardChange` had an unconditional `isPipeline` bail,
    relaxed to "pipeline AND current year" so a future-year manual award edit isn't blocked.
    Verified with a harness: editing a preview row writes an isolated per-year pin (current year
    untouched, `is_pipeline` unaffected) that round-trips back into the inputs on re-render. `npm
    test` (580/580). Not verified in a live browser. Done 2026-08-05 (v1.130.0).
    (`src/frontend/js-tuition-aid.js`)
  - **TAP16-FIX2** — Reported "the calculations here are wrong — I entered aid for WOL totalling
    $80,850 and the bar shows $70,150." Not a math bug: `tapUpdateGauges()`'s budget-used total is
    computed from `tapEnrolledActiveForYear()`, which deliberately excludes pipeline (not-yet-
    enrolled) students — including the ones TAP16-FIX1 just made editable for "what if enrolled"
    planning — so typed pipeline awards were invisible in every total, exactly matching the report
    (the three pipeline rows in the screenshot summed to $18,100, entirely unaccounted for). Asked
    the user how they wanted it resolved (`AskUserQuestion`: merge into one total / show both kept
    separate / only count manually-overridden pipeline rows) rather than guess — chose **show both,
    kept separate**. New `tapPipelinePreviewForYear(yearIdx)` (factored out of
    `tapRenderPlannerTables`'s own inline preview-filter block, now shared so the table and the
    gauges can never disagree) backs a new note line under each of the K-8/LHS/Total gauges —
    `tap-k8-pipeline-note` etc. — reading "+ $18,100.00 planned for 3 pipeline students not yet
    enrolled (not counted above)" whenever a preview exists; empty/hidden otherwise, including on
    the current year (pipeline never previews there). The real budget-used figure itself is
    untouched — still real-enrollment-only, so a kid who never actually enrolls still can't inflate
    it. Verified against the real assembled bundle (`CHMS_APP_CORE_JS`+`CHMS_APP_EXT_JS`, not just
    source) with a `vm` harness reproducing the report's exact numbers: real total unaffected, note
    reports exactly $18,100.00/3 students, note disappears on the current year. `npm test`
    (580/580), `node --check` on both built app-JS bundles. Not verified in a live browser. Done
    2026-08-05 (v1.136.0). (`src/frontend/js-tuition-aid.js`, `src/frontend/html-tabs.js`)

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
- [ ] **AU2 — Login page slow / hangs for minutes on some networks (flagged for the redesign, 2026-07-25).** Reported: the login page (`LOGIN_HTML` in `src/html-templates.js`) can take *minutes* to appear on some networks. Diagnosis: the server path is not the problem — for an unauthenticated visitor `getAuthInfo()` returns `null` immediately (no cookie → bails before any D1 query), and `LOGIN_HTML` is a ~4KB self-contained page. The one external, **render-blocking** resource is the Google Fonts `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond…&family=DM+Sans…">` in the `<head>`. On a filtered church/school network that **silently drops** (rather than cleanly refuses) traffic to `fonts.googleapis.com`, the browser blocks first paint waiting on the OS TCP timeout (tens of seconds to minutes, often retried) → white screen for minutes, then the card snaps in. `display=swap` does not help — it only governs font-swap *after* the stylesheet loads, not the blocking request itself; there's also no `preconnect` hint. **Fix deferred to the visual redesign per user (in-progress redesign, don't touch login styling piecemeal now):** self-host the two WOFF2 fonts from the Worker (removes the external dependency entirely and lets the CSP drop the `fonts.googleapis.com`/`fonts.gstatic.com` allowances), or make the font `<link>` non-blocking (`media="print" onload="this.media='all'"` + `preconnect`), or drop custom fonts on the login screen. **To confirm on the affected network before fixing:** DevTools → Network → hard reload → check whether the stalled multi-minute row is `fonts.googleapis.com`/`fonts.gstatic.com` (→ this fix) vs. the document request itself (→ server/Cloudflare path instead, different investigation). (noted 2026-07-25)

### Settings
- [x] **ST1** — Hide testing sections in Settings tab from non-admin users (birthday/anniversary/SMS test buttons, etc.) — done 2026-05-01 (v165). Added `require-admin` class to EM2 and SMS1 import-cards.
- [x] **ST2** — New "Office" role (data-entry): full People/Households/Register CRUD, no Giving/Reports/Settings/Attendance/Volunteers/Scheduler/Imports. Added to the existing Settings → Users role dropdown alongside admin/finance/staff/member. Done 2026-07-16 (v1.21.0) — see NOTES.md for full detail. Bulk people actions (bulk-tag/bulk-member-type/bulk-sacrament/bulk-comm-opt) and marking someone deceased stayed `staff`-only by design (narrower than staff); revisit if that becomes a real limitation for office users.
- [x] **ST3** — Role Permissions rebuilt from a coarse 4-checkbox grid into a **granular per-feature, tri-state matrix**, requested 2026-07-27. Each of the 4 grouped access rows was split into its own item (`giving`, `tuitionaid`, `finance`, `attendance`, `followups`, `audit`, `register`, `reports`); a **Member** column was added; and every cell is now a 3-way select — **No access / View only / Edit** — instead of a checkbox. Scoped with the user via `AskUserQuestion` first (they chose: per-feature view/edit, member limited to the read-only directory, the full item split). Backend: `api-utils.js` now models per-item levels (`ROLE_PERMISSION_ITEMS`/`ROLE_PERMISSION_LEVELS`/`DEFAULT_ROLE_PERMISSIONS`), auto-migrates the old boolean shape forward, clamps read-only items to `view` and members to their safe subset (`clampMemberRow`); `api-chms.js` enforces it centrally via a per-item `ACCESS_GATE` (`none`→403, `view`→reads only, `edit`→read+write) before any handler dispatch, deriving the legacy `isFinance/isStaff/canRegister/canEdit` flags from the matrix for downstream reads; `api-import.js` validates/stores the tri-state shape. **People/Households editing intentionally stays the blanket `canEdit` flag** (every non-member role) — the matrix items are the feature areas layered on top of the baseline directory, not the directory itself. Frontend: granular sidebar visibility (`require-tuitionaid`/`require-financeov`/`require-attendance` split off `require-finance`/`require-staff`; `applyPermissionUI` + new `permView`/`permEdit` helpers in `js-core.js`), member can be granted the Reports tab (the one safe extra, view-only), and the primary create/edit buttons on the Giving/Attendance/Register tabs hide for a view-only role via `perm-edit-*` body classes (deeper per-row controls stay server-enforced). Verified: `npm test` (254/254, role-permissions suite rewritten to 13 tri-state/migration/clamp cases), `node --check` on both built app-JS bundles + `api-chms.js`, a gate-scenario harness against the real `resolveRolePermissions`/`permissionsForRole`, and an isolated DOM harness running the actual served `renderRolePermTable` (confirms 8 rows, read-only items lack an Edit option, member cells locked except Reports). **Not verified**: a live browser. Done 2026-07-27 (v1.85.0). (`src/api-utils.js`, `src/api-chms.js`, `src/api-import.js`, `src/frontend/js-settings.js`, `src/frontend/html-tabs.js`, `src/frontend/html-head.js`, `src/frontend/js-core.js`, `src/frontend/js-register.js`, `test/role-permissions.test.js`)

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
- [x] **G21** — Duplicate fund finder + merge tool. Prompted by the Giving by Fund report showing multiple rows with the identical name (e.g. two "40085 General Fund" rows) — confirmed these are real duplicate `funds` rows (no unique constraint on `name`), typically from a Breeze fund being re-created or no longer existing in Breeze at all. New admin-only `GET /admin/api/funds/duplicates` groups all funds by exact-match name and returns any group with 2+ rows (gift count + total per row); `POST /admin/api/funds/merge` (`{keep_id, remove_ids}`) reassigns `giving_entries.fund_id` to the kept fund and deletes the others, writing a `merge_funds` audit_log row. New Settings → Import/Export card "Find Duplicate Funds" lists each duplicate-name group with a radio picker (defaults to the row with the highest total) and a Merge button — manual review before merging, no auto-merge. Deliberately scoped to exact-name duplicates only (not fuzzy matching) to keep the first pass low-risk. Done 2026-07-17 (v1.29.0). (`src/api-households.js`, `src/frontend/js-export-import.js`, `src/frontend/html-tabs.js`) **G21-BUG1** — Reported "Internal server error" clicking Find Duplicate Funds immediately after ship. Root cause: `giving_entries` has no `amount_cents` column — the real column is `amount` (see the Data Integrity checklist: giving amounts are stored as integer cents in a column named `amount`, not `amount_cents`). The duplicates-finder query referenced the wrong column name, causing a SQL error → 500. Fixed by querying `SUM(amount)`. Done 2026-07-17 (v1.29.3). **G21-BUG2** — Reported the duplicate-group header showed the fund name lowercased (e.g. "25004 building fund" instead of "25004 Building Fund"). Root cause: the group's display `name` was built from the normalized dedup key (`(f.name||'').trim().toLowerCase()`, used only for matching) instead of an actual fund row's real-cased name. Fixed by taking the name from the highest-total fund in the group after sorting. Done 2026-07-17 (v1.29.4).
- [x] **G22** — Reported 2026-07-21: the Giving by Fund report was showing junk placeholder/zero-activity funds (`Breeze Fund 1771128`/`1771129`/`1773223`/`1843175`/`1843177`, `Playground`, `11030 – Cash on Deposit`, etc. — all 0 gifts/$0.00) mixed in at the top of the list. `reports/giving-summary` now sorts $0-in-period funds to the bottom (existing `sort_order, name` ordering preserved within each group). Also flagged: a "49094" numeric-code fund group (like the existing "25010 Concordia Children's..." near-duplicate group found the same day) where the bookkeeper wants the sub-funds kept **separate** in the data — not merged — but wants them visually collapsed together in the report. Added a real expand/collapse toggle to every numeric-prefix fund group in the report (`rptToggleFundGroup()`) — collapsed by default (header + subtotal only), click the header to expand and see the individual fund lines. This is presentation-only, no data change, so it's safe for any prefix group including 49094. Separately, **real duplicate "General Fund" rows** (the accidental kind, not an intentional bookkeeping split like 49094) should be merged for real via the existing Settings → Import/Export → "Find Duplicate Funds" tool (G21) — not done from this session (needs an admin to click Merge in the live app; no live DB/browser access here). Done 2026-07-21 (v1.47.5). Two follow-ups from the same conversation: (1) the collapsed group header showed only the bare numeric code (e.g. "25010") — now labeled with the highest-total member's real fund name (e.g. "25010 Concordia Children's Services") so it reads like a fund, not a code. (2) New "Manage Funds" card in Settings → Import/Export (admin-only) — lists every fund with an Active checkbox and its gift history, reusing the existing (previously frontend-unused) `PUT /admin/api/funds/:id` endpoint; unchecking Active hides a fund from the Giving by Fund report and every other fund picker without deleting it or touching any recorded gifts, for the placeholder/zero-activity funds (Breeze Fund placeholders, Playground, etc.) the user wants gone from view entirely rather than just sorted to the bottom. `GET /admin/api/funds` now also returns `entry_count`/`total_cents` per fund; the funds POST/PUT endpoints gained an `isAdmin` guard (previously ungated). Done 2026-07-21 (v1.50.1). (`src/api-households.js`, `src/frontend/js-reports.js`, `src/frontend/js-export-import.js`, `src/frontend/html-tabs.js`)
- [x] **FIN20** — Church Report's "Full account detail" table (This Year view): renamed the "Actual" column to "YTD Actual" and added a "YTD actuals as of `<date>`" caption (the most recent sync/import timestamp among the year's entries, via new `finChurchAsOfDate()`) both above the table and in its collapsed summary line, so the figures are legible without opening the details. Also moved each section's "Total X" row from a header ABOVE its account lines to a subtotal AFTER them (new `finRenderChurchDetailBody()`/`finRenderChurchTotalRow()`, replacing the old top-of-section bold row), and added one grand-total "Net Income" row at the very bottom of the whole table, computed from the same `d.netIncome` figure the summary card above already shows — so the two can never disagree. `npm test` (173/173, 4 new tests in `test/finance-church-detail-body.test.js`). Not verified in a live browser. Done 2026-07-21 (v1.50.1). (`src/frontend/js-finance.js`, `test/finance-church-detail-body.test.js`)
- [x] **G23** — New read-only `GET /api/intake/funds` endpoint (`src/api-intake.js`), added so the website repo's admin.timothystl.org Giving tab (Funds card) can pull real ChMS fund names as a reference when setting up give.timothystl.org's fund selector, instead of staff retyping names by hand from memory and risking a mismatch. Same auth as the existing `/api/intake/connect-card`/`/api/intake/prayer` routes (`X-Intake-Key` header matching `env.CHMS_INTAKE_API_KEY` — not a user session), reusing the established cross-Worker call pattern rather than inventing a new one; not rate-limited like the POST intake routes since no public form can trigger it. Returns `{funds: [{id, name}]}` for active funds only, `sort_order, name` order. Deliberately does **not** expose or add a Tithe.ly fund ID on this side — ChMS's `funds` table still has no Tithe.ly linkage at all (only `breeze_id`, for Breeze giving-sync), confirmed again while building this; a real cross-app "sync the fund ID too" would need each fund's Tithe.ly ID entered somewhere by hand regardless, so this endpoint only solves getting the fund *name* right, not full fund automation. Verified with a `node:sqlite` harness (correct active-only filter, correct sort). `npm test` (187/187, unchanged — no new test file, the query is a 2-line passthrough already covered by the harness check above). Not verified against a live deploy (no way to invoke the real Worker route from this session). Done 2026-07-27. (`src/api-intake.js`)
- [x] **G25** — "Giving Plateaus & Nudges" report. Requested: find the per-gift amounts givers
  plateau at (e.g. $43/wk) and nudge each to the next clean number ($50), then use those as suggested
  amounts on the giving page. The giving page itself is external (Tithe.ly, give.timothystl.org —
  confirmed not in this repo), so this ships the in-app analysis half only: a finance/admin report
  tile that computes the tiers + nudge targets from live giving data, which the pastor then enters as
  Tithe.ly preset amounts. New `GET /admin/api/reports/giving-plateaus?year=&min_repeat=` (gated
  `giving`), pure `givingNudgeTarget()`/`computeGivingPlateaus()` in `api-utils.js` (10 unit tests —
  reproduces 43→50/83→100 exactly, plateau = modal per-gift amount recurring ≥ min_repeat, tie-break
  higher, upside = (target−plateau)×gift_count). UI: summary cards, Nudge Targets table, collapsible
  per-tier people lists, plateau-distribution histogram; year defaults to current. `npm test`
  (288/288), `node --check` on both built bundles. Not verified in a live browser or against live
  data. Done 2026-07-27 (v1.89.0). (`src/api-utils.js`, `src/api-reports.js`,
  `src/frontend/js-reports.js`, `src/frontend/html-tabs.js`, `test/giving-plateaus.test.js`)
  **v1.91.0** — added a Group-by Household/Person selector (household default): a household is one
  **v1.90.0** — added a Group-by Household/Person selector (household default): a household is one
  giver, spouses' same-day gifts summed. Endpoint `&scope=household|person`; `computeGivingPlateaus`
  carries `link_id`/`link_kind` so rows link to the household (or person). An in-memory-SQLite
  harness caught a real GROUP-BY-alias-collision bug (grouped by person not household) before ship.
  **v1.92.0** — moved the report out of the Giving → Reports tile grid into the **Board Report**
  sub-view (Finance → Giving → Board Report), with its own `#giv-plat-output` target (not the shared
  `showRptOutput`). Year prefills on board-view open.
- [x] **G26** — "Giving by Weekly/Monthly Band" report (companion to G25, in the same Board Report
  tab). Distribution of households (or persons) across granular per-week/per-month giving bands with
  a flat configurable uplift ("$50/wk → $60/wk = +$520/yr"). Distinct from Plateaus: bands + flat
  step, not modal-gift + next-clean-rung; a giver's level = giving ÷ periods elapsed (frequency-
  agnostic). New `GET /admin/api/reports/giving-bands` (gated `giving`), pure `computeGivingBands()`
  in `api-utils.js` (7 tests; uplift annualizes over a full 52/12 while pace uses elapsed periods).
  `npm test` (297/297), `node --check` both bundles + SQLite harness. Not verified live. Done
  2026-07-27 (v1.93.0). (`src/api-utils.js`, `src/api-reports.js`, `src/frontend/js-reports.js`,
  `src/frontend/js-giving.js`, `src/frontend/html-tabs.js`, `test/giving-bands.test.js`)
- [x] **G27** — Four follow-ups on G25 (Plateaus), requested together. (1) **Nudges were too
  aggressive at high amounts** ($2,500→$3,000, a 20%/$500-a-week ask) — `givingNudgeTarget`'s fixed
  round-number ladder replaced with `computeNudgeOptions()`: 3 graduated options (Modest/Standard/
  Generous) whose percentage step shrinks as the base grows (30–100% under $15/wk → 3–10% above
  $1,500/wk); $2,500/wk now nudges to $2,600/$2,700/$2,800, not $3,000. Caught and fixed a real
  floating-point bug in the process (`100*1.10 !== 110` in IEEE 754, throwing off the ceil-to-
  increment rounding by a whole increment). (2) **Impact framing** ("if you gave $18 more a month,
  that could provide X") — new admin-editable "Giving Impact Statements" (`config/giving-impact`,
  never pre-filled/fabricated) matched against each option's monthly-equivalent delta via
  `pickImpactPhrase()`. (3) **Retirement/IRA (QCD)/stock givers weren't visible** — these rarely
  repeat 3+ times so fell into invisible "variable"; new "Large & Occasional Gifts" section surfaces
  them sorted by total (no automatic nudge — a personal-conversation flag instead), plus an
  excluded-organizations diagnostic (count/total of gifts filed under an org-type record, in case a
  QCD custodian got mis-filed there). (4) **Multi-fund handling clarified + a Fund filter** — verified
  via a real-SQLite harness that every fund a giver gives to same-day was already summed, not
  discounted; new `&fund_id=` param + dropdown on both Plateaus and Bands lets the same analysis run
  scoped to one fund, which also directly serves the Concordia Children's Fund ask (a designated
  pass-through fund) with zero fund-specific code. `npm test` (347/347, 20 rewritten plateau tests),
  `node --check` both bundles + backend, SQLite harness confirming the fund isolation. Not verified
  live. Done 2026-07-27 (v1.102.0). (`src/api-utils.js`, `src/api-reports.js`, `src/api-import.js`,
  `src/frontend/js-reports.js`, `src/frontend/js-giving.js`, `src/frontend/html-tabs.js`,
  `test/giving-plateaus.test.js`)
- [x] **G28** — Four corrections to G27, requested right after seeing it. (1) **Fixed round numbers,
  not percentages** — `computeNudgeOptions()` rebuilt around a single curated `GIVING_NUDGE_LADDER`
  (the original hand-picked 10/15/20…1000 values behind the liked 43→50/83→100 examples, densified
  from $1,000 up: $100 steps to $5k, $250 to $10k, $500 to $25k) instead of percentage math — options
  are just "the next 3 ladder rungs above base," zero floating-point risk. (2) **Every option always
  shows a concrete annual dollar impact**, even Modest — `annual_delta_cents` is now unconditional;
  `impact_text` (the ministry-specific phrase) layers on top only when configured. (3) **Occasional/
  IRA-QCD/stock givers get identical treatment to everyone else** — the separate exclusion list is
  gone; a `low_frequency` flag (≤3 gifts/yr) instead drives an inline narrative ("gave $X in N gifts
  last year — about $Y/wk") right in the normal tier breakdown. (4) **Every giver's weekly figure =
  whole-year total (every fund) ÷ 52** — replaces modal-repeat plateau-finding entirely; endpoint SQL
  simplified to match `reports/giving-bands`'s one-row-per-giver shape, same `periodsElapsed`
  convention for a partial current year. `min_repeat` removed from API and UI. `npm test` (348/348,
  21 rewritten tests including a same-treatment regression proving a weekly $50/wk giver and a
  one-time $2,600 giver produce identical options), `node --check` both bundles + backend, scanned
  the served bundle for the double-backslash escaping bug class (3 hits, all pre-existing/unrelated).
  Not verified live. Done 2026-07-27 (v1.103.0). (`src/api-utils.js`, `src/api-reports.js`,
  `src/frontend/js-reports.js`, `src/frontend/html-tabs.js`, `test/giving-plateaus.test.js`)
- [x] **G29** — Follow-up on G28: user still wanted a dedicated, visible place to see occasional/
  low-frequency givers (folded into the unified model in G28) — specifically as a natural starting
  point for a recurring/automatic-giving conversation — and asked that one-time LARGE gifts (stock/
  IRA/QCD) surface there too, explicit that the list is informational, nobody on it needs to change
  anything. New `low_frequency_givers_list` in `computeGivingPlateaus()` — every low-frequency giver
  (still also in the normal tiers, not excluded), sorted by total given descending so a major one-time
  gift sorts first. New `all_manual_methods` flag per giver (mirrors `bucketGivingMethod()`'s 'ach'
  bucket via SQL) distinguishes "check/cash only" from "already has automatic gifts." New "Occasional
  = ≤ X gifts/yr" input (was a hardcoded 3) + an "Occasional Givers" card on the Plateaus report,
  copy explicitly framed as reference only, with a link to the church's Online Giving URL when
  configured. **Found and flagged (not fixed, out of scope) a pre-existing bug**: a different,
  unrelated giving-statement function reads `_churchConfig.giving_url`, but the real config key is
  `online_giving_url` — that link has silently always been blank; new code here uses the correct key.
  `npm test` (371/371, 4 new tests), `node --check` both bundles + backend, `auto_gifts` SQL verified
  against real SQLite. Not verified live. Done 2026-07-27 (v1.104.0). (`src/api-utils.js`,
  `src/api-reports.js`, `src/frontend/js-reports.js`, `src/frontend/html-tabs.js`,
  `test/giving-plateaus.test.js`)
- [x] **G31 — Giving Nudges: send the plateau analysis as mail (2026-08-06).** Asked for a
  Communications tab for the Plateaus & Nudges report, "so we can communicate these nudges." Scoped
  with the user first (`AskUserQuestion`) rather than guessed — "a tab for it" could mean a nav
  shortcut or a real send flow, and the send flow carries a pastoral decision: chose **full send
  flow**, letters **naming each recipient's own figures**. New **Giving → Communications → Giving
  nudges** pane (year / fund / grouping / Modest-Standard-Generous ask / email-or-print), backed by
  new `GET /admin/api/giving/nudges/status`. Sends record into the same `giving_letter_sends` ledger
  the Letters pane uses (new `letter_type` `nudge`), so a run is resumable and nobody is asked
  twice; printing records too, since printing is a send. **Figures are stated in the rhythm each
  giver actually gives in** — the user's own follow-up, and it mattered more than it sounds: the
  analysis normalises everyone to a weekly-equivalent so a weekly regular and a single December
  stock gift are comparable, which is right for the analysis and wrong for the letter. New pure
  `classifyGivingCadence()`/`cadenceAmountCents()` + per-giver `cadence*` fields. **Three real bugs
  found by harnesses, not by reading**: (1) `computeGivingPlateaus()` never returned a flat `givers`
  array, so the pane would have rendered an **empty recipient list, always** — now returned, and
  stripped back out of the plateaus report response so that payload doesn't double; (2) a giver of
  exactly $200/month would have been told they give **$199** (double-rounding through the weekly
  equivalent: $2,400/yr → $46.15/wk → $46 → $199.33/mo) — the cadence figure now comes from the
  annualised total directly; (3) the letter's own numbers disagreed — "+$60 a month" beside "about
  $728 over a year" — so `cadence_annual_delta_cents` is rebuilt from the rounded cadence delta and
  every figure in one letter reconciles. **The giver query is now shared, not copied**
  (`fetchGivingPlateauRows`), so the list written to can never be a different set of people than the
  list reviewed; a test asserts neither module kept a private copy. Two existing tests changed for
  real reasons: the letter-type inventory (six → seven), and a plateaus test asserting a weekly and
  a one-time giver get byte-identical options — still true of the *analysis* fields, deliberately
  false of the new *cadence* fields, so it was narrowed and a companion test added. `npm test`
  (757/757, 30 new in `test/giving-nudges.test.js` running the real helpers against real in-memory
  SQLite and the real letter builder out of the built bundle); **every new test verified
  non-vacuous** by injecting the exact regression it guards (all four failed as they should); plus
  `node --check` on the built bundle and all three touched backend modules, and a tag-balance scan
  of the assembled `CHMS_HTML`. **Not verified**: a live browser, a real email send, or a real print
  dialog. **⚠ The letter copy is drafted and should be read before any real send** — it thanks the
  giver, states what they currently give, names one next step, and frames it as "an invitation and
  never an expectation," but it is not the pastor's own wording. (`src/api-utils.js`,
  `src/api-giving.js`, `src/api-reports.js`, `src/frontend/js-giving.js`,
  `src/frontend/html-tabs.js`, `test/giving-nudges.test.js`, `test/giving-plateaus.test.js`,
  `test/giving-letters.test.js`)
- [x] **G32 — Year-end projections move from a month basis to a Sunday one (2026-08-06).**
  Reported from the Giving board page: the projections "look like you are taking the current month
  as a complete month," with the suggestion to work in weeks of the year — week X against week X of
  last year, then carry the remaining weeks forward. Confirmed, and it was **two errors pulling the
  same way**: (1) this year's giving through an in-progress month was compared against last year
  through that month **complete** (the SQL bound the prior window at `priorYear-MM-31`), and (2)
  `sundaysElapsedInYear(year, throughMonth)` counted every Sunday through the *end* of the month, so
  Sundays that had not happened yet counted as elapsed. Both understate, so on any date but a month
  end the projection came out low. **The unit is now Sundays**, not calendar weeks or months,
  because that is when this congregation gives — two Julys can hold four Sundays or five. New pure
  helpers in `api-utils.js`: `periodAsOfDate()` (today when the chosen month is still running),
  `sundaysElapsedThroughDate()`, `sundaysInYear()` (52 **or 53** — assuming 52 drops a real week of
  giving in those years), `nthSundayOfYear()` (the prior-year bound), `monthElapsedFraction()`.
  `projectYearEnd()` now takes an options object and reports `sundays_elapsed`/`sundays_in_year`/
  `sundays_remaining`. **The method is unchanged and deliberately so** — it still carries last
  year's remaining Sundays forward scaled by the pace this year is actually running, so a year
  behind stays behind rather than catching up by December; only the basis was wrong. Two things
  fixed alongside, same root cause: **"vs. this point last year"** used the same month-boundary
  slice (and that removed a second, differently-bounded source of truth for one quantity —
  `priorCum` from a monthly slice vs `priorYtd` from the fund query, which disagreed mid-month), and
  **budget-to-date** charged a whole month the congregation had not reached then reported the gap as
  a shortfall (`spreadBudgetYtd` takes a `finalMonthFraction`, defaulting to 1 so nothing else
  changes). The narrative now states its own basis, because that basis is exactly what was wrong.
  `npm test` (762/762); projection tests rewritten for the new basis and two fixtures corrected
  (they set `prior_cents` and `priorMonthly` to different values for the same quantity — the
  duplication this removed); **every new assertion verified non-vacuous** by injecting the exact
  regression it guards (all three failed as they should). **Not verified**: a live browser or real
  D1 data. (`src/api-utils.js`, `src/api-reports.js`, `src/frontend/js-giving.js`,
  `test/giving-board.test.js`, `test/giving-fund-categories.test.js`)
- [ ] **G30** — Pre-existing bug found while building G29, not fixed (out of scope for that session):
  the giving-statement view function in `js-giving.js` (~line 1299) reads `_churchConfig.giving_url`
  to build a "set up recurring giving" link, but `GET /admin/api/config/church` actually returns that
  value under the key `online_giving_url` — so `givingUrl` there has always evaluated to `''`/falsy,
  meaning that specific link has silently never rendered even when an admin has set the URL in
  Settings. Fix: change `_churchConfig.giving_url` to `_churchConfig.online_giving_url` at that call
  site (and any other occurrence of the wrong key — grep for `.giving_url` excluding
  `online_giving_url`). (noted 2026-07-27)
- [ ] **G24** — Manual follow-up needed, outside code: `CHMS_INTAKE_API_KEY` (the same secret value already set on this Worker) needs to also be set as a secret on the website repo's `tlc-newsletter-admin` Worker (admin.timothystl.org) — it isn't there today (that Worker has never called out to ChMS before). Without it, `GET /api/intake/funds` calls from the Giving tab will always get a 401. `wrangler secret put CHMS_INTAKE_API_KEY --name tlc-newsletter-admin`, using the exact same value already configured for this Worker.

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
- [x] **AT7 — Attendance tab full redesign ("1a" direction from design handoff), replacing the
  single 230-Sunday line chart + infinite date-grouped list.** New tab bar under the topbar:
  **This Week · Trends · Festivals · History · Reports**, entirely frontend — one wide
  `GET /admin/api/attendance` load (current year − 4 through next year) drives everything
  client-side, no new backend endpoints beyond the pre-existing `attendance/sunday-name`
  lookup. **This Week**: an entry card (date, 8:00/10:45 inputs, live combined + "vs 4-wk avg"
  delta, Save Sunday / Add special service, a "Still to enter" list derived from an 8-week
  lookback of missing 8:00/10:45 legs) + a Pulse card (latest + prior-week delta, 4-/52-week
  avg, YTD vs last year, Sundays recorded, a last-26-Sundays bar chart colored gold/teal
  against each bar's own trailing 4-week mean) + a 5-year heat grid (quartile-based 4-step
  ramp) + a Recent Sundays list. **Trends**: monthly rhythm (12 months, navy bars ≥ 52-wk avg
  else light blue, with an approximate liturgical-season caption per month), a quarterly
  8:00/10:45 stacked service-mix chart, and a 3-year year-over-year numbers table. **Festivals**:
  Easter/Christmas Eve/Ash Wednesday/Thanksgiving Eve, 4 years side by side (Easter via the
  existing Meeus/Jones/Butcher algorithm, extracted into `attEasterDate()`; Ash Wednesday =
  Easter − 46 days; Thanksgiving Eve = day before the 4th Thursday of November). **History**:
  a sortable-by-date, click-to-correct table (reuses the existing `toggleAttEdit`/
  `saveInlineAttEdit`/`deleteAttDate` functions unchanged) + a client-side CSV export. **Reports**:
  a 2×2 card grid — Year-over-Year summary and Attendance by Service (both reuse the existing
  `runAttendanceSummary`/`runAttendanceByTime` + `_buildAttYoYHtml`/`_buildAttByServiceHtml`
  unchanged), Giving × Attendance (reuses `renderGivingVsAttendance` from `js-reports.js`), and
  a new one-page "Council packet" (`attRunCouncilPacket`/`attPrintPacket`, same
  print-body-class pattern as `printBoardPage()`). New CSS: a scoped `.att-root` token set
  (`src/frontend/html-head.js`, mapping the design handoff's literal hex values onto
  `var(--color-navy)`/`var(--color-teal)`/`var(--color-gold)`/`var(--border)` where they
  matched exactly, new custom properties for the rest — page/inset surfaces, hairlines,
  pos/neg colors, the 4-step heat/year-series ramps); print CSS extended so `#tab-attendance`
  isn't force-hidden and a `body.printing-att-packet` mode isolates just the Council Packet
  card. **Removed** (fully superseded by the redesign, confirmed zero other callers via a
  repo-wide grep before deleting): the old single Line/YoY/Bars line chart + its drag-resize
  handle, the Special/Midweek services bar chart, the date-grouped infinite service list, and
  the from/to date-range + group-by-month + show/hide-table controls — `js-core.js`'s
  `window.load` handler had two unguarded `document.getElementById('att-from'/'att-to').value=`
  lines that would have thrown once those inputs were removed; null-guarded rather than
  deleting the block, since the rest of that handler (report-tile defaults, year checkboxes)
  still needs to run. **Simplified/deferred vs. the design handoff**: (1) the old
  Special/Midweek services chart (all specials, not just the 4 named festivals) was dropped
  rather than kept alongside Festivals — its function (highlighting non-Sunday attendance
  spikes) is judged subsumed by the Festivals tab for the cases that matter; a broader
  "all specials" view isn't in the 1a spec and can be added back if missed. (2) The Reports
  tab's report cards keep small inline inputs (year checkboxes / date range / years toggle)
  rather than the handoff's implied "just click Run report" simplicity, since the underlying
  reports genuinely need a year/date-range selection and the app has no existing "remember
  last params" mechanism to lean on instead. (3) Season labels on the Monthly Rhythm chart
  (Lent/Easter/Advent/summer/fall) are a fixed calendar-month lookup, not real per-year
  liturgical-calendar dates — decorative only, cosmetic risk if a season's dates shift enough
  in a given year to look slightly off. **Verified**: `npm test` (421/421, no attendance-specific
  test file exists in `test/` so no test changes were needed/possible); `node --check` on the
  built `<script>` blocks for both `CHMS_APP_CORE_JS`/`CHMS_APP_EXT_JS` and on the standalone
  `JS_ATTENDANCE` module export; an HTML div-balance scan of the fully assembled `CHMS_HTML`
  (0 open/close mismatch, confirmed the `#tab-attendance` subtree specifically balances); a
  Node `vm`-based harness (fake DOM, ~5 years of realistic Sunday+special fixture data) that
  ran every render function (`attRenderAll`, all 5 panels, `attSetTab`, `attEntryInputChanged`,
  `attSaveEntry`'s PUT-existing-rows path, `attExportHistoryCsv`, `attRunCouncilPacket`/
  `attPrintPacket`, `attRunGivingVsAttendance`, History's `toggleAttEdit`) end-to-end without
  throwing. **Not verified**: an actual browser — no live browser exists in this environment, so
  none of the pixel-level spacing/typography, the heat-grid/bar hover tooltips, or the
  drag-to-resize-free layout at real 1440px/mobile widths were visually confirmed against the
  design handoff's screenshots; also not exercised against a live D1 database (harness used a
  synthetic in-memory fixture, not the real API). Done 2026-07-29 (v1.115.0). (`src/frontend/js-attendance.js`,
  `src/frontend/html-tabs.js`, `src/frontend/html-head.js`, `src/frontend/js-core.js`)

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
- [ ] **SC6 — Native Scheduler rewrite (decision reversed 2026-07-20 — now in progress, phased)** — Originally discussed during RDS5 (2026-07-15) and declined given the size (~5,900 lines). Revisited 2026-07-20 after three round-trip embed-transform bugs in one session (role-picker popover clipped by `.fw-layout`, then a scroll/focus regression, then a CSS-scoping miss where the popover was invisible in the actual embedded ChMS tab because `scheduler-inline.js` scopes all Scheduler CSS under `.sched-root`) — the exact class of risk this item always flagged, now confirmed live rather than hypothetical. A read-only feature-inventory pass found the bigger issue isn't the embed-transform surface (real, ~24 regex/string-literal rules, but containable) — it's that Scheduler's admin data (people, schedule, confirmations, history) lives in `localStorage`/a D1 key-value blob (`scheduler_data`), with "Scheduler people" as client-generated string ids completely disconnected from real ChMS `people.id` rows. **User's decision: relationalize** — a Scheduler volunteer should be a real `people` row, with search hitting the internal database (the existing `GET /admin/api/people?q=` endpoint) instead of Breeze. Requested explicitly incremental delivery, not a big-bang rewrite.
  - [x] **Phase 1** (2026-07-20) — Additive-only, no existing Scheduler behavior changed yet. New relational `scheduler_volunteers` table (`person_id` → real `people.id`, migration `0020`) + `handleSchedulerVolunteersApi()` CRUD in `src/api-scheduler.js` (list/create-upsert/sparse-PATCH/soft-DELETE, `admin`/`staff`-guarded). No new search endpoint — volunteer linking will reuse the existing People search endpoint. 8 new tests (`test/scheduler-volunteers.test.js`), `npm test` (94/94). See NOTES.md for full detail.
  - [x] **Phase 2** (2026-07-20, v1.38.0) — Migration/reconciliation tool. `matchLegacyVolunteer()` suggests real `people` matches (Breeze ID → exact name → fuzzy name/email), flagging ambiguous matches instead of guessing. New `GET migration-preview`/`POST migration-commit` endpoints (commit always re-reads roles/preferences from the legacy blob server-side, never trusts the request body for data, just for the link decision; refuses to double-link one person). New Settings → Import/Export card lets an admin/staff review and commit each legacy volunteer (link to suggested match / search someone else / create new person / skip) — no auto-linking, every row needs a human click per the user's explicit "methodically and slowly" instruction. 9 new tests (26 total). See NOTES.md for full detail.
  - [x] **Phase 3** (2026-07-20, v1.39.0) — Wired People & Availability to the relational data. `getPeople()`/`savePeople()` stay a synchronous localStorage array (avoids touching the ~50+ call sites across the file); new `syncRelationalVolunteers()` merges `/admin/api/scheduler/volunteers` into that same array once per pull, preserving a migrated volunteer's *original* legacy id so historical schedule/last-served references never orphan. Add/Edit Person panel's old Breeze-search box is now "Search ChMS People" (hits the same internal `/admin/api/people?q=` used elsewhere in the app) — new volunteers must link a real person; already-linked ones show read-only with a re-link toggle; not-yet-migrated legacy volunteers are completely unaffected. See NOTES.md for full detail including the verification harness.
  - [ ] **Phase 4 (next)** — Progressively port the remaining native-tab-eligible surfaces (see the full risk-tiered breakdown from the 2026-07-20 inventory pass, referenced in NOTES.md) — Focus Week, generate/auto-fill, reminders/ICS, Breeze import stay a separate, later decision per surface. Also consider: a "create new person directly from the Scheduler form" option (currently out of scope — add via People tab first, then link).

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
- DEPLOY_VERSION is at the top of `src/frontend/js-core.js` (moved from `html-chms.js` after IN3 split; now a plain `export const` since v1.35.0, not just a string inside the served script — see the app-JS-caching Architecture Note above). Bump it on every commit that changes the frontend. Format: `major.minor.patch` semver — patch for fixes, minor for new features, major for breaking changes. Started at `1.0.0` (2026-06-01, formerly v233). **Since v1.35.0 this bump is load-bearing, not just cosmetic**: it's the cache-busting query param on `/admin/app-core.js`/`/admin/app-ext.js`, so forgetting it means a JS-only change won't actually reach returning visitors' browsers even though the deploy succeeds.
- **Editing serve.timothystl.org** (formerly volunteer.timothystl.org): do NOT search/edit `src/html-templates.js` for ministry copy — the public page is assembled from `src/public/` modules. To tweak a ministry, edit `src/public/ministries/<name>.js` directly. Global CSS lives in `src/public/head.js`; all JS (form handlers, routing) in `src/public/scripts.js`.
- **Brand tokens** (Connect): `--color-navy:#1E2D4A`, `--color-teal:#2E7EA6`, `--color-gold:#C9973A`, `--color-cream:#F8F4EE`. Fonts: Cormorant Garamond (display) + DM Sans (head/body). Three-pillar pill system in topbar driven by `pillars` map in `js-core.js` `showTab()`.
- **member_type** is stored lowercased. Both Breeze write paths (per-person at line ~2442, bulk at line ~2777 of `api-import.js`) call `.toLowerCase()` before binding; a defensive `UPDATE … SET member_type=LOWER(member_type)` runs at end of each sync batch as a safety net. Frontend filters use `LOWER()` comparison.

---

## GitHub Repo

**Repo**: `timothystl/chms` (renamed from `timothystl/volunteer` 2026-04-25 — Worker is `tlc-chms`, D1 is `tlc-volunteer-db`)

## Dev Branch

Create a new branch for each session's work using the pattern `feature/<short-description>` (e.g. `feature/anniversary-widowed-fix`). Do not push directly to main.

**PR workflow:** When working in a cloud session (feature branch required by session config), create the PR using the GitHub MCP tool and immediately merge it — do not leave it as a draft for the user to merge. GitHub Actions deploys on merge to `main`. Always paste the PR URL in the chat so it's visible.
