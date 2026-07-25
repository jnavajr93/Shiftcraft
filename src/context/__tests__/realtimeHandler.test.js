/**
 * Realtime SCHEDULE_KEY handler — pure-function coverage.
 *
 * AppContext's postgres_changes listener for SCHEDULE_KEY does:
 *
 *   1. Re-extracts the current week's slot map from live state.
 *   2. Re-applies it with the incoming global defs (new clinics/people/etc.).
 *   3. Merges BUILTIN_TASK_TYPES so stale broadcasts can't wipe built-ins.
 *   4. Updates originalTaskDefsRef from incoming additionalTasks.
 *   5. Tracks new clinics into originalClinicDefsRef.
 *
 * These tests verify the pure-function semantics (steps 1-3, 5) without
 * needing React or jsdom. The key invariant: an incoming global-definitions
 * broadcast must update people/providers/etc. WITHOUT wiping per-week slot
 * assignments that are live in the current view.
 */

import { describe, it, expect } from 'vitest';
import {
  extractSlotMap,
  applySlotMap,
  blankStandardSlots,
} from '../slotMap.js';

// BUILTIN_TASK_TYPES mirrors the constant in AppContext.jsx
const BUILTIN_TASK_TYPES = ['Triage', 'See Matt/Jo', 'Imaging Upload', 'Research', 'Training', 'Med Transport'];

function makeClinic(overrides = {}) {
  return {
    id: 'c1', provider: 'Dr. A', location: 'Phoenix', day: 'Mon',
    open: true, startTime: 480, endTime: 1020, patientCount: 30,
    slots: blankStandardSlots(),
    ...overrides,
  };
}

// Simulate the setGlobalData updater inside the SCHEDULE_KEY handler.
// This is the pure-function core of the realtime handler, extracted for testing.
function applyScheduleKeyBroadcast(currentGlobal, incomingValue) {
  const currentMap = extractSlotMap(currentGlobal.clinics, currentGlobal.additionalTasks);
  const applied = applySlotMap(
    incomingValue.clinics ?? currentGlobal.clinics,
    incomingValue.additionalTasks ?? currentGlobal.additionalTasks,
    currentMap,
  );
  const mergedTaskTypes = [
    ...BUILTIN_TASK_TYPES,
    ...((incomingValue.taskTypes ?? []).filter(t => !BUILTIN_TASK_TYPES.includes(t))),
  ];
  return { ...incomingValue, taskTypes: mergedTaskTypes, ...applied };
}

// Simulate the originalClinicDefsRef update from incoming SCHEDULE_KEY broadcast.
function updateOriginalClinicDefs(existingDefs, incomingClinics) {
  if (!existingDefs || !Array.isArray(incomingClinics)) return existingDefs;
  const existingIds = new Set(existingDefs.map(d => d.id));
  const newClinics = incomingClinics.filter(c => !existingIds.has(c.id));
  if (newClinics.length === 0) return existingDefs;
  return [
    ...existingDefs,
    ...newClinics.map(c => ({ id: c.id, open: c.open, startTime: c.startTime, endTime: c.endTime, patientCount: c.patientCount })),
  ];
}

// ─── Core: assignments survive SCHEDULE_KEY broadcast ────────────────────────

describe('Realtime SCHEDULE_KEY handler — assignment preservation', () => {
  it('per-week slot assignments are preserved when another session updates global defs', () => {
    // Current state: person-1 assigned to opener
    const clinic = makeClinic({ slots: { ...blankStandardSlots(), opener: 'person-1' } });
    const currentGlobal = {
      clinics: [clinic],
      additionalTasks: [],
      people: [{ id: 'person-1', name: 'Alice' }],
      taskTypes: BUILTIN_TASK_TYPES,
      locations: ['Phoenix'],
      providers: [],
    };

    // Another manager added a new person to the roster (global defs update)
    const incoming = {
      clinics: [makeClinic()], // fresh clinic defs (no per-week slots)
      additionalTasks: [],
      people: [{ id: 'person-1', name: 'Alice' }, { id: 'person-2', name: 'Bob' }],
      taskTypes: BUILTIN_TASK_TYPES,
      locations: ['Phoenix'],
      providers: [],
    };

    const next = applyScheduleKeyBroadcast(currentGlobal, incoming);

    // The broadcast must update people
    expect(next.people).toHaveLength(2);
    expect(next.people[1].name).toBe('Bob');

    // Per-week slot assignment must be preserved — person-1 still on opener
    expect(next.clinics[0].slots.opener).toBe('person-1');
  });

  it('task assignments are preserved when another session broadcasts new global defs', () => {
    const clinic = makeClinic();
    const task = { id: 'ta', label: 'Triage', day: 'Mon', assignedPersonId: 'person-1', start: null, end: null };
    const currentGlobal = {
      clinics: [clinic],
      additionalTasks: [task],
      people: [{ id: 'person-1', name: 'Alice' }],
      taskTypes: BUILTIN_TASK_TYPES,
      locations: ['Phoenix'],
      providers: [],
    };

    // Incoming: another manager changed people roster (global defs only, startTime unchanged)
    const incoming = {
      clinics: [makeClinic()], // same startTime: 480
      additionalTasks: [{ id: 'ta', label: 'Triage', day: 'Mon', assignedPersonId: null, start: null, end: null }],
      people: [{ id: 'person-1', name: 'Alice' }, { id: 'person-2', name: 'Bob' }],
      taskTypes: BUILTIN_TASK_TYPES,
      locations: ['Phoenix'],
      providers: [],
    };

    const next = applyScheduleKeyBroadcast(currentGlobal, incoming);

    // Task assignment from current live state must survive
    expect(next.additionalTasks[0].assignedPersonId).toBe('person-1');
    // Incoming people roster applied
    expect(next.people).toHaveLength(2);
    expect(next.people[1].name).toBe('Bob');
  });

  it('per-week clinic config (__clinicConfig) is preserved over incoming global clinic defs', () => {
    // Key invariant: the SCHEDULE_KEY handler re-applies the currentMap (which includes
    // __clinicConfig) onto the incoming clinics. This means the per-week clinic config
    // takes precedence — the incoming global record's times/patientCount are overridden
    // by the current week's __clinicConfig.
    const clinic = makeClinic({ open: false, startTime: 420, patientCount: 55 }); // per-week config
    const currentGlobal = { clinics: [clinic], additionalTasks: [], people: [], taskTypes: BUILTIN_TASK_TYPES, locations: [], providers: [] };

    // Incoming has different patientCount in global record
    const incoming = { clinics: [makeClinic({ patientCount: 40 })], additionalTasks: [], people: [], taskTypes: BUILTIN_TASK_TYPES, locations: [], providers: [] };

    const next = applyScheduleKeyBroadcast(currentGlobal, incoming);

    // Per-week config (from currentMap's __clinicConfig) wins over incoming global values
    expect(next.clinics[0].open).toBe(false);
    expect(next.clinics[0].startTime).toBe(420);
    expect(next.clinics[0].patientCount).toBe(55);
  });

  it('multiple slot assignments all survive a global broadcast', () => {
    const clinic = makeClinic({
      slots: {
        ...blankStandardSlots(),
        opener: 'p1',
        closing: 'p2',
        scribe: { personId: 'p3', start: null, end: null },
      },
    });
    const currentGlobal = { clinics: [clinic], additionalTasks: [], people: [], taskTypes: BUILTIN_TASK_TYPES, locations: [], providers: [] };
    // Incoming with different provider (global defs change); patientCount in incoming is 40
    // but per-week __clinicConfig from currentMap will override it back to 30
    const incoming = { clinics: [makeClinic({ provider: 'Dr. B' })], additionalTasks: [], people: [], taskTypes: BUILTIN_TASK_TYPES, locations: [], providers: [] };

    const next = applyScheduleKeyBroadcast(currentGlobal, incoming);

    // Per-week slot assignments preserved
    expect(next.clinics[0].slots.opener).toBe('p1');
    expect(next.clinics[0].slots.closing).toBe('p2');
    expect(next.clinics[0].slots.scribe.personId).toBe('p3');
    // Incoming global-level provider change applied (provider is not in __clinicConfig)
    expect(next.clinics[0].provider).toBe('Dr. B');
  });
});

// ─── BUILTIN_TASK_TYPES merge ─────────────────────────────────────────────────

describe('Realtime SCHEDULE_KEY handler — BUILTIN_TASK_TYPES always present', () => {
  it('stale broadcast missing Med Transport cannot wipe it from taskTypes', () => {
    const currentGlobal = {
      clinics: [makeClinic()], additionalTasks: [], people: [], locations: [], providers: [],
      taskTypes: [...BUILTIN_TASK_TYPES, 'Custom'],
    };
    // Incoming has an old record without Med Transport
    const incoming = {
      clinics: [makeClinic()], additionalTasks: [], people: [], locations: [], providers: [],
      taskTypes: ['Triage', 'See Matt/Jo', 'Imaging Upload', 'Research', 'Training'],
    };

    const next = applyScheduleKeyBroadcast(currentGlobal, incoming);
    expect(next.taskTypes).toContain('Med Transport');
  });

  it('custom task types from incoming broadcast are preserved alongside built-ins', () => {
    const currentGlobal = {
      clinics: [makeClinic()], additionalTasks: [], people: [], locations: [], providers: [],
      taskTypes: BUILTIN_TASK_TYPES,
    };
    const incoming = {
      clinics: [makeClinic()], additionalTasks: [], people: [], locations: [], providers: [],
      taskTypes: [...BUILTIN_TASK_TYPES, 'IV Insertion'],
    };

    const next = applyScheduleKeyBroadcast(currentGlobal, incoming);
    expect(next.taskTypes).toContain('IV Insertion');
    for (const t of BUILTIN_TASK_TYPES) expect(next.taskTypes).toContain(t);
  });

  it('BUILTIN_TASK_TYPES are deduplicated (not doubled) when incoming already has them', () => {
    const currentGlobal = {
      clinics: [makeClinic()], additionalTasks: [], people: [], locations: [], providers: [],
      taskTypes: BUILTIN_TASK_TYPES,
    };
    const incoming = {
      clinics: [makeClinic()], additionalTasks: [], people: [], locations: [], providers: [],
      taskTypes: BUILTIN_TASK_TYPES,
    };

    const next = applyScheduleKeyBroadcast(currentGlobal, incoming);
    const triageCount = next.taskTypes.filter(t => t === 'Triage').length;
    expect(triageCount).toBe(1);
  });
});

// ─── originalClinicDefsRef update logic ──────────────────────────────────────

describe('Realtime SCHEDULE_KEY handler — originalClinicDefs tracking', () => {
  it('new clinics in incoming broadcast are added to originalClinicDefs', () => {
    const existing = [{ id: 'c1', open: true, startTime: 480, endTime: 1020, patientCount: 30 }];
    const incoming = [
      makeClinic({ id: 'c1' }),
      makeClinic({ id: 'c2', location: 'Scottsdale', patientCount: 20 }),
    ];

    const next = updateOriginalClinicDefs(existing, incoming);
    expect(next).toHaveLength(2);
    expect(next[1].id).toBe('c2');
    expect(next[1].patientCount).toBe(20);
  });

  it('existing clinics are NOT duplicated when they appear in incoming broadcast', () => {
    const existing = [{ id: 'c1', open: true, startTime: 480, endTime: 1020, patientCount: 30 }];
    const incoming = [makeClinic({ id: 'c1', patientCount: 99 })];

    const next = updateOriginalClinicDefs(existing, incoming);
    expect(next).toHaveLength(1);
    // Existing entry is unchanged (not overwritten by incoming)
    expect(next[0].patientCount).toBe(30);
  });

  it('returns existingDefs unchanged (same reference) when no new clinics arrive', () => {
    const existing = [{ id: 'c1', open: true, startTime: 480, endTime: 1020, patientCount: 30 }];
    const incoming = [makeClinic({ id: 'c1' })];

    const next = updateOriginalClinicDefs(existing, incoming);
    expect(next).toBe(existing); // reference equality — no allocation
  });
});
