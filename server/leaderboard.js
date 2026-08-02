// 排行榜：内存存储 + JSON 文件持久化 + HTTP 接口（每个名字只保留最佳成绩）
import fs from 'node:fs';
import path from 'node:path';

const MAX_ENTRIES = 100;      // 榜单容量
const MAX_BODY = 4096;        // POST 请求体上限（字节）
const MAX_SCORE = 99_999_999;
const MODES = ['1p', '2p', 'net'];

function cleanName(name) {
  return String(name ?? '').replace(/[\x00-\x1f\x7f]/g, '').trim();
}

function validate(body) {
  const name = cleanName(body?.name);
  if (name.length < 1 || name.length > 12) return { error: 'name' };
  const { score, stage, mode } = body;
  if (!Number.isInteger(score) || score < 0 || score > MAX_SCORE) return { error: 'score' };
  if (!Number.isInteger(stage) || stage < 1 || stage > 99) return { error: 'stage' };
  if (!MODES.includes(mode)) return { error: 'mode' };
  return { entry: { name, score, stage, mode, cleared: !!body.cleared } };
}

function byRank(a, b) {
  return b.score - a.score || a.ts - b.ts || a.name.localeCompare(b.name);
}

export class LeaderboardStore {
  constructor(file, { max = MAX_ENTRIES } = {}) {
    this.file = file;
    this.max = max;
    this.entries = [];
  }

  load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(data)) {
        this.entries = data.filter((e) => e && typeof e.name === 'string' && Number.isInteger(e.score));
      }
    } catch { /* 文件缺失或损坏：从空榜开始 */ }
    this.entries.sort(byRank);
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.entries));
      fs.renameSync(tmp, this.file); // 同目录 rename，原子替换
    } catch { /* 只读文件系统：本次成绩仅保留在内存 */ }
  }

  list(limit = 10) {
    return this.entries.slice(0, Math.min(limit, this.max))
      .map(({ name, score, stage, mode, cleared }) => ({ name, score, stage, mode, cleared }));
  }

  rankOf(name) {
    const i = this.entries.findIndex((e) => e.name === name);
    return i >= 0 && i < this.max ? i + 1 : null;
  }

  // 提交成绩；同名只在更高分时覆盖。返回 { ok:true, improved, rank } 或 { ok:false, error }
  submit(body) {
    const { entry, error } = validate(body);
    if (error) return { ok: false, error };
    const existing = this.entries.find((e) => e.name === entry.name);
    if (existing && entry.score <= existing.score) {
      return { ok: true, improved: false, rank: this.rankOf(entry.name) };
    }
    if (existing) this.entries.splice(this.entries.indexOf(existing), 1);
    this.entries.push({ ...entry, ts: Date.now() });
    this.entries.sort(byRank);
    this.entries.length = Math.min(this.entries.length, this.max);
    this.save();
    return { ok: true, improved: true, rank: this.rankOf(entry.name) };
  }
}

// HTTP 接口：GET /api/leaderboard?limit=N 与 POST /api/score；其余 /api/* 返回 404
export function createLeaderboardHandler(store, { rateMs = 5000, now = () => Date.now() } = {}) {
  const lastPostByIp = new Map();
  const json = (res, status, obj) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(obj));
  };
  return (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/leaderboard') {
      const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') || '10', 10) || 10, store.max));
      json(res, 200, { list: store.list(limit) });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/score') {
      // 每 IP 限速（与 server.js 的 ::ffff: 归一化保持一致），防止刷屏
      const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
      if (now() - (lastPostByIp.get(ip) || 0) < rateMs) {
        json(res, 429, { error: '提交过于频繁' });
        return;
      }
      if (lastPostByIp.size > 1000) lastPostByIp.clear(); // 防止映射无界增长
      lastPostByIp.set(ip, now());
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > MAX_BODY) { json(res, 413, { error: '请求体过大' }); req.destroy(); }
      });
      req.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(body); } catch { json(res, 400, { error: 'JSON 解析失败' }); return; }
        const result = store.submit(parsed);
        json(res, result.ok ? 200 : 400, result);
      });
      return;
    }
    json(res, 404, { error: 'not found' });
  };
}
