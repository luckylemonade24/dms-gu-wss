import { LobbyHttp as Lobby } from './_lib/lobby-http.js';
export { Lobby };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const id = env.LOBBY.idFromName('global');

    // WebSocket 和 轮询请求，统统丢给 Durable Object
    if (url.pathname === '/ws' || url.pathname.startsWith('/api/')) {
      return env.LOBBY.get(id).fetch(request); 
    }

    return new Response('Not Found', { status: 404 });
  }
};