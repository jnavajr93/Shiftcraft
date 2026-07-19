import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, GripVertical, PhoneCall } from 'lucide-react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useApp } from '../context/AppContext.jsx';
import { generateId } from '../data/seed.js';
import { getOnCallPerson } from '../utils/oncall.js';

// ─── Sortable rotation item ───────────────────
function SortableRotationItem({ item, index, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div ref={setNodeRef} style={style} className="oncall-rotation-item">
      <div className="oncall-rotation-grip" {...attributes} {...listeners} title="Drag to reorder">
        <GripVertical size={14} />
      </div>
      <span className="oncall-rotation-index">{index + 1}.</span>
      <span className="oncall-rotation-name">{item.name}</span>
      <button
        className="btn btn-icon oncall-rotation-remove"
        onClick={() => onRemove(item.id)}
        aria-label={`Remove ${item.name}`}
        title="Remove"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// ─── Main OnCallManager ───────────────────────
export default function OnCallManager() {
  const { oncall, saveOncall, currentWeek } = useApp();

  const [items, setItems]           = useState([]);
  const [blockWeeks, setBlockWeeks] = useState(4);
  const [anchorWeek, setAnchorWeek] = useState('');
  const [newName, setNewName]       = useState('');
  const [saving, setSaving]         = useState(false);
  const [savedMsg, setSavedMsg]     = useState('');
  const newNameRef = useRef(null);
  const didInitRef = useRef(false);

  // Initialize from context once it loads
  useEffect(() => {
    if (oncall && !didInitRef.current) {
      didInitRef.current = true;
      setItems((oncall.rotation ?? []).map(name => ({ id: generateId(), name })));
      setBlockWeeks(oncall.blockWeeks ?? 4);
      setAnchorWeek(oncall.anchorWeek ?? '');
    }
  }, [oncall]);

  const sensors = useSensors(useSensor(PointerSensor));

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex(i => i.id === active.id);
    const newIdx = items.findIndex(i => i.id === over.id);
    setItems(arrayMove(items, oldIdx, newIdx));
  };

  const addPerson = () => {
    const name = newName.trim();
    if (!name) return;
    setItems(prev => [...prev, { id: generateId(), name }]);
    setNewName('');
    newNameRef.current?.focus();
  };

  const removePerson = (id) => {
    setItems(prev => prev.filter(i => i.id !== id));
  };

  const handleSave = async () => {
    setSaving(true);
    const rotation = items.map(i => i.name);
    await saveOncall({
      rotation,
      blockWeeks: Math.max(1, Number(blockWeeks) || 4),
      anchorWeek: anchorWeek || null,
    });
    setSaving(false);
    setSavedMsg('Saved');
    setTimeout(() => setSavedMsg(''), 2500);
  };

  const isDormant = items.length === 0 || !anchorWeek;

  const preview = isDormant ? null : getOnCallPerson(currentWeek, {
    rotation: items.map(i => i.name),
    blockWeeks: Math.max(1, Number(blockWeeks) || 4),
    anchorWeek,
  });

  return (
    <div className="oncall-manager">
      <div className="oncall-manager-section">
        <div className="oncall-manager-label">Rotation order</div>
        <div className="oncall-manager-hint">
          Drag to reorder. Each person takes {blockWeeks} consecutive week{blockWeeks !== 1 ? 's' : ''} before the next.
        </div>

        {items.length > 0 && (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
              <div className="oncall-rotation-list">
                {items.map((item, idx) => (
                  <SortableRotationItem key={item.id} item={item} index={idx} onRemove={removePerson} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {items.length === 0 && (
          <div className="oncall-empty-list">No people added yet. Add names below.</div>
        )}

        <div className="oncall-add-row">
          <input
            ref={newNameRef}
            className="setup-input oncall-add-input"
            type="text"
            placeholder="Name…"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') addPerson(); }}
          />
          <button
            className="btn btn-primary btn-pill"
            style={{ minHeight: 34, fontSize: 12 }}
            onClick={addPerson}
            disabled={!newName.trim()}
          >
            <Plus size={13} /> Add
          </button>
        </div>
      </div>

      <div className="oncall-manager-section">
        <label className="oncall-manager-label">Block length (weeks per person)</label>
        <input
          type="number"
          className="setup-input"
          style={{ width: 80 }}
          min={1}
          max={52}
          value={blockWeeks}
          onChange={e => setBlockWeeks(Number(e.target.value) || 4)}
        />
      </div>

      <div className="oncall-manager-section">
        <label className="oncall-manager-label">Rotation start (anchor week)</label>
        <div className="oncall-manager-hint">
          The first person in the list is on call starting this week.
        </div>
        <input
          type="week"
          className="setup-input"
          style={{ width: 200 }}
          value={anchorWeek}
          onChange={e => setAnchorWeek(e.target.value)}
        />
      </div>

      {isDormant ? (
        <div className="oncall-dormant-msg">
          <PhoneCall size={15} style={{ opacity: 0.4 }} />
          Feature is dormant — add at least one person and set an anchor week to activate.
        </div>
      ) : (
        <div className="oncall-preview">
          <PhoneCall size={14} />
          <span>On call this week: <strong>{preview ?? '—'}</strong></span>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
        <button
          className="btn btn-primary btn-pill"
          style={{ minHeight: 34, fontSize: 13 }}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save rotation'}
        </button>
        {savedMsg && <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 500 }}>{savedMsg}</span>}
      </div>
    </div>
  );
}
