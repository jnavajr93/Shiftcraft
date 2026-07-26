# Shiftcraft — Project State

*Keep this current. Update when something ships or changes. Read at the start of every new session.*

Last updated: **2026-07-26** — commit `d8031c4`

> **Note on docs accuracy:** STATE.md was incomplete on first write — it omitted that the solver/adapter already had absence constraints before this session. Corrected below. Always verify against the actual code, not just these docs.

---

## What This App Is

Vite + React single-page app for scheduling a multi-location eye clinic's weekly tech and admin staff. Managers log in (PIN gate), view a weekly grid of clinic cards, drag/assign staff to slots, track absences and on-call rotation, and post the schedule for staff to read.

Live URL: **https://shiftcraft-azretvit.vercel.app**  
Repo: `/Users/juancnava/shiftcraft`  
Stack: Vite, React 18, @dnd-kit, Supabase, lucide-react, Vitest

---

## Data Architecture

### Two-tier storage in Supabase (`schedule_data` table)

| Record key | What it holds |
|---|---|
| `shiftcraft_main` | Global record — clinic/staff definitions, roster, provider configs |
| `shiftcraft_week_YYYY-MM-DD` | Per-week record — slot assignments, clinic config overrides, task instances |

**The rule:** If it's the same every week, it lives globally. If it can differ week to week, it lives in the week record.

### Global record fields (`shiftcraft_main`)
- `people[]` — full roster (id, name, color, staffType, roles, skills, daysOff, lockedTo, accommodations…)
- `clinics[]` — clinic identity (id, provider, location, day, week) + **baseline** open/times/patientCount (per-week values override these)
- `clinics[].slots` — stored blank; assignments live in week records
- `locations[]`, `providers[]` — location strings and provider configs with requiredSlots/conditionalSlots
- `taskTypes[]` — always exactly `BUILTIN_TASK_TYPES` (6 builtins); never has custom values
- `additionalTasks[]` — task **definitions** (id, label, day, start, end); `assignedPersonId` is null here

### Per-week slot map fields
- `{ [clinicId]: { scribe, opener, closing, middle, training, frontDesk, … } }` — slot assignments (personId strings or null)
- `{ ['task:${id}']: personId | null }` — per-task assignee
- `__clinicConfig: { [clinicId]: { open, startTime, endTime, patientCount } }` — per-week clinic config overrides
- `__tasks: [{ id, label, day, locationTag, start, end, _standingClinicId? }]` — week-specific task instances (stripping `assignedPersonId`); `_standingClinicId` preserved for standing tasks

### Key serialization functions (`src/context/slotMap.js`)
- **`extractSlotMap(clinics, tasks)`** → Supabase row. Captures `__clinicConfig` and `__tasks`. Strips `_isResearch` ephemeral overlays from tasks.
- **`applySlotMap(clinics, tasks, map)`** → live state. Applies `__clinicConfig`, restores task `assignedPersonId` from `task:${id}` keys, clears stale inactive FD slots.
- **`toDefinitionData(globalData, origClinicDefs, origTaskDefs)`** → global baseline for SCHEDULE_KEY. Restores original global clinic times/open state so editing one week doesn't corrupt global record.

### Realtime
Supabase Realtime channel. On SCHEDULE_KEY broadcast: merges incoming, preserves per-week `__clinicConfig`/`__tasks` from current local state. On week broadcast: `applySlotMap` with current map. Conflict detection (version counter) triggers toast and reconciles state.

---

## Identity Model

### personKey
```js
personKey = name => (name ?? '').trim().toLowerCase()
```
The canonical identity key used everywhere: deduplication, absence lookup, assignment matching, health checks.

### Linked records (dual-role staff)
A real person can have **at most two records**: one `staffType: null/tech` and one `staffType: 'admin'`. Same personKey, different roles. This is intentional for staff who work both tech and admin roles.

**Current linked pairs in seed:** Hailey, Katina (each has tech + admin card).

**Rules enforced by `checkExactDuplicate`:**
- Second card with same role → `'same-role'` (hard block)
- Third card with any role → `'third-card'` (hard block)
- One tech + one admin → allowed (returns null)

### Roster health check (`rosterHealthCheck`)
Scans full roster, returns issues:
- `'excess-cards'`: >1 tech card or >1 admin card per personKey
- `'near-duplicate'`: two distinct personKeys with Levenshtein distance ≤ 2

---

## Scheduling Rules Baked In

### Provider configs (`src/data/seed.js:585–590`)
```
Dr. R: required=[scribe, opener, closing]  conditional=[middle if patientCount > 70]
Dr. A: required=[scribe, opener, closing]  conditional=[middle if patientCount > 70]
Dr. S: required=[scribe, opener, closing]  conditional=[middle if patientCount > 70]
Dr. B: required=[scribe, opener]           conditional=[closing if patientCount > 17]
```

**Conditional slots ARE implemented** in `src/engine/adapter.js:66–74` — the adapter evaluates `patientCount > 17` and `patientCount > 70` before generating constraints.

**Exception:** Dr. B's conditional closing is hard-overridden in adapter.js:56–59. The adapter ignores `conditionalSlots` for Dr. B entirely and only auto-fills `scribe + opener + active FD slots`. Closing/middle are intentionally left for manual drag-drop on rare high-volume days.

### Dr. B staffing rules (adapter.js:389–485)
- **Yadi → Scribe:** `lockedTo: [{ provider: 'Dr. B', slot: 'scribe' }]` on her person record. `Scribe` role removed from her roles array so the free solver can't pick her up elsewhere.
- **Marisela → Opener:** Hard-coded name-based MUST_PAIR in adapter.js (not via `lockedTo`). Looks up person by `name.trim().toLowerCase() === 'marisela'`. If no such person exists in the roster, the constraint silently skips.
- **Marisela is NOT in seed.js.** The 11 seeded tech staff are: John, JC, Nikole, Yadi, Martha, Alondra, Jaron, Jocelyn, Itzel, Katina, Lizbeth. Marisela must have been added via Setup UI to the live Supabase roster. Verify she exists in live data before relying on the Dr. B opener constraint.
- Closing/Middle/Training for Dr. B: intentionally never auto-generated (hard override in adapter.js:56–59 ignores conditionalSlots config for Dr. B entirely)

### Slot buffer ranges (`src/data/seed.js — roleBufferRange()`)
Single source of truth. Used by both the solver and the UI hours display.

| Slot type | Hours range |
|---|---|
| scribe / middle / training | `[clinicStart, clinicEnd + 75 min]` |
| closer | `[max(9:00 AM, clinicStart), clinicEnd + 75 min]` |
| opener | `[clinicStart − 15 min, clinicEnd + 60 min]` |
| openingFrontDesk | `[clinicStart − 30 min, 15:30]` |
| closingFrontDesk | `[10:30, clinicEnd + 90 min]` |
| frontDesk | `[clinicStart − 30 min, clinicEnd + 90 min]` |
| OBS (Dr. R) | `[clinicStart − 60 min, clinicEnd + 120 min]` |
| OBS (Dr. A) | `[clinicStart − 60 min, clinicEnd + 60 min]` |
| OBS (others) | `[clinicStart, clinicEnd]` |

### Lunch deduction (`lunchDeduct` in seed.js)
- < 5 hours: no deduction
- 5–9 hours: −30 min
- ≥ 9 hours: −60 min

### Dr. R Mon/Fri FD split
`getActiveFDSlots(clinic)` in seed.js. Dr. R Mon/Fri → `[openingFrontDesk, closingFrontDesk]`; all others → `[frontDesk]`. Stale inactive FD keys are cleared by `applySlotMap` on load.

### OBS clinics
Slot types: `['preop', 'preop2', 'sterile', 'circulator', 'scrub']`  
**`preop2` is never auto-filled by solver** (intentional — for manual assignment when a second preop person is needed). Adapter filters it out of required constraints explicitly.

### On-call
On-call rotation stored per-week in Supabase. Informational only — does **not** block any slot assignments in the solver or UI. Staff panel shows who's on-call this week.

### Training slot
Never auto-generated by solver (filtered out in adapter). Manual-only.

---

## Access Control

**Not real auth.** Client-side PIN gate only.

- PIN hardcoded as `'0000'` in `src/components/TopBar.jsx:377`
- Correct PIN + non-empty initials → `setIsAdmin(true)`, `setManagerInitials(initials)`
- No server-side validation, no Supabase RLS, no user accounts
- `isAdmin` controls: edit buttons, slot popovers, task management, standing task checkboxes, clinic open/close toggle, Setup tab, posting
- Staff view (no PIN): read-only, sees only filled slots, no edit controls

---

## Absence System

### Two separate implementations — they use different blocking sets

**⚠️ Inconsistency between solver and UI blocking types:**

| Layer | File | Blocks these types |
|---|---|---|
| Solver/adapter | `src/engine/adapter.js:149` | `'Approved Time Off'`, `'Sick'`, `'Last-Minute Callout'` (explicit allowlist) |
| UI (drag/popover/context) | `src/utils/absenceUtils.js:8` | Everything EXCEPT `'DoctorOff'` and `'Research'` (denylist) |

An absence type not in the adapter's set (e.g. `'Unpaid'`) would block manual assignment in the UI but would NOT block auto-generation by the solver. This is an open inconsistency.

### Solver absence constraints (`src/engine/adapter.js:155–189`)
`computeAbsenceConstraints(absences, weekMonday)` runs before constraint generation. Returns:
- `fullDayAbsent[dayName]` = Set of personKey strings — blocks all assignments that day
- `partialAbsent[dayName]` = array of `{personName, absentStart, absentEnd}` — partial windows checked per-clinic

This was already implemented before the July 2026 sessions. The solver has been absence-aware.

### UI absence blocking (`src/utils/absenceUtils.js`) — added July 2026
Non-blocking: `DoctorOff`, `Research`. Everything else blocks.

Partial-day: strict interval overlap — `slotStart < absenceEnd && slotEnd > absenceStart`. Touching boundaries do NOT block.

**Three UI paths all enforce the check:**
1. Drag-and-drop (`App.jsx handleDragEnd`)
2. Slot popover (`SlotPopover.jsx`) — greys out absent staff with reason label
3. `AppContext assignSlot / assignTask` — hard guard

### Display
`UnassignedStaff.jsx`: Available (unassigned, can work), Unavailable (absent — greyed, non-interactive), permanent day-off staff hidden entirely.

---

## Standing Clinic Tasks (`src/data/seed.js — STANDING_CLINIC_TASKS`)

Checkboxes rendered on matching clinic cards in manager view. Existence is standing (every week); checked state + assignee is per-week only, stored in `__tasks` with `_standingClinicId: clinic.id` marker.

| Label | Location | Day | Provider filter |
|---|---|---|---|
| Inventory | Phoenix | Mon | — |
| Inventory | Estrella | Mon | — |
| Imaging Upload | Estrella | Mon | — |
| Inventory | Chandler | Mon | — |
| Imaging Upload | Phoenix | Tue | Dr. B only |
| Inventory | Scottsdale | Fri | — |

Person picker on each checkbox: filtered to staff currently assigned to any slot in that clinic. Timeless (`start: null, end: null`) — excluded from hour conflict detection.

The `_standingClinicId` field survives `extractSlotMap → applySlotMap` round-trips (not stripped).

---

## Shipped and Verified (as of `d8031c4`)

All items below have tests passing (254/254) and build clean.

| Feature | File(s) | Tests |
|---|---|---|
| Per-week slot/task/config isolation | `slotMap.js`, `AppContext.jsx` | `slotMap.test.js`, `weekIsolation.test.js` |
| Save rollback on Supabase error | `AppContext.jsx` (all 10 mutations) | `saveRollback.test.js` (6) |
| Buffer range single source of truth | `seed.js roleBufferRange()` | `roleBufferRange.test.js` (10) |
| Open/Close pill display + hours | `seed.js`, `ClinicCard.jsx` | `openClosePill.test.js` (31) |
| Absence blocking (drag, popover, context) | `absenceUtils.js`, `SlotPopover.jsx`, `AdditionalTasks.jsx`, `App.jsx`, `AppContext.jsx` | `absenceUtils.test.js` (30), `absences.test.js` (10) |
| Unassigned staff split (Tech vs Admin) | `UnassignedStaff.jsx` | — |
| Roster identity guardrails | `rosterValidation.js`, `Setup.jsx` | `rosterValidation.test.js` (32) |
| Custom task type fix (no persistence) | `AppContext.jsx`, `AdditionalTasks.jsx` | — |
| Standing clinic task checkboxes | `ClinicCard.jsx`, `seed.js` | `slotMap.test.js` (2 round-trip tests) |
| Posted-week edit banner | `App.jsx`, `TopBar.jsx` | — |
| OBS slot handling | `adapter.js`, `slotMap.js` | `obs.test.js` (32) |
| Doctor-off non-blocking | `absenceUtils.js` | `doctor-off.test.js` (1) |
| On-call rotation | `oncall.js`, `AppContext.jsx` | `oncall.test.js` (14) |
| Holiday closures | `AppContext.jsx` | `holidayClosures.test.js` (8) |
| Realtime conflict handling | `AppContext.jsx` | `realtimeHandler.test.js` (10) |

---

## What Is NOT Implemented (Deferred / Future Work)

### Provider-lock rules for John, JC, Katina — NOT YET IN CODE
These rules exist in the real schedule but are not implemented in the solver or enforced anywhere:
- **John always with Dr. R** on days he works
- **JC always with Dr. A** — if Dr. A is off, then with Dr. S
- **Katina can cover tech (not just admin) on Thursdays and Fridays**

These need to be added as `lockedTo` entries on the person records and/or as adapter constraints.

### Auth & RLS
No real auth. PIN `'0000'` is client-side only. All managers share one account. No Supabase RLS. If this becomes multi-org or needs per-user data, this is the first thing to build.

### personId linking (vs name-based matching)
Assignment and absence lookups use `personKey` (normalized name string). If two staff share the same name, they collide. The linked-records model (Hailey/Katina) works because the names are unique. A proper `personId`-based FK system would eliminate this fragility but requires a migration of all stored slot maps.

### AppContext refactor
`AppContext.jsx` is ~2400 lines. It mixes: data fetching, Supabase realtime, all mutations, derived state, history scoring, presence tracking, research overlays, changelog, dirty tracking, and solver dispatch. Works but is a maintenance risk. No specific plan to split it yet.

### Auto-scheduler ("Generate" button)
The solver engine (`src/engine/solver.js`, `adapter.js`) exists and is called from `TopBar.jsx`. It runs a multi-phase greedy + constraint solver. It's functional but the feature is not prominently surfaced in the UI — managers primarily assign manually. No outstanding bugs known.

### Conditional slot for Dr. B closing
`providers` config has `{ slot: 'closing', if: 'patientCount > 17' }` for Dr. B, but adapter.js ignores it (hard-codes scribe + opener only for Dr. B). Closing is intentional manual-only for Dr. B. The provider config entry is vestigial and could be cleaned up.

### Research overlay
`_isResearch: true` ephemeral tasks are stripped by `extractSlotMap` (never persisted). Research assignments live in a separate Supabase table. The feature works but is outside the main scheduling flow.

---

## Test Suite

```
Test Files  16 passed (16)
Tests       254 passed (254)
```

Run with: `npm test`

Build (zero errors): `npm run build`

---

## Key File Map

| File | Role |
|---|---|
| `src/context/AppContext.jsx` | All state, all mutations, Supabase I/O, realtime, solver dispatch |
| `src/context/slotMap.js` | Pure serialize/deserialize: extractSlotMap, applySlotMap, toDefinitionData |
| `src/data/seed.js` | Constants, slot logic, buffer ranges, STANDING_CLINIC_TASKS, seed data |
| `src/engine/solver.js` | Auto-scheduler: constraint-based greedy placement |
| `src/engine/adapter.js` | Translates clinic/people data → solver constraints |
| `src/utils/absenceUtils.js` | Absence overlap, blocking logic, display labels |
| `src/utils/rosterValidation.js` | personKey, checkExactDuplicate, rosterHealthCheck, editDistance |
| `src/components/ClinicCard.jsx` | Clinic card UI, SlotRow, StandingTaskRow |
| `src/components/AdditionalTasks.jsx` | Weekly additional tasks section |
| `src/components/UnassignedStaff.jsx` | Available/unavailable staff panel |
| `src/components/Setup.jsx` | Manager setup: staff, clinics, locations, health check |
| `src/components/TopBar.jsx` | Week nav, PIN gate, post button, solver trigger |
| `src/components/SlotPopover.jsx` | Slot assignment popover with eligibility checking |
| `src/services/dataService.js` | Supabase read/write wrappers |
