import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { getSlotPersonId, getRenderedSlotEntries, getBoardClinics, slotEffectiveRange, rangesOverlap } from '../data/seed.js';

export function detectConflicts(clinics, people) {
  // Returns array of { personId, personName, day, clinicA, clinicB }
  // Uses time-range overlap (same logic as popover eligibility and solver):
  //   - OBS + anything else same day = conflict regardless of time
  //   - Two non-OBS assignments = conflict only if their effective time ranges overlap
  //   - Two non-OBS assignments that don't overlap (split-day) = NOT a conflict
  const conflicts = [];
  const boardClinics = getBoardClinics(clinics);

  for (const person of people) {
    // Collect { clinic, slotType } per day — need slot to compute effective range
    const byDay = {};
    for (const clinic of boardClinics) {
      if (!clinic.open) continue;
      for (const [slotType, slotVal] of getRenderedSlotEntries(clinic)) {
        if (getSlotPersonId(slotVal) === person.id) {
          if (!byDay[clinic.day]) byDay[clinic.day] = [];
          byDay[clinic.day].push({ clinic, slotType });
        }
      }
    }

    for (const [day, entries] of Object.entries(byDay)) {
      if (entries.length <= 1) continue;

      const obsEntries    = entries.filter(e => e.clinic.location?.toLowerCase() === 'obs');
      const nonObsEntries = entries.filter(e => e.clinic.location?.toLowerCase() !== 'obs');

      if (obsEntries.length > 0) {
        // OBS + any other assignment same day = conflict (day-level, regardless of time)
        for (const nb of nonObsEntries) {
          conflicts.push({ personId: person.id, personName: person.name, day, clinicA: obsEntries[0].clinic, clinicB: nb.clinic });
        }
      } else {
        // Non-OBS only: flag only if effective time ranges actually overlap
        for (let i = 0; i < nonObsEntries.length; i++) {
          for (let j = i + 1; j < nonObsEntries.length; j++) {
            const a = nonObsEntries[i];
            const b = nonObsEntries[j];
            if (rangesOverlap(slotEffectiveRange(a.slotType, a.clinic), slotEffectiveRange(b.slotType, b.clinic))) {
              conflicts.push({ personId: person.id, personName: person.name, day, clinicA: a.clinic, clinicB: b.clinic });
            }
          }
        }
      }
    }
  }
  return conflicts;
}

export function getConflictPersonDays(clinics, people) {
  // Returns Set of 'personId:day' for fast lookup
  const set = new Set();
  const conflicts = detectConflicts(clinics, people);
  for (const c of conflicts) set.add(`${c.personId}:${c.day}`);
  return set;
}

export default function ConflictBanner() {
  const { data } = useApp();
  const [dismissed, setDismissed] = useState([]);

  const conflicts = detectConflicts(data.clinics, data.people)
    .filter(c => !dismissed.includes(`${c.personId}:${c.day}:${c.clinicA.id}:${c.clinicB.id}`));

  if (conflicts.length === 0) return null;

  return (
    <div style={{ flexShrink: 0 }}>
      {conflicts.map(c => {
        const key = `${c.personId}:${c.day}:${c.clinicA.id}:${c.clinicB.id}`;
        return (
          <div key={key} className="conflict-banner">
            <AlertTriangle size={15} color="var(--red)" style={{ flexShrink: 0 }} />
            <span className="conflict-banner-text">
              <strong>{c.personName}</strong> Is Double-Booked On {c.day} —{' '}
              {c.clinicA.provider} @ {c.clinicA.location} and {c.clinicB.provider} @ {c.clinicB.location}
            </span>
            <button
              className="btn btn-icon"
              style={{ minHeight: 28, padding: 4, color: 'var(--red)' }}
              onClick={() => setDismissed(d => [...d, key])}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
