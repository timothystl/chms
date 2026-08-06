import { describe, it, expect } from 'vitest';
import { LETTER_TYPES, letterRecipientKey, mergeLetterRecipients } from '../src/api-utils.js';

const givers = [
  { id: 1, first_name: 'Ann',  last_name: 'Alpha', email: 'ann@x.org',  household_id: 10, total_cents: 5000 },
  { id: 2, first_name: 'Bob',  last_name: 'Beta',  email: '',           household_id: 10, total_cents: 3000 }, // no email, in a member hh
  { id: 3, first_name: 'Cy',   last_name: 'Gamma', email: 'cy@x.org',   household_id: 99, total_cents: 2000 }, // not a member hh
  { id: 4, first_name: 'Deb',  last_name: 'Delta', email: 'deb@x.org',  household_id: null, total_cents: 1000 }, // no hh
];
const households = [
  { id: 10, name: 'Alpha Family',  recipient_email: 'ann@x.org', recipient_name: 'Ann Alpha', total_cents: 8000 },
  { id: 20, name: 'Zeta Family',   recipient_email: '',          recipient_name: '',          total_cents: 0 }, // member hh, no email
];

describe('LETTER_TYPES config', () => {
  it('has the seven letter types with default scopes', () => {
    expect(Object.keys(LETTER_TYPES).sort()).toEqual(
      ['appeal', 'memorial', 'midyear', 'nudge', 'quarterly', 'thank_you', 'year_end']
    );
    expect(LETTER_TYPES.year_end.defaultScope).toBe('givers');
    expect(LETTER_TYPES.appeal.defaultScope).toBe('member_households');
    expect(LETTER_TYPES.memorial.defaultScope).toBe('none');
    // memorial and nudge are both 'none' for the same reason: the letters workspace resolves
    // recipients from a scope query, and neither of these has one — a memorial letter is written
    // one at a time, and a nudge's recipients come from the plateau analysis.
    expect(LETTER_TYPES.nudge.defaultScope).toBe('none');
  });
});

describe('letterRecipientKey', () => {
  it('prefixes person vs household', () => {
    expect(letterRecipientKey('person', 7)).toBe('p7');
    expect(letterRecipientKey('household', 7)).toBe('h7');
  });
});

describe('mergeLetterRecipients — givers scope', () => {
  const { recipients, counts } = mergeLetterRecipients(givers, [], 'givers', new Set(), 'email');
  it('returns one person row per giver', () => {
    expect(recipients).toHaveLength(4);
    expect(recipients.every(r => r.kind === 'person')).toBe(true);
  });
  it('flags no_email for the giver without an email', () => {
    expect(counts.no_email).toBe(1);
    expect(recipients.find(r => r.id === 2).has_email).toBe(false);
  });
});

describe('mergeLetterRecipients — member_households scope', () => {
  const { recipients, counts } = mergeLetterRecipients([], households, 'member_households', new Set(), 'email');
  it('returns one household row each, no_email counted', () => {
    expect(recipients).toHaveLength(2);
    expect(recipients.every(r => r.kind === 'household')).toBe(true);
    expect(counts.no_email).toBe(1); // Zeta has no email
  });
});

describe('mergeLetterRecipients — both scope dedups by household', () => {
  const { recipients } = mergeLetterRecipients(givers, households, 'both', new Set(), 'email');
  const keys = recipients.map(r => r.recipient_key).sort();
  it('member households appear once; givers only if not in a member household', () => {
    // households 10 & 20 as household recipients; givers 3 (hh 99, not member) and 4 (no hh) as persons.
    // givers 1 & 2 are in member household 10 -> represented by the household, not individually.
    expect(keys).toEqual(['h10', 'h20', 'p3', 'p4']);
  });
});

describe('mergeLetterRecipients — sent flags per channel', () => {
  it('marks a recipient sent when its key is in the channel set', () => {
    const sent = new Set(['p1']);
    const { recipients, counts } = mergeLetterRecipients(givers, [], 'givers', sent, 'email');
    expect(recipients.find(r => r.id === 1).sent).toBe(true);
    expect(recipients.find(r => r.id === 3).sent).toBe(false);
    expect(counts.sent).toBe(1);
    expect(counts.unsent).toBe(3);
  });
});
