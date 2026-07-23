import { useState, useCallback, useRef } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Pencil, AlertTriangle, Users, Power } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { getSlotLabel, getSlotTimeLabel, getSlotPersonId, getSlotTimeObj, formatVariableSlotTime, formatOpenerTimeDisplay, formatOpeningFDTimeDisplay, formatClosingFDOverlayDisplay, formatScribeTimeDisplay, formatClosingOverlayDisplay, minutesToTime, SLOT_TYPES, OBS_SLOT_TYPES, SLOT_DISPLAY_LABELS, calcSlotHours, calcPersonWeeklyHours, slotEffectiveRange } from '../data/seed.js';
import { TimeRangePicker } from './TimeRangePicker.jsx';

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

function VariableTimeEditor({ slotType, slotVal, clinic, clinicId, onClose }) {
  const { updateSlotTime } = useApp();
  const timeObj = getSlotTimeObj(slotVal);
  const defaultEndIsClose = timeObj.end == null || timeObj.end === 'close';
  return (
    <div className="variable-time-editor" onClick={e => e.stopPropagation()}>
      <TimeRangePicker
        defaultStart={timeObj.start ?? clinic?.startTime ?? null}
        defaultEnd={!defaultEndIsClose ? timeObj.end : null}
        defaultEndIsClose={defaultEndIsClose}
        openTime={clinic?.startTime ?? null}
        onSave={(s, e) => { updateSlotTime(clinicId, slotType, s, e); onClose(); }}
        onCancel={onClose}
      />
    </div>
  );
}

function ScribeTimeEditor({ slotVal, clinicId, clinic, onClose }) {
  const { updateSlotTime } = useApp();
  const timeObj = getSlotTimeObj(slotVal);
  // null start = 1st Patient default; null/close end = Close default
  const defaultEndIsClose = timeObj.end == null || timeObj.end === 'close';
  return (
    <div className="variable-time-editor" onClick={e => e.stopPropagation()}>
      <TimeRangePicker
        defaultStart={timeObj.start ?? null}
        defaultEnd={!defaultEndIsClose ? timeObj.end : null}
        defaultEndIsClose={defaultEndIsClose}
        openTime={clinic?.startTime ?? null}
        onSave={(s, e) => {
          // scribe uses null for close, not 'close' string
          updateSlotTime(clinicId, 'scribe', s, e === 'close' ? null : e);
          onClose();
        }}
        onCancel={onClose}
      />
      <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '2px 0 2px' }}>
        Leave Start blank for 1st Patient; Close = end of clinic
      </div>
    </div>
  );
}

function OpenerTimeEditor({ slotVal, clinicId, clinic, slotType = 'opener', onClose }) {
  const { updateSlotTime } = useApp();
  const obj = (slotVal && typeof slotVal === 'object') ? slotVal : {};
  const openTime = clinic ? (clinic.startTime - 15) : null;
  // Migration compat: treat stored literal openTime as the Open semantic so the editor
  // opens with the Open badge active on existing slots that pre-date this change.
  const defaultStartIsOpen = obj.start == null || (openTime != null && obj.start === openTime);
  return (
    <div className="variable-time-editor" onClick={e => e.stopPropagation()}>
      <TimeRangePicker
        defaultStart={defaultStartIsOpen ? null : obj.start}
        defaultEnd={obj.end != null && obj.end !== 'close' ? obj.end : null}
        defaultEndIsClose={obj.end === 'close'}
        defaultStartIsOpen={defaultStartIsOpen}
        openSemantic={true}
        openTime={openTime}
        onSave={(s, e) => {
          // Also catch manual-typed exact openTime → store null (Open semantic)
          const finalStart = (s != null && openTime != null && s === openTime) ? null : s;
          updateSlotTime(clinicId, slotType, finalStart, e === 'close' ? null : e);
          onClose();
        }}
        onCancel={onClose}
      />
    </div>
  );
}

function ClosingTimeEditor({ slotVal, clinicId, clinic, slotType = 'closing', onClose }) {
  const { updateSlotTime } = useApp();
  const obj = (slotVal && typeof slotVal === 'object') ? slotVal : {};
  const defaultStartTime = slotType === 'closingFrontDesk' ? 630 : 540; // 10:30 or 9:00
  return (
    <div className="variable-time-editor" onClick={e => e.stopPropagation()}>
      <TimeRangePicker
        defaultStart={obj.start ?? defaultStartTime}
        defaultEnd={null}
        defaultEndIsClose={obj.end == null}
        onSave={(s, e) => {
          // closing uses null for close end
          updateSlotTime(clinicId, slotType, s, e === 'close' ? null : e);
          onClose();
        }}
        onCancel={onClose}
      />
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
    : isOpeningFrontDesk ? formatOpeningFDTimeDisplay(slotVal, clinic) : null;
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
    <div className="slot-block" data-tour={slotType === 'scribe' ? 'slot-scribe' : slotType === 'middle' ? 'slot-middle' : undefined}>
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
            clinic={clinic}
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
            clinic={clinic}
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
            clinic={clinic}
            slotType={slotType}
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
            clinic={clinic}
            slotType={slotType}
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
            clinic={clinic}
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
  preop2: 'Pre-Op/PACU 2',
  sterile: 'Sterile Processing',
  circulator: 'Circulator',
  scrub: 'Scrub Tech',
};

function ObsTimeEditor({ slotType, slotVal, clinicId, clinic, onClose }) {
  const { updateSlotTime } = useApp();
  const obj = (slotVal && typeof slotVal === 'object') ? slotVal : {};
  return (
    <div className="variable-time-editor" onClick={e => e.stopPropagation()}>
      <TimeRangePicker
        defaultStart={obj.start ?? null}
        defaultEnd={obj.end ?? null}
        defaultEndIsClose={false}
        openTime={clinic?.startTime ?? null}
        onSave={(s, e) => {
          updateSlotTime(clinicId, slotType, s, e === 'close' ? null : e);
          onClose();
        }}
        onCancel={onClose}
      />
      <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '2px 0 2px' }}>
        Leave blank to use provider-buffered hours
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
  // Show provider-buffered range (e.g. 7:00 AM – 5:00 PM for Dr. R) when no custom time is set.
  // Falls back to "Open – Close" for blank-provider OBS clinics (no buffer applied).
  const defaultObsTimeDisplay = (() => {
    const range = slotEffectiveRange(slotType, clinic);
    if (range.start === (clinic.startTime ?? 0) && range.end === (clinic.endTime ?? 0)) {
      return 'Open – Close';
    }
    return `${minutesToTime(range.start)} – ${minutesToTime(range.end)}`;
  })();
  const slotHrs = (() => {
    if (!person || !isAdmin) return null;
    const h = calcSlotHours(clinic, slotType);
    return h > 0 ? Number(h.toFixed(2)) : null;
  })();

  return (
    <div className="slot-block">
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
            clinic={clinic}
            onClose={() => setEditingTime(false)}
          />
        ) : (
          <div
            className={`variable-time-row${interactive ? ' editable' : ''}`}
            onClick={interactive ? (e) => { e.stopPropagation(); setEditingTime(true); } : undefined}
          >
            <span className="slot-time-label">{obsTimeDisplay ?? defaultObsTimeDisplay}</span>
            <HoursPill slotHrs={slotHrs} />
            {interactive && <Pencil size={9} style={{ opacity: 0.5 }} />}
          </div>
        )
      )}
    </div>
  );
}

export default function ClinicCard({ clinic, onPersonClick, onEditClinic, matchedPersonIds, hasSearch, isToday, isDoctorOff, holidayName }) {
  const { data, isAdmin, updateClinic } = useApp();
  const showMiddleHint = isAdmin && clinic.open && (clinic.patientCount ?? 0) >= 68 && !getSlotPersonId(clinic.slots.middle);
  const conflictSet = isAdmin ? getConflictPersonDays(data.clinics, data.people) : null;

  if (isDoctorOff) {
    return (
      <div data-clinic-id={clinic.id} className={`clinic-card clinic-card--doctor-off${isToday ? ' col-today-cell' : ''}`}>
        <div className="clinic-card-header">
          <div>
            <div className="clinic-card-title">{clinic.provider}</div>
            <div className="clinic-card-sub">{clinic.location}</div>
          </div>
        </div>
        <div className="clinic-doctor-off-body">No clinic — {clinic.provider} off</div>
      </div>
    );
  }

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
      {holidayName && clinic.open && (
        <div className="clinic-holiday-tag">
          {holidayName} – open
        </div>
      )}
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
            ? (isAdmin ? OBS_SLOT_TYPES : OBS_SLOT_TYPES.filter(st => !!getSlotPersonId(clinic.slots[st]))).map(slotType => (
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
                  'scribe', 'opener', 'middle', 'training', 'closing',
                ];
                // Staff view: hide slots with no one assigned (keeps cards compact)
                const visibleSlotTypes = isAdmin
                  ? clinicSlotTypes
                  : clinicSlotTypes.filter(st => !!getSlotPersonId(clinic.slots[st]));
                return visibleSlotTypes.map(slotType => (
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
