// A simple pursuit driver. It uses the same three inputs a player has, so
// its lap is always achievable. Used to (1) reject undrivable tracks and
// (2) drive the day's starter ghost, a deliberately sloppy "rookie". Only
// exact float ops, so every device gets the same laps.

import { createSim, step, MAX_FRAMES } from './sim.js';

function drive(track, look, dead, inside, delay = 0) {
  const st = createSim(track);
  const inputs = [];
  const decided = [];
  const n = track.n;
  while (!st.finished && st.frame < MAX_FRAMES) {
    const speed = Math.sqrt(st.vx * st.vx + st.vy * st.vy);
    const ahead = look + Math.floor(speed * 0.25);
    const i = (st.seg + ahead) % n;
    // aim slightly toward the inside of the upcoming bend
    const j = (i + 6) % n;
    const bend = track.sx[i] * track.sy[j] - track.sy[i] * track.sx[j];
    const off = bend * inside * track.halfWidth * 4;
    const tx = track.xs[i] - track.sy[i] * off;
    const ty = track.ys[i] + track.sx[i] * off;
    const dx = tx - st.x;
    const dy = ty - st.y;
    const dl = Math.sqrt(dx * dx + dy * dy) || 1;
    const cross = (st.hx * dy - st.hy * dx) / dl;
    decided.push(cross > dead ? 1 : cross < -dead ? -1 : 0);
    // reaction lag: act on what was decided `delay` frames ago
    const input = st.frame >= delay ? decided[st.frame - delay] : 0;
    inputs.push(input);
    step(st, input);
  }
  return { finished: st.finished, time: st.finishTime, inputs };
}

export function bestBotLap(track) {
  let best = null;
  for (const look of [5, 7, 9, 12]) {
    for (const dead of [0.04, 0.1]) {
      for (const inside of [0, 0.5, 1]) {
        const r = drive(track, look, dead, inside);
        if (r.finished && (!best || r.time < best.time)) best = r;
      }
    }
  }
  return best;
}

// The starter ghost: a below-average driver. Reacts late and corrects
// sloppily. Picks the variant whose lap lands closest to `slowdown` times the
// strong bot's lap, so every day's rookie is about equally beatable.
export function rookieLap(track, refTime, slowdown = 1.3) {
  const target = refTime * slowdown;
  let best = null;
  for (const delay of [10, 14, 18, 22, 26, 30]) {
    for (const dead of [0.15, 0.25, 0.35, 0.45]) {
      for (const look of [4, 6, 8]) {
        const r = drive(track, look, dead, 0, delay);
        if (!r.finished) continue;
        if (!best || Math.abs(r.time - target) < Math.abs(best.time - target)) best = r;
      }
    }
  }
  return best;
}
