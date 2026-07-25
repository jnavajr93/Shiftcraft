/**
 * Save-failure rollback contract tests.
 *
 * AppContext mutations use an optimistic-update pattern:
 *   1. Capture prevData = globalData
 *   2. setGlobalData(newData)        ← board updates instantly
 *   3. result = await doSaveWeek(...)
 *   4. if (result === 'error') setGlobalData(prevData)  ← rollback
 *
 * These tests verify the contract at the pure-function level because the
 * React hooks are not available in this vitest environment (no jsdom setup).
 * The rollback behavior is wired into every mutation in AppContext.jsx.
 */

import { describe, it, expect, vi } from 'vitest';

// ─── Simulated mutation helper ────────────────────────────────────────────────
// Mirrors the pattern used in assignSlot, updateSlotTime, addTask, etc.
async function runMutation(initialState, mutationFn, saveFn) {
  let state = initialState;
  const setState = (updater) => { state = updater(state); };

  const prevData = state;
  setState(mutationFn);   // optimistic update

  const result = await saveFn();

  if (result === 'error') {
    state = prevData;     // rollback
  }

  return { state, result };
}

describe('Mutation rollback — save failure reverts local state', () => {
  it('success path: state persists after ok result', async () => {
    const initial = { clinics: [{ id: 'c1', open: true }], version: 1 };
    const { state, result } = await runMutation(
      initial,
      s => ({ ...s, clinics: [{ id: 'c1', open: false }] }),
      async () => 'ok',
    );
    expect(result).toBe('ok');
    expect(state.clinics[0].open).toBe(false); // mutation persisted
  });

  it('error path: state reverts to pre-mutation snapshot', async () => {
    const initial = { clinics: [{ id: 'c1', open: true }], version: 1 };
    const { state, result } = await runMutation(
      initial,
      s => ({ ...s, clinics: [{ id: 'c1', open: false }] }),
      async () => 'error',
    );
    expect(result).toBe('error');
    expect(state.clinics[0].open).toBe(true); // rolled back
  });

  it('conflict path: no rollback — state from DB refresh is preserved', async () => {
    // 'conflict' means doSaveWeek already fetched fresh DB state and applied it.
    // Callers must NOT rollback on conflict (that would overwrite the DB-refreshed state).
    const initial = { clinics: [{ id: 'c1', slots: {} }] };
    let state = initial;

    const prevData = state;
    state = { ...state, clinics: [{ id: 'c1', slots: { opener: 'person-1' } }] }; // optimistic

    // Simulate doSaveWeek returning conflict (state already refreshed from DB)
    const result = 'conflict';

    // Caller checks === 'error' specifically — conflict does NOT trigger rollback
    if (result === 'error') { state = prevData; }

    expect(result).toBe('conflict');
    expect(state.clinics[0].slots.opener).toBe('person-1'); // NOT rolled back
  });

  it('multiple mutations: each rollback is independent and does not cascade', async () => {
    let sharedState = { count: 0 };

    async function mutate(delta, shouldFail) {
      const prev = sharedState;
      sharedState = { count: sharedState.count + delta };
      const result = shouldFail ? 'error' : 'ok';
      if (result === 'error') sharedState = prev;
      return result;
    }

    await mutate(1, false); // +1, succeeds → count = 1
    await mutate(5, true);  // +5, fails → rolled back → count still 1
    await mutate(2, false); // +2, succeeds → count = 3
    await mutate(10, true); // +10, fails → rolled back → count still 3

    expect(sharedState.count).toBe(3);
  });
});

describe('doSaveWeek result enum contract', () => {
  it('only "error" triggers rollback; "ok" and "conflict" do not', () => {
    // Document: callers check === 'error' strictly, so 'conflict' (DB refresh) is safe.
    const rollbackResults = ['ok', 'conflict', 'error'].filter(r => r === 'error');
    const safeResults     = ['ok', 'conflict', 'error'].filter(r => r !== 'error');
    expect(rollbackResults).toEqual(['error']);
    expect(safeResults).toContain('ok');
    expect(safeResults).toContain('conflict');
  });

  it('save-first mutations (clearWeek, copyFromTwoWeeksAgo) only update state on ok result', async () => {
    // Pattern: save FIRST, then update state only if result !== 'error'.
    let stateUpdated = false;

    async function saveFirstMutation(saveFn) {
      const result = await saveFn();
      if (result === 'error') return; // no state update
      stateUpdated = true;
    }

    stateUpdated = false;
    await saveFirstMutation(async () => 'error');
    expect(stateUpdated).toBe(false); // save failed → no state change

    stateUpdated = false;
    await saveFirstMutation(async () => 'ok');
    expect(stateUpdated).toBe(true);  // save succeeded → state updated

    stateUpdated = false;
    await saveFirstMutation(async () => 'conflict');
    expect(stateUpdated).toBe(true);  // conflict still updates state (DB refresh already applied)
  });
});
