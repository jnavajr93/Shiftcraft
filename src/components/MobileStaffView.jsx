import { useState, useEffect, useRef } from 'react';
import { ChevronLeft, Search, User, X } from 'lucide-react';
import { useApp, isoWeek, mondayOfWeek } from '../context/AppContext.jsx';
import {
  DAYS,
  getRenderedSlotEntries,
  getSlotPersonId,
  getSlotLabel,
  formatVariableSlotTime,
  formatOpenerTimeDisplay,
  formatOpeningFDTimeDisplay,
  formatClosingOverlayDisplay,
  formatClosingFDOverlayDisplay,
  formatScribeTimeDisplay,
  OBS_SLOT_TYPES,
} from '../data/seed.js';
import { WeekRows } from './PersonOverlay.jsx';

const STORAGE_KEY = 'shiftcraft_my_name';

function todayDayIdx(currentWeek) {
  const dow = new Date().getDay(); // 0=Sun..6=Sat
  if (currentWeek !== isoWeek(new Date()) || dow < 1 || dow > 5) return null;
  return dow - 1;
}

export default function MobileStaffView({ onPersonClick }) {
  const { data, boardClinics, currentWeek } = useApp();

  // Default selected day: today if current week + weekday, else Mon
  const [dayIdx, setDayIdx] = useState(() => todayDayIdx(currentWeek) ?? 0);

  useEffect(() => {
    setDayIdx(todayDayIdx(currentWeek) ?? 0);
  }, [currentWeek]);

  const todayIdx = todayDayIdx(currentWeek);

  // My schedule
  const [myName, setMyName] = useState(() => localStorage.getItem(STORAGE_KEY) ?? '');
  const [nameSearch, setNameSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showMySchedule, setShowMySchedule] = useState(false);
  const searchInputRef = useRef(null);

  useEffect(() => {
    if (showSearch && searchInputRef.current) searchInputRef.current.focus();
  }, [showSearch]);

  const nameSuggestions = nameSearch.trim()
    ? (data.people ?? []).filter(p =>
        p.name.toLowerCase().includes(nameSearch.toLowerCase())
      )
    : [];

  const selectName = (name) => {
    setMyName(name);
    localStorage.setItem(STORAGE_KEY, name);
    setNameSearch('');
    setShowSearch(false);
    setShowMySchedule(true);
  };

  const clearMyName = () => {
    setMyName('');
    localStorage.removeItem(STORAGE_KEY);
    setShowMySchedule(false);
  };

  // Find person IDs by name (case-insensitive)
  const myPersonIds = myName
    ? (data.people ?? [])
        .filter(p => p.name.toLowerCase() === myName.toLowerCase())
        .map(p => p.id)
    : [];

  // Touch swipe to change day
  const touchStartX = useRef(null);
  const handleTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; };
  const handleTouchEnd = (e) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 44) return;
    if (dx < 0) setDayIdx(d => Math.min(d + 1, 4));
    if (dx > 0) setDayIdx(d => Math.max(d - 1, 0));
  };

  // "My schedule" full-week view
  if (showMySchedule && myPersonIds.length > 0) {
    return (
      <div className="mobile-staff-view">
        <div className="mobile-my-schedule-header">
          <button className="btn-icon" onClick={() => setShowMySchedule(false)} aria-label="Back">
            <ChevronLeft size={18} />
          </button>
          <span className="mobile-my-schedule-title">{myName}'s week</span>
          <button className="btn-icon" onClick={clearMyName} aria-label="Clear my name">
            <X size={16} />
          </button>
        </div>
        <div className="mobile-my-schedule-body">
          <WeekRows
            personIds={myPersonIds}
            clinics={boardClinics ?? []}
            additionalTasks={data.additionalTasks}
            monday={mondayOfWeek(currentWeek)}
          />
        </div>
      </div>
    );
  }

  // Schedule not yet posted
  if (boardClinics === null) {
    return (
      <div className="mobile-staff-view">
        <MobileNameBar
          myName={myName}
          showSearch={showSearch}
          nameSearch={nameSearch}
          nameSuggestions={nameSuggestions}
          searchInputRef={searchInputRef}
          onToggleSearch={() => setShowSearch(s => !s)}
          onNameChange={setNameSearch}
          onSelectName={selectName}
          onShowMySchedule={() => setShowMySchedule(true)}
          onClearMyName={clearMyName}
        />
        <div className="mobile-not-posted">
          <span style={{ fontSize: 20, opacity: 0.4 }}>📋</span>
          Schedule not yet posted for this week.
        </div>
      </div>
    );
  }

  const day = DAYS[dayIdx];
  const dayClinics = boardClinics.filter(c => c.day === day && c.open);

  return (
    <div className="mobile-staff-view">
      <MobileNameBar
        myName={myName}
        showSearch={showSearch}
        nameSearch={nameSearch}
        nameSuggestions={nameSuggestions}
        searchInputRef={searchInputRef}
        onToggleSearch={() => setShowSearch(s => !s)}
        onNameChange={setNameSearch}
        onSelectName={selectName}
        onShowMySchedule={() => setShowMySchedule(true)}
        onClearMyName={clearMyName}
      />

      {/* Day tabs */}
      <div className="mobile-day-tabs">
        {DAYS.map((d, i) => (
          <button
            key={d}
            className={[
              'mobile-day-tab',
              i === dayIdx ? 'active' : '',
              i === todayIdx ? 'today' : '',
            ].filter(Boolean).join(' ')}
            onClick={() => setDayIdx(i)}
          >
            {d}
          </button>
        ))}
      </div>

      {/* Day content */}
      <div
        className="mobile-day-content"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {dayClinics.length === 0 ? (
          <div className="mobile-empty-day">No open clinics on {day}</div>
        ) : (
          dayClinics.map(clinic => (
            <MobileClinicCard
              key={clinic.id}
              clinic={clinic}
              people={data.people}
              onPersonClick={onPersonClick}
            />
          ))
        )}
      </div>
    </div>
  );
}

function MobileNameBar({
  myName, showSearch, nameSearch, nameSuggestions, searchInputRef,
  onToggleSearch, onNameChange, onSelectName, onShowMySchedule, onClearMyName,
}) {
  return (
    <>
      <div className="mobile-name-bar">
        {myName ? (
          <button className="mobile-my-btn" onClick={onShowMySchedule}>
            <User size={13} />
            {myName}'s schedule
          </button>
        ) : (
          <button className="mobile-find-btn" onClick={onToggleSearch}>
            <Search size={13} />
            Find my schedule
          </button>
        )}
      </div>
      {showSearch && (
        <div className="mobile-search-bar">
          <input
            ref={searchInputRef}
            className="mobile-search-input"
            type="search"
            placeholder="Type your name…"
            value={nameSearch}
            onChange={e => onNameChange(e.target.value)}
          />
          {nameSuggestions.length > 0 && (
            <div className="mobile-name-suggestions">
              {nameSuggestions.map(p => (
                <button key={p.id} className="mobile-name-suggestion" onClick={() => onSelectName(p.name)}>
                  <div className="dot" style={{ background: p.color }} />
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function MobileClinicCard({ clinic, people, onPersonClick }) {
  const slots = getRenderedSlotEntries(clinic);

  return (
    <div className="mobile-clinic-card">
      <div className="mobile-clinic-location">{clinic.location}</div>
      {slots.length === 0 ? (
        <div className="mobile-clinic-empty">No staff assigned</div>
      ) : (
        <div className="mobile-clinic-slots">
          {slots.map(([slotType, slotVal]) => {
            const pid = getSlotPersonId(slotVal);
            const person = pid ? people.find(p => p.id === pid) : null;
            const label = getSlotLabel(slotType, clinic.location);

            let time = '';
            if (slotType === 'scribe') {
              time = formatScribeTimeDisplay(slotVal) ?? '1st Patient – Close';
            } else if (slotType === 'opener') {
              time = formatOpenerTimeDisplay(clinic, slotVal);
            } else if (slotType === 'openingFrontDesk') {
              time = formatOpeningFDTimeDisplay(slotVal);
            } else if (slotType === 'closing') {
              time = formatClosingOverlayDisplay(slotVal, clinic);
            } else if (slotType === 'closingFrontDesk') {
              time = formatClosingFDOverlayDisplay(slotVal);
            } else if (slotType === 'frontDesk') {
              time = formatVariableSlotTime(slotVal) ?? 'Open – Close';
            } else if (slotType === 'middle' || slotType === 'training') {
              time = formatVariableSlotTime(slotVal) ?? '';
            } else if (OBS_SLOT_TYPES.includes(slotType)) {
              time = 'Open – Close';
            }

            return (
              <div key={slotType} className="mobile-slot-row">
                <div className="mobile-slot-label">{label}</div>
                <div className="mobile-slot-person">
                  {person ? (
                    <button
                      className="mobile-person-btn"
                      onClick={() => onPersonClick(person.id)}
                    >
                      <div className="dot" style={{ background: person.color }} />
                      {person.name}
                    </button>
                  ) : (
                    <span className="mobile-slot-empty">—</span>
                  )}
                </div>
                {time && <div className="mobile-slot-time">{time}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
