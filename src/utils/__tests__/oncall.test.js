/**
 * Tests for src/utils/oncall.js
 *
 * Key scenarios:
 *  1. weekToIndex continuity across 52-week year boundary (2027→2028) — the
 *     old y*53+w formula produced a gap of 2 here; the fixed formula is always 1.
 *  2. weekToIndex continuity across 53-week year boundary (2026→2027) — both
 *     formulas happen to be fine here; we test it to catch regressions.
 *  3. Override precedence and clear-to-rotation behaviour.
 */

import { describe, it, expect } from 'vitest';
import {
  getOnCallPerson,
  getBlockPosition,
  getOnCallForWeek,
  addWeeks,
} from '../oncall.js';

// ─── Boundary: 52-week year 2027 → 2028 ────────────────────────────────────

describe('52-week boundary (2027-W52 → 2028-W01)', () => {
  // anchor = 2027-W50, blockWeeks = 4
  // With the fixed formula, offsets from anchor:
  //   W50 → 0 (weekInBlock 1)
  //   W51 → 1 (weekInBlock 2)
  //   W52 → 2 (weekInBlock 3)
  //   2028-W01 → 3 (weekInBlock 4)  ← old formula gave offset 4 → new block!
  //   2028-W02 → 4 (weekInBlock 1, new block)
  const settings = { rotation: ['Alice', 'Bob'], blockWeeks: 4, anchorWeek: '2027-W50' };

  it('2028-W01 is week 4 of the same block as 2027-W50 (offset = 3, not 4)', () => {
    expect(getBlockPosition('2028-W01', settings)).toEqual({ weekInBlock: 4, totalWeeks: 4 });
  });

  it('person for 2028-W01 is Alice (same block — no spurious rotation advance)', () => {
    expect(getOnCallPerson('2028-W01', settings)).toBe('Alice');
  });

  it('2028-W02 starts a new block (weekInBlock = 1, person = Bob)', () => {
    expect(getBlockPosition('2028-W02', settings)).toEqual({ weekInBlock: 1, totalWeeks: 4 });
    expect(getOnCallPerson('2028-W02', settings)).toBe('Bob');
  });

  it('consecutive week positions across the boundary advance by exactly 1', () => {
    const weeks = ['2027-W50', '2027-W51', '2027-W52', '2028-W01', '2028-W02', '2028-W03'];
    const positions = weeks.map(w => getBlockPosition(w, settings));
    for (let i = 1; i < positions.length; i++) {
      const prev = positions[i - 1];
      const curr = positions[i];
      const expected = prev.weekInBlock === prev.totalWeeks ? 1 : prev.weekInBlock + 1;
      expect(curr.weekInBlock).toBe(expected);
    }
  });
});

// ─── Boundary: 53-week year 2026 → 2027 ────────────────────────────────────

describe('53-week boundary (2026-W53 → 2027-W01)', () => {
  // 2026 has 53 ISO weeks. The old formula happened to work here, but we
  // verify the fixed formula also gives correct sequential positions.
  const settings = { rotation: ['Alice', 'Bob', 'Charlie'], blockWeeks: 4, anchorWeek: '2026-W51' };

  it('consecutive week positions across the 53-week boundary advance by exactly 1', () => {
    const weeks = ['2026-W51', '2026-W52', '2026-W53', '2027-W01', '2027-W02'];
    const positions = weeks.map(w => getBlockPosition(w, settings));
    for (let i = 1; i < positions.length; i++) {
      const prev = positions[i - 1];
      const curr = positions[i];
      const expected = prev.weekInBlock === prev.totalWeeks ? 1 : prev.weekInBlock + 1;
      expect(curr.weekInBlock).toBe(expected);
    }
  });

  it('2027-W01 is exactly 3 weeks after 2026-W51 (weekInBlock 4)', () => {
    expect(getBlockPosition('2027-W01', settings)).toEqual({ weekInBlock: 4, totalWeeks: 4 });
  });
});

// ─── addWeeks round-trips ────────────────────────────────────────────────────

describe('addWeeks', () => {
  it('addWeeks basic', () => {
    expect(addWeeks('2026-W01', 1)).toBe('2026-W02');
    expect(addWeeks('2026-W52', 1)).toBe('2026-W53');
    expect(addWeeks('2026-W53', 1)).toBe('2027-W01');
    expect(addWeeks('2027-W52', 1)).toBe('2028-W01');
  });

  it('addWeeks with n=0 is identity', () => {
    expect(addWeeks('2026-W15', 0)).toBe('2026-W15');
  });

  it('addWeeks with negative n goes backwards', () => {
    expect(addWeeks('2027-W01', -1)).toBe('2026-W53');
    expect(addWeeks('2028-W01', -1)).toBe('2027-W52');
  });
});

// ─── Override precedence and clearing ───────────────────────────────────────

describe('getOnCallForWeek: override precedence', () => {
  const settings = { rotation: ['Alice', 'Bob'], blockWeeks: 4, anchorWeek: '2026-W01' };

  it('override wins over rotation', () => {
    const overrides = [{ week_key: '2026-W03', person_name: 'Charlie', note: 'cover' }];
    const result = getOnCallForWeek('2026-W03', settings, overrides);
    expect(result).toEqual({ person: 'Charlie', isOverride: true, note: 'cover' });
  });

  it('falls back to rotation when no override for that week', () => {
    // offset 0 from anchor → Alice
    const result = getOnCallForWeek('2026-W01', settings, []);
    expect(result).toEqual({ person: 'Alice', isOverride: false, note: null });
  });

  it('clearing override (empty array) returns to rotation assignment', () => {
    const weekStr = '2026-W01';
    const withOverride = getOnCallForWeek(weekStr, settings, [
      { week_key: weekStr, person_name: 'Zoe', note: null },
    ]);
    expect(withOverride.person).toBe('Zoe');
    expect(withOverride.isOverride).toBe(true);

    const cleared = getOnCallForWeek(weekStr, settings, []);
    expect(cleared.person).toBe('Alice');
    expect(cleared.isOverride).toBe(false);
  });

  it('override for a different week does not affect the queried week', () => {
    const overrides = [{ week_key: '2026-W05', person_name: 'Dave', note: null }];
    const result = getOnCallForWeek('2026-W01', settings, overrides);
    expect(result.isOverride).toBe(false);
    expect(result.person).toBe('Alice');
  });

  it('returns null for unconfigured rotation', () => {
    expect(getOnCallForWeek('2026-W01', { rotation: [], blockWeeks: 4, anchorWeek: '2026-W01' }, [])).toBeNull();
  });
});
