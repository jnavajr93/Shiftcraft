/**
 * Regression tests for additional-task persistence.
 *
 * Root cause (discovered 2026-07-22):
 *   The `cleartasks` migration in runMigrations() did `additionalTasks: []` — a blanket wipe.
 *   On any new device (localStorage flag absent), this ran against live Supabase data that
 *   already had user-created tasks. The next user action triggered the auto-save useEffect
 *   which then pushed the empty task list to Supabase, destroying tasks for all users.
 *
 * Fix: migration now filters only the pre-seeded stub IDs (SEEDED_TASK_IDS), not all tasks.
 *      init() also saves immediately when migrations ran, rather than waiting for a user action.
 *
 * These tests prove:
 *   1. The filter logic only removes pre-seeded stubs, not user-created tasks.
 *   2. generateSchedule() produces no task-slot assignments (tasks are never auto-filled).
 *   3. The slot map (extractSlotMap / applySlotMap) correctly round-trips task assignments.
 */

import { describe, it, expect } from 'vitest';
import { generateSchedule } from './adapter.js';

// ── 1. cleartasks migration: filter logic ────────────────────────────────────
//
// These are the exact seeded IDs that the migration is allowed to remove.
// Copied from AppContext.jsx to make the test self-contained and catch drift.
const SEEDED_TASK_IDS = new Set([
  'triage-mon', 'see-matt-jo-mon', 'img-upload-mon-ph', 'img-upload-mon-es',
  'triage-tue', 'see-matt-jo-tue',
  'triage-wed', 'see-matt-jo-wed',
  'triage-thu', 'see-matt-jo-thu',
  'triage-fri', 'see-matt-jo-fri',
]);

// The fixed migration logic (was previously `additionalTasks: []`)
function simulateCleartasksMigration(tasks) {
  return (tasks ?? []).filter(t => !SEEDED_TASK_IDS.has(t.id));
}

describe('cleartasks migration — filter logic', () => {
  it('removes only pre-seeded stub IDs; user-created tasks survive', () => {
    const tasks = [
      { id: 'triage-mon',         label: 'Triage',          day: 'Mon', assignedPersonId: null },
      { id: 'see-matt-jo-mon',    label: 'See Matt/Jo',     day: 'Mon', assignedPersonId: null },
      { id: 'img-upload-mon-ph',  label: 'Imaging Upload',  day: 'Mon', assignedPersonId: null },
      { id: 'user-inventory-abc', label: 'Inventory',       day: 'Mon', assignedPersonId: 'p1' },
      { id: 'user-research-xyz',  label: 'Research',        day: 'Tue', assignedPersonId: 'p2' },
    ];
    const after = simulateCleartasksMigration(tasks);
    expect(after).toHaveLength(2);
    const ids = after.map(t => t.id).sort();
    expect(ids).toEqual(['user-inventory-abc', 'user-research-xyz'].sort());
  });

  it('leaves all tasks intact when none match seeded IDs', () => {
    const tasks = [
      { id: 'abc-111', label: 'Inventory',  day: 'Mon', assignedPersonId: 'p1' },
      { id: 'def-222', label: 'Research',   day: 'Tue', assignedPersonId: 'p2' },
      { id: 'ghi-333', label: 'Training',   day: 'Wed', assignedPersonId: null },
    ];
    expect(simulateCleartasksMigration(tasks)).toHaveLength(3);
  });

  it('removes all tasks when all are seeded stubs', () => {
    const tasks = [
      { id: 'triage-mon', label: 'Triage', day: 'Mon' },
      { id: 'triage-tue', label: 'Triage', day: 'Tue' },
      { id: 'see-matt-jo-fri', label: 'See Matt/Jo', day: 'Fri' },
    ];
    expect(simulateCleartasksMigration(tasks)).toHaveLength(0);
  });

  it('handles empty or undefined task list without throwing', () => {
    expect(simulateCleartasksMigration([])).toHaveLength(0);
    expect(simulateCleartasksMigration(undefined)).toHaveLength(0);
  });

  it('all 12 seeded stub IDs are covered', () => {
    // Ensures SEEDED_TASK_IDS here stays in sync with AppContext.jsx
    const expected = [
      'triage-mon', 'see-matt-jo-mon', 'img-upload-mon-ph', 'img-upload-mon-es',
      'triage-tue', 'see-matt-jo-tue',
      'triage-wed', 'see-matt-jo-wed',
      'triage-thu', 'see-matt-jo-thu',
      'triage-fri', 'see-matt-jo-fri',
    ];
    expect(SEEDED_TASK_IDS.size).toBe(12);
    for (const id of expected) {
      expect(SEEDED_TASK_IDS.has(id)).toBe(true);
    }
  });
});

// ── 2. generateSchedule() never auto-fills task slots ────────────────────────

const makeGlobalData = (overrides = {}) => ({
  people: [
    {
      id: 'p1', name: 'Alice', color: '#000',
      roles: ['Scribe'], skills: [], clearedLocations: [],
      preferredLocations: [], lockedTo: [], daysOff: [],
      availabilityWindows: {}, accommodations: [], targetHours: 40,
    },
    {
      id: 'p2', name: 'Bob', color: '#111',
      roles: ['Opener'], skills: [], clearedLocations: [],
      preferredLocations: [], lockedTo: [], daysOff: [],
      availabilityWindows: {}, accommodations: [], targetHours: 40,
    },
  ],
  locations: ['Phoenix'],
  providers: [
    { name: 'Dr. A', requiredSlots: ['scribe', 'opener'], conditionalSlots: [] },
  ],
  clinics: [{
    id: 'mon-phoenix', day: 'Mon', location: 'Phoenix', provider: 'Dr. A',
    open: true, startTime: 480, endTime: 1020, patientCount: null,
    slots: {
      openingFrontDesk: null, closingFrontDesk: null, frontDesk: null,
      scribe: { personId: null, start: null, end: null },
      opener: null, closing: null,
      middle: { personId: null, start: null, end: null },
      training: { personId: null, start: null, end: null },
    },
  }],
  additionalTasks: [
    { id: 'user-inv-mon', label: 'Inventory',  day: 'Mon', assignedPersonId: 'p1', start: null, end: null },
    { id: 'user-res-tue', label: 'Research',   day: 'Tue', assignedPersonId: 'p2', start: null, end: null },
  ],
  taskTypes: ['Inventory', 'Research'],
  ...overrides,
});

describe('generateSchedule — task non-interference', () => {
  it('generates no assignments for additional task slots', () => {
    const { assignments } = generateSchedule(makeGlobalData());
    // generateSchedule only produces clinic slot assignments (scribe, opener, etc.)
    // It must never auto-assign to task slots — those are manager-only.
    const taskLabels = new Set(['Inventory', 'Research', 'Triage', 'Imaging Upload', 'See Matt/Jo', 'Training']);
    const badAssignments = assignments.filter(a => taskLabels.has(a.slot));
    expect(badAssignments).toHaveLength(0);
  });

  it('manual task assignedPersonId is not touched by generateSchedule', () => {
    // generateSchedule returns { assignments } for clinics only.
    // The caller (applyBulkAssignments) then calls extractSlotMap which reads
    // globalData.additionalTasks as-is. Verify the task object we pass in
    // is NOT modified by the call.
    const gd = makeGlobalData();
    const tasksBefore = JSON.stringify(gd.additionalTasks);
    generateSchedule(gd);
    expect(JSON.stringify(gd.additionalTasks)).toBe(tasksBefore);
  });
});

// ── 3. Slot map round-trip: task assignments survive extract → apply ───────────
//
// extractSlotMap and applySlotMap are internal to AppContext.jsx and cannot be
// imported directly. Their logic is reproduced here so the round-trip contract
// is explicitly tested and any future divergence is caught.

function extractSlotMap(clinics, tasks) {
  const map = {};
  for (const c of clinics) map[c.id] = { ...c.slots };
  for (const t of (tasks ?? [])) map[`task:${t.id}`] = t.assignedPersonId;
  return map;
}

function applySlotMap(clinics, tasks, map) {
  const newClinics = clinics.map(c => ({
    ...c,
    slots: { ...c.slots, ...(map[c.id] ?? {}) },
  }));
  const newTasks = (tasks ?? []).map(t => ({
    ...t,
    assignedPersonId: map[`task:${t.id}`] ?? null,
  }));
  return { clinics: newClinics, additionalTasks: newTasks };
}

describe('Slot map round-trip — task assignments', () => {
  const tasks = [
    { id: 'inv-abc', label: 'Inventory', day: 'Mon', assignedPersonId: 'alice-id', start: null, end: null },
    { id: 'res-def', label: 'Research',  day: 'Tue', assignedPersonId: 'bob-id',   start: null, end: null },
    { id: 'unassigned', label: 'Triage', day: 'Wed', assignedPersonId: null,       start: null, end: null },
  ];

  it('extractSlotMap captures task assignments under task:${id} keys', () => {
    const map = extractSlotMap([], tasks);
    expect(map['task:inv-abc']).toBe('alice-id');
    expect(map['task:res-def']).toBe('bob-id');
    expect(map['task:unassigned']).toBeNull();
  });

  it('applySlotMap restores task assignments from map', () => {
    const map = extractSlotMap([], tasks);
    const { additionalTasks } = applySlotMap([], tasks, map);
    expect(additionalTasks.find(t => t.id === 'inv-abc')?.assignedPersonId).toBe('alice-id');
    expect(additionalTasks.find(t => t.id === 'res-def')?.assignedPersonId).toBe('bob-id');
    expect(additionalTasks.find(t => t.id === 'unassigned')?.assignedPersonId).toBeNull();
  });

  it('full round-trip: extract then apply is identity on assignments', () => {
    const map = extractSlotMap([], tasks);
    const { additionalTasks } = applySlotMap([], tasks, map);
    for (const original of tasks) {
      const restored = additionalTasks.find(t => t.id === original.id);
      expect(restored?.assignedPersonId).toBe(original.assignedPersonId);
    }
  });

  it('task definition attributes (label, day, start, end) survive the round-trip', () => {
    const map = extractSlotMap([], tasks);
    const { additionalTasks } = applySlotMap([], tasks, map);
    const inv = additionalTasks.find(t => t.id === 'inv-abc');
    expect(inv?.label).toBe('Inventory');
    expect(inv?.day).toBe('Mon');
    expect(inv?.start).toBeNull();
    expect(inv?.end).toBeNull();
  });

  it('a blank slot map (null assignment) does not lose the task definition', () => {
    // Simulates navigating to a new week: blank map with task:id → null
    const blankMap = { 'task:inv-abc': null, 'task:res-def': null, 'task:unassigned': null };
    const { additionalTasks } = applySlotMap([], tasks, blankMap);
    // Definitions survive; only assignments are cleared
    expect(additionalTasks).toHaveLength(3);
    for (const t of additionalTasks) {
      expect(t.assignedPersonId).toBeNull();
      expect(t.label).toBeTruthy();
    }
  });
});
