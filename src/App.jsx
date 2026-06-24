import { useState, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';

import { AppProvider, useApp } from './context/AppContext.jsx';
import TopBar from './components/TopBar.jsx';
import Board from './components/Board.jsx';
import Sidebar from './components/Sidebar.jsx';
import HoursBar from './components/HoursBar.jsx';
import ClinicConfig from './components/ClinicConfig.jsx';
import Setup from './components/Setup.jsx';
import PersonOverlay from './components/PersonOverlay.jsx';

function AppContent() {
  const { data, isAdmin, assignSlot } = useApp();
  const [activeTab, setActiveTab] = useState('schedule');
  const [selectedPersonId, setSelectedPersonId] = useState(null);
  const [configClinicId, setConfigClinicId] = useState(null);
  const [search, setSearch] = useState('');
  const [activeDragId, setActiveDragId] = useState(null);

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
    // over.id format: 'slot:clinicId:slotType'
    const parts = String(over.id).split(':');
    if (parts.length === 3 && parts[0] === 'slot') {
      const [, clinicId, slotType] = parts;
      assignSlot(clinicId, slotType, active.id);
    }
  }, [assignSlot]);

  const openPerson = useCallback((personId) => {
    setSelectedPersonId(personId);
  }, []);

  const selectedPerson = selectedPersonId
    ? data.people.find(p => p.id === selectedPersonId) ?? null
    : null;

  const activePerson = activeDragId
    ? data.people.find(p => p.id === activeDragId)
    : null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="app">
        <TopBar activeTab={activeTab} setActiveTab={setActiveTab} />
        <div className="main">
          {activeTab === 'schedule' ? (
            <div className="admin-layout">
              {isAdmin && <Sidebar onPersonClick={openPerson} />}
              <div className="board-wrapper" style={{ display: 'flex', flexDirection: 'column' }}>
                <Board
                  search={search}
                  setSearch={setSearch}
                  onPersonClick={openPerson}
                  onEditClinic={isAdmin ? setConfigClinicId : () => {}}
                />
                {isAdmin && <HoursBar />}
              </div>
            </div>
          ) : (
            <Setup />
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
