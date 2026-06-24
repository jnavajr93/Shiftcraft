import { minToStr } from '../engine/schema.js';

export default function Board({ result }) {
  const days = Object.keys(result);
  if (!days.length) {
    return <div className="empty">No shifts defined yet. Add shifts in the Setup tab, then come back.</div>;
  }
  return (
    <div className="board">
      {days.map((day) => (
        <div className="day-col" key={day}>
          <div className="day-label">{day}</div>
          {result[day].shifts.map((s, i) => (
            <div className="shift-card" key={i}>
              <div className="sc-head">
                <span className="sc-name">{s.shiftName}</span>
                <span className="sc-loc">{s.location}</span>
              </div>
              <div className="sc-time">{minToStr(s.start)} – {minToStr(s.end)}</div>
              <div>
                {s.assigned.length === 0 && <span className="sc-loc">No one assigned</span>}
                {s.assigned.map((a, j) => (
                  <span className="chip" key={j}>
                    <span className="swatch" style={{ background: a.color }} />
                    {a.name}<span className="role">{a.role}</span>
                  </span>
                ))}
              </div>
              {result[day].issues
                .filter((iss) => iss.startsWith(s.shiftName))
                .map((iss, k) => (
                  <div className="issue" key={k}>{iss}</div>
                ))}
            </div>
          ))}
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
  );
}
