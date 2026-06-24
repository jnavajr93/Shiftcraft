import { useState, useCallback } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Pencil, AlertTriangle, Users } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { getSlotLabel, getSlotTimeLabel, SLOT_TYPES } from '../data/seed.js';
import SlotPopover from './SlotPopover.jsx';

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

function SlotRow({ clinic, slotType, onPersonClick, matchedPersonIds, hasSearch }) {
  const { data, isAdmin, assignSlot } = useApp();
  const personId = clinic.slots[slotType];
  const person = personId ? data.people.find(p => p.id === personId) : null;
  const [showPopover, setShowPopover] = useState(false);

  const droppableId = `slot:${clinic.id}:${slotType}`;
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: droppableId });

  const setRef = useCallback((el) => { setDropRef(el); }, [setDropRef]);

  const hasRoleWarning = person && !person.roles.map(r => r.toLowerCase()).includes(slotType);
  const hasLockedWarning = person && person.lockedTo && person.lockedTo !== clinic.provider;
  const showWarning = hasRoleWarning || hasLockedWarning;

  const slotLabel = getSlotLabel(slotType, clinic.location);
  const slotTime = getSlotTimeLabel(clinic, slotType);

  const isHighlighted = hasSearch && person && matchedPersonIds.includes(personId);
  const isDimmed = hasSearch && person && !matchedPersonIds.includes(personId);

  const handleRowClick = () => {
    if (isAdmin) setShowPopover(s => !s);
  };

  return (
    <div
      ref={setRef}
      className={[
        'slot-row',
        isOver && isAdmin ? 'drop-target' : '',
        showWarning ? 'warning-slot' : '',
      ].filter(Boolean).join(' ')}
      onClick={handleRowClick}
      style={{ cursor: isAdmin ? 'pointer' : 'default' }}
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
            ].filter(Boolean).join(' ')}
            onClick={e => { e.stopPropagation(); onPersonClick(personId); }}
          >
            <div className="dot" style={{ background: person.color }} />
            {person.name}
          </div>
        ) : (
          <div className={`slot-empty ${isOver && isAdmin ? 'droppable' : ''}`}>
            {slotLabel}
          </div>
        )}
        {showWarning && (
          <span
            className="warning-icon"
            title={hasLockedWarning ? `Locked to ${person.lockedTo}` : 'Not cleared for this role'}
          >
            <AlertTriangle size={13} />
          </span>
        )}
      </div>
      {showPopover && isAdmin && (
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
  const { isAdmin } = useApp();
  const showMiddleHint = isAdmin && (clinic.patientCount ?? 0) > 50 && !clinic.slots.middle;

  if (!clinic.open && !isAdmin) return null;

  return (
    <div className={`clinic-card${!clinic.open ? ' closed' : ''}`}>
      <div className="clinic-card-header">
        <div>
          <div className="clinic-card-title">{clinic.provider}</div>
          <div className="clinic-card-sub">{clinic.location}</div>
        </div>
        <div className="clinic-card-header-right">
          <PatientBadge count={clinic.patientCount} />
          {isAdmin && (
            <button
              className="clinic-edit-btn"
              onClick={(e) => { e.stopPropagation(); onEditClinic(clinic.id); }}
              title="Edit clinic"
            >
              <Pencil size={14} />
            </button>
          )}
        </div>
      </div>
      <div>
        {SLOT_TYPES.map(slotType => (
          <SlotRow
            key={slotType}
            clinic={clinic}
            slotType={slotType}
            onPersonClick={onPersonClick}
            matchedPersonIds={matchedPersonIds}
            hasSearch={hasSearch}
          />
        ))}
      </div>
      {showMiddleHint && (
        <div className="hint-middle">
          <Users size={12} />
          Consider adding Middle ({clinic.patientCount} patients)
        </div>
      )}
    </div>
  );
}
