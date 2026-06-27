import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { getSeedData, migratePerson, generateId, getSlotPersonId } from '../data/seed.js';
import { supabase } from '../supabase.js';
import {
  saveSchedule as saveScheduleDB,
  loadSchedule as loadScheduleDB,
  saveWeekSlotMap as saveWeekSlotMapDB,
  loadWeekSlotMap as loadWeekSlotMapDB,
  saveChangelog as saveChangelogDB,
  loadChangelog as loadChangelogDB,
  weekKey,
  SCHEDULE_KEY,
} from '../services/dataService.js';

// localStorage keys kept only for migration and per-device flags
const STORAGE_KEY = 'shiftcraft.v5';
const CHANGELOG_KEY_LOCAL = 'shiftcraft.changelog';

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

/** Slot map: { [clinicId]: {scribe,opener,...}, [`task:${taskId}`]: personId|null } */
function extractSlotMap(clinics, tasks) {
  const map = {};
  for (const c of clinics) map[c.id] = { ...c.slots };
  for (const t of (tasks ?? [])) map[`task:${t.id}`] = t.assignedPersonId;
  return map;
}

// Read from localStorage (used during migration only)
function readLocalWeekSlotMap(weekStr) {
  try {
    const raw = localStorage.getItem(`shiftcraft.week.${weekStr}`);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return null;
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
  if (typeof val === 'object') return val;
  return { personId: val, start: null, end: null };
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
    additionalTasks: (raw.additionalTasks ?? []).filter(t => !SEEDED_TASK_IDS.has(t.id)),
    taskTypes: raw.taskTypes ?? getSeedData().taskTypes,
  };
}

// ─── Idempotent migrations ────────────────────
// Migration flags stay in localStorage (tiny booleans, device-level).
// Data corrections are returned and saved to Supabase by the caller.
function runMigrations(data) {
  let d = data;
  let dirty = false;

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

  if (!localStorage.getItem('shiftcraft.migration.cleartasks')) {
    d = { ...d, additionalTasks: [] };
    try { localStorage.setItem('shiftcraft.migration.cleartasks', '1'); } catch { /* ignore */ }
    dirty = true;
  }

  if (!localStorage.getItem('shiftcraft.migration.skills')) {
    try { localStorage.setItem('shiftcraft.migration.skills', '1'); } catch { /* ignore */ }
  }

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

  if (!localStorage.getItem('shiftcraft.migration.slottimes')) {
    // Migrate any remaining localStorage week stores
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

  if (!localStorage.getItem('shiftcraft.migration.scribetimes')) {
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

  if (!localStorage.getItem('shiftcraft.migration.openeropen')) {
    d = {
      ...d,
      clinics: d.clinics.map(c => {
        const opener = c.slots?.opener;
        if (opener && typeof opener === 'object' && opener.start === c.startTime) {
          return { ...c, slots: { ...c.slots, opener: { ...opener, start: null } } };
        }
        return c;
      }),
    };
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('shiftcraft.week.')) continue;
      try {
        const weekMap = JSON.parse(localStorage.getItem(key));
        let changed = false;
        for (const clinicId of Object.keys(weekMap)) {
          if (clinicId.startsWith('task:')) continue;
          const slots = weekMap[clinicId];
          const opener = slots?.opener;
          const clinic = d.clinics.find(c => c.id === clinicId);
          if (opener && typeof opener === 'object' && clinic && opener.start === clinic.startTime) {
            weekMap[clinicId] = { ...slots, opener: { ...opener, start: null } };
            changed = true;
          }
        }
        if (changed) localStorage.setItem(key, JSON.stringify(weekMap));
      } catch { /* ignore */ }
    }
    try { localStorage.setItem('shiftcraft.migration.openeropen', '1'); } catch { /* ignore */ }
    dirty = true;
  }

  // Note: no localStorage save here — caller saves to Supabase
  void dirty;

  return d;
}

// Strip slots from clinic definitions before saving global store
function toDefinitionData(globalData) {
  const { clinics, additionalTasks, ...rest } = globalData;
  const definitionClinics = clinics.map(({ slots, ...def }) => ({
    ...def,
    slots: { scribe: { personId: null, start: null, end: null }, opener: null, closing: null, middle: { personId: null, start: null, end: null }, training: { personId: null, start: null, end: null } },
  }));
  const definitionTasks = (additionalTasks ?? []).map(({ assignedPersonId, ...t }) => ({
    ...t, assignedPersonId: null,
  }));
  return { ...rest, clinics: definitionClinics, additionalTasks: definitionTasks };
}

// ─── Provider ─────────────────────────────────
export function AppProvider({ children }) {
  const nowWeek = isoWeek(new Date());
  const [currentWeek, setCurrentWeek] = useState(nowWeek);
  const [changelog, setChangelog] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const [theme, setTheme] = useState(() =>
    localStorage.getItem('shiftcraft.theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  );
  const [isAdmin, setIsAdmin] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);

  // null until loaded from Supabase
  const [globalData, setGlobalData] = useState(null);

  // ─── Initial load from Supabase ─────────────
  useEffect(() => {
    let cancelled = false;

    async function init() {
      // 1. Try Supabase for global definitions
      let data = await loadScheduleDB();

      if (!data) {
        // Migrate from localStorage if present
        const localRaw = localStorage.getItem(STORAGE_KEY)
          ?? localStorage.getItem('shiftcraft.v4')
          ?? localStorage.getItem('shiftcraft.v3');
        if (localRaw) {
          try { data = migrateData(JSON.parse(localRaw)); } catch { data = null; }
        }
        if (!data) data = getSeedData();
        // Save to Supabase (fire-and-forget)
        saveScheduleDB(toDefinitionData(data));
      }

      data = runMigrations(data);

      // 2. Try Supabase for current week slots
      let weekMap = await loadWeekSlotMapDB(nowWeek);

      if (!weekMap) {
        // Migrate from localStorage if present
        weekMap = readLocalWeekSlotMap(nowWeek);
        if (weekMap) {
          saveWeekSlotMapDB(nowWeek, weekMap); // migrate up
        } else {
          weekMap = extractSlotMap(data.clinics, data.additionalTasks);
          saveWeekSlotMapDB(nowWeek, weekMap);
        }
      }

      const applied = applySlotMap(data.clinics, data.additionalTasks, weekMap);

      // 3. Load changelog
      const cl = await loadChangelogDB();

      if (cancelled) return;

      setGlobalData({ ...data, ...applied });
      setChangelog(cl);
      setIsLoading(false);
    }

    init();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Persist global definitions to Supabase ──
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isLoading || !globalData) return;
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    saveScheduleDB(toDefinitionData(globalData));
    setLastSaved(Date.now());
  }, [globalData, isLoading]);

  // ─── Theme (stays per-device in localStorage) ─
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('shiftcraft.theme', theme);
  }, [theme]);

  // ─── Changelog ────────────────────────────────
  useEffect(() => {
    if (isLoading) return;
    saveChangelogDB(changelog.slice(0, 500));
  }, [changelog, isLoading]);

  // ─── Save toast ──────────────────────────────
  const [savedToast, setSavedToast] = useState(false);
  const saveToastTimer = useRef(null);
  const dismissTimer = useRef(null);

  useEffect(() => {
    if (isLoading || !globalData) return;
    clearTimeout(saveToastTimer.current);
    clearTimeout(dismissTimer.current);
    saveToastTimer.current = setTimeout(() => {
      setSavedToast(true);
      dismissTimer.current = setTimeout(() => setSavedToast(false), 1400);
    }, 600);
  }, [globalData, isLoading]);

  // ─── Real-time sync ───────────────────────────
  useEffect(() => {
    if (isLoading) return;

    const channel = supabase
      .channel('schedule_changes')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'schedule_data',
      }, (payload) => {
        const { key, value } = payload.new;
        if (key === weekKey(currentWeek)) {
          // Another user updated this week's slots
          setGlobalData(g => {
            if (!g) return g;
            const applied = applySlotMap(g.clinics, g.additionalTasks, value);
            return { ...g, ...applied };
          });
        } else if (key === SCHEDULE_KEY) {
          // Another user updated global definitions (people, clinics)
          setGlobalData(g => {
            if (!g) return g;
            const currentMap = extractSlotMap(g.clinics, g.additionalTasks);
            const applied = applySlotMap(value.clinics ?? g.clinics, value.additionalTasks ?? g.additionalTasks, currentMap);
            return { ...value, ...applied };
          });
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isLoading, currentWeek]);

  const addLog = useCallback((entry) => {
    setChangelog(prev => [{ ...entry, timestamp: Date.now() }, ...prev]);
  }, []);

  // ─── Week navigation ────────────────────────
  const navigateWeek = useCallback(async (delta) => {
    if (!globalData) return;

    // Save current week's slots
    const currentMap = extractSlotMap(globalData.clinics, globalData.additionalTasks);
    saveWeekSlotMapDB(currentWeek, currentMap);

    // Compute target week
    const monday = mondayOfWeek(currentWeek);
    const targetMonday = new Date(Date.UTC(
      monday.getUTCFullYear(),
      monday.getUTCMonth(),
      monday.getUTCDate() + delta * 7,
    ));
    const tmp = new Date(targetMonday);
    const dow = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dow);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const weekNum = Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
    const next = `${tmp.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;

    // Load target week from Supabase, fall back to localStorage migration, then blank
    let map = await loadWeekSlotMapDB(next);
    if (!map) {
      map = readLocalWeekSlotMap(next);
      if (map) {
        saveWeekSlotMapDB(next, map); // migrate localStorage → Supabase
      } else {
        map = blankSlotMap(globalData.clinics, globalData.additionalTasks);
        saveWeekSlotMapDB(next, map);
      }
    }

    setCurrentWeek(next);
    setGlobalData(g => {
      const applied = applySlotMap(g.clinics, g.additionalTasks, map);
      return { ...g, ...applied };
    });
  }, [currentWeek, globalData]);

  const jumpToWeek = useCallback(async (targetWeek) => {
    if (!globalData || currentWeek === targetWeek) return;

    const currentMap = extractSlotMap(globalData.clinics, globalData.additionalTasks);
    saveWeekSlotMapDB(currentWeek, currentMap);

    let map = await loadWeekSlotMapDB(targetWeek);
    if (!map) {
      map = readLocalWeekSlotMap(targetWeek);
      if (map) {
        saveWeekSlotMapDB(targetWeek, map);
      } else {
        map = blankSlotMap(globalData.clinics, globalData.additionalTasks);
        saveWeekSlotMapDB(targetWeek, map);
      }
    }

    setCurrentWeek(targetWeek);
    setGlobalData(g => {
      const applied = applySlotMap(g.clinics, g.additionalTasks, map);
      return { ...g, ...applied };
    });
  }, [currentWeek, globalData]);

  const weekIsEmpty = useCallback(() => {
    if (!globalData) return true;
    const allSlotPersonIds = globalData.clinics.flatMap(c => Object.values(c.slots).map(sv => getSlotPersonId(sv)));
    const allTasks = globalData.additionalTasks.map(t => t.assignedPersonId);
    return [...allSlotPersonIds, ...allTasks].every(v => v == null);
  }, [globalData]);

  const copyFromPreviousWeek = useCallback(async () => {
    if (!globalData) return null;
    const monday = mondayOfWeek(currentWeek);
    monday.setUTCDate(monday.getUTCDate() - 7);
    const prevWeek = isoWeek(monday);

    let prevMap = await loadWeekSlotMapDB(prevWeek);
    if (!prevMap) prevMap = readLocalWeekSlotMap(prevWeek);
    if (!prevMap) return null;

    saveWeekSlotMapDB(currentWeek, prevMap);
    setGlobalData(g => {
      const applied = applySlotMap(g.clinics, g.additionalTasks, prevMap);
      return { ...g, ...applied };
    });
    return mondayOfWeek(prevWeek);
  }, [currentWeek, globalData]);

  // ─── Clinic mutations ───────────────────────
  const updateClinic = useCallback((clinicId, changes) => {
    setGlobalData(prev => {
      const clinics = prev.clinics.map(c => c.id === clinicId ? { ...c, ...changes } : c);
      const map = extractSlotMap(clinics, prev.additionalTasks);
      saveWeekSlotMapDB(currentWeek, map);
      return { ...prev, clinics };
    });
  }, [currentWeek]);

  const assignSlot = useCallback((clinicId, slotType, personId) => {
    setGlobalData(prev => {
      const clinics = prev.clinics.map(c => {
        if (c.id !== clinicId) return c;
        const existing = c.slots[slotType];
        const times = (existing && typeof existing === 'object')
          ? { start: existing.start, end: existing.end }
          : { start: null, end: null };
        const newSlotVal = { personId: personId ?? null, ...times };
        return { ...c, slots: { ...c.slots, [slotType]: newSlotVal } };
      });
      const map = extractSlotMap(clinics, prev.additionalTasks);
      saveWeekSlotMapDB(currentWeek, map);
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
        const personId = (existing && typeof existing === 'object')
          ? existing.personId
          : (typeof existing === 'string' ? existing : null);
        return { ...c, slots: { ...c.slots, [slotType]: { personId, start, end } } };
      });
      const map = extractSlotMap(clinics, prev.additionalTasks);
      saveWeekSlotMapDB(currentWeek, map);
      return { ...prev, clinics };
    });
  }, [currentWeek]);

  const assignTask = useCallback((taskId, personId) => {
    setGlobalData(prev => {
      const additionalTasks = prev.additionalTasks.map(t =>
        t.id === taskId ? { ...t, assignedPersonId: personId } : t
      );
      const map = extractSlotMap(prev.clinics, additionalTasks);
      saveWeekSlotMapDB(currentWeek, map);

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
      const map = extractSlotMap(prev.clinics, additionalTasks);
      saveWeekSlotMapDB(currentWeek, map);
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
      saveWeekSlotMapDB(currentWeek, map);
      return { ...prev, clinics };
    });
  }, [currentWeek]);

  const restoreClinicSlots = useCallback((slotSnapshot) => {
    setGlobalData(prev => {
      const clinics = prev.clinics.map(c => ({
        ...c,
        slots: slotSnapshot[c.id] ?? c.slots,
      }));
      const map = extractSlotMap(clinics, prev.additionalTasks);
      saveWeekSlotMapDB(currentWeek, map);
      return { ...prev, clinics };
    });
  }, [currentWeek]);

  const deletePerson = useCallback((personId) => {
    // Best-effort: clear this person from all Supabase week rows
    (async () => {
      try {
        const { data: rows } = await supabase
          .from('schedule_data')
          .select('key, value')
          .like('key', 'shiftcraft_week_%');
        if (rows) {
          for (const row of rows) {
            const map = row.value;
            let changed = false;
            for (const slotKey of Object.keys(map)) {
              const val = map[slotKey];
              if (val === personId) {
                map[slotKey] = null; changed = true;
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
            if (changed) saveWeekSlotMapDB(row.key.replace('shiftcraft_week_', ''), map);
          }
        }
      } catch { /* ignore */ }
    })();

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
    saveChangelogDB([]);
  }, []);

  const data = globalData;

  // ─── Week label ─────────────────────────────
  const weekMonday = mondayOfWeek(currentWeek);
  const weekLabel = weekMonday.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });

  return (
    <AppContext.Provider value={{
      data,
      isLoading,
      savedToast,
      lastSaved,
      isAdmin, setIsAdmin,
      theme, setTheme,
      currentWeek, weekLabel,
      navigateWeek, jumpToWeek, weekIsEmpty, copyFromPreviousWeek,
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
