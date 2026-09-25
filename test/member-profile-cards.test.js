import { describe, it, expect } from 'vitest';
import { JS_PEOPLE } from '../src/frontend/js-people.js';
import { HTML_TABS_1 } from '../src/frontend/html-tabs.js';

// Reported 2026-08-04: a member on mobile saw a Directory button that errored with "Access
// denied", and the person profile "is also still showing demographic data, tags, follow ups and
// notes."
//
// The data itself was already stripped server-side (memberSafeView), so those cards rendered as
// empty shells under real headings — which reads to a member as the app showing them Notes and
// Follow-ups regardless of whether values appear. Giving was already gated this way on
// isFinance; these four never got the same treatment.

describe('profile cards a member must not see', () => {
  it('gates Church life, Tags, Directory visibility, Follow-ups and Notes on the member role', () => {
    for (const v of ['demoCard', 'tagsCard', 'dirCard', 'followCard', 'notesCard']) {
      const m = JS_PEOPLE.match(new RegExp('var ' + v + ' = ([^;]*)'));
      expect(m, v + ' should exist').toBeTruthy();
      expect(m[1], v + ' should be gated on isMemberView').toMatch(/isMemberView/);
    }
  });

  it('keeps Contact, Personal, Household and Location ungated — that is the directory', () => {
    for (const v of ['contactCard', 'personalCard', 'familyCard', 'locationCard']) {
      const m = JS_PEOPLE.match(new RegExp('var ' + v + ' = ([^;]*)'));
      expect(m, v).toBeTruthy();
      // A gated card reads `isMemberView ? '' : …`; Personal legitimately checks isMemberView
      // to drop its Edit button, which still renders the card.
      expect(m[1], v + ' should NOT be member-gated').not.toMatch(/isMemberView \? ''/);
    }
  });

  it('gives a member no Edit button on the one section they do see', () => {
    // Personal's editable field list is empty for a member, so pvfCard draws no Edit button.
    expect(JS_PEOPLE).toMatch(/section\('personal', 'Personal', isMemberView \? \[\] : personalEditIds/);
  });

  it('does not request follow-ups for a member — that endpoint 403s for them', () => {
    expect(JS_PEOPLE).toMatch(/if \(!isMemberView\) pvfRenderFollowups/);
  });

  it('shows members only member_type on the Personal card, not blank stripped rows', () => {
    // gender / marital_status / dob are all absent from memberSafeView.
    const m = JS_PEOPLE.match(/var personalIds = ([\s\S]{0,200})/);
    expect(m[1]).toMatch(/^isMemberView \? \['member_type'\]/);
  });
});

describe('toolbar buttons a member must not see', () => {
  it('gates Directory, Select, Archived and the Members toggle', () => {
    for (const [id, label] of [['p-members-btn', 'Members toggle'], ['p-select-btn', 'Select'],
                               ['p-archive-btn', 'Archived']]) {
      const tag = HTML_TABS_1.match(new RegExp('<button[^>]*id="' + id + '"[^>]*>'))[0];
      expect(tag, label).toContain('no-member');
    }
    const dir = HTML_TABS_1.match(/<button[^>]*printDirectory\(\)[^>]*>/)[0];
    expect(dir, 'Directory button').toContain('no-member');
  });
});
