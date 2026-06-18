// Run with: node src/engine/solver.test.mjs
import {
  emptyConfig, makeRole, makeLocation, makePerson, makeShift, makeConstraint,
} from './schema.js';
import { solve } from './solver.js';
import { CONSTRAINT_TYPES as CT } from './schema.js';

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('  ok:', msg);
}

// ============================================================
// Fixture: small clinic config with Week A/B tagged shifts
// ============================================================
const cfg = emptyConfig();

const rScribe = makeRole({ name: 'Scribe' });
const rOpener = makeRole({ name: 'Opener', opener: true });
const rFloat  = makeRole({ name: 'Float' });
cfg.roles = [rScribe, rOpener, rFloat];

const lPhx = makeLocation({ name: 'Phoenix' });
const lChd = makeLocation({ name: 'Chandler' });
const lEst = makeLocation({ name: 'Estrella' });
cfg.locations = [lPhx, lChd, lEst];

const allTech = [rOpener.id, rFloat.id];
const john    = makePerson({ name: 'John',    roles: [rScribe.id],              color: '#2563eb' });
const jc      = makePerson({ name: 'JC',      roles: [rScribe.id],              color: '#16a34a' });
const yadi    = makePerson({ name: 'Yadi',    roles: [...allTech],              color: '#db2777' });
const martha  = makePerson({ name: 'Martha',  roles: [rOpener.id],             color: '#9333ea' });
const alondra = makePerson({ name: 'Alondra', roles: [...allTech, rScribe.id], color: '#ea580c' });
const jocelyn = makePerson({ name: 'Jocelyn', roles: [...allTech],              color: '#0891b2' });
const jaron   = makePerson({ name: 'Jaron',   roles: [...allTech],              color: '#65a30d' });
cfg.people = [john, jc, yadi, martha, alondra, jocelyn, jaron];

// Week A: Dr. A @ Chandler Tue; Dr. S @ Estrella Tue; Dr. R @ Phoenix Mon
const drA_wA = makeShift({ name: 'Dr. A', locationId: lChd.id, days: ['Tue'], anchor: true, week: 'A' });
const drS_wA = makeShift({ name: 'Dr. S', locationId: lEst.id, days: ['Tue'], anchor: true, week: 'A' });
const drR_wA = makeShift({ name: 'Dr. R', locationId: lPhx.id, days: ['Mon'], anchor: true, week: 'A' });

// Week B: Dr. R @ Chandler Tue; Dr. A @ Phoenix Mon (rotated locations)
const drR_wB = makeShift({ name: 'Dr. R', locationId: lChd.id, days: ['Tue'], anchor: true, week: 'B' });
const drA_wB = makeShift({ name: 'Dr. A', locationId: lPhx.id, days: ['Mon'], anchor: true, week: 'B' });

// No-week-tag shift — should appear in every week
const drS_any = makeShift({ name: 'Dr. S (always)', locationId: lEst.id, days: ['Wed'], anchor: true });

cfg.shifts = [drA_wA, drS_wA, drR_wA, drR_wB, drA_wB, drS_any];

cfg.constraints = [
  makeConstraint({ type: CT.MIN_STAFF, locationId: lChd.id, roleId: rScribe.id, count: 1 }),
  makeConstraint({ type: CT.MIN_STAFF, locationId: lChd.id, roleId: rOpener.id, count: 1 }),
  makeConstraint({ type: CT.MIN_STAFF, locationId: lChd.id, roleId: rFloat.id,  count: 1 }),
  makeConstraint({ type: CT.MIN_STAFF, locationId: lEst.id, roleId: rScribe.id, count: 1 }),
  makeConstraint({ type: CT.MIN_STAFF, locationId: lEst.id, roleId: rOpener.id, count: 1 }),
  makeConstraint({ type: CT.MIN_STAFF, locationId: lPhx.id, roleId: rOpener.id, count: 1 }),
  makeConstraint({ type: CT.MUST_PAIR, personId: jc.id, anchorId: drA_wA.id }),
  makeConstraint({ type: CT.UNAVAILABLE, personId: john.id, days: ['Tue'] }),
];

// ============================================================
// Suite 1 — backward-compat: solve(cfg) includes all shifts
// ============================================================
console.log('\n=== Suite 1: solve(cfg) — no week filter ===');
const outAll = solve(cfg);

assert(outAll.Tue, 'Tue present when no week filter');
assert(outAll.Mon, 'Mon present when no week filter');
assert(outAll.Wed, 'Wed present when no week filter');

const allTueClinics = outAll.Tue.shifts.map((s) => s.shiftName);
assert(allTueClinics.includes('Dr. A'), 'Dr. A (wA) visible with no filter');
assert(allTueClinics.includes('Dr. R'), 'Dr. R (wB) visible with no filter');

// ============================================================
// Suite 2 — solve(cfg, 'A')
// ============================================================
console.log('\n=== Suite 2: solve(cfg, "A") ===');
const outA = solve(cfg, 'A');

assert(outA.Tue,  'Tue present in Week A');
assert(outA.Mon,  'Mon present in Week A');
assert(outA.Wed,  'Wed present in Week A (untagged shift)');
assert(!outA.Tue?.shifts?.some((s) => s.shiftName === 'Dr. R'),
  'Dr. R (week B) absent on Tue in Week A');
assert(outA.Tue?.shifts?.some((s) => s.shiftName === 'Dr. A'),
  'Dr. A (week A) present on Tue in Week A');
assert(outA.Wed?.shifts?.some((s) => s.shiftName === 'Dr. S (always)'),
  'Untagged shift present in Week A');

// JC should still pair correctly in Week A
const tueChandlerA = outA.Tue?.shifts?.find((s) => s.shiftName === 'Dr. A');
assert(tueChandlerA?.assigned?.some((a) => a.name === 'JC'),
  'JC paired to Dr. A on Tue in Week A');
assert(!outA.Tue?.shifts?.some((s) => s.assigned?.some((a) => a.name === 'John')),
  'John absent Tuesday in Week A (unavailable)');

// ============================================================
// Suite 3 — solve(cfg, 'B')
// ============================================================
console.log('\n=== Suite 3: solve(cfg, "B") ===');
const outB = solve(cfg, 'B');

assert(outB.Tue,  'Tue present in Week B');
assert(outB.Mon,  'Mon present in Week B');
assert(outB.Wed,  'Wed present in Week B (untagged shift)');
assert(!outB.Tue?.shifts?.some((s) => s.shiftName === 'Dr. A'),
  'Dr. A (week A) absent on Tue in Week B');
assert(outB.Tue?.shifts?.some((s) => s.shiftName === 'Dr. R'),
  'Dr. R (week B) present on Tue in Week B');
assert(!outB.Mon?.shifts?.some((s) => s.shiftName === 'Dr. R'),
  'Dr. R (week A Mon) absent in Week B');
assert(outB.Mon?.shifts?.some((s) => s.shiftName === 'Dr. A'),
  'Dr. A (week B Mon) present in Week B');
assert(outB.Wed?.shifts?.some((s) => s.shiftName === 'Dr. S (always)'),
  'Untagged shift present in Week B');

// ============================================================
// Suite 4 — seed.js integration check
// ============================================================
console.log('\n=== Suite 4: seed.js solve with Week A and Week B ===');
import { seedClinic } from './seed.js';
const seedCfg = seedClinic();

const seedA = solve(seedCfg, 'A');
const seedB = solve(seedCfg, 'B');

assert(Object.keys(seedA).length > 0, 'Week A produces days');
assert(Object.keys(seedB).length > 0, 'Week B produces days');

// Week A has Dr. R on Mon @ Phoenix
const seedA_mon = seedA.Mon?.shifts || [];
assert(seedA_mon.some((s) => s.shiftName === 'Dr. R' && s.location === 'Phoenix'),
  'Seed Week A: Dr. R @ Phoenix on Mon');

// Week B has Dr. S on Mon @ Phoenix (not Dr. R)
const seedB_mon = seedB.Mon?.shifts || [];
assert(seedB_mon.some((s) => s.shiftName === 'Dr. S' && s.location === 'Phoenix'),
  'Seed Week B: Dr. S @ Phoenix on Mon');
assert(!seedB_mon.some((s) => s.shiftName === 'Dr. R'),
  'Seed Week B: Dr. R absent on Mon');

// No week A shifts appear on Week B and vice versa
const weekAShiftsInB = Object.values(seedB).flatMap((d) => d.shifts)
  .filter((s) => seedCfg.shifts.find((sh) => sh.id === s.shiftId && sh.week === 'A'));
assert(weekAShiftsInB.length === 0, 'No Week A shifts appear when solving Week B');

console.log('\nAll suites done.');
