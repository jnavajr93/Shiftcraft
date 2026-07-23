# Shiftcraft Session Status — 2026-07-22

## Completed This Session
- On-call visibility for staff (b5653cf): three-part feature —
  1. **Staff board pill**: amber pill showing on-call tech for viewed week, right of the standing notice. Updates on week navigation. Hidden when rotation not configured. Desktop (Board.jsx) + mobile (MobileStaffView.jsx).
  2. **Personal overlay row**: clickable amber row showing "On Call: [date range]" or "On Call Now: [date range]" for rotation members; omitted for non-members. In both PersonOverlay and MobileStaffView "My Schedule" sheet.
  3. **Read-only rotation view** (OnCallRotationView.jsx): 26-week forward view grouped by consecutive same-person blocks, reflects overrides. Full-screen on mobile, centered modal on desktop. Opened from either pill or overlay row. Contains ONLY on-call data — no absences, closures, doctor-off, research. Closes via X, backdrop click, or Escape.
  - New oncall.js exports: `getPersonNextBlock` (computes next block for a named person from rotation math) and `formatBlockRange` (ISO weeks → "Aug 3–28" display).

**Last commit:** b5653cf

## Pending
- Create `research_assignments` table in Supabase production (DDL: id uuid PK, person_name text, date date, start_min int, end_min int, note text, entered_by text, created_at timestamptz default now())
- Production smoke test Research: enter 3 weeks out → task on board + personal view with hours; person still assignable; edit + delete; realtime sync
- Production smoke test Doctor Off via day panel: Dr. R off on clinic day → clinics close on board, generation assigns nobody, no gap flag, post blocked if staff assigned; other providers unaffected; Clinic Closed still works independently
- Production smoke test On Call persistence: set 3 techs On Call → reload → still On Call → generate → still On Call → post → still On Call → edit unrelated staff field → still On Call
- Verify new on-call staff feature: pill shows correct tech for viewed week and updates on navigation; personal overlay shows next block for rotation member, omits for non-member; rotation view opens from both entry points, shows blocks months out, reflects overrides, exposes no absence data, is read-only; manager mode unchanged.
