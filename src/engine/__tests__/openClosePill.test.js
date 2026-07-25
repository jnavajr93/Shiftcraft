/**
 * Open/Close pill regression tests.
 *
 * Regressions fixed:
 *   - 'close' end string on middle/training → correctly uses endTime + 60 min
 *   - opener null/close end → correctly uses endTime + 60 min (not min(1020,endTime))
 *   - Display: null opener start → "Open" (not "?")
 *   - Display: null/close opener end → "Close" (not a time string)
 *   - slotEffectiveRange: opener null/close → endTime + 60
 *   - slotEffectiveRange: middle/training 'close' → endTime + 60
 */

import { describe, it, expect } from 'vitest';
import {
  formatVariableSlotTime,
  formatOpenerTimeDisplay,
  formatOpeningFDTimeDisplay,
  calcSlotHours,
  slotEffectiveRange,
} from '../../data/seed.js';
import { blankStandardSlots } from '../../../src/context/slotMap.js';

// Base clinic: 8 AM start (480), 5 PM end (1020)
function makeClinic(overrides = {}) {
  return {
    id: 'c1', provider: 'Dr. A', location: 'Phoenix', day: 'Mon',
    open: true, startTime: 480, endTime: 1020, patientCount: 30,
    slots: blankStandardSlots(),
    ...overrides,
  };
}

// ─── formatVariableSlotTime ───────────────────────────────────────────────────

describe('formatVariableSlotTime', () => {
  it('null start with non-null end → "Open – <time>"', () => {
    // minutesToTime omits :00 for on-the-hour values (e.g. "12 PM" not "12:00 PM")
    expect(formatVariableSlotTime({ start: null, end: 720 })).toBe('Open – 12 PM');
  });

  it('"close" end → shows "Close" (not the time string)', () => {
    expect(formatVariableSlotTime({ start: 600, end: 'close' })).toBe('10 AM – Close');
  });

  it('null start AND "close" end → "Open – Close"', () => {
    expect(formatVariableSlotTime({ start: null, end: 'close' })).toBe('Open – Close');
  });

  it('both null → returns null (no display)', () => {
    expect(formatVariableSlotTime({ start: null, end: null })).toBeNull();
  });

  it('normal start and end → formatted times (on-the-hour = no :00 suffix)', () => {
    expect(formatVariableSlotTime({ start: 480, end: 1020 })).toBe('8 AM – 5 PM');
  });

  it('non-zero minute start/end → shows minutes', () => {
    expect(formatVariableSlotTime({ start: 495, end: 1050 })).toBe('8:15 AM – 5:30 PM');
  });

  it('non-object slotVal → returns null', () => {
    expect(formatVariableSlotTime(null)).toBeNull();
    expect(formatVariableSlotTime('person-id')).toBeNull();
  });
});

// ─── formatOpenerTimeDisplay ──────────────────────────────────────────────────

describe('formatOpenerTimeDisplay', () => {
  const clinic = makeClinic(); // startTime = 480

  it('null start → "Open"', () => {
    const result = formatOpenerTimeDisplay(clinic, { start: null, end: null });
    expect(result.startsWith('Open')).toBe(true);
  });

  it('null end → "Close"', () => {
    const result = formatOpenerTimeDisplay(clinic, { start: null, end: null });
    expect(result.endsWith('Close')).toBe(true);
  });

  it('"close" string end → "Close"', () => {
    const result = formatOpenerTimeDisplay(clinic, { start: null, end: 'close' });
    expect(result.endsWith('Close')).toBe(true);
  });

  it('explicit non-null start overrides "Open" display', () => {
    const result = formatOpenerTimeDisplay(clinic, { start: 500, end: null });
    expect(result.startsWith('8:20 AM')).toBe(true);
  });

  it('explicit non-close end shows time', () => {
    // minutesToTime: 1080 = 6:00 PM → "6 PM" (no :00)
    const result = formatOpenerTimeDisplay(clinic, { start: null, end: 1080 });
    expect(result.endsWith('6 PM')).toBe(true);
  });

  it('migration compat: stored openTime literal (startTime - 15) still displays as "Open"', () => {
    // Pre-fix rows may hold clinic.startTime - 15 as a literal instead of null
    const openTime = clinic.startTime - 15; // 465
    const result = formatOpenerTimeDisplay(clinic, { start: openTime, end: null });
    expect(result.startsWith('Open')).toBe(true);
  });
});

// ─── formatOpeningFDTimeDisplay ───────────────────────────────────────────────

describe('formatOpeningFDTimeDisplay', () => {
  it('null start → "Open"', () => {
    const result = formatOpeningFDTimeDisplay({ start: null, end: null });
    expect(result.startsWith('Open')).toBe(true);
  });

  it('null end → "3:30 PM" (default)', () => {
    const result = formatOpeningFDTimeDisplay({ start: null, end: null });
    expect(result.endsWith('3:30 PM')).toBe(true);
  });

  it('"close" end → "Close" (not 3:30 PM)', () => {
    const result = formatOpeningFDTimeDisplay({ start: null, end: 'close' });
    expect(result.endsWith('Close')).toBe(true);
  });

  it('explicit time end → formatted time (3:00 PM = "3 PM")', () => {
    // minutesToTime: 900 = 15:00 → "3 PM" (no :00)
    const result = formatOpeningFDTimeDisplay({ start: null, end: 900 });
    expect(result.endsWith('3 PM')).toBe(true);
  });
});

// ─── calcSlotHours — opener close semantics ───────────────────────────────────

describe('calcSlotHours — opener null/close end', () => {
  it('opener with null end → uses endTime + 60 min (1020 + 60 = 1080) not min(1020, endTime)', () => {
    const clinic = makeClinic({ slots: { ...blankStandardSlots(), opener: { personId: null, start: null, end: null } } });
    // Expected: (1020 + 60) - (480 - 15) = 1080 - 465 = 615 min = 10.25h raw → lunchDeduct: 9.25h
    const raw = 615 / 60; // 10.25h
    const expected = raw - 1; // lunchDeduct for > 9h = -1h → 9.25h
    expect(calcSlotHours(clinic, 'opener')).toBeCloseTo(expected, 5);
  });

  it('opener with "close" end → same as null end (endTime + 60)', () => {
    const withNull  = makeClinic({ slots: { ...blankStandardSlots(), opener: { personId: null, start: null, end: null } } });
    const withClose = makeClinic({ slots: { ...blankStandardSlots(), opener: { personId: null, start: null, end: 'close' } } });
    expect(calcSlotHours(withNull, 'opener')).toBe(calcSlotHours(withClose, 'opener'));
  });

  it('opener with explicit numeric end → uses that value (not endTime+60)', () => {
    const clinic = makeClinic({ slots: { ...blankStandardSlots(), opener: { personId: null, start: null, end: 900 } } });
    // Expected: 900 - 465 = 435 min raw → lunchDeduct(435/60 = 7.25h) = 6.75h
    const expected = (900 - 465) / 60 - 0.5;
    expect(calcSlotHours(clinic, 'opener')).toBeCloseTo(expected, 5);
  });
});

// ─── calcSlotHours — middle/training close semantics ─────────────────────────

describe('calcSlotHours — middle/training "close" end', () => {
  it('middle with "close" end → uses endTime + 60 min', () => {
    const clinic = makeClinic({
      slots: { ...blankStandardSlots(), middle: { personId: null, start: 600, end: 'close' } },
    });
    // Expected raw: (1020 + 60) - 600 = 480 min = 8h → lunchDeduct(8) = 7.5h
    expect(calcSlotHours(clinic, 'middle')).toBeCloseTo(7.5, 5);
  });

  it('training with "close" end → uses endTime + 60 min', () => {
    const clinic = makeClinic({
      slots: { ...blankStandardSlots(), training: { personId: null, start: 600, end: 'close' } },
    });
    expect(calcSlotHours(clinic, 'training')).toBeCloseTo(7.5, 5);
  });

  it('middle with numeric end (not "close") → uses that value', () => {
    const clinic = makeClinic({
      slots: { ...blankStandardSlots(), middle: { personId: null, start: 600, end: 900 } },
    });
    // (900 - 600) / 60 = 5h → lunchDeduct(5) = 4.5h
    expect(calcSlotHours(clinic, 'middle')).toBeCloseTo(4.5, 5);
  });
});

// ─── slotEffectiveRange — close semantics ─────────────────────────────────────

describe('slotEffectiveRange — open/close semantics', () => {
  it('opener with null end → end = endTime + 60', () => {
    const clinic = makeClinic({ slots: { ...blankStandardSlots(), opener: { personId: null, start: null, end: null } } });
    const { end } = slotEffectiveRange('opener', clinic);
    expect(end).toBe(1020 + 60); // 1080
  });

  it('opener with "close" end → end = endTime + 60', () => {
    const clinic = makeClinic({ slots: { ...blankStandardSlots(), opener: { personId: null, start: null, end: 'close' } } });
    const { end } = slotEffectiveRange('opener', clinic);
    expect(end).toBe(1020 + 60);
  });

  it('opener null start → uses roleBufferRange default (startTime - 15)', () => {
    const clinic = makeClinic({ slots: { ...blankStandardSlots(), opener: { personId: null, start: null, end: null } } });
    const { start } = slotEffectiveRange('opener', clinic);
    expect(start).toBe(480 - 15); // 465
  });

  it('middle with "close" end → end = endTime + 60', () => {
    const clinic = makeClinic({ slots: { ...blankStandardSlots(), middle: { personId: null, start: 600, end: 'close' } } });
    const { end } = slotEffectiveRange('middle', clinic);
    expect(end).toBe(1020 + 60);
  });

  it('training with "close" end → end = endTime + 60', () => {
    const clinic = makeClinic({ slots: { ...blankStandardSlots(), training: { personId: null, start: 540, end: 'close' } } });
    const { end } = slotEffectiveRange('training', clinic);
    expect(end).toBe(1020 + 60);
  });

  it('opener with explicit numeric end → uses that value', () => {
    const clinic = makeClinic({ slots: { ...blankStandardSlots(), opener: { personId: null, start: null, end: 960 } } });
    const { end } = slotEffectiveRange('opener', clinic);
    expect(end).toBe(960);
  });

  it('scribe with explicit end → uses that value (not roleBufferRange default)', () => {
    const clinic = makeClinic({ slots: { ...blankStandardSlots(), scribe: { personId: null, start: null, end: 720 } } });
    const { end } = slotEffectiveRange('scribe', clinic);
    expect(end).toBe(720);
  });

  it('closing with null end → uses roleBufferRange default (endTime + 75)', () => {
    const clinic = makeClinic({ slots: { ...blankStandardSlots(), closing: { personId: null, start: null, end: null } } });
    // Note: closing is NOT an 'object' slot in blankStandardSlots — it's null string-typed
    // So sv is null → cs=null, ce=null → start=defaults.start, end=defaults.end
    // Wait, need to check blankStandardSlots closing type
    // Actually in blankStandardSlots closing is null (string type), not object
    // Let me use a proper object slot to test custom end override
    const clinicWithObj = makeClinic({ slots: { ...blankStandardSlots(), closing: 'p1' } });
    const { end: endDefault } = slotEffectiveRange('closing', clinicWithObj);
    expect(endDefault).toBe(1020 + 75); // roleBufferRange default
  });
});
