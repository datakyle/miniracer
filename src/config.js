// Address of the ghost server (the Cloudflare Worker in /worker).
// Leave empty to run without shared ghosts: share links still work.
// After `npx wrangler deploy`, paste the printed workers.dev URL here.
export const GHOST_API = 'https://miniracer-ghosts.miniracer.workers.dev';

// Tries per player per day. A try is used when the light goes green, so
// backing out during the countdown is free, but restarting mid-lap is not.
export const TRIES_PER_DAY = 5;
