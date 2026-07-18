import { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getSeedData, migratePerson, generateId, getSlotPersonId, OBS_SLOT_TYPES, getBoardClinics, getAssignmentsForPerson, getRenderedSlotEntries, getActiveFDSlots, minutesToTime, SLOT_DISPLAY_LABELS } from '../data/seed.js';
import { supabase } from '../supabase.js';
import {
  saveSchedule as saveScheduleDB,
  loadSchedule as loadScheduleDB,
  saveWeekSlotMap as saveWeekSlotMapDB,
  loadWeekSlotMap as loadWeekSlotMapDB,
  deleteWeekSlotMap as deleteWeekSlotMapDB,
  saveChangelog as saveChangelogDB,
  loadChangelog as loadChangelogDB,
  loadPlacementHistory as loadPlacementHistoryDB,
  savePlacementHistory as savePlacementHistoryDB,
  loadDismissedPatterns as loadDismissedPatternsDB,
  saveDismissedPatterns as saveDismissedPatternsDB,
  fetchLatestPostedSnapshot as fetchLatestPostedSnapshotDB,
  savePostedSnapshot as savePostedSnapshotDB,
  weekKey,
  SCHEDULE_KEY,
  CHANGELOG_KEY,
} from '../services/dataService.js';
import { computeHistoryScores } from '../data/patterns.js';

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

/** Default landing week per clinic rollover rule (America/Phoenix, always UTC-7):
 *  Mon 00:00 – Fri 16:59  → current ISO week
 *  Fri 17:00 – Sun 23:59  → the following ISO week
 */
export function defaultLandingWeek() {
  // Shift UTC to Phoenix local time using UTC methods so device timezone is irrelevant.
  const PHOENIX_OFFSET_MS = -7 * 60 * 60 * 1000; // UTC-7, no DST
  const px = new Date(Date.now() + PHOENIX_OFFSET_MS);
  const dow  = px.getUTCDay();    // 0=Sun … 6=Sat  (Phoenix local)
  const hour = px.getUTCHours();  // 0–23             (Phoenix local)

  // Roll forward to next Monday when: Fri ≥ 17:00, Saturday, or Sunday
  const rollover = (dow === 5 && hour >= 17) || dow === 6 || dow === 0;
  const daysToMon = rollover ? (dow === 0 ? 1 : 8 - dow) : 0;

  // Compute ISO week entirely from UTC values — do NOT call isoWeek() here.
  // isoWeek() reads the Date using local-timezone methods (.getFullYear etc.), which
  // gives the wrong calendar date on any device not at UTC+0 (e.g. UTC-7 Phoenix:
  // Date.UTC(2026,6,20) local-reads as Jul 19, landing on the prior week).
  const target = new Date(px.getTime() + daysToMon * 86400000);
  const y = target.getUTCFullYear(), m = target.getUTCMonth(), d = target.getUTCDate();
  const thursday = new Date(Date.UTC(y, m, d));
  const utcDow = thursday.getUTCDay() || 7;          // 1=Mon … 7=Sun
  thursday.setUTCDate(d + 4 - utcDow);               // shift to Thursday of ISO week
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
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
  const newClinics = clinics.map(c => {
    if (c.location === 'OBS') {
      // Merge with blank OBS shape, then strip any non-OBS keys that leaked in from
      // stale Supabase data (e.g. a prior bad generation that wrote 'frontDesk' to OBS).
      const merged = { ...blankObsSlots(), ...(map[c.id] ?? {}) };
      const invalidKeys = Object.keys(merged).filter(k => !OBS_SLOT_TYPES.includes(k));
      if (invalidKeys.length > 0) {
        console.warn(`[Shiftcraft applySlotMap] OBS clinic ${c.id}: stripping invalid slot keys:`, invalidKeys);
        for (const k of invalidKeys) delete merged[k];
      }
      return { ...c, slots: merged };
    }
    // Merge with blank standard shape, then clear personIds in inactive FD slots.
    // Inactive FD slots on Dr. R Mon/Fri: 'frontDesk' is dead; only
    // openingFrontDesk/closingFrontDesk are rendered. Stale Supabase data
    // can leave a personId in the inactive slot, causing phantom "already assigned"
    // in every popover and conflict banner on that day. Clearing here makes the
    // fix universal: every week load cleans itself regardless of init() startup week.
    const merged = { ...blankStandardSlots(), ...(map[c.id] ?? {}) };
    const activeFD = new Set(getActiveFDSlots(c));
    const ALL_FD = ['openingFrontDesk', 'closingFrontDesk', 'frontDesk'];
    for (const fdKey of ALL_FD) {
      if (!activeFD.has(fdKey) && merged[fdKey]) {
        console.warn(`[Shiftcraft applySlotMap] Regular clinic ${c.id} (${c.provider} ${c.day}): clearing stale inactive FD slot "${fdKey}"`);
        merged[fdKey] = null;
      }
    }
    return { ...c, slots: merged };
  });
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

// ─── Snapshot helpers (module-level, usable in init()) ────────────────────
// Canonical slot map string with stable key order for dirty-state comparison.
// Postgres JSONB may return keys in a different order than we wrote them.
function sortedJSON(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return JSON.stringify(obj);
  const keys = Object.keys(obj).sort();
  const inner = keys.map(k => `${JSON.stringify(k)}:${sortedJSON(obj[k])}`).join(',');
  return `{${inner}}`;
}

function hasAnyAssignment(map) {
  for (const [key, val] of Object.entries(map)) {
    if (key.startsWith('task:')) { if (val) return true; continue; }
    if (!val) continue;
    if (typeof val === 'string') return true;
    if (typeof val === 'object') {
      for (const sv of Object.values(val)) {
        if (getSlotPersonId(sv)) return true;
      }
    }
  }
  return false;
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
  const nowWeek = defaultLandingWeek();
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

  // ─── Placement history & patterns ────────────
  const [placementHistory, setPlacementHistory] = useState([]);
  const [dismissedPatterns, setDismissedPatterns] = useState([]);
  // Stable ref so appendHistory doesn't need placementHistory in its deps.
  const historyRef = useRef([]);

  // ─── Posted snapshots ────────────────────────
  // { [weekStr]: { id, snapshot, posted_at, posted_by } | null }
  // undefined = not yet fetched; null = fetched, never posted
  const [postedSnapshots, setPostedSnapshots] = useState({});
  // Session-scoped: weeks that have assignments newer than their last post
  const [dirtyWeeks, setDirtyWeeks] = useState(() => new Set());

  // ─── Realtime & concurrency ────────────────
  // Per-week version loaded from DB — used for conditional (optimistic) saves.
  const weekVersionRef = useRef({}); // { [weekStr]: number | null }
  // Channel ref so presence can be tracked after manager logs in/out.
  const rtChannelRef = useRef(null);
  // Stable ref for manager initials — avoids stale closure in Realtime handler.
  const managerInitialsRef = useRef(null);
  // Guard: skip the changelog save useEffect when the update came from Realtime.
  const changelogFromRemoteRef = useRef(false);
  // Presence: other managers currently viewing this week.
  const [presentManagers, setPresentManagers] = useState([]);
  // Conflict toast: shown when a save is rejected due to a version mismatch.
  const [conflictToast, setConflictToast] = useState(null);
  const conflictToastTimerRef = useRef(null);

  // ─── Verified save helper ─────────────────────
  // Versioned conditional save via upsert_schedule_data RPC.
  // On conflict (another manager saved between our load and this save):
  //   - fetches latest, applies to local state, shows conflict toast
  //   - returns false (caller's pending change is lost — user must redo)
  // On network error: retries once, then gives up.
  // Returns true on success, false on conflict or permanent error.
  const doSaveWeek = useCallback(async (weekStr, map) => {
    setSaveStatus('saving');

    const trySave = () =>
      saveWeekSlotMapDB(weekStr, map, weekVersionRef.current[weekStr] ?? null);

    let result = await trySave();

    if (result.error) {
      // Retry once on transient network error (same version — safe if first write failed)
      await new Promise(r => setTimeout(r, 1200));
      result = await trySave();
    }

    if (result.error) {
      setSaveStatus('error');
      return false;
    }

    if (result.conflict) {
      // Version mismatch: another manager wrote ahead of us.
      // Fetch latest, apply to state so the board shows current truth.
      const latest = await loadWeekSlotMapDB(weekStr);
      if (latest.status === 'ok') {
        weekVersionRef.current[weekStr] = latest.version ?? null;
        setGlobalData(g => {
          if (!g) return g;
          const applied = applySlotMap(g.clinics, g.additionalTasks, latest.data);
          return { ...g, ...applied };
        });
      }
      setSaveStatus('error');
      clearTimeout(conflictToastTimerRef.current);
      setConflictToast('Schedule updated by another manager — board refreshed');
      conflictToastTimerRef.current = setTimeout(() => setConflictToast(null), 7000);
      return false;
    }

    weekVersionRef.current[weekStr] = result.newVersion ?? null;
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
        weekVersionRef.current[nowWeek] = weekResult.version ?? null;
      } else {
        // status === 'empty': row genuinely does not exist — safe to seed
        const localMap = readLocalWeekSlotMap(nowWeek);
        if (localMap) {
          // Migrate localStorage data up to Supabase (only when cloud has no row)
          weekMap = localMap;
          const seedResult = await saveWeekSlotMapDB(nowWeek, localMap, null);
          if (!seedResult.conflict) weekVersionRef.current[nowWeek] = seedResult.newVersion ?? null;
        } else {
          // Brand-new week: seed a blank map
          weekMap = blankSlotMap(data.clinics, data.additionalTasks);
          const seedResult = await saveWeekSlotMapDB(nowWeek, weekMap, null);
          if (!seedResult.conflict) weekVersionRef.current[nowWeek] = seedResult.newVersion ?? null;
        }
      }

      // 3. Stale slot cleanup — runs on every load (idempotent, cheap).
      // Removes two kinds of invalid data from the Supabase week map:
      //   a) Non-OBS slot keys on OBS clinics (e.g. 'frontDesk' written by a bad generation run)
      //   b) Personid in inactive FD slots (e.g. plain 'frontDesk' on a Dr. R Mon/Fri clinic,
      //      where the card renders openingFrontDesk/closingFrontDesk instead)
      // applySlotMap already strips these from in-memory state, but the Supabase row must also
      // be cleaned so other clients load clean data and don't get phantom "already assigned" flags.
      const staleRemovals = [];  // { action, personName, day }
      {
        const clinicById = new Map(data.clinics.map(c => [c.id, c]));
        const personById = new Map((data.people ?? []).map(p => [p.id, p]));
        const ALL_FD = new Set(['openingFrontDesk', 'closingFrontDesk', 'frontDesk']);
        let weekMapDirty = false;
        const cleanedWeekMap = { ...weekMap };

        for (const [clinicId, slots] of Object.entries(cleanedWeekMap)) {
          if (clinicId.startsWith('task:')) continue;
          if (!slots || typeof slots !== 'object') continue;
          const clinic = clinicById.get(clinicId);
          if (!clinic) continue;

          const isObs = clinic.location?.toLowerCase() === 'obs';
          const activeFD = isObs ? null : new Set(getActiveFDSlots(clinic));
          const cleanSlots = { ...slots };
          let clinicDirty = false;

          for (const [slotKey, slotVal] of Object.entries(slots)) {
            const pid = getSlotPersonId(slotVal);
            let stale = false;
            if (isObs && !OBS_SLOT_TYPES.includes(slotKey)) {
              stale = true;  // non-OBS slot key on OBS clinic
            } else if (!isObs && ALL_FD.has(slotKey) && !activeFD.has(slotKey)) {
              stale = true;  // inactive FD slot
            }
            if (stale) {
              if (pid) {
                const personName = personById.get(pid)?.name ?? pid;
                const msg = `Removed stale hidden assignment: ${personName} from ${slotKey} @ ${clinic.location} ${clinic.day}`;
                console.warn(`[Shiftcraft init] ${msg}`);
                staleRemovals.push({ action: msg, personName, day: clinic.day });
              }
              // Clear the slot value (preserve shape for OBS object slots)
              cleanSlots[slotKey] = (typeof slotVal === 'object' && slotVal !== null)
                ? { ...slotVal, personId: null }
                : null;
              clinicDirty = true;
            }
          }

          if (clinicDirty) {
            cleanedWeekMap[clinicId] = cleanSlots;
            weekMapDirty = true;
          }
        }

        if (weekMapDirty) {
          weekMap = cleanedWeekMap;
          saveWeekSlotMapDB(nowWeek, weekMap);
          console.log(`[Shiftcraft init] Cleaned ${staleRemovals.length} stale slot assignment(s) and saved to Supabase`);
        }
      }

      // Shadow clinic cleanup — DISABLED
      // Previously blanked slot assignments on "shadow" clinics (duplicate location:day entries).
      // Disabled because it ran on new devices/browsers and risked blanking valid data until
      // the deduplication logic can be fully verified against production clinic configurations.
      // Just set the flag so it never runs on any device.
      if (!localStorage.getItem('shiftcraft.migration.clearshadowslots')) {
        try { localStorage.setItem('shiftcraft.migration.clearshadowslots', '1'); } catch { /* ignore */ }
      }

      const applied = applySlotMap(data.clinics, data.additionalTasks, weekMap);

      // 5. Load changelog; prepend any stale-data removal entries from the cleanup above
      const cl = await loadChangelogDB();

      if (cancelled) return;

      const removalEntries = staleRemovals.map(r => ({
        timestamp: Date.now(),
        action: r.action,
        personName: r.personName,
        day: r.day,
        detail: '',
      }));
      const initialChangelog = removalEntries.length > 0
        ? [...removalEntries, ...cl].slice(0, 500)
        : cl;
      if (removalEntries.length > 0) {
        saveChangelogDB(initialChangelog);
      }

      setGlobalData({ ...data, ...applied });
      setChangelog(initialChangelog);

      // 6. Load placement history + dismissed patterns (graceful — app works without them)
      const [historyResult, dismissedResult] = await Promise.all([
        loadPlacementHistoryDB(),
        loadDismissedPatternsDB(),
      ]);
      if (!cancelled) {
        if (historyResult.status === 'ok') {
          historyRef.current = historyResult.data ?? [];
          setPlacementHistory(historyResult.data ?? []);
        }
        if (dismissedResult.status === 'ok') {
          setDismissedPatterns(dismissedResult.data ?? []);
        }
      }

      // 7. Load posted snapshot for current week (graceful — app works without it)
      const snapResult = await fetchLatestPostedSnapshotDB(weekKey(nowWeek));
      if (!cancelled) {
        const snapValue = snapResult.status === 'ok' ? snapResult.data : null;
        setPostedSnapshots({ [nowWeek]: snapValue });
        // Dirty check: if week has assignments newer than the snapshot, mark dirty
        const currentMap = extractSlotMap(applied.clinics, applied.additionalTasks ?? []);
        const isEmpty = !hasAnyAssignment(currentMap);
        const snapshotMatches = snapValue && sortedJSON(currentMap) === sortedJSON(snapValue.snapshot);
        if (!isEmpty && !snapshotMatches) {
          setDirtyWeeks(new Set([nowWeek]));
        }
      }

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

  // ─── Keep stable refs in sync ────────────────
  useEffect(() => { managerInitialsRef.current = managerInitials; }, [managerInitials]);

  // ─── Changelog ────────────────────────────────
  useEffect(() => {
    if (isLoading) return;
    // Skip saving when this render was triggered by a Realtime push from another client.
    // Without this guard the save would echo back and trigger a Realtime loop.
    if (changelogFromRemoteRef.current) {
      changelogFromRemoteRef.current = false;
      return;
    }
    saveChangelogDB(changelog.slice(0, 500));
  }, [changelog, isLoading]);

  // ─── Real-time sync ──────────────────────────
  // Per-week channel with Presence + postgres_changes + reconnect handling.
  // Channel is recreated whenever the viewed week changes so Presence is
  // automatically scoped to people looking at the same week.
  useEffect(() => {
    if (isLoading) return;

    const wk = weekKey(currentWeek);
    let wasDisconnected = false;

    const channel = supabase
      .channel(`shiftcraft:week:${currentWeek}`)

      // ── postgres_changes — slot, definition, and changelog updates ──
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'schedule_data',
      }, (payload) => {
        const { key, value, version } = payload.new ?? {};

        if (key === wk) {
          // Echo suppression: if our local version is already ≥ remote version,
          // this is our own broadcast — skip to avoid overwriting in-flight edits.
          const local = weekVersionRef.current[currentWeek];
          if (local !== null && local !== undefined && version !== null && version <= local) return;
          // Apply remote slot update and record the new version.
          weekVersionRef.current[currentWeek] = version ?? null;
          setGlobalData(g => {
            if (!g) return g;
            const applied = applySlotMap(g.clinics, g.additionalTasks, value);
            return { ...g, ...applied };
          });
        } else if (key === SCHEDULE_KEY) {
          setGlobalData(g => {
            if (!g) return g;
            const currentMap = extractSlotMap(g.clinics, g.additionalTasks);
            const applied = applySlotMap(
              value.clinics ?? g.clinics,
              value.additionalTasks ?? g.additionalTasks,
              currentMap,
            );
            return { ...value, ...applied };
          });
        } else if (key === CHANGELOG_KEY) {
          // Merge remote changelog — guard against echo loop in the save useEffect.
          if (Array.isArray(value) && value.length > 0) {
            changelogFromRemoteRef.current = true;
            setChangelog(value.slice(0, 500));
          }
        }
      })

      // ── posted_schedules — live updates when another manager posts ──
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'posted_schedules',
      }, (payload) => {
        const row = payload.new ?? {};
        if (!row.week_key) return;
        // week_key is the full weekKey string (e.g. 'shiftcraft_week_2025-W42')
        const ws = row.week_key.replace('shiftcraft_week_', '');
        const newSnap = { id: row.id, snapshot: row.snapshot, posted_at: row.posted_at, posted_by: row.posted_by };
        setPostedSnapshots(prev => ({ ...prev, [ws]: newSnap }));
        // Clear dirty state for the posted week (banner clears live for all managers)
        setDirtyWeeks(prev => { const next = new Set(prev); next.delete(ws); return next; });
      })

      // ── Presence — who else is viewing this week ──
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const mine = managerInitialsRef.current;
        const others = Object.values(state)
          .flat()
          .map(p => p.initials)
          .filter(i => i && i !== mine);
        setPresentManagers([...new Set(others)]);
      })
      .on('presence', { event: 'join' }, ({ newPresences }) => {
        const mine = managerInitialsRef.current;
        setPresentManagers(prev => {
          const next = new Set(prev);
          for (const p of newPresences) {
            if (p.initials && p.initials !== mine) next.add(p.initials);
          }
          return [...next];
        });
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        const leaving = new Set(leftPresences.map(p => p.initials));
        setPresentManagers(prev => prev.filter(i => !leaving.has(i)));
      })

      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          if (wasDisconnected) {
            // Reconnected after sleep/blip — refetch to catch up on missed changes.
            wasDisconnected = false;
            const r = await loadWeekSlotMapDB(currentWeek);
            if (r.status === 'ok') {
              weekVersionRef.current[currentWeek] = r.version ?? null;
              setGlobalData(g => {
                if (!g) return g;
                const applied = applySlotMap(g.clinics, g.additionalTasks, r.data);
                return { ...g, ...applied };
              });
            }
          }
          // Track presence if manager is already logged in.
          const initials = managerInitialsRef.current;
          if (initials) channel.track({ initials, joinedAt: Date.now() });
        } else if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR' || status === 'CLOSED') {
          wasDisconnected = true;
        }
      });

    rtChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      rtChannelRef.current = null;
      setPresentManagers([]);
    };
  // currentWeek intentionally in deps: recreate channel on week navigation.
  }, [isLoading, currentWeek]);

  // ── Presence tracking — manager login / logout ──
  // Runs when admin status changes while the channel is already subscribed.
  useEffect(() => {
    const ch = rtChannelRef.current;
    if (!ch) return;
    if (isAdmin && managerInitials) {
      ch.track({ initials: managerInitials, joinedAt: Date.now() });
    } else {
      ch.untrack();
    }
  }, [isAdmin, managerInitials]);

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

    // No save here — every individual mutation (assignSlot etc.) already saves immediately
    // to Supabase. Saving again on navigation would produce misleading "✓ Saved" toasts
    // and perform redundant writes. Navigation is strictly read-only.

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
      weekVersionRef.current[next] = weekResult.version ?? null;
    } else if (weekResult.status === 'empty') {
      const localMap = readLocalWeekSlotMap(next);
      if (localMap) {
        map = localMap;
        const sr = await saveWeekSlotMapDB(next, localMap, null);
        if (!sr.conflict) weekVersionRef.current[next] = sr.newVersion ?? null;
      } else {
        map = blankSlotMap(globalData.clinics, globalData.additionalTasks);
        const sr = await saveWeekSlotMapDB(next, map, null);
        if (!sr.conflict) weekVersionRef.current[next] = sr.newVersion ?? null;
      }
    } else {
      // Load error — do not navigate, keep current week, show error
      setSaveStatus('error');
      return;
    }

    // Load snapshot for the new week in parallel with state updates
    const snapResult = await fetchLatestPostedSnapshotDB(weekKey(next));
    const snapValue = snapResult.status === 'ok' ? snapResult.data : null;

    setCurrentWeek(next);
    setGlobalData(g => {
      const applied = applySlotMap(g.clinics, g.additionalTasks, map);
      return { ...g, ...applied };
    });
    setPostedSnapshots(prev => ({ ...prev, [next]: snapValue }));
    // Track dirty state for week picker dots
    if (hasAnyAssignment(map) && !(snapValue && sortedJSON(map) === sortedJSON(snapValue.snapshot))) {
      setDirtyWeeks(prev => new Set([...prev, next]));
    }
  }, [currentWeek, globalData]);

  const jumpToWeek = useCallback(async (targetWeek) => {
    if (!globalData || currentWeek === targetWeek) return;

    // No save here — same reasoning as navigateWeek: each mutation already saves immediately.

    const weekResult = await loadWeekSlotMapDB(targetWeek);
    let map;
    if (weekResult.status === 'ok') {
      map = weekResult.data;
      weekVersionRef.current[targetWeek] = weekResult.version ?? null;
    } else if (weekResult.status === 'empty') {
      const localMap = readLocalWeekSlotMap(targetWeek);
      if (localMap) {
        map = localMap;
        const sr = await saveWeekSlotMapDB(targetWeek, localMap, null);
        if (!sr.conflict) weekVersionRef.current[targetWeek] = sr.newVersion ?? null;
      } else {
        map = blankSlotMap(globalData.clinics, globalData.additionalTasks);
        const sr = await saveWeekSlotMapDB(targetWeek, map, null);
        if (!sr.conflict) weekVersionRef.current[targetWeek] = sr.newVersion ?? null;
      }
    } else {
      setSaveStatus('error');
      return;
    }

    const snapResult2 = await fetchLatestPostedSnapshotDB(weekKey(targetWeek));
    const snapValue2 = snapResult2.status === 'ok' ? snapResult2.data : null;

    setCurrentWeek(targetWeek);
    setGlobalData(g => {
      const applied = applySlotMap(g.clinics, g.additionalTasks, map);
      return { ...g, ...applied };
    });
    setPostedSnapshots(prev => ({ ...prev, [targetWeek]: snapValue2 }));
    if (hasAnyAssignment(map) && !(snapValue2 && sortedJSON(map) === sortedJSON(snapValue2.snapshot))) {
      setDirtyWeeks(prev => new Set([...prev, targetWeek]));
    }
  }, [currentWeek, globalData]);

  const weekIsEmpty = useCallback(() => {
    if (!globalData) return true;
    // Only check rendered slots — inactive FD slots hold stale data and must be invisible.
    const allSlotPersonIds = globalData.clinics.flatMap(c =>
      getRenderedSlotEntries(c).map(([, sv]) => getSlotPersonId(sv))
    );
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
    setDirtyWeeks(prev => new Set([...prev, currentWeek]));
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
    setDirtyWeeks(prev => new Set([...prev, weekStr]));
    return true;
  }, [currentWeek, globalData, doSaveWeek]);

  const clearWeek = useCallback(async () => {
    if (!globalData) return;
    // Delete the week row entirely — a cleared week must have zero leftover data in Supabase.
    // On next load the init() path will see status:'empty' and seed a fresh blank map.
    await deleteWeekSlotMapDB(currentWeek);
    const clinics = globalData.clinics.map(c => ({
      ...c,
      slots: c.location === 'OBS' ? blankObsSlots() : blankStandardSlots(),
    }));
    const additionalTasks = (globalData.additionalTasks ?? []).map(t => ({ ...t, assignedPersonId: null }));
    setGlobalData(prev => ({ ...prev, clinics, additionalTasks }));
    // A cleared week with a prior snapshot is now dirty (snapshot ≠ blank)
    if (postedSnapshots[currentWeek]) {
      setDirtyWeeks(prev => new Set([...prev, currentWeek]));
    }
  }, [currentWeek, globalData, postedSnapshots]);

  // ─── History helpers ─────────────────────────
  const MAX_HISTORY_WEEKS = 52;

  /** Append new history entries, prune to 52-week rolling window, persist. */
  const appendHistory = useCallback((newEntries) => {
    if (!newEntries.length) return;
    const cutoff = isoWeek(new Date(Date.now() - MAX_HISTORY_WEEKS * 7 * 24 * 60 * 60 * 1000));
    const pruned = [...historyRef.current, ...newEntries].filter(e => (e.weekStr ?? '') >= cutoff);
    historyRef.current = pruned;
    setPlacementHistory(pruned);
    savePlacementHistoryDB(pruned); // fire-and-forget
  }, []);

  // ─── Post week ────────────────────────────────
  // Writes a snapshot of the current live data to posted_schedules.
  // Returns { error, snapshot } — TopBar handles downloads and logging on success.
  const postWeek = useCallback(async (initials) => {
    if (!globalData) return { error: 'No data' };
    const slotMap = extractSlotMap(globalData.clinics, globalData.additionalTasks);
    const wk = weekKey(currentWeek);
    const { error, data: row } = await savePostedSnapshotDB(wk, slotMap, initials);
    if (error) {
      console.error('[Shiftcraft] Post failed:', error);
      return { error };
    }
    const newSnap = {
      id: row?.id,
      snapshot: slotMap,
      posted_at: row?.posted_at ?? new Date().toISOString(),
      posted_by: initials,
    };
    setPostedSnapshots(prev => ({ ...prev, [currentWeek]: newSnap }));
    setDirtyWeeks(prev => { const next = new Set(prev); next.delete(currentWeek); return next; });
    return { error: null, snapshot: slotMap };
  }, [globalData, currentWeek]);

  const dismissPattern = useCallback((key) => {
    setDismissedPatterns(prev => {
      const next = [...new Set([...prev, key])];
      saveDismissedPatternsDB(next);
      return next;
    });
  }, []);

  const undismissPattern = useCallback((key) => {
    setDismissedPatterns(prev => {
      const next = prev.filter(k => k !== key);
      saveDismissedPatternsDB(next);
      return next;
    });
  }, []);

  // ─── Clinic mutations ───────────────────────
  const updateClinic = useCallback(async (clinicId, changes) => {
    if (!globalData) return;
    const prev = globalData.clinics.find(c => c.id === clinicId);
    const clinics = globalData.clinics.map(c => c.id === clinicId ? { ...c, ...changes } : c);
    const map = extractSlotMap(clinics, globalData.additionalTasks);
    setGlobalData(p => ({ ...p, clinics }));
    // Log open/close toggles
    if (prev && 'open' in changes && changes.open !== prev.open) {
      const action = changes.open
        ? `Clinic opened: ${prev.provider} @ ${prev.location} on ${prev.day}`
        : `Clinic closed: ${prev.provider} @ ${prev.location} on ${prev.day}`;
      setChangelog(log => [{ timestamp: Date.now(), action, personName: '', day: prev.day, detail: '', initials: managerInitials ?? undefined }, ...log].slice(0, 500));
    }
    await doSaveWeek(currentWeek, map);
    setDirtyWeeks(p => new Set([...p, currentWeek]));
  }, [currentWeek, globalData, doSaveWeek, managerInitials]);

  const assignSlot = useCallback(async (clinicId, slotType, personId) => {
    if (!globalData) return;

    const targetClinic = globalData.clinics.find(c => c.id === clinicId);
    if (!targetClinic) return;
    const isObsAssignment = targetClinic.location?.toLowerCase() === 'obs';

    // Guard: block writes to inactive FD slots (e.g. plain frontDesk on Dr. R Mon/Fri).
    // The popover only renders active slots, so this should never trigger normally —
    // it catches any code path that bypasses the popover (drag-and-drop, etc.).
    if (!isObsAssignment) {
      const ALL_FD = new Set(['openingFrontDesk', 'closingFrontDesk', 'frontDesk']);
      const activeFD = new Set(getActiveFDSlots(targetClinic));
      if (ALL_FD.has(slotType) && !activeFD.has(slotType)) {
        console.error(
          `[Shiftcraft] assignSlot: BLOCKED write to inactive FD slot "${slotType}" ` +
          `on ${targetClinic.provider} ${targetClinic.day}. Active: ${[...activeFD].join(', ')}`
        );
        return;
      }
    }

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
    setDirtyWeeks(prev => new Set([...prev, currentWeek]));

    // Record history entry for manual slot assignments (not for removals).
    if (personId && targetClinic) {
      const existingSlotVal = targetClinic.slots[slotType];
      const previousPersonId = getSlotPersonId(existingSlotVal);
      const source = previousPersonId && previousPersonId !== personId ? 'manual-edit' : 'manual-add';
      const loc = (targetClinic.location ?? '').toLowerCase().replace(/\s+/g, '_');
      appendHistory([{
        personName:      person?.name ?? personId,
        day:             targetClinic.day,
        location:        loc,
        slotType,
        weekStr:         currentWeek,
        source,
        managerInitials: managerInitials ?? null,
        createdAt:       new Date().toISOString(),
      }]);
    }
  }, [currentWeek, globalData, doSaveWeek, managerInitials, appendHistory]);

  const updateSlotTime = useCallback(async (clinicId, slotType, start, end) => {
    if (!globalData) return;
    const clinic = globalData.clinics.find(c => c.id === clinicId);
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
    if (clinic) {
      const slotLabel = SLOT_DISPLAY_LABELS[slotType] ?? slotType;
      const endStr = end === 'close' ? 'Close' : end != null ? minutesToTime(end) : '?';
      const action = `${slotLabel} time set @ ${clinic.location} (${clinic.provider}) on ${clinic.day}: ${start != null ? minutesToTime(start) : '?'} – ${endStr}`;
      setChangelog(log => [{ timestamp: Date.now(), action, personName: '', day: clinic.day, detail: '', initials: managerInitials ?? undefined }, ...log].slice(0, 500));
    }
    await doSaveWeek(currentWeek, map);
    setDirtyWeeks(prev => new Set([...prev, currentWeek]));
  }, [currentWeek, globalData, doSaveWeek, managerInitials]);

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
    setDirtyWeeks(prev => new Set([...prev, currentWeek]));
  }, [currentWeek, globalData, doSaveWeek, managerInitials]);

  const addTask = useCallback(async (task) => {
    if (!globalData) return;
    const additionalTasks = [...(globalData.additionalTasks ?? []), task];
    const taskTypes = globalData.taskTypes.includes(task.label)
      ? globalData.taskTypes
      : [...globalData.taskTypes, task.label];
    const map = extractSlotMap(globalData.clinics, additionalTasks);
    setGlobalData(prev => ({ ...prev, additionalTasks, taskTypes }));
    const endStr = task.end === 'close' ? 'Close' : task.end != null ? minutesToTime(task.end) : null;
    const timeStr = task.start != null && endStr ? ` ${minutesToTime(task.start)} – ${endStr}` : '';
    const action = `Task created: ${task.label}${task.locationTag ? ` @ ${task.locationTag}` : ''} on ${task.day}${timeStr}`;
    setChangelog(log => [{ timestamp: Date.now(), action, personName: '', day: task.day, detail: '', initials: managerInitials ?? undefined }, ...log].slice(0, 500));
    await doSaveWeek(currentWeek, map);
    setDirtyWeeks(prev => new Set([...prev, currentWeek]));
  }, [currentWeek, globalData, doSaveWeek, managerInitials]);

  const removeTask = useCallback(async (taskId) => {
    if (!globalData) return;
    const task = globalData.additionalTasks.find(t => t.id === taskId);
    const additionalTasks = (globalData.additionalTasks ?? []).filter(t => t.id !== taskId);
    const map = extractSlotMap(globalData.clinics, additionalTasks);
    setGlobalData(prev => ({ ...prev, additionalTasks }));
    if (task) {
      const action = `Task removed: ${task.label}${task.locationTag ? ` @ ${task.locationTag}` : ''} on ${task.day}`;
      setChangelog(log => [{ timestamp: Date.now(), action, personName: '', day: task.day, detail: '', initials: managerInitials ?? undefined }, ...log].slice(0, 500));
    }
    await doSaveWeek(currentWeek, map);
    setDirtyWeeks(prev => new Set([...prev, currentWeek]));
  }, [currentWeek, globalData, doSaveWeek, managerInitials]);

  const updateTaskTime = useCallback(async (taskId, start, end) => {
    if (!globalData) return;
    const task = globalData.additionalTasks.find(t => t.id === taskId);
    const additionalTasks = (globalData.additionalTasks ?? []).map(t =>
      t.id === taskId ? { ...t, start, end } : t
    );
    const map = extractSlotMap(globalData.clinics, additionalTasks);
    setGlobalData(prev => ({ ...prev, additionalTasks }));
    if (task) {
      const endStr = end === 'close' ? 'Close' : end != null ? minutesToTime(end) : '?';
      const timeStr = start != null ? `${minutesToTime(start)} – ${endStr}` : '';
      const action = `Task time updated: ${task.label}${task.locationTag ? ` @ ${task.locationTag}` : ''} on ${task.day}${timeStr ? ' → ' + timeStr : ''}`;
      setChangelog(log => [{ timestamp: Date.now(), action, personName: '', day: task.day, detail: '', initials: managerInitials ?? undefined }, ...log].slice(0, 500));
    }
    await doSaveWeek(currentWeek, map);
    setDirtyWeeks(prev => new Set([...prev, currentWeek]));
  }, [currentWeek, globalData, doSaveWeek, managerInitials]);

  const updateTask = useCallback(async (taskId, changes) => {
    if (!globalData) return;
    const prev = globalData.additionalTasks.find(t => t.id === taskId);
    const additionalTasks = globalData.additionalTasks.map(t =>
      t.id === taskId ? { ...t, ...changes } : t
    );
    const taskTypes = changes.label && !globalData.taskTypes.includes(changes.label)
      ? [...globalData.taskTypes, changes.label]
      : globalData.taskTypes;
    const map = extractSlotMap(globalData.clinics, additionalTasks);
    setGlobalData(g => ({ ...g, additionalTasks, taskTypes }));
    const updated = { ...prev, ...changes };
    // Log content changes (label / location / time)
    const changed = [];
    if (changes.label != null && changes.label !== prev?.label) changed.push(`renamed to "${changes.label}"`);
    if ('locationTag' in changes && changes.locationTag !== prev?.locationTag) changed.push(`location → ${changes.locationTag || 'none'}`);
    if (('start' in changes || 'end' in changes) && !('assignedPersonId' in changes)) {
      const s = updated.start; const e = updated.end;
      const endStr = e === 'close' ? 'Close' : e != null ? minutesToTime(e) : '?';
      if (s != null) changed.push(`time → ${minutesToTime(s)} – ${endStr}`);
    }
    if (changed.length > 0) {
      setChangelog(log => [{
        timestamp: Date.now(),
        action: `Task edited: ${prev?.label || 'task'} on ${updated.day} (${changed.join(', ')})`,
        personName: '', day: updated.day, detail: '',
        initials: managerInitials ?? undefined,
      }, ...log].slice(0, 500));
    }
    // Log assignment changes
    if ('assignedPersonId' in changes && changes.assignedPersonId !== prev?.assignedPersonId) {
      const person = changes.assignedPersonId
        ? globalData.people.find(p => p.id === changes.assignedPersonId)
        : null;
      const action = changes.assignedPersonId
        ? `${person?.name} assigned to ${updated.label}${updated.locationTag ? ` (${updated.locationTag})` : ''} on ${updated.day}`
        : `${updated.label} unassigned on ${updated.day}`;
      setChangelog(log => [{
        timestamp: Date.now(), action,
        personName: person?.name ?? '—', day: updated.day, detail: '',
        initials: managerInitials ?? undefined,
      }, ...log].slice(0, 500));
    }
    await doSaveWeek(currentWeek, map);
    setDirtyWeeks(prev => new Set([...prev, currentWeek]));
  }, [currentWeek, globalData, doSaveWeek, managerInitials]);

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
      const targetClinic = clinics.find(c => c.id === clinicId);
      if (targetClinic) {
        const isObsClinic = targetClinic.location?.toLowerCase() === 'obs';
        const isObsSlot   = OBS_SLOT_TYPES.includes(slot);
        if (isObsClinic && !isObsSlot) {
          console.error(`[Shiftcraft] applyBulkAssignments: BLOCKED writing non-OBS slot "${slot}" to OBS clinic "${clinicId}". This is a bug in the solver or adapter.`);
          continue;
        }
        if (!isObsClinic && isObsSlot) {
          console.error(`[Shiftcraft] applyBulkAssignments: BLOCKED writing OBS slot "${slot}" to regular clinic "${clinicId}". This is a bug in the solver or adapter.`);
          continue;
        }
      }
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
    setDirtyWeeks(prev => new Set([...prev, currentWeek]));

    // Record generated assignments in history for pattern learning.
    const clinicById  = new Map(globalData.clinics.map(c => [c.id, c]));
    const personById  = new Map((globalData.people ?? []).map(p => [p.id, p]));
    const histEntries = assignments
      .filter(a => a.personId)
      .map(a => {
        const clinic  = clinicById.get(a.clinicId);
        const person  = personById.get(a.personId);
        if (!clinic || !person) return null;
        const loc = (clinic.location ?? '').toLowerCase().replace(/\s+/g, '_');
        return {
          personName:      person.name,
          day:             clinic.day,
          location:        loc,
          slotType:        a.slot,
          weekStr:         currentWeek,
          source:          'generated',
          managerInitials: null,
          createdAt:       new Date().toISOString(),
        };
      })
      .filter(Boolean);
    appendHistory(histEntries);
  }, [currentWeek, globalData, doSaveWeek, appendHistory]);

  const restoreClinicSlots = useCallback(async (slotSnapshot) => {
    if (!globalData) return;
    const clinics = globalData.clinics.map(c => ({
      ...c,
      slots: slotSnapshot[c.id] ?? c.slots,
    }));
    const map = extractSlotMap(clinics, globalData.additionalTasks);
    setGlobalData(prev => ({ ...prev, clinics }));
    await doSaveWeek(currentWeek, map);
    setDirtyWeeks(prev => new Set([...prev, currentWeek]));
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

  // ─── Derived: history scores for solver tiebreaking ──
  const historyScores = useMemo(() => computeHistoryScores(placementHistory), [placementHistory]);

  // ─── Week label ─────────────────────────────
  const weekMonday = mondayOfWeek(currentWeek);
  const weekLabel = weekMonday.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', timeZone: 'UTC',
  });

  const postedSnapshot = postedSnapshots[currentWeek] ?? null;

  const isDirty = useMemo(() => {
    if (!globalData) return false;
    const snap = postedSnapshots[currentWeek];
    if (snap === undefined) return false; // still loading
    const liveMap = extractSlotMap(globalData.clinics, globalData.additionalTasks);
    if (snap === null) {
      // Never posted — dirty only if the week has assignments worth posting
      return hasAnyAssignment(liveMap);
    }
    return sortedJSON(liveMap) !== sortedJSON(snap.snapshot);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalData, currentWeek, postedSnapshots]);

  // What the board renders: live data for managers, snapshot-applied data for staff.
  // null = staff view, week never posted → show "not yet posted" placeholder.
  const boardClinics = useMemo(() => {
    if (!globalData) return null;
    if (isAdmin) return globalData.clinics;
    const snap = postedSnapshots[currentWeek];
    if (snap == null) return null; // undefined (loading) or null (never posted)
    return applySlotMap(globalData.clinics, globalData.additionalTasks, snap.snapshot).clinics;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, globalData, currentWeek, postedSnapshots]);

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
      assignTask, addTask, removeTask, updateTask, updateTaskTime,
      updatePerson, addPerson, deletePerson, reorderPeople,
      applyBulkAssignments, restoreClinicSlots,
      addClinic, removeClinic, addLocation, removeLocation,
      changelog, clearChangelog, addLog,
      placementHistory, dismissedPatterns, historyScores,
      dismissPattern, undismissPattern,
      presentManagers, conflictToast, setConflictToast,
      isDirty, postedSnapshot, dirtyWeeks, boardClinics, postWeek,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);
