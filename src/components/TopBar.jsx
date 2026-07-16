import { useState, useEffect, useRef } from 'react';
import {
  Calendar, Sun, Moon, ChevronLeft, ChevronRight,
  History, Printer, Sparkles, Wand2, Loader2, X, CircleHelp, RotateCcw,
  Download, Upload,
} from 'lucide-react';
import { useApp, isoWeek, mondayOfWeek } from '../context/AppContext.jsx';

const EXPORT_VERSION = 'shiftcraft-v1';
import { useTour } from './Tour.jsx';
import ChangeLogDrawer from './ChangeLogDrawer.jsx';
import ChatPanel from './ChatPanel.jsx';
import { generateSchedule } from '../engine/adapter.js';
import { validateAndRepairAssignments } from '../engine/validator.js';

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
          placeholder="e.g. JN"
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

function WeekDatePicker({ currentWeek, onSelectWeek, onClose, triggerRef }) {
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
          const dow = d.getDay();
          return (
            <div
              key={i}
              className={['wdp-day', otherMonth?'wdp-other-month':'', isSel?'wdp-sel-week':'', isSel&&dow===1?'wdp-week-start':'', isSel&&dow===0?'wdp-week-end':'', isToday?'wdp-today':''].filter(Boolean).join(' ')}
              onClick={() => { onSelectWeek(wk); onClose(); }}
            >
              {d.getDate()}
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

  // ─── Export / Import state ───────────────────
  const [pendingImport, setPendingImport] = useState(null); // parsed file data awaiting confirmation
  const [importError, setImportError] = useState('');

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
      const { assignments: raw, issues } = generateSchedule(data);

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
                setIsAdmin(false);
                setManagerInitials(null);
              } else {
                setShowPinModal(true);
              }
            }}
          >
            {isAdmin && managerInitials ? `Manager · ${managerInitials}` : 'Manager'}
          </button>
        </div>
      </div>

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
    </>
  );
}
