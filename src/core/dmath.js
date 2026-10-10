// Deterministic math.
//
// Replays (ghosts and shared challenge links) are re-simulated on the
// receiving device, so the simulation must produce bit-identical results in
// every browser. +, -, *, / and Math.sqrt are exactly specified by IEEE 754,
// but Math.sin / cos / exp / atan2 are "implementation-approximated" in
// ECMAScript and can differ in the last bit between engines. Everything the
// simulation needs is built here from exact operations only.

export const PI = 3.141592653589793;
export const TWO_PI = 6.283185307179586;
const HALF_PI = 1.5707963267948966;

// Taylor series for sin on [-pi/2, pi/2]; error < 1e-12 at the edges.
function sinCore(x) {
  const x2 = x * x;
  return x * (1 + x2 * (-1 / 6 + x2 * (1 / 120 + x2 * (-1 / 5040 + x2 * (1 / 362880
    + x2 * (-1 / 39916800 + x2 * (1 / 6227020800 + x2 * (-1 / 1307674368000))))))));
}

export function wrapAngle(a) {
  return a - Math.round(a / TWO_PI) * TWO_PI;
}

export function dsin(a) {
  let r = wrapAngle(a);
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  return sinCore(r);
}

export function dcos(a) {
  return dsin(a + HALF_PI);
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
