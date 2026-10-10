// Steering input: hold the left or right half of the screen, or use
// arrow keys / A-D. Multi-touch safe: each finger is tracked separately and
// the steer value is (right held) - (left held).

export function createInput(target) {
  const pointers = new Map();
  const keys = { left: false, right: false };
  let enabled = false;
  let onRestart = null;

  const sideOf = (e) => (e.clientX < window.innerWidth / 2 ? 'left' : 'right');

  target.addEventListener('pointerdown', (e) => {
    if (!enabled) return;
    pointers.set(e.pointerId, sideOf(e));
    target.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  const release = (e) => pointers.delete(e.pointerId);
  target.addEventListener('pointerup', release);
  target.addEventListener('pointercancel', release);
  target.addEventListener('lostpointercapture', release);
  target.addEventListener('pointermove', (e) => {
    // sliding a finger across the middle switches direction
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, sideOf(e));
  });
  target.addEventListener('contextmenu', (e) => e.preventDefault());

  const keyDir = (e) => {
    const k = e.key.toLowerCase();
    if (k === 'arrowleft' || k === 'a') return 'left';
    if (k === 'arrowright' || k === 'd') return 'right';
    return null;
  };
  window.addEventListener('keydown', (e) => {
    const d = keyDir(e);
    if (d) {
      keys[d] = true;
      e.preventDefault();
    } else if (e.key.toLowerCase() === 'r' && onRestart && !e.repeat) {
      onRestart();
    }
  });
  window.addEventListener('keyup', (e) => {
    const d = keyDir(e);
    if (d) keys[d] = false;
  });
  window.addEventListener('blur', () => {
    keys.left = keys.right = false;
    pointers.clear();
  });

  return {
    steer() {
      let l = keys.left;
      let r = keys.right;
      for (const side of pointers.values()) {
        if (side === 'left') l = true;
        else r = true;
      }
      return (r ? 1 : 0) - (l ? 1 : 0);
    },
    held() {
      let l = keys.left;
      let r = keys.right;
      for (const side of pointers.values()) {
        if (side === 'left') l = true;
        else r = true;
      }
      return { left: l, right: r };
    },
    setEnabled(v) {
      enabled = v;
      if (!v) pointers.clear();
    },
    onRestart(fn) {
      onRestart = fn;
    },
  };
}
