# PLAN.md — CR10 Remediation Plan (Phases 21–28)

**This file is the running order for all open work.** It was written 2026-08-19 out of the CR10
whole-codebase review and lives here, rather than inside `CLAUDE.md`, for one reason: `CLAUDE.md`
is ~600 KB and a session that skims or truncates it will not find the plan. This file is small
enough to read whole.

**Every open item in the project is in exactly one phase below, under one alphanumeric code**
(`P<phase>-<letter>`). Each code names the original item code(s) it retires, so a search for
`SEC12` or `PAL5` still lands somewhere.

**The evidence for each finding is in `CLAUDE.md`** — the `CR10` entry under Queued Items holds
the measurements and the reasoning; this file holds only the order of work and the decision made.
Update BOTH when an item ships: check the box here, and mark the original code closed there.

Phases 21 and 22 are ordered by risk; 23 onward by dependency, not urgency.

---

## The work queue — priority order (rebuilt 2026-08-20)

**Read this table, not the phase numbers.** The phases below were written 2026-08-19 when authorization
was on fire; Phase 21 is now complete and Phase 22 is 5 of 7 done, so phase order no longer equals work
order. **The codes never change** — `P24-A` is `P24-A` forever, because CLAUDE.md, NOTES.md and every
shipped commit reference them. Only the ORDER below is re-decided.

**36 items open** (P22-E, P24-C and P26-A all closed 2026-08-22 — see below). Take the next
unchecked row. Detail for every code is in its phase section further down.
### Tier 1 — Finish the security work (small, bounded, do first)

| # | Code | Size | What |
|---|---|---|---|
| 1 | ~~**P22-E**~~ | small | DONE 2026-08-22. Login rate limiting, intake rate limiting and QuickBooks OAuth `state` now fail **closed**, not open, with no `RSVP_STORE`. || 2 | ~~**P22-F**~~ | small ×5 | DONE 2026-08-22. Break-glass `===` compare · fixed rate-limit window · `X-Breeze-Subdomain` validation · photo-proxy scheme check · `Set-Cookie` off immutable assets. |

**Tier 1 complete. Tier 2 items 3-4 (P24-C, P26-A) also done.** Next up: item 5, `api()` + P25-D.

### Tier 2 — Things that are wrong on screen right now

Highest payoff per line changed in the whole plan. Two of these are user-reported.

| # | Code | Size | What |
|---|---|---|---|
| 3 | ~~**P24-C**~~ | ~2 lines | DONE 2026-08-22. Council display-name label was already fixed by an earlier session; the write-refusal string in `api-chms.js` still said "office" — now says "council". |
| 4 | ~~**P26-A**~~ | small | DONE 2026-08-22. Nine CSS custom properties are now declared, with a build-time assertion added so a future one can't go undefined the same way. || 5 | **P24-A** + **P25-D** | **large — see note** | `api()` resolves instead of rejecting on a server error whenever `opts` is passed, so **54 write call sites report success on failure**. This is the mechanism behind the SAC1/SAC3 "Save failed with no reason" reports. |
| 6 | **P24-B** | medium | Dashboard: ~11 serial D1 round-trips, and two staff opening it the same Monday both seed the weekly tasks and leave ten. |

> **⚠ Why 5 merges two codes.** P24-A rewrites `api()`; P25-D routes seven `js-finance.js` uploads
> through `api()` and replaces eight hardcoded `/chms` 401 redirects. Both sweep the same call sites.
> Doing them separately means auditing 230 `api()` calls twice, and the second sweep lands on code the
> first one just changed. **One PR.** And the sweep is not optional within it: flipping `api()` to reject
> without adding a `.catch` to all 54 sites turns silent failures into unhandled rejections.

### Tier 3 — Load speed, cheapest first

The church network is slow; AU2 has been open since July for that reason.

| # | Code | Size | What |
|---|---|---|---|
| 7 | **P25-A** | one-liner | The two scheduler-embed assets bypass `assetCacheControl()` — and the test's own `ASSETS` list encodes the gap. |
| 8 | **P25-B** | one-liner | Hoist the pure asset routes above `await initDb(env.DB)`. None touch D1. |
| 9 | **P25-C** | medium | Self-host the fonts. **⚠ AU2 is written as a login-page item and is not one** — the app shell blocks on three families at 17 weight/italic combinations with no `preconnect` at all. |
| 10 | **P25-G** | medium | `serve.timothystl.org` is 204.5 KB with **no `Cache-Control` at all** and is identical for every visitor. The church's public front door, on the same slow network. |
| 11 | **P25-E** | large | Split `app-ext.js` (1,273 KB) along the permission line. A `staff` account with `finance: none` downloads all 696 KB of Finance. **⚠ Keep CR9's two rules: fail SAFE, and pin "no global defined twice".** |
| 12 | **P25-F** | large | The 194 KB `no-store` shell. Needs the boot sequence looked at, not another mechanical extraction. |

### Tier 4 — Authentication foundation (scope before writing code)

| # | Code | Size | What |
|---|---|---|---|
| 13 | **P23-A** | needs scoping | Session cookies are HMAC-signed with `ADMIN_PASSWORD`, a human-chosen password that any member can grind offline. Move to a `SESSION_SECRET`. **⚠ The migration is the hard part, not the change.** |
| 14 | **P23-B** | needs scoping | MFA for `admin` and `finance`. **P23-A first** — MFA over a guessable session key buys less than it looks like. |

> Placed below Tier 3 on **sequencing, not importance**. P23-A is the most valuable remaining security
> item; it is also the one that can log the whole staff out mid-week if the rollout is wrong, so it wants
> a session of its own rather than a slot in a queue.

### Tier 5 — Hand-off and repo hygiene (all small)

Raised from last position: a session already failed to find the plan once, and two of these are the
same class of problem.

| # | Code | Size | What |
|---|---|---|---|
| 15 | **P27-C** | minutes | `npm audit fix`. Back to 6 high; all dev-tooling, none reaching the Worker. Recurring chore. |
| 16 | **P27-A** | small | **"See FIN58" currently resolves to three different features.** Suffix the later duplicates; do not renumber. |
| 17 | **P27-B** | small | The American-English check returns 27, and the file says it should return nothing. **⚠ Four hits are the rule quoting its own examples — exclude those lines or it can never be green.** |
| 18 | **P27-D** | small | Delete ~800 KB of dead tracked files. **⚠ Confirm nothing outside the repo serves them** — a root `CNAME` suggests Pages once did. |

### Tier 6 — Design system consolidation

P26-A is **not** here; it is item 4, because it is a bug.

| # | Code | Size | What |
|---|---|---|---|
| 19 | **P26-B** | medium | Continue PAL7's exact-match hex pass. 423 literals, 171 distinct; the top two are `--color-teal` and `--color-gold` longhand. **⚠ Keep PAL7's two rules.** |
| 20 | **P26-C** | medium | 1,168 legacy token references against 314 brand ones. `--ev-*` is down to 38 and can go first. |
| 21 | **P26-E** | small | Reconcile the palettes. RD1 counted three; there are **five across four surfaces**. Scope from five. |
| 22 | **P26-F** | large | The a11y pass MO5 deferred: 128 click handlers on non-interactive elements against 2 `tabindex` and 9 `role=`. |
| 23 | **P26-D** | **with the redesign** | ~3,900 pure-layout inline `style=` attributes. A refactor, not a substitution — RD2's own decision was to let it ride. Keep it there unless the redesign slips. |

### Tier 7 — Carried forward (P28-A … P28-O, not from CR10)

Fifteen pre-existing backlog items, listed so nothing is orphaned. Not ordered against each other — but
three are trivial and blocked only on somebody doing them:

- **P28-L** — set `CHMS_INTAKE_API_KEY` on `tlc-newsletter-admin`. One command. Until then G23's endpoint 401s.
- **P28-M** — point the `/volunteer` short-URL redirect at `serve.timothystl.org`. Website-repo D1 data, not code.
- **P28-K** — confirm the live daycare endpoint renders. Needs two secrets and one button.

And one is the gate on everything the member tier was built for:

- **P28-N** / **TLY1** — **invite member accounts at scale.** CONN2 built the flow; nobody has been invited,
  so the directory has an audience of one. Organizational, not technical. **This is what makes SEC11-SEC22
  worth having fixed.**

---

## Standing rules for every phase

These are why the earlier phases held up:
one phase per PR · `npm test` green before and after · `DEPLOY_VERSION` bumped on any frontend change ·
every new test checked for vacuity by injecting the exact regression it guards · a `Not verified` line
naming what was not exercised (a live browser, a real phone, real D1, a real sent email).

---

## Phase 21 — Authorization emergency ✅ COMPLETE 2026-08-19 (v1.191.0)
**Goal:** close the two paths that let the lowest-trust account in the app act as the church, and the
stored-XSS class that reaches an admin session from a public form. **Nothing else belongs in this PR.**

- [x] **P21-A** — DONE 2026-08-19 (v1.191.0), retires **SEC11**. Was: Role-gate `POST /email/send`. The gate is `schedAuthed` in
  `tlc-volunteer-worker.js`, not the handler. `admin`/`staff` only, matching SW1/SW2's decision for the
  `/admin/api/scheduler/*` siblings.
- [x] **P21-B** — DONE 2026-08-19 (v1.191.0), retires **SEC12**. Was: Role-gate the Breeze proxy (`/api/*`, `/breeze/*`) and the rest of the
  `schedAuthed` block: `/serve/pending`, `/serve/general-pending`, `/serve/event-pending`, `/rsvp/store`,
  `/rsvp/sync`. `/esv/passage` is the one that can stay open to any authenticated role. **⚠ The
  `X-Worker-Secret` bypass must keep working** — the scheduler's own server-to-server calls ride it.
- [x] **P21-C** — DONE 2026-08-19 (v1.191.0), retires **SEC13** — and it went further than planned: testing the helper showed **`volJsAttr` was injectable on its own** (it escaped the quotes `JSON.stringify` added but not a literal `&quot;` already in the value), so all 25 call sites were wrong, not one. Fixed in the helper. Was: `js-volunteers.js:122`: drop the inner `esc()` from the three
  `volJsAttr(esc(…))` calls, or move the button to the `data-*` + delegated-listener pattern already used by
  the Email button two lines below. **⚠ `volJsAttr` alone is correct; wrapping it in `esc()` is what breaks
  it.**
- [x] **P21-D** — DONE 2026-08-19 (v1.191.0), retires **SEC14**. All five converted to `jsAttr(raw)`, plus `bzlPickSearchResult` normalized even though its ordering happened to be safe. Was: The five autocomplete handlers: `js-households.js:811` and `:847`,
  `js-reports.js:1441`, `js-export-import.js:813`, `js-tuition-aid.js:1408`. **⚠ Do not copy the neighboring
  line to fix these** — `js-export-import.js:925` is the only one that gets the ordering right (replace on
  the raw string *first*, so the `&` double-encodes), and three of the five carry a `.replace(/'/g,'&#39;')`
  that is a no-op and reads as protection.
- [x] **P21-E** — DONE 2026-08-19 (v1.191.0). `test/inline-handler-escaping.test.js`: three source scans plus the real shipped `jsAttr` driven through a full attribute-decode-and-execute round trip against 13 hostile payloads. Was: A regression test for the whole class, because this is its fourth appearance
  (VUXBUG2 → SW11 → REV1 → SEC13/SEC14). Scan the built bundles for an inline handler whose argument is an
  `esc()`-derived value sitting between `&#39;`/`&quot;` delimiters, and assert none. Verify non-vacuous by
  reintroducing SEC13 and watching it fail.
- [x] **P21-F** — DONE 2026-08-19 (v1.191.0), retires **DSN9**. Renamed to `jsAttr` rather than moved under its old name, since the implementation had to change anyway; zero `volJsAttr` references remain. Was: Move `volJsAttr` from `js-volunteers.js` to `js-core.js` beside `esc()`,
  with a comment stating the two must never be composed. It is called 29 times from `js-finance.js` already;
  it rides here because P21-C/D are the reason anyone will read it next.

**Done when:** a `role='member'` cookie gets 403 from `/email/send` and `/api/people`, driven against the real
worker the way CR10 verified the hole; a sign-up named `A");…//` renders inert in the Signups list; P21-E
fails on a deliberate revert. ✅ **All three met.** Member cookie: 403 on all eleven privileged routes with
zero upstream calls, admin/staff and the `X-Worker-Secret` bypass unaffected. Both hostile-name forms
(`A");…` and `A&quot;);…`) render inert in all three surfaces and still round-trip to the handler
byte-identical. 9 injections, 9 correct failure sets. `npm test` 1629/1629 (was 1601). See NOTES.md
v1.191.0. **Not verified**: a live browser, a real sent email, or production D1.

---

## Phase 22 — Security hardening
**Goal:** the rest of the CR10 security findings. Independent of each other; safe to land in one PR.

- [x] **P22-A** — DONE 2026-08-19 (v1.192.0), retires **SEC16**. **User decision: honor the checkbox.** Filtered in four places, not the obvious three — the fourth is household-name disambiguation, which renders a person's FIRST NAME into the "Doe (John)" label and drew it from the head of household regardless of opt-out, so an opted-out head surfaced on the label of the very list that excluded them. Also: a household whose every member opted out is 404 to a member (otherwise `/households/1..N` harvests names and photos for exactly the families that asked to be left out). Staff/finance/council/admin untouched — the opt-out hides someone from the directory, not from the office, and half the new tests assert that. 12 new tests against real SQLite; 8 injections, 8 correct failure sets, in both directions. **⚠ Two of my own tests were vacuous on the first draft** (the fixture made the opted-out person the spouse, so disambiguation never had to choose) and were rewritten. **⚠ A member who opts themselves out cannot find themselves in the directory either** — `app_users` has no `person_id`, so there is no carve-out to hang a self-view on. Was:
- [x] **P22-B** — DONE 2026-08-19 (v1.193.0), retires **SEC17**. Fixed at four layers: a server-side write-strip on both `scheduler_data` write paths (**the authoritative guarantee** — a stale tab cannot put them back), a one-time D1 scrub in `_doInitDb`, a client strip at the two storage chokepoints (`getBreezeSettings`/`saveBreezeSettings`, so all 25 call sites are covered by two edits rather than a third copy of the Resend delete), and `breezeGet`/`breezePost` no longer sending `X-Breeze-Api-Key`. **⚠ That last one was load-bearing** — both helpers guarded on `!s.apiKey` and would have rejected outright once the key was stripped. Also removed four dead hidden inputs. **⚠ Nine `s.workerSecret ? … : {}` header conditionals are left in place and are now permanently inert**, documented at `_workerHeaders()` — rewriting nine `fetch` sites inside a 500 KB template literal was not worth the risk here. 13 new tests; 10 injections, 10 correct failure sets. **⚠ One of my own assertions was wrong twice** (tripped on its own documentation, then checked only the JS bundle while the input lives in the markup bundle) and was corrected. Was:
  Resend key already got this treatment (`loadSettingsForm` deletes it on read); copy that, plus a
  one-time strip of what is already stored. Both live in `env` and are read from there.
- [x] **P22-C** — DONE 2026-08-19 (v1.194.0), retires **SEC18**. One escaper per RUNTIME rather than one overall: `csvCell`/`csvRow` in `api-utils.js` (server), the same pair in `js-core.js` (browser), and a documented local copy in `scheduler-html.js` — that file also ships as the standalone `scheduler/index.html` and cannot import an admin bundle. Six hand-rolled escapers with three different notions of what needs quoting became three, with a test asserting the browser and server copies agree and a scan forbidding a fourth. **⚠ One deliberate behavior change: a plain number is EXEMPT from the guard.** The three frontend copies guarded a leading `-` unconditionally, so every negative amount shipped as TEXT and refunds fell out of the bookkeeper's `SUM()` (G6 says refunds are real here). **⚠ Two SC3-BUG1 build breaks in one edit** — the scheduler guard's regex escapes were eaten by the template literal, and then the same happened inside the COMMENT quoting that regex. 18 new tests; 12 injections, 12 correct failure sets. Was:
  exporters (`api-reports.js:496`, `api-admin.js:692`, `api-import.js:1076` and `:1271`). Separately, give
  `giving/statement?format=csv` real escaping — it has none — and sanitize `person.last_name` before it goes
  into `Content-Disposition`. One shared `csvCell()` helper, not five copies (SW17's lesson).
- [x] **P22-D** — DONE 2026-08-19 (v1.195.0), retires **SEC19**. Purged on sign-out AND on a 401 — the
  second is the case sign-out never sees, and the one the shared-office scenario actually turns on
  (nobody clicks Sign Out; the cookie expires and the next person signs in). The purge rides
  `waitUntil` **alone** on the `/admin/logout` fetch — **⚠ no `respondWith`, deliberately**, so the
  worker can never break signing out; a test asserts that, because the obvious "intercept and
  re-issue" version puts the purge in front of the one request that must never fail. `API_CACHE` is
  now `'chms-api-' + VERSION`, so `activate` evicts it like the static cache. The shell is keyed by
  role rather than dropped: **⚠ the worker cannot tell which role a response was built for** (the read
  side is an offline cold launch — no request, no cookie, no page to ask), so `applyRoleUI()` posts
  the role and the worker stores it beside the shell in the same version-scoped cache. Sanitized to
  letters first — it arrives by `postMessage` and lands in a cache key. Cost, accepted: the first
  offline launch after a deploy falls to the offline page. **⚠ A harness bug, not a worker bug, was
  found on the way** — the fake `caches` returned the stored `Response` rather than a clone, so a
  second read saw a consumed body. 8 injections, 8 correct failure sets. `npm test` 1702/1702 (was
  1672). **Not verified**: a live browser, a real installed PWA, or a real offline relaunch. Was:
- [x] **P22-E** — DONE 2026-08-22, retires **SEC20**. All three sites now fail CLOSED instead of open
  when `RSVP_STORE` is absent: (1) `handleAdminLogin` (`api-admin.js`) refuses with a 503 before any
  credential check runs — brute-force protection that silently disables itself is worse than a login
  page that says "temporarily unavailable"; (2) `intakeRateLimitOk` (`api-intake.js`) returns `false`
  (429) instead of `true` — an unauthenticated public-facing intake endpoint should not go unlimited
  just because KV is unbound; (3) the QuickBooks connect route (`api-finance.js`) refuses to start the
  OAuth flow at all (503) rather than mint a `state` nobody will check, and the callback route refuses
  (redirects with `qb_error=state_store_unavailable`) rather than trust an unverifiable `state` param.
  `npm test` 1785/1785, 8 new tests in `test/kv-fail-closed.test.js`; **all 4 "missing store" cases
  verified non-vacuous** by reverting the three fixes and confirming they fail against the pre-fix
  code (the 4 "store present, still works normally" cases keep the fix from being a blanket refuse).
  `test/admin-login-credentials.test.js`'s shared `envWith()` fixture updated to include a working
  in-memory KV mock, since login can no longer succeed with none at all. **Not verified**: a live
  browser or a real QuickBooks OAuth round-trip. (`src/api-admin.js`, `src/api-intake.js`,
  `src/api-finance.js`, `test/kv-fail-closed.test.js`, `test/admin-login-credentials.test.js`)
- [x] **P22-F** — DONE 2026-08-22, retires **SEC21** (all five remaining sub-items; (a-i)/(b) of the
  original seven had already shipped in commit `c7c1c3a`, per the note this replaces). Prompted by an
  independent external code review landing the same findings. All five verified non-vacuous (each
  test fails against the pre-fix code, confirmed by stashing the fix and re-running):
  (a-ii) break-glass password compare switched from `submittedPass === adminPassword` to
  `timingSafeEqual(submittedPass, adminPassword)` (`api-admin.js`) — `timingSafeEqual` already
  existed for `X-Intake-Key`; this was the one credential in the login path still comparing
  non-constant-time, and the one whose compromise also forges every session cookie (SEC15/P23-A);
  (b) login rate limiting's KV key dropped its `:${Math.floor(Date.now()/WINDOW_MS)}` bucket suffix —
  it's per-IP only now, and every failed attempt re-arms a fresh 20-minute TTL, so the window only
  resets after 15+ minutes of no attempts at all rather than at a fixed wall-clock boundary an
  attacker could straddle (10 attempts + 10 attempts, no wait, at the old bucket edge);
  (c) the `X-Breeze-Subdomain` header fallback in `handleSchedBreezeProxy` (`api-scheduler.js`) is now
  checked against `/^[a-z0-9-]+$/` before being interpolated into the upstream hostname — refuses with
  400 rather than carrying `BREEZE_API_KEY` to an attacker-chosen host the moment `BREEZE_SUBDOMAIN`
  is ever unset;
  (d) `/admin/photo-proxy` (`tlc-volunteer-worker.js`) now checks `parsed.protocol === 'https:'`
  before the existing Breeze-hostname allowlist, matching its own pre-existing comment;
  (e) `refreshAuthCookie` (`src/auth.js`) now skips wrapping any response whose `Cache-Control`
  contains both `public` and `immutable` — the four versioned asset routes stop carrying a
  `Set-Cookie` at all, which also lets Cloudflare's edge actually cache them (a `Set-Cookie` response
  is never edge-cached, silently defeating the `immutable` intent it rode alongside).
  `npm test`: 1777/1777 (was 1771; 6 net new tests — `test/photo-proxy-https.test.js`,
  `test/breeze-proxy-subdomain-validation.test.js`, `test/login-rate-limit-sliding.test.js`,
  `test/versioned-asset-no-cookie.test.js`, plus one added to `test/admin-login-credentials.test.js`
  and one unrelated migration-visibility test from the same pass — see below). `node --check` on every
  touched file. **Not verified**: a live browser, a real Cloudflare edge cache, or a real attempted
  SSRF/timing attack — same standing caveat as every backend change in this repo's history.
- [x] **P22-G** — DONE 2026-08-19 (v1.196.0), retires **SEC22**. Deleted, with a comment in their
  place saying why a role-password env var must not come back (an authentication path with no
  account behind it — nothing to deactivate, nothing to audit, no way to tell whose login it was).
  **⚠ The dead code was the smaller half.** `SECRETS.md` listed **`ADMIN_EMAIL`** under Required
  Secrets as the `From:` address on all Resend email — it is not and never was; that is
  **`EMAIL_FROM`**, which the file did not document at all. `sendResend()` refuses without it, so
  an operator following SECRETS.md would have set the wrong variable, seen no error, and had a
  Worker that sent no email. Fixed, plus a new "Variables the Worker does not read" section
  naming all four. New `test/admin-login-credentials.test.js` (11) drives the real
  `handleAdminLogin` with all three role passwords set: they were never a login, and the real
  credentials still work. **The source scan is the part that lasts** — a dead credential read
  looks exactly like a live one, which is how these survived. 5 injections, 5 correct failure
  sets. `npm test` 1713/1713 (was 1702). Was:

**Done when:** each item fixed or formally deferred with a reason, per this file's convention.

---

## Phase 23 — Authentication foundation (needs scoping before any code)
**Goal:** the two items that change how sessions and logins work. Both deserve their own session.

- [ ] **P23-A** (retires **SEC15**) — Move session signing off `ADMIN_PASSWORD` onto a separate
  high-entropy `SESSION_SECRET`. **⚠ Migration matters more than the change**: every existing cookie is
  signed with the old key, so plan for accept-either-during-rollout or accept-a-forced-logout, and keep
  LP8's rotate-to-revoke-everything property pointed at the new secret. Update `SECRETS.md`.
- [ ] **P23-B** (retires **SEC9**) — MFA, at least for `admin` and `finance`. TOTP setup + QR, verification
  at login, recovery codes, and a decision on which roles are required. **P23-A first** — MFA on top of a
  session key that is also a guessable password buys less than it looks like.
- **SEC10 (CAPTCHA) is closed as deferred** and stays closed unless the threat model changes here.

**Done when:** each has a design decision logged in this file, or is in active implementation.

---

## Phase 24 — Silent failures
**Goal:** the correctness items where the app already knows something went wrong and says nothing. Highest
user-visible payoff per line changed in the whole plan.

- [ ] **P24-A** (retires **LOAD9**) — `api()` must reject on `!r.ok` regardless of whether `opts` was passed.
  **⚠ This surfaces 54 currently-silent failures at once** (230 write-style calls, 176 already check
  `d.error`, 54 do not) — every one of those call sites needs a `.catch` before this lands, or a working
  save starts showing an unhandled rejection. Do the call-site sweep in the same PR, file by file:
  `js-tuition-aid` 10 · `js-giving` 8 · `js-volunteers` 7 · `js-attendance` 5 · `js-finance` 5 ·
  `js-settings` 4 · `js-dashboard` 4 · `js-export-import` 3 · `js-core` 2 · `js-households` 2 · `js-people` 2
  · `js-register` 1 · `js-reports` 1. This is the mechanism behind the SAC1/SAC3 reports.
- [ ] **P24-B** (retires **LOAD8**, **CR5**) — Dashboard: fold `birthdays`, `annRows` and
  `baptismAnniversaries` into the existing first `Promise.all` (they depend on nothing), run
  `prayerOpen`/`prayerOpenTotal` together, and replace the five-`await` weekly-task seed loop with one
  `db.batch()`. **⚠ Add a unique constraint on `engagement_tasks(title, week_key)` or seed with
  `INSERT … WHERE NOT EXISTS`** — two staff opening the dashboard the same Monday morning currently both
  seed and leave ten tasks.
- [x] **P24-C** — DONE 2026-08-22, retires **DSN8**. `council` was already added to `roleLabels` in
  `api-admin.js` by an earlier session (found already fixed, with a comment naming DSN8). The other
  half — `api-chms.js`'s write-refusal string still saying "editing requires staff, office, or finance
  access" — was still there; changed to "council". `npm test` passing, 2 new tests in
  `test/role-labels-council.test.js`, verified non-vacuous by reverting the fix. (`src/api-chms.js`,  `test/role-labels-council.test.js`)

**Done when:** a forced 500 on a save shows the server's own message; the dashboard's D1 round-trip count is
measured and recorded; a council user sees their role name.

---

## Phase 25 — Load speed
**Goal:** ordered cheapest-first. P25-A and P25-B are one-liners; P25-E is the big one.

- [ ] **P25-A** (retires **LOAD4**) — Route `/admin/scheduler-embed.html` and `.js` through
  `assetCacheControl()` and add both to `ASSETS` in `test/asset-cache-policy.test.js`. Two of six versioned
  assets are currently outside the mid-rollout stale-pinning defense, and the test's own list encodes the gap.
- [ ] **P25-B** (retires **LOAD7**) — Hoist the pure asset routes (`/icons/*`, `/favicon.svg`,
  `/header-logo.png`, `/admin/app-*.js`, `/admin/app.css`, the TinyMCE proxy) above `await initDb(env.DB)`
  in `_fetch`. None of them touch D1.
- [ ] **P25-C** (retires **LOAD5**, **CR2**, **AU2**) — Self-host the fonts, or make the `<link>`
  non-blocking with a `preconnect`. **⚠ AU2 is written as a login-page item and is not one** — the app shell
  (`html-head.js:15`) blocks on the same host for three families at 17 weight/italic combinations, and has no
  `preconnect` at all while `PUBLIC_HTML` already has two. Self-hosting also lets the CSP drop both
  `fonts.*` allowances.
- [ ] **P25-D** (retires **CR6**, **DSN6**) — Route the seven `FormData` uploads in `js-finance.js` through
  `api()` (it passes `opts` straight through, so `FormData` works), and replace all eight hardcoded
  `location.href = '/chms'` 401 redirects with a shared host-aware helper — the frontend mirror of
  `appRootPath()`, whose own comment explains why this knowledge must live in one place.
- [ ] **P25-E** (retires **LOAD2**) — Split `app-ext.js` (1,273 KB) along the permission line the way CR9
  split along the role line. `js-finance.js` alone is 696 KB of its source, and a `staff` or `council`
  account with `finance: none` downloads and parses all of it. The shell is the only per-request surface and
  already decides (`chmsHtmlForRole`); `ensureFullAppLoaded()` is already the lazy fallback for a permission
  granted later. **⚠ Keep CR9's two rules: fail SAFE (an unrecognized role gets everything), and pin
  "no global defined twice across bundles" with a test** — the member split's one real bug was a module
  landing in the wrong half.
- [ ] **P25-F** (retires **LOAD3**, **CR1b**, **CR9a**) — The 194 KB `no-store` shell, which is nearly all
  tab markup. CR1b's own caveat still stands: there is no natural lazy trigger, so this needs the boot
  sequence looked at, not another mechanical extraction. While in there: the served document never closes
  `<body>` or `<html>`, and the script tags carry no `defer`.
- [ ] **P25-G** (retires **LOAD6**) — Give `serve.timothystl.org` the CR1 treatment: `PUBLIC_HTML` is a
  204.5 KB document with 57.4 KB of CSS and 80.2 KB of JS inlined and **no `Cache-Control` at all**. It is
  entirely static and identical for every visitor — a better candidate for immutable versioned assets than
  the admin shell ever was, on the same slow network.

**Done when:** each shipped or deferred; measure the same numbers CR10 recorded and put the new ones next to
the old ones in this file.

---

## Phase 26 — Design system consolidation (pre-redesign)
**Goal:** what RD1/RD2/RD4 asked for in 2026-07, restated with measurements. **P26-A is a visible bug, not
cleanup — do not let it wait for the redesign.**

- [x] **P26-A** — DONE 2026-08-22, retires **DSN1**. The nine tokens (`--honey`, `--soft-sage`,
  `--on-pale-gold`, `--on-pale-sage`, `--error-bg`, `--on-error-bg`, `--error-border`,
  `--danger-btn`, `--danger-hover`) are now declared in `html-head.js`'s main `:root`, with the
  exact values `scheduler-html.js`'s own (now-stripped-on-embed) `:root` used — no visual change,
  just the values now actually resolve. Also built the requested **build-time assertion**:
  `test/scheduler-css-vars.test.js` extracts the real embedded Scheduler CSS (via
  `getSchedulerInlineParts()`, the same transform the app serves), collects every no-fallback
  `var(--x)` it uses, and asserts each one resolves against the app shell's declared tokens — so
  the next token added to the Scheduler that isn't also declared in `html-head.js` fails CI
  instead of going silent. `npm test` 1781/1781, 2 new tests; both verified non-vacuous by
  reverting the token fix and confirming they fail. (`src/frontend/html-head.js`,
  `test/scheduler-css-vars.test.js`)
- [ ] **P26-B** (retires **PAL5**, **DSN3**, **RD4**) — Continue PAL7's exact-match hex substitution. 423 hex
  literals, 171 distinct; the two most common are `#2E7EA6` (36x) and `#C9973A` (33x), which are
  `--color-teal` and `--color-gold` written longhand. **⚠ Keep PAL7's two rules**: never substitute a hex
  inside a `var(--x, #fallback)` (24 of them, deliberate — they are what renders in an emailed letter), and
  never map a value onto a token namespaced for another tab. Also settle the two reds: `#c0392b` is
  hardcoded 13x including twice in `html-head.js`, and PAL1 retired it.
- [ ] **P26-C** (retires **PAL2**, **DSN2**) — Migrate legacy token references onto the Palette A set, then
  delete the legacy definitions. Current state: 1,168 legacy references (`--warm-gray` 791 · `--linen` 120 ·
  `--steel-anchor` 113 · `--charcoal` 86 · `--sky-steel` 18 · `--warm-white` 2) against 314 brand-token
  references. The `--ev-*` family is down to 38 and can go first.
- [ ] **P26-D** (retires **RD2**, **CR4**, **DSN4**) — The structural half: ~3,900 pure-layout inline
  `style=` attributes (of 4,004 total; only 99 carry a color, which is P26-B's problem). This is a refactor,
  not a substitution, and RD1/RD2's own 2026-07-12 decision was to let it ride with the redesign. Keep it
  there unless the redesign slips.
- [ ] **P26-E** (retires **RD1**, **DSN5**) — Reconcile the palettes. RD1 counted three; there are **five
  across four surfaces**: admin legacy · admin brand · the Scheduler's own 28-token `:root` · the public
  site's original `--navy/--teal/--gold/--cream/--moss/--slate/--plum-*` · and the public site's `--sv-*`,
  where `--sv-navy` and `--navy` are the same `#1E2D4A` under two names by SITE1's deliberate choice. Scope
  from five.
- [ ] **P26-F** (retires **DSN7**, **MO5**) — The accessibility pass MO5 deferred, now with a number:
  128 click handlers on non-interactive elements (76 `<div>`, 35 `<span>`, 17 `<td>`) against 2 `tabindex`
  and 9 `role=`; 18 `aria-label` and 0 `aria-labelledby` across a 1.6 MB app; 13 `<img>` to 12 `alt=`.
  **⚠ `aria-labelledby` is an HTML attribute name — see the spelling rule at the top of this file.**

**Done when:** P26-A shipped; the rest either shipped or explicitly folded into the redesign with a date.

---

## Phase 27 — Repo and process hygiene
**Goal:** keep the tools that catch problems from going quietly red. All small.

- [ ] **P27-A** (retires **DOC3**) — Suffix the later duplicate backlog IDs (`FIN58b`, `FIN58c`, `FIN54b`,
  `FIN54c`, `FIN55b`, `FIN56b`, `FIN57b`, `FIN61b`, `FIN62b`, `FIN63b`, `FIN20b`, `FIN33b`, `FIN6b`) rather
  than renumbering. **This matters because this file is the hand-off between sessions**: "see FIN58" currently
  resolves to three different features. `G3` also appears twice as the same item — make the second a
  cross-reference.
- [ ] **P27-B** (retires **DOC4**) — Get the American-English check back to zero. 27 hits today: NOTES.md 13 ·
  CLAUDE.md 12 (4 of which are the rule quoting its own example words and are unavoidable — exclude those
  four lines in the command, or the check can never be green) · `src/frontend/js-finance.js:7968` ·
  `test/finance-comp-baseline.test.js:504`. The last two are live code.
- [ ] **P27-C** (retires **DOC5**) — `npm audit fix`. Back to 6 high after REV8 recorded 0 on 2026-07-11; all
  dev-tooling (`wrangler → miniflare → sharp`/`undici`, `vitest → vite → postcss`/`nanoid`), none reaching
  the deployed Worker, which has no runtime dependencies. Treat as a recurring chore, not a one-time fix.
- [ ] **P27-D** (retires **DOC6**) — Delete the ~800 KB of dead tracked files: `index.html` (157 KB),
  `mockup.html` (158 KB), `chms-admin.html` (108 KB), `legacyindex.html` (106 KB), `volunteer-admin.html`
  (71 KB), `slide-builder.html` (64 KB), `volunteer-legacy.html` (43 KB), `breeze-proxy-worker.js` (27 KB —
  the entry point of the Worker IN1 deleted in April), and the three unimported `src/` modules
  (`api-member.js`, `portal-html.js`, `portal-sw-js.js`), whose stated purpose was fulfilled when CONN2 built
  the invite flow from scratch in `api-people.js`. **⚠ Confirm nothing outside this repo serves them first**
  — a `CNAME` file at the root suggests GitHub Pages once did. They are inside the spelling-check and
  `git ls-files | xargs grep` surface, which is the actual cost.

**Done when:** the spelling check and `npm audit` both return clean, and a search for any backlog code lands
on exactly one entry.

---

## Phase 28 — Carried forward (features, external, and one spin-out)
**Goal:** nothing here came out of CR10; it is the pre-existing backlog, listed so the plan is complete and
nothing is orphaned. Not ordered.

- [ ] **P28-A** / **G3** — Gift entry workflow improvements. User has detail; needs a scoping session.
  (Listed twice in this file — see P27-A.)
- [ ] **P28-B** / **PM1** — Person merge: move giving, tags and household membership to a canonical record,
  then delete the duplicate. Needs a confirmation UI with a diff view. **The SITE2 sign-up merge tools are a
  working precedent** — same shape, same confirm-count safety pattern.
- [ ] **P28-C** / **PL1b** — Pledge tracking: a `pledges` table, pledge vs. actual on the profile and in
  Giving Insights.
- [ ] **P28-D** / **TAP3** — The eight remaining tuition config knobs still have no UI (two got one; see the
  item's own 2026-08-19 note).
- [ ] **P28-E** / **TAP6** — Offset-0 is deliberately not pin-aware, so a pin made for "next year" is not
  promoted when that year becomes current. Re-verified unchanged 2026-08-19.
- [ ] **P28-F** / **SC4** — Mobile self-service "My Schedule". **Blocked**: there is no per-volunteer login,
  so nothing can answer "which person is me". Needs a volunteer identity decision first.
- [ ] **P28-G** / **SC6** — Native Scheduler rewrite, Phase 4: port the remaining surfaces (Focus Week,
  generate/auto-fill, reminders/ICS, Breeze import), each a separate decision. **P26-A touches the same
  code and should land first.**
- [ ] **P28-H** / **VUX-DEFER1** — Weekly digest to ministry leaders. `notify_weekly_digest` saves a
  preference and nothing sends anything; verified 2026-08-19. Still blocked on ministry-leader contact
  mapping, which does not exist.
- [ ] **P28-I** / **VUX-DEFER2** — Automated reminder before a volunteer's first Sunday.
  `sms_reminder_opt_in` is stored and shown in the admin UI ("🔔 Wants a reminder before serving") and
  nothing sends; verified 2026-08-19. Ministry-role sign-ups are recurring with no date to schedule against.
- [ ] **P28-J** / **QB1** (new, spun out of the now-closed FIN2) — Match QuickBooks `Deposit` entities against
  `giving_deposits` by date and amount, to auto-populate the bank amount and the real fee line in the
  Deposits reconciliation UI instead of the bookkeeper typing the bank total. `Deposit` is a queryable Data
  API entity (same pattern as `Budget`, which works) and is not called anywhere in this app yet. **Needs the
  same precedence decision FIN2 settled for sync**: how far to trust an auto-match against manual entry.
- [ ] **P28-K** / **FIN3** — Confirm the live daycare finance endpoint renders correctly. Needs
  `DAYCARE_API_URL`/`DAYCARE_API_KEY` set as Worker secrets, then one click of "Sync Daycare App".
- [ ] **P28-L** / **G24** — Set `CHMS_INTAKE_API_KEY` on `tlc-newsletter-admin` with the same value as here.
  **MKT1's Christmas Market summary endpoint answers 401 until this is done.**
- [ ] **P28-M** / **BRND3** — Website-repo follow-up: point the `/volunteer` short-URL redirect at
  `serve.timothystl.org`. That is D1 data in the other repo, not code here. (The DNS half is demonstrably
  done — `serve.timothystl.org` is live and `volunteer.timothystl.org` no longer resolves.)
- [ ] **P28-N** / **TLY1** — Invite member accounts at scale. **This is the organizational gate on the whole
  member tier**, and CR9/SEC11/SEC12/SEC16 all get more consequential the moment it happens — Phase 21
  should land first.
- [ ] **P28-O** / **TLY2** — Unverified: which Tithe.ly link-open mode was in effect for the successful
  session-persistence test. Only matters if it regresses after a Tithe.ly update.

**Done when:** each item either shipped, formally deferred with a reason, or moved into a phase of its own.
