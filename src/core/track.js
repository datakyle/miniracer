// Procedural track generation.
//
// A day's date string seeds the RNG. Control points are scattered around a
// circle (sorted by angle, so the loop can never cross itself), smoothed with
// a centripetal Catmull-Rom spline, then resampled at a fixed spacing. The
// result is checked for tight corners and for parts of the road passing too
// close to each other; failures retry with the next sub-seed.

import { createRng, hashString } from './rng.js';
import { dsin, dcos, TWO_PI } from './dmath.js';

export const HALF_WIDTH = 5.5;
export const SPACING = 1.5;
const MIN_RADIUS = 9;
const CLEARANCE = HALF_WIDTH * 2 + 5;
const MIN_LENGTH = 215;
const MAX_LENGTH = 290;

// Visual themes. Picked by the seed so a day keeps its look; the
// simulation never reads them. Three road types, two colour variants each.
export const THEMES = [
  {
    id: 'circuit-red', kind: 'circuit',
    bg: '#3f9e44', bgAlt: '#48aa4c', road: '#3b3f48', line: '#ffffff',
    curbA: '#e8262b', curbB: '#ffffff', tree: '#21762c', treeLight: '#2f8f3a',
    skid: 'rgba(10,10,14,0.45)',
  },
  {
    id: 'circuit-blue', kind: 'circuit',
    bg: '#56b04a', bgAlt: '#5fbb52', road: '#40444e', line: '#ffffff',
    curbA: '#1f6bff', curbB: '#ffffff', tree: '#2c7f30', treeLight: '#3b9a3d',
    skid: 'rgba(10,10,14,0.45)',
  },
  {
    id: 'street-day', kind: 'street',
    bg: '#c4c8d0', bgAlt: '#bcc0c9', road: '#30333b', line: '#ffffff', center: '#ffcc00',
    sidewalk: '#e6e8ec', kerb: '#8e949e',
    roofs: ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#b197fc', '#ff922b'],
    tree: '#2f9e44', treeLight: '#40c057', skid: 'rgba(10,10,14,0.4)',
  },
  {
    id: 'street-night', kind: 'street',
    bg: '#171a2e', bgAlt: '#1b1f36', road: '#24273d', line: '#3ff0ff', center: '#ff3fa4',
    sidewalk: '#30345a', kerb: '#5a5f96',
    roofs: ['#ff3fa4', '#3ff0ff', '#ffe14d', '#8c5cff', '#39ff88', '#ff7b2e'],
    tree: '#1d6b55', treeLight: '#26896d', skid: 'rgba(0,0,0,0.45)', neon: true,
  },
  {
    id: 'dirt-forest', kind: 'dirt',
    bg: '#5aa43a', bgAlt: '#62ad40', road: '#b5733e', roadLight: '#c98b55', rut: 'rgba(84,46,18,0.38)',
    edge: 'rgba(80,46,20,0.55)', bale: '#f2c94c', baleDark: '#c99a2e', tree: '#2b7a2e', treeLight: '#3a9a3a',
    dust: '201,150,98', skid: 'rgba(70,38,14,0.4)',
  },
  {
    id: 'dirt-desert', kind: 'dirt',
    bg: '#efc27c', bgAlt: '#e8b96f', road: '#c4602f', roadLight: '#d77a45', rut: 'rgba(100,36,12,0.38)',
    edge: 'rgba(120,52,20,0.45)', bale: '#f7f1e3', baleDark: '#1d1d1f', tree: '#6f8f2e', treeLight: '#86a83a',
    dust: '226,170,110', skid: 'rgba(110,40,12,0.38)', tires: true,
  },
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
  const count = rng.int(6, 10);
  const pts = [];
  const baseR = rng.range(33, 44);
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
