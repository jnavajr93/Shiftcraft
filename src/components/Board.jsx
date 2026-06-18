import { useState } from 'react';
import { minToStr } from '../engine/schema.js';

function minToTimeInput(m) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
function timeInputToMin(t) {
  const [h, m] = (t || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export default function Board({ result, week, flexMode, onSwap, onUpdateShiftTime }) {
  const [editingTime, setEditingTime] = useState(null);   // shiftId being edited
  const [draftTime, setDraftTime] = useState({ start: '', end: '' });
  const [dragOverKey, setDragOverKey] = useState(null);   // 'day-shiftIdx' of drop target

  const days = Object.keys(result);
  if (!days.length) {
    return <div className="empty">No shifts defined yet. Add shifts in the Setup tab, then come back.</div>;
  }

  // ── Time editing ──────────────────────────────────────────────────────────
  const startEditTime = (s) => {
    setEditingTime(s.shiftId);
    setDraftTime({ start: minToTimeInput(s.start), end: minToTimeInput(s.end) });
  };
  const commitTime = (shiftId) => {
    onUpdateShiftTime(shiftId, timeInputToMin(draftTime.start), timeInputToMin(draftTime.end));
    setEditingTime(null);
  };

  // ── Drag handling ─────────────────────────────────────────────────────────
  const handleDragStart = (e, day, shiftIdx, personIdx) => {
    e.dataTransfer.setData('text/plain', JSON.stringify({ day, shiftIdx, personIdx }));
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDrop = (e, day, shiftIdx) => {
    e.preventDefault();
    setDragOverKey(null);
    try {
      const { day: fromDay, shiftIdx: fromShiftIdx, personIdx } =
        JSON.parse(e.dataTransfer.getData('text/plain'));
      if (fromDay === day && fromShiftIdx === shiftIdx) return;
      onSwap(fromDay, fromShiftIdx, personIdx, day, shiftIdx);
    } catch { /* ignore bad payloads */ }
  };

  return (
    <div>
      {week && (
        <div className="week-banner">
          Showing <strong>Week {week}</strong> — toggle above to switch weeks
        </div>
      )}
      <div className="board">
        {days.map((day) => (
          <div className="day-col" key={day}>
            <div className="day-label">{day}</div>

            {result[day].shifts.map((s, shiftIdx) => {
              const dropKey = `${day}-${shiftIdx}`;
              const isOver = dragOverKey === dropKey;
              const isEditingTime = editingTime === s.shiftId;

              return (
                <div
                  key={shiftIdx}
                  className={'shift-card' + (isOver ? ' drop-target' : '')}
                  onDragOver={(e) => { e.preventDefault(); setDragOverKey(dropKey); }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget)) setDragOverKey(null);
                  }}
                  onDrop={(e) => handleDrop(e, day, shiftIdx)}
                >
                  {/* Header row: name, location, flex badges */}
                  <div className="sc-head">
                    <span className="sc-name">{s.shiftName}</span>
                    <span className="sc-loc">{s.location}</span>
                    {flexMode && s.staffing?.map((st, k) => {
                      const delta = st.have - st.min;
                      if (delta === 0) return null;
                      return (
                        <span key={k} className={'staff-badge ' + (delta > 0 ? 'over' : 'under')}>
                          {delta > 0 ? '+' : ''}{delta} {st.role}
                        </span>
                      );
                    })}
                  </div>

                  {/* Time row — click to edit */}
                  {isEditingTime ? (
                    <div className="time-editor">
                      <input
                        type="time"
                        value={draftTime.start}
                        onChange={(e) => setDraftTime((d) => ({ ...d, start: e.target.value }))}
                      />
                      <span style={{ color: 'var(--ink-faint)' }}>–</span>
                      <input
                        type="time"
                        value={draftTime.end}
                        onChange={(e) => setDraftTime((d) => ({ ...d, end: e.target.value }))}
                      />
                      <button className="btn primary sm" onClick={() => commitTime(s.shiftId)}>Save</button>
                      <button className="btn sm" onClick={() => setEditingTime(null)}>✕</button>
                    </div>
                  ) : (
                    <div
                      className="sc-time editable"
                      onClick={() => startEditTime(s)}
                      title="Click to edit shift times"
                    >
                      {minToStr(s.start)} – {minToStr(s.end)}
                    </div>
                  )}

                  {/* Assigned chips — draggable */}
                  <div>
                    {s.assigned.length === 0 && <span className="sc-loc">No one assigned</span>}
                    {s.assigned.map((a, personIdx) => (
                      <span
                        key={personIdx}
                        className="chip draggable"
                        draggable
                        onDragStart={(e) => handleDragStart(e, day, shiftIdx, personIdx)}
                      >
                        <span className="swatch" style={{ background: a.color }} />
                        {a.name}<span className="role">{a.role}</span>
                      </span>
                    ))}
                  </div>

                  {/* Staffing issue warnings */}
                  {result[day].issues
                    .filter((iss) => iss.startsWith(s.shiftName))
                    .map((iss, k) => (
                      <div className="issue" key={k}>{iss}</div>
                    ))}
                </div>
              );
            })}

            {result[day].unplaced.length > 0 && (
              <div className="unplaced">
                <div className="lbl">Available, unassigned</div>
                <div>
                  {result[day].unplaced.map((u, j) => (
                    <span className="chip" key={j}>
                      <span className="swatch" style={{ background: u.color }} />
                      {u.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
