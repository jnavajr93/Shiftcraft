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
