import { useDraggable } from '@dnd-kit/core';
import { useApp } from '../context/AppContext.jsx';
import { calcPersonWeeklyHours } from '../data/seed.js';

const SKILL_ABBR = {
  'Workup':             'WU',
  'Treatments':         'Tx',
  'FAs':                'FA',
  'Autoclave & Closing': 'AC/CL',
};

function PersonCard({ person, onPersonClick, clinics }) {
  const { data } = useApp();
  const hours = calcPersonWeeklyHours(person.id, clinics, data.additionalTasks);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: person.id,
  });

  const skills = person.skills ?? [];

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`person-sidebar-card${isDragging ? ' dragging' : ''}`}
      style={{ touchAction: 'none' }}
    >
      <div className="dot" style={{ background: person.color }} />
      <span className="person-sidebar-name" onClick={(e) => { e.stopPropagation(); onPersonClick(person.id); }}>
        {person.name}
      </span>
      {person.employmentType && (
        <span className="employment-badge">
          {person.employmentType === 'Full-time' ? 'FT' : person.employmentType === 'Part-time' ? 'PT' : person.employmentType}
        </span>
      )}
      {person.grade && <span className={`grade-badge ${person.grade}`}>{person.grade}</span>}
      <span className="person-sidebar-hours">{hours}h</span>
    </div>
  );
}

const GRADE_ORDER = { A: 0, B: 1, C: 2, T: 3 };

export default function Sidebar({ onPersonClick }) {
  const { data } = useApp();

  // Sort by grade A → B → C → ungraded; stable within each group (preserves Setup order)
  const sorted = [...data.people].sort(
    (a, b) => (GRADE_ORDER[a.grade] ?? 3) - (GRADE_ORDER[b.grade] ?? 3)
  );

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
            clinics={data.clinics}
          />
        ))}
      </div>
    </div>
  );
}
