import { useEffect } from 'react';
import { X, PhoneCall } from 'lucide-react';
import { useApp, mondayOfWeek } from '../context/AppContext.jsx';
import { getOnCallForWeek, addWeeks, formatBlockRange } from '../utils/oncall.js';

const ONCALL_COLOR = '#f59e0b';
const WEEKS_AHEAD = 26;

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
  // Compare Monday timestamps
  const cMs = mondayOfWeek(currentWeek).getTime();
  const sMs = mondayOfWeek(block.startWeek).getTime();
  const eMs = mondayOfWeek(block.endWeek).getTime() + 6 * 86400000;
  return cMs >= sMs && cMs <= eMs;
}

/**
 * Read-only on-call rotation view — safe for staff.
 * Shows the next 26 weeks of on-call blocks: who, when, any override flag.
 * Contains NO absence, closure, doctor-off, or research data.
 */
export default function OnCallRotationView({ onClose }) {
  const { oncall, oncallOverrides, data, currentWeek } = useApp();

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!oncall?.rotation?.length || !oncall?.anchorWeek) return null;

  const blocks = buildBlocks(currentWeek, oncall, oncallOverrides, data.people);

  return (
    <div className="oncall-rotation-overlay" role="dialog" aria-modal="true" aria-label="On-Call Rotation" onClick={onClose}>
      <div className="oncall-rotation-card" onClick={e => e.stopPropagation()}>
        <div className="oncall-rotation-header">
          <div className="oncall-rotation-header-left">
            <PhoneCall size={16} style={{ color: ONCALL_COLOR, flexShrink: 0 }} />
            <div>
              <div className="oncall-rotation-title">On-Call Rotation</div>
              <div className="oncall-rotation-subtitle">Next {WEEKS_AHEAD} weeks · Read only</div>
            </div>
          </div>
          <button className="overlay-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="oncall-rotation-body">
          {blocks.length === 0 ? (
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
          )}
        </div>
      </div>
    </div>
  );
}
