// Canvas renderer. World units, y down. Visual only: nothing here feeds back
// into the simulation, so it is free to use Math.atan2 and friends.

import { createRng } from '../core/rng.js';

const CAR_L = 2.3;
const CAR_W = 1.25;

function roadPath(track) {
  const p = new Path2D();
  p.moveTo(track.xs[0], track.ys[0]);
  for (let i = 1; i < track.n; i++) p.lineTo(track.xs[i], track.ys[i]);
  p.closePath();
  return p;
}

function decorations(track) {
  const rng = createRng(track.decoSeed);
  const out = [];
  const b = track.bounds;
  const pad = 30;
  const tries = 900;
  const minD = track.halfWidth + 3.5;
  for (let k = 0; k < tries && out.length < 260; k++) {
    const x = rng.range(b.minX - pad, b.maxX + pad);
    const y = rng.range(b.minY - pad, b.maxY + pad);
    const r = rng.range(1.2, 3.2);
    let ok = true;
    for (let i = 0; i < track.n; i += 2) {
      const dx = x - track.xs[i];
      const dy = y - track.ys[i];
      if (dx * dx + dy * dy < (minD + r) * (minD + r)) {
        ok = false;
        break;
      }
    }
    if (ok) out.push({ x, y, r, kind: rng.next() < 0.75 ? 0 : 1 });
  }
  return out;
}

function makeDotPattern(ctx, theme) {
  const c = document.createElement('canvas');
  c.width = c.height = 24;
  const g = c.getContext('2d');
  g.fillStyle = theme.bg;
  g.fillRect(0, 0, 24, 24);
  g.fillStyle = theme.bgDot;
  g.beginPath();
  g.arc(6, 6, 2, 0, Math.PI * 2);
  g.arc(18, 18, 2, 0, Math.PI * 2);
  g.fill();
  return ctx.createPattern(c, 'repeat');
}

export function drawCar(ctx, x, y, angle, color, alpha = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.globalAlpha = alpha;
  // shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  roundRect(ctx, -CAR_L / 2 + 0.15, -CAR_W / 2 + 0.2, CAR_L, CAR_W, 0.35);
  ctx.fill();
  // tyres
  ctx.fillStyle = '#16171b';
  for (const [tx, ty] of [[0.65, -0.62], [0.65, 0.62], [-0.7, -0.64], [-0.7, 0.64]]) {
    ctx.fillRect(tx - 0.27, ty - 0.14, 0.54, 0.28);
  }
  // body
  ctx.fillStyle = color;
  roundRect(ctx, -CAR_L / 2, -CAR_W / 2, CAR_L, CAR_W, 0.38);
  ctx.fill();
  // cockpit
  ctx.fillStyle = 'rgba(20,22,30,0.85)';
  roundRect(ctx, -0.35, -0.38, 0.75, 0.76, 0.22);
  ctx.fill();
  // nose stripe
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillRect(0.55, -0.12, 0.55, 0.24);
  // rear wing
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
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

function drawTrack(ctx, track, path, theme) {
  const w = track.halfWidth * 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = w + 3.2;
  ctx.stroke(path);
  ctx.strokeStyle = theme.curbB;
  ctx.lineWidth = w + 1.4;
  ctx.stroke(path);
  ctx.strokeStyle = theme.curbA;
  ctx.setLineDash([1.6, 1.6]);
  ctx.lineCap = 'butt';
  ctx.stroke(path);
  ctx.setLineDash([]);
  ctx.lineCap = 'round';
  ctx.strokeStyle = theme.road;
  ctx.lineWidth = w;
  ctx.stroke(path);
  // faint racing guide down the middle
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 0.25;
  ctx.setLineDash([2, 3]);
  ctx.stroke(path);
  ctx.setLineDash([]);
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let track = null;
  let path = null;
  let deco = [];
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
    path = roadPath(track);
    deco = decorations(track);
    pattern = makeDotPattern(ctx, theme);
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
    const vx0 = cx - halfW;
    const vy0 = cy - halfH;
    ctx.save();
    ctx.scale(1 / 6, 1 / 6);
    ctx.fillStyle = pattern;
    ctx.fillRect(vx0 * 6, vy0 * 6, halfW * 12, halfH * 12);
    ctx.restore();

    // scenery
    for (const d of deco) {
      if (d.x < vx0 - 4 || d.x > cx + halfW + 4 || d.y < vy0 - 4 || d.y > cy + halfH + 4) continue;
      if (d.kind === 0) {
        ctx.fillStyle = theme.deco;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = theme.bgDot;
        ctx.fillRect(d.x - d.r * 0.5, d.y - d.r * 0.5, d.r, d.r);
      }
    }

    drawTrack(ctx, track, path, theme);
    drawStartLine(ctx, track);

    // skid marks
    if (view.skids.length) {
      ctx.strokeStyle = theme.skid;
      ctx.lineWidth = 0.3;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      for (const k of view.skids) {
        ctx.moveTo(k[0], k[1]);
        ctx.lineTo(k[2], k[3]);
      }
      ctx.stroke();
    }

    for (const g of view.ghosts) {
      if (!g.visible) continue;
      drawCar(ctx, g.x, g.y, Math.atan2(g.hy, g.hx), g.color, 0.4);
      if (g.label) {
        ctx.save();
        ctx.translate(g.x, g.y - 2.6);
        ctx.scale(1 / ppu, 1 / ppu);
        ctx.font = '600 11px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillText(g.label, 1, 1);
        ctx.fillStyle = '#ababaf';
        ctx.fillText(g.label, 0, 0);
        ctx.restore();
      }
    }

    const p = view.player;
    drawCar(ctx, p.x, p.y, Math.atan2(p.hy, p.hx), view.playerColor, 1);

    for (const sp of view.sparks) {
      ctx.fillStyle = `rgba(245,245,247,${sp.life})`;
      ctx.fillRect(sp.x - 0.15, sp.y - 0.15, 0.3, 0.3);
    }
  }

  return { setDay, draw, resize, pixelsPerUnit };
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
