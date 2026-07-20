import { supabase } from '../supabase'

export const SCHEDULE_KEY = 'shiftcraft_main'
export const CHANGELOG_KEY = 'shiftcraft_changelog'

export function weekKey(weekStr) {
  return `shiftcraft_week_${weekStr}`
}

// ─── Load result types ────────────────────────
// { status: 'ok', data }        — row found and returned
// { status: 'empty' }           — query succeeded, row does not exist (PGRST116)
// { status: 'error', error }    — network / timeout / permission failure
//
// NEVER treat 'error' the same as 'empty'. Only 'empty' is safe to seed/overwrite.

// ─── Global schedule (clinic definitions, people, locations) ──
export async function saveSchedule(data) {
  const { error } = await supabase
    .from('schedule_data')
    .upsert({ key: SCHEDULE_KEY, value: data, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) console.error('[Shiftcraft] Save schedule error:', error)
  return { error: error ?? null }
}

export async function loadSchedule() {
  const { data, error } = await supabase
    .from('schedule_data')
    .select('value')
    .eq('key', SCHEDULE_KEY)
    .single()
  if (error) {
    // PGRST116 = "The result contains 0 rows" — row genuinely does not exist
    if (error.code === 'PGRST116') return { status: 'empty' }
    // Any other error (network, timeout, permissions) — do not treat as missing data
    return { status: 'error', error }
  }
  if (!data?.value) return { status: 'empty' }
  return { status: 'ok', data: data.value }
}

// ─── Per-week slot maps ───────────────────────
// Versioned save — uses the upsert_schedule_data RPC for atomic optimistic concurrency.
// Falls back to plain upsert if the RPC doesn't exist yet (pre-migration).
//
// loadedVersion = null   → first write (no version check)
// loadedVersion = number → conditional update; returns conflict:true if mismatch
//
// Return shape: { error, newVersion, conflict }
export async function saveWeekSlotMap(weekStr, map, loadedVersion = null) {
  const { data, error } = await supabase.rpc('upsert_schedule_data', {
    p_key:            weekKey(weekStr),
    p_value:          map,
    p_loaded_version: loadedVersion ?? null,
  })
  if (error) {
    // RPC not found (pre-migration) — fall back to unconditional upsert.
    // No concurrency protection yet, but saves succeed so nothing is lost.
    const { error: e2 } = await supabase
      .from('schedule_data')
      .upsert(
        { key: weekKey(weekStr), value: map, updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      )
    if (e2) {
      console.error('[Shiftcraft] Save week error:', e2)
      return { error: e2, newVersion: null, conflict: false }
    }
    return { error: null, newVersion: null, conflict: false }
  }
  // data = new version number, or null when version didn't match (conflict)
  if (data === null || data === undefined) {
    return { error: null, newVersion: null, conflict: true }
  }
  return { error: null, newVersion: data, conflict: false }
}

export async function deleteWeekSlotMap(weekStr) {
  const { error } = await supabase
    .from('schedule_data')
    .delete()
    .eq('key', weekKey(weekStr))
  if (error) console.error('[Shiftcraft] Delete week error:', error)
  return { error: error ?? null }
}

// Returns { status, data, version } — version is null if column not yet populated.
// Uses select('*') so PostgREST never errors on a missing version column:
// the column is simply absent from the result and data.version resolves to null.
export async function loadWeekSlotMap(weekStr) {
  const { data, error } = await supabase
    .from('schedule_data')
    .select('*')
    .eq('key', weekKey(weekStr))
    .single()
  if (error) {
    if (error.code === 'PGRST116') return { status: 'empty' }
    return { status: 'error', error }
  }
  if (!data?.value) return { status: 'empty' }
  return { status: 'ok', data: data.value, version: data.version ?? null }
}

// ─── Placement history ───────────────────────
export const HISTORY_KEY   = 'shiftcraft_placement_history';
export const DISMISSED_KEY = 'shiftcraft_dismissed_patterns';

export async function loadPlacementHistory() {
  const { data, error } = await supabase
    .from('schedule_data')
    .select('value')
    .eq('key', HISTORY_KEY)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return { status: 'empty' };
    return { status: 'error', error };
  }
  return { status: 'ok', data: data?.value ?? [] };
}

export async function savePlacementHistory(entries) {
  const { error } = await supabase
    .from('schedule_data')
    .upsert({ key: HISTORY_KEY, value: entries, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) console.error('[Shiftcraft] Save history error:', error);
  return { error: error ?? null };
}

export async function loadDismissedPatterns() {
  const { data, error } = await supabase
    .from('schedule_data')
    .select('value')
    .eq('key', DISMISSED_KEY)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return { status: 'empty' };
    return { status: 'error', error };
  }
  return { status: 'ok', data: data?.value ?? [] };
}

export async function saveDismissedPatterns(keys) {
  const { error } = await supabase
    .from('schedule_data')
    .upsert({ key: DISMISSED_KEY, value: keys, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) console.error('[Shiftcraft] Save dismissed patterns error:', error);
  return { error: error ?? null };
}

// ─── Posted schedule snapshots ───────────────
// Snapshot = slotMap ({ [clinicId]: {...slots}, [`task:${id}`]: personId|null })
// stored in posted_schedules.snapshot (jsonb). Append-only — every Post writes
// a new row. Staff view reads the MAX(posted_at) row per week_key.

export async function fetchLatestPostedSnapshot(wk) {
  const { data, error } = await supabase
    .from('posted_schedules')
    .select('id, snapshot, posted_at, posted_by')
    .eq('week_key', wk)
    .order('posted_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (error.code === 'PGRST116') return { status: 'empty' };
    // Table doesn't exist yet (42P01) — treat as empty so app degrades gracefully
    if (error.code === '42P01') return { status: 'empty' };
    return { status: 'error', error };
  }
  if (!data) return { status: 'empty' };
  return { status: 'ok', data };
}

export async function savePostedSnapshot(wk, snapshot, postedBy) {
  const { data, error } = await supabase
    .from('posted_schedules')
    .insert({ week_key: wk, snapshot, posted_by: postedBy })
    .select('id, posted_at')
    .single();
  if (error) return { error };
  return { error: null, data };
}

// ─── Changelog ────────────────────────────────
export async function saveChangelog(entries) {
  const { error } = await supabase
    .from('schedule_data')
    .upsert({ key: CHANGELOG_KEY, value: entries, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) console.error('[Shiftcraft] Save changelog error:', error)
}

export async function loadChangelog() {
  const { data, error } = await supabase
    .from('schedule_data')
    .select('value')
    .eq('key', CHANGELOG_KEY)
    .single()
  if (error) return []
  return data?.value || []
}

// ─── Absence CRUD ────────────────────────────
export async function fetchAllAbsences() {
  const { data, error } = await supabase
    .from('absences')
    .select('id, person_name, start_date, end_date, type, partial_start, partial_end, note, entered_by, created_at')
    .order('start_date', { ascending: true });
  if (error) {
    if (error.code === '42P01') return { status: 'empty', data: [] };
    return { status: 'error', error, data: [] };
  }
  return { status: 'ok', data: data ?? [] };
}

export async function saveAbsence(payload) {
  const { data, error } = await supabase
    .from('absences')
    .insert(payload)
    .select('id, person_name, start_date, end_date, type, partial_start, partial_end, note, entered_by, created_at')
    .single();
  if (error) return { error };
  return { error: null, data };
}

export async function updateAbsence(id, payload) {
  const { data, error } = await supabase
    .from('absences')
    .update(payload)
    .eq('id', id)
    .select('id, person_name, start_date, end_date, type, partial_start, partial_end, note, entered_by, created_at')
    .single();
  if (error) return { error };
  return { error: null, data };
}

export async function deleteAbsence(id) {
  const { error } = await supabase.from('absences').delete().eq('id', id);
  return { error };
}

export function subscribeAbsences(callback) {
  return supabase
    .channel('absences-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'absences' }, callback)
    .subscribe();
}

// ─── Absence records (week-scoped, for post gate) ─
// Fetches all absence rows overlapping the Mon–Fri range of the given week.
// weekMonday is a Date object (UTC midnight of Monday).
// Degrades gracefully if the absences table doesn't exist yet (42P01).
export async function fetchAbsencesForWeek(weekMonday) {
  const startStr = weekMonday.toISOString().slice(0, 10);
  const friday = new Date(weekMonday);
  friday.setUTCDate(weekMonday.getUTCDate() + 4);
  const endStr = friday.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from('absences')
    .select('person_name, start_date, end_date, type, partial_start, partial_end')
    .lte('start_date', endStr)
    .gte('end_date', startStr);

  if (error) {
    if (error.code === '42P01') return { status: 'empty', data: [] };
    return { status: 'error', error, data: [] };
  }
  return { status: 'ok', data: data ?? [] };
}

// ─── All posted snapshots for a week ─────────
export async function fetchAllPostedSnapshots(wk) {
  const { data, error } = await supabase
    .from('posted_schedules')
    .select('id, snapshot, posted_at, posted_by')
    .eq('week_key', wk)
    .order('posted_at', { ascending: false });
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST116') return { status: 'empty', data: [] };
    return { status: 'error', error, data: [] };
  }
  return { status: 'ok', data: data ?? [] };
}

// ─── Calendar overrides (holidays observed/open, office-closed days) ──────────

export async function fetchAllCalendarOverrides() {
  const { data, error } = await supabase
    .from('calendar_overrides')
    .select('*')
    .order('date', { ascending: true });
  if (error) {
    if (error.code === '42P01') return { status: 'empty', data: [] };
    return { status: 'error', error, data: [] };
  }
  return { status: 'ok', data: data ?? [] };
}

export async function saveCalendarOverride(payload) {
  const { data, error } = await supabase
    .from('calendar_overrides')
    .insert(payload)
    .select()
    .single();
  if (error) return { error };
  return { error: null, data };
}

export async function deleteCalendarOverride(id) {
  const { error } = await supabase.from('calendar_overrides').delete().eq('id', id);
  return { error };
}

export function subscribeCalendarOverrides(callback) {
  return supabase
    .channel('calendar-overrides-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_overrides' }, callback)
    .subscribe();
}

// ─── On-call settings ─────────────────────────
export const ONCALL_KEY = 'shiftcraft_on_call';

export async function loadOncallSettings() {
  const { data, error } = await supabase
    .from('schedule_data')
    .select('value')
    .eq('key', ONCALL_KEY)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return { status: 'empty' };
    return { status: 'error', error };
  }
  return { status: 'ok', data: data?.value ?? null };
}

export async function saveOncallSettings(payload) {
  const { error } = await supabase
    .from('schedule_data')
    .upsert({ key: ONCALL_KEY, value: payload, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) console.error('[Shiftcraft] Save oncall error:', error);
  return { error: error ?? null };
}

// ─── On-call overrides (per-week overrides) ───
export async function fetchOncallOverrides() {
  const { data, error } = await supabase
    .from('oncall_overrides')
    .select('*');
  if (error) {
    if (error.code === '42P01') return { status: 'empty', data: [] };
    return { status: 'error', error, data: [] };
  }
  return { status: 'ok', data: data ?? [] };
}

export async function saveOncallOverride(payload) {
  // payload: { week_key, person_name, note }
  const { data, error } = await supabase
    .from('oncall_overrides')
    .upsert(payload, { onConflict: 'week_key' })
    .select()
    .single();
  if (error) { console.error('[Shiftcraft] Save oncall override error:', error); return { error }; }
  return { error: null, data };
}

export async function deleteOncallOverride(weekKey) {
  const { error } = await supabase
    .from('oncall_overrides')
    .delete()
    .eq('week_key', weekKey);
  if (error) console.error('[Shiftcraft] Delete oncall override error:', error);
  return { error: error ?? null };
}
