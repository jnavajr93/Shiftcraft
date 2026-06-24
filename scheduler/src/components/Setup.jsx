import { useState } from 'react';
import {
  makeRole, makeLocation, makePerson, makeShift, makeConstraint, DAYS, minToStr,
} from '../engine/schema.js';
import { CONSTRAINT_TYPES as CT } from '../engine/schema.js';

const PALETTE = ['#2563eb', '#16a34a', '#db2777', '#9333ea', '#ea580c', '#0891b2', '#65a30d', '#0d9488', '#c026d3', '#0284c7', '#dc2626', '#7c3aed'];

export default function Setup({ cfg, setCfg }) {
  const [sub, setSub] = useState('people');
  const up = (patch) => setCfg({ ...cfg, ...patch, meta: { ...cfg.meta, updated: Date.now() } });

  return (
    <div>
      <div className="tabs" style={{ marginLeft: 0, marginBottom: 18 }}>
        {['people', 'roles', 'locations', 'shifts', 'rules'].map((t) => (
          <button key={t} className={'tab' + (sub === t ? ' active' : '')} onClick={() => setSub(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {sub === 'people' && <People cfg={cfg} up={up} />}
      {sub === 'roles' && <Roles cfg={cfg} up={up} />}
      {sub === 'locations' && <Locations cfg={cfg} up={up} />}
      {sub === 'shifts' && <Shifts cfg={cfg} up={up} />}
      {sub === 'rules' && <Rules cfg={cfg} up={up} />}
    </div>
  );
}

function People({ cfg, up }) {
  const addP = () =>
    up({ people: [...cfg.people, makePerson({ color: PALETTE[cfg.people.length % PALETTE.length] })] });
  const edit = (id, patch) =>
    up({ people: cfg.people.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const del = (id) => up({ people: cfg.people.filter((p) => p.id !== id) });
  const toggle = (p, field, val) => {
    const has = p[field].includes(val);
    edit(p.id, { [field]: has ? p[field].filter((x) => x !== val) : [...p[field], val] });
  };

  return (
    <div>
      <div className="section-head">
        <h2>People</h2>
        <span className="hint">Who they are, which roles they fill, where they're cleared.</span>
        <div style={{ flex: 1 }} />
        <button className="btn primary sm" onClick={addP}>+ Add person</button>
      </div>
      {cfg.people.length === 0 && <div className="empty">No people yet. Add your first.</div>}
      <div className="grid-cards">
        {cfg.people.map((p) => (
          <div className="card" key={p.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span className="swatch" style={{ background: p.color, width: 12, height: 12, borderRadius: 3, display: 'inline-block' }} />
              <input type="text" value={p.name} onChange={(e) => edit(p.id, { name: e.target.value })}
                style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', fontWeight: 600 }} />
              <button className="btn ghost danger sm" onClick={() => del(p.id)}>Remove</button>
            </div>
            <div className="field">
              <label>Roles they can fill</label>
              <div className="pill-group">
                {cfg.roles.map((r) => (
                  <button key={r.id} className={'pill' + (p.roles.includes(r.id) ? ' on' : '')}
                    onClick={() => toggle(p, 'roles', r.id)}>{r.name}</button>
                ))}
                {cfg.roles.length === 0 && <span className="sub">Define roles first</span>}
              </div>
            </div>
            <div className="field">
              <label>Cleared locations <span style={{ color: 'var(--ink-faint)', fontWeight: 400 }}>(none = any)</span></label>
              <div className="pill-group">
                {cfg.locations.map((l) => (
                  <button key={l.id} className={'pill' + (p.locations.includes(l.id) ? ' on' : '')}
                    onClick={() => toggle(p, 'locations', l.id)}>{l.name}</button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SimpleList({ cfg, up, title, hint, field, make, label }) {
  const add = () => up({ [field]: [...cfg[field], make()] });
  const edit = (id, name) => up({ [field]: cfg[field].map((x) => (x.id === id ? { ...x, name } : x)) });
  const del = (id) => up({ [field]: cfg[field].filter((x) => x.id !== id) });
  return (
    <div>
      <div className="section-head">
        <h2>{title}</h2><span className="hint">{hint}</span>
        <div style={{ flex: 1 }} />
        <button className="btn primary sm" onClick={add}>+ Add {label}</button>
      </div>
      {cfg[field].length === 0 && <div className="empty">None yet.</div>}
      <div className="row-list">
        {cfg[field].map((x) => (
          <div className="row-item" key={x.id}>
            <input type="text" className="grow" value={x.name} onChange={(e) => edit(x.id, e.target.value)}
              style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '6px 9px' }} />
            <button className="btn ghost danger sm" onClick={() => del(x.id)}>Remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}

const Roles = ({ cfg, up }) => (
  <SimpleList cfg={cfg} up={up} title="Roles" hint="The job types a shift needs filled (e.g. Scribe, Opener)."
    field="roles" make={() => makeRole({ name: 'New role' })} label="role" />
);
const Locations = ({ cfg, up }) => (
  <SimpleList cfg={cfg} up={up} title="Locations" hint="Where work happens." field="locations"
    make={() => makeLocation({ name: 'New location' })} label="location" />
);

function Shifts({ cfg, up }) {
  const add = () => up({ shifts: [...cfg.shifts, makeShift({ locationId: cfg.locations[0]?.id })] });
  const edit = (id, patch) => up({ shifts: cfg.shifts.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const del = (id) => up({ shifts: cfg.shifts.filter((s) => s.id !== id) });
  const toggleDay = (s, d) => {
    const has = s.days.includes(d);
    edit(s.id, { days: has ? s.days.filter((x) => x !== d) : [...s.days, d] });
  };
  return (
    <div>
      <div className="section-head">
        <h2>Shifts</h2><span className="hint">Things that need staffing on certain days — a provider's clinic, a service window.</span>
        <div style={{ flex: 1 }} />
        <button className="btn primary sm" onClick={add}>+ Add shift</button>
      </div>
      {cfg.shifts.length === 0 && <div className="empty">No shifts yet.</div>}
      <div className="grid-cards">
        {cfg.shifts.map((s) => (
          <div className="card" key={s.id}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <input type="text" value={s.name} onChange={(e) => edit(s.id, { name: e.target.value })}
                style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 6, padding: '5px 8px', fontWeight: 600 }} />
              <button className="btn ghost danger sm" onClick={() => del(s.id)}>Remove</button>
            </div>
            <div className="field">
              <label>Location</label>
              <select value={s.locationId || ''} onChange={(e) => edit(s.id, { locationId: e.target.value })}>
                {cfg.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Days</label>
              <div className="pill-group">
                {DAYS.slice(0, 5).map((d) => (
                  <button key={d} className={'pill' + (s.days.includes(d) ? ' on' : '')}
                    onClick={() => toggleDay(s, d)}>{d}</button>
                ))}
              </div>
            </div>
            <div className="cols-2">
              <div className="field"><label>Start (min)</label>
                <input type="number" value={s.start} onChange={(e) => edit(s.id, { start: +e.target.value })} />
                <span className="sub">{minToStr(s.start)}</span>
              </div>
              <div className="field"><label>End (min)</label>
                <input type="number" value={s.end} onChange={(e) => edit(s.id, { end: +e.target.value })} />
                <span className="sub">{minToStr(s.end)}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Rules({ cfg, up }) {
  const pName = (id) => cfg.people.find((p) => p.id === id)?.name || '?';
  const rName = (id) => cfg.roles.find((r) => r.id === id)?.name || '?';
  const lName = (id) => cfg.locations.find((l) => l.id === id)?.name || '?';
  const sName = (id) => cfg.shifts.find((s) => s.id === id)?.name || '?';
  const del = (id) => up({ constraints: cfg.constraints.filter((c) => c.id !== id) });
  const addType = (type) => {
    const base = { type };
    if (type === CT.MIN_STAFF || type === CT.MAX_STAFF) { base.locationId = cfg.locations[0]?.id; base.roleId = cfg.roles[0]?.id; base.count = 1; }
    if (type === CT.MUST_PAIR) { base.personId = cfg.people[0]?.id; base.anchorId = cfg.shifts[0]?.id; }
    if (type === CT.WHITELIST) { base.locationId = cfg.locations[0]?.id; base.people = []; }
    if (type === CT.UNAVAILABLE) { base.personId = cfg.people[0]?.id; base.days = []; }
    if (type === CT.HOUR_CAP) { base.personId = cfg.people[0]?.id; base.count = 40; }
    up({ constraints: [...cfg.constraints, makeConstraint(base)] });
  };
  const describe = (c) => {
    switch (c.type) {
      case CT.MIN_STAFF: return `${lName(c.locationId)} needs at least ${c.count} ${rName(c.roleId)}`;
      case CT.MAX_STAFF: return `${lName(c.locationId)} allows at most ${c.count} ${rName(c.roleId)}`;
      case CT.MUST_PAIR: return `${pName(c.personId)} pairs with ${sName(c.anchorId)}`;
      case CT.WHITELIST: return `${lName(c.locationId)} only: ${(c.people || []).map(pName).join(', ') || '(no one yet)'}`;
      case CT.UNAVAILABLE: return `${pName(c.personId)} off ${(c.days || []).join(', ') || '(no days)'}`;
      case CT.HOUR_CAP: return `${pName(c.personId)} max ${c.count} hrs/week`;
      default: return c.type;
    }
  };
  return (
    <div>
      <div className="section-head">
        <h2>Rules</h2><span className="hint">Every scheduling rule is one of these. The solver enforces them.</span>
      </div>
      <div className="pill-group" style={{ marginBottom: 16 }}>
        <button className="btn sm" onClick={() => addType(CT.MIN_STAFF)}>+ Min staff</button>
        <button className="btn sm" onClick={() => addType(CT.MAX_STAFF)}>+ Max staff</button>
        <button className="btn sm" onClick={() => addType(CT.MUST_PAIR)}>+ Must pair</button>
        <button className="btn sm" onClick={() => addType(CT.WHITELIST)}>+ Whitelist</button>
        <button className="btn sm" onClick={() => addType(CT.UNAVAILABLE)}>+ Unavailable</button>
        <button className="btn sm" onClick={() => addType(CT.HOUR_CAP)}>+ Hour cap</button>
      </div>
      {cfg.constraints.length === 0 && <div className="empty">No rules yet. Add one above.</div>}
      <div className="row-list">
        {cfg.constraints.map((c) => (
          <RuleRow key={c.id} c={c} cfg={cfg} up={up} describe={describe} del={del} />
        ))}
      </div>
    </div>
  );
}

function RuleRow({ c, cfg, up, describe, del }) {
  const edit = (patch) => up({ constraints: cfg.constraints.map((x) => (x.id === c.id ? { ...x, ...patch } : x)) });
  const toggleDay = (d) => {
    const days = c.days || [];
    edit({ days: days.includes(d) ? days.filter((x) => x !== d) : [...days, d] });
  };
  const togglePerson = (id) => {
    const ppl = c.people || [];
    edit({ people: ppl.includes(id) ? ppl.filter((x) => x !== id) : [...ppl, id] });
  };
  return (
    <div className="row-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="grow" style={{ fontWeight: 500 }}>{describe(c)}</span>
        <button className="btn ghost danger sm" onClick={() => del(c.id)}>Remove</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {(c.type === CT.MIN_STAFF || c.type === CT.MAX_STAFF) && (<>
          <Sel value={c.locationId} opts={cfg.locations} onChange={(v) => edit({ locationId: v })} />
          <Sel value={c.roleId} opts={cfg.roles} onChange={(v) => edit({ roleId: v })} />
          <input type="number" value={c.count} min={0} onChange={(e) => edit({ count: +e.target.value })}
            style={{ width: 70, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6 }} />
        </>)}
        {c.type === CT.MUST_PAIR && (<>
          <Sel value={c.personId} opts={cfg.people} onChange={(v) => edit({ personId: v })} />
          <Sel value={c.anchorId} opts={cfg.shifts} onChange={(v) => edit({ anchorId: v })} />
        </>)}
        {c.type === CT.HOUR_CAP && (<>
          <Sel value={c.personId} opts={cfg.people} onChange={(v) => edit({ personId: v })} />
          <input type="number" value={c.count} onChange={(e) => edit({ count: +e.target.value })}
            style={{ width: 70, padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6 }} />
        </>)}
        {c.type === CT.UNAVAILABLE && (<>
          <Sel value={c.personId} opts={cfg.people} onChange={(v) => edit({ personId: v })} />
          <div className="pill-group">
            {DAYS.slice(0, 5).map((d) => (
              <button key={d} className={'pill' + ((c.days || []).includes(d) ? ' on' : '')} onClick={() => toggleDay(d)}>{d}</button>
            ))}
          </div>
        </>)}
        {c.type === CT.WHITELIST && (<>
          <Sel value={c.locationId} opts={cfg.locations} onChange={(v) => edit({ locationId: v })} />
          <div className="pill-group">
            {cfg.people.map((p) => (
              <button key={p.id} className={'pill' + ((c.people || []).includes(p.id) ? ' on' : '')} onClick={() => togglePerson(p.id)}>{p.name}</button>
            ))}
          </div>
        </>)}
      </div>
    </div>
  );
}

const Sel = ({ value, opts, onChange }) => (
  <select value={value || ''} onChange={(e) => onChange(e.target.value)}
    style={{ padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6 }}>
    {opts.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
  </select>
);
