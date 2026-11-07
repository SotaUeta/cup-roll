// 物理演算とルール。サーバー(Node)とブラウザの両方で読み込む。
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.CupGame = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 座標系: テーブルは x∈[0,W], y∈[0,L]。y=0 が手前の端（カップ側）、投げる位置は y=LAUNCH_Y。
  const C = {
    W: 360,
    L: 640,
    BALL_R: 7,
    WALL: 22,              // 左右の伏せカップ（壁）の内側の位置
    CUP_R: 20,
    CUP_PITCH: 48,
    CUP_Y: -22,
    CUP_VALUES: [2, 1, 'X', 5, 'X', 1, 2],
    X_VALUE: -3,
    CATCH: 13,             // カップ中心からこの距離以内なら入る
    RIM: 22,               // ここまではフチに当たって跳ね返る。その外側は隙間に落ちる
    LAUNCH_Y: 590,
    MAX_SPEED: 900,
    DECEL: 260,            // 転がり抵抗（減速量 / 秒）
    MAX_ENTRY_SPEED: 420,  // これより速く端に来た球はカップを飛び越える
    MAX_ANGLE: 0.6,
    MIN_POWER: 0.05,
    WALL_E: 0.5,
    BALL_E: 0.9,
    BALLS_PER_PLAYER: 6,
    DT: 1 / 240,
    REC_EVERY: 8,          // 30fps で記録
    MAX_STEPS: 240 * 20,
  };
  const CUP_X = C.CUP_VALUES.map((_, i) => C.W / 2 + (i - 3) * C.CUP_PITCH);

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const r1 = (v) => Math.round(v * 10) / 10;

  function cupValue(i) {
    const v = C.CUP_VALUES[i];
    return v === 'X' ? C.X_VALUE : v;
  }

  function newGame(names, first) {
    return {
      phase: 'playing',
      names: [names[0], names[1]],
      first,
      turn: first,
      left: [C.BALLS_PER_PLAYER, C.BALLS_PER_PLAYER],
      balls: [],                       // {id, owner, x, y, where:'table'|'cup', cup}
      cups: C.CUP_VALUES.map(() => null), // 入っている球の id
      nextId: 1,
      shotNo: 0,
    };
  }

  function scores(state) {
    const s = [0, 0];
    state.cups.forEach((id, i) => {
      if (id == null) return;
      const b = state.balls.find((x) => x.id === id);
      if (b) s[b.owner] += cupValue(i);
    });
    return s;
  }

  function simulate(s) {
    const R = C.BALL_R;
    const frames = [];
    const events = [];
    const byId = new Map(s.balls.map((b) => [b.id, b]));
    for (const b of s.balls) { b.vx = b.vx || 0; b.vy = b.vy || 0; }

    const onTable = () => s.balls.filter((b) => b.where === 'table');
    const rec = () => frames.push(onTable().map((b) => [b.id, r1(b.x), r1(b.y)]));
    const out = (b, reason) => {
      b.where = 'out';
      events.push({ f: frames.length, type: 'out', id: b.id, reason });
    };

    const edge = (b) => {
      const sp = Math.hypot(b.vx, b.vy);
      const i = clamp(Math.round((b.x - CUP_X[0]) / C.CUP_PITCH), 0, CUP_X.length - 1);
      const dx = b.x - CUP_X[i];
      if (sp > C.MAX_ENTRY_SPEED) return out(b, 'over');
      if (Math.abs(dx) <= C.CATCH) {
        const prev = s.cups[i];
        if (prev != null) byId.get(prev).where = 'out';
        s.cups[i] = b.id;
        b.where = 'cup'; b.cup = i; b.x = CUP_X[i]; b.y = C.CUP_Y; b.vx = 0; b.vy = 0;
        events.push({ f: frames.length, type: 'cup', id: b.id, cup: i, kicked: prev });
      } else if (Math.abs(dx) <= C.RIM) {
        // フチに当たって手前に跳ね返る
        b.y = 0.5;
        b.vy = Math.abs(b.vy) * 0.35;
        b.vx += Math.sign(dx) * 30;
      } else {
        out(b, 'gap');
      }
    };

    rec();
    for (let step = 1; step <= C.MAX_STEPS; step++) {
      const tb = onTable();
      for (const b of tb) {
        const sp = Math.hypot(b.vx, b.vy);
        if (sp === 0) continue;
        const ns = sp - C.DECEL * C.DT;
        if (ns <= 1.5) { b.vx = 0; b.vy = 0; continue; }
        b.vx *= ns / sp; b.vy *= ns / sp;
        b.x += b.vx * C.DT; b.y += b.vy * C.DT;
      }
      for (const b of tb) {
        if (b.x < C.WALL + R) { b.x = C.WALL + R; b.vx = Math.abs(b.vx) * C.WALL_E; b.vy *= 0.9; }
        if (b.x > C.W - C.WALL - R) { b.x = C.W - C.WALL - R; b.vx = -Math.abs(b.vx) * C.WALL_E; b.vy *= 0.9; }
      }
      for (let i = 0; i < tb.length; i++) {
        for (let j = i + 1; j < tb.length; j++) {
          const a = tb[i], b = tb[j];
          const dx = b.x - a.x, dy = b.y - a.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= 4 * R * R || d2 === 0) continue;
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
          const push = (2 * R - d) / 2;
          a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
          const rv = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
          if (rv > 0) {
            const k = ((1 + C.BALL_E) * rv) / 2;
            a.vx -= k * nx; a.vy -= k * ny; b.vx += k * nx; b.vy += k * ny;
          }
        }
      }
      for (const b of tb) {
        if (b.where !== 'table') continue;
        if (b.y <= 0) edge(b);
        else if (b.y > C.L + R) out(b, 'back');
      }
      const moving = onTable().some((b) => b.vx !== 0 || b.vy !== 0);
      if (step % C.REC_EVERY === 0 || !moving) rec();
      if (!moving) break;
    }
    for (const b of s.balls) { delete b.vx; delete b.vy; }
    s.balls = s.balls.filter((b) => b.where !== 'out');
    return { frames, events };
  }

  // shot: {x, angle, power}。angle=0 で真っ直ぐ、power は 0〜1
  function applyShot(state, seat, shot) {
    if (state.phase !== 'playing') return { error: 'not_playing' };
    if (seat !== state.turn) return { error: 'not_your_turn' };
    if (state.left[seat] <= 0) return { error: 'no_balls' };
    const x = Number(shot && shot.x), a = Number(shot && shot.angle), p = Number(shot && shot.power);
    if (![x, a, p].every(Number.isFinite)) return { error: 'bad_shot' };

    const s = JSON.parse(JSON.stringify(state));
    const ang = clamp(a, -C.MAX_ANGLE, C.MAX_ANGLE);
    const pow = clamp(p, C.MIN_POWER, 1);
    const ball = {
      id: s.nextId++,
      owner: seat,
      x: clamp(x, C.WALL + C.BALL_R + 1, C.W - C.WALL - C.BALL_R - 1),
      y: C.LAUNCH_Y,
      where: 'table',
      cup: -1,
      vx: Math.sin(ang) * pow * C.MAX_SPEED,
      vy: -Math.cos(ang) * pow * C.MAX_SPEED,
    };
    s.balls.push(ball);
    s.left[seat]--;
    s.shotNo++;

    const { frames, events } = simulate(s);

    const other = 1 - seat;
    if (s.left[other] > 0) s.turn = other;
    else if (s.left[seat] > 0) s.turn = seat;
    else { s.phase = 'over'; s.turn = -1; }

    return { state: s, frames, events, newBall: { id: ball.id, owner: seat } };
  }

  return { C, CUP_X, cupValue, newGame, scores, applyShot, clamp };
});
