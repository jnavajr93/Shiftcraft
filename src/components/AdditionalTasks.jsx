import { useState, useRef, useEffect } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Plus, X, Trash2, Pencil, Check } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { DAYS, generateId, minutesToTime, minutesToTimeInput, timeInputToMinutes } from '../data/seed.js';

function formatTaskTime(task) {
  const { start, end } = task;
  if (start == null && end == null) return null;
  const startStr = start != null ? minutesToTime(start) : '?';
  const endStr = end === 'close' ? 'Close' : end != null ? minutesToTime(end) : '?';
  return `${startStr} – ${endStr}`;
}

function TaskTimeEditor({ task, onSave, onClose }) {
  const [startVal, setStartVal] = useState(task.start != null ? minutesToTimeInput(task.start) : '');
  const [endVal, setEndVal] = useState(task.end != null && task.end !== 'close' ? minutesToTimeInput(task.end) : '');
  const [endIsClose, setEndIsClose] = useState(task.end === 'close');

  const handleSave = () => {
    const s = startVal ? timeInputToMinutes(startVal) : null;
    const e = endIsClose ? 'close' : endVal ? timeInputToMinutes(endVal) : null;
    onSave(s, e);
  };

  return (
    <div className="variable-time-editor" onClick={e => e.stopPropagation()}>
      <div className="variable-time-fields">
        <label className="vte-label">Start</label>
        <input type="time" className="vte-input" value={startVal} onChange={e => setStartVal(e.target.value)} autoFocus />
        <label className="vte-label">End</label>
        {endIsClose ? (
          <span className="vte-close-badge">Close</span>
        ) : (
          <input type="time" className="vte-input" value={endVal} onChange={e => setEndVal(e.target.value)} />
        )}
        <label className="vte-close-toggle">
          <input type="checkbox" checked={endIsClose} onChange={e => setEndIsClose(e.target.checked)} />
          <span>Close</span>
        </label>
      </div>
      <div className="variable-time-actions">
        <button className="btn btn-primary" style={{ minHeight: 26, fontSize: 11, padding: '3px 10px' }} onClick={handleSave}>
          <Check size={11} /> Save
        </button>
        <button className="btn" style={{ minHeight: 26, fontSize: 11, padding: '3px 8px' }} onClick={onClose}>
          <X size={11} />
        </button>
      </div>
    </div>
  );
}

// ─── Task Slot Popover ───────────────────────
// No role filtering — any staff can be assigned to any task.
// Sorted by grade A → B → C → ungraded.
function TaskPopover({ task, currentPersonId, onAssign, onRemove, onClose }) {
  const { data } = useApp();
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
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

  const gradeOrder = { A: 0, B: 1, C: 2 };
  const currentPerson = currentPersonId
    ? data.people.find(p => p.id === currentPersonId)
    : null;

  const sorted = [...data.people].sort(
    (a, b) => (gradeOrder[a.grade] ?? 3) - (gradeOrder[b.grade] ?? 3)
  );

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
              onClick={e => { e.stopPropagation(); onRemove(); }}
              title="Remove"
            >
              <Trash2 size={13} />
            </button>
          </div>
          <div className="popover-divider" />
        </>
      )}
      <div className="popover-section-label">Staff</div>
      {sorted.map(p => (
        <div
          key={p.id}
          className={`popover-item${p.id === currentPersonId ? ' current-person' : ''}`}
          onClick={() => onAssign(p.id)}
        >
          <div className="dot" style={{ background: p.color }} />
          <span style={{ flex: 1 }}>{p.name}</span>
          {p.grade && <span className={`grade-badge ${p.grade}`}>{p.grade}</span>}
        </div>
      ))}
    </div>
  );
}

// ─── Task Slot Row ───────────────────────────
function TaskSlotRow({ task, onPersonClick, onRemove }) {
  const { data, isAdmin, assignTask, updateTaskTime } = useApp();
  const [showPopover, setShowPopover] = useState(false);
  const [editingTime, setEditingTime] = useState(false);

  const droppableId = `task:${task.id}`;
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });

  const person = task.assignedPersonId
    ? data.people.find(p => p.id === task.assignedPersonId)
    : null;

  const handleRowClick = () => {
    if (isAdmin) setShowPopover(s => !s);
  };

  const timeDisplay = formatTaskTime(task);

  return (
    <div className="task-slot-wrapper" style={{ position: 'relative', zIndex: showPopover ? 10 : undefined }}>
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
              {isAdmin ? 'Assign…' : '—'}
            </div>
          )}
        </div>
        {onRemove && isAdmin && (
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
      {(isAdmin || timeDisplay) && (
        editingTime ? (
          <TaskTimeEditor
            task={task}
            onSave={(s, e) => { updateTaskTime(task.id, s, e); setEditingTime(false); }}
            onClose={() => setEditingTime(false)}
          />
        ) : (
          <div
            className={`variable-time-row${isAdmin ? ' editable' : ''}`}
            onClick={isAdmin ? (e) => { e.stopPropagation(); setEditingTime(true); } : undefined}
          >
            <span>{timeDisplay ?? (isAdmin ? 'Set time…' : '')}</span>
            {isAdmin && <Pencil size={9} style={{ opacity: 0.5 }} />}
          </div>
        )
      )}
    </div>
  );
}

// ─── Add Task Form ───────────────────────────
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
      start: null,
      end: null,
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

// ─── Additional Tasks Panel ──────────────────
export default function AdditionalTasks({ onPersonClick }) {
  const { data, isAdmin, removeTask, addTask, addLog } = useApp();
  const [addingDay, setAddingDay] = useState(null);

  const handleAdd = (task) => {
    addTask(task);
    setAddingDay(null);
  };

  const handleRemove = (task) => {
    addLog({
      action: `${task.label} removed from ${task.day}`,
      personName: '',
      day: task.day,
      detail: '',
    });
    removeTask(task.id);
  };

  return (
    <div data-tour="additional-tasks" style={{ padding: '0 16px 16px', flexShrink: 0 }}>
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
                        onRemove={isAdmin ? () => handleRemove(task) : undefined}
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
