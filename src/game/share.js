// Challenge links. The whole run travels in the URL fragment:
//   #c=<date>.<ms>.<name>.<inputs>
// The fragment never reaches a server. On open, the receiving browser
// re-simulates the inputs; if the lap reproduces the claimed time it is
// shown as verified.

import { decodeInputs } from '../core/replay.js';
import { buildDay, isDateKey } from '../core/day.js';
import { runInputs, timeMs } from '../core/sim.js';

export function cleanName(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 14);
}

const toUrlName = (n) => n.replace(/ /g, '_');
const fromUrlName = (n) => n.replace(/_/g, ' ');

export function challengeUrl({ dateKey, ms, name, inputs }) {
  const base = `${location.origin}${location.pathname}`;
  const who = toUrlName(cleanName(name) || 'a friend');
  return `${base}#c=${dateKey}.${ms}.${who}.${inputs}`;
}

export function parseChallenge(hash) {
  const m = /^#c=([^.]+)\.(\d+)\.([a-z0-9_-]*)\.([A-Za-z0-9_-]+)$/.exec(hash || '');
  if (!m) return null;
  const [, dateKey, msStr, rawName, inputs] = m;
  if (!isDateKey(dateKey)) return null;
  const name = cleanName(fromUrlName(rawName)) || 'a friend';
  let frames;
  try {
    frames = decodeInputs(inputs);
  } catch {
    return null;
  }
  const day = buildDay(dateKey);
  const result = runInputs(day.track, frames);
  const ms = Number(msStr);
  const replayMs = result.finished ? timeMs(result.finishTime) : null;
  return {
    dateKey,
    name,
    // the replay is the source of truth for the time
    ms: replayMs,
    claimedMs: ms,
    valid: replayMs != null,
    verified: replayMs === ms,
    inputs,
  };
}

export function fmt(ms) {
  if (ms == null) return '--.---';
  const s = Math.floor(ms / 1000);
  const r = String(ms % 1000).padStart(3, '0');
  if (s >= 60) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${r}`;
  return `${s}.${r}`;
}

export function fmtDelta(ms) {
  const sign = ms < 0 ? '-' : '+';
  return `${sign}${fmt(Math.abs(ms))}`;
}

export function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export const MEDAL_EMOJI = { gold: '🥇', silver: '🥈', bronze: '🥉' };

export function shareText({ day, ms, medal }) {
  const line = `${medal ? MEDAL_EMOJI[medal] + ' ' : '🏁 '}${fmt(ms)}`;
  return `Daily lap #${day.number} · ${capitalize(day.track.name)}\n${line}\nRace my ghost:`;
}

export async function shareRun({ text, url }) {
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ text, url });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    return 'copied';
  } catch {
    window.prompt('Copy this link', `${text} ${url}`);
    return 'prompted';
  }
}
