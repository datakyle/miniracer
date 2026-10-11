// Talks to the ghost server (worker/). Everything here fails soft: with no
// server configured, or offline, the game keeps working with local ghosts.

import { GHOST_API } from '../config.js';
import { cleanCrew, DEFAULT_CREW } from '../core/names.js';
import { hashString } from '../core/rng.js';
import { decodeInputs } from '../core/replay.js';
import { store } from './storage.js';

// ?api=http://127.0.0.1:8787 points this tab at a local server (for testing)
function apiBase() {
  try {
    const q = new URLSearchParams(location.search).get('api');
    if (q) sessionStorage.setItem('dailylap:api', q);
    return (sessionStorage.getItem('dailylap:api') || GHOST_API).replace(/\/$/, '');
  } catch {
    return GHOST_API.replace(/\/$/, '');
  }
}

const API = apiBase();
export const cloudEnabled = Boolean(API);

// a crew in the page address (from a friend's link) becomes this player's crew
export function initCrew() {
  const q = new URLSearchParams(location.search).get('crew');
  if (q) store.crew = cleanCrew(q);
  return crew();
}

export function crew() {
  return store.crew || DEFAULT_CREW;
}

// must match pidFor in worker/src/handler.js
export function myPid() {
  return hashString(`pid|${store.playerId}`).toString(16);
}

const boards = new Map(); // `${date}|${crew}` -> { at, rows }

// rows already decoded: [{ name, ms, frames, pid }]
export function cachedBoard(dateKey) {
  return boards.get(`${dateKey}|${crew()}`)?.rows ?? [];
}

export async function refreshBoard(dateKey, { maxAgeMs = 15000 } = {}) {
  if (!cloudEnabled) return [];
  const key = `${dateKey}|${crew()}`;
  const hit = boards.get(key);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.rows;
  try {
    const res = await fetch(`${API}/ghosts?date=${dateKey}&crew=${encodeURIComponent(crew())}`);
    if (!res.ok) return hit?.rows ?? [];
    const body = await res.json();
    const rows = [];
    for (const g of body.ghosts || []) {
      try {
        rows.push({ name: g.name, ms: g.ms, pid: g.pid, frames: decodeInputs(g.inputs) });
      } catch {
        // skip a row we can't read
      }
    }
    boards.set(key, { at: Date.now(), rows });
    return rows;
  } catch {
    return hit?.rows ?? [];
  }
}

// -> { best, rank, total } or { error }
export async function uploadBest(dateKey) {
  const mine = store.day(dateKey);
  if (!cloudEnabled || !mine?.best || !mine.inputs) return { error: 'nothing to upload' };
  try {
    const res = await fetch(`${API}/ghosts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        date: dateKey,
        crew: crew(),
        player: store.playerId,
        name: store.name,
        inputs: mine.inputs,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: body.error || `upload failed (${res.status})` };
    store.markUploaded(dateKey, mine.best);
    boards.delete(`${dateKey}|${crew()}`);
    return body;
  } catch {
    return { error: "couldn't reach the ghost server" };
  }
}
