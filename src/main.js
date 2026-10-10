import { buildDay, dateKeyFromDate, medalFor } from './core/day.js';
import { createSim, step, DT, MAX_FRAMES, TUNING, timeMs } from './core/sim.js';
import { encodeInputs, decodeInputs } from './core/replay.js';
import { createRenderer, drawPreview } from './game/render.js';
import { createInput } from './game/input.js';
import { createAudio } from './game/audio.js';
import { store, prune } from './game/storage.js';
import { parseChallenge, challengeUrl, shareText, shareRun, fmt, fmtDelta, cleanName, capitalize } from './game/share.js';

const $ = (sel) => document.querySelector(sel);
const canvas = $('#game');
const renderer = createRenderer(canvas);
const input = createInput(canvas);
const audio = createAudio();
audio.setMuted(!store.sound);

// the player is the warm amber; ghosts are quiet tints
const PLAYER_COLOR = '#b8906a';
const FRIEND_COLORS = ['#8fb4e0', '#c9a0dc', '#9fd0a8', '#e0b8a0'];
const COUNTDOWN = 1.6;

// dev only: ?bot drives the player's car with the bot lap (for testing)
const devBot = Boolean(import.meta.env?.DEV) && new URLSearchParams(location.search).has('bot');

const todayKey = dateKeyFromDate(new Date());
prune(todayKey);

let dateKey = todayKey;
let day = null;
let challenge = null;

// race state
let mode = 'home'; // home | countdown | racing | finished
let sim = null;
let inputs = [];
let ghosts = [];
let pbSplits = null;
let countdownLeft = 0;
let lastBeep = 0;
let acc = 0;
let prev = { x: 0, y: 0, hx: 1, hy: 0 };
let cam = { x: 0, y: 0 };
let skids = [];
let sparks = [];
let shake = 0;
let splitMsg = null;
let lastResult = null;

// attract mode: the bot drives laps behind the menus
let attract = null;
let attractFrame = 0;

function loadDay(key) {
  dateKey = key;
  day = buildDay(key);
  renderer.setDay(day);
  startAttract();
}

function startAttract() {
  attract = createSim(day.track);
  attractFrame = 0;
  skids = [];
  cam.x = attract.x;
  cam.y = attract.y;
}

// ---------- ghosts ----------

function ghostFromEncoded(encoded, label, color) {
  try {
    return { frames: decodeInputs(encoded), sim: createSim(day.track), label, color, visible: true };
  } catch {
    return null;
  }
}

function buildGhosts() {
  const list = [];
  const mine = store.day(dateKey);
  if (store.ghost && mine?.inputs) {
    const g = ghostFromEncoded(mine.inputs, 'best', '#ffffff');
    if (g) list.push(g);
  }
  const friends = Object.entries(store.friends(dateKey)).sort((a, b) => a[1].ms - b[1].ms).slice(0, 3);
  friends.forEach(([name, f], i) => {
    const g = ghostFromEncoded(f.inputs, name, FRIEND_COLORS[i % FRIEND_COLORS.length]);
    if (g) list.push(g);
  });
  if (store.ghost && medalFor(day, mine?.best) !== 'gold') {
    list.push({ frames: day.bot.inputs, sim: createSim(day.track), label: 'gold', color: '#d4b46a', visible: true });
  }
  return list;
}

function computeSplits(encoded) {
  if (!encoded) return null;
  let frames;
  try {
    frames = decodeInputs(encoded);
  } catch {
    return null;
  }
  const s = createSim(day.track);
  const out = [];
  for (let f = 0; f < frames.length && !s.finished; f++) {
    const before = s.nextCp;
    step(s, frames[f]);
    if (s.nextCp > before) out.push(s.frame);
  }
  return out;
}

// ---------- race flow ----------

function startRace() {
  audio.unlock();
  sim = createSim(day.track);
  inputs = [];
  ghosts = buildGhosts();
  pbSplits = computeSplits(store.day(dateKey)?.inputs);
  skids = [];
  sparks = [];
  shake = 0;
  acc = 0;
  splitMsg = null;
  prev = { x: sim.x, y: sim.y, hx: sim.hx, hy: sim.hy };
  cam.x = sim.x;
  cam.y = sim.y;
  countdownLeft = COUNTDOWN;
  lastBeep = 4;
  mode = 'countdown';
  input.setEnabled(true);
  show('hud');
  $('#time').textContent = fmt(0);
  $('#split').textContent = '';
  document.body.classList.toggle('first-time', !store.day(dateKey)?.runs);
}

function finishRace() {
  mode = 'finished';
  input.setEnabled(false);
  const finished = sim.finished;
  const ms = finished ? timeMs(sim.finishTime) : null;
  const before = store.day(dateKey)?.best ?? null;
  let isBest = false;
  if (finished) {
    isBest = store.recordRun(dateKey, ms, encodeInputs(inputs.slice(0, sim.frame)));
  }
  lastResult = { ms, before, isBest, finished };
  renderFinish();
  show('finish');
}

function goHome() {
  mode = 'home';
  input.setEnabled(false);
  startAttract();
  renderHome();
  show('home');
}

input.onRestart(() => {
  if (mode !== 'home') startRace();
});

// ---------- per-frame ----------

function addSkids(s, p) {
  if (s.slip < 0.2) return;
  const speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
  if (speed < 8) return;
  for (const side of [-0.6, 0.6]) {
    const ax = p.x - p.hx * 0.75 - p.hy * side;
    const ay = p.y - p.hy * 0.75 + p.hx * side;
    const bx = s.x - s.hx * 0.75 - s.hy * side;
    const by = s.y - s.hy * 0.75 + s.hx * side;
    skids.push([ax, ay, bx, by]);
  }
  if (skids.length > 3000) skids.splice(0, skids.length - 3000);
}

function physicsStep() {
  prev = { x: sim.x, y: sim.y, hx: sim.hx, hy: sim.hy };
  const steer = devBot ? day.bot.inputs[sim.frame] ?? 0 : input.steer();
  inputs.push(steer);
  const before = sim.nextCp;
  step(sim, steer);
  addSkids(sim, prev);

  if (sim.wallHit > 2) {
    shake = Math.min(1.2, sim.wallHit * 0.06);
    audio.bump(sim.wallHit);
    if (sim.wallHit > 6 && navigator.vibrate) navigator.vibrate(12);
    for (let k = 0; k < 6; k++) {
      sparks.push({ x: sim.x, y: sim.y, vx: (Math.random() - 0.5) * 14, vy: (Math.random() - 0.5) * 14, life: 1 });
    }
  }
  if (sim.nextCp > before && pbSplits && pbSplits[before] != null) {
    const delta = Math.round((sim.frame - pbSplits[before]) * DT * 1000);
    splitMsg = { text: fmtDelta(delta), good: delta < 0, until: performance.now() + 1800 };
  }

  for (const g of ghosts) {
    if (g.sim.finished) {
      g.visible = false;
      continue;
    }
    step(g.sim, g.frames[g.sim.frame] ?? 0);
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (mode === 'countdown') {
    countdownLeft -= dt;
    const n = Math.ceil((countdownLeft / COUNTDOWN) * 3);
    if (n !== lastBeep && n > 0) {
      lastBeep = n;
      audio.beep(false);
    }
    $('#countdown').textContent = n > 0 ? String(n) : '';
    if (countdownLeft <= 0) {
      audio.beep(true);
      $('#countdown').textContent = 'Go';
      setTimeout(() => {
        if (mode === 'racing') $('#countdown').textContent = '';
      }, 450);
      mode = 'racing';
      acc = 0;
    }
  } else if (mode === 'racing') {
    acc += dt;
    while (acc >= DT) {
      acc -= DT;
      physicsStep();
      if (sim.finished || sim.frame >= MAX_FRAMES) {
        finishRace();
        break;
      }
    }
    $('#time').textContent = fmt(Math.round(sim.frame * DT * 1000));
  } else if (mode === 'home' && attract) {
    // bot demo lap behind the menu
    acc += dt;
    while (acc >= DT) {
      acc -= DT;
      const p = { x: attract.x, y: attract.y, hx: attract.hx, hy: attract.hy };
      step(attract, day.bot.inputs[attractFrame] ?? 0);
      attractFrame++;
      addSkids(attract, p);
      if (attract.finished) startAttract();
    }
  }

  const car = mode === 'home' ? attract : sim;
  if (car) {
    const alpha = mode === 'racing' ? acc / DT : 1;
    const p = mode === 'racing'
      ? {
          x: prev.x + (car.x - prev.x) * alpha,
          y: prev.y + (car.y - prev.y) * alpha,
          hx: prev.hx + (car.hx - prev.hx) * alpha,
          hy: prev.hy + (car.hy - prev.hy) * alpha,
        }
      : { x: car.x, y: car.y, hx: car.hx, hy: car.hy };
    const look = mode === 'home' ? 0.25 : 0.42;
    const tx = p.x + car.vx * look;
    const ty = p.y + car.vy * look;
    const k = 1 - Math.exp(-dt * 5);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;

    for (const sp of sparks) {
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      sp.life -= dt * 2.5;
    }
    sparks = sparks.filter((sp) => sp.life > 0);
    shake *= Math.exp(-dt * 10);

    renderer.draw({
      player: p,
      playerColor: PLAYER_COLOR,
      ghosts: mode === 'home' ? [] : ghosts.map((g) => {
        // hide the name while the ghost overlaps the player, so labels don't pile up
        const near = (g.sim.x - p.x) ** 2 + (g.sim.y - p.y) ** 2 < 16;
        return { ...g, label: near ? '' : g.label, x: g.sim.x, y: g.sim.y, hx: g.sim.hx, hy: g.sim.hy };
      }),
      cam,
      skids,
      sparks,
      shake: shake > 0.02 ? shake : 0,
    });

    const speed = Math.sqrt(car.vx * car.vx + car.vy * car.vy);
    audio.update(mode === 'racing' || mode === 'countdown', speed / TUNING.maxSpeed, car.slip);
  }

  if (mode === 'racing' || mode === 'countdown') {
    const held = input.held();
    $('#pad-left').classList.toggle('on', held.left);
    $('#pad-right').classList.toggle('on', held.right);
    const sp = $('#split');
    if (splitMsg && now < splitMsg.until) {
      sp.textContent = splitMsg.text;
      sp.className = splitMsg.good ? 'ahead' : 'behind';
    } else {
      sp.textContent = '';
    }
  }

  requestAnimationFrame(frame);
}

// ---------- UI ----------

function show(id) {
  for (const el of ['home', 'finish', 'hud']) $(`#${el}`).hidden = el !== id;
  document.body.dataset.mode = id;
}

function prettyDate(key) {
  const d = new Date(`${key}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function timeToMidnight() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const mins = Math.max(0, Math.floor((next - now) / 60000));
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const dot = (m) => `<span class="mdot ${m}"></span>`;

const ICON_SOUND_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
const ICON_SOUND_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>';

function medalRow(best) {
  const got = medalFor(day, best);
  const rank = { gold: 3, silver: 2, bronze: 1 };
  return ['gold', 'silver', 'bronze']
    .map((m) => {
      const earned = got && rank[got] >= rank[m];
      return `<div class="medal ${earned ? 'earned' : ''}" title="${capitalize(m)}">${dot(m)}<span>${fmt(day.medals[m])}</span></div>`;
    })
    .join('');
}

function friendsList() {
  const mine = store.day(dateKey)?.best;
  const rows = Object.entries(store.friends(dateKey)).map(([name, f]) => ({ name, ms: f.ms, me: false }));
  if (!rows.length) return '';
  if (mine != null) rows.push({ name: store.name || 'You', ms: mine, me: true });
  rows.sort((a, b) => a.ms - b.ms);
  return `<div class="board"><div class="label">Friends today</div>${rows
    .map((r, i) => `<div class="board-row ${r.me ? 'me' : ''}"><span>${i + 1}</span><span>${esc(r.name)}${r.me && store.name ? ' (you)' : ''}</span><b>${fmt(r.ms)}</b></div>`)
    .join('')}</div>`;
}

function renderHome() {
  const mine = store.day(dateKey);
  const best = mine?.best ?? null;
  const medal = medalFor(day, best);
  const streak = store.streak(todayKey);
  const isToday = dateKey === todayKey;

  let challengeHtml = '';
  if (challenge && challenge.dateKey === dateKey) {
    const beat = best != null && best < challenge.ms;
    challengeHtml = `<div class="challenge">
      <div><b>${esc(challenge.name)}</b> ran <b>${fmt(challenge.ms)}</b>${challenge.verified ? '<span class="tag">Verified</span>' : ''}</div>
      <div class="muted">${beat ? `You beat them by ${fmt(challenge.ms - best)}.` : 'Their ghost races with you. Beat it.'}</div>
    </div>`;
  }

  const runs = mine?.runs ?? 0;
  $('#home').innerHTML = `
    <div class="card">
      <div class="top">
        <div class="brand">Daily lap</div>
        <button class="icon" id="btn-sound" aria-label="${store.sound ? 'Mute' : 'Unmute'}">${store.sound ? ICON_SOUND_ON : ICON_SOUND_OFF}</button>
      </div>
      <span class="eyebrow">No. ${day.number} · ${prettyDate(dateKey)}${isToday ? '' : ` · <a href="#" id="go-today">Play today's track</a>`}</span>
      <canvas class="preview" id="preview"></canvas>
      <h1>${esc(capitalize(day.track.name))}</h1>
      <div class="medals">${medalRow(best)}</div>
      <div class="pb">${best != null
        ? `Your best <b>${fmt(best)}</b>${medal ? `, ${medal}` : ''}. ${runs} run${runs === 1 ? '' : 's'}.`
        : 'No lap yet today.'}${streak > 1 ? ` ${streak} days in a row.` : ''}</div>
      ${challengeHtml}
      ${friendsList()}
      <div class="stack">
        <button class="primary" id="btn-race">${best != null ? 'Race again' : 'Race'}</button>
        ${best != null ? '<button class="secondary" id="btn-share-home">Share my best</button>' : ''}
      </div>
      <p class="how">Hold the <b>left</b> or <b>right</b> side of the screen to steer, or use the arrow keys. The car drives itself. One lap, as fast as you can. Walls slow you down.</p>
      <div class="foot">${isToday ? `New track in ${timeToMidnight()}` : `Track from ${prettyDate(dateKey)}`}</div>
    </div>`;
  drawPreview($('#preview'), day.track, { road: '#2c2c2f', edge: 'rgba(255,255,255,0.55)', arrow: '#ababaf' });
  $('#btn-race').onclick = startRace;
  $('#btn-sound').onclick = () => {
    store.sound = !store.sound;
    audio.setMuted(!store.sound);
    if (store.sound) audio.unlock();
    renderHome();
  };
  const share = $('#btn-share-home');
  if (share) share.onclick = () => doShare(share);
  const gt = $('#go-today');
  if (gt) {
    gt.onclick = (e) => {
      e.preventDefault();
      loadDay(todayKey);
      renderHome();
    };
  }
}

function renderFinish() {
  const r = lastResult;
  const best = store.day(dateKey)?.best ?? null;
  let headline;
  let sub = '';
  if (!r.finished) {
    headline = 'DNF';
    sub = 'Out of time. Try again.';
  } else {
    headline = fmt(r.ms);
    if (r.isBest && r.before != null) sub = `<span class="ahead">New best, ${fmtDelta(r.ms - r.before)}</span>`;
    else if (r.isBest) sub = 'First lap done.';
    else sub = `<span class="behind">${fmtDelta(r.ms - best)}</span> off your best of ${fmt(best)}`;
  }
  const medal = medalFor(day, r.ms);
  let medalHtml = '';
  if (medal) {
    medalHtml = `<div class="medal-big">${dot(medal)}${capitalize(medal)}</div>`;
  } else if (r.finished) {
    medalHtml = `<div class="muted">${fmt(r.ms - day.medals.bronze)} to bronze</div>`;
  }
  if (medal && medal !== 'gold') {
    const nextM = medal === 'bronze' ? 'silver' : 'gold';
    medalHtml += `<div class="muted">${fmt(r.ms - day.medals[nextM])} to ${nextM}</div>`;
  }

  let vs = '';
  const friends = Object.entries(store.friends(dateKey));
  if (r.finished && friends.length) {
    vs = friends
      .sort((a, b) => a[1].ms - b[1].ms)
      .slice(0, 3)
      .map(([name, f]) => (r.ms < f.ms
        ? `<div>You beat <b>${esc(name)}</b> by ${fmt(f.ms - r.ms)}.</div>`
        : `<div><b>${esc(name)}</b> is ahead by ${fmt(r.ms - f.ms)}.</div>`))
      .join('');
    vs = `<div class="vs">${vs}</div>`;
  }

  $('#finish').innerHTML = `
    <div class="card">
      <span class="label">No. ${day.number} · ${esc(capitalize(day.track.name))}</span>
      <div class="result">${headline}</div>
      <div class="sub">${sub}</div>
      ${medalHtml}
      ${vs}
      <div class="row">
        <button class="primary" id="btn-again">Race again</button>
        ${best != null ? '<button class="secondary" id="btn-share">Share best</button>' : ''}
      </div>
      <div class="name-row" id="name-row" hidden>
        <input id="name-input" maxlength="14" placeholder="Your name (optional)" autocomplete="nickname" />
        <button class="primary" id="btn-name-ok">Share</button>
      </div>
      <button class="link" id="btn-home">Menu</button>
      <div class="hint-keys">Press R to restart anytime.</div>
    </div>`;
  $('#btn-again').onclick = startRace;
  $('#btn-home').onclick = goHome;
  const sh = $('#btn-share');
  if (sh) sh.onclick = () => doShare(sh);
}

async function doShare(btn) {
  if (!store.name) {
    const row = $('#name-row');
    if (row && row.hidden) {
      row.hidden = false;
      const inp = $('#name-input');
      inp.focus();
      $('#btn-name-ok').onclick = () => {
        store.name = cleanName(inp.value) || 'anon';
        row.hidden = true;
        doShare(btn);
      };
      return;
    }
    if (!row) {
      const n = window.prompt('Your name, shown to friends', '');
      store.name = cleanName(n) || 'anon';
    }
  }
  const mine = store.day(dateKey);
  if (!mine?.best) return;
  const url = challengeUrl({ dateKey, ms: mine.best, name: store.name, inputs: mine.inputs });
  const text = shareText({ day, ms: mine.best, medal: medalFor(day, mine.best) });
  const res = await shareRun({ text, url });
  if (res === 'copied') toast('Link copied. Send it to a friend.');
}

let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

$('#btn-restart').onclick = (e) => {
  e.stopPropagation();
  startRace();
};
$('#btn-quit').onclick = (e) => {
  e.stopPropagation();
  goHome();
};
for (const id of ['#btn-restart', '#btn-quit']) {
  $(id).addEventListener('pointerdown', (e) => e.stopPropagation());
}

// ---------- boot ----------

function boot() {
  challenge = parseChallenge(location.hash);
  if (challenge && !challenge.valid) {
    challenge = null;
    toast("That link's lap didn't check out.");
  }
  if (challenge) {
    store.addFriend(challenge.dateKey, challenge.name, challenge.ms, challenge.inputs);
    history.replaceState(null, '', location.pathname + location.search);
    loadDay(challenge.dateKey);
  } else {
    loadDay(todayKey);
  }
  goHome();
  requestAnimationFrame(frame);
}

boot();
