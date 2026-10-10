// Tiny procedural sound: an engine tone that follows speed, tyre hiss while
// sliding, and a thump on wall hits. Starts on the first user gesture.

export function createAudio() {
  let ac = null;
  let engine, engineGain, hissGain, master;
  let muted = false;

  function init() {
    if (ac) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ac = new AC();
    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.5;
    master.connect(ac.destination);

    engine = ac.createOscillator();
    engine.type = 'sawtooth';
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    engineGain = ac.createGain();
    engineGain.gain.value = 0;
    engine.connect(lp).connect(engineGain).connect(master);
    engine.start();

    const len = ac.sampleRate;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    const noise = ac.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    bp.Q.value = 0.8;
    hissGain = ac.createGain();
    hissGain.gain.value = 0;
    noise.connect(bp).connect(hissGain).connect(master);
    noise.start();
  }

  return {
    unlock() {
      init();
      if (ac && ac.state === 'suspended') ac.resume();
    },
    setMuted(v) {
      muted = v;
      if (master) master.gain.setTargetAtTime(v ? 0 : 0.5, ac.currentTime, 0.02);
    },
    update(running, speedRatio, slip) {
      if (!ac) return;
      const t = ac.currentTime;
      engine.frequency.setTargetAtTime(55 + speedRatio * 150, t, 0.05);
      engineGain.gain.setTargetAtTime(running ? 0.07 + speedRatio * 0.05 : 0, t, 0.08);
      const h = running && speedRatio > 0.3 ? Math.min(1, Math.max(0, (slip - 0.12) * 3)) : 0;
      hissGain.gain.setTargetAtTime(h * 0.08, t, 0.05);
    },
    bump(strength) {
      if (!ac || muted) return;
      const t = ac.currentTime;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(120, t);
      o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
      g.gain.setValueAtTime(Math.min(0.4, 0.1 + strength * 0.03), t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + 0.2);
    },
    beep(high) {
      if (!ac || muted) return;
      const t = ac.currentTime;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'square';
      o.frequency.value = high ? 880 : 440;
      g.gain.setValueAtTime(0.06, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + (high ? 0.35 : 0.15));
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + 0.4);
    },
  };
}
