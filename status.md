# Shiftcraft Session Status — 2026-07-16

## Completed this session

All 5 features from the previous session (phantom FD slots, invalid OBS slots, Dr. B minimal staffing,
Dr. B no-substitutes, Dr. R split-day) were already done. This session implemented:

### Feature: Schedule learning from history

**What it does:**
- Every generated and manual slot assignment is recorded to `shiftcraft_placement_history` in Supabase
- Rolling 52-week window; entries older than 52 weeks are pruned on next write
- Manual edits/adds count 3× vs generated (higher signal)
- Pattern scores are computed as a soft tiebreaker when the solver has multiple eligible candidates
- AI chat system prompt now includes top 15 active patterns as context
- New **Patterns panel** (TrendingUp icon in topbar, admin-only) shows learned preferences in plain language
  with a per-pattern dismiss/ignore toggle stored in `shiftcraft_dismissed_patterns`

**Files added:**
- `src/data/patterns.js` — `computeHistoryScores`, `computePatterns`, `buildPatternSummary`, `patternKey`
- `src/components/PatternsPanel.jsx` — patterns panel UI with dismiss/restore

**Files modified:**
- `src/services/dataService.js` — 4 new CRUD functions for history + dismissed patterns
- `src/context/AppContext.jsx` — `placementHistory`, `dismissedPatterns`, `historyScores` state;
  `appendHistory`, `dismissPattern`, `undismissPattern` callbacks; history recording in
  `assignSlot` and `applyBulkAssignments`
- `src/engine/solver.js` — optional `scoreFn` param to `solve()` and `fillShift()`
- `src/engine/adapter.js` — pass `historyScores → scoreFn` to solver via `options.historyScores`
- `src/components/ChatPanel.jsx` — `buildPatternSummary` injected into system prompt
- `src/components/TopBar.jsx` — Patterns panel button (TrendingUp); passes `historyScores` to
  `generateSchedule(data, { historyScores })`

**Commit:** cf57cfd  
**Branch:** main (pushed to GitHub)

## Architecture notes

Pattern key format: `personName:day:location:slotType` — all lowercase, location underscored
(matches `toLocationId()` in adapter.js). E.g. `john:mon:chandler:scribe`.

History recording:
- `assignSlot` → source = 'manual-edit' (replacing existing person) or 'manual-add' (empty slot)
- `applyBulkAssignments` → source = 'generated'

The solver tiebreaker only kicks in when 2+ candidates pass all hard rules. It never overrides
availability, OBS precedence, day-off, Dr. B no-substitute, or any other hard constraint.

## Nothing pending

All requested features have been implemented.
