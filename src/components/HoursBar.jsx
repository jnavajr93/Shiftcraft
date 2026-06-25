import { useState } from 'react';
import { ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { calcPersonWeeklyHours } from '../data/seed.js';

// Unit test — runs once at module load
function runHoursTest() {
  const mockClinic = {
    id: 'test', day: 'Mon', week: 'A', location: 'Test', provider: 'Dr. X',
    open: true, startTime: 480, endTime: 1020, patientCount: null,
    slots: { scribe: 'test-person', opener: null, closing: null, middle: null, training: null },
  };
  const result = calcPersonWeeklyHours('test-person', [mockClinic]);
  if (result === 10.25) {
    console.log('Hours calc: PASS');
  } else {
    console.error(`Hours calc: FAIL [got ${result}]`);
  }
}
runHoursTest();

export default function HoursBar() {
  const { data } = useApp();
  const [collapsed, setCollapsed] = useState(false);

  const assigned = data.people
    .map(p => ({ person: p, hours: calcPersonWeeklyHours(p.id, data.clinics, data.additionalTasks) }))
    .filter(({ hours }) => hours > 0);

  const totalHours = assigned.reduce((sum, { hours }) => sum + hours, 0);

  return (
    <div data-tour="hours-bar" className="hours-bar">
      <div className="hours-bar-header" onClick={() => setCollapsed(c => !c)}>
        <span className="hours-bar-title">Hours This Week</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {collapsed && (
            <span className="hours-bar-collapsed-info">{Math.round(totalHours * 10) / 10}h scheduled</span>
          )}
          {collapsed
            ? <ChevronUp size={16} color="var(--text-muted)" />
            : <ChevronDown size={16} color="var(--text-muted)" />}
        </div>
      </div>
      {!collapsed && (
        <div className="hours-bar-body">
          {assigned.length === 0 && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>No staff assigned yet</span>
          )}
          {assigned.map(({ person, hours }) => {
            const target = person.targetHours ?? 40;
            const pct = Math.min(hours / target, 1);
            const isOver = hours > target;
            return (
              <div key={person.id} className="hours-person">
                <div className="dot" style={{ background: person.color }} />
                <span className="hours-person-name">{person.name}</span>
                <div className="progress-track">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${pct * 100}%`,
                      background: isOver ? 'var(--amber)' : 'var(--accent)',
                    }}
                  />
                </div>
                <span className="hours-amount" style={{ color: isOver ? 'var(--amber)' : undefined }}>
                  {hours}h
                  {isOver && <AlertTriangle size={11} style={{ marginLeft: 3, verticalAlign: 'middle' }} />}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
