# Shiftcraft — Handoff Status

**Last updated:** 2026-07-11
**Live site:** https://shiftcraft-five.vercel.app
**Repo:** https://github.com/jnavajr93/Shiftcraft
**Local path:** /Users/juancnava/shiftcraft

---

## Session 2026-07-11 — commit c4b83a7

### 1. Admin → Manager (TopBar)
Button label changed to "Manager".

### 2. People → Staff tab + Tech/Admin sub-tabs (Setup)
- Main Setup tabs now: **Staff | Clinics | Locations**
- Inside Staff tab: **Tech** and **Admin** sub-tabs with counts
- Tech = everyone where staffType !== 'admin' (null defaults to tech)
- Admin = staffType === 'admin'
- "Add Person" button on the right; new person inherits the active sub-tab type

### 3. staffType field on each person
- `migratePerson` in seed.js adds `staffType: p.staffType ?? null`
- PersonCard: Tech/Admin pill picker below Employment
- AddPersonModal: same picker, prefilled from active sub-tab

### 4. Days-off pills turn red when selected
- `.pill.daysoff.active` in index.css: `background: #dc2626; border-color: #dc2626; color: #fff`
- Both PersonCard and AddPersonModal days-off buttons have `daysoff` class

### 5. Opening FD + Closing FD slots (above Scribe on every clinic card)
Slot order: **Opening FD → Closing FD → Scribe → Opener → Closing → Middle → Training**

- `SLOT_TYPES` in seed.js updated to include the new slots first
- `SLOT_DISPLAY_LABELS` exported from seed.js; card column shows "OPENING FD" / "CLOSING FD"
- `blankStandardSlots()` includes `openingFD: null, closingFD: null`
- `applySlotMap` uses merge pattern so new keys backfill existing week data
- Migration `frontdeskslots` adds keys to any clinics already in Supabase
- Default times: Opening FD = Open → 5PM; Closing FD = 9AM → ~Close
- Click/drag to assign, editable times, included in hours calc
- Role warning suppressed (no role called openingFD/closingFD)
- OpenerTimeEditor and ClosingTimeEditor accept `slotType` prop for reuse
- PersonOverlay handles the new slots in weekly breakdown

---

## Previous session (2026-06-28)

### Supabase shared database
- Replaced localStorage with Supabase for all schedule data
- Real-time sync via supabase.channel
- Tables: `schedule_data` with keys shiftcraft_main, shiftcraft_week_*, shiftcraft_changelog
- Env vars on Vercel: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY

### OBS clinic overhaul
- OBS clinics use 4 fixed roles: preop, sterile, circulator, scrub
- ObsSlotRow component, blankObsSlots helper, obsslots migration

### Other
- SlotPopover double-booking check covers same-clinic other slots
- UnassignedStaff section (admin only)
- Grade badge colors: A=green, B=yellow, C=red

---

## Architecture

```
src/
  supabase.js
  services/dataService.js
  context/AppContext.jsx
  data/seed.js              — SLOT_TYPES, SLOT_DISPLAY_LABELS, OBS_SLOT_TYPES, helpers
  components/
    TopBar.jsx
    Board.jsx
    ClinicCard.jsx          — SlotRow (all 7 slot types) + ObsSlotRow
    SlotPopover.jsx
    Setup.jsx               — Staff (Tech/Admin) | Clinics | Locations
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
- Standard slots: openingFD, closingFD, scribe, opener, closing, middle, training
- OBS slots: preop, sterile, circulator, scrub
