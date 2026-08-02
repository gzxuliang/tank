// 坦克大战服务器：HTTP 静态托管 + 通用实时对局服务
// 用法：npm install && npm start，然后浏览器打开 http://localhost:8000
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { GameRegistry, RealtimeGameService } from './runtime/realtime-service.js';
import { tankGameDefinition } from './games/tank-match.js';

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

// 静态文件只从白名单路径提供服务：仅 /index.html 与 /src/ 目录可访问，
// 其余（.git、server/、部署脚本、镜像包、test/ 等）一律 403，
// 防止仓库内的敏感文件被 HTTP 下载；穿越检查保留作纵深防御。
const onRequest = (req, res) => {
  let urlPath;
  try { urlPath = decodeURIComponent((req.url || '/').split('?')[0]); }
  catch { res.writeHead(400); res.end('Bad Request'); return; }
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath !== '/index.html' && !urlPath.startsWith('/src/')) {
    res.writeHead(403);
    res.end();
    return;
  }
  const file = path.normalize(path.join(ROOT, urlPath));
  const relative = path.relative(ROOT, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
};

let server;
if (process.env.TLS_CERT && process.env.TLS_KEY) {
  server = https.createServer({
    cert: fs.readFileSync(process.env.TLS_CERT),
    key: fs.readFileSync(process.env.TLS_KEY),
  }, onRequest);
} else {
  server = http.createServer(onRequest);
}

const registry = new GameRegistry().register(tankGameDefinition);
const realtime = new RealtimeGameService(registry, { roomIdleMs: ROOM_IDLE_MS });
const connCountByIp = new Map();
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });

wss.on('connection', (ws, req) => {
  // IPv4-mapped IPv6（::ffff:x.x.x.x）归一化为 IPv4，防止双栈绕过每 IP 上限
  const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  const count = connCountByIp.get(ip) || 0;
  if (count >= MAX_CONN_PER_IP) { ws.terminate(); return; }
  connCountByIp.set(ip, count + 1);

  ws._alive = true;
  realtime.attach(ws);
  ws.on('pong', () => { ws._alive = true; });
  ws.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    realtime.handleMessage(ws, message);
  });

  let cleaned = false;
  const onClose = () => {
    if (cleaned) return;
    cleaned = true;
    const remaining = (connCountByIp.get(ip) || 1) - 1;
    if (remaining <= 0) connCountByIp.delete(ip);
    else connCountByIp.set(ip, remaining);
    realtime.handleClose(ws);
  };
  ws.on('close', onClose);
  ws.on('error', onClose);
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws._alive) { ws.terminate(); continue; }
    ws._alive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);

realtime.start();
wss.on('close', () => {
  clearInterval(heartbeat);
  realtime.stop();
});

server.listen(PORT, '0.0.0.0', () => {
  const proto = process.env.TLS_CERT ? 'https' : 'http';
  console.log(`坦克大战服务器已启动：${proto}://localhost:${PORT}`);
  console.log('服务器权威模拟已启用：60Hz 逻辑，30Hz 快照，断线可在 30 秒内恢复');
});
