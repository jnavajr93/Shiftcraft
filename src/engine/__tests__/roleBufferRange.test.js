/**
 * Drift-guard tests for roleBufferRange — the single source of truth for
 * role time-range buffers shared by seed.js (UI conflict detection) and
 * solver.js (generation conflict detection).
 *
 * If these tests fail, the buffer constants have changed in seed.js without
 * updating this file, or solver.js has diverged back to a local copy.
 */

import { describe, it, expect } from 'vitest';
import { roleBufferRange } from '../../data/seed.js';

// Base times used throughout: 8:00 AM start (480), 5:00 PM end (1020)
const S = 480;
const E = 1020;

describe('roleBufferRange — single source of truth drift guard', () => {
  it('scribe: no start buffer, +75 min end', () => {
    expect(roleBufferRange('scribe', S, E)).toEqual({ start: 480, end: 1095 });
  });

  it('closing: start clamped to 9:00 AM (540) when base start is earlier, +75 end', () => {
    // base start (420) < 540 → clamped
    expect(roleBufferRange('closing', 420, E)).toEqual({ start: 540, end: 1095 });
    // base start (600) > 540 → not clamped
    expect(roleBufferRange('closing', 600, E)).toEqual({ start: 600, end: 1095 });
  });

  it('opener: -15 min start, +60 min end', () => {
    expect(roleBufferRange('opener', S, E)).toEqual({ start: 465, end: 1080 });
  });

  it('openingFrontDesk: -30 min start, end capped at 930 (3:30 PM) regardless of clinic end', () => {
    expect(roleBufferRange('openingFrontDesk', S, E)).toEqual({ start: 450, end: 930 });
    // end cap is fixed — late-ending clinic does not extend it
    expect(roleBufferRange('openingFrontDesk', S, 1200)).toEqual({ start: 450, end: 930 });
  });

  it('closingFrontDesk: start fixed at 630 (10:30 AM) regardless of clinic start, +90 end', () => {
    expect(roleBufferRange('closingFrontDesk', S, E)).toEqual({ start: 630, end: 1110 });
    expect(roleBufferRange('closingFrontDesk', 300, E)).toEqual({ start: 630, end: 1110 });
  });

  it('frontDesk: -30 min start, +90 min end', () => {
    expect(roleBufferRange('frontDesk', S, E)).toEqual({ start: 450, end: 1110 });
  });

  it('OBS roles — Dr. R provider: -60 start, +120 end', () => {
    for (const slot of ['preop', 'preop2', 'sterile', 'circulator', 'scrub']) {
      expect(roleBufferRange(slot, S, E, 'Dr. R')).toEqual({ start: 420, end: 1140 });
      // Partial match (e.g. "Dr. Richards") must also match
      expect(roleBufferRange(slot, S, E, 'Dr. R2')).toEqual({ start: 420, end: 1140 });
    }
  });

  it('OBS roles — Dr. A provider: -60 start, +60 end', () => {
    for (const slot of ['preop', 'preop2', 'sterile', 'circulator', 'scrub']) {
      expect(roleBufferRange(slot, S, E, 'Dr. A')).toEqual({ start: 420, end: 1080 });
    }
  });

  it('OBS roles — other or blank provider: no buffer (zero — surfaces as warning)', () => {
    expect(roleBufferRange('preop', S, E, 'Dr. X')).toEqual({ start: 480, end: 1020 });
    expect(roleBufferRange('scrub', S, E, '')).toEqual({ start: 480, end: 1020 });
    expect(roleBufferRange('circulator', S, E)).toEqual({ start: 480, end: 1020 });
  });

  it('unknown role: passthrough — no buffer applied', () => {
    expect(roleBufferRange('someUnknownRole', S, E)).toEqual({ start: 480, end: 1020 });
    expect(roleBufferRange('', S, E)).toEqual({ start: 480, end: 1020 });
  });
});
