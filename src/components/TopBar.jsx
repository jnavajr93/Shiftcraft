import { Calendar, Sun, Moon } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';

function weekLabel() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function TopBar({ activeTab, setActiveTab }) {
  const { isAdmin, setIsAdmin, theme, setTheme } = useApp();

  return (
    <div className="topbar">
      <div className="topbar-brand">
        <Calendar size={24} strokeWidth={1.5} />
        <span>Shiftcraft</span>
      </div>

      <div className="topbar-week">Week of {weekLabel()}</div>

      <div className="topbar-right">
        {isAdmin && (
          <button
            className={`btn btn-pill ${activeTab === 'setup' ? 'active' : ''}`}
            onClick={() => setActiveTab(t => t === 'setup' ? 'schedule' : 'setup')}
          >
            Setup
          </button>
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
  );
}
