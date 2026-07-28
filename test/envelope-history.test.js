import { describe, it, expect } from 'vitest';
import { archiveEnvelope, parseEnvelopeHistory } from '../src/api-utils.js';

describe('archiveEnvelope', () => {
  it('adds a superseded number to an empty history', () => {
    expect(archiveEnvelope('[]', '42')).toBe('["42"]');
    expect(archiveEnvelope('', '42')).toBe('["42"]');
    expect(archiveEnvelope(null, '42')).toBe('["42"]');
  });

  it('prepends most-recent-first', () => {
    expect(archiveEnvelope('["42"]', '55')).toBe('["55","42"]');
  });

  it('is a no-op for a blank old number', () => {
    expect(archiveEnvelope('["42"]', '')).toBe('["42"]');
    expect(archiveEnvelope('["42"]', '   ')).toBe('["42"]');
    expect(archiveEnvelope('[]', null)).toBe('[]');
  });

  it('does not duplicate a number already in history', () => {
    expect(archiveEnvelope('["55","42"]', '42')).toBe('["55","42"]');
  });

  it('coerces numeric entries to strings and survives malformed json', () => {
    expect(archiveEnvelope('[55,42]', '7')).toBe('["7","55","42"]');
    expect(archiveEnvelope('not json', '42')).toBe('["42"]');
  });

  it('trims the incoming number', () => {
    expect(archiveEnvelope('[]', '  42 ')).toBe('["42"]');
  });
});

describe('parseEnvelopeHistory', () => {
  it('returns a string array, never throws', () => {
    expect(parseEnvelopeHistory('["55","42"]')).toEqual(['55', '42']);
    expect(parseEnvelopeHistory('[7,8]')).toEqual(['7', '8']);
    expect(parseEnvelopeHistory('')).toEqual([]);
    expect(parseEnvelopeHistory(null)).toEqual([]);
    expect(parseEnvelopeHistory('garbage')).toEqual([]);
    expect(parseEnvelopeHistory('{"a":1}')).toEqual([]);
  });
});

// End-to-end of the sync exception's core: a new Breeze number archives the old one.
describe('envelope reassignment (sync exception behavior)', () => {
  it('archives the prior number when the current changes', () => {
    let current = '42', history = '[]';
    // year 2 in Breeze: reassigned to 55
    const newNum = '55';
    if (newNum !== current) { history = archiveEnvelope(history, current); current = newNum; }
    expect(current).toBe('55');
    expect(parseEnvelopeHistory(history)).toEqual(['42']);
    // year 3: reassigned to 60
    const y3 = '60';
    if (y3 !== current) { history = archiveEnvelope(history, current); current = y3; }
    expect(current).toBe('60');
    expect(parseEnvelopeHistory(history)).toEqual(['55', '42']);
    // re-sync with no change: nothing archived
    if ('60' !== current) { history = archiveEnvelope(history, current); }
    expect(parseEnvelopeHistory(history)).toEqual(['55', '42']);
  });
});
