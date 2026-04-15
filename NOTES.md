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

## Backlog — Phased Plan

Items ordered by effort. Complete one phase, test, then move to the next.
Added 2026-04-15, phased 2026-04-15.

---

### Phase 1 — Quick Wins (no DB changes, low risk) ✅ START HERE
| # | Description | Status |
|---|-------------|--------|
| A2 | After login, redirect directly to the CHMS/people screen instead of splash/home | Queued |
| P2 | Move the Breeze **import** controls into the **Settings tab** | Queued |
| B2 | Show a clear summary of which fields were synced during a Breeze import (visible in UI) | Queued |
| B1 | **Tag import broken**: Breeze shows 99 "Voters" but only ~20 in app — fix tag-member fetch logic | Queued |
| N1 | **Multi-tag AND search** — filter people who have ALL selected tags (e.g. Voters + Volunteers) | Queued |

**Test after Phase 1:** Login flow, Settings tab has import, tag counts match Breeze, multi-tag filter works.

---

### Phase 2 — UI Fixes (no schema changes)
| # | Description | Status |
|---|-------------|--------|
| H2 | Fix **"Add person to household"** — search/select existing people OR create new; current text popup is broken | Queued |
| P1 | Paginate all list views at **25 items per page** (people, households, giving) | Queued |

**Test after Phase 2:** Household member adding works both ways, lists load faster and paginate correctly.

---

### Phase 3 — Profile Editing Overhaul
| # | Description | Status |
|---|-------------|--------|
| P3 | Edit gifts **inline on the person profile** — no separate window | Queued |
| P4 | **Inline field editing on profile** — keep master Edit modal, but also click any field to edit in place | Queued |

**Test after Phase 3:** Can edit any profile field by clicking it; gift edits work inline; master Edit modal still works.

---

### Phase 4 — Directory (needs new DB columns for privacy flags)
| # | Description | Status |
|---|-------------|--------|
| D2 | **Per-field directory privacy** — profile toggles to hide address / phone / email / photo individually; person still appears in directory by name | Queued |
| D1 | Directory defaults to **member households only**; group filter option; non-member household members still included | Queued |
| D3 | Printed directory: **8.5×11**, includes profile photos, paginates **alphabetically** (A–C p.1, D–F p.2, etc.) | Queued |

**Test after Phase 4:** Privacy flags save per person; directory filters correctly; print layout looks right on paper.

---

### Phase 5 — Dedicated Sessions (schedule separately, unknown scope)
| # | Description | Status |
|---|-------------|--------|
| A1 | Per-user auth: enforce username+password, fix broken user management in Settings. Roles: Admin/Finance/Staff/Member | Queued — dedicated session |
| S1 | **Register record creation from people records** is broken — diagnose and fix | Queued — dedicated session |
| S2 | **Image/photo import** is broken — diagnose and fix | Queued — dedicated session |

---

### Phase 6 — Future / Planning
| # | Description | Status |
|---|-------------|--------|
| H1 | Add **Organizations** section to sidebar below Households (new entity type, DB schema) | Future |
| H3 | **Household-level giving** — combine/display giving totals across all household members | Future |
| N2 | **Scheduler app** integrated natively into this CHMS app | Future |
| I1 | **Rename subdomain** (`chms.timothystl.org` or `admin.timothystl.org`); possibly merge website editing + newsletter | Discussion needed |

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
