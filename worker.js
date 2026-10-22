// 注意这里引入了新建的 LobbyHttp
import { LobbyHttp as Lobby } from './_lib/lobby-http.js';
export { Lobby };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const id = env.LOBBY.idFromName('global');

    // 1. 原有的 WebSocket 逻辑
    if (url.pathname === '/ws') {
      return env.LOBBY.get(id).fetch(request);
    }

    // 2. 新增的 HTTP 轮询转发
    if (url.pathname.startsWith('/api/')) {
      const lobby = env.LOBBY.get(id);
      // 通过调用自定义的 handleHttp 绕过原本的 fetch
      return lobby.handleHttp(request); 
    }

    return new Response('Not Found', { status: 404 });
  }
};