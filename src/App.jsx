import { useState, useCallback, useEffect, useRef } from 'react';
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
import { TourProvider } from './components/Tour.jsx';
import TopBar from './components/TopBar.jsx';
import Board from './components/Board.jsx';
import Sidebar from './components/Sidebar.jsx';
import HoursBar from './components/HoursBar.jsx';
import ClinicConfig from './components/ClinicConfig.jsx';
import Setup from './components/Setup.jsx';
import PersonOverlay from './components/PersonOverlay.jsx';
import AdditionalTasks from './components/AdditionalTasks.jsx';
import UnassignedStaff from './components/UnassignedStaff.jsx';
import ConflictBanner from './components/ConflictBanner.jsx';
import MobileStaffView from './components/MobileStaffView.jsx';

function SavedToast() {
  const { saveStatus } = useApp();
  const [visible, setVisible] = useState(false);
  const [fadingOut, setFadingOut] = useState(false);
  const holdTimerRef = useRef(null);
  const fadeTimerRef = useRef(null);

  useEffect(() => {
    if (saveStatus === 'saved') {
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
  }, [saveStatus]);

  if (!visible) return null;
  return (
    <div className={`saved-toast${fadingOut ? ' saved-toast--out' : ''}`}>✓ Saved</div>
  );
}

function AppContent() {
  const { data, isAdmin, boardClinics, isLoading, loadError, saveStatus, assignSlot, assignTask } = useApp();

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
  const [setupSection, setSetupSection] = useState('staff');

  // Guard: staff view must never land on Setup. Belt-and-suspenders for the
  // manager-pill exit fix; also catches deep-links / stale state.
  useEffect(() => {
    if (!isAdmin && activeTab === 'setup') setActiveTab('schedule');
  }, [isAdmin, activeTab]);
  const [selectedPersonId, setSelectedPersonId] = useState(null);
  const [configClinicId, setConfigClinicId] = useState(null);
  const [search, setSearch] = useState('');
  const [activeDragId, setActiveDragId] = useState(null);

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
      assignTask(parts[1], active.id);
    }
  }, [assignSlot, assignTask, data]);

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
                  <MobileStaffView onPersonClick={openPerson} />
                ) : (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 0 }}>
                    <Board
                      search={search}
                      setSearch={setSearch}
                      onPersonClick={openPerson}
                      onEditClinic={isAdmin ? setConfigClinicId : () => {}}
                      footer={
                        <>
                          {(isAdmin || boardClinics !== null) && <AdditionalTasks onPersonClick={openPerson} />}
                          {isAdmin && <UnassignedStaff onPersonClick={openPerson} />}
                        </>
                      }
                    />
                  </div>
                )}
                {isAdmin && <HoursBar />}
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
          />
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
        <div className="saved-toast" style={{
          background: '#dc2626',
          color: '#fff',
          bottom: 'auto',
          top: 68,
        }}>
          ⚠ Change not saved — check connection
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
      <TourProvider>
        <AppContent />
      </TourProvider>
    </AppProvider>
  );
}
