# Shiftcraft Session Status — 2026-07-25

## SHA deployed: bf23314

## Work completed this session

### 1. Save toast fix (completed in prior session, confirmed)
- `skipDefinitionSaveRef.current = true` added in `jumpToWeek` (was only in `navigateWeek`)
- `SavedToast` guarded by `isAdmin`

### 2. Med Transport task type (completed in prior session, confirmed)
- `migrateData()` now called on the Supabase "ok" load path (line ~664 in AppContext.jsx)
- `tasktypes_medtransport` localStorage migration added as belt-and-suspenders
- Realtime SCHEDULE_KEY handler merges `BUILTIN_TASK_TYPES`

### 3. Absence enforcement Phase 3 (completed in prior session, confirmed)
- `computeAbsenceConstraints()` in adapter.js
- Full-day → UNAVAILABLE solver constraints
- Partial-day → overlap filter (clinic.startTime < absentEnd && clinic.endTime > absentStart)
- Linked-record support (same display name → block all person IDs)
- Post-gate conflict check in AbsenceCalendar.jsx handleSave
- 10 automated tests in src/engine/absences.test.js

### 4. Per-week task instance isolation (completed this session)
- **Root cause**: `additionalTasks` (task instances) lived in the global SCHEDULE_KEY record,
  so adding a task in week B made it appear in every week.
- **Fix**: Task instances are now per-week via `__tasks` in the week slot map row.

**Files changed:**
- `src/context/slotMap.js`:
  - `extractSlotMap`: stores task defs in `__tasks` (excludes `_isResearch`, strips `assignedPersonId`)
  - `applySlotMap`: uses `map.__tasks ?? tasks ?? []` (per-week list wins; fallback = migration path)
  - `blankSlotMap(clinics)`: signature simplified (no tasks arg), seeds `__tasks: []`
  - `toDefinitionData(globalData, originalClinicDefs, originalTaskDefs)`: third param for task baseline
  - `hasAnyAssignment`: skips `__tasks` key
  - `stripClinicConfig`: also strips `__tasks`; short-circuits if neither key present

- `src/context/AppContext.jsx`:
  - `originalTaskDefsRef = useRef(null)` — mirrors `originalClinicDefsRef`
  - `init()`: captures `originalTaskDefsRef.current` from global data before `applySlotMap`
  - Auto-save: passes `originalTaskDefsRef.current` to `toDefinitionData`
  - `navigateWeek` + `jumpToWeek`: pass `originalTaskDefsRef.current` as task fallback
  - Realtime SCHEDULE_KEY: syncs `originalTaskDefsRef.current` from incoming global record
  - `copyFromTwoWeeksAgo`: strips `__tasks` from source map (keeps current week's task list)
  - `clearWeek`: saves blank map with `__tasks: []`; sets `additionalTasks: []` in state
  - All `blankSlotMap(clinics, tasks)` → `blankSlotMap(clinics)`

- `src/context/__tests__/slotMap.test.js`: 9 new per-week task isolation tests (120 total)

## Migration notes
- Old week rows without `__tasks` fall back to global baseline via `??` chain — no rewrites
- `provider` and `day` on clinics remain global (not per-week)

## Test results
- 120/120 passing
- Build: zero errors

## Global record field classification (final)
| Field | Status |
|---|---|
| people[], locations[], providers[], taskTypes[] | Global |
| clinics[].id/provider/location/day/week | Global |
| clinics[].open/startTime/endTime/patientCount | Global baseline (per-week override in __clinicConfig) |
| clinics[].slots | Per-week (blanked in global record) |
| additionalTasks[].id/label/day/start/end | Global baseline (per-week instances in __tasks) |
| additionalTasks[].assignedPersonId | Per-week (nulled in global record, stored as task:<id>) |
