import { useState, useCallback, useEffect } from 'react';
import { Trash2, Plus, Pencil, GripVertical, X } from 'lucide-react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useApp } from '../context/AppContext.jsx';
import {
  generateId, DAYS, minutesToTime, ROLES, EMPLOYMENT_TYPES, SKILLS,
  ACCOMMODATION_TYPES, EARLY_LEAVE_REASONS, accommodationLabel,
} from '../data/seed.js';
import ClinicConfig from './ClinicConfig.jsx';

const GRADE_OPTIONS = ['A', 'B', 'C', 'T'];
const PRESET_COLORS = [
  '#2563eb','#16a34a','#0891b2','#db2777','#9333ea',
  '#ea580c','#65a30d','#0d9488','#c026d3','#0284c7','#7c3aed',
  '#b45309','#0f766e','#7e22ce','#be185d','#166534','#1d4ed8',
];

function toggleArr(arr, item) {
  return arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item];
}

// lockedTo entries can be plain strings ("Dr. B") or objects ({ provider, slot }).
// These helpers unify the two formats for pill display and toggle.
function lockedToHasProvider(lockedTo, providerName) {
  return (lockedTo ?? []).some(e => (typeof e === 'string' ? e : e.provider) === providerName);
}
function lockedToToggleProvider(lockedTo, providerName) {
  const arr = lockedTo ?? [];
  const has = lockedToHasProvider(arr, providerName);
  if (has) return arr.filter(e => (typeof e === 'string' ? e : e.provider) !== providerName);
  return [...arr, providerName]; // UI always adds plain strings; objects come from seed/migration
}

// ─── Availability Constraints ─────────────────
function AvailabilityConstraints({ windows, daysOff, onChange }) {
  const constrainedDays = Object.keys(windows).filter(
    d => windows[d] && (windows[d].startNotBefore != null || windows[d].endNoLater != null)
  );

  const parseTime = (str) => {
    if (!str) return null;
    const [h, m] = str.split(':').map(Number);
    return h * 60 + (m || 0);
  };

  const toInputVal = (min) => {
    if (min == null) return '';
    const h = String(Math.floor(min / 60)).padStart(2, '0');
    const m = String(min % 60).padStart(2, '0');
    return `${h}:${m}`;
  };

  const addConstraint = () => {
    const available = DAYS.filter(d => !daysOff.includes(d) && !constrainedDays.includes(d));
    if (available.length === 0) return;
    const day = available[0];
    onChange({ ...windows, [day]: { startNotBefore: null, endNoLater: null } });
  };

  const removeConstraint = (day) => {
    const next = { ...windows };
    delete next[day];
    onChange(next);
  };

  const setField = (day, field, val) => {
    onChange({ ...windows, [day]: { ...(windows[day] ?? {}), [field]: val } });
  };

  const changeDay = (oldDay, newDay) => {
    const next = { ...windows };
    next[newDay] = next[oldDay];
    delete next[oldDay];
    onChange(next);
  };

  const availableDaysForRow = (currentDay) =>
    DAYS.filter(d => !daysOff.includes(d) && (d === currentDay || !constrainedDays.includes(d)));

  return (
    <div className="avail-constraints">
      {constrainedDays.map(day => (
        <div key={day} className="avail-constraint-row">
          <select
            className="form-input avail-day-select"
            value={day}
            onChange={e => changeDay(day, e.target.value)}
          >
            {availableDaysForRow(day).map(d => <option key={d}>{d}</option>)}
          </select>
          <input
            type="time"
            className="form-input avail-time-input"
            value={toInputVal(windows[day]?.startNotBefore)}
            onChange={e => setField(day, 'startNotBefore', parseTime(e.target.value) || null)}
            title="Start not before"
          />
          <span className="avail-sep">–</span>
          <input
            type="time"
            className="form-input avail-time-input"
            value={toInputVal(windows[day]?.endNoLater)}
            onChange={e => setField(day, 'endNoLater', parseTime(e.target.value) || null)}
            title="End no later"
          />
          <button
            className="btn btn-icon"
            style={{ minHeight: 32, padding: 4 }}
            onClick={() => removeConstraint(day)}
          >
            <X size={13} />
          </button>
        </div>
      ))}
      {DAYS.filter(d => !daysOff.includes(d) && !constrainedDays.includes(d)).length > 0 && (
        <button
          className="btn"
          style={{ minHeight: 30, fontSize: 12, marginTop: constrainedDays.length > 0 ? 4 : 0 }}
          onClick={addConstraint}
        >
          <Plus size={12} /> Add availability constraint
        </button>
      )}
    </div>
  );
}

// ─── Add Accommodation Form ───────────────────
function AddAccommodationForm({ locations, providers, onAdd, onCancel }) {
  const [type, setType] = useState('');
  const [day, setDay] = useState('Mon');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [reason, setReason] = useState('personal');
  const [locationId, setLocationId] = useState(locations[0] ?? '');

  const parseTime = (str) => {
    if (!str) return null;
    const [h, m] = str.split(':').map(Number);
    return h * 60 + (m || 0);
  };

  const handleAdd = () => {
    if (!type) return;
    let acc;
    if (type === 'extended_lunch')
      acc = { type, day, start: parseTime(start), end: parseTime(end) };
    else if (type === 'early_leave')
      acc = { type, day, endTime: parseTime(end), reason };
    else if (type === 'no_half_days')
      acc = { type, locationId };
    else if (type === 'no_back_to_back_locations')
      acc = { type };
    else if (type === 'late_start')
      acc = { type, day, startTime: parseTime(start), reason };
    if (acc) onAdd(acc);
  };

  const typeLabels = {
    extended_lunch: 'Extended lunch',
    early_leave: 'Leave early',
    no_half_days: 'No half days at location',
    no_back_to_back_locations: 'No back-to-back locations',
    late_start: 'Late start',
  };

  const needsDay = ['extended_lunch', 'early_leave', 'late_start'].includes(type);
  const needsStart = ['extended_lunch', 'late_start'].includes(type);
  const needsEnd = ['extended_lunch', 'early_leave'].includes(type);
  const needsReason = ['early_leave', 'late_start'].includes(type);
  const needsLocation = type === 'no_half_days';

  return (
    <div className="accommodation-form">
      <div className="form-group">
        <label className="form-label">Type</label>
        <select className="form-input" value={type} onChange={e => setType(e.target.value)}>
          <option value="">Select type…</option>
          {ACCOMMODATION_TYPES.map(t => (
            <option key={t} value={t}>{typeLabels[t]}</option>
          ))}
        </select>
      </div>
      {needsDay && (
        <div className="form-group">
          <label className="form-label">Day</label>
          <select className="form-input" value={day} onChange={e => setDay(e.target.value)}>
            <option value="*">All days</option>
            {DAYS.map(d => <option key={d}>{d}</option>)}
          </select>
        </div>
      )}
      {needsStart && (
        <div className="form-group">
          <label className="form-label">{type === 'late_start' ? 'Start time' : 'Lunch start'}</label>
          <input type="time" className="form-input" value={start} onChange={e => setStart(e.target.value)} />
        </div>
      )}
      {needsEnd && (
        <div className="form-group">
          <label className="form-label">{type === 'early_leave' ? 'Leave by' : 'Lunch end'}</label>
          <input type="time" className="form-input" value={end} onChange={e => setEnd(e.target.value)} />
        </div>
      )}
      {needsReason && (
        <div className="form-group">
          <label className="form-label">Reason</label>
          <select className="form-input" value={reason} onChange={e => setReason(e.target.value)}>
            {EARLY_LEAVE_REASONS.map(r => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </div>
      )}
      {needsLocation && (
        <div className="form-group">
          <label className="form-label">Location</label>
          <select className="form-input" value={locationId} onChange={e => setLocationId(e.target.value)}>
            {locations.map(l => <option key={l}>{l}</option>)}
          </select>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button className="btn btn-primary" style={{ minHeight: 36, fontSize: 13 }} onClick={handleAdd} disabled={!type}>
          Add
        </button>
        <button className="btn" style={{ minHeight: 36, fontSize: 13 }} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Person Card (sortable) ───────────────────
function PersonCard({ person, providers, locations }) {
  const { updatePerson, deletePerson } = useApp();
  const [showAccForm, setShowAccForm] = useState(false);
  const up = (field, value) => updatePerson(person.id, { [field]: value });

  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: person.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const confirmDelete = () => {
    if (confirm(`Remove ${person.name} from all schedules?`)) deletePerson(person.id);
  };

  const addAccommodation = (acc) => {
    up('accommodations', [...(person.accommodations ?? []), acc]);
    setShowAccForm(false);
  };

  const removeAccommodation = (i) => {
    up('accommodations', person.accommodations.filter((_, idx) => idx !== i));
  };

  const togglePrefLocation = (loc) => {
    const cur = person.preferredLocations ?? [];
    if (cur.includes(loc)) {
      up('preferredLocations', cur.filter(l => l !== loc));
    } else {
      up('preferredLocations', [...cur, loc]);
    }
  };

  return (
    <div ref={setNodeRef} style={style} className="person-setup-card">
      {/* Header: drag handle + color + name + delete */}
      <div className="person-setup-header">
        <button
          className="drag-handle"
          {...listeners}
          {...attributes}
          tabIndex={-1}
          title="Drag to reorder"
        >
          <GripVertical size={16} />
        </button>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <input
            type="color"
            value={person.color}
            onChange={e => up('color', e.target.value)}
            style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }}
          />
          <div className="color-swatch" style={{ background: person.color }} />
        </div>
        <input
          className="form-input"
          style={{ flex: 1, fontWeight: 500 }}
          value={person.name}
          onChange={e => up('name', e.target.value)}
          placeholder="Name"
        />
        <button className="btn btn-icon btn-danger" onClick={confirmDelete} style={{ minHeight: 36 }}>
          <Trash2 size={15} />
        </button>
      </div>

      {/* Employment type */}
      <div className="form-group">
        <label className="form-label">Employment</label>
        <div style={{ display: 'flex', gap: 4 }}>
          {EMPLOYMENT_TYPES.map(et => (
            <button
              key={et}
              className={`pill small${person.employmentType === et ? ' active' : ''}`}
              onClick={() => up('employmentType', et)}
            >
              {et}
            </button>
          ))}
        </div>
      </div>

      {/* Staff type */}
      <div className="form-group">
        <label className="form-label">Staff Type</label>
        <div style={{ display: 'flex', gap: 4 }}>
          {['tech', 'admin'].map(t => (
            <button
              key={t}
              className={`pill small${(person.staffType ?? 'tech') === t ? ' active' : ''}`}
              onClick={() => up('staffType', t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Grade */}
      <div className="form-group">
        <label className="form-label">Grade</label>
        <div className="grade-picker">
          {GRADE_OPTIONS.map(g => (
            <button
              key={g}
              className={`grade-pill ${g}${person.grade === g ? ' active' : ''}`}
              onClick={() => up('grade', person.grade === g ? null : g)}
            >{g}</button>
          ))}
          <button
            className="grade-pill"
            onClick={() => up('grade', null)}
          >—</button>
        </div>
      </div>

      {/* Roles */}
      <div className="form-group">
        <label className="form-label">Roles <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'none', fontWeight: 400 }}>(first = primary)</span></label>
        <div className="pill-group">
          {ROLES.map(r => {
            const idx = person.roles.indexOf(r);
            const isActive = idx !== -1;
            return (
              <button
                key={r}
                className={`pill${isActive ? ' active' : ''}`}
                onClick={() => up('roles', toggleArr(person.roles, r))}
              >
                {isActive ? `${idx + 1}. ` : ''}{r}
              </button>
            );
          })}
        </div>
      </div>

      {/* Skills */}
      <div className="form-group">
        <label className="form-label">Skills</label>
        <div className="pill-group">
          {SKILLS.map(s => (
            <button
              key={s}
              className={`pill small${(person.skills ?? []).includes(s) ? ' active' : ''}`}
              onClick={() => up('skills', toggleArr(person.skills ?? [], s))}
            >{s}</button>
          ))}
        </div>
      </div>

      {/* Preferred locations */}
      <div className="form-group">
        <label className="form-label">Preferred Locations <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'none', fontWeight: 400 }}>(first = top)</span></label>
        <div className="pill-group">
          {locations.map(l => {
            const idx = (person.preferredLocations ?? []).indexOf(l);
            const isActive = idx !== -1;
            return (
              <button
                key={l}
                className={`pill small${isActive ? ' active' : ''}`}
                onClick={() => togglePrefLocation(l)}
              >
                {isActive ? `${idx + 1}. ` : ''}{l}
              </button>
            );
          })}
        </div>
      </div>

      {/* Locked to */}
      <div className="form-group">
        <label className="form-label">Locked to Provider <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'none', fontWeight: 400 }}>(none = flexible)</span></label>
        <div className="pill-group">
          {providers.map(p => (
            <button
              key={p.name}
              className={`pill small${lockedToHasProvider(person.lockedTo, p.name) ? ' active' : ''}`}
              onClick={() => up('lockedTo', lockedToToggleProvider(person.lockedTo, p.name))}
            >{p.name}</button>
          ))}
        </div>
      </div>

      {/* Days off */}
      <div className="form-group">
        <label className="form-label">Days Off</label>
        <div className="pill-group">
          {DAYS.map(d => (
            <button
              key={d}
              className={`pill small daysoff${(person.daysOff ?? []).includes(d) ? ' active' : ''}`}
              onClick={() => up('daysOff', toggleArr(person.daysOff ?? [], d))}
            >{d}</button>
          ))}
        </div>
      </div>

      {/* Availability windows */}
      <div className="form-group">
        <label className="form-label">Availability Windows</label>
        <AvailabilityConstraints
          windows={person.availabilityWindows ?? {}}
          daysOff={person.daysOff ?? []}
          onChange={(w) => up('availabilityWindows', w)}
        />
      </div>

      {/* Accommodations */}
      <div className="form-group">
        <label className="form-label">Accommodations</label>
        {(person.accommodations ?? []).length > 0 && (
          <div className="accommodation-list">
            {person.accommodations.map((acc, i) => (
              <div key={i} className="accommodation-item">
                <span style={{ fontSize: 12, flex: 1 }}>{accommodationLabel(acc)}</span>
                <button
                  className="btn btn-icon"
                  style={{ minHeight: 24, padding: 3 }}
                  onClick={() => removeAccommodation(i)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        {showAccForm ? (
          <AddAccommodationForm
            locations={locations}
            providers={providers}
            onAdd={addAccommodation}
            onCancel={() => setShowAccForm(false)}
          />
        ) : (
          <button
            className="btn"
            style={{ minHeight: 32, fontSize: 12, marginTop: 4 }}
            onClick={() => setShowAccForm(true)}
          >
            <Plus size={13} /> Add accommodation
          </button>
        )}
      </div>

      {/* Target hours */}
      <div className="form-group">
        <label className="form-label">Target Hours / Week</label>
        <input
          className="form-input"
          type="number" min="0" max="80"
          value={person.targetHours ?? 40}
          onChange={e => up('targetHours', Number(e.target.value))}
          style={{ width: 100 }}
        />
      </div>
    </div>
  );
}

// ─── Add Person Modal ────────────────────────
function AddPersonModal({ onClose, existingNames, providers, locations, defaultStaffType = 'tech' }) {
  const { addPerson, addLog } = useApp();

  const defaultColor = PRESET_COLORS.find(c => !existingNames.includes(c)) ?? PRESET_COLORS[0];

  const [form, setForm] = useState({
    name: '',
    color: defaultColor,
    employmentType: 'Full-time',
    grade: null,
    staffType: defaultStaffType,
    roles: [],
    skills: [],
    clearedLocations: [],
    preferredLocations: [],
    lockedTo: [],
    daysOff: [],
    targetHours: 40,
  });
  const [nameError, setNameError] = useState('');
  const [shake, setShake] = useState(false);

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

  const togglePrefLocation = (loc) => {
    const cur = form.preferredLocations;
    set('preferredLocations', cur.includes(loc) ? cur.filter(l => l !== loc) : [...cur, loc]);
  };

  const validate = () => {
    const trimmed = form.name.trim();
    if (!trimmed) {
      setNameError('Name is required');
      triggerShake();
      return false;
    }
    if (existingNames.map(n => n.toLowerCase()).includes(trimmed.toLowerCase())) {
      setNameError('A staff member with this name already exists');
      triggerShake();
      return false;
    }
    return true;
  };

  const triggerShake = () => {
    setShake(true);
    setTimeout(() => setShake(false), 400);
  };

  const handleSave = () => {
    if (!validate()) return;
    const person = {
      id: generateId(),
      name: form.name.trim(),
      color: form.color,
      employmentType: form.employmentType,
      grade: form.grade,
      staffType: form.staffType,
      roles: form.roles,
      skills: form.skills,
      clearedLocations: form.clearedLocations,
      preferredLocations: form.preferredLocations,
      lockedTo: form.lockedTo,
      daysOff: form.daysOff,
      availabilityWindows: {},
      accommodations: [],
      targetHours: form.targetHours,
    };
    addPerson(person);
    addLog({ action: `${person.name} added to roster`, personName: person.name, day: '', detail: '' });
    onClose();
  };

  const handleBackdrop = (e) => { if (e.target === e.currentTarget) onClose(); };

  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div className="overlay-backdrop" onClick={handleBackdrop} style={{ zIndex: 250, alignItems: 'flex-start', paddingTop: 40 }}>
      <div className="overlay-modal" style={{ maxWidth: 520, maxHeight: 'calc(100vh - 80px)', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '0.5px solid var(--border)', flexShrink: 0 }}>
          <div style={{ fontWeight: 500, fontSize: 16 }}>Add new staff member</div>
          <button className="overlay-close" style={{ position: 'static' }} onClick={onClose}><X size={16} /></button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Name */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Name <span style={{ color: 'var(--red)' }}>*</span></label>
            <input
              className={`form-input${shake ? ' shake' : ''}`}
              style={{ fontWeight: 500 }}
              autoFocus
              placeholder="Full name"
              value={form.name}
              onChange={e => { set('name', e.target.value); setNameError(''); }}
            />
            {nameError && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 4 }}>{nameError}</div>}
          </div>

          {/* Color */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Color</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => set('color', c)}
                  style={{
                    width: 26, height: 26, borderRadius: '50%', background: c,
                    border: form.color === c ? '2.5px solid var(--text-primary)' : '2px solid transparent',
                    outline: form.color === c ? '2px solid var(--bg-elevated)' : 'none',
                    outlineOffset: -4, cursor: 'pointer', flexShrink: 0,
                    boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.12)',
                  }}
                  title={c}
                />
              ))}
            </div>
          </div>

          {/* Employment */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Employment</label>
            <div style={{ display: 'flex', gap: 4 }}>
              {EMPLOYMENT_TYPES.map(et => (
                <button key={et} className={`pill small${form.employmentType === et ? ' active' : ''}`} onClick={() => set('employmentType', et)}>{et}</button>
              ))}
            </div>
          </div>

          {/* Staff type */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Staff Type</label>
            <div style={{ display: 'flex', gap: 4 }}>
              {['tech', 'admin'].map(t => (
                <button key={t} className={`pill small${form.staffType === t ? ' active' : ''}`} onClick={() => set('staffType', t)}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Grade */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Grade</label>
            <div className="grade-picker">
              {GRADE_OPTIONS.map(g => (
                <button key={g} className={`grade-pill ${g}${form.grade === g ? ' active' : ''}`} onClick={() => set('grade', form.grade === g ? null : g)}>{g}</button>
              ))}
              <button className="grade-pill" onClick={() => set('grade', null)}>—</button>
            </div>
          </div>

          {/* Roles */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Roles <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'none', fontWeight: 400 }}>(first = primary)</span></label>
            <div className="pill-group">
              {ROLES.map(r => {
                const idx = form.roles.indexOf(r);
                const isActive = idx !== -1;
                return (
                  <button key={r} className={`pill${isActive ? ' active' : ''}`} onClick={() => set('roles', toggleArr(form.roles, r))}>
                    {isActive ? `${idx + 1}. ` : ''}{r}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Skills */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Skills</label>
            <div className="pill-group">
              {SKILLS.map(s => (
                <button key={s} className={`pill small${form.skills.includes(s) ? ' active' : ''}`} onClick={() => set('skills', toggleArr(form.skills, s))}>{s}</button>
              ))}
            </div>
          </div>

          {/* Preferred locations */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Preferred Locations <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'none', fontWeight: 400 }}>(first = top)</span></label>
            <div className="pill-group">
              {locations.map(l => {
                const idx = form.preferredLocations.indexOf(l);
                const isActive = idx !== -1;
                return (
                  <button key={l} className={`pill small${isActive ? ' active' : ''}`} onClick={() => togglePrefLocation(l)}>
                    {isActive ? `${idx + 1}. ` : ''}{l}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Locked to provider */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Locked to Provider <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'none', fontWeight: 400 }}>(none = flexible)</span></label>
            <div className="pill-group">
              {providers.map(p => (
                <button key={p.name} className={`pill small${lockedToHasProvider(form.lockedTo, p.name) ? ' active' : ''}`} onClick={() => set('lockedTo', lockedToToggleProvider(form.lockedTo, p.name))}>{p.name}</button>
              ))}
            </div>
          </div>

          {/* Days off */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Days Off</label>
            <div className="pill-group">
              {DAYS.map(d => (
                <button key={d} className={`pill small daysoff${form.daysOff.includes(d) ? ' active' : ''}`} onClick={() => set('daysOff', toggleArr(form.daysOff, d))}>{d}</button>
              ))}
            </div>
          </div>

          {/* Target hours */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Target Hours / Week</label>
            <input
              className="form-input"
              type="number" min="0" max="80"
              value={form.targetHours}
              onChange={e => set('targetHours', Number(e.target.value))}
              style={{ width: 100 }}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 20px', borderTop: '0.5px solid var(--border)', flexShrink: 0 }}>
          <button className="btn" style={{ minHeight: 40 }} onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" style={{ minHeight: 40 }} onClick={handleSave}>Add to roster</button>
        </div>
      </div>
    </div>
  );
}

// ─── Staff Tab ────────────────────────────────
function StaffTab() {
  const { data, reorderPeople } = useApp();
  const [showModal, setShowModal] = useState(false);
  const [staffSubTab, setStaffSubTab] = useState('tech');

  const sensors = useSensors(useSensor(PointerSensor, {
    activationConstraint: { distance: 5 },
  }));

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const oldIndex = data.people.findIndex(p => p.id === active.id);
    const newIndex = data.people.findIndex(p => p.id === over.id);
    reorderPeople(arrayMove(data.people, oldIndex, newIndex));
  };

  const techPeople = data.people.filter(p => (p.staffType ?? 'tech') !== 'admin');
  const adminPeople = data.people.filter(p => p.staffType === 'admin');
  const visiblePeople = staffSubTab === 'tech' ? techPeople : adminPeople;

  return (
    <div className="setup-content">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {['tech', 'admin'].map(t => (
            <button
              key={t}
              className={`setup-subtab${staffSubTab === t ? ' active' : ''}`}
              style={{ fontSize: 12, padding: '4px 12px' }}
              onClick={() => setStaffSubTab(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
              <span style={{ marginLeft: 5, opacity: 0.6, fontWeight: 400 }}>
                ({t === 'tech' ? techPeople.length : adminPeople.length})
              </span>
            </button>
          ))}
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={15} /> Add Person
        </button>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={visiblePeople.map(p => p.id)} strategy={verticalListSortingStrategy}>
          <div className="people-grid">
            {visiblePeople.map(p => (
              <PersonCard
                key={p.id}
                person={p}
                providers={data.providers}
                locations={data.locations}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {showModal && (
        <AddPersonModal
          onClose={() => setShowModal(false)}
          existingNames={data.people.map(p => p.name)}
          providers={data.providers}
          locations={data.locations}
          defaultStaffType={staffSubTab}
        />
      )}
    </div>
  );
}

// ─── Clinic Row (with inline delete confirm) ──
function ClinicRow({ c, onEdit, onDeleted }) {
  const { removeClinic, addLog } = useApp();
  const [confirming, setConfirming] = useState(false);

  const handleDelete = () => {
    addLog({ action: `${c.provider} · ${c.location} on ${c.day} removed`, personName: '', day: c.day, detail: '' });
    removeClinic(c.id);
    onDeleted?.();
  };

  if (confirming) {
    return (
      <div className="clinic-setup-row" style={{ background: 'var(--red-bg)', borderRadius: 'var(--radius)', padding: '8px 12px', gap: 8 }}>
        <div style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)' }}>
          Delete <strong>{c.provider} · {c.location}</strong>?
        </div>
        <button
          className="btn btn-danger"
          style={{ minHeight: 32, fontSize: 12, padding: '4px 10px' }}
          onClick={handleDelete}
        >
          Yes, delete
        </button>
        <button
          className="btn"
          style={{ minHeight: 32, fontSize: 12, padding: '4px 10px' }}
          onClick={() => setConfirming(false)}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="clinic-setup-row">
      <div className="clinic-setup-info">
        <div className="clinic-setup-primary">{c.provider} · {c.location}</div>
        <div className="clinic-setup-secondary">
          {minutesToTime(c.startTime)} – {minutesToTime(c.endTime)}
          {c.patientCount != null ? ` · ${c.patientCount} pts` : ''}
          {!c.open ? ' · Closed' : ''}
        </div>
      </div>
      <button
        className="btn btn-icon"
        style={{ minHeight: 36 }}
        onClick={() => onEdit(c.id)}
        title="Edit clinic"
      >
        <Pencil size={14} />
      </button>
      <button
        className="btn btn-icon clinic-delete-btn"
        style={{ minHeight: 36 }}
        onClick={() => setConfirming(true)}
        title="Delete clinic"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

// ─── Clinics Tab ──────────────────────────────
function ClinicsTab() {
  const { data, addClinic } = useApp();
  const [editId, setEditId] = useState(null);

  const handleAdd = (day) => {
    const id = generateId();
    addClinic({
      id, day, week: 'A',
      location: data.locations[0] ?? 'Phoenix',
      provider: data.providers[0]?.name ?? 'Dr. R',
      open: true, startTime: 480, endTime: 1020, patientCount: null,
      slots: { openingFD: null, closingFD: null, scribe: null, opener: null, closing: null, middle: null, training: null },
    });
    setEditId(id);
  };

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden', height: '100%' }}>
      <div className="setup-content" style={{ flex: 1 }}>
        {DAYS.map(day => {
          const dayClinics = data.clinics.filter(c => c.day === day);
          return (
            <div key={day} className="day-group">
              <div className="day-group-header">{day}</div>
              {dayClinics.map(c => (
                <ClinicRow
                  key={c.id}
                  c={c}
                  onEdit={setEditId}
                  onDeleted={() => { if (editId === c.id) setEditId(null); }}
                />
              ))}
              <div className="section-add">
                <button className="btn" style={{ minHeight: 36, fontSize: 13 }} onClick={() => handleAdd(day)}>
                  <Plus size={14} /> Add clinic
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {editId && <ClinicConfig clinicId={editId} onClose={() => setEditId(null)} />}
    </div>
  );
}

// ─── Locations Tab ────────────────────────────
function LocationsTab() {
  const { data, addLocation, removeLocation } = useApp();
  const [newLoc, setNewLoc] = useState('');

  const handleAdd = () => {
    const val = newLoc.trim();
    if (val && !data.locations.includes(val)) {
      addLocation(val);
      setNewLoc('');
    }
  };

  return (
    <div className="setup-content">
      {data.locations.map(loc => (
        <div key={loc} className="location-row">
          <span className="location-name">{loc}</span>
          <button
            className="btn btn-icon btn-danger"
            style={{ minHeight: 32 }}
            onClick={() => { if (confirm(`Remove "${loc}"?`)) removeLocation(loc); }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, maxWidth: 360 }}>
        <input
          className="form-input"
          placeholder="New location…"
          value={newLoc}
          onChange={e => setNewLoc(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
        />
        <button className="btn btn-primary" onClick={handleAdd} style={{ minHeight: 40, flexShrink: 0 }}>
          <Plus size={15} /> Add
        </button>
      </div>
    </div>
  );
}

// ─── Main Setup ───────────────────────────────
export default function Setup() {
  const [subTab, setSubTab] = useState('staff');

  return (
    <div className="setup-page">
      <div className="setup-subtabs">
        {['staff', 'clinics', 'locations'].map(t => (
          <button
            key={t}
            className={`setup-subtab${subTab === t ? ' active' : ''}`}
            onClick={() => setSubTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {subTab === 'staff'     && <StaffTab />}
      {subTab === 'clinics'   && <ClinicsTab />}
      {subTab === 'locations' && <LocationsTab />}
    </div>
  );
}
