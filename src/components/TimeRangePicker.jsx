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
  defaultStart       = null,
  defaultEnd         = null,
  defaultEndIsClose  = false,
  defaultStartIsOpen = false,  // true → Open chip starts active, time input hidden (openSemantic only)
  onChange,
  onSave,
  onCancel,
  saveLabel          = 'Save',
  openTime           = null,   // if provided, shows "Open" chip at start of start presets
  openSemantic       = false,  // when true: Open chip stores null (semantic); badge replaces input; mirrors Close
}) {
  // startIsOpen: only tracked/meaningful when openSemantic is true
  const [startIsOpen, setStartIsOpen] = useState(openSemantic && defaultStartIsOpen);
  const [startVal, setStartVal] = useState(
    (openSemantic && defaultStartIsOpen) ? '' : (defaultStart != null ? minutesToTimeInput(defaultStart) : '')
  );
  const [endVal, setEndVal] = useState(
    !defaultEndIsClose && defaultEnd != null ? minutesToTimeInput(defaultEnd) : ''
  );
  const [endIsClose, setEndIsClose] = useState(defaultEndIsClose);

  // When openSemantic+startIsOpen, startMins is null (semantic — not resolved here)
  const startMins = (openSemantic && startIsOpen) ? null : (startVal ? timeInputToMinutes(startVal) : null);
  const endMins   = endIsClose ? null : (endVal ? timeInputToMinutes(endVal) : null);

  // Resolve start for validation: Open chip resolves to openTime so we can catch end-before-open errors
  const resolvedStartForValidation = (openSemantic && startIsOpen) ? openTime : startMins;
  const timeError = !endIsClose && resolvedStartForValidation != null && endMins != null && endMins <= resolvedStartForValidation
    ? 'End must be after start'
    : null;

  useEffect(() => {
    onChange?.(startMins, endMins, endIsClose);
  }, [startMins, endMins, endIsClose]); // eslint-disable-line react-hooks/exhaustive-deps

  const setEnd = (val) => { setEndIsClose(false); setEndVal(val); };
  const setClose = (active) => { setEndIsClose(active); if (active) setEndVal(''); };

  const handleSave = () => {
    if (timeError) return;
    // openSemantic + startIsOpen → send null (caller stores null = Open semantic)
    onSave?.(openSemantic && startIsOpen ? null : startMins, endIsClose ? 'close' : endMins);
  };

  // Open chip value: '__open__' sentinel when openSemantic (avoids collision with literal minute values);
  // literal openTime when not openSemantic (preserves original behaviour for middle/training/scribe/obs).
  const startChips = openTime != null
    ? [{ label: 'Open', value: openSemantic ? '__open__' : openTime }, ...START_PRESETS]
    : START_PRESETS;

  return (
    <>
      {/* ── Start row ── */}
      <div className="trp-row">
        <span className="vte-label">Start</span>
        <div className="trp-presets">
          {startChips.map(p => {
            const isOpenChip = p.value === '__open__';
            const isActive = isOpenChip
              ? (openSemantic && startIsOpen)
              : (!startIsOpen && startMins === p.value);
            return (
              <button
                key={String(p.value)}
                type="button"
                className={`trp-chip${isActive ? ' active' : ''}`}
                onClick={() => {
                  if (isOpenChip) {
                    setStartIsOpen(true);
                    setStartVal('');
                  } else {
                    setStartIsOpen(false);
                    setStartVal(minutesToTimeInput(p.value));
                  }
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        {(openSemantic && startIsOpen) ? (
          <span className="vte-close-badge">Open</span>
        ) : (
          <input
            type="time"
            className="vte-input"
            step="900"
            value={startVal}
            onChange={e => { if (openSemantic) setStartIsOpen(false); setStartVal(e.target.value); }}
            autoFocus={!!onSave}
          />
        )}
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
