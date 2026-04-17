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
| A1 | Per-user auth: enforce username+password, fix broken user management in Settings. Roles: Admin/Finance/Staff/Member | Done 2026-04-16 — Add User modal fixed (v24); FINANCE/STAFF/MEMBER env-var fallbacks removed; ADMIN_PASSWORD break-glass retained |
| S1 | **Register record creation from people records** — diagnose and fix | Done 2026-04-16 — endpoint confirmed correct; DOB/Place of Birth/Baptism Place added to edit form |
| S2 | **Image/photo import** — diagnose and fix | Done 2026-04-16 — bulk import already syncs photos via p.path; per-person sync now also updates photo_url; diagnostic output added |

---

### Phase 5b — Dashboard & Household View Improvements
| # | Description | Status |
|---|-------------|--------|
| DB1 | Dashboard people count — members only (not all person types) | Done (prior session) |
| DB2 | Dashboard households count — members only | Done (prior session) |
| DB3 | Dashboard last services — show both Sunday services | Done (prior session) |
| DB4 | Dashboard birthdays/anniversaries — month-at-a-time view with copy/paste export | Done 2026-04-16 (v23): two separate cards, bulletin copy format, anniversary couple pairing |
| HV1 | Household view — filter by member type (members-only or selectable) | Done (prior session) |

---

### Phase 5c — People & Household Data Quality
| # | Description | Status |
|---|-------------|--------|
| HQ1 | **Household-level contact info** — "Push address to members without one" button in household edit modal + same from person profile; never overwrites existing individual addresses | Done 2026-04-16 |
| HQ2 | **Baptized/Confirmed without a date** — boolean flag separate from date fields; allow marking someone as baptized or confirmed even when no date is known (new DB columns: `baptized INTEGER`, `confirmed INTEGER`) | Done |
| HQ3 | **Sort by household in people view** — add "Household" as a sort option in the people list alongside existing last_name / first_name / member_type / created_at options | Done 2026-04-16 |
| HQ4 | **Disambiguate same-last-name households** — when multiple households share a last name, auto-label as "John Smith Family" / "Joe Smith Family" using the head-of-household's first name | Done 2026-04-16 (v22); COALESCE fallback fixed v23 |

---

### Phase 6 — Future / Planning
| # | Description | Status |
|---|-------------|--------|
| H1 | Add **Organizations** section to sidebar below Households (new entity type, DB schema) | Done 2026-04-17 (v26) |
| H3 | **Household-level giving** — combine/display giving totals across all household members | Done 2026-04-17 (v26) |
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

### 2026-04-17
- **v47**: Giving CSV import — three correctness fixes: (1) Negative entries (refunds/adjustments) were silently dropped by `cents <= 0` check; changed to `cents === 0` so negative adjustments are now imported. (2) Fund name "nan" (blank fund exported by Excel/Python) now maps to General Fund instead of creating a junk fund record. (3) Person IDs with trailing `.0` float suffix (e.g. `43826663.0`) now normalized by stripping `.0` so giving entries link correctly to people.
- **v46**: AT1, AT2, PF1, PH1, HQ4 — (AT1) Attendance table collapse/expand toggle button above the Sunday list. (AT2) Fix attendance-by-service chart direction: ORDER BY ASC so January plots left, December plots right. (PF1) Filter people by missing data fields: multi-select checkboxes organized by category (Main/Family/Other/Contact) in filter drawer; AND logic finds people missing all selected fields; chips shown for each active missing-field filter. (PH1) Household photo upload: replace plain URL field with upload button + preview in hh-modal; POST /admin/api/households/:id/photo → R2 → DB. (HQ4) Household head robustness: GET /admin/api/households/no-head-count and POST /admin/api/households/fix-heads promote spouse or first member to head for headless households; Settings card shows count and fix button.
- **v45**: PH3 — Fix black bar above household card photos. Wrapped img in a container div with matching background-color and border-radius; onerror now hides the whole container so the 80px slot disappears entirely on load failure instead of showing a dark broken-image rectangle.
- **v44**: Anniversary propagation on manual person save — when anniversary_date is set on a head/spouse, automatically copies it to their household partner if the partner has none. Covers manually-added people who never sync to Breeze.
- **v43**: Anniversary improvements — (1) Breeze import now propagates anniversary_date to spouse when only one has it set; (2) anniversary dashboard card hides entries where either spouse is deceased.
- **v42**: DB7 — Fix anniversary spouse pairing for couples where only one person has the anniversary_date set in Breeze (the other's field is blank). After the initial grouping pass, a secondary household lookup finds the head/spouse partner and adds them to the entry. Covers the common Breeze pattern where only the household head has the date.
- **v41**: Add "Clear All Funds" button in Settings danger zone. Deletes all fund records (not giving entries) so garbage fund names from bad imports can be wiped before re-importing. API: DELETE /admin/api/funds/all (admin only).
- **v40**: Keep Breeze fund number prefix in fund names. The v36 parseFundSplits change stripped "40085" from "40085 General Fund" — user wants the full name including the number. Regex now strips only the trailing amount in parens, leaving the rest of the name intact.
- **v39**: Fix "Internal server error" on Breeze sync. Root cause: `import/breeze-giving`, `import/breeze-sync-person`, and `import/breeze-giving-csv` had no outer try/catch — any uncaught exception escaped to the api-admin.js outer catch and returned the generic "Internal server error" message instead of a descriptive one. Added try/catch to all three. Also fixed the export endpoints being unreachable (404): added `seg.startsWith('export/')` to the ChMS dispatch condition in api-admin.js.
- **v38**: G5 — Export Data. Three CSV download buttons in Settings → Data Import & Sync: Export All People (name, contact, dates, household, member type), Export Giving (year selector, all entries with date/person/fund/amount/method), Export Register (all baptism/confirmation/wedding records). API: GET /admin/api/export/{people,giving,register}; people/register = admin-only, giving = finance+.
- **v37**: G4 — Fix reopen/close batch buttons. Previously both did an extra GET pre-fetch; if that fetch silently failed, `batch_date`/`description` were undefined and dropped by JSON.stringify (data corruption), and errors were invisible making the button look dead. Now uses `_currentBatch` (stored on render) directly — no extra round-trip — and adds `.catch()` with alert so failures surface instead of disappearing.
- **v36**: Fix giving CSV import — `split(/\\r?\\n/)` in String.raw was emitting literal `\\r?\\n` to the browser, so the file never split into lines and 0 rows were processed. Fixed to `split(/\r?\n/)`. Also fixed `parseFundSplits` to strip Breeze's numeric fund ID prefix (`40085 General Fund` → `General Fund`) so imported gifts match existing fund records by name.
- **v28**: G1 full fix — added `POST /admin/api/import/fix-fund-names` standalone endpoint + "Auto-Fix Fund Names from Breeze" button in Settings. Handles `{funds:[...]}` response format from Breeze in addition to plain array. CSV import now also renames existing placeholder funds when it sees the real name from the CSV data, and shares `fundByName` cache with `fundByBreezeId` for de-dup. Response now includes `breezeFundsFound` for diagnostics.
- **G1 fix**: Breeze giving import now pre-fetches `/api/funds` at the start of every sync to build a real fund-name map. Fixes "Breeze Fund XXXXX" placeholders appearing as fund names. Also retroactively renames any already-corrupted placeholder funds on the next sync. Response now includes `fundsRenamed` count. (api-chms.js only — no frontend change)
- **v27**: G2 — person profile giving tab: added Batch column (clickable → navigates to that batch in the Giving tab), gift rows are now clickable (opens edit-gift-modal instead of inline editing), edit modal title shows batch # and hides Save button for closed batches. DB5 — last worship stat card now shows both services + combined total on a single card instead of two separate cards.
- **v26**: H1 — Organizations tab added (sidebar between Households and Giving; new `organizations` DB table; full CRUD API + UI with card grid, search, pagination, add/edit modal). H3 — Household giving summary added to household detail modal (finance+ only; shows last 5 years of giving totals for all household members).

### 2026-04-16
- **v23**: HQ4 fix — COALESCE fallback in all 3 disambiguation paths so households without a 'head' role still get disambiguated. DB4 — birthday and anniversary split into two separate dashboard cards; anniversary couples (same household + same date) paired into one line ("Bob & Alice Johnson"); bulletin copy format: "Apr  5  John Smith" with year in header.
- **v22**: HQ4 — household name disambiguation. `disambiguateHHName()` helper in API; households list query now fetches `head_first_name` + a global dup-name check computes `display_name` per row. Same for `households/:id` and `people` (list + single record adds `household_display_name`). Frontend uses disambiguated name in household cards, detail modal, people table, person profile badge, and both household autocompletes. Pattern: "Smith Family" → "John Smith Family".
- **v21**: HQ3 — "Household" sort column added to people list (API + clickable header). HQ1 — sync-address endpoint now only updates members with no existing address (never overwrites); returns updated count. "Push address to members without one" button added to household edit modal and updated on person profiles.
- **v11**: Register edit form — DOB, Place of Birth, Baptism Place fields added (Goal 2). Autofill `name=` attributes added to all form fields missing them (~50 fields across all modals, Goal 3). Per-person Breeze sync now updates photo_url + exposes photo diagnostic (Goal 4).
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
