import { describe, it, expect } from 'vitest';
import { memberSafeView } from '../src/api-people.js';
import { JS_CORE } from '../src/frontend/js-core.js';

// Reported 2026-08-03: "When searching as a member user the people status all show as visitor
// even when they are members."
//
// Root cause: memberSafeView() (src/api-people.js) is an explicit allowlist of what a
// role='member' viewer sees of another person's record (built for CONN3's security pass —
// strips notes/tags/breeze_id, respects dir_hide_* opt-outs). `member_type` was simply never
// added to it — not a deliberate redaction, just a gap: it isn't sensitive, and it's literally
// the field the People tab's own default filter (mt:'member') scopes by.
//
// Every frontend renderer that colors/labels the status badge (typeColor/typeDotHtml in
// js-core.js) falls back to 'visitor' on a falsy value — by design, for a genuinely unset type.
// A member-role response always had a falsy member_type (the field was absent entirely), so
// every person, regardless of real status, rendered with the Visitor dot and label. The bug
// was the missing field, not the fallback — the fallback is correct and stays as-is.

function samplePerson(overrides = {}) {
  return {
    id: 42, first_name: 'Jane', last_name: 'Doe', member_type: 'Member',
    household_id: 7, household_name: 'Doe Family', family_role: 'head',
    email: 'jane@example.com', phone: '555-1234',
    address1: '1 Main St', city: 'St. Louis', state: 'MO', zip: '63101',
    dob: '1980-01-01', anniversary_date: '2005-06-01',
    notes: 'pastoral note — never sent to a member', breeze_id: 'bz123',
    locally_edited: 1, tags: [{ id: 1, name: 'Usher' }],
    ...overrides,
  };
}

describe('memberSafeView — member_type', () => {
  it('passes member_type through, the exact field the reported bug was missing', () => {
    const v = memberSafeView(samplePerson({ member_type: 'Member' }));
    expect(v.member_type).toBe('Member');
  });

  it('passes through each real status value, not just "Member"', () => {
    for (const mt of ['Member', 'Visitor', 'Associate', 'Friend', 'Inactive', 'Organization']) {
      expect(memberSafeView(samplePerson({ member_type: mt })).member_type).toBe(mt);
    }
  });

  it('defaults to empty string rather than omitting the key, so it is never `undefined`', () => {
    const v = memberSafeView(samplePerson({ member_type: null }));
    expect(v.member_type).toBe('');
    expect('member_type' in v).toBe(true);
  });
});

describe('memberSafeView — still redacts what CONN3 built this allowlist to redact', () => {
  it('never leaks staff-only fields', () => {
    const v = memberSafeView(samplePerson());
    expect(v.notes).toBeUndefined();
    expect(v.breeze_id).toBeUndefined();
    expect(v.locally_edited).toBeUndefined();
    expect(v.tags).toEqual([]);
  });

  it('still honors dir_hide_* opt-outs', () => {
    const v = memberSafeView(samplePerson({ dir_hide_phone: 1, dir_hide_email: 1 }));
    expect(v.phone).toBe('');
    expect(v.email).toBe('');
  });
});

describe('the reported symptom, reproduced end to end against the real served frontend code', () => {
  // Extracts the REAL typeColor/typeDotHtml source text out of JS_CORE — not a
  // reimplementation — and evals just those two self-contained function bodies. The full
  // JS_CORE string runs boot-time window/document side effects the moment it's loaded, which
  // this test has no browser to satisfy; slicing out only these two pure functions (they touch
  // no DOM, only a color-lookup object and string formatting) is what lets the real source run
  // here at all, without a fake global environment wide enough to hide a genuine mismatch.
  function loadFrontendTypeHelpers() {
    const start = JS_CORE.indexOf('var TYPE_COLORS');
    const afterDot = JS_CORE.indexOf('function typeDotHtml');
    const end = JS_CORE.indexOf('\n}\n', afterDot) + 3;
    const src = JS_CORE.slice(start, end);
    expect(src).toContain('function typeColor');
    expect(src).toContain('function typeDotHtml');
    const sandbox = { esc: (s) => String(s || '') };
    // eslint-disable-next-line no-new-func
    new Function('esc', src + '\nthis.typeColor = typeColor; this.typeDotHtml = typeDotHtml;')
      .call(sandbox, sandbox.esc);
    return sandbox;
  }

  it('labels a real member "Member", not "Visitor"', () => {
    const { typeDotHtml } = loadFrontendTypeHelpers();
    const v = memberSafeView(samplePerson({ member_type: 'Member' }));
    // Before the fix, v.member_type was undefined here and this rendered "Visitor" regardless.
    expect(typeDotHtml(v.member_type)).toContain('>Member<');
    expect(typeDotHtml(v.member_type)).not.toContain('>Visitor<');
  });

  it('still renders "Visitor" for an actual visitor — the fallback itself was never the bug', () => {
    const { typeDotHtml } = loadFrontendTypeHelpers();
    const v = memberSafeView(samplePerson({ member_type: 'Visitor' }));
    expect(typeDotHtml(v.member_type)).toContain('>Visitor<');
  });
});
