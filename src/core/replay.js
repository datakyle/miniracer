// Compact replay codec: run-length encoded inputs, varint packed, base64url.
// A typical lap is a few dozen steering changes, so a whole ghost fits in a
// ~100 character URL fragment.

const INPUT_TO_SYM = { '-1': 0, 0: 1, 1: 2 };
const SYM_TO_INPUT = [-1, 0, 1];

export function encodeInputs(inputs) {
  const bytes = [];
  const pushVarint = (v) => {
    while (v >= 0x80) {
      bytes.push((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    bytes.push(v);
  };
  let i = 0;
  while (i < inputs.length) {
    const cur = inputs[i];
    let j = i;
    while (j < inputs.length && inputs[j] === cur) j++;
    pushVarint((j - i) * 3 + INPUT_TO_SYM[cur]);
    i = j;
  }
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeInputs(str, maxFrames = 120 * 120) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = [];
  let v = 0;
  let mul = 1;
  for (let k = 0; k < bin.length; k++) {
    const b = bin.charCodeAt(k);
    v += (b & 0x7f) * mul;
    if (b & 0x80) {
      mul *= 128;
      continue;
    }
    const sym = v % 3;
    const len = (v - sym) / 3;
    if (out.length + len > maxFrames) throw new Error('replay too long');
    for (let r = 0; r < len; r++) out.push(SYM_TO_INPUT[sym]);
    v = 0;
    mul = 1;
  }
  return out;
}
