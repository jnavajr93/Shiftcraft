import { useState, useEffect, useMemo, useRef } from 'react';
import { seedClinic } from './engine/seed.js';
import { emptyConfig } from './engine/schema.js';
import { solve } from './engine/solver.js';
import Board from './components/Board.jsx';
import Setup from './components/Setup.jsx';

const STORAGE_KEY = 'scheduler.config.v1';

function loadConfig() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return seedClinic();
}

export default function App() {
  const [tab, setTab] = useState('schedule');
  const [cfg, setCfg] = useState(loadConfig);
  const fileRef = useRef(null);

  // Auto-save to localStorage on every change.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
  }, [cfg]);

  const result = useMemo(() => {
    try { return solve(cfg); } catch (e) { console.error(e); return {}; }
  }, [cfg]);

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (cfg.meta?.name || 'schedule').replace(/\s+/g, '_') + '.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJSON = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { setCfg(JSON.parse(reader.result)); }
      catch (err) { alert('That file is not a valid schedule export.'); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const reset = () => {
    if (confirm('Replace everything with the sample clinic? Your current setup will be lost.')) setCfg(seedClinic());
  };
  const clear = () => {
    if (confirm('Start from an empty schedule? Your current setup will be lost.')) setCfg(emptyConfig());
  };

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand"><span className="dot" /> Shiftcraft</div>
        <div className="tabs">
          <button className={'tab' + (tab === 'schedule' ? ' active' : '')} onClick={() => setTab('schedule')}>Schedule</button>
          <button className={'tab' + (tab === 'setup' ? ' active' : '')} onClick={() => setTab('setup')}>Setup</button>
        </div>
        <div className="spacer" />
        <button className="btn sm" onClick={() => fileRef.current?.click()}>Import</button>
        <button className="btn sm" onClick={exportJSON}>Export</button>
        <button className="btn sm" onClick={reset}>Load sample</button>
        <button className="btn sm" onClick={clear}>New</button>
        <input ref={fileRef} type="file" accept="application/json" onChange={importJSON} style={{ display: 'none' }} />
      </div>
      <div className="main">
        {tab === 'schedule' ? (
          <>
            <div className="section-head">
              <h2>{cfg.meta?.name || 'Schedule'}</h2>
              <span className="hint">Generated from your setup. Edit people and rules in Setup; this updates live.</span>
            </div>
            <Board result={result} />
          </>
        ) : (
          <Setup cfg={cfg} setCfg={setCfg} />
        )}
      </div>
    </div>
  );
}
