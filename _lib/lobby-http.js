import { Lobby as OriginalLobby } from './lobby.js';

export class LobbyHttp extends OriginalLobby {
  constructor(state, env) {
    super(state, env);
    this.pollQueues = new Map(); // 新增：轮询挂起队列
    this.lastPollTime = new Map(); // 监控心跳
  }

  // 专门处理 HTTP 轮询请求的方法
  async handleHttp(request) {
    const url = new URL(request.url);

    // 1. 处理前端发来的普通 POST 数据
    if (url.pathname === '/api/send') {
      const sid = url.searchParams.get('sid');
      const body = await request.text();
      
      // 伪造一个拥有 send 方法的假 WebSocket，用来欺骗原本的 handle
      const fakeWs = {
        send: (msg) => {
          const q = this.pollQueues.get(sid);
          if (q && q.resolve) {
            q.resolve(new Response(msg, { status: 200 }));
            this.pollQueues.delete(sid);
          }
        }
      };
      
      // 如果这个玩家是第一次来，给他新建一个 session
      let sess = Array.from(this.conns).find(s => s.id === sid);
      if (!sess) {
        sess = { id: sid, ws: fakeWs, room: null, profile: null, offline: false, timer: null, bucket: { tokens: 60, at: Date.now() } };
        this.conns.add(sess);
        // 发送 hello 消息
        fakeWs.send(JSON.stringify({ t: 'hello', id: sid, ranked: true, n: this.conns.size }));
      } else {
        sess.ws = fakeWs; // 更新引用
      }

      // 把数据丢给父类原本的消息处理函数！
      try { this.handle(sess, JSON.parse(body)); } 
      catch (e) { this.sendMsg(sess, '服务器处理出错：' + e.message); }
      
      return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*' } });
    }

    // 2. 处理前端发来的 GET 轮询请求（挂起）
    if (url.pathname === '/api/poll') {
      const sid = url.searchParams.get('sid');
      
      return new Promise((resolve) => {
        // 设置超时 25 秒，没消息就返回 204 让前端重新连
        const timer = setTimeout(() => {
          this.pollQueues.delete(sid);
          this.checkDisconnect(sid); // 检查是否掉线
          resolve(new Response(null, { status: 204 }));
        }, 25000);

        this.pollQueues.set(sid, {
          resolve: (res) => {
            clearTimeout(timer);
            resolve(res);
          }
        });
      });
    }

    // 不是轮询请求，交还给父类原本的 WebSocket 处理逻辑
    return super.fetch(request);
  }

  // 辅助清理掉线玩家
  checkDisconnect(sid) {
    const now = Date.now();
    this.lastPollTime.set(sid, now);
    // 如果超过 60 秒没来 poll，判定掉线
    setTimeout(() => {
      if (this.lastPollTime.get(sid) === now) {
        const sess = Array.from(this.conns).find(s => s.id === sid);
        if (sess) {
          this.conns.delete(sess);
          this.onClose(sess); // 调用父类的清理逻辑
        }
      }
    }, 60000);
  }
}