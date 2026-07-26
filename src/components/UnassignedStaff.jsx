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

  function splitDayColumn(day, canonical) {
    const unavailable = [];
    const unassigned = [];

    for (const entry of canonical) {
      const { displayRecord, allRecords } = entry;
      const pKey = displayRecord.name.trim().toLowerCase();

      const dayAbsences = getAbsencesOnDay(pKey, day, weekMonday, absences);
      if (dayAbsences.length > 0) {
        unavailable.push({ ...entry, absenceLabel: unavailableLabel(dayAbsences[0]) });
        continue;
      }

      const allOff = allRecords.every(r => (r.daysOff ?? []).includes(day));
      if (allOff) continue;

      const nameKey = displayRecord.name.trim().toLowerCase();
      const clinicAssignments = getAssignmentsForPerson(nameKey, day, data.people, data.clinics);
      if (clinicAssignments.length > 0) continue;

      const samePersonIds = new Set(allRecords.map(r => r.id));
      if ((data.additionalTasks ?? []).some(t => t.day === day && samePersonIds.has(t.assignedPersonId))) {
        continue;
      }

      unassigned.push(entry);
    }

    return { unassigned, unavailable };
  }

  // Render one day column of unassigned chips for a given canonical list
  function renderUnassignedColumn(day, canonical) {
    const { unassigned } = splitDayColumn(day, canonical);
    if (unassigned.length === 0) return <div key={day} />;
    return (
      <div key={day} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {unassigned.map(({ displayRecord }) => (
          <DraggablePersonChip key={displayRecord.id} person={displayRecord} onPersonClick={onPersonClick} />
        ))}
      </div>
    );
  }

  // Check if a day column has any unassigned people across both groups
  function dayHasAnyUnassigned(day) {
    const t = splitDayColumn(day, techCanonical).unassigned;
    const a = splitDayColumn(day, adminCanonical).unassigned;
    return t.length > 0 || a.length > 0;
  }

  // Merge unavailable from both groups for a day, deduped by personKey
  function getMergedUnavailable(day) {
    const seen = new Set();
    const result = [];
    const techUnavail  = splitDayColumn(day, techCanonical).unavailable;
    const adminUnavail = splitDayColumn(day, adminCanonical).unavailable;
    for (const entry of [...techUnavail, ...adminUnavail]) {
      const key = entry.displayRecord.name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(entry);
    }
    return result;
  }

  const hasAnyUnavailable = DAYS.some(day => getMergedUnavailable(day).length > 0);

  // Whether the tech or admin grid has anything to show for a given day
  const techHasAny  = DAYS.some(day => splitDayColumn(day, techCanonical).unassigned.length > 0);
  const adminHasAny = DAYS.some(day => splitDayColumn(day, adminCanonical).unassigned.length > 0);

  if (!techHasAny && !adminHasAny && !hasAnyUnavailable) return null;

  return (
    <div style={{ padding: '0 16px 16px', flexShrink: 0 }}>
      <div style={{ minWidth: 1000 }}>

        {/* ── Unassigned (Tech + Admin in one section) ── */}
        {(techHasAny || adminHasAny) && (
          <div style={{ marginBottom: hasAnyUnavailable ? 8 : 16 }}>
            <div className="tasks-section-header" style={{ marginBottom: 8 }}>Unassigned</div>

            {/* Tech sub-section */}
            {techHasAny && (
              <>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
                  Tech
                </div>
                <div className="tasks-grid" style={{ marginBottom: adminHasAny ? 10 : 0 }}>
                  {DAYS.map(day => renderUnassignedColumn(day, techCanonical))}
                </div>
              </>
            )}

            {/* Divider + Admin sub-section */}
            {adminHasAny && (
              <>
                {techHasAny && (
                  <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0 10px' }} />
                )}
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
                  Front Desk / Admin
                </div>
                <div className="tasks-grid">
                  {DAYS.map(day => renderUnassignedColumn(day, adminCanonical))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Unavailable Staff (merged, deduped) ── */}
        {hasAnyUnavailable && (
          <>
            <div className="tasks-section-header" style={{ marginBottom: 8, opacity: 0.6 }}>Unavailable Staff</div>
            <div className="tasks-grid">
              {DAYS.map(day => {
                const merged = getMergedUnavailable(day);
                if (merged.length === 0) return <div key={day} />;
                return (
                  <div key={day} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {merged.map(({ displayRecord, absenceLabel: label }) => (
                      <div
                        key={displayRecord.id}
                        className="person-chip"
                        style={{ cursor: 'default', opacity: 0.45, pointerEvents: 'none', userSelect: 'none' }}
                        title={label}
                      >
                        <div className="dot" style={{ background: displayRecord.color }} />
                        <span style={{ minWidth: 0 }}>{displayRecord.name}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4, flexShrink: 0 }}>{label}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </>
        )}

      </div>
    </div>
  );
}
