import { useState, useRef, useEffect, useCallback } from 'react';
import { X, Send, Loader } from 'lucide-react';
import { useApp } from '../context/AppContext.jsx';
import { DAYS, minutesToTime, getRenderedSlotEntries, getSlotPersonId } from '../data/seed.js';

// ─── Build system prompt from current schedule state ──────────────────────────
function buildSystemPrompt(data, weekLabel) {
  const lines = [
    `You are a scheduling assistant for a medical eye clinic. Today's schedule is for the week of ${weekLabel}.`,
    '',
    '## Staff',
    ...data.people.map(p => {
      const parts = [`- ${p.name} (${p.employmentType}, roles: ${p.roles.join(', ') || 'none'})`];
      if (p.lockedTo?.length) parts[0] += `, locked to: ${p.lockedTo.join(', ')}`;
      if (p.daysOff?.length) parts[0] += `, off: ${p.daysOff.join(', ')}`;
      return parts[0];
    }),
    '',
    '## Clinics & Current Assignments',
    ...DAYS.flatMap(day => {
      const dayClinics = data.clinics.filter(c => c.day === day);
      if (!dayClinics.length) return [];
      return [
        `### ${day}`,
        ...dayClinics.map(c => {
          const status = c.open ? `${minutesToTime(c.startTime)}–${minutesToTime(c.endTime)}, ${c.patientCount ?? '?'} pts` : 'CLOSED';
          const slots = getRenderedSlotEntries(c)
            .map(([slot, sv]) => {
              const pid = getSlotPersonId(sv);
              if (!pid) return null;
              const person = data.people.find(p => p.id === pid);
              return `${slot}: ${person?.name ?? pid}`;
            })
            .filter(Boolean);
          return `- ${c.provider} @ ${c.location} [${status}]${slots.length ? ': ' + slots.join(', ') : ': (no assignments)'}`;
        }),
      ];
    }),
    '',
    '## Additional Tasks',
    ...DAYS.flatMap(day => {
      const tasks = data.additionalTasks.filter(t => t.day === day);
      return tasks.map(t => {
        const person = t.assignedPersonId ? data.people.find(p => p.id === t.assignedPersonId) : null;
        return `- ${day} ${t.label}${t.locationTag ? ` (${t.locationTag})` : ''}: ${person?.name ?? 'unassigned'}`;
      });
    }),
    '',
    '## Your capabilities',
    'You can suggest or make scheduling changes. When you want to assign someone, emit an action block:',
    '<action>{"type":"assign","clinicId":"<id>","slot":"<scribe|opener|closing|middle|training>","personId":"<id>"}</action>',
    'Or to assign a task:',
    '<action>{"type":"assignTask","taskId":"<id>","personId":"<id>"}</action>',
    'Person IDs and clinic IDs are shown below in parentheses if needed — you can infer them from names.',
    '',
    '## IDs for reference',
    'People: ' + data.people.map(p => `${p.name}=${p.id}`).join(', '),
    'Clinics: ' + data.clinics.map(c => `${c.day}/${c.provider}@${c.location}=${c.id}`).join(', '),
    'Tasks: ' + data.additionalTasks.map(t => `${t.day}/${t.label}${t.locationTag ? `@${t.locationTag}` : ''}=${t.id}`).join(', '),
    '',
    'Always explain your reasoning before emitting action blocks. Only emit actions when the user asks you to make a change.',
  ];
  return lines.join('\n');
}

// ─── Parse <action> blocks from assistant response ────────────────────────────
function parseActions(text) {
  const actions = [];
  const re = /<action>([\s\S]*?)<\/action>/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    try {
      actions.push(JSON.parse(match[1].trim()));
    } catch { /* skip malformed */ }
  }
  return actions;
}

// ─── Strip <action> blocks for display ───────────────────────────────────────
function stripActions(text) {
  return text.replace(/<action>[\s\S]*?<\/action>/g, '').trim();
}

// ─── Apply a single action ────────────────────────────────────────────────────
function useApplyAction() {
  const { data, assignSlot, assignTask } = useApp();
  return useCallback((action) => {
    if (action.type === 'assign') {
      const clinic = data.clinics.find(c => c.id === action.clinicId);
      if (!clinic) return null;
      const currentId = clinic.slots[action.slot];
      if (currentId && currentId !== action.personId) {
        // Conflict check: would double-book
        const person = data.people.find(p => p.id === action.personId);
        const alreadyOn = data.clinics.some(c =>
          c.id !== action.clinicId &&
          c.day === clinic.day &&
          c.open &&
          getRenderedSlotEntries(c).some(([, sv]) => getSlotPersonId(sv) === action.personId)
        );
        if (alreadyOn) {
          return { error: `${person?.name ?? action.personId} is already assigned on ${clinic.day}` };
        }
      }
      assignSlot(action.clinicId, action.slot, action.personId);
      return { ok: true };
    }
    if (action.type === 'assignTask') {
      assignTask(action.taskId, action.personId);
      return { ok: true };
    }
    return null;
  }, [data, assignSlot, assignTask]);
}

// ─── Message bubble ───────────────────────────────────────────────────────────
function Bubble({ msg }) {
  const isUser = msg.role === 'user';
  const displayText = msg.role === 'assistant' ? stripActions(msg.content) : msg.content;
  const hasActions = msg.role === 'assistant' && parseActions(msg.content).length > 0;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 10,
    }}>
      <div style={{
        maxWidth: '85%', padding: '8px 12px',
        borderRadius: isUser ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
        background: isUser ? 'var(--accent)' : 'var(--bg-surface)',
        color: isUser ? 'var(--btn-text)' : 'var(--text-primary)',
        border: isUser ? 'none' : '0.5px solid var(--border)',
        fontSize: 13, lineHeight: 1.5,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {displayText || (msg.streaming ? '…' : '')}
      </div>
      {hasActions && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, marginLeft: 2 }}>
          Applied to schedule
        </div>
      )}
    </div>
  );
}

// ─── Main ChatPanel ───────────────────────────────────────────────────────────
export default function ChatPanel({ onClose }) {
  const { data, weekLabel } = useApp();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const bodyRef = useRef(null);
  const applyAction = useApplyAction();

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // Auto-scroll to bottom
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { role: 'user', content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);

    const assistantMsg = { role: 'assistant', content: '', streaming: true };
    setMessages(prev => [...prev, assistantMsg]);

    try {
      const system = buildSystemPrompt(data, weekLabel);
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system,
          messages: nextMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(err);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data_str = line.slice(6).trim();
          if (data_str === '[DONE]') continue;
          try {
            const evt = JSON.parse(data_str);
            if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
              fullText += evt.delta.text;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { role: 'assistant', content: fullText, streaming: true };
                return updated;
              });
            }
          } catch { /* skip non-JSON lines */ }
        }
      }

      // Apply any actions found in the response
      const actions = parseActions(fullText);
      const errors = [];
      for (const action of actions) {
        const result = applyAction(action);
        if (result?.error) errors.push(result.error);
      }
      if (errors.length) showToast(`Warning: ${errors.join('; ')}`);
      else if (actions.length) showToast(`${actions.length} change${actions.length > 1 ? 's' : ''} applied`);

      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', content: fullText, streaming: false };
        return updated;
      });
    } catch (err) {
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: 'assistant', content: `Error: ${err.message}`, streaming: false };
        return updated;
      });
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, data, weekLabel, applyAction]);

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  return (
    <div className="config-panel open" style={{ zIndex: 195, width: 360 }}>
      <div className="config-panel-header">
        <div style={{ fontWeight: 500 }}>Schedule Assistant</div>
        <button className="btn btn-icon" onClick={onClose}><X size={18} /></button>
      </div>

      <div
        ref={bodyRef}
        className="config-panel-body"
        style={{ flex: 1, overflowY: 'auto', gap: 0, padding: '12px 16px' }}
      >
        {messages.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
            Ask about the schedule or request changes
          </div>
        )}
        {messages.map((msg, i) => <Bubble key={i} msg={msg} />)}
      </div>

      {toast && (
        <div style={{
          margin: '0 16px 4px', padding: '6px 10px',
          background: 'var(--accent-subtle)', border: '0.5px solid var(--border)',
          borderRadius: 'var(--radius)', fontSize: 12, color: 'var(--text-secondary)',
        }}>
          {toast}
        </div>
      )}

      <div style={{ padding: '8px 16px 12px', borderTop: '0.5px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <textarea
            className="form-input"
            style={{ flex: 1, resize: 'none', minHeight: 60, fontSize: 13, lineHeight: 1.4 }}
            placeholder="Ask about the schedule…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            disabled={loading}
          />
          <button
            className="btn btn-primary"
            style={{ minHeight: 60, padding: '0 14px', flexShrink: 0 }}
            onClick={send}
            disabled={loading || !input.trim()}
          >
            {loading ? <Loader size={16} className="spin" /> : <Send size={16} />}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
          Shift+Enter for new line
        </div>
      </div>
    </div>
  );
}
