# Shiftcraft Session Status — 2026-07-21

## Completed This Session
- Absence category rework: merged "Partial Day" into "Approved Time Off" with optional time fields; locked palette (Last-Minute Callout red, Approved green, Sick blue, Tech On Call amber, Doctor Off teal, Closed/Holiday gray); `LEGACY_REMAP` for display-time Partial→Approved without DB migration; fixed validator.js bug (lowercase 'partial' vs capitalized DB value)
- Research assignments feature (commit 10c4700):
  - Calendar entry in manager mode — purple #8b5cf6 bars + legend chip
  - Supabase table `research_assignments` with graceful 42P01 handling
  - Auto-materializes as Additional Task on board when week arrives
  - Carries hours through effectiveAdditionalTasks (HoursBar, PersonOverlay, Sidebar, MobileStaffView)
  - `data.additionalTasks` (slot map) stays manual-tasks-only — research does NOT pollute Supabase week slots
  - Realtime sync via postgres_changes subscription
- On-call surfacing rework (commit 8db58aa):
  - Removed Tech On Call chip from absence legend
  - Tags appear ONLY while On Call panel is open
  - Exactly ONE tag per 4-week block at its start (detects person change vs previous week; handles overrides)
  - Clicking a tag opens the override popover
  - UpcomingPanel on-call section also gated by panel open state

**Last commit:** 8db58aa

## Pending
- Create `research_assignments` table in Supabase production (DDL: id uuid PK, person_name text, date date, start_min int, end_min int, note text, entered_by text, created_at timestamptz default now())
- Production smoke test Research: enter 3 weeks out → navigate → task appears on board + personal view with hours; person still assignable; edit + delete work; realtime sync
- Production smoke test On-call: open On Call panel → block-start tags appear; close panel → tags gone; override a week → tag reflects new person at that week
