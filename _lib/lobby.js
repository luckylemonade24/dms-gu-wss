import { createEngine, createAI } from './engine-bridge.js';

const OFFLINE_GRACE_MS = 30000;
const MAX_ROOMS = 500;
const MSG_RATE = 20;
const MSG_BURST = 60;
const MSG_OVER_LIMIT = 300;
const RANK_RANGE = 10; 
const RANK_TURN_MS = 80000; 

function normPass(p) { return String(p == null ? '' : p).trim().slice(0, 12); }
function mkRoom(code, pass) {
  const seats = [];
  for (let i = 0; i < 4; i++) seats.push({ role: i < 2 ? 'fight' : 'watch', player: null });
  return { code, rule: 'bo1', hostId: null, status: 'waiting', seats, seq: 0, round: 0, game: null, pass: normPass(pass), series: null, mode: 'friendly', ended: false, rank: null, rankTimer: null, rankDeadline: 0, rankTag: null, rankWho: null };
}
function firstOf(gameIdx, total) { if (total <= 1 || gameIdx >= total - 1) return Math.random() < 0.5 ? 'A' : 'B'; return gameIdx % 2 === 0 ? 'A' : 'B'; }
function newServerSeries(arg) { let total = Number(arg && arg.total) || 1; let need = Number(arg && arg.need) || 1; total = Math.max(1, Math.min(9, total)); need = Math.max(1, Math.min(total, need)); const firsts = []; const given = (arg && Array.isArray(arg.firsts)) ? arg.firsts : null; for (let i = 0; i < total; i++) { const g = given && (given[i] === 'A' || given[i] === 'B') ? given[i] : null; firsts.push(g || firstOf(i, total)); } return { rule: String((arg && arg.rule) || 'bo1'), need, total, round: 0, wins: { A: 0, B: 0 }, firsts, over: false }; }
function flipSideDeep(o) { if (o === 'A') return 'B'; if (o === 'B') return 'A'; if (!o || typeof o !== 'object') return o; if (Array.isArray(o)) return o.map(flipSideDeep); const out = {}; Object.keys(o).forEach(k => { out[k] = flipSideDeep(o[k]); }); return out; }
function flipInPlace(s) { const a = s.players.A; s.players.A = s.players.B; s.players.B = a; s.players.A.key = 'A'; s.players.B.key = 'B'; s.active = s.active === 'A' ? 'B' : (s.active === 'B' ? 'A' : s.active); if (s.winner === 'A') s.winner = 'B'; else if (s.winner === 'B') s.winner = 'A'; if (s.pending) { if (s.pending.actorKey) s.pending.actorKey = s.pending.actorKey === 'A' ? 'B' : 'A'; if (s.pending.victimKey) s.pending.victimKey = s.pending.victimKey === 'A' ? 'B' : 'A'; } ['dealt', 'healed'].forEach(k => { if (s[k]) { const t = s[k].A; s[k].A = s[k].B; s[k].B = t; } }); if (s.dmgBy) { const t = s.dmgBy.A; s.dmgBy.A = s.dmgBy.B; s.dmgBy.B = t; } if (Array.isArray(s.events)) s.events = flipSideDeep(s.events); return s; }
function flipSides(o) { if (o === 'A') return 'B'; if (o === 'B') return 'A'; if (!o || typeof o !== 'object') return o; const out = {}; Object.keys(o).forEach(k => { const v = o[k]; out[k] = (v === 'A') ? 'B' : (v === 'B' ? 'A' : v); }); return out; }

export class Lobby {
  constructor(state, env) {
    this.dstate = state;
    this.env = env;
    this.rooms = new Map();
    this.offline = new Map();
    this.nextPid = 1;
    this.rankQueue = new Map();
  }

  async fetch(req) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.dstate.acceptWebSocket(server);
    const sessId = 'p' + (this.nextPid++);
    const sess = { id: sessId, room: null, profile: null, offline: false, timer: null, bucket: { tokens: MSG_BURST, at: Date.now() } };
    server.serializeAttachment(sess);
    this.send(server, { t: 'hello', id: sess.id, ranked: true, n: this.dstate.getWebSockets().length });
    this.broadcastOnline();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    const sess = ws.deserializeAttachment();
    let m = null;
    try { m = JSON.parse(message); } catch (e) { return; }
    if (!this.allowMsg(sess)) return;
    if (!m || !m.t) return;
    if (m.t === 'ping') { this.send(ws, { t: 'pong', ts: m.ts }); return; }
    sess.ws = ws; 
    try { this.handle(sess, m); } catch (e) { this.sendMsg(sess, '服务器处理出错：' + e.message); }
    delete sess.ws;
    ws.serializeAttachment(sess);
  }

  async webSocketClose(ws, code, reason, wasClean) {
    const sess = ws.deserializeAttachment();
    this.onClose(sess);
  }

  async webSocketError(ws, error) {
    const sess = ws.deserializeAttachment();
    this.onClose(sess);
  }

  // 纯粹地只发给真实存在的 WSS
  sendSess(sess, obj) { 
    if (!sess) return;
    const wss = this.dstate.getWebSockets();
    for (const w of wss) {
      const s = w.deserializeAttachment();
      if (s.id === sess.id) { this.send(w, obj); return; }
    }
  }
  
  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch (e) {} }
  sendMsg(sess, text) { this.sendSess(sess, { t: 'msg', text }); }

  broadcastOnline() {
    const n = this.dstate.getWebSockets().length;
    this.dstate.getWebSockets().forEach(ws => this.send(ws, { t: 'online-count', n }));
  }

  allowMsg(sess) {
    const now = Date.now();
    const b = sess.bucket || (sess.bucket = { tokens: MSG_BURST, at: now });
    b.tokens = Math.min(MSG_BURST, b.tokens + ((now - b.at) / 1000) * MSG_RATE);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  onClose(sess) {
    if (sess.closed) return;
    sess.closed = true;
    this.broadcastOnline();
    this.rankQueue.delete(sess.id);
    if (!sess.room) return;
    sess.offline = true;
    clearTimeout(sess.timer);
    sess.timer = setTimeout(() => {
      this.offline.delete(sess.id);
      this.leaveRoom(sess, true);
    }, OFFLINE_GRACE_MS);
    this.offline.set(sess.id, sess);
    const room = this.rooms.get(sess.room);
    if (room) {
      const other = room.seats.map(s => s.player).filter(p => p && p.id !== sess.id && p.sess)[0];
      if (other) this.sendMsg(other.sess, '对手掉线了，正在等待重连…（30 秒内回来可继续）');
      this.broadcastRoom(room);
    }
  }

  // ======== 以下是你原有的所有游戏核心逻辑，无需修改 ========
  handle(sess, m) {
    switch (m.t) {
      case 'resume': this.doResume(sess, m.id); break;
      case 'profile': sess.profile = this.normProfile(m, sess.profile); this.syncProfileToSeat(sess); break;
      case 'create': this.doCreate(sess, m.pass); break;
      case 'join': this.doJoin(sess, m.code, m.pass); break;
      case 'leave': this.leaveRoom(sess, false); break;
      case 'rule': this.setRule(sess, m.rule); break;
      case 'seat':
      case 'swap': this.doSwapRequest(sess, m.role, m.idx); break;
      case 'swap-answer': this.doSwapAnswer(sess, m.ok); break;
      case 'ready': this.setReady(sess, m.v); break;
      case 'deck': this.setDeck(sess, m); break;
      case 'start': this.doStart(sess, m.series); break;
      case 'begin': this.beginBattle(sess, m); break;
      case 'act': this.doAct(sess, m.a); break;
      case 'prompt': this.doPrompt(sess, m.v); break;
      case 'ranked': this.doRankedQueue(sess, m); break;
      case 'ranked-cancel': this.doRankedCancel(sess); break;
    }
  }

  randCode() { for (let i = 0; i < 200; i++) { const c = String(1000 + Math.floor(Math.random() * 9000)); if (!this.rooms.has(c)) return c; } return String(Date.now() % 10000); }
  seatOfPlayer(room, pid) { return (room && room.seats.find(s => s.player && s.player.id === pid)) || null; }
  sessionOfPlayer(room, pid) { const s = this.seatOfPlayer(room, pid); return s ? s.player.sess : null; }
  fighters(room) { return room.seats.filter(s => s.role === 'fight' && s.player).map(s => s.player); }

  pubRoomFor(room, viewerId) {
    room.seq++;
    return {
      code: room.code, rule: room.rule, hostId: room.hostId, status: room.status, seq: room.seq,
      mode: room.mode, locked: !!room.pass, series: this.seriesFor(room, viewerId),
      seats: room.seats.map(s => ({ role: s.role, player: s.player ? { id: s.player.id, name: s.player.name, avatar: s.player.avatar, title: s.player.title, deckName: s.player.deckName, ready: !!s.player.ready, self: s.player.id === viewerId, deckIds: s.player.id === viewerId ? s.player.deckIds.slice() : undefined } : null }))
    };
  }

  seriesFor(room, viewerId) {
    const s = room.series; if (!s) return null;
    let mine = 'A';
    if (room.game) mine = (room.game.A === viewerId) ? 'A' : ((room.game.B === viewerId) ? 'B' : 'A');
    else if (room.seats[0] && room.seats[0].player && room.seats[0].player.id === viewerId) mine = 'A';
    else if (room.seats[1] && room.seats[1].player && room.seats[1].player.id === viewerId) mine = 'B';
    return { rule: s.rule, need: s.need, total: s.total, round: s.round, over: s.over, win: (mine === 'B' ? s.wins.B : s.wins.A), lose: (mine === 'B' ? s.wins.A : s.wins.B), firsts: s.firsts.slice() };
  }

  broadcastRoom(room) {
    room.seats.forEach(s => { if (s.player) this.sendSess(s.player.sess, { t: 'room', room: this.pubRoomFor(room, s.player.id) }); });
  }

  normProfile(m, old) {
    const p = old || {};
    return { id: p.id, name: String(m.name || p.name || '玩家').slice(0, 12), avatar: String(m.avatar || p.avatar || '初始头像1').slice(0, 40), title: String(m.title || p.title || '雪景学院新生').slice(0, 20), deckName: String(m.deckName || p.deckName || '卡组').slice(0, 12), deckIds: Array.isArray(m.deckIds) ? m.deckIds.filter(x => typeof x === 'string').slice(0, 40) : (p.deckIds || []).slice(), ready: false };
  }

  syncProfileToSeat(sess) {
    const room = sess.room && this.rooms.get(sess.room); if (!room || !sess.profile) return;
    const seat = this.seatOfPlayer(room, sess.id); if (!seat) return;
    Object.assign(seat.player, { name: sess.profile.name, avatar: sess.profile.avatar, title: sess.profile.title, deckName: sess.profile.deckName, deckIds: (sess.profile.deckIds || []).slice() });
    seat.player.ready = false; this.broadcastRoom(room);
  }

  doCreate(sess, pass) {
    if (this.rooms.size >= MAX_ROOMS) { this.sendMsg(sess, '服务器房间数已达上限，请稍后再试'); return; }
    this.leaveRoom(sess, false);
    const room = mkRoom(this.randCode(), pass);
    sess.profile = sess.profile || this.normProfile({}, null);
    room.hostId = sess.id;
    room.seats[0].player = Object.assign({}, sess.profile, { id: sess.id, sess, ready: false });
    this.rooms.set(room.code, room); sess.room = room.code;
    this.broadcastRoom(room);
    this.sendMsg(sess, '房间已创建，房号 ' + room.code + (room.pass ? '（已设密码，加入的人要输密码）' : '') + '（把房号发给朋友即可加入）');
  }

  doJoin(sess, code, pass) {
    const room = this.rooms.get(String(code || '').trim());
    if (!room) { this.sendMsg(sess, '没有找到房号 ' + code + ' 的房间'); return; }
    if (room.mode === 'ranked') { this.sendMsg(sess, '该房间不可加入'); return; }
    if (room.pass && room.pass !== normPass(pass)) { this.sendMsg(sess, '密码不正确'); return; }
    if (this.seatOfPlayer(room, sess.id)) { this.sendMsg(sess, '你已经在这个房间里了'); return; }
    const free = room.seats.find(s => !s.player);
    if (!free) { this.sendMsg(sess, '房间已满（最多 4 人）'); return; }
    this.leaveRoom(sess, false); sess.profile = sess.profile || this.normProfile({}, null);
    sess.room = room.code;
    free.player = Object.assign({}, sess.profile, { id: sess.id, sess, ready: false });
    this.broadcastRoom(room); this.sendMsg(sess, '已加入房间 ' + room.code);
  }

  leaveRoom(sess, silentQuit) {
    this.rankQueue.delete(sess.id); if (!sess.room) return;
    const room = this.rooms.get(sess.room); sess.room = null; if (!room) return;
    const seat = this.seatOfPlayer(room, sess.id); if (!seat) return;
    const wasFight = seat.role === 'fight'; const other = this.fighters(room).find(p => p.id !== sess.id); seat.player = null;

    if (room.game && wasFight) {
      if (room.mode === 'ranked') {
        const st = room.game.engine && room.game.engine.state;
        const loserKey = room.game.A === sess.id ? 'A' : (room.game.B === sess.id ? 'B' : null);
        if (loserKey && st && !st.winner) this.settleRanked(room, loserKey === 'A' ? 'B' : 'A', sess);
        this.clearRankTimer(room); room.game = null; room.series = null; room.ended = true; room.status = 'waiting';
        room.seats.forEach((s) => { if (s.player) { this.sendSess(s.player.sess, { t: 'battle-end', reason: '对手已离开，本局判负' }); s.player.ready = false; } });
        room.seats.forEach((s) => { if (s.player) { s.player.sess.room = null; s.player = null; } });
        this.rooms.delete(room.code); return;
      }
      room.game = null; room.series = null; room.ended = false; room.status = 'waiting';
      room.seats.forEach(s => { if (s.player) s.player.ready = false; });
      if (other) this.sendMsg(other.sess, '对手已离开房间，本局作废');
      room.seats.forEach(s => { if (s.player) this.sendSess(s.player.sess, { t: 'battle-end', reason: '对手已离开，本局作废' }); });
    }
    if (silentQuit && other) this.sendMsg(other.sess, '有玩家断线离开了房间');
    if (!room.seats.some(s => s.player)) { this.rooms.delete(room.code); return; }
    if (room.hostId === sess.id) {
      const np = room.seats.find(s => s.player); room.hostId = np ? np.player.id : null;
      if (np) room.seats.forEach(s => { if (s.player) this.sendMsg(s.player.sess, '房主已离开，房主转让给 ' + np.player.name); });
    }
    this.broadcastRoom(room);
  }

  doStart(sess, arg) {
    const room = this.rooms.get(sess.room); if (!room) return;
    if (room.hostId !== sess.id) { this.sendMsg(sess, '只有房主可以开始'); return; }
    room.series = newServerSeries(arg); room.ended = false; this.broadcastRoom(room);
    room.seats.forEach(s => { if (s.player) this.sendSess(s.player.sess, { t: 'stage', stage: 'prep' }); });
  }

  setRule(sess, rule) {
    const room = this.rooms.get(sess.room); if (!room || room.hostId !== sess.id) return;
    if (['bo1', 'bo3', 'bo5'].indexOf(rule) < 0) return; room.rule = rule; this.broadcastRoom(room);
  }

  setReady(sess, v) {
    const room = this.rooms.get(sess.room); if (!room) return;
    const seat = this.seatOfPlayer(room, sess.id); if (!seat || seat.role !== 'fight') return;
    seat.player.ready = v !== false; this.broadcastRoom(room);
  }

  setDeck(sess, m) {
    const room = this.rooms.get(sess.room); if (!room) return;
    const seat = this.seatOfPlayer(room, sess.id); if (!seat) return;
    seat.player.deckName = String(m.deckName || '卡组').slice(0, 12);
    seat.player.deckIds = Array.isArray(m.deckIds) ? m.deckIds.slice(0, 40) : [];
    seat.player.ready = false;
    sess.profile = Object.assign({}, sess.profile, { deckName: seat.player.deckName, deckIds: seat.player.deckIds.slice() });
    this.broadcastRoom(room);
  }

  doSwapRequest(sess, role, idx) {
    const room = this.rooms.get(sess.room); if (!room) return;
    if (role !== 'fight' && role !== 'watch') return;
    const mine = this.seatOfPlayer(room, sess.id); if (!mine) return;
    const pick = (idx != null && room.seats[idx] && room.seats[idx].role === role) ? room.seats[idx] : null;
    if (pick === mine || (mine.role === role && !pick)) { this.sendMsg(sess, '你已经坐在这个席位了'); return; }
    if (pick) {
      if (!pick.player) { pick.player = mine.player; mine.player = null; pick.player.ready = false; this.broadcastRoom(room); this.sendMsg(sess, '已切换席位'); return; }
      room.swapReq = { from: sess.id, to: pick.player.id };
      this.sendSess(pick.player.sess, { t: 'swap-req', from: mine.player.name, fromRole: mine.role, toRole: role });
      this.sendMsg(sess, '已向 ' + pick.player.name + ' 发送交换席位申请…'); return;
    }
    const free = room.seats.find(s => s.role === role && !s.player);
    if (free) { free.player = mine.player; mine.player = null; free.player.ready = false; this.broadcastRoom(room); this.sendMsg(sess, '已切换席位'); return; }
    const occupied = room.seats.find(s => s.role === role && s.player);
    if (!occupied) { this.sendMsg(sess, '该席位已满'); return; }
    room.swapReq = { from: sess.id, to: occupied.player.id };
    this.sendSess(occupied.player.sess, { t: 'swap-req', from: mine.player.name, fromRole: mine.role, toRole: role });
    this.sendMsg(sess, '已向 ' + occupied.player.name + ' 发送交换席位申请…');
  }

  doSwapAnswer(sess, ok) {
    const room = this.rooms.get(sess.room); if (!room) return;
    const req = room.swapReq; if (!req || req.to !== sess.id) { this.sendMsg(sess, '没有待处理的交换申请'); return; }
    room.swapReq = null;
    const a = this.seatOfPlayer(room, req.from); const b = this.seatOfPlayer(room, req.to);
    if (!ok) { if (a && a.player) this.sendMsg(a.player.sess, '对方拒绝了交换席位的申请'); return; }
    if (!a || !b || !a.player || !b.player) { this.sendMsg(sess, '对方已不在房间'); return; }
    const pa = a.player, pb = b.player;
    a.player = pb; b.player = pa; pa.ready = false; pb.ready = false;
    this.broadcastRoom(room);
    this.sendMsg(pa.sess, '已与 ' + pb.name + ' 交换席位'); this.sendMsg(pb.sess, '已与 ' + pa.name + ' 交换席位');
  }

  beginBattle(sess, m) {
    const room = this.rooms.get(sess.room); if (!room) return;
    if (!this.seatOfPlayer(room, sess.id)) { this.sendMsg(sess, '你不在这个房间里'); return; }
    const fs2 = room.seats.filter(s => s.role === 'fight' && s.player);
    if (fs2.length !== 2) { this.sendMsg(sess, '需要两名对战玩家'); return; }
    if (room.mode !== 'ranked' && !fs2.every(s => s.player.ready)) { this.sendMsg(sess, '双方都点「准备」后才能开始'); return; }
    if (!fs2[0].player.deckIds.length || !fs2[1].player.deckIds.length) { this.sendMsg(sess, '有玩家的卡组是空的'); return; }

    const A = fs2[0].player, B = fs2[1].player;
    const eng = createEngine();
    eng.newGame({ playerDeck: A.deckIds.slice(), aiDeck: B.deckIds.slice(), playerName: A.name, aiName: B.name, playerHp: 40, playerMax: 40, aiHp: 40, first: room.series ? (room.series.firsts[room.series.round] || 'A') : ((m && m.first === 'B') ? 'B' : 'A'), seed: Number(m && m.seed) || (Date.now() >>> 0), mode: 'battle', tutorial: false });
    eng.state.players.A.isAI = false; eng.state.players.B.isAI = false; eng.state.ach.off = true;

    const ai = createAI(eng);
    room.round++;
    room.game = { engine: eng, ai, A: A.id, B: B.id };
    room.status = 'playing'; room.ended = false; fs2.forEach(s => { s.player.ready = false; });
    this.broadcastRoom(room); this.sendState(room, true);
  }

  snapshotFor(room, key, spectate) {
    const raw = room.game.engine.state; const copy = JSON.parse(JSON.stringify(raw));
    if (key === 'B') flipInPlace(copy);
    const maskPile = (arr) => Array.isArray(arr) ? arr.map(() => ({ iid: null, cardId: null })) : arr;
    if (spectate) { ['A', 'B'].forEach(k => { const p = copy.players[k]; if (!p) return; p.hand = maskPile(p.hand); p.deck = maskPile(p.deck); }); }
    else { const opp = copy.players.B; if (opp) { opp.hand = maskPile(opp.hand); opp.deck = maskPile(opp.deck); } }
    if (copy.pending && (spectate || copy.pending.actorKey !== 'A')) copy.pending = { kind: 'WAIT_OPPONENT', actorKey: copy.pending.actorKey };
    return copy;
  }

  sendState(room, initial) {
    const g = room.game; if (!g) return;
    this.armRankTimer(room);
    const st = g.engine.state;
    if (st.winner && !room.ended) {
      room.ended = true;
      if (room.mode === 'ranked') this.settleRanked(room, st.winner);
      const s = room.series;
      if (s && !s.over) { s.wins[st.winner] = (s.wins[st.winner] || 0) + 1; s.round++; if (s.wins.A >= s.need || s.wins.B >= s.need || s.round >= s.total) s.over = true; this.broadcastRoom(room); }
    }
    [['A', g.A], ['B', g.B]].forEach(([key, pid]) => {
      const sess = this.sessionOfPlayer(room, pid); if (!sess) return;
      this.sendSess(sess, { t: initial ? 'battle' : 'state', s: this.snapshotFor(room, key), over: !!st.winner, winner: st.winner || null, mode: room.mode, deadline: room.mode === 'ranked' ? (room.rankDeadline || 0) : 0 });
    });
    room.seats.forEach(s => {
      if (!s.player || s.role !== 'watch' || !s.player.sess) return;
      this.sendSess(s.player.sess, { t: initial ? 'battle' : 'state', s: this.snapshotFor(room, 'A', true), over: !!st.winner, winner: st.winner || null, spectator: true });
    });
    st.events = [];
  }

  doAct(sess, a) {
    const room = this.rooms.get(sess.room); const g = room && room.game;
    if (!g) { this.sendMsg(sess, '当前不在对局中'); return; }
    const myKey = g.A === sess.id ? 'A' : (g.B === sess.id ? 'B' : null);
    if (!myKey) { this.sendMsg(sess, '你是观战者，不能操作'); return; }
    const st = g.engine.state;
    if (st.winner) { this.sendMsg(sess, '对局已结束'); return; }
    if (st.active !== myKey) { this.sendMsg(sess, '还没轮到你'); return; }
    if (st.pending) { this.sendMsg(sess, '请先处理弹出的选择'); return; }
    const act = Object.assign({}, a); delete act._ai;
    const r = g.engine.tryAction(myKey === 'B' ? flipSides(act) : act);
    if (!r || !r.ok) { this.sendMsg(sess, '操作无效：' + ((r && (r.msg || r.reason)) || '未知原因')); return; }
    this.sendState(room, false);
  }

  doPrompt(sess, v) {
    const room = this.rooms.get(sess.room); const g = room && room.game; if (!g) return;
    const st = g.engine.state; if (!st.pending) return;
    const myKey = g.A === sess.id ? 'A' : (g.B === sess.id ? 'B' : null);
    if (st.pending.actorKey !== myKey) { this.sendMsg(sess, '现在不是在等你做选择'); return; }
    g.engine.resolvePrompt(myKey === 'B' ? flipSides(v) : v);
    this.sendState(room, false);
  }

  doResume(newSess, oldId) {
    const old = this.offline.get(String(oldId || ''));
    if (!old || !old.offline) { this.sendMsg(newSess, '原来的对局已结束或已超时'); return; }
    clearTimeout(old.timer); this.offline.delete(old.id); old.timer = null; old.offline = false;
    old.ws = newSess.ws;
    newSess.ws.serializeAttachment(old); // 恢复存档
    this.sendMsg(old, '已恢复到原来的对局');
    const room = old.room && this.rooms.get(old.room);
    if (room) {
      this.broadcastRoom(room);
      if (room.game) this.sendState(room, true);
      const other = room.seats.map(s => s.player).filter(p => p && p.id !== old.id && p.sess)[0];
      if (other) this.sendMsg(other.sess, '对手已重新连接，继续对局');
    }
  }

  checkRankedDeck(ids) { if (!Array.isArray(ids)) return '排位赛需要先选择卡组'; if (ids.length !== 20) return '排位赛必须使用 20 张卡组（当前 ' + ids.length + ' 张）'; return null; }
  rankClamp(n) { n = Math.round(Number(n)); if (!isFinite(n)) n = 1; return Math.max(1, Math.min(100, n)); }

  doRankedQueue(sess, m) {
    const score = this.rankClamp(m && m.score);
    const deckWhy = this.checkRankedDeck(sess.profile && sess.profile.deckIds);
    if (deckWhy) { this.sendMsg(sess, deckWhy); return; }
    sess.rankScore = score;
    if (sess.room) this.leaveRoom(sess, false);
    this.rankQueue.delete(sess.id);
    let best = null;
    this.rankQueue.forEach((e) => {
      if (!e || !e.sess || e.sess.id === sess.id) return;
      const d = Math.abs(e.score - score); if (d > RANK_RANGE) return;
      if (!best || d < best.d) best = { e: e, d: d };
    });
    if (best) { this.rankQueue.delete(best.e.sess.id); this.startRankedMatch(best.e.sess, sess); return; }
    this.rankQueue.set(sess.id, { sess: sess, score: score, since: Date.now() });
    this.sendSess(sess, { t: 'ranked-wait', score: score, queue: this.rankQueue.size, range: RANK_RANGE });
  }

  doRankedCancel(sess) { this.rankQueue.delete(sess.id); this.sendSess(sess, { t: 'ranked-cancel' }); }

  startRankedMatch(a, b) {
    const sa = this.rankClamp(a.rankScore), sb = this.rankClamp(b.rankScore);
    this.leaveRoom(a, false); this.leaveRoom(b, false);
    const room = mkRoom(this.randCode(), '');
    room.mode = 'ranked'; room.hostId = a.id; room.status = 'playing'; room.rank = { scoreA: sa, scoreB: sb };
    a.profile = a.profile || this.normProfile({}, null); b.profile = b.profile || this.normProfile({}, null);
    room.seats[0].player = Object.assign({}, a.profile, { id: a.id, sess: a, ready: true });
    room.seats[1].player = Object.assign({}, b.profile, { id: b.id, sess: b, ready: true });
    this.rooms.set(room.code, room); a.room = room.code; b.room = room.code;
    room.series = newServerSeries({ rule: 'bo1', need: 1, total: 1 });
    this.broadcastRoom(room);
    this.sendSess(a, { t: 'ranked-matched', room: this.pubRoomFor(room, a.id), score: sa });
    this.sendSess(b, { t: 'ranked-matched', room: this.pubRoomFor(room, b.id), score: sb });
    this.beginBattle(a, { first: Math.random() < 0.5 ? 'A' : 'B', seed: (Date.now() >>> 0) });
  }

  settleRanked(room, winnerKey, loserSess) {
    const g = room.game; if (!g || !room.rank) return;
    const winA = winnerKey === 'A'; const byForfeit = !!loserSess;
    const put = (pid, win, base, forfeit) => {
      let sess = this.sessionOfPlayer(room, pid);
      if (!sess && loserSess && loserSess.id === pid) sess = loserSess;
      if (!sess) return;
      const delta = win ? 1 : -1;
      this.sendSess(sess, { t: 'ranked-result', win, delta, score: this.rankClamp(base + delta), mode: 'ranked', forfeit: !!forfeit });
    };
    put(g.A, winA, room.rank.scoreA, byForfeit && !winA);
    put(g.B, !winA, room.rank.scoreB, byForfeit && winA);
    this.clearRankTimer(room);
  }

  clearRankTimer(room) { if (!room) return; if (room.rankTimer) { clearTimeout(room.rankTimer); room.rankTimer = null; } room.rankDeadline = 0; }

  armRankTimer(room) {
    if (!room || room.mode !== 'ranked') return;
    const g = room.game; if (!g) { this.clearRankTimer(room); return; }
    const st = g.engine.state; if (st.winner) { this.clearRankTimer(room); return; }
    const tag = (st.turnCount || 0) + ':' + st.active + ':' + (st.pending ? 'P' + st.pending.actorKey : 'R');
    if (room.rankTag === tag && room.rankTimer) return;
    this.clearRankTimer(room); room.rankTag = tag; room.rankDeadline = Date.now() + RANK_TURN_MS;
    room.rankTimer = setTimeout(() => this.onRankTimeout(room), RANK_TURN_MS);
  }

  onRankTimeout(room) {
    room.rankTimer = null; const g = room.game; if (!g) return;
    let st = g.engine.state;
    if (st.winner) { this.clearRankTimer(room); this.sendState(room, false); return; }
    if (st.pending) { try { g.engine.resolvePrompt(); } catch (e) { } st = g.engine.state; }
    if (st.winner) { this.clearRankTimer(room); this.sendState(room, false); return; }
    let r = null; try { r = g.engine.tryAction({ type: 'END_TURN' }); } catch (e) { }
    if (r && r.ok) { this.sendState(room, false); return; }
    room.rankTimer = setTimeout(() => this.onRankTimeout(room), 5000);
  }
}