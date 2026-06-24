import { Search } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { DAYS } from '../data/seed.js';
import ClinicCard from './ClinicCard.jsx';

export default function Board({ search, setSearch, onPersonClick, onEditClinic }) {
  const { data, isAdmin } = useApp();

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
          {DAYS.map(day => {
            const dayClinics = data.clinics.filter(
              c => c.day === day && (isAdmin || c.open)
            );
            return (
              <div key={day} className="board-col">
                <div className="col-header">
                  <div className="col-header-day">{day}</div>
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
