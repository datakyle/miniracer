import { buildDay, dateKeyAt, msUntilNextDay, addDays } from './core/day.js';
import { createSim, step, DT, MAX_FRAMES, TUNING, timeMs } from './core/sim.js';
import { encodeInputs, decodeInputs } from './core/replay.js';
import { createRenderer, drawPreview } from './game/render.js';
import { createInput } from './game/input.js';
import { createAudio } from './game/audio.js';
import { store, prune } from './game/storage.js';
import { listGhosts, pickRivals, submitRun } from './game/ghosts.js';
import { cloudEnabled, initCrew, crew, refreshBoard, uploadBest } from './game/cloud.js';
import { cleanCrew, DEFAULT_CREW } from './core/names.js';
import { parseChallenge, challengeUrl, shareText, shareRun, fmt, fmtDelta, cleanName, capitalize } from './game/share.js';

const $ = (sel) => document.querySelector(sel);
const canvas = $('#game');
const renderer = createRenderer(canvas);
const input = createInput(canvas);
const audio = createAudio();
audio.setMuted(!store.sound);

// the race itself is bright and readable; the menus keep the brand palette
const PLAYER_COLOR = '#ff5a1f';
const FRIEND_COLORS = ['#22b8ff', '#b85cff', '#2ee87a'];
const STARTER_COLOR = '#ffd400';
const MAX_FRIEND_GHOSTS = 3;
const BOARD_ROWS = 10;
const COUNTDOWN = 1.6;

// dev only: ?bot drives the player's car with the bot lap (for testing)
const devBot = Boolean(import.meta.env?.DEV) && new URLSearchParams(location.search).has('bot');

// the day rolls over at midnight US Central for everyone (see core/day.js)
const todayKey = dateKeyAt();
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
let lookOff = { x: 0, y: 0 };
let skids = [];
let sparks = [];
let dust = [];
// recent path of the car in view (the racing line), and the speed zoom
let trail = [];
let zoom = 1;
const TRAIL_POINTS = 140;
// display units: top speed 31 world units/s reads as ~280 km/h
const KMH_PER_UNIT = 9;
let dustTick = 0;
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
  dust = [];
  trail = [];
  cam.x = attract.x;
  cam.y = attract.y;
  lookOff = { x: 0, y: 0 };
}

// ---------- ghosts ----------

function buildGhosts() {
  const all = listGhosts(day);
  const friends = pickRivals(all, store.day(dateKey)?.best ?? null, MAX_FRIEND_GHOSTS);
  const picked = [
    ...all.filter((g) => g.kind === 'you' && store.ghost).map((g) => ({ ...g, label: 'best', color: '#ffffff' })),
    ...friends.map((g, i) => ({ ...g, label: g.name, color: FRIEND_COLORS[i % FRIEND_COLORS.length] })),
    ...all.filter((g) => g.kind === 'starter').map((g) => ({ ...g, label: g.name, color: STARTER_COLOR })),
  ];
  return picked.map((g) => ({ frames: g.frames, sim: createSim(day.track), label: g.label, color: g.color, visible: true }));
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
  dust = [];
  trail = [];
  shake = 0;
  acc = 0;
  splitMsg = null;
  prev = { x: sim.x, y: sim.y, hx: sim.hx, hy: sim.hy };
  cam.x = sim.x;
  cam.y = sim.y;
  lookOff = { x: 0, y: 0 };
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
    isBest = submitRun(dateKey, ms, encodeInputs(inputs.slice(0, sim.frame)));
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
  refreshHome();
}

// pull the crew's board, then redraw the menu if we're still on it
async function refreshHome(maxAgeMs = 15000) {
  if (!cloudEnabled) return;
  const before = dateKey;
  await refreshBoard(dateKey, { maxAgeMs });
  if (mode === 'home' && dateKey === before) renderHome();
}

input.onRestart(() => {
  if (mode !== 'home') startRace();
});

// ---------- per-frame ----------

function addTrail(s, frameNo) {
  if (frameNo % 2) return;
  const speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
  trail.push({ x: s.x, y: s.y, sr: Math.min(1, speed / TUNING.maxSpeed) });
  if (trail.length > TRAIL_POINTS) trail.splice(0, trail.length - TRAIL_POINTS);
}

function addSkids(s, p) {
  if (s.slip < 0.2) return;
  const speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy);
  if (speed < 8) return;
  // dirt tracks throw up dust from the rear wheels while sliding
  if (renderer.kind() === 'dirt' && ++dustTick % 3 === 0) {
    for (const side of [-0.6, 0.6]) {
      dust.push({
        x: s.x - s.hx * 1.1 - s.hy * side,
        y: s.y - s.hy * 1.1 + s.hx * side,
        r: 0.5,
        life: Math.min(1, s.slip * 2),
      });
    }
    if (dust.length > 240) dust.splice(0, dust.length - 240);
  }
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
  addTrail(sim, sim.frame);

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
      addTrail(attract, attractFrame);
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
    // camera: locked to the car (no positional lag), with a look-ahead
    // offset that eases toward the direction of travel
    const look = mode === 'home' ? 0.25 : 0.3;
    const k = 1 - Math.exp(-dt * 4);
    lookOff.x += (car.vx * look - lookOff.x) * k;
    lookOff.y += (car.vy * look - lookOff.y) * k;
    cam.x = p.x + lookOff.x;
    cam.y = p.y + lookOff.y;

    for (const sp of sparks) {
      sp.x += sp.vx * dt;
      sp.y += sp.vy * dt;
      sp.life -= dt * 2.5;
    }
    sparks = sparks.filter((sp) => sp.life > 0);
    for (const d of dust) {
      d.r += dt * 2.2;
      d.life -= dt * 1.4;
    }
    dust = dust.filter((d) => d.life > 0);
    shake *= Math.exp(-dt * 10);

    const carSpeed = Math.sqrt(car.vx * car.vx + car.vy * car.vy);
    const speedRatio = Math.min(1, carSpeed / TUNING.maxSpeed);
    // pull the camera back as speed builds: more road ahead, more sense of pace
    const targetZoom = mode === 'home' ? 1 : 1 - 0.16 * speedRatio * speedRatio;
    zoom += (targetZoom - zoom) * (1 - Math.exp(-dt * 2.5));

    renderer.draw({
      trail,
      zoom,
      speedRatio,
      racing: mode === 'racing',
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
      dust,
      shake: shake > 0.02 ? shake : 0,
    });

    audio.update(mode === 'racing' || mode === 'countdown', speedRatio, car.slip);
    if (mode === 'racing' || mode === 'countdown' || mode === 'finished') updateSpeedo(carSpeed, speedRatio);
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

// ---------- speedometer ----------

const speedoEl = $('#speedo');
const speedoNum = $('#speed-num');
const speedoArc = $('#speed-arc');
const ARC_LEN = 100; // the arc path uses pathLength="100"
let shownSpeed = 0;

function updateSpeedo(speed, ratio) {
  if (!speedoEl) return;
  // the number eases so it reads as a needle, not flicker
  shownSpeed += (speed * KMH_PER_UNIT - shownSpeed) * 0.35;
  speedoNum.textContent = String(Math.round(shownSpeed));
  speedoArc.style.strokeDashoffset = String(ARC_LEN * (1 - ratio));
  speedoEl.classList.toggle('hot', ratio > 0.86);
  speedoEl.style.setProperty('--heat', ratio.toFixed(3));
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

// time until the next track (midnight US Central)
function timeToMidnight() {
  const mins = Math.max(0, Math.floor(msUntilNextDay() / 60000));
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}


const ICON_SOUND_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
const ICON_SOUND_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>';

// everyone whose ghost you have for this day, fastest first. Long boards
// show the top rows plus your own.
function ghostBoard() {
  const rows = listGhosts(day).map((g, i) => ({ ...g, rank: i + 1 }));
  let shown = rows.slice(0, BOARD_ROWS);
  const me = rows.find((g) => g.kind === 'you');
  if (me && me.rank > BOARD_ROWS) shown = shown.slice(0, BOARD_ROWS - 1).concat(me);
  const title = crew() === DEFAULT_CREW ? 'Today' : `Today · ${esc(crew())}`;
  return `<div class="board"><div class="label">${title}</div>${shown
    .map((g) => `<div class="board-row ${g.kind === 'you' ? 'me' : ''}"><span>${g.rank}</span><span>${esc(g.name)}${g.kind === 'you' && store.name ? ' (you)' : ''}</span><b>${fmt(g.ms)}</b></div>`)
    .join('')}${rows.length > shown.length ? `<div class="board-more">${rows.length} racers today</div>` : ''}</div>`;
}

function canUpload() {
  const best = store.day(dateKey)?.best ?? null;
  // the server takes laps for today and yesterday (Central)
  const open = dateKey === todayKey || dateKey === addDays(todayKey, -1);
  return cloudEnabled && open && best != null && store.uploaded(dateKey) !== best;
}

function renderHome() {
  const mine = store.day(dateKey);
  const best = mine?.best ?? null;
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
        <div class="brand"><img class="appmark" src="./icon.svg" alt="" width="28" height="28">Daily lap</div>
        <button class="icon" id="btn-sound" aria-label="${store.sound ? 'Mute' : 'Unmute'}">${store.sound ? ICON_SOUND_ON : ICON_SOUND_OFF}</button>
      </div>
      <span class="eyebrow">No. ${day.number} · ${prettyDate(dateKey)}${isToday ? '' : ` · <a href="#" id="go-today">Play today's track</a>`}</span>
      <canvas class="preview" id="preview"></canvas>
      <h1>${esc(capitalize(day.track.name))}</h1>
      <div class="pb">${best != null
        ? `Your best <b>${fmt(best)}</b>. ${runs} run${runs === 1 ? '' : 's'}.`
        : `No lap yet today. Beat ${esc(day.rookie.name)}'s <b>${fmt(day.rookie.ms)}</b>.`}${streak > 1 ? ` ${streak} days in a row.` : ''}</div>
      ${challengeHtml}
      ${ghostBoard()}
      <div class="stack">
        <button class="primary" id="btn-race">${best != null ? 'Race again' : 'Race'}</button>
        ${best != null ? `<div class="row">
          ${canUpload() ? '<button class="secondary" id="btn-upload-home">Upload ghost</button>' : ''}
          <button class="secondary" id="btn-share-home">Share link</button>
        </div>` : ''}
      </div>
      <p class="how">Hold the <b>left</b> or <b>right</b> side of the screen to steer, or use the arrow keys. The car drives itself. One lap, as fast as you can. Walls slow you down.</p>
      <div class="foot">${isToday ? `New track in ${timeToMidnight()}` : `Track from ${prettyDate(dateKey)}`}${cloudEnabled ? ` · Crew: ${esc(crew())} <a href="#" id="btn-crew">change</a>` : ''}</div>
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
  const up = $('#btn-upload-home');
  if (up) up.onclick = () => doUpload(up);
  const cr = $('#btn-crew');
  if (cr) {
    cr.onclick = (e) => {
      e.preventDefault();
      const next = window.prompt('Crew code. Everyone with the same code shares a board. Leave empty for the public board.', crew() === DEFAULT_CREW ? '' : crew());
      if (next === null) return;
      store.crew = cleanCrew(next);
      renderHome();
      refreshHome(0);
    };
  }
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
  let vs = '';
  if (r.finished) {
    const others = listGhosts(day).filter((g) => g.kind !== 'you').slice(0, 4);
    vs = others
      .map((g) => (r.ms < g.ms
        ? `<div>You beat <b>${esc(g.name)}</b> by ${fmt(g.ms - r.ms)}.</div>`
        : `<div><b>${esc(g.name)}</b> is ahead by ${fmt(r.ms - g.ms)}.</div>`))
      .join('');
    if (vs) vs = `<div class="vs">${vs}</div>`;
  }

  $('#finish').innerHTML = `
    <div class="card">
      <span class="label">No. ${day.number} · ${esc(capitalize(day.track.name))}</span>
      <div class="result">${headline}</div>
      <div class="sub">${sub}</div>
      ${vs}
      <button class="primary" id="btn-again">Race again</button>
      ${best != null ? `<div class="row">
        ${cloudEnabled ? `<button class="secondary" id="btn-upload" ${canUpload() ? '' : 'disabled'}>${canUpload() ? 'Upload ghost' : 'Ghost uploaded'}</button>` : ''}
        <button class="secondary" id="btn-share">Share link</button>
      </div>` : ''}
      <div class="name-row" id="name-row" hidden>
        <input id="name-input" maxlength="14" placeholder="Your name, shown to friends" autocomplete="nickname" />
        <button class="primary" id="btn-name-ok">OK</button>
      </div>
      <button class="link" id="btn-home">Menu</button>
      <div class="hint-keys">Press R to restart anytime.</div>
    </div>`;
  $('#btn-again').onclick = startRace;
  $('#btn-home').onclick = goHome;
  const sh = $('#btn-share');
  if (sh) sh.onclick = () => doShare(sh);
  const up = $('#btn-upload');
  if (up && !up.disabled) up.onclick = () => doUpload(up);
}

// asks for a display name once (inline on the finish screen, else a prompt)
function withName(then) {
  if (store.name) return then();
  const row = $('#name-row');
  if (row && !$('#finish').hidden) {
    row.hidden = false;
    const inp = $('#name-input');
    inp.focus();
    $('#btn-name-ok').onclick = () => {
      store.name = cleanName(inp.value) || 'anon';
      row.hidden = true;
      then();
    };
    return;
  }
  const n = window.prompt('Your name, shown to friends', '');
  if (n === null) return;
  store.name = cleanName(n) || 'anon';
  then();
}

function doUpload(btn) {
  withName(async () => {
    btn.disabled = true;
    btn.textContent = 'Uploading…';
    const res = await uploadBest(dateKey);
    if (res.error) {
      btn.disabled = false;
      btn.textContent = 'Upload ghost';
      toast(capitalize(res.error) + '.');
      return;
    }
    btn.textContent = `Uploaded · #${res.rank}`;
    toast(`Ghost uploaded. You're #${res.rank} of ${res.total} today.`);
    await refreshBoard(dateKey, { maxAgeMs: 0 });
    if (mode === 'home') renderHome();
  });
}

async function doShare(btn) {
  if (!store.name) return withName(() => doShare(btn));
  const mine = store.day(dateKey);
  if (!mine?.best) return;
  const url = challengeUrl({ dateKey, ms: mine.best, name: store.name, inputs: mine.inputs, crew: crew() });
  const text = shareText({ day, ms: mine.best });
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
  initCrew();
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
