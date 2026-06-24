export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
export const ROLES = ['Scribe', 'Opener', 'Middle', 'Closing', 'Training'];
export const SLOT_TYPES = ['scribe', 'opener', 'closing', 'middle', 'training'];

export function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

export function minutesToTime(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour}${m > 0 ? ':' + String(m).padStart(2, '0') : ''} ${ampm}`;
}

export function getSlotTimeLabel(clinic, slotType) {
  const { startTime, endTime } = clinic;
  switch (slotType) {
    case 'scribe':   return null;
    case 'opener':   return `${minutesToTime(startTime)} – 5:00 PM`;
    case 'closing':  return `9:00 AM – ${minutesToTime(endTime)}`;
    case 'middle':   return '9:00 AM – 6:00 PM';
    case 'training': return '8:00 AM – 5:00 PM';
    default:         return null;
  }
}

export function getSlotLabel(slotType, location) {
  if (slotType === 'scribe') return `Scribe @ ${location}`;
  return slotType.charAt(0).toUpperCase() + slotType.slice(1);
}

export function calcSlotHours(clinic, slotType) {
  const { startTime, endTime } = clinic;
  switch (slotType) {
    case 'scribe':   return (endTime - startTime) / 60;
    case 'opener':   return (17 * 60 - startTime) / 60;
    case 'closing':  return (endTime - 9 * 60) / 60;
    case 'middle':   return 9;
    case 'training': return 9;
    default:         return 0;
  }
}

export function calcPersonWeeklyHours(personId, clinics) {
  let total = 0;
  for (const clinic of clinics) {
    if (!clinic.open) continue;
    for (const [slotType, assignedId] of Object.entries(clinic.slots)) {
      if (assignedId === personId) {
        total += calcSlotHours(clinic, slotType);
      }
    }
  }
  return Math.round(total * 100) / 100;
}

export function getSeedData() {
  const people = [
    { id: 'john',    name: 'John',    color: '#2563eb', roles: ['Scribe'],                                   locations: [], grade: null, lockedTo: 'Dr. R', preferences: { preferredLocations: [], daysOff: [] }, targetHours: 40 },
    { id: 'jc',      name: 'JC',      color: '#16a34a', roles: ['Scribe'],                                   locations: [], grade: null, lockedTo: 'Dr. A', preferences: { preferredLocations: [], daysOff: [] }, targetHours: 40 },
    { id: 'nikole',  name: 'Nikole',  color: '#0891b2', roles: ['Scribe'],                                   locations: [], grade: null, lockedTo: null,    preferences: { preferredLocations: [], daysOff: [] }, targetHours: 40 },
    { id: 'yadi',    name: 'Yadi',    color: '#db2777', roles: ['Opener', 'Middle', 'Closing'],              locations: [], grade: null, lockedTo: null,    preferences: { preferredLocations: [], daysOff: [] }, targetHours: 40 },
    { id: 'martha',  name: 'Martha',  color: '#9333ea', roles: ['Opener'],                                   locations: [], grade: null, lockedTo: null,    preferences: { preferredLocations: [], daysOff: [] }, targetHours: 40 },
    { id: 'alondra', name: 'Alondra', color: '#ea580c', roles: ['Opener', 'Middle', 'Closing', 'Scribe'],   locations: [], grade: null, lockedTo: null,    preferences: { preferredLocations: [], daysOff: [] }, targetHours: 40 },
    { id: 'jaron',   name: 'Jaron',   color: '#65a30d', roles: ['Opener', 'Middle', 'Closing'],              locations: [], grade: null, lockedTo: null,    preferences: { preferredLocations: [], daysOff: [] }, targetHours: 40 },
    { id: 'jocelyn', name: 'Jocelyn', color: '#0d9488', roles: ['Opener', 'Middle', 'Closing'],              locations: [], grade: null, lockedTo: null,    preferences: { preferredLocations: [], daysOff: [] }, targetHours: 40 },
    { id: 'itzel',   name: 'Itzel',   color: '#c026d3', roles: ['Opener', 'Middle', 'Closing'],              locations: [], grade: null, lockedTo: null,    preferences: { preferredLocations: [], daysOff: [] }, targetHours: 40 },
    { id: 'katina',  name: 'Katina',  color: '#0284c7', roles: ['Opener', 'Middle', 'Closing', 'Scribe'],   locations: [], grade: null, lockedTo: null,    preferences: { preferredLocations: [], daysOff: [] }, targetHours: 40 },
    { id: 'lizbeth', name: 'Lizbeth', color: '#7c3aed', roles: ['Opener', 'Middle', 'Closing', 'Scribe'],   locations: [], grade: null, lockedTo: null,    preferences: { preferredLocations: [], daysOff: [] }, targetHours: 40 },
  ];

  const locations = ['Phoenix', 'Chandler', 'Estrella', 'Scottsdale'];
  const providers = ['Dr. R', 'Dr. A', 'Dr. S', 'Dr. B'];

  const clinics = [
    // Monday
    { id: 'mon-phoenix-drr',     day: 'Mon', week: 'A', location: 'Phoenix',    provider: 'Dr. R', open: true, startTime: 480, endTime: 1020, patientCount: 45, slots: { scribe: 'john',   opener: 'yadi',    closing: 'jocelyn', middle: null,    training: null } },
    { id: 'mon-chandler-dra',    day: 'Mon', week: 'A', location: 'Chandler',   provider: 'Dr. A', open: true, startTime: 480, endTime: 1020, patientCount: 30, slots: { scribe: 'jc',     opener: 'martha',  closing: 'jaron',   middle: null,    training: null } },
    // Tuesday
    { id: 'tue-scottsdale-drr',  day: 'Tue', week: 'A', location: 'Scottsdale', provider: 'Dr. R', open: true, startTime: 480, endTime: 1020, patientCount: 55, slots: { scribe: 'john',   opener: 'alondra', closing: 'itzel',   middle: 'katina', training: null } },
    { id: 'tue-estrella-drs',    day: 'Tue', week: 'A', location: 'Estrella',   provider: 'Dr. S', open: true, startTime: 540, endTime: 1080, patientCount: 20, slots: { scribe: 'nikole', opener: 'lizbeth', closing: null,      middle: null,    training: null } },
    // Wednesday
    { id: 'wed-phoenix-dra',     day: 'Wed', week: 'A', location: 'Phoenix',    provider: 'Dr. A', open: true, startTime: 480, endTime: 1020, patientCount: 35, slots: { scribe: 'jc',     opener: 'jocelyn', closing: 'yadi',    middle: null,    training: null } },
    { id: 'wed-chandler-drb',    day: 'Wed', week: 'A', location: 'Chandler',   provider: 'Dr. B', open: true, startTime: 480, endTime: 1020, patientCount: 28, slots: { scribe: null,     opener: 'martha',  closing: 'jaron',   middle: null,    training: null } },
    // Thursday
    { id: 'thu-scottsdale-drr',  day: 'Thu', week: 'A', location: 'Scottsdale', provider: 'Dr. R', open: true, startTime: 480, endTime: 1020, patientCount: 52, slots: { scribe: 'john',   opener: 'katina',  closing: 'itzel',   middle: 'alondra', training: null } },
    { id: 'thu-phoenix-dra',     day: 'Thu', week: 'A', location: 'Phoenix',    provider: 'Dr. A', open: true, startTime: 480, endTime: 1020, patientCount: 42, slots: { scribe: 'jc',     opener: 'lizbeth', closing: 'jocelyn', middle: null,    training: null } },
    // Friday
    { id: 'fri-estrella-drs',    day: 'Fri', week: 'A', location: 'Estrella',   provider: 'Dr. S', open: true, startTime: 540, endTime: 1080, patientCount: 15, slots: { scribe: 'nikole', opener: 'yadi',    closing: null,      middle: null,    training: null } },
    { id: 'fri-phoenix-drr',     day: 'Fri', week: 'A', location: 'Phoenix',    provider: 'Dr. R', open: true, startTime: 480, endTime: 1020, patientCount: 38, slots: { scribe: null,     opener: 'martha',  closing: 'jaron',   middle: null,    training: null } },
  ];

  return { people, clinics, locations, providers };
}
