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

**24 items open** (of 38 total: 23 rows in the table below + 15 Tier 7 carry-forwards). Closed:
P22-E, P22-F, P24-C and P26-A on 2026-08-22; P24-A, P25-D, P24-B, P25-A, P25-B, P25-C, P25-G,
P27-C, P27-B, P27-D and P27-A on 2026-08-23 — see below. **Tiers 1, 2 and 5 are now all
complete; Tier 3 has only its two "large" items left (P25-E, P25-F).** Take the next
unchecked row. Detail for every code is in its phase section further down.
### Tier 1 — Finish the security work (small, bounded, do first)

| # | Code | Size | What |
|---|---|---|---|
| 1 | ~~**P22-E**~~ | small | DONE 2026-08-22. Login rate limiting, intake rate limiting and QuickBooks OAuth `state` now fail **closed**, not open, with no `RSVP_STORE`. || 2 | ~~**P22-F**~~ | small ×5 | DONE 2026-08-22. Break-glass `===` compare · fixed rate-limit window · `X-Breeze-Subdomain` validation · photo-proxy scheme check · `Set-Cookie` off immutable assets. |

**Tier 1 and Tier 2 both complete.** Next up: item 11, P25-E (split `app-ext.js` along the
permission line — the large one).

### Tier 2 — Things that are wrong on screen right now

Highest payoff per line changed in the whole plan. Two of these are user-reported.

| # | Code | Size | What |
|---|---|---|---|
| 3 | ~~**P24-C**~~ | ~2 lines | DONE 2026-08-22. Council display-name label was already fixed by an earlier session; the write-refusal string in `api-chms.js` still said "office" — now says "council". |
| 4 | ~~**P26-A**~~ | small | DONE 2026-08-22. Nine CSS custom properties are now declared, with a build-time assertion added so a future one can't go undefined the same way. |
| 5 | ~~**P24-A** + **P25-D**~~ | **large — see note** | DONE 2026-08-23. `api()` now rejects on any non-2xx response regardless of `opts`; 88 write call sites got a `.catch` added (99 candidates found, 11 excluded as already-safe or as the wrong fix — see the entry below); the 8 hardcoded `/chms` redirects are gone; the 7 `js-finance.js` `FormData` uploads route through `api()`. |
| 6 | ~~**P24-B**~~ | medium | DONE 2026-08-23. Four more dashboard queries folded into the existing `Promise.all`; the prayer-request pair now runs together; the weekly-task seed is one `db.batch()` with `INSERT OR IGNORE` against a new unique index. |

> **⚠ Why 5 merges two codes.** P24-A rewrites `api()`; P25-D routes seven `js-finance.js` uploads
> through `api()` and replaces eight hardcoded `/chms` 401 redirects. Both sweep the same call sites.
> Doing them separately means auditing 230 `api()` calls twice, and the second sweep lands on code the
> first one just changed. **One PR.** And the sweep is not optional within it: flipping `api()` to reject
> without adding a `.catch` to all 54 sites turns silent failures into unhandled rejections.

### Tier 3 — Load speed, cheapest first

The church network is slow; AU2 has been open since July for that reason.

| # | Code | Size | What |
|---|---|---|---|
| 7 | ~~**P25-A**~~ | one-liner | DONE 2026-08-23. Both scheduler-embed assets now route through `assetCacheControl()`; the test's `ASSETS` list covers all six. |
| 8 | ~~**P25-B**~~ | one-liner | DONE 2026-08-23. The 8 pure asset routes now sit above `await initDb(env.DB)` in `_fetch`. |
| 9 | ~~**P25-C**~~ | medium | DONE 2026-08-23. Both the app shell and the login page now preconnect and load fonts non-blockingly. |
| 10 | ~~**P25-G**~~ | medium | DONE 2026-08-23. `PUBLIC_HTML`'s ~57 KB CSS + ~80 KB JS are now versioned immutable routes; the shell dropped to ~68 KB. |
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
| 15 | ~~**P27-C**~~ | minutes | DONE 2026-08-23. `npm audit fix` — 0 vulnerabilities. Recurring chore, will drift back up. |
| 16 | ~~**P27-A**~~ | small | DONE 2026-08-23. All duplicate headers suffixed, cross-references re-pointed, `G3`'s second copy now a pointer. |
| 17 | ~~**P27-B**~~ | small | DONE 2026-08-23. American-English check is back to zero, real hits fixed, 8 self-referential ones excluded in the command itself. |
| 18 | ~~**P27-D**~~ | small | DONE 2026-08-23. ~800 KB of dead files (+ `CNAME`) deleted, confirmed with the user first. |

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

- [x] **P24-A** — DONE 2026-08-23, retires **LOAD9**. `api()` (`js-core.js`) now rejects on any
  non-2xx response regardless of whether `opts` was passed — previously it only rejected on
  `!opts` (a GET), so every write (POST/PUT/PATCH/DELETE) resolved a failed save's `{error:...}`
  body straight into the caller's success handler. This is the mechanism behind the SAC1/SAC3
  "Save failed with no reason" reports. `test/api-helper-reject.test.js` (6 tests, extracting and
  running the real `api()`/`frontendAppRootPath()` source in a vm with a stubbed `fetch`) verified
  non-vacuous by reverting the core logic change and confirming the two write-rejection tests fail
  against the pre-fix code.
  - **The call-site sweep this needed, done in the same change**: a from-scratch scan (not the
    54-count above, which undercounted — the real number of write-style `api()` calls with no
    `.catch` at all was **99**) found every one via a small paren/comment-aware scanner (not a
    plain regex — a naive one is wrong here in two ways that mattered: it must skip `//`/`/* */`
    comments when matching quotes/parens, since an apostrophe inside a prose comment like
    "person's" otherwise corrupts the scan for everything after it in that expression; and it must
    not flag `return api(...)`, since that call's rejection propagates into whatever chain the
    enclosing function's own return value belongs to). 88 of the 99 got a `.catch` added, in each
    file's own existing idiom (`alert(...)` where the file already used it, `finToast(...)` in
    `js-finance.js`, `showErrorBanner(...)` in `js-core.js`).
  - **⚠ The other 11 were not "already fine" — they were the wrong fix, caught by hand-auditing
    every `Promise.all`/ternary site, not by the scanner.** Two real bugs found this way, both now
    fixed differently than a bare per-call `.catch` would fix them: (1) `js-finance.js`'s daycare
    save built `var req = editingId ? api(...) : api(...)`, later read via `req.then(...).catch(...)`
    — adding a `.catch` to each ternary branch would have swallowed the rejection *before* it
    reached the real, already-existing outer catch, silently continuing the save-succeeded UI path
    on a failed save. Removed both; the pre-existing outer `.catch` was already correct. (2) Two
    near-identical `js-finance.js` planning-save functions and two `js-attendance.js` functions
    build an array of `api(...)` calls fed to `Promise.all([...])`/`Promise.all(saves)` — a
    per-call `.catch` there makes `Promise.all` resolve as though every save succeeded even when
    one genuinely failed, since a caught-and-swallowed rejection resolves to `undefined` rather
    than propagating. Fixed by moving to one `.catch` on the aggregate instead of one per call,
    which is what the two planning functions already had and the two attendance functions needed
    added. **This is the same "reports success on failure" bug the whole item exists to close,
    reintroduced by a naive fix — worth remembering if this pattern (aggregate several `api()`
    calls, catch each individually) shows up again anywhere else.**
  - Every one of the 88 insertions was verified structurally, not just by `node --check`: none is
    immediately followed by a further `.then(`/`.catch(` (confirms nothing landed mid-chain, the
    exact shape of the first bug found), every one is immediately preceded by `)` (confirms it was
    appended after a real call, never mid-expression), and none sits inside a `Promise.all([...])`
    array literal or a `.push(...)` argument (confirms none of the second bug's shape survived).
    `npm test` 1795/1795 (was 1793 before this branch), `node --check` on all 13 touched files.
    **Not verified**: a live browser — the standing caveat on all frontend work in this repo.
- [x] **P24-B** — DONE 2026-08-23, retires **LOAD8**, **CR5**. `birthdays`, `annRows`,
  `baptismAnniversaries` and the year-round `annIssueCandidates` query (none of the four depends on
  anything computed earlier — three need only `dashMonthStr`, the fourth isn't month-scoped at all)
  moved into the dashboard handler's existing first `Promise.all`, alongside the 12 queries already
  there. `prayerOpen`/`prayerOpenTotal` (two independent counts, previously two serial awaits) now
  run together via `Promise.all`. The weekly-task seed's five serial `INSERT` awaits became one
  `db.batch()` call using `INSERT OR IGNORE`, backed by a new `UNIQUE(title, week_key)` index
  (`migrations/0037_engagement_tasks_unique_week.sql`, also added as a runtime migration in
  `db.js` with a dedup `DELETE` run first — a database that already hit the pre-fix race has real
  duplicate rows, and a bare `CREATE UNIQUE INDEX` would fail against them outright). This closes
  the race: two staff opening the dashboard the same Monday morning and both finding the week's
  task list empty now both attempt to seed, but the loser's five inserts are silently ignored by
  the unique index instead of duplicating every row. `npm test` (1798/1798, 3 new in
  `test/engagement-tasks-race.test.js` — running the real `initDb` against real in-memory SQLite,
  same harness pattern as `test/db-init-fastpath.test.js`); verified non-vacuous by reverting
  `src/db.js`'s migration and confirming 2 of the 3 new tests fail (10 rows instead of 5; the
  dedup-on-reboot case not applied). `node --check` on both touched files. **Not verified**: a live
  browser or real D1 — same standing caveat as all frontend/backend work in this repo without a
  live environment. (`src/api-chms.js`, `src/db.js`, `migrations/0037_engagement_tasks_unique_week.sql`,
  `test/engagement-tasks-race.test.js`)
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

- [x] **P25-A** — DONE 2026-08-23, retires **LOAD4**. Both `/admin/scheduler-embed.html` and
  `/admin/scheduler-embed.js` now use the same `assetCacheControl()` as the other four versioned
  assets, instead of a hardcoded `public, max-age=31536000, immutable` — closing the mid-rollout
  stale-pinning gap those two were sitting outside of. `js-core.js` already requests both with
  `?v=DEPLOY_VERSION`, so no frontend change was needed. Added both to `ASSETS` in
  `test/asset-cache-policy.test.js` (the list itself was the second half of the gap — it only ever
  covered four of the six). `npm test` (1798/1798, no new test file — extended the existing
  parameterized suite); verified non-vacuous by reverting the worker change and confirming 3 of 7
  tests in that file correctly fail. `node --check` on `tlc-volunteer-worker.js`. **Not verified**:
  a live browser or a real multi-colo rollout. (`tlc-volunteer-worker.js`,
  `test/asset-cache-policy.test.js`)
- [x] **P25-B** — DONE 2026-08-23, retires **LOAD7**. `/favicon.svg`, `/icons/*`, the TinyMCE
  vendor proxy, `/header-logo.png`, `/admin/app-member.js`, `/admin/app-staff.js`,
  `/admin/app-ext.js` and `/admin/app.css` (plus the `assetCacheControl()` helper the last four
  need) now sit at the top of `_fetch`, before `await initDb(env.DB)` — none of them read or
  write D1, so a cold isolate serving a favicon no longer pays a D1 round trip for it. The old
  copies further down (which had become unreachable dead code) were deleted rather than left in
  place; `/admin/scheduler-embed.html`/`.js` stayed where they are and still reference the same
  `assetCacheControl()`, now defined earlier in the same function scope. `npm test` (1800/1800, 2
  new in `test/pure-asset-routes-skip-initdb.test.js` — a DB stub that throws on any
  `prepare`/`batch` call proves these 8 routes serve successfully without touching it, plus a
  sanity check that a DB-dependent route does fail against the same stub, ruling out a vacuous
  pass). Verified non-vacuous by reverting the worker change and confirming the first test fails
  with `500`/"DB init error" on `/favicon.svg`. `node --check` on `tlc-volunteer-worker.js`. **Not
  verified**: a live browser or a real cold-isolate timing measurement. (`tlc-volunteer-worker.js`,
  `test/pure-asset-routes-skip-initdb.test.js`)
- [x] **P25-C** — DONE 2026-08-23, retires **LOAD5**, **CR2**, **AU2**. Chose the non-blocking
  `preconnect` option over self-hosting (self-hosting needs the actual WOFF2 binaries fetched from
  `fonts.gstatic.com` and vendored, which this session has no reliable network path to verify) — CSP
  keeps its `fonts.*` allowances for now. Both the app shell (`html-head.js`, previously blocking on
  Google Fonts with no `preconnect` at all — AU2 was written as a login-page item, but this is the
  actual highest-traffic surface) and the login page (`html-templates.js`, which already had this same
  blocking pattern) now: `<link rel="preconnect">` to both `fonts.googleapis.com` and
  `fonts.gstatic.com`, the real stylesheet `<link>` loaded via the standard `media="print"` +
  `onload="this.media='all'"` swap so it never blocks first paint, and a `<noscript>` fallback so
  fonts still load with JS disabled. `PUBLIC_HTML` already had preconnects and was left unchanged.
  `npm test` (1803/1803, 3 new in `test/font-loading-nonblocking.test.js`); verified non-vacuous by
  reverting both files and confirming all 3 new tests fail against the pre-fix markup. `node --check`
  on both touched files. **Not verified**: a live browser, or an actual measurement of first-paint
  improvement on a slow/filtered network — the standing caveat this fix exists to address in the first
  place. (`src/frontend/html-head.js`, `src/html-templates.js`,
  `test/font-loading-nonblocking.test.js`)
- [x] **P25-D** — DONE 2026-08-23, retires **CR6**, **DSN6**, done in the same change as P24-A per
  the note above (both sweep the same call sites). New `frontendAppRootPath()` in `js-core.js`
  mirrors `auth.js`'s `appRootPath()` (`connect.timothystl.org` → `/`, else `/chms`); `api()`'s own
  401 handler and all 7 `js-finance.js` upload functions use it — the 8 hardcoded
  `location.href = '/chms'` copies are gone. The 7 `FormData` uploads (`fetch(...).then(function(r)
  {...})` hand-rolled boilerplate re-parsing the response and re-checking `r.status`/`r.ok`) now
  read `api(url, { method: 'POST', body: fd })` — `api()` already passes `opts` straight to `fetch`,
  so a `FormData` body works unchanged; each call's own `.then(function(d) {...}).catch(...)`
  continuation was left as-is, since `api()`'s resolved/rejected shape matches what it already
  expected.
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
- [x] **P25-G** — DONE 2026-08-23, retires **LOAD6**. `PUBLIC_HTML`'s inlined `<style>` (~57 KB) and
  `<script>` (~80 KB) blocks are now their own exported constants (`PUBLIC_APP_CSS` in
  `src/public/head.js`, `PUBLIC_APP_JS` in `src/public/scripts.js`), re-exported from
  `html-templates.js` and served at `/serve-app.css`/`/serve-app.js` — same `?v=DEPLOY_VERSION`
  immutable-when-current, `no-store` otherwise pattern as `/admin/app.css`/`/admin/app-*.js` (CR1),
  hoisted above `initDb()` alongside the other pure asset routes (P25-B). `PUBLIC_HTML` itself drops
  from ~204.5 KB to ~68.4 KB and now references the two external routes via `<link rel="stylesheet">`
  and `<script src>`; it keeps no `Cache-Control` of its own — small enough on its own, and it's still
  the one piece that would need per-visitor logic if that's ever added, unlike the two blocks that were
  pulled out. Two existing tests needed updating for real reasons, not new fixture drift:
  `test/serve-redesign.test.js` extracted its `SCRIPT` fixture from `PUBLIC_HTML`'s inline `<script>`
  (now external — switched to importing `PUBLIC_APP_JS` directly) and had a `sv-role-grid` id assertion
  that was passing only by coincidence (the id string only "existed" because it was inside the inline
  script's own source text, not real markup — it's created at runtime via `innerHTML` before use, which
  the split now correctly exposes). `npm test` (1810/1810, 5 new in
  `test/public-app-assets-cache.test.js`); verified non-vacuous by reverting all four touched source
  files and confirming 4 of 7 tests in that file fail (routes fall through to the `/admin/api/*`
  catch-all → 401, `PUBLIC_HTML` still ~204 KB). `node --check` on all four touched files. **Not
  verified**: a live browser, or a real measurement of the public site's own load time.
  (`src/public/head.js`, `src/public/scripts.js`, `src/html-templates.js`, `tlc-volunteer-worker.js`,
  `test/serve-redesign.test.js`, `test/public-app-assets-cache.test.js`)

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

- [x] **P27-A** — DONE 2026-08-23, retires **DOC3**. All later duplicate headers suffixed
  (`FIN20b`, `FIN33b`, `FIN54b`, `FIN54c` [was `FIN54-OPEN`], `FIN55b`, `FIN56b`, `FIN57b`,
  `FIN58b`, `FIN58c`, `FIN61b`, `FIN62b`, `FIN63b`) — never renumbered, and every cross-reference
  elsewhere in `CLAUDE.md` re-pointed at the correct one, resolved by reading each reference's
  actual content against what each duplicate's body introduces (not by line proximity — e.g.
  "FIN57's `externallyFunded`" only makes sense against the later duplicate, since that's the one
  that introduces the field). **`FIN6b` was not created** — on inspection only one `FIN6` header
  exists in the current file; DOC3's original claim didn't hold against the live file (either
  already fixed in an earlier pass, or DOC3 was wrong about this one from the start). `G3`'s
  second occurrence (in the old flat "### Giving / Finance" list) is now a one-line pointer to the
  first (in the Development Phases list), rather than a restated duplicate. Two cross-references
  were read carefully and left alone as correctly ambiguous rather than force-resolved: `FIN36`'s
  header lists `FIN33` among a string of related-but-not-specific prior codes (a loose list, not a
  pointer to one occurrence), and `FIN66`'s "FIN63's lesson" was traced by content match to the
  **bare** `FIN63` entry (its "the card names what it searched for" framing), not `FIN63b`. `DOC3`
  itself marked resolved with a note explaining what changed, original text kept below for the
  record. Research for this item (finding every occurrence, determining chronological order via
  dates/version numbers/test counts, and mapping every cross-reference) was delegated to a
  background research agent given the ~600 KB file size — the actual edits and verification were
  done directly against the live file. `npm test` (1813/1813, unaffected — prose-only changes in
  `CLAUDE.md`). Re-ran the American-English check (P27-B) afterward to confirm the new prose didn't
  reintroduce a hit. (`CLAUDE.md`)
- [x] **P27-B** — DONE 2026-08-23, retires **DOC4**. Was 27 hits; now zero, and the check as
  documented (with 6 new exclusions added to its own command) actually returns clean. Fixed 19 real
  violations: 8 in `CLAUDE.md` (color/center/gray/initializes, in the BRAND1/BRAND2/BRAND5/TINY2
  historical write-ups), 9 in `NOTES.md` (the same BRAND saga, told a second time in that file), and
  the two flagged live-code instances (a comment in `src/frontend/js-finance.js`, an assertion
  comment in `test/finance-comp-baseline.test.js`). **Left 8 hits alone, deliberately, and
  excluded them in the check command itself** rather than editing: 4 in `CLAUDE.md` are this section
  quoting its own banned-word and look-alike-word examples (rewriting them would mean the section
  could no longer show what it's talking about — the reworded explanatory prose above the command
  had to avoid the same trap, since a first draft accidentally reintroduced 2 new hits by describing
  the examples using the very words being described); 2 more are the identical self-quoting pattern
  in `NOTES.md`'s own copy of this rule; the last 2 are `NOTES.md`'s v1.172.1 entry naming the exact
  pre-fix wording of three real strings that release corrected — a historical record, same reasoning
  as the `migrations/*.sql` exclusion. `npm test` (1813/1813, unaffected — comment/prose-only
  changes). `node --check` on the one touched JS source file. (`CLAUDE.md`, `NOTES.md`,
  `src/frontend/js-finance.js`, `test/finance-comp-baseline.test.js`)
- [x] **P27-C** — DONE 2026-08-23, retires **DOC5**. `npm audit fix` — 6 high (dev-tooling only:
  `nanoid`, `postcss`, `sharp` via `wrangler → miniflare`, `undici`) down to **0 vulnerabilities**.
  `package-lock.json` only, no source change. `npm test` (1813/1813, unaffected — a pure
  dependency bump). This is a recurring chore, not a one-time fix — expect it to drift back up as
  `wrangler`'s own dependency tree moves; re-run periodically. (`package-lock.json`)
- [x] **P27-D** — DONE 2026-08-23, retires **DOC6**. Deleted all 10 dead files
  (`index.html`, `mockup.html`, `chms-admin.html`, `legacyindex.html`, `volunteer-admin.html`,
  `slide-builder.html`, `volunteer-legacy.html`, `breeze-proxy-worker.js`, `src/api-member.js`,
  `src/portal-html.js`, `src/portal-sw-js.js`) plus the root `CNAME` file. Verified each by grep
  across the whole repo (not just `src/`) before deleting — zero references anywhere; the worker's
  `path === '/index.html'` checks are URL-path matches against dynamic content, not a reference to
  the deleted static file (Workers have no filesystem at runtime). **Asked the user first about
  `CNAME`/`index.html` specifically** — the CNAME points at `volunteer.timothystl.org`, a hostname
  that no longer resolves at all per the App Family Rename, and no GitHub Pages deploy workflow
  exists in `.github/workflows/` — confirmed to delete both. Updated a stale comment in
  `tlc-volunteer-worker.js` that referenced the three deleted `src/` modules as "kept for future
  reuse" (they were never reused — CONN2 built the real invite flow from scratch instead). `npm
  test` (1813/1813, no test referenced any of the deleted files). `node --check` on the one touched
  source file. **Not verified**: whether GitHub Pages was in fact configured in repo Settings — no
  tool available to this session checks that directly; the CNAME/no-workflow/dead-domain evidence
  was judged sufficient. (`tlc-volunteer-worker.js`, and 11 file deletions)

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
