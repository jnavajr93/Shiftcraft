import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { getSlotPersonId } from '../data/seed.js';

export function detectConflicts(clinics, people) {
  // Returns array of { personId, personName, day, clinicA, clinicB }
  const conflicts = [];
  const personMap = Object.fromEntries(people.map(p => [p.id, p]));

  for (const person of people) {
    // For each day, collect all clinics this person is assigned to
    const byDay = {};
    for (const clinic of clinics) {
      if (!clinic.open) continue;
      for (const [, slotVal] of Object.entries(clinic.slots)) {
        if (getSlotPersonId(slotVal) === person.id) {
          if (!byDay[clinic.day]) byDay[clinic.day] = [];
          byDay[clinic.day].push(clinic);
        }
      }
    }
    for (const [day, assigned] of Object.entries(byDay)) {
      if (assigned.length > 1) {
        // Multiple clinics on the same day = conflict
        for (let i = 1; i < assigned.length; i++) {
          conflicts.push({
            personId: person.id,
            personName: person.name,
            day,
            clinicA: assigned[0],
            clinicB: assigned[i],
          });
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
              <strong>{c.personName}</strong> is double-booked on {c.day} —{' '}
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
