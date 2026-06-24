import { useEffect, useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { minutesToTime } from '../data/seed.js';

function TimeInput({ label, value, onChange }) {
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  const display = minutesToTime(value);

  const adjust = (delta) => {
    const next = Math.max(0, Math.min(24 * 60, value + delta));
    onChange(next);
  };

  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button className="btn" style={{ minHeight: 36, padding: '4px 10px' }} onClick={() => adjust(-15)}>−</button>
        <span style={{ fontSize: 14, fontWeight: 500, minWidth: 64, textAlign: 'center' }}>{display}</span>
        <button className="btn" style={{ minHeight: 36, padding: '4px 10px' }} onClick={() => adjust(15)}>+</button>
      </div>
    </div>
  );
}

function Toggle({ on, onChange, label }) {
  return (
    <label className="toggle-row">
      <div className={`toggle-track${on ? ' on' : ''}`} onClick={() => onChange(!on)}>
        <div className="toggle-thumb" />
      </div>
      <span className="toggle-label">{label}</span>
    </label>
  );
}

function patientClass(n) {
  if (n == null || isNaN(n)) return 'neutral';
  return n > 50 ? 'red' : n >= 30 ? 'amber' : 'neutral';
}

export default function ClinicConfig({ clinicId, onClose }) {
  const { data, updateClinic, removeClinic, addLog } = useApp();
  const clinic = data.clinics.find(c => c.id === clinicId);
  const [open, setIsOpen] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!clinic) return;
    setIsOpen(clinic.open);
  }, [clinicId]);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!clinic) return null;

  const set = (field, value) => updateClinic(clinicId, { [field]: value });

  const ptClass = patientClass(clinic.patientCount);

  return (
    <div className="config-panel open">
      <div className="config-panel-header">
        <div>
          <div style={{ fontWeight: 500 }}>{clinic.provider}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{clinic.location} · {clinic.day}</div>
        </div>
        <button className="btn btn-icon" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="config-panel-body">
        <Toggle
          on={clinic.open}
          onChange={(v) => set('open', v)}
          label={clinic.open ? 'Clinic Open' : 'Clinic Closed'}
        />

        <div className="form-group">
          <label className="form-label">Provider</label>
          <input
            className="form-input"
            value={clinic.provider}
            onChange={e => set('provider', e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Location</label>
          <select
            className="form-input"
            value={clinic.location}
            onChange={e => set('location', e.target.value)}
          >
            {data.locations.map(l => <option key={l}>{l}</option>)}
          </select>
        </div>

        <TimeInput
          label="Start Time"
          value={clinic.startTime}
          onChange={(v) => set('startTime', v)}
        />
        <TimeInput
          label="End Time (last scheduled patient)"
          value={clinic.endTime}
          onChange={(v) => set('endTime', v)}
        />
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -8 }}>
          Closing tech stays 1–1.5h after this
        </div>

        <div className="form-group">
          <label className="form-label">Patient Count</label>
          <input
            className="form-input"
            type="number"
            min="0"
            value={clinic.patientCount ?? ''}
            onChange={e => set('patientCount', e.target.value === '' ? null : Number(e.target.value))}
          />
          {clinic.patientCount != null && (
            <div className={`patient-indicator ${ptClass}`} style={{ marginTop: 6 }}>
              <div className={`pt-dot ${ptClass}`} />
              {ptClass === 'neutral' ? 'Light day' : ptClass === 'amber' ? 'Moderate' : 'Busy — consider Middle'}
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: 16, borderTop: '0.5px solid var(--border)', flexShrink: 0 }}>
        {confirmDelete ? (
          <div style={{ background: 'var(--red-bg)', border: '0.5px solid var(--red)', borderRadius: 'var(--radius)', padding: '10px 12px' }}>
            <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 8 }}>
              Delete <strong>{clinic.provider} · {clinic.location}</strong> on <strong>{clinic.day}</strong>?
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-danger"
                style={{ minHeight: 34, fontSize: 13 }}
                onClick={() => {
                  addLog({ action: `${clinic.provider} · ${clinic.location} on ${clinic.day} removed`, personName: '', day: clinic.day, detail: '' });
                  removeClinic(clinic.id);
                  onClose();
                }}
              >
                Yes, delete
              </button>
              <button className="btn" style={{ minHeight: 34, fontSize: 13 }} onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            className="btn btn-danger"
            style={{ width: '100%', minHeight: 38, fontSize: 13 }}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={14} /> Delete clinic
          </button>
        )}
      </div>
    </div>
  );
}
