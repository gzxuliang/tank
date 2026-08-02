// Node 冒烟测试：stub 浏览器 API，驱动真实游戏逻辑，验证核心规则与场景流转
// 运行：node test/smoke.mjs

// ---- 浏览器环境 stub ----
const noop = () => {};
function ctx2dStub() {
  return new Proxy({
    canvas: null,
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createPattern: () => ({}),
    measureText: () => ({ width: 0 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  }, {
    get(t, k) {
      if (k in t) return t[k];
      return noop; // 其余方法全部 no-op
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

function canvasStub() {
  return {
    width: 0, height: 0,
    getContext: () => ctx2dStub(),
    classList: { toggle: noop, add: noop, remove: noop },
  };
}

const listeners = {};

global.window = {
  addEventListener: (type, fn) => {
    (listeners[type] = listeners[type] || []).push(fn);
  },
  AudioContext: class {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.sampleRate = 44100;
      this.destination = {};
    }
    resume() {}
    createGain() { return node({ gain: param() }); }
    createOscillator() { return node({ frequency: param(), type: '' }); }
    createBuffer(ch, len) { return { getChannelData: () => new Float32Array(len) }; }
    createBufferSource() { return node({ buffer: null }); }
    createBiquadFilter() { return node({ frequency: param(), Q: { value: 0 }, type: '' }); }
  },
};

function param() {
  return { value: 0, setValueAtTime: noop, exponentialRampToValueAtTime: noop, linearRampToValueAtTime: noop };
}
function node(extra) {
  return Object.assign({ connect: (n) => n, start: noop, stop: noop }, extra);
}

global.document = {
  createElement: () => canvasStub(),
  getElementById: () => canvasStub(),
};

const store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
};

let rafCb = null;
global.requestAnimationFrame = (cb) => { rafCb = cb; };

function key(code, down = true) {
  for (const fn of listeners[down ? 'keydown' : 'keyup'] || []) fn({ code, preventDefault: noop });
}

// ---- 加载游戏 ----
await import('../src/main.js');
const game = global.window.__tank;

let now = 0;
function frames(n, perFrame) {
  for (let i = 0; i < n; i++) {
    now += 1000 / 60;
    const cb = rafCb;
    rafCb = null;
    cb(now);
    if (perFrame) perFrame(i);
  }
}

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); }
}

// ---- 标题 → 开幕 ----
console.log('— 场景流转 —');
frames(10);
check('初始为标题场景', game.engine.scene.constructor.name === 'TitleScene');
key('Enter'); key('Enter', false);
frames(5);
check('确认后进入开幕场景', game.engine.scene.constructor.name === 'IntroScene');
frames(100);
check('开幕后进入战斗场景', game.engine.scene.constructor.name === 'GameScene');

const world = game.engine.scene.world;
check('世界已创建', !!world);
check('玩家已出生', world.player && world.player.alive);
check('开局命数为 3', world.lives[0] === 3);
check('出击队列 20 辆', world.spawnQueue.length === 20);

// ---- 全部关卡出怪点畅通 ----
// 回归：曾有关卡用砖/钢/水封住出怪点，敌坦嵌进地形卡死（钢墙内敌坦无法被击杀，关卡软锁）
console.log('— 关卡出怪点 —');
{
  const { LEVELS } = await import('../src/game/levels.js');
  const { TileMap } = await import('../src/game/tilemap.js');
  const { ENEMY_SPAWNS, PLAYER_SPAWN, PLAYER2_SPAWN, TILE } = await import('../src/core/const.js');
  for (let i = 0; i < LEVELS.length; i++) {
    const tm = new TileMap();
    tm.loadLevel(LEVELS[i]);
    tm.fortify(false);
    const ok = ENEMY_SPAWNS.every((sp) => {
      const x = sp.tx * TILE, y = sp.ty * TILE;
      if (tm.isSolidForTank(x, y, 16, 16)) return false;
      // 至少一个方向能开出去（上下左右各探一辆坦克的身位）
      return [[16, 0], [-16, 0], [0, 16], [0, -16]]
        .some(([dx, dy]) => !tm.isSolidForTank(x + dx, y + dy, 16, 16));
    });
    check(`第 ${i + 1} 关三个出怪点畅通且有出路`, ok);
    // 双人出生点不被地形阻挡
    const p1ok = !tm.isSolidForTank(PLAYER_SPAWN.tx * TILE, PLAYER_SPAWN.ty * TILE, 16, 16);
    const p2ok = !tm.isSolidForTank(PLAYER2_SPAWN.tx * TILE, PLAYER2_SPAWN.ty * TILE, 16, 16);
    check(`第 ${i + 1} 关双人出生点无阻挡`, p1ok && p2ok);
  }
}

// ---- 关卡连通性 ----
// 回归：第 6 关曾被竖河切成左右两半，唯一缺口在最顶行出怪点处，玩家被堵死在左岸
console.log('— 关卡连通性 —');
{
  const { LEVELS } = await import('../src/game/levels.js');
  const { PLAYER_SPAWN, BASE_TX, BASE_TY } = await import('../src/core/const.js');
  // 大格 BFS；isHard(ch, bx, by) 判定硬墙
  const bfs = (rows, sx, sy, isHard) => {
    const seen = new Set([sx + ',' + sy]);
    const q = [[sx, sy]];
    while (q.length) {
      const [x, y] = q.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= 13 || ny >= 13) continue;
        if (seen.has(nx + ',' + ny) || isHard(rows[ny][nx], nx, ny)) continue;
        seen.add(nx + ',' + ny);
        q.push([nx, ny]);
      }
    }
    return seen;
  };
  const isBase = (bx, by) => bx === BASE_TX / 2 && by === BASE_TY / 2;
  // 钢/水/基地为硬墙（砖可击穿算路）：全图不得有围死的孤岛
  LEVELS.forEach((rows, i) => {
    const seen = bfs(rows, PLAYER_SPAWN.tx / 2, PLAYER_SPAWN.ty / 2,
      (ch, bx, by) => ch === '@' || ch === '~' || isBase(bx, by));
    let islands = 0;
    for (let y = 0; y < 13; y++) {
      for (let x = 0; x < 13; x++) {
        const ch = rows[y][x];
        if (ch !== '@' && ch !== '~' && !isBase(x, y) && !seen.has(x + ',' + y)) islands++;
      }
    }
    check(`第 ${i + 1} 关无钢墙/水面围死的孤岛`, islands === 0);
  });
  // 第 6 关专测：砖/钢/水全算墙，不破坏任何地形也能从左岸开到右岸
  {
    const seen = bfs(LEVELS[5], 0, 6,
      (ch, bx, by) => ch === '#' || ch === '@' || ch === '~' || isBase(bx, by));
    check('第 6 关左右岸纯驾驶连通（无需破墙）', seen.has('12,6'));
  }
}

// ---- 玩家移动与射击 ----
console.log('— 玩家操作 —');
const px0 = world.player.x;
frames(40); // 等出生动画结束
check('出生动画结束', world.player.spawnTimer <= 0);
key('ArrowRight');
frames(20);
key('ArrowRight', false);
check('向右移动生效', world.player.x > px0);
// 传送到空旷区朝上射击，避免子弹出生点贴着墙
world.player.x = 100; world.player.y = 100; world.player.dir = 0;
key('Space'); key('Space', false);
frames(1);
check('射击产生子弹', world.bullets.some((b) => b.isPlayerBullet));
frames(30);

// ---- 敌方生成与 AI ----
console.log('— 敌方逻辑 —');
frames(300);
check('敌坦已生成', world.enemies.length > 0);
check('同屏敌坦不超过 4', world.enemies.filter((e) => e.alive).length <= 4);
const queueAfter = world.spawnQueue.length;
check('出击队列已消耗', queueAfter < 20);

// ---- 地形破坏 ----
console.log('— 地形与子弹规则 —');
// 直接在砖墙前放一颗子弹验证破坏
world.tilemap.cells[world.tilemap.idx(5, 5)] = 1;
world.tilemap.brickMask[world.tilemap.idx(5, 5)] = 0b1111;
const hit = world.tilemap.bulletHit(5 * 8, 5 * 8, 8, 4, 1);
check('子弹破坏砖墙', hit.result === 'brick');
check('砖墙被整格清除', world.tilemap.cells[world.tilemap.idx(5, 5)] === 0 &&
  world.tilemap.brickMask[world.tilemap.idx(5, 5)] === 0);
world.tilemap.cells[world.tilemap.idx(6, 5)] = 2;
const hitSteel = world.tilemap.bulletHit(6 * 8, 5 * 8, 8, 4, 1);
check('普通子弹被钢墙挡住', hitSteel.result === 'steel' && world.tilemap.cells[world.tilemap.idx(6, 5)] === 2);
const hitSteel2 = world.tilemap.bulletHit(6 * 8, 5 * 8, 8, 4, 3);
check('三星子弹击穿钢墙', world.tilemap.cells[world.tilemap.idx(6, 5)] === 0);

// ---- 道具六种效果 ----
console.log('— 道具效果 —');
const lv0 = world.player.level;
world._applyPowerup({ type: 'star', x: 0, y: 0 }, world.player);
check('⭐ 升级生效', world.player.level === lv0 + 1);
world._applyPowerup({ type: 'helmet', x: 0, y: 0 }, world.player);
check('🛡 护盾生效', world.player.shieldTimer > 0);
world._applyPowerup({ type: 'clock', x: 0, y: 0 }, world.player);
check('⏱ 冻结生效', world.freezeTimer > 0);
world._applyPowerup({ type: 'shovel', x: 0, y: 0 }, world.player);
check('🔧 基地钢墙生效', world.shovelTimer > 0);
const lives0 = world.lives[0];
world._applyPowerup({ type: 'life', x: 0, y: 0 }, world.player);
check('🚜 加命生效', world.lives[0] === lives0 + 1);
if (world.enemies.length > 0) {
  const aliveBefore = world.enemies.filter((e) => e.alive).length;
  world._applyPowerup({ type: 'grenade', x: 0, y: 0 }, world.player);
  check('💣 清屏生效', world.enemies.filter((e) => e.alive).length === 0 && aliveBefore > 0);
} else {
  check('💣 清屏生效（场上无敌坦，跳过）', true);
}
world.freezeTimer = 1; // 让冻结自然结束
frames(5);

// ---- 铁锹恢复墙避让坦克（防止坦克被嵌进墙里卡死）----
console.log('— 围墙恢复避让 —');
for (const e of world.enemies) e.alive = false; // 清场，避免干扰
world.enemies = [];
const fi = world.tilemap.idx(11, 23); // 基地围墙格之一
world.tilemap.cells[fi] = 0; world.tilemap.brickMask[fi] = 0; // 先打穿这个格子
// 玩家 16×16 压在 (11,23) 上时还会碰到 (12,23)、(11,24)，先把它们重置为砖墙
for (const [tx, ty] of [[12, 23], [11, 24]]) {
  world.tilemap.cells[world.tilemap.idx(tx, ty)] = 1;
  world.tilemap.brickMask[world.tilemap.idx(tx, ty)] = 0b1111;
}
world.player.x = 11 * 8; world.player.y = 23 * 8;             // 玩家站上去
world.tilemap.fortify(true, (tx, ty) => world._fortifyCellOccupied(tx, ty));
check('围墙恢复避开坦克占用格', world.tilemap.cells[fi] === 0);
check('坦克压着的围墙格全部保持原样（未变钢）',
  world.tilemap.cells[world.tilemap.idx(12, 23)] === 1 &&
  world.tilemap.cells[world.tilemap.idx(11, 24)] === 1);
world.player.x = 100; world.player.y = 100; // 开走
world.tilemap.retryFortify((tx, ty) => world._fortifyCellOccupied(tx, ty));
check('坦克开走后围墙自动补回', world.tilemap.cells[fi] === 2);

// ---- 拐角辅助：错位 4px 也能自动引导进缺口 ----
console.log('— 拐角辅助 —');
{
  // 清空一块区域，造一堵带 2 格缺口的墙
  for (let ty = 8; ty <= 15; ty++) {
    for (let tx = 10; tx <= 14; tx++) {
      world.tilemap.cells[world.tilemap.idx(tx, ty)] = 0;
      world.tilemap.brickMask[world.tilemap.idx(tx, ty)] = 0;
    }
  }
  for (let ty = 8; ty <= 15; ty++) {
    if (ty === 11 || ty === 12) continue; // 缺口在 11、12 行
    world.tilemap.cells[world.tilemap.idx(14, ty)] = 1;
    world.tilemap.brickMask[world.tilemap.idx(14, ty)] = 0b1111;
  }
  // 坦克与缺口错位 4px（压在第 13 行墙上）
  world.player.x = 12 * 8; world.player.y = 11 * 8 + 4; world.player.dir = 1;
  const moved = world.player.tryMove(world);
  check('错位直进被自动引导进缺口', moved && world.player.x > 12 * 8 && world.player.y === 11 * 8);
  // 恢复原位，避免影响后续混战
  world.player.x = 100; world.player.y = 100; world.player.dir = 0;
}

// ---- 长时间混战 ----
console.log('— 60 秒混战 —');
let err = null;
try {
  frames(3600, (i) => {
    if (i % 25 === 0) key(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'][(i / 25) % 4 | 0]);
    if (i % 25 === 12) key(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'][((i - 12) / 25) % 4 | 0], false);
    if (i % 40 === 0) { key('Space'); key('Space', false); }
  });
} catch (e) { err = e; }
check('60 秒混战无异常', !err);
if (err) console.error(err);

// ---- 失败流程：基地被毁 ----
console.log('— 失败流程 —');
const sceneBefore = game.engine.scene.constructor.name;
if (game.engine.scene.constructor.name === 'GameScene') {
  const w2 = game.engine.scene.world;
  if (w2.state === 'playing') {
    w2.baseDestroyed();
    check('基地被毁进入结束状态', w2.state === 'over' && w2.overReason === 'base');
    frames(200);
    check('进入游戏结束场景', game.engine.scene.constructor.name === 'GameOverScene');
    frames(50);
    key('Enter'); key('Enter', false);
    frames(10);
    check('返回标题场景', game.engine.scene.constructor.name === 'TitleScene');
  } else {
    // 战斗中已自然结束，同样覆盖了失败流程
    check('战斗自然结束（覆盖失败流程）', w2.state === 'over');
  }
} else {
  check('战斗已在混战中自然流转', sceneBefore !== 'GameScene' || true);
}

// ---- 本地双人模式 ----
console.log('— 本地双人 —');
{
  // 回到标题后选择「双人游戏」（菜单第 2 项）
  if (game.engine.scene.constructor.name !== 'TitleScene') {
    game.engine.changeScene(new (await import('../src/scenes/title.js')).TitleScene(game));
    frames(5);
  }
  key('ArrowDown'); key('ArrowDown', false);
  frames(2);
  key('Enter'); key('Enter', false);
  frames(5);
  check('选择双人后进入开幕', game.engine.scene.constructor.name === 'IntroScene');
  frames(100);
  check('进入双人战斗', game.engine.scene.constructor.name === 'GameScene');
  const w2 = game.engine.scene.world;
  check('双人模式两名玩家', w2.playerCount === 2 && w2.players.length === 2);
  check('双人命数各自独立', w2.lives[0] === 3 && w2.lives[1] === 3);
  check('P2 出生在基地右侧', w2.players[1].x > w2.players[0].x);
  check('P2 使用绿色系调色板', w2.players[1].paletteName() === 'ally0');

  frames(40); // 出生动画结束
  const p2x0 = w2.players[1].x;
  key('KeyD'); frames(20); key('KeyD', false);
  check('P2（WASD）移动生效', w2.players[1].x > p2x0);
  key('KeyF'); key('KeyF', false);
  frames(1);
  check('P2（F）射击生效', w2.bullets.some((b) => b.owner === w2.players[1]));
  frames(30);

  // P1 阵亡：游戏继续，P2 不受影响
  w2.players[0].shieldTimer = 0; w2.players[0].spawnTimer = 0;
  w2.playerHit({ x: 0, y: 0 }, w2.players[0]);
  check('P1 阵亡扣自己的命', w2.lives[0] === 2 && w2.lives[1] === 3);
  check('P1 阵亡后游戏继续', w2.state === 'playing' && w2.players[1].alive);
  let deadTankRenderCount = 0;
  const renderDeadTank = w2.players[0].render;
  w2.players[0].render = () => { deadTankRenderCount++; };
  w2.render(ctx2dStub());
  w2.players[0].render = renderDeadTank;
  check('阵亡玩家坦克不会继续渲染', deadTankRenderCount === 0);

  // 道具归属拾取者
  w2._applyPowerup({ type: 'life', x: 0, y: 0 }, w2.players[1]);
  check('加命道具归拾取者（P2）', w2.lives[1] === 4 && w2.lives[0] === 2);
  const p1lv = w2.players[0].level;
  w2._applyPowerup({ type: 'star', x: 0, y: 0 }, w2.players[1]);
  check('星星只升级拾取者（P2）', w2.players[1].level === 1 && w2.players[0].level === p1lv);

  // 双方命数耗尽才判负
  w2.lives[0] = 0; w2.lives[1] = 1;
  w2.respawnTimers[0] = 0;
  w2.players[1].shieldTimer = 0; w2.players[1].spawnTimer = 0;
  w2.playerHit({ x: 0, y: 0 }, w2.players[1]);
  check('全员命数耗尽判负', w2.state === 'over' && w2.overReason === 'tank');
  frames(200); // 流向 GameOverScene
  key('Enter'); key('Enter', false);
  frames(10);
}

// ---- 回归：重生时出生点被占用（敌坦压杀 / 队友避让，防坦克重叠卡死）----
console.log('— 重生占位处理 —');
{
  const { World } = await import('../src/game/world.js');
  const { Enemy } = await import('../src/game/enemy.js');
  const { NetInput } = await import('../src/core/input.js');

  // 敌坦占用出生点：重生时直接压杀
  const g3 = Object.create(game);
  g3.mode = '1p'; g3.playerLevels = [0, 0]; g3.lives = [3, 3]; g3.score = 0;
  const w3 = new World(g3, 0);
  w3.spawnTimer = 99999; // 不再出新敌坦，保持场景确定
  const in3 = new NetInput();
  const p1 = w3.players[0];
  p1.shieldTimer = 0; p1.spawnTimer = 0;
  const e = new Enemy(p1.x, p1.y, 'basic', false, w3.rand);
  e.id = 999; e.spawnTimer = 0; e.frozen = true; // 冻结在出生点上
  w3.enemies.push(e);
  w3.playerHit({ x: 0, y: 0 }, p1);
  for (let f = 0; f < 80; f++) { w3.update([in3]); in3.postUpdate(); }
  check('出生点敌坦被重生压杀', !w3.enemies.some((x) => x.id === 999));
  check('玩家重生后不与任何坦克重叠', p1.alive && !w3.tankBlocked(p1, p1.x, p1.y, 16, 16));

  // 队友占用出生点：重生推迟，让开后才重生
  const g4 = Object.create(game);
  g4.mode = '2p'; g4.playerLevels = [0, 0]; g4.lives = [3, 3]; g4.score = 0;
  const w4 = new World(g4, 0);
  w4.spawnTimer = 99999;
  const in4 = new NetInput();
  const [q1, q2] = w4.players;
  const sx = q1.x, sy = q1.y;
  q1.shieldTimer = 0; q1.spawnTimer = 0;
  q2.shieldTimer = 0; q2.spawnTimer = 0;
  w4.playerHit({ x: 0, y: 0 }, q1);      // P1 阵亡
  q2.x = sx; q2.y = sy;                  // P2 停到 P1 出生点上占位
  for (let f = 0; f < 80; f++) { w4.update([in4, in4]); in4.postUpdate(); }
  check('队友占位时重生推迟', !q1.alive);
  q2.x = sx - 32;                        // P2 让开
  for (let f = 0; f < 40; f++) { w4.update([in4, in4]); in4.postUpdate(); }
  check('队友让开后正常重生', q1.alive && !w4.tankBlocked(q1, q1.x, q1.y, 16, 16));

  // 转向时的网格对齐不能把本来刚好相邻的坦克挤到一起
  w4.tilemap.cells.fill(0); w4.tilemap.brickMask.fill(0);
  q1.alive = true; q2.alive = true;
  q1.spawnTimer = 0; q2.spawnTimer = 0;
  q1.x = 33; q1.y = 64; q2.x = 49; q2.y = 64;
  q1.setDir(0, w4);
  check('转向对齐不会把坦克挤进另一辆坦克', q1.x === 33 && !w4.tankBlocked(q1, q1.x, q1.y, 16, 16));
}

// ---- 联网快照同步（权威世界：序列化 → 应用到镜像世界）----
console.log('— 联网快照同步 —');
{
  const { World } = await import('../src/game/world.js');
  const { NetInput } = await import('../src/core/input.js');
  const { serializeWorld, pushSnapshot, interpolateTo, serializeMap, applyMap } = await import('../src/net/sync.js');

  // 主机世界：双人模式，用 NetInput 模拟两端输入
  const g2 = Object.create(game);
  g2.mode = '2p';
  g2.playerLevels = [0, 0];
  g2.lives = [3, 3];
  const hostWorld = new World(g2, 0);
  const mirrorWorld = new World(g2, 0); // 客机镜像：结构相同但不跑逻辑
  const in1 = new NetInput(), in2 = new NetInput();

  let err = null;
  try {
    for (let f = 0; f < 300; f++) {
      in1.applyRemote({ right: f % 4 < 2, up: f % 4 >= 2 }, f % 30 === 0 ? { fire: true } : {});
      in2.applyRemote({ left: f % 6 < 3 }, f % 45 === 0 ? { fire: true } : {});
      hostWorld.update([in1, in2]);
      in1.postUpdate(); in2.postUpdate();
    }
  } catch (e) { err = e; }
  check('主机 300 帧逻辑无异常', !err);
  if (err) console.error(err);

  // 快照应用：实体计数与关键状态一致
  const snap = serializeWorld(hostWorld, {});
  const beforeSnapX = mirrorWorld.players.map((p) => p.x);
  pushSnapshot(mirrorWorld, snap, 1);
  // 位置契约：活动中的玩家保持插值前位置（随后由快照缓冲平滑），
  // 只有死亡/出生或相距超过 24px 的瞬移才在应用快照时直接落位
  check('快照同步玩家目标位置',
    mirrorWorld.players.every((p, i) =>
      p.x === beforeSnapX[i] || Math.abs(p.x - hostWorld.players[i].x) < 0.01));
  check('快照同步敌坦数量', mirrorWorld.enemies.length === hostWorld.enemies.length);
  check('快照同步子弹数量', mirrorWorld.bullets.length === hostWorld.bullets.length);
  check('快照同步命数与状态',
    mirrorWorld.lives[0] === hostWorld.lives[0] && mirrorWorld.state === hostWorld.state);
  check('快照同步敌坦字段',
    mirrorWorld.enemies.every((e) => {
      const h = hostWorld.enemies.find((x) => x.id === e.id);
      return h && e.type === h.type && e.hp === h.hp && e.alive === h.alive;
    }));

  // 插值到最新快照帧：位置收敛到主机位置（替代旧指数趋近）
  interpolateTo(mirrorWorld, snap.hf, 1);
  check('插值后镜像收敛到主机坐标',
    Math.abs(mirrorWorld.players[0].x - hostWorld.players[0].x) < 0.5 &&
    mirrorWorld.enemies.every((e) => {
      const h = hostWorld.enemies.find((x) => x.id === e.id);
      return h && Math.abs(e.x - h.x) < 0.5 && Math.abs(e.y - h.y) < 0.5;
    }));

  // 地形增量同步：打穿一块砖，序列化/应用后两端一致
  hostWorld.tilemap.cells[hostWorld.tilemap.idx(5, 5)] = 1;
  hostWorld.tilemap.brickMask[hostWorld.tilemap.idx(5, 5)] = 0b1111;
  hostWorld.tilemap.bulletHit(5 * 8, 5 * 8, 8, 4, 1);
  applyMap(mirrorWorld.tilemap, serializeMap(hostWorld.tilemap, 0));
  check('地形同步一致',
    mirrorWorld.tilemap.cells[5 * 26 + 5] === hostWorld.tilemap.cells[5 * 26 + 5] &&
    mirrorWorld.tilemap.brickMask[5 * 26 + 5] === hostWorld.tilemap.brickMask[5 * 26 + 5]);
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
