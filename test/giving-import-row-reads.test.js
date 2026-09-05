import { describe, expect, it, vi } from 'vitest';
import { loadExistingGivingIds } from '../src/api-import.js';

describe('giving import duplicate lookup', () => {
  it('queries only incoming IDs and returns existing matches', async () => {
    const calls = [];
    const db = {
      prepare(sql) {
        expect(sql).toContain('WHERE breeze_id IN (');
        expect(sql).not.toContain("breeze_id != ''");
        return {
          bind(...ids) {
            calls.push(ids);
            return {
              async all() {
                return { results: ids.includes('gift-2') ? [{ breeze_id: 'gift-2' }] : [] };
              },
            };
          },
        };
      },
    };

    const result = await loadExistingGivingIds(db, ['gift-1', 'gift-2', 'gift-2', '']);

    expect(calls).toEqual([['gift-1', 'gift-2']]);
    expect([...result]).toEqual(['gift-2']);
  });

  it('stays below the D1 bind limit for large import chunks', async () => {
    const sizes = [];
    const db = {
      prepare() {
        return {
          bind(...ids) {
            sizes.push(ids.length);
            return { all: vi.fn().mockResolvedValue({ results: [] }) };
          },
        };
      },
    };

    await loadExistingGivingIds(db, Array.from({ length: 205 }, (_, i) => `gift-${i}`));

    expect(sizes).toEqual([90, 90, 25]);
  });
});
