import {
  emptyConfig, makeRole, makeLocation, makePerson, makeShift, makeConstraint,
} from './schema.js';
import { CONSTRAINT_TYPES as CT } from './schema.js';

// A worked example so the app is useful on first open and demonstrates the
// generic model. Users can delete all of this and build their own.
export function seedClinic() {
  const cfg = emptyConfig();
  cfg.meta.name = 'Eye Clinic — Week A';

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
  add('John', [rScribe.id], '#2563eb');
  add('JC', [rScribe.id], '#16a34a');
  add('Nikole', [rScribe.id], '#0891b2');
  add('Lizbeth', [rScribe.id, ...tech], '#7c3aed');
  add('Alondra', [rScribe.id, ...tech], '#ea580c');
  add('Yadi', [...tech], '#db2777');
  add('Martha', [rOpener.id], '#9333ea');
  add('Jaron', [...tech], '#65a30d');
  add('Jocelyn', [...tech], '#0d9488');
  add('Itzel', [...tech], '#c026d3');
  add('Katina', [...tech], '#0284c7');

  // Shifts (one week's provider pattern, simplified)
  const drR_mon = makeShift({ name: 'Dr. R', locationId: lPhx.id, days: ['Mon'], anchor: true, start: 480, end: 1020 });
  const drA_tue = makeShift({ name: 'Dr. A', locationId: lChd.id, days: ['Tue'], anchor: true });
  const drS_tue = makeShift({ name: 'Dr. S', locationId: lEst.id, days: ['Tue'], anchor: true });
  const drA_thu = makeShift({ name: 'Dr. A', locationId: lPhx.id, days: ['Thu'], anchor: true });
  const drS_thu = makeShift({ name: 'Dr. S', locationId: lChd.id, days: ['Thu'], anchor: true });
  const drR_thu = makeShift({ name: 'Dr. R', locationId: lEst.id, days: ['Thu'], anchor: true });
  const drA_fri = makeShift({ name: 'Dr. A', locationId: lChd.id, days: ['Fri'], anchor: true });
  const drR_fri = makeShift({ name: 'Dr. R', locationId: lSco.id, days: ['Fri'], anchor: true });
  const drS_fri = makeShift({ name: 'Dr. S', locationId: lPhx.id, days: ['Fri'], anchor: true });
  cfg.shifts = [drR_mon, drA_tue, drS_tue, drA_thu, drS_thu, drR_thu, drA_fri, drR_fri, drS_fri];

  const minS = (loc, role, n) => makeConstraint({ type: CT.MIN_STAFF, locationId: loc, roleId: role, count: n });
  cfg.constraints = [
    minS(lPhx.id, rScribe.id, 1), minS(lPhx.id, rOpener.id, 1), minS(lPhx.id, rFloat.id, 2),
    minS(lChd.id, rScribe.id, 1), minS(lChd.id, rOpener.id, 1), minS(lChd.id, rFloat.id, 1),
    minS(lEst.id, rScribe.id, 1), minS(lEst.id, rOpener.id, 1), minS(lEst.id, rFloat.id, 1),
    minS(lSco.id, rScribe.id, 1), minS(lSco.id, rOpener.id, 1), minS(lSco.id, rFloat.id, 2),
    // Pairings: John -> Dr. R, JC -> Dr. A
    makeConstraint({ type: CT.MUST_PAIR, personId: P.John.id, anchorId: drR_thu.id, note: 'John follows Dr. R' }),
    makeConstraint({ type: CT.MUST_PAIR, personId: P.JC.id, anchorId: drA_tue.id, note: 'JC follows Dr. A' }),
    // John off Tue/Wed; JC off Mon/Wed
    makeConstraint({ type: CT.UNAVAILABLE, personId: P.John.id, days: ['Tue', 'Wed'] }),
    makeConstraint({ type: CT.UNAVAILABLE, personId: P.JC.id, days: ['Mon', 'Wed'] }),
  ];
  return cfg;
}
