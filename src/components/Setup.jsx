import { useState } from 'react';
import { Trash2, Plus, Pencil } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { generateId, DAYS, minutesToTime } from '../data/seed.js';
import ClinicConfig from './ClinicConfig.jsx';

const ROLE_OPTIONS = ['Scribe', 'Opener', 'Middle', 'Closing', 'Training'];
const GRADE_OPTIONS = ['A', 'B', 'C'];
const DAY_OPTIONS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const PRESET_COLORS = [
  '#2563eb','#16a34a','#0891b2','#db2777','#9333ea',
  '#ea580c','#65a30d','#0d9488','#c026d3','#0284c7','#7c3aed',
];

function toggleArr(arr, item) {
  return arr.includes(item) ? arr.filter(x => x !== item) : [...arr, item];
}

function PersonCard({ person, providers }) {
  const { updatePerson, deletePerson } = useApp();
  const up = (field, value) => updatePerson(person.id, { [field]: value });

  const confirmDelete = () => {
    if (confirm(`Remove ${person.name} from all schedules?`)) deletePerson(person.id);
  };

  return (
    <div className="person-setup-card">
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

      <div className="form-group">
        <label className="form-label">Grade</label>
        <div className="grade-picker">
          {GRADE_OPTIONS.map(g => (
            <button
              key={g}
              className={`grade-pill ${g}${person.grade === g ? ' active' : ''}`}
              onClick={() => up('grade', person.grade === g ? null : g)}
            >
              {g}
            </button>
          ))}
          <button
            className="grade-pill"
            style={!person.grade ? { background: 'var(--bg-surface)', color: 'var(--text-primary)', borderColor: 'var(--border-strong)' } : {}}
            onClick={() => up('grade', null)}
          >—</button>
        </div>
      </div>

      <div className="form-group">
        <label className="form-label">Roles</label>
        <div className="pill-group">
          {ROLE_OPTIONS.map(r => (
            <button
              key={r}
              className={`pill${person.roles.includes(r) ? ' active' : ''}`}
              onClick={() => up('roles', toggleArr(person.roles, r))}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

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

      <div className="form-group">
        <label className="form-label">Days Off</label>
        <div className="pill-group">
          {DAY_OPTIONS.map(d => (
            <button
              key={d}
              className={`pill small${(person.preferences?.daysOff ?? []).includes(d) ? ' active' : ''}`}
              onClick={() => up('preferences', {
                ...person.preferences,
                daysOff: toggleArr(person.preferences?.daysOff ?? [], d),
              })}
            >
              {d}
            </button>
          ))}
        </div>
      </div>

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

function PeopleTab() {
  const { data, addPerson } = useApp();

  const handleAdd = () => {
    addPerson({
      id: generateId(),
      name: 'New Person',
      color: PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)],
      roles: [],
      locations: [],
      grade: null,
      lockedTo: null,
      preferences: { preferredLocations: [], daysOff: [] },
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
          <PersonCard key={p.id} person={p} providers={data.providers} />
        ))}
      </div>
    </div>
  );
}

function ClinicsTab() {
  const { data, addClinic } = useApp();
  const [editId, setEditId] = useState(null);

  const handleAdd = (day) => {
    const id = generateId();
    addClinic({
      id,
      day,
      week: 'A',
      location: data.locations[0] ?? 'Phoenix',
      provider: data.providers[0] ?? 'Dr. R',
      open: true,
      startTime: 480,
      endTime: 1020,
      patientCount: null,
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
                <button
                  className="btn"
                  style={{ minHeight: 36, fontSize: 13 }}
                  onClick={() => handleAdd(day)}
                >
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
            onClick={() => {
              if (confirm(`Remove location "${loc}"?`)) removeLocation(loc);
            }}
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
