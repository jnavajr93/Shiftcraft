import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useDroppable } from '@dnd-kit/core';
import { Plus, X, Trash2, Pencil, Zap } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { mondayOfWeek } from '../context/AppContext.jsx';
import { DAYS, generateId, minutesToTime, getAssignmentsForPerson, slotEffectiveRange, rangesOverlap } from '../data/seed.js';
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
    const closeOnExternalScroll = (e) => {
      if (contentRef.current?.contains(e.target)) return;
      onClose();
    };
    window.addEventListener('scroll', closeOnExternalScroll, { capture: true, passive: true });
    window.addEventListener('resize', onClose, { passive: true });
    return () => {
      window.removeEventListener('scroll', closeOnExternalScroll, { capture: true });
      window.removeEventListener('resize', onClose);
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

// ─── Task eligibility (no role check — any staff can take any task) ───────────
function taskIneligibleReason(person, task, clinics, allPeople) {
  if ((person.daysOff ?? []).includes(task.day)) return 'Off this day';

  const nameKey = person.name.trim().toLowerCase();
  const dayAssignments = getAssignmentsForPerson(nameKey, task.day, allPeople ?? [], clinics);

  const taskRange = (task.start != null && task.end != null && task.end !== 'close')
    ? { start: task.start, end: task.end }
    : null;

  const blocking = dayAssignments.filter(a => {
    if (a.isObs) return true; // OBS = day-level block
    if (!taskRange) return false;
    return rangesOverlap(taskRange, slotEffectiveRange(a.slotType, a.clinic));
  });

  if (blocking.length > 0) {
    const b = blocking[0];
    if (b.isObs) return 'Assigned to OBS this day';
    const br = slotEffectiveRange(b.slotType, b.clinic);
    const label = b.clinic.provider || b.clinic.location;
    return `Overlaps ${label} ${minutesToTime(br.start)}–${minutesToTime(br.end)}`;
  }

  return null;
}

// ─── Task Slot Popover ────────────────────────────────────────────────────────
// Follows SlotPopover pattern: Suggested / All Staff / Ineligible sections.
function TaskSlotPopover({ task, currentPersonId, onAssign, onRemove, onClose, triggerRef }) {
  const { data } = useApp();
  const { popoverStyle, contentRef } = usePortalPopover(triggerRef, onClose);

  useEffect(() => {
    const handler = (e) => {
      if (contentRef.current?.contains(e.target)) return;
      onClose();
    };
    const keyH = (e) => { if (e.key === 'Escape') onClose(); };
    const t = setTimeout(() => {
      document.addEventListener('mousedown', handler);
      document.addEventListener('touchstart', handler, { passive: true });
      document.addEventListener('keydown', keyH);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
      document.removeEventListener('keydown', keyH);
    };
  }, [onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  const gradeOrder = { A: 0, B: 1, C: 2 };
  const currentPerson = currentPersonId ? data.people.find(p => p.id === currentPersonId) : null;

  // Classify all people
  const classified = data.people.map(person => {
    const reason = taskIneligibleReason(person, task, data.clinics, data.people);
    return { person, eligible: !reason, reason };
  });

  const eligible = classified
    .filter(c => c.eligible)
    .sort((a, b) => (gradeOrder[a.person.grade] ?? 3) - (gradeOrder[b.person.grade] ?? 3));

  const ineligible = classified.filter(c => !c.eligible);

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
              onClick={e => { e.stopPropagation(); onRemove(); }}
              title="Remove"
            >
              <Trash2 size={13} />
            </button>
          </div>
          <div className="popover-divider" />
          <div className="popover-section-label">Staff</div>
          {eligible.map(({ person }) => (
            <TaskPersonRow key={person.id} person={person} isCurrent={person.id === currentPersonId} onAssign={onAssign} />
          ))}
          {ineligible.length > 0 && (
            <>
              <div className="popover-divider" />
              <div className="popover-section-label">Ineligible</div>
              {ineligible.map(({ person, reason }) => (
                <TaskPersonRow key={person.id} person={person} isCurrent={false} dimmed reason={reason} onAssign={onAssign} />
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
                <TaskPersonRow key={person.id} person={person} isCurrent={false} suggested onAssign={onAssign} />
              ))}
              {(rest.length > 0 || ineligible.length > 0) && <div className="popover-divider" />}
            </>
          )}
          {rest.length > 0 && (
            <>
              <div className="popover-section-label">All Staff</div>
              {rest.map(({ person }) => (
                <TaskPersonRow key={person.id} person={person} isCurrent={false} onAssign={onAssign} />
              ))}
            </>
          )}
          {ineligible.length > 0 && (
            <>
              <div className="popover-divider" />
              <div className="popover-section-label">Ineligible</div>
              {ineligible.map(({ person, reason }) => (
                <TaskPersonRow key={person.id} person={person} isCurrent={false} dimmed reason={reason} onAssign={onAssign} />
              ))}
            </>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}

function TaskPersonRow({ person, isCurrent, dimmed, suggested, reason, onAssign }) {
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
      {reason && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{reason}</span>}
    </div>
  );
}

// ─── Task Slot Row ────────────────────────────────────────────────────────────
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

  const timeDisplay = formatTaskTime(task);

  return (
    <div className="task-slot-wrapper" style={{ position: 'relative' }}>
      {/* Slot row — popover is a SIBLING, not a descendant, to avoid React event bubbling interference */}
      <div
        ref={combinedRef}
        className={`task-slot${isOver && isAdmin ? ' drop-target' : ''}`}
        onClick={() => { if (isAdmin) setShowPopover(s => !s); }}
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
      </div>

      {/* Popover lives OUTSIDE .task-slot so its clicks don't bubble to the toggle handler */}
      {showPopover && isAdmin && (
        <TaskSlotPopover
          task={task}
          currentPersonId={task.assignedPersonId}
          onAssign={(pid) => { assignTask(task.id, pid); setShowPopover(false); }}
          onRemove={() => { assignTask(task.id, null); setShowPopover(false); }}
          onClose={() => setShowPopover(false)}
          triggerRef={triggerRef}
        />
      )}

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

// ─── Add / Edit Task Form ─────────────────────────────────────────────────────
// Fields: Task, Location tag, Time. Staff is assigned via the slot popover after creation.
function AddTaskForm({ day, initialTask = null, onSubmit, onCancel }) {
  const { data } = useApp();

  const presetLabels = data.taskTypes ?? [];
  const initIsPreset = initialTask ? presetLabels.includes(initialTask.label) : false;

  const [labelMode, setLabelMode] = useState(
    initialTask ? (initIsPreset ? initialTask.label : '__custom') : ''
  );
  const [customLabel, setCustomLabel] = useState(
    initialTask && !initIsPreset ? (initialTask.label ?? '') : ''
  );
  const [locationTag, setLocationTag] = useState(initialTask?.locationTag ?? '');
  const [taskTime, setTaskTime] = useState({
    start:      initialTask?.start ?? 480,
    end:        initialTask?.end !== 'close' ? (initialTask?.end ?? 1020) : null,
    endIsClose: initialTask?.end === 'close',
  });

  const effectiveLabel = labelMode === '__custom' ? customLabel : labelMode;

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
      assignedPersonId: initialTask?.assignedPersonId ?? null,
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

// ─── Additional Tasks Panel ───────────────────────────────────────────────────
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
