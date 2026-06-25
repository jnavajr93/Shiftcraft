import { Search } from 'lucide-react';
import { useApp, mondayOfWeek } from '../context/AppContext.jsx';
import { DAYS } from '../data/seed.js';
import ClinicCard from './ClinicCard.jsx';

const LOCATION_ORDER = ['Phoenix', 'Chandler', 'Estrella', 'Scottsdale', 'OBS'];

export default function Board({ search, setSearch, onPersonClick, onEditClinic }) {
  const { data, isAdmin, currentWeek } = useApp();
  const monday = mondayOfWeek(currentWeek);

  const matchedPersonIds = search.trim()
    ? data.people
        .filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
        .map(p => p.id)
    : [];

  // Fixed locations first, then any extra locations alphabetically
  const allLocations = [...new Set(data.clinics.map(c => c.location))];
  const extraLocations = allLocations.filter(loc => !LOCATION_ORDER.includes(loc)).sort();
  const orderedLocations = [...LOCATION_ORDER, ...extraLocations];

  return (
    <div className="board-wrapper">
      <div className="board-search">
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
      <div data-tour="week-board" className="board-scroll">
        <div className="board-grid">

          {/* Row 0: day headers */}
          {DAYS.map((day, idx) => {
            const d = new Date(monday);
            d.setUTCDate(monday.getUTCDate() + idx);
            const dateLabel = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
            return (
              <div key={day} className="col-header">
                <div className="col-header-day">{day}</div>
                <div className="col-header-date">{dateLabel}</div>
              </div>
            );
          })}

          {/* Rows 1…N: one row per location, one cell per day */}
          {orderedLocations.flatMap(loc =>
            DAYS.map(day => {
              const clinic = data.clinics.find(
                c => c.day === day && c.location === loc && (isAdmin || c.open)
              );
              if (clinic) {
                return (
                  <ClinicCard
                    key={clinic.id}
                    clinic={clinic}
                    onPersonClick={onPersonClick}
                    onEditClinic={onEditClinic}
                    matchedPersonIds={matchedPersonIds}
                    hasSearch={search.trim().length > 0}
                  />
                );
              }
              return (
                <div
                  key={`empty-${loc}-${day}`}
                  className={isAdmin ? 'clinic-row-placeholder' : 'clinic-row-placeholder clinic-row-placeholder--staff'}
                >
                  {isAdmin ? loc : null}
                </div>
              );
            })
          )}

        </div>
      </div>
    </div>
  );
}
