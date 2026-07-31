// 联网会话：主机权威 + 快照同步
// 主机（NetHostSession）：跑权威 World，P2 输入来自客机，每 2 帧广播快照
// 客机（NetClientSession）：发本地输入，按快照更新镜像 World 并渲染；
// 自己的坦克做本地预测（输入即时生效，快照小幅纠偏），消除操作延迟
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
    this.frame = 0;
    this.dead = false;
    this.sendMapNext = true;        // 首包快照附带全量地形
    ensureAudioWrapped(game);
    this.client.on('relay', (m) => this.onMessage(m.data)); // 服务器外层包装为 {t:'relay', data}
    this.client.on('peer-left', () => { this.dead = true; });
    this.client.on('close', () => { this.dead = true; });
  }

  onMessage(data) {
    if (data.t === 'in') this.netInput.applyRemote(data.held, data.edges);
    else if (data.t === 'hello') this.sendMapNext = true; // 客机进入新场景，补发全量地形
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
      for (const m of data.ev || []) {
        if (this.game.audio[m]) this.game.audio[m]();
      }
      this.scene.paused = !!data.ps; // 跟随主机暂停（仅显示遮罩，不阻塞快照处理）
      if (this.game.score > this.game.hiScore) this.game.hiScore = this.game.score;
    }
  }

  update() {
    if (this.dead) { backToTitleWithNotice(this.game, '对方已断开连接'); return; }
    // 输入只在变化时发送（附 10Hz 心跳兜底），减少中转消息量
    const snap = NetInput.snapshotOf(this.game.input);
    const key = JSON.stringify(snap);
    this._idleFrames = (this._idleFrames || 0) + 1;
    if (key !== this._lastInput || this._idleFrames >= 6) {
      this.client.relay({ t: 'in', ...snap });
      this._lastInput = key;
      this._idleFrames = 0;
    }
    const world = this.scene.world;
    const me = world.players[1]; // 客机固定为 P2
    this._predict(world, me);    // 本地预测自己的坦克，输入即时生效
    smoothEntities(world, me);   // 其余实体位置向快照目标平滑趋近
    world._updateFx();           // 特效动画本地推进
  }

  // 本地预测自己的坦克（主机仍权威）：先用快照小幅纠偏，再用本地输入驱动移动
  _predict(world, me) {
    if (!me || !me.alive || me.spawnTimer > 0 || world.state !== 'playing') return;
    // 纠偏：严重不符（阵亡/重生/跨场景）直接落位，轻微偏差缓慢收敛
    if (me._tx !== undefined) {
      const dx = me._tx - me.x, dy = me._ty - me.y;
      if (Math.abs(dx) > 24 || Math.abs(dy) > 24) { me.x = me._tx; me.y = me._ty; }
      else { me.x += dx * 0.15; me.y += dy * 0.15; }
    }
    // 移动逻辑与 Player.update 一致；开火不做预测（子弹由主机权威生成）
    const d = this.game.input.dirHeld();
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
}
