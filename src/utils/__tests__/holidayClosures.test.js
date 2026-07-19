import { describe, it, expect } from 'vitest';
import { buildClosureMap, computeClinicHolidaySets } from '../holidayClosures.js';
import { getFederalHolidays } from '../federalHolidays.js';

// Independence Day 2026: July 4 is a Saturday → observed Friday July 3
const independenceDay2026 = { date: '2026-07-03', name: 'Independence Day' };

describe('buildClosureMap', () => {
  it('default: observed holiday appears in map', () => {
    const map = buildClosureMap([independenceDay2026], []);
    expect(map.has('2026-07-03')).toBe(true);
    const entry = map.get('2026-07-03');
    expect(entry.name).toBe('Independence Day');
    expect(entry.closedLocations).toBe(null);
    expect(entry.moved).toBe(false);
  });

  it('holiday_open override: holiday excluded from map', () => {
    const overrides = [{ kind: 'holiday_open', date: '2026-07-03' }];
    const map = buildClosureMap([independenceDay2026], overrides);
    expect(map.has('2026-07-03')).toBe(false);
  });

  it('holiday_moved: original excluded, moved-to date included', () => {
    const overrides = [{ kind: 'holiday_moved', date: '2026-07-06', holiday_name: 'Independence Day' }];
    const map = buildClosureMap([independenceDay2026], overrides);
    expect(map.has('2026-07-03')).toBe(false);
    expect(map.has('2026-07-06')).toBe(true);
    const entry = map.get('2026-07-06');
    expect(entry.moved).toBe(true);
    expect(entry.originalDate).toBe('2026-07-03');
    expect(entry.name).toBe('Independence Day');
  });

  it('holiday_scope: closedLocations set correctly', () => {
    const overrides = [{ kind: 'holiday_scope', date: '2026-07-03', holiday_name: 'Independence Day', locations: ['Phoenix', 'Chandler'] }];
    const map = buildClosureMap([independenceDay2026], overrides);
    expect(map.has('2026-07-03')).toBe(true);
    const entry = map.get('2026-07-03');
    expect(entry.closedLocations).toEqual(['Phoenix', 'Chandler']);
  });

  it('office_closed: appears in map', () => {
    const overrides = [{ kind: 'office_closed', date: '2026-07-06', label: 'Staff training', locations: null }];
    const map = buildClosureMap([], overrides);
    expect(map.has('2026-07-06')).toBe(true);
    const entry = map.get('2026-07-06');
    expect(entry.name).toBe('Staff training');
    expect(entry.closedLocations).toBe(null);
  });
});

describe('computeClinicHolidaySets', () => {
  it('full closure: all clinics for that day in closedClinicIds', () => {
    const closureMap = new Map([
      ['2026-07-06', { name: 'Independence Day', kind: 'holiday', closedLocations: null, moved: true, originalDate: '2026-07-03' }],
    ]);
    const clinics = [{ id: 'c1', day: 'Mon', location: 'Phoenix', open: true }];
    const weekDateMap = { Mon: '2026-07-06' };
    const { closedClinicIds } = computeClinicHolidaySets(closureMap, clinics, weekDateMap);
    expect(closedClinicIds.has('c1')).toBe(true);
  });

  it('partial closure: only matching locations closed, others get workedHolidayMap', () => {
    const closureMap = new Map([
      ['2026-07-06', { name: 'Independence Day', kind: 'holiday', closedLocations: ['Phoenix', 'Chandler'], moved: false, originalDate: null }],
    ]);
    const clinics = [
      { id: 'c1', day: 'Mon', location: 'Phoenix', open: true },
      { id: 'c2', day: 'Mon', location: 'Estrella', open: true },
    ];
    const weekDateMap = { Mon: '2026-07-06' };
    const { closedClinicIds, workedHolidayMap } = computeClinicHolidaySets(closureMap, clinics, weekDateMap);
    expect(closedClinicIds.has('c1')).toBe(true);
    expect(closedClinicIds.has('c2')).toBe(false);
    expect(workedHolidayMap.get('c2')).toBe('Independence Day');
  });

  it('moved holiday: closed-to date closes clinic, original date ignored', () => {
    const holidays = getFederalHolidays(2026);
    const overrides = [{ kind: 'holiday_moved', date: '2026-07-06', holiday_name: 'Independence Day' }];
    const closureMap = buildClosureMap(holidays, overrides);
    const clinics = [
      { id: 'cMon', day: 'Mon', location: 'Phoenix', open: true },
      { id: 'cFri', day: 'Fri', location: 'Phoenix', open: true },
    ];
    // Mon = 2026-07-06 (moved-to date), Fri = 2026-07-03 (original computed date)
    const weekDateMap = { Mon: '2026-07-06', Fri: '2026-07-03' };
    const { closedClinicIds } = computeClinicHolidaySets(closureMap, clinics, weekDateMap);
    expect(closedClinicIds.has('cMon')).toBe(true);
    expect(closedClinicIds.has('cFri')).toBe(false);
  });
});
