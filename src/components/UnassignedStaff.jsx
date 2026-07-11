import { useApp } from '../context/AppContext.jsx';
import { DAYS, getSlotPersonId } from '../data/seed.js';

export default function UnassignedStaff({ onPersonClick }) {
  const { data, isAdmin } = useApp();

  if (!isAdmin) return null;

  return (
    <div style={{ padding: '0 16px 16px', flexShrink: 0 }}>
      <div style={{ minWidth: 1000 }}>
        <div className="tasks-section-header" style={{ marginBottom: 8 }}>Unassigned Staff</div>
        <div className="tasks-grid">
          {DAYS.map(day => {
            const assignedIds = new Set();

            // Collect everyone assigned to any open clinic slot this day
            for (const clinic of data.clinics) {
              if (clinic.day !== day || !clinic.open) continue;
              for (const sv of Object.values(clinic.slots)) {
                const pid = getSlotPersonId(sv);
                if (pid) assignedIds.add(pid);
              }
            }

            // Collect everyone assigned to any additional task this day
            for (const task of data.additionalTasks ?? []) {
              if (task.day === day && task.assignedPersonId) {
                assignedIds.add(task.assignedPersonId);
              }
            }

            const unassigned = data.people.filter(p =>
              !assignedIds.has(p.id) && !(p.daysOff ?? []).includes(day)
            );

            return (
              <div key={day} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {unassigned.length === 0 ? (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', padding: '4px 0' }}>
                    All assigned
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {unassigned.map(person => (
                      <div
                        key={person.id}
                        className="person-chip"
                        style={{ cursor: 'pointer' }}
                        onClick={() => onPersonClick(person.id)}
                      >
                        <div className="dot" style={{ background: person.color }} />
                        {person.name}
                      </div>
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
