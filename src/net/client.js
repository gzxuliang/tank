// 网络客户端：WebSocket 连接 + 房间协议 + 游戏消息收发
// 传输层可注入：浏览器用 WebSocket，Node 测试用内存管道（见 test/smoke.mjs）
//
// 用法：
//   const net = new NetClient(url);
//   net.on('created', (m) => ...); net.on('joined', ...); net.on('error', ...);
//   net.on('peer-joined', ...); net.on('peer-left', ...);
//   net.on('relay', (data) => ...);  // 对端发来的游戏消息
//   net.createRoom(); / net.joinRoom(code); / net.relay(data); / net.close();

export class NetClient {
  // transportFactory(url, handlers) → {send(str), close()}
  // 默认浏览器 WebSocket；测试可注入内存管道
  constructor(url, transportFactory = null) {
    this.url = url;
    this._handlers = {};
    this._factory = transportFactory || ((u, h) => {
      const ws = new WebSocket(u);
      ws.onopen = () => h.open();
      ws.onmessage = (e) => h.message(e.data);
      ws.onclose = () => h.close();
      ws.onerror = () => h.error();
      return { send: (s) => ws.readyState === 1 && ws.send(s), close: () => ws.close() };
    });
    this._transport = null;
    this.connected = false;
  }

  on(type, fn) { this._handlers[type] = fn; return this; }
  _emit(type, data) { if (this._handlers[type]) this._handlers[type](data); }

  connect() {
    this._transport = this._factory(this.url, {
      open: () => { this.connected = true; this._emit('open'); },
      close: () => { this.connected = false; this._emit('close'); },
      error: () => this._emit('socket-error'),
      message: (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        this._emit(msg.t, msg);
      },
    });
  }

  _send(msg) { if (this._transport) this._transport.send(JSON.stringify(msg)); }

  createRoom() { this._send({ t: 'create' }); }
  joinRoom(code) { this._send({ t: 'join', code }); }
  relay(data) { this._send({ t: 'relay', data }); }
  close() { if (this._transport) this._transport.close(); }
}

// 默认连接地址：优先 URL 参数 ?server=ws://host:port（合法则记住），
// 其次 localStorage 中记住的地址，最后回退到与页面同源（走 /ws 路径：
// Cloudflare 静态资源优先路由下，/ws 无对应文件才会进入 Worker → Durable Object；
// Node 版 server.js 不校验路径，同样兼容）
export function defaultServerUrl() {
  const param = new URLSearchParams(location.search).get('server');
  if (param && /^wss?:\/\//.test(param)) {
    try { localStorage.setItem('tank_server', param); } catch { /* 隐私模式等场景忽略 */ }
    return param;
  }
  let saved = null;
  try { saved = localStorage.getItem('tank_server'); } catch { /* 忽略 */ }
  if (saved && /^wss?:\/\//.test(saved)) return saved;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}
