<p align="center"><img src="logo.svg" alt="Daily lap logo" width="132" height="132"></p>

# Daily lap

A two-minute daily habit: one lap, one new track, and a link that lets a friend race your exact lap. It runs in a phone browser. No login, no app, no server.

### [Play today's lap → datakyle.github.io/miniracer](https://datakyle.github.io/miniracer/)

Open it on your phone. Hold the left or right side of the screen to steer. When you finish, tap **Share best** and send the link to a friend. They race your ghost on the same track.

- **A new track every day.** The date seeds a procedural generator, so everyone gets the same track.
- **Two buttons.** Hold the left or right half of the screen (or ← → / A D). The car drives itself, and steering hard makes it slide.
- **Five tries a day.** One lap per try, and your best counts. A try is used when the light goes green, so backing out during the countdown is free, but restarting mid-lap (↺ or R) uses a try. Walls slow you down but never end a run. The limit is `TRIES_PER_DAY` in `src/config.js`. It's enforced in the browser, so it's an honour system, not anti-cheat.
- **Feel the speed.** A fading racing line trails your car, coloured by speed (blue when slow, orange flat out). A speedometer sits at the bottom. The camera pulls back and the edges darken slightly as you approach top speed.
- **About 10 seconds a lap.** Short enough to run it ten times in a coffee break.
- **A starter ghost.** Every track comes with danger darrell, a below-average driver to race against your first time. Most players beat darrell within a few tries.
- **Race your friends.** "Share best" sends a link that holds your whole lap. Your friend races your ghost, and everyone whose ghost you have shows up on the day's board.

Inspired by Reddit's [Mini Racer](https://github.com/shimrut/mini-racer). All code here is original.

## How sharing works without a backend

A lap is stored as one steering input (-1, 0, +1) per 1/120 s physics step. It is
run-length encoded, varint packed and base64url'd into the URL fragment:

```
https://…/#c=2026-10-10.17557.kyle.oAEFSQU6BUMI…
            date       ms    name  inputs
```

The fragment never reaches a server. When a friend opens the link, their browser
**re-simulates the lap**. The time shown is the replayed time, and a link whose claimed
time matches the replay gets a "verified" tag. Hand-editing the time in the link
doesn't work.

This only holds because the simulation is deterministic on every device.
`Math.sin`, `cos`, `exp` and `pow` can differ in the last bit between JS engines,
so the simulation and track generator use only `+ - * /` and `Math.sqrt` (all exactly
specified by IEEE 754). Sin and cos come from a Taylor polynomial in `src/core/dmath.js`.

## Design

This is the dark inversion of the Kyle Bautista design language: Inter at 400/500/600, `#1d1d1f` surfaces, hairline borders instead of shadows, and sentence case. Blue (`#0d74ce`) appears only on actions. Warm amber (`#B8906A`) appears once per screen, as the brand dot. The tokens live at the top of `src/styles.css`. The race view itself is deliberately louder and doesn't follow the brand palette. Each day's seed picks one of three road types, each in two colour variants (`THEMES` in `src/core/track.js`, drawn by `src/game/render.js`):

- **Circuit:** striped grass, white edge lines, red/white or blue/white curbs on the corners, and a grandstand by the start.
- **Street:** city blocks, sidewalks, white lane edges and a dashed centre line, in a day or neon-night version.
- **Dirt:** a brown or red-clay track with faint ruts, scattered hay bales or tyre stacks outside the corners, and dust when you slide.

The player's car is bright orange with a white outline. Ghosts are vivid colours at about half opacity.

## Layout

```
src/core/        pure, deterministic, no DOM
  rng.js         string hash + mulberry32
  dmath.js       deterministic sin/cos
  track.js       procedural track: polar points -> centripetal Catmull-Rom -> resample -> validate
  sim.js         car physics (auto throttle, yaw, grip/drift, walls, checkpoints, sub-frame finish)
  bot.js         pursuit driver: proves the track is drivable; a laggy variant drives danger darrell, the starter ghost
  replay.js      input codec
  day.js         date -> { track, bot lap, starter ghost }; Central-time days
  schedule.js    generated: which generator attempt each day uses
  names.js       player name and crew code rules (shared with the server)
src/game/        browser side
  render.js      canvas renderer (themes, curbs, skid marks, ghosts, scenery)
  input.js       multi-touch halves + keyboard
  audio.js       procedural engine / tyre / bump sounds
  share.js       challenge links + verification
  storage.js     localStorage (bests, ghosts, friends, streak)
  ghosts.js      which ghosts exist for a day (starter, you, crew, links), and who to race
  cloud.js       talks to the ghost server; fails soft when it isn't configured
src/config.js    GHOST_API: the ghost server's address
worker/          Cloudflare Worker + D1 ghost server (see Shared ghosts)
scripts/         gen-schedule.mjs
src/main.js      game loop, screens
```

## Run

```
npm install
npm run dev        # http://localhost:5173  (add ?bot to let the bot drive, dev only)
npm test
npm run build      # optional: minified static site in dist/
```

## Deploy

The game is live at **https://datakyle.github.io/miniracer/**.

GitHub Pages serves the `main` branch as-is (Settings → Pages → "Deploy from a branch", `main`, `/ (root)`). The source is plain ES modules with relative paths, so it runs in the browser with no build step: every push to `main` is live a minute later. `.nojekyll` stops Pages from running Jekyll on it.

`.github/workflows/ci.yml` runs the tests and a Vite build on every push, so a broken change shows up as a red check.

For other static hosts, either serve the repo root or run `npm run build` and upload `dist/`. Both work from any path.

## Shared ghosts

Players can tap **Upload ghost** after a lap. Their best lap for the day goes to a small server, and everyone on the same **crew** races against it and sees it on the day's board. There are no accounts. Each browser gets a random player id, and the name is whatever the player types.

- **The server checks every lap.** It rebuilds the day's track and re-simulates the uploaded steering with the same code the game runs. It stores the time that comes out, never the time the client claims. A lap that doesn't finish is rejected. A copy of someone else's lap is rejected too, even if it's padded with extra frames.
- **One row per player per day.** A faster upload replaces the old one, and a slower one doesn't.
- **Crews keep groups apart.** Links look like `https://datakyle.github.io/miniracer/?crew=kyles-crew`. Anyone who opens a crew link joins that crew, and **Share link** includes your crew. Without a crew you're on `public`. You can change it from the footer of the home screen.
- **Everyone's day changes at midnight US Central**, wherever they are, so friends always race the same track.

### Cost

$0. The server is a Cloudflare Worker with a D1 database. The free plan includes 5 GB of D1 storage, 5M rows read and 100k rows written per day ([D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)). A friend group uses a tiny fraction of that: a ghost is a few hundred bytes. If the free limit is ever hit, uploads fail until the next UTC day. Nothing is charged.

### One-time setup (about 10 minutes)

On your computer, with Node 20+ installed:

```sh
git clone https://github.com/datakyle/miniracer && cd miniracer/worker
npm install
npx wrangler login                    # opens a browser to sign in to Cloudflare (free account)
npx wrangler d1 create miniracer      # prints a database_id
#   paste that id into worker/wrangler.toml (database_id = "...")
npm run db:remote                     # creates the ghosts table
npm run deploy                        # prints https://miniracer-ghosts.<you>.workers.dev
```

Then put that URL in `src/config.js` (`GHOST_API`), commit and push. GitHub Pages picks it up in a minute, and the Upload button appears.

### Trying it locally

```sh
cd worker && npm install && npm run db:local && npm run dev    # server on http://127.0.0.1:8787
# in another terminal, from the repo root:
npm run dev
# open http://localhost:5173/?api=http://127.0.0.1:8787&crew=test
```

`?api=` points one tab at any ghost server, without touching `src/config.js`.

### Keeping the schedule in sync

The server can't afford to search for each day's track on every request, so `src/core/schedule.js` lists which generator attempt each day uses (through 2028). If you change track generation, physics or the bot, run `node scripts/gen-schedule.mjs`. A test fails until you do.

## Handling

The car follows the "traction lerp" approach common in top-down racers (see the [KidsCanCode Godot car recipe](https://github.com/kidscancode/godot_recipes/blob/master/src-4/content/2D/car_steering.md)). Grip swings the car's velocity toward its nose while keeping its length. It doesn't delete the sideways part, so sliding keeps momentum.

- **Instant steering.** The turn reaches full rate in about 40 ms and stops about 30 ms after release.
- **Drift on demand.** Steering above `driftSpeed` drops to `driftGrip`, so the nose swings past the direction of travel and the car slides about 40°. Letting go or counter-steering snaps it back to full `grip` in about 0.2 s.
- **Momentum.** A hard 90° drift keeps about 90% of top speed. `driftScrub` takes a little speed for wide slides, so a tidy line still wins.
- **Camera.** The camera is locked to the car. Only the look-ahead eases, so the car never trails on screen.

## Tuning

- Handling: `TUNING` in `src/core/sim.js` (see below)
- Track shape and size: constants at the top of `src/core/track.js`
- Lap length: `MIN_LENGTH` / `MAX_LENGTH` in `src/core/track.js` (215 to 290 units is about 9 to 11 s)
- Starter ghost: `ROOKIE_NAME` in `src/core/day.js`, and the `slowdown` in `rookieLap` (`src/core/bot.js`)

Changing any of these changes the tracks or the physics, so old challenge links stop
verifying.
