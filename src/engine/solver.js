// ============================================================================
// SOLVER
// ----------------------------------------------------------------------------
// Generic placement engine. For each day, for each active shift, it fills the
// required roles from the eligible people pool while respecting constraints,
// and flags anything it can't satisfy. Knows nothing about ophthalmology — it
// only knows roles, locations, people, shifts, and the 6 constraint types.
//
// EXECUTION ORDER (per day):
//   Phase 1 — OBS (priority >= 10):
//     a. MUST_PAIR pre-pass for OBS shifts → reserve locked people
//     b. Fill OBS slots; mark placed people + their blockedIds as full-day-blocked.
//   Phase 1.5 — Dr. R split-day clinics (0 < priority < 10, sorted AM-first):
//     a. MUST_PAIR pre-pass for split-day shifts → reserve locked people with time ranges
//     b. Fill AM first, then PM. The AM team is still available for PM (no time overlap)
//        so the solver naturally carries the same team to both halves.
//   Phase 2 — regular clinics (priority === 0):
//     a. MUST_PAIR pre-pass for regular shifts → skip anyone already time-committed
//     b. Fill remaining shifts; split-day team blocked from same-time clinics.
//
// AVAILABILITY MODEL:
//   A person is excluded from a shift if any of the following:
//     - They are OBS-blocked (full-day exclusion — placed in OBS or it's an OBS shift)
//     - Their existing effective time range overlaps the candidate shift's window
//
//   Effective ranges per role (default, no custom slot start/end):
//     scribe / closing / closingFrontDesk : [shift.start,      shift.end + 75]
//     opener / openingFrontDesk           : [shift.start - 15, shift.end     ]
//     all other roles                     : [shift.start,      shift.end     ]
//
//   Two ranges [a.start, a.end) and [b.start, b.end) overlap iff a.start < b.end
//   AND b.start < a.end (strict). Touching boundaries (a.end === b.start) do NOT
//   overlap, which is intentional: the Dr. R split-day AM scribe's effective end
//   equals the PM start exactly, making the carry-across possible.
// ============================================================================

import { CONSTRAINT_TYPES as CT } from './schema.js';
import { lunchDeduct } from '../data/seed.js';

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

// ── Time-overlap availability tracking ───────────────────────────────────────

/**
 * Effective time range a person occupies when placed in roleId at shift.
 * Mirrors seed.js slotEffectiveRange() — must stay in sync.
 *   scribe/closing          : [start,      end + 75]
 *   opener                  : [start - 15, end     ]
 *   openingFrontDesk        : [start - 30, 3:30 PM ]   (no post buffer; end at 930)
 *   closingFrontDesk        : [10:30 AM,   end + 90]   (start at 630)
 *   frontDesk               : [start - 30, end + 90]   (both buffers)
 *   all other roles         : [start,      end     ]
 */
function effectiveRange(roleId, shift) {
  const s = shift.start ?? 0;
  const e = shift.end ?? 0;
  switch (roleId) {
    case 'scribe':
      return { start: s, end: e + 75 };
    case 'closing':
      return { start: Math.max(540, s), end: e + 75 };
    case 'opener':
      return { start: s - 15, end: Math.min(1020, e) };
    case 'openingFrontDesk':
      return { start: s - 30, end: 930 };
    case 'closingFrontDesk':
      return { start: 630, end: e + 90 };
    case 'frontDesk':
      return { start: s - 30, end: e + 90 };
    default:
      return { start: s, end: e };
  }
}

/** Hours for a specific role at a shift, including role-specific buffers and lunch deduction. */
function roleHours(roleId, shift) {
  const r = effectiveRange(roleId, shift);
  return lunchDeduct(Math.max(0, (r.end - r.start) / 60));
}

/**
 * Mark a person (and all their blockedIds) as placed.
 * usedRanges: Map<personId, { obsBlock: bool, ranges: [{start,end}] }>
 * OBS placement → obsBlock = true (full-day exclusion).
 * Regular placement → push effective time range.
 */
function markPlaced(personId, roleId, shift, isObs, usedRanges, blockedIds) {
  const mark = (id) => {
    if (!usedRanges.has(id)) usedRanges.set(id, { obsBlock: false, ranges: [] });
    const entry = usedRanges.get(id);
    if (isObs) {
      entry.obsBlock = true;
    } else {
      entry.ranges.push(effectiveRange(roleId, shift));
    }
  };
  mark(personId);
  for (const lid of (blockedIds ?? [])) mark(lid);
}

/**
 * Check if a person can be placed in roleId at a shift.
 * - OBS target: requires no existing commitments (full-day occupation).
 * - Regular target: checks whether the role's effective time range (with buffers)
 *   overlaps any already-committed range. Touching boundaries are NOT an overlap.
 * obsBlock persons are always excluded.
 */
function isAvailableForShift(personId, roleId, shift, isObs, usedRanges) {
  const entry = usedRanges.get(personId);
  if (!entry) return true;
  if (entry.obsBlock) return false;
  if (isObs) {
    // OBS is a full-day commitment — any existing time range blocks it.
    return entry.ranges.length === 0;
  }
  // Use the effective range of the new role (includes FD buffers, scribe/closing buffer, etc.)
  const { start, end } = effectiveRange(roleId, shift);
  return !entry.ranges.some(r => r.start < end && start < r.end);
}

// ── fillShift ────────────────────────────────────────────────────────────────

/**
 * Fill a single shift — apply pre-reserved people, then fill each required
 * role from the remaining eligible pool. Mutates `usedRanges`, `weekHours`,
 * `cards`, and `issues` in place.
 *
 * @param isObs    True when this is an OBS shift (triggers full-day blocking).
 * @param scoreFn  Optional (personName, day, locationId, roleId) → number.
 *                 When multiple candidates are eligible, the one with the
 *                 highest score is preferred (soft historical tiebreaker).
 */
function fillShift(shift, reservations, usedRanges, weekHours, cards, issues, idx, cfg, day, isObs, scoreFn) {
  const loc = idx.locations[shift.locationId];
  const req = staffingFor(shift.locationId, cfg);

  const assigned = [];

  // Apply pre-reserved (MUST_PAIR) people — hours credited here.
  // These people were already marked in usedRanges during the pre-pass.
  for (const res of (reservations[shift.id] ?? [])) {
    assigned.push(res);
    weekHours[res.personId] = (weekHours[res.personId] || 0) + roleHours(res.roleId, shift);
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
      const rHrs = roleHours(roleId, shift);
      // Gather all eligible candidates, then pick the one with the highest
      // historical score (soft tiebreaker). Without scoreFn, first eligible wins.
      const eligible = cfg.people.filter(
        (person) =>
          isAvailableForShift(person.id, roleId, shift, isObs, usedRanges) &&
          !exceedsHourCap(person.id, rHrs, weekHours, cfg) &&
          canStaff(person, shift.locationId, roleId, day, cfg)
      );
      let candidate;
      if (eligible.length === 0) {
        candidate = undefined;
      } else if (eligible.length === 1 || !scoreFn) {
        candidate = eligible[0];
      } else {
        let bestScore = -1;
        candidate = eligible[0];
        for (const p of eligible) {
          const s = scoreFn(p.name, day, shift.locationId, roleId);
          if (s > bestScore) { bestScore = s; candidate = p; }
        }
      }
      if (candidate) {
        assigned.push({ personId: candidate.id, roleId });
        markPlaced(candidate.id, roleId, shift, isObs, usedRanges, candidate.blockedIds);
        weekHours[candidate.id] = (weekHours[candidate.id] || 0) + rHrs;
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

// ── Main entry ────────────────────────────────────────────────────────────────
// Returns { [day]: { shifts:[...], unplaced:[...], issues:[...] } }
// week: 'A', 'B', or null (null = include all shifts regardless of week tag)
// scoreFn: optional (personName, day, locationId, roleId) → number — historical tiebreaker
export function solve(cfg, week = null, scoreFn = null) {
  const idx = indexConfig(cfg);
  const result = {};
  const weekHours = {}; // cumulative hours per person across all days

  for (const day of activeDays(cfg, week)) {
    // usedRanges tracks each person's time commitments today:
    //   { obsBlock: bool, ranges: [{start, end}] }
    // obsBlock = true  → full-day OBS exclusion
    // ranges            → effective time windows from regular placements
    const usedRanges = new Map();

    const dayShifts = cfg.shifts.filter(
      (s) =>
        (s.days || []).includes(day) &&
        (s.week == null || week == null || s.week === week)
    );

    // ── Phase classification ─────────────────────────────────────────────────
    // Phase 1 (OBS)       : priority >= 10 — full-day block after placement
    // Phase 1.5 (split-day): 0 < priority < 10 — time-range tracked, AM before PM
    // Phase 2 (regular)   : priority === 0
    const isObsShift   = (s) => (s.priority ?? 0) >= 10;
    const isSplitShift = (s) => (s.priority ?? 0) > 0 && (s.priority ?? 0) < 10;
    const isRegShift   = (s) => (s.priority ?? 0) === 0;

    const phase1Shifts = dayShifts.filter(isObsShift)
      .sort((a, b) => totalMin(b.locationId, cfg) - totalMin(a.locationId, cfg));

    const phase15Shifts = dayShifts.filter(isSplitShift)
      .sort((a, b) => {
        // More constrained first; within same location pressure, earlier start first.
        const md = totalMin(b.locationId, cfg) - totalMin(a.locationId, cfg);
        return md !== 0 ? md : (a.start ?? 0) - (b.start ?? 0);
      });

    const phase2Shifts = dayShifts.filter(isRegShift)
      .sort((a, b) => totalMin(b.locationId, cfg) - totalMin(a.locationId, cfg));

    const phase1ShiftIds  = new Set(phase1Shifts.map((s) => s.id));
    const phase15ShiftIds = new Set(phase15Shifts.map((s) => s.id));
    const phase2ShiftIds  = new Set(phase2Shifts.map((s) => s.id));

    const allPairings = cfg.constraints.filter(
      (c) => c.enabled && c.type === CT.MUST_PAIR
    );

    const cards = [];
    const issues = [];
    const reservations = {}; // shiftId → [{personId, roleId}]

    // ── Helper: run a MUST_PAIR pre-pass for a set of shift IDs ─────────────
    // For each matching pairing: check availability (time-overlap aware), validate
    // role is required by target shift, reserve the person, mark usedRanges.
    const mustPairPrePass = (shiftIdSet, isObsPhase) => {
      for (const p of allPairings) {
        if (!shiftIdSet.has(p.anchorId)) continue;
        const person = idx.people[p.personId];
        if (!person || isUnavailable(person.id, day, cfg)) continue;

        const anchorShift = idx.shifts[p.anchorId];
        if (!anchorShift) continue;

        const roleId = p.slot ?? person.roles[0];
        if (!isAvailableForShift(person.id, roleId, anchorShift, isObsPhase, usedRanges)) continue;

        // Guard: role must actually be required by the target shift.
        const anchorReq = staffingFor(anchorShift.locationId, cfg);
        if (!anchorReq[roleId]) {
          console.warn(
            `[Shiftcraft MUST_PAIR] Skipping ${person.name} → ${anchorShift.name || '(empty)'}` +
            ` role "${roleId}" — not required (required: ${Object.keys(anchorReq).join(', ')})`
          );
          continue;
        }

        if (!reservations[p.anchorId]) reservations[p.anchorId] = [];
        reservations[p.anchorId].push({ personId: person.id, roleId });
        markPlaced(person.id, roleId, anchorShift, isObsPhase, usedRanges, person.blockedIds);
      }
    };

    // ── Phase 1: OBS ─────────────────────────────────────────────────────────
    if (phase1Shifts.length > 0) {
      console.log(`[Shiftcraft fill] ${day} ── Phase 1: OBS (${phase1Shifts.map(s => s.name || 'OBS').join(', ')})`);
    }
    mustPairPrePass(phase1ShiftIds, /* isObs */ true);
    for (const shift of phase1Shifts) {
      fillShift(shift, reservations, usedRanges, weekHours, cards, issues, idx, cfg, day, /* isObs */ true, scoreFn);
    }

    // ── Phase 1.5: Dr. R split-day (AM → PM, same team carries across) ───────
    if (phase15Shifts.length > 0) {
      console.log(`[Shiftcraft fill] ${day} ── Phase 1.5: split-day (${phase15Shifts.map(s => s.name).join(', ')})`);
    }
    mustPairPrePass(phase15ShiftIds, /* isObs */ false);
    for (const shift of phase15Shifts) {
      fillShift(shift, reservations, usedRanges, weekHours, cards, issues, idx, cfg, day, /* isObs */ false, scoreFn);
    }

    // ── Phase 2: Regular shifts ───────────────────────────────────────────────
    if (phase2Shifts.length > 0) {
      console.log(`[Shiftcraft fill] ${day} ── Phase 2: regular (${phase2Shifts.map(s => s.name).join(', ')})`);
    }
    mustPairPrePass(phase2ShiftIds, /* isObs */ false);
    for (const shift of phase2Shifts) {
      fillShift(shift, reservations, usedRanges, weekHours, cards, issues, idx, cfg, day, /* isObs */ false, scoreFn);
    }

    // Unplaced: people with no time commitments at all today
    const unplaced = cfg.people
      .filter((p) => {
        if (isUnavailable(p.id, day, cfg)) return false;
        const u = usedRanges.get(p.id);
        return !u || (!u.obsBlock && u.ranges.length === 0);
      })
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
