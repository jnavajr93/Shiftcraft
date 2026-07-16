import { useDraggable } from '@dnd-kit/core';
import { useApp } from '../context/AppContext.jsx';
import { DAYS, getAssignmentsForPerson } from '../data/seed.js';

function DraggablePersonChip({ person, onPersonClick }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: person.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className="person-chip"
      style={{ cursor: 'grab', touchAction: 'none', opacity: isDragging ? 0.4 : 1 }}
      onClick={() => onPersonClick(person.id)}
    >
      <div className="dot" style={{ background: person.color }} />
      {person.name}
    </div>
  );
}

export default function UnassignedStaff({ onPersonClick }) {
  const { data } = useApp();

  // Build canonical person list — one entry per display name.
  // For linked pairs (admin + tech record with same name), prefer the tech record
  // for display color/id. The eligibility check is name-based so it covers both records.
  const canonicalPeople = (() => {
    const seen = new Set();
    const result = [];
    for (const p of data.people) {
      const key = p.name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const allRecords = data.people.filter(q => q.name.trim().toLowerCase() === key);
      // Non-admin record preferred for display (has tech role colors)
      const displayRecord = allRecords.find(q => q.staffType !== 'admin') ?? allRecords[0];
      result.push({ displayRecord, allRecords });
    }
    return result;
  })();

  return (
    <div style={{ padding: '0 16px 16px', flexShrink: 0 }}>
      <div style={{ minWidth: 1000 }}>
        <div className="tasks-section-header" style={{ marginBottom: 8 }}>Unassigned Staff</div>
        <div className="tasks-grid">
          {DAYS.map(day => {
            const unassigned = canonicalPeople.filter(({ displayRecord, allRecords }) => {
              // Physical person is considered "off" only when ALL their records mark this day off.
              const allOff = allRecords.every(r => (r.daysOff ?? []).includes(day));
              if (allOff) return false;

              // Assigned via any rendered clinic slot today (name-based, rendered slots only).
              // getAssignmentsForPerson uses getBoardClinics + getRenderedSlotEntries internally,
              // so inactive FD slots and shadow clinics are invisible here.
              const nameKey = displayRecord.name.trim().toLowerCase();
              const clinicAssignments = getAssignmentsForPerson(nameKey, day, data.people, data.clinics);
              if (clinicAssignments.length > 0) return false;

              // Assigned via additional task today.
              const samePersonIds = new Set(allRecords.map(r => r.id));
              if ((data.additionalTasks ?? []).some(t => t.day === day && samePersonIds.has(t.assignedPersonId))) {
                return false;
              }

              return true;
            });

            return (
              <div key={day} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {unassigned.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', padding: '4px 0' }}>
                    All assigned
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {unassigned.map(({ displayRecord }) => (
                      <DraggablePersonChip
                        key={displayRecord.id}
                        person={displayRecord}
                        onPersonClick={onPersonClick}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
