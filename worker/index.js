// 坦克大战联机服务器（Cloudflare 版）：Workers 静态页面 + Durable Object 房间中继
// 与 server/server.js 使用同一房间协议（create/join/relay/peer-left），
// 浏览器客户端零改动：页面与 WebSocket 同源，defaultServerUrl() 直连即可。
//
// 架构：
//   普通请求        → Workers Static Assets（public/，由 worker/build-public.mjs 生成）
//   WebSocket 升级  → 全局唯一的 RoomLobby Durable Object（管理所有房间）
//
// 免费档要点：房间/连接元数据全部挂在 WebSocket attachment 上（休眠唤醒后仍在），
// 不使用存储 API；空闲时 Durable Object 自动休眠，不产生时长费用。

const MAX_PAYLOAD = 64 * 1024;        // 与 Node 版一致的 64KB 消息上限
const MAX_CONN_PER_IP = 20;           // 每 IP 最大并发连接
const ROOM_IDLE_MS = 30 * 60 * 1000;  // 房间无 guest 的空闲存活时间
const REAPER_MS = 60 * 1000;          // 空闲房间巡检间隔

export default {
  async fetch(request, env) {
    if (request.headers.get('Upgrade') === 'websocket') {
      // 全局唯一大厅实例：房间量小（每房 2 人），单实例足够且计费更省
      const id = env.LOBBY.idFromName('lobby');
      return env.LOBBY.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};

export class RoomLobby {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    // 每 IP 连接数限制（从所有活跃连接的 attachment 统计，休眠后依然准确）
    const ip = request.headers.get('cf-connecting-ip') || '';
    const sameIp = this.ctx.getWebSockets().filter((ws) => this._meta(ws).ip === ip);
    if (sameIp.length >= MAX_CONN_PER_IP) {
      return new Response('too many connections', { status: 429 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server); // 休眠 API：事件驱动，空闲不计时长
    server.serializeAttachment({ ip, code: null, role: null, at: Date.now() });
    this._ensureAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---- attachment 元数据 ----
  _meta(ws) { return ws.deserializeAttachment() || {}; }
  _setMeta(ws, patch) { ws.serializeAttachment({ ...this._meta(ws), ...patch }); }
  _peers(code) { return this.ctx.getWebSockets().filter((ws) => this._meta(ws).code === code); }
  _send(ws, msg) { try { ws.send(JSON.stringify(msg)); } catch { /* 连接已断开 */ } }

  webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_PAYLOAD) { ws.close(1009, 'too big'); return; }
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const meta = this._meta(ws);
    const now = Date.now();

    if (msg.t === 'create' && !meta.code) {
      let code = null;
      for (let i = 0; i < 100; i++) {
        const c = String(Math.floor(1000 + Math.random() * 9000));
        if (this._peers(c).length === 0) { code = c; break; }
      }
      if (!code) { this._send(ws, { t: 'error', msg: '房间已满，请稍后再试' }); return; }
      this._setMeta(ws, { code, role: 'host', at: now });
      this._send(ws, { t: 'created', code });
    } else if (msg.t === 'join' && !meta.code) {
      const code = String(msg.code || '');
      const peers = this._peers(code);
      if (peers.length === 0) { this._send(ws, { t: 'error', msg: '房间不存在' }); return; }
      if (peers.length >= 2) { this._send(ws, { t: 'error', msg: '房间已满' }); return; }
      this._setMeta(ws, { code, role: 'guest', at: now });
      this._setMeta(peers[0], { at: now }); // 已配对，房间不再算空闲
      this._send(ws, { t: 'joined' });
      this._send(peers[0], { t: 'peer-joined' });
    } else if (msg.t === 'relay' && meta.code) {
      // 原样转发给同房对端（不解析游戏内容，与 Node 版一致）
      for (const peer of this._peers(meta.code)) {
        if (peer !== ws) this._send(peer, { t: 'relay', data: msg.data });
      }
    }
  }

  webSocketClose(ws) { this._drop(ws); }
  webSocketError(ws) { this._drop(ws); }

  // 任一方断开：通知对端并解散房间（不支持中途重连，与 Node 版一致）
  _drop(ws) {
    const meta = this._meta(ws);
    if (!meta.code) return;
    for (const peer of this._peers(meta.code)) {
      if (peer !== ws) {
        this._send(peer, { t: 'peer-left' });
        this._setMeta(peer, { code: null, role: null });
      }
    }
  }

  // 定时回收空闲房间（只有房主且超时无人加入）
  async alarm() {
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const m = this._meta(ws);
      if (m.code && m.role === 'host' && this._peers(m.code).length === 1 &&
          now - m.at > ROOM_IDLE_MS) {
        this._send(ws, { t: 'error', msg: '房间超时未有人加入，已关闭' });
        this._setMeta(ws, { code: null, role: null });
      }
    }
    this._ensureAlarm();
  }

  _ensureAlarm() {
    // 同一时刻只有一个 alarm，重复调用相当于顺延
    this.ctx.storage.setAlarm(Date.now() + REAPER_MS).catch(() => {});
  }
}
