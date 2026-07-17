/**
 * Post-generation schedule validation.
 *
 * Canonical person identity is NAME-BASED (trim + lowercase), not ID-based.
 * Two records with the same display name represent the same physical person
 * regardless of whether linkedPersonId is set on either record. This is the
 * correct identity for conflict detection: the system intentionally allows
 * same names across tech/admin staff types for the linked-person feature,
 * so "same name = same physical person" is a hard invariant.
 */

/** Returns the canonical person key (normalized name) for a given person ID. */
export function personKey(personId, people) {
  const p = (people ?? []).find(q => q.id === personId);
  return p ? p.name.trim().toLowerCase() : personId;
}

/**
 * Effective time range for a given slot at a clinic, matching the solver's
 * effectiveRange() helper and seed.js's calcSlotHours() defaults.
 * Custom slot start/end overrides are respected when present.
 */
function slotEffectiveRange(slot, clinic) {
  const sv  = clinic.slots?.[slot];
  const cs  = (sv && typeof sv === 'object') ? (sv.start ?? null) : null;
  const ce  = (sv && typeof sv === 'object') ? (sv.end   ?? null) : null;
  const s   = cs ?? (clinic.startTime ?? 0);
  const e   = ce ?? (clinic.endTime   ?? 0);
  switch (slot) {
    case 'scribe':
    case 'closing':
    case 'closingFrontDesk':
      return { start: s, end: ce ?? (e + 75) };
    case 'opener':
    case 'openingFrontDesk':
      return { start: cs ?? (s - 15), end: e };
    default:
      return { start: s, end: e };
  }
}

/**
 * Detects double-bookings in a proposed assignment list and auto-repairs them.
 *
 * Rules (in priority order):
 *  1. OBS overrides everything: any physical person with an OBS assignment on a
 *     given day has all non-OBS assignments for that day dropped — regardless of time.
 *  2. Two non-OBS assignments whose effective time ranges overlap are a conflict:
 *     keep the first, drop the rest.
 *  3. Two non-OBS assignments whose effective time ranges do NOT overlap are LEGAL
 *     (e.g., Dr. R split-day AM + PM). Both are kept.
 *
 * Canonical person identity is name-based: two records with the same display name
 * represent the same physical person.
 *
 * @param assignments  [{clinicId, slot, personId}]
 * @param clinics      all clinic objects (needs .id, .day, .location, .startTime, .endTime, .slots)
 * @param people       all person objects (needs .id, .name)
 * @returns { safe: Assignment[], dropped: DroppedEntry[] }
 */
export function validateAndRepairAssignments(assignments, clinics, people) {
  const clinicById = new Map(clinics.map(c => [c.id, c]));

  // Group by: canonical person key (name) → day → entries (with effective time ranges)
  const groups = {};
  for (const a of assignments) {
    const clinic = clinicById.get(a.clinicId);
    if (!clinic) continue;
    const key   = personKey(a.personId, people);
    const isObs = clinic.location?.toLowerCase() === 'obs';
    const range = isObs ? null : slotEffectiveRange(a.slot, clinic);
    if (!groups[key]) groups[key] = {};
    if (!groups[key][clinic.day]) groups[key][clinic.day] = [];
    groups[key][clinic.day].push({
      a, isObs, location: clinic.location, day: clinic.day,
      start: range?.start ?? 0,
      end:   range?.end   ?? 0,
    });
  }

  const dropKeys = new Set(); // 'clinicId:slot'
  const dropped  = [];

  for (const dayMap of Object.values(groups)) {
    for (const entries of Object.values(dayMap)) {
      if (entries.length <= 1) continue;

      const obsEntries    = entries.filter(e => e.isObs);
      const nonObsEntries = entries.filter(e => !e.isObs);

      if (obsEntries.length > 0) {
        // Rule 1: OBS wins — drop all non-OBS assignments regardless of time.
        for (const e of nonObsEntries) {
          dropKeys.add(`${e.a.clinicId}:${e.a.slot}`);
          dropped.push({ personId: e.a.personId, clinicId: e.a.clinicId, slot: e.a.slot, day: e.day, location: e.location });
        }
      } else {
        // Rules 2 & 3: check pairwise time overlaps among non-OBS assignments.
        // Two assignments that do NOT overlap in time are both legal (split-day).
        // Two assignments that DO overlap in time: keep the earlier-appearing one.
        const toDrop = new Set();
        for (let i = 0; i < nonObsEntries.length; i++) {
          if (toDrop.has(i)) continue;
          for (let j = i + 1; j < nonObsEntries.length; j++) {
            if (toDrop.has(j)) continue;
            const ei = nonObsEntries[i];
            const ej = nonObsEntries[j];
            const overlaps = ei.start < ej.end && ej.start < ei.end;
            if (overlaps) toDrop.add(j); // keep i, drop j
          }
        }
        for (const j of toDrop) {
          const e = nonObsEntries[j];
          dropKeys.add(`${e.a.clinicId}:${e.a.slot}`);
          dropped.push({ personId: e.a.personId, clinicId: e.a.clinicId, slot: e.a.slot, day: e.day, location: e.location });
        }
      }
    }
  }

  return {
    safe:    assignments.filter(a => !dropKeys.has(`${a.clinicId}:${a.slot}`)),
    dropped,
  };
}

// Role display name → OBS slot key (matches ROLE_TO_SLOT_KEY in adapter.js)
const OBS_ROLE_FOR_SLOT = {
  preop:       'Pre-Op/PACU',
  sterile:     'Sterile Processing',
  circulator:  'Circulator',
  scrub:       'Scrub Tech',
};

/**
 * Post-generation OBS integrity check.
 *
 * On any day with an OBS clinic, every OBS slot that is EMPTY in `assignments`
 * is a potential violation. It becomes a confirmed violation when at least one
 * person who is (a) qualified for that OBS slot and (b) not on a day-off was
 * placed into a regular (non-OBS) clinic instead. That means the solver filled
 * a regular slot before OBS had a chance — which must never happen.
 *
 * Returns an array of human-readable violation strings. An empty array is clean.
 */
export function findObsViolations(assignments, clinics, people) {
  const violations = [];
  const clinicById = new Map(clinics.map(c => [c.id, c]));

  // Collect OBS clinics per day
  const obsByDay = {}; // day → clinic
  for (const c of clinics) {
    if (c.open && c.location?.toLowerCase() === 'obs') {
      obsByDay[c.day] = obsByDay[c.day] ?? c; // first OBS per day
    }
  }
  if (Object.keys(obsByDay).length === 0) return [];

  // Index assignments: day → { obs: [{slot, personId}], regular: [{slot, personId}] }
  const byDay = {};
  for (const a of assignments) {
    const clinic = clinicById.get(a.clinicId);
    if (!clinic) continue;
    const day = clinic.day;
    if (!byDay[day]) byDay[day] = { obs: [], regular: [] };
    if (clinic.location?.toLowerCase() === 'obs') {
      byDay[day].obs.push(a);
    } else {
      byDay[day].regular.push(a);
    }
  }

  for (const [day, obsClinic] of Object.entries(obsByDay)) {
    const filledObsSlots = new Set((byDay[day]?.obs ?? []).map(a => a.slot));
    const regularAssignedIds = new Set((byDay[day]?.regular ?? []).map(a => a.personId));

    // Check every OBS slot that should be filled
    for (const slotKey of Object.keys(obsClinic.slots ?? {})) {
      if (filledObsSlots.has(slotKey)) continue; // filled — OK

      const requiredRole = OBS_ROLE_FOR_SLOT[slotKey];
      if (!requiredRole) continue; // unknown slot, skip

      // Who is qualified for this OBS slot?
      const displaced = people.filter(p => {
        if ((p.daysOff ?? []).includes(day)) return false;
        if (!(p.roles ?? []).includes(requiredRole)) return false;
        const cleared = p.clearedLocations ?? [];
        if (cleared.length > 0 && !cleared.some(l => l.toLowerCase() === 'obs')) return false;
        // Was this person (or a same-name record) assigned to a regular clinic today?
        const nameKey = p.name.trim().toLowerCase();
        return people
          .filter(q => q.name.trim().toLowerCase() === nameKey)
          .some(q => regularAssignedIds.has(q.id));
      });

      if (displaced.length > 0) {
        const names = [...new Set(displaced.map(p => p.name))].join(', ');
        violations.push(
          `${day} OBS ${slotKey} empty — ${names} qualified but placed at a regular clinic`
        );
      }
    }
  }

  return violations;
}

// OBS slot keys — must match OBS_SLOT_TYPES in seed.js
const OBS_SLOT_KEYS = new Set(['preop', 'sterile', 'circulator', 'scrub']);

/**
 * Post-generation slot-type integrity check.
 *
 * Returns an array of violation strings for any assignment whose slot type is
 * invalid for its clinic type (OBS slot in regular clinic or vice versa).
 * An empty array is clean.
 */
export function findInvalidSlotAssignments(assignments, clinics) {
  const violations = [];
  const clinicById = new Map(clinics.map(c => [c.id, c]));
  for (const a of assignments) {
    const clinic = clinicById.get(a.clinicId);
    if (!clinic) continue;
    const isObsClinic = clinic.location?.toLowerCase() === 'obs';
    const isObsSlot   = OBS_SLOT_KEYS.has(a.slot);
    if (isObsClinic && !isObsSlot) {
      violations.push(`${clinic.day} OBS clinic has non-OBS slot "${a.slot}" assigned (person ${a.personId})`);
    } else if (!isObsClinic && isObsSlot) {
      violations.push(`${clinic.day} ${clinic.location} clinic has OBS slot "${a.slot}" assigned (person ${a.personId})`);
    }
  }
  return violations;
}

// ─── Self-contained tests ───────────────────────────────────────────────────
// Two same-name records with NO linkedPersonId, one in OBS and one in FD on
// the same day. Universal rules: same name = same person, OBS wins.
// Call runValidationTests() and check console for PASS / FAIL lines.

export function runValidationTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition, label) {
    if (condition) {
      console.log(`  ✓ ${label}`);
      passed++;
    } else {
      console.error(`  ✗ ${label}`);
      failed++;
    }
  }

  console.group('[Shiftcraft] Validator self-test');

  // ── Test 1: unlinked same-name pair — OBS wins ────────────────────────────
  // Two same-name records with NO linkedPersonId. Tech in OBS, admin in FD.
  // Expected: FD dropped, OBS kept.
  {
    console.group('Test 1: unlinked same-name pair, OBS + FD same day');
    const people = [
      { id: 'admin-1', name: 'Sam', staffType: 'admin', linkedPersonId: null },
      { id: 'tech-1',  name: 'Sam', staffType: null,    linkedPersonId: null },
    ];
    const clinics = [
      { id: 'wed-obs',      day: 'Wed', location: 'OBS',      open: true },
      { id: 'wed-chandler', day: 'Wed', location: 'Chandler', open: true },
    ];
    const assignments = [
      { clinicId: 'wed-obs',      slot: 'scrub',     personId: 'tech-1' },
      { clinicId: 'wed-chandler', slot: 'frontDesk', personId: 'admin-1' },
    ];

    const { safe, dropped } = validateAndRepairAssignments(assignments, clinics, people);
    assert(safe.length === 1,              'exactly 1 safe assignment');
    assert(safe[0]?.personId === 'tech-1', 'safe assignment is OBS record');
    assert(dropped.length === 1,           'exactly 1 dropped assignment');
    assert(dropped[0]?.personId === 'admin-1', 'dropped is FD record');
    console.groupEnd();
  }

  // ── Test 2: one-directional link — same result ────────────────────────────
  {
    console.group('Test 2: one-directional link, OBS + FD same day');
    const people = [
      { id: 'admin-1', name: 'Sam', staffType: 'admin', linkedPersonId: 'tech-1' },
      { id: 'tech-1',  name: 'Sam', staffType: null,    linkedPersonId: null },
    ];
    const clinics = [
      { id: 'wed-obs',      day: 'Wed', location: 'OBS',      open: true },
      { id: 'wed-chandler', day: 'Wed', location: 'Chandler', open: true },
    ];
    const assignments = [
      { clinicId: 'wed-obs',      slot: 'scrub',     personId: 'tech-1' },
      { clinicId: 'wed-chandler', slot: 'frontDesk', personId: 'admin-1' },
    ];
    const { safe, dropped } = validateAndRepairAssignments(assignments, clinics, people);
    assert(safe.length === 1,              'exactly 1 safe assignment');
    assert(safe[0]?.personId === 'tech-1', 'safe is OBS record');
    assert(dropped.length === 1,           'exactly 1 dropped');
    console.groupEnd();
  }

  // ── Test 3: Same person (single record) in two clinics same day ───────────
  {
    console.group('Test 3: single record double-booked across two regular clinics');
    const people = [{ id: 'solo-1', name: 'Solo', staffType: null, linkedPersonId: null }];
    const clinics = [
      { id: 'wed-chandler', day: 'Wed', location: 'Chandler', open: true },
      { id: 'wed-phoenix',  day: 'Wed', location: 'Phoenix',  open: true },
    ];
    const assignments = [
      { clinicId: 'wed-chandler', slot: 'scribe', personId: 'solo-1' },
      { clinicId: 'wed-phoenix',  slot: 'opener', personId: 'solo-1' },
    ];
    const { safe, dropped } = validateAndRepairAssignments(assignments, clinics, people);
    assert(safe.length === 1,    'keeps first, drops second');
    assert(dropped.length === 1, '1 dropped');
    console.groupEnd();
  }

  // ── Test 4: No conflicts — verify valid schedules are not modified ─────────
  {
    console.group('Test 4: no conflicts (different people, different days)');
    const people = [
      { id: 'p1', name: 'Alice', staffType: null,    linkedPersonId: null },
      { id: 'p2', name: 'Bob',   staffType: 'admin', linkedPersonId: null },
    ];
    const clinics = [
      { id: 'mon-chandler', day: 'Mon', location: 'Chandler', open: true },
      { id: 'tue-obs',      day: 'Tue', location: 'OBS',      open: true },
    ];
    const assignments = [
      { clinicId: 'mon-chandler', slot: 'scribe',    personId: 'p1' },
      { clinicId: 'tue-obs',      slot: 'circulator', personId: 'p2' },
    ];
    const { safe, dropped } = validateAndRepairAssignments(assignments, clinics, people);
    assert(safe.length === 2,    'both assignments safe');
    assert(dropped.length === 0, 'nothing dropped');
    console.groupEnd();
  }

  const result = failed === 0
    ? `All ${passed} assertions passed`
    : `${failed} FAILED, ${passed} passed`;
  console.log(`\n${result}`);
  console.groupEnd();
  return { passed, failed };
}
