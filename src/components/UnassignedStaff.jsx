import { useDraggable } from '@dnd-kit/core';
import { useApp } from '../context/AppContext.jsx';
import { DAYS, getAssignmentsForPerson } from '../data/seed.js';
import { getAbsencesOnDay, unavailableLabel } from '../utils/absenceUtils.js';

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
  const { data, absences, weekMonday } = useApp();

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

  // Split canonical into { unassigned, unavailable } for a given day
  function splitDayColumn(day, canonical) {
    const unavailable = [];
    const unassigned = [];

    for (const entry of canonical) {
      const { displayRecord, allRecords } = entry;
      const pKey = displayRecord.name.trim().toLowerCase();

      // Absence check first
      const dayAbsences = getAbsencesOnDay(pKey, day, weekMonday, absences);
      if (dayAbsences.length > 0) {
        unavailable.push({ ...entry, absenceLabel: unavailableLabel(dayAbsences[0]) });
        continue;
      }

      // Physical person is considered "off" only when ALL their records mark this day off.
      const allOff = allRecords.every(r => (r.daysOff ?? []).includes(day));
      if (allOff) continue; // permanent day off — not shown in either group

      // Assigned via any rendered clinic slot today (name-based, rendered slots only).
      const nameKey = displayRecord.name.trim().toLowerCase();
      const clinicAssignments = getAssignmentsForPerson(nameKey, day, data.people, data.clinics);
      if (clinicAssignments.length > 0) continue;

      // Assigned via additional task today.
      const samePersonIds = new Set(allRecords.map(r => r.id));
      if ((data.additionalTasks ?? []).some(t => t.day === day && samePersonIds.has(t.assignedPersonId))) {
        continue;
      }

      unassigned.push(entry);
    }

    return { unassigned, unavailable };
  }

  // Render one day column for the "available" grid
  function renderAvailableColumn(day, canonical) {
    const { unassigned, unavailable } = splitDayColumn(day, canonical);
    const isEmpty = unassigned.length === 0 && unavailable.length === 0;

    return (
      <div key={day} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {isEmpty ? (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', padding: '4px 0' }}>
            All Assigned
          </div>
        ) : (
          <>
            {unassigned.map(({ displayRecord }) => (
              <DraggablePersonChip key={displayRecord.id} person={displayRecord} onPersonClick={onPersonClick} />
            ))}
          </>
        )}
      </div>
    );
  }

  // Render one day column for the "unavailable" grid
  function renderUnavailableColumn(day, canonical) {
    const { unavailable } = splitDayColumn(day, canonical);
    if (unavailable.length === 0) return <div key={day} />;

    return (
      <div key={day} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {unavailable.map(({ displayRecord, absenceLabel: label }) => (
          <div
            key={displayRecord.id}
            style={{ opacity: 0.45, pointerEvents: 'none', userSelect: 'none' }}
            title={label}
          >
            <div className="person-chip" style={{ cursor: 'default' }}>
              <div className="dot" style={{ background: displayRecord.color }} />
              <span style={{ flex: 1, minWidth: 0 }}>{displayRecord.name}</span>
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', paddingLeft: 4, marginTop: 1 }}>{label}</div>
          </div>
        ))}
      </div>
    );
  }

  // Check if any day has unavailable staff for this group
  function hasAnyUnavailable(canonical) {
    return DAYS.some(day => {
      const { unavailable } = splitDayColumn(day, canonical);
      return unavailable.length > 0;
    });
  }

  return (
    <div style={{ padding: '0 16px 16px', flexShrink: 0 }}>
      <div style={{ minWidth: 1000 }}>
        {techCanonical.length > 0 && (
          <>
            <div className="tasks-section-header" style={{ marginBottom: 8 }}>Unassigned Tech</div>
            <div className="tasks-grid" style={{ marginBottom: hasAnyUnavailable(techCanonical) ? 8 : 16 }}>
              {DAYS.map(day => renderAvailableColumn(day, techCanonical))}
            </div>
            {hasAnyUnavailable(techCanonical) && (
              <>
                <div className="tasks-section-header" style={{ marginBottom: 8, opacity: 0.6 }}>Unavailable Tech Today</div>
                <div className="tasks-grid" style={{ marginBottom: 16 }}>
                  {DAYS.map(day => renderUnavailableColumn(day, techCanonical))}
                </div>
              </>
            )}
          </>
        )}
        {adminCanonical.length > 0 && (
          <>
            <div className="tasks-section-header" style={{ marginBottom: 8 }}>Unassigned Front Desk / Admin</div>
            <div className="tasks-grid" style={{ marginBottom: hasAnyUnavailable(adminCanonical) ? 8 : 0 }}>
              {DAYS.map(day => renderAvailableColumn(day, adminCanonical))}
            </div>
            {hasAnyUnavailable(adminCanonical) && (
              <>
                <div className="tasks-section-header" style={{ marginBottom: 8, opacity: 0.6 }}>Unavailable Admin Today</div>
                <div className="tasks-grid">
                  {DAYS.map(day => renderUnavailableColumn(day, adminCanonical))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
