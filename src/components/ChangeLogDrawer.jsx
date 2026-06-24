import { X, Trash2 } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';

function formatTimestamp(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function groupByDay(entries) {
  const now = new Date();
  const today = now.toDateString();
  const yesterday = new Date(now - 86400000).toDateString();
  const groups = {};

  for (const entry of entries) {
    const d = new Date(entry.timestamp).toDateString();
    const label = d === today ? 'Today' : d === yesterday ? 'Yesterday' : new Date(entry.timestamp).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    if (!groups[label]) groups[label] = [];
    groups[label].push(entry);
  }
  return groups;
}

export default function ChangeLogDrawer({ onClose }) {
  const { changelog, clearChangelog } = useApp();
  const groups = groupByDay(changelog);

  return (
    <div className="config-panel open" style={{ zIndex: 190 }}>
      <div className="config-panel-header">
        <div style={{ fontWeight: 500 }}>Change Log</div>
        <button className="btn btn-icon" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="config-panel-body" style={{ gap: 0 }}>
        {changelog.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
            No changes yet
          </div>
        )}
        {Object.entries(groups).map(([label, entries]) => (
          <div key={label} style={{ marginBottom: 16 }}>
            <div className="day-group-header" style={{ marginBottom: 6 }}>{label}</div>
            {entries.map((entry, i) => (
              <div key={i} style={{ padding: '6px 0', borderBottom: '0.5px solid var(--border)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>
                  {formatTimestamp(entry.timestamp)}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                  {entry.action}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      {changelog.length > 0 && (
        <div style={{ padding: 16, borderTop: '0.5px solid var(--border)', flexShrink: 0 }}>
          <button
            className="btn btn-danger"
            style={{ width: '100%', minHeight: 40 }}
            onClick={() => {
              if (confirm('Clear the entire change log?')) clearChangelog();
            }}
          >
            <Trash2 size={14} /> Clear log
          </button>
        </div>
      )}
    </div>
  );
}
