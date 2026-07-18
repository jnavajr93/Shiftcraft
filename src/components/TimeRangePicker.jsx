import { useState, useEffect } from 'react';
import { Check, X as XIcon } from 'lucide-react';
import { minutesToTimeInput, timeInputToMinutes } from '../data/seed.js';

export const START_PRESETS = [
  { label: '7:00 AM',  value: 420 },
  { label: '8:00 AM',  value: 480 },
  { label: '9:00 AM',  value: 540 },
  { label: '12:00 PM', value: 720 },
];

export const END_PRESETS = [
  { label: '12:00 PM', value: 720  },
  { label: '3:00 PM',  value: 900  },
  { label: '5:00 PM',  value: 1020 },
  { label: 'Close',    value: 'close' },
];

export function TimeRangePicker({
  defaultStart      = null,
  defaultEnd        = null,
  defaultEndIsClose = false,
  onChange,
  onSave,
  onCancel,
  saveLabel         = 'Save',
  openTime          = null,   // NEW: if provided, shows "Open" chip at start of start presets
}) {
  const [startVal, setStartVal] = useState(
    defaultStart != null ? minutesToTimeInput(defaultStart) : ''
  );
  const [endVal, setEndVal] = useState(
    !defaultEndIsClose && defaultEnd != null ? minutesToTimeInput(defaultEnd) : ''
  );
  const [endIsClose, setEndIsClose] = useState(defaultEndIsClose);

  const startMins = startVal ? timeInputToMinutes(startVal) : null;
  const endMins   = endIsClose ? null : (endVal ? timeInputToMinutes(endVal) : null);

  const timeError = !endIsClose && startMins != null && endMins != null && endMins <= startMins
    ? 'End must be after start'
    : null;

  useEffect(() => {
    onChange?.(startMins, endMins, endIsClose);
  }, [startMins, endMins, endIsClose]); // eslint-disable-line react-hooks/exhaustive-deps

  const setEnd = (val) => { setEndIsClose(false); setEndVal(val); };
  const setClose = (active) => { setEndIsClose(active); if (active) setEndVal(''); };

  const handleSave = () => {
    if (timeError) return;
    onSave?.(startMins, endIsClose ? 'close' : endMins);
  };

  // Build start chips — prepend "Open" if openTime is provided
  const startChips = openTime != null
    ? [{ label: 'Open', value: openTime }, ...START_PRESETS]
    : START_PRESETS;

  return (
    <>
      {/* ── Start row ── */}
      <div className="trp-row">
        <span className="vte-label">Start</span>
        <div className="trp-presets">
          {startChips.map(p => (
            <button
              key={String(p.value)}
              type="button"
              className={`trp-chip${startMins === p.value ? ' active' : ''}`}
              onClick={() => setStartVal(minutesToTimeInput(p.value))}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input
          type="time"
          className="vte-input"
          step="900"
          value={startVal}
          onChange={e => setStartVal(e.target.value)}
          autoFocus={!!onSave}
        />
      </div>

      {/* ── End row — Close is now a pill chip, not a separate checkbox ── */}
      <div className="trp-row">
        <span className="vte-label">End</span>
        <div className="trp-presets">
          {END_PRESETS.map(p => {
            const isActive = p.value === 'close'
              ? endIsClose
              : !endIsClose && endMins === p.value;
            return (
              <button
                key={String(p.value)}
                type="button"
                className={`trp-chip${isActive ? ' active' : ''}`}
                onClick={() =>
                  p.value === 'close'
                    ? setClose(!endIsClose)   // toggle: click again to unselect
                    : setEnd(minutesToTimeInput(p.value))
                }
              >
                {p.label}
              </button>
            );
          })}
        </div>
        {endIsClose ? (
          <span className="vte-close-badge">Close</span>
        ) : (
          <input
            type="time"
            className="vte-input"
            step="900"
            value={endVal}
            onChange={e => setEnd(e.target.value)}
          />
        )}
        {/* Close checkbox REMOVED — Close is now a selectable pill above */}
      </div>

      {timeError && <div className="trp-error">{timeError}</div>}

      {onSave && (
        <div className="variable-time-actions">
          <button
            className="btn btn-primary"
            style={{ minHeight: 26, fontSize: 11, padding: '3px 10px' }}
            disabled={!!timeError}
            onClick={handleSave}
          >
            <Check size={11} /> {saveLabel}
          </button>
          {onCancel && (
            <button
              className="btn"
              style={{ minHeight: 26, fontSize: 11, padding: '3px 8px' }}
              onClick={onCancel}
            >
              <XIcon size={11} />
            </button>
          )}
        </div>
      )}
    </>
  );
}
