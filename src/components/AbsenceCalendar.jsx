import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronLeft, ChevronRight, X, Clock, Plus, Trash2, AlertCircle } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';

// ─── Date helpers ─────────────────────────────────────────────────────────────

function toDateStr(d) { return d.toISOString().slice(0, 10); }
function parseUTC(str) { return new Date(str + 'T00:00:00Z'); }

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

const TYPE_OPTIONS = ['Vacation', 'Sick', 'Personal', 'Partial'];
const TYPE_COLOR = { Vacation: '#3b82f6', Sick: '#ef4444', Personal: '#8b5cf6', Partial: '#f59e0b' };

function formatDateDisplay(str) {
  const d = parseUTC(str);
  return `${MONTHS[d.getUTCMonth()].slice(0,3)} ${d.getUTCDate()}`;
}
function formatRange(start, end) {
  if (start === end) return formatDateDisplay(start);
  const s = parseUTC(start), e = parseUTC(end);
  if (s.getUTCFullYear() === e.getUTCFullYear()) {
    if (s.getUTCMonth() === e.getUTCMonth())
      return `${formatDateDisplay(start)}–${e.getUTCDate()}`;
    return `${formatDateDisplay(start)} – ${formatDateDisplay(end)}`;
  }
  return `${formatDateDisplay(start)} – ${formatDateDisplay(end)}, ${e.getUTCFullYear()}`;
}

// Build 6-row × 7-col grid (Sun→Sat) for the given year/month (0-indexed)
function buildGrid(year, month) {
  const firstDay = new Date(Date.UTC(year, month, 1));
  const dow = firstDay.getUTCDay(); // 0=Sun
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

// ─── Absence modal ────────────────────────────────────────────────────────────

function AbsenceModal({ mode, initStart, initEnd, absence, people, absences, managerInitials, onSave, onDelete, onClose }) {
  const isEdit = mode === 'edit';
  const [personKey, setPersonKey] = useState(absence?.person_name ?? '');
  const [type,      setType]      = useState(absence?.type ?? 'Vacation');
  const [startD,    setStartD]    = useState(absence?.start_date ?? initStart ?? '');
  const [endD,      setEndD]      = useState(absence?.end_date   ?? initEnd   ?? '');
  const [pStart,    setPStart]    = useState(absence?.partial_start ?? '08:00');
  const [pEnd,      setPEnd]      = useState(absence?.partial_end   ?? '12:00');
  const [note,      setNote]      = useState(absence?.note ?? '');
  const [saving,    setSaving]    = useState(false);
  const [deleting,  setDeleting]  = useState(false);
  const [dupWarning, setDupWarning] = useState(null); // overlap entry or null

  // Soft duplicate check
  const checkDup = useCallback(() => {
    if (!personKey || !startD || !endD) return null;
    const dup = absences.find(a => {
      if (isEdit && a.id === absence?.id) return false;
      return a.person_name === personKey && a.end_date >= startD && a.start_date <= endD;
    });
    return dup ?? null;
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
  const canSubmit = personKey && startD && endD && startD <= endD;

  return (
    <div className="overlay-backdrop" style={{ zIndex: 310 }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="overlay-modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="overlay-header">
          <span style={{ fontWeight: 600, fontSize: 15 }}>{isEdit ? 'Edit absence' : 'Add absence'}</span>
          <button className="overlay-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="overlay-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Person */}
          <div>
            <label className="setup-label">Person</label>
            <select className="setup-input" value={personKey} onChange={e => setPersonKey(e.target.value)}>
              <option value="">— select —</option>
              {[...people].sort((a,b) => a.name.localeCompare(b.name)).map(p => (
                <option key={p.id} value={p.name.trim().toLowerCase()}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Type */}
          <div>
            <label className="setup-label">Type</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {TYPE_OPTIONS.map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className="pill"
                  style={{
                    background: type === t ? TYPE_COLOR[t] : undefined,
                    borderColor: type === t ? TYPE_COLOR[t] : undefined,
                    color: type === t ? '#fff' : undefined,
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Dates */}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label className="setup-label">Start date</label>
              <input type="date" className="setup-input" value={startD} onChange={e => { setStartD(e.target.value); if (e.target.value > endD) setEndD(e.target.value); }} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="setup-label">End date</label>
              <input type="date" className="setup-input" value={endD} min={startD} onChange={e => setEndD(e.target.value)} />
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
            <input className="setup-input" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. pre-approved, FMLA…" />
          </div>

          {/* Duplicate warning */}
          {dupWarning && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '10px 12px', background: 'rgba(245,158,11,0.1)', borderRadius: 8, border: '0.5px solid rgba(245,158,11,0.4)' }}>
              <AlertCircle size={14} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                <strong>{person?.name ?? dupWarning.person_name}</strong> already has <em>{dupWarning.type}</em>{' '}
                ({formatRange(dupWarning.start_date, dupWarning.end_date)}) overlapping these dates.
                <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary btn-pill" style={{ fontSize: 11, minHeight: 26 }} onClick={() => handleSubmit(true)} disabled={saving}>
                    {saving ? 'Adding…' : 'Add anyway'}
                  </button>
                  <button className="btn btn-pill" style={{ fontSize: 11, minHeight: 26 }} onClick={() => setDupWarning(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', padding: '12px 24px', borderTop: '0.5px solid var(--border)', flexShrink: 0 }}>
          <div>
            {isEdit && (
              <button className="btn btn-pill" style={{ fontSize: 12, color: '#dc2626', borderColor: '#dc2626' }} onClick={handleDelete} disabled={deleting}>
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

function WeekRow({ week, viewMonth, absences, personByKey, todayStr, dragStart, dragEnd, onDayMouseDown, onDayMouseEnter, onDayClick, onAbsenceClick }) {
  const weekStart = toDateStr(week[0]);
  const weekEnd   = toDateStr(week[6]);

  const dragMin = dragStart && dragEnd ? (dragStart < dragEnd ? dragStart : dragEnd) : dragStart;
  const dragMax = dragStart && dragEnd ? (dragStart > dragEnd ? dragStart : dragEnd) : dragStart;

  // Absences overlapping this week, sorted stably for lane assignment
  const weekAbsences = absences
    .filter(a => a.end_date >= weekStart && a.start_date <= weekEnd)
    .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.person_name.localeCompare(b.person_name));

  return (
    <div className="absence-week-row">
      {/* Day cells */}
      {week.map((day, col) => {
        const ds = toDateStr(day);
        const isThisMonth = day.getUTCMonth() === viewMonth;
        const isToday = ds === todayStr;
        const inDrag = dragMin && dragMax && ds >= dragMin && ds <= dragMax;
        return (
          <div
            key={col}
            className={`absence-day-cell${inDrag ? ' absence-day-cell--drag' : ''}`}
            onMouseDown={() => onDayMouseDown(ds)}
            onMouseEnter={() => onDayMouseEnter(ds)}
            onClick={() => onDayClick(ds)}
          >
            <span className={`absence-day-num${isToday ? ' absence-day-num--today' : ''}${!isThisMonth ? ' absence-day-num--other' : ''}`}>
              {day.getUTCDate()}
            </span>
          </div>
        );
      })}

      {/* Bars overlay — absolutely positioned over the week row */}
      {weekAbsences.length > 0 && (
        <div className="absence-bars-layer" style={{ pointerEvents: 'none' }}>
          {weekAbsences.map((absence, laneIdx) => {
            const barStart = absence.start_date < weekStart ? weekStart : absence.start_date;
            const barEnd   = absence.end_date   > weekEnd   ? weekEnd   : absence.end_date;
            const startCol = week.findIndex(d => toDateStr(d) === barStart);
            const endCol   = week.findIndex(d => toDateStr(d) === barEnd);
            if (startCol < 0 || endCol < 0) return null;

            const person = personByKey.get(absence.person_name);
            const color  = person?.color ?? TYPE_COLOR[absence.type] ?? '#6b7280';
            const label  = `${person?.name ?? absence.person_name} · ${absence.type}`;
            const isStart = absence.start_date >= weekStart;
            const isEnd   = absence.end_date   <= weekEnd;

            return (
              <div
                key={absence.id}
                className="absence-bar"
                style={{
                  left:    `calc(${startCol} / 7 * 100% + 2px)`,
                  width:   `calc(${endCol - startCol + 1} / 7 * 100% - 4px)`,
                  top:     `${30 + laneIdx * 22}px`,
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

function UpcomingPanel({ absences, personByKey, todayStr, onAbsenceClick }) {
  const cutoff = (() => { const d = parseUTC(todayStr); d.setUTCDate(d.getUTCDate() + 30); return toDateStr(d); })();
  const upcoming = absences
    .filter(a => a.end_date >= todayStr && a.start_date <= cutoff)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  return (
    <div className="absence-upcoming-section">
      <div className="absence-upcoming-title">Upcoming 30 days</div>
      <div className="absence-upcoming-list">
        {upcoming.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '12px 0', textAlign: 'center' }}>No upcoming absences</div>
        )}
        {upcoming.map(a => {
          const person = personByKey.get(a.person_name);
          const color  = person?.color ?? TYPE_COLOR[a.type] ?? '#6b7280';
          return (
            <div key={a.id} className="absence-upcoming-item" onClick={() => onAbsenceClick(a)}>
              <div className="absence-upcoming-dot" style={{ background: color }} />
              <div className="absence-upcoming-info">
                <div className="absence-upcoming-name">{person?.name ?? a.person_name}</div>
                <div className="absence-upcoming-detail">
                  {a.type} · {formatRange(a.start_date, a.end_date)}
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

// ─── Main calendar ────────────────────────────────────────────────────────────

export default function AbsenceCalendar({ onClose }) {
  const { data, absences, addAbsence, editAbsence, removeAbsence, managerInitials, addLog } = useApp();
  const people    = data.people ?? [];
  const personByKey = new Map(people.map(p => [p.name.trim().toLowerCase(), p]));

  const todayStr = toDateStr(new Date());
  const todayDate = new Date();

  const [viewYear,  setViewYear]  = useState(todayDate.getUTCFullYear());
  const [viewMonth, setViewMonth] = useState(todayDate.getUTCMonth());
  const [modal,     setModal]     = useState(null);

  // Drag state
  const [dragStart, setDragStart] = useState(null);
  const [dragEnd,   setDragEnd]   = useState(null);
  const dragging = useRef(false);

  const grid = buildGrid(viewYear, viewMonth);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };
  const goToday = () => { setViewYear(todayDate.getUTCFullYear()); setViewMonth(todayDate.getUTCMonth()); };

  // Drag handlers
  const handleDayMouseDown = useCallback((ds) => {
    dragging.current = true;
    setDragStart(ds);
    setDragEnd(ds);
  }, []);

  const handleDayMouseEnter = useCallback((ds) => {
    if (dragging.current) setDragEnd(ds);
  }, []);

  const handleDayClick = useCallback((ds) => {
    if (dragging.current) {
      const start = dragStart < ds ? dragStart : ds;
      const end   = dragStart > ds ? dragStart : ds;
      dragging.current = false;
      setDragStart(null);
      setDragEnd(null);
      setModal({ mode: 'add', initStart: start, initEnd: end });
    }
  }, [dragStart]);

  // Global mouseup to end drag
  useEffect(() => {
    const onUp = () => {
      if (dragging.current && dragStart) {
        const start = dragStart < dragEnd ? dragStart : dragEnd ?? dragStart;
        const end   = dragStart > dragEnd ? dragStart : dragEnd ?? dragStart;
        dragging.current = false;
        setDragStart(null);
        setDragEnd(null);
        setModal({ mode: 'add', initStart: start, initEnd: end });
      }
    };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [dragStart, dragEnd]);

  const handleAbsenceClick = useCallback((absence) => {
    setModal({ mode: 'edit', absence });
  }, []);

  const handleSave = useCallback(async (...args) => {
    let result;
    if (modal?.mode === 'edit') {
      result = await editAbsence(...args);
      if (!result.error) {
        const person = personByKey.get(args[1]?.person_name ?? modal?.absence?.person_name);
        addLog({ action: 'Absence updated', personName: person?.name ?? args[1]?.person_name ?? '?', day: '', detail: `${args[1]?.type} ${formatRange(args[1]?.start_date, args[1]?.end_date)}` });
      }
    } else {
      result = await addAbsence(...args);
      if (!result.error) {
        const person = personByKey.get(args[0]?.person_name);
        addLog({ action: 'Absence added', personName: person?.name ?? args[0]?.person_name ?? '?', day: '', detail: `${args[0]?.type} ${formatRange(args[0]?.start_date, args[0]?.end_date)}` });
      }
    }
    if (!result.error) setModal(null);
  }, [modal, addAbsence, editAbsence, addLog, personByKey]);

  const handleDelete = useCallback(async (id) => {
    const absence = modal?.absence;
    const result = await removeAbsence(id);
    if (!result.error) {
      const person = personByKey.get(absence?.person_name);
      addLog({ action: 'Absence removed', personName: person?.name ?? absence?.person_name ?? '?', day: '', detail: `${absence?.type} ${formatRange(absence?.start_date, absence?.end_date)}` });
      setModal(null);
    }
  }, [modal, removeAbsence, addLog, personByKey]);

  return (
    <div className="absence-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="absence-panel">
        {/* Header */}
        <div className="absence-header">
          <button className="btn btn-icon" onClick={prevMonth} title="Previous month"><ChevronLeft size={16} /></button>
          <span className="absence-month-label">{MONTHS[viewMonth]} {viewYear}</span>
          <button className="btn btn-icon" onClick={nextMonth} title="Next month"><ChevronRight size={16} /></button>
          <button className="btn btn-pill" style={{ fontSize: 11, minHeight: 26, padding: '2px 10px' }} onClick={goToday}>
            This month
          </button>
          <div style={{ flex: 1 }} />
          <button
            className="btn btn-pill"
            style={{ fontSize: 11, minHeight: 26, padding: '2px 10px', gap: 4 }}
            onClick={() => setModal({ mode: 'add', initStart: todayStr, initEnd: todayStr })}
          >
            <Plus size={12} /> Add
          </button>
          <button className="btn btn-icon" onClick={onClose} title="Close"><X size={16} /></button>
        </div>

        {/* Body: calendar + upcoming */}
        <div className="absence-body">
          <div className="absence-cal-section">
            {/* Day-of-week headers */}
            <div className="absence-dow-row">
              {DOW.map(d => <div key={d} className="absence-dow-cell">{d}</div>)}
            </div>

            {/* Month grid */}
            <div className="absence-grid">
              {grid.map((week, wi) => (
                <WeekRow
                  key={wi}
                  week={week}
                  viewMonth={viewMonth}
                  absences={absences}
                  personByKey={personByKey}
                  todayStr={todayStr}
                  dragStart={dragStart}
                  dragEnd={dragEnd}
                  onDayMouseDown={handleDayMouseDown}
                  onDayMouseEnter={handleDayMouseEnter}
                  onDayClick={handleDayClick}
                  onAbsenceClick={handleAbsenceClick}
                />
              ))}
            </div>
          </div>

          <UpcomingPanel
            absences={absences}
            personByKey={personByKey}
            todayStr={todayStr}
            onAbsenceClick={handleAbsenceClick}
          />
        </div>
      </div>

      {/* Add / edit modal */}
      {modal && (
        <AbsenceModal
          mode={modal.mode}
          initStart={modal.initStart}
          initEnd={modal.initEnd}
          absence={modal.absence}
          people={people}
          absences={absences}
          managerInitials={managerInitials}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
