// ─── Holiday closure utilities ────────────────────────────────────────────────
// Pure module — no React or Supabase imports.

export const CLOSURE_LOCATIONS = ['Phoenix', 'Chandler', 'Estrella', 'Scottsdale', 'OBS'];

/**
 * Build a closure map from federal holidays + calendar_overrides.
 *
 * @param {Array<{date: string, name: string}>} federalHolidays - from getFederalHolidays()
 * @param {Array} calendarOverrides - rows from calendar_overrides table
 * @returns {Map<string, ClosureEntry>}
 *
 * ClosureEntry = {
 *   name: string,              // holiday name or office-closed label
 *   kind: 'holiday'|'office_closed',
 *   closedLocations: string[]|null,  // null = all locations; array = specific locations CLOSED
 *   moved: boolean,            // true if this is a moved-to date for a holiday
 *   originalDate: string|null, // computed holiday date (only when moved=true)
 * }
 *
 * Multiple office_closed entries on the same date are merged (union of closed locations;
 * if any entry is all-locations, the merge is all-locations).
 * The original computed date of a moved holiday does NOT appear in the map — it's a normal day.
 */
export function buildClosureMap(federalHolidays, calendarOverrides) {
  const movedByName = new Map(
    calendarOverrides.filter(o => o.kind === 'holiday_moved').map(o => [o.holiday_name, o])
  );
  const openByDate = new Map(
    calendarOverrides.filter(o => o.kind === 'holiday_open').map(o => [o.date, o])
  );
  const scopeByDate = new Map(
    calendarOverrides.filter(o => o.kind === 'holiday_scope').map(o => [o.date, o])
  );
  const officeClosedEntries = calendarOverrides.filter(o => o.kind === 'office_closed');

  const result = new Map();

  for (const h of federalHolidays) {
    const movedOverride = movedByName.get(h.name);
    if (movedOverride) {
      const movedDate = movedOverride.date;
      if (!openByDate.has(movedDate)) {
        result.set(movedDate, { name: h.name, kind: 'holiday', closedLocations: null, moved: true, originalDate: h.date });
      }
      // Original computed date (h.date) is NOT added — treated as normal day
    } else {
      if (openByDate.has(h.date)) continue;
      const scopeOvr = scopeByDate.get(h.date);
      const closedLocations = (scopeOvr && scopeOvr.locations?.length > 0) ? scopeOvr.locations : null;
      result.set(h.date, { name: h.name, kind: 'holiday', closedLocations, moved: false, originalDate: null });
    }
  }

  for (const o of officeClosedEntries) {
    const closedLocations = (o.locations && o.locations.length > 0) ? o.locations : null;
    if (!result.has(o.date)) {
      result.set(o.date, { name: o.label ?? 'Office Closed', kind: 'office_closed', closedLocations, moved: false, originalDate: null });
    } else {
      const ex = result.get(o.date);
      const merged = (ex.closedLocations === null || closedLocations === null)
        ? null
        : [...new Set([...ex.closedLocations, ...closedLocations])];
      result.set(o.date, { ...ex, closedLocations: merged });
    }
  }

  return result;
}

/**
 * Given a closure map and open clinics with their week dates, compute:
 *   closedClinicIds  - Set<clinicId>: clinics whose location is closed (excluded from generation)
 *   workedHolidayMap - Map<clinicId, name>: clinics open on a partial-/full-holiday date
 *                      (clinic is at an open location while holiday applies elsewhere)
 *
 * weekDateMap: { Mon: 'YYYY-MM-DD', Tue: 'YYYY-MM-DD', ... }
 */
export function computeClinicHolidaySets(closureMap, clinics, weekDateMap) {
  const closedClinicIds = new Set();
  const workedHolidayMap = new Map();
  for (const clinic of clinics) {
    if (!clinic.open) continue;
    const dateStr = weekDateMap[clinic.day];
    if (!dateStr) continue;
    const closure = closureMap.get(dateStr);
    if (!closure) continue;
    const locationClosed = closure.closedLocations === null || closure.closedLocations.includes(clinic.location);
    if (locationClosed) {
      closedClinicIds.add(clinic.id);
    } else if (closure.kind === 'holiday') {
      workedHolidayMap.set(clinic.id, closure.name);
    }
  }
  return { closedClinicIds, workedHolidayMap };
}
