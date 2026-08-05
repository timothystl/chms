import { describe, it, expect } from 'vitest';
import { CHMS_APP_EXT_JS } from '../src/html-chms.js';

// Regression cover for the long-running "the Compensation boxes don't type correctly" reports
// (FIN42 / FIN48 / FIN49 / FIN50 each fixed a real but different symptom and shipped without
// catching the actual cause, because nothing here was ever tested by simulating real keystrokes).
//
// The cause: every dollar/percent box on the Compensation tab is a FULLY CONTROLLED input. On
// each keystroke the handler converts the text to canonical cents, then the whole card re-renders
// and writes cents/100 straight back into the box. That round-trip is lossy for anything still
// being typed — the instant you type ".", the buffer is "1234." -> parseFloat -> 1234 -> the box
// is rewritten as "1234", your decimal point is gone, and the next two digits land as whole
// dollars. $1,234.56 silently becomes $123,456.
//
// These tests run the REAL sanitizer and the REAL handler out of the built bundle, and model the
// re-render both ways (with and without the fix) so the failure mode itself is pinned down, not
// just the fixed behaviour.

function extract(name, kind = 'function') {
  const re = kind === 'function'
    ? new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`)
    : new RegExp(`var ${name} = [\\s\\S]*?;\\n`);
  const m = CHMS_APP_EXT_JS.match(re);
  if (!m) throw new Error(`${name} not found in built script`);
  return m[0];
}

// Real finSanitizeDecimalInput + real finSalaryRefHealthOptOutChange (the Health Opt-Out Cash box
// in District Reference Data — the one specifically reported), with the re-render stubbed so the
// test drives it explicitly below.
function loadHandlers() {
  const sandbox = {};
  const src = `
    var _finSalaryReferenceByYear = {};
    var rerenderCalls = 0;
    function finRerenderPlanningPreserveFocus() { rerenderCalls++; }
    ${extract('finSanitizeDecimalInput')}
    ${extract('finSalaryRefHealthOptOutChange')}
    return {
      sanitize: finSanitizeDecimalInput,
      onOptOutInput: finSalaryRefHealthOptOutChange,
      ref: function () { return _finSalaryReferenceByYear; }
    };
  `;
  return new Function(src)(sandbox);
}

// Models one keystroke-by-keystroke editing session against a controlled input.
//   preserveRawValue=false -> the pre-fix behaviour (re-render overwrites the box from state)
//   preserveRawValue=true  -> the fix (the focused box keeps the text the user actually typed)
function typeInto(keys, { preserveRawValue }) {
  const h = loadHandlers();
  const YEAR = 2027;
  const el = { value: '' };
  for (const key of keys) {
    el.value = el.value + key;          // the browser inserts the character
    const sanitized = h.sanitize(el);   // real sanitizer (mutates el.value in place)
    const rawAfterInput = el.value;
    h.onOptOutInput(YEAR, sanitized);   // real handler -> canonical cents in state
    // ...then the card re-renders, rebuilding this input's value from canonical state:
    const cents = h.ref()[YEAR] && h.ref()[YEAR].healthOptOutCents;
    el.value = cents != null ? String(cents / 100) : '';
    if (preserveRawValue) el.value = rawAfterInput;   // <- finRerenderPlanningPreserveFocus
  }
  const cents = h.ref()[YEAR] && h.ref()[YEAR].healthOptOutCents;
  return { shown: el.value, cents: cents == null ? null : cents };
}

describe('Compensation money inputs: typing a decimal amount', () => {
  it('reproduces the reported bug when the re-render overwrites the focused box', () => {
    // This is what the user hit: every attempt to type cents produced a 100x figure.
    const { cents } = typeInto([...'1234.56'], { preserveRawValue: false });
    expect(cents).toBe(12345600); // $123,456.00 — wrong, and silently so
  });

  it('stores the amount that was actually typed once the focused box is preserved', () => {
    const { shown, cents } = typeInto([...'1234.56'], { preserveRawValue: true });
    expect(cents).toBe(123456); // $1,234.56
    expect(shown).toBe('1234.56');
  });

  it('keeps the decimal point visible while it is still being typed', () => {
    // The trailing "." is the exact character that used to vanish and shift every later digit.
    const { shown } = typeInto([...'50.'], { preserveRawValue: true });
    expect(shown).toBe('50.');
  });

  it('handles cents that start with a zero', () => {
    const { cents } = typeInto([...'100.05'], { preserveRawValue: true });
    expect(cents).toBe(10005);
  });

  it('clears back to no stored figure when the box is emptied', () => {
    const h = loadHandlers();
    h.onOptOutInput(2027, '250');
    expect(h.ref()[2027].healthOptOutCents).toBe(25000);
    h.onOptOutInput(2027, '');
    expect(h.ref()[2027].healthOptOutCents).toBeUndefined();
  });
});

describe('Compensation inputs are all typing-safe by construction', () => {
  // Pull every <input> tag belonging to the Compensation card out of the built bundle.
  const compensationInputs = CHMS_APP_EXT_JS
    .split('<input')
    .slice(1)
    .map(chunk => '<input' + chunk.slice(0, chunk.indexOf('>') + 1))
    .filter(tag => /id="fin-salary-|id="fin-health-premium-/.test(tag));

  it('finds the Compensation inputs in the built bundle', () => {
    // Guards the two filters above from silently matching nothing after a refactor.
    expect(compensationInputs.length).toBeGreaterThanOrEqual(8);
  });

  it('uses no type="number" box, which cannot round-trip an in-progress value', () => {
    // A type="number" input returns "" from .value for a mid-typed string like "1234.", so the
    // stored figure gets deleted and the box blanks out; it also has no selectionStart, so the
    // caret-restore is silently skipped and the cursor jumps to the end on every keystroke.
    // This is what the reported Health Opt-Out Cash box was, and what four fixes never changed.
    const offenders = compensationInputs.filter(tag => /type="number"/.test(tag));
    expect(offenders).toEqual([]);
  });

  it('routes every editable box through a live sanitizer instead of raw this.value', () => {
    const offenders = compensationInputs
      .filter(tag => /oninput=/.test(tag))
      .filter(tag => !/finSanitizeDecimalInput\(this\)|finPlanSanitizeWholeDollarInput\(this\)/.test(tag))
      // free-text fields (worker name, account code) legitimately take this.value verbatim
      .filter(tag => !/id="fin-salary-(name|acct)-/.test(tag));
    expect(offenders).toEqual([]);
  });
});

describe('re-render wrappers preserve the focused input', () => {
  for (const fn of ['finRerenderPlanningPreserveFocus', 'finRerenderPlanTablePreserveFocus']) {
    it(`${fn} captures and restores the focused element's raw value`, () => {
      const src = extract(fn);
      expect(src).toMatch(/var activeValue = active && typeof active\.value === 'string'/);
      expect(src).toMatch(/restored\.value = activeValue/);
      // ...and must restore it before putting the caret back, or the caret lands against the
      // pre-restore string length.
      expect(src.indexOf('restored.value = activeValue')).toBeLessThan(src.indexOf('setSelectionRange'));
    });
  }
});
