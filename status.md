# Shiftcraft — Handoff Status

**Last updated:** 2026-06-28  
**Live site:** https://shiftcraft-five.vercel.app  
**Repo:** https://github.com/jnavajr93/Shiftcraft  
**Local path:** /Users/juancnava/shiftcraft  

---

## What was done this session

### Supabase shared database (commit 8a80a1e)
- Replaced localStorage as the primary data store with Supabase
- All users now see the same schedule in real time
- Real-time sync via `supabase.channel` — changes in browser A appear in browser B within ~2s
- On first load, existing localStorage data auto-migrates to Supabase
- localStorage kept only for: theme preference, migration flags (one-time booleans)
- New files: `src/supabase.js`, `src/services/dataService.js`
- Supabase table: `schedule_data` with columns `key TEXT PRIMARY KEY`, `value JSONB`, `updated_at TIMESTAMPTZ`
- Three key types in the table:
  - `shiftcraft_main` — global definitions (people, clinics, locations, task types)
  - `shiftcraft_week_{weekStr}` — per-week slot assignments (e.g. `shiftcraft_week_2026-W26`)
  - `shiftcraft_changelog` — changelog entries
- Loading screen shown while Supabase fetch completes
- Env vars needed on Vercel: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

### OBS clinic overhaul (commits 7e329db, 832257b, de531c2)
- OBS clinics (thu-obs, fri-obs) now use 4 fixed roles instead of standard scribe/opener/etc.
- `OBS_SLOT_TYPES = ['preop', 'sterile', 'circulator', 'scrub']` exported from seed.js
- Display labels: `preop → Pre-Op/PACU`, `sterile → Sterile Processing`, `circulator → Circulator`, `scrub → Scrub Tech`
- `ObsSlotRow` component in ClinicCard.jsx — no time editors, no role warnings
- `blankObsSlots()` / `blankStandardSlots()` helpers in AppContext for correct slot initialization
- `obsslots` migration converts any existing OBS clinics that had standard slots
- Warning triangles (AlertTriangle) now only show when `isAdmin` is true

### OBS role gating (commits 750f16a, 69765dc)
- Added 4 OBS roles to `ROLES` in seed.js: `'Pre-Op/PACU'`, `'Sterile Processing'`, `'Circulator'`, `'Scrub Tech'`
- These appear as toggleable chips in the staff card (Setup.jsx) alongside standard roles
- SlotPopover now checks OBS role eligibility per slot: preop→Pre-Op/PACU, sterile→Sterile Processing, etc.
- Staff without the matching OBS role show as "Ineligible — Role not in their list" in the popover

### Other fixes (commits 12ebb04, 94dc234, b68130d)
- "Already assigned today" in SlotPopover now catches same-clinic other slots (not just other clinics), excluding only the exact slot:clinicId pair that opened the popover
- **Unassigned Staff section** added below Additional Tasks — admin only, shows per-day chips for staff with no clinic slots, no tasks, and no day-off on that day (`src/components/UnassignedStaff.jsx`)
- Grade badge colors changed: A=green (#16a34a), B=yellow (#ca8a04), C=red (#dc2626)

---

## Current architecture

```
src/
  supabase.js                  — Supabase client (reads VITE_ env vars)
  services/dataService.js      — save/load helpers for Supabase
  context/AppContext.jsx        — all state, async init from Supabase, real-time sub
  data/seed.js                 — ROLES, SLOT_TYPES, OBS_SLOT_TYPES, seed data, helpers
  components/
    App.jsx                    — root layout, DnD context
    Board.jsx                  — main clinic grid (Mon–Fri columns)
    ClinicCard.jsx             — per-clinic card, SlotRow + ObsSlotRow
    SlotPopover.jsx            — person picker with eligibility logic
    AdditionalTasks.jsx        — tasks below the board
    UnassignedStaff.jsx        — unassigned staff section (admin only)
    Sidebar.jsx                — staff list (admin only)
    HoursBar.jsx               — weekly hours totals (admin only)
    ConflictBanner.jsx         — double-booking warnings
    Setup.jsx                  — staff/clinic management tab
    PersonOverlay.jsx          — staff detail overlay
```

## Data model notes
- Clinic slots are stored separately from clinic definitions
- `shiftcraft_main` saves clinic definitions with **blank** slots (no assignments)
- Per-week assignments live in `shiftcraft_week_*` rows
- OBS slots use `{ personId: null }` object form (not string/null like opener/closing)
- `getSlotPersonId(slotVal)` handles all slot value shapes

## Known / potential next steps (not started)
- The "remaining staff pool" idea was discussed but not built beyond UnassignedStaff
- `deletePerson` cleans up Supabase week rows fire-and-forget; no UI confirmation yet
- `removeClinic` does not clean up Supabase week rows for that clinic (cosmetic only)
- Chunk size warning on build (572kb JS) — could be code-split if needed
