import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, AlertTriangle } from 'lucide-react';
import { useApp, mondayOfWeek, isoWeek } from '../context/AppContext.jsx';
import { DAYS } from '../data/seed.js';
import ClinicCard from './ClinicCard.jsx';

const LOCATION_ORDER = ['Phoenix', 'Chandler', 'Estrella', 'Scottsdale', 'OBS'];

export default function Board({ search, setSearch, onPersonClick, onEditClinic, footer }) {
  const { data, isAdmin, boardClinics, currentWeek, doctorOffClinicIds, holidayWorkedMap } = useApp();
  const monday = mondayOfWeek(currentWeek);

  // ── Staff search dropdown ──────────────────────────────────────────────────
  // Dedupe by name: one row per person, prefer tech record for color dot.
  // Only shown in staff view (isAdmin uses the board highlight flow).
  const searchSuggestions = (!isAdmin && search.trim())
    ? Object.values(
        (data.people ?? [])
          .filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
          .reduce((acc, p) => {
            const key = p.name.toLowerCase();
            if (!acc[key] || (p.staffType ?? 'tech') !== 'admin') acc[key] = p;
            return acc;
          }, {})
      )
    : [];

  const [activeIdx, setActiveIdx] = useState(-1);
  // Reset keyboard selection when the query changes
  useEffect(() => { setActiveIdx(-1); }, [search]);

  const searchWrapRef = useRef(null);
  // Close dropdown when clicking outside the search wrap
  useEffect(() => {
    if (searchSuggestions.length === 0) return;
    const handler = (e) => {
      if (searchWrapRef.current && !searchWrapRef.current.contains(e.target)) {
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [searchSuggestions.length, setSearch]);

  const handleSearchKeyDown = useCallback((e) => {
    if (searchSuggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, searchSuggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (activeIdx >= 0 && activeIdx < searchSuggestions.length) {
        e.preventDefault();
        onPersonClick(searchSuggestions[activeIdx].id);
        setSearch('');
      }
    } else if (e.key === 'Escape') {
      setSearch('');
    }
  }, [searchSuggestions, activeIdx, onPersonClick, setSearch]);

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

  // Sync horizontal scroll between the day-header strip and the clinic grid.
  // Both have min-width:1000px. The header strip uses overflow:hidden to hide
  // its own scrollbar; we mirror board-scroll's scrollLeft onto it.
  const scrollRef = useRef(null);
  const headerRef = useRef(null);
  useEffect(() => {
    const scroll = scrollRef.current;
    const header = headerRef.current;
    if (!scroll || !header) return;
    const onScroll = () => { header.scrollLeft = scroll.scrollLeft; };
    scroll.addEventListener('scroll', onScroll, { passive: true });
    return () => scroll.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="board-wrapper">
      {/* Search bar: OUTSIDE board-scroll — never scrolls away. */}
      <div className="board-search">
        <div className="search-wrap" ref={searchWrapRef}>
          <span className="search-icon"><Search size={15} /></span>
          <input
            data-tour="search-bar"
            className="search-input"
            type="search"
            placeholder="Search Staff…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            autoComplete="off"
          />
          {searchSuggestions.length > 0 && (
            <div className="search-suggestions">
              {searchSuggestions.map((p, i) => (
                <button
                  key={p.id}
                  className={`search-suggestion${i === activeIdx ? ' search-suggestion--active' : ''}`}
                  onMouseDown={e => {
                    // mousedown fires before blur; prevent input blur closing dropdown
                    e.preventDefault();
                    onPersonClick(p.id);
                    setSearch('');
                  }}
                  onMouseEnter={() => setActiveIdx(i)}
                >
                  <div className="dot" style={{ background: p.color }} />
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Standing staff notice — staff view only */}
      {!isAdmin && (
        <div className="staff-notice">
          <AlertTriangle size={13} />
          <span>The schedule is subject to change with short notice. It is your responsibility to review your schedule daily.</span>
        </div>
      )}

      {/* Day-header strip: OUTSIDE board-scroll — never scrolls away vertically.
          Horizontal scroll is mirrored from board-scroll via the JS listener above. */}
      {!showNotPosted && (
        <div ref={headerRef} className="board-day-headers" aria-hidden="true">
          <div className="board-day-headers-inner">
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
          </div>
        </div>
      )}

      {/* Clinic grid: the only thing that scrolls. */}
      <div ref={scrollRef} data-tour="week-board" className="board-scroll">
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
                      isDoctorOff={doctorOffClinicIds?.has(clinic.id) ?? false}
                      holidayName={holidayWorkedMap?.get(clinic.id) ?? null}
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
        {footer}
      </div>
    </div>
  );
}
