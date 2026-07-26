/**
 * Regression tests for per-week clinic config isolation.
 *
 * These tests verify that:
 *  1. extractSlotMap captures open/times/patientCount in __clinicConfig.
 *  2. applySlotMap applies __clinicConfig for the per-week values.
 *  3. applySlotMap without __clinicConfig uses the supplied global baseline.
 *  4. toDefinitionData restores the global baseline values (does NOT write
 *     the per-week override into the global record).
 *  5. Full three-week isolation: distinct clinic configs in weeks A, B, C
 *     are independently stored and retrievable without cross-contamination.
 *  6. Staff assignments and additional tasks are already per-week (confirm).
 */

import { describe, it, expect } from 'vitest';
import {
  extractSlotMap,
  applySlotMap,
  blankSlotMap,
  blankStandardSlots,
  blankObsSlots,
  stripClinicConfig,
  toDefinitionData,
  hasAnyAssignment,
} from '../slotMap.js';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

function makeClinic(overrides = {}) {
  return {
    id: 'c1',
    provider: 'Dr. Test',
    location: 'Phoenix',
    day: 'Mon',
    open: true,
    startTime: 480,   // 8:00 AM
    endTime: 1020,    // 5:00 PM
    patientCount: 30,
    slots: blankStandardSlots(),
    ...overrides,
  };
}

function makeTask(overrides = {}) {
  return {
    id: 't1',
    label: 'Triage',
    day: 'Mon',
    assignedPersonId: null,
    start: null,
    end: null,
    ...overrides,
  };
}

// ─── extractSlotMap ───────────────────────────────────────────────────────────

describe('extractSlotMap', () => {
  it('captures open, startTime, endTime, patientCount in __clinicConfig', () => {
    const clinic = makeClinic({ open: false, startTime: 420, endTime: 900, patientCount: 55 });
    const map = extractSlotMap([clinic], []);
    expect(map.__clinicConfig).toBeDefined();
    expect(map.__clinicConfig['c1']).toEqual({
      open: false,
      startTime: 420,
      endTime: 900,
      patientCount: 55,
    });
  });

  it('captures task assignments keyed as task:<id>', () => {
    const task = makeTask({ assignedPersonId: 'person-1' });
    const map = extractSlotMap([makeClinic()], [task]);
    expect(map['task:t1']).toBe('person-1');
  });

  it('captures slot assignments for the clinic', () => {
    const clinic = makeClinic({
      slots: { ...blankStandardSlots(), opener: 'person-2' },
    });
    const map = extractSlotMap([clinic], []);
    expect(map['c1'].opener).toBe('person-2');
  });
});

// ─── applySlotMap — per-week config overrides ─────────────────────────────────

describe('applySlotMap — per-week __clinicConfig', () => {
  it('applies __clinicConfig to override open/closed state', () => {
    // Global baseline: clinic open
    const globalClinic = makeClinic({ open: true });
    // Week slot map marks the clinic as closed for this week only
    const weekMap = {
      c1: blankStandardSlots(),
      __clinicConfig: { c1: { open: false, startTime: 480, endTime: 1020, patientCount: 30 } },
    };
    const { clinics } = applySlotMap([globalClinic], [], weekMap);
    expect(clinics[0].open).toBe(false);
  });

  it('applies __clinicConfig for startTime and endTime', () => {
    const globalClinic = makeClinic({ startTime: 480, endTime: 1020 });
    const weekMap = {
      c1: blankStandardSlots(),
      __clinicConfig: { c1: { open: true, startTime: 420, endTime: 900, patientCount: 30 } },
    };
    const { clinics } = applySlotMap([globalClinic], [], weekMap);
    expect(clinics[0].startTime).toBe(420);
    expect(clinics[0].endTime).toBe(900);
  });

  it('applies __clinicConfig for patientCount', () => {
    const globalClinic = makeClinic({ patientCount: 30 });
    const weekMap = {
      c1: blankStandardSlots(),
      __clinicConfig: { c1: { open: true, startTime: 480, endTime: 1020, patientCount: 72 } },
    };
    const { clinics } = applySlotMap([globalClinic], [], weekMap);
    expect(clinics[0].patientCount).toBe(72);
  });

  it('uses global baseline when __clinicConfig is absent (blank new week)', () => {
    const globalClinic = makeClinic({ open: true, startTime: 480, patientCount: 30 });
    const weekMap = blankSlotMap([globalClinic], []);
    // blankSlotMap deliberately omits __clinicConfig
    expect(weekMap.__clinicConfig).toBeUndefined();
    const { clinics } = applySlotMap([globalClinic], [], weekMap);
    // Falls back to global baseline
    expect(clinics[0].open).toBe(true);
    expect(clinics[0].startTime).toBe(480);
    expect(clinics[0].patientCount).toBe(30);
  });

  it('applies slot assignments regardless of __clinicConfig', () => {
    const globalClinic = makeClinic({ open: true });
    const weekMap = {
      c1: { ...blankStandardSlots(), opener: 'person-3' },
      __clinicConfig: { c1: { open: false, startTime: 480, endTime: 1020, patientCount: 30 } },
    };
    const { clinics } = applySlotMap([globalClinic], [], weekMap);
    expect(clinics[0].slots.opener).toBe('person-3');
    expect(clinics[0].open).toBe(false);
  });
});

// ─── toDefinitionData — baseline restoration ──────────────────────────────────

describe('toDefinitionData', () => {
  it('restores open/closed baseline — does not write per-week toggle to global record', () => {
    // Simulate: clinic was globally open at init
    const originalClinicDefs = [
      { id: 'c1', open: true, startTime: 480, endTime: 1020, patientCount: 30 },
    ];
    // Manager closed the clinic for this week — globalData now has open: false
    const globalData = {
      clinics: [makeClinic({ open: false })],
      additionalTasks: [],
      people: [],
      taskTypes: [],
      locations: [],
      providers: [],
    };
    const def = toDefinitionData(globalData, originalClinicDefs);
    // Global record must have the BASELINE open value, not the per-week toggle
    expect(def.clinics[0].open).toBe(true);
  });

  it('restores startTime / endTime baseline', () => {
    const originalClinicDefs = [
      { id: 'c1', open: true, startTime: 480, endTime: 1020, patientCount: 30 },
    ];
    const globalData = {
      clinics: [makeClinic({ startTime: 420, endTime: 900 })],
      additionalTasks: [],
      people: [], taskTypes: [], locations: [], providers: [],
    };
    const def = toDefinitionData(globalData, originalClinicDefs);
    expect(def.clinics[0].startTime).toBe(480);
    expect(def.clinics[0].endTime).toBe(1020);
  });

  it('restores patientCount baseline', () => {
    const originalClinicDefs = [
      { id: 'c1', open: true, startTime: 480, endTime: 1020, patientCount: 30 },
    ];
    const globalData = {
      clinics: [makeClinic({ patientCount: 72 })],
      additionalTasks: [],
      people: [], taskTypes: [], locations: [], providers: [],
    };
    const def = toDefinitionData(globalData, originalClinicDefs);
    expect(def.clinics[0].patientCount).toBe(30);
  });

  it('passes through non-per-week fields (provider, location) unchanged', () => {
    const originalClinicDefs = [
      { id: 'c1', open: true, startTime: 480, endTime: 1020, patientCount: 30 },
    ];
    const globalData = {
      clinics: [makeClinic({ provider: 'Dr. Updated', location: 'Chandler' })],
      additionalTasks: [],
      people: [], taskTypes: [], locations: [], providers: [],
    };
    const def = toDefinitionData(globalData, originalClinicDefs);
    // Provider and location are global — must pass through
    expect(def.clinics[0].provider).toBe('Dr. Updated');
    expect(def.clinics[0].location).toBe('Chandler');
  });

  it('allows new clinics (not in originalClinicDefs) to write their initial values', () => {
    const originalClinicDefs = [
      { id: 'c1', open: true, startTime: 480, endTime: 1020, patientCount: 30 },
    ];
    const newClinic = makeClinic({ id: 'c2', open: false, startTime: 420, patientCount: 50 });
    const globalData = {
      clinics: [makeClinic(), newClinic],
      additionalTasks: [],
      people: [], taskTypes: [], locations: [], providers: [],
    };
    const def = toDefinitionData(globalData, originalClinicDefs);
    // New clinic (c2) not in originalClinicDefs — initial values ARE the baseline
    expect(def.clinics[1].open).toBe(false);
    expect(def.clinics[1].startTime).toBe(420);
    expect(def.clinics[1].patientCount).toBe(50);
  });

  it('strips slots from all clinics', () => {
    const originalClinicDefs = [
      { id: 'c1', open: true, startTime: 480, endTime: 1020, patientCount: 30 },
    ];
    const globalData = {
      clinics: [makeClinic({ slots: { ...blankStandardSlots(), opener: 'person-5' } })],
      additionalTasks: [],
      people: [], taskTypes: [], locations: [], providers: [],
    };
    const def = toDefinitionData(globalData, originalClinicDefs);
    // Slots must be blanked — the global record holds no assignments
    expect(def.clinics[0].slots.opener).toBeNull();
  });

  it('strips task assignedPersonId', () => {
    const originalClinicDefs = [
      { id: 'c1', open: true, startTime: 480, endTime: 1020, patientCount: 30 },
    ];
    const globalData = {
      clinics: [makeClinic()],
      additionalTasks: [makeTask({ assignedPersonId: 'person-9' })],
      people: [], taskTypes: [], locations: [], providers: [],
    };
    const def = toDefinitionData(globalData, originalClinicDefs);
    expect(def.additionalTasks[0].assignedPersonId).toBeNull();
  });

  it('behaves correctly with no originalClinicDefs (null)', () => {
    // When originalClinicDefs is null (e.g. during initial seed before ref is set),
    // the function must not crash and should return values as-is.
    const globalData = {
      clinics: [makeClinic({ open: false })],
      additionalTasks: [],
      people: [], taskTypes: [], locations: [], providers: [],
    };
    const def = toDefinitionData(globalData, null);
    // No baseline to restore — passes through
    expect(def.clinics[0].open).toBe(false);
  });
});

// ─── Three-week isolation scenario ────────────────────────────────────────────

describe('Three-week isolation: editing one week leaves others untouched', () => {
  // Simulate the full flow: one global clinic, three weeks with distinct configs.
  // Mimics what the app does: extractSlotMap → Supabase → applySlotMap → navigate.

  const GLOBAL_BASELINE = {
    id: 'c1', open: true, startTime: 480, endTime: 1020, patientCount: 30,
  };
  const globalClinic = makeClinic(GLOBAL_BASELINE);

  // Week A: close the clinic, 40 patients
  const weekAConfig = { open: false, startTime: 480, endTime: 1020, patientCount: 40 };
  // Week B: keep open, change times, 55 patients
  const weekBConfig = { open: true, startTime: 420, endTime: 900, patientCount: 55 };
  // Week C: default (no override) — should fall back to global baseline

  // Extract maps as if navigating to each week and making edits
  const weekAClinic = { ...globalClinic, ...weekAConfig };
  const weekBClinic = { ...globalClinic, ...weekBConfig };

  const mapA = extractSlotMap([weekAClinic], []);
  const mapB = extractSlotMap([weekBClinic], []);
  const mapC = blankSlotMap([globalClinic], []); // new week, no __clinicConfig

  it('Week A: stores its own config in __clinicConfig', () => {
    expect(mapA.__clinicConfig['c1'].open).toBe(false);
    expect(mapA.__clinicConfig['c1'].patientCount).toBe(40);
  });

  it('Week B: stores its own config in __clinicConfig', () => {
    expect(mapB.__clinicConfig['c1'].open).toBe(true);
    expect(mapB.__clinicConfig['c1'].startTime).toBe(420);
    expect(mapB.__clinicConfig['c1'].patientCount).toBe(55);
  });

  it('Week C: no __clinicConfig (blank week)', () => {
    expect(mapC.__clinicConfig).toBeUndefined();
  });

  it('Applying Week A map to global baseline gives Week A config', () => {
    const { clinics } = applySlotMap([globalClinic], [], mapA);
    expect(clinics[0].open).toBe(false);
    expect(clinics[0].patientCount).toBe(40);
  });

  it('Applying Week B map to global baseline gives Week B config', () => {
    const { clinics } = applySlotMap([globalClinic], [], mapB);
    expect(clinics[0].open).toBe(true);
    expect(clinics[0].startTime).toBe(420);
    expect(clinics[0].patientCount).toBe(55);
  });

  it('Applying Week C map to global baseline gives global baseline config', () => {
    const { clinics } = applySlotMap([globalClinic], [], mapC);
    expect(clinics[0].open).toBe(true);
    expect(clinics[0].startTime).toBe(480);
    expect(clinics[0].patientCount).toBe(30);
  });

  it('toDefinitionData with originalClinicDefs does not corrupt global record with Week A values', () => {
    // After applying Week A, globalData.clinics has open: false, patientCount: 40
    const { clinics: weekAClinics } = applySlotMap([globalClinic], [], mapA);
    const globalData = {
      clinics: weekAClinics,
      additionalTasks: [],
      people: [], taskTypes: [], locations: [], providers: [],
    };
    const originalClinicDefs = [GLOBAL_BASELINE];
    const def = toDefinitionData(globalData, originalClinicDefs);
    // The global record must have the BASELINE values, not Week A's per-week values
    expect(def.clinics[0].open).toBe(true);      // baseline: open
    expect(def.clinics[0].patientCount).toBe(30); // baseline: 30
  });

  it('Week A edits do NOT affect Week B when re-applying Week B map to uncorrupted global baseline', () => {
    // Simulate: manager edits Week A (closes clinic), then navigates to Week B.
    // navigateWeek resets globalData.clinics to originalClinicDefs before applySlotMap.
    const resetClinics = [{ ...globalClinic, ...GLOBAL_BASELINE }]; // restored from originalClinicDefs
    const { clinics: weekBAfterNav } = applySlotMap(resetClinics, [], mapB);
    expect(weekBAfterNav[0].open).toBe(true);        // Week B: open
    expect(weekBAfterNav[0].startTime).toBe(420);    // Week B: 7:00 AM
    expect(weekBAfterNav[0].patientCount).toBe(55);  // Week B: 55
  });

  it('Week B edits do NOT affect Week C (blank week) when applying Week C map to global baseline', () => {
    const resetClinics = [{ ...globalClinic, ...GLOBAL_BASELINE }]; // restored from originalClinicDefs
    const { clinics: weekCAfterNav } = applySlotMap(resetClinics, [], mapC);
    expect(weekCAfterNav[0].open).toBe(true);       // global baseline: open
    expect(weekCAfterNav[0].startTime).toBe(480);   // global baseline: 8:00 AM
    expect(weekCAfterNav[0].patientCount).toBe(30); // global baseline: 30
  });
});

// ─── Staff assignments are per-week ──────────────────────────────────────────

describe('Staff assignments are per-week', () => {
  it('slot assignments are stored in the week slot map, not the global record', () => {
    const clinic = makeClinic({
      slots: { ...blankStandardSlots(), opener: 'person-1', scribe: { personId: 'person-2', start: null, end: null } },
    });
    const originalClinicDefs = [
      { id: 'c1', open: true, startTime: 480, endTime: 1020, patientCount: 30 },
    ];
    const globalData = {
      clinics: [clinic],
      additionalTasks: [],
      people: [], taskTypes: [], locations: [], providers: [],
    };
    const def = toDefinitionData(globalData, originalClinicDefs);
    // Global record must have blank slots, not the per-week assignments
    expect(def.clinics[0].slots.opener).toBeNull();
    expect(def.clinics[0].slots.scribe?.personId).toBeNull();
  });

  it('task assignments are stored in the week slot map, not the global record', () => {
    const task = makeTask({ assignedPersonId: 'person-3' });
    const originalClinicDefs = [
      { id: 'c1', open: true, startTime: 480, endTime: 1020, patientCount: 30 },
    ];
    const globalData = {
      clinics: [makeClinic()],
      additionalTasks: [task],
      people: [], taskTypes: [], locations: [], providers: [],
    };
    const def = toDefinitionData(globalData, originalClinicDefs);
    expect(def.additionalTasks[0].assignedPersonId).toBeNull();
    // Verify they ARE in the week map
    const weekMap = extractSlotMap([makeClinic()], [task]);
    expect(weekMap['task:t1']).toBe('person-3');
  });
});

// ─── stripClinicConfig ────────────────────────────────────────────────────────

describe('stripClinicConfig', () => {
  it('removes __clinicConfig from a map', () => {
    const map = { c1: {}, __clinicConfig: { c1: { open: true } } };
    const stripped = stripClinicConfig(map);
    expect(stripped.__clinicConfig).toBeUndefined();
    expect(stripped.c1).toBeDefined();
  });

  it('returns the map unchanged when no __clinicConfig', () => {
    const map = { c1: {}, 'task:t1': 'person-1' };
    expect(stripClinicConfig(map)).toBe(map); // same reference
  });
});

// ─── hasAnyAssignment ─────────────────────────────────────────────────────────

describe('hasAnyAssignment', () => {
  it('returns false for a blank map', () => {
    const map = blankSlotMap([makeClinic()], [makeTask()]);
    expect(hasAnyAssignment(map)).toBe(false);
  });

  it('returns true when a slot has an assignment', () => {
    const clinic = makeClinic({ slots: { ...blankStandardSlots(), opener: 'person-1' } });
    const map = extractSlotMap([clinic], []);
    expect(hasAnyAssignment(map)).toBe(true);
  });

  it('ignores __clinicConfig when checking assignments', () => {
    // A map with __clinicConfig but no actual assignments should return false
    const map = {
      c1: blankStandardSlots(),
      __clinicConfig: { c1: { open: false, startTime: 480, endTime: 1020, patientCount: 30 } },
    };
    expect(hasAnyAssignment(map)).toBe(false);
  });
});

// ─── Per-week task instance isolation ────────────────────────────────────────
//
// Task INSTANCES (label, day, time) are per-week: adding/editing/removing a task
// in one week must not affect any other week.
//
// Key invariants:
//   1. extractSlotMap stores task definitions in __tasks.
//   2. applySlotMap uses __tasks from the map (per-week list), ignoring the
//      global baseline passed as the second argument.
//   3. blankSlotMap seeds __tasks: [] so new weeks have no task instances.
//   4. toDefinitionData uses originalTaskDefs (global baseline) when writing the
//      global SCHEDULE_KEY record, preventing per-week task instances from bleeding.
//   5. Three-week independence: distinct task lists in A/B/C do not cross-contaminate.

describe('Per-week task instance isolation', () => {
  const clinic = makeClinic();
  const origDefs = [{ id: 'c1', open: true, startTime: 480, endTime: 1020, patientCount: 30 }];

  // ── 1. extractSlotMap stores __tasks ──────────────────────────────────────

  it('extractSlotMap stores task definitions in __tasks (without assignedPersonId)', () => {
    const tasks = [
      makeTask({ id: 'ta', label: 'Inventory', assignedPersonId: 'person-1' }),
      makeTask({ id: 'tb', label: 'Triage',    assignedPersonId: 'person-2' }),
    ];
    const map = extractSlotMap([clinic], tasks);
    expect(Array.isArray(map.__tasks)).toBe(true);
    expect(map.__tasks).toHaveLength(2);
    // definitions must NOT include assignedPersonId
    expect(map.__tasks[0].assignedPersonId).toBeUndefined();
    expect(map.__tasks[1].assignedPersonId).toBeUndefined();
    // assignments are stored separately as task:<id>
    expect(map['task:ta']).toBe('person-1');
    expect(map['task:tb']).toBe('person-2');
  });

  it('extractSlotMap excludes _isResearch ephemeral overlays from __tasks', () => {
    const tasks = [
      makeTask({ id: 'ta', label: 'Triage' }),
      { ...makeTask({ id: 'tr', label: 'Research' }), _isResearch: true, _researchId: 'r1' },
    ];
    const map = extractSlotMap([clinic], tasks);
    expect(map.__tasks).toHaveLength(1);
    expect(map.__tasks[0].id).toBe('ta');
  });

  // ── 2. applySlotMap uses __tasks from the map ─────────────────────────────

  it('applySlotMap uses __tasks from the map, ignoring the global baseline list', () => {
    // Global baseline has task G; week map has task W only.
    const globalTask = makeTask({ id: 'g', label: 'GlobalTask' });
    const weekTask   = makeTask({ id: 'w', label: 'WeekTask' });
    const weekMap = extractSlotMap([clinic], [weekTask]);
    // Pass global task list as second arg; week map's __tasks should win.
    const { additionalTasks } = applySlotMap([clinic], [globalTask], weekMap);
    expect(additionalTasks).toHaveLength(1);
    expect(additionalTasks[0].id).toBe('w');
  });

  it('applySlotMap restores task assignments from task:<id> entries', () => {
    const task = makeTask({ id: 'ta', assignedPersonId: 'person-5' });
    const weekMap = extractSlotMap([clinic], [task]);
    // Pass empty list as global baseline — __tasks provides the definition
    const { additionalTasks } = applySlotMap([clinic], [], weekMap);
    expect(additionalTasks[0].assignedPersonId).toBe('person-5');
  });

  // ── 3. blankSlotMap seeds __tasks: [] ────────────────────────────────────

  it('blankSlotMap produces __tasks: [] so new weeks start with no task instances', () => {
    const map = blankSlotMap([clinic]);
    expect(map.__tasks).toEqual([]);
    // applySlotMap on a blank map yields no tasks regardless of global baseline
    const globalTask = makeTask({ id: 'g', label: 'GlobalTask' });
    const { additionalTasks } = applySlotMap([clinic], [globalTask], map);
    expect(additionalTasks).toHaveLength(0);
  });

  // ── 4. toDefinitionData uses originalTaskDefs ─────────────────────────────

  it('toDefinitionData uses originalTaskDefs baseline, not the current week task list', () => {
    // originalTaskDefs: one global task (the baseline at init)
    const originalTaskDefs = [makeTask({ id: 'global', label: 'GlobalTemplate' })];
    // This week added a per-week task; live additionalTasks has both
    const globalData = {
      clinics: [clinic],
      additionalTasks: [
        makeTask({ id: 'global', label: 'GlobalTemplate', assignedPersonId: 'person-1' }),
        makeTask({ id: 'perweek', label: 'PerWeekTask',   assignedPersonId: 'person-2' }),
      ],
      people: [], taskTypes: [], locations: [], providers: [],
    };
    const def = toDefinitionData(globalData, origDefs, originalTaskDefs);
    // Global record must contain ONLY the baseline task, not the per-week addition
    expect(def.additionalTasks).toHaveLength(1);
    expect(def.additionalTasks[0].id).toBe('global');
    expect(def.additionalTasks[0].assignedPersonId).toBeNull();
  });

  it('toDefinitionData with null originalTaskDefs falls back to live list (first-time seed)', () => {
    const globalData = {
      clinics: [clinic],
      additionalTasks: [makeTask({ id: 'ta', label: 'Triage', assignedPersonId: 'p1' })],
      people: [], taskTypes: [], locations: [], providers: [],
    };
    const def = toDefinitionData(globalData, origDefs, null);
    // No baseline provided — uses live list (initial seed case)
    expect(def.additionalTasks).toHaveLength(1);
    expect(def.additionalTasks[0].id).toBe('ta');
    expect(def.additionalTasks[0].assignedPersonId).toBeNull();
  });

  // ── 5. Three-week independence ────────────────────────────────────────────

  it('tasks added in week B do not appear when applying week A or week C maps', () => {
    // Global baseline: no tasks
    const globalTasks = [];

    // Week A: one task (Inventory)
    const weekATask = makeTask({ id: 'inv', label: 'Inventory', assignedPersonId: 'p1' });
    const mapA = extractSlotMap([clinic], [weekATask]);

    // Week B: different task (Triage)
    const weekBTask = makeTask({ id: 'tri', label: 'Triage', assignedPersonId: 'p2' });
    const mapB = extractSlotMap([clinic], [weekBTask]);

    // Week C: no tasks (blank)
    const mapC = blankSlotMap([clinic]);

    const { additionalTasks: tasksA } = applySlotMap([clinic], globalTasks, mapA);
    const { additionalTasks: tasksB } = applySlotMap([clinic], globalTasks, mapB);
    const { additionalTasks: tasksC } = applySlotMap([clinic], globalTasks, mapC);

    // Week A has only Inventory
    expect(tasksA).toHaveLength(1);
    expect(tasksA[0].id).toBe('inv');
    expect(tasksA[0].assignedPersonId).toBe('p1');

    // Week B has only Triage
    expect(tasksB).toHaveLength(1);
    expect(tasksB[0].id).toBe('tri');
    expect(tasksB[0].assignedPersonId).toBe('p2');

    // Week C has no tasks
    expect(tasksC).toHaveLength(0);
  });

  it('toDefinitionData writes only the global baseline regardless of which week is viewed', () => {
    // Baseline: one global template task
    const originalTaskDefs = [makeTask({ id: 'tmpl', label: 'Template' })];

    // Week B has two tasks: the template (assigned) + a per-week extra
    const globalDataWeekB = {
      clinics: [clinic],
      additionalTasks: [
        makeTask({ id: 'tmpl',  label: 'Template',    assignedPersonId: 'pA' }),
        makeTask({ id: 'extra', label: 'WeekBOnlyTask', assignedPersonId: 'pB' }),
      ],
      people: [], taskTypes: [], locations: [], providers: [],
    };
    // Week C has no tasks
    const globalDataWeekC = {
      clinics: [clinic],
      additionalTasks: [],
      people: [], taskTypes: [], locations: [], providers: [],
    };

    const defFromB = toDefinitionData(globalDataWeekB, origDefs, originalTaskDefs);
    const defFromC = toDefinitionData(globalDataWeekC, origDefs, originalTaskDefs);

    // Both weeks must write the same global baseline (only 'tmpl', unassigned)
    expect(defFromB.additionalTasks).toHaveLength(1);
    expect(defFromB.additionalTasks[0].id).toBe('tmpl');
    expect(defFromC.additionalTasks).toHaveLength(1);
    expect(defFromC.additionalTasks[0].id).toBe('tmpl');
  });
});

// ─── Standing task _standingClinicId round-trip ───────────────────────────────

describe('standing task _standingClinicId round-trip', () => {
  it('preserves _standingClinicId through extractSlotMap → applySlotMap', () => {
    const clinic = makeClinic();
    const task = makeTask({ id: 'st1', label: 'Inventory', _standingClinicId: 'c1' });
    const map = extractSlotMap([clinic], [task]);

    // _standingClinicId should appear in __tasks
    expect(map.__tasks).toHaveLength(1);
    expect(map.__tasks[0]._standingClinicId).toBe('c1');

    // applySlotMap should restore the task with _standingClinicId intact
    const applied = applySlotMap([clinic], [], map);
    expect(applied.additionalTasks).toHaveLength(1);
    expect(applied.additionalTasks[0]._standingClinicId).toBe('c1');
    expect(applied.additionalTasks[0].label).toBe('Inventory');
  });

  it('assignedPersonId is NOT stored in __tasks — it is per-week via task:<id> key', () => {
    const clinic = makeClinic();
    const task = makeTask({ id: 'st1', _standingClinicId: 'c1', assignedPersonId: 'person-x' });
    const map = extractSlotMap([clinic], [task]);

    // assignedPersonId stripped from __tasks
    expect(map.__tasks[0].assignedPersonId).toBeUndefined();
    // but stored as task:st1 in the map
    expect(map['task:st1']).toBe('person-x');

    // applySlotMap should restore assignedPersonId
    const applied = applySlotMap([clinic], [], map);
    expect(applied.additionalTasks[0].assignedPersonId).toBe('person-x');
    expect(applied.additionalTasks[0]._standingClinicId).toBe('c1');
  });
});
