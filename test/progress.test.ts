import { describe, expect, it } from 'vitest';
import {
  computeProgress,
  localDate,
  ProgressSnapshot,
  progressToCsv,
  progressToJson,
  updateHistory,
} from '../src/core/progress';

const h = (...entries: [string, number][]): ProgressSnapshot[] =>
  entries.map(([date, words]) => ({ date, words }));

describe('localDate', () => {
  it('formats as YYYY-MM-DD with zero padding', () => {
    expect(localDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(localDate(new Date(2026, 11, 25))).toBe('2026-12-25');
  });
});

describe('updateHistory', () => {
  it('appends a new day', () => {
    const out = updateHistory(h(['2026-07-07', 100]), '2026-07-08', 150);
    expect(out).toEqual(h(['2026-07-07', 100], ['2026-07-08', 150]));
  });

  it('updates the same day in place', () => {
    const out = updateHistory(h(['2026-07-08', 100]), '2026-07-08', 130);
    expect(out).toEqual(h(['2026-07-08', 130]));
  });

  it('returns the same reference when nothing changed', () => {
    const history = h(['2026-07-08', 100]);
    expect(updateHistory(history, '2026-07-08', 100)).toBe(history);
  });

  it('starts empty histories', () => {
    expect(updateHistory([], '2026-07-08', 42)).toEqual(h(['2026-07-08', 42]));
  });
});

describe('computeProgress', () => {
  it('computes today and session deltas against the previous day', () => {
    const history = h(['2026-07-06', 1000], ['2026-07-07', 1400], ['2026-07-08', 1900]);
    const info = computeProgress(history, '2026-07-08', 1500, 1000);
    expect(info.todayDelta).toBe(500); // vs yesterday's 1400
    expect(info.sessionDelta).toBe(400); // vs session start 1500
    expect(info.totalWords).toBe(1900);
    expect(info.goal).toBe(1000);
  });

  it('reports zero delta on the first day ever', () => {
    const info = computeProgress(h(['2026-07-08', 500]), '2026-07-08', 500, 0);
    expect(info.todayDelta).toBe(0);
    expect(info.sessionDelta).toBe(0);
  });

  it('handles negative deltas (deleted words)', () => {
    const history = h(['2026-07-07', 1000], ['2026-07-08', 900]);
    const info = computeProgress(history, '2026-07-08', 950, 0);
    expect(info.todayDelta).toBe(-100);
    expect(info.sessionDelta).toBe(-50);
  });

  it('lists recent days newest first with per-day deltas', () => {
    const history = h(
      ['2026-07-05', 100],
      ['2026-07-06', 300],
      ['2026-07-07', 250],
      ['2026-07-08', 600]
    );
    const info = computeProgress(history, '2026-07-08', 600, 0);
    expect(info.recent).toEqual([
      { date: '2026-07-08', words: 600, delta: 350 },
      { date: '2026-07-07', words: 250, delta: -50 },
      { date: '2026-07-06', words: 300, delta: 200 },
    ]);
  });
});

describe('export formats', () => {
  const history = h(['2026-07-07', 100], ['2026-07-08', 250]);

  it('emits CSV with per-day deltas', () => {
    expect(progressToCsv(history)).toBe(
      'date,words,delta\n2026-07-07,100,0\n2026-07-08,250,150\n'
    );
  });

  it('emits JSON with per-day deltas', () => {
    expect(JSON.parse(progressToJson(history))).toEqual([
      { date: '2026-07-07', words: 100, delta: 0 },
      { date: '2026-07-08', words: 250, delta: 150 },
    ]);
  });
});
