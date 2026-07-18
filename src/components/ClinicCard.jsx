import { useState, useCallback, useRef } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Pencil, AlertTriangle, Users, Power, Check, X as XIcon } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { getSlotLabel, getSlotTimeLabel, getSlotPersonId, getSlotTimeObj, formatVariableSlotTime, formatOpenerTimeDisplay, formatOpeningFDTimeDisplay, formatClosingFDOverlayDisplay, formatScribeTimeDisplay, formatClosingOverlayDisplay, minutesToTime, minutesToTimeInput, timeInputToMinutes, SLOT_TYPES, OBS_SLOT_TYPES, SLOT_DISPLAY_LABELS, calcSlotHours, calcPersonWeeklyHours } from '../data/seed.js';

function fmtHours(h) {
  return `~${Number(h.toFixed(2))}h`;
}

function HoursPill({ slotHrs }) {
  if (slotHrs == null) return null;
  return <span className="slot-hours-num">{fmtHours(slotHrs)}</span>;
}
import SlotPopover from './SlotPopover.jsx';
import { getConflictPersonDays } from './ConflictBanner.jsx';

function PatientBadge({ count }) {
  if (count == null) return null;
  const cls = count >= 68 ? 'red' : count >= 55 ? 'amber' : 'neutral';
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

function ScribeTimeEditor({ slotVal, clinicId, onClose }) {
  const { updateSlotTime } = useApp();
  const timeObj = getSlotTimeObj(slotVal);
  const [startVal, setStartVal] = useState(timeObj.start != null ? minutesToTimeInput(timeObj.start) : '');
  const [endVal, setEndVal] = useState(timeObj.end != null ? minutesToTimeInput(timeObj.end) : '');

  const handleSave = () => {
    const s = startVal ? timeInputToMinutes(startVal) : null;
    const e = endVal ? timeInputToMinutes(endVal) : null;
    updateSlotTime(clinicId, 'scribe', s, e);
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
        <input
          type="time"
          className="vte-input"
          value={endVal}
          onChange={e => setEndVal(e.target.value)}
        />
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '2px 0 4px' }}>
        Leave blank for defaults (1st Patient / Close)
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

function OpenerTimeEditor({ slotVal, clinicId, slotType = 'opener', defaultEndTime = '17:00', onClose }) {
  const { updateSlotTime } = useApp();
  const obj = (slotVal && typeof slotVal === 'object') ? slotVal : {};
  const [startVal, setStartVal] = useState(obj.start != null ? minutesToTimeInput(obj.start) : '');
  const [endVal, setEndVal] = useState(obj.end != null ? minutesToTimeInput(obj.end) : defaultEndTime);

  const handleSave = () => {
    const s = startVal ? timeInputToMinutes(startVal) : null;
    const e = endVal ? timeInputToMinutes(endVal) : 1020;
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
        <input
          type="time"
          className="vte-input"
          value={endVal}
          onChange={e => setEndVal(e.target.value)}
        />
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '2px 0 4px' }}>
        Leave Start blank for 'Open' (15 min before 1st patient)
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

function ClosingTimeEditor({ slotVal, clinicId, slotType = 'closing', defaultStartTime = '09:00', onClose }) {
  const { updateSlotTime } = useApp();
  const obj = (slotVal && typeof slotVal === 'object') ? slotVal : {};
  const [startVal, setStartVal] = useState(obj.start != null ? minutesToTimeInput(obj.start) : defaultStartTime);
  const [endVal, setEndVal] = useState(obj.end != null ? minutesToTimeInput(obj.end) : '');
  const [endIsClose, setEndIsClose] = useState(obj.end == null);

  const handleSave = () => {
    const s = startVal ? timeInputToMinutes(startVal) : 540;
    const e = endIsClose ? null : endVal ? timeInputToMinutes(endVal) : null;
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
          <span className="vte-close-badge">~Close</span>
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
          <span>~Close</span>
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
  const triggerRef = useRef(null);
  const setRef = useCallback((el) => { setDropRef(el); triggerRef.current = el; }, [setDropRef]);

  const isVariable = slotType === 'middle' || slotType === 'training';
  const isScribe = slotType === 'scribe';
  const isOpener = slotType === 'opener';
  const isClosing = slotType === 'closing';
  const isOpeningFrontDesk = slotType === 'openingFrontDesk';
  const isClosingFrontDesk = slotType === 'closingFrontDesk';
  const isFrontDesk = slotType === 'frontDesk';
  const isFDSlot = isOpeningFrontDesk || isClosingFrontDesk || isFrontDesk;
  // Suppress role warning if person has a slot-specific MUST_PAIR lock for this slot
  const isMustPairForThisSlot = person && (person.lockedTo ?? []).some(e =>
    typeof e === 'object' && e.provider === clinic.provider && e.slot === slotType
  );
  // FD slots have no matching role — suppress the warning
  const hasRoleWarning = person && !isMustPairForThisSlot && !isFDSlot && !person.roles.map(r => r.toLowerCase()).includes(slotType);
  const showWarning = isAdmin && hasRoleWarning;
  const hasConflict = person && conflictSet && conflictSet.has(`${person.id}:${clinic.day}`);

  const slotLabel = getSlotLabel(slotType, clinic.location);
  const slotTime = getSlotTimeLabel(clinic, slotType);
  const variableTimeDisplay = isVariable ? formatVariableSlotTime(slotVal) : null;
  const scribeTimeDisplay = isScribe ? formatScribeTimeDisplay(slotVal) : null;
  const scribeHasOverride = isScribe && slotVal && typeof slotVal === 'object' && (slotVal.start != null || slotVal.end != null);
  const showScribeTimeRow = isScribe && ((isAdmin && clinicOpen) || scribeHasOverride);
  // Opener display (uses clinic start time)
  const openerDisplay = isOpener ? formatOpenerTimeDisplay(clinic, slotVal)
    : isOpeningFrontDesk ? formatOpeningFDTimeDisplay(slotVal) : null;
  // Closing / Closing FD display pieces
  const isClosingType = isClosing || isClosingFrontDesk;
  const closingObj = (isClosingType && slotVal && typeof slotVal === 'object') ? slotVal : {};
  const closingDefaultStart = isClosingFrontDesk ? '10:30 AM' : '9:00 AM';
  const closingStartStr = isClosingType ? (closingObj.start != null ? minutesToTime(closingObj.start) : closingDefaultStart) : null;
  const closingEndStr   = isClosingType ? (closingObj.end   != null ? minutesToTime(closingObj.end)   : null) : null; // null = ~Close
  // Front Desk display
  const frontDeskDisplay = isFrontDesk ? (formatVariableSlotTime(slotVal) ?? 'Open – Close') : null;

  const isHighlighted = hasSearch && person && matchedPersonIds.includes(personId);
  const isDimmed = hasSearch && person && !matchedPersonIds.includes(personId);
  const interactive = isAdmin && clinicOpen;

  // Timeless violation: person assigned to a variable-time slot with no time set
  const isTimelessViolation = isVariable && isAdmin && person &&
    slotVal && typeof slotVal === 'object' && slotVal.start == null && slotVal.end == null;

  // Per-assignment hours: manager mode only, right-aligned on time row
  const slotHrs = (() => {
    if (!person || !isAdmin) return null;
    const h = calcSlotHours(clinic, slotType);
    return h > 0 ? Number(h.toFixed(2)) : null;
  })();

  const handleRowClick = () => {
    if (interactive) setShowPopover(s => !s);
  };

  return (
    <div data-tour={slotType === 'scribe' ? 'slot-scribe' : slotType === 'middle' ? 'slot-middle' : undefined}>
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
          <div className="slot-label">{SLOT_DISPLAY_LABELS[slotType] ?? slotType}</div>
          {!isOpener && !isClosing && !isOpeningFrontDesk && !isClosingFrontDesk && !isFrontDesk && slotTime && (
            <div className="slot-time">{slotTime}</div>
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
              title="Not cleared for this role"
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
            triggerRef={triggerRef}
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
            className={`variable-time-row${isAdmin && clinicOpen ? ' editable' : ''}${isTimelessViolation ? ' slot-row--timeless' : ''}`}
            onClick={isAdmin && clinicOpen ? (e) => { e.stopPropagation(); setEditingTime(true); } : undefined}
          >
            <span className="slot-time-label">{variableTimeDisplay ?? (isAdmin && clinicOpen ? 'Set time…' : '—')}</span>
            {variableTimeDisplay && <HoursPill slotHrs={slotHrs} />}
            {isAdmin && clinicOpen && <Pencil size={9} style={{ opacity: 0.5 }} />}
          </div>
        )
      )}

      {/* Scribe time row */}
      {showScribeTimeRow && (
        editingTime ? (
          <ScribeTimeEditor
            slotVal={slotVal}
            clinicId={clinic.id}
            onClose={() => setEditingTime(false)}
          />
        ) : (
          <div
            className={`variable-time-row${isAdmin && clinicOpen ? ' editable' : ''}`}
            onClick={isAdmin && clinicOpen ? (e) => { e.stopPropagation(); setEditingTime(true); } : undefined}
          >
            <span className="slot-time-label">{scribeTimeDisplay ?? (isAdmin && clinicOpen ? '1st Patient – Close' : '—')}</span>
            <HoursPill slotHrs={slotHrs} />
            {isAdmin && clinicOpen && <Pencil size={9} style={{ opacity: 0.5 }} />}
          </div>
        )
      )}

      {/* Opener / Opening Front Desk time row */}
      {(isOpener || isOpeningFrontDesk) && clinicOpen && (
        editingTime && interactive ? (
          <OpenerTimeEditor
            slotVal={slotVal}
            clinicId={clinic.id}
            slotType={slotType}
            defaultEndTime={isOpeningFrontDesk ? '15:30' : '17:00'}
            onClose={() => setEditingTime(false)}
          />
        ) : (
          <div
            className={`variable-time-row${interactive ? ' editable' : ''}`}
            onClick={interactive ? (e) => { e.stopPropagation(); setEditingTime(true); } : undefined}
          >
            <span className="slot-time-label">{openerDisplay}</span>
            <HoursPill slotHrs={slotHrs} />
            {interactive && <Pencil size={9} style={{ opacity: 0.5 }} />}
          </div>
        )
      )}

      {/* Closing / Closing Front Desk time row */}
      {(isClosing || isClosingFrontDesk) && clinicOpen && (
        editingTime && interactive ? (
          <ClosingTimeEditor
            slotVal={slotVal}
            clinicId={clinic.id}
            slotType={slotType}
            defaultStartTime={isClosingFrontDesk ? '10:30' : '09:00'}
            onClose={() => setEditingTime(false)}
          />
        ) : (
          <div
            className={`variable-time-row${interactive ? ' editable' : ''}`}
            onClick={interactive ? (e) => { e.stopPropagation(); setEditingTime(true); } : undefined}
          >
            <span className="slot-time-label">{closingStartStr} – {closingEndStr != null ? closingEndStr : <em>~Close</em>}</span>
            <HoursPill slotHrs={slotHrs} />
            {interactive && <Pencil size={9} style={{ opacity: 0.5 }} />}
          </div>
        )
      )}

      {/* Front Desk time row */}
      {isFrontDesk && clinicOpen && (
        editingTime && interactive ? (
          <VariableTimeEditor
            slotType={slotType}
            slotVal={slotVal}
            clinicId={clinic.id}
            onClose={() => setEditingTime(false)}
          />
        ) : (
          <div
            className={`variable-time-row${interactive ? ' editable' : ''}`}
            onClick={interactive ? (e) => { e.stopPropagation(); setEditingTime(true); } : undefined}
          >
            <span className="slot-time-label">{frontDeskDisplay}</span>
            <HoursPill slotHrs={slotHrs} />
            {interactive && <Pencil size={9} style={{ opacity: 0.5 }} />}
          </div>
        )
      )}
    </div>
  );
}

const OBS_LABELS = {
  preop: 'Pre-Op/PACU',
  sterile: 'Sterile Processing',
  circulator: 'Circulator',
  scrub: 'Scrub Tech',
};

function ObsTimeEditor({ slotType, slotVal, clinicId, onClose }) {
  const { updateSlotTime } = useApp();
  const obj = (slotVal && typeof slotVal === 'object') ? slotVal : {};
  const [startVal, setStartVal] = useState(obj.start != null ? minutesToTimeInput(obj.start) : '');
  const [endVal, setEndVal] = useState(obj.end != null ? minutesToTimeInput(obj.end) : '');

  const handleSave = () => {
    const s = startVal ? timeInputToMinutes(startVal) : null;
    const e = endVal ? timeInputToMinutes(endVal) : null;
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
        <input
          type="time"
          className="vte-input"
          value={endVal}
          onChange={e => setEndVal(e.target.value)}
        />
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '2px 0 4px' }}>
        Leave blank to use provider-buffered hours
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

function ObsSlotRow({ clinic, slotType, onPersonClick, matchedPersonIds, hasSearch, conflictSet, clinicOpen }) {
  const { data, isAdmin, assignSlot } = useApp();
  const slotVal = clinic.slots[slotType];
  const personId = getSlotPersonId(slotVal);
  const person = personId ? data.people.find(p => p.id === personId) : null;
  const [showPopover, setShowPopover] = useState(false);
  const [editingTime, setEditingTime] = useState(false);

  const droppableId = `slot:${clinic.id}:${slotType}`;
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: droppableId });
  const triggerRef = useRef(null);
  const setRef = useCallback((el) => { setDropRef(el); triggerRef.current = el; }, [setDropRef]);

  const hasConflict = person && conflictSet && conflictSet.has(`${person.id}:${clinic.day}`);
  const isHighlighted = hasSearch && person && matchedPersonIds.includes(personId);
  const isDimmed = hasSearch && person && !matchedPersonIds.includes(personId);
  const interactive = isAdmin && clinicOpen;
  const label = OBS_LABELS[slotType] ?? slotType;
  const obsTimeDisplay = formatVariableSlotTime(slotVal);
  const slotHrs = (() => {
    if (!person || !isAdmin) return null;
    const h = calcSlotHours(clinic, slotType);
    return h > 0 ? Number(h.toFixed(2)) : null;
  })();

  return (
    <div>
      <div
        ref={setRef}
        className={['slot-row', isOver && interactive ? 'drop-target' : ''].filter(Boolean).join(' ')}
        onClick={interactive ? () => setShowPopover(s => !s) : undefined}
        style={{ cursor: interactive ? 'pointer' : 'default' }}
      >
        <div className="slot-label-col" style={{ whiteSpace: 'normal', minWidth: 80 }}>
          <div className="slot-label">{label}</div>
        </div>
        <div className="slot-content">
          {person ? (
            <div
              className={['person-chip', isHighlighted ? 'highlighted' : '', isDimmed ? 'dimmed' : '', hasConflict ? 'conflict-ring' : ''].filter(Boolean).join(' ')}
              onClick={e => { e.stopPropagation(); onPersonClick(personId); }}
            >
              <div className="dot" style={{ background: person.color }} />
              {person.name}
              {hasConflict && <AlertTriangle size={11} style={{ color: 'var(--red)', flexShrink: 0 }} />}
            </div>
          ) : (
            <div className={['slot-empty', isOver && interactive ? 'droppable' : ''].filter(Boolean).join(' ')}>
              {label}
            </div>
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
            triggerRef={triggerRef}
          />
        )}
      </div>

      {/* OBS time row */}
      {clinicOpen && (
        editingTime ? (
          <ObsTimeEditor
            slotType={slotType}
            slotVal={slotVal}
            clinicId={clinic.id}
            onClose={() => setEditingTime(false)}
          />
        ) : (
          <div
            className={`variable-time-row${interactive ? ' editable' : ''}`}
            onClick={interactive ? (e) => { e.stopPropagation(); setEditingTime(true); } : undefined}
          >
            <span className="slot-time-label">{obsTimeDisplay ?? 'Open – Close'}</span>
            <HoursPill slotHrs={slotHrs} />
            {interactive && <Pencil size={9} style={{ opacity: 0.5 }} />}
          </div>
        )
      )}
    </div>
  );
}

export default function ClinicCard({ clinic, onPersonClick, onEditClinic, matchedPersonIds, hasSearch, isToday }) {
  const { data, isAdmin, updateClinic } = useApp();
  const showMiddleHint = isAdmin && clinic.open && (clinic.patientCount ?? 0) >= 68 && !getSlotPersonId(clinic.slots.middle);
  const conflictSet = isAdmin ? getConflictPersonDays(data.clinics, data.people) : null;

  if (!clinic.open && !isAdmin) return null;

  return (
    <div data-tour="clinic-card" data-clinic-id={clinic.id} className={`clinic-card${!clinic.open ? ' closed' : ''}${isToday ? ' col-today-cell' : ''}`}>
      <div className="clinic-card-header">
        <div>
          <div className="clinic-card-title">{clinic.provider}</div>
          <div className="clinic-card-sub">{clinic.location}</div>
        </div>
        <div className="clinic-card-header-right">
          <span className="clinic-time-pill">
            {minutesToTime(clinic.startTime)} – {minutesToTime(clinic.endTime)}
          </span>
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
          {clinic.location === 'OBS'
            ? OBS_SLOT_TYPES.map(slotType => (
                <ObsSlotRow
                  key={slotType}
                  clinic={clinic}
                  slotType={slotType}
                  onPersonClick={onPersonClick}
                  matchedPersonIds={matchedPersonIds}
                  hasSearch={hasSearch}
                  conflictSet={conflictSet}
                  clinicOpen={clinic.open}
                />
              ))
            : (() => {
                const isDrRMonFri = clinic.provider === 'Dr. R' &&
                  (clinic.day === 'Mon' || clinic.day === 'Fri');
                const fdSlots = isDrRMonFri
                  ? ['openingFrontDesk', 'closingFrontDesk']
                  : ['frontDesk'];
                const clinicSlotTypes = [
                  ...fdSlots,
                  'scribe', 'opener', 'closing', 'middle', 'training',
                ];
                return clinicSlotTypes.map(slotType => (
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
                ));
              })()
          }
        </div>
      )}
      {showMiddleHint && (
        <div className="hint-middle">
          <Users size={12} />
          High volume — consider adding a Middle tech
        </div>
      )}
    </div>
  );
}
