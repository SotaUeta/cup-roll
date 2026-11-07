// 物理演算とルール。サーバー(Node)とブラウザの両方で読み込む。
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  else root.CupGame = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 座標系: テーブルは x∈[0,W], y∈[0,L]。y=0 がカップ側の端で、テーブルはそちらへ傾いている。
  const C = {
    W: 360,
    L: 640,
    BALL_R: 7,
    WALL: 22,                // 横のコップ（壁）の内側の位置
    SIDE_CUPS: 18,
    SIDE_Y0: 14,             // 横のコップの並び。カップ側から順に置き、投げる側から消える
    SIDE_PITCH: 30,
    SIDE_R: 10,
    CUP_R: 20,
    CUP_PITCH: 48,
    CUP_Y: -22,
    CUP_VALUES: [2, 1, 'X', 5, 'X', 1, 2],
    CUP_CAP: 3,
    CATCH: 13,               // カップ中心からこの距離以内なら入る
    RIM: 22,                 // ここまではフチに当たって跳ね返る。その外側は隙間に落ちる
    LAUNCH_Y: 590,
    LAUNCH_X: [150, 210],    // 中央から少し外れた位置。プレイヤー1は左、プレイヤー2は右
    LAUNCH_SPEED: 150,
    SLOPE: 450,              // 傾きによる加速
    FRICTION: 20,
    WALL_E: 0.5,
    MAX_ANGLE: 1.2,
    DT: 1 / 240,
    REC_EVERY: 8,            // 30fps で記録
    MAX_STEPS: 240 * 12,
  };
  const CUP_X = C.CUP_VALUES.map((_, i) => C.W / 2 + (i - 3) * C.CUP_PITCH);

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const r1 = (v) => Math.round(v * 10) / 10;

  function cupValue(i) {
    const v = C.CUP_VALUES[i];
    return v === 'X' ? 0 : v;
  }

  function newGame(names, first) {
    return {
      phase: 'playing',
      names: [names[0], names[1]],
      first,
      turn: first,
      cups: C.CUP_VALUES.map(() => []), // 各カップに入っている球の id
      balls: [],                        // カップに入った球 {id, owner, cup}
      nextId: 1,
      shotNo: 0,
      winner: null,                     // 0 | 1 | -1(引き分け)
      endReason: null,                  // 'clear' | 'full'
    };
  }

  function scores(state) {
    const s = [0, 0];
    for (const b of state.balls) s[b.owner] += cupValue(b.cup);
    return s;
  }

  function sideLeft(state) {
    return scores(state).map((v) => Math.max(0, C.SIDE_CUPS - v));
  }

  // 横のコップが残っている範囲（y がこれ以下なら壁がある）
  function wallEnd(n) {
    return n > 0 ? C.SIDE_Y0 + (n - 1) * C.SIDE_PITCH + C.SIDE_R : -Infinity;
  }

  function simulate(state, b) {
    const R = C.BALL_R;
    const ends = sideLeft(state).map(wallEnd);
    const frames = [];
    const rec = () => frames.push([r1(b.x), r1(b.y)]);

    const edge = () => {
      const i = clamp(Math.round((b.x - CUP_X[0]) / C.CUP_PITCH), 0, CUP_X.length - 1);
      const dx = b.x - CUP_X[i];
      const full = state.cups[i].length >= C.CUP_CAP;
      if (Math.abs(dx) <= C.CATCH && !full) {
        b.x = CUP_X[i];
        return { type: 'cup', cup: i };
      }
      if (Math.abs(dx) <= C.RIM) {
        // フチ、または満杯のカップの球に当たって坂を少し戻る
        const dir = dx !== 0 ? Math.sign(dx) : b.vx >= 0 ? 1 : -1;
        b.y = 0.5;
        b.vy = Math.abs(b.vy) * 0.3;
        b.vx = b.vx * 0.5 + dir * (full && Math.abs(dx) <= C.CATCH ? 60 : 30);
        return null;
      }
      return { type: 'out', reason: 'gap' };
    };

    let result = null;
    rec();
    for (let step = 1; step <= C.MAX_STEPS && !result; step++) {
      b.vy -= C.SLOPE * C.DT;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 0) {
        const k = Math.max(0, sp - C.FRICTION * C.DT) / sp;
        b.vx *= k; b.vy *= k;
      }
      b.x += b.vx * C.DT;
      b.y += b.vy * C.DT;

      if (b.y <= ends[0] && b.x < C.WALL + R) { b.x = C.WALL + R; b.vx = Math.abs(b.vx) * C.WALL_E; }
      if (b.y <= ends[1] && b.x > C.W - C.WALL - R) { b.x = C.W - C.WALL - R; b.vx = -Math.abs(b.vx) * C.WALL_E; }

      if (b.x < -R || b.x > C.W + R) result = { type: 'out', reason: 'side' };
      else if (b.y > C.L + R) result = { type: 'out', reason: 'back' };
      else if (b.y <= 0) result = edge();

      if (result || step % C.REC_EVERY === 0) rec();
    }
    return { frames, result: result || { type: 'out', reason: 'stuck' } };
  }

  // shot: {angle}。angle=0 で真っ直ぐカップ側、正で右
  function applyShot(state, seat, shot) {
    if (state.phase !== 'playing') return { error: 'not_playing' };
    if (seat !== state.turn) return { error: 'not_your_turn' };
    const a = Number(shot && shot.angle);
    if (!Number.isFinite(a)) return { error: 'bad_shot' };

    const s = JSON.parse(JSON.stringify(state));
    const ang = clamp(a, -C.MAX_ANGLE, C.MAX_ANGLE);
    const ball = {
      x: C.LAUNCH_X[seat],
      y: C.LAUNCH_Y,
      vx: Math.sin(ang) * C.LAUNCH_SPEED,
      vy: -Math.cos(ang) * C.LAUNCH_SPEED,
    };
    const { frames, result } = simulate(s, ball);

    if (result.type === 'cup') {
      const id = s.nextId++;
      s.cups[result.cup].push(id);
      s.balls.push({ id, owner: seat, cup: result.cup });
    }
    s.shotNo++;

    const sc = scores(s);
    const scoringFull = s.cups.every((c, i) => C.CUP_VALUES[i] === 'X' || c.length >= C.CUP_CAP);
    if (sc[seat] >= C.SIDE_CUPS) {
      s.phase = 'over'; s.turn = -1; s.winner = seat; s.endReason = 'clear';
    } else if (scoringFull) {
      s.phase = 'over'; s.turn = -1; s.endReason = 'full';
      s.winner = sc[0] === sc[1] ? -1 : sc[0] > sc[1] ? 0 : 1;
    } else {
      s.turn = 1 - seat;
    }
    return { state: s, frames, result };
  }

  return { C, CUP_X, cupValue, newGame, scores, sideLeft, wallEnd, applyShot, clamp };
});
