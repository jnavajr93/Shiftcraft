import { useState, useCallback } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Pencil, AlertTriangle, Users, Power, Check, X as XIcon } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { getSlotLabel, getSlotTimeLabel, getSlotPersonId, getSlotTimeObj, formatVariableSlotTime, minutesToTimeInput, timeInputToMinutes, SLOT_TYPES } from '../data/seed.js';
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

function VariableTimeEditor({ slotType, slotVal, clinicId, onClose }) {
  const { updateSlotTime } = useApp();
  const timeObj = getSlotTimeObj(slotVal);
  const [startVal, setStartVal] = useState(timeObj.start != null ? minutesToTimeInput(timeObj.start) : '');
  const [endVal, setEndVal] = useState(timeObj.end != null && timeObj.end !== 'close' ? minutesToTimeInput(timeObj.end) : '');
  const [endIsClose, setEndIsClose] = useState(timeObj.end === 'close');

  const handleSave = () => {
    const s = startVal ? timeInputToMinutes(startVal) : null;
    const e = endIsClose ? 'close' : endVal ? timeInputToMinutes(endVal) : null;
    updateSlotTime(clinicId, slotType, s, e);
    onClose();
  };

  return (
    <div className="variable-time-editor" onClick={e => e.stopPropagation()}>
      <div className="variable-time-fields">
        <label className="vte-label">Start</label>
        <input
          type="time"
          className="vte-input"
          value={startVal}
          onChange={e => setStartVal(e.target.value)}
          autoFocus
        />
        <label className="vte-label">End</label>
        {endIsClose ? (
          <span className="vte-close-badge">Close</span>
        ) : (
          <input
            type="time"
            className="vte-input"
            value={endVal}
            onChange={e => setEndVal(e.target.value)}
          />
        )}
        <label className="vte-close-toggle">
          <input
            type="checkbox"
            checked={endIsClose}
            onChange={e => setEndIsClose(e.target.checked)}
          />
          <span>Close</span>
        </label>
      </div>
      <div className="variable-time-actions">
        <button className="btn btn-primary" style={{ minHeight: 26, fontSize: 11, padding: '3px 10px' }} onClick={handleSave}>
          <Check size={11} /> Save
        </button>
        <button className="btn" style={{ minHeight: 26, fontSize: 11, padding: '3px 8px' }} onClick={onClose}>
          <XIcon size={11} />
        </button>
      </div>
    </div>
  );
}

function SlotRow({ clinic, slotType, onPersonClick, matchedPersonIds, hasSearch, conflictSet, clinicOpen }) {
  const { data, isAdmin, assignSlot } = useApp();
  const slotVal = clinic.slots[slotType];
  const personId = getSlotPersonId(slotVal);
  const person = personId ? data.people.find(p => p.id === personId) : null;
  const [showPopover, setShowPopover] = useState(false);
  const [editingTime, setEditingTime] = useState(false);

  const droppableId = `slot:${clinic.id}:${slotType}`;
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: droppableId });
  const setRef = useCallback((el) => { setDropRef(el); }, [setDropRef]);

  const isVariable = slotType === 'middle' || slotType === 'training';
  const hasRoleWarning = person && !person.roles.map(r => r.toLowerCase()).includes(slotType);
  const hasLockedWarning = person && person.lockedTo?.length > 0 && !person.lockedTo.includes(clinic.provider);
  const showWarning = hasRoleWarning || hasLockedWarning;
  const hasConflict = person && conflictSet && conflictSet.has(`${person.id}:${clinic.day}`);

  const slotLabel = getSlotLabel(slotType, clinic.location);
  const slotTime = getSlotTimeLabel(clinic, slotType);
  const variableTimeDisplay = isVariable ? formatVariableSlotTime(slotVal) : null;

  const isHighlighted = hasSearch && person && matchedPersonIds.includes(personId);
  const isDimmed = hasSearch && person && !matchedPersonIds.includes(personId);
  const interactive = isAdmin && clinicOpen;

  const handleRowClick = () => {
    if (interactive) setShowPopover(s => !s);
  };

  return (
    <div>
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
          {slotType === 'closing' ? (
            <div className="slot-time">9:00 AM – <em>Close</em></div>
          ) : (
            slotTime && <div className="slot-time">{slotTime}</div>
          )}
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

      {/* Variable time row for middle/training */}
      {isVariable && (clinicOpen || variableTimeDisplay) && (
        editingTime ? (
          <VariableTimeEditor
            slotType={slotType}
            slotVal={slotVal}
            clinicId={clinic.id}
            onClose={() => setEditingTime(false)}
          />
        ) : (
          <div
            className={`variable-time-row${isAdmin && clinicOpen ? ' editable' : ''}`}
            onClick={isAdmin && clinicOpen ? (e) => { e.stopPropagation(); setEditingTime(true); } : undefined}
          >
            <span>{variableTimeDisplay ?? (isAdmin && clinicOpen ? 'Set time…' : '—')}</span>
            {isAdmin && clinicOpen && <Pencil size={9} style={{ opacity: 0.5 }} />}
          </div>
        )
      )}
    </div>
  );
}

export default function ClinicCard({ clinic, onPersonClick, onEditClinic, matchedPersonIds, hasSearch }) {
  const { data, isAdmin, updateClinic } = useApp();
  const showMiddleHint = isAdmin && clinic.open && (clinic.patientCount ?? 0) > 50 && !getSlotPersonId(clinic.slots.middle);
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
