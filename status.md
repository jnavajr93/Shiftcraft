# Shiftcraft — Handoff Status

**Last updated:** 2026-07-16
**Live site:** https://shiftcraft-five.vercel.app
**Repo:** https://github.com/jnavajr93/Shiftcraft
**Local path:** /Users/juancnava/shiftcraft

---

## Session 2026-07-16 — commit a047593

### CRITICAL data-loss fix — blank week overwriting real assignments on load failure

**Root cause confirmed:** `loadWeekSlotMap` returned `null` for both "row doesn't exist yet" and
"network/timeout error". The `init()` function treated both identically: generate a blank slot map
and write it to Supabase — silently destroying a full week of work on any transient connection
failure (Supabase cold start, network blip, etc.).

### What changed

#### `src/services/dataService.js`
- `loadSchedule` and `loadWeekSlotMap` now return a **discriminated union result**:
  - `{ status: 'ok', data }` — row found
  - `{ status: 'empty' }` — PGRST116 (no rows) — safe to seed blank
  - `{ status: 'error', error }` — network/timeout/permissions — **never write**
- `saveSchedule` and `saveWeekSlotMap` now return `{ error }` so callers can check

#### `src/context/AppContext.jsx`
- **`init()`** — 3-way result handling:
  - `ok` → use cloud data (never fall through to localStorage)
  - `empty` → seed from localStorage migration or blank (cloud confirmed absent)
  - `error` → set `loadError` state, show blocking banner, **abort without writing anything**
- **`doSaveWeek(weekStr, map)`** — new awaited save helper:
  - Awaits `saveWeekSlotMapDB`, retries once on failure (1.2s delay)
  - Sets `saveStatus` to `'saving'` → `'saved'` → back to `'idle'` after 3s
  - Sets `saveStatus` to `'error'` if both attempts fail (never silently swallows)
- All 10 week-saving callbacks now use `doSaveWeek`:
  `assignSlot`, `updateClinic`, `updateSlotTime`, `assignTask`, `addTask`,
  `clearWeek`, `applyBulkAssignments`, `restoreClinicSlots`, `navigateWeek`, `jumpToWeek`
- `navigateWeek` / `jumpToWeek` — current week save is **awaited before navigating**;
  load of next week uses 3-way result (error → stays on current week)
- Shadow clinic cleanup **DISABLED** — previously blanked all shadow-clinic slots across ALL
  Supabase week rows on any device without the migration flag; now just sets the flag
- `savedToast` removed from context (replaced by `saveStatus`)
- Context now exposes: `loadError`, `saveStatus`, `lastSaved`

#### `src/App.jsx`
- `loadError` renders a full-screen blocking banner with a Refresh button
- `saveStatus === 'error'` renders a red toast: "⚠ Change not saved — check connection"
- `saveStatus === 'saved'` renders the existing green "✓ Saved" toast

#### `src/components/TopBar.jsx`
- Save indicator now reflects actual `saveStatus`:
  - `saving` → "Saving…" (muted)
  - `saved` / `idle` → "Saved X ago" (existing label, muted)
  - `error` → "⚠ Unsaved changes" (red, bold)

### Remaining fire-and-forget saves (intentional, all safe)
These are write-to-confirmed-empty-row operations where no existing data can be overwritten:
- First-time install seed to `shiftcraft_main`
- New week first-time seed after confirmed `status:'empty'` from Supabase
- localStorage → Supabase migration (only runs when cloud row is confirmed absent)
- `deletePerson` best-effort async scrub across all week rows

### Known open issues / next steps
- **Realtime overwrite** — still present: incoming Supabase realtime events fully replace local
  state without merge logic. If a stale tab/user saves, it can overwrite a newer session.
  Diagnosis is confirmed; fix not yet implemented.
- The `savedToast` / `lastSaved` timer that previously fired on any state change (not on actual
  save confirmation) has been removed. All save feedback is now driven by `saveStatus`.

---

## Previous session (2026-07-11) — commit c4b83a7

### Changes
1. Admin → Manager (TopBar label)
2. People → Staff tab + Tech/Admin sub-tabs (Setup)
3. `staffType` field on each person (Tech/Admin pill picker)
4. Days-off pills turn red when selected
5. Opening FD + Closing FD slots (above Scribe on every clinic card)

Slot order: **Opening FD → Closing FD → Scribe → Opener → Closing → Middle → Training**

---

## Previous session (2026-06-28)

### Supabase shared database
- Replaced localStorage with Supabase for all schedule data
- Real-time sync via supabase.channel
- Tables: `schedule_data` with keys shiftcraft_main, shiftcraft_week_*, shiftcraft_changelog

### OBS clinic overhaul
- OBS clinics use 4 fixed roles: preop, sterile, circulator, scrub
- ObsSlotRow component, blankObsSlots helper, obsslots migration

---

## Architecture

```
src/
  supabase.js
  services/dataService.js       — load functions return { status, data?, error? }
  context/AppContext.jsx         — doSaveWeek, loadError, saveStatus
  data/seed.js                   — SLOT_TYPES, SLOT_DISPLAY_LABELS, OBS_SLOT_TYPES, helpers
  components/
    TopBar.jsx                   — saveStatus indicator
    Board.jsx
    ClinicCard.jsx               — SlotRow (all 7 slot types) + ObsSlotRow
    SlotPopover.jsx
    Setup.jsx                    — Staff (Tech/Admin) | Clinics | Locations
    PersonOverlay.jsx
    AdditionalTasks.jsx
    UnassignedStaff.jsx
    HoursBar.jsx
    ConflictBanner.jsx
    Sidebar.jsx
```

## Data model
- `shiftcraft_main` — global defs (people with staffType, clinics with blank slots)
- `shiftcraft_week_*` — per-week slot assignments
- Standard slots: openingFrontDesk, closingFrontDesk, frontDesk, scribe, opener, closing, middle, training
- OBS slots: preop, sterile, circulator, scrub
