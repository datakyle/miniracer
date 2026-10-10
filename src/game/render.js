// Canvas renderer. World units, y down. Visual only: nothing here feeds back
// into the simulation, so it is free to use Math.atan2 and friends.
//
// Three road types (theme.kind): 'circuit', 'street' and 'dirt'. Geometry
// that doesn't change during a race (edge lines, curbs, scenery) is built
// once per day in setDay.

import { createRng } from '../core/rng.js';

const CAR_L = 2.3;
const CAR_W = 1.25;

function loopPath(xs, ys) {
  const p = new Path2D();
  p.moveTo(xs[0], ys[0]);
  for (let i = 1; i < xs.length; i++) p.lineTo(xs[i], ys[i]);
  p.closePath();
  return p;
}

function roadPath(track) {
  return loopPath(track.xs, track.ys);
}

// per-point unit normal and signed curvature (1 / radius)
function frame(track) {
  const n = track.n;
  const nx = new Float64Array(n);
  const ny = new Float64Array(n);
  const k = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i - 1 + n) % n;
    let tx = track.sx[j] + track.sx[i];
    let ty = track.sy[j] + track.sy[i];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    nx[i] = -ty;
    ny[i] = tx;
    k[i] = (track.sx[j] * track.sy[i] - track.sy[j] * track.sx[i]) / (track.sl[i] || 1);
  }
  return { nx, ny, k };
}

function offsetLoop(track, f, d) {
  const xs = new Float64Array(track.n);
  const ys = new Float64Array(track.n);
  for (let i = 0; i < track.n; i++) {
    xs[i] = track.xs[i] + f.nx[i] * d;
    ys[i] = track.ys[i] + f.ny[i] * d;
  }
  return { xs, ys };
}

// corners (radius under ~30 units), padded a little: 1 = bends one way, 2 = the other
function cornerMask(track, f) {
  const n = track.n;
  const raw = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    // smooth curvature over a few points so curbs don't flicker on and off
    let sum = 0;
    for (let d = -3; d <= 3; d++) sum += f.k[(i + d + n) % n];
    if (Math.abs(sum / 7) > 1 / 30) raw[i] = sum > 0 ? 1 : 2;
  }
  const mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!raw[i]) continue;
    for (let d = -4; d <= 4; d++) mask[(i + d + n) % n] = raw[i];
  }
  return mask;
}

// open sub-paths along an offset loop wherever pick(i) is true
function maskedPath(loop, n, pick) {
  const p = new Path2D();
  let open = false;
  for (let i = 0; i <= n; i++) {
    const j = i % n;
    if (pick(j)) {
      if (!open) p.moveTo(loop.xs[j], loop.ys[j]);
      else p.lineTo(loop.xs[j], loop.ys[j]);
      open = true;
    } else {
      open = false;
    }
  }
  return p;
}

function nearRoad(track, x, y, dist) {
  const d2 = dist * dist;
  for (let i = 0; i < track.n; i += 2) {
    const dx = x - track.xs[i];
    const dy = y - track.ys[i];
    if (dx * dx + dy * dy < d2) return true;
  }
  return false;
}

function buildScenery(track, f, mask) {
  const theme = track.theme;
  const rng = createRng(track.decoSeed);
  const b = track.bounds;
  const pad = 34;
  const hw = track.halfWidth;
  const out = { trees: [], blocks: [], bales: [], stands: [] };

  if (theme.kind === 'street') {
    // city blocks between the roads, then a few street trees
    for (let k = 0; k < 900 && out.blocks.length < 120; k++) {
      const w = rng.range(5, 13);
      const h = rng.range(5, 13);
      const x = rng.range(b.minX - pad, b.maxX + pad);
      const y = rng.range(b.minY - pad, b.maxY + pad);
      const r = Math.hypot(w, h) / 2;
      if (nearRoad(track, x, y, hw + 3.6 + r)) continue;
      if (out.blocks.some((o) => Math.abs(o.x - x) < (o.w + w) / 2 + 1.2 && Math.abs(o.y - y) < (o.h + h) / 2 + 1.2)) continue;
      out.blocks.push({ x, y, w, h, roof: rng.pick(theme.roofs) });
    }
    for (let k = 0; k < 400 && out.trees.length < 50; k++) {
      const x = rng.range(b.minX - pad, b.maxX + pad);
      const y = rng.range(b.minY - pad, b.maxY + pad);
      const r = rng.range(1, 1.8);
      if (nearRoad(track, x, y, hw + 3 + r)) continue;
      if (out.blocks.some((o) => Math.abs(o.x - x) < o.w / 2 + r && Math.abs(o.y - y) < o.h / 2 + r)) continue;
      out.trees.push({ x, y, r });
    }
    return out;
  }

  for (let k = 0; k < 900 && out.trees.length < 220; k++) {
    const x = rng.range(b.minX - pad, b.maxX + pad);
    const y = rng.range(b.minY - pad, b.maxY + pad);
    const r = rng.range(1.3, 3.2);
    if (nearRoad(track, x, y, hw + 4 + r)) continue;
    out.trees.push({ x, y, r });
  }

  if (theme.kind === 'circuit') {
    // a grandstand beside the start straight, on whichever side has room
    const i = Math.floor(track.n * 0.97);
    for (const side of [1, -1]) {
      const d = hw + 6;
      const x = track.xs[i] + f.nx[i] * d * side;
      const y = track.ys[i] + f.ny[i] * d * side;
      if (!nearRoad(track, x, y, hw + 4)) {
        out.stands.push({ x, y, a: Math.atan2(track.sy[i], track.sx[i]) });
        break;
      }
    }
  }

  if (theme.kind === 'dirt') {
    // hay bales (or tyre stacks) on the outside of corners
    for (let i = 0; i < track.n; i += 2) {
      const m = mask[i];
      if (!m) continue;
      const side = m === 1 ? -1 : 1;
      const d = hw + 1.3;
      out.bales.push({
        x: track.xs[i] + f.nx[i] * d * side,
        y: track.ys[i] + f.ny[i] * d * side,
        a: Math.atan2(track.sy[i], track.sx[i]),
      });
    }
  }
  return out;
}

function makeGroundPattern(ctx, theme) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  if (theme.kind === 'circuit') {
    // mown grass stripes
    c.width = c.height = 64;
    g.fillStyle = theme.bg;
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = theme.bgAlt;
    g.fillRect(0, 0, 64, 32);
  } else if (theme.kind === 'street') {
    // paving grid
    c.width = c.height = 32;
    g.fillStyle = theme.bg;
    g.fillRect(0, 0, 32, 32);
    g.strokeStyle = theme.bgAlt;
    g.lineWidth = 2;
    g.strokeRect(0, 0, 32, 32);
  } else {
    // speckled grass or sand
    c.width = c.height = 48;
    g.fillStyle = theme.bg;
    g.fillRect(0, 0, 48, 48);
    g.fillStyle = theme.bgAlt;
    const pts = [[6, 9], [30, 4], [18, 26], [41, 21], [9, 38], [34, 40], [24, 14], [44, 33]];
    for (const [x, y] of pts) {
      g.beginPath();
      g.arc(x, y, 2.4, 0, Math.PI * 2);
      g.fill();
    }
  }
  return ctx.createPattern(c, 'repeat');
}

export function drawCar(ctx, x, y, angle, color, alpha = 1, outline = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = alpha;
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  roundRect(ctx, -CAR_L / 2 + 0.2, -CAR_W / 2 + 0.25, CAR_L, CAR_W, 0.35);
  ctx.fill();
  // tyres
  ctx.fillStyle = '#121316';
  for (const [tx, ty] of [[0.65, -0.62], [0.65, 0.62], [-0.7, -0.64], [-0.7, 0.64]]) {
    ctx.fillRect(tx - 0.27, ty - 0.14, 0.54, 0.28);
  }
  // body
  ctx.fillStyle = color;
  roundRect(ctx, -CAR_L / 2, -CAR_W / 2, CAR_L, CAR_W, 0.38);
  ctx.fill();
  if (outline) {
    ctx.lineWidth = 0.14;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }
  // racing stripe
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillRect(-CAR_L / 2 + 0.1, -0.13, CAR_L - 0.2, 0.26);
  // cockpit
  ctx.fillStyle = 'rgba(16,18,26,0.9)';
  roundRect(ctx, -0.35, -0.38, 0.75, 0.76, 0.22);
  ctx.fill();
  // rear wing
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(-CAR_L / 2 - 0.08, -CAR_W / 2 - 0.05, 0.22, CAR_W + 0.1);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawStartLine(ctx, track) {
  const { x, y, dx, dy } = track.finish;
  const w = track.halfWidth;
  const nx = -dy;
  const ny = dx;
  const cells = 8;
  const size = (2 * w) / cells;
  for (let row = 0; row < 2; row++) {
    for (let c = 0; c < cells; c++) {
      ctx.fillStyle = (c + row) % 2 ? '#1d1d1f' : '#f5f5f7';
      const ox = x + nx * (-w + c * size) + dx * (row * size);
      const oy = y + ny * (-w + c * size) + dy * (row * size);
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + nx * size, oy + ny * size);
      ctx.lineTo(ox + nx * size + dx * size, oy + ny * size + dy * size);
      ctx.lineTo(ox + dx * size, oy + dy * size);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function drawScenery(ctx, theme, scenery, vis) {
  const inView = (x, y, r) => x > vis.x0 - r && x < vis.x1 + r && y > vis.y0 - r && y < vis.y1 + r;

  for (const s of scenery.stands) {
    if (!inView(s.x, s.y, 10)) continue;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.a);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-9 + 0.5, -2.2 + 0.6, 18, 4.4);
    ctx.fillStyle = '#e9ecef';
    ctx.fillRect(-9, -2.2, 18, 4.4);
    const seats = ['#e8262b', '#1f6bff', '#ffd43b', '#ffffff'];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 16; c++) {
        ctx.fillStyle = seats[(c + r * 3) % seats.length];
        ctx.fillRect(-8.4 + c * 1.05, -1.7 + r * 1.2, 0.8, 0.8);
      }
    }
    ctx.restore();
  }

  for (const b of scenery.blocks) {
    if (!inView(b.x, b.y, Math.max(b.w, b.h))) continue;
    const x = b.x - b.w / 2;
    const y = b.y - b.h / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(x + 0.8, y + 1, b.w, b.h);
    ctx.fillStyle = theme.neon ? '#202442' : '#f1f3f5';
    ctx.fillRect(x, y, b.w, b.h);
    ctx.fillStyle = b.roof;
    ctx.globalAlpha = theme.neon ? 0.9 : 1;
    ctx.fillRect(x + 0.6, y + 0.6, b.w - 1.2, b.h - 1.2);
    ctx.globalAlpha = 1;
    // rooftop units
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x + b.w * 0.2, y + b.h * 0.25, b.w * 0.22, b.h * 0.2);
    ctx.fillRect(x + b.w * 0.55, y + b.h * 0.6, b.w * 0.18, b.h * 0.16);
  }

  for (const t of scenery.trees) {
    if (!inView(t.x, t.y, t.r)) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.arc(t.x + 0.5, t.y + 0.7, t.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.tree;
    ctx.beginPath();
    ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.treeLight;
    ctx.beginPath();
    ctx.arc(t.x - t.r * 0.25, t.y - t.r * 0.25, t.r * 0.55, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawRoad(ctx, track, g, theme) {
  const w = track.halfWidth * 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (theme.kind === 'street') {
    ctx.strokeStyle = theme.sidewalk;
    ctx.lineWidth = w + 5;
    ctx.stroke(g.center);
    ctx.strokeStyle = theme.kerb;
    ctx.lineWidth = w + 0.9;
    ctx.stroke(g.center);
    ctx.strokeStyle = theme.road;
    ctx.lineWidth = w;
    ctx.stroke(g.center);
    // lane edges and a dashed centre line
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 0.3;
    ctx.globalAlpha = theme.neon ? 0.9 : 0.8;
    ctx.stroke(g.edgeInL);
    ctx.stroke(g.edgeInR);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = theme.center;
    ctx.lineWidth = 0.42;
    ctx.lineCap = 'butt';
    ctx.setLineDash([2.6, 2]);
    ctx.stroke(g.center);
    ctx.setLineDash([]);
    return;
  }

  if (theme.kind === 'dirt') {
    // soft churned edge, the track worn lighter down the middle, and ruts
    ctx.strokeStyle = theme.edge;
    ctx.lineWidth = w + 2.4;
    ctx.stroke(g.center);
    ctx.strokeStyle = theme.road;
    ctx.lineWidth = w;
    ctx.stroke(g.center);
    ctx.strokeStyle = theme.roadLight;
    ctx.lineWidth = w * 0.45;
    ctx.stroke(g.center);
    ctx.strokeStyle = theme.rut;
    ctx.lineWidth = 0.9;
    ctx.stroke(g.rutL);
    ctx.stroke(g.rutR);
    return;
  }

  // circuit: shadow, tarmac, white edge lines, curbs on the corners
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = w + 3;
  ctx.stroke(g.center);
  ctx.strokeStyle = theme.road;
  ctx.lineWidth = w;
  ctx.stroke(g.center);
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 0.35;
  ctx.stroke(g.edgeInL);
  ctx.stroke(g.edgeInR);
  ctx.lineCap = 'butt';
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = theme.curbB;
  ctx.stroke(g.curbs);
  ctx.strokeStyle = theme.curbA;
  ctx.setLineDash([1.3, 1.3]);
  ctx.stroke(g.curbs);
  ctx.setLineDash([]);
}

function drawBales(ctx, theme, bales, vis) {
  for (const b of bales) {
    if (b.x < vis.x0 - 2 || b.x > vis.x1 + 2 || b.y < vis.y0 - 2 || b.y > vis.y1 + 2) continue;
    if (theme.tires) {
      // tyre stack: dark ring with a light centre
      ctx.fillStyle = theme.baleDark;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 0.75, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = theme.bale;
      ctx.beginPath();
      ctx.arc(b.x, b.y, 0.3, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.a);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-1.2 + 0.25, -0.6 + 0.3, 2.4, 1.2);
    ctx.fillStyle = theme.bale;
    ctx.fillRect(-1.2, -0.6, 2.4, 1.2);
    ctx.fillStyle = theme.baleDark;
    ctx.fillRect(-0.45, -0.6, 0.12, 1.2);
    ctx.fillRect(0.35, -0.6, 0.12, 1.2);
    ctx.restore();
  }
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let track = null;
  let geo = null;
  let scenery = null;
  let pattern = null;
  let theme = null;
  let dpr = 1;
  let cssW = 0;
  let cssH = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    cssW = window.innerWidth;
    cssH = window.innerHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  resize();
  window.addEventListener('resize', resize);

  function setDay(day) {
    track = day.track;
    theme = track.theme;
    const f = frame(track);
    const mask = cornerMask(track, f);
    const hw = track.halfWidth;
    const n = track.n;
    const inL = offsetLoop(track, f, hw - 0.45);
    const inR = offsetLoop(track, f, -(hw - 0.45));
    const curbL = offsetLoop(track, f, hw + 0.55);
    const curbR = offsetLoop(track, f, -(hw + 0.55));
    const rutL = offsetLoop(track, f, hw * 0.42);
    const rutR = offsetLoop(track, f, -hw * 0.42);
    // curbs on both sides of every corner
    const curbs = new Path2D();
    curbs.addPath(maskedPath(curbL, n, (i) => mask[i] !== 0));
    curbs.addPath(maskedPath(curbR, n, (i) => mask[i] !== 0));
    geo = {
      center: roadPath(track),
      edgeInL: loopPath(inL.xs, inL.ys),
      edgeInR: loopPath(inR.xs, inR.ys),
      rutL: loopPath(rutL.xs, rutL.ys),
      rutR: loopPath(rutR.xs, rutR.ys),
      curbs,
    };
    scenery = buildScenery(track, f, mask);
    pattern = makeGroundPattern(ctx, theme);
    document.documentElement.style.setProperty('--bg', theme.bg);
  }

  // world units across the shorter screen side
  function pixelsPerUnit() {
    const short = Math.min(cssW, cssH);
    return Math.max(7, Math.min(16, short / 36));
  }

  function draw(view) {
    const ppu = pixelsPerUnit();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const s = ppu * dpr;
    const cx = view.cam.x + (view.shake ? (Math.random() - 0.5) * view.shake : 0);
    const cy = view.cam.y + (view.shake ? (Math.random() - 0.5) * view.shake : 0);
    ctx.setTransform(s, 0, 0, s, canvas.width / 2 - cx * s, canvas.height / 2 - cy * s);

    const halfW = cssW / 2 / ppu + 4;
    const halfH = cssH / 2 / ppu + 4;
    const vis = { x0: cx - halfW, x1: cx + halfW, y0: cy - halfH, y1: cy + halfH };
    ctx.save();
    ctx.scale(1 / 6, 1 / 6);
    ctx.fillStyle = pattern;
    ctx.fillRect(vis.x0 * 6, vis.y0 * 6, halfW * 12, halfH * 12);
    ctx.restore();

    drawRoad(ctx, track, geo, theme);
    drawStartLine(ctx, track);
    drawBales(ctx, theme, scenery.bales, vis);

    // skid marks
    if (view.skids.length) {
      ctx.strokeStyle = theme.skid;
      ctx.lineWidth = 0.32;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      for (const k of view.skids) {
        ctx.moveTo(k[0], k[1]);
        ctx.lineTo(k[2], k[3]);
      }
      ctx.stroke();
    }

    // dust kicked up on dirt
    if (theme.dust && view.dust) {
      for (const d of view.dust) {
        ctx.fillStyle = `rgba(${theme.dust},${d.life * 0.45})`;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (const g of view.ghosts) {
      if (!g.visible) continue;
      drawCar(ctx, g.x, g.y, Math.atan2(g.hy, g.hx), g.color, 0.55);
      if (g.label) {
        ctx.save();
        ctx.translate(g.x, g.y - 2.6);
        ctx.scale(1 / ppu, 1 / ppu);
        ctx.font = '600 12px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,0.65)';
        ctx.fillText(g.label, 1, 1);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(g.label, 0, 0);
        ctx.restore();
      }
    }

    const p = view.player;
    drawCar(ctx, p.x, p.y, Math.atan2(p.hy, p.hx), view.playerColor, 1, true);

    for (const sp of view.sparks) {
      ctx.fillStyle = `rgba(255,214,90,${sp.life})`;
      ctx.fillRect(sp.x - 0.18, sp.y - 0.18, 0.36, 0.36);
    }

    // trees, buildings and stands sit off the road, so draw them last
    drawScenery(ctx, theme, scenery, vis);
  }

  return { setDay, draw, resize, pixelsPerUnit, kind: () => theme?.kind };
}

// Small static picture of a track for menus.
export function drawPreview(canvas, track, opts = {}) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  const b = track.bounds;
  const bw = b.maxX - b.minX;
  const bh = b.maxY - b.minY;
  const pad = 10;
  const s = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh) * dpr;
  ctx.setTransform(s, 0, 0, s, (canvas.width - bw * s) / 2 - b.minX * s, (canvas.height - bh * s) / 2 - b.minY * s);
  const path = roadPath(track);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = opts.edge || 'rgba(255,255,255,0.9)';
  ctx.lineWidth = track.halfWidth * 2 + 3;
  ctx.stroke(path);
  ctx.strokeStyle = opts.road || track.theme.road;
  ctx.lineWidth = track.halfWidth * 2;
  ctx.stroke(path);
  drawStartLine(ctx, track);
  // direction arrow just after the line
  const i = Math.floor(track.n * 0.06);
  const x = track.xs[i];
  const y = track.ys[i];
  const a = Math.atan2(track.sy[i], track.sx[i]);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.fillStyle = opts.arrow || '#fff';
  ctx.beginPath();
  ctx.moveTo(3, 0);
  ctx.lineTo(-2, -2.4);
  ctx.lineTo(-2, 2.4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
