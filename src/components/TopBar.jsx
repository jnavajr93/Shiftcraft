import { useState, useEffect, useRef } from 'react';
import {
  Calendar, Sun, Moon, ChevronLeft, ChevronRight,
  History, Printer, Sparkles, Wand2, Loader2, X, CircleHelp, RotateCcw,
  Download, Upload, SendHorizonal, AlertCircle,
} from 'lucide-react';
import { useApp, isoWeek, mondayOfWeek } from '../context/AppContext.jsx';

const EXPORT_VERSION = 'shiftcraft-v1';
import { useTour } from './Tour.jsx';
import ChangeLogDrawer from './ChangeLogDrawer.jsx';
import ChatPanel from './ChatPanel.jsx';
import { generateSchedule } from '../engine/adapter.js';
import { validateAndRepairAssignments, findObsViolations, findInvalidSlotAssignments, getPostViolations } from '../engine/validator.js';

// ─── Post helpers ────────────────────────────
function formatPostedTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Open a print window with a formatted schedule grid
function generatePrintWindow(data, weekLabel, weekMonday, postedBy) {
  const DAYS_LIST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const LOC_ORDER = ['Phoenix', 'Chandler', 'Estrella', 'Scottsdale', 'OBS'];
  const personById = new Map((data.people ?? []).map(p => [p.id, p]));

  const dayDates = DAYS_LIST.map((day, i) => {
    const d = new Date(weekMonday);
    d.setUTCDate(weekMonday.getUTCDate() + i);
    return `${day} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  });

  const allLocs = [...new Set(data.clinics.filter(c => c.open).map(c => c.location))];
  const extras = allLocs.filter(l => !LOC_ORDER.includes(l)).sort();
  const locations = [...LOC_ORDER, ...extras].filter(l => allLocs.includes(l));

  const getPersonId = (sv) => {
    if (!sv) return null;
    if (typeof sv === 'string') return sv;
    return sv.personId ?? null;
  };

  let rows = '';
  for (const loc of locations) {
    let cells = `<td class="lc">${loc}</td>`;
    for (const day of DAYS_LIST) {
      const clinic = data.clinics.find(c => c.day === day && c.location === loc && c.open);
      if (!clinic) { cells += '<td></td>'; continue; }
      let content = clinic.provider ? `<div class="pv">${clinic.provider}</div>` : '';
      for (const [st, sv] of Object.entries(clinic.slots ?? {})) {
        const pid = getPersonId(sv);
        if (!pid) continue;
        const p = personById.get(pid);
        if (!p) continue;
        const lbl = st.replace(/([A-Z])/g, ' $1').trim();
        content += `<div class="sl"><span class="sr">${lbl}:</span> ${p.name}</div>`;
      }
      if (!content) content = '<span class="em">—</span>';
      cells += `<td>${content}</td>`;
    }
    rows += `<tr>${cells}</tr>`;
  }

  const generatedAt = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const html = `<!DOCTYPE html><html><head><title>Shiftcraft — Week of ${weekLabel}</title>
<style>
@media print{@page{size:landscape;margin:0.4in}}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,Arial,sans-serif;font-size:9px;color:#111}
h1{font-size:13px;font-weight:700;margin-bottom:8px}
table{border-collapse:collapse;width:100%;table-layout:fixed}
th,td{border:0.5px solid #bbb;padding:4px 5px;vertical-align:top}
th{background:#f3f4f6;font-weight:600;text-align:center;font-size:9px}
.lc{font-weight:700;background:#f9fafb;width:72px}
.pv{font-weight:600;font-size:8.5px;margin-bottom:2px;color:#444}
.sl{font-size:8px;line-height:1.45}
.sr{color:#777}
.em{color:#aaa;font-style:italic}
footer{margin-top:8px;font-size:7.5px;color:#666;display:flex;justify-content:space-between}
</style></head><body>
<h1>Shiftcraft — Week of ${weekLabel}</h1>
<table><thead><tr><th style="width:72px">Location</th>${dayDates.map(d => `<th>${d}</th>`).join('')}</tr></thead>
<tbody>${rows}</tbody></table>
<footer><span>Generated ${generatedAt}</span><span>Posted by ${postedBy ?? '—'}</span></footer>
<script>window.onload=function(){window.print()}</script>
</body></html>`;

  const win = window.open('', '_blank');
  if (win) { win.document.write(html); win.document.close(); }
}

// ─── Post validation modal ───────────────────
function PostValidationModal({ violations, onClose, onJump, setActiveTab }) {
  return (
    <div className="overlay-backdrop" style={{ zIndex: 260 }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="overlay-modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div className="overlay-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={16} style={{ color: 'var(--red)' }} />
            <span style={{ fontWeight: 600, fontSize: 15 }}>Cannot post — fix these issues first</span>
          </div>
          <button className="overlay-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="overlay-body" style={{ maxHeight: 320, overflowY: 'auto' }}>
          <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {violations.map((v, i) => (
              <li key={i}>
                <button
                  onClick={() => onJump(v, setActiveTab)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                    display: 'flex', alignItems: 'flex-start', gap: 8, width: '100%',
                    padding: '6px 8px', borderRadius: 6,
                    color: v.type === 'timeless' ? 'var(--red)' : 'var(--amber)',
                  }}
                  className="post-violation-row"
                >
                  <span style={{ flexShrink: 0, marginTop: 1 }}>●</span>
                  <span style={{ fontSize: 13, lineHeight: 1.4 }}>{v.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div style={{ padding: '12px 24px', borderTop: '0.5px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── Post confirmation modal ─────────────────
function PostConfirmModal({ weekLabel, onConfirm, onCancel }) {
  return (
    <div className="overlay-backdrop" style={{ zIndex: 260 }} onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="overlay-modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
        <div className="overlay-header">
          <div style={{ fontWeight: 500, fontSize: 16 }}>Post Week of {weekLabel}?</div>
          <button className="overlay-close" onClick={onCancel}><X size={16} /></button>
        </div>
        <div className="overlay-body">
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
            This will publish the schedule to all staff immediately. A JSON backup and a printable PDF will download automatically.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 24px', borderTop: '0.5px solid var(--border)', flexShrink: 0 }}>
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" style={{ minHeight: 40, gap: 6 }} onClick={onConfirm}>
            <SendHorizonal size={14} /> Post + Export
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Exit nudge modal ────────────────────────
function ExitNudgeModal({ postedSnapshot, onPost, onLeave }) {
  return (
    <div className="overlay-backdrop" style={{ zIndex: 300, backdropFilter: 'blur(4px)' }} onClick={e => { if (e.target === e.currentTarget) onLeave(); }}>
      <div className="overlay-modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
        <div className="overlay-header">
          <div style={{ fontWeight: 600, fontSize: 15 }}>Unposted changes</div>
        </div>
        <div className="overlay-body">
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {postedSnapshot
              ? 'This week has changes that staff haven\'t seen yet. Post before leaving manager mode?'
              : 'This week hasn\'t been posted yet — staff can\'t see it. Post before leaving manager mode?'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 24px', borderTop: '0.5px solid var(--border)', flexShrink: 0 }}>
          <button className="btn" onClick={onLeave}>Leave anyway</button>
          <button className="btn btn-primary" style={{ minHeight: 38, gap: 6 }} onClick={onPost}>
            <SendHorizonal size={13} /> Post
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Generate confirmation modal ─────────────
function GenerateModal({ weekLabel, keepExisting, onKeepChange, onConfirm, onCancel, isRegen }) {
  return (
    <div
      className="overlay-backdrop"
      style={{ zIndex: 250 }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="overlay-modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
        <div className="overlay-header">
          <div>
            <div style={{ fontWeight: 500, fontSize: 16 }}>
              Generate schedule for Week of {weekLabel}?
            </div>
          </div>
          <button className="overlay-close" onClick={onCancel}><X size={16} /></button>
        </div>
        <div className="overlay-body">
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
            {isRegen
              ? 'This will replace the current AI-generated assignments. Claude will re-fill all slots based on your current configuration.'
              : 'Claude will fill all empty slots based on your staff settings, skills, availability, and clinic configuration. Existing assignments will be replaced.'}
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, color: 'var(--text-primary)' }}>
            <input
              type="checkbox"
              checked={keepExisting}
              onChange={e => onKeepChange(e.target.checked)}
              style={{ width: 15, height: 15, cursor: 'pointer' }}
            />
            Keep existing assignments — only fill empty slots
          </label>
        </div>
        <div style={{
          display: 'flex', gap: 8, justifyContent: 'flex-end',
          padding: '12px 24px', borderTop: '0.5px solid var(--border)', flexShrink: 0,
        }}>
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" style={{ minHeight: 40 }} onClick={onConfirm}>
            <Wand2 size={15} /> Generate
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Clear Week confirmation modal ───────────────
function ClearWeekModal({ weekLabel, onConfirm, onCancel }) {
  return (
    <div
      className="overlay-backdrop"
      style={{ zIndex: 250 }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="overlay-modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
        <div className="overlay-header">
          <div style={{ fontWeight: 500, fontSize: 16 }}>Clear this week's schedule?</div>
          <button className="overlay-close" onClick={onCancel}><X size={16} /></button>
        </div>
        <div className="overlay-body">
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
            This will remove all staff assignments for <strong>Week of {weekLabel}</strong>.
            Clinic settings and times are kept. This cannot be undone.
          </p>
        </div>
        <div style={{
          display: 'flex', gap: 8, justifyContent: 'flex-end',
          padding: '12px 24px', borderTop: '0.5px solid var(--border)', flexShrink: 0,
        }}>
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-danger" style={{ minHeight: 40 }} onClick={onConfirm}>
            Clear Week
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Manager unlock modal (PIN + initials) ───────
const ADMIN_PIN = '0000';

function ManagerModal({ onSuccess, onCancel }) {
  const [digits, setDigits] = useState(['', '', '', '']);
  const [initials, setInitials] = useState('');
  const [pinError, setPinError] = useState(false);
  const [initialsError, setInitialsError] = useState(false);
  const [shake, setShake] = useState(false);
  const refs = [useRef(), useRef(), useRef(), useRef()];
  const initialsRef = useRef();

  useEffect(() => {
    refs[0].current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validateInitials = (val) => /^[A-Za-z]{2,3}$/.test(val);

  const submit = (ds, inits) => {
    const pinOk = ds.join('') === ADMIN_PIN;
    const initialsOk = validateInitials(inits);
    if (!pinOk) {
      setShake(true);
      setPinError(true);
      setDigits(['', '', '', '']);
      setTimeout(() => {
        setShake(false);
        refs[0].current?.focus();
      }, 500);
    }
    if (!initialsOk) {
      setInitialsError(true);
    }
    if (pinOk && initialsOk) {
      onSuccess(inits.toUpperCase());
    }
  };

  const handleChange = (i, val) => {
    const d = val.replace(/\D/g, '');
    if (!d) return;
    const next = [...digits];
    next[i] = d[d.length - 1];
    setDigits(next);
    setPinError(false);
    if (i < 3) refs[i + 1].current?.focus();
    else initialsRef.current?.focus();
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const raw = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 4);
    if (!raw) return;
    const next = ['', '', '', ''].map((_, i) => raw[i] ?? '');
    setDigits(next);
    setPinError(false);
    if (raw.length === 4) {
      refs[3].current?.focus();
      initialsRef.current?.focus();
    } else {
      refs[Math.min(raw.length, 3)].current?.focus();
    }
  };

  const handleKeyDown = (i, e) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      const next = [...digits];
      if (next[i]) {
        next[i] = '';
        setDigits(next);
      } else if (i > 0) {
        next[i - 1] = '';
        setDigits(next);
        refs[i - 1].current?.focus();
      }
      setPinError(false);
    }
  };

  const handleInitialsChange = (e) => {
    const val = e.target.value.replace(/[^A-Za-z]/g, '').slice(0, 3);
    setInitials(val);
    setInitialsError(false);
  };

  const canSubmit = digits.every(d => d !== '') && initials.trim().length >= 2;

  return (
    <div
      className="overlay-backdrop"
      style={{ zIndex: 300, backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        className="overlay-modal"
        style={{ maxWidth: 320, textAlign: 'center', padding: '32px 24px' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontWeight: 600, fontSize: 17, marginBottom: 6 }}>Manager access</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24 }}>Enter PIN and your initials</div>

        <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'left', marginBottom: 6 }}>PIN</div>
        <div
          style={{ display: 'flex', gap: 10, justifyContent: 'center', marginBottom: pinError ? 8 : 20 }}
          className={shake ? 'pin-shake' : ''}
        >
          {digits.map((d, i) => (
            <input
              key={i}
              ref={refs[i]}
              type="password"
              inputMode="numeric"
              maxLength={1}
              value={d}
              onChange={e => handleChange(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
              onPaste={handlePaste}
              style={{
                width: 48, height: 56, textAlign: 'center', fontSize: 24,
                fontWeight: 700, borderRadius: 8,
                border: `1.5px solid ${pinError ? '#dc2626' : 'var(--border-strong)'}`,
                background: 'var(--bg-elevated)',
                color: 'var(--text-primary)',
                outline: 'none',
                caretColor: 'transparent',
              }}
            />
          ))}
        </div>
        {pinError && (
          <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 12 }}>Incorrect PIN</div>
        )}

        <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'left', marginBottom: 6 }}>Your initials</div>
        <input
          ref={initialsRef}
          type="text"
          value={initials}
          onChange={handleInitialsChange}
          onKeyDown={e => { if (e.key === 'Enter' && canSubmit) submit(digits, initials); }}

          maxLength={3}
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '10px 12px', fontSize: 20, fontWeight: 700,
            textAlign: 'center', letterSpacing: 4,
            borderRadius: 8, marginBottom: initialsError ? 4 : 20,
            border: `1.5px solid ${initialsError ? '#dc2626' : 'var(--border-strong)'}`,
            background: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            outline: 'none',
            textTransform: 'uppercase',
          }}
        />
        {initialsError && (
          <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 12 }}>2–3 letters required</div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={() => submit(digits, initials)}
            disabled={!canSubmit}
          >
            Unlock
          </button>
        </div>
      </div>
    </div>
  );
}

const SYSTEM_PROMPT = `You are a scheduling engine for a medical eye clinic. You will receive the complete clinic configuration and staff roster for a week. Fill every clinic slot with appropriate staff.

HARD RULES (never violate):
1. No double-booking: each person appears in at most ONE slot across ALL clinics on any given day.
2. lockedTo: if a person's lockedTo array is non-empty, they may only be assigned to clinics whose provider matches one of those values.
3. daysOff: never assign someone on a day listed in their daysOff.
4. availabilityWindows: if a person has endNoLater for a given day, their shift must end at or before that time (in minutes from midnight). Closing slot ends at clinic endTime — skip if endTime > endNoLater.
5. Role requirements: scribe slot → person must have 'Scribe' in roles. opener slot → 'Opener' in roles. closing slot → 'Closing' in roles. middle slot → 'Middle' in roles. training → any role.

SOFT RULES (follow when possible, in order of priority):
6. Known locks: Yadi → always Scribe at any Dr. B clinic. John → always Scribe at any Dr. R clinic. JC → always Scribe at any Dr. A clinic.
7. Grade priority: prefer grade A over B over C over T when multiple staff are eligible. T-grade staff are in training — use as last resort, below C, above ungraded.
8. Prefer staff at their preferredLocations.
9. Distribute hours fairly — try to keep everyone near their targetHours for the week.
10. Skills: prefer 'Autoclave & Closing' skill for closing slots; 'Treatments' skill for middle slots.

OUTPUT: respond ONLY with valid JSON, no explanation, no markdown, no code fences. Exact shape:
{"assignments":[{"clinicId":"string","slot":"scribe|opener|closing|middle|training","personId":"string"}]}

Only include slots that should be filled. Omit middle/training unless needed. If a slot cannot be filled, omit it entirely.`;

// ─── Week Date Picker ──────────────────────────
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_HDRS = ['Mo','Tu','We','Th','Fr','Sa','Su'];

function WeekDatePicker({ currentWeek, onSelectWeek, onClose, triggerRef, dirtyWeeks }) {
  const ref = useRef(null);
  const monday = mondayOfWeek(currentWeek);
  const [viewYear, setViewYear] = useState(monday.getUTCFullYear());
  const [viewMonth, setViewMonth] = useState(monday.getUTCMonth());

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target) &&
          !(triggerRef?.current && triggerRef.current.contains(e.target))) onClose();
    };
    const keyH = (e) => { if (e.key === 'Escape') onClose(); };
    const t = setTimeout(() => {
      document.addEventListener('mousedown', handler);
      document.addEventListener('keydown', keyH);
    }, 0);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', handler); document.removeEventListener('keydown', keyH); };
  }, [onClose, triggerRef]);

  const today = new Date();
  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y-1); } else setViewMonth(m => m-1); };
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y+1); } else setViewMonth(m => m+1); };

  // Build grid, Mon-start
  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const startOffset = firstDow === 0 ? 6 : firstDow - 1;
  const cells = Array.from({ length: 42 }, (_, i) => new Date(viewYear, viewMonth, 1 - startOffset + i));
  const showSix = cells.slice(35).some(d => d.getMonth() === viewMonth);
  const grid = showSix ? cells : cells.slice(0, 35);

  return (
    <div ref={ref} className="week-date-picker" onClick={e => e.stopPropagation()}>
      <div className="wdp-header">
        <button className="btn btn-icon" style={{ minHeight: 28, padding: '3px 6px' }} onClick={prevMonth}><ChevronLeft size={14} /></button>
        <span className="wdp-month-label">{MONTHS[viewMonth]} {viewYear}</span>
        <button className="btn btn-icon" style={{ minHeight: 28, padding: '3px 6px' }} onClick={nextMonth}><ChevronRight size={14} /></button>
      </div>
      <div className="wdp-grid">
        {DAY_HDRS.map(d => <div key={d} className="wdp-day-header">{d}</div>)}
        {grid.map((d, i) => {
          const wk = isoWeek(d);
          const otherMonth = d.getMonth() !== viewMonth;
          const isToday = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
          const isSel = wk === currentWeek;
          const isDirtyWk = dirtyWeeks?.has(wk);
          const dow = d.getDay();
          return (
            <div
              key={i}
              className={['wdp-day', otherMonth?'wdp-other-month':'', isSel?'wdp-sel-week':'', isSel&&dow===1?'wdp-week-start':'', isSel&&dow===0?'wdp-week-end':'', isToday?'wdp-today':''].filter(Boolean).join(' ')}
              onClick={() => { onSelectWeek(wk); onClose(); }}
            >
              {d.getDate()}
              {isDirtyWk && <span className="wdp-dirty-dot" title="Unposted changes" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Import confirmation modal ────────────────
function ImportModal({ importWeekLabel, exportedAt, onConfirm, onCancel }) {
  return (
    <div
      className="overlay-backdrop"
      style={{ zIndex: 250 }}
      onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="overlay-modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <div className="overlay-header">
          <div style={{ fontWeight: 500, fontSize: 16 }}>Import this week?</div>
          <button className="overlay-close" onClick={onCancel}><X size={16} /></button>
        </div>
        <div className="overlay-body">
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
            This will replace all assignments for <strong>Week of {importWeekLabel}</strong> with
            the backup from <strong>{exportedAt}</strong>. Current assignments for that week will be overwritten.
          </p>
        </div>
        <div style={{
          display: 'flex', gap: 8, justifyContent: 'flex-end',
          padding: '12px 24px', borderTop: '0.5px solid var(--border)', flexShrink: 0,
        }}>
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary" style={{ minHeight: 40 }} onClick={onConfirm}>
            <Upload size={14} /> Import
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TopBar({ activeTab, setActiveTab }) {
  const {
    isAdmin, setIsAdmin, managerInitials, setManagerInitials, theme, setTheme,
    weekLabel, currentWeek, navigateWeek, jumpToWeek, weekIsEmpty, copyFromTwoWeeksAgo, clearWeek,
    data, addLog, applyBulkAssignments, restoreClinicSlots, lastSaved, saveStatus, importWeekData,
    historyScores, presentManagers, conflictToast, setConflictToast,
    isDirty, postedSnapshot, dirtyWeeks, postWeek,
  } = useApp();
  const weekLabelRef = useRef(null);
  const undoTimerRef = useRef(null);
  const fileInputRef = useRef(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const { showWelcomeCard } = useTour();

  // Relative "X ago" label — re-evaluated every 15 s
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    if (!lastSaved) return;
    const id = setInterval(() => forceUpdate(n => n + 1), 15000);
    return () => clearInterval(id);
  }, [lastSaved]);

  const savedAgoLabel = (() => {
    if (!lastSaved) return null;
    const secs = Math.floor((Date.now() - lastSaved) / 1000);
    if (secs < 10) return 'Saved just now';
    if (secs < 60) return `Saved ${secs}s ago`;
    const mins = Math.floor(secs / 60);
    return `Saved ${mins}m ago`;
  })();

  const isCurrentWeek = currentWeek === isoWeek(new Date());
  const [copyToast, setCopyToast] = useState(null);
  const [showClearModal, setShowClearModal] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showChat, setShowChat] = useState(false);

  // ─── Post state ──────────────────────────────
  // 'idle' | 'violations' | 'confirm' — which post modal to show
  const [showPostModal, setShowPostModal] = useState(null);
  const [postViolations, setPostViolations] = useState([]);
  const [postState, setPostState] = useState('idle'); // 'idle'|'loading'|'done'|'error'
  const [showExitNudge, setShowExitNudge] = useState(false);

  // ─── Export / Import state ───────────────────
  const [pendingImport, setPendingImport] = useState(null); // parsed file data awaiting confirmation
  const [importError, setImportError] = useState('');

  // ─── Post flow ───────────────────────────────
  const handlePostClick = () => {
    if (!data) return;
    const violations = getPostViolations(data.clinics, data.people);
    if (violations.length > 0) {
      setPostViolations(violations);
      setShowPostModal('violations');
    } else {
      setShowPostModal('confirm');
    }
  };

  const handleViolationJump = (violation, setTab) => {
    setShowPostModal(null);
    if (setTab) setTab('schedule');
    setTimeout(() => {
      const el = document.querySelector(`[data-clinic-id="${violation.clinicId}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('clinic-card--flash');
        setTimeout(() => el.classList.remove('clinic-card--flash'), 1500);
      }
    }, 80);
  };

  const handlePostConfirm = async () => {
    setShowPostModal(null);
    setPostState('loading');
    const { error, snapshot } = await postWeek(managerInitials);
    if (error) {
      setPostState('error');
      setCopyToast('Post failed — check connection');
      setTimeout(() => setCopyToast(null), 4000);
      return;
    }
    addLog({
      action: `Week of ${weekLabel} posted`,
      personName: 'Manager',
      day: '',
      detail: `Published by ${managerInitials}`,
    });

    // JSON download
    const monday = mondayOfWeek(currentWeek);
    const payload = {
      version: EXPORT_VERSION,
      weekStr: currentWeek,
      weekMonday: monday.toISOString().slice(0, 10),
      exportedAt: new Date().toISOString(),
      slotMap: snapshot,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shiftcraft_week_${monday.toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    // PDF print window
    generatePrintWindow(data, weekLabel, monday, managerInitials);

    setPostState('done');
    setTimeout(() => setPostState('idle'), 3000);
  };

  const handleExitLeave = () => {
    setShowExitNudge(false);
    setIsAdmin(false);
    setManagerInitials(null);
  };

  const handleExitPost = () => {
    setShowExitNudge(false);
    handlePostClick();
  };

  const handleExport = () => {
    if (!data) return;
    const monday = mondayOfWeek(currentWeek);
    const slotMap = {};
    for (const c of data.clinics) slotMap[c.id] = { ...c.slots };
    for (const t of (data.additionalTasks ?? [])) slotMap[`task:${t.id}`] = t.assignedPersonId;

    const payload = {
      version: EXPORT_VERSION,
      weekStr: currentWeek,
      weekMonday: monday.toISOString().slice(0, 10),
      exportedAt: new Date().toISOString(),
      slotMap,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shiftcraft-week-${payload.weekMonday}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setCopyToast('Week exported');
    setTimeout(() => setCopyToast(null), 3000);
  };

  const handleImportClick = () => {
    setImportError('');
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        if (
          !parsed ||
          parsed.version !== EXPORT_VERSION ||
          typeof parsed.weekStr !== 'string' ||
          !parsed.weekStr.match(/^\d{4}-W\d{2}$/) ||
          !parsed.slotMap ||
          typeof parsed.slotMap !== 'object'
        ) {
          setImportError('Not a valid Shiftcraft week export file');
          setCopyToast('Not a valid Shiftcraft week export file');
          setTimeout(() => setCopyToast(null), 4000);
          return;
        }
        setPendingImport(parsed);
      } catch {
        setImportError('Not a valid Shiftcraft week export file');
        setCopyToast('Not a valid Shiftcraft week export file');
        setTimeout(() => setCopyToast(null), 4000);
      }
    };
    reader.readAsText(file);
  };

  const handleImportConfirm = async () => {
    if (!pendingImport) return;
    const { weekStr, slotMap, weekMonday, exportedAt } = pendingImport;
    setPendingImport(null);

    const ok = await importWeekData(weekStr, slotMap);
    if (!ok) {
      setCopyToast('Import failed — check connection');
      setTimeout(() => setCopyToast(null), 4000);
      return;
    }

    const importedLabel = new Date(weekMonday).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    addLog({
      action: `Week of ${importedLabel} restored from backup (exported ${new Date(exportedAt).toLocaleString()})`,
      personName: 'Manager',
      day: '',
      detail: '',
    });
    setCopyToast('Week restored from backup');
    setTimeout(() => setCopyToast(null), 3000);
  };

  // Generate state
  const [showGenModal, setShowGenModal] = useState(false);
  const [keepExisting, setKeepExisting] = useState(false);
  const [genState, setGenState] = useState('idle'); // 'idle'|'loading'|'done'|'error'
  const [genError, setGenError] = useState('');
  const [undoInfo, setUndoInfo] = useState(null); // { snapshot, count }
  const [hadGeneration, setHadGeneration] = useState(false);

  // Auto-dismiss the undo toast after 4 s
  useEffect(() => {
    if (!undoInfo || genState === 'loading') return;
    clearTimeout(undoTimerRef.current);
    undoTimerRef.current = setTimeout(() => setUndoInfo(null), 4000);
    return () => clearTimeout(undoTimerRef.current);
  }, [undoInfo, genState]);

  const handleCopy = async () => {
    const result = await copyFromTwoWeeksAgo();
    if (!result) {
      setCopyToast('No data found 2 weeks ago');
    } else {
      const label = result.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
      setCopyToast(`Copied from week of ${label}`);
    }
    setTimeout(() => setCopyToast(null), 3000);
  };

  const handleClearConfirm = () => {
    setShowClearModal(false);
    clearWeek();
    addLog({ action: `Week of ${weekLabel} cleared by manager`, personName: 'Manager', day: '', detail: '' });
    setCopyToast('Week cleared');
    setTimeout(() => setCopyToast(null), 3000);
  };

  const handleGenerateClick = () => {
    setGenError('');
    setShowGenModal(true);
  };

  const handleGenerateConfirm = async () => {
    setShowGenModal(false);
    setGenState('loading');

    // Snapshot current slots for undo
    const snapshot = {};
    for (const c of data.clinics) {
      snapshot[c.id] = { ...c.slots };
    }

    try {
      const { assignments: raw, issues } = generateSchedule(data, { historyScores });

      let assignments = raw;

      if (keepExisting) {
        assignments = assignments.filter(a => {
          const clinic = data.clinics.find(c => c.id === a.clinicId);
          const sv = clinic?.slots[a.slot];
          // Variable-time slots store { personId } objects; others store value directly
          if (sv && typeof sv === 'object') return !sv.personId;
          return !sv;
        });
      }

      // Post-generation validation: detect and repair double-bookings before saving.
      // A generated schedule must never reach the database with a conflict.
      const { safe, dropped } = validateAndRepairAssignments(assignments, data.clinics, data.people);
      assignments = safe;

      // Slot-type integrity check: no OBS slot in a regular clinic, no regular slot in OBS.
      // The adapter/solver fixes should prevent this, but verify before writing to Supabase.
      const invalidSlots = findInvalidSlotAssignments(assignments, data.clinics);
      if (invalidSlots.length > 0) {
        const msg = `Invalid slot assignments — schedule NOT saved:\n${invalidSlots.join('\n')}`;
        console.error('[Shiftcraft] ' + msg);
        setGenError(msg);
        setGenState('error');
        return;
      }

      // OBS integrity check: if any OBS slot is empty while a qualified person
      // was placed at a regular clinic, that is a hard violation — the two-phase
      // solver should prevent it, but we verify here and surface it loudly.
      const obsViolations = findObsViolations(assignments, data.clinics, data.people);
      if (obsViolations.length > 0) {
        const msg = `OBS staffing violation — schedule NOT saved:\n${obsViolations.join('\n')}`;
        console.error('[Shiftcraft] ' + msg);
        setGenError(msg);
        setGenState('error');
        return;
      }

      // Await the save — generation is complete only when data is on Supabase
      await applyBulkAssignments(assignments, { clearFirst: !keepExisting });

      const personById = Object.fromEntries(data.people.map(p => [p.id, p]));
      for (const d of dropped) {
        const name = personById[d.personId]?.name ?? d.personId;
        addLog({
          action: `Removed ${name} from ${d.slot} @ ${d.location} — OBS precedence (auto-repair)`,
          personName: name,
          day: d.day,
          detail: '',
        });
      }

      addLog({
        action: `Schedule generated for Week of ${weekLabel} — ${assignments.length} assignments made${dropped.length > 0 ? `, ${dropped.length} conflict(s) auto-repaired` : ''}`,
        personName: 'Solver',
        day: '',
        detail: issues.length > 0 ? `Unfilled: ${issues.join('; ')}` : '',
      });

      setUndoInfo({ snapshot, count: assignments.length });
      setHadGeneration(true);
      setGenState('done');
      setTimeout(() => setGenState('idle'), 2500);

      if (issues.length > 0) {
        console.warn('[Shiftcraft] Solver unfilled slots:', issues);
      }

    } catch (err) {
      setGenError(err.message);
      setGenState('error');
    }
  };

  const handleUndo = () => {
    if (!undoInfo) return;
    restoreClinicSlots(undoInfo.snapshot);
    addLog({
      action: `AI schedule reverted for Week of ${weekLabel}`,
      personName: 'Claude',
      day: '',
      detail: '',
    });
    setUndoInfo(null);
    setHadGeneration(false);
  };

  const genButtonContent = () => {
    if (genState === 'loading') return (
      <><Loader2 size={14} className="spin" /> Generating…</>
    );
    if (genState === 'done') return <>✓ Schedule ready</>;
    if (genState === 'error') return <><Wand2 size={14} /> Try again</>;
    return <><Wand2 size={14} /> Generate</>;
  };

  return (
    <>
      <div className="topbar">
        <div className="topbar-brand">
          <Calendar size={24} strokeWidth={1.5} />
          <span>Shiftcraft</span>
        </div>

        <div className="topbar-week">
          <button className="btn btn-icon topbar-nav-btn" onClick={() => navigateWeek(-1)} aria-label="Previous week">
            <ChevronLeft size={16} />
          </button>
          {!isCurrentWeek && (
            <button
              className="btn topbar-today-btn"
              onClick={() => jumpToWeek(isoWeek(new Date()))}
              title="Go to current week"
            >
              Today
            </button>
          )}
          <button
            ref={weekLabelRef}
            className="topbar-week-label"
            onClick={() => setShowDatePicker(s => !s)}
            aria-label="Jump to week"
          >
            <Calendar size={13} style={{ opacity: 0.45, flexShrink: 0 }} />
            {isCurrentWeek && <span className="topbar-week-dot" title="Current week" />}
            Week of {weekLabel}
          </button>
          <button className="btn btn-icon topbar-nav-btn" onClick={() => navigateWeek(1)} aria-label="Next week">
            <ChevronRight size={16} />
          </button>
          {showDatePicker && (
            <WeekDatePicker
              currentWeek={currentWeek}
              onSelectWeek={jumpToWeek}
              onClose={() => setShowDatePicker(false)}
              triggerRef={weekLabelRef}
              dirtyWeeks={dirtyWeeks}
            />
          )}
        </div>

        <div className="topbar-right">
          {isAdmin && weekIsEmpty() && (
            <button className="btn btn-pill topbar-mobile-hidden" style={{ fontSize: 12, minHeight: 32 }} onClick={handleCopy}>
              Copy from 2 weeks ago
            </button>
          )}
          {isAdmin && !weekIsEmpty() && (
            <button
              className="btn btn-pill topbar-mobile-hidden"
              style={{ fontSize: 12, minHeight: 32, color: 'var(--red, #dc2626)', gap: 5 }}
              onClick={() => setShowClearModal(true)}
            >
              <RotateCcw size={13} /> Clear Week
            </button>
          )}
          {isAdmin && (
            <>
              <button
                className="btn btn-pill topbar-mobile-hidden"
                style={{ fontSize: 12, minHeight: 32, gap: 5 }}
                onClick={handleExport}
                title="Export this week as a backup file"
              >
                <Download size={13} /> Export
              </button>
              <button
                className="btn btn-pill topbar-mobile-hidden"
                style={{ fontSize: 12, minHeight: 32, gap: 5 }}
                onClick={handleImportClick}
                title="Restore a week from a backup file"
              >
                <Upload size={13} /> Import
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            </>
          )}
          {isAdmin && (
            <>
              {/* Post button */}
              {isDirty ? (
                <button
                  className={`btn btn-pill topbar-mobile-hidden btn-post${postState === 'error' ? ' generate-error' : postState === 'done' ? ' generate-done' : ''}`}
                  style={{ fontSize: 12, minHeight: 32, gap: 5 }}
                  onClick={postState === 'idle' || postState === 'error' ? handlePostClick : undefined}
                  disabled={postState === 'loading'}
                  title="Publish schedule to staff"
                >
                  {postState === 'loading' ? <><Loader2 size={13} className="spin" /> Posting…</> :
                   postState === 'done'    ? <>✓ Posted</> :
                   postedSnapshot ? <><SendHorizonal size={13} /> Post changes</> :
                   <><SendHorizonal size={13} /> Post</>}
                </button>
              ) : postedSnapshot ? (
                <span className="topbar-posted-status topbar-mobile-hidden" title={`Posted by ${postedSnapshot.posted_by ?? '—'}`}>
                  ✓ Posted {formatPostedTime(postedSnapshot.posted_at)}
                </span>
              ) : null}

              {/* Generate schedule button */}
              <button
                data-tour="generate-button"
                className={`btn btn-pill generate-btn topbar-mobile-hidden${genState === 'error' ? ' generate-error' : genState === 'done' ? ' generate-done' : ''}`}
                style={{ fontSize: 12, minHeight: 32, gap: 5 }}
                onClick={genState === 'idle' || genState === 'error' ? handleGenerateClick : undefined}
                disabled={genState === 'loading'}
                title={genState === 'error' ? genError : 'Generate schedule with AI'}
              >
                {genButtonContent()}
              </button>

              <button
                data-tour="print-button"
                className="btn btn-icon topbar-mobile-hidden"
                onClick={() => window.print()}
                aria-label="Print schedule"
                title="Print"
              >
                <Printer size={20} strokeWidth={1.5} />
              </button>
              <button
                data-tour="log-button"
                className="btn btn-icon topbar-mobile-hidden"
                onClick={() => setShowLog(s => !s)}
                aria-label="Change log"
                title="Change log"
              >
                <History size={20} strokeWidth={1.5} />
              </button>
              <button
                className={`btn btn-icon topbar-mobile-hidden${showChat ? ' active' : ''}`}
                onClick={() => setShowChat(s => !s)}
                aria-label="Schedule assistant"
                title="AI Schedule Assistant"
              >
                <Sparkles size={20} strokeWidth={1.5} />
              </button>
              <button
                data-tour="setup-tab"
                className={`btn btn-pill topbar-mobile-hidden ${activeTab === 'setup' ? 'active' : ''}`}
                onClick={() => setActiveTab(t => t === 'setup' ? 'schedule' : 'setup')}
              >
                Setup
              </button>
            </>
          )}
          <button
            className="btn btn-icon topbar-mobile-hidden"
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle theme"
          >
            {theme === 'dark'
              ? <Sun size={20} strokeWidth={1.5} />
              : <Moon size={20} strokeWidth={1.5} />}
          </button>
          <button
            data-tour="help-button"
            className="btn btn-icon topbar-mobile-hidden"
            onClick={showWelcomeCard}
            aria-label="Help tour"
            title="Take a tour"
          >
            <CircleHelp size={20} strokeWidth={1.5} />
          </button>
          {/* Presence: other managers viewing this week */}
          {presentManagers.length > 0 && (
            <div className="topbar-mobile-hidden" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              {presentManagers.map(initials => (
                <span
                  key={initials}
                  title={`${initials} is also editing this week`}
                  style={{
                    padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                    background: 'var(--accent-subtle, rgba(59,130,246,0.12))',
                    border: '0.5px solid var(--accent, #3b82f6)',
                    color: 'var(--accent, #3b82f6)', letterSpacing: 0.5,
                  }}
                >
                  {initials}
                </span>
              ))}
            </div>
          )}
          {saveStatus === 'error' && (
            <span className="topbar-mobile-hidden" style={{ fontSize: 11, color: '#dc2626', fontWeight: 500, whiteSpace: 'nowrap' }}>
              ⚠ Unsaved changes
            </span>
          )}
          {saveStatus === 'saving' && (
            <span className="topbar-mobile-hidden" style={{ fontSize: 11, color: 'var(--text-muted, var(--text-secondary))', opacity: 0.7, whiteSpace: 'nowrap' }}>
              Saving…
            </span>
          )}
          {(saveStatus === 'saved' || saveStatus === 'idle') && savedAgoLabel && (
            <span className="topbar-mobile-hidden" style={{ fontSize: 11, color: 'var(--text-muted, var(--text-secondary))', opacity: 0.7, whiteSpace: 'nowrap' }}>
              {savedAgoLabel}
            </span>
          )}
          <button
            data-tour="admin-button"
            className={`btn btn-pill btn-admin ${isAdmin ? 'active' : ''}`}
            onClick={() => {
              if (isAdmin) {
                if (isDirty) {
                  setShowExitNudge(true);
                } else {
                  setIsAdmin(false);
                  setManagerInitials(null);
                }
              } else {
                setShowPinModal(true);
              }
            }}
          >
            {isAdmin && managerInitials ? `Manager · ${managerInitials}` : 'Manager'}
          </button>
        </div>
      </div>

      {/* Unposted changes banner — persistent, manager-only, not dismissible */}
      {isAdmin && isDirty && (
        <div className="unposted-banner">
          <span className="unposted-banner-msg">
            {postedSnapshot
              ? `Unposted changes — staff are seeing the version posted ${formatPostedTime(postedSnapshot.posted_at)} by ${postedSnapshot.posted_by ?? '—'}`
              : 'This week has not been posted — staff cannot see it yet.'}
          </span>
          <button
            className="btn btn-primary"
            style={{ minHeight: 26, fontSize: 11, padding: '3px 12px', whiteSpace: 'nowrap', flexShrink: 0 }}
            onClick={handlePostClick}
          >
            Post
          </button>
        </div>
      )}

      {/* Mobile-only week navigation bar */}
      <div className="topbar-mobile-week">
        <button className="btn btn-icon topbar-nav-btn" onClick={() => navigateWeek(-1)} aria-label="Previous week">
          <ChevronLeft size={16} />
        </button>
        {!isCurrentWeek && (
          <button className="btn topbar-today-btn" onClick={() => jumpToWeek(isoWeek(new Date()))} title="Go to current week">
            Today
          </button>
        )}
        <span style={{ fontSize: 14, fontWeight: 500 }}>Week of {weekLabel}</span>
        <button className="btn btn-icon topbar-nav-btn" onClick={() => navigateWeek(1)} aria-label="Next week">
          <ChevronRight size={16} />
        </button>
      </div>

      {copyToast && (
        <div className="copy-toast">{copyToast}</div>
      )}

      {/* Conflict toast — shown when a concurrent save was rejected */}
      {conflictToast && (
        <div
          className="copy-toast"
          style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--amber-bg, #fef3c7)', color: '#92400e', border: '1px solid #fcd34d', maxWidth: 380 }}
        >
          <span style={{ flex: 1 }}>⚠ {conflictToast}</span>
          <button
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex', padding: 2, flexShrink: 0 }}
            onClick={() => setConflictToast(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Undo toast — top-center so it doesn't cover the hours bar; auto-dismisses after 4 s */}
      {undoInfo && genState !== 'loading' && (
        <div className="copy-toast" style={{ display: 'flex', alignItems: 'center', gap: 10, top: 68, bottom: 'unset', fontSize: 13, pointerEvents: 'auto' }}>
          <span>Schedule generated — {undoInfo.count} slots filled</span>
          <button
            className="btn"
            style={{ minHeight: 28, fontSize: 12, padding: '3px 10px', background: 'var(--bg-elevated)', color: 'var(--text-primary)' }}
            onClick={handleUndo}
          >
            Undo
          </button>
          <button
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex', padding: 2 }}
            onClick={() => { clearTimeout(undoTimerRef.current); setUndoInfo(null); }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {showGenModal && (
        <GenerateModal
          weekLabel={weekLabel}
          keepExisting={keepExisting}
          onKeepChange={setKeepExisting}
          onConfirm={handleGenerateConfirm}
          onCancel={() => setShowGenModal(false)}
          isRegen={hadGeneration}
        />
      )}

      {showClearModal && (
        <ClearWeekModal
          weekLabel={weekLabel}
          onConfirm={handleClearConfirm}
          onCancel={() => setShowClearModal(false)}
        />
      )}
      {showLog && <ChangeLogDrawer onClose={() => setShowLog(false)} />}
      {showChat && <ChatPanel onClose={() => setShowChat(false)} />}
      {pendingImport && (
        <ImportModal
          importWeekLabel={new Date(pendingImport.weekMonday).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
          exportedAt={new Date(pendingImport.exportedAt).toLocaleString()}
          onConfirm={handleImportConfirm}
          onCancel={() => setPendingImport(null)}
        />
      )}
      {showPinModal && (
        <ManagerModal
          onSuccess={(inits) => { setShowPinModal(false); setIsAdmin(true); setManagerInitials(inits); }}
          onCancel={() => setShowPinModal(false)}
        />
      )}
      {showPostModal === 'violations' && (
        <PostValidationModal
          violations={postViolations}
          onClose={() => setShowPostModal(null)}
          onJump={handleViolationJump}
          setActiveTab={setActiveTab}
        />
      )}
      {showPostModal === 'confirm' && (
        <PostConfirmModal
          weekLabel={weekLabel}
          onConfirm={handlePostConfirm}
          onCancel={() => setShowPostModal(null)}
        />
      )}
      {showExitNudge && (
        <ExitNudgeModal
          postedSnapshot={postedSnapshot}
          onPost={handleExitPost}
          onLeave={handleExitLeave}
        />
      )}
    </>
  );
}
