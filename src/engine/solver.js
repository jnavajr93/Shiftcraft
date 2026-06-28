// ============================================================================
// SOLVER
// ----------------------------------------------------------------------------
// Generic placement engine. For each day, for each active shift, it fills the
// required roles from the eligible people pool while respecting constraints,
// and flags anything it can't satisfy. Knows nothing about ophthalmology — it
// only knows roles, locations, people, shifts, and the 6 constraint types.
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
    const cards = [];
    const issues = [];

    // 1) Resolve must-pair anchors first so paired people are locked early.
    const pairings = cfg.constraints.filter(
      (c) => c.enabled && c.type === CT.MUST_PAIR
    );

    // Sort shifts so the most-constrained (largest min-staff) fill first.
    const sorted = [...dayShifts].sort(
      (a, b) => totalMin(b.locationId, cfg) - totalMin(a.locationId, cfg)
    );

    for (const shift of sorted) {
      const loc = idx.locations[shift.locationId];
      const req = staffingFor(shift.locationId, cfg);
      const assigned = []; // { personId, roleId }
      const hrs = shiftHours(shift);

      // a) Apply pairings: any person paired to this anchor shift.
      // HOUR_CAP is not checked here — explicit pairings are user overrides.
      pairings.forEach((p) => {
        if (p.anchorId !== shift.id) return;
        const person = idx.people[p.personId];
        if (person && !used.has(person.id) && !isUnavailable(person.id, day, cfg)) {
          const roleId = person.roles[0];
          assigned.push({ personId: person.id, roleId });
          used.add(person.id);
          weekHours[person.id] = (weekHours[person.id] || 0) + hrs;
        }
      });

      // b) Fill each required role up to its minimum.
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
            weekHours[candidate.id] = (weekHours[candidate.id] || 0) + hrs;
          } else {
            const roleName = idx.roles[roleId]?.name || 'staff';
            issues.push(`${shift.name}: needs ${need - i} more ${roleName}`);
            break;
          }
        }
      }

      // Staffing summary (computed before assigned is mapped, while roleIds are available)
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
