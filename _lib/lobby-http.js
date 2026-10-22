import { Lobby as OriginalLobby } from './lobby.js';

export class LobbyHttp extends OriginalLobby {
  constructor(state, env) {
    super(state, env);
    this.conns = new Set(); // ★ 专门存长轮询的假 session
    this.pollQueues = new Map();    
    this.messageQueues = new Map(); 
  }

  async fetch(req) {
    const url = new URL(req.url);

    // --- HTTP 长轮询逻辑 ---
    if (url.pathname === '/api/send') {
      const sid = url.searchParams.get('sid');
      const body = await req.text();
      
      const fakeWs = {
        isFake: true,
        send: (msg) => {
          const q = this.pollQueues.get(sid);
          if (q && q.resolve) {
            q.resolve(new Response(msg, { status: 200, headers: { 'Access-Control-Allow-Origin': '*' } }));
            this.pollQueues.delete(sid);
          } else {
            if (!this.messageQueues.has(sid)) this.messageQueues.set(sid, []);
            this.messageQueues.get(sid).push(msg);
          }
        }
      };
      
      let sess = Array.from(this.conns).find(s => s.id === sid);
      if (!sess) {
        sess = { id: sid, ws: fakeWs, room: null, profile: null, offline: false, timer: null, bucket: { tokens: 60, at: Date.now() } };
        this.conns.add(sess);
        this.sendMsg(sess, JSON.stringify({ t: 'hello', id: sid, ranked: true, n: this.dstate.getWebSockets().length + this.conns.size })); // 发送 hello
      } else {
        sess.ws = fakeWs; 
      }

      try { this.handle(sess, JSON.parse(body)); } 
      catch (e) { this.sendMsg(sess, '服务器处理出错：' + e.message); }
      
      return new Response('ok', { status: 200, headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    if (url.pathname === '/api/poll') {
      const sid = url.searchParams.get('sid');
      const msgs = this.messageQueues.get(sid);
      if (msgs && msgs.length > 0) {
        return new Response(msgs.shift(), { status: 200, headers: { 'Access-Control-Allow-Origin': '*' } });
      }
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          this.pollQueues.delete(sid);
          resolve(new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } }));
        }, 20000);
        this.pollQueues.set(sid, {
          resolve: (res) => { clearTimeout(timer); resolve(res); }
        });
      });
    }

    // --- WebSocket 请求交还给父类 ---
    return super.fetch(req);
  }

  // ★ 核心魔法：重写发送逻辑。如果是假 WS 推队列，如果是真 WS 交父类。
  sendSess(sess, obj) {
    if (!sess) return;
    if (sess.ws && sess.ws.isFake) {
      sess.ws.send(JSON.stringify(obj));
    } else {
      super.sendSess(sess, obj);
    }
  }

  broadcastOnline() {
    const n = this.dstate.getWebSockets().length + this.conns.size;
    this.conns.forEach(s => { try { this.sendSess(s, { t: 'online-count', n }); } catch (e) { } });
    this.dstate.getWebSockets().forEach(ws => {
      this.send(ws, { t: 'online-count', n });
    });
  }
}