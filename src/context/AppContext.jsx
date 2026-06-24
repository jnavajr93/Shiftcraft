import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getSeedData, migratePerson } from '../data/seed.js';

const STORAGE_KEY = 'shiftcraft.v3';         // global clinic/people definitions
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
  try { localStorage.setItem(weekStorageKey(weekStr), JSON.stringify(map)); } catch { /* ignore */ }
}

/** Apply a slotMap onto clinics and tasks, returning new arrays */
function applySlotMap(clinics, tasks, map) {
  const newClinics = clinics.map(c => ({
    ...c,
    slots: map[c.id] ?? { scribe: null, opener: null, closing: null, middle: null, training: null },
  }));
  const newTasks = (tasks ?? []).map(t => ({
    ...t,
    assignedPersonId: map[`task:${t.id}`] ?? null,
  }));
  return { clinics: newClinics, additionalTasks: newTasks };
}

function blankSlotMap(clinics, tasks) {
  const map = {};
  for (const c of clinics) map[c.id] = { scribe: null, opener: null, closing: null, middle: null, training: null };
  for (const t of (tasks ?? [])) map[`task:${t.id}`] = null;
  return map;
}

// ─── Migration ────────────────────────────────
function migrateData(raw) {
  return {
    ...raw,
    people: (raw.people ?? []).map(migratePerson),
    additionalTasks: raw.additionalTasks ?? getSeedData().additionalTasks,
    taskTypes: raw.taskTypes ?? getSeedData().taskTypes,
  };
}

// ─── Load global data ─────────────────────────
function loadGlobal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return migrateData(JSON.parse(raw));
  } catch { /* ignore */ }
  return getSeedData();
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
      slots: { scribe: null, opener: null, closing: null, middle: null, training: null },
    }));
    const definitionTasks = additionalTasks.map(({ assignedPersonId, ...t }) => ({
      ...t, assignedPersonId: null,
    }));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ...rest, clinics: definitionClinics, additionalTasks: definitionTasks,
      }));
    } catch { /* ignore */ }
  }, [globalData]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('shiftcraft.theme', theme);
  }, [theme]);

  useEffect(() => {
    saveChangelog(changelog);
  }, [changelog]);

  const addLog = useCallback((entry) => {
    setChangelog(prev => [{ ...entry, timestamp: Date.now() }, ...prev]);
  }, []);

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
    const allSlots = globalData.clinics.flatMap(c => Object.values(c.slots));
    const allTasks = globalData.additionalTasks.map(t => t.assignedPersonId);
    return [...allSlots, ...allTasks].every(v => v == null);
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
        return { ...c, slots: { ...c.slots, [slotType]: personId } };
      });
      const map = extractSlotMap(clinics, prev.additionalTasks);
      saveWeekSlotMap(currentWeek, map);

      // Change log
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
      return { ...prev, additionalTasks, taskTypes };
    });
  }, []);

  const removeTask = useCallback((taskId) => {
    setGlobalData(prev => ({
      ...prev,
      additionalTasks: (prev.additionalTasks ?? []).filter(t => t.id !== taskId),
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
              if (val[slot] === personId) { val[slot] = null; changed = true; }
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
          Object.entries(c.slots).map(([k, v]) => [k, v === personId ? null : v])
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
      isAdmin, setIsAdmin,
      theme, setTheme,
      currentWeek, weekLabel,
      navigateWeek, weekIsEmpty, copyFromPreviousWeek,
      updateClinic, assignSlot,
      assignTask, addTask, removeTask,
      updatePerson, addPerson, deletePerson,
      addClinic, removeClinic, addLocation, removeLocation,
      changelog, clearChangelog, addLog,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);
