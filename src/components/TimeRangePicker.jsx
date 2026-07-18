/**
 * Shared time-range picker — used by both slot editors (Middle/Training)
 * and the task time editor / add-task form.
 *
 * Usage — self-contained with Save/Cancel (slot and task inline editors):
 *   <div className="variable-time-editor" onClick={e => e.stopPropagation()}>
 *     <TimeRangePicker
 *       defaultStart={480}          // minutes, or null for empty
 *       defaultEnd={null}
 *       defaultEndIsClose={true}
 *       onSave={(start, end) => …}  // end is minutes | 'close' | null
 *       onCancel={onClose}
 *       saveLabel="Save"
 *     />
 *   </div>
 *
 * Usage — embedded inside a form (onChange mode, no Save/Cancel buttons):
 *   <TimeRangePicker
 *     defaultStart={480}
 *     defaultEnd={1020}
 *     defaultEndIsClose={false}
 *     onChange={(startMins, endMins, endIsClose) => setTime(...)}
 *   />
 *   // parent checks validity: endMins != null && endMins > startMins (or endIsClose)
 */

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
  defaultStart      = null,   // minutes | null
  defaultEnd        = null,   // minutes | null  (ignored when defaultEndIsClose=true)
  defaultEndIsClose = false,
  onChange,                   // (startMins, endMins, endIsClose) — for form embedding
  onSave,                     // (startMins, endMinOrClose) — shows Save button when present
  onCancel,                   // () — shows Cancel button when present
  saveLabel         = 'Save',
}) {
  const [startVal, setStartVal] = useState(
    defaultStart != null ? minutesToTimeInput(defaultStart) : ''
  );
  const [endVal, setEndVal] = useState(
    !defaultEndIsClose && defaultEnd != null ? minutesToTimeInput(defaultEnd) : ''
  );
  const [endIsClose, setEndIsClose] = useState(defaultEndIsClose);

  // Derived minutes
  const startMins = startVal ? timeInputToMinutes(startVal) : null;
  const endMins   = endIsClose ? null : (endVal ? timeInputToMinutes(endVal) : null);

  // Validation
  const timeError = !endIsClose && startMins != null && endMins != null && endMins <= startMins
    ? 'End must be after start'
    : null;

  // Notify parent on every change (form-embedding mode)
  useEffect(() => {
    onChange?.(startMins, endMins, endIsClose);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startMins, endMins, endIsClose]);

  const setEnd = (val) => { setEndIsClose(false); setEndVal(val); };
  const setClose = (checked) => { setEndIsClose(checked); if (checked) setEndVal(''); };

  const handleSave = () => {
    if (timeError) return;
    onSave?.(startMins, endIsClose ? 'close' : endMins);
  };

  return (
    <>
      {/* ── Start row ── */}
      <div className="trp-row">
        <span className="vte-label">Start</span>
        <div className="trp-presets">
          {START_PRESETS.map(p => (
            <button
              key={p.value}
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

      {/* ── End row ── */}
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
                    ? setClose(true)
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
        <label className="vte-close-toggle">
          <input
            type="checkbox"
            checked={endIsClose}
            onChange={e => setClose(e.target.checked)}
          />
          <span>Close</span>
        </label>
      </div>

      {/* ── Validation error ── */}
      {timeError && <div className="trp-error">{timeError}</div>}

      {/* ── Save / Cancel (inline-editor mode only) ── */}
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
