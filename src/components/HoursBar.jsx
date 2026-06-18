import { useMemo } from 'react';
import { computeHours } from '../engine/solver.js';
import { CONSTRAINT_TYPES as CT } from '../engine/schema.js';

export default function HoursBar({ result, cfg, defaultCap = 40 }) {
  const hours = useMemo(() => computeHours(result), [result]);

  // Per-person cap: use HOUR_CAP constraint if present, else defaultCap.
  const capFor = (personId) => {
    const c = cfg.constraints.find(
      (x) => x.enabled && x.type === CT.HOUR_CAP && x.personId === personId
    );
    return c?.count ?? defaultCap;
  };

  const active = cfg.people.filter((p) => (hours[p.id] ?? 0) > 0);
  if (!active.length) return null;

  return (
    <div className="hours-bar" role="status" aria-label="Weekly hours summary">
      <div className="hours-bar-inner">
        <span className="hours-bar-title">Hours</span>
        {active.map((p) => {
          const h = hours[p.id];
          const cap = capFor(p.id);
          const over = h > cap;
          const label = Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
          return (
            <div
              key={p.id}
              className={'hours-person' + (over ? ' over-cap' : '')}
              title={over ? `${p.name}: ${label} — over ${cap}h cap` : `${p.name}: ${label}`}
            >
              <span className="swatch" style={{ background: p.color }} />
              <span className="hours-name">{p.name}</span>
              <span className="hours-val">{label}</span>
              {over && <span className="hours-flag" aria-label="over cap">!</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
