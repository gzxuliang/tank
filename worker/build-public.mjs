// 把游戏静态文件（index.html + src/）拷到 public/，供 Workers Static Assets 托管
// 用法：node worker/build-public.mjs（部署 Worker 前执行，CI 里也会自动跑）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const copy = (src, dst) => {
  if (fs.statSync(src).isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) copy(path.join(src, name), path.join(dst, name));
  } else {
    fs.copyFileSync(src, dst);
  }
};

copy(path.join(ROOT, 'index.html'), path.join(OUT, 'index.html'));
copy(path.join(ROOT, 'src'), path.join(OUT, 'src'));
console.log('public/ 已生成（index.html + src/）');
