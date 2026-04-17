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
- [ ] **PL1** — Revisit how the people list is divided: user primarily works with members but doesn't want to discard other contacts. Think through a better default view / filter strategy. (noted 2026-04-17)

### Giving / Finance
- [ ] **G1** — Fund import broken: giving records coming in with fund name "breeze fund XXXXX" instead of real fund name. Fix Breeze giving import to resolve fund names correctly. (noted 2026-04-17)
- [x] **G2** — Edit individual gifts from person profile: click batch number → opens that batch; click a gift row → modal to edit that individual gift (amount, fund, date, method, check #, note). Done 2026-04-17 (v27).
- [ ] **G3** — Overall gift entry workflow improvements (user has more detail — revisit in dedicated session). (noted 2026-04-17)

### Dashboard
- [x] **DB5** — Last worship card: show both services AND the combined total on a single card (not two separate cards). Done 2026-04-17 (v27).
- [ ] **DB6** — Dashboard customization: ability to add, remove, and reorder/move cards on the dashboard. (noted 2026-04-17)

### Attendance / Reports
- [ ] **AT1** — Attendance table: add collapse/expand toggle so the full Sunday attendance table can be hidden. (noted 2026-04-17)
- [ ] **AT2** — Attendance graph direction: January should be on the left (currently reversed). (noted 2026-04-17)
- [ ] **AT3** — Attendance graphs: drag to resize charts. (noted 2026-04-17)
- [ ] **AT4** — Year-over-year giving/attendance report: overlapping graphs to compare current year vs prior year on the same chart. (noted 2026-04-17)

### Communications / Email
- [ ] **EM1** — Connect member email list to the newsletter the church sends out (integrate or export for mailing). (noted 2026-04-17)
- [ ] **EM2** — Automated birthday/anniversary emails: automatically send a "Happy Birthday" or "Happy Anniversary" email to members on their day. (noted 2026-04-17)

### Scheduler
- [ ] **SC1** — Make the scheduler native to the CHMS app instead of linking out to an external scheduler. (noted 2026-04-17) — see Phase 6 N2.

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
