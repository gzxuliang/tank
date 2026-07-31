// 坦克大战联机服务器：HTTP 静态托管 + WebSocket 房间中继
// 用法：npm install && npm start，然后浏览器打开 http://localhost:8000
// 局域网：同一 WiFi 下其他设备访问 http://<本机IP>:8000
// 公网：部署到有公网 IP 的机器（或内网穿透），详见 README.zh-CN.md「公网部署」
//
// 服务器只做「房间配对 + 消息转发」，不解析游戏内容：
//   C→S {t:'create'}            创建房间 → S→C {t:'created', code}
//   C→S {t:'join', code}        加入房间 → S→C {t:'joined'} / {t:'error', msg}
//                               加入成功后房主收到 {t:'peer-joined'}
//   C→S {t:'relay', data}       游戏消息 → 原样转发给对端 {t:'relay', data}
//   任一方断开                  → 对端收到 {t:'peer-left'}，房间销毁
//
// 公网加固（环境变量可调）：
//   PORT               监听端口（默认 8000）
//   TLS_CERT/TLS_KEY   证书与私钥文件路径，同时设置时启用 HTTPS/WSS
//   MAX_CONN_PER_IP    每 IP 最大并发连接数（默认 20）
//   ROOM_IDLE_MINUTES  房间无 guest 的空闲存活时间（默认 30 分钟）
//   心跳：每 30s ping 一次，未回应的连接下一轮终止并清理房间
//   maxPayload 64KB：超限消息由 ws 库直接断开连接

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || 8000;
const MAX_CONN_PER_IP = Number(process.env.MAX_CONN_PER_IP || 20);
const ROOM_IDLE_MS = Number(process.env.ROOM_IDLE_MINUTES || 30) * 60 * 1000;
const HEARTBEAT_MS = 30 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.bat': 'text/plain; charset=utf-8',
};

// ---- 静态文件服务（限项目根目录内）----
const onRequest = (req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
};

// 设置了 TLS_CERT/TLS_KEY 时启用 HTTPS（WebSocket 随之升级为 WSS）
let server;
if (process.env.TLS_CERT && process.env.TLS_KEY) {
  server = https.createServer({
    cert: fs.readFileSync(process.env.TLS_CERT),
    key: fs.readFileSync(process.env.TLS_KEY),
  }, onRequest);
} else {
  server = http.createServer(onRequest);
}

// ---- 房间中继 ----
const rooms = new Map(); // code → { host: ws, guest: ws|null, createdAt: number }

function makeCode() {
  for (let i = 0; i < 100; i++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (!rooms.has(code)) return code;
  }
  return null;
}

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function leaveRoom(ws) {
  const code = ws._room;
  if (!code) return;
  ws._room = null;
  const room = rooms.get(code);
  if (!room) return;
  // 通知对端并销毁房间（第一版不支持中途重连）
  const peer = room.host === ws ? room.guest : room.host;
  send(peer, { t: 'peer-left' });
  if (peer) peer._room = null;
  rooms.delete(code);
}

// 每 IP 连接数限制，防公网恶意刷屏占满资源
const connCountByIp = new Map(); // ip → count

const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress || '';
  const count = connCountByIp.get(ip) || 0;
  if (count >= MAX_CONN_PER_IP) { ws.terminate(); return; }
  connCountByIp.set(ip, count + 1);

  ws._room = null;
  ws._alive = true; // 心跳标记：收到任何 pong 即续命
  ws.on('pong', () => { ws._alive = true; });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.t === 'create' && !ws._room) {
      const code = makeCode();
      if (!code) { send(ws, { t: 'error', msg: '房间已满，请稍后再试' }); return; }
      rooms.set(code, { host: ws, guest: null, createdAt: Date.now() });
      ws._room = code;
      send(ws, { t: 'created', code });
    } else if (msg.t === 'join' && !ws._room) {
      const room = rooms.get(String(msg.code || ''));
      if (!room) { send(ws, { t: 'error', msg: '房间不存在' }); return; }
      if (room.guest) { send(ws, { t: 'error', msg: '房间已满' }); return; }
      room.guest = ws;
      ws._room = String(msg.code);
      send(ws, { t: 'joined' });
      send(room.host, { t: 'peer-joined' });
    } else if (msg.t === 'relay' && ws._room) {
      const room = rooms.get(ws._room);
      if (!room) return;
      send(room.host === ws ? room.guest : room.host, { t: 'relay', data: msg.data });
    }
  });
  let cleaned = false; // close 与 error 可能都触发，只清理一次
  const onClose = () => {
    if (cleaned) return;
    cleaned = true;
    // 释放 IP 计数并清理房间
    const n = (connCountByIp.get(ip) || 1) - 1;
    if (n <= 0) connCountByIp.delete(ip); else connCountByIp.set(ip, n);
    leaveRoom(ws);
  };
  ws.on('close', onClose);
  ws.on('error', onClose);
});

// 心跳：终止沉默连接（公网上客户端断电/断网不会触发 close）
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws._alive) { ws.terminate(); continue; }
    ws._alive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);

// 空闲房间清理：长时间无人加入的房间回收房间码与连接
const reaper = setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (!room.guest && now - room.createdAt > ROOM_IDLE_MS) {
      send(room.host, { t: 'error', msg: '房间超时未有人加入，已关闭' });
      room.host._room = null;
      rooms.delete(code);
    }
  }
}, 60 * 1000);

wss.on('close', () => { clearInterval(heartbeat); clearInterval(reaper); });

server.listen(PORT, '0.0.0.0', () => {
  const proto = process.env.TLS_CERT ? 'https' : 'http';
  console.log(`坦克大战服务器已启动：${proto}://localhost:${PORT}`);
  console.log('局域网对战：让好友浏览器打开 ' + proto + '://<本机IP>:' + PORT);
  console.log('公网对战：部署到有公网 IP 的机器，见 README.zh-CN.md「公网部署」');
});
