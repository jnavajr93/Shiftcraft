# Shiftcraft Session Status — 2026-07-29

## SHA deployed: 169ba51

## Deployed URL: https://shiftcraft-azretvit.vercel.app

---

## Work completed this session

### On-call visibility improvements (staff-only)

- **OnCallRotationView** — added List | Calendar toggle; calendar shows 4 months as month grids with person color, first name on Monday, today highlighted
- **Board staff notice bar** — on-call pill shows "On Call: [name]" (staff-only, no dates)
- **PersonOverlay** — on-call row moved to top (below name, above Monday row), staff-only
- **TopBar** — removed duplicate on-call badge from topbar center
- **AbsenceCalendar** — on-call blocks shown as amber bars in calendar cells; "On Call" legend filter (defaults on, lane 0, other bars shift down by 1)

---

### Triage tab + staffType + tour removal (2026-07-29)

#### 1. Tours removed
- `TourProvider` made a no-op — renders children only, no welcome card, no tooltips, no localStorage
- `<TourProvider>` wrapper removed from `App.jsx`
- **Files changed:** `src/components/Tour.jsx`, `src/App.jsx`

#### 2. Roster Health removed
- Removed "Roster Health" button and modal from Setup page
- **Files changed:** `src/components/Setup.jsx`

#### 3. Triage staffType added
- Third staffType option: `tech` | `admin` | `triage`
- Setup Staff section now has Tech / Admin / Triage sub-tabs with counts
- Tech sub-tab excludes both `admin` and `triage` types
- **Files changed:** `src/components/Setup.jsx`

#### 4. Clinics | Triage tab switcher
- `boardTab` state (`'clinics'` | `'triage'`) added to `App.jsx`
- `BoardTabBar` segmented control renders above board in desktop view
- Mobile: `boardTab`/`setBoardTab` passed to `MobileStaffView` which renders `BoardTabBar`
- `HoursBar` only shown when `boardTab === 'clinics'` (manager mode)
- **Files changed:** `src/App.jsx`, `src/components/MobileStaffView.jsx`, `src/index.css`

#### 5. TriageBoard component
- Weekly grid: Mon–Fri columns, role rows:
  - Scanning / Sorting / Records
  - NP Calls
  - Phreesia
  - Triage & Overflow (multi-person)
  - NP Attachments
  - Lunch 12PM → Lunch / Phone Coverage
  - Lunch 1PM → Lunch / Phone Coverage
- Manager: clickable cells, inline picker to assign triage staff
- Staff: read-only, own name highlighted amber
- Data stored per-week in Supabase: `shiftcraft_triage_{weekStr}`
- **Files created:** `src/components/TriageBoard.jsx`
- **Files changed:** `src/services/dataService.js`, `src/context/AppContext.jsx`, `src/index.css`

---

## Next steps

- Go to Setup → Staff → Triage sub-tab to assign triage staffType to triage team members
- In Triage tab, manager can click cells to assign triage staff per role/day
- Staff assigned as `triage` type will see their name highlighted amber in the Triage board
