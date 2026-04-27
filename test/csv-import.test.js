import { describe, it, expect } from 'vitest';
import { parseFundSplits, givingEntryId, isGivingDup } from '../src/api-utils.js';

// ── parseFundSplits ───────────────────────────────────────────────────────────

describe('parseFundSplits', () => {
  describe('blank / nan fund (G6 quirk)', () => {
    it('maps empty string to General Fund', () => {
      expect(parseFundSplits('', 5000)).toEqual([{ name: 'General Fund', cents: 5000 }]);
    });
    it('maps null to General Fund', () => {
      expect(parseFundSplits(null, 5000)).toEqual([{ name: 'General Fund', cents: 5000 }]);
    });
    it('maps "nan" to General Fund (Excel blank export quirk)', () => {
      expect(parseFundSplits('nan', 5000)).toEqual([{ name: 'General Fund', cents: 5000 }]);
    });
    it('is case-insensitive for nan', () => {
      expect(parseFundSplits('NaN', 5000)).toEqual([{ name: 'General Fund', cents: 5000 }]);
    });
  });

  describe('single fund with numeric prefix (Breeze CSV format)', () => {
    it('parses a plain prefixed fund name, uses totalCents', () => {
      expect(parseFundSplits('40085 General Fund', 10000)).toEqual([
        { name: '40085 General Fund', cents: 10000 },
      ]);
    });
    it('strips trailing amount in parens from a single-fund row', () => {
      expect(parseFundSplits('40085 General Fund (100.00)', 10000)).toEqual([
        { name: '40085 General Fund', cents: 10000 },
      ]);
    });
  });

  describe('multi-fund single row with numeric prefix (split-fund G6 quirk)', () => {
    it('returns two entries with their individual amounts', () => {
      const result = parseFundSplits(
        '40085 General Fund (160.00), 49094 Tuition Aid (40.00)', 20000
      );
      expect(result).toEqual([
        { name: '40085 General Fund', cents: 16000 },
        { name: '49094 Tuition Aid', cents: 4000 },
      ]);
    });
    it('handles three-way split', () => {
      const result = parseFundSplits(
        '40085 General Fund (50.00), 49094 Tuition Aid (30.00), 50001 Building Fund (20.00)', 10000
      );
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ name: '40085 General Fund', cents: 5000 });
      expect(result[2]).toEqual({ name: '50001 Building Fund', cents: 2000 });
    });
  });

  describe('colon format', () => {
    it('parses single fund in colon format, uses totalCents', () => {
      expect(parseFundSplits('General Fund: $160.00', 16000)).toEqual([
        { name: 'General Fund', cents: 16000 },
      ]);
    });
    it('parses two funds in colon format with individual amounts', () => {
      const result = parseFundSplits('General Fund: $160.00, Tuition Aid: $40.00', 20000);
      expect(result).toEqual([
        { name: 'General Fund', cents: 16000 },
        { name: 'Tuition Aid', cents: 4000 },
      ]);
    });
  });

  describe('plain fund name (no prefix, no colon)', () => {
    it('returns the name as-is with totalCents', () => {
      expect(parseFundSplits('Christmas Offering', 7500)).toEqual([
        { name: 'Christmas Offering', cents: 7500 },
      ]);
    });
  });
});

// ── givingEntryId ─────────────────────────────────────────────────────────────

describe('givingEntryId', () => {
  it('first occurrence, single fund: returns pid unchanged', () => {
    expect(givingEntryId('ABC123', 1, -1)).toBe('ABC123');
  });

  it('second occurrence (Breeze per-fund row), single fund: returns pid-2', () => {
    expect(givingEntryId('ABC123', 2, -1)).toBe('ABC123-2');
  });

  it('third occurrence: returns pid-3', () => {
    expect(givingEntryId('ABC123', 3, -1)).toBe('ABC123-3');
  });

  it('multi-fund first split (splitIdx=0): returns pid-1', () => {
    expect(givingEntryId('ABC123', 1, 0)).toBe('ABC123-1');
  });

  it('multi-fund second split (splitIdx=1): returns pid-2', () => {
    expect(givingEntryId('ABC123', 1, 1)).toBe('ABC123-2');
  });
});

// ── isGivingDup ───────────────────────────────────────────────────────────────

describe('isGivingDup', () => {
  it('first occurrence is a dup when pid is in existingIds', () => {
    expect(isGivingDup('ABC123', 1, new Set(['ABC123']))).toBe(true);
  });

  it('first occurrence is a dup when pid-1 is in existingIds (legacy suffix)', () => {
    expect(isGivingDup('ABC123', 1, new Set(['ABC123-1']))).toBe(true);
  });

  it('first occurrence is NOT a dup when neither pid nor pid-1 exist', () => {
    expect(isGivingDup('ABC123', 1, new Set(['ABC123-2']))).toBe(false);
  });

  it('second occurrence is a dup when pid-2 is in existingIds', () => {
    expect(isGivingDup('ABC123', 2, new Set(['ABC123-2']))).toBe(true);
  });

  it('second occurrence is NOT a dup when pid-2 is absent (pid alone does not count)', () => {
    expect(isGivingDup('ABC123', 2, new Set(['ABC123']))).toBe(false);
  });

  it('returns false for empty existingIds', () => {
    expect(isGivingDup('ABC123', 1, new Set())).toBe(false);
  });
});
