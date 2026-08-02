// 联网传输客户端：协议 v3、房间操作、输入批次和恢复连接
export const NET_PROTOCOL_VERSION = 3;

export class NetClient {
  // transportFactory(url, handlers) → {send(str), close()}
  constructor(url, transportFactory = null) {
    this.url = url;
    this._handlers = new Map();
    this._factory = transportFactory || ((target, handlers) => {
      const ws = new WebSocket(target);
      ws.onopen = () => handlers.open();
      ws.onmessage = (event) => handlers.message(event.data);
      ws.onclose = () => handlers.close();
      ws.onerror = () => handlers.error();
      return { send: (data) => ws.readyState === 1 && ws.send(data), close: () => ws.close() };
    });
    this._transport = null;
    this._generation = 0;
    this.connected = false;
  }

  on(type, handler) {
    let handlers = this._handlers.get(type);
    if (!handlers) { handlers = new Set(); this._handlers.set(type, handlers); }
    handlers.add(handler);
    return () => handlers.delete(handler);
  }

  _emit(type, data) {
    for (const handler of this._handlers.get(type) || []) handler(data);
  }

  connect() {
    const generation = ++this._generation;
    this._transport = this._factory(this.url, {
      open: () => {
        if (generation !== this._generation) return;
        this.connected = true;
        this._emit('open');
      },
      close: () => {
        if (generation !== this._generation) return;
        this.connected = false;
        this._emit('close');
      },
      error: () => {
        if (generation === this._generation) this._emit('socket-error');
      },
      message: (raw) => {
        if (generation !== this._generation) return;
        let message;
        try { message = JSON.parse(raw); } catch { return; }
        this._emit(message.t, message);
        this._emit('message', message);
      },
    });
  }

  send(message) {
    if (!this._transport || !this.connected) return false;
    this._transport.send(JSON.stringify(message));
    return true;
  }

  createRoom(game = 'tank') { this.send({ t: 'create', protocol: NET_PROTOCOL_VERSION, game }); }
  joinRoom(code) { this.send({ t: 'join', protocol: NET_PROTOCOL_VERSION, code }); }
  resume(code, token) { this.send({ t: 'resume', protocol: NET_PROTOCOL_VERSION, code, token }); }
  sendInputs(epoch, frames) { this.send({ t: 'input', epoch, frames }); }
  command(epoch, command, data = {}) { return this.send({ t: 'command', epoch, command, ...data }); }

  close() {
    this._generation++;
    this.connected = false;
    if (this._transport) this._transport.close();
    this._transport = null;
  }
}

// 默认连接同源 Node 服务，也可用 ?server=ws://host:port 指定并记住地址。
export function defaultServerUrl() {
  const param = new URLSearchParams(location.search).get('server');
  if (param && /^wss?:\/\//.test(param)) {
    try { localStorage.setItem('tank_server', param); } catch { /* 存储不可用时忽略 */ }
    return param;
  }
  let saved = null;
  try { saved = localStorage.getItem('tank_server'); } catch { /* 存储不可用时忽略 */ }
  if (saved && /^wss?:\/\//.test(saved)) return saved;
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}/ws`;
}
