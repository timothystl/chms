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

### Phase 1 — Quick Wins (no DB changes, low risk) ✅ DONE 2026-04-15
| # | Description | Status |
|---|-------------|--------|
| A2 | After login, redirect directly to the CHMS/people screen instead of splash/home | Done |
| P2 | Move the Breeze **import** controls into the **Settings tab** | Done |
| B2 | Show a clear summary of which fields were synced during a Breeze import (visible in UI) | Done |
| B1 | **Tag import broken**: added `POST /admin/api/import/breeze-sync-tags` — clears and re-syncs all tag assignments; "Sync Tags Only" button in Settings | Done — needs test |
| N1 | **Multi-tag AND search** — tag filter upgraded to checkboxes; selecting multiple tags shows only people with ALL tags | Done |

**Test after Phase 1:** Login lands on People tab. Settings tab has all import tools. Run "Sync Tags Only" and verify Voters tag shows ~99 people. Check multi-tag filter selects people with both tags.

---

### Phase 2 — UI Fixes (no schema changes) ✅ DONE 2026-04-16
| # | Description | Status |
|---|-------------|--------|
| H2 | Fix **"Add person to household"** — search/select existing people OR create new; current text popup is broken | Done |
| P1 | Paginate all list views at **25 items per page** (people, households, giving) | Done |

---

### Phase 3 — Profile Editing Overhaul ✅ DONE 2026-04-16
| # | Description | Status |
|---|-------------|--------|
| P3 | Edit gifts **inline on the person profile** — no separate window | Done |
| P4 | **Breeze-style section-level inline editing** — Contact, Demographics/Dates, Tags, Notes each have an Edit button that expands the section into an inline form; Save/Cancel in the section header | Done |

---

### Phase 4 — Directory ✅ DONE 2026-04-16
| # | Description | Status |
|---|-------------|--------|
| D2 | **Per-field directory privacy** — profile toggles to hide address / phone / email | Done |
| D1 | Directory defaults to **member households only**; type filter buttons; whole household shown when any member qualifies | Done |
| D3 | Printed directory: letter section headers, avatar initials, page-break-inside avoid | Done |

---

### Phase 5 — Dedicated Sessions (schedule separately, unknown scope)
| # | Description | Status |
|---|-------------|--------|
| A1 | Per-user auth: enforce username+password, fix broken user management in Settings. Roles: Admin/Finance/Staff/Member | Queued — dedicated session |
| S1 | **Register record creation from people records** is broken — diagnose and fix | Queued — dedicated session |
| S2 | **Image/photo import** is broken — diagnose and fix | Queued — dedicated session |

---

### Phase 5b — Dashboard & Household View Improvements
| # | Description | Status |
|---|-------------|--------|
| DB1 | Dashboard people count — members only (not all person types) | Queued |
| DB2 | Dashboard households count — members only | Queued |
| DB3 | Dashboard last services — show both Sunday services | Queued |
| DB4 | Dashboard birthdays/anniversaries — month-at-a-time view with copy/paste export | Queued |
| HV1 | Household view — filter by member type (members-only or selectable) | Queued |

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
| R9 | Breeze member_type over-count | Built-in type field (1076274773) labeled nearly everyone as Member; fixed resolution order — built-in only used when no custom Status field exists | Fixed 2026-04-16 |
| R10 | Blank-status default to Member | Fallback used `configuredMemberTypes[0]` (Member) for people with no Breeze status; changed to always default to 'Other' | Fixed 2026-04-16 |
| R11 | Deactivation wipe | Chunked NOT IN on seen-ID set deactivated everyone; fixed to compute to-deactivate set in JS then use IN | Fixed 2026-04-16 |
| R12 | Tag sync Worker timeout | Per-person DB queries in phase=sync caused 30s timeout; replaced with single bulk SELECT + db.batch() inserts | Fixed 2026-04-16 |
| R13 | Tag sync embedded in import | Auto-tag-sync at end of final import batch timed out Worker; moved to separate auto-triggered call from frontend | Fixed 2026-04-16 |

---

## Recent Changes (newest first)

### 2026-04-16
- **v8**: Fixed blank-status people defaulting to Member (R10).
- **v7**: Fixed tag sync Worker timeout — batch DB ops (R12).
- **v6**: Fixed deactivation wipe bug (R11); removed tag sync from import (R13); added Restore All Active button.
- **v5**: Fixed member_type over-count from built-in Breeze type field (R9).
- **v4**: Fixed directory member filter (D1); fixed label accessibility errors (74 resources).
- **Phase 4 complete**: D1 member filter, D2 per-field privacy, D3 print layout (v4).
- **Phase 3 complete**: P3 inline gift editing and P4 Breeze-style section-level inline editing shipped (v3).
- **Phase 2 complete**: H2 add-to-household with create-new-person option; P1 pagination already done.
- **NOTES.md updated**: Marked phases 2, 3 & 4 done; resolved issues R9–R13 documented.

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
