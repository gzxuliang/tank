// 音频管理器：WebAudio 程序合成 8-bit 音效与简易 BGM，无外部音频文件
export class AudioMan {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.bgmTimer = null;
    this.bgmName = null;
  }

  // 浏览器要求首次用户交互后才能创建 AudioContext
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.35;
    return this.muted;
  }

  // ---- 基础合成原语 ----
  tone({ freq = 440, dur = 0.1, type = 'square', vol = 0.5, slide = 0, delay = 0 }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  noise({ dur = 0.2, vol = 0.5, freq = 1200, q = 1, slideTo = 0, delay = 0 }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.max(1, (dur + 0.05) * this.ctx.sampleRate);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t0);
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0); src.stop(t0 + dur + 0.05);
  }

  // ---- 具体音效 ----
  shoot()      { this.tone({ freq: 900, dur: 0.07, type: 'square', vol: 0.25, slide: -500 }); }
  hitWall()    { this.noise({ dur: 0.08, vol: 0.3, freq: 2500, q: 2 }); }
  hitSteel()   { this.tone({ freq: 2200, dur: 0.09, type: 'triangle', vol: 0.3, slide: -1200 });
                 this.noise({ dur: 0.05, vol: 0.15, freq: 4000, q: 3 }); }
  hitTank()    { this.noise({ dur: 0.12, vol: 0.35, freq: 900, q: 1 }); }
  explodeSmall(){ this.noise({ dur: 0.18, vol: 0.4, freq: 700, q: 0.8, slideTo: 150 }); }
  explodeBig() {
    this.noise({ dur: 0.45, vol: 0.6, freq: 500, q: 0.6, slideTo: 80 });
    this.tone({ freq: 110, dur: 0.4, type: 'sawtooth', vol: 0.35, slide: -70 });
  }
  powerupSpawn(){ this.tone({ freq: 1320, dur: 0.1, type: 'sine', vol: 0.3 });
                  this.tone({ freq: 1760, dur: 0.12, type: 'sine', vol: 0.25, delay: 0.08 }); }
  powerupPick() {
    [660, 880, 1100, 1320].forEach((f, i) =>
      this.tone({ freq: f, dur: 0.09, type: 'square', vol: 0.22, delay: i * 0.06 }));
  }
  pause()      { this.tone({ freq: 1200, dur: 0.06, vol: 0.25 }); this.tone({ freq: 800, dur: 0.08, vol: 0.25, delay: 0.07 }); }
  freeze()     { this.tone({ freq: 2000, dur: 0.3, type: 'sine', vol: 0.25, slide: -1500 }); }
  grenade()    { this.explodeBig(); this.noise({ dur: 0.6, vol: 0.4, freq: 300, q: 0.5, slideTo: 60 }); }
  oneUp()      { [523, 659, 784, 1047, 1319].forEach((f, i) =>
                   this.tone({ freq: f, dur: 0.1, type: 'square', vol: 0.22, delay: i * 0.07 })); }
  respawn()    { this.tone({ freq: 440, dur: 0.08, type: 'square', vol: 0.2, slide: 440 }); }
  shovel()     { this.tone({ freq: 300, dur: 0.08, type: 'square', vol: 0.3 });
                 this.tone({ freq: 450, dur: 0.1, type: 'square', vol: 0.3, delay: 0.09 }); }

  // ---- 旋律（简易序列器）----
  _playNotes(notes, tempo, type = 'square', vol = 0.2) {
    const beat = 60 / tempo;
    let t = 0;
    for (const [freq, len] of notes) {
      if (freq > 0) this.tone({ freq, dur: beat * len * 0.9, type, vol, delay: t });
      t += beat * len;
    }
    return t * 1000;
  }

  stageStart() {
    // 经典开场式上行号角
    this._playNotes([
      [392, 0.5], [523, 0.5], [659, 0.5], [784, 1],
      [659, 0.5], [784, 1.5],
    ], 240, 'square', 0.22);
  }

  gameOver() {
    this._playNotes([
      [523, 1], [392, 1], [330, 1], [262, 2],
    ], 120, 'triangle', 0.25);
  }

  victory() {
    this._playNotes([
      [523, 0.5], [659, 0.5], [784, 0.5], [1047, 1],
      [784, 0.5], [1047, 1.5], [1319, 2],
    ], 200, 'square', 0.22);
  }

  // 标题画面循环 BGM（进行曲风格小循环）
  startBgm(name) {
    this.stopBgm();
    this.bgmName = name;
    if (!this.ctx) return;
    const loop = () => {
      if (this.bgmName !== name) return;
      const melody = name === 'title' ? [
        [262, 1], [330, 1], [392, 1], [523, 1.5], [392, 0.5],
        [330, 1], [392, 1], [523, 2],
        [440, 1], [523, 1], [659, 1.5], [523, 0.5],
        [392, 1], [330, 1], [262, 2],
      ] : [];
      const ms = this._playNotes(melody, 150, 'square', 0.12);
      this.bgmTimer = setTimeout(loop, ms + 120);
    };
    loop();
  }

  stopBgm() {
    this.bgmName = null;
    if (this.bgmTimer) { clearTimeout(this.bgmTimer); this.bgmTimer = null; }
  }
}
