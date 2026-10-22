import { Lobby } from './_lib/lobby.js';
export { Lobby };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('expected websocket', { status: 426 });
      }
      const id = env.LOBBY.idFromName('global');
      return env.LOBBY.get(id).fetch(request);
    }
    
    return new Response('Not Found', { status: 404 });
  }
};