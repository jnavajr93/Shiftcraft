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
import AdditionalTasks from './components/AdditionalTasks.jsx';
import ConflictBanner from './components/ConflictBanner.jsx';

function AppContent() {
  const { data, isAdmin, assignSlot, assignTask } = useApp();
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
    const parts = String(over.id).split(':');
    if (parts.length === 3 && parts[0] === 'slot') {
      // Clinic slot: 'slot:clinicId:slotType'
      assignSlot(parts[1], parts[2], active.id);
    } else if (parts.length === 2 && parts[0] === 'task') {
      // Task slot: 'task:taskId'
      assignTask(parts[1], active.id);
    }
  }, [assignSlot, assignTask]);

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
        {/* Print-only header */}
        <div className="print-header" style={{ padding: '16px 0 8px', borderBottom: '1px solid #ccc', marginBottom: 16 }}>
          <div style={{ fontSize: 18, fontWeight: 600 }}>Shiftcraft — Week of {data ? '' : ''}</div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>CONFIDENTIAL — Admin use only</div>
        </div>

        <TopBar activeTab={activeTab} setActiveTab={setActiveTab} />
        <div className="main">
          {activeTab === 'schedule' ? (
            <div className="admin-layout">
              {isAdmin && <Sidebar onPersonClick={openPerson} />}
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
                {isAdmin && <ConflictBanner />}
                <div style={{ flex: 1, overflow: 'auto' }}>
                  <Board
                    search={search}
                    setSearch={setSearch}
                    onPersonClick={openPerson}
                    onEditClinic={isAdmin ? setConfigClinicId : () => {}}
                  />
                  <AdditionalTasks onPersonClick={openPerson} />
                </div>
                {isAdmin && <HoursBar />}
              </div>
            </div>
          ) : (
            <Setup />
          )}
        </div>

        {/* Print-only footer */}
        <div className="print-footer" style={{ marginTop: 24, paddingTop: 8, borderTop: '1px solid #ccc', fontSize: 11, color: '#666', display: 'flex', justifyContent: 'space-between' }}>
          <span>Generated {new Date().toLocaleString()}</span>
          <span>CONFIDENTIAL — Admin use only</span>
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
