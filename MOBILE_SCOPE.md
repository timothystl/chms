# Mobile Readiness — Scope

**Status:** scoping only, nothing implemented.
**Date:** 2026-08-03. **Measured against:** `main` @ `049c0a6` (v1.118.0, post-CR1).

---

## Method

Every number below was measured against the current source, not estimated:
counts of media queries, inline styles, tables, wrappers, and font sizes come from
scripted scans of `src/frontend/*.js`, `src/scheduler-html.js`, and
`tlc-volunteer-worker.js`. **No live browser was involved** — this environment has
none, which is the standing caveat on all frontend work in this repo. Everything
here is a source-level finding; the pixel-level judgments (spacing, tap comfort,
real-device feel) still need a phone.

---

## Verdict

**The foundation is in better shape than "make this mobile friendly" implies.** The
app already has the viewport meta tag, an off-canvas sidebar at every screen size
(VUX10), 29 media queries covering the major grid layouts, WCAG-sized touch targets
on buttons under 600px (MO3), adapted modals under 480px (MO4), charts that scale
via `viewBox` + `width:100%`, and toolbars that `flex-wrap`. Mobile has been
handled piecemeal, per-feature, as features shipped.

The gap is not "no mobile support." It is that the piecemeal approach left **two
categories of defect that break pages outright on a phone**, and **one structural
problem that makes any systematic pass expensive**. Those three things are the
scope.

The single highest-value finding: **every text input in the app is under 16px**,
which makes iOS Safari zoom the viewport on every field focus, app-wide. That is
roughly one CSS rule to fix and it is the difference between "usable on a phone"
and "fights you on every form."

---

## Already correct — do not redo

Listing these explicitly so a mobile pass doesn't burn time re-solving them:

| Thing | State | Where |
|---|---|---|
| Viewport meta | Present on all three shells (app, login, public) | `html-head.js:5`, `html-templates.js:17,43` |
| Sidebar | Off-canvas drawer at all widths, backdrop, close-on-navigate | VUX10, `html-head.js` |
| Button touch targets | 44px min-height under 600px | MO3 |
| Modals | Reduced padding, `max-height:95vh` under 480px | MO4 |
| Charts | `viewBox` + `width:100%`, scale correctly | `js-reports.js`, `js-attendance.js` |
| Chart resize handles | Touch events registered alongside mouse | MO1 |
| Toolbars / filter rows | `flex-wrap:wrap` | `html-head.js` |
| Volunteers inner rail | Stacks to horizontal pill row under 700px | VUX15 |
| People quickview | Hidden under 767px (deliberate) | `html-head.js` |
| PWA manifest + icons | Present and served | `/chms.webmanifest` |

---

## Findings

Ranked by user-visible impact per unit of effort.

### M1 — iOS zooms on every input focus, app-wide 🔴

Every form control in the admin app is below the 16px threshold at which iOS
Safari suppresses focus-zoom:

```
input               .9rem   (14.4px)   ← person edit, modals, .field
input               .84rem  (13.4px)
select              13px
scheduler input     .82rem  (13.1px)
number inputs       .78rem  (12.5px)
```

On any iPhone, tapping any field zooms the page in and leaves it zoomed — the user
then has to pinch back out, on every field, on every form. This affects every tab
that has an input, which is all of them.

**Fix:** one media query setting `font-size:16px` on `input, select, textarea`
under ~768px. The visual weight change is real but confined to phones. Roughly a
dozen lines including the spot-checks for fields whose layout assumes the smaller
size (the attendance entry inputs are already `1.65rem`, and number inputs pinned
to `width:56px` will need to widen).

**Effort:** small. **Impact:** the largest single mobile improvement available.

### M2 — 55 of 99 tables have no horizontal scroll container 🔴

A wide table with no `overflow-x` wrapper doesn't scroll — it widens the page, so
the whole layout shifts and the user can pan the entire UI sideways off-screen.
This is the "everything is broken and I can't get back" mobile failure.

| File | Tables | Wrapped | Bare |
|---|---:|---:|---:|
| `js-reports.js` | 23 | 3 | **20** |
| `js-finance.js` | 40 | 24 | **16** |
| `js-attendance.js` | 5 | 0 | **5** |
| `js-giving.js` | 9 | 6 | 3 |
| `html-tabs.js` | 9 | 6 | 3 |
| `js-export-import.js` | 4 | 1 | 3 |
| others | 9 | 4 | 5 |
| **Total** | **99** | **44** | **55** |

The complication: **65 of the 99 tables carry no CSS class at all** — they are
built with inline styles in JS string concatenation. Only 34 use a class
(`rpt-table` ×28, `entries-table` ×4, `dir-table`, `reg-table`).

```
  65  (no class — inline styled)
  28  rpt-table
   4  entries-table
   1  dir-table
   1  reg-table
```

So a class-targeted CSS rule reaches only a third of the problem. Two ways to
cover the rest:

- **(a) Descendant selector** — `.tab-panel table { display:block; overflow-x:auto; }`
  inside a mobile media query. Reaches all 99 regardless of class, in one rule.
  Caveat: `display:block` on a `<table>` drops table layout semantics, so column
  widths recompute; needs a real-device check on the widest tables (Finance
  multi-year, Reports trend) before trusting it.
- **(b) Runtime wrap pass** — a small boot-time function that wraps every
  `<table>` not already inside an `overflow-x` container. Preserves table layout
  exactly. Costs a DOM pass per render, and has to re-run after every dynamic
  render, which in this app is most of the UI.

Recommend trying (a) first and falling back to (b) for tables where it misbehaves.
**Do not** hand-edit 55 call sites — that is the expensive path and the one most
likely to regress.

**Effort:** small-to-medium, dominated by verification rather than by writing code.

### M3 — Inline styles defeat responsive rules 🟠

**3,752 inline `style="…"` attributes** across `src/frontend/`:

```
977  html-tabs.js      304  js-people.js       124  js-dashboard.js
958  js-finance.js     247  js-giving.js       121  js-attendance.js
441  js-reports.js     159  js-tuition-aid.js   93  js-volunteers.js
                       133  js-export-import.js  …
```

Plus **~200 fixed `width:`/`min-width:` values of 100px or more** in those inline
styles, including `min-width:600px`, `560px`, `520px`, `480px` — each of which
forces horizontal overflow on a 390px viewport.

This matters more than it looks: **an inline style beats a media-query class rule**,
so any responsive CSS written here can be silently defeated by markup elsewhere.
That is not hypothetical — it is exactly what VUX15 was: an inline
`style="width:290px"` overrode the mobile stacking rule, and the fix was moving it
to a class.

This is CR4/RD2/RD4/PAL5 already on the backlog, restated with mobile as the
motivation. It is the reason a *systematic* mobile pass is expensive and a
*targeted* one is not.

**Effort:** large, and genuinely open-ended. Recommend **not** scoping this as
mobile work — treat M1/M2 as targeted fixes that route around it, and let the
inline-style cleanup ride with the redesign that already owns it.

### M4 — Breakpoints are ad hoc 🟠

Eleven distinct breakpoints, each added for one feature:

```
700px ×7   900px ×5   480px ×4   800px ×2   767px ×2   600px ×2
1000px ×2  520px ×1   720px ×1   820px ×1   1100px ×1
```

Nothing is *broken* by this, but it means there is no shared definition of
"phone," so each new feature invents one and the layouts change at inconsistent
widths as a device rotates. Consolidating to three (~600 phone / ~900 tablet /
~1100 wide) is mechanical, low-risk, and makes every later mobile change cheaper.

**Effort:** small. Best done immediately before M1/M2 so those land on the
consolidated set.

### M5 — Service worker is dead on the primary hostname 🟠

There is a real service worker (`SW_JS` in `src/html-chms.js`, served at `/sw.js`,
registered at `js-core.js:401`). Two problems:

1. **Its navigation fallback checks `url.pathname === '/chms'`.** Since CONN6 the
   app is served at `/` on `connect.timothystl.org` (`tlc-volunteer-worker.js:286`).
   So the offline page fallback never fires on the hostname everyone actually
   uses — it is dead code left behind by the rename.
2. **`STATIC_ASSETS` precaches only `/chms.webmanifest`.** The ~1.3 MB of genuinely
   immutable, versioned assets — `/admin/app-core.js`, `/admin/app-ext.js`,
   `/admin/app.css` — are not precached, even though they are the ideal precache
   targets and already carry `max-age=31536000, immutable`.

Net effect: the app is installable (manifest + icons) but behaves like a website
on a phone — full network dependency, no offline, no instant relaunch. The
`#offline-banner` in the UI is driven by an API response field, not by the SW.

Fixing both is small and self-contained, and it is what makes the app feel
*installed* rather than bookmarked. Worth doing precisely because the church's
network is known to be slow (see AU2).

**Effort:** small.

### M6 — First load is heavy on a phone network 🟠

Post-CR1 the shell is 200 KB `no-store` (re-downloaded every load), plus ~968 KB
of app JS and 101 KB of CSS on first visit. Already-tracked items that are
disproportionately felt on cellular:

- **AU2** — login page first paint blocks on Google Fonts; on a filtered network
  that silently drops the request this is a multi-minute white screen. Already
  diagnosed and deferred to the redesign.
- **CR1b** — the remaining ~192 KB of `HTML_TABS_1/2` still inline in the
  `no-store` shell.
- **CR3** — boot is a serial waterfall (`/me` → then tags/funds/member-types).

None of these are new; flagging that mobile is where they hurt most, and that M5
(precaching the immutable assets) partly mitigates the repeat-visit cost without
touching any of them.

### M7 — Some surfaces will not become phone-native, and that's fine 🟢

Being honest about scope rather than promising uniform coverage:

- **Finance** (4,740 lines, 958 inline styles, 40 tables) is a multi-year
  budget-grid workflow. It can be made *not broken* on a phone (scrollable, no
  page-shifting) but making it phone-*native* is a redesign, not a mobile pass.
  Tablet-minimum is the honest target.
- **Scheduler** (6,398 lines, 6 media queries, 6 fixed `min-width`s ≥300px) is a
  month-grid tool that is admin-only and now lazy-loaded (CR1). Same call.
- **Tuition Aid**, **Church Report**, **Board Report** — same shape.

Meanwhile the surfaces most likely to be opened *on* a phone are the cheap ones:
Dashboard, People directory/profile, Attendance entry, Giving quick entry,
Prayer/follow-ups — and the member-role directory view, which is the one tier of
this app whose users are *predominantly* on phones and which is already the
narrowest surface (read-only People, plus Reports if granted).

---

## Proposed phases

Each phase is independently shippable and independently valuable.

### Phase A — Stop the bleeding
**M4** breakpoint consolidation → **M1** input font-size → **M2** table overflow.

These three, in that order, take the app from "fights you on a phone" to "usable
on a phone." No redesign, no inline-style cleanup, no new UI. Everything is
additive CSS plus one possible runtime helper.

*Size: one focused session, plus a real-device pass.*

### Phase B — Make it feel installed
**M5** service worker: fix the stale `/chms` path, precache the three immutable
asset routes, verify the install prompt and offline fallback on a real phone.

*Size: half a session, plus a real-device pass.*

### Phase C — Phone-first pass on the surfaces that matter
Dashboard, People (list + profile + the member-role directory), Attendance entry,
Giving quick entry. Card-style layouts instead of tables where a table is the
wrong form on a 390px screen; a mobile equivalent for the People quickview panel
that currently just disappears under 767px.

This is the first phase that involves real design decisions rather than
mechanical fixes, and it is where a phone in hand stops being a verification step
and becomes the design surface.

*Size: several sessions. Scope per-surface, not all at once.*

### Phase D — Not scoped as mobile work
Inline-style/token cleanup (M3, = CR4/RD2/RD4/PAL5), Finance and Scheduler
rearchitecture (M7), AU2/CR1b/CR3 load-time work (M6). Each already has an owner
elsewhere in the backlog. Mobile benefits from all of them; none should be
blocked on mobile or vice versa.

---

## The one decision that changes the work

Phases A and B are worth doing under any answer — they are defect fixes. **Phase C
is the question**, and it turns on who is actually opening this on a phone:

- **"Staff shouldn't have to fight it when they check something from their phone"**
  → Phases A + B, stop there. Roughly one to two sessions total.
- **"Members will use the directory on their phones, and staff will do real work
  from them"** → A + B + C, scoped surface by surface, several sessions.
- **"It should feel like an app"** → A + B + C, and Phase D's inline-style cleanup
  stops being deferrable, because per-surface phone layouts can't be built
  reliably on top of 3,752 inline styles that override them.

The member tier is the strongest argument for C: it is the one role whose users
are mostly on phones, and it is the smallest surface to get right.

---

## Not verified

- **No live browser or real device.** Every finding is source-level. The M1 fix in
  particular changes visual weight on real phones and needs eyes on it; the M2
  `display:block` approach needs a device check on the widest tables before being
  trusted.
- **No live D1 or production data** — table widths under real data volumes (long
  fund names, long household names) may overflow differently than the source
  suggests.
- **Not measured on the church's actual network**, which is the environment where
  M6/AU2 actually bite.
