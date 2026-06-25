import { Search } from 'lucide-react';
import { useApp, mondayOfWeek } from '../context/AppContext.jsx';
import { DAYS } from '../data/seed.js';
import ClinicCard from './ClinicCard.jsx';

const LOCATION_ORDER = ['Phoenix', 'Chandler', 'Estrella', 'Scottsdale', 'OBS'];
const locationRank = (loc) => { const i = LOCATION_ORDER.indexOf(loc); return i === -1 ? 999 : i; };

export default function Board({ search, setSearch, onPersonClick, onEditClinic }) {
  const { data, isAdmin, currentWeek } = useApp();
  const monday = mondayOfWeek(currentWeek);

  const matchedPersonIds = search.trim()
    ? data.people
        .filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
        .map(p => p.id)
    : [];

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
          {DAYS.map((day, idx) => {
            const dayClinics = data.clinics
              .filter(c => c.day === day && (isAdmin || c.open))
              .sort((a, b) => locationRank(a.location) - locationRank(b.location));
            const d = new Date(monday);
            d.setUTCDate(monday.getUTCDate() + idx);
            const dateLabel = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
            return (
              <div key={day} className="board-col">
                <div className="col-header">
                  <div className="col-header-day">{day}</div>
                  <div className="col-header-date">{dateLabel}</div>
                </div>
                {dayClinics.length === 0 && (
                  <div className="empty-col-msg">No clinics</div>
                )}
                {dayClinics.map(clinic => (
                  <ClinicCard
                    key={clinic.id}
                    clinic={clinic}
                    onPersonClick={onPersonClick}
                    onEditClinic={onEditClinic}
                    matchedPersonIds={matchedPersonIds}
                    hasSearch={search.trim().length > 0}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
