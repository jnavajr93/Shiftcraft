import { useState, useEffect, useContext, createContext } from 'react';
import { GraduationCap } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';

// ─── Tour step definitions ─────────────────────────────────────────────────
//
// Fields:
//   target    — data-tour attribute value to anchor to; null = always centered
//   title     — tooltip heading
//   body      — tooltip text
//   centered  — force centered regardless of target (use for steps with no
//               reliable anchor, e.g. "not posted" state that may not be visible)
//   done      — marks the final step (shows "Done" button instead of "Next")
//
// Mobile note:
//   Steps whose target has display:none on mobile (topbar-mobile-hidden elements)
//   automatically fall back to CENTERED() because getBoundingClientRect() returns
//   a zero-size rect for hidden elements — no special handling needed.

const STAFF_STEPS = [
  {
    target: 'search-bar',
    title: 'Find your schedule',
    body: 'Type your name in the search bar to highlight every shift assigned to you this week. Everything else dims so you can scan the board at a glance.',
  },
  {
    target: 'week-board',
    title: 'Reading the board',
    body: 'Each column is a day of the week. Each card is a clinic running that day — your role (Scribe, Opener, Closing…) appears in the slot next to your name. On a phone, scroll sideways to move between days.',
  },
  {
    target: 'slot-scribe',
    title: 'Tap your name chip',
    body: 'Tap your name on any assignment to open your personal week view — every shift listed in time order so you can see your full schedule at once.',
  },
  {
    target: null,
    title: 'Schedule not posted yet?',
    body: 'If the board is empty or shows a "not posted" notice, your manager hasn\'t published this week yet. Only the most recently posted schedule is visible to staff.',
    centered: true,
  },
  {
    target: 'help-button',
    title: 'Replay anytime',
    body: 'Tap the ? button whenever you want to walk through this tour again. That\'s everything — you\'re all set.',
    done: true,
  },
];

const ADMIN_STEPS = [
  {
    target: 'admin-button',
    title: 'Entering manager mode',
    body: 'Click Manager and enter your PIN plus your initials. Your initials are stamped on every change in the log — so the team always knows who made each edit.',
  },
  {
    target: 'week-nav',
    title: 'Week navigation',
    body: 'Use the arrows to move between weeks, or click the week label to jump to any date. The Today button snaps you back to the current week. Weeks with unpublished changes are marked so you don\'t lose track.',
  },
  {
    target: 'staff-sidebar',
    title: 'Staff panel',
    body: 'All staff listed by grade with their live weekly hours. Drag any name directly onto a clinic slot to assign them — or click a slot to pick from the popover. Hours update instantly.',
  },
  {
    target: 'clinic-card',
    title: 'Clinic cards',
    body: 'Each card is one clinic for the day. The badge shows patient count — amber means busy, red means 68+ patients. Click the power icon in the card header to mark a clinic closed for the week; it disappears from staff view.',
  },
  {
    target: 'slot-scribe',
    title: 'Filling slots',
    body: 'Click any empty slot to open the staff picker. Best-fit staff appear first, sorted by grade and skills. Role mismatches and scheduling conflicts are flagged with a reason — you can override if needed.',
  },
  {
    target: 'slot-middle',
    title: 'Middle and Training',
    body: 'Add a Middle or Training tech when the clinic needs extra coverage. Each gets its own custom start/end time that counts toward their weekly hours.',
  },
  {
    target: 'hours-bar',
    title: 'Hours tracker',
    body: 'Totals update live with every assignment. Staff approaching their weekly hour target are highlighted in amber. Use this to balance the load before you post.',
  },
  {
    target: 'additional-tasks',
    title: 'Additional tasks',
    body: 'Assign off-clinic work — Triage, Imaging Upload, Training, and custom tasks — here. Set a start/end time or leave it as all-shift. Hours count toward the weekly total.',
  },
  {
    target: 'generate-button',
    title: 'AI schedule generation',
    body: 'Click Generate and Claude fills the entire week using each staff member\'s skills, availability, constraints, and provider locks. Every slot is editable afterward — generation is a starting point, not a final answer.',
  },
  {
    target: 'post-button',
    title: 'Draft → Posted',
    body: 'Every edit is a draft — staff cannot see it until you Post. The amber banner at the top reminds you when you have unpublished changes. Shiftcraft checks for conflicts and coverage gaps before going live.',
  },
  {
    target: 'log-button',
    title: 'Change log',
    body: 'Every assignment change is recorded with a timestamp and the initials of who made it. Open History to review edits, investigate a change, or show accountability to your team.',
  },
  {
    target: 'setup-tab',
    title: 'Setup',
    body: 'Three sections: People (grades, skills, day-off patterns, provider locks), Clinics (hours, patient count), and Locations. Configure once — applies to every week going forward.',
    done: true,
  },
  // ── PLACEHOLDER: Calendar / Absences step goes here when that feature ships ──
];

// ─── Tooltip positioning ───────────────────────────────────────────────────

const CENTERED = () => ({
  top: Math.max(8, Math.round(window.innerHeight / 2) - 100),
  left: Math.max(8, Math.round(window.innerWidth / 2) - Math.min(144, Math.round((window.innerWidth - 24) / 2))),
  arrow: null,
  centered: true,
});

function getTooltipPosition(targetEl) {
  if (!targetEl) return CENTERED();

  const rect = targetEl.getBoundingClientRect();
  // Zero-size rect = element is hidden (display:none on mobile, etc.) → center
  if (rect.width === 0 && rect.height === 0) return CENTERED();

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Tooltip width is responsive: min(288px, 100vw - 24px)
  const TW = Math.min(288, vw - 24);
  const TH = 200; // generous estimate — better to overshoot than clip
  const GAP = 12;
  const MARGIN = 8;

  // Clamp rect into visible range
  const top    = Math.max(0, Math.min(rect.top,    vh));
  const bottom = Math.max(0, Math.min(rect.bottom, vh));
  const left   = Math.max(0, Math.min(rect.left,   vw));

  const clampLeft = (l) => Math.max(MARGIN, Math.min(l, vw - TW - MARGIN));
  const arrowX = (l) => Math.min(Math.max(left + rect.width / 2 - l, 20), TW - 20);

  // Prefer below
  if (bottom + TH + GAP < vh) {
    const l = clampLeft(left);
    return { top: bottom + GAP, left: l, arrow: 'top', arrowLeft: arrowX(l) };
  }
  // Try above
  if (top - TH - GAP > 0) {
    const l = clampLeft(left);
    return { top: top - TH - GAP, left: l, arrow: 'bottom', arrowLeft: arrowX(l) };
  }
  // Try right (only if there's room — avoids overflow on narrow screens)
  if (rect.right + TW + GAP < vw) {
    return { top: Math.max(MARGIN, Math.min(top, vh - TH - MARGIN)), left: rect.right + GAP, arrow: 'left', arrowLeft: 0 };
  }
  // Try left
  if (left - TW - GAP > 0) {
    return { top: Math.max(MARGIN, Math.min(top, vh - TH - MARGIN)), left: Math.max(MARGIN, left - TW - GAP), arrow: 'right', arrowLeft: 0 };
  }
  // Everything fails → center
  return CENTERED();
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

  // Auto-show welcome card after 1 second on first visit
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
      // Steps with centered:true or null target skip element lookup
      if (currentStep.centered || !currentStep.target) {
        setTooltipPos(CENTERED());
        return;
      }
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
      if (currentStep.centered || !currentStep.target) {
        setTooltipPos(CENTERED());
        return;
      }
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
          <div className="tour-welcome-body">
            {isAdmin
              ? 'Want a quick walkthrough of manager features — assigning staff, posting, and the change log?'
              : 'Want a quick tour so you can find your schedule and read the board?'}
          </div>
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
              {tooltipPos.centered && current.target && (
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
