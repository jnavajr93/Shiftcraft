import { useState, useCallback } from 'react';
import { Trash2, Plus, Pencil, GripVertical, X } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import {
  generateId, DAYS, minutesToTime, ROLES, EMPLOYMENT_TYPES,
  ACCOMMODATION_TYPES, EARLY_LEAVE_REASONS, accommodationLabel,
} from '../data/seed.js';
import ClinicConfig from './ClinicConfig.jsx';

const GRADE_OPTIONS = ['A', 'B', 'C'];
const PRESET_COLORS = [
  '#2563eb','#16a34a','#0891b2','#db2777','#9333ea',
  '#ea580c','#65a30d','#0d9488','#c026d3','#0284c7','#7c3aed',
];

function toggleArr(arr, item) {
  return arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item];
}

// ─── Availability Windows ────────────────────
function AvailabilityTable({ windows, daysOff, onChange }) {
  const activeDays = DAYS.filter(d => !daysOff.includes(d));
  if (activeDays.length === 0) return null;

  const setWindow = (day, field, val) => {
    onChange({ ...windows, [day]: { ...(windows[day] ?? {}), [field]: val } });
  };

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

  return (
    <div className="avail-table">
      <div className="avail-header">
        <span>Day</span><span>Start not before</span><span>End no later</span>
      </div>
      {activeDays.map(day => {
        const w = windows[day] ?? {};
        return (
          <div key={day} className="avail-row">
            <span className="avail-day">{day}</span>
            <input
              type="time"
              className="form-input"
              style={{ padding: '4px 6px', fontSize: 12 }}
              value={toInputVal(w.startNotBefore)}
              onChange={e => setWindow(day, 'startNotBefore', parseTime(e.target.value) || null)}
            />
            <input
              type="time"
              className="form-input"
              style={{ padding: '4px 6px', fontSize: 12 }}
              value={toInputVal(w.endNoLater)}
              onChange={e => setWindow(day, 'endNoLater', parseTime(e.target.value) || null)}
            />
          </div>
        );
      })}
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

// ─── Person Card ───────────────────────────────
function PersonCard({ person, providers, locations }) {
  const { updatePerson, deletePerson } = useApp();
  const [showAccForm, setShowAccForm] = useState(false);
  const up = (field, value) => updatePerson(person.id, { [field]: value });

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
    <div className="person-setup-card">
      {/* Header: color + name + delete */}
      <div className="person-setup-header">
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
        <label className="form-label">Roles</label>
        <div className="pill-group">
          {ROLES.map(r => (
            <button
              key={r}
              className={`pill${person.roles.includes(r) ? ' active' : ''}`}
              onClick={() => up('roles', toggleArr(person.roles, r))}
            >{r}</button>
          ))}
        </div>
      </div>

      {/* Cleared locations */}
      <div className="form-group">
        <label className="form-label">Cleared Locations <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'none', fontWeight: 400 }}>(none = any)</span></label>
        <div className="pill-group">
          {locations.map(l => (
            <button
              key={l}
              className={`pill small${(person.clearedLocations ?? []).includes(l) ? ' active' : ''}`}
              onClick={() => up('clearedLocations', toggleArr(person.clearedLocations ?? [], l))}
            >{l}</button>
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
        <label className="form-label">Locked to Provider</label>
        <select
          className="form-input"
          value={person.lockedTo ?? ''}
          onChange={e => up('lockedTo', e.target.value || null)}
        >
          <option value="">None</option>
          {providers.map(p => <option key={p}>{p}</option>)}
        </select>
      </div>

      {/* Days off */}
      <div className="form-group">
        <label className="form-label">Days Off</label>
        <div className="pill-group">
          {DAYS.map(d => (
            <button
              key={d}
              className={`pill small${(person.daysOff ?? []).includes(d) ? ' active' : ''}`}
              onClick={() => up('daysOff', toggleArr(person.daysOff ?? [], d))}
            >{d}</button>
          ))}
        </div>
      </div>

      {/* Availability windows */}
      <div className="form-group">
        <label className="form-label">Availability Windows</label>
        <AvailabilityTable
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

// ─── People Tab ───────────────────────────────
function PeopleTab() {
  const { data, addPerson } = useApp();

  const handleAdd = () => {
    addPerson({
      id: generateId(),
      name: 'New Person',
      color: PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)],
      employmentType: 'Full-time',
      grade: null,
      roles: [],
      clearedLocations: [],
      preferredLocations: [],
      lockedTo: null,
      daysOff: [],
      availabilityWindows: {},
      accommodations: [],
      targetHours: 40,
    });
  };

  return (
    <div className="setup-content">
      <div className="section-add" style={{ marginBottom: 16 }}>
        <button className="btn btn-primary" onClick={handleAdd}>
          <Plus size={15} /> Add Person
        </button>
      </div>
      <div className="people-grid">
        {data.people.map(p => (
          <PersonCard
            key={p.id}
            person={p}
            providers={data.providers}
            locations={data.locations}
          />
        ))}
      </div>
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
      provider: data.providers[0] ?? 'Dr. R',
      open: true, startTime: 480, endTime: 1020, patientCount: null,
      slots: { scribe: null, opener: null, closing: null, middle: null, training: null },
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
                <div key={c.id} className="clinic-setup-row">
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
                    onClick={() => setEditId(c.id)}
                  >
                    <Pencil size={14} />
                  </button>
                </div>
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
  const [subTab, setSubTab] = useState('people');

  return (
    <div className="setup-page">
      <div className="setup-subtabs">
        {['people', 'clinics', 'locations'].map(t => (
          <button
            key={t}
            className={`setup-subtab${subTab === t ? ' active' : ''}`}
            onClick={() => setSubTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {subTab === 'people'    && <PeopleTab />}
      {subTab === 'clinics'   && <ClinicsTab />}
      {subTab === 'locations' && <LocationsTab />}
    </div>
  );
}
