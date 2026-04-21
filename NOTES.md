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

### 2026-04-21
- **v89**: Force Remove Orphans. v88's Diagnose confirmed all 43 extras for the 2025 discrepancy were pure "orphan" rows (valid `breeze_id`, not in Breeze's current giving/list). Root cause: when the user deletes a whole batch in Breeze the `bulk_contributions_deleted` audit event references the batch, not the individual payment IDs — so the sync's `deletedPaymentIds` set misses them and re-imports them on every run. v86's Reconcile Orphans can't clean them because its "current replacement exists for same person+date" safety check fails for outright deletions. New endpoint `POST /admin/api/giving/force-remove-orphans` deletes DB entries whose `breeze_id` is not in giving/list for the window *without* that safety check. Safeguards: (1) admin-only (not just finance); (2) caller must pass `confirm_count` and `confirm_cents` matching what the server recomputes — refuses on mismatch so the button can't run against stale data; (3) refuses if giving/list returned fewer than 100 payments (truncation guard); (4) only touches `breeze_id != ''` rows (manual/quick-entry can never be affected); (5) logs an `audit_log` entry `force_remove_orphans` with the date range, cents total, and list of removed ids. UI: red "Force Remove N" button on the Diagnose results header (admin only, hidden when extras=0); confirm dialog shows count and total; on success, reruns the Giving by Fund report.
- **v88**: Giving reconcile diagnostic. New read-only endpoint `GET /admin/api/giving/reconcile-diagnose?from=YYYY-MM-DD&to=YYYY-MM-DD` returns every DB giving_entry in the date range alongside a classification for each row: `in_breeze` (breeze_id matches a Breeze giving/list payment ID), `no_breeze_id` (manual entry / quick-entry / pre-payment-ID import — invisible to Reconcile Orphans because its filter requires `breeze_id != ''`), `split_suffix_base_in_breeze` / `split_suffix_orphan` (CSV importer's `pid-N` multi-row split IDs), and `orphan` (breeze_id absent from Breeze). Response also includes per-fund extras totals (which funds carry the discrepancy), classification counts, a twin-detection pass (rows sharing person+date+amount across different breeze_ids), and a `missing_from_db` list (inverse: Breeze payments with no DB row). Use case: the 4-fund / 43-entry / $9,743.50 2025 discrepancy survives sync + reconcile-orphans, so this tool shows which rows are the extras and why they aren't cleaned up. "Diagnose" button added next to "Reconcile Orphans" on the Giving by Fund report; results view includes fund breakdown, per-row table, and "Export Extras CSV". Read-only — no `giving_entries` mutations. Finance-gated.
- **v87**: Fix giving sync re-importing contributions deleted in a later year. `contribution_deleted` and `bulk_contributions_deleted` audit log events were fetched with `end=${end}` (e.g. 2025-12-31 for a 2025 sync). A 2025 contribution corrected/deleted in 2026 has its deletion event in 2026, outside that window — so `deletedPaymentIds` missed it and the old entry was re-imported every sync. Fix: fetch deletion events with `end=today` (not capped at the sync window end). Addition and update events still use the original `end` so no new 2026 data bleeds into a 2025 sync.
- **v86**: Giving by Fund report improvements. (1) Total givers count now shown below the report title (parallel query on `COUNT(DISTINCT person_id)`). (2) New `POST /admin/api/giving/reconcile-orphans` endpoint: fetches Breeze giving/list for a date range, finds DB entries whose `breeze_id` no longer exists in Breeze, removes them (same safety check as the sync orphan pass). (3) "Reconcile Orphans" button added to the report — runs the cleanup for the same date range as the report and reloads if any orphans were removed. Addresses 2025 discrepancy: app $547,367 vs Breeze $537,624 due to stale pre-G10 orphaned entries.
- **v87**: Suppress benign `ResizeObserver loop completed with undelivered notifications` warning in both `window.onerror` and the `window.addEventListener('error')` handler, so the chart drag-to-resize code doesn't trigger the red error banner on pages with multiple charts (e.g. Reports tab).
- **v86**: Auth — shorten session lifetime. Cookie is now a session cookie (no `Expires`) so it dies when the browser closes. Absolute 7-day lifetime replaced with a 30-minute sliding idle timeout (`IDLE_TIMEOUT_MS` in `src/auth.js`); the cookie is refreshed on every authenticated request via `refreshAuthCookie` wrapped into the main fetch handler, so activity rolls the timeout forward. Addresses "logged in for 7 days = no password" concern. Frontend already redirects on 401 so no client changes needed.
- **v85**: G10 fix — Orphan cleanup pass added to Breeze giving sync. When Breeze edits a contribution it creates a new payment ID; the old DB entry becomes stale ("orphaned"). The supplement pass (v74) already imports the corrected version from giving/list; this new pass detects DB entries in the sync window whose `breeze_id` no longer appears in giving/list and removes them if a current replacement exists for the same person+date. This resolves G10 (correction pass was always 0) and allows G11/G12/G13/G14 corrections made in Breeze to apply automatically on next sync. Response now includes `orphansRemoved` count; status message updated accordingly.

### 2026-04-20
- **v84**: EM1 — Brevo newsletter sync. Three Brevo helpers in `src/api-emails.js` (`brevoUpsertContact`, `brevoBulkSync`, `brevoGetListContacts`). Three endpoints in `api-chms.js`: `POST /admin/api/brevo/sync-contact` (single contact, staff+), `POST /admin/api/brevo/bulk-sync` (all members, admin), `GET /admin/api/brevo/reconcile` (comparison view, admin). Auto-sync: on person PUT, if email changed and member_type='member', fires `brevoUpsertContact` (non-fatal). Frontend: "Add to Newsletter" button on person profile contact section; Settings card with "Check Brevo Sync" (reconciliation view showing missing members + Add All Missing button) and "Bulk Sync All Members".
- **v83**: EM2 — Automated birthday/anniversary emails via Resend. New `src/api-emails.js`: `sendBirthdayEmails` and `sendAnniversaryEmails` functions. Birthday: queries active members with today's dob MM-DD, sends personal email via Resend. Anniversary: pairs couples by household, sends one combined email for shared email addresses, separate emails otherwise; excludes deceased spouses. Both use `RESEND_API_KEY` + `EMAIL_FROM` already in worker. Daily cron added to wrangler.toml (`0 14 * * *` = 9am Central); `scheduled` handler added to `tlc-volunteer-worker.js`. Dedup via audit_log (`birthday_email_sent`/`anniversary_email_sent` actions). Admin test buttons in Settings tab. Manual trigger endpoints: `POST /admin/api/email/run-birthday` and `/run-anniversary` (admin only).
- **v82**: PL1 — Members-first people list. Default view shows Members only (`peopleFilter.mt` initializes to `'member'`). "Members" toggle button in toolbar highlights teal when active; clicking it calls `toggleMemberFilter()` to switch between `mt='member'` and `mt=''`. A "Member" filter chip appears below the toolbar with an × to clear. `renderActiveFilterChips()` and `updateFilterBadge()` now called after every `loadPeople` response so chip/button state is correct on initial tab load.
- **v81**: PL2 — Archive/Deceased person handling. New `status` column (`active|archived|deceased`) added to `people` table via DB migration; `active` field kept in sync. People list default view hides archived/deceased; "Archived" toggle button in toolbar switches to archived view with highlighted button and status pills on rows. Dashboard birthday/anniversary queries filter out archived/deceased. Three new API endpoints: `POST /people/:id/archive` (set status=archived, active=0), `POST /people/:id/unarchive` (set status=active, active=1, deceased=0), `POST /people/:id/deceased` (set status=deceased, deceased=1, death_date=today, active=0; promotes household head if deceased was head). Person profile shows Archive/Deceased buttons for active people; Reactivate button for archived/deceased; status badge next to member type. Anniversary cards exclude couples where either spouse is deceased via status OR deceased column check.
- **v80**: Extend drag-to-resize to all charts: (1) Main att chart YoY mode now respects `_attChartH` (passes it to `renderYoYChart`). (2) Attendance report YoY chart, (3) Attendance by Service chart, and (4) Giving Trend chart each get their own height var (`_yoyRptH`, `_byServiceRptH`, `_givingTrendH`) and a drag handle. Report charts re-render only the SVG portion on drag, preserving the table below. Added `_chartResizeHandle()` helper for consistent handle HTML. Added `_rptResizeMoveH` generic handler keyed by chart type.
- **v79**: Four UI improvements: (1) AT3 — Drag-to-resize attendance chart: added a drag handle below the attendance chart card; dragging adjusts `_attChartH` (120–600px range) and re-renders at the new height using `requestAnimationFrame`. (2) PH2 — Profile photo crop tool: selecting a photo now opens a crop modal with a canvas overlay; user can drag the crop box to reposition or drag corners to resize; "Crop & Upload" applies the crop before uploading; "Use Full Image" skips crop. (3) DB6 — Dashboard card customization: added a "⚙ Customize" button on the dashboard header that opens a modal with checkboxes to show/hide Follow-up Queue, First-Time Givers, Not Seen Recently, Birthdays, Anniversaries, and Membership by Type; preferences saved to localStorage. (4) AT4 — Year-over-year giving chart: new "Giving Trend" tile on the Reports tab; user selects which years to compare (defaults to last 3); calls new `/admin/api/reports/giving-trend` endpoint; renders a monthly line chart with per-year totals in the legend.

### 2026-04-19
- **v78**: Remove dangerous migration pass from v77 ghost fund redirect. The v77 pass did `UPDATE giving_entries SET fund_id=<general_fund_id> WHERE fund_id=<ghostLocalId>` — if fund 1771128 was previously linked by name to any real fund (not just a "Breeze Fund XXXXX" placeholder), this would move ALL of that fund's entries to General Fund, inflating totals. Fixed: keep the `fundByBreezeId` redirect for new imports only; existing entries with ghost fund must be corrected manually via Edit Gift modal.
- **v77**: Ghost fund redirect — hardcode Breeze fund 1771128 (deleted/retired) → General Fund (1718214). On sync: (1) any new contributions with the ghost fund ID now land in General Fund, (2) a migration pass updates existing DB entries pointing to the ghost fund's local record so they immediately display the correct fund name. G13 partially resolved: fund fixed, but if Breeze creates new payment IDs for the edited contributions, duplicates by person+date may exist and require manual cleanup via Edit Gift modal.
- **v76**: Three giving sync improvements: (1) Fetch `contribution_updated` from Breeze audit log and apply corrections to already-imported entries — uses giving/list current amounts as source of truth, scales multi-fund splits proportionally. (2) For new imports, override stale audit-log amounts with giving/list current data when a `glByPaymentId` match exists. (3) Full Breeze audit log CSV export via `GET /admin/api/giving/breeze-audit-export` with "Download Audit Log CSV" button in Settings; exports all action types with person names, both IDs, current amounts, and fund details. `correctedCount` added to diagnostics and sync result message.
- **v75**: Fix giving/list truncation — scope to sync window instead of all-time. The all-time range (2020-today, limit=10000) silently dropped early-year entries for churches with 15,000+ all-time contributions. Switching to sync window (lateStart–end) keeps the result under ~3,000 entries per year, well within the limit. This was causing ~100 contributions from early 2025 to be missing from the supplement.
- **v74**: Supplement audit log with giving/list entries for Tithely batch imports. Tithely contributions don't appear in any audit log action type — they're only in `/api/giving/list`. Now after processing audit log entries, giving/list entries with payment IDs not already seen are normalized into synthetic audit-log-format entries and processed identically. `givingListSupplementCount` diagnostic shows how many were added.
- **v73**: Fix batch grouping for older-format audit log entries. Some 2025 entries use `batch_edit_select` (internal Breeze batch record ID) instead of `batch_num`. These were falling back to date-based batch names ("Breeze Import YYYY-MM-DD") instead of being grouped into a single numbered batch. Now uses `batch_num || batch_edit_select` so all entries from the same Breeze batch are grouped together.
- **v72**: Also fetch `bulk_import_contributions` action from audit log in parallel with `contribution_added`. Tithely (external processor) batch imports land under this action type, not `contribution_added`, explaining why ~700 2025 contributions were missing from audit-log syncs. Entries are merged and deduplicated by payment ID before processing. Adds `contributionAddedCount`, `bulkImportCount`, and `bulkImportSample` to diagnostics so the structure of bulk entries can be verified.
- **v71**: G9 fix — import cross-year late entries (45-day grace window). Contributions whose contribution date falls within 45 days before the sync `start` are now imported with their actual contribution date instead of being skipped. Fixes Dec 2025 contributions logged in Jan 2026 that were previously never imported into either year. `seenIds` guard prevents double-import if both years are synced. Also bumps audit log limit from 3000 → 10000 to prevent silent truncation for high-volume years. New response field: `lateImported` (count of grace-window entries added). `lateEntries` diagnostic now only shows truly excluded entries (older than 45 days before start).
- **v70**: Fix merged/deleted Breeze fund IDs still showing as "Breeze Fund XXXXX". Root cause: `breezeFundNames` is only populated from Breeze API endpoints, which no longer return merged funds. Fix: scan all audit log entries for `fname-{uuid}` fields (recorded at log time, survives merges) and use those as a fallback source for `breezeFundNames` before the batch-rename block runs.
- **v69**: Code review improvements: add numeric guard on fund IDs before URL interpolation; replace silent catch{} with `diag.lateFundFetchWarnings` logging; update DEPLOY_VERSION date.

### 2026-04-18
- **v69**: Resolve fund names for late-entry fund IDs. Funds that appear only in date-filtered (late) entries were never reaching the individual API lookup, so they displayed as raw Breeze IDs in the lateEntries diagnostic. Now adds a targeted resolution pass for those IDs before Pass 2. Also fixes giving-list fallback fund lookup to prefer `fund_id` over row `id`.
- **v68**: Fix giving list harvest returning empty. Breeze requires date params — without them it returns []. Now uses fixed wide range (2020-01-01 to today) so all-time fund names are captured regardless of sync window.
- **v67**: Sync diagnostics now show `lateEntries` (contributions outside the sync date range, with date/amount/fund/method per entry) and `ghostFundContribs` (all DB contributions tied to still-unresolved "Breeze Fund XXXXX" funds). Both appear at the top of the diagnostics block after a sync.
- **v65**: Fix batch-rename of placeholder funds running before giving/list harvest. The rename block checked `breezeFundNames` before the giving list had been fetched, so it always had 0 names (since /api/funds returns empty for this account). Moved batch-rename to after the giving list harvest so the full name map is available.
- **v64**: Separate "already existed" from "outside date range" in sync status. The audit log filters by LOG DATE, so Dec contributions entered in Jan appear in the Jan sync window but have prior-year contribution dates. These were counted as "already existed" — now shown as "outside date range (logged late)" so a clean sync after deleting data shows 0 already-existed instead of a confusing number.
- **v63**: Harvest fund names from all-time giving list (no date filter) instead of current sync window only. Ensures fund IDs that appear rarely or only in older contributions are still resolved, preventing isolated "Breeze Fund XXXXXXX" stragglers.
- **v62**: Fix root cause of "Breeze Fund XXXXXXX" placeholder fund names. The giving list harvest used `f.id` (a 9-digit per-payment row ID unique to each giving-list row) as the key in `breezeFundNames`, instead of `f.fund_id` (the 7-digit actual Breeze fund ID that the audit log uses in `fund-` fields). Swapping to `f.fund_id || f.id` means the harvest now builds `breezeFundNames['1718214'] = '40085 General Fund'`, which matches what the audit log reads. On next sync the batch-rename block will update all existing "Breeze Fund XXXXXXX" records to their real names.
- **v61**: Show sync diagnostics in UI. After "Sync Date Range" completes, full JSON diagnostics object renders in a scrollable pre block directly below the status message. Also improved the status line to report dupes removed, funds renamed, and funds created.
- **v60**: Add comprehensive diagnostics to Breeze giving sync response. `diagnostics` object now includes: (1) `apiFundsSample` — what `/api/funds` returned after bulk fetch; (2) `givingListSample` — raw structure of first 3 giving/list entries (shows keys, fund/funds fields); (3) `auditLogSample` — parsed details of first 3 audit log entries, showing all fund-*, fname-*, amount-* fields; (4) `breezeFundNamesAfterHarvest` — complete map of all fund IDs+names gathered from both sources; (5) `unresolvedFundIds` — fund IDs that would become "Breeze Fund XXXXX" placeholders. Purpose: diagnose why fund names aren't resolving and which ID system the audit log uses.

### 2026-04-17
- **v53**: Fix Breeze giving sync hitting Cloudflare D1 per-invocation limit. Root cause: per-entry sequential D1 awaits inside the processing loop (one UPDATE per entry for batch-date correction, one per fund for linking). Replaced with a two-pass approach: Pass 1 pre-scans all entries to collect needed batches/funds; all creates/updates are then executed via db.batch() (each batch = 1 D1 call). Pass 2 builds entry inserts with no D1 calls in the loop. Total D1 calls reduced from O(entries) to ~10 regardless of sync size. Also added "Clear Giving by Year" danger-zone button + API endpoint so a single year can be wiped without touching others.
- **v52**: Fix cross-chunk split-payment imports. Increased CSV chunk size from 500 → 5000 rows so an entire year of giving data is processed in one API call; nth-occurrence tracking (v51) now reliably handles all split-fund rows. Added "Look Up Payment ID" card in Settings import section (GET /admin/api/giving/by-payment-id) to see which fund/amount was recorded for any Breeze payment ID.
- **v51**: Fix giving CSV import for multi-row split payments. Breeze exports one row per fund for split donations (same Payment ID, different fund/amount). Previously the second row was treated as a duplicate and the fund was silently dropped. Now tracks nth-occurrence of each payment ID within a chunk; assigns entry IDs pid (1st), pid-2 (2nd), pid-3 (3rd), etc. Duplicate check uses pid-N for subsequent occurrences. Also returns dupIds list in response; frontend shows expandable list of skipped payment IDs after import completes.
- **v50**: Fix anniversary pairing when spouse is a visitor/non-member. Secondary household lookup no longer filters by member_type — the qualifying person already passed that check; their partner is pulled in regardless of member type. Common pattern: one spouse is a member, the other is a visitor.
- **v49**: Fix anniversary pairing for spouses without head/spouse family_role. Secondary household lookup (for solo entries) previously only found partners with `family_role IN ('head','spouse')`; broadened to any active non-deceased household member with a relevant member type, preferring head/spouse roles but falling back to any match. Fixes Todd & Jessica Shasserre showing solo.
- **v48**: Giving by Fund report groups funds by numeric code prefix. Funds sharing the same code (e.g. "40085 General Fund", "40085 Christmas Offering", "40085 Lenten") are collapsed under a grey group header row with an indented list and a subtotal line. Funds with a unique code or no code show as flat rows. No API change — grouping is client-side.
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
