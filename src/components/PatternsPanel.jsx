import { useState, useMemo } from 'react';
import { X, RotateCcw } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { computePatterns } from '../data/patterns.js';

const SLOT_LABEL = {
  scribe:           'Scribe',
  opener:           'Opener',
  closing:          'Closing',
  middle:           'Middle',
  training:         'Training',
  frontDesk:        'Front Desk',
  openingFrontDesk: 'Opening FD',
  closingFrontDesk: 'Closing FD',
  preop:            'Pre-Op/PACU',
  sterile:          'Sterile',
  circulator:       'Circulator',
  scrub:            'Scrub',
};

// Capitalize display name from normalized lowercase
function capitalizeLocation(loc) {
  return loc.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function PatternRow({ pattern, onDismiss, onRestore }) {
  const slot = SLOT_LABEL[pattern.slotType] ?? pattern.slotType;
  const loc  = capitalizeLocation(pattern.location);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 0', borderBottom: '0.5px solid var(--border)',
      opacity: pattern.dismissed ? 0.45 : 1,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {pattern.personName} → {slot} @ {loc}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
          {pattern.day} · {pattern.weekCount} {pattern.weekCount === 1 ? 'week' : 'weeks'} · score {pattern.score}
        </div>
      </div>
      {onDismiss && (
        <button
          className="btn btn-icon"
          style={{ minHeight: 28, padding: '3px 6px', flexShrink: 0 }}
          title="Dismiss this pattern"
          onClick={onDismiss}
        >
          <X size={14} />
        </button>
      )}
      {onRestore && (
        <button
          className="btn btn-icon"
          style={{ minHeight: 28, padding: '3px 6px', flexShrink: 0 }}
          title="Restore this pattern"
          onClick={onRestore}
        >
          <RotateCcw size={14} />
        </button>
      )}
    </div>
  );
}

export default function PatternsPanel({ onClose }) {
  const { placementHistory, dismissedPatterns, dismissPattern, undismissPattern } = useApp();
  const [showDismissed, setShowDismissed] = useState(false);

  const patterns = useMemo(
    () => computePatterns(placementHistory, dismissedPatterns),
    [placementHistory, dismissedPatterns]
  );

  const activePatterns    = patterns.filter(p => !p.dismissed);
  const dismissedArr      = patterns.filter(p =>  p.dismissed);
  const totalWeeks        = placementHistory.length > 0
    ? new Set(placementHistory.map(e => e.weekStr)).size
    : 0;

  return (
    <div className="config-panel open" style={{ zIndex: 195, width: 360 }}>
      <div className="config-panel-header">
        <div style={{ fontWeight: 500 }}>Learned Patterns</div>
        <button className="btn btn-icon" onClick={onClose}><X size={18} /></button>
      </div>

      <div
        className="config-panel-body"
        style={{ flex: 1, overflowY: 'auto', gap: 0, padding: '12px 16px' }}
      >
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
          {totalWeeks > 0
            ? `${totalWeeks} weeks of history · patterns with score ≥ 2 shown`
            : 'No history yet — patterns appear after schedules are generated or edited'}
        </div>

        {activePatterns.length === 0 && totalWeeks > 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
            No strong patterns yet. Keep generating and editing schedules.
          </div>
        )}

        {activePatterns.map(p => (
          <PatternRow
            key={p.key}
            pattern={p}
            onDismiss={() => dismissPattern(p.key)}
          />
        ))}

        {dismissedArr.length > 0 && (
          <button
            className="btn"
            style={{ width: '100%', marginTop: 12, fontSize: 12, minHeight: 32 }}
            onClick={() => setShowDismissed(s => !s)}
          >
            {showDismissed ? 'Hide dismissed' : `Show ${dismissedArr.length} dismissed`}
          </button>
        )}

        {showDismissed && dismissedArr.map(p => (
          <PatternRow
            key={p.key}
            pattern={p}
            onRestore={() => undismissPattern(p.key)}
          />
        ))}
      </div>

      <div style={{
        padding: '10px 16px', borderTop: '0.5px solid var(--border)',
        fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, lineHeight: 1.5,
      }}>
        Patterns influence generation as a tiebreaker when multiple staff are equally eligible.
        Dismiss any pattern you don't want the solver to reinforce.
      </div>
    </div>
  );
}
