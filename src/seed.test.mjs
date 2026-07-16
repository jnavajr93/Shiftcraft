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
    { id: 'hailey-admin', name: 'Hailey', staffType: 'admin' },
    { id: 'hailey-tech',  name: 'Hailey', staffType: null },
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
      frontDesk: 'hailey-admin',   // stale — inactive on Dr. R Fri
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

  const assignments = getAssignmentsForPerson('hailey', 'Fri', people, clinics);
  assert(assignments.length === 0, 'getAssignmentsForPerson returns empty — stale inactive slot ignored');

  console.groupEnd();
}

// ── Test 2: stale frontDesk on Dr. R Monday is also invisible ───────────────
{
  console.group('Test 2: stale frontDesk on Dr. R Mon — same rule applies');
  const people = [{ id: 'hailey-admin', name: 'Hailey', staffType: 'admin' }];
  const clinics = [{
    id: 'mon-phoenix-drr',
    day: 'Mon',
    location: 'Phoenix',
    provider: 'Dr. R',
    open: true,
    slots: {
      openingFrontDesk: null,
      closingFrontDesk: null,
      frontDesk: 'hailey-admin',  // stale
      scribe: { personId: null, start: null, end: null },
      opener: null, closing: null,
      middle: { personId: null, start: null, end: null },
      training: { personId: null, start: null, end: null },
    },
  }];
  const assignments = getAssignmentsForPerson('hailey', 'Mon', people, clinics);
  assert(assignments.length === 0, 'Mon stale frontDesk not found by getAssignmentsForPerson');
  console.groupEnd();
}

// ── Test 3: active openingFrontDesk IS found ─────────────────────────────────
{
  console.group('Test 3: active openingFrontDesk on Dr. R Fri — IS found');
  const people = [{ id: 'hailey-admin', name: 'Hailey', staffType: 'admin' }];
  const clinics = [{
    id: 'fri-phoenix-drr',
    day: 'Fri',
    location: 'Phoenix',
    provider: 'Dr. R',
    open: true,
    slots: {
      openingFrontDesk: 'hailey-admin',  // active
      closingFrontDesk: null,
      frontDesk: null,
      scribe: { personId: null, start: null, end: null },
      opener: null, closing: null,
      middle: { personId: null, start: null, end: null },
      training: { personId: null, start: null, end: null },
    },
  }];
  const assignments = getAssignmentsForPerson('hailey', 'Fri', people, clinics);
  assert(assignments.length === 1,                              'active openingFrontDesk found');
  assert(assignments[0]?.slotType === 'openingFrontDesk',      'correct slot type returned');
  console.groupEnd();
}

// ── Test 4: regular (non-Dr. R) clinic — plain frontDesk IS active ───────────
{
  console.group('Test 4: frontDesk active on Dr. A Mon (non-Dr. R)');
  const people = [{ id: 'hailey-admin', name: 'Hailey', staffType: 'admin' }];
  const clinics = [{
    id: 'mon-chandler-dra',
    day: 'Mon',
    location: 'Chandler',
    provider: 'Dr. A',
    open: true,
    slots: {
      openingFrontDesk: null,
      closingFrontDesk: null,
      frontDesk: 'hailey-admin',  // active on non-Dr. R clinics
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

  const assignments = getAssignmentsForPerson('hailey', 'Mon', people, clinics);
  assert(assignments.length === 1,          'frontDesk assignment found on Dr. A clinic');
  console.groupEnd();
}

// ── Test 5: OBS clinic — only OBS slot types visible ─────────────────────────
{
  console.group('Test 5: OBS clinic — non-OBS stale key invisible');
  const people = [
    { id: 'hailey-admin', name: 'Hailey', staffType: 'admin' },
    { id: 'hailey-tech',  name: 'Hailey', staffType: null },
  ];
  const clinics = [{
    id: 'tue-obs',
    day: 'Tue',
    location: 'OBS',
    provider: '',
    open: true,
    slots: {
      preop:      { personId: 'hailey-tech', start: null, end: null },
      sterile:    { personId: null, start: null, end: null },
      circulator: { personId: null, start: null, end: null },
      scrub:      { personId: null, start: null, end: null },
      frontDesk:  'hailey-admin',  // stale bad key on OBS clinic
    },
  }];

  const rendered = getRenderedSlotEntries(clinics[0]);
  const renderedKeys = rendered.map(([k]) => k);
  assert(!renderedKeys.includes('frontDesk'), 'OBS: stale frontDesk key excluded');
  assert(renderedKeys.includes('preop'),      'OBS: preop included');

  const assignments = getAssignmentsForPerson('hailey', 'Tue', people, clinics);
  assert(assignments.length === 1,              'OBS: only preop found (not stale frontDesk)');
  assert(assignments[0]?.slotType === 'preop',  'correct OBS slot returned');
  console.groupEnd();
}

console.groupEnd();
