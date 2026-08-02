// 联机协议 v3 测试：服务端权威、延迟抖动、开火确认、恢复连接和真实服务器
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { NetInput } from '../src/core/input.js';
import { World } from '../src/game/world.js';
import { NetGameController, NetGameSession } from '../src/net/session.js';
import { pushSnapshot, serializeWorld } from '../src/net/sync.js';
import { GameRegistry, PROTOCOL_VERSION, RealtimeGameService } from '../server/runtime/realtime-service.js';
import { tankGameDefinition } from '../server/games/tank-match.js';

const noop = () => {};
let pass = 0;
let fail = 0;

function check(name, condition) {
  if (condition) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name); }
}

function makeSocket(onSend = null) {
  return {
    readyState: 1,
    messages: [],
    send(raw) {
      const message = JSON.parse(raw);
      this.messages.push(message);
      if (onSend) onSend(message);
    },
    terminate() { this.readyState = 3; },
  };
}

function lastMessage(socket, type) {
  return [...socket.messages].reverse().find((message) => message.t === type);
}

function makeGame() {
  const audio = {};
  for (const name of [
    'shoot', 'hitWall', 'hitSteel', 'hitTank', 'explodeSmall', 'explodeBig',
    'powerupSpawn', 'powerupPick', 'grenade', 'oneUp', 'shovel', 'freeze',
    'respawn', 'victory', 'gameOver', 'stageStart', 'pause',
  ]) audio[name] = noop;
  return {
    mode: 'net',
    engine: { frame: 0, addHitstop: noop, changeScene: noop },
    audio,
    input: new NetInput(),
    inputs: [new NetInput(), new NetInput()],
    assets: {},
    score: 0,
    hiScore: 0,
    lives: [3, 3],
    playerLevels: [0, 0],
    addScore(points) { this.score += points; },
    resetRun() { this.score = 0; this.lives = [3, 3]; this.playerLevels = [0, 0]; },
  };
}

console.log('— 通用实时对局运行时 —');
{
  let clock = 1_000;
  const registry = new GameRegistry().register(tankGameDefinition);
  registry.register({
    id: 'test-game',
    validateInput: () => true,
    createMatch: () => ({ marker: '独立适配器' }),
  });
  check('游戏注册表可以挂接其他游戏适配器', registry.get('test-game').createMatch().marker === '独立适配器');

  const service = new RealtimeGameService(registry, { now: () => clock, reconnectMs: 30_000 });
  const host = makeSocket();
  const guest = makeSocket();
  service.attach(host);
  service.attach(guest);
  service.handleMessage(host, { t: 'create', protocol: PROTOCOL_VERSION, game: 'tank' });
  const created = lastMessage(host, 'created');
  service.handleMessage(guest, { t: 'join', protocol: PROTOCOL_VERSION, code: created.code });
  const joined = lastMessage(guest, 'joined');
  check('创建与加入得到不同席位和恢复令牌',
    created.slot === 0 && joined.slot === 1 && created.token && joined.token && created.token !== joined.token);

  service.handleMessage(host, { t: 'command', epoch: created.epoch, command: 'ready', phaseId: 1 });
  service.handleMessage(guest, { t: 'command', epoch: joined.epoch, command: 'ready', phaseId: 1 });
  service.tick();
  const room = service.rooms.get(created.code);
  const match = room.match;
  check('双方准备后由服务器创建权威世界', match.phase === 'playing' && match.world instanceof World);

  match.world.players.forEach((player) => { player.spawnTimer = 0; });
  match.world.enemies = [];
  match.world.spawnQueue = [{ type: 'basic', hasPowerup: false }];
  match.world.spawnTimer = 99_999;
  const startX = match.world.players[1].x;
  service.handleMessage(guest, {
    t: 'input', epoch: joined.epoch, frames: [
      { seq: 1, held: { right: true }, fireSeq: 1, viewFrame: match.frame },
      { seq: 2, held: { right: true }, viewFrame: match.frame },
      { seq: 3, held: { right: true }, viewFrame: match.frame },
    ],
  });
  for (let i = 0; i < 4; i++) service.tick();
  const snap = lastMessage(guest, 'snap');
  const fireResults = guest.messages.filter((message) => message.t === 'fire-result' && message.fireSeq === 1);
  const hostHeardShot = host.messages.some((message) =>
    message.t === 'snap' && message.ev?.some((event) => event.name === 'shoot' && event.fireSeq === 1));
  const guestHeardShot = guest.messages.some((message) =>
    message.t === 'snap' && message.ev?.some((event) => event.name === 'shoot' && event.fireSeq === 1));
  check('输入按序逐条执行而不是只保留最后一条', match.world.players[1].x > startX + 3);
  check('快照只确认已经实际执行的输入序号', snap.ack === 3);
  check('每次开火都有且只有一个明确结果', fireResults.length === 1 && fireResults[0].accepted === true);
  check('同一次开火音效会发送给房间内双方', hostHeardShot && guestHeardShot);

  const beforeDisconnect = match.frame;
  service.handleClose(guest);
  for (let i = 0; i < 10; i++) service.tick();
  check('一方断线时权威对局继续推进', match.frame === beforeDisconnect + 10);

  clock += 1_000;
  const resumedSocket = makeSocket();
  service.attach(resumedSocket);
  service.handleMessage(resumedSocket, {
    t: 'resume', protocol: PROTOCOL_VERSION, code: created.code, token: joined.token,
  });
  const resumed = lastMessage(resumedSocket, 'resumed');
  const fullSnapshot = lastMessage(resumedSocket, 'snap');
  check('30 秒内可凭令牌恢复原席位', resumed?.slot === 1 && resumed.epoch === joined.epoch + 1);
  check('恢复后立即收到全量权威快照', fullSnapshot?.full === true && !!fullSnapshot.map);

  match.world.bullets = [];
  service.handleMessage(resumedSocket, {
    t: 'input', epoch: resumed.epoch, frames: [
      { seq: 1, held: {}, fireSeq: 1, viewFrame: match.frame },
    ],
  });
  service.tick();
  const resumedFire = resumedSocket.messages.find((message) =>
    message.t === 'fire-result' && message.epoch === resumed.epoch && message.fireSeq === 1);
  check('刷新恢复后开火序号从 1 重新开始也能正常发射', resumedFire?.accepted === true);

  service.handleClose(resumedSocket);
  clock += 30_001;
  service.tick();
  check('超时玩家被移除，另一名玩家仍可继续',
    service.rooms.has(created.code) && match.world.lives[1] === 0 && match.world.players[0].alive);
}

console.log('— 联机全灭后同房间重开 —');
{
  const registry = new GameRegistry().register(tankGameDefinition);
  const service = new RealtimeGameService(registry);
  const host = makeSocket();
  const guest = makeSocket();
  service.attach(host);
  service.attach(guest);
  service.handleMessage(host, { t: 'create', protocol: PROTOCOL_VERSION, game: 'tank' });
  const created = lastMessage(host, 'created');
  service.handleMessage(guest, { t: 'join', protocol: PROTOCOL_VERSION, code: created.code });
  const joined = lastMessage(guest, 'joined');
  service.handleMessage(host, { t: 'command', epoch: created.epoch, command: 'ready', phaseId: 1 });
  service.handleMessage(guest, { t: 'command', epoch: joined.epoch, command: 'ready', phaseId: 1 });
  service.tick();

  // 第 1 关产生过输入历史：服务端席位序号随之单调递增，
  // 重开后客户端新会话必须延续序号而不是归零
  service.handleMessage(guest, {
    t: 'input', epoch: joined.epoch,
    frames: [{ seq: 1, held: { right: true }, viewFrame: 1 }, { seq: 2, held: { right: true }, viewFrame: 1 }],
  });
  service.tick();

  const match = service.rooms.get(created.code).match;
  const finishedWorld = match.world;
  finishedWorld.lives = [1, 1];
  for (const player of finishedWorld.players) {
    player.spawnTimer = 0;
    player.shieldTimer = 0;
    finishedWorld.playerHit({ x: 0, y: 0 }, player);
  }
  match.hitstop = 0;
  finishedWorld.stateTimer = 0;
  service.tick();
  check('双方全灭后服务端保留原房间并进入结束画面',
    match.phase === 'over' && service.rooms.has(created.code));

  const overPhaseId = match.phaseId;
  service.handleMessage(host, { t: 'command', epoch: created.epoch, command: 'ready', phaseId: overPhaseId });
  service.tick();
  const readyStatus = lastMessage(host, 'ready-status');
  check('准备状态必须由服务端确认，不能只以客户端发送成功为准',
    readyStatus?.phaseId === overPhaseId && readyStatus.slots.length === 1 && readyStatus.slots[0] === 0);
  service.handleMessage(guest, { t: 'command', epoch: joined.epoch, command: 'ready', phaseId: overPhaseId });
  service.tick();
  check('双方确认一次即可直接重新进入战斗',
    match.phase === 'playing' && match.stageIndex === 0 && match.lives[0] === 3 &&
    match.lives[1] === 3 && match.world !== finishedWorld);

  // 重开后客户端新会话延续序号（seq 3 起），输入应立即生效
  match.world.players.forEach((player) => { player.spawnTimer = 0; player.shieldTimer = 0; });
  const restartX = match.world.players[1].x;
  for (let i = 0; i < 4; i++) {
    service.handleMessage(guest, {
      t: 'input', epoch: joined.epoch,
      frames: [{ seq: 3 + i, held: { right: true }, viewFrame: match.frame }],
    });
    service.tick();
  }
  check('全灭重开后新会话的输入立即生效', match.world.players[1].x > restartX + 2);
}

console.log('— 跨关后的输入与开火延续 —');
{
  // 客户端：战斗会话跨关延续输入/开火序号（服务端席位序号整场单调，归零会被全部丢弃）
  const clientGame = makeGame();
  const fakeClient = { on: () => () => {}, command: () => true };
  const controller = new NetGameController(clientGame, fakeClient, { code: '0000', slot: 0, token: 't', epoch: 1 });
  const mkScene = () => ({ world: new World(clientGame, 0), stageIndex: 0, paused: false });
  const s1 = new NetGameSession(clientGame, mkScene(), controller);
  controller.currentSession = s1; // 正常流程由 createGameSession 挂到 controller
  s1.seq = 41; s1.fireSeq = 7;
  controller._onPhase({ phaseId: 2, phase: 'playing', stageIndex: 1 });
  const s2 = new NetGameSession(clientGame, mkScene(), controller);
  controller.currentSession = s2;
  check('战斗会话跨关延续输入与开火序号', s2.seq === 41 && s2.fireSeq === 7);
  s2.onResumed();
  controller._onPhase({ phaseId: 3, phase: 'playing', stageIndex: 1 });
  const s3 = new NetGameSession(clientGame, mkScene(), controller);
  check('断线恢复后序号重新归零与服务端对齐', s3.seq === 0 && s3.fireSeq === 0);
  s3.destroy();

  // 服务端：跨关清空滞留队列，第 2 关输入与开火照常执行
  const registry = new GameRegistry().register(tankGameDefinition);
  const service = new RealtimeGameService(registry);
  const host = makeSocket();
  const guest = makeSocket();
  service.attach(host);
  service.attach(guest);
  service.handleMessage(host, { t: 'create', protocol: PROTOCOL_VERSION, game: 'tank' });
  const created = lastMessage(host, 'created');
  service.handleMessage(guest, { t: 'join', protocol: PROTOCOL_VERSION, code: created.code });
  const joined = lastMessage(guest, 'joined');
  const readyBoth = () => {
    const phaseId = service.rooms.get(created.code).match.phaseId;
    service.handleMessage(host, { t: 'command', epoch: created.epoch, command: 'ready', phaseId });
    service.handleMessage(guest, { t: 'command', epoch: joined.epoch, command: 'ready', phaseId });
    service.tick();
  };
  readyBoth(); // 开幕 -> 第 1 关

  const match = service.rooms.get(created.code).match;
  const seat = () => service.rooms.get(created.code).seats[1];
  match.world.players.forEach((player) => { player.spawnTimer = 0; player.shieldTimer = 0; });
  match.world.enemies = [];
  match.world.spawnTimer = 99_999;

  // 第 1 关：连发输入并开火一次，制造 ack/lastQueuedSeq/lastFireSeq 历史与滞留队列
  let seq = 0, fireSeq = 0;
  for (let i = 0; i < 30; i++) {
    service.handleMessage(guest, {
      t: 'input', epoch: joined.epoch, frames: [
        { seq: ++seq, held: { right: true }, fireSeq: i === 0 ? ++fireSeq : null, viewFrame: match.frame },
        { seq: ++seq, held: { right: true }, viewFrame: match.frame },
      ],
    });
    service.tick();
  }
  check('第 1 关输入按限速执行并积压部分队列', seat().ack > 0 && seat().queue.length > 0);

  // 强制通关：结算 -> 开幕 -> 第 2 关
  match.world.spawnQueue = [];
  match.world.state = 'clear';
  match.world.stateTimer = 0;
  service.tick();
  const sawTally = match.phase === 'tally';
  readyBoth();
  const sawIntro = match.phase === 'intro' && match.stageIndex === 1;
  readyBoth();
  check('通关后依次进入结算、开幕和第 2 关',
    sawTally && sawIntro && match.phase === 'playing' && match.stageIndex === 1);
  check('阶段间隙滞留的旧输入被清空', seat().queue.length === 0);

  // 第 2 关开头不发输入：坦克不应因上一关的旧输入自行漂移
  match.world.players.forEach((player) => { player.spawnTimer = 0; player.shieldTimer = 0; });
  match.world.enemies = [];
  match.world.spawnTimer = 99_999;
  const parkedX = match.world.players[1].x;
  for (let i = 0; i < 10; i++) service.tick();
  check('第 2 关开头坦克不再自行漂移', Math.abs(match.world.players[1].x - parkedX) < 0.01);

  // 客户端新会话延续序号继续发输入：移动与开火都正常（清空地形避免关卡布局干扰）
  guest.messages.length = 0;
  const me = match.world.players[1];
  me.x = 32; me.y = 100; me.dir = 1;
  match.world.tilemap.cells.fill(0);
  match.world.tilemap.brickMask.fill(0);
  const stage2X = me.x;
  for (let i = 0; i < 6; i++) {
    service.handleMessage(guest, {
      t: 'input', epoch: joined.epoch, frames: [
        { seq: ++seq, held: { right: true }, fireSeq: i === 0 ? ++fireSeq : null, viewFrame: match.frame },
        { seq: ++seq, held: { right: true }, viewFrame: match.frame },
      ],
    });
    service.tick();
  }
  const stage2Fire = guest.messages.filter((m) => m.t === 'fire-result' && m.fireSeq === fireSeq);
  check('第 2 关输入继续按序执行', me.x > stage2X + 3);
  check('第 2 关开火继续被接受', stage2Fire.length === 1 && stage2Fire[0].accepted === true);
}

console.log('— 玩家坦克子弹与快照平滑 —');
{
  const authority = new World(makeGame(), 0);
  const mirror = new World(makeGame(), 0);
  authority.players.forEach((player) => { player.alive = true; player.spawnTimer = 0; });
  mirror.players.forEach((player) => { player.alive = true; player.spawnTimer = 0; });
  authority.players[1].x = 128;
  authority.players[1].y = 64;
  mirror.players[1].x = 16;
  mirror.players[1].y = 64;
  pushSnapshot(mirror, serializeWorld(authority, { hf: 10 }), 0);
  check('活动中的远端坦克不因一份相隔很远的快照突然跳位', mirror.players[1].x === 16);

  const world = new World(makeGame(), 0);
  const [shooter, teammate] = world.players;
  world.tilemap.bulletHit = () => ({ result: null });
  shooter.x = 32; shooter.y = 64; shooter.dir = 1;
  teammate.x = 52; teammate.y = 64;
  shooter.spawnTimer = 0; shooter.shieldTimer = 0;
  teammate.spawnTimer = 0; teammate.shieldTimer = 0;
  world.lives = [3, 1];
  world.spawnBullet(shooter);
  world.bullets[0].update(world);
  check('玩家子弹命中另一名玩家坦克后会消失并造成命中', !teammate.alive && world.bullets[0]?.alive === false);
}

console.log('— 250ms 往返延迟与 60ms 抖动 —');
{
  const registry = new GameRegistry().register(tankGameDefinition);
  const service = new RealtimeGameService(registry);
  const host = makeSocket();
  const guest = makeSocket();
  service.attach(host);
  service.attach(guest);
  service.handleMessage(host, { t: 'create', protocol: PROTOCOL_VERSION, game: 'tank' });
  const created = lastMessage(host, 'created');
  service.handleMessage(guest, { t: 'join', protocol: PROTOCOL_VERSION, code: created.code });
  const joined = lastMessage(guest, 'joined');
  service.handleMessage(host, { t: 'command', epoch: created.epoch, command: 'ready', phaseId: 1 });
  service.handleMessage(guest, { t: 'command', epoch: joined.epoch, command: 'ready', phaseId: 1 });
  service.tick();

  const match = service.rooms.get(created.code).match;
  match.world.players.forEach((player) => { player.spawnTimer = 0; });
  match.world.enemies = [];
  match.world.spawnQueue = [{ type: 'basic', hasPowerup: false }];
  match.world.spawnTimer = 99_999;

  let simulationFrame = 0;
  let upstreamDelivery = 0;
  let downstreamDelivery = 0;
  const upstream = [];
  const downstream = [];
  const delays = [6, 9, 7, 8]; // 单向平均 7.5 帧，往返约 250ms；波动范围约 50ms
  const handlers = new Map();
  let acceptedFireResults = 0;
  const browserClient = {
    on(type, handler) {
      let set = handlers.get(type);
      if (!set) { set = new Set(); handlers.set(type, set); }
      set.add(handler);
      return () => set.delete(handler);
    },
    emit(type, message) {
      if (type === 'fire-result' && message.accepted) acceptedFireResults++;
      for (const handler of handlers.get(type) || []) handler(message);
    },
    sendInputs(epoch, frames) {
      const at = Math.max(simulationFrame + delays[simulationFrame % delays.length], upstreamDelivery + 1);
      upstreamDelivery = at;
      upstream.push({ at, message: { t: 'input', epoch, frames } });
    },
  };
  guest.messages.length = 0;
  guest.send = (raw) => {
    const message = JSON.parse(raw);
    const at = Math.max(simulationFrame + delays[(simulationFrame + 1) % delays.length], downstreamDelivery + 1);
    downstreamDelivery = at;
    downstream.push({ at, message });
  };

  const clientGame = makeGame();
  const scene = { world: new World(clientGame, 0), stageIndex: 0, paused: false };
  scene.world.externalPlayerControl = true;
  const controller = { client: browserClient, slot: 1, epoch: joined.epoch, status: 'connected' };
  const session = new NetGameSession(clientGame, scene, controller);
  const initial = { ...match.snapshot(1, true), ack: 0, epoch: joined.epoch, full: true };
  match.afterSnapshot();
  browserClient.emit('snap', initial);

  const beforeDuplicateAck = scene.world.players[1].x;
  scene.world.players[1].x += 32;
  browserClient.emit('snap', { ...initial, sf: initial.sf + 2, hf: initial.hf + 2 });
  check('确认号未变化的重复快照不会把本地坦克强行拉回旧位置',
    scene.world.players[1].x === beforeDuplicateAck + 32);
  scene.world.players[1].x = beforeDuplicateAck;

  let previousX = scene.world.players[1].x;
  let maxBacktrack = 0;
  let immediateFire = false;
  for (simulationFrame = 1; simulationFrame <= 180; simulationFrame++) {
    clientGame.engine.frame++;
    const moving = simulationFrame <= 28;
    clientGame.input.applyRemote(moving ? { right: true } : {}, simulationFrame === 5 ? { fire: true } : {});
    session.update();
    if (simulationFrame === 5) immediateFire = scene.world.bullets.some((bullet) => bullet.id < 0);
    clientGame.input.postUpdate();

    for (let i = upstream.length - 1; i >= 0; i--) {
      if (upstream[i].at <= simulationFrame) {
        service.handleMessage(guest, upstream[i].message);
        upstream.splice(i, 1);
      }
    }
    service.tick();
    for (let i = downstream.length - 1; i >= 0; i--) {
      if (downstream[i].at <= simulationFrame) {
        const { message } = downstream[i];
        browserClient.emit(message.t, message);
        downstream.splice(i, 1);
      }
    }

    const x = scene.world.players[1].x;
    if (moving) maxBacktrack = Math.max(maxBacktrack, previousX - x);
    previousX = x;
  }

  check('高延迟下按键后本地坦克立即前进且不会前后反复', maxBacktrack < 0.01);
  check('按下开火的同一帧立即出现预测子弹', immediateFire);
  check('服务端对这次开火只返回一次成功确认', acceptedFireResults === 1);
  check('输入全部确认后预测位置与权威位置一致',
    Math.abs(scene.world.players[1].x - match.world.players[1].x) < 0.01);
  check('远端插值缓冲按抖动在 4 到 10 帧内调整', session.interpDelay >= 4 && session.interpDelay <= 10);

  const predictedBullet = {
    id: -99,
    alive: true,
    localPredicted: true,
    ownerId: scene.world.players[1].id,
    clientFireSeq: 99,
    clientFireEpoch: joined.epoch,
  };
  scene.world.bullets.push(predictedBullet);
  session.predictedFires.set(99, predictedBullet);
  browserClient.emit('fire-result', {
    t: 'fire-result', epoch: joined.epoch, fireSeq: 99, accepted: true, bulletId: 9999,
  });
  check('服务端允许开火后预测子弹立即绑定权威编号', predictedBullet.id === 9999);

  const endedSnapshot = {
    ...match.snapshot(1, false),
    sf: session.lastAppliedServerFrame + 2,
    hf: session.lastAppliedServerFrame + 2,
    bu: [],
    ack: session.seq,
    epoch: joined.epoch,
  };
  browserClient.emit('snap', endedSnapshot);
  check('权威子弹已命中消失时本地预测子弹不会继续穿行', !scene.world.bullets.includes(predictedBullet));
  session.destroy();
}

console.log('— 真实 Node 服务器协议 —');
{
  const port = 18_000 + Math.floor(Math.random() * 2_000);
  const serverPath = fileURLToPath(new URL('../server/server.js', import.meta.url));
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  class Inbox {
    constructor(ws) {
      this.ws = ws;
      this.messages = [];
      this.waiters = [];
      ws.on('message', (raw) => {
        const message = JSON.parse(raw.toString());
        const index = this.waiters.findIndex((waiter) => waiter.predicate(message));
        if (index >= 0) {
          const [waiter] = this.waiters.splice(index, 1);
          clearTimeout(waiter.timer);
          waiter.resolve(message);
        } else this.messages.push(message);
      });
    }

    next(predicate, timeout = 3_000) {
      const index = this.messages.findIndex(predicate);
      if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, timer: null };
        waiter.timer = setTimeout(() => {
          const at = this.waiters.indexOf(waiter);
          if (at >= 0) this.waiters.splice(at, 1);
          reject(new Error('等待服务器消息超时'));
        }, timeout);
        this.waiters.push(waiter);
      });
    }
  }

  const open = () => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.once('open', () => resolve(new Inbox(ws)));
    ws.once('error', reject);
  });

  let error = null;
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on('data', (data) => { if (String(data).includes('已启动')) resolve(); });
      child.once('exit', () => reject(new Error('服务器提前退出')));
      setTimeout(() => reject(new Error('服务器启动超时')), 5_000);
    });

    const host = await open();
    host.ws.send(JSON.stringify({ t: 'create', protocol: PROTOCOL_VERSION, game: 'tank' }));
    const created = await host.next((message) => message.t === 'created');
    check('真实服务器返回 4 位房间码和 P1 席位', /^\d{4}$/.test(created.code) && created.slot === 0);

    const guest = await open();
    guest.ws.send(JSON.stringify({ t: 'join', protocol: PROTOCOL_VERSION, code: created.code }));
    const joined = await guest.next((message) => message.t === 'joined');
    await host.next((message) => message.t === 'peer-joined');
    check('真实服务器把加入者分配到 P2 席位', joined.slot === 1 && !!joined.token);

    host.ws.send(JSON.stringify({ t: 'command', epoch: created.epoch, command: 'ready', phaseId: 1 }));
    guest.ws.send(JSON.stringify({ t: 'command', epoch: joined.epoch, command: 'ready', phaseId: 1 }));
    await guest.next((message) => message.t === 'phase' && message.phase === 'playing');
    guest.ws.send(JSON.stringify({
      t: 'input', epoch: joined.epoch,
      frames: [
        { seq: 1, held: { right: true }, viewFrame: 1 },
        { seq: 2, held: {}, fireSeq: 1, viewFrame: 1 },
      ],
    }));
    const fire = await guest.next((message) => message.t === 'fire-result' && message.fireSeq === 1);
    const snap = await guest.next((message) => message.t === 'snap' && message.ack === 2);
    check('真实服务器逐条确认输入并明确回应开火', snap.ack === 2 && typeof fire.accepted === 'boolean');

    guest.ws.close();
    const resumedClient = await open();
    resumedClient.ws.send(JSON.stringify({
      t: 'resume', protocol: PROTOCOL_VERSION, code: created.code, token: joined.token,
    }));
    const resumed = await resumedClient.next((message) => message.t === 'resumed');
    const full = await resumedClient.next((message) => message.t === 'snap' && message.full);
    check('真实服务器支持刷新页面后的席位恢复', resumed.slot === 1 && resumed.epoch === 2 && !!full.map);

    const invalid = await open();
    invalid.ws.send(JSON.stringify({ t: 'join', protocol: 1, code: created.code }));
    check('旧协议不会被静默兼容', (await invalid.next((message) => message.t === 'error')).t === 'error');

    const oversized = await open();
    const closed = new Promise((resolve) => oversized.ws.once('close', (code) => resolve(code)));
    oversized.ws.send(JSON.stringify({ t: 'input', frames: [{ data: 'x'.repeat(70 * 1024) }] }));
    check('超过 64KB 的消息仍会被断开', (await closed) === 1009);

    host.ws.close();
    resumedClient.ws.close();
    invalid.ws.close();
  } catch (caught) {
    error = caught;
  } finally {
    child.kill();
  }
  check('真实服务器集成测试无异常', !error);
  if (error) console.error(error);
}

console.log(`\n联机 v3 结果：${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
