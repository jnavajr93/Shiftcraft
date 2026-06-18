// ============================================================================
// SCHEDULER DATA MODEL
// ----------------------------------------------------------------------------
// Everything practice-specific lives in a single config object. The solver
// reads ONLY from this object — no hardcoded names, doctors, or locations.
// To adapt the tool to a different business, you edit data, not code.
// ============================================================================

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// ---- Constraint types -------------------------------------------------------
// Each rule a user creates is one of these typed objects. ~6 types cover the
// overwhelming majority of real-world scheduling rules.
export const CONSTRAINT_TYPES = {
  MIN_STAFF: 'min_staff',       // location needs >= N people of role R
  MAX_STAFF: 'max_staff',       // location allows <= N people of role R
  MUST_PAIR: 'must_pair',       // person follows a provider/anchor wherever they go
  WHITELIST: 'whitelist',       // only listed people may staff this location
  UNAVAILABLE: 'unavailable',   // person off on given day(s), optionally conditional
  HOUR_CAP: 'hour_cap',         // person <= N hours/week
};

// ---- Factory helpers (keeps shapes consistent) ------------------------------
let _id = 0;
export const uid = (p = 'id') => `${p}_${Date.now().toString(36)}_${(_id++).toString(36)}`;

export function makePerson(o = {}) {
  return {
    id: o.id || uid('p'),
    name: o.name || 'New person',
    roles: o.roles || [],          // role ids this person can fill
    locations: o.locations || [],  // location ids cleared for; [] = any
    targetHours: o.targetHours ?? null,
    color: o.color || '#64748b',
  };
}

export function makeRole(o = {}) {
  return { id: o.id || uid('r'), name: o.name || 'Role', opener: !!o.opener };
}

export function makeLocation(o = {}) {
  return { id: o.id || uid('l'), name: o.name || 'Location' };
}

// A "shift" is a thing that needs staffing on certain days at a location.
// In a clinic this is a provider's clinic; in a cafe it's "morning service".
export function makeShift(o = {}) {
  return {
    id: o.id || uid('s'),
    name: o.name || 'Shift',
    locationId: o.locationId || null,
    days: o.days || [],            // which DAYS this runs
    start: o.start ?? 480,         // minutes from midnight (480 = 8:00)
    end: o.end ?? 990,             // 990 = 4:30pm
    anchor: o.anchor || false,     // is this a "provider" others can pair to?
    week: o.week ?? null,          // 'A', 'B', or null (= runs every week)
  };
}

export function makeConstraint(o = {}) {
  return {
    id: o.id || uid('c'),
    type: o.type,
    enabled: o.enabled !== false,
    // fields below are type-dependent; unused ones stay undefined
    locationId: o.locationId,
    roleId: o.roleId,
    count: o.count,
    personId: o.personId,
    anchorId: o.anchorId,
    people: o.people,              // array of personIds (whitelist)
    days: o.days,                  // array of DAYS (unavailable)
    note: o.note || '',
  };
}

// ---- Time helpers -----------------------------------------------------------
export function minToStr(m) {
  if (m == null) return '';
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm.toString().padStart(2, '0')} ${ap}`;
}

export function emptyConfig() {
  return {
    meta: { name: 'Untitled schedule', updated: Date.now() },
    roles: [],
    locations: [],
    people: [],
    shifts: [],
    constraints: [],
  };
}
