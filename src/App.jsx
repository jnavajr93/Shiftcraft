import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { seedClinic } from './engine/seed.js';
import { emptyConfig } from './engine/schema.js';
import { solve } from './engine/solver.js';
import Board from './components/Board.jsx';
import Setup from './components/Setup.jsx';
import HoursBar from './components/HoursBar.jsx';

const STORAGE_KEY  = 'scheduler.config.v1';
const THEME_KEY    = 'shiftcraft.theme';

function loadConfig() {
  try { const r = localStorage.getItem(STORAGE_KEY); if (r) return JSON.parse(r); } catch {}
  return seedClinic();
}
function getInitialTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// ── Logo mark ────────────────────────────────────────────────────────────────
function BrandMark() {
  return (
    <svg width="16" height="14" viewBox="0 0 16 14" fill="none" aria-hidden="true">
      <rect x="0" y="0"  width="16" height="3.5" rx="1.75" fill="currentColor"/>
      <rect x="0" y="5.25" width="10" height="3.5" rx="1.75" fill="currentColor" opacity=".7"/>
      <rect x="0" y="10.5" width="13" height="3.5" rx="1.75" fill="currentColor" opacity=".85"/>
    </svg>
  );
}

// ── Theme icons ──────────────────────────────────────────────────────────────
function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}
// ── Search icon ──────────────────────────────────────────────────────────────
function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  );
}

export default function App() {
  const [cfg, setCfg]           = useState(loadConfig);
  const [tab, setTab]           = useState('schedule');
  const [week, setWeek]         = useState('A');
  const [flexMode, setFlexMode] = useState(false);
  const [isAdmin, setIsAdmin]   = useState(false);
  const [theme, setTheme]       = useState(getInitialTheme);

  // Filters
  const [search, setSearch]               = useState('');
  const [filterPerson, setFilterPerson]   = useState('');
  const [filterLocation, setFilterLocation] = useState('');
  const [filterRole, setFilterRole]       = useState('');
  const [filterDay, setFilterDay]         = useState('');

  const fileRef = useRef(null);

  // Persist theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  // Auto-save config
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch {}
  }, [cfg]);

  const solverResult = useMemo(() => {
    try { return solve(cfg, week); } catch (e) { console.error(e); return {}; }
  }, [cfg, week]);

  const [displayResult, setDisplayResult] = useState(solverResult);
  useEffect(() => { setDisplayResult(solverResult); }, [solverResult]);

  const handleSwap = useCallback((fromDay, fromShiftIdx, personIdx, toDay, toShiftIdx) => {
    setDisplayResult((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      const person = next[fromDay].shifts[fromShiftIdx].assigned[personIdx];
      next[fromDay].shifts[fromShiftIdx].assigned.splice(personIdx, 1);
      next[toDay].shifts[toShiftIdx].assigned.push(person);
      return next;
    });
  }, []);

  const handleUpdateShiftTime = useCallback((shiftId, start, end) => {
    setCfg((prev) => ({
      ...prev,
      shifts: prev.shifts.map((s) => (s.id === shiftId ? { ...s, start, end } : s)),
      meta: { ...prev.meta, updated: Date.now() },
    }));
  }, []);

  const clearFilters = () => {
    setSearch(''); setFilterPerson(''); setFilterLocation('');
    setFilterRole(''); setFilterDay('');
  };
  const hasActiveFilter = search || filterPerson || filterLocation || filterRole || filterDay;

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), {
      href: url,
      download: (cfg.meta?.name || 'schedule').replace(/\s+/g, '_') + '.json',
    }).click();
    URL.revokeObjectURL(url);
  };

  const importJSON = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { setCfg(JSON.parse(reader.result)); }
      catch { alert('Not a valid schedule export.'); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const reset = () => {
    if (confirm('Replace with the sample clinic config?')) setCfg(seedClinic());
  };
  const clear = () => {
    if (confirm('Start from an empty schedule?')) setCfg(emptyConfig());
  };

  const hasWeekTags = cfg.shifts.some((s) => s.week === 'A' || s.week === 'B');

  const filters = {
    search,
    personId: filterPerson,
    locationName: filterLocation,
    roleName: filterRole,
    day: filterDay,
  };

  return (
    <div className="app">
      {/* ── Topbar ─────────────────────────────────────────────────────── */}
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><BrandMark /></div>
          <span className="brand-name">Shiftcraft</span>
        </div>

        {isAdmin && (
          <nav className="nav-tabs" aria-label="Main navigation">
            <button
              className={'nav-tab' + (tab === 'schedule' ? ' active' : '')}
              onClick={() => setTab('schedule')}
            >Schedule</button>
            <button
              className={'nav-tab' + (tab === 'setup' ? ' active' : '')}
              onClick={() => setTab('setup')}
            >Setup</button>
          </nav>
        )}

        <div className="topbar-sep" />

        {isAdmin && <span className="admin-pill">Admin</span>}

        <div className="spacer" />

        {/* Admin-only topbar actions */}
        {isAdmin && tab === 'schedule' && (
          <>
            <button
              className={'btn sm' + (flexMode ? ' toggled' : '')}
              onClick={() => setFlexMode((f) => !f)}
            >
              Flex {flexMode ? 'on' : 'off'}
            </button>
            <div className="topbar-sep" />
          </>
        )}
        {isAdmin && (
          <>
            <button className="btn sm" onClick={() => fileRef.current?.click()}>Import</button>
            <button className="btn sm" onClick={exportJSON}>Export</button>
            <button className="btn sm" onClick={reset}>Load sample</button>
            <button className="btn sm" onClick={clear}>New</button>
            <input ref={fileRef} type="file" accept="application/json" onChange={importJSON} style={{ display: 'none' }} />
            <div className="topbar-sep" />
          </>
        )}

        {/* Admin toggle */}
        <button
          className={'btn sm' + (isAdmin ? ' toggled' : '')}
          onClick={() => { setIsAdmin((a) => !a); if (isAdmin) setTab('schedule'); }}
          title={isAdmin ? 'Exit admin mode' : 'Enter admin mode'}
        >
          {isAdmin ? 'Exit admin' : 'Admin'}
        </button>

        {/* Theme toggle */}
        <button className="icon-btn" onClick={toggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} aria-label="Toggle theme">
          {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
      </header>

      {/* ── Main ───────────────────────────────────────────────────────── */}
      <div className={'main' + (isAdmin && tab === 'schedule' ? ' has-hours-bar' : '')}>
        {tab === 'schedule' ? (
          <>
            {/* Schedule toolbar */}
            <div className="schedule-toolbar">
              <h1 className="schedule-title">{cfg.meta?.name || 'Schedule'}</h1>

              {hasWeekTags && (
                <div className="week-toggle" role="group" aria-label="Select week">
                  <button className={'week-btn' + (week === 'A' ? ' active' : '')} onClick={() => setWeek('A')}>
                    Week A
                  </button>
                  <button className={'week-btn' + (week === 'B' ? ' active' : '')} onClick={() => setWeek('B')}>
                    Week B
                  </button>
                </div>
              )}

              <div className="toolbar-divider" />
            </div>

            {/* Filter bar — visible in both Staff and Admin */}
            <div className="filter-bar" role="search">
              <span className="filter-bar-label">Filter</span>
              <div className="search-wrap">
                <SearchIcon />
                <input
                  type="search"
                  className="search-input"
                  placeholder="Search name…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search by person name"
                />
              </div>
              <select className="filter-sel" value={filterPerson} onChange={(e) => setFilterPerson(e.target.value)} aria-label="Filter by person">
                <option value="">All people</option>
                {cfg.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select className="filter-sel" value={filterLocation} onChange={(e) => setFilterLocation(e.target.value)} aria-label="Filter by location">
                <option value="">All locations</option>
                {cfg.locations.map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
              </select>
              <select className="filter-sel" value={filterRole} onChange={(e) => setFilterRole(e.target.value)} aria-label="Filter by role">
                <option value="">All roles</option>
                {cfg.roles.map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
              </select>
              <select className="filter-sel" value={filterDay} onChange={(e) => setFilterDay(e.target.value)} aria-label="Filter by day">
                <option value="">All days</option>
                {Object.keys(displayResult).map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              {hasActiveFilter && (
                <button className="btn sm ghost" onClick={clearFilters}>Clear</button>
              )}
            </div>

            <Board
              result={displayResult}
              week={hasWeekTags ? week : null}
              flexMode={flexMode}
              isAdmin={isAdmin}
              filters={filters}
              onSwap={handleSwap}
              onUpdateShiftTime={handleUpdateShiftTime}
            />
          </>
        ) : (
          <Setup cfg={cfg} setCfg={setCfg} />
        )}
      </div>

      {/* ── Hours bar (admin + schedule tab only) ──────────────────────── */}
      {isAdmin && tab === 'schedule' && (
        <HoursBar result={displayResult} cfg={cfg} defaultCap={40} />
      )}
    </div>
  );
}
