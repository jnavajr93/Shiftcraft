import { useState, useEffect, useContext, createContext } from 'react';
import { GraduationCap } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';

// ─── Tour step definitions ─────────────────────────────────────────────────

const STAFF_STEPS = [
  { target: 'week-board',       title: 'Your weekly schedule',              body: 'Each column is a day. Each card is a clinic running at a specific location. Scroll down to see all clinics.' },
  { target: 'search-bar',       title: 'Two ways to find your shift',       body: 'Type your name in the search bar to highlight all your shifts across the week. Everything else dims.' },
  { target: 'clinic-card',      title: 'Or tap your name directly',         body: 'Tap your name on any shift chip to open your personal weekly view — every assignment listed in one place.' },
  { target: 'slot-scribe',      title: 'Role slots',                        body: 'Every clinic has a Scribe, Opener, and Closing tech. Middle and Training appear when extra coverage is needed.' },
  { target: 'additional-tasks', title: 'Additional tasks',                  body: 'Off-clinic assignments like Triage or Imaging Upload appear here with their shift time. Check if you have been assigned to any.' },
  { target: 'help-button',      title: 'Replay this tour anytime',          body: 'Click the ? icon whenever you want to walk through the tour again.', done: true },
];

const ADMIN_STEPS = [
  { target: 'week-board',       title: 'The weekly schedule board',           body: 'Your full week at a glance — every location, every provider, every slot. This is where you build the schedule.' },
  { target: 'staff-sidebar',    title: 'Your staff panel',                    body: 'All staff listed by grade with their current hours. Drag any name directly onto a clinic slot to assign them.' },
  { target: 'clinic-card',      title: 'Clinic cards',                        body: 'Each card is one clinic. The badge shows patient count — amber is busy, red is high volume (68+ patients).' },
  { target: 'clinic-card',      title: 'Turn off an unscheduled clinic',      body: 'See the power icon on the clinic card header? Click it to mark a clinic closed for the week. It dims in admin view and disappears entirely in staff view.' },
  { target: 'slot-scribe',      title: 'Click any slot to assign',            body: 'Click an empty slot to open a staff picker. Your best-fit staff appear at the top — sorted by grade and skills, already-assigned staff are excluded.' },
  { target: 'staff-sidebar',    title: 'Or drag to assign',                   body: 'Drag any staff card from this sidebar and drop it onto any open slot. Works on touch screens too.' },
  { target: 'slot-middle',      title: 'Optional slots — Middle and Training', body: 'Add a Middle or Training tech when the clinic needs extra coverage. Each gets its own custom start and end time.' },
  { target: 'hours-bar',        title: 'Live hours tracker',                  body: 'Updates instantly with every assignment. Anyone approaching their weekly limit is flagged in amber. No payroll surprises.' },
  { target: 'additional-tasks', title: 'Additional tasks',                    body: 'Assign off-clinic work like Triage or Imaging Upload here. Click the task slot to assign someone, then set the shift time for that task.' },
  { target: 'generate-button',  title: 'Let AI build the schedule',           body: 'Click Generate and Claude fills the entire week based on every staff member\'s skills, availability, constraints, and provider locks.' },
  { target: 'print-button',     title: 'Print the schedule',                  body: 'Generates a clean one-page schedule ready to print or save as PDF. No UI chrome — just the week your team needs to see.' },
  { target: 'log-button',       title: 'Change log',                          body: 'Every schedule change is recorded here with a timestamp — who moved where and when. Full accountability without the paperwork.' },
  { target: 'setup-tab',        title: 'Setup — configure everything',        body: 'Three sections: People, Clinics, and Locations. Set it up once and it applies every week.' },
  { target: 'setup-tab',        title: 'Setup — People',                      body: 'Add staff, set grades (A/B/C), assign skills, lock to providers, set days off and availability windows. The AI uses all of this when generating the schedule.' },
  { target: 'setup-tab',        title: 'Setup — Clinics',                     body: 'Configure each clinic\'s start time, end time, and patient count. Toggle clinics open or closed. Add new clinics per day as your schedule grows.' },
  { target: 'setup-tab',        title: 'Setup — Locations',                   body: 'Add or rename your clinic locations here. Any new location becomes available across all clinics and staff cleared-location settings.', done: true },
];

// ─── Tooltip positioning ───────────────────────────────────────────────────

const CENTERED = () => ({
  top: Math.max(8, Math.round(window.innerHeight / 2) - 100),
  left: Math.max(8, Math.round(window.innerWidth / 2) - 144),
  arrow: null,
  centered: true,
});

function getTooltipPosition(targetEl) {
  if (!targetEl) return CENTERED();

  const rect = targetEl.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return CENTERED();

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const TW = 288;
  const TH = 180;
  const GAP = 12;

  // Clamp rect into visible range (element may be partially off-screen after scroll)
  const top    = Math.max(0, Math.min(rect.top,    vh));
  const bottom = Math.max(0, Math.min(rect.bottom, vh));
  const left   = Math.max(0, Math.min(rect.left,   vw));

  // Prefer below
  if (bottom + TH + GAP < vh) {
    return {
      top: bottom + GAP,
      left: Math.max(8, Math.min(left, vw - TW - 8)),
      arrow: 'top',
      arrowLeft: Math.min(Math.max(left + rect.width / 2 - Math.max(8, Math.min(left, vw - TW - 8)), 20), TW - 20),
    };
  }
  // Try above
  if (top - TH - GAP > 0) {
    return {
      top: top - TH - GAP,
      left: Math.max(8, Math.min(left, vw - TW - 8)),
      arrow: 'bottom',
      arrowLeft: Math.min(Math.max(left + rect.width / 2 - Math.max(8, Math.min(left, vw - TW - 8)), 20), TW - 20),
    };
  }
  // Try right
  if (rect.right + TW + GAP < vw) {
    return {
      top: Math.max(8, Math.min(top, vh - TH - 8)),
      left: rect.right + GAP,
      arrow: 'left',
      arrowLeft: 0,
    };
  }
  // Fallback left
  return {
    top: Math.max(8, Math.min(top, vh - TH - 8)),
    left: Math.max(8, left - TW - GAP),
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

    let outerT, innerT;

    const positionTooltip = () => {
      const el = document.querySelector(`[data-tour="${currentStep.target}"]`);
      if (!el) {
        setTooltipPos(CENTERED());
        return;
      }
      const rect = el.getBoundingClientRect();
      const inView =
        rect.width > 0 &&
        rect.top >= 0 &&
        rect.bottom <= window.innerHeight;
      if (inView) {
        setTooltipPos(getTooltipPosition(el));
      } else {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        innerT = setTimeout(() => setTooltipPos(getTooltipPosition(el)), 350);
      }
    };

    const onResize = () => {
      const el = document.querySelector(`[data-tour="${currentStep.target}"]`);
      setTooltipPos(getTooltipPosition(el));
    };

    outerT = setTimeout(positionTooltip, 80);
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(outerT);
      clearTimeout(innerT);
      window.removeEventListener('resize', onResize);
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
        const arrowClass = tooltipPos.arrow ? `arrow-${tooltipPos.arrow}` : '';

        return (
          <div
            className={`tour-tooltip ${arrowClass}`}
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
              {tooltipPos.centered && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Scroll to see this element
                </div>
              )}
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
