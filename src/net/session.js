// 联网会话：主机权威 + 快照同步
// 主机（NetHostSession）：跑权威 World，P2 输入来自客机，每 2 帧广播快照
// 客机（NetClientSession）：只发本地输入，按快照更新镜像 World 并渲染
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
    // 每帧把本地输入发给主机（客机不跑游戏逻辑）
    this.client.relay({ t: 'in', ...NetInput.snapshotOf(this.game.input) });
    const world = this.scene.world;
    smoothEntities(world);   // 位置向快照目标平滑趋近
    world._updateFx();       // 特效动画本地推进
  }
}
