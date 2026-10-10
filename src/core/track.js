// Procedural track generation.
//
// A day's date string seeds the RNG. Control points are scattered around a
// circle (sorted by angle, so the loop can never cross itself), smoothed with
// a centripetal Catmull-Rom spline, then resampled at a fixed spacing. The
// result is checked for tight corners and for parts of the road passing too
// close to each other; failures retry with the next sub-seed.

import { createRng, hashString } from './rng.js';
import { dsin, dcos, TWO_PI } from './dmath.js';

export const HALF_WIDTH = 4;
export const SPACING = 1.5;
const MIN_RADIUS = 7.5;
const CLEARANCE = HALF_WIDTH * 2 + 5;
const MIN_LENGTH = 340;
const MAX_LENGTH = 560;

// Dark palettes. Visual only, but chosen by the seed so a day keeps its look.
export const THEMES = [
  { id: 'graphite', bg: '#161618', bgDot: '#202023', road: '#2c2c2f', curbA: '#ababaf', curbB: '#3a3a3d', skid: 'rgba(0,0,0,0.45)', deco: '#1f1f22' },
  { id: 'midnight', bg: '#11151d', bgDot: '#19202c', road: '#272d3a', curbA: '#8fa6c9', curbB: '#2f3850', skid: 'rgba(0,0,0,0.45)', deco: '#171d28' },
  { id: 'moss', bg: '#111813', bgDot: '#18221b', road: '#282e2a', curbA: '#8fb29a', curbB: '#2c3a30', skid: 'rgba(0,0,0,0.45)', deco: '#16211a' },
  { id: 'plum', bg: '#17131c', bgDot: '#211a28', road: '#2e2934', curbA: '#b39ac9', curbB: '#3a3045', skid: 'rgba(0,0,0,0.45)', deco: '#1f1826' },
  { id: 'umber', bg: '#1a1612', bgDot: '#241e18', road: '#302a25', curbA: '#c4a483', curbB: '#3d342c', skid: 'rgba(0,0,0,0.45)', deco: '#221c16' },
];

const ADJ = ['velvet', 'copper', 'neon', 'quiet', 'lucky', 'crimson', 'paper', 'golden', 'hollow', 'salty', 'electric', 'rusty', 'misty', 'jade', 'amber', 'cobalt', 'lazy', 'wild', 'silver', 'sunny', 'tiny', 'grand', 'frosty', 'midnight'];
const NOUN = ['wombat', 'hairpin', 'harbor', 'lagoon', 'serpent', 'canyon', 'orchard', 'comet', 'ridge', 'pretzel', 'meadow', 'spiral', 'falcon', 'marsh', 'pier', 'boulevard', 'loop', 'kettle', 'lantern', 'badger', 'ribbon', 'plateau', 'otter', 'chicane'];

function catmullRom(ctrl, samplesPerSeg) {
  const n = ctrl.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n];
    const p1 = ctrl[i];
    const p2 = ctrl[(i + 1) % n];
    const p3 = ctrl[(i + 2) % n];
    // centripetal parameterisation: knot spacing = sqrt(distance)
    const k = (a, b) => Math.sqrt(Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y))) || 1e-6;
    const t0 = 0;
    const t1 = t0 + k(p0, p1);
    const t2 = t1 + k(p1, p2);
    const t3 = t2 + k(p2, p3);
    for (let s = 0; s < samplesPerSeg; s++) {
      const t = t1 + ((t2 - t1) * s) / samplesPerSeg;
      const lerp = (a, b, ta, tb) => ({
        x: ((tb - t) / (tb - ta)) * a.x + ((t - ta) / (tb - ta)) * b.x,
        y: ((tb - t) / (tb - ta)) * a.y + ((t - ta) / (tb - ta)) * b.y,
      });
      const a1 = lerp(p0, p1, t0, t1);
      const a2 = lerp(p1, p2, t1, t2);
      const a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, t0, t2);
      const b2 = lerp(a2, a3, t1, t3);
      out.push(lerp(b1, b2, t1, t2));
    }
  }
  return out;
}

function resample(poly, spacing) {
  const n = poly.length;
  let total = 0;
  const segLen = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const l = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));
    segLen.push(l);
    total += l;
  }
  const count = Math.round(total / spacing);
  const step = total / count;
  const out = [];
  let seg = 0;
  let segStart = 0;
  for (let k = 0; k < count; k++) {
    const d = k * step;
    while (segStart + segLen[seg] < d && seg < n - 1) {
      segStart += segLen[seg];
      seg++;
    }
    const u = segLen[seg] > 0 ? (d - segStart) / segLen[seg] : 0;
    const a = poly[seg];
    const b = poly[(seg + 1) % n];
    out.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
  }
  return { pts: out, length: total };
}

function controlPoints(rng) {
  const count = rng.int(8, 14);
  const pts = [];
  const baseR = rng.range(55, 80);
  for (let i = 0; i < count; i++) {
    const ang = ((i + rng.range(-0.3, 0.3)) / count) * TWO_PI;
    // occasional deep pinch makes hairpins and chicanes
    const pinch = rng.next() < 0.28 ? rng.range(0.35, 0.6) : rng.range(0.75, 1.15);
    const r = baseR * pinch;
    // squash into an ellipse so tracks are not all round
    pts.push({ x: dcos(ang) * r * 1.25, y: dsin(ang) * r });
  }
  return pts;
}

// Returns null if the polyline is not a good track.
function analyse(pts, length) {
  if (length < MIN_LENGTH || length > MAX_LENGTH) return null;
  const n = pts.length;
  const tx = new Float64Array(n);
  const ty = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const l = Math.sqrt((b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y));
    tx[i] = (b.x - a.x) / l;
    ty[i] = (b.y - a.y) / l;
  }
  // curvature: cross of tangents 3 samples apart ~ sin(turn angle)
  const W = 3;
  const curv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + W) % n;
    const cross = tx[i] * ty[j] - ty[i] * tx[j];
    const dot = tx[i] * tx[j] + ty[i] * ty[j];
    if (dot < 0) return null;
    const radius = (W * SPACING) / Math.max(Math.abs(cross), 1e-9);
    if (radius < MIN_RADIUS) return null;
    curv[i] = cross;
  }
  // clearance between parts of the road that are far apart along the loop
  const gap = Math.ceil((CLEARANCE * 2.2) / SPACING);
  const c2 = CLEARANCE * CLEARANCE;
  for (let i = 0; i < n; i++) {
    for (let j = i + gap; j < n; j++) {
      if (n - (j - i) < gap) break;
      const dx = pts[i].x - pts[j].x;
      const dy = pts[i].y - pts[j].y;
      if (dx * dx + dy * dy < c2) return null;
    }
  }
  return { tx, ty, curv };
}

function nameFor(rng) {
  return `${rng.pick(ADJ)} ${rng.pick(NOUN)}`;
}

export function generateGeometry(dateKey, attempt) {
  const rng = createRng(hashString(`daily-lap|${dateKey}|${attempt}`));
  const ctrl = controlPoints(rng);
  if (rng.next() < 0.5) ctrl.reverse();
  const dense = catmullRom(ctrl, 24);
  const { pts, length } = resample(dense, SPACING);
  const info = analyse(pts, length);
  if (!info) return null;

  // put the start line in the middle of the straightest stretch
  const n = pts.length;
  const span = 14;
  let best = 0;
  let bestScore = Infinity;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -span; k <= span; k++) s += Math.abs(info.curv[(i + k + n) % n]);
    if (s < bestScore) {
      bestScore = s;
      best = i;
    }
  }
  const rotated = pts.slice(best).concat(pts.slice(0, best));
  return buildTrack(rotated, length, {
    name: nameFor(rng),
    theme: THEMES[Math.floor(rng.next() * THEMES.length)],
    seed: `${dateKey}|${attempt}`,
    decoSeed: hashString(`deco|${dateKey}|${attempt}`),
  });
}

function buildTrack(pts, length, meta) {
  const n = pts.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = pts[i].x;
    ys[i] = pts[i].y;
  }
  // per-segment unit direction (segment i: point i -> i+1)
  const sx = new Float64Array(n);
  const sy = new Float64Array(n);
  const sl = new Float64Array(n);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = xs[j] - xs[i];
    const dy = ys[j] - ys[i];
    const l = Math.sqrt(dx * dx + dy * dy);
    sx[i] = dx / l;
    sy[i] = dy / l;
    sl[i] = l;
    minX = Math.min(minX, xs[i]);
    minY = Math.min(minY, ys[i]);
    maxX = Math.max(maxX, xs[i]);
    maxY = Math.max(maxY, ys[i]);
  }
  // heading of segment 0 as an angle, built only from exact ops: we store the
  // unit vector and let the sim use it directly; the renderer may use atan2.
  const startIdx = n - 4;
  const checkpoints = [Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4)];
  return {
    ...meta,
    n,
    xs,
    ys,
    sx,
    sy,
    sl,
    length,
    halfWidth: HALF_WIDTH,
    checkpoints,
    startIdx,
    start: { x: xs[startIdx], y: ys[startIdx], dx: sx[startIdx], dy: sy[startIdx] },
    finish: { x: xs[0], y: ys[0], dx: sx[0], dy: sy[0] },
    bounds: { minX: minX - HALF_WIDTH, minY: minY - HALF_WIDTH, maxX: maxX + HALF_WIDTH, maxY: maxY + HALF_WIDTH },
  };
}
