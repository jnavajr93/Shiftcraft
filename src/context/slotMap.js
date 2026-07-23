/**
 * Pure slot-map utilities — no React, no Supabase, no side effects.
 * Safe to import from test files without mocking.
 *
 * Slot maps are the per-week records stored in Supabase.  They hold:
 *   - { [clinicId]: { scribe, opener, ... } }  slot assignments
 *   - { [`task:${id}`]: personId | null }       task assignments
 *   - { __clinicConfig: { [clinicId]: { open, startTime, endTime, patientCount } } }
 *                                                per-week clinic config (never in global record)
 */

import { OBS_SLOT_TYPES, getSlotPersonId, getActiveFDSlots } from '../data/seed.js';

// ─── Blank slot shapes ────────────────────────────────────────────────────────

export function blankObsSlots() {
  return {
    preop:      { personId: null, start: null, end: null },
    sterile:    { personId: null, start: null, end: null },
    circulator: { personId: null, start: null, end: null },
    scrub:      { personId: null, start: null, end: null },
  };
}

export function blankStandardSlots() {
  return {
    openingFrontDesk: null, closingFrontDesk: null, frontDesk: null,
    scribe:   { personId: null, start: null, end: null },
    opener:   null, closing: null,
    middle:   { personId: null, start: null, end: null },
    training: { personId: null, start: null, end: null },
  };
}

// ─── extractSlotMap ───────────────────────────────────────────────────────────

/**
 * Serialise the current live clinic/task state into a slot map for Supabase.
 * Captures __clinicConfig so per-week clinic config (open, times, patientCount)
 * is stored alongside assignments in the week record — never in the global record.
 */
export function extractSlotMap(clinics, tasks) {
  const map = {};
  for (const c of clinics) map[c.id] = { ...c.slots };
  for (const t of (tasks ?? [])) map[`task:${t.id}`] = t.assignedPersonId;
  // Per-week clinic config snapshot: open/closed, start/end times, patient count.
  map.__clinicConfig = Object.fromEntries(
    clinics.map(c => [c.id, { open: c.open, startTime: c.startTime, endTime: c.endTime, patientCount: c.patientCount }])
  );
  return map;
}

// ─── applySlotMap ─────────────────────────────────────────────────────────────

/**
 * Apply a slotMap onto clinics and tasks, returning new arrays.
 * If the map contains __clinicConfig, those per-week values (open, times, patientCount)
 * override the base clinic definitions for this week only.
 */
export function applySlotMap(clinics, tasks, map) {
  const clinicConfig = map.__clinicConfig ?? {};
  const newClinics = clinics.map(c => {
    // Apply per-week clinic config (open/closed, times, patient count) if present.
    const override = clinicConfig[c.id];
    const base = override ? { ...c, ...override } : c;

    if (base.location === 'OBS') {
      const merged = { ...blankObsSlots(), ...(map[c.id] ?? {}) };
      const invalidKeys = Object.keys(merged).filter(k => !OBS_SLOT_TYPES.includes(k));
      if (invalidKeys.length > 0) {
        console.warn(`[Shiftcraft applySlotMap] OBS clinic ${c.id}: stripping invalid slot keys:`, invalidKeys);
        for (const k of invalidKeys) delete merged[k];
      }
      return { ...base, slots: merged };
    }
    const merged = { ...blankStandardSlots(), ...(map[c.id] ?? {}) };
    const activeFD = new Set(getActiveFDSlots(base));
    const ALL_FD = ['openingFrontDesk', 'closingFrontDesk', 'frontDesk'];
    for (const fdKey of ALL_FD) {
      if (!activeFD.has(fdKey) && merged[fdKey]) {
        console.warn(`[Shiftcraft applySlotMap] Regular clinic ${c.id} (${base.provider} ${base.day}): clearing stale inactive FD slot "${fdKey}"`);
        merged[fdKey] = null;
      }
    }
    return { ...base, slots: merged };
  });
  const newTasks = (tasks ?? []).map(t => ({
    ...t,
    assignedPersonId: map[`task:${t.id}`] ?? null,
  }));
  return { clinics: newClinics, additionalTasks: newTasks };
}

// ─── blankSlotMap ─────────────────────────────────────────────────────────────

/**
 * Blank slot map for a brand-new week.
 * Intentionally NO __clinicConfig: new weeks fall through to the global baseline
 * via the clinic-config reset in navigateWeek / jumpToWeek.
 */
export function blankSlotMap(clinics, tasks) {
  const map = {};
  for (const c of clinics) map[c.id] = c.location === 'OBS' ? blankObsSlots() : blankStandardSlots();
  for (const t of (tasks ?? [])) map[`task:${t.id}`] = null;
  return map;
}

// ─── hasAnyAssignment ─────────────────────────────────────────────────────────

export function hasAnyAssignment(map) {
  for (const [key, val] of Object.entries(map)) {
    if (key === '__clinicConfig') continue;
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

// ─── stripClinicConfig ────────────────────────────────────────────────────────

/** Remove __clinicConfig before dirty comparisons so clinic-config changes
 *  don't incorrectly mark the schedule dirty relative to a posted snapshot. */
export function stripClinicConfig(map) {
  if (!map || typeof map !== 'object' || !('__clinicConfig' in map)) return map;
  const { __clinicConfig: _, ...rest } = map;
  return rest;
}

// ─── sortedJSON ───────────────────────────────────────────────────────────────

/** Canonical JSON with stable key order — Postgres JSONB may return keys in a
 *  different order than we wrote them. */
export function sortedJSON(obj) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return JSON.stringify(obj);
  const keys = Object.keys(obj).sort();
  const inner = keys.map(k => `${JSON.stringify(k)}:${sortedJSON(obj[k])}`).join(',');
  return `{${inner}}`;
}

// ─── toDefinitionData ─────────────────────────────────────────────────────────

/**
 * Strip per-week state and return only the global clinic/task definitions
 * suitable for writing to the SCHEDULE_KEY global record.
 *
 * Critical: per-week fields (open/closed, startTime, endTime, patientCount)
 * are restored from `originalClinicDefs` (the baseline captured at app init)
 * so that editing one week's config does NOT corrupt the global record and
 * bleed into other weeks.
 *
 * For newly added clinics (not in originalClinicDefs), initial values are
 * written as-is — they ARE the global baseline for that clinic.
 *
 * @param {object} globalData  - live app state (may have per-week overrides)
 * @param {Array|null} originalClinicDefs - [{ id, open, startTime, endTime, patientCount }]
 *   captured once at init before any per-week applySlotMap calls.
 */
export function toDefinitionData(globalData, originalClinicDefs) {
  const { clinics, additionalTasks, ...rest } = globalData;
  const defsById = originalClinicDefs
    ? new Map(originalClinicDefs.map(d => [d.id, d]))
    : null;
  const definitionClinics = clinics.map(({ slots, ...def }) => {
    // For existing clinics: restore global-baseline per-week fields so the live
    // overrides (open, times, patientCount for this specific week) are not written
    // to the global record and do not affect any other week.
    // For new clinics (not in originalClinicDefs): pass through as-is — their
    // initial values are the baseline.
    const orig = defsById?.get(def.id);
    return {
      ...def,
      ...(orig
        ? { open: orig.open, startTime: orig.startTime, endTime: orig.endTime, patientCount: orig.patientCount }
        : {}),
      slots: def.location === 'OBS' ? blankObsSlots() : blankStandardSlots(),
    };
  });
  const definitionTasks = (additionalTasks ?? []).map(({ assignedPersonId, ...t }) => ({
    ...t, assignedPersonId: null,
  }));
  return { ...rest, clinics: definitionClinics, additionalTasks: definitionTasks };
}
