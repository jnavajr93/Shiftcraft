import { useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { Trash2 } from 'lucide-react';

export default function SlotPopover({ clinic, slotType, currentPersonId, onAssign, onRemove, onClose }) {
  const { data } = useApp();
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const keyHandler = (e) => { if (e.key === 'Escape') onClose(); };
    // Use setTimeout to avoid immediately closing on the opening click
    const t = setTimeout(() => {
      document.addEventListener('mousedown', handler);
      document.addEventListener('keydown', keyHandler);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [onClose]);

  // Sort: A first, then B, then C, then null grade
  const gradeOrder = { A: 0, B: 1, C: 2, null: 3 };
  const available = [...data.people].sort((a, b) => {
    return (gradeOrder[a.grade] ?? 3) - (gradeOrder[b.grade] ?? 3);
  });

  const currentPerson = currentPersonId ? data.people.find(p => p.id === currentPersonId) : null;

  return (
    <div ref={ref} className="popover" onClick={e => e.stopPropagation()}>
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
        </>
      )}
      <div className="popover-section-label">Staff</div>
      {available.map(person => {
        const isCurrent = person.id === currentPersonId;
        const hasRoleWarning = !person.roles.map(r => r.toLowerCase()).includes(slotType);
        const hasLockedWarning = person.lockedTo && person.lockedTo !== clinic.provider;
        return (
          <div
            key={person.id}
            className={`popover-item ${isCurrent ? 'current-person' : ''}`}
            onClick={() => onAssign(person.id)}
          >
            <div className="dot" style={{ background: person.color }} />
            <span style={{ flex: 1 }}>{person.name}</span>
            {person.grade && (
              <span className={`grade-badge ${person.grade}`}>{person.grade}</span>
            )}
            {(hasRoleWarning || hasLockedWarning) && (
              <span
                style={{ fontSize: 10, color: 'var(--amber)', marginLeft: 2 }}
                title={hasLockedWarning ? `Locked to ${person.lockedTo}` : 'Role mismatch'}
              >⚠</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
