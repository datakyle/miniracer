// One day = one track. Everything here is a pure function of the date key, so
// every player gets the same track and the same starter ghost with no server.

import { generateGeometry } from './track.js';
import { bestBotLap, rookieLap } from './bot.js';
import { timeMs } from './sim.js';

// Puzzle #1 is the launch day.
export const EPOCH = '2026-10-10';
// The starter ghost's name. Below average on purpose: most players beat
// them within a few tries.
export const ROOKIE_NAME = 'Danger Darrell';

export function dateKeyFromDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isDateKey(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

export function dayNumber(dateKey) {
  const a = Date.parse(`${EPOCH}T00:00:00Z`);
  const b = Date.parse(`${dateKey}T00:00:00Z`);
  return Math.round((b - a) / 86400000) + 1;
}

const cache = new Map();

export function buildDay(dateKey) {
  if (cache.has(dateKey)) return cache.get(dateKey);
  for (let attempt = 0; attempt < 200; attempt++) {
    const track = generateGeometry(dateKey, attempt);
    if (!track) continue;
    const bot = bestBotLap(track);
    if (!bot || bot.time > 11) continue;
    const rookie = rookieLap(track, bot.time);
    if (!rookie) continue;
    const day = {
      dateKey,
      number: dayNumber(dateKey),
      track,
      attempt,
      // strong lap: drives the menu demo; not shown as a target
      bot: { ms: timeMs(bot.time), inputs: bot.inputs },
      rookie: { name: ROOKIE_NAME, ms: timeMs(rookie.time), inputs: rookie.inputs },
    };
    cache.set(dateKey, day);
    return day;
  }
  throw new Error(`no valid track for ${dateKey}`);
}
