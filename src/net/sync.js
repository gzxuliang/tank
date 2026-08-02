// 快照同步：服务端把权威 World 序列化，两个浏览器按快照重建镜像 World
import { Player } from '../game/player.js';
import { Enemy } from '../game/enemy.js';
import { Bullet } from '../game/bullet.js';
import { PowerUp } from '../game/powerup.js';
import { Explosion } from '../fx/effects.js';
import { FloatText } from '../fx/floattext.js';

// ---- 地形（变化时才发，Uint8Array → base64）----
export function serializeMap(tilemap, stageIndex) {
  return {
    t: 'map',
    sg: stageIndex,
    cells: btoa(String.fromCharCode(...tilemap.cells)),
    mask: btoa(String.fromCharCode(...tilemap.brickMask)),
    baseAlive: tilemap.baseAlive,
  };
}

export function applyMap(tilemap, msg) {
  const cells = atob(msg.cells), mask = atob(msg.mask);
  for (let i = 0; i < cells.length; i++) tilemap.cells[i] = cells.charCodeAt(i);
  for (let i = 0; i < mask.length; i++) tilemap.brickMask[i] = mask.charCodeAt(i);
  tilemap.baseAlive = msg.baseAlive;
  tilemap._dirty = true; // 触发地面层缓存重绘
}

// ---- 世界快照 ----
export function serializeWorld(world, extra = {}) {
  return {
    t: 'snap',
    hf: world.game.engine.frame, // 服务端帧号：浏览器插值缓冲的时间轴
    sg: world.stageIndex, // 关卡号：两端场景错位时客机丢弃过期快照
    st: world.state,
    stT: world.stateTimer,
    oR: world.overReason,
    pl: world.players.map((p) => ({
      id: p.id, x: p.x, y: p.y, dir: p.dir, lv: p.level,
      alive: p.alive, spT: p.spawnTimer, shT: p.shieldTimer,
      moving: p.moving, tread: p.treadFrame, slT: p.slideTimer || 0, slD: p.slideDir ?? p.dir,
    })),
    en: world.enemies.map((e) => ({
      id: e.id, x: e.x, y: e.y, dir: e.dir, type: e.type, hp: e.hp,
      hasP: e.hasPowerup, alive: e.alive, spT: e.spawnTimer,
      frz: !!e.frozen, hitF: e.hitFlash, moving: e.moving, tread: e.treadFrame,
    })),
    bu: world.bullets.map((b) => ({
      id: b.id, x: b.x, y: b.y, dir: b.dir, spd: b.speed, pow: b.power, isP: b.isPlayerBullet,
      own: b.ownerId ?? (b.owner && b.owner.id), fs: b.clientFireSeq, fe: b.clientFireEpoch,
    })),
    pu: world.powerups.map((p) => ({ id: p.id, x: p.x, y: p.y, type: p.type })),
    lv: [...world.lives],
    ks: world.killStats.map((k) => ({ ...k })),
    sc: world.game.score,
    sq: world.spawnQueue.length,
    frz: world.freezeTimer,
    shv: world.shovelTimer,
    fx: world.fxEvents,
    ...extra,                 // ev: 音效事件; ps: 服务端暂停标志
  };
}

// 快照缓冲：浏览器保留最近几帧快照，渲染时按 hf 时间轴插值。
const SNAP_BUFFER_MAX = 30;

// 快照入队 + 瞬时应用：状态/分数/地形/音效/特效/实体集合立即生效；
// 实体位置由 interpolateTo 插值，自己的玩家由预测和纠偏管理。
// selfSlot：当前浏览器自己的玩家 slot。
// 活动中的坦克始终由快照缓冲平滑显示，不能因为丢了一份快照就直接跳到最新坐标；
// 阵亡/重生（alive=false 或 spawnTimer>0）才立即落位。
// 缺省（无 selfSlot，测试直用）时行为不变
export function pushSnapshot(world, snap, selfSlot) {
  world.state = snap.st;
  world.stateTimer = snap.stT;
  world.overReason = snap.oR;
  world.freezeTimer = snap.frz;
  world.shovelTimer = snap.shv;
  world.lives = [...snap.lv];
  world.killStats = snap.ks.map((k) => ({ ...k }));
  world.game.score = snap.sc;
  // 出击队列只用于 HUD 剩余敌坦图标，用占位数组同步长度即可
  world.spawnQueue.length = snap.sq;

  syncPlayers(world, snap.pl, selfSlot);
  syncEnemies(world, snap.en);
  const self = selfSlot === undefined ? null : world.players.find((p) => p.slot === selfSlot);
  syncBullets(world, snap.bu, self && self.id);
  syncPowerups(world, snap.pu);

  // 视觉事件：爆炸/飘字在客机本地重建（粒子本地生成）
  for (const fx of snap.fx || []) {
    if (fx.k === 'ex') {
      world.explosions.push(new Explosion(fx.x, fx.y, fx.big));
      world.particles.burst(fx.x, fx.y, fx.big ? { count: 18 } : undefined);
      if (fx.big) world.shake.add(2, 10);
    } else if (fx.k === 'ft') {
      world.floatTexts.push(new FloatText(fx.x, fx.y, fx.text, fx.color));
    }
  }

  // 快照入队（按 hf 有序，同 hf 去重，截断到最近 N 帧）
  if (snap.hf === undefined) return; // 无 hf 的快照（测试直用）不做插值
  const buf = world._snapBuffer || (world._snapBuffer = []);
  let i = buf.length;
  while (i > 0 && buf[i - 1].hf >= snap.hf) i--;
  if (i < buf.length && buf[i].hf === snap.hf) buf[i] = { hf: snap.hf, snap };
  else buf.splice(i, 0, { hf: snap.hf, snap });
  while (buf.length > SNAP_BUFFER_MAX) buf.shift();
}

// 每渲染帧：把远端实体位置插值到 renderHf 时刻；自己的玩家跳过。
// 状态字段（方向/存活/动画等）已由 pushSnapshot 按最新快照写入，这里只写位置
// 缓冲不足时回退到最近帧位置
function findIn(list, id) {
  for (const s of list) if (s.id === id) return s;
  return null;
}

export function interpolateTo(world, renderHf, selfSlot) {
  const buf = world._snapBuffer;
  if (!buf || buf.length === 0) return;
  let f0 = buf[0], f1 = buf[0];
  for (const e of buf) {
    if (e.hf <= renderHf) f0 = e;
    else { f1 = e; break; }
  }
  if (f1.hf <= f0.hf) f1 = f0; // 缓冲不足：用最近帧
  const span = f1.hf - f0.hf;
  const t = span > 0 ? Math.min(1, Math.max(0, (renderHf - f0.hf) / span)) : 0;

  const self = selfSlot === undefined ? null : world.players.find((player) => player.slot === selfSlot);
  const selfId = self ? self.id : -1;

  // 玩家（跳过自己）
  for (const p of world.players) {
    if (p.id === selfId) continue;
    const s0 = findIn(f0.snap.pl, p.id), s1 = findIn(f1.snap.pl, p.id);
    if (!s0 && !s1) continue;
    if (!s0) { p.x = s1.x; p.y = s1.y; continue; } // 出生：直接用最近帧
    if (!s1) continue;                             // 已死亡（实体即将被瞬时应用删除）
    p.x = s0.x + (s1.x - s0.x) * t;
    p.y = s0.y + (s1.y - s0.y) * t;
  }
  // 敌人
  for (const e of world.enemies) {
    const s0 = findIn(f0.snap.en, e.id), s1 = findIn(f1.snap.en, e.id);
    if (!s0 && !s1) continue;
    if (!s0) { e.x = s1.x; e.y = s1.y; continue; }
    if (!s1) continue;
    e.x = s0.x + (s1.x - s0.x) * t;
    e.y = s0.y + (s1.y - s0.y) * t;
  }
  // 子弹（本地预测子弹 id<0 不在快照里，自动跳过）
  for (const b of world.bullets) {
    if (b.localPredicted) continue;
    const s0 = findIn(f0.snap.bu, b.id), s1 = findIn(f1.snap.bu, b.id);
    if (!s0 && !s1) continue;
    if (!s0) { b.x = s1.x; b.y = s1.y; continue; }
    if (!s1) continue;
    b.x = s0.x + (s1.x - s0.x) * t;
    b.y = s0.y + (s1.y - s0.y) * t;
  }
  // 道具
  for (const p of world.powerups) {
    const s0 = findIn(f0.snap.pu, p.id), s1 = findIn(f1.snap.pu, p.id);
    if (!s0 && !s1) continue;
    if (!s0) { p.x = s1.x; p.y = s1.y; continue; }
    if (!s1) continue;
    p.x = s0.x + (s1.x - s0.x) * t;
    p.y = s0.y + (s1.y - s0.y) * t;
  }
}

// 记录快照目标坐标；自己的活动坦克不直接改物理位置。
// 位置主要由快照缓冲插值每帧写入；死亡/出生动画（smooth 且 noSnap=false）或
// 与权威位置相差超过 24px（瞬移/复活）时直接落位，避免长距离滑翔。
function lerpEntity(e, x, y, smooth, noSnap) {
  if (smooth) {
    if (!noSnap && (e.x === undefined || Math.abs(e.x - x) > 24 || Math.abs(e.y - y) > 24)) {
      e.x = x; e.y = y;
    }
  } else {
    e.x = x; e.y = y;
  }
}

function syncPlayers(world, list, selfSlot) {
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    let p = world.players.find((pl) => pl.id === s.id);
    if (!p) {
      p = new Player(s.x, s.y, i);
      p.id = s.id;
      world.players.push(p);
    }
    // 自己的活动坦克保留本地控制字段和预测位置，权威差异由会话统一纠偏。
    const isSelf = p.slot === selfSlot;
    lerpEntity(p, s.x, s.y, true, s.alive && s.spT <= 0);
    p.level = s.lv; p._applyLevel();
    p.alive = s.alive; p.spawnTimer = s.spT; p.shieldTimer = s.shT;
    if (!isSelf || !s.alive || s.spT > 0) {
      p.dir = s.dir; p.moving = s.moving; p.treadFrame = s.tread;
      p.slideTimer = s.slT || 0; p.slideDir = s.slD ?? s.dir;
    }
  }
  world.players = world.players.filter((p) => list.some((s) => s.id === p.id));
}

function syncEnemies(world, list) {
  for (const s of list) {
    let e = world.enemies.find((en) => en.id === s.id);
    if (!e) {
      e = new Enemy(s.x, s.y, s.type, s.hasP, Math.random);
      e.id = s.id;
      world.enemies.push(e);
    }
    lerpEntity(e, s.x, s.y, true, s.alive && s.spT <= 0);
    e.dir = s.dir; e.hp = s.hp; e.alive = s.alive;
    e.spawnTimer = s.spT; e.frozen = s.frz; e.hitFlash = s.hitF;
    e.moving = s.moving; e.treadFrame = s.tread;
  }
  world.enemies = world.enemies.filter((e) => list.some((s) => s.id === e.id));
}

function syncBullets(world, list, selfId) {
  for (const s of list) {
    let b = world.bullets.find((bu) => bu.id === s.id);
    if (!b) {
      // 只有同一射手、同一连接代次和同一开火编号才能接管预测子弹。
      b = s.own === selfId && typeof s.fs === 'number' && typeof s.fe === 'number'
        ? world.bullets.find((lb) => lb.localPredicted && lb.ownerId === selfId &&
          lb.clientFireSeq === s.fs && lb.clientFireEpoch === s.fe)
        : null;
      if (b) {
        b.id = s.id;
        b.authorityConfirmed = true;
      } else {
        b = Object.create(Bullet.prototype); // 绕过 owner 构造，渲染只读 x/y
        b.id = s.id;
        world.bullets.push(b);
      }
    }
    const keepPrediction = b.localPredicted && b.ownerId === selfId && b.clientFireSeq === s.fs;
    if (!keepPrediction) { b.x = s.x; b.y = s.y; }
    b.dir = s.dir;
    b.speed = s.spd; b.power = s.pow; b.isPlayerBullet = s.isP;
    b.ownerId = s.own;
    b.clientFireEpoch = s.fe;
    b.owner = world.players.find((p) => p.id === s.own) || null;
    b.alive = true;
  }
  // 未确认的本地预测子弹保留；权威子弹按最新快照集合裁剪。
  world.bullets = world.bullets.filter((b) => b.alive &&
    (b.localPredicted && b.id < 0 || list.some((s) => s.id === b.id)));
}

function syncPowerups(world, list) {
  for (const s of list) {
    let p = world.powerups.find((pu) => pu.id === s.id);
    if (!p) {
      p = new PowerUp(s.x, s.y, s.type);
      p.id = s.id;
      world.powerups.push(p);
    }
    p.x = s.x; p.y = s.y; p.type = s.type;
  }
  world.powerups = world.powerups.filter((p) => list.some((s) => s.id === p.id));
}
