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

## Current Backlog Status

Full detail in `NOTES.md`. Summary:

- **Phases 1–5c**: All complete as of 2026-04-16 (v25).
- **Phase 6**: H1 (Organizations) and H3 (Household giving) done as of 2026-04-17 (v26). Remaining: N2 Scheduler integration, I1 Subdomain rename.
- **Anything added below this line was noted mid-session and not yet scheduled.**

---

## Queued Items (add new ones here during sessions)

<!-- Add items here as they come up. Format: - [ ] Description (noted YYYY-MM-DD) -->

### People List
- [ ] **PL1** — Revisit how the people list is divided: user primarily works with members but doesn't want to discard other contacts. Think through a better default view / filter strategy. Needs design conversation first. (noted 2026-04-17)
- [ ] **PL2** — Archive/Deceased people: how to handle people who have died or should be archived — separate status, hide from active lists, preserve giving history, show in a separate view. Needs design conversation. (noted 2026-04-17)

### Giving / Finance
- [x] **G1** — Fund import: pre-fetches `/api/funds` from Breeze to resolve real names; retroactively renames any "Breeze Fund XXXXX" placeholders on next sync. Done 2026-04-17.
- [x] **G2** — Edit individual gifts from person profile: click batch number → opens that batch; click a gift row → modal to edit that individual gift (amount, fund, date, method, check #, note). Done 2026-04-17 (v27).
- [ ] **G3** — Overall gift entry workflow improvements (user has more detail — revisit in dedicated session). (noted 2026-04-17)
- [ ] **G4** — Reopen batch button is broken/dead — investigate and fix. (noted 2026-04-17)
- [ ] **G5** — Export data: persons, giving (year-by-year), and register data — all useful formats for records/reporting. (noted 2026-04-17)

### Dashboard
- [x] **DB5** — Last worship card: show both services AND the combined total on a single card (not two separate cards). Done 2026-04-17 (v27).
- [ ] **DB6** — Dashboard customization: ability to add, remove, and reorder/move cards on the dashboard. (noted 2026-04-17)
- [ ] **DB7** — Anniversary dashboard spouse pairing misses some households — not all married couples are being grouped into one line. (noted 2026-04-17)

### Photos
- [ ] **PH1** — Household picture: ability to set/upload a photo for the whole household, or apply a member photo as the household picture. (noted 2026-04-17)
- [ ] **PH2** — Crop profile picture: add a crop/resize tool when uploading a profile photo. (noted 2026-04-17)
- [ ] **PH3** — Black bar appearing above some household cards — investigate and fix rendering bug. (noted 2026-04-17)

### People / Filters
- [ ] **PF1** — More filter-by-X options: filter people by missing data fields (no DOB, no address, no email, etc.) for data cleanup workflows. (noted 2026-04-17)

### Attendance / Reports
- [ ] **AT1** — Attendance table: add collapse/expand toggle so the full Sunday attendance table can be hidden. (noted 2026-04-17)
- [ ] **AT2** — Attendance graph direction: January should be on the left (currently reversed). (noted 2026-04-17)
- [ ] **AT3** — Attendance graphs: drag to resize charts. (noted 2026-04-17)
- [ ] **AT4** — Year-over-year giving/attendance report: overlapping graphs to compare current year vs prior year on the same chart. (noted 2026-04-17)

### Communications / Email
- [ ] **EM1** — Connect member email list to the newsletter the church sends out (integrate or export for mailing). Requires email infrastructure (Resend or similar). (noted 2026-04-17)
- [ ] **EM2** — Automated birthday/anniversary emails: automatically send a "Happy Birthday" or "Happy Anniversary" email to members on their day. Requires email infrastructure. (noted 2026-04-17)

### Scheduler
- [ ] **SC1** — Make the scheduler native to the CHMS app instead of linking out to an external scheduler. Large, unknown scope — needs scoping session. (noted 2026-04-17) — see Phase 6 N2.

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
- [ ] Pushed to `claude/continue-volunteer-app-xhY9J`, not main

---

## Gotchas & Patterns

- `disambiguateHHName(name, headFirst)` — shared helper at top of `api-chms.js`. Always use COALESCE fallback in `head_first_name` subqueries (not all members have `family_role='head'`).
- Dashboard birthday/anniversary: two separate cards since v23. Copy functions: `dashCopyBirthdays()` / `dashCopyAnniversaries()`. Anniversary rows are couple-paired by household+date in the API before returning.
- `api()` helper in frontend handles 401→redirect. Always use it instead of raw `fetch` for `/admin/api/*` calls.
- All modals have specific IDs (e.g. `person-modal`, `hh-modal`). There is no generic `modal-overlay`. Use `openModal(id)` / `closeModal(id)`.
- DEPLOY_VERSION is at the top of the `<script>` block in `html-chms.js`. Bump it on every commit.

---

## Dev Branch

Working branch: `claude/continue-volunteer-app-xhY9J`
Push to this branch. Do not push directly to main.
