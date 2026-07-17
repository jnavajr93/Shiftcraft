// ============================================================================
// SOLVER
// ----------------------------------------------------------------------------
// Generic placement engine. For each day, for each active shift, it fills the
// required roles from the eligible people pool while respecting constraints,
// and flags anything it can't satisfy. Knows nothing about ophthalmology — it
// only knows roles, locations, people, shifts, and the 6 constraint types.
//
// EXECUTION ORDER (per day):
//   Phase 1 — high-priority shifts (priority > 0, i.e. OBS):
//     a. MUST_PAIR pre-pass for OBS shifts only → reserve locked people
//     b. Fill OBS slots; mark placed people + their blockedIds as used
//   Phase 2 — regular shifts (priority === 0):
//     a. MUST_PAIR pre-pass for regular shifts only → reserved people who
//        survived Phase 1 (OBS-placed people are already in `used` and skip)
//     b. Fill regular slots; OBS-placed people are excluded by `used`
//
// This guarantees OBS is ALWAYS filled before any front desk / regular slot,
// regardless of lockedTo (MUST_PAIR) constraints on regular clinics.
// ============================================================================

import { CONSTRAINT_TYPES as CT } from './schema.js';

// Build fast lookup maps from the config arrays.
function indexConfig(cfg) {
  const byId = (arr) => arr.reduce((m, x) => ((m[x.id] = x), m), {});
  return {
    roles: byId(cfg.roles),
    locations: byId(cfg.locations),
    people: byId(cfg.people),
    shifts: byId(cfg.shifts),
  };
}

// Is this person off on this day per UNAVAILABLE constraints?
function isUnavailable(personId, day, cfg) {
  return cfg.constraints.some(
    (c) =>
      c.enabled &&
      c.type === CT.UNAVAILABLE &&
      c.personId === personId &&
      (c.days || []).includes(day)
  );
}

// Whitelist: if a location has any whitelist constraint, only listed people allowed.
function whitelistFor(locationId, cfg) {
  const wl = cfg.constraints.filter(
    (c) => c.enabled && c.type === CT.WHITELIST && c.locationId === locationId
  );
  if (!wl.length) return null; // no restriction
  const allowed = new Set();
  wl.forEach((c) => (c.people || []).forEach((p) => allowed.add(p)));
  return allowed;
}

function canStaff(person, locationId, roleId, day, cfg) {
  if (!person) return false;
  if (!person.roles.includes(roleId)) return false;
  if (person.locations.length && !person.locations.includes(locationId)) return false;
  if (isUnavailable(person.id, day, cfg)) return false;
  const wl = whitelistFor(locationId, cfg);
  if (wl && !wl.has(person.id)) return false;
  return true;
}

// Staffing requirements for a location: { roleId: {min, max} }
function staffingFor(locationId, cfg) {
  const req = {};
  cfg.constraints.forEach((c) => {
    if (!c.enabled || c.locationId !== locationId) return;
    if (c.type === CT.MIN_STAFF) {
      req[c.roleId] = req[c.roleId] || {};
      req[c.roleId].min = c.count;
    }
    if (c.type === CT.MAX_STAFF) {
      req[c.roleId] = req[c.roleId] || {};
      req[c.roleId].max = c.count;
    }
  });
  return req;
}

function shiftHours(shift) {
  return Math.max(0, ((shift.end ?? 0) - (shift.start ?? 0)) / 60);
}

function exceedsHourCap(personId, additionalHrs, weekHours, cfg) {
  const cap = cfg.constraints.find(
    (c) => c.enabled && c.type === CT.HOUR_CAP && c.personId === personId
  );
  if (!cap) return false;
  return (weekHours[personId] || 0) + additionalHrs > cap.count;
}

/**
 * Fill a single shift — apply pre-reserved people, then fill each required
 * role from the remaining eligible pool. Mutates `used`, `weekHours`, `cards`,
 * and `issues` in place, and logs each assignment to the console so callers
 * can verify execution order.
 */
function fillShift(shift, reservations, used, weekHours, cards, issues, idx, cfg, day) {
  const loc = idx.locations[shift.locationId];
  const req = staffingFor(shift.locationId, cfg);
  const hrs = shiftHours(shift);

  const assigned = [];

  // Apply pre-reserved (MUST_PAIR) people — hours credited here.
  for (const res of (reservations[shift.id] ?? [])) {
    assigned.push(res);
    weekHours[res.personId] = (weekHours[res.personId] || 0) + hrs;
    console.log(
      `[Shiftcraft fill] ${day} | ${shift.name} @ ${loc?.name ?? shift.locationId}` +
      ` | ${res.roleId} → ${idx.people[res.personId]?.name ?? res.personId} (MUST_PAIR)`
    );
  }

  // Fill each required role up to its minimum.
  for (const roleId of Object.keys(req)) {
    const need = req[roleId].min || 0;
    const have = assigned.filter((a) => a.roleId === roleId).length;
    for (let i = have; i < need; i++) {
      const candidate = cfg.people.find(
        (person) =>
          !used.has(person.id) &&
          !exceedsHourCap(person.id, hrs, weekHours, cfg) &&
          canStaff(person, shift.locationId, roleId, day, cfg)
      );
      if (candidate) {
        assigned.push({ personId: candidate.id, roleId });
        used.add(candidate.id);
        for (const lid of (candidate.blockedIds ?? [])) used.add(lid);
        weekHours[candidate.id] = (weekHours[candidate.id] || 0) + hrs;
        console.log(
          `[Shiftcraft fill] ${day} | ${shift.name} @ ${loc?.name ?? shift.locationId}` +
          ` | ${roleId} → ${idx.people[candidate.id]?.name ?? candidate.id}`
        );
      } else {
        const roleName = idx.roles[roleId]?.name || 'staff';
        issues.push(`${shift.name}: needs ${need - i} more ${roleName}`);
        console.warn(
          `[Shiftcraft fill] ${day} | ${shift.name} @ ${loc?.name ?? shift.locationId}` +
          ` | ${roleId} → EMPTY (no eligible candidate)`
        );
        break;
      }
    }
  }

  const staffing = Object.entries(req).map(([roleId, bounds]) => ({
    role: idx.roles[roleId]?.name || '?',
    min: bounds.min || 0,
    max: bounds.max ?? null,
    have: assigned.filter((a) => a.roleId === roleId).length,
  }));

  cards.push({
    shiftId: shift.id,
    shiftName: shift.name,
    location: loc ? loc.name : '—',
    start: shift.start,
    end: shift.end,
    staffing,
    assigned: assigned.map((a) => ({
      personId: a.personId,
      name: idx.people[a.personId]?.name || '?',
      role: idx.roles[a.roleId]?.name || '?',
      color: idx.people[a.personId]?.color || '#888',
    })),
  });
}

// Main entry: returns { [day]: { shifts:[...], unplaced:[...], issues:[...] } }
// week: 'A', 'B', or null (null = include all shifts regardless of week tag)
export function solve(cfg, week = null) {
  const idx = indexConfig(cfg);
  const result = {};
  const weekHours = {}; // cumulative hours per person across all days

  for (const day of activeDays(cfg, week)) {
    const used = new Set(); // personIds already placed today
    const dayShifts = cfg.shifts.filter(
      (s) =>
        (s.days || []).includes(day) &&
        (s.week == null || week == null || s.week === week)
    );

    // Split into two phases by priority.
    // Phase 1 = high-priority shifts (priority > 0, currently OBS).
    // Phase 2 = regular shifts (priority === 0).
    // Within each phase sort by most-constrained location (totalMin) descending.
    const phase1Shifts = dayShifts
      .filter((s) => (s.priority ?? 0) > 0)
      .sort((a, b) => totalMin(b.locationId, cfg) - totalMin(a.locationId, cfg));

    const phase2Shifts = dayShifts
      .filter((s) => (s.priority ?? 0) === 0)
      .sort((a, b) => totalMin(b.locationId, cfg) - totalMin(a.locationId, cfg));

    const phase1ShiftIds = new Set(phase1Shifts.map((s) => s.id));
    const phase2ShiftIds = new Set(phase2Shifts.map((s) => s.id));
    const allPairings = cfg.constraints.filter(
      (c) => c.enabled && c.type === CT.MUST_PAIR
    );

    const cards = [];
    const issues = [];
    const reservations = {}; // shiftId → [{personId, roleId}]

    if (phase1Shifts.length > 0) {
      console.log(`[Shiftcraft fill] ${day} ── Phase 1: OBS (${phase1Shifts.map(s => s.name).join(', ')})`);
    }

    // ── Phase 1 pre-pass: MUST_PAIR for OBS shifts only ──────────────────────
    for (const p of allPairings) {
      if (!phase1ShiftIds.has(p.anchorId)) continue;
      const person = idx.people[p.personId];
      if (!person || used.has(person.id) || isUnavailable(person.id, day, cfg)) continue;
      const roleId = p.slot ?? person.roles[0];
      // Guard: only reserve if the resolved role is actually required by the target shift.
      // A stale lockedTo entry with blank provider can match OBS clinics (provider:''),
      // and an admin's roles[0]='frontDesk' would produce an invalid OBS+frontDesk reservation.
      const anchorShift = idx.shifts[p.anchorId];
      if (!anchorShift) continue;
      const anchorReq = staffingFor(anchorShift.locationId, cfg);
      if (!anchorReq[roleId]) {
        console.warn(`[Shiftcraft MUST_PAIR] Skipping ${person.name} → ${anchorShift.name||'OBS'} with role "${roleId}" — not required by that shift (required: ${Object.keys(anchorReq).join(', ')})`);
        continue;
      }
      if (!reservations[p.anchorId]) reservations[p.anchorId] = [];
      reservations[p.anchorId].push({ personId: person.id, roleId });
      used.add(person.id);
      for (const lid of (person.blockedIds ?? [])) used.add(lid);
    }

    // ── Phase 1: Fill OBS shifts ──────────────────────────────────────────────
    for (const shift of phase1Shifts) {
      fillShift(shift, reservations, used, weekHours, cards, issues, idx, cfg, day);
    }

    if (phase2Shifts.length > 0) {
      console.log(`[Shiftcraft fill] ${day} ── Phase 2: regular (${phase2Shifts.map(s => s.name).join(', ')})`);
    }

    // ── Phase 2 pre-pass: MUST_PAIR for regular shifts only ──────────────────
    // OBS-placed people are already in `used` and will be skipped here,
    // so a person locked to a regular clinic who was consumed by OBS stays in OBS.
    for (const p of allPairings) {
      if (!phase2ShiftIds.has(p.anchorId)) continue;
      const person = idx.people[p.personId];
      if (!person || used.has(person.id) || isUnavailable(person.id, day, cfg)) continue;
      const roleId = p.slot ?? person.roles[0];
      // Same guard as Phase 1: skip if the resolved role isn't required by the shift.
      const anchorShift = idx.shifts[p.anchorId];
      if (!anchorShift) continue;
      const anchorReq = staffingFor(anchorShift.locationId, cfg);
      if (!anchorReq[roleId]) {
        console.warn(`[Shiftcraft MUST_PAIR] Skipping ${person.name} → ${anchorShift.name||'(empty)'} with role "${roleId}" — not required (required: ${Object.keys(anchorReq).join(', ')})`);
        continue;
      }
      if (!reservations[p.anchorId]) reservations[p.anchorId] = [];
      reservations[p.anchorId].push({ personId: person.id, roleId });
      used.add(person.id);
      for (const lid of (person.blockedIds ?? [])) used.add(lid);
    }

    // ── Phase 2: Fill regular shifts ─────────────────────────────────────────
    for (const shift of phase2Shifts) {
      fillShift(shift, reservations, used, weekHours, cards, issues, idx, cfg, day);
    }

    const unplaced = cfg.people
      .filter((p) => !used.has(p.id) && !isUnavailable(p.id, day, cfg))
      .map((p) => ({ personId: p.id, name: p.name, color: p.color }));

    result[day] = { shifts: cards, unplaced, issues };
  }
  return result;
}

function totalMin(locationId, cfg) {
  return cfg.constraints
    .filter((c) => c.enabled && c.type === CT.MIN_STAFF && c.locationId === locationId)
    .reduce((s, c) => s + (c.count || 0), 0);
}

// Compute total weekly hours per person from a solve() result.
// Uses start/end stored on each card — no cfg dependency.
export function computeHours(result) {
  const totals = {};
  Object.values(result).forEach((day) => {
    day.shifts.forEach((card) => {
      const hrs = Math.max(0, ((card.end ?? 0) - (card.start ?? 0)) / 60);
      card.assigned.forEach((a) => {
        totals[a.personId] = (totals[a.personId] || 0) + hrs;
      });
    });
  });
  return totals;
}

function activeDays(cfg, week = null) {
  const set = new Set();
  cfg.shifts
    .filter((s) => s.week == null || week == null || s.week === week)
    .forEach((s) => (s.days || []).forEach((d) => set.add(d)));
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].filter((d) => set.has(d));
}
