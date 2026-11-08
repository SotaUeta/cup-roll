(() => {
  'use strict';
  const G = window.CupGame;
  const FX = window.FX;
  const C = G.C;
  const $ = (id) => document.getElementById(id);

  const COLORS = {
    floor: '#ece8e1',
    table: '#bf9c6c',
    plank: '#ad8a5c',
    lime: '#a9cf2e', limeIn: '#86a71f',
    pink: '#c42b8c', pinkIn: '#9b1f6e',
    side: ['#2a9fd0', '#c42b8c'],
    ball: ['#f6f5f0', '#f08a24'],
  };
  const VIEW = { x0: -14, y0: -70, w: 388, h: 760 };
  const FRAME_SEC = C.REC_EVERY * C.DT;
  const MIN_SWIPE = 12;       // これより短いスワイプは無視（ワールド座標）
  const CUP_SLOTS = [[-6, 4], [6, 4], [0, -6]];

  // ---------- 通信 ----------
  class NetTransport {
    constructor(onMsg) {
      this.onMsg = onMsg;
      this.hello = null;
      this.retry = 0;
      this.closed = false;
    }
    connect() {
      const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws';
      const ws = (this.ws = new WebSocket(url));
      ws.onopen = () => { this.retry = 0; if (this.hello) this.send(this.hello); setConn(true); };
      ws.onmessage = (e) => { try { this.onMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
      ws.onclose = () => {
        if (this.closed) return;
        setConn(false);
        const wait = Math.min(8000, 500 * 2 ** this.retry++);
        setTimeout(() => { if (!this.closed) this.connect(); }, wait);
      };
    }
    send(obj) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(obj)); }
    close() { this.closed = true; if (this.ws) this.ws.close(); }
  }

  // 同じ端末で2人。サーバーと同じメッセージを返す
  class LocalTransport {
    constructor(onMsg) { this.onMsg = onMsg; this.state = null; this.first = 0; this.names = ['プレイヤー1', 'プレイヤー2']; }
    emit(m) { setTimeout(() => this.onMsg(JSON.parse(JSON.stringify(m))), 0); }
    connect() {
      this.state = G.newGame(this.names, this.first);
      this.emit({ t: 'joined', room: null, seat: -1 });
      this.emit({ t: 'room', names: this.names, online: [true, true], rematch: [false, false] });
      this.emit({ t: 'state', state: this.state });
    }
    send(m) {
      if (m.t === 'shot') {
        const seat = this.state.turn;
        const r = G.applyShot(this.state, seat, m);
        if (r.error) return;
        this.emit({ t: 'shot', seat, frames: r.frames, result: r.result, state: r.state });
        this.state = r.state;
      } else if (m.t === 'rematch') {
        this.first = 1 - this.first;
        this.connect();
      }
    }
    close() {}
  }

  // ---------- 状態 ----------
  const app = {
    mode: null,        // 'net' | 'local'
    tr: null,
    seat: null,
    room: null,
    info: { names: [null, null], online: [false, false], rematch: [false, false] },
    state: null,       // 表示が追いついた最新の状態
    queue: [],
    play: null,        // 再生中のショット
    swipe: null,
    side: [C.SIDE_CUPS, C.SIDE_CUPS], // 表示中の横のコップの数（1個ずつ減らして見せる）
    sideT: 0,
    pops: 0,           // ドパガキモード: 連続して消えたコップの数（音の高さ用）
    streak: [0, 0],    // 連続で得点した回数
    lastNow: 0,
    pending: false,
    message: '',
    conn: true,
  };

  function setConn(ok) { app.conn = ok; updateUi(); }

  function onMsg(m) {
    switch (m.t) {
      case 'joined':
        app.seat = m.seat;
        app.room = m.room;
        if (m.room) {
          localStorage.setItem('cupcl:' + m.room, m.token);
          app.tr.hello = { t: 'join', room: m.room, token: m.token, name: myName() };
          history.replaceState(null, '', '?room=' + m.room);
        }
        showGame();
        break;
      case 'room':
        app.info = m;
        updateUi();
        break;
      case 'state':
      case 'shot':
        app.queue.push(m);
        break;
      case 'error':
        if (m.code === 'notfound' || m.code === 'full' || m.code === 'busy') {
          const text = { notfound: '部屋が見つかりません。コードを確認してください。', full: 'その部屋はすでに2人そろっています。', busy: 'サーバーが混み合っています。' }[m.code];
          if (app.room) localStorage.removeItem('cupcl:' + app.room);
          leave(text);
        } else {
          app.pending = false;
          updateUi();
        }
        break;
    }
  }

  // ---------- ロビー ----------
  function myName() { return $('name').value.trim().slice(0, 12); }

  function startNet(hello) {
    localStorage.setItem('cupcl:name', myName());
    app.mode = 'net';
    app.tr = new NetTransport(onMsg);
    app.tr.hello = hello;
    app.tr.connect();
  }

  function startLocal() {
    app.mode = 'local';
    app.tr = new LocalTransport(onMsg);
    app.tr.connect();
  }

  function joinRoom(code) {
    code = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) { $('lobbyError').textContent = '部屋コードは4文字です。'; return; }
    startNet({ t: 'join', room: code, token: localStorage.getItem('cupcl:' + code), name: myName() });
  }

  function resetGameState() {
    FX.reset();
    Object.assign(app, { seat: null, room: null, state: null, queue: [], play: null, swipe: null, pending: false, message: '', streak: [0, 0],
      side: [C.SIDE_CUPS, C.SIDE_CUPS], info: { names: [null, null], online: [false, false], rematch: [false, false] } });
  }

  function leave(errorText) {
    if (app.tr) app.tr.close();
    app.tr = null;
    resetGameState();
    history.replaceState(null, '', location.pathname);
    $('game').hidden = true;
    $('lobby').hidden = false;
    $('joinBox').hidden = true;
    $('lobbyError').textContent = errorText || '';
  }

  function showGame() {
    $('lobby').hidden = true;
    $('game').hidden = false;
    resize();
    updateUi();
  }

  // ---------- HUD ----------
  function canShoot() {
    const s = app.state;
    return !!s && !app.play && app.queue.length === 0 && !app.pending && app.conn &&
      s.phase === 'playing' && (app.mode === 'local' || s.turn === app.seat);
  }

  function nameOf(i) {
    return (app.state && app.state.names[i]) || app.info.names[i] || `プレイヤー${i + 1}`;
  }
  const isMe = (i) => app.mode === 'net' && i === app.seat;
  const who = (i) => (isMe(i) ? 'あなた' : nameOf(i));

  function updateUi() {
    if ($('game').hidden) return;
    const s = app.state;
    const sc = s ? G.scores(s) : [0, 0];
    const left = s ? G.sideLeft(s) : [C.SIDE_CUPS, C.SIDE_CUPS];
    for (let i = 0; i < 2; i++) {
      const el = $('p' + i);
      el.querySelector('.pname').textContent = nameOf(i);
      el.querySelector('.pscore').textContent = s ? left[i] : '';
      el.querySelector('.pleft').textContent = (isMe(i) ? '自分　' : '') + (s ? `${sc[i]}点` : '');
      el.classList.toggle('turn', !!s && s.phase === 'playing' && s.turn === i && !app.play);
      el.classList.toggle('off', app.mode === 'net' && !app.info.online[i] && app.info.names[i] != null);
    }

    const waiting = app.mode === 'net' && !s;
    $('waiting').hidden = !waiting;
    if (waiting) $('roomCode').textContent = app.room || '';

    let status = '';
    const rb = $('rematchBtn');
    rb.hidden = true;
    if (!app.conn) status = '接続が切れました。再接続しています…';
    else if (!s || app.play) status = '';
    else if (s.phase === 'over') {
      if (s.winner === -1) status = `カップが埋まりました。引き分け`;
      else if (s.endReason === 'clear') status = `${who(s.winner)}の勝ち（コップを全部消した）`;
      else status = `カップが埋まりました。残りが少ない${who(s.winner)}の勝ち`;
      rb.hidden = false;
      const voted = app.mode === 'net' && app.info.rematch[app.seat];
      rb.disabled = voted;
      rb.textContent = voted ? '相手を待っています' : 'もう一度';
    } else {
      const opp = app.mode === 'net' ? 1 - app.seat : -1;
      let turnText;
      if (app.mode === 'net' && !app.info.online[opp]) turnText = '相手の接続が切れています。戻るのを待っています。';
      else if (app.mode === 'local') turnText = `${nameOf(s.turn)} の番`;
      else turnText = s.turn === app.seat ? 'あなたの番' : '相手の番';
      if (s.shotNo < 2 && canShoot()) turnText += '　カップの方へスワイプして転がす';
      status = app.message ? `${app.message}　→ ${turnText}` : turnText;
    }
    $('status').textContent = status;
  }

  function describeShot(item) {
    const r = item.result;
    let text;
    if (r.type === 'cup') {
      const v = G.cupValue(r.cup);
      text = v > 0 ? `+${v}点` : 'X（0点）';
    } else {
      text = { gap: 'カップの隙間に落ちた', side: '台の横から落ちた', back: '奥に落ちた' }[r.reason] || 'ミス';
    }
    return `${item.state.names[item.seat]}: ${text}`;
  }

  // ---------- 再生 ----------
  function startItem(item, now) {
    if (item.t === 'state') {
      if (!app.state || item.state.shotNo === 0) {
        app.message = '';
        app.side = G.sideLeft(item.state);
        if (item.state.shotNo === 0) { app.streak = [0, 0]; FX.reset(); }
      }
      app.state = item.state;
      app.pending = false;
      updateUi();
      return;
    }
    app.play = { item, pos: 0, last: now };
    app.swipe = null;
    FX.clearTrail();
    if (FX.on) FX.sfx.launch();
    updateUi();
  }

  function finishItem(now) {
    const item = app.play.item;
    const fr = item.frames[item.frames.length - 1];
    app.play = null;
    app.message = describeShot(item);
    app.state = item.state;
    app.pending = false;
    app.sideT = now;
    app.pops = 0;
    const r = item.result;
    const v = r.type === 'cup' ? G.cupValue(r.cup) : 0;
    app.streak[item.seat] = v > 0 ? app.streak[item.seat] + 1 : 0;
    if (FX.on) shotFx(item, r, v, fr);
    updateUi();
  }

  // ---------- ドパガキモードの演出 ----------
  function shotFx(item, r, v, fr) {
    const seat = item.seat;
    const streak = app.streak[seat];
    if (r.type === 'cup' && v > 0) {
      const x = G.CUP_X[r.cup], y = C.CUP_Y;
      const big = v >= 5;
      FX.burst(x, y, [COLORS.ball[seat], '#ffd23f', '#ff3b6b', '#3bd6ff', '#7bff5a'], big ? 90 : 35 + v * 8, big ? 520 : 340);
      FX.shake(big ? 12 : 3 + v * 1.5, big ? 0.6 : 0.3);
      FX.flash(big ? '#fff3a0' : '#ffffff', big ? 0.75 : 0.35);
      FX.text(`+${v}`, x, y + 40, { size: big ? 54 : 38, color: big ? '#ffd23f' : '#ffffff' });
      if (big) FX.text('JACKPOT!!', C.W / 2, C.L * 0.35, { size: 46, color: '#ffd23f', life: 1.6, vy: -15 });
      if (streak >= 2) FX.text(`${streak}連続!!`, C.W / 2, C.L * 0.62, { size: 30 + Math.min(streak, 6) * 4, color: '#ff3b6b', life: 1.4, vy: -20 });
      FX.sfx.cup(v, streak);
      FX.vibrate(big ? [60, 40, 60, 40, 120] : [40]);
      bump(seat);
    } else if (r.type === 'cup') {
      FX.text('スカ…', G.CUP_X[r.cup], C.CUP_Y + 40, { size: 30, color: '#b9b9c8' });
      FX.shake(2, 0.2);
      FX.sfx.zero();
    } else {
      const x = G.clamp(fr[0], 40, C.W - 40), y = G.clamp(fr[1], 30, C.L - 30);
      FX.text(r.reason === 'gap' ? 'おしい!!' : 'ざんねん', x, y, { size: 30, color: '#b9b9c8' });
      FX.sfx.miss();
    }
    if (item.state.phase === 'over') setTimeout(() => overFx(item.state), 700);
  }

  function overFx(s) {
    if (!FX.on || app.state !== s) return;
    const w = s.winner;
    if (w === -1) { FX.setBanner('DRAW', '#ffffff'); return; }
    const iLost = app.mode === 'net' && w !== app.seat;
    if (iLost) {
      FX.setBanner('LOSE…', '#9a9aae');
      FX.sfx.lose();
    } else {
      FX.setBanner(app.mode === 'net' ? 'WIN!!' : `${nameOf(w)} WIN!!`, '#ffd23f');
      FX.confetti(4);
      FX.flash('#ffffff', 0.8);
      FX.shake(10, 0.5);
      FX.sfx.win();
      FX.vibrate([80, 50, 80, 50, 200]);
    }
  }

  function bump(seat) {
    const el = $('p' + seat).querySelector('.pscore');
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  // ---------- 描画 ----------
  const cv = $('cv');
  const ctx = cv.getContext('2d');
  let scale = 1;

  function resize() {
    const st = $('stage');
    const w = st.clientWidth, h = st.clientHeight;
    if (!w || !h) return;
    scale = Math.min(w / VIEW.w, h / VIEW.h);
    const dpr = window.devicePixelRatio || 1;
    cv.style.width = VIEW.w * scale + 'px';
    cv.style.height = VIEW.h * scale + 'px';
    cv.width = Math.round(VIEW.w * scale * dpr);
    cv.height = Math.round(VIEW.h * scale * dpr);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, -VIEW.x0 * scale * dpr, -VIEW.y0 * scale * dpr);
  }

  function circle(x, y, r, fill, stroke) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
  }

  function drawBall(x, y, owner, r = C.BALL_R) {
    ctx.beginPath();
    ctx.ellipse(x + 2, y + 3, r, r * 0.7, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fill();
    circle(x, y, r, COLORS.ball[owner], 'rgba(0,0,0,0.4)');
  }

  function drawTable() {
    ctx.fillStyle = COLORS.floor;
    ctx.fillRect(VIEW.x0, VIEW.y0, VIEW.w, VIEW.h);
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(4, 6, C.W, C.L);
    ctx.fillStyle = COLORS.table;
    ctx.fillRect(0, 0, C.W, C.L);
    ctx.strokeStyle = COLORS.plank;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const x of [C.W / 3, (C.W * 2) / 3]) { ctx.moveTo(x, 0); ctx.lineTo(x, C.L); }
    ctx.moveTo(0, C.L * 0.46); ctx.lineTo(C.W, C.L * 0.46);
    ctx.stroke();

    // 横のコップ（カップ側から並び、投げる側から消える）
    for (let side = 0; side < 2; side++) {
      const x = side === 0 ? 11 : C.W - 11;
      for (let k = 0; k < app.side[side]; k++) {
        circle(x, C.SIDE_Y0 + k * C.SIDE_PITCH, C.SIDE_R, COLORS.side[side], 'rgba(0,0,0,0.25)');
      }
    }

    // カップと得点
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 17px sans-serif';
    G.CUP_X.forEach((x, i) => {
      const isX = C.CUP_VALUES[i] === 'X';
      circle(x, C.CUP_Y, C.CUP_R, isX ? COLORS.pink : COLORS.lime, 'rgba(0,0,0,0.3)');
      circle(x, C.CUP_Y, C.CUP_R - 4, isX ? COLORS.pinkIn : COLORS.limeIn);
      ctx.fillStyle = isX ? '#a3102a' : '#33470a';
      ctx.fillText(isX ? '×' : String(C.CUP_VALUES[i]), x, 17);
    });
  }

  function drawCupBalls(state) {
    const owner = new Map(state.balls.map((b) => [b.id, b.owner]));
    state.cups.forEach((ids, i) => {
      ids.forEach((id, k) => {
        const [ox, oy] = CUP_SLOTS[k] || [0, 0];
        drawBall(G.CUP_X[i] + ox, C.CUP_Y + oy, owner.get(id), 6);
      });
    });
  }

  function drawPlayback(now) {
    const p = app.play;
    const fr = p.item.frames;
    const last = fr.length - 1;
    // ドパガキモード: カップに入る直前だけスローにする
    const r = p.item.result;
    const slow = FX.on && r.type === 'cup' && G.cupValue(r.cup) > 0 && last - p.pos < 9;
    p.pos += (now - p.last) / 1000 / FRAME_SEC * (slow ? (G.cupValue(r.cup) >= 5 ? 0.2 : 0.35) : 1);
    p.last = now;
    const fi = p.pos;
    const idx = Math.min(Math.floor(fi), last);
    const k = Math.min(fi - idx, 1);
    const a = fr[idx], b = fr[Math.min(idx + 1, last)];
    const x = a[0] + (b[0] - a[0]) * k, y = a[1] + (b[1] - a[1]) * k;
    if (FX.on) { FX.trailPush(x, y); FX.drawTrail(ctx, C.BALL_R, now); }
    drawBall(x, y, p.item.seat);
    if (fi >= last) finishItem(now);
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - (app.lastNow || now)) / 1000);
    app.lastNow = now;
    if (!app.play && app.queue.length) startItem(app.queue.shift(), now);
    // 得点した分の横のコップを1個ずつ消す
    if (app.state && !app.play) {
      const target = G.sideLeft(app.state);
      if (now - app.sideT > (FX.on ? 70 : 90)) {
        for (let i = 0; i < 2; i++) {
          if (app.side[i] <= target[i]) continue;
          app.side[i]--;
          app.sideT = now;
          if (FX.on) {
            const x = i === 0 ? 11 : C.W - 11, y = C.SIDE_Y0 + app.side[i] * C.SIDE_PITCH;
            FX.flyCup(x, y, COLORS.side[i], i === 0 ? -1 : 1);
            FX.burst(x, y, [COLORS.side[i], '#ffffff'], 8, 160);
            FX.sfx.pop(app.pops++);
          }
        }
      }
    }
    FX.update(dt, C.W);
    if (!$('game').hidden) {
      const [ox, oy] = FX.on ? FX.offset() : [0, 0];
      ctx.save();
      ctx.translate(ox, oy);
      drawTable();
      if (app.state) drawCupBalls(app.state);
      if (app.play) drawPlayback(now);
      else if (app.state && app.state.phase === 'playing') {
        // 次に転がす人の球を、投げる位置に常に表示する
        drawBall(C.LAUNCH_X[app.state.turn], C.LAUNCH_Y, app.state.turn);
      }
      if (FX.on) FX.draw(ctx);
      ctx.restore();
      if (FX.on) FX.drawOverlay(ctx, VIEW, C.W / 2, C.L * 0.42);
    }
    requestAnimationFrame(frame);
  }

  // ---------- 入力（スワイプ） ----------
  function toWorld(e) {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale + VIEW.x0, y: (e.clientY - r.top) / scale + VIEW.y0, t: e.timeStamp };
  }

  // 指を離す直前の約0.1秒の動きの向きを使う
  function swipeAngle(pts) {
    const end = pts[pts.length - 1];
    let start = pts[0];
    for (let i = pts.length - 1; i >= 0; i--) {
      start = pts[i];
      if (end.t - pts[i].t >= 100) break;
    }
    let dx = end.x - start.x, dy = end.y - start.y;
    if (Math.hypot(dx, dy) < MIN_SWIPE) { dx = end.x - pts[0].x; dy = end.y - pts[0].y; }
    if (Math.hypot(dx, dy) < MIN_SWIPE || dy > -MIN_SWIPE / 2) return null;
    return G.clamp(Math.atan2(dx, -dy), -C.MAX_ANGLE, C.MAX_ANGLE);
  }

  cv.addEventListener('pointerdown', (e) => {
    FX.unlock();
    if (!canShoot()) return;
    app.swipe = { id: e.pointerId, pts: [toWorld(e)] };
    cv.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!app.swipe || e.pointerId !== app.swipe.id) return;
    const pts = app.swipe.pts;
    pts.push(toWorld(e));
    if (pts.length > 60) pts.shift();
  });
  const release = (e) => {
    if (!app.swipe || e.pointerId !== app.swipe.id) return;
    const sw = app.swipe;
    app.swipe = null;
    if (e.type !== 'pointerup') return;
    sw.pts.push(toWorld(e));
    const angle = swipeAngle(sw.pts);
    if (angle == null || !canShoot()) return;
    app.pending = true;
    app.message = '';
    app.tr.send({ t: 'shot', angle });
    updateUi();
  };
  cv.addEventListener('pointerup', release);
  cv.addEventListener('pointercancel', release);
  new ResizeObserver(resize).observe($('stage'));

  // ---------- ボタン ----------
  $('name').value = localStorage.getItem('cupcl:name') || '';
  $('createBtn').onclick = () => startNet({ t: 'create', name: myName() });
  $('codeBtn').onclick = () => joinRoom($('codeInput').value);
  $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom($('codeInput').value); });
  $('localBtn').onclick = startLocal;
  $('leaveBtn').onclick = () => leave();
  const dopaLabel = () => {
    $('dopaBtn').setAttribute('aria-pressed', String(FX.on));
    $('dopaBtn').classList.toggle('primary', FX.on);
    document.body.classList.toggle('dopa', FX.on);
  };
  $('dopaBtn').onclick = () => { FX.setOn(!FX.on); dopaLabel(); };
  dopaLabel();
  $('rematchBtn').onclick = () => { app.tr.send({ t: 'rematch' }); if (app.mode === 'net') { app.info.rematch[app.seat] = true; updateUi(); } };
  $('copyBtn').onclick = async () => {
    const url = location.origin + location.pathname + '?room=' + app.room;
    try { await navigator.clipboard.writeText(url); $('copyNote').textContent = 'コピーしました'; }
    catch { $('copyNote').textContent = url; }
  };

  const inviteCode = new URLSearchParams(location.search).get('room');
  if (inviteCode) {
    const code = inviteCode.toUpperCase();
    $('joinCode').textContent = code;
    $('joinBox').hidden = false;
    $('joinBtn').onclick = () => joinRoom(code);
    // 自分が作った部屋や一度入った部屋なら、そのまま復帰する
    if (localStorage.getItem('cupcl:' + code)) joinRoom(code);
  }

  requestAnimationFrame(frame);
})();
