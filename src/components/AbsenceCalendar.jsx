import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ChevronLeft, ChevronRight, X, Clock, Plus, Trash2, AlertCircle, History, Building2, PhoneCall, UserCheck } from 'lucide-react';
import { useApp, mondayOfWeek, isoWeek } from '../context/AppContext.jsx';
import { minutesToTime, minutesToTimeInput, timeInputToMinutes } from '../data/seed.js';
import { getFederalHolidays } from '../utils/federalHolidays.js';
import { CLOSURE_LOCATIONS, buildClosureMap } from '../utils/holidayClosures.js';
import { getOnCallPerson, getOnCallForWeek, getBlockPosition, addWeeks } from '../utils/oncall.js';
import OnCallManager from './OnCallManager.jsx';

// ─── Category definitions ─────────────────────────────────────────────────────

export const ABSENCE_TYPES = [
  { key: 'Callout',   label: 'Last-Minute Callout', short: 'Callout',  color: '#ef4444' },
  { key: 'Approved',  label: 'Approved Time Off',   short: 'Approved', color: '#22c55e' },
  { key: 'Sick',      label: 'Sick',                short: 'Sick',     color: '#3b82f6' },
  // Request/pending is retired — hidden from form/legend but kept for rendering old DB rows
  { key: 'Request',   label: 'Request / Pending',   short: 'Request',  color: '#6b7280', hidden: true },
  // Partial Day is merged into Approved Time Off — hidden from form/legend; old DB rows
  // are remapped to 'Approved' at display time via LEGACY_REMAP below.
  { key: 'Partial',   label: 'Approved Time Off',   short: 'Approved', color: '#22c55e', hidden: true },
  { key: 'DoctorOff', label: 'Doctor Off',          short: 'Dr. Off',  color: '#22b8cf' },
];

// Types available for selection in the add/edit form and shown in the legend
const SELECTABLE_TYPES = ABSENCE_TYPES.filter(t => !t.hidden);

const DOCTORS = ['Dr. R', 'Dr. A', 'Dr. S', 'Dr. B'];

const TYPE_MAP = new Map(ABSENCE_TYPES.map(t => [t.key, t]));

// Maps retired type keys → their active canonical replacement (display + filter only;
// the DB value is not migrated — existing 'Partial' rows render as 'Approved Time Off').
const LEGACY_REMAP = { Partial: 'Approved' };

const colorOf = (key) => TYPE_MAP.get(LEGACY_REMAP[key] ?? key)?.color ?? '#6b7280';
const labelOf = (key) => TYPE_MAP.get(LEGACY_REMAP[key] ?? key)?.label ?? key;
const shortOf = (key) => TYPE_MAP.get(LEGACY_REMAP[key] ?? key)?.short ?? key;

// Canonical type key for filtering — remaps retired keys to their active replacement
const canonicalType = (key) => LEGACY_REMAP[key] ?? key;

// Holidays / office-closed are shown in neutral slate
const CLOSED_COLOR = '#64748b';

// ONCALL_COLOR is the SINGLE SOURCE of amber shared by:
//   • the Tech On Call legend dot and on-call chips in this file
//   • the staff-card .pill-oncall-active in index.css (color/border: #f59e0b)
// Do not hardcode a second amber — keep index.css in sync with this value.
const ONCALL_COLOR = '#f59e0b';

// Research assignments shown in purple (freed by Partial Day merge)
const RESEARCH_COLOR = '#8b5cf6';

// ─── Date helpers ─────────────────────────────────────────────────────────────

function toDateStr(d) { return d.toISOString().slice(0, 10); }
function parseUTC(str) { return new Date(str + 'T00:00:00Z'); }
function dayAfter(dateStr) { const d = parseUTC(dateStr); d.setUTCDate(d.getUTCDate() + 1); return toDateStr(d); }

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function formatDateDisplay(str) {
  const d = parseUTC(str);
  return `${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}`;
}
function formatRange(start, end) {
  if (!start) return '';
  if (start === end) return formatDateDisplay(start);
  const s = parseUTC(start), e = parseUTC(end);
  if (s.getUTCFullYear() === e.getUTCFullYear()) {
    if (s.getUTCMonth() === e.getUTCMonth())
      return `${formatDateDisplay(start)}–${e.getUTCDate()}`;
    return `${formatDateDisplay(start)} – ${formatDateDisplay(end)}`;
  }
  return `${formatDateDisplay(start)} – ${formatDateDisplay(end)}, ${e.getUTCFullYear()}`;
}

// ISO week from a UTC midnight Date (avoids local-timezone getFullYear/Month/Date pitfalls)
function isoWeekUTC(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const w = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(w).padStart(2, '0')}`;
}

// Build 6-row × 7-col grid (Sun→Sat)
function buildGrid(year, month) {
  const firstDay = new Date(Date.UTC(year, month, 1));
  const dow = firstDay.getUTCDay();
  const cur = new Date(firstDay);
  cur.setUTCDate(1 - dow);
  const grid = [];
  for (let r = 0; r < 6; r++) {
    const week = [];
    for (let c = 0; c < 7; c++) {
      week.push(new Date(cur));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    grid.push(week);
  }
  return grid;
}

// ─── Legend (filter chips) ────────────────────────────────────────────────────

function Legend({ activeCategories, onToggle, researchTableReady }) {
  return (
    <div className="absence-legend">
      {SELECTABLE_TYPES.map(t => {
        const active = activeCategories.has(t.key);
        return (
          <button
            key={t.key}
            className={`absence-legend-item${active ? '' : ' absence-legend-item--off'}`}
            onClick={() => onToggle(t.key)}
            title={active ? `Hide ${t.label}` : `Show ${t.label}`}
          >
            <span className="absence-legend-dot" style={{ background: t.color }} />
            <span>{t.label}</span>
          </button>
        );
      })}
      {/* Closed / Holiday chip */}
      <button
        className={`absence-legend-item${activeCategories.has('Closed') ? '' : ' absence-legend-item--off'}`}
        onClick={() => onToggle('Closed')}
        title={activeCategories.has('Closed') ? 'Hide Holidays & Closures' : 'Show Holidays & Closures'}
      >
        <span className="absence-legend-dot" style={{ background: CLOSED_COLOR }} />
        <span>Closed / Holiday</span>
      </button>
      {/* Research chip */}
      {researchTableReady !== false && (
        <button
          className={`absence-legend-item${activeCategories.has('Research') ? '' : ' absence-legend-item--off'}`}
          onClick={() => onToggle('Research')}
          title={activeCategories.has('Research') ? 'Hide Research Assignments' : 'Show Research Assignments'}
        >
          <span className="absence-legend-dot" style={{ background: RESEARCH_COLOR }} />
          <span>Research</span>
        </button>
      )}
    </div>
  );
}

// ─── Closure modal ────────────────────────────────────────────────────────────

// Saves one calendar_overrides row per day in range (existing schema has one date per row).
// Same label + locations across days — grouping for display happens at read time.
function ClinicClosedModal({ initStart, initEnd, managerInitials, onSave, onClose }) {
  const [startD, setStartD] = useState(initStart ?? '');
  const [endD,   setEndD]   = useState(initEnd   ?? '');
  const [selectedLocs, setSelectedLocs] = useState([...CLOSURE_LOCATIONS]); // default: all
  const [label,   setLabel]   = useState('');
  const [saving,  setSaving]  = useState(false);

  const allSelected = selectedLocs.length === CLOSURE_LOCATIONS.length;

  const toggleLoc = (loc) => {
    setSelectedLocs(prev =>
      prev.includes(loc) ? prev.filter(l => l !== loc) : [...prev, loc]
    );
  };
  const toggleAll = () => {
    setSelectedLocs(allSelected ? [] : [...CLOSURE_LOCATIONS]);
  };

  const canSave = startD && endD && endD >= startD && selectedLocs.length > 0 && label.trim();

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    // null = all locations (schema convention: null means every location is closed)
    const locations = allSelected ? null : selectedLocs;
    const entered_by = managerInitials ?? null;
    const labelStr = label.trim();
    // Write one row per calendar day in the range
    let d = parseUTC(startD);
    const endDate = parseUTC(endD);
    const payloads = [];
    while (d <= endDate) {
      payloads.push({ date: toDateStr(d), kind: 'office_closed', label: labelStr, locations, entered_by });
      d = new Date(d);
      d.setUTCDate(d.getUTCDate() + 1);
    }
    await onSave(payloads);
    setSaving(false);
  };

  return (
    <div className="overlay-backdrop" style={{ zIndex: 320 }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="overlay-modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="overlay-header">
          <span style={{ fontWeight: 600, fontSize: 15 }}>Clinic Closed</span>
          <button className="overlay-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="overlay-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Locations — first field, most important */}
          <div>
            <label className="setup-label">Locations</label>
            <div className="pill-group" style={{ marginTop: 4 }}>
              <button
                className={`pill small${allSelected ? ' active' : ''}`}
                onClick={toggleAll}
              >
                All Locations
              </button>
              {CLOSURE_LOCATIONS.map(loc => (
                <button
                  key={loc}
                  className={`pill small${selectedLocs.includes(loc) ? ' active' : ''}`}
                  onClick={() => toggleLoc(loc)}
                >
                  {loc}
                </button>
              ))}
            </div>
          </div>
          {/* Dates */}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label className="setup-label">Start Date</label>
              <input
                type="date" className="setup-input" value={startD}
                onChange={e => { setStartD(e.target.value); if (e.target.value > endD) setEndD(e.target.value); }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label className="setup-label">End Date</label>
              <input
                type="date" className="setup-input" value={endD} min={startD}
                onChange={e => setEndD(e.target.value)}
              />
            </div>
          </div>
          {/* Label */}
          <div>
            <label className="setup-label">Reason / Label</label>
            <input
              className="setup-input"
              autoFocus
              value={label}
              onChange={e => setLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && canSave) handleSave(); }}
              placeholder="E.g. Staff Training"
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 24px', borderTop: '0.5px solid var(--border)', flexShrink: 0 }}>
          <button className="btn btn-pill" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-pill" onClick={handleSave} disabled={!canSave || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Person typeahead ─────────────────────────────────────────────────────────

function PersonTypeahead({ value, onChange, roster, placeholder }) {
  // value = personKey string (empty string when unset)
  // roster = [{ label: string, key: string, color: string|null }]
  // color: roster staff use their board card color; doctors/others pass null → neutral dot
  const [query, setQuery]           = useState('');
  const [open, setOpen]             = useState(false);
  const [highlightIdx, setHighlight] = useState(-1);
  const inputRef = useRef(null);
  const listRef  = useRef(null);

  const selected = roster.find(r => r.key === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return roster;
    return roster.filter(r => r.label.toLowerCase().includes(q));
  }, [query, roster]);

  // Reset highlight when filtered list changes
  useEffect(() => { setHighlight(-1); }, [filtered]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIdx >= 0 && listRef.current) {
      const el = listRef.current.children[highlightIdx];
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIdx]);

  const select = (item) => {
    onChange(item.key);
    setQuery('');
    setOpen(false);
    setHighlight(-1);
  };

  const clear = () => {
    onChange('');
    setQuery('');
    setHighlight(-1);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleKeyDown = (e) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
      return;
    }
    if (e.key === 'Escape') { setOpen(false); setHighlight(-1); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(i => Math.min(i + 1, filtered.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(i => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightIdx >= 0 && filtered[highlightIdx]) select(filtered[highlightIdx]);
      else if (filtered.length === 1) select(filtered[0]);
      return;
    }
  };

  if (selected) {
    return (
      <div className="typeahead-chip">
        <span className="typeahead-chip-dot" style={{ background: selected.color ?? '#94a3b8' }} />
        <span className="typeahead-chip-label">{selected.label}</span>
        <button type="button" className="typeahead-chip-clear" onClick={clear} aria-label="Clear selection">
          <X size={12} />
        </button>
      </div>
    );
  }

  return (
    <div className="typeahead-wrap">
      <input
        ref={inputRef}
        className="setup-input typeahead-input"
        value={query}
        placeholder={placeholder ?? 'Search…'}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={handleKeyDown}
      />
      {open && filtered.length > 0 && (
        <ul className="typeahead-dropdown" ref={listRef} onMouseDown={e => e.preventDefault()}>
          {filtered.map((item, i) => (
            <li
              key={item.key}
              className={`typeahead-option${i === highlightIdx ? ' typeahead-option--hi' : ''}`}
              onMouseEnter={() => setHighlight(i)}
              onMouseDown={() => select(item)}
            >
              <span className="typeahead-option-dot" style={{ background: item.color ?? '#94a3b8' }} />
              {item.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Absence modal ────────────────────────────────────────────────────────────

function AbsenceModal({ mode, initStart, initEnd, initType, absence, people, absences, doctors, managerInitials, onSave, onDelete, onClose }) {
  const isEdit = mode === 'edit';
  const [personKey, setPersonKey] = useState(absence?.person_name ?? '');
  // If editing an absence with a retired/legacy type, remap to its canonical replacement.
  // 'Partial' → 'Approved'; unknown types fall back to '' so user must pick a current type.
  // initType allows callers (e.g. DayPanel Doctor Off shortcut) to pre-select a type.
  const [type,      setType]      = useState(() => {
    const raw = absence?.type ?? initType ?? 'Approved';
    const t   = LEGACY_REMAP[raw] ?? raw;
    return SELECTABLE_TYPES.some(s => s.key === t) ? t : '';
  });
  const [startD,    setStartD]    = useState(absence?.start_date ?? initStart ?? '');
  const [endD,      setEndD]      = useState(absence?.end_date   ?? initEnd   ?? '');
  // Partial time fields are optional for Approved Time Off; blank = full day off.
  const [pStart,    setPStart]    = useState(absence?.partial_start ?? '');
  const [pEnd,      setPEnd]      = useState(absence?.partial_end   ?? '');
  const [note,      setNote]      = useState(absence?.note ?? '');
  const [saving,    setSaving]    = useState(false);
  const [deleting,  setDeleting]  = useState(false);
  const [dupWarning, setDupWarning] = useState(null);
  const [saveError,   setSaveError]   = useState(null);
  const [deleteError, setDeleteError] = useState(null);

  const handleTypeSelect = (newType) => {
    if ((type === 'DoctorOff') !== (newType === 'DoctorOff')) setPersonKey('');
    setType(newType);
  };

  const checkDup = useCallback(() => {
    if (!personKey || !startD || !endD) return null;
    return absences.find(a => {
      if (isEdit && a.id === absence?.id) return false;
      return a.person_name === personKey && a.end_date >= startD && a.start_date <= endD;
    }) ?? null;
  }, [personKey, startD, endD, absences, isEdit, absence]);

  const handleSubmit = async (force = false) => {
    if (!personKey || !startD || !endD) return;
    if (!force) {
      const dup = checkDup();
      if (dup) { setDupWarning(dup); return; }
    }
    setSaving(true);
    setSaveError(null);
    const payload = {
      person_name:   personKey,
      start_date:    startD,
      end_date:      endD,
      type,
      // Store partial times only when Approved and times are actually filled in
      partial_start: type === 'Approved' && pStart ? pStart : null,
      partial_end:   type === 'Approved' && pEnd   ? pEnd   : null,
      note:          note.trim() || null,
      entered_by:    managerInitials,
    };
    const result = isEdit ? await onSave(absence.id, payload) : await onSave(payload);
    if (result?.error) setSaveError('Save failed — check your connection and try again.');
    setSaving(false);
  };

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    const result = await onDelete(absence.id);
    if (result?.error) setDeleteError('Delete failed — check your connection.');
    setDeleting(false);
  };

  const person = people.find(p => p.name.trim().toLowerCase() === personKey);
  const canSubmit = personKey && startD && endD && startD <= endD && SELECTABLE_TYPES.some(s => s.key === type);

  return (
    <div className="overlay-backdrop" style={{ zIndex: 310 }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="overlay-modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="overlay-header">
          <span style={{ fontWeight: 600, fontSize: 15 }}>{isEdit ? 'Edit Absence' : 'Add Absence'}</span>
          <button className="overlay-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="overlay-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Person / Doctor picker */}
          <div>
            <label className="setup-label">{type === 'DoctorOff' ? 'Doctor' : 'Person'}</label>
            {type === 'DoctorOff' ? (
              <PersonTypeahead
                value={personKey}
                onChange={setPersonKey}
                roster={(doctors ?? DOCTORS).map(d => ({ key: d, label: d, color: null }))}
                placeholder="Search Doctors…"
              />
            ) : (
              <PersonTypeahead
                value={personKey}
                onChange={setPersonKey}
                roster={[...people]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map(p => ({ key: p.name.trim().toLowerCase(), label: p.name, color: p.color ?? null }))}
                placeholder="Search Staff…"
              />
            )}
          </div>

          {/* Category */}
          <div>
            <label className="setup-label">Category</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {SELECTABLE_TYPES.map(t => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => handleTypeSelect(t.key)}
                  className="absence-type-btn"
                  style={{
                    '--type-color': t.color,
                    background:     type === t.key ? t.color : undefined,
                    borderColor:    type === t.key ? t.color : undefined,
                    color:          type === t.key ? '#fff'  : undefined,
                  }}
                >
                  <span className="absence-type-swatch" style={{ background: t.color, opacity: type === t.key ? 0 : 1 }} />
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Dates */}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label className="setup-label">Start Date</label>
              <input type="date" className="setup-input" value={startD}
                onChange={e => { setStartD(e.target.value); if (e.target.value > endD) setEndD(e.target.value); }} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="setup-label">End Date</label>
              <input type="date" className="setup-input" value={endD} min={startD}
                onChange={e => setEndD(e.target.value)} />
            </div>
          </div>

          {/* Partial-time adjustment — optional fields for Approved Time Off */}
          {type === 'Approved' && (
            <div>
              <label className="setup-label">
                Time Adjustment{' '}
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional — blank = full day off)</span>
              </label>
              <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
                <div style={{ flex: 1 }}>
                  <label className="setup-label" style={{ fontSize: 11 }}>Start</label>
                  <input type="time" className="setup-input" value={pStart} onChange={e => setPStart(e.target.value)} />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="setup-label" style={{ fontSize: 11 }}>End</label>
                  <input type="time" className="setup-input" value={pEnd} onChange={e => setPEnd(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {/* Note */}
          <div>
            <label className="setup-label">Note <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
            <input className="setup-input" value={note} onChange={e => setNote(e.target.value)} placeholder="E.g. FMLA, Pre-Approved…" />
          </div>

          {/* Duplicate warning */}
          {dupWarning && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', background: 'rgba(245,158,11,0.1)', borderRadius: 8, border: '0.5px solid rgba(245,158,11,0.4)' }}>
              <AlertCircle size={14} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                <strong>{person?.name ?? dupWarning.person_name}</strong> already has <em>{labelOf(dupWarning.type)}</em>{' '}
                ({formatRange(dupWarning.start_date, dupWarning.end_date)}) overlapping these dates.
                <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary btn-pill" style={{ fontSize: 11, minHeight: 26 }}
                    onClick={() => handleSubmit(true)} disabled={saving}>
                    {saving ? 'Adding…' : 'Add Anyway'}
                  </button>
                  <button className="btn btn-pill" style={{ fontSize: 11, minHeight: 26 }}
                    onClick={() => setDupWarning(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Save / delete error banners — shown inline so the manager sees them with the form */}
          {saveError && (
            <div className="absence-modal-error">
              <AlertCircle size={13} style={{ flexShrink: 0 }} />
              <span>{saveError}</span>
            </div>
          )}
          {deleteError && (
            <div className="absence-modal-error">
              <AlertCircle size={13} style={{ flexShrink: 0 }} />
              <span>{deleteError}</span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', padding: '12px 24px', borderTop: '0.5px solid var(--border)', flexShrink: 0 }}>
          <div>
            {isEdit && (
              <button className="btn btn-pill" style={{ fontSize: 12, color: '#dc2626', borderColor: '#dc2626' }}
                onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : <><Trash2 size={13} /> Delete</>}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-pill" onClick={onClose}>Cancel</button>
            {!dupWarning && (
              <button className="btn btn-primary btn-pill" onClick={() => handleSubmit(false)} disabled={!canSubmit || saving}>
                {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Absence'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Research Modal ────────────────────────────────────────────────────────────

function ResearchModal({ mode, initDate, assignment, people, managerInitials, onSave, onDelete, onClose }) {
  const isEdit = mode === 'edit';
  const [personKey, setPersonKey]   = useState(assignment?.person_name ?? '');
  const [startD,    setStartD]      = useState(assignment?.date ?? initDate ?? '');
  const [endD,      setEndD]        = useState(assignment?.date ?? initDate ?? '');
  const [startTime, setStartTime]   = useState(
    assignment?.start_min != null ? minutesToTimeInput(assignment.start_min) : ''
  );
  const [endTime,   setEndTime]     = useState(
    assignment?.end_min != null ? minutesToTimeInput(assignment.end_min) : ''
  );
  const [note,      setNote]        = useState(assignment?.note ?? '');
  const [saving,    setSaving]      = useState(false);
  const [deleting,  setDeleting]    = useState(false);

  const canSave = personKey && startD && endD && startD <= endD;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    const start_min = startTime ? timeInputToMinutes(startTime) : null;
    const end_min   = endTime   ? timeInputToMinutes(endTime)   : null;
    const noteVal   = note.trim() || null;
    if (isEdit) {
      await onSave(assignment.id, {
        person_name: personKey,
        date:        startD,
        start_min,
        end_min,
        note:        noteVal,
      });
    } else {
      // Insert one row per calendar day in the range
      let d = parseUTC(startD);
      const endDate = parseUTC(endD);
      while (d <= endDate) {
        await onSave({
          person_name: personKey,
          date:        toDateStr(d),
          start_min,
          end_min,
          note:        noteVal,
          entered_by:  managerInitials ?? null,
        });
        d = new Date(d);
        d.setUTCDate(d.getUTCDate() + 1);
      }
    }
    setSaving(false);
    onClose();
  };

  const handleDelete = async () => {
    setDeleting(true);
    await onDelete(assignment.id);
    setDeleting(false);
    onClose();
  };

  return (
    <div className="overlay-backdrop" style={{ zIndex: 310 }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="overlay-modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="overlay-header">
          <span style={{ fontWeight: 600, fontSize: 15 }}>{isEdit ? 'Edit Research' : 'Add Research'}</span>
          <button className="overlay-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="overlay-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Person */}
          <div>
            <label className="setup-label">Person</label>
            <PersonTypeahead
              value={personKey}
              onChange={setPersonKey}
              roster={[...people]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(p => ({ key: p.name.trim().toLowerCase(), label: p.name, color: p.color ?? null }))}
              placeholder="Search Staff…"
            />
          </div>

          {/* Dates */}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label className="setup-label">{isEdit ? 'Date' : 'Start Date'}</label>
              <input type="date" className="setup-input" value={startD}
                onChange={e => { setStartD(e.target.value); if (!isEdit && e.target.value > endD) setEndD(e.target.value); }} />
            </div>
            {!isEdit && (
              <div style={{ flex: 1 }}>
                <label className="setup-label">End Date</label>
                <input type="date" className="setup-input" value={endD} min={startD}
                  onChange={e => setEndD(e.target.value)} />
              </div>
            )}
          </div>

          {/* Time window (optional) */}
          <div>
            <label className="setup-label">
              Time Window{' '}
              <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional — blank = all day)</span>
            </label>
            <div style={{ display: 'flex', gap: 12, marginTop: 6 }}>
              <div style={{ flex: 1 }}>
                <label className="setup-label" style={{ fontSize: 11 }}>Start</label>
                <input type="time" className="setup-input" value={startTime} onChange={e => setStartTime(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="setup-label" style={{ fontSize: 11 }}>End</label>
                <input type="time" className="setup-input" value={endTime} onChange={e => setEndTime(e.target.value)} />
              </div>
            </div>
          </div>

          {/* Note */}
          <div>
            <label className="setup-label">Note <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
            <input className="setup-input" value={note} onChange={e => setNote(e.target.value)} placeholder="E.g. IRB Study, Chart Review…" />
          </div>

        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', padding: '12px 24px', borderTop: '0.5px solid var(--border)', flexShrink: 0 }}>
          <div>
            {isEdit && (
              <button className="btn btn-pill" style={{ fontSize: 12, color: '#dc2626', borderColor: '#dc2626' }}
                onClick={handleDelete} disabled={deleting}>
                {deleting ? 'Deleting…' : <><Trash2 size={13} /> Delete</>}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-pill" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary btn-pill" onClick={handleSave} disabled={!canSave || saving}>
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Add Research'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Week row with spanning bars ──────────────────────────────────────────────

function WeekRow({ week, viewMonth, absences, closures, personByKey, todayStr, onDayClick, onDayDoubleClick, onAbsenceClick, activeCategories, currentWeekDates, dayPanelDate, oncallSettings, oncallOverrides, people, isAdmin, onOncallChipClick, eligiblePool, dragRange, onCellMouseDown, onCellMouseEnter, suppressClickRef, researchAssignments, onResearchClick, showOncallPanel }) {
  const weekStart = toDateStr(week[0]);
  const weekEnd   = toDateStr(week[6]);
  const clickTimerRef = useRef(null);

  // On-call: use Monday (index 1 in Sun–Sat row) to determine ISO week
  const rowMonday = week[1];
  const rowWeekStr = rowMonday ? isoWeekUTC(rowMonday) : null;
  // On-call: only compute when the On Call panel is open
  const onCallResult = (showOncallPanel && oncallSettings && rowWeekStr)
    ? getOnCallForWeek(rowWeekStr, oncallSettings, oncallOverrides ?? [])
    : null;
  // Block-start detection: show a tag only when the on-call person changes from the previous week.
  // This fires at every 4-week block boundary AND whenever an override changes who holds a week.
  const prevWeekStr = rowWeekStr ? addWeeks(rowWeekStr, -1) : null;
  const prevOnCallResult = (showOncallPanel && oncallSettings && prevWeekStr)
    ? getOnCallForWeek(prevWeekStr, oncallSettings, oncallOverrides ?? [])
    : null;
  const isBlockStart = !!(showOncallPanel && onCallResult &&
    onCallResult.person !== prevOnCallResult?.person);
  const onCallNameKey = isBlockStart ? onCallResult?.person?.trim()?.toLowerCase() : null;
  const personColor = onCallNameKey
    ? (people ?? []).find(p => p.name.trim().toLowerCase() === onCallNameKey)?.color ?? ONCALL_COLOR
    : ONCALL_COLOR;
  const hasAbsenceConflict = isBlockStart && onCallNameKey
    ? absences.some(a => a.person_name === onCallNameKey && a.start_date <= weekEnd && a.end_date >= weekStart)
    : false;

  // Highlight if any day of this calendar row falls in the board's current week
  const isCurrentWeek = week.some(d => currentWeekDates.has(toDateStr(d)));

  const weekAbsences = absences
    .filter(a => a.end_date >= weekStart && a.start_date <= weekEnd && activeCategories.has(canonicalType(a.type)))
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.person_name.localeCompare(b.person_name));

  // Closure bars — filter spans that overlap this week (startDate/endDate)
  const weekClosures = activeCategories.has('Closed')
    ? closures.filter(c => c.endDate >= weekStart && c.startDate <= weekEnd)
    : [];

  // Research bars for this week
  const weekResearch = (activeCategories.has('Research') && researchAssignments?.length)
    ? researchAssignments.filter(ra => ra.date >= weekStart && ra.date <= weekEnd)
    : [];

  // Single click on cell → jump to that week directly
  const handleCellInteraction = (ds, e) => {
    if (suppressClickRef?.current) { suppressClickRef.current = false; return; }
    onDayDoubleClick(ds);
  };

  // + button click → open day panel (admin only)
  const handleAddBtnClick = (ds, e) => {
    e.stopPropagation();
    if (suppressClickRef?.current) { suppressClickRef.current = false; return; }
    const rect = e.currentTarget.closest('.absence-day-cell').getBoundingClientRect();
    onDayClick(ds, rect);
  };

  const allBars = weekClosures.length + weekAbsences.length + weekResearch.length;

  return (
    <div className={`absence-week-row${isCurrentWeek ? ' absence-week-row--current-week' : ''}`}>
      {week.map((day, col) => {
        const ds = toDateStr(day);
        const isThisMonth = day.getUTCMonth() === viewMonth;
        const isToday = ds === todayStr;
        const isPanelDay = ds === dayPanelDate;
        const isInDragRange = dragRange && ds >= dragRange.start && ds <= dragRange.end;
        return (
          <div
            key={col}
            className={`absence-day-cell${isPanelDay ? ' absence-day-cell--selected' : ''}${isInDragRange ? ' absence-day-cell--drag' : ''}`}
            onClick={(e) => handleCellInteraction(ds, e)}
            onMouseDown={isAdmin ? (e) => { if (e.button === 0) onCellMouseDown?.(ds, e); } : undefined}
            onMouseEnter={isAdmin ? () => onCellMouseEnter?.(ds) : undefined}
          >
            <span className={`absence-day-num${isToday ? ' absence-day-num--today' : ''}${!isThisMonth ? ' absence-day-num--other' : ''}`}>
              {day.getUTCDate()}
            </span>
            {isAdmin && (
              <button
                className="absence-day-add-btn"
                onClick={(e) => handleAddBtnClick(ds, e)}
                title="Add Absence Or Closure"
              >
                +
              </button>
            )}
          </div>
        );
      })}

      {allBars > 0 && (
        <div className="absence-bars-layer" style={{ pointerEvents: 'none' }}>
          {/* Closure bars first (holidays + office-closed); may span multiple days */}
          {weekClosures.map((closure, laneIdx) => {
            const barStart = closure.startDate < weekStart ? weekStart : closure.startDate;
            const barEnd   = closure.endDate   > weekEnd   ? weekEnd   : closure.endDate;
            const startCol = week.findIndex(d => toDateStr(d) === barStart);
            const endCol   = week.findIndex(d => toDateStr(d) === barEnd);
            if (startCol < 0 || endCol < 0) return null;
            const isSStart = closure.startDate >= weekStart;
            const isSEnd   = closure.endDate   <= weekEnd;
            const locSuffix = closure.locations ? ` – ${closure.locations.join(', ')}` : '';
            const barLabel  = `${closure.label}${locSuffix}`;
            return (
              <div
                key={`c-${closure.startDate}-${closure.kind}-${laneIdx}`}
                className="absence-bar closure-bar"
                style={{
                  left:         `calc(${startCol} / 7 * 100% + 2px)`,
                  width:        `calc(${endCol - startCol + 1} / 7 * 100% - 4px)`,
                  top:          `${30 + laneIdx * 22}px`,
                  background:   CLOSED_COLOR,
                  borderRadius: `${isSStart ? 3 : 0}px ${isSEnd ? 3 : 0}px ${isSEnd ? 3 : 0}px ${isSStart ? 3 : 0}px`,
                  pointerEvents: 'none',
                }}
                title={barLabel}
              >
                <span className="absence-bar-label">{barLabel}</span>
                {closure.kind === 'office_closed' && <Building2 size={9} style={{ flexShrink: 0, marginLeft: 3, opacity: 0.9 }} />}
              </div>
            );
          })}

          {/* Absence bars after closure bars */}
          {weekAbsences.map((absence, idx) => {
            const laneIdx = weekClosures.length + idx;
            const barStart = absence.start_date < weekStart ? weekStart : absence.start_date;
            const barEnd   = absence.end_date   > weekEnd   ? weekEnd   : absence.end_date;
            const startCol = week.findIndex(d => toDateStr(d) === barStart);
            const endCol   = week.findIndex(d => toDateStr(d) === barEnd);
            if (startCol < 0 || endCol < 0) return null;

            const person   = personByKey.get(absence.person_name);
            const color    = colorOf(absence.type);
            const label    = `${person?.name ?? absence.person_name} · ${shortOf(absence.type)}`;
            const isStart  = absence.start_date >= weekStart;
            const isEnd    = absence.end_date   <= weekEnd;

            return (
              <div
                key={absence.id}
                className="absence-bar"
                style={{
                  left:       `calc(${startCol} / 7 * 100% + 2px)`,
                  width:      `calc(${endCol - startCol + 1} / 7 * 100% - 4px)`,
                  top:        `${30 + laneIdx * 22}px`,
                  background: color,
                  borderRadius: `${isStart ? 3 : 0}px ${isEnd ? 3 : 0}px ${isEnd ? 3 : 0}px ${isStart ? 3 : 0}px`,
                  pointerEvents: 'auto',
                }}
                onClick={e => { e.stopPropagation(); onAbsenceClick(absence); }}
                title={label}
              >
                <span className="absence-bar-label">{label}</span>
                {absence.partial_start && <Clock size={9} style={{ flexShrink: 0, marginLeft: 3, opacity: 0.9 }} />}
              </div>
            );
          })}

          {/* Research bars */}
          {weekResearch.map((ra, idx) => {
            const laneIdx = weekClosures.length + weekAbsences.length + idx;
            const startCol = week.findIndex(d => toDateStr(d) === ra.date);
            if (startCol < 0) return null;
            const person = personByKey.get((ra.person_name ?? '').trim().toLowerCase());
            const displayName = person?.name ?? ra.person_name;
            const timeStr = ra.start_min != null
              ? ` · ${minutesToTime(ra.start_min)}–${minutesToTime(ra.end_min ?? ra.start_min)}`
              : '';
            const label = `${displayName} · Research${timeStr}`;
            return (
              <div
                key={`research-${ra.id}`}
                className="absence-bar"
                style={{
                  left:        `calc(${startCol} / 7 * 100% + 2px)`,
                  width:       `calc(1 / 7 * 100% - 4px)`,
                  top:         `${30 + laneIdx * 22}px`,
                  background:  RESEARCH_COLOR,
                  borderRadius: 3,
                  pointerEvents: 'auto',
                  cursor: onResearchClick ? 'pointer' : 'default',
                }}
                onClick={e => { e.stopPropagation(); onResearchClick?.(ra); }}
                title={label}
              >
                <span className="absence-bar-label">{label}</span>
              </div>
            );
          })}
        </div>
      )}
      {/* On-call block-start tag — shown only when On Call panel is open, once per block */}
      {isBlockStart && rowWeekStr && onCallResult && (
        <div
          className={`absence-oncall-chip${onCallResult.isOverride ? ' absence-oncall-chip--override' : ''}`}
          title={`On call: ${onCallResult.person}${onCallResult.isOverride ? ' (override)' : ''}${hasAbsenceConflict ? ' · Has absence this week' : ''}`}
          onClick={isAdmin ? (e) => { e.stopPropagation(); onOncallChipClick(rowWeekStr, e.currentTarget.getBoundingClientRect()); } : undefined}
          style={isAdmin ? { cursor: 'pointer' } : undefined}
        >
          <span className="absence-oncall-chip-dot" style={{ background: personColor }} />
          <span className="absence-oncall-chip-name">{onCallResult.person}</span>
          {onCallResult.isOverride && <UserCheck size={8} style={{ flexShrink: 0, opacity: 0.8 }} />}
          {hasAbsenceConflict && <AlertCircle size={8} style={{ flexShrink: 0, color: '#ef4444' }} />}
        </div>
      )}
    </div>
  );
}

// ─── Upcoming panel ───────────────────────────────────────────────────────────

function UpcomingPanel({ absences, closures, personByKey, todayStr, onAbsenceClick, activeCategories, oncallSettings, oncallOverrides, people, researchAssignments, onResearchClick, showOncallPanel }) {
  const cutoff = (() => { const d = parseUTC(todayStr); d.setUTCDate(d.getUTCDate() + 30); return toDateStr(d); })();

  const upcomingAbsences = absences
    .filter(a => a.end_date >= todayStr && a.start_date <= cutoff && activeCategories.has(canonicalType(a.type)))
    .map(a => ({
      key: `a-${a.id}`,
      date: a.start_date,
      color: colorOf(a.type),
      title: personByKey.get(a.person_name)?.name ?? a.person_name,
      detail: `${labelOf(a.type)} · ${formatRange(a.start_date, a.end_date)}`,
      note: a.partial_start ? `${a.partial_start}–${a.partial_end}` : (a.note ?? null),
      onClick: () => onAbsenceClick(a),
    }));

  const upcomingClosures = activeCategories.has('Closed')
    ? closures
        .filter(c => c.endDate >= todayStr && c.startDate <= cutoff)
        .map(c => {
          const locStr = c.locations ? c.locations.join(', ') + ' closed' : 'All locations closed';
          const dateRange = c.startDate === c.endDate
            ? formatDateDisplay(c.startDate)
            : formatRange(c.startDate, c.endDate);
          return {
            key: `c-${c.startDate}-${c.endDate}-${c.kind}`,
            date: c.startDate,
            color: CLOSED_COLOR,
            title: c.kind === 'holiday' ? c.label : locStr,
            detail: c.kind === 'holiday'
              ? dateRange
              : `${dateRange}${c.label ? ` — ${c.label}` : ''}`,
            note: null,
            onClick: null,
          };
        })
    : [];

  // On-call entries: one per week that falls within the next 30 days
  const upcomingOncall = [];
  if (showOncallPanel && oncallSettings?.rotation?.length > 0 && oncallSettings?.anchorWeek) {
    const todayDate = parseUTC(todayStr);
    const cutoffDate = parseUTC(cutoff);
    // Start from Monday of today's week
    let weekMon = mondayOfWeek(isoWeekUTC(todayDate));
    while (weekMon <= cutoffDate) {
      const monStr = toDateStr(weekMon);
      if (monStr <= cutoff) {
        const wk = isoWeekUTC(weekMon);
        const result = getOnCallForWeek(wk, oncallSettings, oncallOverrides ?? []);
        if (result) {
          const pColor = (people ?? []).find(p => p.name.trim().toLowerCase() === result.person.trim().toLowerCase())?.color ?? ONCALL_COLOR;
          upcomingOncall.push({
            key: `oncall-${wk}`,
            date: monStr,
            color: pColor,
            title: result.person,
            detail: `Tech On Call · ${wk.replace('-W', ' W')}${result.isOverride ? ' (override)' : ''}`,
            note: null,
            onClick: null,
          });
        }
      }
      const next = new Date(weekMon);
      next.setUTCDate(next.getUTCDate() + 7);
      weekMon = next;
    }
  }

  // Research upcoming entries
  const upcomingResearch = (activeCategories.has('Research') && researchAssignments?.length)
    ? researchAssignments
        .filter(ra => ra.date >= todayStr && ra.date <= cutoff)
        .map(ra => {
          const person = personByKey.get((ra.person_name ?? '').trim().toLowerCase());
          const timeNote = ra.start_min != null
            ? `${minutesToTime(ra.start_min)} – ${minutesToTime(ra.end_min ?? ra.start_min)}`
            : null;
          return {
            key: `research-${ra.id}`,
            date: ra.date,
            color: RESEARCH_COLOR,
            title: person?.name ?? ra.person_name,
            detail: `Research · ${formatDateDisplay(ra.date)}`,
            note: timeNote ?? ra.note ?? null,
            onClick: onResearchClick ? () => onResearchClick(ra) : null,
          };
        })
    : [];

  const upcoming = [...upcomingAbsences, ...upcomingClosures, ...upcomingOncall, ...upcomingResearch]
    .sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="absence-upcoming-section">
      <div className="absence-upcoming-title">Upcoming 30 days</div>
      <div className="absence-upcoming-list">
        {upcoming.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '16px 0', textAlign: 'center' }}>No upcoming absences or closures</div>
        )}
        {upcoming.map(item => (
          <div
            key={item.key}
            className={`absence-upcoming-item${item.onClick ? '' : ' absence-upcoming-item--static'}`}
            onClick={item.onClick ?? undefined}
            style={item.onClick ? undefined : { cursor: 'default' }}
          >
            <div className="absence-upcoming-dot" style={{ background: item.color }} />
            <div className="absence-upcoming-info">
              <div className="absence-upcoming-name">{item.title}</div>
              <div className="absence-upcoming-detail">{item.detail}</div>
              {item.note && <div className="absence-upcoming-note">{item.note}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Day panel (anchored near clicked cell) ───────────────────────────────────

function DayPanel({ dateStr, rect, absences, personByKey, holidayDetail, dayClosures, isAdmin, managerInitials, onClose, onJumpAndClose, onAddAbsence, onAddDoctorOff, onAbsenceClick, onToggleHolidayOpen, onMoveHoliday, onResetMove, onSetHolidayScope, onAddClosure, onDeleteClosure, onAddResearch, researchTableReady }) {
  const dayAbsences = absences.filter(a => a.start_date <= dateStr && a.end_date >= dateStr);
  const d = parseUTC(dateStr);
  const dateLabel = `${DOW[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}`;

  const [togglingHoliday, setTogglingHoliday] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [scopeEditorOpen, setScopeEditorOpen] = useState(false);
  const [scopeSelection, setScopeSelection] = useState(null);
  const [scopeSaving, setScopeSaving] = useState(false);
  const [showMoveUI, setShowMoveUI] = useState(false);
  const [moveDate, setMoveDate] = useState('');
  const [moveSaving, setMoveSaving] = useState(false);

  const panelWidth = 300;
  let left = Math.round(rect.left);
  if (left + panelWidth > window.innerWidth - 12) left = window.innerWidth - panelWidth - 12;
  if (left < 8) left = 8;
  let top = Math.round(rect.bottom + 6);
  if (top + 320 > window.innerHeight - 8) top = Math.round(rect.top) - 326;
  if (top < 8) top = 8;

  const computedDate = holidayDetail?.computedDate ?? dateStr;
  const moveMin = (() => { const dm = parseUTC(computedDate); dm.setUTCDate(dm.getUTCDate() - 7); return dm.toISOString().slice(0, 10); })();
  const moveMax = (() => { const dm = parseUTC(computedDate); dm.setUTCDate(dm.getUTCDate() + 7); return dm.toISOString().slice(0, 10); })();

  const openScopeEditor = () => {
    setScopeSelection(holidayDetail?.closedLocations ?? null);
    setScopeEditorOpen(true);
  };

  const toggleScopeLocation = (loc) => {
    setScopeSelection(prev => {
      const current = prev ?? CLOSURE_LOCATIONS; // null means all selected
      if (current.includes(loc)) {
        const next = current.filter(l => l !== loc);
        return next.length === 0 ? [] : next;
      } else {
        const next = [...current, loc];
        return next.length === CLOSURE_LOCATIONS.length ? null : next; // null = all
      }
    });
  };

  const openMoveUI = () => {
    setMoveDate(dateStr);
    setShowMoveUI(true);
  };

  const handleToggleHoliday = async () => {
    setTogglingHoliday(true);
    if (holidayDetail?.status === 'open') {
      if (holidayDetail.openOverrideId) await onToggleHolidayOpen('remove', holidayDetail.openOverrideId, null);
    } else {
      await onToggleHolidayOpen('add', null, { date: dateStr, kind: 'holiday_open', entered_by: managerInitials ?? null });
    }
    setTogglingHoliday(false);
  };

  const handleSaveScope = async () => {
    setScopeSaving(true);
    await onSetHolidayScope(dateStr, holidayDetail.name, scopeSelection);
    setScopeSaving(false);
    setScopeEditorOpen(false);
  };

  const handleMoveSubmit = async () => {
    if (!moveDate || moveDate === computedDate) return;
    setMoveSaving(true);
    await onMoveHoliday(holidayDetail.name, moveDate);
    setMoveSaving(false);
    setShowMoveUI(false);
    onClose();
  };

  const handleDeleteClosure = async (id) => {
    setDeletingId(id);
    await onDeleteClosure(id);
    setDeletingId(null);
  };

  return (
    <div
      className="day-panel"
      style={{ top, left, width: panelWidth }}
      onClick={e => e.stopPropagation()}
    >
      <div className="day-panel-header">
        <span className="day-panel-date">{dateLabel}</span>
        <button className="btn btn-icon" style={{ minHeight: 24, padding: '2px 4px' }} onClick={onClose}>
          <X size={13} />
        </button>
      </div>

      {/* Holiday section */}
      {holidayDetail && (
        <div className="day-panel-holiday">
          {holidayDetail.status === 'moved_away' && (
            <div className="day-panel-holiday-row">
              <span className="day-panel-holiday-dot" style={{ background: CLOSED_COLOR, opacity: 0.4 }} />
              <span className="day-panel-holiday-name day-panel-holiday-moved-away">
                {holidayDetail.name} – Moved To {formatDateDisplay(holidayDetail.movedToDate)}
              </span>
              {isAdmin && (
                <button
                  className="btn btn-pill"
                  style={{ fontSize: 10, minHeight: 20, padding: '1px 7px', marginLeft: 'auto', flexShrink: 0 }}
                  onClick={() => onResetMove(holidayDetail.movedOverrideId)}
                >
                  Reset
                </button>
              )}
            </div>
          )}

          {holidayDetail.status === 'moved_here' && (
            <div className="day-panel-holiday-row">
              <span className="day-panel-holiday-dot" style={{ background: CLOSED_COLOR }} />
              <span className="day-panel-holiday-name">
                {holidayDetail.name}{' '}
                <span className="day-panel-holiday-status">
                  (Moved From {formatDateDisplay(holidayDetail.originalDate)}) – Observed
                </span>
              </span>
              {isAdmin && (
                <button
                  className="btn btn-pill"
                  style={{ fontSize: 10, minHeight: 20, padding: '1px 7px', marginLeft: 'auto', flexShrink: 0 }}
                  onClick={() => onResetMove(holidayDetail.movedOverrideId)}
                >
                  Reset to {formatDateDisplay(holidayDetail.originalDate)}
                </button>
              )}
            </div>
          )}

          {(holidayDetail.status === 'observed' || holidayDetail.status === 'scoped' || holidayDetail.status === 'open') && (
            <>
              <div className="day-panel-holiday-row">
                <span className="day-panel-holiday-dot" style={{ background: CLOSED_COLOR, opacity: holidayDetail.status === 'open' ? 0.4 : 1 }} />
                <span className="day-panel-holiday-name">
                  {holidayDetail.name}
                  <span className="day-panel-holiday-status">
                    {holidayDetail.status === 'open' ? ' – Office Open' :
                     holidayDetail.status === 'scoped' ? ` – Closed: ${(holidayDetail.closedLocations ?? []).join(', ')}` :
                     ' – Observed (All Locations)'}
                  </span>
                </span>
                {isAdmin && (
                  <button
                    className="btn btn-pill"
                    style={{ fontSize: 10, minHeight: 20, padding: '1px 7px', marginLeft: 'auto', flexShrink: 0 }}
                    onClick={handleToggleHoliday}
                    disabled={togglingHoliday}
                  >
                    {togglingHoliday ? '…' : holidayDetail.status === 'open' ? 'Mark Observed' : 'Mark Open'}
                  </button>
                )}
              </div>

              {/* Location scope editor (admin, not-open) */}
              {isAdmin && holidayDetail.status !== 'open' && (
                <div className="day-panel-holiday-scope">
                  {!scopeEditorOpen ? (
                    <button className="btn btn-pill" style={{ fontSize: 10, minHeight: 20, padding: '1px 7px' }}
                      onClick={openScopeEditor}>
                      Edit Closed Locations
                    </button>
                  ) : (
                    <div>
                      <div className="day-panel-scope-chips">
                        {CLOSURE_LOCATIONS.map(loc => {
                          const isSelected = scopeSelection === null || scopeSelection.includes(loc);
                          return (
                            <button
                              key={loc}
                              className={`day-panel-scope-chip${isSelected ? ' day-panel-scope-chip--on' : ''}`}
                              onClick={() => toggleScopeLocation(loc)}
                            >
                              {loc}
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        <button className="btn btn-pill btn-primary" style={{ fontSize: 10, minHeight: 20 }}
                          onClick={handleSaveScope} disabled={scopeSaving}>
                          {scopeSaving ? '…' : 'Save'}
                        </button>
                        <button className="btn btn-pill" style={{ fontSize: 10, minHeight: 20 }}
                          onClick={() => setScopeEditorOpen(false)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Move observed day (admin, not-open) */}
              {isAdmin && holidayDetail.status !== 'open' && (
                <div className="day-panel-holiday-move">
                  {!showMoveUI ? (
                    <button className="btn btn-pill" style={{ fontSize: 10, minHeight: 20, padding: '1px 7px' }}
                      onClick={openMoveUI}>
                      Move Observed Day
                    </button>
                  ) : (
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Move To:</div>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input type="date" className="setup-input" style={{ fontSize: 11, flex: 1 }}
                          value={moveDate} min={moveMin} max={moveMax}
                          onChange={e => setMoveDate(e.target.value)} />
                        <button className="btn btn-pill btn-primary" style={{ fontSize: 10, minHeight: 20 }}
                          onClick={handleMoveSubmit} disabled={moveSaving || !moveDate || moveDate === computedDate}>
                          {moveSaving ? '…' : 'Set'}
                        </button>
                        <button className="btn btn-pill" style={{ fontSize: 10, minHeight: 20 }}
                          onClick={() => setShowMoveUI(false)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Office-closed entries */}
      {dayClosures.length > 0 && (
        <div className="day-panel-closures">
          {dayClosures.map(c => (
            <div key={c.id} className="day-panel-closure-item">
              <Building2 size={11} style={{ color: CLOSED_COLOR, flexShrink: 0 }} />
              <span className="day-panel-closure-label">
                {c.label}
                {c.locations && c.locations.length > 0 && (
                  <span style={{ opacity: 0.65, fontSize: 10, marginLeft: 4 }}>
                    ({c.locations.join(', ')})
                  </span>
                )}
              </span>
              {isAdmin && (
                <button
                  className="btn btn-icon"
                  style={{ minHeight: 20, padding: '1px 3px', marginLeft: 'auto', color: 'var(--text-muted)' }}
                  onClick={() => handleDeleteClosure(c.id)}
                  disabled={deletingId === c.id}
                  title="Delete Closure"
                >
                  {deletingId === c.id ? '…' : <Trash2 size={11} />}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="day-panel-absence-list">
        {dayAbsences.length === 0 && !holidayDetail && dayClosures.length === 0 && (
          <div className="day-panel-empty">No Absences This Day</div>
        )}
        {dayAbsences.length === 0 && (holidayDetail || dayClosures.length > 0) && (
          <div className="day-panel-empty">No staff absences</div>
        )}
        {dayAbsences.map(a => {
          const person = personByKey.get(a.person_name);
          const color = colorOf(a.type);
          return (
            <div key={a.id} className="day-panel-absence-item" onClick={() => onAbsenceClick(a)}>
              <span className="day-panel-dot" style={{ background: color }} />
              <span className="day-panel-name">{person?.name ?? a.person_name}</span>
              <span className="day-panel-type" style={{ color }}>{shortOf(a.type)}</span>
            </div>
          );
        })}
      </div>

      <div className="day-panel-actions">
        {/* Fully stacked — each button 100% width, nothing clips regardless of panel width */}
        {/* Ordered by frequency of use: Add Absence · Doctor Off · Research · Clinic Closed */}
        <button
          className="btn btn-pill btn-primary"
          style={{ fontSize: 11, minHeight: 26, gap: 4, width: '100%' }}
          onClick={() => onAddAbsence(dateStr)}
        >
          <Plus size={11} /> Add Absence
        </button>
        {isAdmin && (
          <button
            className="btn btn-pill"
            style={{ fontSize: 11, minHeight: 26, gap: 4, color: colorOf('DoctorOff'), borderColor: colorOf('DoctorOff'), width: '100%' }}
            onClick={() => onAddDoctorOff(dateStr)}
          >
            <Plus size={11} /> Doctor Off
          </button>
        )}
        {isAdmin && researchTableReady !== false && (
          <button
            className="btn btn-pill"
            style={{ fontSize: 11, minHeight: 26, gap: 4, color: RESEARCH_COLOR, borderColor: RESEARCH_COLOR, width: '100%' }}
            onClick={() => onAddResearch(dateStr)}
          >
            <Plus size={11} /> Research
          </button>
        )}
        {isAdmin && (
          <button
            className="btn btn-pill"
            style={{ fontSize: 11, minHeight: 26, gap: 4, color: CLOSED_COLOR, borderColor: CLOSED_COLOR, width: '100%', opacity: 0.7 }}
            onClick={() => onAddClosure(dateStr)}
          >
            <Building2 size={11} /> Clinic Closed
          </button>
        )}
      </div>
    </div>
  );
}

// ─── History view ─────────────────────────────────────────────────────────────

function AbsenceHistory({ absences, people, personByKey, onAbsenceClick }) {
  const [selectedKey, setSelectedKey] = useState('');
  const [selectedYear, setSelectedYear] = useState('all');
  // History type filter initialised from SELECTABLE_TYPES only (excludes retired hidden types)
  const [activeTypes, setActiveTypes] = useState(new Set(SELECTABLE_TYPES.map(t => t.key)));

  // All years present in absences data
  const allYears = [...new Set(absences.map(a => a.start_date.slice(0, 4)))].sort().reverse();

  const personAbsences = absences.filter(a => {
    if (selectedKey && a.person_name !== selectedKey) return false;
    if (selectedYear !== 'all' && !a.start_date.startsWith(selectedYear)) return false;
    // Use canonical type so old 'Partial' rows pass through when 'Approved' is active
    if (!activeTypes.has(canonicalType(a.type))) return false;
    return true;
  }).sort((a, b) => b.start_date.localeCompare(a.start_date));

  // Summary counts by category for selected person + year (ignoring type filter for summary).
  // Old 'Partial' rows are counted under 'Approved' via LEGACY_REMAP.
  const summaryBase = absences.filter(a => {
    if (selectedKey && a.person_name !== selectedKey) return false;
    if (selectedYear !== 'all' && !a.start_date.startsWith(selectedYear)) return false;
    return true;
  });
  const counts = Object.fromEntries(ABSENCE_TYPES.map(t => [
    t.key,
    summaryBase.filter(a => canonicalType(a.type) === t.key).length,
  ]));
  const totalDays = summaryBase.reduce((sum, a) => {
    const start = parseUTC(a.start_date), end = parseUTC(a.end_date);
    return sum + Math.round((end - start) / 86400000) + 1;
  }, 0);

  const toggleType = (key) => {
    setActiveTypes(prev => {
      const next = new Set(prev);
      if (next.has(key)) { if (next.size > 1) next.delete(key); }
      else next.add(key);
      return next;
    });
  };

  const selectedPerson = personByKey.get(selectedKey);

  return (
    <div className="absence-history">
      {/* Controls */}
      <div className="absence-history-controls">
        {/* Person selector */}
        <select
          className="setup-input"
          style={{ maxWidth: 200, fontSize: 13 }}
          value={selectedKey}
          onChange={e => setSelectedKey(e.target.value)}
        >
          <option value="">All Staff</option>
          {[...people].sort((a, b) => a.name.localeCompare(b.name)).map(p => (
            <option key={p.id} value={p.name.trim().toLowerCase()}>{p.name}</option>
          ))}
        </select>

        {/* Year filter */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button
            className={`pill small${selectedYear === 'all' ? ' active' : ''}`}
            onClick={() => setSelectedYear('all')}
          >All Time</button>
          {allYears.map(y => (
            <button
              key={y}
              className={`pill small${selectedYear === y ? ' active' : ''}`}
              onClick={() => setSelectedYear(y)}
            >{y}</button>
          ))}
        </div>

        {/* Category filter */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {SELECTABLE_TYPES.map(t => (
            <button
              key={t.key}
              className="absence-type-filter-btn"
              style={{
                background:  activeTypes.has(t.key) ? t.color : undefined,
                borderColor: activeTypes.has(t.key) ? t.color : undefined,
                color:       activeTypes.has(t.key) ? '#fff'  : undefined,
                opacity:     activeTypes.has(t.key) ? 1 : 0.45,
              }}
              onClick={() => toggleType(t.key)}
            >
              {t.short}
            </button>
          ))}
        </div>
      </div>

      {/* Summary counts */}
      {summaryBase.length > 0 && (
        <div className="absence-history-summary">
          <div className="absence-history-summary-header">
            {selectedPerson
              ? <><span style={{ fontWeight: 700 }}>{selectedPerson.name}</span> — </>
              : 'All Staff — '
            }
            {selectedYear !== 'all' ? selectedYear : 'All Time'} · {totalDays} Day{totalDays !== 1 ? 's' : ''} Total
          </div>
          <div className="absence-history-summary-counts">
            {ABSENCE_TYPES.filter(t => counts[t.key] > 0).map(t => (
              <span key={t.key} className="absence-history-count-chip"
                style={{ background: `${t.color}18`, borderColor: `${t.color}40`, color: t.color }}>
                <span style={{ fontWeight: 700 }}>{counts[t.key]}</span> {t.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Chronological list */}
      <div className="absence-history-list">
        {personAbsences.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '32px 0', textAlign: 'center' }}>
            {selectedKey ? 'No Absences Recorded For This Person' : 'No Absences Match The Selected Filters'}
          </div>
        )}
        {personAbsences.map(a => {
          const person = personByKey.get(a.person_name);
          const color  = colorOf(a.type);
          return (
            <div key={a.id} className="absence-history-row" onClick={() => onAbsenceClick(a)}>
              <div className="absence-history-row-dot" style={{ background: color }} />
              <div className="absence-history-row-date">{formatRange(a.start_date, a.end_date)}</div>
              {!selectedKey && (
                <div className="absence-history-row-person" style={{ color: person?.color }}>
                  {person?.name ?? a.person_name}
                </div>
              )}
              <div className="absence-history-row-type" style={{ color }}>
                {labelOf(a.type)}
                {a.partial_start && (
                  <span style={{ opacity: 0.7, fontSize: 10, marginLeft: 5 }}>
                    {a.partial_start}–{a.partial_end}
                  </span>
                )}
              </div>
              {a.note && <div className="absence-history-row-note">{a.note}</div>}
              {a.entered_by && (
                <div className="absence-history-row-meta">Entered By {a.entered_by}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Drag-range chooser ───────────────────────────────────────────────────────

function RangeChooser({ start, end, x, y, onAddAbsence, onClinicClosed, onClose }) {
  const width = 200;
  const left = Math.min(Math.max(x - width / 2, 8), window.innerWidth - width - 8);
  const top  = Math.min(y + 10, window.innerHeight - 120);
  const label = start === end ? formatDateDisplay(start) : formatRange(start, end);
  return (
    <div
      className="range-chooser"
      style={{ top, left, width }}
      onClick={e => e.stopPropagation()}
    >
      <div className="range-chooser-label">{label}</div>
      <button className="btn btn-pill range-chooser-btn" onClick={onAddAbsence}>
        Add Absence
      </button>
      <button className="btn btn-pill range-chooser-btn" style={{ color: CLOSED_COLOR, borderColor: CLOSED_COLOR }} onClick={onClinicClosed}>
        <Building2 size={11} /> Clinic Closed
      </button>
    </div>
  );
}

// ─── On-call week popover ─────────────────────────────────────────────────────

function OnCallWeekPopover({ weekStr, rect, settings, overrides, eligiblePool, onClose, onSaveOverride, onSaveBlock, onDeleteOverride, onStartHere }) {
  const existingOverride = (overrides ?? []).find(o => o.week_key === weekStr);
  const blockLength = settings?.blockWeeks ?? 4;
  const hasAnchor   = !!settings?.anchorWeek;
  const computed    = getOnCallForWeek(weekStr, settings, overrides ?? []);
  const blockPos    = getBlockPosition(weekStr, settings);
  const personColor = computed
    ? (eligiblePool ?? []).find(p => p.name.trim().toLowerCase() === computed.person.trim().toLowerCase())?.color ?? ONCALL_COLOR
    : ONCALL_COLOR;

  const [applyBlock,        setApplyBlock]        = useState(false);
  const [assigning,         setAssigning]         = useState(false);
  const [startConfirmPerson, setStartConfirmPerson] = useState(null);
  const [savingStart,       setSavingStart]       = useState(false);

  // Position anchored near the clicked chip/affordance
  const popoverWidth = 280;
  let left = Math.round(rect.left);
  if (left + popoverWidth > window.innerWidth - 12) left = window.innerWidth - popoverWidth - 12;
  if (left < 8) left = 8;
  let top = Math.round(rect.bottom + 6);
  if (top + 360 > window.innerHeight - 8) top = Math.round(rect.top) - 366;
  if (top < 8) top = 8;

  const handlePickPerson = async (personName) => {
    setAssigning(true);
    if (applyBlock) {
      await onSaveBlock(weekStr, personName, blockLength);
    } else {
      await onSaveOverride(weekStr, personName, null);
    }
    setAssigning(false);
    onClose();
  };

  const handleClearOverride = async () => {
    setAssigning(true);
    await onDeleteOverride(weekStr);
    setAssigning(false);
    onClose();
  };

  const handleConfirmStart = async () => {
    if (!startConfirmPerson) return;
    setSavingStart(true);
    await onStartHere(weekStr, startConfirmPerson);
    setSavingStart(false);
    onClose();
  };

  const pool = eligiblePool ?? [];

  return (
    <div className="oncall-popover" style={{ top, left, width: popoverWidth }} onClick={e => e.stopPropagation()}>
      <div className="oncall-popover-header">
        <span style={{ fontWeight: 600, fontSize: 13 }}>On Call · {weekStr.replace('-W', ' W')}</span>
        <button className="btn btn-icon" style={{ minHeight: 24, padding: '2px 4px' }} onClick={onClose}>
          <X size={13} />
        </button>
      </div>

      {/* Current assignment */}
      <div className="oncall-popover-current">
        {computed ? (
          <>
            <span className="oncall-popover-dot" style={{ background: personColor }} />
            <span className="oncall-popover-name">{computed.person}</span>
            {computed.isOverride && <span className="oncall-popover-badge">Override</span>}
            {blockPos && (
              <span className="oncall-popover-pos">Week {blockPos.weekInBlock} of {blockPos.totalWeeks}</span>
            )}
          </>
        ) : (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No One Assigned</span>
        )}
      </div>

      <div className="oncall-popover-divider" />

      {pool.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '10px 0', textAlign: 'center', lineHeight: 1.6 }}>
          No On-Call Eligible Techs.<br />
          Mark Techs With The On Call Role In Staff Setup.
        </div>
      ) : hasAnchor ? (
        /* ─── Rotation active: assign override ─── */
        <div className="oncall-popover-section">
          <div className="oncall-popover-section-label">
            {applyBlock ? `Assign ${blockLength}-Week Block:` : 'Assign This Week:'}
          </div>
          <div className="oncall-pool-pills">
            {pool.map(p => (
              <button
                key={p.id}
                className="oncall-pool-pill"
                onClick={() => !assigning && handlePickPerson(p.name)}
                disabled={assigning}
              >
                <span className="oncall-pool-pill-dot" style={{ background: p.color }} />
                {p.name}
              </button>
            ))}
          </div>
          <label className="oncall-block-checkbox">
            <input
              type="checkbox"
              checked={applyBlock}
              onChange={e => setApplyBlock(e.target.checked)}
            />
            Apply As {blockLength}-Week Block
          </label>
          {existingOverride && (
            <button
              className="btn btn-pill"
              style={{ fontSize: 11, minHeight: 26, marginTop: 8, color: '#dc2626', borderColor: '#dc2626' }}
              onClick={handleClearOverride}
              disabled={assigning}
            >
              Clear Override
            </button>
          )}
        </div>
      ) : (
        /* ─── No anchor yet: start rotation here ─── */
        <div className="oncall-popover-section">
          <div className="oncall-popover-section-label">Start Rotation Here</div>
          {startConfirmPerson ? (
            <div className="oncall-popover-confirm">
              <AlertCircle size={13} style={{ color: '#f59e0b', flexShrink: 0 }} />
              <div style={{ fontSize: 11, lineHeight: 1.6 }}>
                <strong>{startConfirmPerson}</strong> Goes First Starting {weekStr.replace('-W', ' W')}.
                Auto-Rotation Activates From Here.
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button
                  className="btn btn-primary btn-pill"
                  style={{ fontSize: 11, minHeight: 26 }}
                  onClick={handleConfirmStart}
                  disabled={savingStart}
                >
                  {savingStart ? '…' : 'Confirm'}
                </button>
                <button
                  className="btn btn-pill"
                  style={{ fontSize: 11, minHeight: 26 }}
                  onClick={() => setStartConfirmPerson(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
                Pick A Tech To Set This Week As Block 1 And Activate The Auto-Rotation.
              </div>
              <div className="oncall-pool-pills">
                {pool.map(p => (
                  <button
                    key={p.id}
                    className="oncall-pool-pill"
                    onClick={() => setStartConfirmPerson(p.name)}
                  >
                    <span className="oncall-pool-pill-dot" style={{ background: p.color }} />
                    {p.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main calendar ────────────────────────────────────────────────────────────

export default function AbsenceCalendar({ onClose, currentWeek, onJumpToWeek }) {
  const {
    data, absences, addAbsence, editAbsence, removeAbsence, managerInitials, addLog,
    calendarOverrides, addCalendarOverride, removeCalendarOverride, isAdmin,
    oncall, oncallOverrides, saveOncallOverride, deleteOncallOverride, saveOncall,
    researchAssignments, researchTableReady, addResearchAssignment, editResearchAssignment, removeResearchAssignment,
  } = useApp();
  const people      = data.people ?? [];
  const doctors     = (data.providers ?? []).map(p => p.name);
  const personByKey = useMemo(
    () => new Map(people.map(p => [p.name.trim().toLowerCase(), p])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.people],
  );

  // Eligible pool: techs with the 'On Call' role
  const eligiblePool = useMemo(
    () => people.filter(p => (p.roles ?? []).includes('On Call')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.people],
  );
  const eligibleNames = useMemo(
    () => new Set(eligiblePool.map(p => p.name)),
    [eligiblePool],
  );
  // Effective rotation: oncall with rotation filtered to only eligible people
  const effectiveOncallSettings = useMemo(() => {
    if (!oncall) return null;
    return {
      ...oncall,
      rotation: (oncall.rotation ?? []).filter(n => eligibleNames.has(n)),
    };
  }, [oncall, eligibleNames]);

  const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

  // Open focused on the month containing the currently viewed board week
  const initMonday = currentWeek ? mondayOfWeek(currentWeek) : new Date();
  const [view,           setView]           = useState('calendar'); // 'calendar' | 'history'
  const [showOncallPanel, setShowOncallPanel] = useState(false);
  const [viewYear,  setViewYear]  = useState(initMonday.getUTCFullYear());
  const [viewMonth, setViewMonth] = useState(initMonday.getUTCMonth());
  const [modal,          setModal]          = useState(null); // absence modal
  const [closureModal,   setClosureModal]   = useState(null); // { initStart, initEnd }
  const [rangeChooser,   setRangeChooser]   = useState(null); // { start, end, x, y }
  const [dayPanel,       setDayPanel]       = useState(null); // { dateStr, rect }
  const [researchModal,  setResearchModal]  = useState(null); // null | { mode, initDate, assignment }
  const [dragRange,    setDragRange]    = useState(null); // { start, end } dateStr
  const dragActiveRef   = useRef(false);
  const dragStartRef    = useRef(null);
  const dragRangeRef    = useRef(null);
  const dragConfirmedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const [onCallPopover, setOnCallPopover] = useState(null); // { weekStr, rect }

  // Category filter chips — all on by default (including 'Closed', 'OnCall', 'Research')
  const [activeCategories, setActiveCategories] = useState(
    () => new Set([...SELECTABLE_TYPES.map(t => t.key), 'Closed', 'Research']),
  );
  const toggleCategory = useCallback((key) => {
    setActiveCategories(prev => {
      const next = new Set(prev);
      if (next.has(key)) { if (next.size > 1) next.delete(key); }
      else next.add(key);
      return next;
    });
  }, []);

  // ─── Holiday / override derived data ───────────────────────────────────────

  // Federal holidays for current + adjacent years
  const federalHolidays = useMemo(() => {
    return [
      ...getFederalHolidays(viewYear - 1),
      ...getFederalHolidays(viewYear),
      ...getFederalHolidays(viewYear + 1),
    ];
  }, [viewYear]);

  // movedByName: Map<holidayName, override> — holiday_moved overrides
  const movedByName = useMemo(
    () => new Map((calendarOverrides ?? []).filter(o => o.kind === 'holiday_moved').map(o => [o.holiday_name, o])),
    [calendarOverrides]
  );

  // openByDate: Map<dateStr, override> — holiday_open overrides
  const openByDate = useMemo(
    () => new Map((calendarOverrides ?? []).filter(o => o.kind === 'holiday_open').map(o => [o.date, o])),
    [calendarOverrides]
  );

  // scopeByDate: Map<dateStr, override> — holiday_scope overrides
  const scopeByDate = useMemo(
    () => new Map((calendarOverrides ?? []).filter(o => o.kind === 'holiday_scope').map(o => [o.date, o])),
    [calendarOverrides]
  );

  // officeClosedByDate: Map<dateStr, override[]>
  const officeClosedByDate = useMemo(() => {
    const map = new Map();
    (calendarOverrides ?? []).filter(o => o.kind === 'office_closed').forEach(o => {
      if (!map.has(o.date)) map.set(o.date, []);
      map.get(o.date).push(o);
    });
    return map;
  }, [calendarOverrides]);

  // movedToByDate: Map<movedToDate, { name, originalDate, id }>
  const movedToByDate = useMemo(() => {
    const map = new Map();
    for (const [name, ovr] of movedByName) {
      const originalHoliday = federalHolidays.find(h => h.name === name);
      if (originalHoliday) {
        map.set(ovr.date, { name, originalDate: originalHoliday.date, id: ovr.id });
      }
    }
    return map;
  }, [movedByName, federalHolidays]);

  // closureMap: use buildClosureMap — accounts for moves, open overrides, scope
  const closureMap = useMemo(
    () => buildClosureMap(federalHolidays, calendarOverrides ?? []),
    [federalHolidays, calendarOverrides]
  );

  // officeClosedSpans: group consecutive same-label+locations DB rows into date spans.
  // Lets WeekRow render one spanning bar instead of N single-day bars.
  const officeClosedSpans = useMemo(() => {
    const entries = (calendarOverrides ?? [])
      .filter(o => o.kind === 'office_closed')
      .sort((a, b) => a.date.localeCompare(b.date));

    const spans = [];
    for (const entry of entries) {
      const locKey = JSON.stringify((entry.locations ?? null) === null ? null : [...(entry.locations ?? [])].sort());
      const lbl = entry.label ?? '';
      const last = spans[spans.length - 1];
      if (last && last._locKey === locKey && last.label === lbl && dayAfter(last.endDate) === entry.date) {
        last.endDate = entry.date;
        last.ids.push(entry.id);
      } else {
        spans.push({ startDate: entry.date, endDate: entry.date, label: lbl, locations: entry.locations ?? null, ids: [entry.id], _locKey: locKey });
      }
    }
    return spans;
  }, [calendarOverrides]);

  // allClosures: display-only array (startDate/endDate) for WeekRow bars + UpcomingPanel
  const allClosures = useMemo(() => {
    const result = [];
    // Holidays: always single-day
    for (const [date, entry] of closureMap) {
      if (entry.kind !== 'holiday') continue;
      result.push({
        kind: 'holiday',
        startDate: date, endDate: date,
        label: `${entry.name}${entry.moved ? ' (moved)' : ''}`,
        locations: entry.closedLocations,
      });
    }
    // Office-closed: grouped spans
    for (const span of officeClosedSpans) {
      result.push({
        kind: 'office_closed',
        startDate: span.startDate, endDate: span.endDate,
        label: span.label,
        locations: span.locations,
        ids: span.ids,
      });
    }
    return result.sort((a, b) => a.startDate.localeCompare(b.startDate));
  }, [closureMap, officeClosedSpans]);

  // Per-date holiday detail for the DayPanel
  const holidayDetailByDate = useMemo(() => {
    const map = new Map();

    // Original computed holiday dates
    for (const h of federalHolidays) {
      const movedOvr = movedByName.get(h.name);
      const openOvr = openByDate.get(h.date);
      const scopeOvr = scopeByDate.get(h.date);

      if (movedOvr) {
        map.set(h.date, {
          status: 'moved_away',
          name: h.name,
          movedToDate: movedOvr.date,
          movedOverrideId: movedOvr.id,
          computedDate: h.date,
          closedLocations: null,
          scopeOverrideId: null,
          openOverrideId: null,
        });
      } else if (openOvr) {
        map.set(h.date, {
          status: 'open',
          name: h.name,
          openOverrideId: openOvr.id,
          computedDate: h.date,
          movedToDate: null,
          movedOverrideId: null,
          closedLocations: null,
          scopeOverrideId: null,
        });
      } else if (scopeOvr) {
        map.set(h.date, {
          status: 'scoped',
          name: h.name,
          closedLocations: scopeOvr.locations ?? [],
          scopeOverrideId: scopeOvr.id,
          computedDate: h.date,
          movedToDate: null,
          movedOverrideId: null,
          openOverrideId: null,
        });
      } else {
        map.set(h.date, {
          status: 'observed',
          name: h.name,
          closedLocations: null,
          computedDate: h.date,
          movedToDate: null,
          movedOverrideId: null,
          openOverrideId: null,
          scopeOverrideId: null,
        });
      }
    }

    // Moved-to dates (where the holiday now lives)
    for (const [date, info] of movedToByDate) {
      map.set(date, {
        status: 'moved_here',
        name: info.name,
        originalDate: info.originalDate,
        movedOverrideId: info.id,
        computedDate: null,
        movedToDate: date,
        closedLocations: null,
        scopeOverrideId: null,
        openOverrideId: null,
      });
    }

    return map;
  }, [federalHolidays, movedByName, openByDate, scopeByDate, movedToByDate]);

  // ──────────────────────────────────────────────────────────────────────────

  // Set of dateStr for Mon–Sun of the currently viewed board week (for row highlight)
  const currentWeekDates = useMemo(() => {
    if (!currentWeek) return new Set();
    const mon = mondayOfWeek(currentWeek);
    const dates = new Set();
    for (let i = 0; i < 7; i++) {
      const d = new Date(mon);
      d.setUTCDate(mon.getUTCDate() + i);
      dates.add(toDateStr(d));
    }
    return dates;
  }, [currentWeek]);

  // Escape layering: closure modal → absence modal → range chooser → dayPanel → calendar
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') {
        if (closureModal)    { setClosureModal(null);     return; }
        if (modal)           { setModal(null);             return; }
        if (rangeChooser)    { setRangeChooser(null);     return; }
        if (onCallPopover)   { setOnCallPopover(null);    return; }
        if (dayPanel)        { setDayPanel(null);          return; }
        if (showOncallPanel) { setShowOncallPanel(false); return; }
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [closureModal, modal, rangeChooser, onCallPopover, dayPanel, showOncallPanel, onClose]);

  // ─── Drag-range selection (manager only) ───────────────────────────────────
  const handleCellMouseDown = useCallback((ds) => {
    dragActiveRef.current = true;
    dragConfirmedRef.current = false;
    dragStartRef.current = ds;
    dragRangeRef.current = { start: ds, end: ds };
    setDragRange(null); // don't highlight single cell yet (wait for confirmed drag)
  }, []);

  const handleCellMouseEnter = useCallback((ds) => {
    if (!dragActiveRef.current || ds === dragStartRef.current) return;
    dragConfirmedRef.current = true;
    const start = dragStartRef.current;
    const [s, e] = ds < start ? [ds, start] : [start, ds];
    const range = { start: s, end: e };
    dragRangeRef.current = range;
    setDragRange(range);
  }, []);

  // Global mouseup: end drag; show chooser if range confirmed
  useEffect(() => {
    const handleMouseUp = (ev) => {
      if (!dragActiveRef.current) return;
      dragActiveRef.current = false;
      if (dragConfirmedRef.current && dragRangeRef.current) {
        suppressClickRef.current = true;
        setTimeout(() => { suppressClickRef.current = false; }, 100);
        const { start, end } = dragRangeRef.current;
        setRangeChooser({ start, end, x: ev.clientX, y: ev.clientY });
      }
      setDragRange(null);
      dragRangeRef.current = null;
      dragConfirmedRef.current = false;
    };
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const grid = buildGrid(viewYear, viewMonth);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };
  const goToday = () => {
    const now = new Date();
    setViewYear(now.getUTCFullYear());
    setViewMonth(now.getUTCMonth());
  };

  // Single-click: open day panel anchored near the cell
  const handleDayClick = useCallback((ds, rect) => {
    setDayPanel({ dateStr: ds, rect });
  }, []);

  // Double-click: jump to the week containing that day and close calendar
  const handleDayDoubleClick = useCallback((ds) => {
    if (onJumpToWeek) onJumpToWeek(isoWeek(parseUTC(ds)));
    onClose();
  }, [onJumpToWeek, onClose]);

  const handleAbsenceClick = useCallback((absence) => {
    setDayPanel(null);
    setModal({ mode: 'edit', absence });
  }, []);

  const handleSave = useCallback(async (...args) => {
    let result;
    if (modal?.mode === 'edit') {
      result = await editAbsence(...args);
      if (!result.error) {
        const p = personByKey.get(args[1]?.person_name ?? modal?.absence?.person_name);
        addLog({ action: 'Absence updated', personName: p?.name ?? '?', day: '',
          detail: `${labelOf(args[1]?.type)} ${formatRange(args[1]?.start_date, args[1]?.end_date)}` });
      }
    } else {
      result = await addAbsence(...args);
      if (!result.error) {
        const p = personByKey.get(args[0]?.person_name);
        addLog({ action: 'Absence added', personName: p?.name ?? '?', day: '',
          detail: `${labelOf(args[0]?.type)} ${formatRange(args[0]?.start_date, args[0]?.end_date)}` });
      }
    }
    if (!result.error) setModal(null);
  }, [modal, addAbsence, editAbsence, addLog, personByKey]);

  const handleDelete = useCallback(async (id) => {
    const absence = modal?.absence;
    const result  = await removeAbsence(id);
    if (!result.error) {
      const p = personByKey.get(absence?.person_name);
      addLog({ action: 'Absence removed', personName: p?.name ?? '?', day: '',
        detail: `${labelOf(absence?.type)} ${formatRange(absence?.start_date, absence?.end_date)}` });
      setModal(null);
    }
  }, [modal, removeAbsence, addLog, personByKey]);

  const handleToggleHolidayOpen = useCallback(async (action, id, payload) => {
    if (action === 'add') {
      await addCalendarOverride(payload);
    } else {
      await removeCalendarOverride(id);
    }
    // errors surface via saveStatus toast in AppContext
  }, [addCalendarOverride, removeCalendarOverride]);

  // Move a holiday to a new date (replaces any existing holiday_moved override for that holiday)
  const handleMoveHoliday = useCallback(async (holidayName, newDate) => {
    const existing = (calendarOverrides ?? []).find(o => o.kind === 'holiday_moved' && o.holiday_name === holidayName);
    if (existing) {
      const { error } = await removeCalendarOverride(existing.id);
      if (error) return; // error already surfaced via saveStatus
    }
    await addCalendarOverride({ date: newDate, kind: 'holiday_moved', holiday_name: holidayName });
  }, [calendarOverrides, removeCalendarOverride, addCalendarOverride]);

  // Reset a moved holiday back to its computed date
  const handleResetMove = useCallback(async (overrideId) => {
    await removeCalendarOverride(overrideId);
  }, [removeCalendarOverride]);

  // Set location scope for a holiday (null = all; array = specific closed locations)
  const handleSetHolidayScope = useCallback(async (dateStr, holidayName, locations) => {
    const existing = (calendarOverrides ?? []).find(o => o.kind === 'holiday_scope' && o.date === dateStr);
    if (existing) {
      const { error } = await removeCalendarOverride(existing.id);
      if (error) return; // error already surfaced via saveStatus; don't write a second override
    }
    // If locations is null or all 5 locations selected: no scope override needed (all closed = default)
    if (locations !== null && locations.length > 0 && locations.length < CLOSURE_LOCATIONS.length) {
      await addCalendarOverride({ date: dateStr, kind: 'holiday_scope', holiday_name: holidayName, locations });
    }
  }, [calendarOverrides, removeCalendarOverride, addCalendarOverride]);

  const handleAddClosure = useCallback(async (payloads) => {
    const arr = Array.isArray(payloads) ? payloads : [payloads];
    for (const p of arr) {
      const { error } = await addCalendarOverride(p);
      if (error) return; // error surfaced via saveStatus; don't close modal or continue writing
    }
    setClosureModal(null);
  }, [addCalendarOverride]);

  const handleDeleteClosure = useCallback(async (id) => {
    await removeCalendarOverride(id);
    // error surfaces via saveStatus toast
  }, [removeCalendarOverride]);

  const handleAddDoctorOff = useCallback((ds) => {
    setDayPanel(null);
    setModal({ mode: 'add', initStart: ds, initEnd: ds, initType: 'DoctorOff' });
  }, []);

  const handleAddResearch = useCallback((dateStr) => {
    setDayPanel(null);
    setResearchModal({ mode: 'add', initDate: dateStr });
  }, []);

  const handleResearchClick = useCallback((ra) => {
    if (!isAdmin) return;
    setResearchModal({ mode: 'edit', assignment: ra });
  }, [isAdmin]);

  const handleResearchSave = useCallback(async (idOrPayload, payloadOrUndefined) => {
    if (payloadOrUndefined !== undefined) {
      // edit: (id, payload)
      await editResearchAssignment(idOrPayload, payloadOrUndefined);
    } else {
      // add: (payload)
      await addResearchAssignment(idOrPayload);
    }
  }, [addResearchAssignment, editResearchAssignment]);

  const handleResearchDelete = useCallback(async (id) => {
    await removeResearchAssignment(id);
  }, [removeResearchAssignment]);

  // ─── On-call chip handlers (manager only) ──────
  const handleOncallChipClick = useCallback((weekStr, rect) => {
    setDayPanel(null);
    setOnCallPopover({ weekStr, rect });
  }, []);

  const handleSaveOncallOverride = useCallback(async (weekStr, personName, note) => {
    await saveOncallOverride({ week_key: weekStr, person_name: personName, note: note ?? null });
  }, [saveOncallOverride]);

  // Save overrides for weekStr and the following (blockLength-1) weeks
  const handleSaveOncallBlock = useCallback(async (weekStr, personName, blockLength) => {
    for (let i = 0; i < blockLength; i++) {
      const wk = i === 0 ? weekStr : addWeeks(weekStr, i);
      await saveOncallOverride({ week_key: wk, person_name: personName, note: null });
    }
  }, [saveOncallOverride]);

  const handleDeleteOncallOverride = useCallback(async (weekStr) => {
    await deleteOncallOverride(weekStr);
  }, [deleteOncallOverride]);

  // "Start Rotation Here": reorder eligible rotation so personName is first, set anchor
  const handleStartHere = useCallback(async (weekStr, personName) => {
    if (!oncall) return;
    const rotation = (oncall.rotation ?? []).filter(n => eligibleNames.has(n));
    const idx = rotation.findIndex(n => n.trim().toLowerCase() === personName.trim().toLowerCase());
    let newRotation;
    if (idx < 0) {
      // Person not yet in saved rotation — put them first
      newRotation = [personName, ...rotation];
    } else {
      newRotation = [...rotation.slice(idx), ...rotation.slice(0, idx)];
    }
    await saveOncall({ ...oncall, anchorWeek: weekStr, rotation: newRotation });
  }, [oncall, saveOncall, eligibleNames]);

  return (
    <div
      className="absence-overlay"
      onClick={showOncallPanel ? () => setShowOncallPanel(false) : undefined}
    >
      <div className="absence-panel" onClick={showOncallPanel ? e => e.stopPropagation() : undefined}>

        {/* ── Header ── */}
        <div className="absence-header">
          {view === 'calendar' ? (
            <>
              <button className="btn btn-icon" onClick={prevMonth} title="Previous month"><ChevronLeft size={16} /></button>
              <span className="absence-month-label">{MONTHS[viewMonth]} {viewYear}</span>
              <button className="btn btn-icon" onClick={nextMonth} title="Next month"><ChevronRight size={16} /></button>
              <button className="btn btn-pill" style={{ fontSize: 11, minHeight: 26, padding: '2px 10px' }} onClick={goToday}>
                This Month
              </button>
            </>
          ) : (
            <span className="absence-month-label" style={{ paddingLeft: 4 }}>Absence History</span>
          )}
          <div style={{ flex: 1 }} />
          {/* On call panel button — manager only */}
          {isAdmin && (
            <button
              className={`btn btn-pill topbar-mobile-hidden${showOncallPanel ? ' active' : ''}`}
              style={{ fontSize: 11, minHeight: 26, padding: '2px 10px', gap: 4 }}
              onClick={() => setShowOncallPanel(s => !s)}
              title={showOncallPanel ? 'Close On-Call Panel' : 'Manage On-Call Rotation'}
            >
              <PhoneCall size={13} />
              On Call
            </button>
          )}
          {/* History toggle */}
          <button
            className={`btn btn-pill topbar-mobile-hidden${view === 'history' ? ' active' : ''}`}
            style={{ fontSize: 11, minHeight: 26, padding: '2px 10px', gap: 4 }}
            onClick={() => setView(v => v === 'history' ? 'calendar' : 'history')}
            title={view === 'history' ? 'Back To Calendar' : 'View Absence History'}
          >
            <History size={13} />
            {view === 'history' ? 'Calendar' : 'History'}
          </button>
          {view === 'calendar' && (
            <button
              className="btn btn-pill"
              style={{ fontSize: 11, minHeight: 26, padding: '2px 10px', gap: 4 }}
              onClick={() => setModal({ mode: 'add', initStart: todayStr, initEnd: todayStr })}
            >
              <Plus size={12} /> Add
            </button>
          )}
          <button className="btn btn-icon" onClick={onClose} title="Close"><X size={16} /></button>
        </div>

        {/* ── Body ── */}
        {view === 'calendar' ? (
          <div className="absence-body">
            <div className="absence-cal-section">
              <div className="absence-dow-row">
                {DOW.map(d => <div key={d} className="absence-dow-cell">{d}</div>)}
              </div>
              <Legend activeCategories={activeCategories} onToggle={toggleCategory} researchTableReady={researchTableReady} />
              <div className="absence-grid">
                {grid.map((week, wi) => (
                  <WeekRow
                    key={wi}
                    week={week}
                    viewMonth={viewMonth}
                    absences={absences}
                    closures={allClosures}
                    personByKey={personByKey}
                    todayStr={todayStr}
                    onDayClick={handleDayClick}
                    onDayDoubleClick={handleDayDoubleClick}
                    onAbsenceClick={handleAbsenceClick}
                    activeCategories={activeCategories}
                    currentWeekDates={currentWeekDates}
                    dayPanelDate={dayPanel?.dateStr ?? null}
                    oncallSettings={effectiveOncallSettings}
                    oncallOverrides={oncallOverrides}
                    people={people}
                    isAdmin={isAdmin}
                    onOncallChipClick={handleOncallChipClick}
                    eligiblePool={eligiblePool}
                    dragRange={dragRange}
                    onCellMouseDown={isAdmin ? handleCellMouseDown : undefined}
                    onCellMouseEnter={isAdmin ? handleCellMouseEnter : undefined}
                    suppressClickRef={suppressClickRef}
                    researchAssignments={researchAssignments}
                    onResearchClick={isAdmin ? handleResearchClick : undefined}
                    showOncallPanel={showOncallPanel}
                  />
                ))}
              </div>
            </div>
            <UpcomingPanel
              absences={absences}
              closures={allClosures}
              personByKey={personByKey}
              todayStr={todayStr}
              onAbsenceClick={handleAbsenceClick}
              activeCategories={activeCategories}
              oncallSettings={effectiveOncallSettings}
              oncallOverrides={oncallOverrides}
              people={people}
              researchAssignments={researchAssignments}
              onResearchClick={isAdmin ? handleResearchClick : undefined}
              showOncallPanel={showOncallPanel}
            />
          </div>
        ) : (
          <AbsenceHistory
            absences={absences}
            people={people}
            personByKey={personByKey}
            onAbsenceClick={handleAbsenceClick}
          />
        )}
      </div>

      {/* On-call side panel — slides in from the right, manager only */}
      {isAdmin && showOncallPanel && (
        <div className="oncall-side-panel" onClick={e => e.stopPropagation()}>
          <div className="oncall-side-panel-header">
            <span className="oncall-side-panel-title">On Call</span>
            <button className="btn btn-icon" style={{ minHeight: 28 }} onClick={() => setShowOncallPanel(false)} title="Close">
              <X size={16} />
            </button>
          </div>
          <div className="oncall-side-panel-body">
            <OnCallManager />
          </div>
        </div>
      )}

      {/* On-call week popover — manager only */}
      {isAdmin && onCallPopover && !modal && !closureModal && (
        <OnCallWeekPopover
          weekStr={onCallPopover.weekStr}
          rect={onCallPopover.rect}
          settings={effectiveOncallSettings}
          overrides={oncallOverrides}
          eligiblePool={eligiblePool}
          onClose={() => setOnCallPopover(null)}
          onSaveOverride={handleSaveOncallOverride}
          onSaveBlock={handleSaveOncallBlock}
          onDeleteOverride={handleDeleteOncallOverride}
          onStartHere={handleStartHere}
        />
      )}

      {/* Day panel — anchored near clicked cell, above modal layer */}
      {dayPanel && !modal && !closureModal && !researchModal && (
        <DayPanel
          dateStr={dayPanel.dateStr}
          rect={dayPanel.rect}
          absences={absences}
          personByKey={personByKey}
          holidayDetail={holidayDetailByDate.get(dayPanel.dateStr) ?? null}
          dayClosures={officeClosedByDate.get(dayPanel.dateStr) ?? []}
          isAdmin={isAdmin}
          managerInitials={managerInitials}
          onClose={() => setDayPanel(null)}
          onJumpAndClose={() => {
            if (onJumpToWeek) onJumpToWeek(isoWeek(parseUTC(dayPanel.dateStr)));
            onClose();
          }}
          onAddAbsence={(ds) => {
            setDayPanel(null);
            setModal({ mode: 'add', initStart: ds, initEnd: ds });
          }}
          onAddDoctorOff={isAdmin ? handleAddDoctorOff : undefined}
          onAbsenceClick={handleAbsenceClick}
          onToggleHolidayOpen={handleToggleHolidayOpen}
          onMoveHoliday={handleMoveHoliday}
          onResetMove={handleResetMove}
          onSetHolidayScope={handleSetHolidayScope}
          onAddClosure={(ds) => {
            setDayPanel(null);
            setClosureModal({ initStart: ds, initEnd: ds });
          }}
          onDeleteClosure={handleDeleteClosure}
          onAddResearch={handleAddResearch}
          researchTableReady={researchTableReady}
        />
      )}

      {modal && (
        <AbsenceModal
          mode={modal.mode}
          initStart={modal.initStart}
          initEnd={modal.initEnd}
          initType={modal.initType ?? undefined}
          absence={modal.absence}
          people={people}
          absences={absences}
          doctors={doctors}
          managerInitials={managerInitials}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setModal(null)}
        />
      )}

      {closureModal && (
        <ClinicClosedModal
          initStart={closureModal.initStart}
          initEnd={closureModal.initEnd}
          managerInitials={managerInitials}
          onSave={handleAddClosure}
          onClose={() => setClosureModal(null)}
        />
      )}

      {researchModal && (
        <ResearchModal
          mode={researchModal.mode}
          initDate={researchModal.initDate ?? null}
          assignment={researchModal.assignment ?? null}
          people={people}
          managerInitials={managerInitials}
          onSave={handleResearchSave}
          onDelete={handleResearchDelete}
          onClose={() => setResearchModal(null)}
        />
      )}

      {rangeChooser && (
        <RangeChooser
          start={rangeChooser.start}
          end={rangeChooser.end}
          x={rangeChooser.x}
          y={rangeChooser.y}
          onAddAbsence={() => {
            setModal({ mode: 'add', initStart: rangeChooser.start, initEnd: rangeChooser.end });
            setRangeChooser(null);
          }}
          onClinicClosed={() => {
            setClosureModal({ initStart: rangeChooser.start, initEnd: rangeChooser.end });
            setRangeChooser(null);
          }}
          onClose={() => setRangeChooser(null)}
        />
      )}
    </div>
  );
}
