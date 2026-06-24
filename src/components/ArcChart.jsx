import { useEffect, useRef } from 'react';

const SIZE = 140;
const STROKE = 12;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;
const CX = SIZE / 2;
const CY = SIZE / 2;

export default function ArcChart({ hours, target, color }) {
  const arcRef = useRef(null);
  const pct = Math.min(hours / (target || 40), 1);
  const isOver = hours > (target || 40);
  const fill = isOver ? 'var(--amber)' : color;

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const el = arcRef.current;
    if (!el) return;
    const finalOffset = CIRC * (1 - pct);
    if (prefersReduced) {
      el.style.strokeDashoffset = finalOffset;
      return;
    }
    el.style.strokeDashoffset = CIRC;
    const start = performance.now();
    const duration = 600;

    function tick(now) {
      const elapsed = now - start;
      const t = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3);
      el.style.strokeDashoffset = CIRC * (1 - eased * pct);
      if (t < 1) requestAnimationFrame(tick);
    }
    const raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pct, prefersReduced]);

  return (
    <div className="arc-chart-container">
      <svg width={SIZE} height={SIZE} style={{ transform: 'rotate(-90deg)' }}>
        {/* Track */}
        <circle
          cx={CX} cy={CY} r={R}
          fill="none"
          stroke="var(--border-strong)"
          strokeWidth={STROKE}
        />
        {/* Arc */}
        <circle
          ref={arcRef}
          cx={CX} cy={CY} r={R}
          fill="none"
          stroke={fill}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC}
          style={{ transition: prefersReduced ? 'none' : undefined }}
        />
      </svg>
      <div style={{ marginTop: -SIZE / 2 - 6, textAlign: 'center', pointerEvents: 'none' }}>
        <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.2 }}>
          {hours}h
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>/ {target ?? 40}h</div>
      </div>
      <div style={{ height: SIZE / 2 - 20 }} />
    </div>
  );
}
