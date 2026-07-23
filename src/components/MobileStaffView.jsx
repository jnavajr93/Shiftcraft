import { useState, useEffect, useRef } from 'react';
import { Search, User, X, AlertTriangle } from 'lucide-react';
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
  const { data, boardClinics, currentWeek, effectiveAdditionalTasks } = useApp();

  const [dayIdx, setDayIdx] = useState(() => todayDayIdx(currentWeek) ?? 0);
  useEffect(() => { setDayIdx(todayDayIdx(currentWeek) ?? 0); }, [currentWeek]);
  const todayIdx = todayDayIdx(currentWeek);

  // My schedule — single nameSearch state; no separate showSearch phase
  const [myName, setMyName] = useState(() => localStorage.getItem(STORAGE_KEY) ?? '');
  const [nameSearch, setNameSearch] = useState('');
  const [showMySchedule, setShowMySchedule] = useState(false);

  // Item 1: Dedupe by name — one suggestion per unique person; prefer tech record for color
  const nameSuggestions = nameSearch.trim()
    ? Object.values(
        (data.people ?? [])
          .filter(p => p.name.toLowerCase().includes(nameSearch.toLowerCase()))
          .reduce((acc, p) => {
            const key = p.name.toLowerCase();
            // Keep tech (non-admin) record so color is correct; overwrite admin if tech seen later
            if (!acc[key] || (p.staffType ?? 'tech') !== 'admin') acc[key] = p;
            return acc;
          }, {})
      )
    : [];

  const selectName = (name) => {
    setMyName(name);
    localStorage.setItem(STORAGE_KEY, name);
    setNameSearch('');
    setShowMySchedule(true);
  };

  const clearMyName = () => {
    setMyName('');
    localStorage.removeItem(STORAGE_KEY);
    setShowMySchedule(false);
  };

  // Collect ALL person IDs matching the name (tech + admin linked records both contribute)
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

  const day = boardClinics ? DAYS[dayIdx] : null;
  const dayClinics = boardClinics ? boardClinics.filter(c => c.day === day && c.open) : [];
  // Item 3: bottom-sheet is the only path — no full-page view exists
  const sheetOpen = showMySchedule && myPersonIds.length > 0;

  return (
    <div className="mobile-staff-view">
      {/* Item 5: single-field search bar — no two-step tap-then-type */}
      <MobileNameBar
        myName={myName}
        nameSearch={nameSearch}
        nameSuggestions={nameSuggestions}
        onNameChange={setNameSearch}
        onSelectName={selectName}
        onShowMySchedule={() => setShowMySchedule(true)}
        onClearMyName={clearMyName}
      />

      {boardClinics === null ? (
        <div className="mobile-not-posted">
          <span style={{ fontSize: 20, opacity: 0.4 }}>📋</span>
          Schedule Not Yet Posted For This Week.
        </div>
      ) : (
        <>
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

          {/* Standing staff notice */}
          <div className="staff-notice staff-notice--mobile">
            <AlertTriangle size={12} />
            <span>The schedule, opening times, and traveling to offices are subject to change with short notice. It is your responsibility to check your schedule regularly.</span>
          </div>

          {/* Day content */}
          <div
            className="mobile-day-content"
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            {dayClinics.length === 0 ? (
              <div className="mobile-empty-day">No Open Clinics On {day}</div>
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
        </>
      )}

      {/* My schedule — centered modal (not bottom sheet; bottom sheet clips Friday) */}
      {sheetOpen && (
        <div className="my-schedule-backdrop" onClick={() => setShowMySchedule(false)}>
          <div className="my-schedule-modal" onClick={e => e.stopPropagation()}>
            <div className="mobile-my-schedule-header">
              <span className="mobile-my-schedule-title">{myName}'s Week</span>
              <button className="btn-icon" onClick={() => setShowMySchedule(false)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="mobile-my-schedule-body">
              <WeekRows
                personIds={myPersonIds}
                clinics={boardClinics ?? []}
                additionalTasks={effectiveAdditionalTasks}
                monday={mondayOfWeek(currentWeek)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Item 5: unified name bar — the bar IS the input when no name is set; no secondary box appears
function MobileNameBar({ myName, nameSearch, nameSuggestions, onNameChange, onSelectName, onShowMySchedule, onClearMyName }) {
  return (
    <div className="mobile-name-bar">
      {myName ? (
        <>
          <button className="mobile-my-btn" onClick={onShowMySchedule}>
            <User size={13} />
            {myName}'s Schedule
          </button>
          <button
            className="btn-icon"
            style={{ marginLeft: 6, flexShrink: 0 }}
            onClick={onClearMyName}
            aria-label="Clear my name"
          >
            <X size={16} />
          </button>
        </>
      ) : (
        <div className="mobile-name-search-wrap">
          <Search size={15} className="mobile-search-icon" />
          {/* Item 2: suppress iOS Contact AutoFill */}
          <input
            className="mobile-name-input"
            type="text"
            placeholder="Find My Schedule…"
            value={nameSearch}
            onChange={e => onNameChange(e.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
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
    </div>
  );
}

function MobileClinicCard({ clinic, people, onPersonClick }) {
  const slots = getRenderedSlotEntries(clinic);

  return (
    <div className="mobile-clinic-card">
      <div className="mobile-clinic-location">{clinic.location}</div>
      {slots.length === 0 ? (
        <div className="mobile-clinic-empty">No Staff Assigned</div>
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
              time = formatOpeningFDTimeDisplay(slotVal, clinic);
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
