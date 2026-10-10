/* A small chime box: the ledger modules call audio.stinger() on big moments. Wyrmhold answers
 * with a struck bell, synthesised (no samples), and only after the warden has touched the page. */
class Chimes {
  private ctx: AudioContext | null = null;
  muted = false;
  private get ac(): AudioContext | null {
    if (this.muted) return null;
    try { this.ctx ??= new AudioContext(); } catch { return null; }
    return this.ctx;
  }
  bell(freq = 523.25, gain = 0.25, decay = 2.4) {
    const ac = this.ac; if (!ac || ac.state === 'suspended') { void ac?.resume(); if (!ac) return; }
    const t = ac.currentTime;
    for (const [mult, g] of [[1, 1], [2.76, 0.45], [5.4, 0.2], [0.5, 0.35]] as const) {
      const o = ac.createOscillator(), v = ac.createGain();
      o.type = 'sine'; o.frequency.value = freq * mult;
      v.gain.setValueAtTime(0, t); v.gain.linearRampToValueAtTime(gain * g, t + 0.01); v.gain.exponentialRampToValueAtTime(0.0001, t + decay / mult ** 0.3);
      o.connect(v).connect(ac.destination); o.start(t); o.stop(t + decay + 0.1);
    }
  }
  stinger(name: 'youExploded' | 'vulnerable' | 'secure' | 'alpha', gain = 0.8) {
    const f = { youExploded: 196, vulnerable: 293.66, secure: 523.25, alpha: 659.25 }[name];
    this.bell(f, 0.22 * gain);
  }
}
/* The sky's own music: a slow modal pad that drifts through four chords, with bells falling now
 * and then like drops of alpha. Synthesised, quiet, and only after the warden touches the page. */
class Ambience {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private timers: number[] = [];
  private voices: { o: OscillatorNode[]; g: GainNode }[] = [];
  on: boolean;
  private listeners = new Set<() => void>();
  constructor() { let v: string | null = null; try { v = localStorage.getItem('wyrmhold.music'); } catch { /* none */ } this.on = v !== 'off'; }
  onChange(f: () => void) { this.listeners.add(f); return () => this.listeners.delete(f); }
  toggle() {
    this.on = !this.on;
    try { localStorage.setItem('wyrmhold.music', this.on ? 'on' : 'off'); } catch { /* memory only */ }
    if (this.on) this.start(); else this.stop();
    this.listeners.forEach((f) => f());
  }
  start() {
    if (!this.on || this.ctx) return;
    try { this.ctx = new AudioContext(); } catch { return; }
    const ac = this.ctx;
    const master = ac.createGain(); master.gain.value = 0; master.gain.linearRampToValueAtTime(0.055, ac.currentTime + 6);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 0.6;
    const lfo = ac.createOscillator(), lfoG = ac.createGain(); lfo.frequency.value = 0.05; lfoG.gain.value = 500; lfo.connect(lfoG).connect(lp.frequency); lfo.start();
    // a long, soft echo
    const delay = ac.createDelay(2); delay.delayTime.value = 0.62; const fb = ac.createGain(); fb.gain.value = 0.38;
    lp.connect(master); lp.connect(delay); delay.connect(fb).connect(delay); delay.connect(master);
    master.connect(ac.destination);
    this.master = master;
    // D dorian, wandering: Dm9 · Fmaj7 · Cadd9 · Am7
    const CHORDS = [[146.83, 220, 261.63, 329.63], [174.61, 220, 261.63, 329.63], [130.81, 196, 293.66, 329.63], [110, 196, 261.63, 329.63]];
    let i = 0;
    const play = () => {
      const now = ac.currentTime;
      const g = ac.createGain(); g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(1, now + 3.5); g.gain.linearRampToValueAtTime(0, now + 11);
      const os = CHORDS[i % CHORDS.length].flatMap((f) => [f, f * 1.003].map((fr, k) => {
        const o = ac.createOscillator(); o.type = k ? 'triangle' : 'sine'; o.frequency.value = fr;
        const v = ac.createGain(); v.gain.value = 0.18; o.connect(v).connect(g); o.start(now); o.stop(now + 11.5); return o;
      }));
      g.connect(lp);
      this.voices.push({ o: os, g });
      if (this.voices.length > 3) this.voices.shift();
      i++;
    };
    play();
    this.timers.push(window.setInterval(play, 8000));
    const bell = () => {
      const scale = [587.33, 659.25, 698.46, 880, 987.77, 1174.66];
      const f = scale[Math.floor(Math.random() * scale.length)];
      const t = ac.currentTime, o = ac.createOscillator(), v = ac.createGain();
      o.type = 'sine'; o.frequency.value = f;
      v.gain.setValueAtTime(0, t); v.gain.linearRampToValueAtTime(0.09, t + 0.01); v.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
      o.connect(v).connect(delay); o.connect(v); v.connect(master); o.start(t); o.stop(t + 3.3);
      this.timers.push(window.setTimeout(bell, 2500 + Math.random() * 6000));
    };
    this.timers.push(window.setTimeout(bell, 3000));
  }
  stop() {
    this.timers.forEach((t) => { clearInterval(t); clearTimeout(t); }); this.timers = [];
    const ac = this.ctx; this.ctx = null;
    if (!ac) return;
    try { this.master?.gain.linearRampToValueAtTime(0, ac.currentTime + 1.2); } catch { /* closed */ }
    setTimeout(() => { void ac.close(); }, 1400);
    this.voices = [];
  }
}

export const audio = new Chimes();
export const ambience = new Ambience();
