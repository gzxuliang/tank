// 联网对局控制器：双方使用相同客户端，负责阶段切换、输入预测、纠偏和断线恢复
import { DIR_DX, DIR_DY, MAP_W, TILE } from '../core/const.js';
import { applyMap, interpolateTo, pushSnapshot } from './sync.js';
import { NetClient, defaultServerUrl } from './client.js';
import { IntroScene } from '../scenes/intro.js';
import { GameScene } from '../scenes/game.js';
import { TallyScene } from '../scenes/tally.js';
import { GameOverScene } from '../scenes/gameover.js';

const SESSION_KEY = 'tank_net_session_v3';
const BASE_INTERP_DELAY = 4;
const MAX_INTERP_DELAY = 10;

function saveResume(data) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(data)); } catch { /* 存储不可用时忽略 */ }
}

function loadResume() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}

function clearResume() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* 存储不可用时忽略 */ }
}

function heldState(input) {
  return {
    up: !!input.state.up,
    right: !!input.state.right,
    down: !!input.state.down,
    left: !!input.state.left,
  };
}

function playerState(player) {
  return {
    x: player.x,
    y: player.y,
    dir: player.dir,
    moving: player.moving,
    treadFrame: player.treadFrame,
    slideTimer: player.slideTimer || 0,
    slideDir: player.slideDir ?? player.dir,
  };
}

function restorePlayer(player, state) {
  player.x = state.x;
  player.y = state.y;
  player.dir = state.dir;
  player.moving = state.moving;
  player.treadFrame = state.treadFrame;
  player.slideTimer = state.slideTimer || 0;
  player.slideDir = state.slideDir ?? state.dir;
}

export class NetGameController {
  constructor(game, client, welcome) {
    this.game = game;
    this.client = client;
    this.code = welcome.code;
    this.slot = welcome.slot;
    this.token = welcome.token;
    this.epoch = welcome.epoch;
    this.phaseId = 0;
    this.readySlots = new Set();
    this.status = 'connected';
    this.currentSession = null;
    this.manualClose = false;
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.pendingOpenOff = null;
    // 输入与开火序号跨关卡延续：服务端席位序号整场对局单调递增，
    // 新战斗会话必须从这里续号，否则服务端会把 seq 倒退的输入全部丢弃。
    this.carriedSeq = 0;
    this.carriedFireSeq = 0;
    this._bindClient();
    this._persist();
  }

  _bindClient() {
    this.client.on('phase', (message) => this._onPhase(message));
    this.client.on('ready-status', (message) => {
      if (message.phaseId !== this.phaseId || !Array.isArray(message.slots)) return;
      this.readySlots = new Set(message.slots);
    });
    this.client.on('seat-status', (message) => {
      if (message.slot !== this.slot && message.removed) this.game.notice = '另一名玩家已离开，对局继续';
    });
    this.client.on('close', () => this._onClose());
    this.client.on('resumed', (message) => this._onResumed(message));
    this.client.on('resume-rejected', (message) => this._resumeRejected(message));
    this.client.on('snap', (message) => {
      if (!this.currentSession) this.pendingSnapshot = message;
    });
  }

  activate() {
    this.game.mode = 'net';
    this.game.net = this;
    this.game.resetRun();
    this.game.audio.stopBgm();
  }

  createGameSession(scene) {
    this.currentSession = new NetGameSession(this.game, scene, this);
    if (this.pendingSnapshot) {
      this.currentSession.acceptSnapshot(this.pendingSnapshot);
      this.pendingSnapshot = null;
    }
    return this.currentSession;
  }

  ready(phaseId = this.phaseId) {
    return this.client.command(this.epoch, 'ready', { phaseId });
  }

  isReady() { return this.readySlots.has(this.slot); }

  togglePause() {
    this.client.command(this.epoch, 'pause');
  }

  _onPhase(message) {
    if (message.phaseId < this.phaseId) return;
    this.phaseId = message.phaseId;
    this.readySlots.clear();
    if (this.currentSession) {
      // 会话随场景销毁前接住序号，供下一关的新会话延续
      this.carriedSeq = this.currentSession.seq;
      this.carriedFireSeq = this.currentSession.fireSeq;
      this.currentSession.destroy();
    }
    this.currentSession = null;
    if (message.phase === 'intro') {
      this.game.engine.changeScene(new IntroScene(this.game, message.stageIndex));
    } else if (message.phase === 'playing') {
      this.game.engine.changeScene(new GameScene(this.game, message.stageIndex, 20));
    } else if (message.phase === 'tally') {
      this.game.engine.changeScene(new TallyScene(this.game, message.stageIndex, message.killStats));
    } else if (message.phase === 'over') {
      this.game.engine.changeScene(new GameOverScene(this.game, message.stageIndex, message.reason || 'tank'));
    }
  }

  _onClose() {
    if (this.manualClose || this.status === 'expired') return;
    this.status = 'reconnecting';
    if (this.currentSession) this.currentSession.onDisconnected();
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (this.reconnectTimer || this.manualClose) return;
    const delay = Math.min(3000, 400 + this.reconnectAttempt * 300);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempt++;
      if (this.pendingOpenOff) this.pendingOpenOff();
      this.pendingOpenOff = this.client.on('open', () => {
        this.pendingOpenOff();
        this.pendingOpenOff = null;
        this.client.resume(this.code, this.token);
      });
      this.client.connect();
    }, delay);
  }

  _onResumed(message) {
    this.slot = message.slot;
    this.epoch = message.epoch;
    this.status = 'connected';
    this.reconnectAttempt = 0;
    this._persist();
    if (this.currentSession) this.currentSession.onResumed();
  }

  _resumeRejected(message) {
    this.status = 'expired';
    clearResume();
    if (this.currentSession) {
      this.currentSession.destroy();
      this.currentSession = null;
    }
    this.game.notice = message.msg || '对局恢复失败';
    this.manualClose = true;
    this.client.close();
    this.game.net = null;
    this.game.mode = '1p';
    import('../scenes/title.js').then(({ TitleScene }) => {
      this.game.engine.changeScene(new TitleScene(this.game));
    });
  }

  _persist() {
    saveResume({ url: this.client.url, code: this.code, token: this.token, slot: this.slot });
  }

  close() {
    this.manualClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pendingOpenOff) this.pendingOpenOff();
    clearResume();
    this.client.close();
  }
}

export function restoreNetSession(game, transportFactory = null) {
  const saved = loadResume();
  if (!saved || !saved.url || !saved.code || !saved.token) return null;
  const client = new NetClient(saved.url || defaultServerUrl(), transportFactory);
  const controller = new NetGameController(game, client, {
    code: saved.code,
    slot: saved.slot || 0,
    token: saved.token,
    epoch: 0,
  });
  controller.status = 'reconnecting';
  controller.activate();
  client.on('open', () => client.resume(saved.code, saved.token));
  client.connect();
  return controller;
}

export class NetGameSession {
  constructor(game, scene, controller) {
    this.game = game;
    this.scene = scene;
    this.controller = controller;
    this.client = controller.client;
    this.seq = controller.carriedSeq || 0;      // 延续上一关的序号（断线恢复时已被重置为 0）
    this.fireSeq = controller.carriedFireSeq || 0;
    this.history = new Map();
    this.pendingBatch = [];
    this.predictedFires = new Map();
    this.localFireAudio = new Set();
    this.latestServerFrame = 0;
    this.renderFrame = undefined;
    this.interpDelay = BASE_INTERP_DELAY;
    this.jitterFrames = 0;
    this.lastSnapLocalFrame = 0;
    this.lastSnapServerFrame = undefined;
    this.lastAppliedServerFrame = -1;
    this.lastAcknowledgedInput = -1;
    this.disconnected = controller.status !== 'connected';
    this.unsubscribers = [
      this.client.on('snap', (message) => this._onSnapshot(message)),
      this.client.on('fire-result', (message) => this._onFireResult(message)),
      // 服务端暂停/恢复即时通知：当帧停止或恢复本地预测，不等下一份快照
      this.client.on('pause', (message) => { this.scene.paused = !!message.ps; }),
    ];
    scene.world.externalPlayerControl = true;
  }

  update() {
    const world = this.scene.world;
    if (!world) return;
    if (!this.disconnected && this.controller.status === 'connected') this._sampleAndPredict(world);
    this._interpolate(world);
    this._advanceLocalBullets(world);
    world._updateFx();
  }

  onDisconnected() {
    this.disconnected = true;
    this.pendingBatch.length = 0;
  }

  onResumed() {
    this.disconnected = false;
    // 服务端恢复席位时已把 ack/lastQueuedSeq/lastFireSeq 清零，两端重新对齐
    this.seq = 0;
    this.fireSeq = 0;
    this.history.clear();
    this.pendingBatch.length = 0;
    this.predictedFires.clear();
    this.localFireAudio.clear();
    this.lastAcknowledgedInput = -1;
  }

  _sampleAndPredict(world) {
    const input = this.game.input;
    const held = heldState(input);
    const fireSeq = input.pressed('fire') ? ++this.fireSeq : null;
    const frame = {
      seq: ++this.seq,
      held,
      fireSeq,
      viewFrame: Math.floor(this.renderFrame ?? this.latestServerFrame),
    };
    if (!this.scene.paused) this._applyPredictedInput(world, frame, true);
    const me = world.players[this.controller.slot];
    if (me) this.history.set(frame.seq, { frame, state: playerState(me) });
    while (this.history.size > 240) this.history.delete(this.history.keys().next().value);
    this.pendingBatch.push(frame);
    if (this.pendingBatch.length >= 2) {
      this.client.sendInputs(this.controller.epoch, this.pendingBatch.splice(0));
    }
  }

  _applyPredictedInput(world, frame, advanceTimers) {
    const me = world.players[this.controller.slot];
    if (!me || !me.alive || world.state !== 'playing') return;
    if (advanceTimers) me.tickTimers();
    world.pendingPlayerFire = frame.fireSeq ? {
      slot: this.controller.slot,
      fireSeq: frame.fireSeq,
      fireEpoch: this.controller.epoch,
      viewHf: frame.viewFrame,
    } : null;
    const input = {
      dirHeld: () => frame.held.up ? 0 : frame.held.right ? 1 : frame.held.down ? 2 : frame.held.left ? 3 : -1,
      pressed: (action) => action === 'fire' && !!frame.fireSeq,
    };
    const fired = me.applyControl(world, input);
    world.pendingPlayerFire = null;
    if (fired && frame.fireSeq) {
      const bullet = world.bullets[world.bullets.length - 1];
      bullet.id = -frame.fireSeq;
      bullet.ownerId = me.id;
      bullet.clientFireSeq = frame.fireSeq;
      bullet.clientFireEpoch = this.controller.epoch;
      bullet.localPredicted = true;
      this.predictedFires.set(frame.fireSeq, bullet);
      this.localFireAudio.add(frame.fireSeq);
    }
  }

  _onSnapshot(snapshot) {
    if (snapshot.epoch !== this.controller.epoch || snapshot.sg !== this.scene.stageIndex) return;
    const serverFrame = snapshot.sf ?? snapshot.hf;
    if (serverFrame <= this.lastAppliedServerFrame) return;
    this.lastAppliedServerFrame = serverFrame;
    const world = this.scene.world;
    if (!world) return;
    if (snapshot.map) applyMap(world.tilemap, snapshot.map);
    this.latestServerFrame = snapshot.sf ?? snapshot.hf;
    this._updateJitter(snapshot);
    const authoritative = snapshot.pl && snapshot.pl[this.controller.slot];
    pushSnapshot(world, snapshot, this.controller.slot);
    this._reconcile(world, snapshot.ack, authoritative);
    for (const event of snapshot.ev || []) {
      const name = typeof event === 'string' ? event : event.name;
      if (!name || !this.game.audio[name]) continue;
      if (name === 'shoot' && event.slot === this.controller.slot && this.localFireAudio.has(event.fireSeq)) {
        this.localFireAudio.delete(event.fireSeq);
        continue;
      }
      this.game.audio[name]();
    }
    this.scene.paused = !!snapshot.ps;
    if (this.game.score > this.game.hiScore) this.game.hiScore = this.game.score;
  }

  acceptSnapshot(snapshot) { this._onSnapshot(snapshot); }

  _updateJitter(snapshot) {
    const serverFrame = snapshot.sf ?? snapshot.hf;
    const localFrame = this.game.engine.frame;
    if (this.lastSnapServerFrame !== undefined) {
      const expected = serverFrame - this.lastSnapServerFrame;
      const actual = localFrame - this.lastSnapLocalFrame;
      this.jitterFrames = this.jitterFrames * 0.85 + Math.abs(actual - expected) * 0.15;
      this.interpDelay = Math.max(BASE_INTERP_DELAY, Math.min(MAX_INTERP_DELAY,
        BASE_INTERP_DELAY + Math.ceil(this.jitterFrames * 1.5)));
    }
    this.lastSnapServerFrame = serverFrame;
    this.lastSnapLocalFrame = localFrame;
  }

  _reconcile(world, ack, authoritative) {
    const me = world.players[this.controller.slot];
    if (!me || !authoritative || !Number.isSafeInteger(ack)) return;
    // 同一确认号会出现在多份快照里。历史已经在第一次确认时删除，
    // 不能把之后的重复快照误判为预测错误并把坦克硬拉回去。
    if (ack <= this.lastAcknowledgedInput) return;
    this.lastAcknowledgedInput = ack;
    const predicted = this.history.get(ack);
    const mismatch = !predicted || Math.abs(predicted.state.x - authoritative.x) > 0.01 ||
      Math.abs(predicted.state.y - authoritative.y) > 0.01 || predicted.state.dir !== authoritative.dir;
    if (mismatch) {
      restorePlayer(me, {
        x: authoritative.x,
        y: authoritative.y,
        dir: authoritative.dir,
        moving: authoritative.moving,
        treadFrame: authoritative.tread,
        slideTimer: authoritative.slT,
        slideDir: authoritative.slD,
      });
      for (let seq = ack + 1; seq <= this.seq; seq++) {
        const entry = this.history.get(seq);
        if (!entry) break;
        this._applyPredictedInput(world, { ...entry.frame, fireSeq: null }, false);
        entry.state = playerState(me);
      }
    }
    for (const seq of [...this.history.keys()]) if (seq <= ack) this.history.delete(seq);
  }

  _onFireResult(message) {
    if (message.epoch !== this.controller.epoch) return;
    // 被拒绝的开火不会有服务端枪声事件，localFireAudio 在这里兜底清理
    this.localFireAudio.delete(message.fireSeq);
    const bullet = this.predictedFires.get(message.fireSeq);
    if (!bullet) return;
    if (!message.accepted) bullet.alive = false;
    else {
      bullet.id = message.bulletId;
      bullet.authorityConfirmed = true;
    }
    this.predictedFires.delete(message.fireSeq);
  }

  _interpolate(world) {
    const buffer = world._snapBuffer;
    if (!buffer || !buffer.length) return;
    const latest = buffer[buffer.length - 1].hf;
    const oldest = buffer[0].hf;
    const target = latest - this.interpDelay;
    if (this.renderFrame === undefined || this.renderFrame < oldest) this.renderFrame = Math.max(oldest, target);
    else this.renderFrame = Math.min(target, this.renderFrame + 1);
    interpolateTo(world, this.renderFrame, this.controller.slot);
  }

  _advanceLocalBullets(world) {
    for (const bullet of world.bullets) {
      if (!bullet.localPredicted) continue;
      bullet._age = (bullet._age || 0) + 1;
      if (bullet._age > 120) { bullet.alive = false; continue; }
      const steps = Math.ceil(bullet.speed);
      for (let i = 0; i < steps && bullet.alive; i++) {
        bullet.x += DIR_DX[bullet.dir] * (bullet.speed / steps);
        bullet.y += DIR_DY[bullet.dir] * (bullet.speed / steps);
        if (bullet.x < 0 || bullet.x > MAP_W * TILE || bullet.y < 0 || bullet.y > MAP_W * TILE) {
          bullet.alive = false;
          break;
        }
        const rect = bullet.hitRect();
        if (world.tilemap.bulletHit(rect.x, rect.y, rect.w, rect.h, bullet.power, false).result) {
          bullet.alive = false;
          break;
        }
        // 让本地画面也在敌坦/队友前停下；真正的命中、击毁、扣命和重生仍以服务端快照为准。
        if (bullet.isPlayerBullet) {
          const hitEnemy = world.enemies.find((enemy) => enemy.alive && enemy.spawnTimer <= 0 &&
            bullet._overlaps(enemy));
          if (hitEnemy) bullet.alive = false;
          const hitPlayer = world.players.find((player) => player.alive && player.spawnTimer <= 0 &&
            player.id !== bullet.ownerId && bullet._overlaps(player));
          if (hitPlayer) bullet.alive = false;
        }
      }
    }
    world.bullets = world.bullets.filter((bullet) => bullet.alive);
  }

  destroy() {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers = [];
  }
}
