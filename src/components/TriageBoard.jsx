import { useState, useCallback, Fragment } from 'react';
import { useApp } from '../context/AppContext.jsx';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const DAY_LABELS = { Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu', Friday: 'Fri' };

// Role definitions — key = field in data model, label = display label, multi = allows multiple people
const ROLES = [
  { key: 'scanning',        label: 'Scanning / Sorting / Records', multi: false },
  { key: 'npCalls',         label: 'NP Calls',                     multi: false },
  { key: 'phreesia',        label: 'Phreesia',                      multi: false },
  { key: 'triageOverflow',  label: 'Triage & Overflow',             multi: true  },
  { key: 'npAttachments',   label: 'NP Attachments',                multi: false },
];

const LUNCH_SECTIONS = [
  {
    header: 'Lunch 12 PM',
    rows: [
      { key: 'lunch12Lunch',    label: '→ Lunch',          multi: false },
      { key: 'lunch12Coverage', label: '→ Phone Coverage', multi: false },
    ],
  },
  {
    header: 'Lunch 1 PM',
    rows: [
      { key: 'lunch1Lunch',    label: '→ Lunch',          multi: false },
      { key: 'lunch1Coverage', label: '→ Phone Coverage', multi: false },
    ],
  },
];

const EMPTY_DAY = () => ({
  scanning: [],
  npCalls: [],
  phreesia: [],
  triageOverflow: [],
  npAttachments: [],
  lunch12Lunch: [],
  lunch12Coverage: [],
  lunch1Lunch: [],
  lunch1Coverage: [],
});

function buildEmpty() {
  const out = {};
  for (const d of DAYS) out[d] = EMPTY_DAY();
  return out;
}

// ─── Name chip ─────────────────────────────────
function Chip({ name, color, highlight, onRemove }) {
  return (
    <div
      className="triage-chip"
      style={{
        background: highlight ? 'rgba(245,158,11,0.15)' : color ? `${color}22` : 'var(--bg-hover)',
        borderColor: highlight ? '#f59e0b' : color ?? 'var(--border)',
      }}
    >
      <div className="triage-chip-dot" style={{ background: color ?? 'var(--text-muted)' }} />
      <span className="triage-chip-name">{name}</span>
      {onRemove && (
        <button className="triage-chip-remove" onClick={onRemove} title="Remove">×</button>
      )}
    </div>
  );
}

// ─── Cell picker (manager mode) ────────────────
function CellPicker({ triagePeople, current, multi, onSelect, onClose }) {
  const remaining = multi
    ? triagePeople.filter(p => !current.includes(p.name))
    : triagePeople;

  if (remaining.length === 0 && !multi) {
    return (
      <div className="triage-picker">
        <div className="triage-picker-empty">No triage staff available</div>
      </div>
    );
  }

  return (
    <div className="triage-picker">
      {remaining.map(p => (
        <button
          key={p.id}
          className="triage-picker-item"
          onClick={() => { onSelect(p.name); if (!multi) onClose(); }}
        >
          <div className="triage-chip-dot" style={{ background: p.color ?? 'var(--text-muted)', flexShrink: 0 }} />
          {p.name}
        </button>
      ))}
      {remaining.length === 0 && (
        <div className="triage-picker-empty">All assigned</div>
      )}
    </div>
  );
}

// ─── Cell (one grid cell) ──────────────────────
function Cell({ names, role, day, triagePeople, isAdmin, myName, onUpdate }) {
  const [open, setOpen] = useState(false);

  const peopleMap = new Map(triagePeople.map(p => [p.name, p]));

  const handleSelect = (name) => {
    const next = role.multi ? [...names, name] : [name];
    onUpdate(next);
  };

  const handleRemove = (name) => {
    onUpdate(names.filter(n => n !== name));
  };

  const handleCellClick = () => {
    if (!isAdmin) return;
    setOpen(o => !o);
  };

  return (
    <div
      className={`triage-cell${isAdmin ? ' triage-cell--editable' : ''}`}
      onClick={handleCellClick}
      style={{ position: 'relative' }}
    >
      {names.map(name => {
        const person = peopleMap.get(name);
        const highlight = myName && name.toLowerCase() === myName.toLowerCase();
        return (
          <Chip
            key={name}
            name={name}
            color={person?.color}
            highlight={highlight}
            onRemove={isAdmin ? (e) => { e.stopPropagation(); handleRemove(name); } : null}
          />
        );
      })}
      {names.length === 0 && isAdmin && (
        <div className="triage-cell-placeholder">+</div>
      )}
      {open && isAdmin && (
        <div
          className="triage-picker-wrapper"
          onClick={e => e.stopPropagation()}
        >
          <CellPicker
            triagePeople={triagePeople}
            current={names}
            multi={role.multi}
            onSelect={handleSelect}
            onClose={() => setOpen(false)}
          />
          <button className="triage-picker-close" onClick={() => setOpen(false)}>Done</button>
        </div>
      )}
    </div>
  );
}

// ─── TriageBoard ───────────────────────────────
export default function TriageBoard({ myName }) {
  const { data, isAdmin, triageData, saveTriageWeek } = useApp();

  const triagePeople = (data?.people ?? []).filter(p => p.staffType === 'triage');

  const board = triageData ?? buildEmpty();

  const handleUpdate = useCallback(async (day, roleKey, names) => {
    const next = {
      ...board,
      [day]: { ...(board[day] ?? EMPTY_DAY()), [roleKey]: names },
    };
    await saveTriageWeek(next);
  }, [board, saveTriageWeek]);

  if (triagePeople.length === 0 && !isAdmin) {
    return (
      <div className="triage-empty-state">
        No triage staff configured — add staff with Triage type in Setup
      </div>
    );
  }

  // Render one row for a given role config across all 5 days
  const renderRow = (role, isSubRow = false) => (
    <tr key={role.key} className={isSubRow ? 'triage-subrow' : ''}>
      <td className="triage-role-label">{role.label}</td>
      {DAYS.map(day => (
        <td key={day} className="triage-data-cell">
          <Cell
            names={(board[day] ?? EMPTY_DAY())[role.key] ?? []}
            role={role}
            day={day}
            triagePeople={triagePeople}
            isAdmin={isAdmin}
            myName={myName}
            onUpdate={(names) => handleUpdate(day, role.key, names)}
          />
        </td>
      ))}
    </tr>
  );

  return (
    <div className="triage-board">
      <div className="triage-scroll-wrapper">
        <table className="triage-table">
          <thead>
            <tr>
              <th className="triage-role-label triage-header-role">Role</th>
              {DAYS.map(d => (
                <th key={d} className="triage-header-day">{DAY_LABELS[d]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROLES.map(role => renderRow(role))}
            {LUNCH_SECTIONS.map(section => (
              <Fragment key={section.header}>
                <tr className="triage-section-header-row">
                  <td className="triage-section-header" colSpan={6}>{section.header}</td>
                </tr>
                {section.rows.map(role => renderRow(role, true))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {triagePeople.length === 0 && isAdmin && (
        <div className="triage-empty-state" style={{ marginTop: 16 }}>
          No triage staff configured — add staff with Triage type in Setup to assign people here
        </div>
      )}
    </div>
  );
}
