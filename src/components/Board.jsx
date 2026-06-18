import { useState } from 'react';
import { minToStr } from '../engine/schema.js';

function minToTimeInput(m) {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
function timeInputToMin(t) {
  const [h, m] = (t || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Returns true if this shift card should be highlighted given active filters.
function cardMatches(card, filters) {
  const { search, personId, locationName, roleName, day: filterDay } = filters;
  if (!search && !personId && !locationName && !roleName) return true;
  if (search) {
    const term = search.toLowerCase();
    if (!card.assigned.some((a) => a.name.toLowerCase().includes(term))) return false;
  }
  if (personId && !card.assigned.some((a) => a.personId === personId)) return false;
  if (locationName && card.location !== locationName) return false;
  if (roleName && !card.assigned.some((a) => a.role === roleName)) return false;
  return true;
}

export default function Board({ result, week, flexMode, isAdmin, filters = {}, onSwap, onUpdateShiftTime }) {
  const [editingTime, setEditingTime] = useState(null);
  const [draftTime, setDraftTime] = useState({ start: '', end: '' });
  const [dragOverKey, setDragOverKey] = useState(null);

  const allDays = Object.keys(result);
  const days = filters.day ? allDays.filter((d) => d === filters.day) : allDays;
  const hasFilters = !!(filters.search || filters.personId || filters.locationName || filters.roleName);

  if (!days.length) {
    return <div className="empty">No shifts defined yet — add shifts in Setup, then return here.</div>;
  }

  const startEditTime = (s) => {
    setEditingTime(s.shiftId);
    setDraftTime({ start: minToTimeInput(s.start), end: minToTimeInput(s.end) });
  };
  const commitTime = (shiftId) => {
    onUpdateShiftTime?.(shiftId, timeInputToMin(draftTime.start), timeInputToMin(draftTime.end));
    setEditingTime(null);
  };

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
      onSwap?.(fromDay, fromShiftIdx, personIdx, day, shiftIdx);
    } catch { /* ignore */ }
  };

  return (
    <div>
      {week && (
        <div className="week-banner">
          Showing <strong>Week {week}</strong> — use the toggle above to switch
        </div>
      )}
      <div className="board-wrap">
        <div className="board" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(160px, 1fr))` }}>
          {days.map((day) => (
            <div className="day-col" key={day}>
              <div className="day-header">{day}</div>

              {result[day].shifts.map((s, shiftIdx) => {
                const dropKey = `${day}-${shiftIdx}`;
                const isOver = dragOverKey === dropKey;
                const isEditingTime = editingTime === s.shiftId;
                const matched = !hasFilters || cardMatches(s, filters);

                return (
                  <div
                    key={shiftIdx}
                    className={
                      'shift-card' +
                      (isOver ? ' drop-target' : '') +
                      (hasFilters && !matched ? ' dim' : '')
                    }
                    onDragOver={isAdmin ? (e) => { e.preventDefault(); setDragOverKey(dropKey); } : undefined}
                    onDragLeave={isAdmin ? (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverKey(null); } : undefined}
                    onDrop={isAdmin ? (e) => handleDrop(e, day, shiftIdx) : undefined}
                  >
                    {/* Header */}
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

                    {/* Time — click-to-edit in admin only */}
                    {isAdmin && isEditingTime ? (
                      <div className="time-editor">
                        <input type="time" value={draftTime.start}
                          onChange={(e) => setDraftTime((d) => ({ ...d, start: e.target.value }))} />
                        <span style={{ color: 'var(--ink-faint)', fontSize: 'var(--t-xs)' }}>–</span>
                        <input type="time" value={draftTime.end}
                          onChange={(e) => setDraftTime((d) => ({ ...d, end: e.target.value }))} />
                        <button className="btn primary sm" onClick={() => commitTime(s.shiftId)}>Save</button>
                        <button className="btn sm" onClick={() => setEditingTime(null)}>✕</button>
                      </div>
                    ) : (
                      <div
                        className={'sc-time' + (isAdmin ? ' editable' : '')}
                        onClick={isAdmin ? () => startEditTime(s) : undefined}
                        title={isAdmin ? 'Click to edit times' : undefined}
                      >
                        {minToStr(s.start)} – {minToStr(s.end)}
                      </div>
                    )}

                    {/* Assigned chips */}
                    <div>
                      {s.assigned.length === 0 && (
                        <span style={{ fontSize: 'var(--t-xs)', color: 'var(--ink-faint)' }}>No one assigned</span>
                      )}
                      {s.assigned.map((a, personIdx) => (
                        <span
                          key={personIdx}
                          className={'chip' + (isAdmin ? ' draggable' : '')}
                          draggable={isAdmin}
                          onDragStart={isAdmin ? (e) => handleDragStart(e, day, shiftIdx, personIdx) : undefined}
                        >
                          <span className="swatch" style={{ background: a.color }} />
                          {a.name}
                          <span className="role">{a.role}</span>
                        </span>
                      ))}
                    </div>

                    {/* Issues */}
                    {result[day].issues
                      .filter((iss) => iss.startsWith(s.shiftName))
                      .map((iss, k) => <div className="issue" key={k}>{iss}</div>)}
                  </div>
                );
              })}

              {result[day].unplaced.length > 0 && (
                <div className="unplaced">
                  <div className="lbl">Unassigned</div>
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
    </div>
  );
}
