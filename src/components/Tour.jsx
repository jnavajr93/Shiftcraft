import { useState, useEffect, useContext, createContext } from 'react';
import { GraduationCap } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';

// ─── Tour step definitions ─────────────────────────────────────────────────

const STAFF_STEPS = [
  { target: 'week-board',       title: 'Your weekly schedule',   body: 'Each column is a day. Each card is a clinic running that day at a specific location. Scroll down to see all clinics.' },
  { target: 'clinic-card',      title: 'Clinic cards',           body: 'Each card shows the provider, location, patient volume, and who is assigned to each role that day.' },
  { target: 'slot-scribe',      title: 'Role slots',             body: 'Every clinic has a Scribe, Opener, and Closing tech. Middle and Training appear when the clinic needs extra coverage.' },
  { target: 'search-bar',       title: 'Find your shift fast',   body: 'Type your name here. Your assignments highlight instantly across the whole week — everything else dims.' },
  { target: 'additional-tasks', title: 'Additional tasks',       body: 'Off-clinic assignments like Triage or Imaging Upload appear here. Check if you have been assigned to any.' },
  { target: 'admin-button',     title: 'Need to make changes?',  body: 'Staff view is read-only. Click Admin to unlock editing if you have admin access.', done: true },
];

const ADMIN_STEPS = [
  { target: 'week-board',       title: 'The weekly schedule board', body: 'Your full week at a glance — every location, every provider, every slot. This is where you build the schedule.' },
  { target: 'staff-sidebar',    title: 'Your staff panel',          body: 'All staff listed here with their grade badge and current hours. Drag any name directly onto a clinic slot to assign them.' },
  { target: 'clinic-card',      title: 'Clinic cards',              body: 'Each card is one clinic. The badge shows patient count — amber means busy, red means high volume.' },
  { target: 'slot-scribe',      title: 'Click any slot to assign',  body: 'Click an empty slot to open a staff picker. Your best-fit staff appear at the top sorted by grade and skills.' },
  { target: 'slot-middle',      title: 'Optional slots',            body: 'Middle and Training slots are optional. Add them when the clinic needs extra coverage — each gets its own custom time.' },
  { target: 'hours-bar',        title: 'Live hours tracker',        body: 'Updates instantly as you assign staff. Anyone approaching their weekly limit is flagged in amber. No payroll surprises.' },
  { target: 'generate-button',  title: 'Let AI build the schedule', body: 'Click Generate and Claude fills the entire week based on every staff member\'s skills, availability, and constraints.' },
  { target: 'additional-tasks', title: 'Additional tasks',          body: 'Assign off-clinic work like Triage or Imaging Upload here. Works the same as clinic slots — drag or click to assign.' },
  { target: 'setup-tab',        title: 'Configure everything in Setup', body: 'Add staff, set skills and grades, configure clinics, and define availability rules. Set it once — it applies every week.', done: true },
];

// ─── Tooltip positioning ───────────────────────────────────────────────────

function getTooltipPosition(targetEl) {
  const rect = targetEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const TW = 288;
  const TH = 180;
  const GAP = 12;

  // Prefer below
  if (rect.bottom + TH + GAP < vh) {
    return {
      top: rect.bottom + GAP,
      left: Math.max(8, Math.min(rect.left, vw - TW - 8)),
      arrow: 'top',
      arrowLeft: Math.min(Math.max(rect.left + rect.width / 2 - Math.max(8, Math.min(rect.left, vw - TW - 8)), 20), TW - 20),
    };
  }
  // Try above
  if (rect.top - TH - GAP > 0) {
    return {
      top: rect.top - TH - GAP,
      left: Math.max(8, Math.min(rect.left, vw - TW - 8)),
      arrow: 'bottom',
      arrowLeft: Math.min(Math.max(rect.left + rect.width / 2 - Math.max(8, Math.min(rect.left, vw - TW - 8)), 20), TW - 20),
    };
  }
  // Try right
  if (rect.right + TW + GAP < vw) {
    return {
      top: Math.max(8, Math.min(rect.top, vh - TH - 8)),
      left: rect.right + GAP,
      arrow: 'left',
      arrowLeft: 0,
    };
  }
  // Fallback left
  return {
    top: Math.max(8, Math.min(rect.top, vh - TH - 8)),
    left: Math.max(8, rect.left - TW - GAP),
    arrow: 'right',
    arrowLeft: 0,
  };
}

// ─── Context ───────────────────────────────────────────────────────────────

const TourContext = createContext(null);
export const useTour = () => useContext(TourContext);

// ─── TourProvider ──────────────────────────────────────────────────────────

export function TourProvider({ children }) {
  const { isAdmin, setIsAdmin } = useApp();

  const [showWelcome, setShowWelcome] = useState(false);
  const [activeTour, setActiveTour] = useState(null); // 'staff' | 'admin' | null
  const [step, setStep] = useState(0);
  const [tooltipPos, setTooltipPos] = useState(null);

  // Auto-show welcome card after 1 second on mount
  useEffect(() => {
    const t = setTimeout(() => {
      const dismissed = localStorage.getItem('shiftcraft.tour.dismissed') === '1';
      if (dismissed) return;
      const tourKey = isAdmin ? 'shiftcraft.tour.admin.done' : 'shiftcraft.tour.staff.done';
      const done = localStorage.getItem(tourKey) === '1';
      if (done) return;
      setShowWelcome(true);
    }, 1000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const endTour = () => {
    if (activeTour === 'staff') localStorage.setItem('shiftcraft.tour.staff.done', '1');
    if (activeTour === 'admin') localStorage.setItem('shiftcraft.tour.admin.done', '1');
    setActiveTour(null);
    setStep(0);
    setTooltipPos(null);
  };

  const startTour = (type) => {
    setShowWelcome(false);
    if (type === 'admin' && !isAdmin) setIsAdmin(true);
    setActiveTour(type);
    setStep(0);
  };

  const showWelcomeCard = () => {
    endTour();
    setShowWelcome(true);
  };

  // Update tooltip position when step or tour changes
  useEffect(() => {
    if (!activeTour) return;
    const steps = activeTour === 'staff' ? STAFF_STEPS : ADMIN_STEPS;
    const currentStep = steps[step];
    if (!currentStep) return;

    const updatePos = () => {
      const el = document.querySelector(`[data-tour="${currentStep.target}"]`);
      if (el) {
        setTooltipPos(getTooltipPosition(el));
      }
    };

    const t = setTimeout(updatePos, 50);
    window.addEventListener('resize', updatePos);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', updatePos);
    };
  }, [activeTour, step]);

  // ESC closes tour
  useEffect(() => {
    if (!activeTour) return;
    const handler = (e) => { if (e.key === 'Escape') endTour(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTour]);

  return (
    <TourContext.Provider value={{ showWelcomeCard }}>
      {children}

      {showWelcome && (
        <div className="tour-welcome">
          <div className="tour-welcome-icon"><GraduationCap size={20} /></div>
          <div className="tour-welcome-title">Welcome to Shiftcraft</div>
          <div className="tour-welcome-body">Want a quick tour of how everything works?</div>
          <div className="tour-welcome-actions">
            <button
              className="btn btn-primary"
              style={{ minHeight: 34, fontSize: 13 }}
              onClick={() => startTour(isAdmin ? 'admin' : 'staff')}
            >
              Show me around
            </button>
            <button
              className="btn tour-skip-btn"
              onClick={() => {
                localStorage.setItem('shiftcraft.tour.dismissed', '1');
                setShowWelcome(false);
              }}
            >
              Skip for now
            </button>
          </div>
        </div>
      )}

      {activeTour && tooltipPos && (() => {
        const steps = activeTour === 'staff' ? STAFF_STEPS : ADMIN_STEPS;
        const total = steps.length;
        const current = steps[step];
        const pct = ((step + 1) / total) * 100;
        const isLast = step === total - 1;

        return (
          <div
            className={`tour-tooltip arrow-${tooltipPos.arrow}`}
            style={{ top: tooltipPos.top, left: tooltipPos.left }}
            onClick={e => e.stopPropagation()}
          >
            <div className="tour-progress-bar">
              <div className="tour-progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="tour-tooltip-body">
              <div className="tour-step-counter">Step {step + 1} of {total}</div>
              <div className="tour-tooltip-title">{current.title}</div>
              <div className="tour-tooltip-text">{current.body}</div>
              <div className="tour-tooltip-footer">
                {step > 0 && (
                  <button className="btn" style={{ minHeight: 30, fontSize: 12 }} onClick={() => setStep(s => s - 1)}>
                    Prev
                  </button>
                )}
                <span style={{ flex: 1 }} />
                {isLast ? (
                  <button className="btn btn-primary" style={{ minHeight: 30, fontSize: 12 }} onClick={endTour}>
                    {activeTour === 'staff' ? "Done — I'm all set" : "Done — let's build a schedule"}
                  </button>
                ) : (
                  <button className="btn btn-primary" style={{ minHeight: 30, fontSize: 12 }} onClick={() => setStep(s => s + 1)}>
                    Next
                  </button>
                )}
              </div>
            </div>
            {(tooltipPos.arrow === 'top' || tooltipPos.arrow === 'bottom') && (
              <div className="tour-arrow" style={{ left: tooltipPos.arrowLeft }} />
            )}
            {(tooltipPos.arrow === 'left' || tooltipPos.arrow === 'right') && (
              <div className="tour-arrow" />
            )}
          </div>
        );
      })()}
    </TourContext.Provider>
  );
}
