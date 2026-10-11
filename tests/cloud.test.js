import { describe, it, expect } from 'vitest';
import { searchDay, scheduledAttempt, trackFor, buildDay, dateKeyAt, msUntilNextDay, addDays } from '../src/core/day.js';
import { encodeInputs, decodeInputs } from '../src/core/replay.js';
import { cleanCrew } from '../src/core/names.js';
import { verifyUpload, pidFor } from '../worker/src/handler.js';

describe('schedule', () => {
  it('matches a fresh search (regenerate with scripts/gen-schedule.mjs if this fails)', () => {
    for (const k of ['2026-10-10', '2026-12-25', '2027-02-14', '2027-07-04', '2027-10-31', '2028-02-29', '2028-12-31']) {
      expect(scheduledAttempt(k)).toBe(searchDay(k).attempt);
    }
  }, 60000);

  it('rebuilds the same track the game uses', () => {
    const k = '2026-11-03';
    expect(Array.from(trackFor(k).xs)).toEqual(Array.from(buildDay(k).track.xs));
  });
});

describe('central time day', () => {
  it('rolls over at midnight Central, not UTC', () => {
    // 23:30 CDT on Oct 10 is 04:30 UTC on Oct 11
    expect(dateKeyAt(Date.parse('2026-10-11T04:30:00Z'))).toBe('2026-10-10');
    expect(dateKeyAt(Date.parse('2026-10-11T05:30:00Z'))).toBe('2026-10-11');
  });

  it('counts down across daylight saving changes', () => {
    // 00:30 on the night clocks go back: 23.5 h of wall clock, 24.5 h real
    expect(Math.round(msUntilNextDay(Date.parse('2026-11-01T05:30:00Z')) / 60000)).toBe(24.5 * 60);
    // 00:30 on the night clocks go forward: 22.5 h real
    expect(Math.round(msUntilNextDay(Date.parse('2027-03-14T06:30:00Z')) / 60000)).toBe(22.5 * 60);
  });
});

describe('crew codes', () => {
  it('cleans to lowercase dashes, defaulting to public', () => {
    expect(cleanCrew('Kyles Crew!')).toBe('kyles-crew');
    expect(cleanCrew('')).toBe('public');
    expect(cleanCrew('--A__b--')).toBe('a-b');
  });
});

describe('ghost server checks', () => {
  const now = Date.parse('2026-10-11T18:00:00Z');
  const today = dateKeyAt(now);
  const day = buildDay(today);
  const lap = encodeInputs(day.rookie.inputs);
  const player = 'playerAAAAAAAAAAAAAAAA';

  it('accepts a real lap and times it itself', () => {
    const r = verifyUpload({ date: today, player, name: 'Kyle B', inputs: lap, ms: 1, crew: 'Kyles Crew' }, now);
    expect(r.error).toBeUndefined();
    expect(r.ms).toBe(day.rookie.ms);
    expect(r.name).toBe('kyle b');
    expect(r.crew).toBe('kyles-crew');
    expect(r.pid).toBe(pidFor(player));
  });

  it('trims padding after the finish line', () => {
    const padded = encodeInputs([...day.rookie.inputs, 1, 1, 0, -1]);
    expect(verifyUpload({ date: today, player, inputs: padded }, now).inputs).toBe(lap);
  });

  it('rejects laps that do not finish, bad ids and closed days', () => {
    expect(verifyUpload({ date: today, player, inputs: encodeInputs(day.rookie.inputs.slice(0, 500)) }, now).error).toBe('lap does not finish');
    expect(verifyUpload({ date: today, player: 'short', inputs: lap }, now).error).toBe('bad player id');
    expect(verifyUpload({ date: addDays(today, -2), player, inputs: lap }, now).error).toBe('that day is closed');
    expect(verifyUpload({ date: addDays(today, -1), player, inputs: encodeInputs(buildDay(addDays(today, -1)).rookie.inputs) }, now).error).toBeUndefined();
    expect(verifyUpload({ date: today, player, inputs: 'not base64!' }, now).error).toBe('bad lap');
  });

  it('round-trips the stored ghost', () => {
    const r = verifyUpload({ date: today, player, inputs: lap }, now);
    expect(decodeInputs(r.inputs)).toEqual(day.rookie.inputs.slice(0, decodeInputs(r.inputs).length));
  });
});
