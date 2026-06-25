import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { getSeedData, migratePerson, generateId, getSlotPersonId } from '../data/seed.js';

const STORAGE_KEY = 'shiftcraft.v5';         // global clinic/people definitions
const CHANGELOG_KEY = 'shiftcraft.changelog';

const AppContext = createContext(null);

// ─── ISO week helpers ─────────────────────────
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function mondayOfWeek(weekStr) {
  const [year, wStr] = weekStr.split('-W');
  const y = parseInt(year), w = parseInt(wStr);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (w - 1) * 7);
  return monday;
}

function weekStorageKey(weekStr) { return `shiftcraft.week.${weekStr}`; }

/** Slot map: { [clinicId]: {scribe,opener,...}, [`task:${taskId}`]: personId|null } */
function extractSlotMap(clinics, tasks) {
  const map = {};
  for (const c of clinics) map[c.id] = { ...c.slots };
  for (const t of (tasks ?? [])) map[`task:${t.id}`] = t.assignedPersonId;
  return map;
}

function loadWeekSlotMap(weekStr) {
  try {
    const raw = localStorage.getItem(weekStorageKey(weekStr));
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
}

function saveWeekSlotMap(weekStr, map) {
  try {
    const payload = JSON.stringify(map);
    localStorage.setItem(weekStorageKey(weekStr), payload);
    console.log('[Shiftcraft] Saved week slots:', weekStorageKey(weekStr), payload.length, 'chars');
  } catch (e) {
    console.error('[Shiftcraft] Week slot save failed:', e);
  }
}

/** Apply a slotMap onto clinics and tasks, returning new arrays */
function applySlotMap(clinics, tasks, map) {
  const newClinics = clinics.map(c => ({
    ...c,
    slots: map[c.id] ?? {
      scribe: { personId: null, start: null, end: null },
      opener: null, closing: null,
      middle: { personId: null, start: null, end: null },
      training: { personId: null, start: null, end: null },
    },
  }));
  const newTasks = (tasks ?? []).map(t => ({
    ...t,
    assignedPersonId: map[`task:${t.id}`] ?? null,
  }));
  return { clinics: newClinics, additionalTasks: newTasks };
}

function blankSlotMap(clinics, tasks) {
  const map = {};
  for (const c of clinics) map[c.id] = {
    scribe: { personId: null, start: null, end: null },
    opener: null, closing: null,
    middle: { personId: null, start: null, end: null },
    training: { personId: null, start: null, end: null },
  };
  for (const t of (tasks ?? [])) map[`task:${t.id}`] = null;
  return map;
}

// IDs that were pre-seeded and should be stripped on migration
const SEEDED_TASK_IDS = new Set([
  'triage-mon','see-matt-jo-mon','img-upload-mon-ph','img-upload-mon-es',
  'triage-tue','see-matt-jo-tue',
  'triage-wed','see-matt-jo-wed',
  'triage-thu','see-matt-jo-thu',
  'triage-fri','see-matt-jo-fri',
]);

function migrateVariableSlot(val) {
  if (val === null || val === undefined) return { personId: null, start: null, end: null };
  if (typeof val === 'object') return val; // already object form
  return { personId: val, start: null, end: null }; // legacy string personId
}

// ─── Migration ────────────────────────────────
function migrateData(raw) {
  return {
    ...raw,
    people: (raw.people ?? []).map(migratePerson),
    clinics: (raw.clinics ?? []).map(c => {
      const { lastPatientTime: _lpt, ...rest } = c;
      return {
        ...rest,
        slots: {
          ...(rest.slots ?? {}),
          scribe: migrateVariableSlot((rest.slots ?? {}).scribe),
          middle: migrateVariableSlot((rest.slots ?? {}).middle),
          training: migrateVariableSlot((rest.slots ?? {}).training),
        },
      };
    }),
    // Strip pre-seeded tasks; keep only admin-created ones
    additionalTasks: (raw.additionalTasks ?? []).filter(t => !SEEDED_TASK_IDS.has(t.id)),
    taskTypes: raw.taskTypes ?? getSeedData().taskTypes,
  };
}

// ─── Idempotent migrations ────────────────────
// Each migration runs once, guarded by a localStorage flag.
// Runs synchronously before React state initialises so the
// corrected data is used from the very first render.
function runMigrations(data) {
  let d = data;
  let dirty = false;

  // ── Migration: avail ─────────────────────────
  // Wipe all availabilityWindows and re-apply only the known-correct
  // values for Yadi. Fixes stale 12:30 PM (750 min) defaults.
  if (!localStorage.getItem('shiftcraft.migration.avail')) {
    d = {
      ...d,
      people: d.people.map(p => {
        let windows = {};
        if (p.name === 'Yadi') {
          windows = {
            Mon: { startNotBefore: null, endNoLater: 990 },
            Wed: { startNotBefore: null, endNoLater: 990 },
            Thu: { startNotBefore: null, endNoLater: 870 },
            Fri: { startNotBefore: null, endNoLater: 990 },
          };
        }
        return { ...p, availabilityWindows: windows };
      }),
    };
    try { localStorage.setItem('shiftcraft.migration.avail', '1'); } catch { /* ignore */ }
    dirty = true;
  }

  // ── Migration: obs ───────────────────────────
  // Add OBS location and Thu/Fri clinics if missing.
  if (!localStorage.getItem('shiftcraft.migration.obs')) {
    let { locations, clinics } = d;
    if (!locations.includes('OBS')) {
      locations = [...locations, 'OBS'];
    }
    if (!clinics.some(c => c.location === 'OBS' && c.day === 'Thu')) {
      clinics = [...clinics, {
        id: 'thu-obs', day: 'Thu', week: 'A', location: 'OBS', provider: '',
        open: true, startTime: 480, endTime: 1020, patientCount: null,
        slots: { scribe: { personId: null, start: null, end: null }, opener: null, closing: null, middle: { personId: null, start: null, end: null }, training: { personId: null, start: null, end: null } },
      }];
    }
    if (!clinics.some(c => c.location === 'OBS' && c.day === 'Fri')) {
      clinics = [...clinics, {
        id: 'fri-obs', day: 'Fri', week: 'A', location: 'OBS', provider: '',
        open: true, startTime: 480, endTime: 1020, patientCount: null,
        slots: { scribe: { personId: null, start: null, end: null }, opener: null, closing: null, middle: { personId: null, start: null, end: null }, training: { personId: null, start: null, end: null } },
      }];
    }
    d = { ...d, locations, clinics };
    try { localStorage.setItem('shiftcraft.migration.obs', '1'); } catch { /* ignore */ }
    dirty = true;
  }

  // ── Migration: cleartasks ────────────────────
  // Wipe any additional task instances left over from old static seeds.
  if (!localStorage.getItem('shiftcraft.migration.cleartasks')) {
    d = { ...d, additionalTasks: [] };
    try { localStorage.setItem('shiftcraft.migration.cleartasks', '1'); } catch { /* ignore */ }
    dirty = true;
  }

  // ── Migration: skills (legacy split — no-op, kept for flag compat) ──
  if (!localStorage.getItem('shiftcraft.migration.skills')) {
    try { localStorage.setItem('shiftcraft.migration.skills', '1'); } catch { /* ignore */ }
  }

  // ── Migration: skillsmerge ───────────────────
  // Merge any combination of 'Autoclave', 'Closing', 'Autoclave and Closing',
  // 'Autoclave, Closing' into a single 'Autoclave & Closing' entry.
  if (!localStorage.getItem('shiftcraft.migration.skillsmerge')) {
    const MERGE_TRIGGERS = new Set(['Autoclave', 'Closing', 'Autoclave and Closing', 'Autoclave, Closing', 'Autoclave & Closing']);
    d = {
      ...d,
      people: d.people.map(p => {
        const raw = p.skills ?? [];
        const hasMergeable = raw.some(s => MERGE_TRIGGERS.has(s));
        if (!hasMergeable) return p;
        const skills = raw
          .filter(s => !MERGE_TRIGGERS.has(s))
          .concat(['Autoclave & Closing']);
        return { ...p, skills };
      }),
    };
    try { localStorage.setItem('shiftcraft.migration.skillsmerge', '1'); } catch { /* ignore */ }
    dirty = true;
  }

  // ── Migration: slottimes ─────────────────────────
  // Convert middle/training slot values in ALL week stores from personId strings
  // (or null) to { personId, start: null, end: null } objects.
  if (!localStorage.getItem('shiftcraft.migration.slottimes')) {
    // Migrate all week slot stores
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('shiftcraft.week.')) continue;
      try {
        const weekMap = JSON.parse(localStorage.getItem(key) ?? '{}');
        let changed = false;
        for (const clinicId of Object.keys(weekMap)) {
          const slots = weekMap[clinicId];
          if (slots && typeof slots === 'object') {
            if ('middle' in slots && (slots.middle === null || typeof slots.middle === 'string')) {
              slots.middle = migrateVariableSlot(slots.middle);
              changed = true;
            }
            if ('training' in slots && (slots.training === null || typeof slots.training === 'string')) {
              slots.training = migrateVariableSlot(slots.training);
              changed = true;
            }
          }
        }
        if (changed) localStorage.setItem(key, JSON.stringify(weekMap));
      } catch { /* ignore */ }
    }
    try { localStorage.setItem('shiftcraft.migration.slottimes', '1'); } catch { /* ignore */ }
    // d itself: global store slots are always blank (stripped on save), but
    // update in-memory to object form in case loadGlobal is reading old seed data
    d = {
      ...d,
      clinics: d.clinics.map(c => ({
        ...c,
        slots: {
          ...c.slots,
          middle: migrateVariableSlot(c.slots?.middle),
          training: migrateVariableSlot(c.slots?.training),
        },
      })),
    };
    dirty = true;
  }

  // ── Migration: scribetimes ─────────────────────────
  // Convert scribe slot values from string/null to { personId, start: null, end: null } objects.
  if (!localStorage.getItem('shiftcraft.migration.scribetimes')) {
    // Migrate all week slot stores
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('shiftcraft.week.')) continue;
      try {
        const weekMap = JSON.parse(localStorage.getItem(key) ?? '{}');
        let changed = false;
        for (const clinicId of Object.keys(weekMap)) {
          const slots = weekMap[clinicId];
          if (slots && typeof slots === 'object') {
            if ('scribe' in slots && (slots.scribe === null || typeof slots.scribe === 'string')) {
              slots.scribe = migrateVariableSlot(slots.scribe);
              changed = true;
            }
          }
        }
        if (changed) localStorage.setItem(key, JSON.stringify(weekMap));
      } catch { /* ignore */ }
    }
    // Update in-memory
    d = {
      ...d,
      clinics: d.clinics.map(c => ({
        ...c,
        slots: {
          ...c.slots,
          scribe: migrateVariableSlot(c.slots?.scribe),
        },
      })),
    };
    try { localStorage.setItem('shiftcraft.migration.scribetimes', '1'); } catch { /* ignore */ }
    dirty = true;
  }

  // ── Migration: tasktimes ─────────────────────
  // Add start/end time fields to existing additional tasks that don't have them.
  if (!localStorage.getItem('shiftcraft.migration.tasktimes')) {
    d = {
      ...d,
      additionalTasks: (d.additionalTasks ?? []).map(t => ({
        start: null, end: null, ...t,
      })),
    };
    try { localStorage.setItem('shiftcraft.migration.tasktimes', '1'); } catch { /* ignore */ }
    dirty = true;
  }

  // ── Migration: removelastpatient ─────────────
  // Strip lastPatientTime from all clinic objects — endTime now is the last patient time.
  if (!localStorage.getItem('shiftcraft.migration.removelastpatient')) {
    d = {
      ...d,
      clinics: d.clinics.map(c => {
        const { lastPatientTime: _lpt, ...rest } = c;
        return rest;
      }),
    };
    try { localStorage.setItem('shiftcraft.migration.removelastpatient', '1'); } catch { /* ignore */ }
    dirty = true;
  }

  // Save corrected data back to localStorage
  if (dirty) {
    try {
      const { clinics, additionalTasks, ...rest } = d;
      const definitionClinics = clinics.map(({ slots, ...def }) => ({
        ...def,
        slots: { scribe: { personId: null, start: null, end: null }, opener: null, closing: null, middle: { personId: null, start: null, end: null }, training: { personId: null, start: null, end: null } },
      }));
      const definitionTasks = (additionalTasks ?? []).map(({ assignedPersonId, ...t }) => ({
        ...t, assignedPersonId: null,
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ...rest, clinics: definitionClinics, additionalTasks: definitionTasks,
      }));
    } catch { /* ignore */ }
  }

  return d;
}

// ─── Load global data ─────────────────────────
function loadGlobal() {
  let data;
  try {
    // Try current key first; fall back to any previous key so migrations
    // can still run on data that predates the current STORAGE_KEY.
    const raw = localStorage.getItem(STORAGE_KEY)
      ?? localStorage.getItem('shiftcraft.v3')
      ?? localStorage.getItem('shiftcraft.v4');
    if (raw) data = migrateData(JSON.parse(raw));
  } catch { /* ignore */ }
  if (!data) data = getSeedData();
  return runMigrations(data);
}

// ─── Change log ───────────────────────────────
function loadChangelog() {
  try { return JSON.parse(localStorage.getItem(CHANGELOG_KEY) ?? '[]'); } catch { return []; }
}
function saveChangelog(log) {
  try { localStorage.setItem(CHANGELOG_KEY, JSON.stringify(log.slice(0, 500))); } catch { /* ignore */ }
}

// ─── Provider ────────────────────────────────
export function AppProvider({ children }) {
  const nowWeek = isoWeek(new Date());
  const [currentWeek, setCurrentWeek] = useState(nowWeek);
  const [changelog, setChangelog] = useState(loadChangelog);

  const [theme, setTheme] = useState(() =>
    localStorage.getItem('shiftcraft.theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  );
  const [isAdmin, setIsAdmin] = useState(false);

  const [lastSaved, setLastSaved] = useState(null);

  // Global data (clinic definitions, people, locations)
  const [globalData, setGlobalData] = useState(() => {
    const g = loadGlobal();
    // Apply week-specific slots for the current week
    const stored = loadWeekSlotMap(nowWeek);
    if (stored) {
      const applied = applySlotMap(g.clinics, g.additionalTasks, stored);
      return { ...g, ...applied };
    }
    // First run: seed the current week from globalData's own slots
    const seedMap = extractSlotMap(g.clinics, g.additionalTasks);
    saveWeekSlotMap(nowWeek, seedMap);
    return g;
  });

  // Persist global (definitions only — not slots, those go to week store)
  useEffect(() => {
    const { clinics, additionalTasks, ...rest } = globalData;
    // Strip slots from clinics before saving to global store
    const definitionClinics = clinics.map(({ slots, ...def }) => ({
      ...def,
      slots: { scribe: null, opener: null, closing: null, middle: { personId: null, start: null, end: null }, training: { personId: null, start: null, end: null } },
    }));
    const definitionTasks = additionalTasks.map(({ assignedPersonId, ...t }) => ({
      ...t, assignedPersonId: null,
    }));
    try {
      const payload = JSON.stringify({ ...rest, clinics: definitionClinics, additionalTasks: definitionTasks });
      localStorage.setItem(STORAGE_KEY, payload);
      console.log('[Shiftcraft] Saved to localStorage:', STORAGE_KEY, payload.length, 'chars');
      setLastSaved(Date.now());
    } catch (e) {
      console.error('[Shiftcraft] localStorage save failed:', e);
    }
  }, [globalData]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('shiftcraft.theme', theme);
  }, [theme]);

  // Belt-and-suspenders: flush both stores synchronously before the page unloads.
  // The useEffect above already saves on every change, but beforeunload catches
  // any edge cases where the effect hadn't fired yet.
  useEffect(() => {
    const handleBeforeUnload = () => {
      try {
        const { clinics, additionalTasks, ...rest } = globalData;
        const definitionClinics = clinics.map(({ slots, ...def }) => ({
          ...def,
          slots: { scribe: { personId: null, start: null, end: null }, opener: null, closing: null, middle: { personId: null, start: null, end: null }, training: { personId: null, start: null, end: null } },
        }));
        const definitionTasks = additionalTasks.map(({ assignedPersonId, ...t }) => ({
          ...t, assignedPersonId: null,
        }));
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...rest, clinics: definitionClinics, additionalTasks: definitionTasks }));
      } catch { /* ignore */ }
      try {
        const map = extractSlotMap(globalData.clinics, globalData.additionalTasks);
        saveWeekSlotMap(currentWeek, map);
      } catch { /* ignore */ }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [globalData, currentWeek]);

  useEffect(() => {
    saveChangelog(changelog);
  }, [changelog]);

  const addLog = useCallback((entry) => {
    setChangelog(prev => [{ ...entry, timestamp: Date.now() }, ...prev]);
  }, []);

  // ─── Save toast ──────────────────────────────
  const [savedToast, setSavedToast] = useState(false);
  const isFirstRender = useRef(true);
  const saveToastTimer = useRef(null);
  const dismissTimer = useRef(null);

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    clearTimeout(saveToastTimer.current);
    clearTimeout(dismissTimer.current);
    saveToastTimer.current = setTimeout(() => {
      setSavedToast(true);
      dismissTimer.current = setTimeout(() => setSavedToast(false), 1400);
    }, 600);
  }, [globalData]);

  // ─── Week navigation ────────────────────────
  const navigateWeek = useCallback((delta) => {
    setCurrentWeek(prev => {
      // Save current week's slots
      const currentMap = extractSlotMap(globalData.clinics, globalData.additionalTasks);
      saveWeekSlotMap(prev, currentMap);

      // Compute next week
      const monday = mondayOfWeek(prev);
      monday.setUTCDate(monday.getUTCDate() + delta * 7);
      const next = isoWeek(monday);

      // Load or blank next week
      const stored = loadWeekSlotMap(next);
      const map = stored ?? blankSlotMap(globalData.clinics, globalData.additionalTasks);
      if (!stored) saveWeekSlotMap(next, map);

      setGlobalData(g => {
        const applied = applySlotMap(g.clinics, g.additionalTasks, map);
        return { ...g, ...applied };
      });

      return next;
    });
  }, [globalData.clinics, globalData.additionalTasks]);

  const weekIsEmpty = useCallback(() => {
    const allSlotPersonIds = globalData.clinics.flatMap(c => Object.values(c.slots).map(sv => getSlotPersonId(sv)));
    const allTasks = globalData.additionalTasks.map(t => t.assignedPersonId);
    return [...allSlotPersonIds, ...allTasks].every(v => v == null);
  }, [globalData]);

  const copyFromPreviousWeek = useCallback(() => {
    const monday = mondayOfWeek(currentWeek);
    monday.setUTCDate(monday.getUTCDate() - 7);
    const prevWeek = isoWeek(monday);
    const prevMap = loadWeekSlotMap(prevWeek);
    if (!prevMap) return null;

    // Save current week with prev week's slots
    saveWeekSlotMap(currentWeek, prevMap);
    setGlobalData(g => {
      const applied = applySlotMap(g.clinics, g.additionalTasks, prevMap);
      return { ...g, ...applied };
    });
    return mondayOfWeek(prevWeek);
  }, [currentWeek]);

  // ─── Clinic mutations ───────────────────────
  const updateClinic = useCallback((clinicId, changes) => {
    setGlobalData(prev => {
      const clinics = prev.clinics.map(c => c.id === clinicId ? { ...c, ...changes } : c);
      // Persist slot update to week store
      const map = extractSlotMap(clinics, prev.additionalTasks);
      saveWeekSlotMap(currentWeek, map);
      return { ...prev, clinics };
    });
  }, [currentWeek]);

  const assignSlot = useCallback((clinicId, slotType, personId) => {
    setGlobalData(prev => {
      const clinics = prev.clinics.map(c => {
        if (c.id !== clinicId) return c;
        let newSlotVal;
        if (slotType === 'middle' || slotType === 'training' || slotType === 'scribe') {
          const existing = c.slots[slotType];
          const times = (existing && typeof existing === 'object')
            ? { start: existing.start, end: existing.end }
            : { start: null, end: null };
          newSlotVal = { personId, ...times };
        } else {
          newSlotVal = personId;
        }
        return { ...c, slots: { ...c.slots, [slotType]: newSlotVal } };
      });
      const map = extractSlotMap(clinics, prev.additionalTasks);
      saveWeekSlotMap(currentWeek, map);
      const clinic = clinics.find(c => c.id === clinicId);
      const person = personId ? prev.people.find(p => p.id === personId) : null;
      if (clinic) {
        const action = personId
          ? `${person?.name} assigned to ${slotType} @ ${clinic.location} (${clinic.provider}) on ${clinic.day}`
          : `Slot removed: ${slotType} @ ${clinic.location} (${clinic.provider}) on ${clinic.day}`;
        setChangelog(log => [{
          timestamp: Date.now(), action,
          personName: person?.name ?? '—', day: clinic.day, detail: '',
        }, ...log].slice(0, 500));
      }
      return { ...prev, clinics };
    });
  }, [currentWeek]);

  const updateSlotTime = useCallback((clinicId, slotType, start, end) => {
    setGlobalData(prev => {
      const clinics = prev.clinics.map(c => {
        if (c.id !== clinicId) return c;
        const existing = c.slots[slotType];
        const personId = (existing && typeof existing === 'object') ? existing.personId : null;
        return { ...c, slots: { ...c.slots, [slotType]: { personId, start, end } } };
      });
      const map = extractSlotMap(clinics, prev.additionalTasks);
      saveWeekSlotMap(currentWeek, map);
      return { ...prev, clinics };
    });
  }, [currentWeek]);

  const assignTask = useCallback((taskId, personId) => {
    setGlobalData(prev => {
      const additionalTasks = prev.additionalTasks.map(t =>
        t.id === taskId ? { ...t, assignedPersonId: personId } : t
      );
      const map = extractSlotMap(prev.clinics, additionalTasks);
      saveWeekSlotMap(currentWeek, map);

      const task = additionalTasks.find(t => t.id === taskId);
      const person = personId ? prev.people.find(p => p.id === personId) : null;
      if (task) {
        const action = personId
          ? `${person?.name} assigned to ${task.label}${task.locationTag ? ` (${task.locationTag})` : ''} on ${task.day}`
          : `${task.label} unassigned on ${task.day}`;
        setChangelog(log => [{
          timestamp: Date.now(), action,
          personName: person?.name ?? '—', day: task.day, detail: '',
        }, ...log].slice(0, 500));
      }

      return { ...prev, additionalTasks };
    });
  }, [currentWeek]);

  const addTask = useCallback((task) => {
    setGlobalData(prev => {
      const additionalTasks = [...(prev.additionalTasks ?? []), task];
      const taskTypes = prev.taskTypes.includes(task.label)
        ? prev.taskTypes
        : [...prev.taskTypes, task.label];
      // Keep week slot store in sync so the new task survives a reload
      const map = extractSlotMap(prev.clinics, additionalTasks);
      saveWeekSlotMap(currentWeek, map);
      return { ...prev, additionalTasks, taskTypes };
    });
  }, [currentWeek]);

  const removeTask = useCallback((taskId) => {
    setGlobalData(prev => ({
      ...prev,
      additionalTasks: (prev.additionalTasks ?? []).filter(t => t.id !== taskId),
    }));
  }, []);

  const updateTaskTime = useCallback((taskId, start, end) => {
    setGlobalData(prev => ({
      ...prev,
      additionalTasks: (prev.additionalTasks ?? []).map(t =>
        t.id === taskId ? { ...t, start, end } : t
      ),
    }));
  }, []);

  // ─── Person mutations ───────────────────────
  const updatePerson = useCallback((personId, changes) => {
    setGlobalData(prev => ({
      ...prev,
      people: prev.people.map(p => p.id === personId ? { ...p, ...changes } : p),
    }));
  }, []);

  const addPerson = useCallback((person) => {
    setGlobalData(prev => ({ ...prev, people: [...prev.people, person] }));
  }, []);

  const reorderPeople = useCallback((newOrder) => {
    setGlobalData(prev => ({ ...prev, people: newOrder }));
  }, []);

  // Bulk-apply AI-generated assignments: [{clinicId, slot, personId}]
  const applyBulkAssignments = useCallback((assignments) => {
    setGlobalData(prev => {
      let clinics = prev.clinics;
      for (const { clinicId, slot, personId } of assignments) {
        clinics = clinics.map(c => {
          if (c.id !== clinicId) return c;
          let newSlotVal;
          if (slot === 'middle' || slot === 'training' || slot === 'scribe') {
            const existing = c.slots[slot];
            const times = (existing && typeof existing === 'object')
              ? { start: existing.start, end: existing.end }
              : { start: null, end: null };
            newSlotVal = { personId, ...times };
          } else {
            newSlotVal = personId;
          }
          return { ...c, slots: { ...c.slots, [slot]: newSlotVal } };
        });
      }
      const map = extractSlotMap(clinics, prev.additionalTasks);
      saveWeekSlotMap(currentWeek, map);
      return { ...prev, clinics };
    });
  }, [currentWeek]);

  // Restore a slot snapshot: {[clinicId]: {scribe, opener, ...}} — used for undo
  const restoreClinicSlots = useCallback((slotSnapshot) => {
    setGlobalData(prev => {
      const clinics = prev.clinics.map(c => ({
        ...c,
        slots: slotSnapshot[c.id] ?? c.slots,
      }));
      const map = extractSlotMap(clinics, prev.additionalTasks);
      saveWeekSlotMap(currentWeek, map);
      return { ...prev, clinics };
    });
  }, [currentWeek]);

  const deletePerson = useCallback((personId) => {
    // Scan ALL stored weeks in localStorage and null out this person
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith('shiftcraft.week.')) continue;
        const map = JSON.parse(localStorage.getItem(key) ?? '{}');
        let changed = false;
        for (const slotKey of Object.keys(map)) {
          const val = map[slotKey];
          if (val === personId) {
            map[slotKey] = null;
            changed = true;
          } else if (val && typeof val === 'object') {
            for (const slot of Object.keys(val)) {
              const sv = val[slot];
              if (sv === personId) {
                val[slot] = null; changed = true;
              } else if (sv && typeof sv === 'object' && sv.personId === personId) {
                val[slot] = { ...sv, personId: null }; changed = true;
              }
            }
          }
        }
        if (changed) localStorage.setItem(key, JSON.stringify(map));
      }
    } catch { /* ignore */ }

    setGlobalData(prev => {
      const clinics = prev.clinics.map(c => ({
        ...c,
        slots: Object.fromEntries(
          Object.entries(c.slots).map(([k, v]) => {
            if (v === personId) return [k, null];
            if (v && typeof v === 'object' && v.personId === personId) return [k, { ...v, personId: null }];
            return [k, v];
          })
        ),
      }));
      const additionalTasks = (prev.additionalTasks ?? []).map(t =>
        t.assignedPersonId === personId ? { ...t, assignedPersonId: null } : t
      );
      return {
        ...prev,
        people: prev.people.filter(p => p.id !== personId),
        clinics,
        additionalTasks,
      };
    });
  }, []);

  // ─── Clinic/location mutations ──────────────
  const addClinic = useCallback((clinic) => {
    setGlobalData(prev => ({ ...prev, clinics: [...prev.clinics, clinic] }));
  }, []);

  const removeClinic = useCallback((clinicId) => {
    setGlobalData(prev => ({
      ...prev,
      clinics: prev.clinics.filter(c => c.id !== clinicId),
    }));
    // Remove from every stored week in localStorage
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith('shiftcraft.week.')) continue;
        const map = JSON.parse(localStorage.getItem(key) ?? '{}');
        if (clinicId in map) {
          delete map[clinicId];
          localStorage.setItem(key, JSON.stringify(map));
        }
      }
    } catch { /* ignore */ }
  }, []);

  const addLocation = useCallback((loc) => {
    setGlobalData(prev => ({ ...prev, locations: [...prev.locations, loc] }));
  }, []);

  const removeLocation = useCallback((loc) => {
    setGlobalData(prev => ({ ...prev, locations: prev.locations.filter(l => l !== loc) }));
  }, []);

  // ─── Changelog mutations ────────────────────
  const clearChangelog = useCallback(() => {
    setChangelog([]);
    saveChangelog([]);
  }, []);

  // Expose data as 'data' for component compatibility
  const data = globalData;

  // ─── Week label ─────────────────────────────
  const weekMonday = mondayOfWeek(currentWeek);
  const weekLabel = weekMonday.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });

  return (
    <AppContext.Provider value={{
      data,
      savedToast,
      lastSaved,
      isAdmin, setIsAdmin,
      theme, setTheme,
      currentWeek, weekLabel,
      navigateWeek, weekIsEmpty, copyFromPreviousWeek,
      updateClinic, assignSlot, updateSlotTime,
      assignTask, addTask, removeTask, updateTaskTime,
      updatePerson, addPerson, deletePerson, reorderPeople,
      applyBulkAssignments, restoreClinicSlots,
      addClinic, removeClinic, addLocation, removeLocation,
      changelog, clearChangelog, addLog,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);
