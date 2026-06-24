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

// ---- Build a sample clinic config ----
const cfg = emptyConfig();

const rScribe = makeRole({ name: 'Scribe' });
const rOpener = makeRole({ name: 'Opener', opener: true });
const rFloat = makeRole({ name: 'Float' });
cfg.roles = [rScribe, rOpener, rFloat];

const lPhx = makeLocation({ name: 'Phoenix' });
const lChd = makeLocation({ name: 'Chandler' });
const lEst = makeLocation({ name: 'Estrella' });
cfg.locations = [lPhx, lChd, lEst];

const allTech = [rOpener.id, rFloat.id];
const john = makePerson({ name: 'John', roles: [rScribe.id], color: '#2563eb' });
const jc = makePerson({ name: 'JC', roles: [rScribe.id], color: '#16a34a' });
const yadi = makePerson({ name: 'Yadi', roles: [...allTech], color: '#db2777' });
const martha = makePerson({ name: 'Martha', roles: [rOpener.id], color: '#9333ea' });
const alondra = makePerson({ name: 'Alondra', roles: [...allTech, rScribe.id], color: '#ea580c' });
const jocelyn = makePerson({ name: 'Jocelyn', roles: [...allTech], color: '#0891b2' });
const jaron = makePerson({ name: 'Jaron', roles: [...allTech], color: '#65a30d' });
cfg.people = [john, jc, yadi, martha, alondra, jocelyn, jaron];

// Dr. A at Chandler Tue; Dr. S at Estrella Tue; Dr. R Phoenix Mon
const drA = makeShift({ name: 'Dr. A', locationId: lChd.id, days: ['Tue'], anchor: true });
const drS = makeShift({ name: 'Dr. S', locationId: lEst.id, days: ['Tue'], anchor: true });
const drR = makeShift({ name: 'Dr. R', locationId: lPhx.id, days: ['Mon'], anchor: true });
cfg.shifts = [drA, drS, drR];

// Constraints
cfg.constraints = [
  // Chandler needs 1 scribe + 2 techs
  makeConstraint({ type: CT.MIN_STAFF, locationId: lChd.id, roleId: rScribe.id, count: 1 }),
  makeConstraint({ type: CT.MIN_STAFF, locationId: lChd.id, roleId: rOpener.id, count: 1 }),
  makeConstraint({ type: CT.MIN_STAFF, locationId: lChd.id, roleId: rFloat.id, count: 1 }),
  // Estrella needs 1 scribe + 1 opener
  makeConstraint({ type: CT.MIN_STAFF, locationId: lEst.id, roleId: rScribe.id, count: 1 }),
  makeConstraint({ type: CT.MIN_STAFF, locationId: lEst.id, roleId: rOpener.id, count: 1 }),
  // Phoenix needs 1 opener
  makeConstraint({ type: CT.MIN_STAFF, locationId: lPhx.id, roleId: rOpener.id, count: 1 }),
  // JC always with Dr. S on Tue (pairing) — wait, JC pairs to Dr.A per your rule
  makeConstraint({ type: CT.MUST_PAIR, personId: jc.id, anchorId: drA.id }),
  // John off Tue
  makeConstraint({ type: CT.UNAVAILABLE, personId: john.id, days: ['Tue'] }),
  // Skibell-style whitelist demo: Estrella only Yadi + Martha
  // (left out here to test general fill; whitelist tested separately)
];

console.log('\n=== Running solver ===');
const out = solve(cfg);

// ---- Assertions ----
assert(out.Tue, 'Tuesday produced a result');
assert(out.Mon, 'Monday produced a result');

const tueChandler = out.Tue.shifts.find((s) => s.shiftName === 'Dr. A');
assert(tueChandler, 'Dr. A clinic exists on Tue');
assert(
  tueChandler.assigned.some((a) => a.name === 'JC'),
  'JC is paired to Dr. A on Tuesday'
);
assert(
  !out.Tue.shifts.some((s) => s.assigned.some((a) => a.name === 'John')),
  'John is NOT scheduled Tuesday (unavailable)'
);

const chandlerScribes = tueChandler.assigned.filter((a) => a.role === 'Scribe').length;
assert(chandlerScribes >= 1, 'Chandler has at least 1 scribe Tue');

console.log('\n=== Tuesday schedule ===');
out.Tue.shifts.forEach((s) => {
  console.log(`${s.shiftName} @ ${s.location}: ` +
    s.assigned.map((a) => `${a.name}(${a.role})`).join(', '));
});
if (out.Tue.issues.length) console.log('Issues:', out.Tue.issues);

console.log('\nDone.');
