import { useState } from 'react';
import { Calendar, Sun, Moon, ChevronLeft, ChevronRight, History, Printer } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import ChangeLogDrawer from './ChangeLogDrawer.jsx';

export default function TopBar({ activeTab, setActiveTab }) {
  const { isAdmin, setIsAdmin, theme, setTheme, weekLabel, navigateWeek, weekIsEmpty, copyFromPreviousWeek } = useApp();
  const [showLog, setShowLog] = useState(false);
  const [copyToast, setCopyToast] = useState(null);

  const handleCopy = () => {
    const result = copyFromPreviousWeek();
    if (!result) {
      setCopyToast('No previous week data found');
    } else {
      const label = result.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
      setCopyToast(`Copied from week of ${label}`);
    }
    setTimeout(() => setCopyToast(null), 3000);
  };

  return (
    <>
      <div className="topbar">
        <div className="topbar-brand">
          <Calendar size={24} strokeWidth={1.5} />
          <span>Shiftcraft</span>
        </div>

        <div className="topbar-week">
          <button
            className="btn btn-icon"
            onClick={() => navigateWeek(-1)}
            aria-label="Previous week"
            style={{ minHeight: 32, padding: 4 }}
          >
            <ChevronLeft size={18} />
          </button>
          <span style={{ padding: '0 10px', fontWeight: 500, fontSize: 14, color: 'var(--text-secondary)' }}>
            Week of {weekLabel}
          </span>
          <button
            className="btn btn-icon"
            onClick={() => navigateWeek(1)}
            aria-label="Next week"
            style={{ minHeight: 32, padding: 4 }}
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="topbar-right">
          {isAdmin && weekIsEmpty() && (
            <button className="btn btn-pill" style={{ fontSize: 12, minHeight: 32 }} onClick={handleCopy}>
              Copy from last week
            </button>
          )}
          {isAdmin && (
            <>
              <button
                className="btn btn-icon"
                onClick={() => window.print()}
                aria-label="Print schedule"
                title="Print"
              >
                <Printer size={20} strokeWidth={1.5} />
              </button>
              <button
                className="btn btn-icon"
                onClick={() => setShowLog(s => !s)}
                aria-label="Change log"
                title="Change log"
              >
                <History size={20} strokeWidth={1.5} />
              </button>
              <button
                className={`btn btn-pill ${activeTab === 'setup' ? 'active' : ''}`}
                onClick={() => setActiveTab(t => t === 'setup' ? 'schedule' : 'setup')}
              >
                Setup
              </button>
            </>
          )}
          <button
            className="btn btn-icon"
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            aria-label="Toggle theme"
          >
            {theme === 'dark'
              ? <Sun size={20} strokeWidth={1.5} />
              : <Moon size={20} strokeWidth={1.5} />}
          </button>
          <button
            className={`btn btn-pill ${isAdmin ? 'active' : ''}`}
            onClick={() => setIsAdmin(a => !a)}
          >
            Admin
          </button>
        </div>
      </div>

      {copyToast && (
        <div className="copy-toast">{copyToast}</div>
      )}

      {showLog && <ChangeLogDrawer onClose={() => setShowLog(false)} />}
    </>
  );
}
