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

/**
 * Return the UTC millisecond timestamp of 00:00 on the Monday that opens
 * the given ISO week.  The "Jan 4 is always in W1" rule anchors the calc.
 */
function isoWeekMondayMs(weekStr) {
  const [y, w] = weekStr.split('-W').map(Number);
  const jan4dow = new Date(Date.UTC(y, 0, 4)).getUTCDay() || 7; // 1=Mon … 7=Sun
  const week1MonMs = Date.UTC(y, 0, 4) - (jan4dow - 1) * 86400000;
  return week1MonMs + (w - 1) * 7 * 86400000;
}

/**
 * Re-encode a UTC-ms timestamp as an ISO week string.
 * The Thursday of the week (ISO rule) determines the year.
 */
function msToIsoWeek(ms) {
  const thu = new Date(ms + 3 * 86400000); // Thursday of the same ISO week
  const year = thu.getUTCFullYear();
  const yearStartMs = Date.UTC(year, 0, 1);
  const week = Math.ceil(((thu.getTime() - yearStartMs) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/**
 * Convert an ISO week string to a continuous monotonic integer that advances
 * by exactly 1 per ISO week, with no skip at year boundaries.
 *
 * The old formula (y * 53 + w) was NOT monotonic: most ISO years have 52
 * weeks, so crossing from a 52-week year into January produced a gap of 2
 * instead of 1 (e.g. 2027-W52 → 2028-W01 diffed as 2).  This function
 * fixes that by converting to Monday-date milliseconds first.
 */
function weekToIndex(weekStr) {
  // Dividing by ms-per-week yields an integer that grows by exactly 1 each week.
  return Math.floor(isoWeekMondayMs(weekStr) / (7 * 86400000));
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
 * Uses isoWeekMondayMs / msToIsoWeek so the same arithmetic powers all helpers.
 */
export function addWeeks(weekStr, n) {
  return msToIsoWeek(isoWeekMondayMs(weekStr) + n * 7 * 86400000);
}

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/**
 * Format a block's date range as a human-readable string.
 * startWeek is the first week (Monday); endWeek's Friday is the block's last working day,
 * but we display through Sunday for a clean range.
 * Examples: "Aug 3–28"  "Jul 28 – Aug 25"  "Dec 29 – Jan 25, 2027"
 */
export function formatBlockRange(startWeek, endWeek) {
  const sMs = isoWeekMondayMs(startWeek);
  const eMs = isoWeekMondayMs(endWeek) + 6 * 86400000; // Sunday of last week
  const s = new Date(sMs), e = new Date(eMs);
  const sm = s.getUTCMonth(), em = e.getUTCMonth();
  const sy = s.getUTCFullYear(), ey = e.getUTCFullYear();
  const sd = s.getUTCDate(), ed = e.getUTCDate();
  const sFmt = `${MONTHS_SHORT[sm]} ${sd}`;
  const eFmt = `${MONTHS_SHORT[em]} ${ed}`;
  if (sy === ey && sm === em) return `${sFmt}–${ed}`;
  if (sy === ey) return `${sFmt} – ${eFmt}`;
  return `${sFmt} – ${eFmt}, ${ey}`;
}

/**
 * Return the next (or current) computed on-call block for a person.
 * Block boundaries are always from the rotation math — overrides do not shift them.
 * Returns { startWeek, endWeek, isCurrent } or null when:
 *   – personName is not in the rotation
 *   – rotation or anchorWeek is not configured
 *
 * isCurrent – true when fromWeek falls inside this block (person is on call now).
 * startWeek / endWeek – ISO week strings, inclusive first/last week of the block.
 */
export function getPersonNextBlock(personName, settings, fromWeek) {
  const { rotation = [], blockWeeks = 4, anchorWeek } = settings ?? {};
  if (!rotation.length || !anchorWeek || !fromWeek || !personName) return null;

  const nameKey = personName.trim().toLowerCase();
  const personIdx = rotation.findIndex(n => n.trim().toLowerCase() === nameKey);
  if (personIdx < 0) return null;

  const len = rotation.length;
  const fromOffset = weekToIndex(fromWeek) - weekToIndex(anchorWeek);
  const currentBlockNum = Math.floor(fromOffset / blockWeeks);
  const currentOwnerIdx = ((currentBlockNum % len) + len) % len;

  let blockNum;
  if (currentOwnerIdx === personIdx) {
    blockNum = currentBlockNum;
  } else {
    const ahead = ((personIdx - currentOwnerIdx) % len + len) % len;
    blockNum = currentBlockNum + ahead;
  }

  const startOffset = blockNum * blockWeeks;
  const endOffset   = startOffset + blockWeeks - 1;
  const anchorMs    = isoWeekMondayMs(anchorWeek);

  const startWeek = msToIsoWeek(anchorMs + startOffset * 7 * 86400000);
  const endWeek   = msToIsoWeek(anchorMs + endOffset   * 7 * 86400000);
  const isCurrent = currentOwnerIdx === personIdx;

  return { startWeek, endWeek, isCurrent };
}
