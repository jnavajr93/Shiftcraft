/**
 * absenceUtils.js
 * Pure functions for absence-based blocking in Shiftcraft.
 * No React / component imports.
 */

const DAYS_LIST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const NON_BLOCKING = new Set(['DoctorOff', 'Research']);

/** Convert a day name + weekMonday Date to a 'YYYY-MM-DD' string. */
export function dayToDateStr(dayName, weekMonday) {
  const idx = DAYS_LIST.indexOf(dayName);
  if (idx < 0) return null;
  const d = new Date(weekMonday);
  d.setUTCDate(weekMonday.getUTCDate() + idx);
  return d.toISOString().slice(0, 10);
}

/**
 * Returns all blocking absences for this person on this day.
 * personKey must already be trimmed + lowercased.
 */
export function getAbsencesOnDay(personKey, dayName, weekMonday, absences) {
  const dateStr = dayToDateStr(dayName, weekMonday);
  if (!dateStr) return [];
  return absences.filter(a => {
    if (NON_BLOCKING.has(a.type)) return false;
    const key = (a.person_name ?? '').trim().toLowerCase();
    if (key !== personKey) return false;
    return a.start_date <= dateStr && a.end_date >= dateStr;
  });
}

/**
 * Returns true if an absence window overlaps with [slotStart, slotEnd].
 * Full-day absence (partial_start/end both null) always overlaps.
 * Treat null slotStart as 0, null slotEnd as Infinity.
 */
export function absenceOverlapsSlot(absence, slotStart, slotEnd) {
  const sStart = slotStart != null ? slotStart : 0;
  const sEnd   = slotEnd   != null ? slotEnd   : Infinity;

  // Full-day absence always overlaps
  if (absence.partial_start == null && absence.partial_end == null) return true;

  const aStart = absence.partial_start ?? 0;
  const aEnd   = absence.partial_end   ?? Infinity;

  // Partial overlap: slotStart < absenceEnd AND slotEnd > absenceStart
  return sStart < aEnd && sEnd > aStart;
}

/**
 * Returns the first blocking absence for personKey on dayName+slot, or null.
 * slotStart/slotEnd = null means treat as full-day (block on any absence).
 */
export function getBlockingAbsence(personKey, dayName, weekMonday, absences, slotStart = null, slotEnd = null) {
  const dayAbsences = getAbsencesOnDay(personKey, dayName, weekMonday, absences);
  for (const absence of dayAbsences) {
    if (absenceOverlapsSlot(absence, slotStart, slotEnd)) return absence;
  }
  return null;
}

/** Internal: formats minutes-from-midnight to "8 AM", "12 PM", "3:30 PM" */
function minutesToTimeSimple(minutes) {
  const totalMins = Math.round(minutes);
  const h24 = Math.floor(totalMins / 60);
  const m   = totalMins % 60;
  const period = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  if (m === 0) return `${h12} ${period}`;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

/**
 * Short reason for popover ineligible list.
 * Full-day:    "Absent — Approved Time Off"
 * Partial-day: "Absent 8 AM–12 PM — Sick"
 */
export function formatAbsenceIneligibleReason(absence) {
  if (absence.partial_start == null && absence.partial_end == null) {
    return `Absent — ${absence.type}`;
  }
  const startStr = absence.partial_start != null ? minutesToTimeSimple(absence.partial_start) : '?';
  const endStr   = absence.partial_end   != null ? minutesToTimeSimple(absence.partial_end)   : '?';
  return `Absent ${startStr}–${endStr} — ${absence.type}`;
}

/**
 * Label for Unavailable Today row.
 * Full-day:                  "Approved Time Off"
 * Partial-day with end:      "Sick · Off until 12 PM"
 * Partial-day with start only: "Sick · Off from 8 AM"
 */
export function unavailableLabel(absence) {
  if (absence.partial_start == null && absence.partial_end == null) {
    return absence.type;
  }
  if (absence.partial_end != null) {
    return `${absence.type} · Off until ${minutesToTimeSimple(absence.partial_end)}`;
  }
  return `${absence.type} · Off from ${minutesToTimeSimple(absence.partial_start)}`;
}

/**
 * Full block message: "{personName} is off {dayLabel} — {type}"
 * with optional partial window appended.
 */
export function formatAbsenceBlockMsg(personName, dayLabel, absence) {
  const base = `${personName} is off ${dayLabel} — ${absence.type}`;
  if (absence.partial_start == null && absence.partial_end == null) return base;
  const startStr = absence.partial_start != null ? minutesToTimeSimple(absence.partial_start) : '?';
  const endStr   = absence.partial_end   != null ? minutesToTimeSimple(absence.partial_end)   : '?';
  return `${base} (${startStr}–${endStr})`;
}
