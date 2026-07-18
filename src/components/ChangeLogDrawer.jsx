import { useState, useEffect } from 'react';
import { X, Trash2, Download, FileText } from 'lucide-react';
import { useApp, mondayOfWeek } from '../context/AppContext.jsx';
import { fetchAllPostedSnapshots, weekKey } from '../services/dataService.js';

const EXPORT_VERSION = 'shiftcraft-v1';
const DAYS_LIST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const LOC_ORDER = ['Phoenix', 'Chandler', 'Estrella', 'Scottsdale', 'OBS'];

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

function generatePrintWindow(data, weekLabel, weekMonday, postedBy) {
  const personById = new Map((data.people ?? []).map(p => [p.id, p]));
  const dayDates = DAYS_LIST.map((day, i) => {
    const d = new Date(weekMonday);
    d.setUTCDate(weekMonday.getUTCDate() + i);
    return `${day} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  });
  const allLocs = [...new Set(data.clinics.filter(c => c.open).map(c => c.location))];
  const extras = allLocs.filter(l => !LOC_ORDER.includes(l)).sort();
  const locations = [...LOC_ORDER, ...extras].filter(l => allLocs.includes(l));
  const getPersonId = (sv) => { if (!sv) return null; if (typeof sv === 'string') return sv; return sv.personId ?? null; };
  let rows = '';
  for (const loc of locations) {
    let cells = `<td class="lc">${loc}</td>`;
    for (const day of DAYS_LIST) {
      const clinic = data.clinics.find(c => c.day === day && c.location === loc && c.open);
      if (!clinic) { cells += '<td></td>'; continue; }
      let content = clinic.provider ? `<div class="pv">${clinic.provider}</div>` : '';
      for (const [st, sv] of Object.entries(clinic.slots ?? {})) {
        const pid = getPersonId(sv);
        if (!pid) continue;
        const p = personById.get(pid);
        if (!p) continue;
        const lbl = st.replace(/([A-Z])/g, ' $1').trim();
        content += `<div class="sl"><span class="sr">${lbl}:</span> ${p.name}</div>`;
      }
      if (!content) content = '<span class="em">—</span>';
      cells += `<td>${content}</td>`;
    }
    rows += `<tr>${cells}</tr>`;
  }
  const generatedAt = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  const html = `<!DOCTYPE html><html><head><title>Shiftcraft — Week of ${weekLabel}</title>
<style>
@media print{@page{size:landscape;margin:0.4in}}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,Arial,sans-serif;font-size:9px;color:#111}
h1{font-size:13px;font-weight:700;margin-bottom:8px}
table{border-collapse:collapse;width:100%;table-layout:fixed}
th,td{border:0.5px solid #bbb;padding:4px 5px;vertical-align:top}
th{background:#f3f4f6;font-weight:600;text-align:center;font-size:9px}
.lc{font-weight:700;background:#f9fafb;width:72px}
.pv{font-weight:600;font-size:8.5px;margin-bottom:2px;color:#444}
.sl{font-size:8px;line-height:1.45}
.sr{color:#777}
.em{color:#aaa;font-style:italic}
footer{margin-top:8px;font-size:7.5px;color:#666;display:flex;justify-content:space-between}
</style></head><body>
<h1>Shiftcraft — Week of ${weekLabel}</h1>
<table><thead><tr><th style="width:72px">Location</th>${dayDates.map(d => `<th>${d}</th>`).join('')}</tr></thead>
<tbody>${rows}</tbody></table>
<footer><span>Generated ${generatedAt}</span><span>Posted by ${postedBy ?? '—'}</span></footer>
<script>window.onload=function(){window.print()}</script>
</body></html>`;
  const win = window.open('', '_blank');
  if (win) { win.document.write(html); win.document.close(); }
}

export default function ChangeLogDrawer({ onClose }) {
  const { changelog, clearChangelog, currentWeek, data, weekLabel } = useApp();
  const groups = groupByDay(changelog);
  const [postedVersions, setPostedVersions] = useState([]);

  useEffect(() => {
    fetchAllPostedSnapshots(weekKey(currentWeek)).then(res => {
      if (res.status === 'ok') setPostedVersions(res.data);
    });
  }, [currentWeek]);

  const weekMonday = mondayOfWeek(currentWeek);

  const handleDownloadJSON = (snap) => {
    const payload = {
      version: EXPORT_VERSION,
      weekStr: currentWeek,
      weekMonday: weekMonday.toISOString().slice(0, 10),
      exportedAt: snap.posted_at,
      slotMap: snap.snapshot,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shiftcraft_week_${weekMonday.toISOString().slice(0, 10)}_${snap.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadPDF = (snap) => {
    if (!data) return;
    generatePrintWindow(data, weekLabel, weekMonday, snap.posted_by);
  };

  return (
    <div className="config-panel open" style={{ zIndex: 190 }}>
      <div className="config-panel-header">
        <div style={{ fontWeight: 500 }}>History</div>
        <button className="btn btn-icon" onClick={onClose}><X size={18} /></button>
      </div>
      <div className="config-panel-body" style={{ gap: 0, padding: 0 }}>

        {/* Posted snapshots section */}
        {postedVersions.length > 0 && (
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)' }}>
            <div className="day-group-header" style={{ marginBottom: 8 }}>Posted versions — {weekLabel}</div>
            {postedVersions.map(snap => (
              <div key={snap.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '0.5px solid var(--border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 }}>{formatTimestamp(snap.posted_at)}</div>
                  {snap.posted_by && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>by {snap.posted_by}</div>}
                </div>
                <button
                  className="btn btn-icon"
                  title="Download JSON backup"
                  style={{ minHeight: 28, padding: '3px 8px' }}
                  onClick={() => handleDownloadJSON(snap)}
                >
                  <Download size={13} />
                </button>
                <button
                  className="btn btn-icon"
                  title="Open printable PDF"
                  style={{ minHeight: 28, padding: '3px 8px' }}
                  onClick={() => handleDownloadPDF(snap)}
                >
                  <FileText size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Change log */}
        <div style={{ padding: '12px 16px', flex: 1, overflowY: 'auto' }}>
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
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2, display: 'flex', gap: 6, alignItems: 'center' }}>
                    {entry.initials && (
                      <span style={{ fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: 0.5 }}>{entry.initials}</span>
                    )}
                    <span>{formatTimestamp(entry.timestamp)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                    {entry.action}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

      </div>
      {changelog.length > 0 && (
        <div style={{ padding: 16, borderTop: '0.5px solid var(--border)', flexShrink: 0 }}>
          <button
            className="btn btn-danger"
            style={{ width: '100%', minHeight: 40 }}
            onClick={() => { if (confirm('Clear the entire change log?')) clearChangelog(); }}
          >
            <Trash2 size={14} /> Clear log
          </button>
        </div>
      )}
    </div>
  );
}
