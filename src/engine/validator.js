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
 * Detects double-bookings in a proposed assignment list and auto-repairs them.
 * OBS takes precedence: when a physical person has both an OBS and a non-OBS
 * assignment on the same day, all non-OBS assignments are dropped.
 * When there is no OBS involvement, all but the first same-day assignment are dropped.
 *
 * @param assignments  [{clinicId, slot, personId}]
 * @param clinics      all clinic objects (needs .id, .day, .location)
 * @param people       all person objects (needs .id, .name)
 * @returns { safe: Assignment[], dropped: DroppedEntry[] }
 */
export function validateAndRepairAssignments(assignments, clinics, people) {
  const clinicById = new Map(clinics.map(c => [c.id, c]));

  // Group by: canonical person key (name) → day → entries
  const groups = {}; // { [personKey]: { [day]: [{ a, isObs, location }] } }
  for (const a of assignments) {
    const clinic = clinicById.get(a.clinicId);
    if (!clinic) continue;
    const key = personKey(a.personId, people);
    const isObs = clinic.location?.toLowerCase() === 'obs';
    if (!groups[key]) groups[key] = {};
    if (!groups[key][clinic.day]) groups[key][clinic.day] = [];
    groups[key][clinic.day].push({ a, isObs, location: clinic.location, day: clinic.day });
  }

  const dropKeys = new Set(); // 'clinicId:slot'
  const dropped = [];         // for changelog

  for (const dayMap of Object.values(groups)) {
    for (const entries of Object.values(dayMap)) {
      if (entries.length <= 1) continue; // no conflict
      const obsEntries    = entries.filter(e => e.isObs);
      const nonObsEntries = entries.filter(e => !e.isObs);
      if (obsEntries.length > 0) {
        // OBS wins — drop every non-OBS assignment for this person+day
        for (const e of nonObsEntries) {
          dropKeys.add(`${e.a.clinicId}:${e.a.slot}`);
          dropped.push({ personId: e.a.personId, clinicId: e.a.clinicId, slot: e.a.slot, day: e.day, location: e.location });
        }
      } else {
        // All non-OBS: keep first, drop the rest
        for (const e of nonObsEntries.slice(1)) {
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

// ─── Self-contained tests ───────────────────────────────────────────────────
// Reproduce the exact Hailey scenario: two same-name records with NO
// linkedPersonId set, one in OBS and one in FD on the same day.
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

  // ── Test 1: Exact Hailey scenario ─────────────────────────────────────────
  // Two same-name records with NO linkedPersonId. Tech in OBS, admin in FD.
  // Expected: FD dropped (OBS wins). This is the bug that shipped twice.
  {
    console.group('Test 1: unlinked same-name pair, OBS + FD same day');
    const people = [
      { id: 'admin-1', name: 'Hailey', staffType: 'admin', linkedPersonId: null },
      { id: 'tech-1',  name: 'Hailey', staffType: null,    linkedPersonId: null },
    ];
    const clinics = [
      { id: 'wed-obs',      day: 'Wed', location: 'OBS',      open: true },
      { id: 'wed-chandler', day: 'Wed', location: 'Chandler', open: true },
    ];
    const assignments = [
      { clinicId: 'wed-obs',      slot: 'scrub',     personId: 'tech-1' },
      { clinicId: 'wed-chandler', slot: 'frontDesk', personId: 'admin-1' },
    ];

    // Demonstrate what OLD ID-based logic produced (the bug):
    const oldCanonical = { 'admin-1': 'admin-1', 'tech-1': 'tech-1' }; // each maps to self
    const oldKey = (id) => oldCanonical[id] ?? id;
    const oldGroups = {};
    for (const a of assignments) {
      const clinic = clinics.find(c => c.id === a.clinicId);
      const key = oldKey(a.personId);
      const isObs = clinic.location?.toLowerCase() === 'obs';
      if (!oldGroups[key]) oldGroups[key] = {};
      if (!oldGroups[key][clinic.day]) oldGroups[key][clinic.day] = [];
      oldGroups[key][clinic.day].push({ a, isObs });
    }
    const oldConflicts = Object.values(oldGroups).flatMap(d => Object.values(d).filter(e => e.length > 1));
    assert(oldConflicts.length === 0, 'OLD CODE: no conflicts detected (expected — this is the bug)');

    // Run NEW validation:
    const { safe, dropped } = validateAndRepairAssignments(assignments, clinics, people);
    assert(safe.length === 1,             'NEW CODE: exactly 1 safe assignment');
    assert(safe[0]?.personId === 'tech-1', 'NEW CODE: safe assignment is OBS (tech-Hailey)');
    assert(dropped.length === 1,           'NEW CODE: exactly 1 dropped assignment');
    assert(dropped[0]?.personId === 'admin-1', 'NEW CODE: dropped is FD (admin-Hailey)');
    console.groupEnd();
  }

  // ── Test 2: Linked pair (linkedPersonId set on one side) ──────────────────
  // Admin has linkedPersonId pointing to tech. Same expected result.
  {
    console.group('Test 2: one-directional link, OBS + FD same day');
    const people = [
      { id: 'admin-1', name: 'Hailey', staffType: 'admin', linkedPersonId: 'tech-1' },
      { id: 'tech-1',  name: 'Hailey', staffType: null,    linkedPersonId: null },
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
    assert(safe[0]?.personId === 'tech-1', 'safe is OBS tech-Hailey');
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
