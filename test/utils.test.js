import { describe, it, expect } from 'vitest';
import { disambiguateHHName } from '../src/api-utils.js';

describe('disambiguateHHName', () => {
  it('returns name unchanged when headFirst is falsy', () => {
    expect(disambiguateHHName('Smith Family', '')).toBe('Smith Family');
    expect(disambiguateHHName('Smith Family', null)).toBe('Smith Family');
    expect(disambiguateHHName('Smith Family', undefined)).toBe('Smith Family');
  });

  it('prepends head first name to "X Family" names', () => {
    expect(disambiguateHHName('Smith Family', 'John')).toBe('John Smith Family');
  });

  it('handles extra spaces around Family suffix', () => {
    expect(disambiguateHHName('Smith  Family', 'John')).toBe('John Smith Family');
    expect(disambiguateHHName('  Smith Family  ', 'John')).toBe('John Smith Family');
  });

  it('is case-insensitive for Family suffix', () => {
    expect(disambiguateHHName('Smith FAMILY', 'John')).toBe('John Smith Family');
    expect(disambiguateHHName('Smith family', 'John')).toBe('John Smith Family');
  });

  it('prepends head first name to plain last-name strings', () => {
    expect(disambiguateHHName('Smith', 'John')).toBe('John Smith');
  });

  it('prepends to multi-word names that are not "Family" pattern', () => {
    expect(disambiguateHHName('Smith & Jones', 'Mary')).toBe('Mary Smith & Jones');
  });

  it('handles org-style names (no Family suffix, no common last name)', () => {
    expect(disambiguateHHName('Timothy Lutheran', 'Staff')).toBe('Staff Timothy Lutheran');
  });

  it('preserves head first name with spaces', () => {
    expect(disambiguateHHName('Smith Family', 'John Jr.')).toBe('John Jr. Smith Family');
  });
});
