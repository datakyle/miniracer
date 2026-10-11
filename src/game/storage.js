// Everything lives in localStorage. No accounts.

// bump when tracks or physics change: saved laps only replay on the track they were driven on
const KEY = 'dailylap:v5';
const KEEP_DAYS = 45;

function blank() {
  return { name: '', sound: true, ghost: true, days: {}, friends: {} };
}

let data = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    return { ...blank(), ...JSON.parse(raw) };
  } catch {
    return blank();
  }
}

// identity lives under its own key so it survives the version bumps above
const PROFILE_KEY = 'dailylap:profile';
let profile = loadProfile();

function loadProfile() {
  try {
    return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {};
  } catch {
    return {};
  }
}

function saveProfile() {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // ignore
  }
}

function randomId() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // private mode or full: the game still works for this session
  }
}

export function prune(todayKey) {
  const cutoff = Date.parse(`${todayKey}T00:00:00Z`) - KEEP_DAYS * 86400000;
  for (const bucket of [data.days, data.friends]) {
    for (const k of Object.keys(bucket)) {
      if (Date.parse(`${k}T00:00:00Z`) < cutoff) delete bucket[k];
    }
  }
  save();
}

export const store = {
  // anonymous id for the ghost server: one per browser, never shown
  get playerId() {
    if (!profile.playerId) {
      profile.playerId = randomId();
      saveProfile();
    }
    return profile.playerId;
  },
  get crew() {
    return profile.crew || null;
  },
  set crew(v) {
    profile.crew = v;
    saveProfile();
  },
  uploaded(dateKey) {
    return data.days[dateKey]?.uploaded ?? null;
  },
  markUploaded(dateKey, ms) {
    const d = data.days[dateKey];
    if (!d) return;
    d.uploaded = ms;
    save();
  },
  get name() {
    return data.name;
  },
  set name(v) {
    data.name = v;
    save();
  },
  get sound() {
    return data.sound;
  },
  set sound(v) {
    data.sound = v;
    save();
  },
  get ghost() {
    return data.ghost;
  },
  set ghost(v) {
    data.ghost = v;
    save();
  },
  day(dateKey) {
    return data.days[dateKey] || null;
  },
  // returns true when this run is a new personal best
  recordRun(dateKey, ms, inputsEncoded) {
    const d = data.days[dateKey] || { best: null, inputs: null, runs: 0 };
    d.runs += 1;
    const isBest = d.best == null || ms < d.best;
    if (isBest) {
      d.best = ms;
      d.inputs = inputsEncoded;
    }
    data.days[dateKey] = d;
    save();
    return isBest;
  },
  markPlayed(dateKey) {
    const d = data.days[dateKey] || { best: null, inputs: null, runs: 0 };
    data.days[dateKey] = d;
    save();
  },
  friends(dateKey) {
    return data.friends[dateKey] || {};
  },
  addFriend(dateKey, name, ms, inputs) {
    const f = data.friends[dateKey] || {};
    const prev = f[name];
    if (!prev || ms <= prev.ms) f[name] = { ms, inputs };
    data.friends[dateKey] = f;
    save();
  },
  streak(todayKey) {
    let count = 0;
    let t = Date.parse(`${todayKey}T00:00:00Z`);
    // today not finished yet doesn't break the streak
    if (!data.days[todayKey]?.best) t -= 86400000;
    for (;;) {
      const k = new Date(t).toISOString().slice(0, 10);
      if (!data.days[k]?.best) break;
      count++;
      t -= 86400000;
    }
    return count;
  },
};
