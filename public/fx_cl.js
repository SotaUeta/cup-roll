// ドパガキモードの演出（見た目と音だけ。ゲームの結果には影響しない）
(() => {
  'use strict';
  const FX = {
    on: localStorage.getItem('cupcl:dopa') === '1',
    parts: [],
    texts: [],
    cups: [],
    trail: [],
    banner: null,
    shakeA: 0, shakeT: 0, shakeD: 1,
    flashA: 0, flashColor: '#fff',
    confettiT: 0,
  };

  FX.setOn = (v) => {
    FX.on = v;
    localStorage.setItem('cupcl:dopa', v ? '1' : '0');
    if (v) audio();
    else FX.reset();
  };

  FX.reset = () => {
    FX.parts = []; FX.texts = []; FX.cups = []; FX.trail = [];
    FX.banner = null; FX.shakeT = 0; FX.flashA = 0; FX.confettiT = 0;
  };

  // ---------- 音 ----------
  let ac = null, master = null;
  function audio() {
    if (!ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = 0.22;
      master.connect(ac.destination);
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  FX.unlock = () => { if (FX.on) audio(); };

  const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);
  function tone(freq, at, dur, type = 'square', vol = 0.4, slideTo = 0) {
    const a = audio();
    if (!a) return;
    const t = a.currentTime + at;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(at, dur, vol, freq) {
    const a = audio();
    if (!a) return;
    const n = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, n, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = a.createBufferSource();
    s.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq;
    const g = a.createGain();
    g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(master);
    s.start(a.currentTime + at);
  }

  FX.sfx = {
    launch() { noise(0, 0.3, 0.6, 700); tone(NOTE(48), 0, 0.25, 'triangle', 0.3, NOTE(60)); },
    cup(value, streak) {
      const base = 72 + Math.min(streak, 6) * 2;
      const seq = value >= 5 ? [0, 4, 7, 12, 16, 19, 24] : value >= 2 ? [0, 4, 7, 12] : [0, 7, 12];
      seq.forEach((s, i) => tone(NOTE(base + s), i * 0.055, 0.2, 'square', 0.32));
      if (value >= 5) {
        seq.forEach((s, i) => tone(NOTE(base + s + 12), 0.42 + i * 0.045, 0.18, 'triangle', 0.3));
        noise(0, 0.5, 0.5, 3000);
      }
    },
    zero() { tone(NOTE(52), 0, 0.28, 'sawtooth', 0.35); tone(NOTE(47), 0.3, 0.6, 'sawtooth', 0.35, NOTE(40)); },
    miss() { tone(NOTE(67), 0, 0.6, 'triangle', 0.4, NOTE(40)); },
    pop(k) { tone(NOTE(74 + Math.min(k, 26)), 0, 0.07, 'square', 0.22); },
    win() { [60, 64, 67, 72, 67, 72, 76, 79, 84, 84].forEach((n, i) => tone(NOTE(n), i * 0.09, i === 9 ? 0.6 : 0.18, 'square', 0.33)); },
    lose() { [67, 63, 60, 55].forEach((n, i) => tone(NOTE(n), i * 0.25, 0.35, 'triangle', 0.33)); },
  };

  FX.vibrate = (pattern) => { if (navigator.vibrate) navigator.vibrate(pattern); };

  // ---------- 見た目 ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  FX.burst = (x, y, colors, n, speed) => {
    for (let i = 0; i < n; i++) {
      const ang = rand(Math.PI * 1.05, Math.PI * 1.95) + (Math.random() < 0.3 ? Math.PI * 0.9 : 0);
      const sp = speed * rand(0.3, 1.2);
      FX.parts.push({
        x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, g: 600,
        life: 1, decay: rand(0.5, 1.1), size: rand(2, 5), color: pick(colors),
        rot: rand(0, 6), vr: rand(-12, 12), rect: Math.random() < 0.6,
      });
    }
  };

  FX.confetti = (seconds) => { FX.confettiT = Math.max(FX.confettiT, seconds); };

  FX.text = (str, x, y, o = {}) => {
    FX.texts.push({ str, x, y, t: 0, life: o.life || 1.3, size: o.size || 30, color: o.color || '#fff', vy: o.vy ?? -35 });
  };

  FX.shake = (a, d) => { FX.shakeA = Math.max(a, FX.shakeT > 0 ? FX.shakeA : 0); FX.shakeT = FX.shakeD = d; };
  FX.flash = (color, a) => { FX.flashColor = color; FX.flashA = a; };

  FX.flyCup = (x, y, color, dir) => {
    FX.cups.push({ x, y, vx: dir * rand(140, 260), vy: rand(-260, -160), rot: 0, vr: dir * rand(6, 14), color, life: 1.6 });
  };

  FX.trailPush = (x, y) => { FX.trail.push([x, y]); if (FX.trail.length > 22) FX.trail.shift(); };
  FX.clearTrail = () => { FX.trail = []; };

  FX.setBanner = (str, color) => { FX.banner = { str, color, t: 0 }; };

  FX.offset = () => {
    if (FX.shakeT <= 0) return [0, 0];
    const k = FX.shakeA * (FX.shakeT / FX.shakeD);
    return [rand(-k, k), rand(-k, k)];
  };

  const CONFETTI = ['#ff3b6b', '#ffd23f', '#3bd6ff', '#7bff5a', '#c25bff', '#ffffff', '#ff8a24'];

  FX.update = (dt, W) => {
    if (FX.confettiT > 0) {
      FX.confettiT -= dt;
      for (let i = 0; i < 4; i++) {
        FX.parts.push({
          x: rand(0, W), y: rand(-80, -60), vx: rand(-30, 30), vy: rand(60, 160), g: 40,
          life: 1, decay: 0.22, size: rand(3, 6), color: pick(CONFETTI), rot: rand(0, 6), vr: rand(-8, 8), rect: true,
        });
      }
    }
    for (const p of FX.parts) {
      p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt; p.life -= p.decay * dt;
    }
    FX.parts = FX.parts.filter((p) => p.life > 0);
    for (const t of FX.texts) { t.t += dt; t.y += t.vy * dt; }
    FX.texts = FX.texts.filter((t) => t.t < t.life);
    for (const c of FX.cups) { c.vy += 900 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.rot += c.vr * dt; c.life -= dt; }
    FX.cups = FX.cups.filter((c) => c.life > 0);
    if (FX.shakeT > 0) FX.shakeT -= dt;
    FX.flashA *= Math.pow(0.02, dt);
    if (FX.banner) FX.banner.t += dt;
  };

  function popScale(t) {
    if (t < 0.12) return 0.4 + (t / 0.12) * 1.0;
    if (t < 0.25) return 1.4 - ((t - 0.12) / 0.13) * 0.4;
    return 1;
  }

  function outlinedText(ctx, str, x, y, size, color) {
    ctx.font = `900 ${size}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.22;
    ctx.strokeStyle = '#1b1020';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  FX.drawTrail = (ctx, r, now) => {
    const n = FX.trail.length;
    FX.trail.forEach(([x, y], i) => {
      ctx.globalAlpha = (i + 1) / n * 0.7;
      ctx.fillStyle = `hsl(${(now * 0.4 + i * 16) % 360}, 95%, 60%)`;
      ctx.beginPath();
      ctx.arc(x, y, r * (0.4 + 0.6 * (i + 1) / n), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  };

  FX.draw = (ctx) => {
    for (const c of FX.cups) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.globalAlpha = Math.min(1, c.life);
      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.moveTo(-9, -11); ctx.lineTo(9, -11); ctx.lineTo(6, 11); ctx.lineTo(-6, 11); ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    for (const p of FX.parts) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.5));
      ctx.fillStyle = p.color;
      if (p.rect) {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    for (const t of FX.texts) {
      const s = popScale(t.t);
      ctx.globalAlpha = Math.min(1, (t.life - t.t) / 0.3);
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(s, s);
      outlinedText(ctx, t.str, 0, 0, t.size, t.color);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  };

  // 画面全体に重ねるもの（揺れの外で描く）
  FX.drawOverlay = (ctx, view, cx, cy) => {
    if (FX.flashA > 0.01) {
      ctx.globalAlpha = FX.flashA;
      ctx.fillStyle = FX.flashColor;
      ctx.fillRect(view.x0, view.y0, view.w, view.h);
      ctx.globalAlpha = 1;
    }
    if (FX.banner) {
      const b = FX.banner;
      const s = popScale(b.t) * (1 + Math.sin(b.t * 6) * 0.04);
      ctx.save();
      ctx.font = '900 58px sans-serif';
      const fit = Math.min(1, (view.w * 0.82) / ctx.measureText(b.str).width);
      ctx.translate(cx, cy);
      ctx.rotate(-0.08);
      ctx.scale(s * fit, s * fit);
      outlinedText(ctx, b.str, 0, 0, 58, b.color);
      ctx.restore();
    }
  };

  window.FX = FX;
})();
