// Guards a single per-request synthetic-fixture read -- or a live-first resolver whose own
// fallback reads one -- so a genuinely missing/invalid row in an otherwise-empty database
// degrades to an honest "unavailable" sentinel instead of throwing out of shell.js's route
// handler entirely. See apps/finance/README.md's "Known readiness limitations" and
// docs/FINANCE_PRODUCTION_CUTOVER.md's "Scope and acceptance limits": production's real Finance
// D1 genuinely has zero `source='synthetic_fixture'` rows (fixtures are a staging-only, explicitly
// applied step, never part of a migration), and several readSynthetic*() functions correctly throw
// -- as a real data-integrity check -- when their expected row/shape is entirely absent. That is a
// true finding about missing data, not a bug in the reader, so this wrapper never hides, retries,
// or fabricates a value. It only stops one section's or one companion sub-page's missing
// dependency from taking down every other part of the same request.
//
// `null` already means "this field does not apply to the section being rendered" throughout
// shell.js and every apps/finance/*-pages.js module (e.g. `budgetReport` is `null` outside the
// 'planning' section). SYNTHETIC_UNAVAILABLE is a distinct value precisely so a genuine read
// failure is never confused with "not applicable here" -- and so a caller can never mistake it for
// a real zero/blank figure.
export const SYNTHETIC_UNAVAILABLE = Object.freeze({ syntheticUnavailable: true });

export function isSyntheticUnavailable(value) {
  return value === SYNTHETIC_UNAVAILABLE;
}

export async function safeSyntheticRead(read) {
  try {
    return await read();
  } catch {
    return SYNTHETIC_UNAVAILABLE;
  }
}
