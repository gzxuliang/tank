// 坦克大战服务端适配器：把通用对局运行时接到真实 World 游戏逻辑
import { World } from '../../src/game/world.js';
import { LEVELS } from '../../src/game/levels.js';
import { serializeMap, serializeWorld } from '../../src/net/sync.js';

const AUDIO_METHODS = [
  'shoot', 'hitWall', 'hitSteel', 'hitTank', 'explodeSmall', 'explodeBig',
  'powerupSpawn', 'powerupPick', 'grenade', 'oneUp', 'shovel', 'freeze',
  'respawn', 'victory', 'gameOver', 'stageStart', 'pause',
];

function makeInput(frame) {
  const held = frame.held || {};
  return {
    dirHeld() {
      if (held.up) return 0;
      if (held.right) return 1;
      if (held.down) return 2;
      if (held.left) return 3;
      return -1;
    },
    pressed(action) { return action === 'fire' && !!frame.fireSeq; },
  };
}

function validNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export const tankGameDefinition = {
  id: 'tank',
  seatCount: 2,

  validateInput(frame) {
    if (!frame || !Number.isSafeInteger(frame.seq) || frame.seq <= 0) return false;
    if (frame.fireSeq != null && (!Number.isSafeInteger(frame.fireSeq) || frame.fireSeq <= 0)) return false;
    if (frame.viewFrame != null && !validNumber(frame.viewFrame)) return false;
    const held = frame.held;
    if (!held || typeof held !== 'object') return false;
    return ['up', 'right', 'down', 'left'].every((key) => held[key] === undefined || typeof held[key] === 'boolean');
  },

  createMatch(options) { return new TankMatch(options); },
};

export class TankMatch {
  constructor({ tickRate = 60 } = {}) {
    this.tickRate = tickRate;
    this.frame = 0;
    this.phase = 'intro';
    this.phaseId = 1;
    this.stageIndex = 0;
    this.world = null;
    this.ready = new Set();
    this.removed = new Set();
    this.events = [];
    this.hitstop = 0;
    this.score = 0;
    this.lives = [3, 3];
    this.playerLevels = [0, 0];
    this.audioEvents = [];
    this.paused = false;
    this.lastFireSeq = [0, 0];
    this.events.push(this.phaseMessage());
  }

  phaseMessage() {
    const message = { t: 'phase', phase: this.phase, phaseId: this.phaseId, stageIndex: this.stageIndex };
    if (this.phase === 'tally' && this.world) message.killStats = this.world.killStats.map((row) => ({ ...row }));
    if (this.phase === 'over' && this.world) message.reason = this.world.overReason;
    return message;
  }

  canAcceptInput(slot) {
    return this.phase === 'playing' && !this.removed.has(slot) && !!this.world;
  }

  handleCommand(slot, message) {
    if (this.removed.has(slot)) return;
    if (message.command === 'ready' && message.phaseId === this.phaseId) {
      this.ready.add(slot);
      // 客户端只有收到服务端确认后才显示“正在等待”，避免断线时把未送达的准备误认为成功。
      this.events.push({ t: 'ready-status', phaseId: this.phaseId, slots: [...this.ready] });
    }
    if (message.command === 'pause' && slot === 0 && this.phase === 'playing') {
      this.paused = !this.paused;
      // 暂停状态立即广播，让双方客户端当帧同步停止/恢复预测，不等下一份快照
      this.events.push({ t: 'pause', ps: this.paused });
    }
  }

  applyInput(slot, frame) {
    if (this.paused) return frame.fireSeq ? { fire: { fireSeq: frame.fireSeq, accepted: false } } : null;
    const player = this.world && this.world.players[slot];
    const hasNewFire = !!frame.fireSeq && frame.fireSeq > this.lastFireSeq[slot];
    if (frame.fireSeq) this.lastFireSeq[slot] = Math.max(this.lastFireSeq[slot], frame.fireSeq);
    if (!player || !player.alive) return frame.fireSeq ? { fire: { fireSeq: frame.fireSeq, accepted: false } } : null;
    this.world.pendingPlayerFire = hasNewFire ? {
      slot,
      fireSeq: frame.fireSeq,
      fireEpoch: frame.epoch,
      viewHf: Math.max(this.frame - 119, Math.min(this.frame, Math.floor(frame.viewFrame ?? this.frame))),
    } : null;
    const accepted = player.applyControl(this.world, makeInput({ ...frame, fireSeq: hasNewFire ? frame.fireSeq : null }));
    const bullet = accepted ? this.world.bullets[this.world.bullets.length - 1] : null;
    this.world.pendingPlayerFire = null;
    if (!frame.fireSeq) return null;
    return { fire: { fireSeq: frame.fireSeq, accepted, bulletId: bullet ? bullet.id : undefined } };
  }

  step() {
    this.frame++;
    if (this.phase === 'intro') {
      if (this._allActiveReady()) this._startStage();
      return;
    }
    if (this.phase === 'tally') {
      if (this._allActiveReady()) {
        if (this.stageIndex + 1 >= LEVELS.length) this._setPhase('over');
        else {
          this.stageIndex++;
          this._setPhase('intro');
        }
      }
      return;
    }
    if (this.phase === 'over') {
      if (this._allActiveReady()) this._restartStage();
      return;
    }
    if (this.phase !== 'playing' || !this.world || this.paused) return;

    this.world.game.engine.frame = this.frame;
    if (this.hitstop > 0) {
      this.hitstop--;
      return;
    }
    this.world.update([]);
    if (this.world.state === 'clear' && this.world.stateTimer <= 0) {
      this.playerLevels = this.world.players.map((p) => p.level);
      this.lives = [...this.world.lives];
      this._setPhase('tally');
    } else if (this.world.state === 'over' && this.world.stateTimer <= 0) {
      this._setPhase('over');
    }
  }

  snapshot(_slot, full) {
    if (!this.world) return null;
    const snapshot = serializeWorld(this.world, {
      sf: this.frame,
      phase: this.phase,
      phaseId: this.phaseId,
      ev: full ? [] : [...this.audioEvents],
      ps: this.paused,
    });
    if (full || this.world.tilemap._dirty) snapshot.map = serializeMap(this.world.tilemap, this.stageIndex);
    return snapshot;
  }

  afterSnapshot() {
    if (!this.world) return;
    this.world.fxEvents = [];
    this.world.tilemap._dirty = false;
    this.audioEvents = [];
  }

  drainEvents() {
    const events = this.events;
    this.events = [];
    return events;
  }

  removePlayer(slot) {
    if (this.removed.has(slot)) return;
    this.removed.add(slot);
    this.ready.delete(slot);
    if (!this.world) return;
    const player = this.world.players[slot];
    if (player) player.alive = false;
    this.world.lives[slot] = 0;
    this.world.respawnTimers[slot] = 0;
  }

  onSeatResumed(slot) {
    this.lastFireSeq[slot] = 0;
  }

  _activeSlots() {
    return [0, 1].filter((slot) => !this.removed.has(slot));
  }

  _allActiveReady() {
    const active = this._activeSlots();
    return active.length > 0 && active.every((slot) => this.ready.has(slot));
  }

  _startStage() {
    this.ready.clear();
    this.audioEvents = [];
    const audio = {};
    for (const method of AUDIO_METHODS) {
      audio[method] = () => {
        const fire = method === 'shoot' ? this.world?.pendingPlayerFire : null;
        this.audioEvents.push(fire
          ? { name: method, slot: fire.slot, fireSeq: fire.fireSeq, fireEpoch: fire.fireEpoch }
          : { name: method });
      };
    }
    const game = {
      mode: 'net',
      score: this.score,
      lives: [...this.lives],
      playerLevels: [...this.playerLevels],
      audio,
      engine: {
        frame: this.frame,
        addHitstop: (frames) => { this.hitstop = Math.max(this.hitstop, frames); },
      },
      addScore: (points) => { this.score += points; game.score = this.score; },
    };
    this.world = new World(game, this.stageIndex);
    this.world.externalPlayerControl = true;
    for (const slot of this.removed) {
      const player = this.world.players[slot];
      if (player) player.alive = false;
      this.world.lives[slot] = 0;
      this.world.respawnTimers[slot] = 0;
    }
    this._setPhase('playing');
  }

  // 联机全灭后保留房间和当前关卡；双方各确认一次就直接开始，
  // 不再经过需要第二次准备的开幕阶段。
  _restartStage() {
    this.lives = [3, 3];
    this.playerLevels = [0, 0];
    this.lastFireSeq = [0, 0];
    this.hitstop = 0;
    this.paused = false;
    this._startStage();
  }

  _setPhase(phase) {
    this.phase = phase;
    this.phaseId++;
    this.ready.clear();
    this.events.push(this.phaseMessage());
  }
}
