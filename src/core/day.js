// One day = one track. Everything here is a pure function of the date key, so
// every player gets the same track and the same starter ghost with no server.

import { generateGeometry } from './track.js';
import { bestBotLap, rookieLap } from './bot.js';
import { timeMs } from './sim.js';
import { SCHEDULE_START, SCHEDULE_ATTEMPTS } from './schedule.js';

// Puzzle #1 is the launch day.
export const EPOCH = '2026-10-10';
// The starter ghost's name. Below average on purpose: most players beat
// them within a few tries.
export const ROOKIE_NAME = 'danger darrell';
// Everyone gets a new track at midnight US Central time, wherever they are,
// so friends always race the same track and their ghosts line up.
export const TIME_ZONE = 'America/Chicago';

const keyFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

// 'YYYY-MM-DD' for the given instant, in Central time
export function dateKeyAt(ms = Date.now()) {
  const parts = Object.fromEntries(keyFormat.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// milliseconds until the next Central-time midnight (DST-safe to the minute)
export function msUntilNextDay(now = Date.now()) {
  const today = dateKeyAt(now);
  let lo = now;
  let hi = now + 26 * 3600000;
  while (hi - lo > 30000) {
    const mid = lo + (hi - lo) / 2;
    if (dateKeyAt(mid) === today) lo = mid;
    else hi = mid;
  }
  return hi - now;
}

export function addDays(dateKey, n) {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

export function isDateKey(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

export function dayNumber(dateKey) {
  const a = Date.parse(`${EPOCH}T00:00:00Z`);
  const b = Date.parse(`${dateKey}T00:00:00Z`);
  return Math.round((b - a) / 86400000) + 1;
}

// The first attempt whose track passes every check (shape, the bot can drive
// it in time, the rookie finishes). Expensive: runs dozens of bot laps.
export function searchDay(dateKey) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const track = generateGeometry(dateKey, attempt);
    if (!track) continue;
    const bot = bestBotLap(track);
    if (!bot || bot.time > 11) continue;
    const rookie = rookieLap(track, bot.time);
    if (!rookie) continue;
    return { attempt, track, bot, rookie };
  }
  throw new Error(`no valid track for ${dateKey}`);
}

// Precomputed answers to searchDay (see scripts/gen-schedule.mjs), so the
// server can rebuild a day's track in a millisecond or two.
export function scheduledAttempt(dateKey) {
  const i = Math.round((Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${SCHEDULE_START}T00:00:00Z`)) / 86400000);
  if (i < 0 || i >= SCHEDULE_ATTEMPTS.length) return null;
  return SCHEDULE_ATTEMPTS[i];
}

// Just the track geometry for a day. Cheap when the day is in the schedule.
export function trackFor(dateKey) {
  const attempt = scheduledAttempt(dateKey);
  if (attempt == null) return searchDay(dateKey).track;
  return generateGeometry(dateKey, attempt);
}

const cache = new Map();

export function buildDay(dateKey) {
  if (cache.has(dateKey)) return cache.get(dateKey);
  let found;
  const attempt = scheduledAttempt(dateKey);
  if (attempt == null) {
    found = searchDay(dateKey);
  } else {
    const track = generateGeometry(dateKey, attempt);
    const bot = bestBotLap(track);
    found = { attempt, track, bot, rookie: rookieLap(track, bot.time) };
  }
  const day = {
    dateKey,
    number: dayNumber(dateKey),
    track: found.track,
    attempt: found.attempt,
    // strong lap: drives the menu demo; not shown as a target
    bot: { ms: timeMs(found.bot.time), inputs: found.bot.inputs },
    rookie: { name: ROOKIE_NAME, ms: timeMs(found.rookie.time), inputs: found.rookie.inputs },
  };
  cache.set(dateKey, day);
  return day;
}
