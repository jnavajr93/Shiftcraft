import { describe, it, expect } from 'vitest';
import {
  dayToDateStr,
  getAbsencesOnDay,
  absenceOverlapsSlot,
  getBlockingAbsence,
  formatAbsenceIneligibleReason,
  unavailableLabel,
  formatAbsenceBlockMsg,
} from '../absenceUtils.js';

// Test week: Mon 2026-07-27 … Fri 2026-07-31
const WEEK_MONDAY = new Date('2026-07-27T00:00:00Z');

// Helper to build an absence record
function makeAbsence(overrides) {
  return {
    person_name: 'alice',
    start_date: '2026-07-27',
    end_date: '2026-07-27',
    type: 'Approved Time Off',
    partial_start: null,
    partial_end: null,
    ...overrides,
  };
}

// ─── dayToDateStr ──────────────────────────────────────────────────────────────
describe('dayToDateStr', () => {
  it('converts Mon to 2026-07-27', () => {
    expect(dayToDateStr('Mon', WEEK_MONDAY)).toBe('2026-07-27');
  });
  it('converts Fri to 2026-07-31', () => {
    expect(dayToDateStr('Fri', WEEK_MONDAY)).toBe('2026-07-31');
  });
  it('returns null for invalid day', () => {
    expect(dayToDateStr('Sat', WEEK_MONDAY)).toBeNull();
  });
});

// ─── getAbsencesOnDay ──────────────────────────────────────────────────────────
describe('getAbsencesOnDay', () => {
  it('returns full-day absence on matching day', () => {
    const absences = [makeAbsence({ person_name: 'alice', start_date: '2026-07-27', end_date: '2026-07-27' })];
    const result = getAbsencesOnDay('alice', 'Mon', WEEK_MONDAY, absences);
    expect(result).toHaveLength(1);
  });

  it('returns partial-day absence', () => {
    const absences = [makeAbsence({
      person_name: 'alice',
      start_date: '2026-07-27',
      end_date: '2026-07-27',
      partial_start: 480,
      partial_end: 720,
    })];
    const result = getAbsencesOnDay('alice', 'Mon', WEEK_MONDAY, absences);
    expect(result).toHaveLength(1);
  });

  it('returns absence spanning multiple days (mid-range day)', () => {
    const absences = [makeAbsence({ start_date: '2026-07-27', end_date: '2026-07-31' })];
    const result = getAbsencesOnDay('alice', 'Wed', WEEK_MONDAY, absences);
    expect(result).toHaveLength(1);
  });

  it('excludes absence for different person', () => {
    const absences = [makeAbsence({ person_name: 'bob' })];
    const result = getAbsencesOnDay('alice', 'Mon', WEEK_MONDAY, absences);
    expect(result).toHaveLength(0);
  });

  it('excludes DoctorOff type', () => {
    const absences = [makeAbsence({ type: 'DoctorOff' })];
    const result = getAbsencesOnDay('alice', 'Mon', WEEK_MONDAY, absences);
    expect(result).toHaveLength(0);
  });

  it('excludes Research type', () => {
    const absences = [makeAbsence({ type: 'Research' })];
    const result = getAbsencesOnDay('alice', 'Mon', WEEK_MONDAY, absences);
    expect(result).toHaveLength(0);
  });

  it('excludes absence outside the date range', () => {
    const absences = [makeAbsence({ start_date: '2026-07-28', end_date: '2026-07-31' })];
    const result = getAbsencesOnDay('alice', 'Mon', WEEK_MONDAY, absences);
    expect(result).toHaveLength(0);
  });
});

// ─── absenceOverlapsSlot ───────────────────────────────────────────────────────
describe('absenceOverlapsSlot', () => {
  it('full-day absence always overlaps (null slot)', () => {
    const absence = makeAbsence();
    expect(absenceOverlapsSlot(absence, null, null)).toBe(true);
  });

  it('full-day absence overlaps a timed slot', () => {
    const absence = makeAbsence();
    expect(absenceOverlapsSlot(absence, 480, 720)).toBe(true);
  });

  it('partial-day overlaps overlapping slot (partial inside slot)', () => {
    // absence: 8 AM–12 PM (480–720), slot: 7 AM–1 PM (420–780)
    const absence = makeAbsence({ partial_start: 480, partial_end: 720 });
    expect(absenceOverlapsSlot(absence, 420, 780)).toBe(true);
  });

  it('partial-day overlaps slot that starts before and ends mid-absence', () => {
    // absence: 8–12, slot: 7–9
    const absence = makeAbsence({ partial_start: 480, partial_end: 720 });
    expect(absenceOverlapsSlot(absence, 420, 540)).toBe(true);
  });

  it('partial-day does NOT overlap non-overlapping slot (slot ends before absence)', () => {
    // absence: 8–12 (480–720), slot: 6–8 (360–480)
    const absence = makeAbsence({ partial_start: 480, partial_end: 720 });
    expect(absenceOverlapsSlot(absence, 360, 480)).toBe(false);
  });

  it('partial-day does NOT overlap slot that starts after absence ends', () => {
    // absence: 8–12 (480–720), slot: 12–4 PM (720–960)
    const absence = makeAbsence({ partial_start: 480, partial_end: 720 });
    expect(absenceOverlapsSlot(absence, 720, 960)).toBe(false);
  });
});

// ─── getBlockingAbsence ────────────────────────────────────────────────────────
describe('getBlockingAbsence', () => {
  it('full-day absence blocks all slots (null slotStart/End)', () => {
    const absences = [makeAbsence()];
    const result = getBlockingAbsence('alice', 'Mon', WEEK_MONDAY, absences, null, null);
    expect(result).not.toBeNull();
  });

  it('full-day absence blocks a timed slot', () => {
    const absences = [makeAbsence()];
    expect(getBlockingAbsence('alice', 'Mon', WEEK_MONDAY, absences, 480, 720)).not.toBeNull();
  });

  it('partial-day absence blocks overlapping slot', () => {
    // absence: 8–12 PM, slot: 7 AM–1 PM
    const absences = [makeAbsence({ partial_start: 480, partial_end: 720 })];
    expect(getBlockingAbsence('alice', 'Mon', WEEK_MONDAY, absences, 420, 780)).not.toBeNull();
  });

  it('partial-day absence does NOT block non-overlapping slot', () => {
    // absence: 8–12 PM (480–720), slot: 12 PM–4 PM (720–960)
    const absences = [makeAbsence({ partial_start: 480, partial_end: 720 })];
    expect(getBlockingAbsence('alice', 'Mon', WEEK_MONDAY, absences, 720, 960)).toBeNull();
  });

  it('returns null when no absence exists', () => {
    expect(getBlockingAbsence('alice', 'Mon', WEEK_MONDAY, [], 480, 720)).toBeNull();
  });

  it('DoctorOff does NOT block', () => {
    const absences = [makeAbsence({ type: 'DoctorOff' })];
    expect(getBlockingAbsence('alice', 'Mon', WEEK_MONDAY, absences, null, null)).toBeNull();
  });

  it('personKey matching is name-based (same person, both tech+admin records)', () => {
    // Simulates a linked-record scenario: absence stored under the canonical name,
    // both the tech ID lookup and admin ID lookup resolve to the same personKey.
    const absences = [makeAbsence({ person_name: 'Alice Smith' })];
    // Both records use the same trimmed-lowercase name key
    expect(getBlockingAbsence('alice smith', 'Mon', WEEK_MONDAY, absences, null, null)).not.toBeNull();
  });
});

// ─── formatAbsenceIneligibleReason ────────────────────────────────────────────
describe('formatAbsenceIneligibleReason', () => {
  it('full-day: returns "Absent — <type>"', () => {
    const absence = makeAbsence({ type: 'Approved Time Off' });
    expect(formatAbsenceIneligibleReason(absence)).toBe('Absent — Approved Time Off');
  });

  it('partial-day: returns "Absent <start>–<end> — <type>"', () => {
    // 8 AM (480) – 12 PM (720)
    const absence = makeAbsence({ type: 'Sick', partial_start: 480, partial_end: 720 });
    expect(formatAbsenceIneligibleReason(absence)).toBe('Absent 8 AM–12 PM — Sick');
  });
});

// ─── unavailableLabel ─────────────────────────────────────────────────────────
describe('unavailableLabel', () => {
  it('full-day: returns the type string', () => {
    const absence = makeAbsence({ type: 'Approved Time Off' });
    expect(unavailableLabel(absence)).toBe('Approved Time Off');
  });

  it('partial with end: "Sick · Off until 12 PM"', () => {
    const absence = makeAbsence({ type: 'Sick', partial_start: 480, partial_end: 720 });
    expect(unavailableLabel(absence)).toBe('Sick · Off until 12 PM');
  });

  it('partial with start only: "Sick · Off from 8 AM"', () => {
    const absence = makeAbsence({ type: 'Sick', partial_start: 480, partial_end: null });
    expect(unavailableLabel(absence)).toBe('Sick · Off from 8 AM');
  });
});

// ─── formatAbsenceBlockMsg ────────────────────────────────────────────────────
describe('formatAbsenceBlockMsg', () => {
  it('full-day: "{name} is off {day} — {type}"', () => {
    const absence = makeAbsence({ type: 'Approved Time Off' });
    expect(formatAbsenceBlockMsg('Alice', 'Mon', absence)).toBe('Alice is off Mon — Approved Time Off');
  });

  it('partial: appends time range', () => {
    const absence = makeAbsence({ type: 'Sick', partial_start: 480, partial_end: 720 });
    expect(formatAbsenceBlockMsg('Alice', 'Tue', absence)).toBe('Alice is off Tue — Sick (8 AM–12 PM)');
  });
});
