import { useState, useCallback, useEffect, useRef } from 'react';
import { X as XIcon } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';

import { AppProvider, useApp } from './context/AppContext.jsx';
import { getAssignmentsForPerson, slotEffectiveRange, rangesOverlap } from './data/seed.js';
import { getBlockingAbsence, formatAbsenceBlockMsg } from './utils/absenceUtils.js';
import { TourProvider } from './components/Tour.jsx';
import TopBar from './components/TopBar.jsx';
import Board from './components/Board.jsx';
import TriageBoard from './components/TriageBoard.jsx';
import Sidebar from './components/Sidebar.jsx';
import HoursBar from './components/HoursBar.jsx';
import ClinicConfig from './components/ClinicConfig.jsx';
import Setup from './components/Setup.jsx';
import PersonOverlay from './components/PersonOverlay.jsx';
import AdditionalTasks from './components/AdditionalTasks.jsx';
import UnassignedStaff from './components/UnassignedStaff.jsx';
import ConflictBanner from './components/ConflictBanner.jsx';
import MobileStaffView from './components/MobileStaffView.jsx';
import OnCallRotationView from './components/OnCallRotationView.jsx';

function SavedToast() {
  const { saveStatus, isAdmin } = useApp();
  const [visible, setVisible] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);
  const holdTimerRef = useRef(null);
  const fadeTimerRef = useRef(null);

  useEffect(() => {
    if (saveStatus === 'saved' && isAdmin) {
      clearTimeout(holdTimerRef.current);
      clearTimeout(fadeTimerRef.current);
      setFadingOut(false);
      setVisible(true);
      holdTimerRef.current = setTimeout(() => {
        setFadingOut(true);
        fadeTimerRef.current = setTimeout(() => {
          setVisible(false);
          setFadingOut(false);
        }, 300);
      }, 2700);
    }
  }, [saveStatus, isAdmin]);

  if (!visible) return null;
  return (
    <div className={`saved-toast${fadingOut ? ' saved-toast--out' : ''}`}>✓ Saved</div>
  );
}

function BoardTabBar({ boardTab, setBoardTab }) {
  return (
    <div className="board-tab-bar">
      <button
        className={`board-tab-btn${boardTab === 'clinics' ? ' active' : ''}`}
        onClick={() => setBoardTab('clinics')}
      >
        Clinics
      </button>
      <button
        className={`board-tab-btn${boardTab === 'triage' ? ' active' : ''}`}
        onClick={() => setBoardTab('triage')}
      >
        Triage
      </button>
    </div>
  );
}

function AppContent() {
  const { data, isAdmin, boardClinics, isLoading, loadError, saveStatus, dismissSaveError, assignSlot, assignTask, absences, weekMonday } = useApp();

  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: 16,
        color: 'var(--text-secondary)',
      }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.5px', color: 'var(--text-primary)' }}>
          Shiftcraft
        </div>
        <div style={{ fontSize: 14 }}>Loading Schedule…</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: 20,
        padding: '0 24px',
      }}>
        <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.5px', color: 'var(--text-primary)' }}>
          Shiftcraft
        </div>
        <div style={{
          background: 'var(--bg-elevated)',
          border: '1.5px solid #fca5a5',
          borderRadius: 10,
          padding: '20px 28px',
          maxWidth: 480,
          textAlign: 'center',
        }}>
          <div style={{ fontWeight: 600, color: '#dc2626', marginBottom: 10, fontSize: 15 }}>
            Schedule Could Not Be Loaded
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            {loadError}
          </div>
        </div>
        <button
          className="btn btn-primary"
          style={{ minHeight: 38 }}
          onClick={() => window.location.reload()}
        >
          Refresh
        </button>
      </div>
    );
  }
  const [activeTab, setActiveTab] = useState('schedule');
  const [boardTab, setBoardTab] = useState('clinics');
  const [setupSection, setSetupSection] = useState('staff');
  const [showOnCallRotation, setShowOnCallRotation] = useState(false);

  // Guard: staff view must never land on Setup. Belt-and-suspenders for the
  // manager-pill exit fix; also catches deep-links / stale state.
  useEffect(() => {
    if (!isAdmin && activeTab === 'setup') setActiveTab('schedule');
  }, [isAdmin, activeTab]);
  const [selectedPersonId, setSelectedPersonId] = useState(null);
  const [configClinicId, setConfigClinicId] = useState(null);
  const [search, setSearch] = useState('');
  const [activeDragId, setActiveDragId] = useState(null);
  const [blockMsg, setBlockMsg] = useState('');

  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 640px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const handleDragStart = useCallback((event) => {
    setActiveDragId(event.active.id);
  }, []);

  const handleDragEnd = useCallback((event) => {
    const { active, over } = event;
    setActiveDragId(null);
    if (!over) return;
    const parts = String(over.id).split(':');
    if (parts.length === 3 && parts[0] === 'slot') {
      // Clinic slot: 'slot:clinicId:slotType'
      const [, clinicId, slotType] = parts;
      const personId = active.id;
      const clinic = data.clinics.find(c => c.id === clinicId);
      if (clinic) {
        const person = data.people.find(p => p.id === personId);
        if (person) {
          // Absence block
          const pKey = person.name.trim().toLowerCase();
          const slotTimes = slotEffectiveRange(slotType, clinic);
          const blockAbs = getBlockingAbsence(pKey, clinic.day, weekMonday, absences, slotTimes.start, slotTimes.end);
          if (blockAbs) {
            setBlockMsg(formatAbsenceBlockMsg(person.name, clinic.day, blockAbs));
            setTimeout(() => setBlockMsg(''), 4000);
            return;
          }

          const nameKey = person.name.trim().toLowerCase();
          const isObsTarget = clinic.location?.toLowerCase() === 'obs';
          const targetRange = isObsTarget ? null : slotEffectiveRange(slotType, clinic);
          const dayAssignments = getAssignmentsForPerson(nameKey, clinic.day, data.people, data.clinics);
          const blocked = dayAssignments.some(a => {
            if (a.clinicId === clinicId && a.slotType === slotType) return false;
            if (isObsTarget || a.isObs) return true;
            return rangesOverlap(targetRange, slotEffectiveRange(a.slotType, a.clinic));
          });
          if (blocked) return;
        }
      }
      assignSlot(clinicId, slotType, personId);
    } else if (parts.length === 2 && parts[0] === 'task') {
      // Task slot: 'task:taskId'
      const task = data.additionalTasks.find(t => t.id === parts[1]);
      const person = data.people.find(p => p.id === active.id);
      if (task && person) {
        const pKey = person.name.trim().toLowerCase();
        const tStart = (task.start != null && task.start !== 'close') ? task.start : null;
        const tEnd   = (task.end   != null && task.end   !== 'close') ? task.end   : null;
        const blockAbs = getBlockingAbsence(pKey, task.day, weekMonday, absences, tStart, tEnd);
        if (blockAbs) {
          setBlockMsg(formatAbsenceBlockMsg(person.name, task.day, blockAbs));
          setTimeout(() => setBlockMsg(''), 4000);
          return;
        }
      }
      assignTask(parts[1], active.id);
    }
  }, [assignSlot, assignTask, data, absences, weekMonday]);

  const openPerson = useCallback((personId) => setSelectedPersonId(personId), []);

  const selectedPerson = selectedPersonId
    ? data.people.find(p => p.id === selectedPersonId) ?? null
    : null;

  const activePerson = activeDragId
    ? data.people.find(p => p.id === activeDragId)
    : null;

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="app">
        <TopBar activeTab={activeTab} setActiveTab={setActiveTab} setupSection={setupSection} setSetupSection={setSetupSection} />
        <div className="main">
          {activeTab === 'schedule' ? (
            <div className="admin-layout">
              {isAdmin && <Sidebar onPersonClick={openPerson} />}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
                {isAdmin && <ConflictBanner />}
                {(!isAdmin && isMobile) ? (
                  <MobileStaffView onPersonClick={openPerson} onOpenOnCallRotation={() => setShowOnCallRotation(true)} boardTab={boardTab} setBoardTab={setBoardTab} />
                ) : (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
                    <BoardTabBar boardTab={boardTab} setBoardTab={setBoardTab} />
                    {boardTab === 'clinics' ? (
                      <Board
                        search={search}
                        setSearch={setSearch}
                        onPersonClick={openPerson}
                        onEditClinic={isAdmin ? setConfigClinicId : () => {}}
                        onOpenOnCallRotation={() => setShowOnCallRotation(true)}
                        footer={
                          <>
                            {(isAdmin || boardClinics !== null) && <AdditionalTasks onPersonClick={openPerson} />}
                            {isAdmin && <UnassignedStaff onPersonClick={openPerson} />}
                          </>
                        }
                      />
                    ) : (
                      <TriageBoard />
                    )}
                  </div>
                )}
                {isAdmin && boardTab === 'clinics' && <HoursBar />}
              </div>
            </div>
          ) : (
            <Setup initialSection={setupSection} onBack={() => setActiveTab('schedule')} />
          )}
        </div>

        {selectedPerson && (
          <PersonOverlay
            person={selectedPerson}
            onClose={() => setSelectedPersonId(null)}
            onOpenOnCallRotation={() => setShowOnCallRotation(true)}
          />
        )}

        {showOnCallRotation && (
          <OnCallRotationView onClose={() => setShowOnCallRotation(false)} />
        )}

        {isAdmin && configClinicId && (
          <ClinicConfig
            clinicId={configClinicId}
            onClose={() => setConfigClinicId(null)}
          />
        )}
      </div>

      <SavedToast />
      {saveStatus === 'error' && (
        <div className="saved-toast saved-toast--error">
          <span>⚠ Change not saved — reverted to last saved state</span>
          <button
            className="saved-toast-dismiss"
            onClick={dismissSaveError}
            aria-label="Dismiss"
          >
            <XIcon size={13} />
          </button>
        </div>
      )}
      {blockMsg && (
        <div className="saved-toast saved-toast--error" style={{ bottom: saveStatus === 'error' ? 88 : 48 }}>
          <span>{blockMsg}</span>
          <button className="saved-toast-dismiss" onClick={() => setBlockMsg('')} aria-label="Dismiss">
            <XIcon size={13} />
          </button>
        </div>
      )}

      <DragOverlay dropAnimation={null}>
        {activePerson ? (
          <div
            className="person-chip"
            style={{
              background: 'var(--bg-elevated)',
              boxShadow: '0 4px 20px rgba(0,0,0,0.18)',
              pointerEvents: 'none',
            }}
          >
            <div className="dot" style={{ background: activePerson.color }} />
            {activePerson.name}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
