import { useState, useEffect, useRef } from 'react';
import {
  Calendar, Sun, Moon, ChevronLeft, ChevronRight,
  History, Sparkles, Wand2, Loader2, X, CircleHelp, RotateCcw,
  SendHorizonal, AlertCircle, Save, PhoneCall, Settings,
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useApp, isoWeek, mondayOfWeek } from '../context/AppContext.jsx';
import {
  getRenderedSlotEntries, SLOT_DISPLAY_LABELS, OBS_SLOT_TYPES,
  formatOpenerTimeDisplay, formatOpeningFDTimeDisplay,
  formatClosingOverlayDisplay, formatClosingFDOverlayDisplay,
  formatScribeTimeDisplay, formatVariableSlotTime,
} from '../data/seed.js';

const EXPORT_VERSION = 'shiftcraft-v1';

// Returns the week to navigate to when "Today" is clicked:
// weekdays → current week; weekends → the upcoming Monday's week.
function todayTargetWeek() {
  const now = new Date();
  const dow = now.getDay(); // 0=Sun, 6=Sat
  if (dow === 0 || dow === 6) {
    const next = new Date(now);
    next.setDate(now.getDate() + (dow === 0 ? 1 : 2));
    return isoWeek(next);
  }
  return isoWeek(now);
}
import { useTour } from './Tour.jsx';
import ChangeLogDrawer from './ChangeLogDrawer.jsx';
import ChatPanel from './ChatPanel.jsx';
import AbsenceCalendar, { ABSENCE_TYPES } from './AbsenceCalendar.jsx';
import { getFederalHolidays } from '../utils/federalHolidays.js';
import { buildClosureMap } from '../utils/holidayClosures.js';
import { getOnCallPerson } from '../utils/oncall.js';
import { generateSchedule } from '../engine/adapter.js';
import { validateAndRepairAssignments, findObsViolations, findInvalidSlotAssignments, getPostViolations } from '../engine/validator.js';
import { fetchAbsencesForWeek } from '../services/dataService.js';

// ─── Post helpers ────────────────────────────
function formatPostedTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const mo = d.getMonth() + 1;
  const day = d.getDate();
  const time = d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${mo}/${day} ${time}`;
}

// Generate and download a PDF schedule grid (landscape letter)
function generateSchedulePDF(data, weekLabel, weekMonday, postedBy, filename, calendarOverrides = []) {
  const DAYS_LIST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const LOC_ORDER = ['Phoenix', 'Chandler', 'Estrella', 'Scottsdale', 'OBS'];
  const personById = new Map((data.people ?? []).map(p => [p.id, p]));

  // Build holiday closure map for PDF column header annotation
  const pdfYear = weekMonday.getUTCFullYear();
  const pdfHolidays = [
    ...getFederalHolidays(pdfYear - 1),
    ...getFederalHolidays(pdfYear),
    ...getFederalHolidays(pdfYear + 1),
  ];
  const pdfClosureMap = buildClosureMap(pdfHolidays, calendarOverrides);

  const dayDates = DAYS_LIST.map((day, i) => {
    const d = new Date(weekMonday);
    d.setUTCDate(weekMonday.getUTCDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const dateLabel = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
    const holidayEntry = pdfClosureMap.get(dateStr);
    const holidayNote = holidayEntry ? `\n★ ${holidayEntry.name}${holidayEntry.closedLocations ? ' (partial)' : ''}` : '';
    return `${day} ${dateLabel}${holidayNote}`;
  });

  const allLocs = [...new Set(data.clinics.filter(c => c.open).map(c => c.location))];
  const extras = allLocs.filter(l => !LOC_ORDER.includes(l)).sort();
  const locations = [...LOC_ORDER, ...extras].filter(l => allLocs.includes(l));

  const slotTimeStr = (clinic, slotType, slotVal) => {
    if (slotType === 'scribe')           return formatScribeTimeDisplay(slotVal) ?? '1st Patient – Close';
    if (slotType === 'opener')           return formatOpenerTimeDisplay(clinic, slotVal);
    if (slotType === 'openingFrontDesk') return formatOpeningFDTimeDisplay(slotVal, clinic);
    if (slotType === 'closing')          return formatClosingOverlayDisplay(slotVal, clinic);
    if (slotType === 'closingFrontDesk') return formatClosingFDOverlayDisplay(slotVal);
    if (['frontDesk', 'middle', 'training'].includes(slotType))
      return formatVariableSlotTime(slotVal) ?? null;
    if (OBS_SLOT_TYPES.includes(slotType)) return 'Open – Close';
    return null;
  };

  const head = [['Location', ...dayDates]];

  const body = locations.map(loc => {
    const row = [loc];
    for (const day of DAYS_LIST) {
      const clinic = data.clinics.find(c => c.day === day && c.location === loc && c.open);
      if (!clinic) { row.push(''); continue; }

      const lines = [];
      if (clinic.provider) lines.push(`[${clinic.provider}]`);

      for (const [slotType, slotVal] of getRenderedSlotEntries(clinic)) {
        const pid = typeof slotVal === 'string' ? slotVal : slotVal?.personId;
        if (!pid) continue;
        const p = personById.get(pid);
        if (!p) continue;
        const label = SLOT_DISPLAY_LABELS[slotType] ?? slotType;
        const time  = slotTimeStr(clinic, slotType, slotVal);
        lines.push(time ? `${label}: ${p.name}\n  ${time}` : `${label}: ${p.name}`);
      }

      row.push(lines.length ? lines.join('\n') : '');
    }
    return row;
  });

  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' });
  const pageW = doc.internal.pageSize.width;
  const pageH = doc.internal.pageSize.height;

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text(`Shiftcraft — Week of ${weekLabel}`, 36, 30);

  autoTable(doc, {
    head,
    body,
    startY: 42,
    margin: { left: 36, right: 36 },
    styles: {
      fontSize: 7,
      cellPadding: { top: 3, right: 4, bottom: 3, left: 4 },
      lineColor: [190, 190, 190],
      lineWidth: 0.3,
      valign: 'top',
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [243, 244, 246],
      textColor: [30, 30, 30],
      fontStyle: 'bold',
      halign: 'center',
      fontSize: 7.5,
    },
    columnStyles: {
      0: { fontStyle: 'bold', fillColor: [249, 250, 251], halign: 'center', cellWidth: 62 },
    },
    theme: 'grid',
  });

  // Footer
  const genAt = new Date().toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(120);
  doc.text(`Generated ${genAt}`, 36, pageH - 16);
  doc.text(`Posted by ${postedBy ?? '—'}`, pageW - 36, pageH - 16, { align: 'right' });

  doc.save(filename);
}

// ─── Post validation modal ───────────────────
function PostValidationModal({ violations, onClose, onJump, setActiveTab }) {
  return (
    <div className="overlay-backdrop" style={{ zIndex: 260 }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="overlay-modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div className="overlay-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertCircle size={16} style={{ color: 'var(--red)' }} />
            <span style={{ fontWeight: 600, fontSize: 15 }}>Cannot Post — Fix These Issues First</span>
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
          <div style={{ fontWeight: 500, fontSize: 16 }}>Post Week Of {weekLabel}?</div>
          <button className="overlay-close" onClick={onCancel}><X size={16} /></button>
        </div>
        <div className="overlay-body">
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
            This Will Publish The Schedule To All Staff Immediately. A JSON Backup And A Printable PDF Will Download Automatically.
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
function ExitNudgeModal({ postedSnapshot, onPost, onLeave, onCancel }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onCancel]);

  return (
    <div className="overlay-backdrop" style={{ zIndex: 300, backdropFilter: 'blur(4px)' }} onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="overlay-modal" style={{ maxWidth: 400 }} onClick={e => e.stopPropagation()}>
        <div className="overlay-header">
          <div style={{ fontWeight: 600, fontSize: 15 }}>Unposted Changes</div>
        </div>
        <div className="overlay-body">
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {postedSnapshot
              ? 'This Week Has Changes That Staff Haven\'t Seen Yet. Post Before Leaving Manager Mode?'
              : 'This Week Hasn\'t Been Posted Yet — Staff Can\'t See It. Post Before Leaving Manager Mode?'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 24px', borderTop: '0.5px solid var(--border)', flexShrink: 0 }}>
          <button className="btn" style={{ gap: 6, background: 'var(--amber)', color: '#ffffff', border: '1px solid var(--amber)' }} onClick={onLeave}><Save size={14} /> Save And Close</button>
          <button className="btn btn-post" style={{ minHeight: 38, gap: 6 }} onClick={onPost}>
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
              Generate Schedule For Week Of {weekLabel}?
            </div>
          </div>
          <button className="overlay-close" onClick={onCancel}><X size={16} /></button>
        </div>
        <div className="overlay-body">
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16 }}>
            {isRegen
              ? 'This Will Replace The Current AI-Generated Assignments. Claude Will Re-Fill All Slots Based On Your Current Configuration.'
              : 'Claude Will Fill All Empty Slots Based On Your Staff Settings, Skills, Availability, And Clinic Configuration. Existing Assignments Will Be Replaced.'}
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 14, color: 'var(--text-primary)' }}>
            <input
              type="checkbox"
              checked={keepExisting}
              onChange={e => onKeepChange(e.target.checked)}
              style={{ width: 15, height: 15, cursor: 'pointer' }}
            />
            Keep Existing Assignments — Only Fill Empty Slots
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
          <div style={{ fontWeight: 500, fontSize: 16 }}>Clear This Week's Schedule?</div>
          <button className="overlay-close" onClick={onCancel}><X size={16} /></button>
        </div>
        <div className="overlay-body">
          <p style={{ fontSize: 14, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>
            This Will Remove All Staff Assignments For <strong>Week Of {weekLabel}</strong>.
            Clinic Settings And Times Are Kept. This Cannot Be Undone.
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
        <div style={{ fontWeight: 600, fontSize: 17, marginBottom: 6 }}>Manager Access</div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 24 }}>Enter PIN And Your Initials</div>

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
          <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 12 }}>2–3 Letters Required</div>
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

// ─── Hover preview (read-only mini month + next 7 days) ──────────────────────

const HP_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const CLOSED_COLOR_HP = '#64748b';

function HoverPreview({ anchorRef, absences, currentWeek, people, calendarOverrides, onMouseEnter, onMouseLeave, onDayClick }) {
  if (!anchorRef?.current) return null;
  const rect = anchorRef.current.getBoundingClientRect();

  const colorOf = (key) => ABSENCE_TYPES.find(t => t.key === key)?.color ?? '#6b7280';
  const personByKey = new Map((people ?? []).map(p => [p.name.trim().toLowerCase(), p]));

  const monday = mondayOfWeek(currentWeek);
  const year   = monday.getUTCFullYear();
  const month  = monday.getUTCMonth();

  // 6-row × 7-col grid, Sun→Sat
  const firstDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const cells = Array.from({ length: 42 }, (_, i) =>
    new Date(Date.UTC(year, month, 1 - firstDow + i)),
  );
  const showSix = cells.slice(35).some(d => d.getUTCMonth() === month);
  const grid = showSix ? cells : cells.slice(0, 35);

  const toDs = (d) => d.toISOString().slice(0, 10);
  const todayDs = toDs(new Date());
  const next7d = new Date();
  next7d.setDate(next7d.getDate() + 7);
  const endDs = toDs(next7d);

  // Build closure set for this month (observed holidays + office-closed)
  const holidays = getFederalHolidays(year);
  const openOverrides = new Set((calendarOverrides ?? []).filter(o => o.kind === 'holiday_open').map(o => o.date));
  const closedDates = new Set([
    ...holidays.filter(h => !openOverrides.has(h.date)).map(h => h.date),
    ...(calendarOverrides ?? []).filter(o => o.kind === 'office_closed').map(o => o.date),
  ]);

  const next7 = (absences ?? [])
    .filter(a => a.end_date >= todayDs && a.start_date <= endDs)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .slice(0, 5);

  const width = 264;
  let left = Math.round(rect.left + rect.width / 2 - width / 2);
  if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
  if (left < 8) left = 8;
  const top = Math.round(rect.bottom + 8);

  const toIsoWeek = (d) => {
    const thu = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    thu.setUTCDate(thu.getUTCDate() + 4 - (thu.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(thu.getUTCFullYear(), 0, 4));
    yearStart.setUTCDate(yearStart.getUTCDate() + 4 - (yearStart.getUTCDay() || 7));
    const week = Math.ceil(((thu - yearStart) / 86400000 + 1) / 7);
    return `${thu.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  };

  return (
    <div className="hover-preview" style={{ top, left, width }} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <div className="hover-preview-month">{HP_MONTHS[month]} {year}</div>
      <div className="hover-preview-grid">
        {['S','M','T','W','T','F','S'].map((h, i) => (
          <div key={i} className="hover-preview-hdr">{h}</div>
        ))}
        {grid.map((d, i) => {
          const ds = toDs(d);
          const isOther = d.getUTCMonth() !== month;
          const dots = isOther ? [] : (absences ?? []).filter(a => a.start_date <= ds && a.end_date >= ds);
          const isClosed = !isOther && closedDates.has(ds);
          return (
            <div
              key={i}
              className={`hover-preview-day${isOther ? ' hover-preview-day--other' : ''}`}
              onClick={isOther ? undefined : () => onDayClick?.(toIsoWeek(d))}
            >
              <span>{d.getUTCDate()}</span>
              {(dots.length > 0 || isClosed) && (
                <div className="hover-preview-dots">
                  {isClosed && <span className="hover-preview-dot" style={{ background: CLOSED_COLOR_HP }} />}
                  {dots.slice(0, isClosed ? 2 : 3).map((a, j) => (
                    <span key={j} className="hover-preview-dot" style={{ background: colorOf(a.type) }} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {next7.length > 0 && (
        <>
          <div className="hover-preview-divider" />
          <div className="hover-preview-next-title">Next 7 days</div>
          {next7.map(a => {
            const person = personByKey.get(a.person_name);
            const name = person?.name ?? a.person_name;
            const dateShort = a.start_date.slice(5).replace('-', '/');
            return (
              <div key={a.id} className="hover-preview-next-item">
                <span className="hover-preview-dot" style={{ background: colorOf(a.type), flexShrink: 0 }} />
                <span className="hover-preview-next-name">{name}</span>
                <span className="hover-preview-next-date">{dateShort}</span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

const GEAR_SECTIONS = [
  { id: 'staff',     label: 'Staff' },
  { id: 'clinics',   label: 'Clinics' },
  { id: 'locations', label: 'Locations' },
  { id: 'data',      label: 'Data' },
];

export default function TopBar({ activeTab, setActiveTab, setupSection, setSetupSection }) {
  const {
    isAdmin, setIsAdmin, managerInitials, setManagerInitials, theme, setTheme,
    weekLabel, currentWeek, navigateWeek, jumpToWeek, weekIsEmpty, copyFromTwoWeeksAgo, clearWeek,
    data, absences, calendarOverrides, addLog, applyBulkAssignments, restoreClinicSlots, lastSaved, saveStatus,
    historyScores, presentManagers, conflictToast, setConflictToast,
    isDirty, postedSnapshot, dirtyWeeks, postWeek,
    doctorOffClinicIds,
    holidayClosedClinicIds,
    onCallThisWeek,
  } = useApp();
  const weekLabelRef = useRef(null);
  const undoTimerRef = useRef(null);
  const hoverTimerRef = useRef(null);
  const gearTimerRef = useRef(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showGearMenu, setShowGearMenu] = useState(false);
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

  const isCurrentWeek = currentWeek === todayTargetWeek();
  const [copyToast, setCopyToast] = useState(null);
  const [showClearModal, setShowClearModal] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [showAbsences, setShowAbsences] = useState(false);

  // Close absence calendar + hover preview when manager mode is exited
  useEffect(() => {
    if (!isAdmin) {
      setShowAbsences(false);
      setShowPreview(false);
      clearTimeout(hoverTimerRef.current);
    }
  }, [isAdmin]);

  // ─── Post state ──────────────────────────────
  // 'idle' | 'violations' | 'confirm' — which post modal to show
  const [showPostModal, setShowPostModal] = useState(null);
  const [postViolations, setPostViolations] = useState([]);
  const [postState, setPostState] = useState('idle'); // 'idle'|'loading'|'done'|'error'
  const [showExitNudge, setShowExitNudge] = useState(false);


  // ─── Post flow ───────────────────────────────
  const handlePostClick = async () => {
    if (!data) return;
    const weekMonday = mondayOfWeek(currentWeek);
    const { data: absences } = await fetchAbsencesForWeek(weekMonday);
    const violations = getPostViolations(data.clinics, data.people, absences ?? [], weekMonday, doctorOffClinicIds);
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

    // PDF download
    try {
      const pdfFilename = `shiftcraft_week_${monday.toISOString().slice(0, 10)}.pdf`;
      generateSchedulePDF(data, weekLabel, monday, managerInitials, pdfFilename, calendarOverrides ?? []);
    } catch (pdfErr) {
      console.error('[Shiftcraft] PDF generation failed:', pdfErr);
    }

    setPostState('done');
    setTimeout(() => setPostState('idle'), 3000);
  };

  const handleExitLeave = () => {
    setShowExitNudge(false);
    setIsAdmin(false);
    setManagerInitials(null);
    setActiveTab('schedule');
  };

  const handleExitPost = () => {
    setShowExitNudge(false);
    handlePostClick();
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
      const { assignments: raw, issues } = generateSchedule(data, { historyScores, doctorOffClinicIds, holidayClosedClinicIds });

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
        <div
          className="topbar-brand topbar-brand--clickable"
          onClick={() => {
            setActiveTab('schedule');
            setShowAbsences(false);
            setShowPreview(false);
            clearTimeout(hoverTimerRef.current);
          }}
          title="Back to schedule board"
          role="button"
          tabIndex={0}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setActiveTab('schedule'); setShowAbsences(false); } }}
        >
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
              onClick={() => jumpToWeek(todayTargetWeek())}
              title="Go to current week"
            >
              Today
            </button>
          )}
          <button
            ref={weekLabelRef}
            data-tour="week-nav"
            className={`topbar-week-label${isAdmin ? '' : ' topbar-week-label--staff'}`}
            onClick={() => {
              if (!isAdmin) return;
              clearTimeout(hoverTimerRef.current);
              setShowPreview(false);
              setShowAbsences(s => !s);
            }}
            onMouseEnter={() => {
              if (!isAdmin || showAbsences) return;
              clearTimeout(hoverTimerRef.current);
              hoverTimerRef.current = setTimeout(() => setShowPreview(true), 300);
            }}
            onMouseLeave={() => {
              clearTimeout(hoverTimerRef.current);
              hoverTimerRef.current = setTimeout(() => setShowPreview(false), 200);
            }}
            aria-label={isAdmin ? 'Open absence calendar' : undefined}
          >
            {isAdmin ? (
              <span
                className={`topbar-absence-cal-icon${showAbsences ? ' topbar-absence-cal-icon--active' : ''}`}
                role="button"
                tabIndex={0}
                title="Absence calendar"
                aria-label="Absence calendar"
                onClick={e => { e.stopPropagation(); clearTimeout(hoverTimerRef.current); setShowPreview(false); setShowAbsences(s => !s); }}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); clearTimeout(hoverTimerRef.current); setShowPreview(false); setShowAbsences(s => !s); } }}
              >
                <Calendar size={19} strokeWidth={1.5} style={{ flexShrink: 0 }} />
              </span>
            ) : (
              <Calendar size={13} style={{ opacity: 0.45, flexShrink: 0 }} />
            )}
            {isCurrentWeek && <span className="topbar-week-dot" title="Current week" />}
            Week of {weekLabel}
          </button>
          <button className="btn btn-icon topbar-nav-btn" onClick={() => navigateWeek(1)} aria-label="Next week">
            <ChevronRight size={16} />
          </button>
          {onCallThisWeek && (
            <div className="topbar-oncall-badge" title={`On call this week: ${onCallThisWeek}`}>
              <PhoneCall size={11} />
              {onCallThisWeek}
            </div>
          )}
        </div>

        <div className="topbar-right">

          {/* ── Cluster 1: Actions — Generate (primary) + Clear/Copy ── */}
          {isAdmin && (
            <div className="topbar-cluster topbar-cluster--actions topbar-mobile-hidden">
              <button
                data-tour="generate-button"
                className={`btn btn-pill generate-btn${genState === 'error' ? ' generate-error' : genState === 'done' ? ' generate-done' : ''}`}
                style={{ fontSize: 12, minHeight: 32, gap: 5 }}
                onClick={genState === 'idle' || genState === 'error' ? handleGenerateClick : undefined}
                disabled={genState === 'loading'}
                title={genState === 'error' ? genError : 'Generate Schedule With AI'}
              >
                {genButtonContent()}
              </button>
              {weekIsEmpty() ? (
                <button className="btn btn-pill" style={{ fontSize: 12, minHeight: 32 }} onClick={handleCopy}>
                  Copy from 2 weeks ago
                </button>
              ) : (
                <button
                  className="btn btn-pill btn-clear-week"
                  style={{ fontSize: 12, minHeight: 32, gap: 5 }}
                  onClick={() => setShowClearModal(true)}
                >
                  <RotateCcw size={13} /> Clear Week
                </button>
              )}
            </div>
          )}

          {/* ── Cluster 2: Utility icons — History, Chat, Settings ── */}
          {isAdmin && (
            <div className="topbar-cluster topbar-cluster--tools topbar-mobile-hidden">
              <button
                data-tour="log-button"
                className="btn btn-icon"
                onClick={() => setShowLog(s => !s)}
                aria-label="Change log"
                title="Change log"
              >
                <History size={20} strokeWidth={1.5} />
              </button>
              <button
                className={`btn btn-icon${showChat ? ' active' : ''}`}
                onClick={() => setShowChat(s => !s)}
                aria-label="Schedule assistant"
                title="AI Schedule Assistant"
              >
                <Sparkles size={20} strokeWidth={1.5} />
              </button>
              <div
                style={{ position: 'relative' }}
                onMouseEnter={() => {
                  clearTimeout(gearTimerRef.current);
                  gearTimerRef.current = setTimeout(() => setShowGearMenu(true), 200);
                }}
                onMouseLeave={() => {
                  clearTimeout(gearTimerRef.current);
                  gearTimerRef.current = setTimeout(() => setShowGearMenu(false), 200);
                }}
              >
                <button
                  data-tour="setup-tab"
                  className={`btn btn-icon${activeTab === 'setup' ? ' active' : ''}`}
                  onClick={() => setActiveTab('setup')}
                  aria-label="Settings"
                  title="Settings"
                >
                  <Settings size={20} strokeWidth={1.5} />
                </button>
                {showGearMenu && (
                  <div
                    className="gear-submenu"
                    onMouseEnter={() => clearTimeout(gearTimerRef.current)}
                    onMouseLeave={() => {
                      clearTimeout(gearTimerRef.current);
                      gearTimerRef.current = setTimeout(() => setShowGearMenu(false), 200);
                    }}
                  >
                    {GEAR_SECTIONS.map(sec => (
                      <button
                        key={sec.id}
                        className="gear-submenu-item"
                        onClick={() => {
                          setSetupSection(sec.id);
                          setActiveTab('setup');
                          setShowGearMenu(false);
                        }}
                      >
                        {sec.label}
                      </button>
                    ))}
                    <div className="gear-submenu-divider" />
                    <button
                      className="gear-submenu-item"
                      onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
                    >
                      <span className="gear-submenu-item-icon">
                        {theme === 'dark'
                          ? <Sun size={14} strokeWidth={1.75} />
                          : <Moon size={14} strokeWidth={1.75} />}
                      </span>
                      {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                    </button>
                    <button
                      className="gear-submenu-item"
                      data-tour="help-button"
                      onClick={() => { showWelcomeCard(); setShowGearMenu(false); }}
                    >
                      <span className="gear-submenu-item-icon">
                        <CircleHelp size={14} strokeWidth={1.75} />
                      </span>
                      Tips
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Cluster 3: Context — save status, Post pill, Manager identity ── */}
          <div className="topbar-cluster topbar-cluster--context">
            {isAdmin && saveStatus === 'error' && (
              <span className="topbar-mobile-hidden" style={{ fontSize: 11, color: '#dc2626', fontWeight: 500, whiteSpace: 'nowrap' }}>
                ⚠ Unsaved
              </span>
            )}
            {isAdmin && saveStatus === 'saving' && (
              <span className="topbar-mobile-hidden" style={{ fontSize: 11, color: 'var(--text-muted, var(--text-secondary))', opacity: 0.7, whiteSpace: 'nowrap' }}>
                Saving…
              </span>
            )}
            {isAdmin && (saveStatus === 'saved' || saveStatus === 'idle') && savedAgoLabel && (
              <span className="topbar-mobile-hidden" style={{ fontSize: 11, color: 'var(--text-muted, var(--text-secondary))', opacity: 0.7, whiteSpace: 'nowrap' }}>
                {savedAgoLabel}
              </span>
            )}
            {isAdmin && (
              <button
                data-tour="post-button"
                className={`btn btn-pill topbar-mobile-hidden btn-post${!isDirty ? ' btn-post--clean' : ''}${postState === 'error' ? ' generate-error' : postState === 'done' ? ' generate-done' : ''}`}
                style={{ fontSize: 12, minHeight: 32, gap: 5 }}
                onClick={isDirty && (postState === 'idle' || postState === 'error') ? handlePostClick : undefined}
                disabled={postState === 'loading' || (!isDirty && postState === 'idle')}
                title={isDirty ? 'Publish schedule to staff' : postedSnapshot ? `Posted by ${postedSnapshot.posted_by ?? '—'}` : 'Nothing to post yet'}
              >
                {postState === 'loading' ? <><Loader2 size={13} className="spin" /> Posting…</> :
                 postState === 'done'    ? <>✓ Posted</> :
                 isDirty && postedSnapshot ? <><SendHorizonal size={13} /> Post changes</> :
                 isDirty ? <><SendHorizonal size={13} /> Post</> :
                 postedSnapshot ? <>✓ Posted {formatPostedTime(postedSnapshot.posted_at)}</> :
                 <><SendHorizonal size={13} /> Post</>}
              </button>
            )}
            {isAdmin && presentManagers.length > 0 && (
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
                    setActiveTab('schedule');
                  }
                } else {
                  setShowPinModal(true);
                }
              }}
            >
              {isAdmin && managerInitials ? <><Save size={13} /> {managerInitials}</> : 'Manager'}
            </button>
          </div>

        </div>
      </div>

      {/* Unposted changes banner — persistent, manager-only, not dismissible */}
      {isAdmin && isDirty && (
        <div className="unposted-banner">
          <span className="unposted-banner-msg">
            {postedSnapshot
              ? `Your changes have not been posted — staff cannot see your changes until you post. Version posted ${formatPostedTime(postedSnapshot.posted_at)} by ${postedSnapshot.posted_by ?? '—'}.`
              : 'This schedule has not been posted — staff cannot see it until you post.'}
          </span>
        </div>
      )}

      {/* Mobile-only week navigation bar */}
      <div className="topbar-mobile-week">
        <button className="btn btn-icon topbar-nav-btn" onClick={() => navigateWeek(-1)} aria-label="Previous week">
          <ChevronLeft size={16} />
        </button>
        {!isCurrentWeek && (
          <button className="btn topbar-today-btn" onClick={() => jumpToWeek(todayTargetWeek())} title="Go to current week">
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
      {isAdmin && showAbsences && (
        <AbsenceCalendar
          onClose={() => setShowAbsences(false)}
          currentWeek={currentWeek}
          onJumpToWeek={jumpToWeek}
        />
      )}
      {isAdmin && showPreview && !showAbsences && (
        <HoverPreview
          anchorRef={weekLabelRef}
          absences={absences ?? []}
          currentWeek={currentWeek}
          people={data?.people ?? []}
          calendarOverrides={calendarOverrides ?? []}
          onMouseEnter={() => clearTimeout(hoverTimerRef.current)}
          onMouseLeave={() => {
            clearTimeout(hoverTimerRef.current);
            hoverTimerRef.current = setTimeout(() => setShowPreview(false), 200);
          }}
          onDayClick={(weekStr) => { setShowPreview(false); jumpToWeek(weekStr); }}
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
          onCancel={() => setShowExitNudge(false)}
        />
      )}
    </>
  );
}
