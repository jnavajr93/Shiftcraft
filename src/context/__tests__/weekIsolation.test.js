/**
 * Week isolation regression tests.
 *
 * These tests verify the mathematical invariants that AppContext's week
 * navigation relies on. Each week's state is fully determined by:
 *   applySlotMap(baseClinics, baseTaskDefs, slotMap)
 * where baseClinics is reset from originalClinicDefsRef before each apply.
 *
 * Regressions targeted:
 *   - Clinic config (open/times/patientCount) bleeding between weeks
 *   - Task instance lists bleeding between weeks
 *   - Slot assignments from week B appearing when A's map is re-applied
 *   - Three-week independence: A, B, C all distinct
 */

import { describe, it, expect } from 'vitest';
import {
  extractSlotMap,
  applySlotMap,
  blankSlotMap,
  blankStandardSlots,
  toDefinitionData,
  sortedJSON,
  stripClinicConfig,
} from '../slotMap.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeClinic(overrides = {}) {
  return {
    id: 'c1', provider: 'Dr. A', location: 'Phoenix', day: 'Mon',
    open: true, startTime: 480, endTime: 1020, patientCount: 30,
    slots: blankStandardSlots(),
    ...overrides,
  };
}

function makeTask(overrides = {}) {
  return {
    id: 't1', label: 'Triage', day: 'Mon',
    assignedPersonId: null, start: null, end: null,
    ...overrides,
  };
}

// Global baseline (what originalClinicDefsRef holds)
const GLOBAL_BASELINE = { id: 'c1', open: true, startTime: 480, endTime: 1020, patientCount: 30 };
const globalClinic = makeClinic(GLOBAL_BASELINE);

// Simulate what navigateWeek does: reset clinics from originalClinicDefsRef,
// then applySlotMap with the new week's slot map.
function simulateNavigate(currentGlobal, originalDefs, map, taskDefs = []) {
  const defsById = new Map(originalDefs.map(d => [d.id, d]));
  const baseClinics = currentGlobal.clinics.map(c => {
    const def = defsById.get(c.id);
    return def ? { ...c, open: def.open, startTime: def.startTime, endTime: def.endTime, patientCount: def.patientCount } : c;
  });
  return applySlotMap(baseClinics, taskDefs, map);
}

// ─── Slot assignment isolation ─────────────────────────────────────────────────

describe('Week isolation — slot assignments', () => {
  it('applying week B map then week A map returns the original week A state (byte-for-byte)', () => {
    // Week A: opener assigned, scribe empty
    const weekAClinic = makeClinic({ slots: { ...blankStandardSlots(), opener: 'person-1' } });
    const mapA = extractSlotMap([weekAClinic], []);

    // Week B: different assignment — scribe = person-2, opener empty
    const weekBClinic = makeClinic({ slots: { ...blankStandardSlots(), scribe: { personId: 'person-2', start: null, end: null } } });
    const mapB = extractSlotMap([weekBClinic], []);

    // Simulate: start on week A, then navigate to B, then navigate back to A
    let g = { clinics: [weekAClinic], additionalTasks: [] };
    const originalDefs = [GLOBAL_BASELINE];

    // Navigate to B
    const appliedB = simulateNavigate(g, originalDefs, mapB);
    g = { ...g, ...appliedB };
    expect(g.clinics[0].slots.opener).toBeNull();         // B has no opener
    expect(g.clinics[0].slots.scribe.personId).toBe('person-2');

    // Navigate back to A
    const appliedA = simulateNavigate(g, originalDefs, mapA);
    g = { ...g, ...appliedA };
    expect(g.clinics[0].slots.opener).toBe('person-1');   // A's opener is back
    expect(g.clinics[0].slots.scribe.personId).toBeNull(); // A's scribe was empty
  });

  it('week B task assignment does not appear when navigating back to week A (A had no tasks)', () => {
    const mapA = blankSlotMap([globalClinic]); // week A: no tasks
    const taskB = makeTask({ id: 'tb', label: 'Triage', assignedPersonId: 'person-3' });
    const mapB = extractSlotMap([globalClinic], [taskB]);

    let g = { clinics: [globalClinic], additionalTasks: [] };

    // Navigate to B
    const appliedB = applySlotMap(g.clinics, [], mapB);
    g = { ...g, ...appliedB };
    expect(g.additionalTasks).toHaveLength(1);
    expect(g.additionalTasks[0].assignedPersonId).toBe('person-3');

    // Navigate back to A (pass empty baseline taskDefs — week A had no tasks)
    const appliedA = applySlotMap(g.clinics, [], mapA);
    g = { ...g, ...appliedA };
    expect(g.additionalTasks).toHaveLength(0); // week A had __tasks: []
  });

  it('three-week slot independence: A, B, C each hold distinct assignments', () => {
    const mapA = extractSlotMap([makeClinic({ slots: { ...blankStandardSlots(), opener: 'p1' } })], []);
    const mapB = extractSlotMap([makeClinic({ slots: { ...blankStandardSlots(), scribe: { personId: 'p2', start: null, end: null } } })], []);
    const mapC = blankSlotMap([globalClinic]);

    const { clinics: cA } = applySlotMap([globalClinic], [], mapA);
    const { clinics: cB } = applySlotMap([globalClinic], [], mapB);
    const { clinics: cC } = applySlotMap([globalClinic], [], mapC);

    expect(cA[0].slots.opener).toBe('p1');                         // A has opener
    expect(cA[0].slots.scribe.personId).toBeNull();                // A has no scribe

    expect(cB[0].slots.scribe.personId).toBe('p2');               // B has scribe
    expect(cB[0].slots.opener).toBeNull();                         // B has no opener

    expect(cC[0].slots.opener).toBeNull();                         // C is blank
    expect(cC[0].slots.scribe.personId).toBeNull();
  });
});

// ─── Clinic config isolation ──────────────────────────────────────────────────

describe('Week isolation — clinic config (open/times/patientCount)', () => {
  it('clinic config from week B does not contaminate week A after A→B→A navigation', () => {
    // Week A: default config (open, 8AM-5PM, 30 patients)
    const mapA = extractSlotMap([globalClinic], []);

    // Week B: closed, 7AM start, 55 patients
    const weekBClinic = makeClinic({ open: false, startTime: 420, patientCount: 55 });
    const mapB = extractSlotMap([weekBClinic], []);

    let g = { clinics: [globalClinic], additionalTasks: [] };
    const originalDefs = [GLOBAL_BASELINE];

    // Navigate to B
    const appliedB = simulateNavigate(g, originalDefs, mapB);
    g = { ...g, ...appliedB };
    expect(g.clinics[0].open).toBe(false);
    expect(g.clinics[0].startTime).toBe(420);
    expect(g.clinics[0].patientCount).toBe(55);

    // Navigate back to A — baseline must be restored first, then A's config applied
    const appliedA = simulateNavigate(g, originalDefs, mapA);
    g = { ...g, ...appliedA };
    expect(g.clinics[0].open).toBe(true);          // baseline: open
    expect(g.clinics[0].startTime).toBe(480);      // baseline: 8 AM
    expect(g.clinics[0].patientCount).toBe(30);    // baseline: 30
  });

  it('editing week B clinic config does NOT corrupt toDefinitionData global record with B values', () => {
    const weekBClinic = makeClinic({ open: false, startTime: 420, patientCount: 55 });
    const { clinics: bClinics } = applySlotMap([globalClinic], [], extractSlotMap([weekBClinic], []));

    const globalData = { clinics: bClinics, additionalTasks: [], people: [], taskTypes: [], locations: [], providers: [] };
    const def = toDefinitionData(globalData, [GLOBAL_BASELINE]);

    // Global record must store BASELINE values regardless of week B's config
    expect(def.clinics[0].open).toBe(true);
    expect(def.clinics[0].startTime).toBe(480);
    expect(def.clinics[0].patientCount).toBe(30);
  });

  it('three-week clinic config independence: each week preserves its own open/times/patientCount', () => {
    const mapA = extractSlotMap([makeClinic({ open: false, patientCount: 40 })], []);
    const mapB = extractSlotMap([makeClinic({ startTime: 420, endTime: 900, patientCount: 55 })], []);
    const mapC = blankSlotMap([globalClinic]); // no __clinicConfig — falls back to baseline

    const originalDefs = [GLOBAL_BASELINE];

    // Each apply starts from baseline (as navigateWeek does)
    const { clinics: cA } = applySlotMap([globalClinic], [], mapA);
    const resetForB = [{ ...globalClinic, ...GLOBAL_BASELINE }];
    const { clinics: cB } = applySlotMap(resetForB, [], mapB);
    const resetForC = [{ ...globalClinic, ...GLOBAL_BASELINE }];
    const { clinics: cC } = applySlotMap(resetForC, [], mapC);

    expect(cA[0].open).toBe(false);
    expect(cA[0].patientCount).toBe(40);

    expect(cB[0].startTime).toBe(420);
    expect(cB[0].patientCount).toBe(55);

    expect(cC[0].open).toBe(true);             // falls back to baseline
    expect(cC[0].startTime).toBe(480);
    expect(cC[0].patientCount).toBe(30);
  });
});

// ─── Task instance isolation ──────────────────────────────────────────────────

describe('Week isolation — task instances', () => {
  it('task instance added in week B is absent when week C map is applied', () => {
    const taskB = makeTask({ id: 'tb', label: 'Inventory' });
    const mapB  = extractSlotMap([globalClinic], [taskB]);
    const mapC  = blankSlotMap([globalClinic]);

    // Apply C's map — should not contain B's task
    const { additionalTasks: tasksC } = applySlotMap([globalClinic], [], mapC);
    expect(tasksC).toHaveLength(0);
  });

  it('task assignment in week B does not create a slot entry in week A slot map', () => {
    const taskA = makeTask({ id: 'ta', label: 'Triage', assignedPersonId: null });
    const mapA  = extractSlotMap([globalClinic], [taskA]);

    const taskB = makeTask({ id: 'ta', label: 'Triage', assignedPersonId: 'person-5' });
    const mapB  = extractSlotMap([globalClinic], [taskB]);

    // Week A map must have null assignment for ta, regardless of week B
    expect(mapA['task:ta']).toBeNull();
    expect(mapB['task:ta']).toBe('person-5');
    // The maps are independent — applying A gives null, B gives person-5
    const { additionalTasks: tA } = applySlotMap([globalClinic], [taskA], mapA);
    const { additionalTasks: tB } = applySlotMap([globalClinic], [taskB], mapB);
    expect(tA[0].assignedPersonId).toBeNull();
    expect(tB[0].assignedPersonId).toBe('person-5');
  });

  it('slot map round-trip: extractSlotMap then applySlotMap is identity (all slot types)', () => {
    const clinic = makeClinic({
      slots: {
        ...blankStandardSlots(),
        opener: 'p1',
        closing: 'p2',
        scribe: { personId: 'p3', start: 480, end: 600 },
        middle: { personId: 'p4', start: 600, end: 900 },
        frontDesk: 'p5',
      },
    });
    const tasks = [makeTask({ assignedPersonId: 'p6' })];
    const map = extractSlotMap([clinic], tasks);
    const { clinics, additionalTasks } = applySlotMap([clinic], tasks, map);

    expect(clinics[0].slots.opener).toBe('p1');
    expect(clinics[0].slots.closing).toBe('p2');
    expect(clinics[0].slots.scribe.personId).toBe('p3');
    expect(clinics[0].slots.middle.personId).toBe('p4');
    expect(clinics[0].slots.frontDesk).toBe('p5');
    expect(additionalTasks[0].assignedPersonId).toBe('p6');
  });
});

// ─── Dirty-flag isolation ─────────────────────────────────────────────────────

describe('Week isolation — dirty flag (stripClinicConfig)', () => {
  it('clinic config change alone does NOT make the slot map appear different from snapshot', () => {
    // Snapshot taken at: no assignments, default config
    const snapshotMap = extractSlotMap([globalClinic], []);

    // Week A now has a different clinic config (open: false) but same assignments
    const editedClinic = makeClinic({ open: false, patientCount: 55 });
    const liveMap = extractSlotMap([editedClinic], []);

    // Strip __clinicConfig and __tasks — dirty check must see them as identical
    expect(sortedJSON(stripClinicConfig(liveMap))).toBe(sortedJSON(stripClinicConfig(snapshotMap)));
  });

  it('slot assignment change DOES make the map appear different from snapshot', () => {
    const snapshotMap = extractSlotMap([globalClinic], []);
    const editedClinic = makeClinic({ slots: { ...blankStandardSlots(), opener: 'p1' } });
    const liveMap = extractSlotMap([editedClinic], []);

    expect(sortedJSON(stripClinicConfig(liveMap))).not.toBe(sortedJSON(stripClinicConfig(snapshotMap)));
  });

  it('adding a new unassigned task instance DOES mark week dirty vs snapshot', () => {
    // Even though assignedPersonId is null, adding a new task creates task:tb: null
    // in the slot map. That new key IS included in the dirty comparison (only __clinicConfig
    // and __tasks definitions are stripped, not task:<id> assignment entries).
    const taskUnassigned = makeTask({ id: 'ta', assignedPersonId: null });
    const snapshotMap = extractSlotMap([globalClinic], [taskUnassigned]);

    const taskExtra = makeTask({ id: 'tb', label: 'Inventory', assignedPersonId: null });
    const liveMap = extractSlotMap([globalClinic], [taskUnassigned, taskExtra]);

    // task:tb: null is a new key → maps differ → week is dirty
    expect(sortedJSON(stripClinicConfig(liveMap))).not.toBe(sortedJSON(stripClinicConfig(snapshotMap)));
  });

  it('task ASSIGNMENT change DOES mark week dirty vs snapshot', () => {
    const taskUnassigned = makeTask({ id: 'ta', assignedPersonId: null });
    const snapshotMap = extractSlotMap([globalClinic], [taskUnassigned]);

    const taskAssigned = makeTask({ id: 'ta', assignedPersonId: 'p1' });
    const liveMap = extractSlotMap([globalClinic], [taskAssigned]);

    expect(sortedJSON(stripClinicConfig(liveMap))).not.toBe(sortedJSON(stripClinicConfig(snapshotMap)));
  });
});
