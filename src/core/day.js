// One day = one track. Everything here is a pure function of the date key, so
// every player gets the same track and the same medal times with no server.

import { generateGeometry } from './track.js';
import { bestBotLap } from './bot.js';
import { timeMs } from './sim.js';

// Puzzle #1 is the launch day.
export const EPOCH = '2026-10-10';
const MEDAL_FACTORS = { gold: 0.985, silver: 1.06, bronze: 1.16 };

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
    if (!bot || bot.time > 32) continue;
    const botMs = timeMs(bot.time);
    const day = {
      dateKey,
      number: dayNumber(dateKey),
      track,
      attempt,
      bot: { ms: botMs, inputs: bot.inputs },
      medals: {
        gold: Math.round(botMs * MEDAL_FACTORS.gold),
        silver: Math.round(botMs * MEDAL_FACTORS.silver),
        bronze: Math.round(botMs * MEDAL_FACTORS.bronze),
      },
    };
    cache.set(dateKey, day);
    return day;
  }
  throw new Error(`no valid track for ${dateKey}`);
}

export function medalFor(day, ms) {
  if (ms == null) return null;
  if (ms <= day.medals.gold) return 'gold';
  if (ms <= day.medals.silver) return 'silver';
  if (ms <= day.medals.bronze) return 'bronze';
  return null;
}
