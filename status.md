# Shiftcraft Session Status — 2026-07-25

## SHA deployed: 95ca95b

## Work completed this session

### 5. Fix 6 — Posted-week edit banner
- Split the single `unposted-banner` into two visually distinct banners:
  - **`posted-edit-banner`** (orange, left accent border): fires when a POSTED week has been re-edited — "This week is posted — your edits are not visible to staff until you re-post. Last posted X by Y."
  - **`unposted-banner`** (amber, unchanged style): now only fires for NEVER-POSTED weeks — "This schedule has not been posted…"
- Both gated on `isAdmin && isDirty && sessionScheduleChangedRef.current`; calendar-only sessions (absences, doctor-off, on-call, research) never trigger either
- CSS added: `.posted-edit-banner` with light/dark mode variants

### 6. Fix 9 — Test gaps filled (136 → 190 tests, +54)
- `weekIsolation.test.js` (16): slot assignment round-trip A→B→A, clinic config independence (A/B/C), task instance isolation, dirty-flag invariants for config vs assignment changes
- `realtimeHandler.test.js` (13): SCHEDULE_KEY broadcast preserves per-week slot assignments; per-week `__clinicConfig` wins over incoming global defs; BUILTIN_TASK_TYPES merge; originalClinicDefs tracking for new clinics
- `openClosePill.test.js` (31): formatVariableSlotTime null/close, formatOpenerTimeDisplay, formatOpeningFDTimeDisplay, calcSlotHours opener/middle/training null+close semantics, slotEffectiveRange close semantics

---

## Previous work this session

### 1. Open/Close pill fix
- `formatVariableSlotTime`: null start → "Open" (was "?")
- `formatOpenerTimeDisplay`: null/close end → "Close"
- `formatOpeningFDTimeDisplay`: 'close' end → "Close"
- `rawSlotHours` middle/training: 'close' end → `endTime + 60` (was `endTime`)
- `rawSlotHours` opener: null/close end → `endTime + 60` (was `min(1020, endTime)`)
- `slotEffectiveRange` opener: null/close → `endTime + 60`
- Added `case 'middle': case 'training':` to `slotEffectiveRange`
- `ClinicCard.jsx`: added `openSemantic={true}`, `defaultStartIsOpen`, `defaultEndIsClose` props

### 2. Per-week task instance isolation
- **Root cause**: `additionalTasks` (task instances) lived in the global SCHEDULE_KEY record,
  so adding a task in week B made it appear in every week.
- **Fix**: Task instances are now per-week via `__tasks` in the week slot map row.

**Files changed:**
- `src/context/slotMap.js`: `__tasks` in extractSlotMap/applySlotMap/blankSlotMap/toDefinitionData/stripClinicConfig
- `src/context/AppContext.jsx`: `originalTaskDefsRef`, wired into all navigation, auto-save, realtime, clearWeek, copyFromTwoWeeksAgo
- `src/context/__tests__/slotMap.test.js`: 9 new per-week task isolation tests

### 3. Fix 1 — Eliminate solver/seed buffer range duplication
- Added `roleBufferRange()` export to `seed.js` as single source of truth
- `slotEffectiveRange()` in seed.js now delegates to `roleBufferRange`
- `effectiveRange()` in `solver.js` replaced with one-liner wrapper: `return roleBufferRange(...)`
- Old drift bug fixed: solver had `Math.min(1020, e)` for opener end; seed had `e + 60`
- 10 drift-guard tests in `src/engine/__tests__/roleBufferRange.test.js`

### 4. Fix 2 — Rollback on failed Supabase save
- `doSaveWeek()` returns `'ok' | 'conflict' | 'error'` (was `true | false`)
- All 10 optimistic mutations (assignSlot, updateSlotTime, updateClinic, assignTask,
  addTask, removeTask, updateTaskTime, updateTask, applyBulkAssignments, restoreClinicSlots):
  capture `prevData = globalData` before state update; `if (result === 'error') setGlobalData(prevData)`
- `clearWeek` and `copyFromTwoWeeksAgo` (save-first): only update state when `result !== 'error'`
- `importWeekData`: updated from `if (!ok)` to `if (result !== 'ok')`
- Error toast updated: "Change not saved — reverted to last saved state"
- 6 rollback contract tests in `src/context/__tests__/saveRollback.test.js`

## Test results
- 136/136 passing
- Build: zero errors

## Architecture notes

### Global record field classification
| Field | Status |
|---|---|
| people[], locations[], providers[], taskTypes[] | Global |
| clinics[].id/provider/location/day/week | Global |
| clinics[].open/startTime/endTime/patientCount | Global baseline (per-week override in __clinicConfig) |
| clinics[].slots | Per-week (blanked in global record) |
| additionalTasks[].id/label/day/start/end | Global baseline (per-week instances in __tasks) |
| additionalTasks[].assignedPersonId | Per-week (nulled in global record, stored as task:<id>) |

### doSaveWeek return contract
| Value | Meaning | Caller action |
|---|---|---|
| `'ok'` | Saved successfully | Update dirty state, continue |
| `'conflict'` | Version mismatch; DB state already applied to local state | No rollback needed |
| `'error'` | DB not written after retries | Roll back local state |
