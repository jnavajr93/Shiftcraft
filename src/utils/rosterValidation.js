/**
 * Roster identity validation utilities.
 *
 * Identity model: personKey = name.trim().toLowerCase().
 * Allowed pairing: one tech card + one admin card per personKey (Hailey, Katina).
 * Blocked: two cards of the same role under the same personKey (accidental merge).
 * Blocked: a third card for any personKey (beyond one tech + one admin).
 */

/** Canonical identity key for a name. */
export const personKey = name => (name ?? '').trim().toLowerCase();

/**
 * Check whether adding/renaming a card would violate cardinality rules.
 *
 * @param {string}      name           — proposed name (will be trimmed)
 * @param {string}      staffType      — 'tech' | 'admin'
 * @param {Array}       existingPeople — full people roster
 * @param {string|null} selfId         — id of the card being renamed (excluded from check)
 * @returns {'third-card' | 'same-role' | null}
 */
export function checkExactDuplicate(name, staffType, existingPeople, selfId = null) {
  const key = personKey(name);
  if (!key) return null;

  const others = existingPeople.filter(
    p => p.id !== selfId && personKey(p.name) === key,
  );
  if (others.length === 0) return null;

  const role      = (staffType ?? 'tech') !== 'admin' ? 'tech' : 'admin';
  const hasTech   = others.some(p => (p.staffType ?? 'tech') !== 'admin');
  const hasAdmin  = others.some(p => p.staffType === 'admin');

  // Both slots occupied — adding any new card creates a third
  if (hasTech && hasAdmin) return 'third-card';
  // Same role already present
  if (role === 'tech'  && hasTech)  return 'same-role';
  if (role === 'admin' && hasAdmin) return 'same-role';
  return null;
}

/**
 * Levenshtein edit distance between two strings.
 */
export function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // Use two alternating rows to keep memory O(n)
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    prev = curr;
  }
  return prev[n];
}

/**
 * Find existing people whose personKeys are near (but not equal to) the proposed name's key.
 * "Near" means edit distance ≤ 2 on the normalised keys.
 * Returns one entry per distinct near personKey (using the first matching card found).
 * Excludes selfId and exact-key matches (those are handled by checkExactDuplicate).
 *
 * @param {string}      name
 * @param {Array}       existingPeople
 * @param {string|null} selfId
 * @returns Array<{ person: Object, reason: 'edit-distance' }>
 */
export function findNearMatches(name, existingPeople, selfId = null) {
  const key = personKey(name);
  if (!key) return [];

  const seenKeys = new Set();
  const results  = [];

  for (const p of existingPeople) {
    if (p.id === selfId) continue;
    const pKey = personKey(p.name);
    if (pKey === key)          continue; // exact — handled elsewhere
    if (seenKeys.has(pKey))    continue; // already reported this personKey
    seenKeys.add(pKey);

    if (editDistance(key, pKey) <= 2) {
      results.push({ person: p, reason: 'edit-distance' });
    }
  }

  return results;
}

/**
 * Roster health check — returns a list of potential identity issues without mutating anything.
 *
 * Issue types:
 *   'excess-cards'   — a personKey has >1 tech card or >1 admin card
 *   'near-duplicate' — two distinct personKeys with edit distance ≤ 2
 *
 * A legitimate linked pair (exactly one tech + one admin) is NOT flagged.
 *
 * @param {Array} people
 * @returns Array<{ type: string, message: string, keys: string[], people: Object[] }>
 */
export function rosterHealthCheck(people) {
  const issues = [];

  // ── Group cards by personKey ──
  const byKey = new Map();
  for (const p of people) {
    const key = personKey(p.name);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(p);
  }

  // ── Per-key cardinality check ──
  for (const [, cards] of byKey) {
    const techCards  = cards.filter(p => (p.staffType ?? 'tech') !== 'admin');
    const adminCards = cards.filter(p => p.staffType === 'admin');
    if (techCards.length > 1) {
      issues.push({
        type: 'excess-cards',
        message: `"${cards[0].name}" has ${techCards.length} tech cards — only one is allowed`,
        keys: [personKey(cards[0].name)],
        people: techCards,
      });
    }
    if (adminCards.length > 1) {
      issues.push({
        type: 'excess-cards',
        message: `"${cards[0].name}" has ${adminCards.length} admin cards — only one is allowed`,
        keys: [personKey(cards[0].name)],
        people: adminCards,
      });
    }
  }

  // ── Near-duplicate personKey pairs ──
  const keys = [...byKey.keys()];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      if (editDistance(keys[i], keys[j]) <= 2) {
        const nameA = byKey.get(keys[i])[0].name;
        const nameB = byKey.get(keys[j])[0].name;
        issues.push({
          type: 'near-duplicate',
          message: `"${nameA}" and "${nameB}" are very similar — possible accidental split`,
          keys: [keys[i], keys[j]],
          people: [...byKey.get(keys[i]), ...byKey.get(keys[j])],
        });
      }
    }
  }

  return issues;
}
