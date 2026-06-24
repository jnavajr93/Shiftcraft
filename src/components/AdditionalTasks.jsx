import { useState, useCallback } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Plus, X } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { DAYS, generateId } from '../data/seed.js';
import SlotPopover from './SlotPopover.jsx';

function TaskSlotRow({ task, onPersonClick, onRemove }) {
  const { data, isAdmin, assignTask } = useApp();
  const [showPopover, setShowPopover] = useState(false);

  const droppableId = `task:${task.id}`;
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });

  const person = task.assignedPersonId
    ? data.people.find(p => p.id === task.assignedPersonId)
    : null;

  const handleRowClick = () => {
    if (isAdmin) setShowPopover(s => !s);
  };

  return (
    <div
      ref={setNodeRef}
      className={`task-slot${isOver && isAdmin ? ' drop-target' : ''}`}
      onClick={handleRowClick}
      style={{ cursor: isAdmin ? 'pointer' : 'default' }}
    >
      <div className="task-label">{task.label}</div>
      {task.locationTag && (
        <div className="task-location-tag">{task.locationTag}</div>
      )}
      <div className="task-content">
        {person ? (
          <div
            className="person-chip"
            onClick={e => { e.stopPropagation(); onPersonClick(person.id); }}
          >
            <div className="dot" style={{ background: person.color }} />
            {person.name}
          </div>
        ) : (
          <div className={`slot-empty${isOver && isAdmin ? ' droppable' : ''}`}>
            Assign…
          </div>
        )}
      </div>
      {onRemove && (
        <button
          className="task-remove-btn"
          onClick={e => { e.stopPropagation(); onRemove(); }}
          title="Remove task"
        >
          <X size={12} />
        </button>
      )}
      {showPopover && isAdmin && (
        <TaskPopover
          task={task}
          currentPersonId={task.assignedPersonId}
          onAssign={(pid) => { assignTask(task.id, pid); setShowPopover(false); }}
          onRemove={() => { assignTask(task.id, null); setShowPopover(false); }}
          onClose={() => setShowPopover(false)}
        />
      )}
    </div>
  );
}

function TaskPopover({ task, currentPersonId, onAssign, onRemove, onClose }) {
  const { data } = useApp();
  const ref = useCallback((el) => {
    if (!el) return;
    const handler = (e) => { if (!el.contains(e.target)) onClose(); };
    const keyH = (e) => { if (e.key === 'Escape') onClose(); };
    const t = setTimeout(() => {
      document.addEventListener('mousedown', handler);
      document.addEventListener('keydown', keyH);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyH);
    };
  }, [onClose]);

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
              style={{ minHeight: 'unset', padding: '2px 4px' }}
              onClick={e => { e.stopPropagation(); onRemove(); }}
            >
              <X size={13} />
            </button>
          </div>
          <div className="popover-divider" />
        </>
      )}
      <div className="popover-section-label">Staff</div>
      {data.people.map(p => (
        <div
          key={p.id}
          className={`popover-item${p.id === currentPersonId ? ' current-person' : ''}`}
          onClick={() => onAssign(p.id)}
        >
          <div className="dot" style={{ background: p.color }} />
          <span>{p.name}</span>
        </div>
      ))}
    </div>
  );
}

function AddTaskForm({ day, onAdd, onCancel }) {
  const { data } = useApp();
  const [label, setLabel] = useState('');
  const [customLabel, setCustomLabel] = useState('');
  const [locationTag, setLocationTag] = useState('');

  const effectiveLabel = label === '__custom' ? customLabel : label;

  const handleAdd = () => {
    if (!effectiveLabel.trim()) return;
    onAdd({
      id: generateId(),
      label: effectiveLabel.trim(),
      day,
      locationTag: locationTag || null,
      assignedPersonId: null,
      isLocationSpecific: !!locationTag,
    });
  };

  return (
    <div className="accommodation-form" style={{ margin: '6px 12px 8px' }}>
      <div className="form-group">
        <label className="form-label">Task</label>
        <select
          className="form-input"
          style={{ fontSize: 13 }}
          value={label}
          onChange={e => setLabel(e.target.value)}
        >
          <option value="">Select or type new…</option>
          {(data.taskTypes ?? []).map(t => <option key={t} value={t}>{t}</option>)}
          <option value="__custom">+ New task type…</option>
        </select>
        {label === '__custom' && (
          <input
            className="form-input"
            style={{ marginTop: 4, fontSize: 13 }}
            placeholder="Task name…"
            value={customLabel}
            onChange={e => setCustomLabel(e.target.value)}
          />
        )}
      </div>
      <div className="form-group">
        <label className="form-label">Location tag (optional)</label>
        <select
          className="form-input"
          style={{ fontSize: 13 }}
          value={locationTag}
          onChange={e => setLocationTag(e.target.value)}
        >
          <option value="">None</option>
          {data.locations.map(l => <option key={l}>{l}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          className="btn btn-primary"
          style={{ minHeight: 32, fontSize: 12 }}
          onClick={handleAdd}
          disabled={!effectiveLabel.trim()}
        >Add</button>
        <button
          className="btn"
          style={{ minHeight: 32, fontSize: 12 }}
          onClick={onCancel}
        >Cancel</button>
      </div>
    </div>
  );
}

export default function AdditionalTasks({ onPersonClick }) {
  const { data, isAdmin, removeTask } = useApp();
  const [addingDay, setAddingDay] = useState(null);
  const { addTask } = useApp();

  const handleAdd = (task) => {
    addTask(task);
    setAddingDay(null);
  };

  return (
    <div style={{ padding: '0 16px 16px', flexShrink: 0 }}>
      <div style={{ minWidth: 1000 }}>
        <div className="tasks-section-header" style={{ marginBottom: 8 }}>Additional Tasks</div>
        <div className="tasks-grid">
          {DAYS.map(day => {
            const dayTasks = (data.additionalTasks ?? []).filter(t => t.day === day);
            return (
              <div key={day} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {dayTasks.length > 0 && (
                  <div className="task-card">
                    {dayTasks.map(task => (
                      <TaskSlotRow
                        key={task.id}
                        task={task}
                        onPersonClick={onPersonClick}
                        onRemove={isAdmin ? () => removeTask(task.id) : undefined}
                      />
                    ))}
                  </div>
                )}
                {isAdmin && (
                  addingDay === day ? (
                    <AddTaskForm
                      day={day}
                      onAdd={handleAdd}
                      onCancel={() => setAddingDay(null)}
                    />
                  ) : (
                    <button
                      className="btn"
                      style={{ minHeight: 32, fontSize: 12, width: '100%' }}
                      onClick={() => setAddingDay(day)}
                    >
                      <Plus size={13} /> Add task
                    </button>
                  )
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
