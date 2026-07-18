// Run with: node src/engine/doctor-off.test.mjs
import { generateSchedule } from './adapter.js';
import { findStaffingGaps, getPostViolations } from './validator.js';

function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; }
  else console.log('  ok:', msg);
}

const CLINIC_ID = 'mon-phoenix-drr';

// Minimal fixture: one Dr. R Monday clinic + staff who can fill it
const fixture = {
  people: [
    { id: 'john',  name: 'John',  color: '#000', roles: ['Scribe'],            skills: [], clearedLocations: [], preferredLocations: [], lockedTo: ['Dr. R'], daysOff: [], availabilityWindows: {}, accommodations: [], targetHours: 40, grade: null, staffType: null, employmentType: 'Full-time' },
    { id: 'alice', name: 'Alice', color: '#111', roles: ['Opener', 'Closing'], skills: [], clearedLocations: [], preferredLocations: [], lockedTo: [],        daysOff: [], availabilityWindows: {}, accommodations: [], targetHours: 40, grade: null, staffType: null, employmentType: 'Full-time' },
    { id: 'bob',   name: 'Bob',   color: '#222', roles: ['Opener', 'Closing'], skills: [], clearedLocations: [], preferredLocations: [], lockedTo: [],        daysOff: [], availabilityWindows: {}, accommodations: [], targetHours: 40, grade: null, staffType: null, employmentType: 'Full-time' },
  ],
  clinics: [{
    id: CLINIC_ID, day: 'Mon', week: 'A', location: 'Phoenix',
    provider: 'Dr. R', open: true, startTime: 480, endTime: 1020, patientCount: 45,
    slots: {
      frontDesk: null, scribe: null, opener: null, closing: null,
      middle: { personId: null, start: null, end: null },
      training: { personId: null, start: null, end: null },
    },
  }],
  locations: ['Phoenix'],
  providers: [{ name: 'Dr. R', requiredSlots: ['scribe', 'opener', 'closing'], conditionalSlots: [] }],
  additionalTasks: [],
  taskTypes: [],
};

const doctorOffClinicIds = new Set([CLINIC_ID]);

// ── Test 1: Doctor off → zero assignments for that clinic ────────────────────
console.log('\n=== Test 1: Dr. R off Mon → zero assignments for that clinic ===');
{
  const { assignments } = generateSchedule(fixture, { doctorOffClinicIds });
  const forClinic = assignments.filter(a => a.clinicId === CLINIC_ID);
  assert(forClinic.length === 0,
    'Zero assignments generated for Dr. R Mon clinic when doctor is off');
}

// ── Test 2: Doctor off clinic excluded from staffing-gap validation ──────────
console.log('\n=== Test 2: Doctor-off clinic excluded from staffing gaps ===');
{
  // Unprotected: gaps expected (no staff assigned)
  const gapsWithout = findStaffingGaps(fixture.clinics);
  assert(gapsWithout.length > 0,
    'Staffing gaps found without doctor-off protection');

  // Protected via getPostViolations with doctorOffClinicIds
  const monday = new Date('2026-07-20T00:00:00Z'); // a Monday
  const violations = getPostViolations(fixture.clinics, fixture.people, [], monday, doctorOffClinicIds);
  const gapViolations = violations.filter(v => v.type === 'gap');
  assert(gapViolations.length === 0,
    'getPostViolations produces no gap violations for doctor-off clinic');
}

// ── Test 3: No DoctorOff → normal generation assigns staff (regression) ──────
console.log('\n=== Test 3: No DoctorOff → normal generation assigns to Dr. R Mon ===');
{
  const { assignments } = generateSchedule(fixture, {});
  const forClinic = assignments.filter(a => a.clinicId === CLINIC_ID);
  assert(forClinic.length > 0,
    'Assignments generated for Dr. R Mon clinic without doctor-off');
  const scribes = forClinic.filter(a => a.slot === 'scribe');
  assert(scribes.some(a => a.personId === 'john'),
    'John (locked to Dr. R) assigned as scribe in normal mode');
}

console.log('\n✓ All doctor-off tests completed.');
