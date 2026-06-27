import { supabase } from '../supabase'

export const SCHEDULE_KEY = 'shiftcraft_main'
export const CHANGELOG_KEY = 'shiftcraft_changelog'

export function weekKey(weekStr) {
  return `shiftcraft_week_${weekStr}`
}

// ─── Global schedule (clinic definitions, people, locations) ──
export async function saveSchedule(data) {
  const { error } = await supabase
    .from('schedule_data')
    .upsert({ key: SCHEDULE_KEY, value: data, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) console.error('[Shiftcraft] Save schedule error:', error)
}

export async function loadSchedule() {
  const { data, error } = await supabase
    .from('schedule_data')
    .select('value')
    .eq('key', SCHEDULE_KEY)
    .single()
  if (error) return null
  return data?.value || null
}

// ─── Per-week slot maps ───────────────────────
export async function saveWeekSlotMap(weekStr, map) {
  const { error } = await supabase
    .from('schedule_data')
    .upsert({ key: weekKey(weekStr), value: map, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) console.error('[Shiftcraft] Save week error:', error)
}

export async function loadWeekSlotMap(weekStr) {
  const { data, error } = await supabase
    .from('schedule_data')
    .select('value')
    .eq('key', weekKey(weekStr))
    .single()
  if (error) return null
  return data?.value || null
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
