/**
 * On-call rotation utility.
 * Pure functions — no side effects, no React or Supabase imports.
 *
 * Settings shape:
 *   { rotation: string[], blockWeeks: number, anchorWeek: string|null }
 *
 * rotation   — ordered list of on-call person names
 * blockWeeks — consecutive weeks per turn (default 4)
 * anchorWeek — ISO week "YYYY-Www" marking the first block's start
 */

/** Convert an ISO week string ("YYYY-Www") to a monotonic integer. */
function weekToIndex(weekStr) {
  const [y, w] = weekStr.split('-W').map(Number);
  return y * 53 + w;
}

/**
 * Return the name of the on-call person for weekStr, or null when:
 *   – rotation is empty
 *   – anchorWeek is not set
 */
export function getOnCallPerson(weekStr, settings) {
  const { rotation = [], blockWeeks = 4, anchorWeek } = settings ?? {};
  if (!rotation.length || !anchorWeek || !weekStr) return null;
  const offset = weekToIndex(weekStr) - weekToIndex(anchorWeek);
  const len = rotation.length;
  // Double modulo handles negative offsets (weeks before anchor)
  const idx = ((Math.floor(offset / blockWeeks) % len) + len) % len;
  return rotation[idx];
}

/**
 * Return on-call result for a week, respecting overrides.
 * Checks oncall_overrides rows first; falls back to computed rotation.
 * Returns { person: string, isOverride: boolean, note: string|null } or null.
 */
export function getOnCallForWeek(weekStr, settings, overrides = []) {
  if (!weekStr) return null;
  const override = (overrides ?? []).find(o => o.week_key === weekStr);
  if (override) return { person: override.person_name, isOverride: true, note: override.note ?? null };
  const person = getOnCallPerson(weekStr, settings);
  return person ? { person, isOverride: false, note: null } : null;
}

/**
 * Return the position of weekStr within its block.
 * Returns { weekInBlock: 1-based, totalWeeks } or null if rotation not configured.
 */
export function getBlockPosition(weekStr, settings) {
  const { rotation = [], blockWeeks = 4, anchorWeek } = settings ?? {};
  if (!rotation.length || !anchorWeek || !weekStr) return null;
  const offset = weekToIndex(weekStr) - weekToIndex(anchorWeek);
  const posInBlock = ((offset % blockWeeks) + blockWeeks) % blockWeeks;
  return { weekInBlock: posInBlock + 1, totalWeeks: blockWeeks };
}

/**
 * Return the ISO week string n weeks after weekStr.
 * addWeeks('2026-W01', 1) → '2026-W02'
 */
export function addWeeks(weekStr, n) {
  const [y, w] = weekStr.split('-W').map(Number);
  // Monday of week 1: Jan 4 is always in W1
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const jan4dow = jan4.getUTCDay() || 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - (jan4dow - 1));
  // Monday of target week, offset by n additional weeks
  const targetMon = new Date(week1Mon);
  targetMon.setUTCDate(week1Mon.getUTCDate() + (w - 1) * 7 + n * 7);
  // Re-encode as ISO week
  const d = new Date(Date.UTC(targetMon.getUTCFullYear(), targetMon.getUTCMonth(), targetMon.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
