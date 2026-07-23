import { useState, useEffect, useRef, useMemo } from 'react';
import { GripVertical, PhoneCall } from 'lucide-react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useApp } from '../context/AppContext.jsx';
import { getOnCallPerson, addWeeks, formatBlockRange } from '../utils/oncall.js';
import { dedupeByName } from './AbsenceCalendar.jsx';

// ─── Anchor helpers ───────────────────────────
// ISO week string → "YYYY-MM-DD" of that Monday
function isoWeekToMondayStr(weekStr) {
  if (!weekStr) return '';
  const [y, w] = weekStr.split('-W').map(Number);
  const jan4dow = new Date(Date.UTC(y, 0, 4)).getUTCDay() || 7;
  const monMs = Date.UTC(y, 0, 4) - (jan4dow - 1) * 86400000 + (w - 1) * 7 * 86400000;
  const d = new Date(monMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

// "YYYY-MM-DD" → ISO week string for the ISO week containing that date
function dateStrToIsoWeek(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const dow = new Date(ms).getUTCDay() || 7; // 1=Mon … 7=Sun
  const monMs = ms - (dow - 1) * 86400000;
  const thu = new Date(monMs + 3 * 86400000);
  const thuYear = thu.getUTCFullYear();
  const week = Math.ceil(((thu.getTime() - Date.UTC(thuYear, 0, 1)) / 86400000 + 1) / 7);
  return `${thuYear}-W${String(week).padStart(2, '0')}`;
}

// "YYYY-Www" → "Mon D, YYYY" of that Monday for display
function formatWeekLabel(weekStr) {
  const ds = isoWeekToMondayStr(weekStr);
  if (!ds) return weekStr;
  return new Date(ds + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

// ─── Sortable pool item ───────────────────────
function SortablePoolItem({ person, index }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: person.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div ref={setNodeRef} style={style} className="oncall-rotation-item">
      <div className="oncall-rotation-grip" {...attributes} {...listeners} title="Drag to reorder">
        <GripVertical size={14} />
      </div>
      <span className="oncall-rotation-index">{index + 1}.</span>
      <span className="oncall-pool-dot" style={{ background: person.color }} />
      <span className="oncall-rotation-name">{person.name}</span>
    </div>
  );
}

// ─── Main OnCallManager ───────────────────────
export default function OnCallManager() {
  const { oncall, saveOncall, currentWeek, data } = useApp();

  // Eligible pool: people with 'On Call' role, deduped by name (linked tech+admin records)
  const eligiblePool = useMemo(
    () => dedupeByName((data.people ?? []).filter(p => (p.roles ?? []).includes('On Call'))),
    [data.people],
  );

  const [blockWeeks, setBlockWeeks]   = useState(4);
  const [anchorWeek, setAnchorWeek]   = useState(null);
  const [saving, setSaving]           = useState(false);
  const [savedMsg, setSavedMsg]       = useState('');
  const [items, setItems]             = useState([]); // ordered eligible people
  const didInitBlockRef = useRef(false);

  // Sync items whenever oncall rotation or eligible pool changes.
  // Order: saved rotation (filtered to eligible) + any new eligible not yet in rotation.
  useEffect(() => {
    if (!oncall) return;

    if (!didInitBlockRef.current) {
      didInitBlockRef.current = true;
      setBlockWeeks(oncall.blockWeeks ?? 4);
      setAnchorWeek(oncall.anchorWeek ?? null);
    }

    const savedRotation = oncall.rotation ?? [];
    const inRotation = savedRotation
      .map(name => eligiblePool.find(p => p.name === name))
      .filter(Boolean);
    const inRotationIds = new Set(inRotation.map(p => p.id));
    const newEligible = eligiblePool.filter(p => !inRotationIds.has(p.id));
    setItems([...inRotation, ...newEligible]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oncall, eligiblePool]);

  const sensors = useSensors(useSensor(PointerSensor));

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex(i => i.id === active.id);
    const newIdx = items.findIndex(i => i.id === over.id);
    setItems(arrayMove(items, oldIdx, newIdx));
  };

  const handleSave = async () => {
    setSaving(true);
    const rotation = items.map(i => i.name);
    await saveOncall({
      ...(oncall ?? {}),
      rotation,
      blockWeeks: Math.max(1, Number(blockWeeks) || 4),
      anchorWeek: anchorWeek ?? null,
    });
    setSaving(false);
    setSavedMsg('Saved');
    setTimeout(() => setSavedMsg(''), 2500);
  };

  const isDormant = eligiblePool.length === 0;

  const preview = (items.length > 0 && anchorWeek)
    ? getOnCallPerson(currentWeek, {
        rotation: items.map(i => i.name),
        blockWeeks: Math.max(1, Number(blockWeeks) || 4),
        anchorWeek,
      })
    : null;

  // Projection: first min(rotation, 6) blocks starting from anchorWeek
  const projection = useMemo(() => {
    if (!anchorWeek || items.length === 0) return [];
    const bw = Math.max(1, Number(blockWeeks) || 4);
    const count = Math.min(items.length, 6);
    const rotation = items.map(i => i.name);
    return Array.from({ length: count }, (_, i) => ({
      name: rotation[i % rotation.length],
      range: formatBlockRange(addWeeks(anchorWeek, i * bw), addWeeks(anchorWeek, (i + 1) * bw - 1)),
    }));
  }, [anchorWeek, items, blockWeeks]);

  return (
    <div className="oncall-manager">
      {isDormant ? (
        <div className="oncall-dormant-msg">
          <PhoneCall size={15} style={{ opacity: 0.4 }} />
          Feature Is Dormant — Mark At Least One Tech With The On Call Role To Activate.
        </div>
      ) : (
        <>
          <div className="oncall-manager-section">
            <div className="oncall-manager-label">Rotation order</div>
            <div className="oncall-manager-hint">
              Drag To Reorder. Each Person Takes {blockWeeks} Consecutive Week{blockWeeks !== 1 ? 's' : ''} On Call.
              Techs With The On Call Role Appear Here Automatically.
            </div>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={items.map(i => i.id)} strategy={verticalListSortingStrategy}>
                <div className="oncall-rotation-list">
                  {items.map((person, idx) => (
                    <SortablePoolItem key={person.id} person={person} index={idx} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
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
            <label className="oncall-manager-label">Rotation starts</label>
            <div className="oncall-manager-hint">Monday of the first person's block.</div>
            <input
              type="date"
              className="setup-input"
              style={{ width: 160 }}
              value={anchorWeek ? isoWeekToMondayStr(anchorWeek) : ''}
              onChange={e => setAnchorWeek(dateStrToIsoWeek(e.target.value) || null)}
            />
            {anchorWeek && (
              <div className="oncall-manager-hint" style={{ marginTop: 2 }}>
                Week of {formatWeekLabel(anchorWeek)}
              </div>
            )}
            {projection.length > 0 && (
              <div className="oncall-projection-list">
                {projection.map((p, i) => (
                  <div key={i} className="oncall-projection-row">
                    <span className="oncall-projection-name">{p.name}</span>
                    <span className="oncall-projection-range">{p.range}</span>
                  </div>
                ))}
                {items.length > 6 && (
                  <div className="oncall-projection-more">…{items.length - 6} more</div>
                )}
              </div>
            )}
          </div>

          {preview && (
            <div className="oncall-preview">
              <PhoneCall size={14} />
              <span>On Call This Week: <strong>{preview}</strong></span>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <button
              className="btn btn-primary btn-pill"
              style={{ minHeight: 34, fontSize: 13 }}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save Rotation'}
            </button>
            {savedMsg && <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 500 }}>{savedMsg}</span>}
          </div>
        </>
      )}
    </div>
  );
}
