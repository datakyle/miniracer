// Car simulation. Fixed timestep, one input per step: -1 (left), 0, +1 (right).
// Throttle is automatic; the only skill is when and how long to steer.
//
// Handling model (arcade, not a tyre model):
//   - steering sets a target yaw rate, reduced at high speed
//   - velocity is split into forward and sideways parts relative to the nose
//   - grip bleeds the sideways part away each step; while steering the grip
//     is a touch lower, so the rear steps out and the car drifts
//   - sideways speed that grip removes is speed lost, so long hard turns are
//     slow: the line matters more than reflexes
//   - walls stop the car's motion into them and scrub speed, but never end
//     the run
//
// Only exact float operations are used (see dmath.js), so a list of inputs
// always reproduces the same lap on any device.

import { dsin, dcos, clamp } from './dmath.js';

export const HZ = 120;
export const DT = 1 / HZ;
export const MAX_FRAMES = HZ * 120;

export const TUNING = Object.freeze({
  maxSpeed: 31,
  accel: 30,
  turnRate: 3.9,
  highSpeedTrim: 0.34,
  yawResponse: 18,
  yawRelax: 7,
  grip: 3.2,
  gripAtSpeed: 1.4,
  steerGrip: 0.82,
  carRadius: 0.8,
  wallScrub: 0.55,
  wallBounce: 0.25,
});

export function createSim(track) {
  return {
    track,
    frame: 0,
    x: track.start.x,
    y: track.start.y,
    hx: track.start.dx,
    hy: track.start.dy,
    vx: 0,
    vy: 0,
    w: 0,
    seg: track.startIdx,
    offset: 0,
    nextCp: 0,
    finished: false,
    finishTime: 0,
    slip: 0,
    wallHit: 0,
    lastS: -1,
  };
}

// nearest road segment around the current one; returns lateral offset
function locate(state) {
  const t = state.track;
  const n = t.n;
  let bestD = Infinity;
  let bestSeg = state.seg;
  let bestOff = 0;
  for (let k = -6; k <= 6; k++) {
    const i = (state.seg + k + n) % n;
    const ax = t.xs[i];
    const ay = t.ys[i];
    const dx = state.x - ax;
    const dy = state.y - ay;
    let u = dx * t.sx[i] + dy * t.sy[i];
    u = clamp(u, 0, t.sl[i]);
    const px = ax + t.sx[i] * u;
    const py = ay + t.sy[i] * u;
    const ex = state.x - px;
    const ey = state.y - py;
    const d = ex * ex + ey * ey;
    if (d < bestD) {
      bestD = d;
      bestSeg = i;
      // signed: positive to the left of travel
      bestOff = t.sx[i] * dy - t.sy[i] * dx;
    }
  }
  state.seg = bestSeg;
  state.offset = bestOff;
}

export function step(state, input) {
  if (state.finished) return;
  const T = TUNING;
  const t = state.track;
  const steer = input;

  let speed = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
  const sr = clamp(speed / T.maxSpeed, 0, 1);

  // yaw
  const targetW = steer * T.turnRate * (1 - T.highSpeedTrim * sr * sr);
  state.w += (targetW - state.w) * clamp(T.yawResponse * DT, 0, 1);
  if (steer === 0) state.w *= 1 - T.yawRelax * DT;
  const a = state.w * DT;
  const c = dcos(a);
  const s = dsin(a);
  let hx = state.hx * c - state.hy * s;
  let hy = state.hx * s + state.hy * c;
  const hl = Math.sqrt(hx * hx + hy * hy);
  hx /= hl;
  hy /= hl;
  state.hx = hx;
  state.hy = hy;

  // split velocity into body frame
  const sxv = -hy;
  const syv = hx;
  let fwd = state.vx * hx + state.vy * hy;
  let lat = state.vx * sxv + state.vy * syv;

  const slip = speed > 0.5 ? Math.abs(lat) / speed : 0;
  state.slip = slip;

  // auto throttle, tapering toward top speed; no extra push while sliding hard
  if (speed < T.maxSpeed) {
    const drive = T.accel * (1 - sr * sr) * (1 - clamp(slip * 2.5, 0, 0.85));
    fwd += drive * DT;
  }
  if (fwd < 0) fwd = Math.min(0, fwd + 20 * DT);

  const grip = (T.grip + T.gripAtSpeed * sr * sr) * (steer === 0 ? 1 : T.steerGrip);
  lat *= 1 - clamp(grip * DT, 0, 1);

  state.vx = hx * fwd + sxv * lat;
  state.vy = hy * fwd + syv * lat;

  speed = Math.sqrt(state.vx * state.vx + state.vy * state.vy);
  if (speed > T.maxSpeed) {
    const k = T.maxSpeed / speed;
    state.vx *= k;
    state.vy *= k;
  }

  const px = state.x;
  const py = state.y;
  state.x += state.vx * DT;
  state.y += state.vy * DT;

  // walls
  locate(state);
  state.wallHit = 0;
  const limit = t.halfWidth - T.carRadius;
  if (state.offset > limit || state.offset < -limit) {
    const side = state.offset > 0 ? 1 : -1;
    const i = state.seg;
    // outward normal (left of travel is +offset)
    const nx = -t.sy[i] * side;
    const ny = t.sx[i] * side;
    const push = Math.abs(state.offset) - limit;
    state.x -= nx * push;
    state.y -= ny * push;
    const vn = state.vx * nx + state.vy * ny;
    if (vn > 0) {
      const tvx = state.vx - nx * vn;
      const tvy = state.vy - ny * vn;
      const severity = clamp(vn / 12, 0, 1);
      const keep = 1 - T.wallScrub * severity;
      state.vx = tvx * keep - nx * vn * T.wallBounce;
      state.vy = tvy * keep - ny * vn * T.wallBounce;
      state.w *= 0.5;
      state.wallHit = vn;
    }
    state.offset = side * limit;
  }

  state.frame++;

  // checkpoints: the tracked segment index cannot skip ahead, so reaching the
  // window just past each checkpoint means the car drove there
  const n = t.n;
  if (state.nextCp < t.checkpoints.length) {
    const cp = t.checkpoints[state.nextCp];
    const ahead = (state.seg - cp + n) % n;
    if (ahead < 12) state.nextCp++;
  }

  // finish line: plane through point 0 facing along segment 0
  const sNow = (state.x - t.finish.x) * t.finish.dx + (state.y - t.finish.y) * t.finish.dy;
  const sPrev = (px - t.finish.x) * t.finish.dx + (py - t.finish.y) * t.finish.dy;
  const nearLine = state.seg < 10 || state.seg > n - 10;
  if (state.nextCp >= t.checkpoints.length && nearLine && sPrev < 0 && sNow >= 0) {
    const frac = sPrev / (sPrev - sNow);
    state.finished = true;
    state.finishTime = (state.frame - 1 + frac) * DT;
  }
}

export function timeMs(seconds) {
  return Math.round(seconds * 1000);
}

// Run a full input list (array of -1/0/1, one per frame). Used to verify
// shared times and to compute the bot's lap.
export function runInputs(track, inputs, onFrame) {
  const st = createSim(track);
  for (let f = 0; f < inputs.length && !st.finished; f++) {
    step(st, inputs[f]);
    if (onFrame) onFrame(st);
  }
  return st;
}
