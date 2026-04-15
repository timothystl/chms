# Dev Notes — Volunteer / ChMS App

This file is checked at the start of every debugging or improvement session.
Update it as issues are found, fixed, or queued.

---

## Architecture Quick Reference

- **Runtime**: Cloudflare Workers + D1 (SQLite at the edge)
- **Entry point**: `tlc-volunteer-worker.js` → routes to `src/api-chms.js` (people/giving/import) and other handlers
- **Frontend**: `chms-admin.html` + `src/html-chms.js` (rendered server-side as a single HTML string)
- **Auth**: role-based — `admin | finance | staff | member`
- **Breeze ChMS API base URL**: `https://<BREEZE_SUBDOMAIN>.breezechms.com/api/`

### Key Breeze API quirks
- `/api/profile` returns field definitions; the `id` on a field is NOT the key used in a person's `details` object — use `field_id` instead.
- `/api/people?details=1` returns people with a `details` object keyed by `field_id` values.
- DOB may live at `person.birth_date` (top-level) OR `details['birthdate']` (literal key) rather than under a numeric field ID.
- The built-in person-type field ID is `1076274773`; values `1=Member, 2=Attender, 3=Visitor`.
- `fk(field)` helper: `String(field.field_id || field.id)` — always use this to get the detail lookup key.

---

## Backlog — Requested Features & Fixes

Items below were provided by the admin on 2026-04-15. Needs clarification marked with ❓.

### Auth / Navigation
| # | Description | Priority | Status |
|---|-------------|----------|--------|
| A1 | Login screen should require both **username and password** — currently only a password field. Need to clarify: shared password now → per-user credentials? Or just a missing username field? ❓ | High | Queued |
| A2 | After login, redirect directly to the CHMS/people screen instead of a splash or home page | Medium | Queued |

### Performance / UX Polish
| # | Description | Priority | Status |
|---|-------------|----------|--------|
| P1 | Paginate all list views at **25 items per page** to speed up load times (people, households, giving, etc.) | High | Queued |
| P2 | Move the Breeze **import** controls into the **Settings tab** — currently hard to find | Medium | Queued |
| P3 | Edit gifts **inline on the person profile** — no separate window/tab needed | Medium | Queued |
| P4 | Edit **name and contact info** directly from the profile view (❓ clarify: is Edit button missing, or opens modal you want inline?) | Medium | Queued |

### Household & People Management
| # | Description | Priority | Status |
|---|-------------|----------|--------|
| H1 | Add **Organizations** section to left sidebar, below Households | Medium | Queued |
| H2 | Fix **"Add person to household"** flow — popup should let you search/select existing people OR create a new person; current text-only popup is broken | High | Queued |
| H3 | **Household-level giving** — combine and display giving totals for all household members (spouses, etc.) together | Medium | Queued |

### Directory / Print
| # | Description | Priority | Status |
|---|-------------|----------|--------|
| D1 | Directory print defaults to **member households only**; offer option to select which groups to include; non-member members of included households are still printed | High | Queued |
| D2 | Add **"Hide from directory" checkbox** on each profile | Medium | Queued |
| D3 | Printed directory formatted for **8.5×11**, includes **profile photos**, paginates **alphabetically** (A–C page 1, D–F page 2, etc.) | Medium | Queued |

### Breeze Import / Sync
| # | Description | Priority | Status |
|---|-------------|----------|--------|
| B1 | **Tag import broken**: Breeze has 99 people tagged "Voters" but only ~20 appear in app — investigate tag-member fetch logic | High | Queued |
| B2 | Add a clear **summary of what fields are synced** during a Breeze import (DOB, baptism, confirmation, etc.) — visible in the UI so admin knows what to expect | Low | Queued |

### Dedicated Sessions Required (Complex / Unknown Scope)
| # | Description | Priority | Status |
|---|-------------|----------|--------|
| S1 | **Register record creation from people records** is not working properly — needs full dedicated session to diagnose and fix | High | Queued — dedicated session |
| S2 | **Image/photo import** is broken — needs dedicated session | High | Queued — dedicated session |

### New Features
| # | Description | Priority | Status |
|---|-------------|----------|--------|
| N1 | **Multi-tag search** — AND logic across tags (e.g., show people who are both "Voters" AND "Volunteers") | Medium | Queued |
| N2 | **Scheduler app** should be integrated natively into this CHMS app rather than being a separate app | Low | Queued |

### Infrastructure / Planning (Discuss Before Acting)
| # | Description | Priority | Status |
|---|-------------|----------|--------|
| I1 | **Rename subdomain** — considering `chms.timothystl.org` or `admin.timothystl.org`; possibly fold in website editing and newsletter tools into one app | Low | Discussion needed |

---

## Resolved Issues

| # | Area | Description | Status |
|---|------|-------------|--------|
| R1 | Bulk Breeze import | Crashed on 2nd batch (HTML response instead of JSON) — added global try/catch + chunked NOT IN query for D1 param limit | Fixed 2026-04-15 |
| R2 | Per-person Breeze sync | Added `POST /admin/api/import/breeze-sync-person` endpoint + "Sync Breeze" button on profile | Fixed 2026-04-15 |
| R3 | Demographic fields blank | DOB, baptism, confirmation, anniversary, gender, marital status not populating — fixed `field_id` vs `id` lookup, literal key fallbacks, `findField` date-preference | Fixed 2026-04-15 |
| R4 | Confirmation field mismatch | `findField` matched "Confirmed" (dropdown) instead of "Confirmation Date" | Fixed 2026-04-15 |
| R5 | DOB field | Breeze "Age" field stores birthdate; added patterns + `details['birthdate']` literal fallback | Fixed 2026-04-15 |
| R6 | Individual gift edit | Gift edit modal not showing — duplicate modal ID bug | Fixed |
| R7 | Statement send | Send statement from profile was broken | Fixed |
| R8 | Demographics Edit button | Role/visibility CSS issue | Fixed |

---

## Recent Changes (newest first)

### 2026-04-15
- **NOTES.md created**: Added this dev reference file; backlog populated from admin-provided list.
- **Bulk import global try/catch** (`src/api-chms.js`): Wrapped entire `import/breeze` handler in try/catch so uncaught exceptions return `{ ok: false, error: "..." }` JSON instead of Cloudflare HTML error page.
- **Deactivation query batching**: Changed `NOT IN (?)` deactivation to process IDs in chunks of 90 to respect D1's ~100-parameter limit.
- **Per-person Breeze sync**: Added `POST /admin/api/import/breeze-sync-person` endpoint and "Sync Breeze" button on the profile demographics section.
- **Demographic field detection**: Fixed `field_id` vs `id` lookup, added literal key fallbacks, improved `findField` date-preference logic, updated `extractDate` to check `birth_date`/`birthday` keys.

---

## Useful Debug Patterns

### Check what Breeze fields are being matched
On the first batch of a bulk import, the response includes `_diag` with:
- `dob_field`, `baptism_field`, `confirmation_field` — which Breeze fields were matched
- `sample_detail_keys` — first 20 keys from first person's `details` object
- `all_profile_fields` — full list of field names/IDs from `/api/profile`

### Per-person sync diagnostic
`POST /admin/api/import/breeze-sync-person` returns `{ diag: { all_profile_field_names, detail_keys_in_breeze, detail_sample, field_matches, fetch_debug } }` — check browser console after clicking "Sync Breeze".

### Cloudflare Worker returning HTML instead of JSON
Means an uncaught exception escaped the handler. Check:
1. Is there a try/catch around the relevant endpoint block?
2. Are there any `await` calls outside try/catch that could throw?
3. D1 parameter limit (~100 per statement) — use chunked queries for large IN/NOT IN lists.

---

## Environment Variables (Cloudflare Worker secrets)
- `BREEZE_SUBDOMAIN` — subdomain for `<subdomain>.breezechms.com`
- `BREEZE_API_KEY` — Breeze API key
- `DB` — D1 database binding
