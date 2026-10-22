import { Lobby as OriginalLobby } from './lobby.js';

export class LobbyHttp extends OriginalLobby {
  constructor(state, env) {
    super(state, env);
    this.pollQueues = new Map();    // 挂起的 GET 请求
    this.messageQueues = new Map(); // ★ 未发出的消息暂存箱（防丢失）
  }

  // 重写 fetch，统一处理 HTTP 轮询
  async fetch(req) {
    const url = new URL(req.url);

    // 1. 处理前端发来的 POST 数据
    if (url.pathname === '/api/send') {
      const sid = url.searchParams.get('sid');
      const body = await req.text();
      
      const fakeWs = {
        send: (msg) => {
          // 如果前端正在挂起等待，直接发给他
          const q = this.pollQueues.get(sid);
          if (q && q.resolve) {
            q.resolve(new Response(msg, { status: 200, headers: { 'Access-Control-Allow-Origin': '*' } }));
            this.pollQueues.delete(sid);
          } else {
            // 如果前端还没发起 GET 拿货，把消息存进暂存箱
            if (!this.messageQueues.has(sid)) this.messageQueues.set(sid, []);
            this.messageQueues.get(sid).push(msg);
          }
        }
      };
      
      let sess = Array.from(this.conns).find(s => s.id === sid);
      if (!sess) {
        sess = { id: sid, ws: fakeWs, room: null, profile: null, offline: false, timer: null, bucket: { tokens: 60, at: Date.now() } };
        this.conns.add(sess);
        // 这里产生的 hello 消息，会被 push 进 messageQueues 暂存
        fakeWs.send(JSON.stringify({ t: 'hello', id: sid, ranked: true, n: this.conns.size }));
      } else {
        sess.ws = fakeWs; 
      }

      try { this.handle(sess, JSON.parse(body)); } 
      catch (e) { this.sendMsg(sess, '服务器处理出错：' + e.message); }
      
      return new Response('ok', { status: 200, headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    // 2. 处理前端发来的 GET 等待
    if (url.pathname === '/api/poll') {
      const sid = url.searchParams.get('sid');
      
      // 优先检查暂存箱里有没有消息
      const msgs = this.messageQueues.get(sid);
      if (msgs && msgs.length > 0) {
        return new Response(msgs.shift(), { status: 200, headers: { 'Access-Control-Allow-Origin': '*' } });
      }

      // 没消息，挂起等待
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

    // 3. 如果是 /ws 请求，交还给原本的 WebSocket 处理逻辑
    return super.fetch(req);
  }
}