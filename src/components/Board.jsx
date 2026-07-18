import { useState, useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import { useApp, mondayOfWeek, isoWeek } from '../context/AppContext.jsx';
import { DAYS } from '../data/seed.js';
import ClinicCard from './ClinicCard.jsx';

const LOCATION_ORDER = ['Phoenix', 'Chandler', 'Estrella', 'Scottsdale', 'OBS'];

export default function Board({ search, setSearch, onPersonClick, onEditClinic }) {
  const { data, isAdmin, boardClinics, currentWeek } = useApp();
  const monday = mondayOfWeek(currentWeek);

  // Midnight rollover — tick increments at midnight so todayDay re-evaluates
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    const t = setTimeout(() => setTick(n => n + 1), midnight - now);
    return () => clearTimeout(t);
  }, [tick]);

  // Today's column — Mon–Fri only, only when this is the current week
  const todayDay = (() => {
    const now = new Date();
    if (currentWeek !== isoWeek(now)) return null;
    const dow = now.getDay(); // 0=Sun,1=Mon..5=Fri,6=Sat
    return (dow >= 1 && dow <= 5) ? DAYS[dow - 1] : null;
  })();

  // Scroll today's column into view when navigating to the current week
  useEffect(() => {
    if (!todayDay) return;
    const t = setTimeout(() => {
      const el = document.querySelector('.col-header--today');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }, 60);
    return () => clearTimeout(t);
  }, [currentWeek, todayDay]);

  // Staff view: boardClinics is null when the week has never been posted
  const showNotPosted = !isAdmin && boardClinics === null;
  const clinics = isAdmin ? (data?.clinics ?? []) : (boardClinics ?? []);

  const matchedPersonIds = search.trim()
    ? data.people
        .filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
        .map(p => p.id)
    : [];

  // Fixed locations first, then any extra locations alphabetically
  const allLocations = [...new Set(clinics.map(c => c.location))];
  const extraLocations = allLocations.filter(loc => !LOCATION_ORDER.includes(loc)).sort();
  const orderedLocations = [...LOCATION_ORDER, ...extraLocations];

  // Measure the search bar height so col-headers can be offset below it.
  // Both board-search and col-headers are inside board-scroll (same scroll
  // container), so the sticky offset for headers = search bar height exactly.
  const scrollRef = useRef(null);
  const searchRef = useRef(null);
  useEffect(() => {
    const search = searchRef.current;
    const scroll = scrollRef.current;
    if (!search || !scroll) return;
    const update = () => scroll.style.setProperty('--search-bar-h', `${search.offsetHeight}px`);
    update();
    const obs = new ResizeObserver(update);
    obs.observe(search);
    return () => obs.disconnect();
  }, []);

  return (
    <div className="board-wrapper">
      <div ref={scrollRef} data-tour="week-board" className="board-scroll">
        {/* Search bar is the first child inside the scroll container so both
            it and the col-headers are sticky within the same scroll context. */}
        <div ref={searchRef} className="board-search">
          <div className="search-wrap">
            <span className="search-icon"><Search size={15} /></span>
            <input
              data-tour="search-bar"
              className="search-input"
              type="search"
              placeholder="Search staff…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {showNotPosted ? (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: 260, color: 'var(--text-muted)', fontSize: 14, flexDirection: 'column', gap: 8,
          }}>
            <span style={{ fontSize: 18, opacity: 0.4 }}>📋</span>
            Schedule not yet posted for this week.
          </div>
        ) : (
          <div className="board-grid">

            {/* Row 0: day headers */}
            {DAYS.map((day, idx) => {
              const d = new Date(monday);
              d.setUTCDate(monday.getUTCDate() + idx);
              const dateLabel = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
              const isToday = day === todayDay;
              return (
                <div key={day} className={`col-header${isToday ? ' col-header--today' : ''}`}>
                  <div className="col-header-day">{day}</div>
                  <div className="col-header-date">{dateLabel}</div>
                </div>
              );
            })}

            {/* Rows 1…N: one row per location, one cell per day */}
            {orderedLocations.flatMap(loc =>
              DAYS.map(day => {
                const clinic = clinics.find(
                  c => c.day === day && c.location === loc && (isAdmin || c.open)
                );
                const isToday = day === todayDay;
                if (clinic) {
                  return (
                    <ClinicCard
                      key={clinic.id}
                      clinic={clinic}
                      onPersonClick={onPersonClick}
                      onEditClinic={onEditClinic}
                      matchedPersonIds={matchedPersonIds}
                      hasSearch={search.trim().length > 0}
                      isToday={isToday}
                    />
                  );
                }
                return (
                  <div
                    key={`empty-${loc}-${day}`}
                    className={[
                      isAdmin ? 'clinic-row-placeholder' : 'clinic-row-placeholder clinic-row-placeholder--staff',
                      isToday ? 'col-today-cell' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    {isAdmin ? loc : null}
                  </div>
                );
              })
            )}

          </div>
        )}
      </div>
    </div>
  );
}
