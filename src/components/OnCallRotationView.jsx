import { useEffect, useState } from 'react';
import { X, PhoneCall, List, CalendarDays } from 'lucide-react';
import { useApp, mondayOfWeek } from '../context/AppContext.jsx';
import { getOnCallForWeek, addWeeks, formatBlockRange } from '../utils/oncall.js';

const ONCALL_COLOR = '#f59e0b';
const WEEKS_AHEAD = 26;
const MONTHS_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/** Convert a UTC Date to ISO week string (e.g. "2026-W31") */
function dateToIsoWeek(d) {
  const thu = new Date(d.getTime() + (3 - ((d.getUTCDay() + 6) % 7)) * 86400000);
  const yearStart = new Date(Date.UTC(thu.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((thu - yearStart) / 86400000 + 1) / 7);
  return `${thu.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Scan WEEKS_AHEAD weeks forward from currentWeek and group consecutive weeks
 * with the same on-call person into display blocks. Respects overrides.
 */
function buildBlocks(currentWeek, oncall, oncallOverrides, people) {
  const blocks = [];
  let cur = null;

  for (let i = 0; i < WEEKS_AHEAD; i++) {
    const w = addWeeks(currentWeek, i);
    const result = getOnCallForWeek(w, oncall, oncallOverrides ?? []);
    if (!result) {
      if (cur) { blocks.push(cur); cur = null; }
      continue;
    }
    if (cur && cur.person === result.person) {
      cur.endWeek = w;
      if (result.isOverride) cur.hasOverride = true;
    } else {
      if (cur) blocks.push(cur);
      const pColor = (people ?? []).find(
        p => p.name.trim().toLowerCase() === result.person.trim().toLowerCase()
      )?.color ?? ONCALL_COLOR;
      cur = {
        person: result.person,
        startWeek: w,
        endWeek: w,
        hasOverride: result.isOverride,
        color: pColor,
        isFirst: i === 0,
      };
    }
  }
  if (cur) blocks.push(cur);
  return blocks;
}

/**
 * Check if currentWeek falls within a block's week range.
 */
function isBlockNow(block, currentWeek) {
  const cMs = mondayOfWeek(currentWeek).getTime();
  const sMs = mondayOfWeek(block.startWeek).getTime();
  const eMs = mondayOfWeek(block.endWeek).getTime() + 6 * 86400000;
  return cMs >= sMs && cMs <= eMs;
}

// ─── Calendar month grid ──────────────────────────────────────────────────────

function MonthGrid({ year, month, oncall, oncallOverrides, people }) {
  const firstDay = new Date(Date.UTC(year, month, 1));
  const lastDayNum = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const firstDow = (firstDay.getUTCDay() + 6) % 7; // Mon=0 … Sun=6

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= lastDayNum; d++) cells.push(new Date(Date.UTC(year, month, d)));
  while (cells.length % 7 !== 0) cells.push(null);

  const today = new Date();
  const todayKey = `${today.getUTCFullYear()}-${today.getUTCMonth()}-${today.getUTCDate()}`;

  return (
    <div className="oncall-cal-month">
      <div className="oncall-cal-month-title">{MONTHS_LONG[month]} {year}</div>
      <div className="oncall-cal-dow-row">
        {['Mo','Tu','We','Th','Fr','Sa','Su'].map(d => (
          <div key={d} className="oncall-cal-dow">{d}</div>
        ))}
      </div>
      <div className="oncall-cal-grid">
        {cells.map((date, i) => {
          if (!date) return <div key={`pad-${i}`} className="oncall-cal-cell oncall-cal-cell--pad" />;

          const weekStr = dateToIsoWeek(date);
          const result = getOnCallForWeek(weekStr, oncall, oncallOverrides ?? []);
          const person = result
            ? (people ?? []).find(p => p.name.trim().toLowerCase() === result.person.trim().toLowerCase())
            : null;
          const color = person?.color ?? (result ? ONCALL_COLOR : null);

          const dayKey = `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
          const isToday = dayKey === todayKey;
          const isWeekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;

          // Show first name on Monday that starts a new block (previous week's person differs)
          const isMonday = date.getUTCDay() === 1;
          const prevWeekStr = dateToIsoWeek(new Date(date.getTime() - 7 * 86400000));
          const prevResult = getOnCallForWeek(prevWeekStr, oncall, oncallOverrides ?? []);
          const isBlockStart = isMonday && result && (!prevResult || prevResult.person !== result.person);

          return (
            <div
              key={dayKey}
              className={[
                'oncall-cal-cell',
                color ? 'oncall-cal-cell--assigned' : '',
                isToday ? 'oncall-cal-cell--today' : '',
                isWeekend ? 'oncall-cal-cell--weekend' : '',
              ].filter(Boolean).join(' ')}
              style={color ? { '--cell-color': color } : undefined}
            >
              <span className="oncall-cal-day-num">{date.getUTCDate()}</span>
              {isBlockStart && (
                <span className="oncall-cal-person-name" style={{ color }}>
                  {result.person.split(' ')[0]}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CalendarView({ oncall, oncallOverrides, people }) {
  const today = new Date();
  const months = [];
  for (let m = 0; m < 4; m++) {
    const totalMonth = today.getUTCMonth() + m;
    months.push({
      year: today.getUTCFullYear() + Math.floor(totalMonth / 12),
      month: totalMonth % 12,
    });
  }
  return (
    <div className="oncall-cal-view">
      {months.map(({ year, month }) => (
        <MonthGrid
          key={`${year}-${month}`}
          year={year}
          month={month}
          oncall={oncall}
          oncallOverrides={oncallOverrides}
          people={people}
        />
      ))}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * Read-only on-call rotation view — safe for staff.
 * Toggle between list (next 26 weeks) and calendar (next 4 months).
 */
export default function OnCallRotationView({ onClose }) {
  const { oncall, oncallOverrides, data, currentWeek } = useApp();
  const [view, setView] = useState('list');

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!oncall?.rotation?.length || !oncall?.anchorWeek) return null;

  const blocks = view === 'list'
    ? buildBlocks(currentWeek, oncall, oncallOverrides, data.people)
    : [];

  return (
    <div className="oncall-rotation-overlay" role="dialog" aria-modal="true" aria-label="On-Call Rotation" onClick={onClose}>
      <div className="oncall-rotation-card" onClick={e => e.stopPropagation()}>
        <div className="oncall-rotation-header">
          <div className="oncall-rotation-header-left">
            <PhoneCall size={16} style={{ color: ONCALL_COLOR, flexShrink: 0 }} />
            <div>
              <div className="oncall-rotation-title">On-Call Rotation</div>
              <div className="oncall-rotation-subtitle">
                {view === 'list' ? `Next ${WEEKS_AHEAD} weeks · Read only` : 'Next 4 months · Read only'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div className="oncall-view-toggle">
              <button
                className={`oncall-view-toggle-btn${view === 'list' ? ' oncall-view-toggle-btn--active' : ''}`}
                onClick={(e) => { e.stopPropagation(); setView('list'); }}
                title="List view"
                aria-label="List view"
              >
                <List size={13} />
              </button>
              <button
                className={`oncall-view-toggle-btn${view === 'calendar' ? ' oncall-view-toggle-btn--active' : ''}`}
                onClick={(e) => { e.stopPropagation(); setView('calendar'); }}
                title="Calendar view"
                aria-label="Calendar view"
              >
                <CalendarDays size={13} />
              </button>
            </div>
            <button className="overlay-close" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="oncall-rotation-body">
          {view === 'list' ? (
            blocks.length === 0 ? (
              <div className="oncall-rotation-empty">No on-call schedule found.</div>
            ) : (
              blocks.map((block, i) => {
                const now = isBlockNow(block, currentWeek);
                return (
                  <div
                    key={i}
                    className={`oncall-rotation-block${now ? ' oncall-rotation-block--now' : ''}`}
                  >
                    <span className="oncall-rotation-block-dot" style={{ background: block.color }} />
                    <div className="oncall-rotation-block-info">
                      <span className="oncall-rotation-block-name">{block.person}</span>
                      <span className="oncall-rotation-block-range">
                        {formatBlockRange(block.startWeek, block.endWeek)}
                      </span>
                    </div>
                    <div className="oncall-rotation-block-badges">
                      {now && <span className="oncall-rotation-badge oncall-rotation-badge--now">Now</span>}
                      {block.hasOverride && (
                        <span className="oncall-rotation-badge oncall-rotation-badge--override">Override</span>
                      )}
                    </div>
                  </div>
                );
              })
            )
          ) : (
            <CalendarView
              oncall={oncall}
              oncallOverrides={oncallOverrides}
              people={data.people}
            />
          )}
        </div>
      </div>
    </div>
  );
}
