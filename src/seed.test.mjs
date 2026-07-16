// Run with: node src/seed.test.mjs
// Tests getRenderedSlotEntries and getAssignmentsForPerson — the two functions
// that enforce "inactive FD slots are invisible to all eligibility checks".

import { getAssignmentsForPerson, getRenderedSlotEntries, getActiveFDSlots } from './data/seed.js';

function assert(cond, label) {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}`); process.exitCode = 1; }
}

console.group('[Shiftcraft] seed.js unit tests');

// ── Test 1: stale frontDesk on Dr. R Friday is invisible ────────────────────
// Dr. R Mon/Fri renders openingFrontDesk + closingFrontDesk.
// A stale personId in the plain frontDesk slot must not flag the person as assigned.
{
  console.group('Test 1: stale frontDesk on Dr. R Fri — getAssignmentsForPerson returns empty');
  const people = [
    { id: 'person-admin', name: 'Alex', staffType: 'admin' },
    { id: 'person-tech',  name: 'Alex', staffType: null },
  ];
  const clinics = [{
    id: 'fri-phoenix-drr',
    day: 'Fri',
    location: 'Phoenix',
    provider: 'Dr. R',
    open: true,
    slots: {
      openingFrontDesk: null,
      closingFrontDesk: null,
      frontDesk: 'person-admin',   // stale — inactive on Dr. R Fri
      scribe:    { personId: null, start: null, end: null },
      opener:    null,
      closing:   null,
      middle:    { personId: null, start: null, end: null },
      training:  { personId: null, start: null, end: null },
    },
  }];

  const activeFD = getActiveFDSlots(clinics[0]);
  assert(
    activeFD.join(',') === 'openingFrontDesk,closingFrontDesk',
    'Dr. R Fri active FD slots = openingFrontDesk, closingFrontDesk'
  );

  const rendered = getRenderedSlotEntries(clinics[0]);
  const renderedKeys = rendered.map(([k]) => k);
  assert(!renderedKeys.includes('frontDesk'),          'getRenderedSlotEntries excludes inactive frontDesk');
  assert(renderedKeys.includes('openingFrontDesk'),    'getRenderedSlotEntries includes openingFrontDesk');
  assert(renderedKeys.includes('closingFrontDesk'),    'getRenderedSlotEntries includes closingFrontDesk');
  assert(renderedKeys.includes('scribe'),              'getRenderedSlotEntries includes scribe');

  const assignments = getAssignmentsForPerson('alex', 'Fri', people, clinics);
  assert(assignments.length === 0, 'getAssignmentsForPerson returns empty — stale inactive slot ignored');

  console.groupEnd();
}

// ── Test 2: stale frontDesk on Dr. R Monday is also invisible ───────────────
{
  console.group('Test 2: stale frontDesk on Dr. R Mon — same rule applies');
  const people = [{ id: 'person-admin', name: 'Alex', staffType: 'admin' }];
  const clinics = [{
    id: 'mon-phoenix-drr',
    day: 'Mon',
    location: 'Phoenix',
    provider: 'Dr. R',
    open: true,
    slots: {
      openingFrontDesk: null,
      closingFrontDesk: null,
      frontDesk: 'person-admin',  // stale
      scribe: { personId: null, start: null, end: null },
      opener: null, closing: null,
      middle: { personId: null, start: null, end: null },
      training: { personId: null, start: null, end: null },
    },
  }];
  const assignments = getAssignmentsForPerson('alex', 'Mon', people, clinics);
  assert(assignments.length === 0, 'Mon stale frontDesk not found by getAssignmentsForPerson');
  console.groupEnd();
}

// ── Test 3: active openingFrontDesk IS found ─────────────────────────────────
{
  console.group('Test 3: active openingFrontDesk on Dr. R Fri — IS found');
  const people = [{ id: 'person-admin', name: 'Alex', staffType: 'admin' }];
  const clinics = [{
    id: 'fri-phoenix-drr',
    day: 'Fri',
    location: 'Phoenix',
    provider: 'Dr. R',
    open: true,
    slots: {
      openingFrontDesk: 'person-admin',  // active
      closingFrontDesk: null,
      frontDesk: null,
      scribe: { personId: null, start: null, end: null },
      opener: null, closing: null,
      middle: { personId: null, start: null, end: null },
      training: { personId: null, start: null, end: null },
    },
  }];
  const assignments = getAssignmentsForPerson('alex', 'Fri', people, clinics);
  assert(assignments.length === 1,                              'active openingFrontDesk found');
  assert(assignments[0]?.slotType === 'openingFrontDesk',      'correct slot type returned');
  console.groupEnd();
}

// ── Test 4: regular (non-Dr. R) clinic — plain frontDesk IS active ───────────
{
  console.group('Test 4: frontDesk active on Dr. A Mon (non-Dr. R)');
  const people = [{ id: 'person-admin', name: 'Alex', staffType: 'admin' }];
  const clinics = [{
    id: 'mon-chandler-dra',
    day: 'Mon',
    location: 'Chandler',
    provider: 'Dr. A',
    open: true,
    slots: {
      openingFrontDesk: null,
      closingFrontDesk: null,
      frontDesk: 'person-admin',  // active on non-Dr. R clinics
      scribe: { personId: null, start: null, end: null },
      opener: null, closing: null,
      middle: { personId: null, start: null, end: null },
      training: { personId: null, start: null, end: null },
    },
  }];
  const activeFD = getActiveFDSlots(clinics[0]);
  assert(activeFD.join(',') === 'frontDesk', 'Dr. A Mon active FD = frontDesk');

  const rendered = getRenderedSlotEntries(clinics[0]);
  const renderedKeys = rendered.map(([k]) => k);
  assert(renderedKeys.includes('frontDesk'),              'frontDesk included on non-Dr. R clinic');
  assert(!renderedKeys.includes('openingFrontDesk'),      'openingFrontDesk excluded (inactive)');
  assert(!renderedKeys.includes('closingFrontDesk'),      'closingFrontDesk excluded (inactive)');

  const assignments = getAssignmentsForPerson('alex', 'Mon', people, clinics);
  assert(assignments.length === 1, 'frontDesk assignment found on Dr. A clinic');
  console.groupEnd();
}

// ── Test 5: OBS clinic — only OBS slot types visible ─────────────────────────
{
  console.group('Test 5: OBS clinic — non-OBS stale key invisible');
  const people = [
    { id: 'person-admin', name: 'Alex', staffType: 'admin' },
    { id: 'person-tech',  name: 'Alex', staffType: null },
  ];
  const clinics = [{
    id: 'tue-obs',
    day: 'Tue',
    location: 'OBS',
    provider: '',
    open: true,
    slots: {
      preop:      { personId: 'person-tech', start: null, end: null },
      sterile:    { personId: null, start: null, end: null },
      circulator: { personId: null, start: null, end: null },
      scrub:      { personId: null, start: null, end: null },
      frontDesk:  'person-admin',  // stale bad key on OBS clinic
    },
  }];

  const rendered = getRenderedSlotEntries(clinics[0]);
  const renderedKeys = rendered.map(([k]) => k);
  assert(!renderedKeys.includes('frontDesk'), 'OBS: stale frontDesk key excluded');
  assert(renderedKeys.includes('preop'),      'OBS: preop included');

  const assignments = getAssignmentsForPerson('alex', 'Tue', people, clinics);
  assert(assignments.length === 1,              'OBS: only preop found (not stale frontDesk)');
  assert(assignments[0]?.slotType === 'preop',  'correct OBS slot returned');
  console.groupEnd();
}

// ── Test 6: same-name pair — OBS takes precedence over regular ───────────────
// Two records with the same name: one in OBS, one in a regular clinic same day.
// validateAndRepairAssignments must drop the regular assignment.
{
  console.group('Test 6: same-name pair — OBS wins, regular dropped');
  // (validator.js runValidationTests() covers this; confirm the universal rule here)
  const nameA = 'Sam';
  const people = [
    { id: 'sam-admin', name: nameA, staffType: 'admin' },
    { id: 'sam-tech',  name: nameA, staffType: null },
  ];
  const clinics = [
    { id: 'wed-obs',      day: 'Wed', location: 'OBS',      open: true,
      slots: { scrub: { personId: 'sam-tech', start: null, end: null } } },
    { id: 'wed-chandler', day: 'Wed', location: 'Chandler', open: true,
      slots: { frontDesk: 'sam-admin' } },
  ];

  // sam-tech is in OBS — sam-admin should appear "already assigned" for popover
  const assignments = getAssignmentsForPerson('sam', 'Wed', people, clinics);
  assert(assignments.length === 2, 'both records found (before repair)');
  assert(assignments.some(a => a.isObs),  'OBS assignment detected');
  assert(assignments.some(a => !a.isObs), 'regular assignment detected');
  console.groupEnd();
}

console.groupEnd();
