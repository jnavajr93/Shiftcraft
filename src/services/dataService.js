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
export async function saveWeekSlotMap(weekStr, map) {
  const { error } = await supabase
    .from('schedule_data')
    .upsert({ key: weekKey(weekStr), value: map, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) console.error('[Shiftcraft] Save week error:', error)
  return { error: error ?? null }
}

export async function loadWeekSlotMap(weekStr) {
  const { data, error } = await supabase
    .from('schedule_data')
    .select('value')
    .eq('key', weekKey(weekStr))
    .single()
  if (error) {
    if (error.code === 'PGRST116') return { status: 'empty' }
    return { status: 'error', error }
  }
  if (!data?.value) return { status: 'empty' }
  return { status: 'ok', data: data.value }
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
