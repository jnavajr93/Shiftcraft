# Shiftcraft Session Status — 2026-07-29

## SHA deployed: 3658ada

## Work completed this session

### On-call visibility improvements

**Goal:** Make on-call schedule visible across all parts of the app — shiftboard, individual staff cards, personal overlay, and a new calendar view.

---

#### 1. OnCallRotationView — list / calendar toggle

- Added a **List | Calendar** toggle (icon buttons) in the header
- **List view** — unchanged; shows next 26 weeks as before
- **Calendar view** — new; shows next 4 months as month grids
  - Each day cell is colored with the on-call person's color (low opacity)
  - First name of the person appears on the Monday that starts their block
  - Today's date highlighted with accent circle
  - Weekend cells dimmed at 55% opacity
- **Files changed:** `src/components/OnCallRotationView.jsx`, `src/index.css`

---

#### 2. Sidebar PersonCard — on-call badges

- Each person row in the Staff sidebar now shows a badge when relevant:
  - **"On Call"** (amber solid) — person is currently on call this week
  - **"Next"** (amber outlined) — person is next up in the rotation
- Badges appear inline after the person's name in the sidebar row
- **Files changed:** `src/components/Sidebar.jsx`

---

#### 3. Sidebar StaffHoverCard — on-call section

- Admin hover card now has an on-call section at the bottom:
  - Shows "On Call Now" label + date range if person is currently on call
  - Shows "On Call Next" label + date range if person is up next
- **Files changed:** `src/components/Sidebar.jsx`

---

#### 4. Board — admin also sees on-call pill

- `onCallForWeek` now computed for all users (removed `!isAdmin` guard)
- Admin view shows `admin-oncall-bar` above day headers: "On Call This Week: [name]"
- Staff notice bar unchanged
- **Files changed:** `src/components/Board.jsx`, `src/index.css`

---

#### 5. PersonOverlay — on-call info visible to admins

- Removed `!isAdmin` guard on on-call block row in PersonOverlay
- Both admin and staff now see on-call dates when viewing any person's card
- **Files changed:** `src/components/PersonOverlay.jsx`
