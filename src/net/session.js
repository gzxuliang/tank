// 联网会话：主机权威 + 快照同步
// 主机（NetHostSession）：跑权威 World，P2 输入来自客机，每 2 帧广播快照
// 客机（NetClientSession）：发本地输入（带帧序号），按快照更新镜像 World 并渲染；
// 自己的坦克做本地预测 + 回放纠偏（快照回执已确认输入序号，倒回权威位置重放），
// 预测准确时零跳动，消除操作延迟与漂移
import { NetInput } from '../core/input.js';
import { serializeWorld, pushSnapshot, serializeMap, applyMap, interpolateTo } from './sync.js';
import { TitleScene } from '../scenes/title.js';
import { DIR_DX, DIR_DY, MAP_W, TILE } from '../core/const.js';

// 需要同步给客机的音效方法
const AUDIO_METHODS = [
  'shoot', 'hitWall', 'hitSteel', 'hitTank', 'explodeSmall', 'explodeBig',
  'powerupSpawn', 'powerupPick', 'grenade', 'oneUp', 'shovel', 'freeze',
  'respawn', 'victory', 'gameOver',
];

// 音频事件记录：全局只包装一次，事件累积在 game.audioEvents，由主机会话随快照带走
function ensureAudioWrapped(game) {
  if (!game.audioEvents) game.audioEvents = [];
  if (game.audio._netWrapped) return;
  game.audio._netWrapped = true;
  for (const m of AUDIO_METHODS) {
    const orig = game.audio[m].bind(game.audio);
    game.audio[m] = (...a) => { game.audioEvents.push(m); orig(...a); };
  }
}

// 断线处理：提示并返回标题
function backToTitleWithNotice(game, text) {
  if (game.net) { game.net.client.close(); game.net = null; }
  game.mode = '1p';
  game.notice = text;
  game.engine.changeScene(new TitleScene(game));
}

export class NetHostSession {
  constructor(game, scene) {
    this.game = game;
    this.scene = scene;
    this.isHost = true;
    this.client = game.net.client;
    this.netInput = new NetInput(); // 客机玩家的输入
    this.lastSeq = 0;               // 已消费的客机输入序号
    this.inQueue = [];              // 输入状态队列：每帧追到最新状态，避免公网突发包永久积压
    this.fireQueue = [];            // 开火按下沿单独排队，移动状态合并时也不能丢
    this.lastQueuedFireSeq = 0;
    this.lastFireSeq = 0;           // 已由权威逻辑处理的开火编号
    this.pendingP2Fire = null;      // 当前权威帧要消费的 P2 开火命令（带客户端开火编号）
    this.frame = 0;
    this.dead = false;
    this.sendMapNext = true;        // 首包快照附带全量地形
    ensureAudioWrapped(game);
    this.client.on('relay', (m) => this.onMessage(m.data)); // 服务器外层包装为 {t:'relay', data}
    this.client.on('peer-left', () => { this.dead = true; });
    this.client.on('close', () => { this.dead = true; });
  }

  onMessage(data) {
    if (data.t === 'in') {
      this.inQueue.push(data); // 排队，update 开头合并消费
    } else if (data.t === 'hello') this.sendMapNext = true; // 客机进入新场景，补发全量地形
  }

  // 移动是“当前按住状态”，同一权威帧收到多包时直接追到最新一包；
  // fire 是一次性事件，必须单独排队。这样网络突发不会形成永远追不完的输入积压。
  _consumeInputs(allowFire = true) {
    this.pendingP2Fire = null;
    let latest = null;
    let highestSeq = this.lastSeq;
    while (this.inQueue.length) {
      const m = this.inQueue.shift();
      if (!m || typeof m.seq !== 'number' || m.seq <= highestSeq) continue;
      highestSeq = m.seq;
      latest = m;
      if (m.edges && m.edges.fire && typeof m.fireSeq === 'number' &&
          m.fireSeq > this.lastQueuedFireSeq) {
        this.fireQueue.push({ fireSeq: m.fireSeq, viewHf: m.viewHf });
        this.lastQueuedFireSeq = m.fireSeq;
      }
    }
    if (latest) {
      this.netInput.applyRemote(latest.held || {}, {});
      this.lastSeq = latest.seq;
      if (typeof latest.viewHf === 'number' && this.scene.world) {
        this.scene.world.inputLag = Math.max(0, Math.min(30, this.game.engine.frame - latest.viewHf));
      }
    } else {
      this.netInput.pressedSet = {};
    }
    if (allowFire && this.fireQueue.length) {
      this.pendingP2Fire = this.fireQueue.shift();
      this.netInput.pressedSet.fire = true;
    }
  }

  update() {
    if (this.dead) { backToTitleWithNotice(this.game, '对方已断开连接'); return; }
    this._consumeInputs();
    const world = this.scene.world;
    world.pendingP2Fire = this.pendingP2Fire;
    world.update([this.game.input, this.netInput]);
    if (this.pendingP2Fire) this.lastFireSeq = this.pendingP2Fire.fireSeq;
    world.pendingP2Fire = null;
    this.pendingP2Fire = null;
    this.netInput.postUpdate();
    this.frame++;
    if (this.frame % 2 === 0) this.broadcast();
  }

  // 主机暂停中：低频心跳，让客机同步显示暂停遮罩
  updatePaused() {
    if (this.dead) { backToTitleWithNotice(this.game, '对方已断开连接'); return; }
    this._consumeInputs(false); // 暂停只更新按住状态，开火事件留到恢复后的权威帧处理
    if (this.frame++ % 30 === 0) this.broadcast();
  }

  // 顿帧期间：广播快照（内容不变，hf 推进），客机插值缓冲不断流
  onHitstop() {
    if (!this.dead) this.broadcast();
  }

  broadcast() {
    const world = this.scene.world;
    // 地形只在变化（或首包）时发全量，676×2 字节
    if (this.sendMapNext || world.tilemap._dirty) {
      this.client.relay(serializeMap(world.tilemap, world.stageIndex));
      this.sendMapNext = false;
    }
    const snap = serializeWorld(world, {
      ev: this.game.audioEvents.splice(0),
      ps: this.scene.paused,
      ack: this.lastSeq, // 回执：客机据此把预测坐标倒回快照点再重放
      fAck: this.lastFireSeq, // 开火独立回执：不能拿输入帧编号判断预测子弹是否被处理
    });
    world.fxEvents = []; // 事件已随快照带走
    this.client.relay(snap);
  }
}

export class NetClientSession {
  constructor(game, scene) {
    this.game = game;
    this.scene = scene;
    this.isHost = false;
    this.client = game.net.client;
    this.dead = false;
    this.fireSeq = 0;          // 本地开火编号：用于精确接管预测子弹
    this.seq = 0;              // 本地输入帧序号（随输入发出，主机随快照回执）
    this.history = new Map();  // seq → 输入快照，回放纠偏用
    this.lastHf = 0;           // 收到的最新快照主机帧号（随输入回告主机，延迟补偿用）
    this._renderHf = undefined;
    this._interpDelay = 6;     // 约 100ms 的初始插值缓冲，按网络抖动自适应增加
    this._jitterFrames = 0;
    this._lastSnapLocalFrame = 0;
    this._lastSnapHf = undefined;
    this._rttFrames = undefined; // 输入发送到权威确认再返回的平滑 RTT（客户端逻辑帧）
    this._localFireFrames = 0; // 本地开火后的音效抑制窗口（防主机回传 shoot 双响）
    this.client.on('relay', (m) => this.onMessage(m.data)); // 服务器外层包装为 {t:'relay', data}
    this.client.on('peer-left', () => { this.dead = true; });
    this.client.on('close', () => { this.dead = true; });
    this.client.relay({ t: 'hello' }); // 通知主机补发全量地形（跨场景同步）
  }

  onMessage(data) {
    const world = this.scene.world;
    if (!world) return;
    if (data.sg !== undefined && data.sg !== this.scene.stageIndex) return; // 跨场景错位，丢弃
    if (data.t === 'map') {
      applyMap(world.tilemap, data);
    } else if (data.t === 'snap') {
      this.lastHf = data.hf; // 记录最新主机帧号（随输入回告，主机算输入延迟）
      const localFrame = this.game.engine.frame;
      if (this._lastSnapHf !== undefined) {
        const expected = data.hf - this._lastSnapHf;
        const actual = localFrame - this._lastSnapLocalFrame;
        this._jitterFrames = this._jitterFrames * 0.85 + Math.abs(actual - expected) * 0.15;
        this._interpDelay = Math.max(6, Math.min(18, 6 + Math.ceil(this._jitterFrames * 2)));
      }
      this._lastSnapLocalFrame = localFrame;
      this._lastSnapHf = data.hf;
      pushSnapshot(world, data, 1); // 客机固定为 P2（slot 1）：瞬时应用 + 快照入队（插值缓冲）
      this._reconcile(world, data.ack); // 回放式纠偏自己的坦克
      for (const m of data.ev || []) {
        if (m === 'shoot' && this._localFireFrames > 0) continue; // 本地已播过开火音（防双响）
        if (this.game.audio[m]) this.game.audio[m]();
      }
      this.scene.paused = !!data.ps; // 跟随主机暂停（仅显示遮罩，不阻塞快照处理）
      if (this.game.score > this.game.hiScore) this.game.hiScore = this.game.score;
    }
  }

  update() {
    if (this.dead) { backToTitleWithNotice(this.game, '对方已断开连接'); return; }
    // 每帧发输入并记录历史（主机回执序号后用于回放纠偏）
    const held = { ...this.game.input.state };
    const edges = { ...this.game.input.pressedSet };
    const fireSeq = edges.fire ? ++this.fireSeq : null;
    this.seq++;
    this.history.set(this.seq, held);
    if (this.history.size > 180) this.history.delete(this.seq - 180); // 只留 3 秒
    // viewHf 是玩家真正看到的远端时间，不是最新到包时间；用于开火回滚判定。
    const viewHf = this._renderHf === undefined ? this.lastHf : Math.floor(this._renderHf);
    this.client.relay({ t: 'in', seq: this.seq, held, edges, fireSeq, viewHf });
    const world = this.scene.world;
    const me = world.players[1]; // 客机固定为 P2
    if (this._localFireFrames > 0) this._localFireFrames--;
    const visualX = me ? me.x + (me._visualOffsetX || 0) : 0;
    const visualY = me ? me.y + (me._visualOffsetY || 0) : 0;
    this._applyInput(world, me, held, edges, fireSeq); // 本地预测：输入即时生效 + 开火预测
    if (me) this._settleVisualCorrection(me, held, visualX, visualY);
    // 远端实体始终保留一段自适应缓冲。不追到最新快照，避免公网抖动时冻结后跳变。
    const buf = world._snapBuffer;
    if (buf && buf.length) {
      const latest = buf[buf.length - 1].hf;
      const oldest = buf[0].hf;
      const target = latest - this._interpDelay;
      if (this._renderHf === undefined || this._renderHf < oldest) this._renderHf = Math.max(oldest, target);
      else this._renderHf = Math.min(target, this._renderHf + 1);
      interpolateTo(world, this._renderHf, 1);
    }
    this._advanceLocalBullets(world); // 本地预测子弹推进（直线 + 地形碰撞）
    world._updateFx();                 // 特效动画本地推进
  }

  // 缓慢消化纠偏残差；持续按住方向时，纠偏最多让画面停住，绝不反向拉回。
  _settleVisualCorrection(me, held, beforeX, beforeY) {
    const settle = (v) => Math.abs(v) <= 0.7 ? 0 : v - Math.sign(v) * 0.7;
    me._visualOffsetX = settle(me._visualOffsetX || 0);
    me._visualOffsetY = settle(me._visualOffsetY || 0);
    const d = held.up ? 0 : held.right ? 1 : held.down ? 2 : held.left ? 3 : -1;
    if (d < 0) return;
    const afterX = me.x + me._visualOffsetX;
    const afterY = me.y + me._visualOffsetY;
    const progress = (afterX - beforeX) * DIR_DX[d] + (afterY - beforeY) * DIR_DY[d];
    if (progress >= 0) return;
    me._visualOffsetX += (beforeX - afterX) * Math.abs(DIR_DX[d]);
    me._visualOffsetY += (beforeY - afterY) * Math.abs(DIR_DY[d]);
  }

  // 用一帧输入驱动自己的坦克（移动逻辑与 Player.update 一致）。
  // fire：本帧按下沿（预测时传真实 pressedSet，回放时传空——重放不重复开火）。
  // 开火本地预测：立即生成子弹（负数 id，权威接管前不被快照匹配）+ 音效，
  // 消除公网下「按 fire 后 2×RTT 才有反馈」的延迟感；命中判定仍由主机权威负责
  _applyInput(world, me, held, fire, fireSeq = null) {
    if (!me || !me.alive || world.state !== 'playing') return;
    me.tickTimers();
    if (me.spawnTimer > 0) return;
    const d = held.up ? 0 : held.right ? 1 : held.down ? 2 : held.left ? 3 : -1;
    if (d >= 0) {
      me.setDir(d);
      me.tryMove(world);
      me.slideTimer = 0;
      if (world.tilemap.onIce(me.x, me.y, me.w, me.h)) {
        me.slideTimer = 8;
        me.slideDir = d;
      }
    } else {
      me.moving = false;
      // 冰面打滑：松开后继续滑一小段
      if (me.slideTimer > 0) {
        me.slideTimer--;
        me.setDir(me.slideDir);
        const bak = me.speed;
        me.speed = bak * 0.7;
        me.tryMove(world);
        me.speed = bak;
      }
    }
    // 本地开火预测（按住仅首帧按下沿生效，与本地单人规则一致）
    if (fire && fire.fire && me.canFire(world)) {
      world.spawnBullet(me);
      const b = world.bullets[world.bullets.length - 1];
      b.id = -1000 - this.seq; // 本地预测子弹：负数 id，权威快照永不匹配
      b.ownerId = me.id;
      b.clientFireSeq = fireSeq;
      b.localPredicted = true;
      world.audio.shoot(); // 本地立即播（客机 audio 未包装，不产生事件）
      this._localFireFrames = 12; // 抑制主机回传的 shoot 事件（防双响）
    }
  }

  // 本地预测子弹推进：直线飞行 + 地形/边界碰撞（不做坦克碰撞，命中由主机权威判定）。
  // 权威子弹按开火编号接管后继续沿本地预测轨迹展示，直到主机快照确认其结束。
  _advanceLocalBullets(world) {
    for (const b of world.bullets) {
      if (!b.localPredicted) continue; // 只看本地预测子弹（确认后仍由本地平滑展示）
      b._age = (b._age || 0) + 1;
      if (b._age > 60) { b.alive = false; continue; } // 防御：权威未生成时超时消失
      const steps = Math.ceil(b.speed);
      for (let i = 0; i < steps && b.alive; i++) {
        b.x += DIR_DX[b.dir] * (b.speed / steps);
        b.y += DIR_DY[b.dir] * (b.speed / steps);
        if (b.x < 0 || b.x > MAP_W * TILE || b.y < 0 || b.y > MAP_W * TILE) {
          world.bulletExplode(b, false);
          break;
        }
        const r = b.hitRect();
        // 客机预测不能改动权威镜像地图；只作只读碰撞预览。
        const hit = world.tilemap.bulletHit(r.x, r.y, r.w, r.h, b.power, false);
        if (hit.result) { world.bulletExplode(b, false); break; }
      }
    }
    world.bullets = world.bullets.filter((b) => b.alive);
  }

  // 回放式纠偏：权威位置已经是主机生成快照时的当前状态，只需补上快照回程期间的输入。
  // seq-ack 近似完整 RTT，取平滑后的一半作为回程帧数；直接重放完整 RTT 会把去程重复计算，
  // 尤其会在出生结束或碰撞附近造成大幅前后跳。
  _reconcile(world, ack) {
    const me = world.players[1];
    if (!me || ack === undefined || me._tx === undefined) return;
    const sampleRtt = Math.max(0, this.seq - ack);
    this._rttFrames = this._rttFrames === undefined
      ? sampleRtt
      : this._rttFrames * 0.85 + sampleRtt * 0.15;
    const oneWay = Math.max(0, Math.round(this._rttFrames / 2));
    const end = Math.max(ack, this.seq - oneWay);
    const screenX = me.x + (me._visualOffsetX || 0);
    const screenY = me.y + (me._visualOffsetY || 0);
    me.x = me._tx; me.y = me._ty; // 倒回权威坐标
    for (let s = ack + 1; s <= end; s++) {
      const held = this.history.get(s);
      if (!held) break;           // 历史不足（超大延迟），直接用快照坐标
      this._applyInput(world, me, held);
    }
    me._visualOffsetX = screenX - me.x;
    me._visualOffsetY = screenY - me.y;
  }
}
