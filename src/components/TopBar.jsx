import { useState, useEffect, useRef } from 'react';
import {
  Calendar, Sun, Moon, ChevronLeft, ChevronRight,
  History, Printer, Sparkles, Wand2, Loader2, X, CircleHelp,
} from 'lucide-react';
import { useApp, isoWeek, mondayOfWeek } from '../context/AppContext.jsx';
import { useTour } from './Tour.jsx';
import ChangeLogDrawer from './ChangeLogDrawer.jsx';
import ChatPanel from './ChatPanel.jsx';

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

export default function TopBar({ activeTab, setActiveTab }) {
  const {
    isAdmin, setIsAdmin, theme, setTheme,
    weekLabel, currentWeek, navigateWeek, jumpToWeek, weekIsEmpty, copyFromPreviousWeek,
    data, addLog, applyBulkAssignments, restoreClinicSlots, lastSaved,
  } = useApp();
  const weekLabelRef = useRef(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
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
  const [showLog, setShowLog] = useState(false);
  const [showChat, setShowChat] = useState(false);

  // Generate state
  const [showGenModal, setShowGenModal] = useState(false);
  const [keepExisting, setKeepExisting] = useState(false);
  const [genState, setGenState] = useState('idle'); // 'idle'|'loading'|'done'|'error'
  const [genError, setGenError] = useState('');
  const [undoInfo, setUndoInfo] = useState(null); // { snapshot, count }
  const [hadGeneration, setHadGeneration] = useState(false);

  const handleCopy = () => {
    const result = copyFromPreviousWeek();
    if (!result) {
      setCopyToast('No previous week data found');
    } else {
      const label = result.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
      setCopyToast(`Copied from week of ${label}`);
    }
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

    const openClinics = data.clinics
      .filter(c => c.open)
      .map(({ id, day, location, provider, startTime, endTime, slots, patientCount }) => ({
        id, day, location, provider, startTime, endTime, patientCount,
        currentSlots: slots,
      }));

    const staffRoster = data.people.map(({ id, name, roles, skills, daysOff, lockedTo, preferredLocations, availabilityWindows, targetHours, grade }) => ({
      id, name, roles, skills, daysOff, lockedTo, preferredLocations, availabilityWindows, targetHours, grade,
    }));

    const userMessage =
      `Fill the schedule for the week of ${weekLabel}.\n\n` +
      `OPEN CLINICS:\n${JSON.stringify(openClinics, null, 0)}\n\n` +
      `STAFF ROSTER:\n${JSON.stringify(staffRoster, null, 0)}\n\n` +
      `Output only the JSON object.`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userMessage }],
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        if (res.status === 401) throw new Error('API key not configured. Add ANTHROPIC_API_KEY in Vercel settings.');
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? `Server error ${res.status}`);
      }

      const apiResponse = await res.json();
      const rawText = apiResponse.content?.[0]?.text ?? '';

      // Strip accidental markdown fences
      const jsonText = rawText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();

      let parsed;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        throw new Error('Claude returned an invalid schedule. Try generating again.');
      }

      const raw = parsed.assignments ?? [];
      const validClinicIds = new Set(data.clinics.map(c => c.id));
      const validPersonIds = new Set(data.people.map(p => p.id));
      const validSlots = new Set(['scribe', 'opener', 'closing', 'middle', 'training']);

      let assignments = raw.filter(a =>
        a.clinicId && validClinicIds.has(a.clinicId) &&
        a.personId && validPersonIds.has(a.personId) &&
        a.slot && validSlots.has(a.slot)
      );

      if (keepExisting) {
        assignments = assignments.filter(a => {
          const clinic = data.clinics.find(c => c.id === a.clinicId);
          const sv = clinic?.slots[a.slot];
          if (a.slot === 'middle' || a.slot === 'training') {
            return !sv?.personId;
          }
          return !sv;
        });
      }

      applyBulkAssignments(assignments);

      addLog({
        action: `AI generated schedule for Week of ${weekLabel} — ${assignments.length} assignments made`,
        personName: 'Claude',
        day: '',
        detail: '',
      });

      setUndoInfo({ snapshot, count: assignments.length });
      setHadGeneration(true);
      setGenState('done');
      setTimeout(() => setGenState('idle'), 2500);

    } catch (err) {
      const msg = err.name === 'AbortError'
        ? 'Generation timed out. Try again.'
        : err.message;
      setGenError(msg);
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
              Copy from last week
            </button>
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
          {savedAgoLabel && (
            <span className="topbar-mobile-hidden" style={{ fontSize: 11, color: 'var(--text-muted, var(--text-secondary))', opacity: 0.7, whiteSpace: 'nowrap' }}>
              {savedAgoLabel}
            </span>
          )}
          <button
            data-tour="admin-button"
            className={`btn btn-pill ${isAdmin ? 'active' : ''}`}
            onClick={() => setIsAdmin(a => !a)}
          >
            {isAdmin ? '← Staff' : 'Admin'}
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

      {/* Undo toast — persists until dismissed */}
      {undoInfo && genState !== 'loading' && (
        <div className="copy-toast" style={{ display: 'flex', alignItems: 'center', gap: 10, bottom: 24, fontSize: 13 }}>
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
            onClick={() => setUndoInfo(null)}
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

      {showLog && <ChangeLogDrawer onClose={() => setShowLog(false)} />}
      {showChat && <ChatPanel onClose={() => setShowChat(false)} />}
    </>
  );
}
