import { describe, it, expect } from 'vitest';
import { buildDay, dayNumber } from '../src/core/day.js';
import { runInputs, timeMs, createSim, step } from '../src/core/sim.js';
import { encodeInputs, decodeInputs } from '../src/core/replay.js';
import { dsin, dcos } from '../src/core/dmath.js';

const keys = Array.from({ length: 120 }, (_, i) =>
  new Date(Date.UTC(2026, 9, 10 + i)).toISOString().slice(0, 10));

describe('deterministic math', () => {
  it('matches Math.sin/cos closely', () => {
    for (let a = -20; a < 20; a += 0.0137) {
      expect(Math.abs(dsin(a) - Math.sin(a))).toBeLessThan(1e-11);
      expect(Math.abs(dcos(a) - Math.cos(a))).toBeLessThan(1e-11);
    }
  });
});

describe('daily tracks', () => {
  it('same date gives the same track', () => {
    const a = buildDay('2026-10-10');
    const b = buildDay('2026-10-10');
    expect(Array.from(a.track.xs)).toEqual(Array.from(b.track.xs));
    expect(a.rookie.ms).toBe(b.rookie.ms);
  });

  it('every day of the next 4 months builds a short, drivable track', () => {
    const names = new Set();
    for (const k of keys) {
      const day = buildDay(k);
      // a strong lap is ~8-11s, so an average player lands around 10s
      expect(day.bot.ms).toBeGreaterThan(6500);
      expect(day.bot.ms).toBeLessThanOrEqual(11000);
      // the starter ghost is clearly slower than a strong lap
      expect(day.rookie.ms).toBeGreaterThan(day.bot.ms * 1.15);
      expect(day.rookie.ms).toBeLessThan(day.bot.ms * 1.5);
      names.add(day.track.name);
    }
    expect(names.size).toBeGreaterThan(80);
  }, 30000);

  it('numbers days from launch', () => {
    expect(dayNumber('2026-10-10')).toBe(1);
    expect(dayNumber('2026-11-10')).toBe(32);
  });
});

describe('replays', () => {
  it('codec round-trips', () => {
    const inputs = [];
    for (let i = 0; i < 3000; i++) inputs.push([-1, 0, 1][Math.floor(i / 37 + (i % 7 === 0 ? 1 : 0)) % 3]);
    expect(decodeInputs(encodeInputs(inputs))).toEqual(inputs);
  });

  it('a recorded lap re-simulates to the exact same time', () => {
    for (const k of keys.slice(0, 15)) {
      const day = buildDay(k);
      const decoded = decodeInputs(encodeInputs(day.bot.inputs));
      const res = runInputs(day.track, decoded);
      expect(res.finished).toBe(true);
      expect(timeMs(res.finishTime)).toBe(day.bot.ms);
    }
  });

  it('cannot finish without driving the whole lap', () => {
    const day = buildDay('2026-10-10');
    // reverse across the line: never steers, will not pass checkpoints in order
    const st = createSim(day.track);
    for (let i = 0; i < 120 * 60; i++) step(st, 1);
    expect(st.finished).toBe(false);
  });

  it('rejects absurdly long replays', () => {
    const long = encodeInputs(new Array(200000).fill(0));
    expect(() => decodeInputs(long)).toThrow();
  });
});

describe('starter ghost', () => {
  it('replays to its recorded time', () => {
    for (const k of keys.slice(0, 10)) {
      const day = buildDay(k);
      const res = runInputs(day.track, day.rookie.inputs);
      expect(res.finished).toBe(true);
      expect(timeMs(res.finishTime)).toBe(day.rookie.ms);
    }
  });
});
