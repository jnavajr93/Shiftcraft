import { useState, useRef, useEffect, useCallback } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { useApp } from '../context/AppContext.jsx';
import { calcPersonWeeklyHours, getBoardClinics, SKILLS, minutesToTime, accommodationLabel } from '../data/seed.js';

const SKILL_ABBR = {
  'Workup':             'WU',
  'Treatments':         'Tx',
  'FAs':                'FA',
  'Autoclave & Closing': 'AC/CL',
};

// ─── Staff Hover Card ─────────────────────────────────────────────────────────

function StaffHoverCard({ person, hours, style, onMouseEnter, onMouseLeave }) {
  const skills = person.skills ?? [];
  const preferredLocations = person.preferredLocations ?? [];
  const daysOff = person.daysOff ?? [];
  const availWindows = person.availabilityWindows ?? {};
  const accommodations = person.accommodations ?? [];
  const lockedTo = person.lockedTo ?? [];

  const availEntries = Object.entries(availWindows).filter(
    ([, w]) => w && (w.endNoLater != null || w.startNotBefore != null)
  );

  const employLabel = person.employmentType === 'Full-time' ? 'FT'
    : person.employmentType === 'Part-time' ? 'PT'
    : (person.employmentType ?? '');

  return (
    <div
      className="staff-hovercard"
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Header */}
      <div className="staff-hovercard-header">
        <div className="dot" style={{ background: person.color, flexShrink: 0 }} />
        <span className="staff-hovercard-name">{person.name}</span>
        {person.grade && (
          <span className={`grade-badge ${person.grade}`} style={{ fontSize: 10 }}>{person.grade}</span>
        )}
        {employLabel && (
          <span className="employment-badge">{employLabel}</span>
        )}
      </div>

      {/* Skills */}
      <div className="staff-hovercard-section">
        <div className="staff-hovercard-label">Skills</div>
        <div className="staff-hovercard-skills">
          {SKILLS.map(skill => (
            <span
              key={skill}
              className={`hovercard-skill-pill${skills.includes(skill) ? ' trained' : ''}`}
            >
              {SKILL_ABBR[skill] ?? skill}
            </span>
          ))}
        </div>
      </div>

      {/* Locked to */}
      {lockedTo.length > 0 && (
        <div className="staff-hovercard-section">
          <div className="staff-hovercard-label">Locked to</div>
          <div className="staff-hovercard-value">{lockedTo.join(', ')}</div>
        </div>
      )}

      {/* Preferred locations */}
      {preferredLocations.length > 0 && (
        <div className="staff-hovercard-section">
          <div className="staff-hovercard-label">Preferred</div>
          <div className="staff-hovercard-value">{preferredLocations.join(', ')}</div>
        </div>
      )}

      {/* Days off */}
      {daysOff.length > 0 && (
        <div className="staff-hovercard-section">
          <div className="staff-hovercard-label">Days off</div>
          <div className="staff-hovercard-days">
            {daysOff.map(d => <span key={d} className="hovercard-day-pill">{d}</span>)}
          </div>
        </div>
      )}

      {/* Availability */}
      {availEntries.length > 0 && (
        <div className="staff-hovercard-section">
          <div className="staff-hovercard-label">Availability</div>
          {availEntries.map(([day, w]) => {
            const parts = [];
            if (w.startNotBefore != null) parts.push(`from ${minutesToTime(w.startNotBefore)}`);
            if (w.endNoLater != null) parts.push(`end by ${minutesToTime(w.endNoLater)}`);
            return (
              <div key={day} className="staff-hovercard-value">{day}: {parts.join(', ')}</div>
            );
          })}
        </div>
      )}

      {/* Accommodations */}
      {accommodations.length > 0 && (
        <div className="staff-hovercard-section">
          <div className="staff-hovercard-label">Notes</div>
          {accommodations.map((acc, i) => (
            <div key={i} className="staff-hovercard-value">{accommodationLabel(acc)}</div>
          ))}
        </div>
      )}

      {/* Hours */}
      <div className="staff-hovercard-section staff-hovercard-hours-row">
        <div className="staff-hovercard-label">This week</div>
        <div className="staff-hovercard-value">{hours}h / {person.targetHours ?? 40}h target</div>
      </div>
    </div>
  );
}

// ─── Person Card ──────────────────────────────────────────────────────────────

function PersonCard({ person, onPersonClick, clinics }) {
  const { data, isAdmin } = useApp();
  const hours = calcPersonWeeklyHours(person.id, clinics, data.additionalTasks);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: person.id });

  const [cardPos, setCardPos] = useState(null);
  const rowRef = useRef(null);
  const showTimer = useRef(null);
  const hideTimer = useRef(null);

  useEffect(() => () => {
    clearTimeout(showTimer.current);
    clearTimeout(hideTimer.current);
  }, []);

  // Merge dnd-kit ref with our position ref
  const setRef = useCallback((el) => {
    rowRef.current = el;
    setNodeRef(el);
  }, [setNodeRef]);

  const openCard = useCallback(() => {
    clearTimeout(hideTimer.current);
    clearTimeout(showTimer.current);
    showTimer.current = setTimeout(() => {
      const rect = rowRef.current?.getBoundingClientRect();
      if (!rect) return;
      const approxCardH = 320;
      const top = Math.max(8, Math.min(rect.top, window.innerHeight - approxCardH - 16));
      setCardPos({ top, left: rect.right + 8 });
    }, 400);
  }, []);

  const closeCard = useCallback(() => {
    clearTimeout(showTimer.current);
    hideTimer.current = setTimeout(() => setCardPos(null), 120);
  }, []);

  const cancelClose = useCallback(() => {
    clearTimeout(hideTimer.current);
  }, []);

  return (
    <>
      <div
        ref={setRef}
        {...listeners}
        {...attributes}
        className={`sidebar-staff-row${isDragging ? ' dragging' : ''}`}
        style={{ touchAction: 'none' }}
        onMouseEnter={isAdmin ? openCard : undefined}
        onMouseLeave={isAdmin ? closeCard : undefined}
      >
        <div className="sidebar-name">
          <div className="dot" style={{ background: person.color }} />
          <span onClick={(e) => { e.stopPropagation(); onPersonClick(person.id); }}>
            {person.name}
          </span>
        </div>
        <div className="sidebar-employment">
          {person.employmentType && (
            <span className="employment-badge">
              {person.employmentType === 'Full-time' ? 'FT' : person.employmentType === 'Part-time' ? 'PT' : person.employmentType}
            </span>
          )}
        </div>
        <div className="sidebar-grade">
          {person.grade
            ? <span className={`grade-badge ${person.grade}`}>{person.grade}</span>
            : <span className="sidebar-grade-empty">—</span>
          }
        </div>
        <span className="sidebar-hours">{hours}h</span>
      </div>

      {isAdmin && cardPos && (
        <StaffHoverCard
          person={person}
          hours={hours}
          style={{ top: cardPos.top, left: cardPos.left }}
          onMouseEnter={cancelClose}
          onMouseLeave={closeCard}
        />
      )}
    </>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

const GRADE_ORDER = { A: 0, B: 1, C: 2, T: 3 };

export default function Sidebar({ onPersonClick }) {
  const { data } = useApp();

  // Sort by grade A → B → C → ungraded; stable within each group (preserves Setup order)
  const sorted = [...data.people].sort(
    (a, b) => (GRADE_ORDER[a.grade] ?? 3) - (GRADE_ORDER[b.grade] ?? 3)
  );
  const boardClinics = getBoardClinics(data.clinics);

  return (
    <div data-tour="staff-sidebar" className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">Staff</span>
        <span className="count-badge">{data.people.length}</span>
      </div>
      <div className="sidebar-body">
        {sorted.map(person => (
          <PersonCard
            key={person.id}
            person={person}
            onPersonClick={onPersonClick}
            clinics={boardClinics}
          />
        ))}
      </div>
    </div>
  );
}
