import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { getSeedData, migratePerson, generateId, getSlotPersonId, OBS_SLOT_TYPES, getBoardClinics, getAssignmentsForPerson } from '../data/seed.js';
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
    slots: c.location === 'OBS'
      ? { ...blankObsSlots(),      ...(map[c.id] ?? {}) }
      : { ...blankStandardSlots(), ...(map[c.id] ?? {}) },
  }));
  const newTasks = (tasks ?? []).map(t => ({
    ...t,
    assignedPersonId: map[`task:${t.id}`] ?? null,
  }));
  return { clinics: newClinics, additionalTasks: newTasks };
}

function blankObsSlots() {
  return {
    preop: { personId: null, start: null, end: null },
    sterile: { personId: null, start: null, end: null },
    circulator: { personId: null, start: null, end: null },
    scrub: { personId: null, start: null, end: null },
  };
}

function blankStandardSlots() {
  return {
    openingFrontDesk: null, closingFrontDesk: null, frontDesk: null,
    scribe: { personId: null, start: null, end: null },
    opener: null, closing: null,
    middle: { personId: null, start: null, end: null },
    training: { personId: null, start: null, end: null },
  };
}

function blankSlotMap(clinics, tasks) {
  const map = {};
  for (const c of clinics) map[c.id] = c.location === 'OBS' ? blankObsSlots() : blankStandardSlots();
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
      // OBS clinics have their own slot shape — don't apply standard slot migration
      if (c.location === 'OBS') return rest;
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
        slots: blankObsSlots(),
      }];
    }
    if (!clinics.some(c => c.location === 'OBS' && c.day === 'Fri')) {
      clinics = [...clinics, {
        id: 'fri-obs', day: 'Fri', week: 'A', location: 'OBS', provider: '',
        open: true, startTime: 480, endTime: 1020, patientCount: null,
        slots: blankObsSlots(),
      }];
    }
    d = { ...d, locations, clinics };
    try { localStorage.setItem('shiftcraft.migration.obs', '1'); } catch { /* ignore */ }
    dirty = true;
  }

  // ── Migration: obsslots ──────────────────────
  // Convert OBS clinics that previously used standard slot types to OBS slot types.
  if (!localStorage.getItem('shiftcraft.migration.obsslots')) {
    d = {
      ...d,
      clinics: d.clinics.map(c => {
        if (c.location !== 'OBS') return c;
        return { ...c, slots: blankObsSlots() };
      }),
    };
    try { localStorage.setItem('shiftcraft.migration.obsslots', '1'); } catch { /* ignore */ }
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

  // ── Migration: providerconfig ─────────────────
  // Upgrade providers from plain string array to object array with slot rules.
  if (!localStorage.getItem('shiftcraft.migration.providerconfig')) {
    if (Array.isArray(d.providers) && d.providers.length > 0 && typeof d.providers[0] === 'string') {
      const PROVIDER_RULES = {
        'Dr. B': { requiredSlots: ['scribe', 'opener'],            conditionalSlots: [{ slot: 'closing', if: 'patientCount > 17' }] },
      };
      const DEFAULT_RULES  = { requiredSlots: ['scribe', 'opener', 'closing'], conditionalSlots: [{ slot: 'middle', if: 'patientCount > 70' }] };
      d = {
        ...d,
        providers: d.providers.map(name => ({
          name,
          ...(PROVIDER_RULES[name] ?? DEFAULT_RULES),
        })),
      };
      dirty = true;
    }
    try { localStorage.setItem('shiftcraft.migration.providerconfig', '1'); } catch { /* ignore */ }
  }

  // ── Migration: lockedto_v2 ────────────────────
  // Upgrade known seed people from plain string lockedTo entries to {provider,slot} objects.
  // String entries for user-added people are left as-is (adapter handles both formats).
  if (!localStorage.getItem('shiftcraft.migration.lockedto_v2')) {
    const LOCKED_UPGRADES = {
      'yadi': [{ provider: 'Dr. B', slot: 'scribe' }],
    };
    let changed = false;
    d = {
      ...d,
      people: d.people.map(p => {
        if (!LOCKED_UPGRADES[p.id]) return p;
        changed = true;
        return { ...p, lockedTo: LOCKED_UPGRADES[p.id] };
      }),
    };
    if (changed) dirty = true;
    try { localStorage.setItem('shiftcraft.migration.lockedto_v2', '1'); } catch { /* ignore */ }
  }

  // ── Migration: yadi_roles_v1 ──────────────────
  // Yadi's roles stripped to ['Opener'] — Scribe removed so she's not consumed
  // as a free-candidacy scribe at non-Dr-B clinics. MUST_PAIR handles her Dr. B scribe slot.
  if (!localStorage.getItem('shiftcraft.migration.yadi_roles_v1')) {
    d = {
      ...d,
      people: d.people.map(p =>
        p.id === 'yadi' ? { ...p, roles: ['Opener'] } : p
      ),
    };
    dirty = true;
    try { localStorage.setItem('shiftcraft.migration.yadi_roles_v1', '1'); } catch { /* ignore */ }
  }

  // ── Migration: drb_config_v1 ──────────────────
  // Force Dr. B provider config to correct slot rules in Supabase.
  // An earlier migration run may have applied DEFAULT_RULES (with closing in requiredSlots
  // and middle conditional) to Dr. B before the per-provider overrides were added.
  if (!localStorage.getItem('shiftcraft.migration.drb_config_v1')) {
    d = {
      ...d,
      providers: (d.providers ?? []).map(p =>
        p.name === 'Dr. B'
          ? { ...p, requiredSlots: ['scribe', 'opener'], conditionalSlots: [{ slot: 'closing', if: 'patientCount > 17' }] }
          : p
      ),
    };
    dirty = true;
    try { localStorage.setItem('shiftcraft.migration.drb_config_v1', '1'); } catch { /* ignore */ }
  }

  // ── Migration: frontdesksingle ────────────────
  // Replace old openingFD/closingFD keys with openingFrontDesk/closingFrontDesk,
  // and add frontDesk slot to all non-OBS clinics.
  if (!localStorage.getItem('shiftcraft.migration.frontdesksingle')) {
    d = {
      ...d,
      clinics: d.clinics.map(c => {
        if (c.location === 'OBS') return c;
        const { openingFD: oFD, closingFD: cFD, ...rest } = c.slots ?? {};
        const slots = {
          openingFrontDesk: rest.openingFrontDesk ?? oFD ?? null,
          closingFrontDesk: rest.closingFrontDesk ?? cFD ?? null,
          frontDesk:        rest.frontDesk ?? null,
          ...rest,
        };
        // Remove legacy keys if they snuck into rest
        delete slots.openingFD;
        delete slots.closingFD;
        return { ...c, slots };
      }),
    };
    dirty = true;
    try { localStorage.setItem('shiftcraft.migration.frontdesksingle', '1'); } catch { /* ignore */ }
  }

  // ── Migration: tasktypes_research ────────────────
  // Add 'Research' to the built-in task type list.
  if (!localStorage.getItem('shiftcraft.migration.tasktypes_research')) {
    if (Array.isArray(d.taskTypes) && !d.taskTypes.includes('Research')) {
      d = { ...d, taskTypes: [...d.taskTypes, 'Research'] };
      dirty = true;
    }
    try { localStorage.setItem('shiftcraft.migration.tasktypes_research', '1'); } catch { /* ignore */ }
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
    slots: def.location === 'OBS' ? blankObsSlots() : blankStandardSlots(),
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
  // Session-scoped initials for the active manager. Cleared on exit; never persisted.
  const [managerInitials, setManagerInitials] = useState(null);
  const [lastSaved, setLastSaved] = useState(null);

  // null = no error; string = error message blocking the UI
  const [loadError, setLoadError] = useState(null);

  // 'idle' | 'saving' | 'saved' | 'error'
  const [saveStatus, setSaveStatus] = useState('idle');
  const saveStatusTimerRef = useRef(null);

  // null until loaded from Supabase
  const [globalData, setGlobalData] = useState(null);

  // ─── Verified save helper ─────────────────────
  // Awaits the Supabase write, retries once on failure, updates save indicator.
  // Returns true on success, false if both attempts fail.
  const doSaveWeek = useCallback(async (weekStr, map) => {
    setSaveStatus('saving');
    let result = await saveWeekSlotMapDB(weekStr, map);
    if (result.error) {
      // Retry once after a brief pause
      await new Promise(r => setTimeout(r, 1200));
      result = await saveWeekSlotMapDB(weekStr, map);
    }
    if (result.error) {
      setSaveStatus('error');
      return false;
    }
    setLastSaved(Date.now());
    setSaveStatus('saved');
    clearTimeout(saveStatusTimerRef.current);
    saveStatusTimerRef.current = setTimeout(() => setSaveStatus('idle'), 3000);
    return true;
  }, []);

  // ─── Initial load from Supabase ─────────────
  useEffect(() => {
    let cancelled = false;

    async function init() {
      // 1. Load global definitions
      const schedResult = await loadScheduleDB();

      if (schedResult.status === 'error') {
        if (cancelled) return;
        setLoadError('Could not load schedule. Check your connection and refresh. Do not make changes until this resolves.');
        setIsLoading(false);
        return;
      }

      let data;
      if (schedResult.status === 'ok') {
        // Cloud has real data — use it. Never fall through to localStorage.
        data = schedResult.data;
      } else {
        // status === 'empty': row genuinely does not exist in Supabase.
        // Safe to seed from localStorage migration or factory defaults.
        const localRaw = localStorage.getItem(STORAGE_KEY)
          ?? localStorage.getItem('shiftcraft.v4')
          ?? localStorage.getItem('shiftcraft.v3');
        if (localRaw) {
          try { data = migrateData(JSON.parse(localRaw)); } catch { data = null; }
        }
        if (!data) data = getSeedData();
        // First-time seed: fire-and-forget is acceptable (no existing cloud data to overwrite)
        saveScheduleDB(toDefinitionData(data));
      }

      data = runMigrations(data);

      // 2. Load this week's slot assignments
      const weekResult = await loadWeekSlotMapDB(nowWeek);

      if (weekResult.status === 'error') {
        // CRITICAL: do NOT write anything to Supabase when we cannot confirm the row is absent.
        // A transient network/timeout error returns null the same as "no row" in the old code,
        // which caused blank data to overwrite a full week of assignments.
        if (cancelled) return;
        setLoadError('Could not load schedule. Check your connection and refresh. Do not make changes until this resolves.');
        setIsLoading(false);
        return;
      }

      let weekMap;
      if (weekResult.status === 'ok') {
        // Cloud has real slot data — use it. Never overwrite with localStorage.
        weekMap = weekResult.data;
      } else {
        // status === 'empty': row genuinely does not exist — safe to seed
        const localMap = readLocalWeekSlotMap(nowWeek);
        if (localMap) {
          // Migrate localStorage data up to Supabase (only when cloud has no row)
          weekMap = localMap;
          saveWeekSlotMapDB(nowWeek, localMap);
        } else {
          // Brand-new week: seed a blank map
          weekMap = blankSlotMap(data.clinics, data.additionalTasks);
          saveWeekSlotMapDB(nowWeek, weekMap);
        }
      }

      // 3. Shadow clinic cleanup — DISABLED
      // Previously blanked slot assignments on "shadow" clinics (duplicate location:day entries).
      // Disabled because it ran on new devices/browsers and risked blanking valid data until
      // the deduplication logic can be fully verified against production clinic configurations.
      // Just set the flag so it never runs on any device.
      if (!localStorage.getItem('shiftcraft.migration.clearshadowslots')) {
        try { localStorage.setItem('shiftcraft.migration.clearshadowslots', '1'); } catch { /* ignore */ }
      }

      const applied = applySlotMap(data.clinics, data.additionalTasks, weekMap);

      // 4. Load changelog
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
    setChangelog(prev => [{
      ...entry,
      timestamp: Date.now(),
      initials: entry.initials ?? managerInitials ?? undefined,
    }, ...prev]);
  }, [managerInitials]);

  // ─── Week navigation ────────────────────────
  const navigateWeek = useCallback(async (delta) => {
    if (!globalData) return;

    // Save current week before leaving — awaited so navigation never loses in-flight data
    const currentMap = extractSlotMap(globalData.clinics, globalData.additionalTasks);
    await doSaveWeek(currentWeek, currentMap);
    // Proceed even if save failed; the error indicator remains visible to the user.

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

    // Load target week — 3-way result: never write blank data on error
    const weekResult = await loadWeekSlotMapDB(next);
    let map;
    if (weekResult.status === 'ok') {
      map = weekResult.data;
    } else if (weekResult.status === 'empty') {
      const localMap = readLocalWeekSlotMap(next);
      if (localMap) {
        map = localMap;
        saveWeekSlotMapDB(next, localMap); // migrate localStorage → Supabase
      } else {
        map = blankSlotMap(globalData.clinics, globalData.additionalTasks);
        saveWeekSlotMapDB(next, map); // seed blank week (safe: confirmed empty)
      }
    } else {
      // Load error — do not navigate, keep current week, show error
      setSaveStatus('error');
      return;
    }

    setCurrentWeek(next);
    setGlobalData(g => {
      const applied = applySlotMap(g.clinics, g.additionalTasks, map);
      return { ...g, ...applied };
    });
  }, [currentWeek, globalData, doSaveWeek]);

  const jumpToWeek = useCallback(async (targetWeek) => {
    if (!globalData || currentWeek === targetWeek) return;

    const currentMap = extractSlotMap(globalData.clinics, globalData.additionalTasks);
    await doSaveWeek(currentWeek, currentMap);

    const weekResult = await loadWeekSlotMapDB(targetWeek);
    let map;
    if (weekResult.status === 'ok') {
      map = weekResult.data;
    } else if (weekResult.status === 'empty') {
      const localMap = readLocalWeekSlotMap(targetWeek);
      if (localMap) {
        map = localMap;
        saveWeekSlotMapDB(targetWeek, localMap);
      } else {
        map = blankSlotMap(globalData.clinics, globalData.additionalTasks);
        saveWeekSlotMapDB(targetWeek, map);
      }
    } else {
      setSaveStatus('error');
      return;
    }

    setCurrentWeek(targetWeek);
    setGlobalData(g => {
      const applied = applySlotMap(g.clinics, g.additionalTasks, map);
      return { ...g, ...applied };
    });
  }, [currentWeek, globalData, doSaveWeek]);

  const weekIsEmpty = useCallback(() => {
    if (!globalData) return true;
    const allSlotPersonIds = globalData.clinics.flatMap(c => Object.values(c.slots).map(sv => getSlotPersonId(sv)));
    const allTasks = globalData.additionalTasks.map(t => t.assignedPersonId);
    return [...allSlotPersonIds, ...allTasks].every(v => v == null);
  }, [globalData]);

  const copyFromTwoWeeksAgo = useCallback(async () => {
    if (!globalData) return null;
    const monday = mondayOfWeek(currentWeek);
    monday.setUTCDate(monday.getUTCDate() - 14);
    const prevWeek = isoWeek(monday);

    const prevResult = await loadWeekSlotMapDB(prevWeek);
    let prevMap;
    if (prevResult.status === 'ok') {
      prevMap = prevResult.data;
    } else if (prevResult.status === 'empty') {
      prevMap = readLocalWeekSlotMap(prevWeek);
    } else {
      return null; // load error — do nothing
    }
    if (!prevMap) return null;

    await doSaveWeek(currentWeek, prevMap);
    setGlobalData(g => {
      const applied = applySlotMap(g.clinics, g.additionalTasks, prevMap);
      return { ...g, ...applied };
    });
    return mondayOfWeek(prevWeek);
  }, [currentWeek, globalData, doSaveWeek]);

  // ─── Week import (from backup file) ────────
  // Saves the provided slotMap to Supabase for the target week,
  // then navigates to that week so the restored data is visible.
  const importWeekData = useCallback(async (weekStr, slotMap) => {
    // Save imported map to Supabase first
    const ok = await doSaveWeek(weekStr, slotMap);
    if (!ok) return false;

    if (weekStr === currentWeek) {
      // Already viewing this week — apply to local state immediately
      setGlobalData(g => {
        if (!g) return g;
        const applied = applySlotMap(g.clinics, g.additionalTasks, slotMap);
        return { ...g, ...applied };
      });
    } else {
      // Viewing a different week — save it first, then switch
      if (globalData) {
        const currentMap = extractSlotMap(globalData.clinics, globalData.additionalTasks);
        await doSaveWeek(currentWeek, currentMap);
      }
      setCurrentWeek(weekStr);
      setGlobalData(g => {
        if (!g) return g;
        const applied = applySlotMap(g.clinics, g.additionalTasks, slotMap);
        return { ...g, ...applied };
      });
    }
    return true;
  }, [currentWeek, globalData, doSaveWeek]);

  const clearWeek = useCallback(async () => {
    if (!globalData) return;
    const clinics = globalData.clinics.map(c => ({
      ...c,
      slots: c.location === 'OBS' ? blankObsSlots() : blankStandardSlots(),
    }));
    const additionalTasks = (globalData.additionalTasks ?? []).map(t => ({ ...t, assignedPersonId: null }));
    const map = extractSlotMap(clinics, additionalTasks);
    setGlobalData(prev => ({ ...prev, clinics, additionalTasks }));
    await doSaveWeek(currentWeek, map);
  }, [currentWeek, globalData, doSaveWeek]);

  // ─── Clinic mutations ───────────────────────
  const updateClinic = useCallback(async (clinicId, changes) => {
    if (!globalData) return;
    const clinics = globalData.clinics.map(c => c.id === clinicId ? { ...c, ...changes } : c);
    const map = extractSlotMap(clinics, globalData.additionalTasks);
    setGlobalData(prev => ({ ...prev, clinics }));
    await doSaveWeek(currentWeek, map);
  }, [currentWeek, globalData, doSaveWeek]);

  const assignSlot = useCallback(async (clinicId, slotType, personId) => {
    if (!globalData) return;

    const targetClinic = globalData.clinics.find(c => c.id === clinicId);
    if (!targetClinic) return;
    const isObsAssignment = targetClinic.location?.toLowerCase() === 'obs';

    let clinics = globalData.clinics;
    const logEntries = [];
    const person = personId ? globalData.people.find(p => p.id === personId) : null;

    // OBS precedence: when assigning someone TO an OBS slot, auto-remove any existing
    // same-day non-OBS assignments for that person and write a changelog entry.
    // Uses name-based canonical identity — checks all same-name records, not just this ID.
    if (isObsAssignment && personId) {
      const personName = person?.name?.trim().toLowerCase() ?? '';
      const samePersonIds = new Set(
        (globalData.people ?? [])
          .filter(q => q.name.trim().toLowerCase() === personName)
          .map(q => q.id)
      );
      clinics = clinics.map(c => {
        if (c.location?.toLowerCase() === 'obs') return c; // keep OBS clinics as-is
        if (c.day !== targetClinic.day || !c.open) return c;
        // Remove any same-name record from every slot in same-day non-OBS clinics
        const newSlots = { ...c.slots };
        let changed = false;
        for (const [st, sv] of Object.entries(newSlots)) {
          if (!samePersonIds.has(getSlotPersonId(sv))) continue;
          if (typeof sv === 'object' && sv !== null) {
            newSlots[st] = { ...sv, personId: null };
          } else {
            newSlots[st] = null;
          }
          changed = true;
          logEntries.push({
            timestamp: Date.now(),
            action: `Removed ${person?.name ?? personId} from ${st} @ ${c.location} — OBS precedence`,
            personName: person?.name ?? '—',
            day: c.day,
            detail: '',
          });
        }
        return changed ? { ...c, slots: newSlots } : c;
      });
    }

    // Apply the intended assignment
    clinics = clinics.map(c => {
      if (c.id !== clinicId) return c;
      const existing = c.slots[slotType];
      const times = (existing && typeof existing === 'object')
        ? { start: existing.start, end: existing.end }
        : { start: null, end: null };
      return { ...c, slots: { ...c.slots, [slotType]: { personId: personId ?? null, ...times } } };
    });

    const map = extractSlotMap(clinics, globalData.additionalTasks);
    setGlobalData(prev => ({ ...prev, clinics }));

    // Log auto-removals first, then the actual assignment
    const mainAction = personId
      ? `${person?.name} assigned to ${slotType} @ ${targetClinic.location} (${targetClinic.provider}) on ${targetClinic.day}`
      : `Slot removed: ${slotType} @ ${targetClinic.location} (${targetClinic.provider}) on ${targetClinic.day}`;
    const allEntries = [
      ...logEntries.map(e => ({ ...e, initials: e.initials ?? managerInitials ?? undefined })),
      { timestamp: Date.now(), action: mainAction, personName: person?.name ?? '—', day: targetClinic.day, detail: '', initials: managerInitials ?? undefined },
    ];
    setChangelog(log => [...allEntries, ...log].slice(0, 500));

    await doSaveWeek(currentWeek, map);
  }, [currentWeek, globalData, doSaveWeek, managerInitials]);

  const updateSlotTime = useCallback(async (clinicId, slotType, start, end) => {
    if (!globalData) return;
    const clinics = globalData.clinics.map(c => {
      if (c.id !== clinicId) return c;
      const existing = c.slots[slotType];
      const personId = (existing && typeof existing === 'object')
        ? existing.personId
        : (typeof existing === 'string' ? existing : null);
      return { ...c, slots: { ...c.slots, [slotType]: { personId, start, end } } };
    });
    const map = extractSlotMap(clinics, globalData.additionalTasks);
    setGlobalData(prev => ({ ...prev, clinics }));
    await doSaveWeek(currentWeek, map);
  }, [currentWeek, globalData, doSaveWeek]);

  const assignTask = useCallback(async (taskId, personId) => {
    if (!globalData) return;
    const additionalTasks = globalData.additionalTasks.map(t =>
      t.id === taskId ? { ...t, assignedPersonId: personId } : t
    );
    const map = extractSlotMap(globalData.clinics, additionalTasks);
    setGlobalData(prev => ({ ...prev, additionalTasks }));

    const task = additionalTasks.find(t => t.id === taskId);
    const person = personId ? globalData.people.find(p => p.id === personId) : null;
    if (task) {
      const action = personId
        ? `${person?.name} assigned to ${task.label}${task.locationTag ? ` (${task.locationTag})` : ''} on ${task.day}`
        : `${task.label} unassigned on ${task.day}`;
      setChangelog(log => [{
        timestamp: Date.now(), action,
        personName: person?.name ?? '—', day: task.day, detail: '',
        initials: managerInitials ?? undefined,
      }, ...log].slice(0, 500));
    }

    await doSaveWeek(currentWeek, map);
  }, [currentWeek, globalData, doSaveWeek, managerInitials]);

  const addTask = useCallback(async (task) => {
    if (!globalData) return;
    const additionalTasks = [...(globalData.additionalTasks ?? []), task];
    const taskTypes = globalData.taskTypes.includes(task.label)
      ? globalData.taskTypes
      : [...globalData.taskTypes, task.label];
    const map = extractSlotMap(globalData.clinics, additionalTasks);
    setGlobalData(prev => ({ ...prev, additionalTasks, taskTypes }));
    await doSaveWeek(currentWeek, map);
  }, [currentWeek, globalData, doSaveWeek]);

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

  const applyBulkAssignments = useCallback(async (assignments, { clearFirst = false } = {}) => {
    if (!globalData) return;
    let clinics = globalData.clinics;
    if (clearFirst) {
      clinics = clinics.map(c =>
        c.open
          ? { ...c, slots: c.location === 'OBS' ? blankObsSlots() : blankStandardSlots() }
          : c
      );
    }
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
    const map = extractSlotMap(clinics, globalData.additionalTasks);
    setGlobalData(prev => ({ ...prev, clinics }));
    await doSaveWeek(currentWeek, map);
  }, [currentWeek, globalData, doSaveWeek]);

  const restoreClinicSlots = useCallback(async (slotSnapshot) => {
    if (!globalData) return;
    const clinics = globalData.clinics.map(c => ({
      ...c,
      slots: slotSnapshot[c.id] ?? c.slots,
    }));
    const map = extractSlotMap(clinics, globalData.additionalTasks);
    setGlobalData(prev => ({ ...prev, clinics }));
    await doSaveWeek(currentWeek, map);
  }, [currentWeek, globalData, doSaveWeek]);

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
      loadError,
      saveStatus,
      lastSaved,
      isAdmin, setIsAdmin,
      managerInitials, setManagerInitials,
      theme, setTheme,
      currentWeek, weekLabel,
      navigateWeek, jumpToWeek, weekIsEmpty, copyFromTwoWeeksAgo, clearWeek, importWeekData,
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
