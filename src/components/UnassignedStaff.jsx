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

  // Build canonical list for one staff group.
  // groupFilter: predicate on a people record to include it as the "display record" for this group.
  // Linked records (e.g. Hailey has both tech + admin) appear once in each group.
  // allRecords (both roles) are used for eligibility checks so name-based assignment is accurate.
  function buildCanonical(groupFilter) {
    const seen = new Set();
    const result = [];
    for (const p of data.people) {
      if (!groupFilter(p)) continue;
      const key = p.name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const allRecords = data.people.filter(q => q.name.trim().toLowerCase() === key);
      result.push({ displayRecord: p, allRecords });
    }
    return result;
  }

  const isTech  = p => (p.staffType ?? 'tech') !== 'admin';
  const isAdmin = p => p.staffType === 'admin';

  const techCanonical  = buildCanonical(isTech);
  const adminCanonical = buildCanonical(isAdmin);

  function renderDayColumn(day, canonical) {
    const unassigned = canonical.filter(({ displayRecord, allRecords }) => {
      // Physical person is considered "off" only when ALL their records mark this day off.
      const allOff = allRecords.every(r => (r.daysOff ?? []).includes(day));
      if (allOff) return false;

      // Assigned via any rendered clinic slot today (name-based, rendered slots only).
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
            All Assigned
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
  }

  return (
    <div style={{ padding: '0 16px 16px', flexShrink: 0 }}>
      <div style={{ minWidth: 1000 }}>
        {techCanonical.length > 0 && (
          <>
            <div className="tasks-section-header" style={{ marginBottom: 8 }}>Unassigned Tech</div>
            <div className="tasks-grid" style={{ marginBottom: 16 }}>
              {DAYS.map(day => renderDayColumn(day, techCanonical))}
            </div>
          </>
        )}
        {adminCanonical.length > 0 && (
          <>
            <div className="tasks-section-header" style={{ marginBottom: 8 }}>Unassigned Front Desk / Admin</div>
            <div className="tasks-grid">
              {DAYS.map(day => renderDayColumn(day, adminCanonical))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
