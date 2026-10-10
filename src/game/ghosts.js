// Which ghosts exist for a day. This is the one place to change when ghosts
// start coming from a shared server instead of this browser.
//
// Today a day's ghosts are:
//   - the starter ghost (a below-average driver everyone sees)
//   - your best lap
//   - anyone whose challenge link you opened

import { decodeInputs } from '../core/replay.js';
import { store } from './storage.js';

// -> [{ name, ms, frames, kind: 'starter' | 'you' | 'friend' }], fastest first
export function listGhosts(day) {
  const out = [{ name: day.rookie.name, ms: day.rookie.ms, frames: day.rookie.inputs, kind: 'starter' }];
  const mine = store.day(day.dateKey);
  if (mine?.best != null && mine.inputs) {
    const frames = safeDecode(mine.inputs);
    if (frames) out.push({ name: store.name || 'you', ms: mine.best, frames, kind: 'you' });
  }
  for (const [name, f] of Object.entries(store.friends(day.dateKey))) {
    const frames = safeDecode(f.inputs);
    if (frames) out.push({ name, ms: f.ms, frames, kind: 'friend' });
  }
  return out.sort((a, b) => a.ms - b.ms);
}

// Saves a finished lap. Returns true when it is a new personal best.
export function submitRun(dateKey, ms, encodedInputs) {
  return store.recordRun(dateKey, ms, encodedInputs);
}

function safeDecode(encoded) {
  try {
    return decodeInputs(encoded);
  } catch {
    return null;
  }
}
