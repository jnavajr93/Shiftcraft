# Shiftcraft Session Status — 2026-07-22

## Completed This Session
- On Call persistence fix (571cdda): echo-suppression ref (`scheduleFromRemoteRef`) added to SCHEDULE_KEY realtime handler in AppContext — same pattern as changelog. Prevented stale Supabase echoes from overwriting On Call flag after toggle.
- Doctor Off color (b7bf399): `#0d9488` (teal) → `#22b8cf` (cyan); single source in `ABSENCE_TYPES`, cascades to legend, bars, DayPanel buttons. Four types now clearly distinct: red / green / blue / cyan / gray.
- "+" add button (b7bf399): hit area 22×22 → 30×30px; still hidden at rest, shows on cell hover, opens day panel.
- Calendar day-click routing bug (b7bf399): `onJumpToWeek` in TopBar now calls `setActiveTab('schedule')` before `jumpToWeek` — clicking any day cell (or "Go to this week") always lands on the board regardless of what tab was active when the calendar opened.

**Last commit:** b7bf399

## Pending
- Create `research_assignments` table in Supabase production (DDL: id uuid PK, person_name text, date date, start_min int, end_min int, note text, entered_by text, created_at timestamptz default now())
- Production smoke test Research: enter 3 weeks out → task on board + personal view with hours; person still assignable; edit + delete; realtime sync
- Production smoke test Doctor Off via day panel: Dr. R off on clinic day → clinics close on board, generation assigns nobody, no gap flag, post blocked if staff assigned; other providers unaffected; Clinic Closed still works independently
- Production smoke test On Call persistence: set 3 techs On Call → reload → still On Call → generate → still On Call → post → still On Call → edit unrelated staff field → still On Call
