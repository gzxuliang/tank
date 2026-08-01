// 联网会话：主机权威 + 快照同步
// 主机（NetHostSession）：跑权威 World，P2 输入来自客机，每 2 帧广播快照
// 客机（NetClientSession）：发本地输入（带帧序号），按快照更新镜像 World 并渲染；
// 自己的坦克做本地预测 + 回放纠偏（快照回执已确认输入序号，倒回权威位置重放），
// 预测准确时零跳动，消除操作延迟与漂移
import { NetInput } from '../core/input.js';
import { serializeWorld, applySnapshot, serializeMap, applyMap, smoothEntities } from './sync.js';
import { TitleScene } from '../scenes/title.js';

// 需要同步给客机的音效方法
const AUDIO_METHODS = [
  'shoot', 'hitWall', 'hitSteel', 'hitTank', 'explodeSmall', 'explodeBig',
  'powerupSpawn', 'powerupPick', 'grenade', 'oneUp', 'shovel', 'freeze',
  'respawn', 'victory', 'gameOver',
];

// 音频事件记录：全局只包装一次，事件累积在 game.audioEvents，由主机会话随快照带走
function ensureAudioWrapped(game) {
  if (game.audio._netWrapped) return;
  game.audio._netWrapped = true;
  game.audioEvents = [];
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
      this.netInput.applyRemote(data.held, data.edges);
      this.lastSeq = data.seq; // 已消费的客机输入序号，随快照回执给客机做回放纠偏
    } else if (data.t === 'hello') this.sendMapNext = true; // 客机进入新场景，补发全量地形
  }

  update() {
    if (this.dead) { backToTitleWithNotice(this.game, '对方已断开连接'); return; }
    const world = this.scene.world;
    world.update([this.game.input, this.netInput]);
    this.netInput.postUpdate();
    this.frame++;
    if (this.frame % 2 === 0) this.broadcast();
  }

  // 主机暂停中：低频心跳，让客机同步显示暂停遮罩
  updatePaused() {
    if (this.dead) { backToTitleWithNotice(this.game, '对方已断开连接'); return; }
    if (this.frame++ % 30 === 0) this.broadcast();
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
    this.seq = 0;              // 本地输入帧序号（随输入发出，主机随快照回执）
    this.history = new Map();  // seq → 输入快照，回放纠偏用
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
      applySnapshot(world, data);
      this._reconcile(world, data.ack); // 回放式纠偏自己的坦克
      for (const m of data.ev || []) {
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
    this.seq++;
    this.history.set(this.seq, held);
    if (this.history.size > 180) this.history.delete(this.seq - 180); // 只留 3 秒
    this.client.relay({ t: 'in', seq: this.seq, held, edges: { ...this.game.input.pressedSet } });
    const world = this.scene.world;
    const me = world.players[1]; // 客机固定为 P2
    this._applyInput(world, me, held); // 本地预测：输入即时生效
    smoothEntities(world, me);         // 其余实体位置向快照目标平滑趋近
    world._updateFx();                 // 特效动画本地推进
  }

  // 用一帧输入驱动自己的坦克（移动逻辑与 Player.update 一致；
  // 开火不做预测，子弹由主机权威生成）。预测与回放共用。
  _applyInput(world, me, held) {
    if (!me || !me.alive || me.spawnTimer > 0 || world.state !== 'playing') return;
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
  }

  // 回放式纠偏：把坐标倒回快照（=主机已确认 ack 输入时的权威位置），
  // 再把 ack 之后的本地输入逐帧重放。预测准确时结果与当前一致，无跳动；
  // 只在预测与主机真实分歧（碰撞差异/阵亡/重生）时才被拉回
  _reconcile(world, ack) {
    const me = world.players[1];
    if (!me || ack === undefined || me._tx === undefined) return;
    me.x = me._tx; me.y = me._ty; // 倒回权威坐标
    for (let s = ack + 1; s <= this.seq; s++) {
      const held = this.history.get(s);
      if (!held) break;           // 历史不足（超大延迟），直接用快照坐标
      this._applyInput(world, me, held);
    }
  }
}
