/**
 * Pattern computation for schedule learning from history.
 *
 * History entry shape:
 *   { personName, day, location, slotType, weekStr, source, managerInitials, createdAt }
 *
 * source weights:
 *   'generated'   → 1  (solver placed them here)
 *   'manual-edit' → 3  (manager replaced the generated choice — high signal)
 *   'manual-add'  → 3  (manager added someone manually — high signal)
 *
 * Pattern key: `${personName}:${day}:${location}:${slotType}` — all lowercase,
 * location uses _ for spaces (matches toLocationId() in adapter.js).
 */

const SOURCE_WEIGHT = {
  'generated':   1,
  'manual-edit': 3,
  'manual-add':  3,
};

/** Canonical pattern key — normalized the same way as toLocationId in adapter.js. */
export function patternKey(personName, day, location, slotType) {
  const loc = (location ?? '').toLowerCase().replace(/\s+/g, '_');
  return `${(personName ?? '').trim().toLowerCase()}:${(day ?? '').toLowerCase()}:${loc}:${(slotType ?? '').toLowerCase()}`;
}

/**
 * Computes a Map<patternKey, score> from history for solver soft-scoring.
 * Call once before generateSchedule and pass the result as options.historyScores.
 */
export function computeHistoryScores(history) {
  const scores = new Map();
  for (const entry of (history ?? [])) {
    if (!entry.personName || !entry.day || !entry.location || !entry.slotType) continue;
    const key = patternKey(entry.personName, entry.day, entry.location, entry.slotType);
    const w = SOURCE_WEIGHT[entry.source] ?? 1;
    scores.set(key, (scores.get(key) ?? 0) + w);
  }
  return scores;
}

/**
 * Computes human-readable patterns for the Patterns UI.
 * Filters noise (score < 2) and marks dismissed entries.
 * Returns array sorted by score descending.
 */
export function computePatterns(history, dismissedKeys) {
  const dismissed = new Set(dismissedKeys ?? []);
  const scoreMap  = new Map();
  const weekSets  = new Map();
  const lastSeen  = new Map();
  const metaMap   = new Map(); // key → { personName, day, location, slotType }

  for (const entry of (history ?? [])) {
    if (!entry.personName || !entry.day || !entry.location || !entry.slotType) continue;
    const key = patternKey(entry.personName, entry.day, entry.location, entry.slotType);
    const w = SOURCE_WEIGHT[entry.source] ?? 1;
    scoreMap.set(key, (scoreMap.get(key) ?? 0) + w);
    if (!weekSets.has(key)) weekSets.set(key, new Set());
    weekSets.get(key).add(entry.weekStr);
    if (!lastSeen.has(key) || entry.weekStr > lastSeen.get(key)) {
      lastSeen.set(key, entry.weekStr);
    }
    if (!metaMap.has(key)) {
      metaMap.set(key, {
        personName: entry.personName,
        day:        entry.day,
        location:   entry.location,
        slotType:   entry.slotType,
      });
    }
  }

  const patterns = [];
  for (const [key, score] of scoreMap.entries()) {
    if (score < 2) continue; // noise threshold
    const meta = metaMap.get(key);
    patterns.push({
      key,
      personName:  meta.personName,
      day:         meta.day,
      location:    meta.location,
      slotType:    meta.slotType,
      score,
      weekCount:   weekSets.get(key)?.size ?? 0,
      lastWeekStr: lastSeen.get(key) ?? '',
      dismissed:   dismissed.has(key),
    });
  }

  return patterns.sort((a, b) => b.score - a.score || b.weekCount - a.weekCount);
}

const SLOT_LABEL = {
  scribe:            'Scribe',
  opener:            'Opener',
  closing:           'Closing',
  middle:            'Middle',
  training:          'Training',
  frontDesk:         'Front Desk',
  openingFrontDesk:  'Opening FD',
  closingFrontDesk:  'Closing FD',
  preop:             'Pre-Op/PACU',
  sterile:           'Sterile',
  circulator:        'Circulator',
  scrub:             'Scrub',
};

/**
 * Returns a compact plain-English summary of the top active patterns.
 * Included in the AI chat system prompt as extra context.
 */
export function buildPatternSummary(patterns) {
  const active = (patterns ?? []).filter(p => !p.dismissed).slice(0, 15);
  if (!active.length) return '';
  const lines = active.map(p => {
    const slot = SLOT_LABEL[p.slotType] ?? p.slotType;
    return `- ${p.personName} → ${slot} @ ${p.location} on ${p.day} (${p.weekCount} weeks, score ${p.score})`;
  });
  return `## Historical placement patterns\n${lines.join('\n')}`;
}
