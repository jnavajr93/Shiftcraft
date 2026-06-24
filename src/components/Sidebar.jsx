import { useDraggable } from '@dnd-kit/core';
import { useApp } from '../context/AppContext.jsx';
import { calcPersonWeeklyHours } from '../data/seed.js';

const SKILL_ABBR = {
  'Workup':     'WU',
  'Treatments': 'Tx',
  'FAs':        'FA',
  'Autoclave':  'AC',
  'Closing':    'CL',
};

function PersonCard({ person, onPersonClick, clinics }) {
  const hours = calcPersonWeeklyHours(person.id, clinics);
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
      {person.grade && <span className={`grade-badge ${person.grade}`}>{person.grade}</span>}
      {skills.length > 0 && (
        <div className="sidebar-skills">
          {skills.map(s => (
            <span key={s} className="skill-badge" title={s}>
              {SKILL_ABBR[s] ?? s.slice(0, 2)}
            </span>
          ))}
        </div>
      )}
      <span className="person-sidebar-hours">{hours}h</span>
    </div>
  );
}

export default function Sidebar({ onPersonClick }) {
  const { data } = useApp();

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span className="sidebar-title">Staff</span>
        <span className="count-badge">{data.people.length}</span>
      </div>
      <div className="sidebar-body">
        {data.people.map(person => (
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
