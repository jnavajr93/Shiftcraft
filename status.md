# Shiftcraft Session Status — 2026-07-21

## Completed This Session
- Absence category rework: merged "Partial Day" into "Approved Time Off" with optional time fields; locked palette; `LEGACY_REMAP` for display-time Partial→Approved; fixed validator.js partial-day detection bug
- Research assignments feature (10c4700): purple bars, own legend chip, auto-materializes as board task, hours routing, realtime sync, graceful 42P01 handling
- On-call surfacing rework (8db58aa): removed legend chip; tags appear only when On Call panel is open; one tag per block at its start (change-detection vs previous week, handles overrides); UpcomingPanel also gated
- Doctor Off day panel shortcut (c457764):
  - New "Doctor Off" button in day panel (teal, admin-only, pre-selects DoctorOff type)
  - Action order: Add Absence · Doctor Off · Research · Clinic Closed
  - Clinic Closed de-emphasized (opacity 0.7) — rare location-only catch-all
  - AbsenceModal now accepts `initType` prop for pre-selection
  - Auto-enforcement chain verified end-to-end from day-panel path

**Last commit:** c457764

## Pending
- Create `research_assignments` table in Supabase production (DDL: id uuid PK, person_name text, date date, start_min int, end_min int, note text, entered_by text, created_at timestamptz default now())
- Production smoke test Research: enter 3 weeks out → task on board + personal view with hours; person still assignable; edit + delete; realtime sync
- Production smoke test Doctor Off via day panel: Dr. R off on clinic day → clinics close on board, generation assigns nobody, no gap flag, post blocked if staff assigned; other providers unaffected; Clinic Closed still works independently
