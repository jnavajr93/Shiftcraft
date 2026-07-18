/**
 * Unit test for defaultLandingWeek()
 * Run directly with Node — no test framework needed.
 * Re-run under different TZ to prove device-independence.
 *
 * Usage:
 *   node test-rollover.mjs
 *   TZ=America/New_York node test-rollover.mjs
 *   TZ=UTC              node test-rollover.mjs
 */

// ── Inline the two functions exactly as they exist in AppContext.jsx ──────────

function isoWeek(date) {
  // Uses LOCAL timezone methods — intentionally NOT called by defaultLandingWeek
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function defaultLandingWeek() {
  const PHOENIX_OFFSET_MS = -7 * 60 * 60 * 1000;
  const px = new Date(Date.now() + PHOENIX_OFFSET_MS);
  const dow  = px.getUTCDay();
  const hour = px.getUTCHours();

  const rollover = (dow === 5 && hour >= 17) || dow === 6 || dow === 0;
  const daysToMon = rollover ? (dow === 0 ? 1 : 8 - dow) : 0;

  const target = new Date(px.getTime() + daysToMon * 86400000);
  const y = target.getUTCFullYear(), m = target.getUTCMonth(), d = target.getUTCDate();
  const thursday = new Date(Date.UTC(y, m, d));
  const utcDow = thursday.getUTCDay() || 7;
  thursday.setUTCDate(d + 4 - utcDow);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

// ── Clock mock ────────────────────────────────────────────────────────────────
// Jul 17 2026 is a Friday in Phoenix.
// All times expressed as Phoenix local; we convert to UTC for Date.now mock.

function phoenixToUtcMs(year, month, day, hour, minute = 0) {
  // Phoenix = UTC-7
  return Date.UTC(year, month - 1, day, hour + 7, minute);
}

const _realNow = Date.now.bind(Date);
function mockNow(utcMs) { Date.now = () => utcMs; }
function restoreNow() { Date.now = _realNow; }

// ── Test harness ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0;

function test(description, utcMs, expected) {
  mockNow(utcMs);
  const result = defaultLandingWeek();
  restoreNow();
  const ok = result === expected;
  const icon = ok ? '✓' : '✗';
  console.log(`  ${icon} ${description}`);
  console.log(`      expected: ${expected}  got: ${result}`);
  if (!ok) failed++;
  else passed++;
}

console.log(`\ndevice TZ = ${process.env.TZ || '(system default: ' + Intl.DateTimeFormat().resolvedOptions().timeZone + ')'}`);
console.log('─'.repeat(70));

// ── Cases using Jul 14–19 2026 (the week of Jul 13) ─────────────────────────
// Week of Jul 13 2026 = 2026-W29, Week of Jul 20 2026 = 2026-W30

// Mon Jul 13 — 9:00 AM Phoenix → current week (W29)
test(
  'Monday 9:00 AM Phoenix → current week',
  phoenixToUtcMs(2026, 7, 13,  9,  0),
  '2026-W29'
);

// Fri Jul 17 — 4:59 PM Phoenix (one minute before rollover) → current week (W29)
test(
  'Friday 4:59 PM Phoenix → current week (no rollover yet)',
  phoenixToUtcMs(2026, 7, 17, 16, 59),
  '2026-W29'
);

// Fri Jul 17 — 5:00 PM Phoenix (exact rollover point) → next week (W30)
test(
  'Friday 5:00 PM Phoenix → next week (rollover starts)',
  phoenixToUtcMs(2026, 7, 17, 17,  0),
  '2026-W30'
);

// Fri Jul 17 — 10:00 PM Phoenix → next week (W30)
test(
  'Friday 10:00 PM Phoenix → next week',
  phoenixToUtcMs(2026, 7, 17, 22,  0),
  '2026-W30'
);

// Sat Jul 18 — 12:00 PM Phoenix → next week (W30)
test(
  'Saturday noon Phoenix → next week',
  phoenixToUtcMs(2026, 7, 18, 12,  0),
  '2026-W30'
);

// Sun Jul 19 — 11:59 PM Phoenix → next week (W30)
test(
  'Sunday 11:59 PM Phoenix → next week',
  phoenixToUtcMs(2026, 7, 19, 23, 59),
  '2026-W30'
);

// Wed Jul 15 — 3:00 PM Phoenix → current week (W29)
test(
  'Wednesday 3:00 PM Phoenix → current week',
  phoenixToUtcMs(2026, 7, 15, 15,  0),
  '2026-W29'
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('─'.repeat(70));
console.log(`  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
