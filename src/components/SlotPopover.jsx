import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../context/AppContext.jsx';
import { Trash2, Zap } from 'lucide-react';
import { DAYS, getSlotPersonId, OBS_SLOT_TYPES, getAssignmentsForPerson } from '../data/seed.js';

// ─── Portal positioning hook ──────────────────────────────────────────────────
// Renders the popover at a fixed viewport position computed from the trigger element.
// Flips upward when there isn't enough space below; clamps horizontally to viewport edges.
// Closes the popover on any scroll event or window resize.
function usePortalPopover(triggerRef, onClose) {
  const contentRef = useRef(null);
  const [popoverStyle, setPopoverStyle] = useState({
    position: 'fixed', top: -9999, left: -9999, visibility: 'hidden', zIndex: 1000,
  });

  useLayoutEffect(() => {
    const trigger = triggerRef?.current;
    const content = contentRef.current;
    if (!trigger || !content) return;

    const tr = trigger.getBoundingClientRect();
    const pr = content.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const GAP = 4;
    const EDGE = 8;

    // Prefer opening below; flip above if not enough space below
    const spaceBelow = vh - tr.bottom - GAP;
    const top = pr.height <= spaceBelow
      ? tr.bottom + GAP
      : Math.max(EDGE, tr.top - GAP - pr.height);

    // Align left edge with trigger, clamp to viewport
    const left = Math.min(Math.max(EDGE, tr.left), vw - pr.width - EDGE);

    setPopoverStyle({
      position: 'fixed',
      top: Math.round(top),
      left: Math.round(left),
      visibility: 'visible',
      zIndex: 1000,
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('scroll', close, { capture: true, passive: true });
    window.addEventListener('resize', close, { passive: true });
    return () => {
      window.removeEventListener('scroll', close, { capture: true });
      window.removeEventListener('resize', close);
    };
  }, [onClose]);

  return { popoverStyle, contentRef };
}

const OBS_ROLE_FOR_SLOT = {
  preop: 'Pre-Op/PACU',
  sterile: 'Sterile Processing',
  circulator: 'Circulator',
  scrub: 'Scrub Tech',
};

const FD_SLOT_TYPES = new Set(['openingFrontDesk', 'closingFrontDesk', 'frontDesk']);

// Returns the provider name string from a lockedTo entry (string or {provider,slot} object)
function lockedToProvider(entry) {
  return typeof entry === 'string' ? entry : entry.provider;
}

/** Returns reason why person can't fill this slot, or null if they can */
function ineligibleReason(person, clinic, slotType, clinics, additionalTasks, allPeople) {
  // Day off
  if ((person.daysOff ?? []).includes(clinic.day)) return 'Off this day';

  // Use the single shared function for all "is this person assigned today" checks.
  // It reads from getBoardClinics() internally — shadow/duplicate clinic records
  // that are invisible on the board cannot produce phantom conflicts here.
  const nameKey = person.name.trim().toLowerCase();
  const dayAssignments = getAssignmentsForPerson(nameKey, clinic.day, allPeople ?? [], clinics);

  // OBS precedence: if assigning to a non-OBS slot and person already has an OBS
  // assignment that day (under any same-name record), block with a specific error.
  const isObsSlot = clinic.location?.toLowerCase() === 'obs';
  if (!isObsSlot && dayAssignments.some(a => a.isObs)) {
    const obs = dayAssignments.filter(a => a.isObs);
    console.warn(`[Shiftcraft eligibility] ${person.name} blocked (OBS precedence) on ${clinic.day}:`,
      obs.map(a => ({ clinicId: a.clinicId, location: a.clinic?.location, provider: a.clinic?.provider, slotType: a.slotType, personId: a.personId }))
    );
    return 'Assigned to OBS this day';
  }

  // Already assigned to any board clinic slot today, except the exact slot this popover is for
  const blocking = dayAssignments.filter(a => !(a.clinicId === clinic.id && a.slotType === slotType));
  const clinicAssigned = blocking.length > 0;
  if (clinicAssigned) {
    console.warn(`[Shiftcraft eligibility] ${person.name} blocked (already assigned) on ${clinic.day}:`,
      blocking.map(a => ({ clinicId: a.clinicId, location: a.clinic?.location, provider: a.clinic?.provider, slotType: a.slotType, personId: a.personId, isObs: a.isObs }))
    );
    return 'Already assigned today';
  }

  // Already assigned to an additional task on this day
  const samePersonIds = new Set(
    (allPeople ?? []).filter(q => q.name.trim().toLowerCase() === nameKey).map(q => q.id)
  );
  const taskAssigned = (additionalTasks ?? []).some(t =>
    t.day === clinic.day && samePersonIds.has(t.assignedPersonId)
  );
  if (taskAssigned) return 'Already assigned today';

  // Front desk slots have no role requirement — admin staff are eligible by staffType alone
  if (FD_SLOT_TYPES.has(slotType)) return null;

  // MUST_PAIR override: if person has a slot-specific lock to this clinic+slot,
  // they're eligible regardless of their roles array (solver places them via MUST_PAIR).
  const isMustPairForThisSlot = (person.lockedTo ?? []).some(e =>
    typeof e === 'object' && e.provider === clinic.provider && e.slot === slotType
  );
  if (isMustPairForThisSlot) return null;

  // Role check
  if (OBS_SLOT_TYPES.includes(slotType)) {
    const required = OBS_ROLE_FOR_SLOT[slotType];
    if (required && !person.roles.includes(required)) return 'Role not in their list';
  } else {
    if (!person.roles.map(r => r.toLowerCase()).includes(slotType)) return 'Role not in their list';
  }

  // Location check
  const cleared = person.clearedLocations ?? [];
  if (cleared.length > 0 && !cleared.includes(clinic.location)) return 'Not cleared for location';

  // Availability window check
  const win = (person.availabilityWindows ?? {})[clinic.day];
  if (win) {
    if (win.startNotBefore != null && clinic.startTime < win.startNotBefore) return 'Starts too early for their window';
    if (win.endNoLater != null && clinic.endTime > win.endNoLater) return 'Ends too late for their window';
  }

  return null;
}

export default function SlotPopover({ clinic, slotType, currentPersonId, onAssign, onRemove, onClose, triggerRef }) {
  const { data } = useApp();
  const { popoverStyle, contentRef } = usePortalPopover(triggerRef, onClose);

  useEffect(() => {
    const handler = (e) => { if (contentRef.current && !contentRef.current.contains(e.target)) onClose(); };
    const keyHandler = (e) => { if (e.key === 'Escape') onClose(); };
    const t = setTimeout(() => {
      document.addEventListener('mousedown', handler);
      document.addEventListener('keydown', keyHandler);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  const gradeOrder = { A: 0, B: 1, C: 2 };
  const currentPerson = currentPersonId ? data.people.find(p => p.id === currentPersonId) : null;

  // Front desk slots → admin staff only. Clinical/OBS slots → tech staff only.
  const isFDSlot = FD_SLOT_TYPES.has(slotType);
  const peopleForSlot = data.people.filter(p =>
    isFDSlot ? p.staffType === 'admin' : p.staffType !== 'admin'
  );

  // Classify each person
  const classified = peopleForSlot.map(person => {
    const reason = ineligibleReason(person, clinic, slotType, data.clinics, data.additionalTasks, data.people);
    return { person, eligible: !reason, reason };
  });

  // Sort eligible by grade
  const eligible = classified
    .filter(c => c.eligible)
    .sort((a, b) => (gradeOrder[a.person.grade] ?? 3) - (gradeOrder[b.person.grade] ?? 3));

  const ineligible = classified.filter(c => !c.eligible);

  // Top 3 eligible = suggestions (if no current assignment)
  const suggestions = !currentPersonId ? eligible.slice(0, 3) : [];
  const rest = !currentPersonId ? eligible.slice(3) : eligible;

  return createPortal(
    <div ref={contentRef} className="popover" style={popoverStyle} onClick={e => e.stopPropagation()}>
      {currentPerson && (
        <>
          <div className="popover-section-label">Assigned</div>
          <div className="popover-item current-person">
            <div className="dot" style={{ background: currentPerson.color }} />
            <span style={{ flex: 1 }}>{currentPerson.name}</span>
            <button
              className="btn btn-icon popover-remove"
              style={{ minHeight: 'unset', padding: '2px 4px', gap: 0 }}
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              title="Remove"
            >
              <Trash2 size={13} />
            </button>
          </div>
          <div className="popover-divider" />
          <div className="popover-section-label">Staff</div>
          {eligible.map(({ person }) => (
            <PersonRow key={person.id} person={person} isCurrent={person.id === currentPersonId} clinic={clinic} slotType={slotType} onAssign={onAssign} />
          ))}
          {ineligible.length > 0 && (
            <>
              <div className="popover-divider" />
              <div className="popover-section-label">Ineligible</div>
              {ineligible.map(({ person, reason }) => (
                <PersonRow key={person.id} person={person} isCurrent={false} dimmed reason={reason} clinic={clinic} slotType={slotType} onAssign={onAssign} />
              ))}
            </>
          )}
        </>
      )}

      {!currentPerson && (
        <>
          {suggestions.length > 0 && (
            <>
              <div className="popover-section-label" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Zap size={10} /> Suggested
              </div>
              {suggestions.map(({ person }) => (
                <PersonRow key={person.id} person={person} isCurrent={false} suggested clinic={clinic} slotType={slotType} onAssign={onAssign} />
              ))}
              {(rest.length > 0 || ineligible.length > 0) && <div className="popover-divider" />}
            </>
          )}
          {rest.length > 0 && (
            <>
              <div className="popover-section-label">All Staff</div>
              {rest.map(({ person }) => (
                <PersonRow key={person.id} person={person} isCurrent={false} clinic={clinic} slotType={slotType} onAssign={onAssign} />
              ))}
            </>
          )}
          {ineligible.length > 0 && (
            <>
              <div className="popover-divider" />
              <div className="popover-section-label">Ineligible</div>
              {ineligible.map(({ person, reason }) => (
                <PersonRow key={person.id} person={person} isCurrent={false} dimmed reason={reason} clinic={clinic} slotType={slotType} onAssign={onAssign} />
              ))}
            </>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}

function PersonRow({ person, isCurrent, dimmed, suggested, reason, clinic, slotType, onAssign }) {
  const hasLockedWarning = person.lockedTo?.length > 0 &&
    !person.lockedTo.some(e => lockedToProvider(e) === clinic.provider);

  return (
    <div
      className={`popover-item${isCurrent ? ' current-person' : ''}${suggested ? ' suggested-item' : ''}`}
      style={{ opacity: dimmed ? 0.5 : 1, cursor: dimmed ? 'default' : 'pointer' }}
      onClick={() => !dimmed && onAssign(person.id)}
      title={reason ?? undefined}
    >
      <div className="dot" style={{ background: person.color }} />
      <span style={{ flex: 1 }}>{person.name}</span>
      {person.grade && <span className={`grade-badge ${person.grade}`}>{person.grade}</span>}
      {hasLockedWarning && !dimmed && (
        <span style={{ fontSize: 10, color: 'var(--amber)', marginLeft: 2 }} title={`Locked to ${person.lockedTo.map(lockedToProvider).join(', ')}`}>⚠</span>
      )}
      {reason && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{reason}</span>}
    </div>
  );
}
