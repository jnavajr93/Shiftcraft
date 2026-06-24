import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { DAYS, calcPersonWeeklyHours, getSlotLabel, minutesToTime } from '../data/seed.js';
import ArcChart from './ArcChart.jsx';

function useIsMobile() {
  return window.matchMedia('(max-width: 640px)').matches;
}

function WeekRows({ person, clinics }) {
  return (
    <div>
      {DAYS.map(day => {
        const assignments = [];
        clinics
          .filter(c => c.day === day && c.open)
          .forEach(c => {
            Object.entries(c.slots).forEach(([slotType, pid]) => {
              if (pid === person.id) {
                assignments.push({
                  clinic: c,
                  slotType,
                  label: getSlotLabel(slotType, c.location),
                  time: slotType === 'scribe'
                    ? `${minutesToTime(c.startTime)} – ${minutesToTime(c.endTime)}`
                    : slotType === 'opener'  ? `${minutesToTime(c.startTime)} – 5:00 PM`
                    : slotType === 'closing' ? `9:00 AM – ${minutesToTime(c.endTime)}`
                    : slotType === 'middle'  ? '9:00 AM – 6:00 PM'
                    : '8:00 AM – 5:00 PM',
                });
              }
            });
          });

        return (
          <div key={day} className="day-schedule-row">
            <div className="day-schedule-label">{day}</div>
            {assignments.length > 0 ? (
              <div className="day-schedule-detail">
                {assignments.map((a, i) => (
                  <div key={i}>{a.label} · {a.time}</div>
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
  const { data, isAdmin } = useApp();
  const hours = calcPersonWeeklyHours(person.id, data.clinics);

  return (
    <>
      <div className="overlay-header">
        <div className="dot-lg" style={{ background: person.color }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 500 }}>{person.name}</div>
          {person.grade && (
            <span className={`grade-badge ${person.grade}`} style={{ marginTop: 4, display: 'inline-block' }}>
              {person.grade}
            </span>
          )}
        </div>
        <button className="overlay-close" onClick={onClose}><X size={16} /></button>
      </div>
      <div className="overlay-body">
        <WeekRows person={person} clinics={data.clinics} />
        {isAdmin && (
          <ArcChart
            hours={hours}
            target={person.targetHours ?? 40}
            color={person.color}
          />
        )}
      </div>
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
