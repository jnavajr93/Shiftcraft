/**
 * OBS feature tests:
 *  1. Second Pre-Op/PACU slot (preop2) — optional, not auto-filled, no gap when empty
 *  2. Provider-specific OBS buffers — Dr. R (+3h span), Dr. A (+2h span), other (zero)
 *  3. Unknown OBS provider surfaces as a validation warning
 *  4. Buffered ranges produce correct overlap detection
 */
import { describe, it, expect } from 'vitest';
import { slotEffectiveRange, calcSlotHours, OBS_SLOT_TYPES } from '../data/seed.js';
import { findStaffingGaps } from './validator.js';
import { generateSchedule } from './adapter.js';

// ── Shared fixtures ─────────────────────────────────────────────────────────

const makeObsClinic = (provider, overrideSlots = {}) => ({
  id: 'thu-obs', day: 'Thu', location: 'OBS', open: true,
  startTime: 480, endTime: 1020, provider,
  slots: {
    preop:       { personId: 'p1' },
    preop2:      { personId: null },
    sterile:     { personId: 'p2' },
    circulator:  { personId: 'p3' },
    scrub:       { personId: 'p4' },
    ...overrideSlots,
  },
});

// ── 1. OBS_SLOT_TYPES ────────────────────────────────────────────────────────

describe('OBS_SLOT_TYPES', () => {
  it('includes preop2', () => {
    expect(OBS_SLOT_TYPES).toContain('preop2');
  });
  it('still includes all four original slots', () => {
    for (const s of ['preop', 'sterile', 'circulator', 'scrub']) {
      expect(OBS_SLOT_TYPES).toContain(s);
    }
  });
});

// ── 2. Provider buffers — slotEffectiveRange ─────────────────────────────────

describe('OBS buffers — slotEffectiveRange', () => {
  const drR = { provider: 'Dr. R', startTime: 480, endTime: 1020, slots: {} };
  const drA = { provider: 'Dr. A', startTime: 480, endTime: 1020, slots: {} };
  const drS = { provider: 'Dr. S', startTime: 480, endTime: 1020, slots: {} };

  for (const slot of OBS_SLOT_TYPES) {
    describe(slot, () => {
      it('Dr. R: 60 min early, 120 min late (3h extra span vs raw)', () => {
        const r = slotEffectiveRange(slot, drR);
        expect(r.start).toBe(480 - 60);  // 7:00 AM
        expect(r.end).toBe(1020 + 120);  // 5:00 PM
        const extraSpan = (r.end - r.start) / 60 - (1020 - 480) / 60;
        expect(extraSpan).toBe(3);
      });

      it('Dr. A: 60 min early, 60 min late (2h extra span vs raw)', () => {
        const r = slotEffectiveRange(slot, drA);
        expect(r.start).toBe(480 - 60);  // 7:00 AM
        expect(r.end).toBe(1020 + 60);   // 6:00 PM
        const extraSpan = (r.end - r.start) / 60 - (1020 - 480) / 60;
        expect(extraSpan).toBe(2);
      });

      it('Other provider: zero buffer (raw clinic times)', () => {
        const r = slotEffectiveRange(slot, drS);
        expect(r.start).toBe(480);
        expect(r.end).toBe(1020);
      });
    });
  }

  it('custom start/end overrides buffer', () => {
    const drRWithCustom = {
      provider: 'Dr. R', startTime: 480, endTime: 1020,
      slots: { preop: { personId: 'x', start: 500, end: 1000 } },
    };
    const r = slotEffectiveRange('preop', drRWithCustom);
    expect(r.start).toBe(500);
    expect(r.end).toBe(1000);
  });
});

// ── 3. calcSlotHours with buffers ─────────────────────────────────────────────

describe('OBS calcSlotHours', () => {
  const drR = { provider: 'Dr. R', startTime: 480, endTime: 1020, slots: {} };
  const drA = { provider: 'Dr. A', startTime: 480, endTime: 1020, slots: {} };

  it('Dr. R preop: (1140-420)/60 = 12h; after lunch = 11h', () => {
    expect(calcSlotHours(drR, 'preop')).toBe(11);
  });
  it('Dr. R preop2: same as preop', () => {
    expect(calcSlotHours(drR, 'preop2')).toBe(calcSlotHours(drR, 'preop'));
  });
  it('Dr. A preop: (1080-420)/60 = 11h; after lunch = 10h', () => {
    expect(calcSlotHours(drA, 'preop')).toBe(10);
  });
});

// ── 4. preop2 optional — gap detection ───────────────────────────────────────

describe('preop2 optional — findStaffingGaps', () => {
  it('empty preop2 does NOT produce a staffing gap', () => {
    const clinic = makeObsClinic('Dr. R');
    const violations = findStaffingGaps([clinic]);
    expect(violations).toHaveLength(0);
  });

  it('empty preop (required) produces a gap; empty preop2 does not add more', () => {
    const clinic = makeObsClinic('Dr. R', { preop: { personId: null } });
    const violations = findStaffingGaps([clinic]);
    expect(violations.length).toBe(1);
    expect(violations[0].label).toContain('Pre-Op/PACU');
    expect(violations.every(v => !v.label.includes('Pre-Op/PACU 2'))).toBe(true);
  });

  it('filled preop2 is not flagged as a problem', () => {
    const clinic = makeObsClinic('Dr. R', { preop2: { personId: 'extra-person' } });
    const violations = findStaffingGaps([clinic]);
    expect(violations).toHaveLength(0);
  });
});

// ── 5. Unknown OBS provider warning ──────────────────────────────────────────

describe('Unknown OBS provider — findStaffingGaps', () => {
  it('Dr. S raises a validation warning', () => {
    const clinic = makeObsClinic('Dr. S');
    const violations = findStaffingGaps([clinic]);
    expect(violations.some(v => v.label.includes('Dr. S'))).toBe(true);
    expect(violations.some(v => v.label.includes('unexpected provider'))).toBe(true);
  });

  it('Dr. B raises a warning (not a known OBS provider)', () => {
    const clinic = makeObsClinic('Dr. B');
    const violations = findStaffingGaps([clinic]);
    expect(violations.some(v => v.label.includes('unexpected provider'))).toBe(true);
  });

  it('blank provider does NOT raise a warning (default OBS setup)', () => {
    const clinic = makeObsClinic('');
    const violations = findStaffingGaps([clinic]);
    expect(violations.some(v => v.label.includes('unexpected provider'))).toBe(false);
  });

  it('Dr. R does NOT raise a warning', () => {
    const clinic = makeObsClinic('Dr. R');
    const violations = findStaffingGaps([clinic]);
    expect(violations.some(v => v.label.includes('unexpected provider'))).toBe(false);
  });

  it('Dr. A does NOT raise a warning', () => {
    const clinic = makeObsClinic('Dr. A');
    const violations = findStaffingGaps([clinic]);
    expect(violations.some(v => v.label.includes('unexpected provider'))).toBe(false);
  });
});

// ── 6. Buffered ranges produce correct overlap detection ─────────────────────

describe('OBS buffered range overlap', () => {
  it('Dr. R OBS preop range overlaps regular clinic during buffered window', () => {
    // OBS: 7:00 AM–5:00 PM (buffered). Regular scribe during that window — should overlap.
    const drRClinic = { provider: 'Dr. R', startTime: 480, endTime: 1020, slots: {} };
    const regularClinic = { provider: 'Dr. A', startTime: 420, endTime: 900, slots: {} };
    const obsRange = slotEffectiveRange('preop', drRClinic);     // 420–1140
    const scrRange = slotEffectiveRange('scribe', regularClinic); // 420–975
    const overlaps = obsRange.start < scrRange.end && scrRange.start < obsRange.end;
    expect(overlaps).toBe(true);
  });

  it('preop2 range is identical to preop for the same provider', () => {
    const drRClinic = { provider: 'Dr. R', startTime: 480, endTime: 1020, slots: {} };
    const r1 = slotEffectiveRange('preop',  drRClinic);
    const r2 = slotEffectiveRange('preop2', drRClinic);
    expect(r1).toEqual(r2);
  });
});

// ── 7. preop2 NOT auto-filled by generateSchedule ────────────────────────────

describe('preop2 not auto-filled', () => {
  it('generateSchedule never assigns to preop2', () => {
    const globalData = {
      people: [
        {
          id: 'p1', name: 'Alice', color: '#000',
          roles: ['Pre-Op/PACU'], skills: [], clearedLocations: ['OBS'],
          preferredLocations: [], lockedTo: [], daysOff: [],
          availabilityWindows: {}, accommodations: [], targetHours: 40,
        },
        {
          id: 'p2', name: 'Bob', color: '#111',
          roles: ['Sterile Processing'], skills: [], clearedLocations: ['OBS'],
          preferredLocations: [], lockedTo: [], daysOff: [],
          availabilityWindows: {}, accommodations: [], targetHours: 40,
        },
      ],
      locations: ['OBS'],
      providers: [],
      clinics: [{
        id: 'thu-obs', day: 'Thu', location: 'OBS', provider: 'Dr. R', open: true,
        startTime: 480, endTime: 1020, patientCount: null,
        slots: { preop: { personId: null }, preop2: { personId: null }, sterile: { personId: null }, circulator: { personId: null }, scrub: { personId: null } },
      }],
      additionalTasks: [],
    };
    const { assignments } = generateSchedule(globalData);
    const preop2 = assignments.filter(a => a.slot === 'preop2');
    expect(preop2).toHaveLength(0);
  });
});
