<p align="center"><img src="logo.svg" alt="Daily lap logo" width="132" height="132"></p>

# Daily lap

A two-minute daily habit: one lap, one new track, and a link that lets a friend race your exact lap. It runs in a phone browser. No login, no app, no server.

### [Play today's lap → datakyle.github.io/miniracer](https://datakyle.github.io/miniracer/)

Open it on your phone. Hold the left or right side of the screen to steer. When you finish, tap **Share best** and send the link to a friend. They race your ghost on the same track.

- **A new track every day.** The date seeds a procedural generator, so everyone gets the same track.
- **Two buttons.** Hold the left or right half of the screen (or ← → / A D). The car drives itself, and steering hard makes it slide.
- **One lap.** Walls slow you down but never end the run. Press ↺ (or R) to restart at any time.
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
- **Dirt:** a brown or red-clay track with ruts, hay bales or tyre stacks on the outside of corners, and dust when you slide.

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
  day.js         date -> { track, bot lap, starter ghost }
src/game/        browser side
  render.js      canvas renderer (themes, curbs, skid marks, ghosts, scenery)
  input.js       multi-touch halves + keyboard
  audio.js       procedural engine / tyre / bump sounds
  share.js       challenge links + verification
  storage.js     localStorage (bests, ghosts, friends, streak)
  ghosts.js      which ghosts exist for a day; the seam for a future shared ghost server
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
