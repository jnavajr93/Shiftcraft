import { useState, useCallback } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Pencil, AlertTriangle, Users, Power } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { getSlotLabel, getSlotTimeLabel, SLOT_TYPES } from '../data/seed.js';
import SlotPopover from './SlotPopover.jsx';
import { getConflictPersonDays } from './ConflictBanner.jsx';

function PatientBadge({ count }) {
  if (count == null) return null;
  const cls = count > 50 ? 'red' : count >= 30 ? 'amber' : 'neutral';
  return (
    <div className="patient-badge">
      <div className={`pt-dot ${cls}`} />
      {count}
    </div>
  );
}

function SlotRow({ clinic, slotType, onPersonClick, matchedPersonIds, hasSearch, conflictSet, clinicOpen }) {
  const { data, isAdmin, assignSlot } = useApp();
  const personId = clinic.slots[slotType];
  const person = personId ? data.people.find(p => p.id === personId) : null;
  const [showPopover, setShowPopover] = useState(false);

  const droppableId = `slot:${clinic.id}:${slotType}`;
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: droppableId });

  const setRef = useCallback((el) => { setDropRef(el); }, [setDropRef]);

  const hasRoleWarning = person && !person.roles.map(r => r.toLowerCase()).includes(slotType);
  const hasLockedWarning = person && person.lockedTo?.length > 0 && !person.lockedTo.includes(clinic.provider);
  const showWarning = hasRoleWarning || hasLockedWarning;
  const hasConflict = person && conflictSet && conflictSet.has(`${person.id}:${clinic.day}`);

  const slotLabel = getSlotLabel(slotType, clinic.location);
  const slotTime = getSlotTimeLabel(clinic, slotType);

  const isHighlighted = hasSearch && person && matchedPersonIds.includes(personId);
  const isDimmed = hasSearch && person && !matchedPersonIds.includes(personId);
  const interactive = isAdmin && clinicOpen;

  const handleRowClick = () => {
    if (interactive) setShowPopover(s => !s);
  };

  return (
    <div
      ref={setRef}
      className={[
        'slot-row',
        isOver && interactive ? 'drop-target' : '',
        showWarning ? 'warning-slot' : '',
      ].filter(Boolean).join(' ')}
      onClick={handleRowClick}
      style={{ cursor: interactive ? 'pointer' : 'default' }}
    >
      <div className="slot-label-col">
        <div className="slot-label">{slotType}</div>
        {slotTime && <div className="slot-time">{slotTime}</div>}
      </div>
      <div className="slot-content">
        {person ? (
          <div
            className={[
              'person-chip',
              isHighlighted ? 'highlighted' : '',
              isDimmed ? 'dimmed' : '',
              hasConflict ? 'conflict-ring' : '',
            ].filter(Boolean).join(' ')}
            onClick={e => { e.stopPropagation(); onPersonClick(personId); }}
          >
            <div className="dot" style={{ background: person.color }} />
            {person.name}
            {hasConflict && <AlertTriangle size={11} style={{ color: 'var(--red)', flexShrink: 0 }} />}
          </div>
        ) : (
          <div className={[
            'slot-empty',
            isOver && interactive ? 'droppable' : '',
            slotType === 'scribe' ? 'slot-empty-scribe' : '',
          ].filter(Boolean).join(' ')}>
            {slotLabel}
          </div>
        )}
        {showWarning && (
          <span
            className="warning-icon"
            title={hasLockedWarning ? `Locked to ${person.lockedTo.join(', ')}` : 'Not cleared for this role'}
          >
            <AlertTriangle size={13} />
          </span>
        )}
      </div>
      {showPopover && interactive && (
        <SlotPopover
          clinic={clinic}
          slotType={slotType}
          currentPersonId={personId}
          onAssign={(pid) => { assignSlot(clinic.id, slotType, pid); setShowPopover(false); }}
          onRemove={() => { assignSlot(clinic.id, slotType, null); setShowPopover(false); }}
          onClose={() => setShowPopover(false)}
        />
      )}
    </div>
  );
}

export default function ClinicCard({ clinic, onPersonClick, onEditClinic, matchedPersonIds, hasSearch }) {
  const { data, isAdmin, updateClinic } = useApp();
  const showMiddleHint = isAdmin && clinic.open && (clinic.patientCount ?? 0) > 50 && !clinic.slots.middle;
  const conflictSet = isAdmin ? getConflictPersonDays(data.clinics, data.people) : null;

  if (!clinic.open && !isAdmin) return null;

  return (
    <div className={`clinic-card${!clinic.open ? ' closed' : ''}`}>
      <div className="clinic-card-header">
        <div>
          <div className="clinic-card-title">{clinic.provider}</div>
          <div className="clinic-card-sub">{clinic.location}</div>
        </div>
        <div className="clinic-card-header-right">
          {clinic.open && <PatientBadge count={clinic.patientCount} />}
          {isAdmin && (
            <>
              <button
                className="clinic-edit-btn"
                onClick={(e) => { e.stopPropagation(); updateClinic(clinic.id, { open: !clinic.open }); }}
                title={clinic.open ? 'Mark as closed this week' : 'Mark as open'}
                style={{ color: clinic.open ? 'var(--text-muted)' : 'var(--red)' }}
              >
                <Power size={14} />
              </button>
              <button
                className="clinic-edit-btn"
                onClick={(e) => { e.stopPropagation(); onEditClinic(clinic.id); }}
                title="Edit clinic"
              >
                <Pencil size={14} />
              </button>
            </>
          )}
        </div>
      </div>
      {!clinic.open && isAdmin ? (
        <div style={{
          padding: '10px 12px',
          fontSize: 12,
          color: 'var(--text-muted)',
          fontStyle: 'italic',
          textAlign: 'center',
        }}>
          Closed this week
        </div>
      ) : (
        <div>
          {SLOT_TYPES.map(slotType => (
            <SlotRow
              key={slotType}
              clinic={clinic}
              slotType={slotType}
              onPersonClick={onPersonClick}
              matchedPersonIds={matchedPersonIds}
              hasSearch={hasSearch}
              conflictSet={conflictSet}
              clinicOpen={clinic.open}
            />
          ))}
        </div>
      )}
      {showMiddleHint && (
        <div className="hint-middle">
          <Users size={12} />
          Consider adding Middle ({clinic.patientCount} patients)
        </div>
      )}
    </div>
  );
}
