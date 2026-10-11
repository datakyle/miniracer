// Ghost server. Stores each player's best lap per day and crew.
//
// The server never trusts a submitted time. It rebuilds the day's track and
// re-simulates the steering inputs with the same code the game runs, and
// stores the time that comes out. A lap that doesn't finish is rejected.
//
//   GET  /ghosts?date=YYYY-MM-DD&crew=code  -> { ghosts: [{ name, ms, inputs, pid }] }
//   POST /ghosts  { date, crew, player, name, inputs } -> { ms, best, rank, total }

import { trackFor, dateKeyAt, addDays, isDateKey } from '../../src/core/day.js';
import { runInputs, timeMs } from '../../src/core/sim.js';
import { decodeInputs, encodeInputs } from '../../src/core/replay.js';
import { hashString } from '../../src/core/rng.js';
import { cleanName, cleanCrew } from '../../src/core/names.js';

const BOARD_SIZE = 30;
// a single crew can't grow without bound in a day
const MAX_PER_DAY = 500;
const MAX_INPUTS_LEN = 6000;

export function pidFor(player) {
  return hashString(`pid|${player}`).toString(16);
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS, ...extra },
  });
}

const fail = (status, error) => json({ error }, status);

// days a lap may be uploaded for: today and yesterday (Central), so a lap
// finished just before midnight still counts
function openDays(now) {
  const today = dateKeyAt(now);
  return [today, addDays(today, -1)];
}

async function getBoard(db, url) {
  const date = url.searchParams.get('date');
  if (!isDateKey(date)) return fail(400, 'bad date');
  const crew = cleanCrew(url.searchParams.get('crew'));
  const { results } = await db
    .prepare('SELECT name, ms, inputs, pid FROM ghosts WHERE date = ? AND crew = ? ORDER BY ms ASC, updated_at ASC LIMIT ?')
    .bind(date, crew, BOARD_SIZE)
    .all();
  return json({ date, crew, ghosts: results }, 200, { 'cache-control': 'public, max-age=10' });
}

// validates and re-simulates an upload; returns { error } or the clean fields
export function verifyUpload(body, now = Date.now()) {
  if (!body || typeof body !== 'object') return { error: 'bad body' };
  const { date, player, inputs } = body;
  if (!isDateKey(date) || !openDays(now).includes(date)) return { error: 'that day is closed' };
  if (typeof player !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(player)) return { error: 'bad player id' };
  if (typeof inputs !== 'string' || inputs.length > MAX_INPUTS_LEN || !/^[A-Za-z0-9_-]+$/.test(inputs)) {
    return { error: 'bad lap' };
  }
  let frames;
  try {
    frames = decodeInputs(inputs);
  } catch {
    return { error: 'bad lap' };
  }
  const result = runInputs(trackFor(date), frames);
  if (!result.finished) return { error: 'lap does not finish' };
  // store the lap trimmed at the finish line, so padding a copied lap with
  // extra frames doesn't make it look like a different lap
  const canonical = encodeInputs(frames.slice(0, result.frame));
  return {
    date,
    crew: cleanCrew(body.crew),
    player,
    pid: pidFor(player),
    name: cleanName(body.name) || 'anon',
    inputs: canonical,
    ms: timeMs(result.finishTime),
  };
}

async function postGhost(db, request, now) {
  const text = await request.text();
  if (text.length > MAX_INPUTS_LEN + 1000) return fail(413, 'too big');
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, 'bad json');
  }
  const lap = verifyUpload(body, now);
  if (lap.error) return fail(422, lap.error);

  const existing = await db
    .prepare('SELECT ms FROM ghosts WHERE date = ? AND crew = ? AND player = ?')
    .bind(lap.date, lap.crew, lap.player)
    .first();
  if (!existing) {
    const count = await db.prepare('SELECT COUNT(*) AS n FROM ghosts WHERE date = ? AND crew = ?').bind(lap.date, lap.crew).first();
    if (count.n >= MAX_PER_DAY) return fail(429, 'board is full today');
    // the same lap uploaded under a second player id is a copy, not a new driver
    const dupe = await db
      .prepare('SELECT 1 AS d FROM ghosts WHERE date = ? AND crew = ? AND inputs = ? AND player != ?')
      .bind(lap.date, lap.crew, lap.inputs, lap.player)
      .first();
    if (dupe) return fail(409, 'that lap is already on the board');
  }

  // keep the faster lap; the name always follows the latest upload
  await db
    .prepare(
      `INSERT INTO ghosts (date, crew, player, pid, name, ms, inputs, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (date, crew, player) DO UPDATE SET
         name = excluded.name,
         ms = CASE WHEN excluded.ms < ghosts.ms THEN excluded.ms ELSE ghosts.ms END,
         inputs = CASE WHEN excluded.ms < ghosts.ms THEN excluded.inputs ELSE ghosts.inputs END,
         updated_at = CASE WHEN excluded.ms < ghosts.ms THEN excluded.updated_at ELSE ghosts.updated_at END`,
    )
    .bind(lap.date, lap.crew, lap.player, lap.pid, lap.name, lap.ms, lap.inputs, now)
    .run();

  const best = existing ? Math.min(existing.ms, lap.ms) : lap.ms;
  const rank = await db
    .prepare('SELECT COUNT(*) AS faster FROM ghosts WHERE date = ? AND crew = ? AND ms < ?')
    .bind(lap.date, lap.crew, best)
    .first();
  const total = await db.prepare('SELECT COUNT(*) AS n FROM ghosts WHERE date = ? AND crew = ?').bind(lap.date, lap.crew).first();
  return json({ ms: lap.ms, best, rank: rank.faster + 1, total: total.n, crew: lap.crew });
}

export async function handle(request, env, now = Date.now()) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (url.pathname === '/ghosts' && request.method === 'GET') return getBoard(env.DB, url);
  if (url.pathname === '/ghosts' && request.method === 'POST') return postGhost(env.DB, request, now);
  if (url.pathname === '/') return json({ ok: true, today: dateKeyAt(now) });
  return fail(404, 'not found');
}
