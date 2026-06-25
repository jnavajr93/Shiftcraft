export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
export const ROLES = ['Scribe', 'Opener', 'Middle', 'Closing', 'Training'];
export const SLOT_TYPES = ['scribe', 'opener', 'closing', 'middle', 'training'];
export const EMPLOYMENT_TYPES = ['Full-time', 'Part-time', 'PRN'];
export const SKILLS = ['Workup', 'Treatments', 'FAs', 'Autoclave & Closing'];
export const ACCOMMODATION_TYPES = [
  'extended_lunch',
  'early_leave',
  'no_half_days',
  'no_back_to_back_locations',
  'late_start',
];
export const EARLY_LEAVE_REASONS = ['school', 'childcare', 'medical', 'personal'];

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

export function minutesToTimeInput(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
export function timeInputToMinutes(str) {
  if (!str) return null;
  const [h, m] = str.split(':').map(Number);
  return h * 60 + m;
}
// Extract personId from any slot value (handles both string and new object form)
export function getSlotPersonId(slotVal) {
  if (!slotVal) return null;
  if (typeof slotVal === 'object') return slotVal.personId ?? null;
  return slotVal;
}
// Get { start, end } from a variable slot value
export function getSlotTimeObj(slotVal) {
  if (!slotVal || typeof slotVal !== 'object') return { start: null, end: null };
  return { start: slotVal.start ?? null, end: slotVal.end ?? null };
}
// Format variable slot time for display. Returns null if not set.
export function formatVariableSlotTime(slotVal) {
  if (!slotVal || typeof slotVal !== 'object') return null;
  const { start, end } = slotVal;
  if (start == null && end == null) return null;
  const startStr = start != null ? minutesToTime(start) : '?';
  const endStr = end === 'close' ? 'Close' : end != null ? minutesToTime(end) : '?';
  return `${startStr} – ${endStr}`;
}

export function accommodationLabel(acc) {
  switch (acc.type) {
    case 'extended_lunch':
      return `Extended lunch ${acc.day} ${minutesToTime(acc.start)}–${minutesToTime(acc.end)}`;
    case 'early_leave':
      return `Leave by ${minutesToTime(acc.endTime)} on ${acc.day === '*' ? 'all days' : acc.day} (${acc.reason})`;
    case 'no_half_days':
      return `No half days at ${acc.locationId}`;
    case 'no_back_to_back_locations':
      return 'No back-to-back locations same day';
    case 'late_start':
      return `Late start ${acc.day} at ${minutesToTime(acc.startTime)} (${acc.reason})`;
    default:
      return acc.type;
  }
}

export function getSlotTimeLabel(clinic, slotType) {
  const { startTime } = clinic;
  switch (slotType) {
    case 'scribe':   return null;
    case 'opener':   return `${minutesToTime(startTime)} – 5:00 PM`;
    case 'closing':  return '9:00 AM – ~Close';
    default:         return null;
  }
}

export function getSlotLabel(slotType, location) {
  const label = slotType.charAt(0).toUpperCase() + slotType.slice(1);
  return `${label} @ ${location}`;
}

export function formatOpenerTimeDisplay(clinic, slotVal) {
  const obj = (slotVal && typeof slotVal === 'object') ? slotVal : {};
  const startStr = obj.start != null ? minutesToTime(obj.start) : 'Open';
  const endStr   = obj.end   != null ? minutesToTime(obj.end)   : '5:00 PM';
  return `${startStr} – ${endStr}`;
}

export function formatScribeTimeDisplay(slotVal) {
  if (!slotVal || typeof slotVal !== 'object') return null; // null/null = use default labels
  const { start, end } = slotVal;
  if (start == null && end == null) return null; // show nothing (clinic card) or default label (overlay)
  const startStr = start != null ? minutesToTime(start) : '1st Patient';
  const endStr = end != null ? minutesToTime(end) : 'Close';
  return `${startStr} – ${endStr}`;
}

export function formatTaskTime(task) {
  if (!task || task.start == null) return null;
  const endStr = task.end === 'close' ? 'Close' : task.end != null ? minutesToTime(task.end) : '?';
  return `${minutesToTime(task.start)} – ${endStr}`;
}

export function calcSlotHours(clinic, slotType) {
  const { startTime, endTime } = clinic;
  switch (slotType) {
    case 'scribe': {
      const sv = clinic.slots?.scribe;
      const scriberStart = (sv && typeof sv === 'object') ? (sv.start ?? null) : null;
      const scriberEnd = (sv && typeof sv === 'object') ? (sv.end ?? null) : null;
      const startMin = scriberStart ?? startTime;
      const endMin = scriberEnd ?? (endTime + 75);
      return (endMin - startMin) / 60;
    }
    case 'opener': {
      const sv = clinic.slots?.opener;
      const obj = (sv && typeof sv === 'object') ? sv : {};
      const s = obj.start != null ? obj.start : (startTime - 15);
      const e = obj.end   != null ? obj.end   : 1020;
      return (e - s) / 60;
    }
    case 'closing': {
      const sv = clinic.slots?.closing;
      const obj = (sv && typeof sv === 'object') ? sv : {};
      const s = obj.start != null ? obj.start : 540;
      const e = obj.end   != null ? obj.end   : (endTime + 75);
      return (e - s) / 60;
    }
    case 'middle': {
      const sv = clinic.slots?.middle;
      if (!sv || typeof sv !== 'object' || sv.start == null || sv.end == null) return 0;
      const endMin = sv.end === 'close' ? endTime : sv.end;
      return (endMin - sv.start) / 60;
    }
    case 'training': {
      const sv = clinic.slots?.training;
      if (!sv || typeof sv !== 'object' || sv.start == null || sv.end == null) return 0;
      const endMin = sv.end === 'close' ? endTime : sv.end;
      return (endMin - sv.start) / 60;
    }
    default: return 0;
  }
}

export function calcPersonWeeklyHours(personId, clinics, additionalTasks) {
  let total = 0;
  for (const clinic of clinics) {
    if (!clinic.open) continue;
    for (const [slotType, slotVal] of Object.entries(clinic.slots)) {
      if (getSlotPersonId(slotVal) === personId) {
        total += calcSlotHours(clinic, slotType);
      }
    }
  }
  for (const task of (additionalTasks ?? [])) {
    if (task.assignedPersonId !== personId) continue;
    if (task.start == null || task.end == null) continue;
    let endMin;
    if (task.end === 'close') {
      const dayClinics = clinics.filter(c => c.day === task.day && c.open);
      endMin = dayClinics.length > 0 ? Math.max(...dayClinics.map(c => c.endTime)) : null;
      if (endMin == null) continue;
    } else {
      endMin = task.end;
    }
    total += (endMin - task.start) / 60;
  }
  return Math.round(total * 100) / 100;
}

/** Migrate old Person shape to new shape */
export function migratePerson(p) {
  // Migrate lockedTo: string|null → string[]
  let lockedTo = p.lockedTo ?? [];
  if (typeof lockedTo === 'string') lockedTo = lockedTo ? [lockedTo] : [];
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    employmentType: p.employmentType ?? 'Full-time',
    grade: p.grade ?? null,
    roles: p.roles ?? [],
    skills: p.skills ?? [],
    clearedLocations: p.clearedLocations ?? p.locations ?? [],
    preferredLocations: p.preferredLocations ?? p.preferences?.preferredLocations ?? [],
    lockedTo,
    daysOff: p.daysOff ?? p.preferences?.daysOff ?? [],
    availabilityWindows: p.availabilityWindows ?? {},
    accommodations: p.accommodations ?? [],
    targetHours: p.targetHours ?? 40,
  };
}

export function getSeedData() {
  const people = [
    {
      id: 'john', name: 'John', color: '#2563eb', employmentType: 'Full-time',
      grade: null, roles: ['Scribe'], skills: [], clearedLocations: [], preferredLocations: [],
      lockedTo: ['Dr. R'], daysOff: ['Tue', 'Wed'],
      availabilityWindows: {},
      accommodations: [],
      targetHours: 40,
    },
    {
      id: 'jc', name: 'JC', color: '#16a34a', employmentType: 'Full-time',
      grade: null, roles: ['Scribe'], skills: [], clearedLocations: [], preferredLocations: [],
      lockedTo: ['Dr. A'], daysOff: ['Mon', 'Wed'],
      availabilityWindows: {},
      accommodations: [],
      targetHours: 40,
    },
    {
      id: 'nikole', name: 'Nikole', color: '#0891b2', employmentType: 'Full-time',
      grade: null, roles: ['Scribe'], skills: [], clearedLocations: [], preferredLocations: [],
      lockedTo: [], daysOff: [],
      availabilityWindows: {},
      accommodations: [],
      targetHours: 40,
    },
    {
      id: 'yadi', name: 'Yadi', color: '#db2777', employmentType: 'Full-time',
      grade: null, roles: ['Scribe', 'Opener', 'Middle', 'Closing'], skills: [], clearedLocations: [], preferredLocations: [],
      lockedTo: ['Dr. B'], daysOff: [],
      availabilityWindows: {
        Mon: { startNotBefore: null, endNoLater: 990 },
        Wed: { startNotBefore: null, endNoLater: 990 },
        Thu: { startNotBefore: null, endNoLater: 870 },
        Fri: { startNotBefore: null, endNoLater: 990 },
      },
      accommodations: [],
      targetHours: 40,
    },
    {
      id: 'martha', name: 'Martha', color: '#9333ea', employmentType: 'Part-time',
      grade: null, roles: ['Opener'], skills: [], clearedLocations: [], preferredLocations: [],
      lockedTo: [], daysOff: [],
      availabilityWindows: {},
      accommodations: [
        { type: 'early_leave', day: '*', endTime: 930, reason: 'personal' },
      ],
      targetHours: 24,
    },
    {
      id: 'alondra', name: 'Alondra', color: '#ea580c', employmentType: 'Full-time',
      grade: null, roles: ['Opener', 'Middle', 'Closing', 'Scribe'], skills: [], clearedLocations: [], preferredLocations: [],
      lockedTo: [], daysOff: [],
      availabilityWindows: {},
      accommodations: [],
      targetHours: 40,
    },
    {
      id: 'jaron', name: 'Jaron', color: '#65a30d', employmentType: 'Full-time',
      grade: null, roles: ['Opener', 'Middle', 'Closing'], skills: [], clearedLocations: [], preferredLocations: [],
      lockedTo: [], daysOff: [],
      availabilityWindows: {},
      accommodations: [],
      targetHours: 40,
    },
    {
      id: 'jocelyn', name: 'Jocelyn', color: '#0d9488', employmentType: 'Full-time',
      grade: null, roles: ['Opener', 'Middle', 'Closing'], skills: [], clearedLocations: [], preferredLocations: [],
      lockedTo: [], daysOff: [],
      availabilityWindows: {},
      accommodations: [],
      targetHours: 40,
    },
    {
      id: 'itzel', name: 'Itzel', color: '#c026d3', employmentType: 'Full-time',
      grade: null, roles: ['Opener', 'Middle', 'Closing'], skills: [], clearedLocations: [], preferredLocations: [],
      lockedTo: [], daysOff: [],
      availabilityWindows: {},
      accommodations: [],
      targetHours: 40,
    },
    {
      id: 'katina', name: 'Katina', color: '#0284c7', employmentType: 'Full-time',
      grade: null, roles: ['Opener', 'Middle', 'Closing', 'Scribe'], skills: [], clearedLocations: [], preferredLocations: [],
      lockedTo: [], daysOff: [],
      availabilityWindows: {},
      accommodations: [],
      targetHours: 40,
    },
    {
      id: 'lizbeth', name: 'Lizbeth', color: '#7c3aed', employmentType: 'Full-time',
      grade: null, roles: ['Opener', 'Middle', 'Closing', 'Scribe'], skills: [], clearedLocations: [], preferredLocations: [],
      lockedTo: [], daysOff: [],
      availabilityWindows: {},
      accommodations: [],
      targetHours: 40,
    },
  ];

  const locations = ['Phoenix', 'Chandler', 'Estrella', 'Scottsdale', 'OBS'];
  const providers = ['Dr. R', 'Dr. A', 'Dr. S', 'Dr. B'];

  // Note: JC daysOff Mon,Wed and John daysOff Tue,Wed — seed reflects this
  // Yadi is locked to Dr. B (Skibell) as Scribe on all Dr. B Estrella clinics
  const clinics = [
    // Monday — JC off Mon, John assigned; Yadi scribes Dr. B @ Estrella
    { id: 'mon-phoenix-drr',    day: 'Mon', week: 'A', location: 'Phoenix',    provider: 'Dr. R', open: true, startTime: 480, endTime: 1020, patientCount: 45, slots: { scribe: 'john',   opener: null,      closing: 'jocelyn', middle: { personId: null, start: null, end: null },     training: { personId: null, start: null, end: null } } },
    { id: 'mon-chandler-dra',   day: 'Mon', week: 'A', location: 'Chandler',   provider: 'Dr. A', open: true, startTime: 480, endTime: 1020, patientCount: 30, slots: { scribe: null,     opener: 'martha',  closing: 'jaron',   middle: { personId: null, start: null, end: null },     training: { personId: null, start: null, end: null } } },
    { id: 'mon-estrella-drb',   day: 'Mon', week: 'A', location: 'Estrella',   provider: 'Dr. B', open: true, startTime: 480, endTime:  990, patientCount: 18, slots: { scribe: 'yadi',   opener: null,      closing: null,      middle: { personId: null, start: null, end: null },     training: { personId: null, start: null, end: null } } },
    // Tuesday — John off Tue; Yadi scribes Dr. B @ Estrella
    { id: 'tue-scottsdale-drr', day: 'Tue', week: 'A', location: 'Scottsdale', provider: 'Dr. R', open: true, startTime: 480, endTime: 1020, patientCount: 55, slots: { scribe: null,     opener: 'alondra', closing: 'itzel',   middle: { personId: 'katina', start: null, end: null }, training: { personId: null, start: null, end: null } } },
    { id: 'tue-estrella-drs',   day: 'Tue', week: 'A', location: 'Estrella',   provider: 'Dr. S', open: true, startTime: 540, endTime: 1080, patientCount: 20, slots: { scribe: 'nikole', opener: 'lizbeth', closing: null,      middle: { personId: null, start: null, end: null },     training: { personId: null, start: null, end: null } } },
    { id: 'tue-estrella-drb',   day: 'Tue', week: 'A', location: 'Estrella',   provider: 'Dr. B', open: true, startTime: 480, endTime: 1020, patientCount: 22, slots: { scribe: 'yadi',   opener: null,      closing: null,      middle: { personId: null, start: null, end: null },     training: { personId: null, start: null, end: null } } },
    // Wednesday — JC off Wed, John off Wed; Yadi scribes Dr. B @ Estrella
    { id: 'wed-phoenix-dra',    day: 'Wed', week: 'A', location: 'Phoenix',    provider: 'Dr. A', open: true, startTime: 480, endTime: 1020, patientCount: 35, slots: { scribe: null,     opener: 'jocelyn', closing: null,      middle: { personId: null, start: null, end: null },     training: { personId: null, start: null, end: null } } },
    { id: 'wed-estrella-drb',   day: 'Wed', week: 'A', location: 'Estrella',   provider: 'Dr. B', open: true, startTime: 480, endTime:  990, patientCount: 16, slots: { scribe: 'yadi',   opener: null,      closing: null,      middle: { personId: null, start: null, end: null },     training: { personId: null, start: null, end: null } } },
    // Thursday
    { id: 'thu-scottsdale-drr', day: 'Thu', week: 'A', location: 'Scottsdale', provider: 'Dr. R', open: true, startTime: 480, endTime: 1020, patientCount: 52, slots: { scribe: 'john',   opener: 'katina',  closing: 'itzel',   middle: { personId: 'alondra', start: null, end: null }, training: { personId: null, start: null, end: null } } },
    { id: 'thu-phoenix-dra',    day: 'Thu', week: 'A', location: 'Phoenix',    provider: 'Dr. A', open: true, startTime: 480, endTime: 1020, patientCount: 42, slots: { scribe: 'jc',     opener: 'lizbeth', closing: 'jocelyn', middle: { personId: null, start: null, end: null },     training: { personId: null, start: null, end: null } } },
    // Friday — Yadi scribes Dr. B @ Estrella
    { id: 'fri-estrella-drs',   day: 'Fri', week: 'A', location: 'Estrella',   provider: 'Dr. S', open: true, startTime: 540, endTime: 1080, patientCount: 15, slots: { scribe: 'nikole', opener: null,      closing: null,      middle: { personId: null, start: null, end: null },     training: { personId: null, start: null, end: null } } },
    { id: 'fri-estrella-drb',   day: 'Fri', week: 'A', location: 'Estrella',   provider: 'Dr. B', open: true, startTime: 480, endTime:  990, patientCount: 20, slots: { scribe: 'yadi',   opener: null,      closing: null,      middle: { personId: null, start: null, end: null },     training: { personId: null, start: null, end: null } } },
    { id: 'fri-phoenix-drr',    day: 'Fri', week: 'A', location: 'Phoenix',    provider: 'Dr. R', open: true, startTime: 480, endTime: 1020, patientCount: 38, slots: { scribe: 'john',   opener: 'martha',  closing: 'jaron',   middle: { personId: null, start: null, end: null },     training: { personId: null, start: null, end: null } } },
    // OBS (Surgery Center)
    { id: 'thu-obs', day: 'Thu', week: 'A', location: 'OBS', provider: '', open: true, startTime: 480, endTime: 1020, patientCount: null, slots: { scribe: null, opener: null, closing: null, middle: { personId: null, start: null, end: null }, training: { personId: null, start: null, end: null } } },
    { id: 'fri-obs', day: 'Fri', week: 'A', location: 'OBS', provider: '', open: true, startTime: 480, endTime: 1020, patientCount: null, slots: { scribe: null, opener: null, closing: null, middle: { personId: null, start: null, end: null }, training: { personId: null, start: null, end: null } } },
  ];

  const additionalTasks = [];

  const taskTypes = ['Triage', 'See Matt/Jo', 'Imaging Upload'];

  return { people, clinics, locations, providers, additionalTasks, taskTypes };
}
