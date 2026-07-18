import { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useDroppable } from '@dnd-kit/core';
import { Plus, X, Trash2, Pencil, Check } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { mondayOfWeek } from '../context/AppContext.jsx';
import { DAYS, generateId, minutesToTime, minutesToTimeInput, timeInputToMinutes, getAssignmentsForPerson, slotEffectiveRange, rangesOverlap } from '../data/seed.js';
import { fetchAbsencesForWeek } from '../services/dataService.js';
import { TimeRangePicker } from './TimeRangePicker.jsx';

// ─── Portal positioning hook (shared pattern with SlotPopover) ────────────────
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

    const spaceBelow = vh - tr.bottom - GAP;
    const top = pr.height <= spaceBelow
      ? tr.bottom + GAP
      : Math.max(EDGE, tr.top - GAP - pr.height);

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

function formatTaskTime(task) {
  const { start, end } = task;
  if (start == null && end == null) return null;
  const startStr = start != null ? minutesToTime(start) : '?';
  const endStr = end === 'close' ? 'Close' : end != null ? minutesToTime(end) : '?';
  return `${startStr} – ${endStr}`;
}

function TaskTimeEditor({ task, onSave, onClose }) {
  // Smart defaults: 8:00 AM start, 5:00 PM end — only applied when field is null
  return (
    <div className="variable-time-editor" onClick={e => e.stopPropagation()}>
      <TimeRangePicker
        defaultStart={task.start ?? 480}
        defaultEnd={task.end !== 'close' ? (task.end ?? 1020) : null}
        defaultEndIsClose={task.end === 'close'}
        onSave={onSave}
        onCancel={onClose}
      />
    </div>
  );
}

// ─── Task Slot Popover ───────────────────────
// No role filtering — any staff can be assigned to any task.
// Sorted by grade A → B → C → ungraded.
function TaskPopover({ task, currentPersonId, onAssign, onRemove, onClose, triggerRef }) {
  const { data } = useApp();
  const { popoverStyle, contentRef } = usePortalPopover(triggerRef, onClose);

  useEffect(() => {
    const handler = (e) => {
      if (contentRef.current && !contentRef.current.contains(e.target)) onClose();
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
  }, [onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  const gradeOrder = { A: 0, B: 1, C: 2 };
  const currentPerson = currentPersonId
    ? data.people.find(p => p.id === currentPersonId)
    : null;

  const sorted = [...data.people].sort(
    (a, b) => (gradeOrder[a.grade] ?? 3) - (gradeOrder[b.grade] ?? 3)
  );

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
    </div>,
    document.body,
  );
}

// ─── Task Slot Row ───────────────────────────
function TaskSlotRow({ task, onPersonClick, onEdit }) {
  const { data, isAdmin, assignTask, updateTaskTime, removeTask } = useApp();
  const [showPopover, setShowPopover] = useState(false);
  const [editingTime, setEditingTime] = useState(false);

  const droppableId = `task:${task.id}`;
  const { setNodeRef, isOver } = useDroppable({ id: droppableId });
  const triggerRef = useRef(null);
  const combinedRef = useCallback((el) => { setNodeRef(el); triggerRef.current = el; }, [setNodeRef]);

  const person = task.assignedPersonId
    ? data.people.find(p => p.id === task.assignedPersonId)
    : null;

  const handleRowClick = () => {
    if (isAdmin) setShowPopover(s => !s);
  };

  const timeDisplay = formatTaskTime(task);

  return (
    <div className="task-slot-wrapper" style={{ position: 'relative' }}>
      <div
        ref={combinedRef}
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
              <span className="person-chip-name">{person.name}</span>
            </div>
          ) : (
            <div className={`slot-empty${isOver && isAdmin ? ' droppable' : ''}`}>
              {isAdmin ? 'Assign…' : '—'}
            </div>
          )}
        </div>
        {isAdmin && (
          <div className="task-actions">
            <button
              className="task-edit-btn"
              onClick={e => { e.stopPropagation(); onEdit(); }}
              title="Edit task"
            >
              <Pencil size={11} />
            </button>
            <button
              className="task-remove-btn"
              onClick={e => { e.stopPropagation(); removeTask(task.id); }}
              title="Remove task"
            >
              <X size={12} />
            </button>
          </div>
        )}
        {showPopover && isAdmin && (
          <TaskPopover
            task={task}
            currentPersonId={task.assignedPersonId}
            onAssign={(pid) => { assignTask(task.id, pid); setShowPopover(false); }}
            onRemove={() => { assignTask(task.id, null); setShowPopover(false); }}
            onClose={() => setShowPopover(false)}
            triggerRef={triggerRef}
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

// ─── Add / Edit Task Form ────────────────────
const DAY_OFFSETS = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4 };

function AddTaskForm({ day, initialTask = null, onSubmit, onCancel }) {
  const { data, currentWeek } = useApp();

  // Label state — detect if edit-mode label is custom (not in taskTypes)
  const presetLabels = data.taskTypes ?? [];
  const initIsPreset = initialTask ? presetLabels.includes(initialTask.label) : false;

  const [labelMode, setLabelMode] = useState(
    initialTask ? (initIsPreset ? initialTask.label : '__custom') : ''
  );
  const [customLabel, setCustomLabel] = useState(
    initialTask && !initIsPreset ? (initialTask.label ?? '') : ''
  );
  const [locationTag, setLocationTag] = useState(initialTask?.locationTag ?? '');
  const [staffId, setStaffId] = useState(initialTask?.assignedPersonId ?? '');
  // Smart defaults: 8 AM start, 5 PM end — only applied when field is null
  const [taskTime, setTaskTime] = useState({
    start:      initialTask?.start ?? 480,
    end:        initialTask?.end !== 'close' ? (initialTask?.end ?? 1020) : null,
    endIsClose: initialTask?.end === 'close',
  });
  const [absences, setAbsences] = useState([]);

  useEffect(() => {
    const monday = mondayOfWeek(currentWeek);
    fetchAbsencesForWeek(monday).then(r => setAbsences(r.data ?? []));
  }, [currentWeek]);

  const effectiveLabel = labelMode === '__custom' ? customLabel : labelMode;

  // Date string for this day in the current week
  const weekMonday = mondayOfWeek(currentWeek);
  const dayDate = new Date(weekMonday);
  dayDate.setUTCDate(dayDate.getUTCDate() + (DAY_OFFSETS[day] ?? 0));
  const dayDateStr = dayDate.toISOString().slice(0, 10);

  // Eligibility per person (absence + time-overlap)
  const eligibility = useMemo(() => {
    const taskRange = (!taskTime.endIsClose && taskTime.start != null && taskTime.end != null)
      ? { start: taskTime.start, end: taskTime.end }
      : null;

    const result = {};
    for (const person of data.people) {
      const nameKey = person.name.trim().toLowerCase();

      const fullDayAbsent = absences.some(a =>
        a.person_name === nameKey &&
        a.start_date <= dayDateStr &&
        a.end_date >= dayDateStr &&
        a.type !== 'partial'
      );
      if (fullDayAbsent) { result[person.id] = 'On leave'; continue; }

      if (taskRange) {
        // Partial absence overlap
        const partialConflict = absences.some(a =>
          a.person_name === nameKey &&
          a.start_date <= dayDateStr &&
          a.end_date >= dayDateStr &&
          a.type === 'partial' &&
          a.partial_start != null && a.partial_end != null &&
          rangesOverlap(taskRange, { start: a.partial_start, end: a.partial_end })
        );
        if (partialConflict) { result[person.id] = 'On leave'; continue; }

        // Clinic assignment overlap
        const assignments = getAssignmentsForPerson(nameKey, day, data.people, data.clinics);
        const hasConflict = assignments.some(a => {
          if (a.isObs) return false;
          const r = slotEffectiveRange(a.slotType, a.clinic);
          return rangesOverlap(taskRange, r);
        });
        if (hasConflict) { result[person.id] = 'Time conflict'; continue; }
      }

      result[person.id] = null; // eligible
    }
    return result;
  }, [data.people, data.clinics, absences, dayDateStr, day, taskTime]);

  const gradeOrder = { A: 0, B: 1, C: 2 };
  const sortedPeople = [...data.people].sort(
    (a, b) => (gradeOrder[a.grade] ?? 3) - (gradeOrder[b.grade] ?? 3)
  );

  const timeError = !taskTime.endIsClose &&
    taskTime.start != null && taskTime.end != null &&
    taskTime.end <= taskTime.start;

  const handleSubmit = () => {
    if (!effectiveLabel.trim() || timeError) return;
    onSubmit({
      id: initialTask?.id ?? generateId(),
      label: effectiveLabel.trim(),
      day,
      locationTag: locationTag || null,
      assignedPersonId: staffId || null,
      isLocationSpecific: !!locationTag,
      start: taskTime.start,
      end: taskTime.endIsClose ? 'close' : taskTime.end,
    });
  };

  return (
    <div className="accommodation-form" style={{ margin: '6px 12px 8px' }}>
      {/* Task */}
      <div className="form-group">
        <label className="form-label">Task</label>
        <select
          className="form-input"
          style={{ fontSize: 13 }}
          value={labelMode}
          onChange={e => setLabelMode(e.target.value)}
        >
          <option value="">Select or type new…</option>
          {presetLabels.map(t => <option key={t} value={t}>{t}</option>)}
          <option value="__custom">+ New task type…</option>
        </select>
        {labelMode === '__custom' && (
          <input
            className="form-input"
            style={{ marginTop: 4, fontSize: 13 }}
            placeholder="Task name…"
            value={customLabel}
            onChange={e => setCustomLabel(e.target.value)}
            autoFocus
          />
        )}
      </div>

      {/* Location tag */}
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

      {/* Staff */}
      <div className="form-group">
        <label className="form-label">Staff (optional)</label>
        <select
          className="form-input"
          style={{ fontSize: 13 }}
          value={staffId}
          onChange={e => setStaffId(e.target.value)}
        >
          <option value="">Unassigned</option>
          {sortedPeople.map(p => {
            const reason = eligibility[p.id];
            return (
              <option key={p.id} value={p.id} disabled={!!reason}>
                {p.name}{p.grade ? ` (${p.grade})` : ''}{reason ? ` — ${reason}` : ''}
              </option>
            );
          })}
        </select>
      </div>

      {/* Time */}
      <div className="form-group">
        <label className="form-label">Time (optional)</label>
        <TimeRangePicker
          defaultStart={taskTime.start}
          defaultEnd={taskTime.end}
          defaultEndIsClose={taskTime.endIsClose}
          onChange={(s, e, eic) => setTaskTime({ start: s, end: e, endIsClose: eic })}
        />
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          className="btn btn-primary"
          style={{ minHeight: 32, fontSize: 12 }}
          onClick={handleSubmit}
          disabled={!effectiveLabel.trim() || !!timeError}
        >{initialTask ? 'Save' : 'Add'}</button>
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
  const { data, isAdmin, managerInitials, removeTask, addTask, updateTask, addLog } = useApp();
  const [addingDay, setAddingDay] = useState(null);
  const [editingTask, setEditingTask] = useState(null);

  const handleAdd = (task) => {
    addTask(task);
    setAddingDay(null);
  };

  const handleUpdate = (task) => {
    updateTask(task.id, task);
    setEditingTask(null);
  };

  const handleRemove = (task) => {
    addLog({
      action: `${task.label} removed from ${task.day}`,
      personName: '',
      day: task.day,
      detail: '',
      initials: managerInitials ?? undefined,
    });
    removeTask(task.id);
  };
  void handleRemove;

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
                      editingTask?.id === task.id ? (
                        <AddTaskForm
                          key={task.id}
                          day={day}
                          initialTask={task}
                          onSubmit={handleUpdate}
                          onCancel={() => setEditingTask(null)}
                        />
                      ) : (
                        <TaskSlotRow
                          key={task.id}
                          task={task}
                          onPersonClick={onPersonClick}
                          onEdit={() => { setAddingDay(null); setEditingTask(task); }}
                        />
                      )
                    ))}
                  </div>
                )}
                {isAdmin && (
                  addingDay === day ? (
                    <AddTaskForm
                      day={day}
                      onSubmit={handleAdd}
                      onCancel={() => setAddingDay(null)}
                    />
                  ) : (
                    <button
                      className="btn"
                      style={{ minHeight: 32, fontSize: 12, width: '100%' }}
                      onClick={() => { setEditingTask(null); setAddingDay(day); }}
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
