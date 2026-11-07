(() => {
  'use strict';
  const G = window.CupGame;
  const C = G.C;
  const $ = (id) => document.getElementById(id);

  const COLORS = {
    floor: '#ece8e1',
    table: '#bf9c6c',
    plank: '#ad8a5c',
    lime: '#a9cf2e', limeIn: '#86a71f',
    pink: '#c42b8c', pinkIn: '#9b1f6e',
    cyan: '#2a9fd0',
    ball: ['#f6f5f0', '#f08a24'],
  };
  const VIEW = { x0: -14, y0: -70, w: 388, h: 830 };
  const DRAG_MAX = 150;
  const FRAME_SEC = C.REC_EVERY * C.DT;

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
        const r = G.applyShot(this.state, this.state.turn, m);
        if (r.error) return;
        this.emit({ t: 'shot', seat: this.state.turn, frames: r.frames, events: r.events, newBall: r.newBall, state: r.state });
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
    aim: null,
    lastX: C.W / 2,
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
    Object.assign(app, { seat: null, room: null, state: null, queue: [], play: null, aim: null, pending: false, message: '',
      info: { names: [null, null], online: [false, false], rematch: [false, false] } });
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

  function updateUi() {
    if ($('game').hidden) return;
    const s = app.state;
    const sc = s ? G.scores(s) : [0, 0];
    for (let i = 0; i < 2; i++) {
      const el = $('p' + i);
      el.querySelector('.pname').textContent = nameOf(i);
      el.querySelector('.pscore').textContent = s ? sc[i] : '';
      el.querySelector('.pleft').textContent = (isMe(i) ? '自分　' : '') + (s ? `残り${s.left[i]}球` : '');
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
    else if (!s) status = '';
    else if (app.play) status = '';
    else if (s.phase === 'over') {
      const [a, b] = sc;
      const w = a > b ? 0 : 1;
      status = a === b ? `引き分け ${a} - ${b}` : `${isMe(w) ? 'あなた' : nameOf(w)}の勝ち ${a} - ${b}`;
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
      if (s.shotNo === 0 && canShoot()) turnText += '　テーブルの下半分を押して、後ろに引いて離す';
      status = app.message ? `${app.message}　→ ${turnText}` : turnText;
    }
    $('status').textContent = status;
  }

  function describeShot(item) {
    const who = item.state.names[item.seat];
    const evs = item.events;
    const mine = evs.filter((e) => e.id === item.newBall.id).pop();
    const owners = ownerMap(item);
    let text;
    if (!mine) text = '届かず（台に残った）';
    else if (mine.type === 'out') text = { over: '強すぎて飛び越えた', gap: 'カップの隙間に落ちた', back: '手前に落ちた' }[mine.reason] || 'ミス';
    else {
      const v = G.cupValue(mine.cup);
      text = v < 0 ? `X ${v}点` : `+${v}点`;
      if (mine.kicked != null && owners.get(mine.kicked) !== item.seat) text += '（奪った）';
    }
    const pushed = evs.filter((e) => e.type === 'cup' && e.id !== item.newBall.id).length;
    if (pushed) text += '　別の球が押し込まれた';
    return `${who}: ${text}`;
  }

  // ---------- 再生 ----------
  function ownerMap(item) {
    const m = new Map();
    const prev = app.state ? app.state.balls : [];
    for (const b of prev) m.set(b.id, b.owner);
    for (const b of item.state.balls) m.set(b.id, b.owner);
    if (item.newBall) m.set(item.newBall.id, item.newBall.owner);
    return m;
  }

  function startItem(item, now) {
    if (item.t === 'state') {
      if (!app.state || item.state.shotNo === 0) app.message = '';
      app.state = item.state;
      app.pending = false;
      updateUi();
      return;
    }
    app.play = {
      item,
      t0: now,
      owners: ownerMap(item),
      cups: app.state ? app.state.cups.slice() : item.state.cups.map(() => null),
      maps: item.frames.map((fr) => new Map(fr.map(([id, x, y]) => [id, [x, y]]))),
      applied: 0,
    };
    app.aim = null;
    updateUi();
  }

  function finishItem() {
    const item = app.play.item;
    app.play = null;
    app.message = describeShot(item);
    app.state = item.state;
    app.pending = false;
    updateUi();
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

  function drawBall(x, y, owner, alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.ellipse(x + 2, y + 3, C.BALL_R, C.BALL_R * 0.7, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fill();
    circle(x, y, C.BALL_R, COLORS.ball[owner], 'rgba(0,0,0,0.4)');
    ctx.globalAlpha = 1;
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

    // 投げる位置の目安
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath();
    ctx.moveTo(C.WALL + 4, C.LAUNCH_Y); ctx.lineTo(C.W - C.WALL - 4, C.LAUNCH_Y);
    ctx.stroke();
    ctx.setLineDash([]);

    // 左右の伏せカップ
    for (let y = 12; y < C.L - 6; y += 21) {
      circle(11, y, 10, COLORS.cyan, 'rgba(0,0,0,0.25)');
      circle(C.W - 11, y, 10, COLORS.pink, 'rgba(0,0,0,0.25)');
    }

    // 手前のカップと得点
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
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#8a7b66';
    ctx.fillText(`× = ${C.X_VALUE}点`, C.W / 2, -56);
  }

  function drawStaticBalls(state, skip) {
    for (const b of state.balls) {
      if (skip && skip.has(b.id)) continue;
      if (b.where === 'cup') drawBall(G.CUP_X[b.cup], C.CUP_Y, b.owner);
      else drawBall(b.x, b.y, b.owner);
    }
  }

  function drawPlayback(now) {
    const p = app.play;
    const fi = (now - p.t0) / 1000 / FRAME_SEC;
    const last = p.maps.length - 1;
    const idx = Math.min(Math.floor(fi), last);
    const k = Math.min(fi - idx, 1);
    const evs = p.item.events;
    while (p.applied < evs.length && evs[p.applied].f <= idx) {
      const e = evs[p.applied++];
      if (e.type === 'cup') p.cups[e.cup] = e.id;
    }
    p.cups.forEach((id, i) => { if (id != null) drawBall(G.CUP_X[i], C.CUP_Y, p.owners.get(id)); });
    const cur = p.maps[idx], nxt = p.maps[Math.min(idx + 1, last)];
    for (const [id, [x, y]] of cur) {
      const n = nxt.get(id);
      const px = n ? x + (n[0] - x) * k : x;
      const py = n ? y + (n[1] - y) * k : y;
      drawBall(px, py, p.owners.get(id));
    }
    if (fi >= last) finishItem();
  }

  function aimShot(a) {
    const sx = a.sx - a.px, sy = a.sy - a.py;
    if (sy >= -2) return null;
    const power = Math.min(Math.hypot(sx, sy) / DRAG_MAX, 1);
    const angle = G.clamp(Math.atan2(sx, -sy), -C.MAX_ANGLE, C.MAX_ANGLE);
    return { x: a.bx, angle, power };
  }

  function drawAim() {
    const s = app.state;
    const owner = s.turn;
    if (!app.aim) {
      drawBall(app.lastX, C.LAUNCH_Y, owner, 0.45);
      return;
    }
    const shot = aimShot(app.aim);
    drawBall(app.aim.bx, C.LAUNCH_Y, owner);
    if (!shot) return;
    const len = 30 + shot.power * 150;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(app.aim.bx, C.LAUNCH_Y - 10);
    ctx.lineTo(app.aim.bx + Math.sin(shot.angle) * len, C.LAUNCH_Y - 10 - Math.cos(shot.angle) * len);
    ctx.stroke();
    ctx.setLineDash([]);
    // 強さ
    const y = C.L + 26;
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    ctx.fillRect(40, y, C.W - 80, 8);
    ctx.fillStyle = '#333';
    ctx.fillRect(40, y, (C.W - 80) * shot.power, 8);
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#555';
    ctx.fillText(`強さ ${Math.round(shot.power * 100)}`, C.W / 2, y + 24);
  }

  function frame(now) {
    if (!app.play && app.queue.length) startItem(app.queue.shift(), now);
    if (!$('game').hidden) {
      drawTable();
      if (app.play) {
        drawPlayback(now);
      } else if (app.state) {
        drawStaticBalls(app.state);
        if (canShoot()) drawAim();
      }
    }
    requestAnimationFrame(frame);
  }

  // ---------- 入力 ----------
  function toWorld(e) {
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale + VIEW.x0, y: (e.clientY - r.top) / scale + VIEW.y0 };
  }

  cv.addEventListener('pointerdown', (e) => {
    if (!canShoot()) return;
    const w = toWorld(e);
    if (w.y < C.L * 0.45) return;
    const bx = G.clamp(w.x, C.WALL + C.BALL_R + 1, C.W - C.WALL - C.BALL_R - 1);
    app.aim = { bx, sx: w.x, sy: w.y, px: w.x, py: w.y, id: e.pointerId };
    app.lastX = bx;
    cv.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!app.aim || e.pointerId !== app.aim.id) return;
    const w = toWorld(e);
    app.aim.px = w.x; app.aim.py = w.y;
  });
  const release = (e) => {
    if (!app.aim || e.pointerId !== app.aim.id) return;
    const shot = e.type === 'pointerup' ? aimShot(app.aim) : null;
    app.aim = null;
    if (shot && shot.power >= 0.08 && canShoot()) {
      app.pending = true;
      app.message = '';
      app.tr.send({ t: 'shot', ...shot });
      updateUi();
    }
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
