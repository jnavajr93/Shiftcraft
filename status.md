# Shiftcraft Session Status — 2026-07-25

## Deployed SHA
`8a90953` — https://shiftcraft-azretvit.vercel.app

## Completed this session

### Med Transport dropdown (3rd report — now fixed)
**Root cause confirmed:** `migrateData()` (which merges `BUILTIN_TASK_TYPES`) was only called on the localStorage/empty Supabase path, never on the normal "ok" Supabase load path. Every page load from Supabase returned raw `taskTypes` without Med Transport.
**Fix:** `init()` now calls `migrateData(schedResult.data)` on the Supabase "ok" path. Added `tasktypes_medtransport` migration (idempotent, saves to Supabase so it persists).

### Save toast fixes (from prior session, now committed)
- `skipDefinitionSaveRef` set in both `navigateWeek` AND `jumpToWeek` — navigation no longer triggers "✓ Saved"
- `SavedToast` guarded by `isAdmin` — staff view never sees the toast

### Realtime SCHEDULE_KEY fix (from prior session, now committed)
- BUILTIN_TASK_TYPES merged into incoming `value.taskTypes` so a broadcast from a stale Supabase record cannot wipe Med Transport

### Absence enforcement — Phase 3 (NEW)
Absences are now a hard rule in schedule generation:

**Full-day absences** (Approved Time Off, Sick, Last-Minute Callout) add `UNAVAILABLE` solver constraints — the person gets zero clinic/OBS slot assignments that day.

**Partial-day absences** post-filter assignments: if a clinic's time range overlaps the absent window (`clinic.startTime < absentEnd && clinic.endTime > absentStart`), the assignment is dropped.

**Linked records** (Hailey tech + Hailey admin, Katina tech + Katina admin): matched by display name → all person IDs blocked by one absence entry.

**Post gate** in `AbsenceCalendar.handleSave`: before saving a personal absence, checks current week's slot map for conflicts. If the person has assignments on those dates, blocks save with named conflicts: person name, date, slot type, clinic/provider.

**10 vitest tests** covering all spec requirements:
- Full-day absent → zero assignments that day, other days unaffected
- Multi-day range → zero assignments across every covered day
- Partial-day → not assigned to overlapping shifts
- Linked-record → both tech and admin records blocked
- Regression: no absences = identical generation; Research/DoctorOff types not blocked

## Test totals
`111 tests, 9 test files — all pass`

## Nothing pending
All reported bugs fixed and deployed.
