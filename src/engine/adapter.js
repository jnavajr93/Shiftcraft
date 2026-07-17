// src/engine/adapter.js
// Translates AppContext globalData → solver cfg, runs solve(), returns
// results in the same { clinicId, slot, personId } shape applyBulkAssignments expects.

import { solve } from './solver.js';
import { getActiveFDSlots, OBS_SLOT_TYPES } from '../data/seed.js';

// Maps role display names (stored in person.roles) to slot key IDs used by the solver.
const ROLE_TO_SLOT_KEY = {
  'Scribe':             'scribe',
  'Opener':             'opener',
  'Middle':             'middle',
  'Closing':            'closing',
  'Training':           'training',
  'Pre-Op/PACU':        'preop',
  'Sterile Processing': 'sterile',
  'Circulator':         'circulator',
  'Scrub Tech':         'scrub',
};

function toLocationId(name) {
  return name.toLowerCase().replace(/\s+/g, '_');
}

// All possible front desk slot keys — used for exclusion logic below.
const ALL_FD_SLOT_KEYS = new Set(['frontDesk', 'openingFrontDesk', 'closingFrontDesk']);

// Returns the slot keys that are required for a clinic (required + evaluated conditionals).
// OBS clinics: every slot key present is required.
// Standard clinics: requiredSlots + any conditionalSlots whose condition is met.
// training is never generated — excluded explicitly as a safety net.
// Front desk keys are always included when present (FIX 2).
function getRequiredSlots(clinic, providers) {
  // case-insensitive OBS check
  const isObs = clinic.location?.toLowerCase() === 'obs';
  // For standard clinics, exclude training AND any FD slots not rendered by the card.
  // Only the active FD slots are visible; filling the others creates invisible orphan assignments.
  const activeFDSet = isObs ? null : new Set(getActiveFDSlots(clinic));
  const allSlotKeys = Object.keys(clinic.slots ?? {}).filter(k => {
    if (k === 'training') return false;
    if (!isObs && ALL_FD_SLOT_KEYS.has(k) && !activeFDSet.has(k)) return false;
    return true;
  });

  // OBS clinics: only the four canonical OBS slot types are ever required.
  // Filter here as belt-and-suspenders — applySlotMap also strips stale keys on load,
  // but an in-memory OBS clinic with a stale key would still produce a bad constraint.
  if (isObs) return allSlotKeys.filter(k => OBS_SLOT_TYPES.includes(k));

  // Dr. B (Skibell): only Scribe and Opener are ever auto-generated.
  // Closing/Middle/Training are intentionally left empty by the solver and filled
  // manually via drag/drop on the rare high-volume day they're needed.
  // This overrides any providers.conditionalSlots config so it stays enforced even
  // when live data in Supabase has an older providers record with the conditional closing.
  if (clinic.provider === 'Dr. B') {
    const activeFD = getActiveFDSlots(clinic);
    return ['scribe', 'opener', ...activeFD].filter(k => allSlotKeys.includes(k));
  }

  const provider = providers.find(p => p.name === clinic.provider);
  if (!provider?.requiredSlots?.length) return allSlotKeys; // fallback: treat everything as required

  const required = provider.requiredSlots.filter(s => s !== 'training');

  for (const cond of provider.conditionalSlots ?? []) {
    if (cond.slot === 'training') continue; // never generate training
    if (cond.if === 'patientCount > 17' && (clinic.patientCount ?? 0) > 17) {
      required.push(cond.slot);
    }
    if (cond.if === 'patientCount > 70' && (clinic.patientCount ?? 0) > 70) {
      required.push(cond.slot);
    }
  }

  // FIX 2: include only the FD slots the card actually renders for this clinic.
  // Dr. R Mon/Fri renders openingFrontDesk + closingFrontDesk; all others render frontDesk.
  // Never fill the invisible FD slots — they appear in data but are not on the card.
  const activeFD = getActiveFDSlots(clinic);
  for (const fdKey of activeFD) {
    if (allSlotKeys.includes(fdKey) && !required.includes(fdKey)) {
      required.push(fdKey);
    }
  }

  return required.filter(s => allSlotKeys.includes(s));
}

// Diagnostic: for each unfilled role in the solve result, log why every
// person was ineligible. Prints to console.group so it's easy to collapse.
// Intended to be temporary — remove once staffing gaps are understood.
function diagnoseSolverGaps(cfg, result) {
  const unavailDays = {};
  for (const c of cfg.constraints) {
    if (c.enabled && c.type === 'unavailable') {
      for (const d of c.days ?? []) {
        unavailDays[`${c.personId}:${d}`] = true;
      }
    }
  }
  const hourCaps = {};
  for (const c of cfg.constraints) {
    if (c.enabled && c.type === 'hour_cap') hourCaps[c.personId] = c.count;
  }
  const shiftById = Object.fromEntries(cfg.shifts.map(s => [s.id, s]));
  const personById = Object.fromEntries(cfg.people.map(p => [p.id, p]));

  let anyGap = false;
  for (const [day, dayResult] of Object.entries(result)) {
    if (!dayResult.issues?.length) continue;
    // Build 'used' set for this day from assigned cards
    const usedToday = new Set();
    for (const card of dayResult.shifts) {
      for (const a of card.assigned) usedToday.add(a.personId);
    }
    for (const card of dayResult.shifts) {
      const shift = shiftById[card.shiftId];
      for (const s of card.staffing) {
        if (s.have >= s.min) continue; // filled — skip
        const roleId = s.role; // role name === roleId (adapter sets name = id)
        // All Dr. B tech slots are intentionally controlled — skip in diagnostic.
        // Scribe/Opener: only Yadi/Marisela, no substitutes; Closing/Middle/Training: always empty.
        if (shift?.name === 'Dr. B' && ['scribe', 'opener', 'closing', 'middle', 'training'].includes(roleId)) continue;
        anyGap = true;
        console.group(`[Shiftcraft gap] ${day} · ${card.shiftName} @ ${card.location} — ${roleId} (have ${s.have}/${s.min})`);
        for (const person of cfg.people) {
          const reasons = [];
          if (!person.roles.includes(roleId)) reasons.push(`no ${roleId} role (has: ${person.roles.join(', ') || 'none'})`);
          if (person.locations.length && !person.locations.includes(shift?.locationId)) reasons.push(`not cleared for ${shift?.locationId} (cleared: ${person.locations.join(', ')})`);
          if (unavailDays[`${person.id}:${day}`]) reasons.push(`day off`);
          if (usedToday.has(person.id)) reasons.push(`already used elsewhere today`);
          if (hourCaps[person.id] != null) reasons.push(`hour cap: ${hourCaps[person.id]}h`);
          const status = reasons.length ? `✗ ${reasons.join(' | ')}` : '✓ eligible but not chosen (hour cap hit or ordering)';
          console.log(`  ${personById[person.id]?.name ?? person.id}: ${status}`);
        }
        console.groupEnd();
      }
    }
  }
  if (!anyGap) console.log('[Shiftcraft] Solver: all required slots filled');
}

// Main export.
// globalData  — full AppContext data object (people, locations, clinics, etc.)
// options.historyScores — optional Map<patternKey, score> from computeHistoryScores().
//   When provided, the solver uses historical frequency as a soft tiebreaker when
//   multiple candidates are equally eligible for a slot.
// Returns { assignments: [{clinicId, slot, personId}], issues: string[] }
export function generateSchedule(globalData, options = {}) {
  const openClinics = (globalData.clinics ?? []).filter(c => c.open);

  // ── 1. Roles — derived from slot keys present in open clinics ──────────────
  const slotKeySet = new Set();
  for (const clinic of openClinics) {
    for (const key of Object.keys(clinic.slots ?? {})) {
      slotKeySet.add(key);
    }
  }
  // role id === slot key; role name === slot key (solver uses name for output)
  const roles = [...slotKeySet].map(key => ({ id: key, name: key }));

  // ── 2. Locations ──────────────────────────────────────────────────────────
  const locations = (globalData.locations ?? []).map(name => ({
    id: toLocationId(name),
    name,
  }));

  // ── 3. People ─────────────────────────────────────────────────────────────
  const people = (globalData.people ?? []).map(p => {
    // Map display role names → slot key IDs; drop any unknown roles
    const mappedRoles = (p.roles ?? []).map(r => ROLE_TO_SLOT_KEY[r]).filter(Boolean);

    // FIX 2: Admin staff with 'Front Desk' skill are eligible for all FD slot types.
    // Admin people currently have no roles configured; skill is the gate.
    if (p.staffType === 'admin' && (p.skills ?? []).includes('Front Desk')) {
      mappedRoles.push('frontDesk', 'openingFrontDesk', 'closingFrontDesk');
    }

    return {
      id: p.id,
      name: p.name,
      color: p.color,
      targetHours: p.targetHours ?? null,
      roles: mappedRoles,
      // Map cleared location names → location IDs; empty = cleared everywhere
      locations: (p.clearedLocations ?? []).map(name => toLocationId(name)),
      // Blocked person IDs: all other records with the same display name.
      // Name-based identity is the canonical rule — same name = same physical person,
      // regardless of whether linkedPersonId is set. Placing any one of these records
      // marks all same-name records as used so the solver never double-books a person.
      blockedIds: (globalData.people ?? [])
        .filter(q => q.name.trim().toLowerCase() === p.name.trim().toLowerCase() && q.id !== p.id)
        .map(q => q.id),
    };
  });

  // ── 4. Shifts — one per open clinic ───────────────────────────────────────
  // Dr. R split-day detection: any day with 2+ open Dr. R clinics is a split-day.
  // Those clinics get priority 5 so the solver processes them as a group (after OBS,
  // before all other regular clinics). Within the group, AM sorts before PM by startTime,
  // so the same team fills both halves naturally (the AM effective range doesn't overlap
  // the PM start, leaving everyone eligible for the second half).
  const drRByDay = {}; // day → count of open Dr. R clinics
  for (const clinic of openClinics) {
    if (clinic.provider === 'Dr. R') drRByDay[clinic.day] = (drRByDay[clinic.day] ?? 0) + 1;
  }
  const splitDayClinicIds = new Set(
    openClinics
      .filter(c => c.provider === 'Dr. R' && (drRByDay[c.day] ?? 0) >= 2)
      .map(c => c.id)
  );

  const shifts = openClinics.map(clinic => ({
    id: clinic.id,
    name: clinic.provider,
    locationId: toLocationId(clinic.location),
    days: [clinic.day],
    start: clinic.startTime,
    end: clinic.endTime,
    week: null,   // already filtered to current week; pass null so solver runs all
    anchor: true,
    // Priority:
    //   10 — OBS (full-day block, must be filled before any regular clinic)
    //    5 — Dr. R split-day pair (processed consecutively AM→PM, natural carry-across)
    //    0 — all other regular clinics
    priority: clinic.location?.toLowerCase() === 'obs' ? 10
            : splitDayClinicIds.has(clinic.id)         ?  5
            :                                              0,
  }));

  // ── 5. Constraints ────────────────────────────────────────────────────────
  const constraints = [];

  // MIN_STAFF: only for required slots per clinic (not conditional ones).
  // For OBS clinics every slot is required; for standard clinics use provider.requiredSlots.
  const minStaffSeen = new Set();
  for (const clinic of openClinics) {
    const locId = toLocationId(clinic.location);
    const requiredSlots = getRequiredSlots(clinic, globalData.providers ?? []);
    for (const slotKey of requiredSlots) {
      const key = `${locId}__${slotKey}`;
      if (!minStaffSeen.has(key)) {
        minStaffSeen.add(key);
        constraints.push({
          id: key,
          type: 'min_staff',
          enabled: true,
          locationId: locId,
          roleId: slotKey,
          count: 1,
        });
      }
    }
  }

  // UNAVAILABLE: per person daysOff
  for (const person of globalData.people ?? []) {
    if ((person.daysOff ?? []).length > 0) {
      constraints.push({
        id: `unavail_${person.id}`,
        type: 'unavailable',
        enabled: true,
        personId: person.id,
        days: person.daysOff,
      });
    }
  }

  // HOUR_CAP: per person targetHours
  for (const person of globalData.people ?? []) {
    if (person.targetHours != null) {
      constraints.push({
        id: `hourcap_${person.id}`,
        type: 'hour_cap',
        enabled: true,
        personId: person.id,
        count: person.targetHours,
      });
    }
  }

  // MUST_PAIR: lockedTo entries → match against shift names.
  // Supports both legacy string format ("Dr. B") and new object format ({ provider, slot }).
  // String: any slot, solver uses person.roles[0].
  // Object: targets the specified slot; solver uses constraint.slot.
  for (const person of globalData.people ?? []) {
    for (const entry of (person.lockedTo ?? [])) {
      const providerName = typeof entry === 'string' ? entry : entry.provider;
      const lockedSlot   = typeof entry === 'string' ? null  : (entry.slot ?? null);
      // Skip empty provider names — OBS clinics have provider:'', so a lockedTo entry
      // with blank provider would accidentally lock the person to every OBS clinic and
      // their roles[0] (often 'frontDesk') would be reserved as the OBS slot.
      if (!providerName) continue;
      for (const shift of shifts) {
        if (shift.name === providerName) {
          constraints.push({
            id: `mustpair_${person.id}_${shift.id}${lockedSlot ? `_${lockedSlot}` : ''}`,
            type: 'must_pair',
            enabled: true,
            personId: person.id,
            anchorId: shift.id,
            slot: lockedSlot, // null = any role (uses person.roles[0]); string = specific slot
          });
        }
      }
    }
  }

  // Dr. B Opener default: Marisela fills Opener at every Dr. B clinic unless she
  // is unavailable that day (day off, already placed, OBS, hour cap hit).
  // Parallel to Yadi → Scribe which is expressed via person.lockedTo in Supabase.
  // Name-based lookup is canonical: same name = same physical person.
  {
    const marisela = (globalData.people ?? []).find(
      p => p.name.trim().toLowerCase() === 'marisela'
    );
    if (marisela) {
      for (const shift of shifts) {
        if (shift.name === 'Dr. B') {
          constraints.push({
            id: `mustpair_drb_opener_${marisela.id}_${shift.id}`,
            type: 'must_pair',
            enabled: true,
            personId: marisela.id,
            anchorId: shift.id,
            slot: 'opener',
          });
        }
      }
    }
  }

  const cfg = { roles, locations, people, shifts, constraints };

  // ── 6. Run solver ─────────────────────────────────────────────────────────
  // Build a scoreFn from historyScores if provided. The key format matches
  // patternKey() in patterns.js: personName:day:location:slotType (all lowercase).
  const { historyScores } = options;
  const scoreFn = historyScores?.size
    ? (personName, day, locationId, roleId) => {
        const key = `${(personName ?? '').trim().toLowerCase()}:${(day ?? '').toLowerCase()}:${locationId}:${(roleId ?? '').toLowerCase()}`;
        return historyScores.get(key) ?? 0;
      }
    : null;
  const result = solve(cfg, null, scoreFn);

  // ── 6b. Diagnostics — log why each unfilled slot has no candidate ─────────
  // Runs a second pass after solve() to explain rejections per person.
  // Remove or gate behind a flag once the staffing gaps are understood.
  diagnoseSolverGaps(cfg, result);

  // ── 7. Translate back to [{clinicId, slot, personId}] ────────────────────
  // solver output: result[day].shifts[].{ shiftId, assigned: [{personId, role}] }
  // role === idx.roles[roleId].name === slotKey (since we set name = id = slotKey)
  //
  // Post-filter 1: strip assignments for slots not required by the specific clinic.
  // Necessary because MIN_STAFF constraints are location-based — when Dr. S at Estrella
  // requires 'closing', the 'estrella__closing' constraint causes the solver to also try
  // to fill closing for Dr. B at Estrella on shared days.
  const requiredSlotsMap = new Map(
    openClinics.map(c => [c.id, new Set(getRequiredSlots(c, globalData.providers ?? []))])
  );

  // Post-filter 2: Dr. B tech slots are person-locked — no substitutes.
  // Scribe: only Yadi. Opener: only Marisela.
  // If either is off/unavailable, the solver may still fill the slot with someone
  // else (MIN_STAFF constraint exists); strip those assignments so the slot stays empty.
  // Closing/Middle/Training are stripped entirely by filter 1 (not in requiredSlotsMap).
  // FD slots are NOT filtered here — they are filled normally.
  const DR_B_TECH_SLOTS = new Set(['scribe', 'opener', 'closing', 'middle', 'training']);
  const peopleList = globalData.people ?? [];
  const yadiIds = new Set(
    peopleList.filter(p => p.name.trim().toLowerCase() === 'yadi').map(p => p.id)
  );
  const mariselaIds = new Set(
    peopleList.filter(p => p.name.trim().toLowerCase() === 'marisela').map(p => p.id)
  );
  // Clinic ID → provider name lookup for Dr. B check
  const clinicProviderMap = new Map(openClinics.map(c => [c.id, c.provider]));

  // All Dr. B tech slot issues are intentional — suppress from changelog.
  // Covers: scribe/opener (no-substitute rule), closing/middle/training (always empty).
  const DR_B_TECH_ISSUE_ROLES = ['scribe', 'opener', 'closing', 'middle', 'training'];

  const assignments = [];
  const issues = [];

  for (const dayResult of Object.values(result)) {
    for (const card of dayResult.shifts) {
      const reqSlots = requiredSlotsMap.get(card.shiftId);
      const isDrB = clinicProviderMap.get(card.shiftId) === 'Dr. B';
      for (const a of card.assigned) {
        if (!a.personId || !a.role) continue;
        // Filter 1: slot must be required by this specific clinic
        if (reqSlots && !reqSlots.has(a.role)) continue;
        // Filter 2: Dr. B tech slots — only the designated person, no substitutes
        if (isDrB && DR_B_TECH_SLOTS.has(a.role)) {
          if (a.role === 'scribe'  && !yadiIds.has(a.personId))    continue;
          if (a.role === 'opener'  && !mariselaIds.has(a.personId)) continue;
          // closing/middle/training already blocked by filter 1; explicit guard for safety
          if (['closing', 'middle', 'training'].includes(a.role))   continue;
        }
        assignments.push({ clinicId: card.shiftId, slot: a.role, personId: a.personId });
      }
    }
    // Suppress all Dr. B tech slot issues — empty slots are intentional by design.
    const dayIssues = (dayResult.issues ?? []).filter(issue =>
      !(issue.startsWith('Dr. B:') &&
        DR_B_TECH_ISSUE_ROLES.some(r => issue.includes(`more ${r}`)))
    );
    issues.push(...dayIssues);
  }

  return { assignments, issues };
}
