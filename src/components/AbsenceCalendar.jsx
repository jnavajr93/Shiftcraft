import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ChevronLeft, ChevronRight, X, Clock, Plus, Trash2, AlertCircle, History } from 'lucide-react';
import { useApp, mondayOfWeek, isoWeek } from '../context/AppContext.jsx';

// ─── Category definitions ─────────────────────────────────────────────────────

export const ABSENCE_TYPES = [
  { key: 'Callout',  label: 'Last-minute callout', short: 'Callout',  color: '#ef4444' },
  { key: 'Approved', label: 'Approved time off',   short: 'Approved', color: '#22c55e' },
  { key: 'Sick',     label: 'Sick',                short: 'Sick',     color: '#3b82f6' },
  // Request/pending is retired — hidden from form/legend but kept for rendering old DB rows
  { key: 'Request',  label: 'Request / pending',   short: 'Request',  color: '#f59e0b', hidden: true },
  { key: 'Partial',  label: 'Partial day',         short: 'Partial',  color: '#8b5cf6' },
  { key: 'DoctorOff', label: 'Doctor off', short: 'Dr. off', color: '#f59e0b' },
];

// Types available for selection in the add/edit form and shown in the legend
const SELECTABLE_TYPES = ABSENCE_TYPES.filter(t => !t.hidden);

const DOCTORS = ['Dr. R', 'Dr. A', 'Dr. S', 'Dr. B'];

const TYPE_MAP  = new Map(ABSENCE_TYPES.map(t => [t.key, t]));
const colorOf   = (key) => TYPE_MAP.get(key)?.color ?? '#6b7280';
const labelOf   = (key) => TYPE_MAP.get(key)?.label ?? key;
const shortOf   = (key) => TYPE_MAP.get(key)?.short ?? key;

// ─── Date helpers ─────────────────────────────────────────────────────────────

function toDateStr(d) { return d.toISOString().slice(0, 10); }
function parseUTC(str) { return new Date(str + 'T00:00:00Z'); }

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

function Legend({ activeCategories, onToggle }) {
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
    </div>
  );
}

// ─── Absence modal ────────────────────────────────────────────────────────────

function AbsenceModal({ mode, initStart, initEnd, absence, people, absences, doctors, managerInitials, onSave, onDelete, onClose }) {
  const isEdit = mode === 'edit';
  const [personKey, setPersonKey] = useState(absence?.person_name ?? '');
  // If editing an absence with a retired type (e.g. 'Request'), reset to '' so user must pick a current type
  const [type,      setType]      = useState(() => {
    const t = absence?.type ?? 'Approved';
    return SELECTABLE_TYPES.some(s => s.key === t) ? t : '';
  });
  const [startD,    setStartD]    = useState(absence?.start_date ?? initStart ?? '');
  const [endD,      setEndD]      = useState(absence?.end_date   ?? initEnd   ?? '');
  const [pStart,    setPStart]    = useState(absence?.partial_start ?? '08:00');
  const [pEnd,      setPEnd]      = useState(absence?.partial_end   ?? '12:00');
  const [note,      setNote]      = useState(absence?.note ?? '');
  const [saving,    setSaving]    = useState(false);
  const [deleting,  setDeleting]  = useState(false);
  const [dupWarning, setDupWarning] = useState(null);

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
    const payload = {
      person_name:   personKey,
      start_date:    startD,
      end_date:      endD,
      type,
      partial_start: type === 'Partial' ? pStart : null,
      partial_end:   type === 'Partial' ? pEnd   : null,
      note:          note.trim() || null,
      entered_by:    managerInitials,
    };
    if (isEdit) await onSave(absence.id, payload);
    else        await onSave(payload);
    setSaving(false);
  };

  const handleDelete = async () => {
    setDeleting(true);
    await onDelete(absence.id);
    setDeleting(false);
  };

  const person = people.find(p => p.name.trim().toLowerCase() === personKey);
  const canSubmit = personKey && startD && endD && startD <= endD && SELECTABLE_TYPES.some(s => s.key === type);

  return (
    <div className="overlay-backdrop" style={{ zIndex: 310 }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="overlay-modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="overlay-header">
          <span style={{ fontWeight: 600, fontSize: 15 }}>{isEdit ? 'Edit absence' : 'Add absence'}</span>
          <button className="overlay-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="overlay-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Person / Doctor picker */}
          <div>
            <label className="setup-label">{type === 'DoctorOff' ? 'Doctor' : 'Person'}</label>
            {type === 'DoctorOff' ? (
              <select className="setup-input" value={personKey} onChange={e => setPersonKey(e.target.value)}>
                <option value="">— select doctor —</option>
                {(doctors ?? DOCTORS).map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            ) : (
              <select className="setup-input" value={personKey} onChange={e => setPersonKey(e.target.value)}>
                <option value="">— select —</option>
                {[...people].sort((a, b) => a.name.localeCompare(b.name)).map(p => (
                  <option key={p.id} value={p.name.trim().toLowerCase()}>{p.name}</option>
                ))}
              </select>
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
              <label className="setup-label">Start date</label>
              <input type="date" className="setup-input" value={startD}
                onChange={e => { setStartD(e.target.value); if (e.target.value > endD) setEndD(e.target.value); }} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="setup-label">End date</label>
              <input type="date" className="setup-input" value={endD} min={startD}
                onChange={e => setEndD(e.target.value)} />
            </div>
          </div>

          {/* Partial times */}
          {type === 'Partial' && (
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label className="setup-label">Partial start</label>
                <input type="time" className="setup-input" value={pStart} onChange={e => setPStart(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="setup-label">Partial end</label>
                <input type="time" className="setup-input" value={pEnd} onChange={e => setPEnd(e.target.value)} />
              </div>
            </div>
          )}

          {/* Note */}
          <div>
            <label className="setup-label">Note <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
            <input className="setup-input" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. FMLA, pre-approved…" />
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
                    {saving ? 'Adding…' : 'Add anyway'}
                  </button>
                  <button className="btn btn-pill" style={{ fontSize: 11, minHeight: 26 }}
                    onClick={() => setDupWarning(null)}>
                    Cancel
                  </button>
                </div>
              </div>
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
                {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Add absence'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Week row with spanning bars ──────────────────────────────────────────────

function WeekRow({ week, viewMonth, absences, personByKey, todayStr, onDayClick, onDayDoubleClick, onAbsenceClick, activeCategories, currentWeekDates, dayPanelDate }) {
  const weekStart = toDateStr(week[0]);
  const weekEnd   = toDateStr(week[6]);
  const clickTimerRef = useRef(null);

  // Highlight if any day of this calendar row falls in the board's current week
  const isCurrentWeek = week.some(d => currentWeekDates.has(toDateStr(d)));

  const weekAbsences = absences
    .filter(a => a.end_date >= weekStart && a.start_date <= weekEnd && activeCategories.has(a.type))
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.person_name.localeCompare(b.person_name));

  // Distinguish single-click (open day panel) from double-click (jump to week)
  const handleCellInteraction = (ds, e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      onDayDoubleClick(ds);
      return;
    }
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      onDayClick(ds, rect);
    }, 220);
  };

  return (
    <div className={`absence-week-row${isCurrentWeek ? ' absence-week-row--current-week' : ''}`}>
      {week.map((day, col) => {
        const ds = toDateStr(day);
        const isThisMonth = day.getUTCMonth() === viewMonth;
        const isToday = ds === todayStr;
        const isPanelDay = ds === dayPanelDate;
        return (
          <div
            key={col}
            className={`absence-day-cell${isPanelDay ? ' absence-day-cell--selected' : ''}`}
            onClick={(e) => handleCellInteraction(ds, e)}
          >
            <span className={`absence-day-num${isToday ? ' absence-day-num--today' : ''}${!isThisMonth ? ' absence-day-num--other' : ''}`}>
              {day.getUTCDate()}
            </span>
          </div>
        );
      })}

      {weekAbsences.length > 0 && (
        <div className="absence-bars-layer" style={{ pointerEvents: 'none' }}>
          {weekAbsences.map((absence, laneIdx) => {
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
                {absence.type === 'Partial' && <Clock size={9} style={{ flexShrink: 0, marginLeft: 3, opacity: 0.9 }} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Upcoming panel ───────────────────────────────────────────────────────────

function UpcomingPanel({ absences, personByKey, todayStr, onAbsenceClick, activeCategories }) {
  const cutoff = (() => { const d = parseUTC(todayStr); d.setUTCDate(d.getUTCDate() + 30); return toDateStr(d); })();
  const upcoming = absences
    .filter(a => a.end_date >= todayStr && a.start_date <= cutoff && activeCategories.has(a.type))
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  return (
    <div className="absence-upcoming-section">
      <div className="absence-upcoming-title">Upcoming 30 days</div>
      <div className="absence-upcoming-list">
        {upcoming.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '16px 0', textAlign: 'center' }}>No upcoming absences</div>
        )}
        {upcoming.map(a => {
          const person = personByKey.get(a.person_name);
          const color  = colorOf(a.type);
          return (
            <div key={a.id} className="absence-upcoming-item" onClick={() => onAbsenceClick(a)}>
              <div className="absence-upcoming-dot" style={{ background: color }} />
              <div className="absence-upcoming-info">
                <div className="absence-upcoming-name">{person?.name ?? a.person_name}</div>
                <div className="absence-upcoming-detail">
                  {labelOf(a.type)} · {formatRange(a.start_date, a.end_date)}
                  {a.type === 'Partial' && a.partial_start && (
                    <span style={{ marginLeft: 4, opacity: 0.7 }}>({a.partial_start}–{a.partial_end})</span>
                  )}
                </div>
                {a.note && <div className="absence-upcoming-note">{a.note}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Day panel (anchored near clicked cell) ───────────────────────────────────

function DayPanel({ dateStr, rect, absences, personByKey, onClose, onJumpAndClose, onAddAbsence, onAbsenceClick }) {
  const dayAbsences = absences.filter(a => a.start_date <= dateStr && a.end_date >= dateStr);
  const d = parseUTC(dateStr);
  const dateLabel = `${DOW[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()].slice(0, 3)} ${d.getUTCDate()}`;

  const panelWidth = 264;
  let left = Math.round(rect.left);
  if (left + panelWidth > window.innerWidth - 12) left = window.innerWidth - panelWidth - 12;
  if (left < 8) left = 8;
  let top = Math.round(rect.bottom + 6);
  if (top + 220 > window.innerHeight - 8) top = Math.round(rect.top) - 226;
  if (top < 8) top = 8;

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
      <div className="day-panel-absence-list">
        {dayAbsences.length === 0 && (
          <div className="day-panel-empty">No absences this day</div>
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
        <button className="btn btn-pill" style={{ fontSize: 11, minHeight: 26 }} onClick={onJumpAndClose}>
          Go to this week
        </button>
        <button
          className="btn btn-pill btn-primary"
          style={{ fontSize: 11, minHeight: 26, gap: 4 }}
          onClick={() => onAddAbsence(dateStr)}
        >
          <Plus size={11} /> Add absence
        </button>
      </div>
    </div>
  );
}

// ─── History view ─────────────────────────────────────────────────────────────

function AbsenceHistory({ absences, people, personByKey, onAbsenceClick }) {
  const [selectedKey, setSelectedKey] = useState('');
  const [selectedYear, setSelectedYear] = useState('all');
  const [activeTypes, setActiveTypes] = useState(new Set(ABSENCE_TYPES.map(t => t.key)));

  // All years present in absences data
  const allYears = [...new Set(absences.map(a => a.start_date.slice(0, 4)))].sort().reverse();

  const personAbsences = absences.filter(a => {
    if (selectedKey && a.person_name !== selectedKey) return false;
    if (selectedYear !== 'all' && !a.start_date.startsWith(selectedYear)) return false;
    if (!activeTypes.has(a.type)) return false;
    return true;
  }).sort((a, b) => b.start_date.localeCompare(a.start_date));

  // Summary counts by category for selected person + year (ignoring type filter for summary)
  const summaryBase = absences.filter(a => {
    if (selectedKey && a.person_name !== selectedKey) return false;
    if (selectedYear !== 'all' && !a.start_date.startsWith(selectedYear)) return false;
    return true;
  });
  const counts = Object.fromEntries(ABSENCE_TYPES.map(t => [
    t.key,
    summaryBase.filter(a => a.type === t.key).length,
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
          <option value="">All staff</option>
          {[...people].sort((a, b) => a.name.localeCompare(b.name)).map(p => (
            <option key={p.id} value={p.name.trim().toLowerCase()}>{p.name}</option>
          ))}
        </select>

        {/* Year filter */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button
            className={`pill small${selectedYear === 'all' ? ' active' : ''}`}
            onClick={() => setSelectedYear('all')}
          >All time</button>
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
              : 'All staff — '
            }
            {selectedYear !== 'all' ? selectedYear : 'all time'} · {totalDays} day{totalDays !== 1 ? 's' : ''} total
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
            {selectedKey ? 'No absences recorded for this person' : 'No absences match the selected filters'}
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
                {a.type === 'Partial' && a.partial_start && (
                  <span style={{ opacity: 0.7, fontSize: 10, marginLeft: 5 }}>
                    {a.partial_start}–{a.partial_end}
                  </span>
                )}
              </div>
              {a.note && <div className="absence-history-row-note">{a.note}</div>}
              {a.entered_by && (
                <div className="absence-history-row-meta">entered by {a.entered_by}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main calendar ────────────────────────────────────────────────────────────

export default function AbsenceCalendar({ onClose, currentWeek, onJumpToWeek }) {
  const { data, absences, addAbsence, editAbsence, removeAbsence, managerInitials, addLog } = useApp();
  const people      = data.people ?? [];
  const doctors     = (data.providers ?? []).map(p => p.name);
  const personByKey = useMemo(
    () => new Map(people.map(p => [p.name.trim().toLowerCase(), p])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.people],
  );

  const todayStr = toDateStr(new Date());

  // Open focused on the month containing the currently viewed board week
  const initMonday = currentWeek ? mondayOfWeek(currentWeek) : new Date();
  const [view,      setView]      = useState('calendar'); // 'calendar' | 'history'
  const [viewYear,  setViewYear]  = useState(initMonday.getUTCFullYear());
  const [viewMonth, setViewMonth] = useState(initMonday.getUTCMonth());
  const [modal,     setModal]     = useState(null);
  const [dayPanel,  setDayPanel]  = useState(null); // { dateStr, rect }

  // Category filter chips — all on by default
  const [activeCategories, setActiveCategories] = useState(
    () => new Set(SELECTABLE_TYPES.map(t => t.key)),
  );
  const toggleCategory = useCallback((key) => {
    setActiveCategories(prev => {
      const next = new Set(prev);
      if (next.has(key)) { if (next.size > 1) next.delete(key); }
      else next.add(key);
      return next;
    });
  }, []);

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

  // Escape layering: modal → dayPanel → calendar
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') {
        if (modal)    { setModal(null);    return; }
        if (dayPanel) { setDayPanel(null); return; }
        onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [modal, dayPanel, onClose]);

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

  return (
    <div className="absence-overlay">
      <div className="absence-panel">

        {/* ── Header ── */}
        <div className="absence-header">
          {view === 'calendar' ? (
            <>
              <button className="btn btn-icon" onClick={prevMonth} title="Previous month"><ChevronLeft size={16} /></button>
              <span className="absence-month-label">{MONTHS[viewMonth]} {viewYear}</span>
              <button className="btn btn-icon" onClick={nextMonth} title="Next month"><ChevronRight size={16} /></button>
              <button className="btn btn-pill" style={{ fontSize: 11, minHeight: 26, padding: '2px 10px' }} onClick={goToday}>
                This month
              </button>
            </>
          ) : (
            <span className="absence-month-label" style={{ paddingLeft: 4 }}>Absence History</span>
          )}
          <div style={{ flex: 1 }} />
          {/* View toggle */}
          <button
            className={`btn btn-pill topbar-mobile-hidden${view === 'history' ? ' active' : ''}`}
            style={{ fontSize: 11, minHeight: 26, padding: '2px 10px', gap: 4 }}
            onClick={() => setView(v => v === 'calendar' ? 'history' : 'calendar')}
            title={view === 'calendar' ? 'View absence history' : 'Back to calendar'}
          >
            <History size={13} />
            {view === 'calendar' ? 'History' : 'Calendar'}
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
              <Legend activeCategories={activeCategories} onToggle={toggleCategory} />
              <div className="absence-grid">
                {grid.map((week, wi) => (
                  <WeekRow
                    key={wi}
                    week={week}
                    viewMonth={viewMonth}
                    absences={absences}
                    personByKey={personByKey}
                    todayStr={todayStr}
                    onDayClick={handleDayClick}
                    onDayDoubleClick={handleDayDoubleClick}
                    onAbsenceClick={handleAbsenceClick}
                    activeCategories={activeCategories}
                    currentWeekDates={currentWeekDates}
                    dayPanelDate={dayPanel?.dateStr ?? null}
                  />
                ))}
              </div>
            </div>
            <UpcomingPanel
              absences={absences}
              personByKey={personByKey}
              todayStr={todayStr}
              onAbsenceClick={handleAbsenceClick}
              activeCategories={activeCategories}
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

      {/* Day panel — anchored near clicked cell, above modal layer */}
      {dayPanel && !modal && (
        <DayPanel
          dateStr={dayPanel.dateStr}
          rect={dayPanel.rect}
          absences={absences}
          personByKey={personByKey}
          onClose={() => setDayPanel(null)}
          onJumpAndClose={() => {
            if (onJumpToWeek) onJumpToWeek(isoWeek(parseUTC(dayPanel.dateStr)));
            onClose();
          }}
          onAddAbsence={(ds) => {
            setDayPanel(null);
            setModal({ mode: 'add', initStart: ds, initEnd: ds });
          }}
          onAbsenceClick={handleAbsenceClick}
        />
      )}

      {modal && (
        <AbsenceModal
          mode={modal.mode}
          initStart={modal.initStart}
          initEnd={modal.initEnd}
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
    </div>
  );
}
