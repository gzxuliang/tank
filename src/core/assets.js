// 资源系统：程序化高清矢量美术 —— 所有精灵以 3× 超采样绘制到离屏画布，
// 运行时通过 blit() 按逻辑尺寸贴图，得到平滑抗锯齿的现代画面
import { TILE, SUB } from './const.js';

const AS = 3; // 资源超采样倍数（与显示放大倍数一致，blit 时 1:1 无损）

// 以逻辑尺寸声明画布，内部放大 AS 倍；绘制代码全部使用逻辑坐标
function makeCanvas(lw, lh, fn) {
  const c = document.createElement('canvas');
  c.width = lw * AS; c.height = lh * AS;
  const g = c.getContext('2d');
  g.scale(AS, AS);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  fn(g);
  c._lw = lw; c._lh = lh;
  return c;
}

// 按精灵的逻辑尺寸贴图（所有渲染调用统一走这里）
export function blit(ctx, img, x, y) {
  ctx.drawImage(img, x, y, img._lw, img._lh);
}

// 创建离屏缓存图层（返回 [画布, 逻辑坐标上下文]），用于静态层预渲染
export function createLayer(lw, lh) {
  const c = document.createElement('canvas');
  c.width = lw * AS; c.height = lh * AS;
  const g = c.getContext('2d');
  g.scale(AS, AS);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  c._lw = lw; c._lh = lh;
  return [c, g];
}

function rotate90(src, times) {
  // times: 1=朝右 2=朝下 3=朝左（原图朝上）
  return makeCanvas(src._lw, src._lh, (g) => {
    g.translate(src._lw / 2, src._lh / 2);
    g.rotate(Math.PI / 2 * times);
    g.drawImage(src, -src._lw / 2, -src._lh / 2, src._lw, src._lh);
  });
}

// ---- 矢量绘图辅助 ----
function shade(hex, amt) {
  // 颜色明度偏移：amt 正为提亮、负为压暗
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const r = clamp((n >> 16) + amt), g = clamp(((n >> 8) & 0xff) + amt), b = clamp((n & 0xff) + amt);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

function lgrad(g, x0, y0, x1, y1, stops) {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  return gr;
}

function rgrad(g, x0, y0, r0, x1, y1, r1, stops) {
  const gr = g.createRadialGradient(x0, y0, r0, x1, y1, r1);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  return gr;
}

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function circle(g, x, y, r) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
}

// ---- 坦克绘制（16×16，朝上）----
// palette: {track, tread, body, dark, accent, turret}
function drawTankSprite(p, frame) {
  return makeCanvas(16, 16, (g) => {
    // 履带（左右两条，圆角 + 纵向渐变）
    for (const tx of [0.2, 12.8]) {
      g.fillStyle = lgrad(g, tx, 0, tx + 3, 0, [[0, shade(p.track, 35)], [1, shade(p.track, -35)]]);
      rr(g, tx, 1, 3, 14, 1.2); g.fill();
      g.strokeStyle = shade(p.track, -60); g.lineWidth = 0.4;
      rr(g, tx, 1, 3, 14, 1.2); g.stroke();
    }
    // 履带齿：随帧滚动
    g.fillStyle = shade(p.tread, 10);
    const off = frame ? 1.5 : 0;
    for (let y = 1.6 + off; y < 14.5; y += 3) {
      g.fillRect(0.6, y, 2.2, 1.1);
      g.fillRect(13.2, y, 2.2, 1.1);
    }
    // 车体：顶部受光的渐变 + 深色描边
    g.fillStyle = lgrad(g, 8, 2, 8, 14, [[0, shade(p.body, 30)], [0.55, p.body], [1, shade(p.body, -28)]]);
    rr(g, 3.2, 2, 9.6, 12, 1.6); g.fill();
    g.strokeStyle = shade(p.dark, -25); g.lineWidth = 0.5;
    rr(g, 3.2, 2, 9.6, 12, 1.6); g.stroke();
    // 前装甲斜面高光
    g.fillStyle = p.accent; g.globalAlpha = 0.75;
    rr(g, 4.6, 2.9, 6.8, 1.1, 0.5); g.fill();
    g.globalAlpha = 1;
    // 车身侧面细节缝
    g.strokeStyle = shade(p.body, -40); g.lineWidth = 0.35;
    g.beginPath(); g.moveTo(4.2, 6); g.lineTo(4.2, 12.5); g.moveTo(11.8, 6); g.lineTo(11.8, 12.5); g.stroke();
    // 炮管（先画，让炮塔压住根部）：金属横向渐变 + 炮口环
    g.fillStyle = lgrad(g, 7, 0, 9, 0, [[0, shade(p.dark, 10)], [0.5, shade(p.dark, 70)], [1, shade(p.dark, 10)]]);
    rr(g, 7, 0.3, 2, 6.8, 0.8); g.fill();
    g.fillStyle = shade(p.dark, -35);
    rr(g, 6.7, 0.3, 2.6, 1.3, 0.5); g.fill();
    // 炮塔：半球形径向渐变
    const tc = p.turret || p.body;
    g.fillStyle = rgrad(g, 6.8, 7.2, 0.5, 8, 9, 4.4, [[0, shade(tc, 45)], [0.65, tc], [1, shade(tc, -35)]]);
    circle(g, 8, 9, 3.4); g.fill();
    g.strokeStyle = shade(p.dark, -15); g.lineWidth = 0.5;
    circle(g, 8, 9, 3.4); g.stroke();
    // 炮塔顶部高光点
    g.fillStyle = 'rgba(255,255,255,0.5)';
    circle(g, 7, 7.6, 0.8); g.fill();
  });
}

// 各型坦克配色
const PALETTES = {
  player0: { track: '#7a5a10', tread: '#c8a030', body: '#e8b838', dark: '#6a4a08', turret: '#f0d060', accent: '#fff0a0' },
  player1: { track: '#7a5a10', tread: '#c8a030', body: '#e8b838', dark: '#6a4a08', turret: '#a0d048', accent: '#d0f080' },
  player2: { track: '#7a5a10', tread: '#c8a030', body: '#f0c848', dark: '#6a4a08', turret: '#48c0c8', accent: '#90e8f0' },
  player3: { track: '#7a5a10', tread: '#c8a030', body: '#f8d858', dark: '#6a4a08', turret: '#f07040', accent: '#ffb080' },
  basic:   { track: '#5a5248', tread: '#9a9088', body: '#c8bcA0', dark: '#4a443c', turret: '#d8ccb0', accent: '#f0e8d0' },
  fast:    { track: '#606060', tread: '#b0b0b0', body: '#e0e0e0', dark: '#484848', turret: '#f0f0f0', accent: '#ffffff' },
  power:   { track: '#2a6055', tread: '#48a090', body: '#58c8a8', dark: '#1f4a40', turret: '#78d8c0', accent: '#b0f0e0' },
  armor1:  { track: '#2a5a20', tread: '#48a038', body: '#48c040', dark: '#1f4a18', turret: '#68d858', accent: '#a0f090' },
  armor2:  { track: '#5a5a20', tread: '#a8a838', body: '#c8c040', dark: '#4a4a18', turret: '#dcd858', accent: '#f0f0a0' },
  armor3:  { track: '#6a4a18', tread: '#b8822e', body: '#d8922e', dark: '#54390f', turret: '#e8a848', accent: '#f8d090' },
  armor4:  { track: '#6a2018', tread: '#b04030', body: '#d84838', dark: '#541810', turret: '#e86050', accent: '#f8a090' },
  // 道具坦红色闪光配色
  flash:   { track: '#6a1010', tread: '#e04040', body: '#f05858', dark: '#500c0c', turret: '#ff8080', accent: '#ffc0c0' },
};

// ---- 地形贴图（8×8）----
function drawBrick() {
  return makeCanvas(8, 8, (g) => {
    g.fillStyle = '#4e1e0c'; g.fillRect(0, 0, 8, 8); // 灰浆缝
    const brick = (x, y, w, h) => {
      g.fillStyle = lgrad(g, x, y, x, y + h, [[0, '#d98a4e'], [0.55, '#bd6532'], [1, '#96441c']]);
      g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(255,220,180,0.45)'; g.fillRect(x, y, w, 0.5);   // 顶部受光
      g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(x, y + h - 0.5, w, 0.5); // 底部阴影
    };
    // 上下两排交错砌法
    brick(0.2, 0.2, 3.3, 3.5); brick(3.8, 0.2, 4.0, 3.5);
    brick(0.2, 4.1, 2.3, 3.6); brick(2.8, 4.1, 5.0, 3.6);
  });
}

function drawSteel() {
  return makeCanvas(8, 8, (g) => {
    // 拉丝金属斜向渐变
    g.fillStyle = lgrad(g, 0, 0, 8, 8, [[0, '#eef2f6'], [0.5, '#a8b2bc'], [1, '#78828c']]);
    g.fillRect(0, 0, 8, 8);
    // 内倒角：左上亮、右下暗
    g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 0.6;
    g.beginPath(); g.moveTo(0.4, 7.4); g.lineTo(0.4, 0.4); g.lineTo(7.4, 0.4); g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.4)';
    g.beginPath(); g.moveTo(7.6, 0.6); g.lineTo(7.6, 7.6); g.lineTo(0.6, 7.6); g.stroke();
    // 中央面板线
    g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 0.4;
    g.strokeRect(2, 2, 4, 4);
    // 四角铆钉
    for (const [x, y] of [[1.7, 1.7], [6.3, 1.7], [1.7, 6.3], [6.3, 6.3]]) {
      g.fillStyle = rgrad(g, x - 0.2, y - 0.2, 0.1, x, y, 0.9, [[0, '#ffffff'], [1, '#5a646e']]);
      circle(g, x, y, 0.8); g.fill();
    }
  });
}

function drawGrass(variant) {
  return makeCanvas(8, 8, (g) => {
    g.fillStyle = '#0e3a10'; g.fillRect(0, 0, 8, 8);
    // 三层草叶：三角叶片由深到浅叠加
    const layers = [
      { col: '#175c19', h: 5.5, n: 7, off: variant ? 0.6 : 0 },
      { col: '#1f7a22', h: 4.2, n: 8, off: variant ? 0.2 : 0.5 },
      { col: '#2f9e33', h: 2.8, n: 9, off: variant ? 0.9 : 0.3 },
    ];
    for (const L of layers) {
      g.fillStyle = L.col;
      for (let i = 0; i < L.n; i++) {
        const x = ((i * 2.9 + L.off * 3.1) % 8.4) - 0.2;
        const base = 8 - ((i * 1.7 + L.off) % 2.2);
        const tip = base - L.h * (0.75 + ((i * 37 % 10) / 40));
        g.beginPath();
        g.moveTo(x, base); g.lineTo(x + 0.7, tip); g.lineTo(x + 1.4, base);
        g.closePath(); g.fill();
      }
    }
  });
}

function drawWater(frame) {
  return makeCanvas(8, 8, (g) => {
    g.fillStyle = lgrad(g, 0, 0, 0, 8, [[0, '#1e56d8'], [0.6, '#1440b0'], [1, '#0c2c80']]);
    g.fillRect(0, 0, 8, 8);
    // 两道平滑波峰，两帧错相流动
    g.strokeStyle = 'rgba(170,215,255,0.8)'; g.lineWidth = 0.55; g.lineCap = 'round';
    const ph = frame ? 1.6 : 0;
    for (const wy of [2.4, 5.6]) {
      g.beginPath();
      g.moveTo(-0.5 + ph, wy);
      g.quadraticCurveTo(2 + ph, wy - 1.2, 4.5 + ph, wy);
      g.quadraticCurveTo(6.5 + ph, wy + 0.9, 8.5 + ph, wy);
      g.stroke();
      if (frame) { // 第二帧补一条回卷波，保证画面不断流
        g.beginPath();
        g.moveTo(-0.5 - 3.2 + ph, wy);
        g.quadraticCurveTo(2 - 3.2 + ph, wy - 1.2, 4.5 - 3.2 + ph, wy);
        g.stroke();
      }
    }
    // 波光点
    g.fillStyle = 'rgba(220,240,255,0.7)';
    circle(g, frame ? 6.2 : 2.2, frame ? 1.4 : 4.4, 0.45); g.fill();
    circle(g, frame ? 1.8 : 5.4, frame ? 6.8 : 7.2, 0.35); g.fill();
  });
}

function drawIce() {
  return makeCanvas(8, 8, (g) => {
    g.fillStyle = lgrad(g, 0, 0, 8, 8, [[0, '#e8f4ff'], [0.55, '#bcd8f0'], [1, '#9cc0e4']]);
    g.fillRect(0, 0, 8, 8);
    // 斜向高光带
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.beginPath(); g.moveTo(0, 3); g.lineTo(3, 0); g.lineTo(5, 0); g.lineTo(0, 5); g.closePath(); g.fill();
    // 冰裂纹
    g.strokeStyle = 'rgba(80,130,180,0.55)'; g.lineWidth = 0.35;
    g.beginPath(); g.moveTo(5.5, 1); g.lineTo(4.2, 3.2); g.lineTo(5.8, 5); g.lineTo(4.6, 7.2); g.stroke();
    g.beginPath(); g.moveTo(4.2, 3.2); g.lineTo(2.2, 3.8); g.stroke();
    // 闪光
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillRect(6.6, 1.4, 0.7, 0.7); g.fillRect(1.4, 6.2, 0.6, 0.6);
  });
}

// ---- 基地老鹰（16×16）----
function drawBase() {
  return makeCanvas(16, 16, (g) => {
    // 底座
    g.fillStyle = lgrad(g, 0, 12, 0, 16, [[0, '#9aa2ac'], [1, '#4c545e']]);
    rr(g, 2, 12.5, 12, 3.2, 0.8); g.fill();
    g.strokeStyle = '#2e343c'; g.lineWidth = 0.4; rr(g, 2, 12.5, 12, 3.2, 0.8); g.stroke();
    // 翅膀（三层羽翼，对称）
    g.fillStyle = lgrad(g, 0, 5, 0, 13, [[0, '#dfe5ec'], [1, '#8b95a1']]);
    for (const [y, w, o] of [[6, 3, 3], [8, 4, 2], [10, 5, 1]]) {
      rr(g, 8 - o - w + 1, y, w, 1.8, 0.7); g.fill();
      rr(g, 8 + o - 1, y, w, 1.8, 0.7); g.fill();
    }
    // 鹰身
    g.fillStyle = lgrad(g, 6, 0, 10, 0, [[0, '#eef2f7'], [0.6, '#c2cad4'], [1, '#98a2ae']]);
    rr(g, 5.8, 4.5, 4.4, 8.5, 1.6); g.fill();
    g.strokeStyle = '#3c444e'; g.lineWidth = 0.4; rr(g, 5.8, 4.5, 4.4, 8.5, 1.6); g.stroke();
    // 头部
    g.fillStyle = '#f4f7fb'; circle(g, 8, 3.6, 2.1); g.fill();
    g.strokeStyle = '#3c444e'; g.lineWidth = 0.35; circle(g, 8, 3.6, 2.1); g.stroke();
    // 喙与眼
    g.fillStyle = '#e8a838';
    g.beginPath(); g.moveTo(9.2, 3.2); g.lineTo(10.8, 3.8); g.lineTo(9.2, 4.4); g.closePath(); g.fill();
    g.fillStyle = '#20242a'; circle(g, 8.4, 3.2, 0.45); g.fill();
    // 胸前高光
    g.fillStyle = 'rgba(255,255,255,0.55)'; rr(g, 6.4, 5.4, 1, 6.5, 0.5); g.fill();
  });
}

function drawBaseDead() {
  return makeCanvas(16, 16, (g) => {
    // 废墟：碎裂的残块堆
    g.fillStyle = lgrad(g, 0, 8, 0, 16, [[0, '#5c646e'], [1, '#33383f']]);
    g.beginPath();
    g.moveTo(1, 16); g.lineTo(1, 12); g.lineTo(3.5, 10); g.lineTo(6, 11.5);
    g.lineTo(8, 9); g.lineTo(10.5, 11); g.lineTo(13, 9.5); g.lineTo(15, 12); g.lineTo(15, 16);
    g.closePath(); g.fill();
    g.strokeStyle = '#22262b'; g.lineWidth = 0.4; g.stroke();
    // 碎块切面高光
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.beginPath(); g.moveTo(3.5, 10); g.lineTo(6, 11.5); g.lineTo(4.5, 12.5); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(8, 9); g.lineTo(10.5, 11); g.lineTo(9, 12); g.closePath(); g.fill();
    // 裂缝
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 0.35;
    g.beginPath(); g.moveTo(6, 11.5); g.lineTo(6.8, 14.5); g.stroke();
    g.beginPath(); g.moveTo(10.5, 11); g.lineTo(11.4, 14); g.stroke();
  });
}

// ---- 道具图标（16×16，玻璃质感面板）----
function powerupBase(g, tint) {
  g.fillStyle = rgrad(g, 8, 5, 1, 8, 9, 11, [[0, '#333a48'], [1, '#141821']]);
  rr(g, 0.5, 0.5, 15, 15, 2.5); g.fill();
  // 彩色微光描边
  g.strokeStyle = tint; g.globalAlpha = 0.85; g.lineWidth = 0.8;
  rr(g, 0.9, 0.9, 14.2, 14.2, 2.2); g.stroke();
  g.globalAlpha = 1;
  // 顶部玻璃反光
  g.fillStyle = 'rgba(255,255,255,0.14)';
  rr(g, 2, 1.6, 12, 5, 2); g.fill();
}

function drawStar() {
  return makeCanvas(16, 16, (g) => {
    powerupBase(g, '#f8c820');
    g.save();
    g.shadowColor = '#ffb020'; g.shadowBlur = 2.5;
    g.fillStyle = lgrad(g, 8, 2.5, 8, 13.5, [[0, '#fff0a8'], [0.5, '#f8c820'], [1, '#d89010']]);
    g.beginPath();
    g.moveTo(8, 2.5); g.lineTo(9.6, 6.4); g.lineTo(13.5, 8); g.lineTo(9.6, 9.6);
    g.lineTo(8, 13.5); g.lineTo(6.4, 9.6); g.lineTo(2.5, 8); g.lineTo(6.4, 6.4);
    g.closePath(); g.fill();
    g.restore();
    g.fillStyle = 'rgba(255,255,255,0.75)'; circle(g, 7.2, 6.8, 0.8); g.fill();
  });
}

function drawHelmet() {
  return makeCanvas(16, 16, (g) => {
    powerupBase(g, '#c0c8d0');
    // 盔体：半球
    g.fillStyle = lgrad(g, 8, 4, 8, 10, [[0, '#f2f5f9'], [0.6, '#b8c0ca'], [1, '#7e8894']]);
    g.beginPath(); g.arc(8, 9.5, 4.5, Math.PI, 0); g.closePath(); g.fill();
    g.strokeStyle = '#454e58'; g.lineWidth = 0.4; g.stroke();
    // 盔檐
    g.fillStyle = lgrad(g, 0, 9.5, 0, 11.5, [[0, '#cfd6de'], [1, '#8b95a1']]);
    rr(g, 2.6, 9.3, 10.8, 2.2, 1); g.fill();
    g.strokeStyle = '#454e58'; g.lineWidth = 0.35; rr(g, 2.6, 9.3, 10.8, 2.2, 1); g.stroke();
    // 顶部棱线与高光
    g.fillStyle = '#9aa4b0'; rr(g, 7.2, 3.6, 1.6, 2.2, 0.6); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.8)'; circle(g, 6, 6.4, 1); g.fill();
  });
}

function drawGrenade() {
  return makeCanvas(16, 16, (g) => {
    powerupBase(g, '#68c068');
    // 弹体
    g.fillStyle = rgrad(g, 6.4, 5.6, 0.5, 8, 9, 5.6, [[0, '#6cb86c'], [0.6, '#3d7a3d'], [1, '#265026']]);
    circle(g, 8, 9.2, 4.4); g.fill();
    g.strokeStyle = '#1a3a1a'; g.lineWidth = 0.4; circle(g, 8, 9.2, 4.4); g.stroke();
    // 菠萝格纹路
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 0.4;
    g.beginPath(); g.moveTo(5.6, 6.4); g.lineTo(10.4, 12); g.moveTo(10.4, 6.4); g.lineTo(5.6, 12); g.stroke();
    // 引信与拉环
    g.fillStyle = '#aeb6c0'; rr(g, 6.8, 2.8, 2.4, 2.2, 0.5); g.fill();
    g.strokeStyle = '#d8dee6'; g.lineWidth = 0.7;
    circle(g, 10.8, 3.8, 1.3); g.stroke();
    // 高光
    g.fillStyle = 'rgba(255,255,255,0.5)'; circle(g, 6.2, 7.2, 1); g.fill();
  });
}

function drawLife() {
  return makeCanvas(16, 16, (g) => {
    powerupBase(g, '#e8b838');
    // 迷你坦克
    g.fillStyle = lgrad(g, 0, 5, 0, 12, [[0, '#8a6a18'], [1, '#5e480e']]);
    rr(g, 3.4, 5, 2.6, 7, 1); g.fill();
    rr(g, 10, 5, 2.6, 7, 1); g.fill();
    g.fillStyle = lgrad(g, 0, 4.5, 0, 12, [[0, '#f8d868'], [1, '#c09020']]);
    rr(g, 5.4, 4.5, 5.2, 7.5, 1.2); g.fill();
    g.strokeStyle = '#6a4a08'; g.lineWidth = 0.35; rr(g, 5.4, 4.5, 5.2, 7.5, 1.2); g.stroke();
    g.fillStyle = '#f8e8a0'; circle(g, 8, 8, 1.7); g.fill();
    g.fillStyle = '#6a4a08'; g.fillRect(7.3, 3, 1.4, 3.6);
  });
}

function drawShovel() {
  return makeCanvas(16, 16, (g) => {
    powerupBase(g, '#c0c8d0');
    // 铲头
    g.fillStyle = lgrad(g, 5, 9, 11, 14, [[0, '#eef2f6'], [1, '#8b95a1']]);
    g.beginPath();
    g.moveTo(5.2, 8.6); g.lineTo(10.8, 8.6); g.lineTo(9.6, 13.4); g.lineTo(6.4, 13.4);
    g.closePath(); g.fill();
    g.strokeStyle = '#454e58'; g.lineWidth = 0.4; g.stroke();
    // 木柄
    g.fillStyle = lgrad(g, 7.2, 0, 8.8, 0, [[0, '#c08848'], [1, '#8a5c28']]);
    rr(g, 7.2, 4.2, 1.6, 5, 0.6); g.fill();
    // D 型握把
    g.strokeStyle = '#aeb6c0'; g.lineWidth = 0.9;
    g.beginPath(); g.arc(8, 3.4, 1.7, Math.PI, 0); g.stroke();
    // 铲面高光
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillRect(5.8, 9.2, 2, 0.7);
  });
}

function drawClock() {
  return makeCanvas(16, 16, (g) => {
    powerupBase(g, '#68d8f0');
    // 铃铛
    g.fillStyle = '#f8c820';
    circle(g, 5, 3.8, 1.5); g.fill();
    circle(g, 11, 3.8, 1.5); g.fill();
    // 表盘
    g.fillStyle = rgrad(g, 7, 6.6, 0.5, 8, 8.6, 5, [[0, '#ffffff'], [1, '#c8d2dc']]);
    circle(g, 8, 8.6, 4.4); g.fill();
    g.strokeStyle = '#4a545e'; g.lineWidth = 0.5; circle(g, 8, 8.6, 4.4); g.stroke();
    // 刻度
    g.fillStyle = '#4a545e';
    g.fillRect(7.7, 4.8, 0.6, 1); g.fillRect(7.7, 11.4, 0.6, 1);
    g.fillRect(4.8, 8.3, 1, 0.6); g.fillRect(10.2, 8.3, 1, 0.6);
    // 指针
    g.strokeStyle = '#20242a'; g.lineWidth = 0.6; g.lineCap = 'round';
    g.beginPath(); g.moveTo(8, 8.6); g.lineTo(8, 5.8); g.stroke();
    g.beginPath(); g.moveTo(8, 8.6); g.lineTo(10.2, 9.4); g.stroke();
  });
}

// ---- 特效帧 ----
function drawSpawnFrame(i) {
  // 出生闪光：收缩旋转的四角星
  return makeCanvas(16, 16, (g) => {
    const colors = ['#ffffff', '#48c8f0', '#f0a048', '#f0f048'];
    const s = (7 - i) / 7;
    g.save();
    g.translate(8, 8);
    g.rotate(i * Math.PI / 8);
    g.scale(s, s);
    g.shadowColor = colors[i % 4]; g.shadowBlur = 3;
    g.fillStyle = colors[i % 4];
    g.beginPath();
    g.moveTo(0, -7); g.lineTo(1.6, -1.6); g.lineTo(7, 0); g.lineTo(1.6, 1.6);
    g.lineTo(0, 7); g.lineTo(-1.6, 1.6); g.lineTo(-7, 0); g.lineTo(-1.6, -1.6);
    g.closePath(); g.fill();
    g.restore();
  });
}

function drawShieldFrame(f) {
  return makeCanvas(16, 16, (g) => {
    // 旋转虚线能量环
    g.save();
    g.strokeStyle = f ? '#f0f8ff' : '#68d8f0';
    g.globalAlpha = 0.9;
    g.lineWidth = 1;
    g.lineCap = 'round';
    g.setLineDash([2.6, 2.2]);
    g.lineDashOffset = f * 2.4;
    g.shadowColor = '#48b8f0'; g.shadowBlur = 1.8;
    circle(g, 8, 8, 7.1); g.stroke();
    g.restore();
  });
}

function drawExplosionSmall(i) {
  return makeCanvas(12, 12, (g) => {
    const r = 2 + i * 1.9;
    g.fillStyle = rgrad(g, 6, 6, 0.2, 6, 6, r, [
      [0, '#ffffff'], [0.35, '#ffe890'], [0.7, '#f08020'], [1, 'rgba(240,128,32,0)'],
    ]);
    circle(g, 6, 6, r); g.fill();
    // 火花射线
    g.strokeStyle = 'rgba(255,240,180,0.9)'; g.lineWidth = 0.5; g.lineCap = 'round';
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + i * 0.5;
      g.beginPath();
      g.moveTo(6 + Math.cos(a) * r * 0.5, 6 + Math.sin(a) * r * 0.5);
      g.lineTo(6 + Math.cos(a) * (r + 1.6), 6 + Math.sin(a) * (r + 1.6));
      g.stroke();
    }
  });
}

function drawExplosionBig(i) {
  // 坦克爆炸：32×32，火球由散到聚再转烟
  return makeCanvas(32, 32, (g) => {
    const frames = [
      { r: 7, stops: [[0, '#ffffff'], [0.5, '#fff0a8'], [1, 'rgba(248,200,32,0)']] },
      { r: 12, stops: [[0, '#fff8d0'], [0.4, '#f8c820'], [0.8, '#f08020'], [1, 'rgba(240,128,32,0)']] },
      { r: 15, stops: [[0, '#ffe890'], [0.45, '#f08020'], [0.8, '#c04020'], [1, 'rgba(192,64,32,0)']] },
      { r: 11, stops: [[0, '#a86848'], [0.6, '#704838'], [1, 'rgba(80,60,50,0)']] },
    ];
    const { r, stops } = frames[i];
    g.fillStyle = rgrad(g, 16, 16, 0.5, 16, 16, r, stops);
    circle(g, 16, 16, r); g.fill();
    if (i === 1 || i === 2) {
      // 不规则火舌：四周附加小火球
      for (let k = 0; k < 6; k++) {
        const a = k * Math.PI / 3 + i * 0.7;
        const d = r * 0.75, fr = r * 0.35;
        const x = 16 + Math.cos(a) * d, y = 16 + Math.sin(a) * d;
        g.fillStyle = rgrad(g, x, y, 0.2, x, y, fr, [
          [0, 'rgba(255,232,144,0.9)'], [1, 'rgba(240,128,32,0)'],
        ]);
        circle(g, x, y, fr); g.fill();
      }
    }
    if (i === 3) {
      // 烟
      g.fillStyle = 'rgba(120,120,120,0.35)';
      circle(g, 12, 12, 4); g.fill();
      circle(g, 20, 14, 3.2); g.fill();
    }
  });
}

// ---- 子弹（6×6，炽热光点）----
function drawBullet() {
  return makeCanvas(6, 6, (g) => {
    g.fillStyle = rgrad(g, 3, 3, 0.2, 3, 3, 2.8, [
      [0, '#ffffff'], [0.45, '#ffe8a0'], [1, 'rgba(255,160,60,0)'],
    ]);
    circle(g, 3, 3, 2.8); g.fill();
    g.fillStyle = '#ffffff'; circle(g, 3, 3, 1.1); g.fill();
  });
}

// ---- HUD 小图标（8×8）----
function drawTankIcon(color) {
  return makeCanvas(8, 8, (g) => {
    g.fillStyle = shade(color, -70);
    rr(g, 0.8, 2, 1.6, 5, 0.6); g.fill();
    rr(g, 5.6, 2, 1.6, 5, 0.6); g.fill();
    g.fillStyle = lgrad(g, 0, 1.5, 0, 7, [[0, shade(color, 30)], [1, shade(color, -30)]]);
    rr(g, 2.2, 1.8, 3.6, 5.2, 0.8); g.fill();
    g.fillStyle = shade(color, -50); circle(g, 4, 4.4, 1.1); g.fill();
    g.fillStyle = shade(color, -70); g.fillRect(3.5, 0.2, 1, 2.6);
  });
}

function drawFlag() {
  return makeCanvas(8, 8, (g) => {
    g.fillStyle = '#d8dee6'; g.fillRect(0.9, 0.4, 0.9, 7.4);
    // 飘扬的旗面
    g.fillStyle = lgrad(g, 0, 1, 0, 5.4, [[0, '#5ce05c'], [1, '#28a028']]);
    g.beginPath();
    g.moveTo(1.8, 1); g.quadraticCurveTo(4.5, 0.2, 7.2, 1.2);
    g.lineTo(7.2, 4.4); g.quadraticCurveTo(4.5, 3.4, 1.8, 4.2);
    g.closePath(); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 0.3; g.stroke();
  });
}

// ---- 构建全部资源 ----
export function buildAssets() {
  const A = {};

  // 坦克：各配色 × 4 方向 × 2 履带帧
  A.tanks = {};
  for (const [name, p] of Object.entries(PALETTES)) {
    const up0 = drawTankSprite(p, 0);
    const up1 = drawTankSprite(p, 1);
    A.tanks[name] = [
      [up0, up1],
      [rotate90(up0, 1), rotate90(up1, 1)],
      [rotate90(up0, 2), rotate90(up1, 2)],
      [rotate90(up0, 3), rotate90(up1, 3)],
    ];
  }

  // 地形
  A.brick = drawBrick();
  A.steel = drawSteel();
  A.grass = [drawGrass(0), drawGrass(1)];
  A.water = [drawWater(0), drawWater(1)];
  A.ice = drawIce();
  A.base = drawBase();
  A.baseDead = drawBaseDead();

  // 道具
  A.powerups = {
    star: drawStar(),
    helmet: drawHelmet(),
    grenade: drawGrenade(),
    life: drawLife(),
    shovel: drawShovel(),
    clock: drawClock(),
  };

  // 特效帧
  A.spawn = [0, 1, 2, 3].map(drawSpawnFrame);
  A.shield = [drawShieldFrame(0), drawShieldFrame(1)];
  A.explSmall = [0, 1, 2].map(drawExplosionSmall);
  A.explBig = [0, 1, 2, 3].map(drawExplosionBig);

  A.bullet = drawBullet();
  A.enemyIcon = drawTankIcon('#d04838');
  A.lifeIcon = drawTankIcon('#e8b838');
  A.flagIcon = drawFlag();

  return A;
}
