# Daily lap

A two-minute daily habit: one lap, one new track, and a link that lets a friend race your exact lap. It runs in a phone browser. No login, no app, no server.

- **A new track every day.** The date seeds a procedural generator, so everyone gets the same track.
- **Two buttons.** Hold the left or right half of the screen (or ← → / A D). The car drives itself, and steering hard makes it slide.
- **One lap.** Walls slow you down but never end the run. Press ↺ (or R) to restart at any time.
- **Medals.** A built-in bot drives every track to set the gold, silver and bronze times.
- **Race your friends.** "Share best" sends a link that holds your whole lap. Your friend races your ghost and sees your time on a friends board.

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

This is the dark inversion of the Kyle Bautista design language: Inter at 400/500/600, `#1d1d1f` surfaces, hairline borders instead of shadows, and sentence case. Blue (`#0d74ce`) appears only on actions. Warm amber (`#B8906A`) appears once per screen, as the brand dot, and as the player's car. The tokens live at the top of `src/styles.css`. Track palettes are in `THEMES` in `src/core/track.js`.

## Layout

```
src/core/        pure, deterministic, no DOM
  rng.js         string hash + mulberry32
  dmath.js       deterministic sin/cos
  track.js       procedural track: polar points -> centripetal Catmull-Rom -> resample -> validate
  sim.js         car physics (auto throttle, yaw, grip/drift, walls, checkpoints, sub-frame finish)
  bot.js         pursuit driver: proves the track is drivable and sets medal times
  replay.js      input codec
  day.js         date -> { track, medals, bot lap }
src/game/        browser side
  render.js      canvas renderer (themes, curbs, skid marks, ghosts, scenery)
  input.js       multi-touch halves + keyboard
  audio.js       procedural engine / tyre / bump sounds
  share.js       challenge links + verification
  storage.js     localStorage (bests, ghosts, friends, streak)
src/main.js      game loop, screens
```

## Run

```
npm install
npm run dev        # http://localhost:5173  (add ?bot to let the bot drive, dev only)
npm test
npm run build      # static site in dist/
```

## Deploy

`.github/workflows/deploy.yml` builds and publishes to GitHub Pages on every push to
`main`. To turn it on, go to Settings → Pages → Source and choose "GitHub Actions". Pages
on a private repo needs a paid plan. Otherwise, make the repo public, or drop `dist/` on
any static host (Netlify, Vercel, Cloudflare Pages).

## Tuning

- Handling: `TUNING` in `src/core/sim.js`
- Track shape and size: constants at the top of `src/core/track.js`
- Medal difficulty: `MEDAL_FACTORS` in `src/core/day.js`

Changing any of these changes the tracks or the physics, so old challenge links stop
verifying.
