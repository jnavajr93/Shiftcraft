# Shiftcraft Session Status — 2026-07-23

## Completed This Session
- On-call visibility for staff (b5653cf): pill on board, on-call row in personal overlay, read-only rotation view (26 weeks forward). See prior entry for full detail.
- Silent failure hardening (2b30169): every DB write failure now produces a visible error the manager cannot miss.
  - All silent `console.error`-only paths wired to `setSaveStatus('error')`: `saveOncall`, `addAbsence`, `editAbsence`, `removeAbsence`, `addCalendarOverride`, `removeCalendarOverride`
  - `saveOncallOverride` / `deleteOncallOverride`: removed 4-second auto-dismiss timer — errors are now persistent
  - Error toast (`⚠ Change not saved — check connection`): persistent until dismissed, has X button, cleared by a successful save. `dismissSaveError` exposed from AppContext.
  - `AbsenceModal`: inline red error banner inside the form on save or delete failure
  - Fire-and-forget handlers (`handleMoveHoliday`, `handleSetHolidayScope`, `handleAddClosure`): now check first-call result and abort on error rather than continuing to a second write
- Research assignment silent-failure hardening (1b0d29e): research_assignments table confirmed in prod (8 columns); all write paths now surface errors.
  - `addResearchAssignment`, `editResearchAssignment`, `removeResearchAssignment` in AppContext: `console.error`-only paths now also call `setSaveStatus('error')` + `clearTimeout`
  - `ResearchModal.handleSave`: checks each `onSave()` result; multi-day insert loop aborts on first error; does not close modal on failure
  - `ResearchModal.handleDelete`: checks result before closing modal
  - Both show inline red banner (`.absence-modal-error`) inside the modal on failure
  - `handleResearchSave` / `handleResearchDelete` in AbsenceCalendar now return the result so modal receives the error signal

**Last commit:** 1b0d29e

## Pending — verify in production
- **Realtime sync test**: open app in two browser windows side by side, run four tests:
  1. Assign a slot in window A → appears in B within ~2 sec (tests week slot channel)
  2. Rename a staff member in A → name updates in B (tests SCHEDULE_KEY channel — the data-loss path)
  3. Add an absence in A → bar appears in B (tests absences channel)
  4. Set an on-call override in A → chip updates in B (tests oncall_overrides channel)
  Report which pass/fail; for failures check browser console for Supabase channel errors.
- **Hardening smoke test**: with DevTools → Network throttled to "Offline", try saving a slot, absence, on-call override, and research entry. Confirm each shows the persistent red error toast. Reconnect, confirm a successful save clears it.
- **Production smoke tests**: Research (enter 3 weeks out, verify board + personal view), Doctor Off (via day panel), On Call persistence (set → reload → generate → post → edit other field)

## Architecture notes
- Data-loss mechanism (documented): `saveSchedule` uses plain upsert (no version gate). When it fails silently and realtime fires from another manager's write, AppContext's SCHEDULE_KEY handler overwrites local state with DB state, discarding the failed write. Now surfaced by the error toast, but root cause (no version gate on global blob) is still present — future hardening.
- RLS plan (Option B, SQL written): key-filtered policies on `schedule_data`; anon reads only `shiftcraft_main` + `shiftcraft_on_call`; authenticated managers get full access. Prerequisite: Supabase Auth + manager login flow must be live first.
- `research_assignments` table: live in prod — id uuid PK, person_name text, date date, start_min int, end_min int, note text, entered_by text, created_at timestamptz.
