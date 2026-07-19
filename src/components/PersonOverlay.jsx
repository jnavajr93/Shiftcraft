import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useApp, mondayOfWeek } from '../context/AppContext.jsx';
import { DAYS, calcPersonWeeklyHours, getBoardClinics, getSlotLabel, getSlotPersonId, getRenderedSlotEntries, formatVariableSlotTime, formatOpenerTimeDisplay, formatOpeningFDTimeDisplay, formatClosingOverlayDisplay, formatClosingFDOverlayDisplay, formatScribeTimeDisplay, formatTaskTime, OBS_SLOT_TYPES, slotEffectiveRange } from '../data/seed.js';
import ArcChart from './ArcChart.jsx';

function useIsMobile() {
  return window.matchMedia('(max-width: 640px)').matches;
}

export function WeekRows({ personIds, clinics, additionalTasks, monday }) {
  const pidSet = new Set(personIds);
  return (
    <div>
      {DAYS.map((day, dayIdx) => {
        // Date for this day: Monday + dayIdx (safe across month boundaries)
        let dateLabel = '';
        if (monday) {
          const d = new Date(monday);
          d.setUTCDate(monday.getUTCDate() + dayIdx);
          dateLabel = ` ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
        }
        const assignments = [];
        clinics
          .filter(c => c.day === day && c.open)
          .forEach(c => {
            // getRenderedSlotEntries filters to board-visible slots only:
            // OBS clinics → 4 OBS types; regular → non-FD + active FD only.
            getRenderedSlotEntries(c).forEach(([slotType, slotVal]) => {
              const pid = getSlotPersonId(slotVal);
              if (pidSet.has(pid)) {
                let time;
                if (slotType === 'scribe') {
                  time = formatScribeTimeDisplay(slotVal) ?? '1st Patient – Close';
                } else if (slotType === 'opener') {
                  time = formatOpenerTimeDisplay(c, slotVal);
                } else if (slotType === 'openingFrontDesk') {
                  time = formatOpeningFDTimeDisplay(slotVal, c);
                } else if (slotType === 'closing') {
                  time = formatClosingOverlayDisplay(slotVal, c);
                } else if (slotType === 'closingFrontDesk') {
                  time = formatClosingFDOverlayDisplay(slotVal);
                } else if (slotType === 'frontDesk') {
                  time = formatVariableSlotTime(slotVal) ?? 'Open – Close';
                } else if (slotType === 'middle' || slotType === 'training') {
                  time = formatVariableSlotTime(slotVal) ?? 'Time not set';
                } else if (OBS_SLOT_TYPES.includes(slotType)) {
                  time = 'Open – Close';
                } else {
                  time = '';
                }
                const sortKey = slotEffectiveRange(slotType, c).start;
                assignments.push({
                  label: getSlotLabel(slotType, c.location),
                  time,
                  sortKey,
                });
              }
            });
          });

        // Add task assignments for this day
        (additionalTasks ?? [])
          .filter(t => t.day === day && pidSet.has(t.assignedPersonId))
          .forEach(t => {
            const label = `${t.label}${t.locationTag ? ' @ ' + t.locationTag : ''}`;
            const time = formatTaskTime(t) ?? null;
            assignments.push({ label, time, sortKey: t.start ?? Infinity });
          });

        assignments.sort((a, b) => a.sortKey - b.sortKey);

        return (
          <div key={day} className="day-schedule-row">
            <div className="day-schedule-label">{day}{dateLabel}</div>
            {assignments.length > 0 ? (
              <div className="day-schedule-detail">
                {assignments.map((a, i) => (
                  <div key={i}>{a.label}{a.time ? ` · ${a.time}` : ''}</div>
                ))}
              </div>
            ) : (
              <div className="day-schedule-off">Off</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function OverlayInner({ person, onClose }) {
  const { data, isAdmin, managerInitials, deletePerson, addLog, currentWeek } = useApp();
  const [confirming, setConfirming] = useState(false);
  const boardClinics = getBoardClinics(data.clinics);

  // If this person is linked to another record (same person, different staff type),
  // show both records' assignments combined and sum their hours.
  const linkedPerson = person.linkedPersonId
    ? (data.people.find(p => p.id === person.linkedPersonId) ?? null)
    : null;
  const personIds = linkedPerson ? [person.id, linkedPerson.id] : [person.id];
  const hours = personIds.reduce(
    (sum, id) => sum + calcPersonWeeklyHours(id, boardClinics, data.additionalTasks),
    0
  );

  const handleRemove = () => {
    addLog({ action: `${person.name} removed from roster by admin`, personName: person.name, day: '', detail: '', initials: managerInitials ?? undefined });
    deletePerson(person.id);
    onClose();
  };

  return (
    <>
      <div className="overlay-header">
        <div className="dot-lg" style={{ background: person.color }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 500 }}>{person.name}</div>
          {isAdmin && person.grade && (
            <span className={`grade-badge ${person.grade}`} style={{ marginTop: 4, display: 'inline-block' }}>
              {person.grade}
            </span>
          )}
        </div>
        <button className="overlay-close" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="overlay-body">
        <WeekRows personIds={personIds} clinics={boardClinics} additionalTasks={data.additionalTasks} monday={currentWeek ? mondayOfWeek(currentWeek) : null} />
        {isAdmin && (
          <ArcChart
            hours={hours}
            target={person.targetHours ?? 40}
            color={person.color}
          />
        )}
      </div>
      {isAdmin && (
        <div style={{ padding: '12px 24px 20px', borderTop: '0.5px solid var(--border)' }}>
          {confirming ? (
            <div style={{ background: 'var(--red-bg)', border: '0.5px solid var(--red)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
              <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 10, lineHeight: 1.5 }}>
                Remove <strong>{person.name}</strong> from the roster? This will unassign them from all current shifts. This cannot be undone.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-danger" style={{ minHeight: 36, fontSize: 13 }} onClick={handleRemove}>
                  Yes, remove
                </button>
                <button className="btn" style={{ minHeight: 36, fontSize: 13 }} onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              className="btn btn-danger"
              style={{ minHeight: 36, fontSize: 13 }}
              onClick={() => setConfirming(true)}
            >
              Remove from roster
            </button>
          )}
        </div>
      )}
    </>
  );
}

export default function PersonOverlay({ person, onClose }) {
  const isMobile = useIsMobile();

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  if (isMobile) {
    return (
      <div className="bottom-sheet-wrapper">
        <div className="bottom-sheet-backdrop" onClick={onClose} />
        <div className="bottom-sheet">
          <div className="sheet-handle" />
          <OverlayInner person={person} onClose={onClose} />
        </div>
      </div>
    );
  }

  return (
    <div className="overlay-backdrop" onClick={onClose}>
      <div className="overlay-modal" onClick={e => e.stopPropagation()}>
        <OverlayInner person={person} onClose={onClose} />
      </div>
    </div>
  );
}
