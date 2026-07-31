// 快照同步：主机把 World 序列化为快照，客机应用到镜像 World
// 主机权威模型：只有主机跑游戏逻辑，客机按快照重建实体后复用 World.render
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
    sg: world.stageIndex, // 关卡号：两端场景错位时客机丢弃过期快照
    st: world.state,
    stT: world.stateTimer,
    oR: world.overReason,
    pl: world.players.map((p) => ({
      id: p.id, x: p.x, y: p.y, dir: p.dir, lv: p.level,
      alive: p.alive, spT: p.spawnTimer, shT: p.shieldTimer,
      moving: p.moving, tread: p.treadFrame,
    })),
    en: world.enemies.map((e) => ({
      id: e.id, x: e.x, y: e.y, dir: e.dir, type: e.type, hp: e.hp,
      hasP: e.hasPowerup, alive: e.alive, spT: e.spawnTimer,
      frz: !!e.frozen, hitF: e.hitFlash, moving: e.moving, tread: e.treadFrame,
    })),
    bu: world.bullets.map((b) => ({
      id: b.id, x: b.x, y: b.y, dir: b.dir, spd: b.speed, pow: b.power, isP: b.isPlayerBullet,
    })),
    pu: world.powerups.map((p) => ({ id: p.id, x: p.x, y: p.y, type: p.type })),
    lv: [...world.lives],
    ks: world.killStats.map((k) => ({ ...k })),
    sc: world.game.score,
    sq: world.spawnQueue.length,
    frz: world.freezeTimer,
    shv: world.shovelTimer,
    fx: world.fxEvents,       // 本帧视觉事件（主机在发送后清空）
    ...extra,                 // ev: 音效事件; ps: 主机暂停标志
  };
}

// 把快照应用到镜像世界（客机）。镜像世界是真实 World 实例，但从不跑 update 逻辑
export function applySnapshot(world, snap) {
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

  syncPlayers(world, snap.pl);
  syncEnemies(world, snap.en);
  syncBullets(world, snap.bu);
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
}

// 位置平滑：客机实体带 _tx/_ty 目标坐标，渲染帧间指数趋近（30Hz 快照下消除抖动）
// skip：本地预测的实体（客机自己的坦克）跳过平滑，由预测逻辑自行纠偏
function lerpEntity(e, x, y, smooth) {
  if (smooth) {
    e._tx = x; e._ty = y;
    if (e.x === undefined || Math.abs(e.x - x) > 24 || Math.abs(e.y - y) > 24) {
      e.x = x; e.y = y; // 首次出现或瞬移（出生/复活）直接落位
    }
  } else {
    e.x = x; e.y = y;
  }
}

// 每渲染帧调用：让实体坐标趋近快照目标
export function smoothEntities(world, skip = null) {
  for (const list of [world.players, world.enemies]) {
    for (const e of list) {
      if (e === skip || e._tx === undefined) continue;
      e.x += (e._tx - e.x) * 0.4;
      e.y += (e._ty - e.y) * 0.4;
    }
  }
}

function syncPlayers(world, list) {
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    let p = world.players.find((pl) => pl.id === s.id);
    if (!p) {
      p = new Player(s.x, s.y, i);
      p.id = s.id;
      world.players.push(p);
    }
    lerpEntity(p, s.x, s.y, true);
    p.dir = s.dir; p.level = s.lv; p._applyLevel();
    p.alive = s.alive; p.spawnTimer = s.spT; p.shieldTimer = s.shT;
    p.moving = s.moving; p.treadFrame = s.tread;
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
    lerpEntity(e, s.x, s.y, true);
    e.dir = s.dir; e.hp = s.hp; e.alive = s.alive;
    e.spawnTimer = s.spT; e.frozen = s.frz; e.hitFlash = s.hitF;
    e.moving = s.moving; e.treadFrame = s.tread;
  }
  world.enemies = world.enemies.filter((e) => list.some((s) => s.id === e.id));
}

function syncBullets(world, list) {
  for (const s of list) {
    let b = world.bullets.find((bu) => bu.id === s.id);
    if (!b) {
      b = Object.create(Bullet.prototype); // 绕过 owner 构造，渲染只读 x/y
      b.id = s.id;
      world.bullets.push(b);
    }
    b.x = s.x; b.y = s.y; b.dir = s.dir;
    b.speed = s.spd; b.power = s.pow; b.isPlayerBullet = s.isP;
    b.alive = true;
  }
  world.bullets = world.bullets.filter((b) => list.some((s) => s.id === b.id));
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
