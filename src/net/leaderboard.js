// 排行榜客户端：提交与查询（同源服务器，或 ?server= 指定的服务器）
import { defaultServerUrl } from './client.js';

export function apiBase() {
  try {
    return new URL(defaultServerUrl().replace(/^ws/, 'http')).origin;
  } catch {
    return location.origin;
  }
}

async function request(path, opts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(apiBase() + path, { ...opts, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // 服务器不可达 / 超时：静默失败，不影响游戏
  } finally {
    clearTimeout(timer);
  }
}

// 返回榜单数组，失败返回 null
export async function fetchTop(limit = 10) {
  const data = await request(`/api/leaderboard?limit=${limit}`);
  return data && Array.isArray(data.list) ? data.list : null;
}

// 返回 { improved, rank }，失败返回 null
export function submitScore(entry) {
  return request('/api/score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entry),
  });
}
