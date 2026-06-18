import {
  emptyConfig, makeRole, makeLocation, makePerson, makeShift, makeConstraint,
} from './schema.js';
import { CONSTRAINT_TYPES as CT } from './schema.js';

// A worked example so the app is useful on first open and demonstrates the
// generic model. Users can delete all of this and build their own.
// Demonstrates Week A / Week B alternating doctor patterns.
export function seedClinic() {
  const cfg = emptyConfig();
  cfg.meta.name = 'Eye Clinic';

  const rScribe = makeRole({ name: 'Scribe' });
  const rOpener = makeRole({ name: 'Opener', opener: true });
  const rFloat = makeRole({ name: 'Float' });
  cfg.roles = [rScribe, rOpener, rFloat];

  const lPhx = makeLocation({ name: 'Phoenix' });
  const lChd = makeLocation({ name: 'Chandler' });
  const lEst = makeLocation({ name: 'Estrella' });
  const lSco = makeLocation({ name: 'Scottsdale' });
  cfg.locations = [lPhx, lChd, lEst, lSco];

  const tech = [rOpener.id, rFloat.id];
  const P = {};
  const add = (name, roles, color, opts = {}) => {
    const p = makePerson({ name, roles, color, ...opts });
    P[name] = p;
    cfg.people.push(p);
  };
  add('John',    [rScribe.id],          '#2563eb');
  add('JC',      [rScribe.id],          '#16a34a');
  add('Nikole',  [rScribe.id],          '#0891b2');
  add('Lizbeth', [rScribe.id, ...tech], '#7c3aed');
  add('Alondra', [rScribe.id, ...tech], '#ea580c');
  add('Yadi',    [...tech],             '#db2777');
  add('Martha',  [rOpener.id],          '#9333ea');
  add('Jaron',   [...tech],             '#65a30d');
  add('Jocelyn', [...tech],             '#0d9488');
  add('Itzel',   [...tech],             '#c026d3');
  add('Katina',  [...tech],             '#0284c7');

  // ── Week A shifts ────────────────────────────────────────────────────────
  const wA_drR_mon = makeShift({ name: 'Dr. R', locationId: lPhx.id, days: ['Mon'], anchor: true, week: 'A', start: 480, end: 1020 });
  const wA_drA_tue = makeShift({ name: 'Dr. A', locationId: lChd.id, days: ['Tue'], anchor: true, week: 'A' });
  const wA_drS_tue = makeShift({ name: 'Dr. S', locationId: lEst.id, days: ['Tue'], anchor: true, week: 'A' });
  const wA_drA_thu = makeShift({ name: 'Dr. A', locationId: lPhx.id, days: ['Thu'], anchor: true, week: 'A' });
  const wA_drS_thu = makeShift({ name: 'Dr. S', locationId: lChd.id, days: ['Thu'], anchor: true, week: 'A' });
  const wA_drR_thu = makeShift({ name: 'Dr. R', locationId: lEst.id, days: ['Thu'], anchor: true, week: 'A' });
  const wA_drA_fri = makeShift({ name: 'Dr. A', locationId: lChd.id, days: ['Fri'], anchor: true, week: 'A' });
  const wA_drR_fri = makeShift({ name: 'Dr. R', locationId: lSco.id, days: ['Fri'], anchor: true, week: 'A' });
  const wA_drS_fri = makeShift({ name: 'Dr. S', locationId: lPhx.id, days: ['Fri'], anchor: true, week: 'A' });

  // ── Week B shifts (rotated locations) ────────────────────────────────────
  const wB_drS_mon = makeShift({ name: 'Dr. S', locationId: lPhx.id, days: ['Mon'], anchor: true, week: 'B', start: 480, end: 1020 });
  const wB_drR_tue = makeShift({ name: 'Dr. R', locationId: lChd.id, days: ['Tue'], anchor: true, week: 'B' });
  const wB_drA_tue = makeShift({ name: 'Dr. A', locationId: lSco.id, days: ['Tue'], anchor: true, week: 'B' });
  const wB_drS_thu = makeShift({ name: 'Dr. S', locationId: lPhx.id, days: ['Thu'], anchor: true, week: 'B' });
  const wB_drA_thu = makeShift({ name: 'Dr. A', locationId: lEst.id, days: ['Thu'], anchor: true, week: 'B' });
  const wB_drR_thu = makeShift({ name: 'Dr. R', locationId: lChd.id, days: ['Thu'], anchor: true, week: 'B' });
  const wB_drR_fri = makeShift({ name: 'Dr. R', locationId: lPhx.id, days: ['Fri'], anchor: true, week: 'B' });
  const wB_drS_fri = makeShift({ name: 'Dr. S', locationId: lSco.id, days: ['Fri'], anchor: true, week: 'B' });
  const wB_drA_fri = makeShift({ name: 'Dr. A', locationId: lChd.id, days: ['Fri'], anchor: true, week: 'B' });

  cfg.shifts = [
    wA_drR_mon, wA_drA_tue, wA_drS_tue, wA_drA_thu, wA_drS_thu, wA_drR_thu, wA_drA_fri, wA_drR_fri, wA_drS_fri,
    wB_drS_mon, wB_drR_tue, wB_drA_tue, wB_drS_thu, wB_drA_thu, wB_drR_thu, wB_drR_fri, wB_drS_fri, wB_drA_fri,
  ];

  const minS = (loc, role, n) => makeConstraint({ type: CT.MIN_STAFF, locationId: loc, roleId: role, count: n });
  cfg.constraints = [
    minS(lPhx.id, rScribe.id, 1), minS(lPhx.id, rOpener.id, 1), minS(lPhx.id, rFloat.id, 2),
    minS(lChd.id, rScribe.id, 1), minS(lChd.id, rOpener.id, 1), minS(lChd.id, rFloat.id, 1),
    minS(lEst.id, rScribe.id, 1), minS(lEst.id, rOpener.id, 1), minS(lEst.id, rFloat.id, 1),
    minS(lSco.id, rScribe.id, 1), minS(lSco.id, rOpener.id, 1), minS(lSco.id, rFloat.id, 2),
    // Pairings: John -> Dr. R Thu (Week A), JC -> Dr. A Tue (Week A)
    makeConstraint({ type: CT.MUST_PAIR, personId: P.John.id, anchorId: wA_drR_thu.id, note: 'John follows Dr. R on Thu (Week A)' }),
    makeConstraint({ type: CT.MUST_PAIR, personId: P.JC.id, anchorId: wA_drA_tue.id, note: 'JC follows Dr. A on Tue (Week A)' }),
    // John off Tue/Wed; JC off Mon/Wed
    makeConstraint({ type: CT.UNAVAILABLE, personId: P.John.id, days: ['Tue', 'Wed'] }),
    makeConstraint({ type: CT.UNAVAILABLE, personId: P.JC.id, days: ['Mon', 'Wed'] }),
  ];
  return cfg;
}
