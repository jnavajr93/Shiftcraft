import { describe, it, expect } from 'vitest';
import {
  personKey,
  checkExactDuplicate,
  editDistance,
  findNearMatches,
  rosterHealthCheck,
} from '../rosterValidation.js';

function p(name, staffType = 'tech', id = null) {
  return { id: id ?? name, name, staffType: staffType ?? 'tech' };
}

// ─── personKey ────────────────────────────────────────────────────────────────

describe('personKey', () => {
  it('lowercases and trims', () => {
    expect(personKey('  Alice  ')).toBe('alice');
    expect(personKey('GISELLE')).toBe('giselle');
  });
  it('returns empty string for whitespace-only input', () => {
    expect(personKey('   ')).toBe('');
  });
});

// ─── checkExactDuplicate ──────────────────────────────────────────────────────

describe('checkExactDuplicate', () => {
  it('returns null for a brand-new name', () => {
    expect(checkExactDuplicate('Bob', 'tech', [p('Alice')])).toBeNull();
  });

  it('blocks second tech card for the same name', () => {
    expect(checkExactDuplicate('Giselle', 'tech', [p('Giselle', 'tech', 'g1')])).toBe('same-role');
  });

  it('blocks second admin card for the same name', () => {
    expect(checkExactDuplicate('Giselle', 'admin', [p('Giselle', 'admin', 'g1')])).toBe('same-role');
  });

  it('allows adding an admin card when only a tech card exists (legit linked pair — adding admin)', () => {
    expect(checkExactDuplicate('Hailey', 'admin', [p('Hailey', 'tech', 'h1')])).toBeNull();
  });

  it('allows adding a tech card when only an admin card exists (legit linked pair — adding tech)', () => {
    expect(checkExactDuplicate('Katina', 'tech', [p('Katina', 'admin', 'k1')])).toBeNull();
  });

  it('blocks a third card when both tech and admin already exist', () => {
    const roster = [p('Hailey', 'tech', 'h1'), p('Hailey', 'admin', 'h2')];
    expect(checkExactDuplicate('Hailey', 'tech',  roster)).toBe('third-card');
    expect(checkExactDuplicate('Hailey', 'admin', roster)).toBe('third-card');
  });

  it('excludes selfId so renaming a card to its current name is always valid', () => {
    expect(checkExactDuplicate('Alice', 'tech', [p('Alice', 'tech', 'a1')], 'a1')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(checkExactDuplicate('GISELLE', 'tech', [p('giselle', 'tech', 'g1')])).toBe('same-role');
  });

  it('treats null staffType as tech', () => {
    // null staffType = tech per the model
    expect(checkExactDuplicate('Alice', 'tech', [{ id: 'a1', name: 'Alice', staffType: null }])).toBe('same-role');
  });
});

// ─── editDistance ─────────────────────────────────────────────────────────────

describe('editDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(editDistance('alice', 'alice')).toBe(0);
  });
  it('returns string length when the other is empty', () => {
    expect(editDistance('abc', '')).toBe(3);
    expect(editDistance('', 'abc')).toBe(3);
  });
  it('Katrina vs Katina = 1 insertion', () => {
    expect(editDistance('katrina', 'katina')).toBe(1);
  });
  it('Marisella vs Marisela = 1 insertion', () => {
    expect(editDistance('marisella', 'marisela')).toBe(1);
  });
  it('completely different short strings have large distance', () => {
    expect(editDistance('abc', 'xyz')).toBe(3);
  });
});

// ─── findNearMatches ──────────────────────────────────────────────────────────

describe('findNearMatches', () => {
  it('returns empty for a clearly distinct name', () => {
    expect(findNearMatches('Charlie', [p('Alice'), p('Bob')])).toHaveLength(0);
  });

  it('finds near-match for 1-char transposition (Katrina → Katina)', () => {
    const matches = findNearMatches('Katrina', [p('Katina', 'tech', 'k1')]);
    expect(matches).toHaveLength(1);
    expect(matches[0].person.name).toBe('Katina');
  });

  it('finds near-match for 1-char insertion (Marisella → Marisela)', () => {
    const matches = findNearMatches('Marisella', [p('Marisela', 'tech', 'm1')]);
    expect(matches).toHaveLength(1);
  });

  it('does NOT return a near-match for exact personKey (handled by checkExactDuplicate)', () => {
    // "alice" === "alice" after normalisation — exact match, not a near-match
    const matches = findNearMatches('Alice', [p('Alice', 'admin', 'a1')]);
    expect(matches).toHaveLength(0);
  });

  it('trailing/leading whitespace collapses to exact personKey and is not a near-match', () => {
    // "Marisela " trims to "marisela" = exact match → not returned by findNearMatches
    const matches = findNearMatches('Marisela ', [p('Marisela', 'tech', 'm1')]);
    expect(matches).toHaveLength(0);
  });

  it('excludes selfId from results', () => {
    const matches = findNearMatches('Alice', [p('Alice', 'tech', 'a1')], 'a1');
    expect(matches).toHaveLength(0);
  });

  it('deduplicates near-match results by personKey (two cards same near name → one result)', () => {
    const roster = [p('Katina', 'tech', 'k1'), p('Katina', 'admin', 'k2')];
    const matches = findNearMatches('Katrina', roster);
    expect(matches).toHaveLength(1); // both cards share personKey 'katina' → reported once
  });

  it('does not flag names that differ by 3+ chars', () => {
    const matches = findNearMatches('Christopher', [p('Stephanie', 'tech', 's1')]);
    expect(matches).toHaveLength(0);
  });
});

// ─── rosterHealthCheck ────────────────────────────────────────────────────────

describe('rosterHealthCheck', () => {
  it('returns no issues for a clean single-role roster', () => {
    expect(rosterHealthCheck([p('Alice', 'tech', 'a1'), p('Bob', 'tech', 'b1')])).toHaveLength(0);
  });

  it('returns no issues for the known-good linked pairs (Hailey + Katina)', () => {
    const roster = [
      p('Hailey', 'tech',  'h1'), p('Hailey', 'admin', 'h2'),
      p('Katina', 'tech',  'k1'), p('Katina', 'admin', 'k2'),
    ];
    expect(rosterHealthCheck(roster)).toHaveLength(0);
  });

  it('flags two tech cards for the same name (excess-cards)', () => {
    const issues = rosterHealthCheck([p('Giselle', 'tech', 'g1'), p('Giselle', 'tech', 'g2')]);
    expect(issues.some(i => i.type === 'excess-cards')).toBe(true);
  });

  it('flags two admin cards for the same name (excess-cards)', () => {
    const issues = rosterHealthCheck([p('Giselle', 'admin', 'g1'), p('Giselle', 'admin', 'g2')]);
    expect(issues.some(i => i.type === 'excess-cards')).toBe(true);
  });

  it('flags near-duplicate names (Katrina vs Katina — seeded bad case)', () => {
    const issues = rosterHealthCheck([p('Katina', 'tech', 'k1'), p('Katrina', 'tech', 'k2')]);
    expect(issues.some(i => i.type === 'near-duplicate')).toBe(true);
  });

  it('does NOT flag dissimilar names as near-duplicates', () => {
    const issues = rosterHealthCheck([
      p('Alice', 'tech', 'a1'), p('Bob', 'tech', 'b1'), p('Charlie', 'tech', 'c1'),
    ]);
    expect(issues).toHaveLength(0);
  });

  it('near-duplicate message names both parties', () => {
    const issues = rosterHealthCheck([p('Katina', 'tech', 'k1'), p('Katrina', 'tech', 'k2')]);
    const nd = issues.find(i => i.type === 'near-duplicate');
    expect(nd.message).toMatch(/Katina/);
    expect(nd.message).toMatch(/Katrina/);
  });

  it('excess-cards issue includes the offending people array', () => {
    const g1 = p('Giselle', 'tech', 'g1');
    const g2 = p('Giselle', 'tech', 'g2');
    const issues = rosterHealthCheck([g1, g2]);
    const ec = issues.find(i => i.type === 'excess-cards');
    expect(ec.people).toContain(g1);
    expect(ec.people).toContain(g2);
  });
});
