// Which ghosts exist for a day:
//   - the starter ghost (a below-average driver everyone sees)
//   - your best lap
//   - your crew's uploaded ghosts (from the ghost server, when configured)
//   - anyone whose challenge link you opened
// Friends from links and from the server are merged by name, fastest wins.

import { decodeInputs } from '../core/replay.js';
import { store } from './storage.js';
import { cachedBoard, myPid } from './cloud.js';

// -> [{ name, ms, frames, kind: 'starter' | 'you' | 'friend' }], fastest first
export function listGhosts(day) {
  const out = [{ name: day.rookie.name, ms: day.rookie.ms, frames: day.rookie.inputs, kind: 'starter' }];
  const mine = store.day(day.dateKey);
  if (mine?.best != null && mine.inputs) {
    const frames = safeDecode(mine.inputs);
    if (frames) out.push({ name: store.name || 'you', ms: mine.best, frames, kind: 'you' });
  }

  const friends = new Map();
  const add = (name, ms, frames) => {
    if (!frames || name === day.rookie.name) return;
    const prev = friends.get(name);
    if (!prev || ms < prev.ms) friends.set(name, { name, ms, frames, kind: 'friend' });
  };
  const me = myPid();
  for (const g of cachedBoard(day.dateKey)) {
    if (g.pid !== me) add(g.name, g.ms, g.frames);
  }
  for (const [name, f] of Object.entries(store.friends(day.dateKey))) {
    add(name, f.ms, safeDecode(f.inputs));
  }
  out.push(...friends.values());
  return out.sort((a, b) => a.ms - b.ms);
}

// Up to n friends worth racing: the ones just ahead of your best, so there's
// always someone to catch. With no lap yet, the slowest few.
export function pickRivals(ghosts, myBest, n = 3) {
  const others = ghosts.filter((g) => g.kind === 'friend');
  if (myBest == null) return others.slice(-n);
  const ahead = others.filter((g) => g.ms < myBest);
  const behind = others.filter((g) => g.ms >= myBest);
  const picked = ahead.slice(-n);
  return picked.concat(behind.slice(0, n - picked.length));
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
