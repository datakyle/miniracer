// Car simulation. Fixed timestep, one input per step: -1 (left), 0, +1 (right).
// Throttle is automatic; the only skill is when and how long to steer.
//
// Handling model (arcade, after the top-down "traction lerp" approach used
// in many 2D racers, e.g. the KidsCanCode Godot car recipe):
//   - steering turns the nose almost instantly; no wind-up, no coasting
//     turn after release
//   - grip steers the velocity toward the nose while keeping its length, so
//     sliding costs very little speed (momentum is kept, not scrubbed away)
//   - steering at speed drops into a low-grip drift: the nose rotates past
//     the direction of travel and the car slides; releasing (or
//     counter-steering) snaps it back to full grip
//   - a drift bleeds a little speed in proportion to the slide, so a clean
//     line is still faster than a wild one
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
  maxSpeed: 34,
  accel: 33,
  // yaw rate (rad/s) at full steer, reached by rampSpeed, trimmed at top speed
  turnRate: 3.4,
  rampSpeed: 7,
  highSpeedTrim: 0.12,
  // how quickly the yaw rate follows the input (per second); high = crisp
  yawResponse: 45,
  // traction: how fast velocity swings toward the nose (per second)
  grip: 11,
  driftGrip: 3.6,
  // drift kicks in when steering above this speed
  driftSpeed: 15,
  // speed lost per second per unit of slide (sin of slip angle) while drifting
  driftScrub: 0.6,
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
    drifting: false,
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

  // yaw: near-instant response, full rate once rolling, slightly calmer at top speed
  const ramp = clamp(speed / T.rampSpeed, 0, 1);
  const targetW = steer * T.turnRate * ramp * (1 - T.highSpeedTrim * sr * sr);
  state.w += (targetW - state.w) * clamp(T.yawResponse * DT, 0, 1);
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

  // slide: sin of the angle between nose and travel (signed: + = travel left of nose)
  const cross = speed > 0.5 ? (hx * state.vy - hy * state.vx) / speed : 0;
  const slip = Math.abs(cross);
  state.slip = slip;

  // drift state: steering at speed. Counter-steering (input against the
  // slide) or letting go hands control back to full grip.
  const counter = steer !== 0 && steer * cross > 0;
  state.drifting = steer !== 0 && !counter && speed > T.driftSpeed;

  // traction: swing velocity toward the nose, keeping its length
  const traction = state.drifting ? T.driftGrip : T.grip;
  const k = clamp(traction * DT, 0, 1);
  let vx = state.vx + (hx * speed - state.vx) * k;
  let vy = state.vy + (hy * speed - state.vy) * k;
  let v = Math.sqrt(vx * vx + vy * vy);
  if (v > 1e-9) {
    // the lerp shortens the vector a touch on a big swing; restore it so
    // grip never acts as a brake
    vx = (vx / v) * speed;
    vy = (vy / v) * speed;
  }

  // auto throttle along the nose, tapering toward top speed
  let newSpeed = speed;
  if (speed < T.maxSpeed) {
    const push = T.accel * (1 - sr * sr) * DT;
    vx += hx * push;
    vy += hy * push;
    newSpeed = Math.sqrt(vx * vx + vy * vy);
  }
  // a drift costs a little speed, more the wider the slide
  if (state.drifting) newSpeed *= 1 - T.driftScrub * slip * DT;
  newSpeed = Math.min(newSpeed, T.maxSpeed);
  v = Math.sqrt(vx * vx + vy * vy);
  if (v > 1e-9) {
    vx = (vx / v) * newSpeed;
    vy = (vy / v) * newSpeed;
  }
  state.vx = vx;
  state.vy = vy;

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
