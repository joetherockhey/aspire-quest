// ASPIRE Quest relay: one Durable Object per cohort room, relays positions, chat and squad invites.
// Stores nothing beyond each live socket's attachment; when everyone leaves, the room is empty.
const MAX_PLAYERS = 200;
const clean = m => {
  const p = {};
  if (typeof m.name === 'string') p.name = m.name.trim().slice(0, 24) || 'Student';
  if (/^#[0-9a-f]{6}$/i.test(m.color)) p.color = m.color;
  for (const k of ['x', 'y', 'xp', 'rank']) if (Number.isFinite(m[k])) p[k] = Math.max(0, Math.min(99999, m[k] | 0));
  if (typeof m.d === 'string') p.d = m.d.slice(0, 1);
  if (typeof m.top === 'string') p.top = m.top.slice(0, 40);
  return p;
};

export class Room {
  constructor(ctx) { this.ctx = ctx; }

  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    if (this.ctx.getWebSockets().length >= MAX_PLAYERS) return new Response('room full', { status: 503 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: crypto.randomUUID().slice(0, 8) });
    return new Response(null, { status: 101, webSocket: client });
  }

  send(ws, o) { try { ws.send(JSON.stringify(o)); } catch {} }
  others(ws) { return this.ctx.getWebSockets().filter(w => w !== ws); }
  broadcast(ws, o, self = false) { const s = JSON.stringify(o); for (const w of this.ctx.getWebSockets()) if (self || w !== ws) try { w.send(s); } catch {} }

  webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > 1000) return;
    let m; try { m = JSON.parse(raw); } catch { return; }
    const me = ws.deserializeAttachment();
    switch (m.t) {
      case 'hello':
      case 'me':
        Object.assign(me, clean(m)); ws.serializeAttachment(me);
        if (m.t === 'hello') this.send(ws, { t: 'init', you: me.id, players: this.others(ws).map(w => w.deserializeAttachment()).filter(p => p.name) });
        this.broadcast(ws, { t: 'up', p: me });
        break;
      case 'mv':
        Object.assign(me, clean({ x: m.x, y: m.y, d: m.d })); ws.serializeAttachment(me);
        this.broadcast(ws, { t: 'mv', id: me.id, x: me.x, y: me.y, d: me.d });
        break;
      case 'chat':
        if (typeof m.m === 'string' && m.m.trim()) this.broadcast(ws, { t: 'chat', id: me.id, m: m.m.trim().slice(0, 120) }, true);
        break;
      case 'emote':
        if (typeof m.e === 'string') this.broadcast(ws, { t: 'emote', id: me.id, e: m.e.slice(0, 4) }, true);
        break;
      case 'invite':
      case 'accept':
        for (const w of this.others(ws)) if (w.deserializeAttachment().id === m.to) this.send(w, { t: m.t, from: me.id, name: me.name, xp: me.xp, rank: me.rank });
        break;
    }
  }

  webSocketClose(ws) { this.broadcast(ws, { t: 'leave', id: ws.deserializeAttachment().id }); try { ws.close(); } catch {} }
  webSocketError(ws) { this.webSocketClose(ws); }
}

export default {
  fetch(req, env) {
    const m = new URL(req.url).pathname.match(/^\/room\/([\w-]{1,40})$/);
    if (!m) return new Response('ASPIRE Quest relay is running.');
    return env.ROOM.get(env.ROOM.idFromName(m[1].toLowerCase())).fetch(req);
  },
};
