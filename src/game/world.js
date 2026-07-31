// 世界状态：实体管理、生成调度、胜负判定、全局效果计时
// 支持单人/双人：玩家以 players[] 管理，命数与击毁统计按人独立
import {
  PLAYER_SPAWN, PLAYER2_SPAWN, ENEMY_SPAWNS, TILE, MAX_ON_FIELD,
  FREEZE_TIME, SHOVEL_TIME, SHOVEL_BLINK_TIME, POWERUP_SCORE,
  FIELD_X, FIELD_Y, FIELD_SIZE,
} from '../core/const.js';
import { TileMap } from './tilemap.js';
import { Player } from './player.js';
import { Enemy } from './enemy.js';
import { Bullet } from './bullet.js';
import { PowerUp, POWERUP_TYPES } from './powerup.js';
import { ParticleSystem } from '../fx/particles.js';
import { Explosion, Shake } from '../fx/effects.js';
import { FloatText } from '../fx/floattext.js';
import { buildSpawnQueue, LEVELS } from './levels.js';

const SCORE_COLORS = { basic: '#f0f0f0', fast: '#68d8f0', power: '#78d8c0', armor: '#f0a048' };
const SPAWNS = [PLAYER_SPAWN, PLAYER2_SPAWN];

export class World {
  constructor(game, stageIndex) {
    this.game = game;             // {assets, audio, engine, addScore, mode}
    this.stageIndex = stageIndex;
    this.rand = Math.random;

    this.tilemap = new TileMap();
    this.tilemap.loadLevel(LEVELS[stageIndex % LEVELS.length]);
    this.tilemap.fortify(false);  // 自动补齐基地砖墙保护圈

    // 模式与玩家（1p / 2p / net 均为合作守基地）
    this.mode = game.mode || '1p';
    this.playerCount = this.mode === '1p' ? 1 : 2;
    this.nextId = 1;              // 实体自增 id（联网快照对应用）
    this.players = [];
    for (let i = 0; i < this.playerCount; i++) {
      const sp = SPAWNS[i];
      const p = new Player(sp.tx * TILE, sp.ty * TILE, i);
      p.id = this.nextId++;
      // 跨关保留升级等级（仿原版）
      p.level = (this.game.playerLevels && this.game.playerLevels[i]) || 0;
      p._applyLevel();
      this.players.push(p);
    }
    // 命数按人独立（FC 原版规则）
    this.lives = [];
    for (let i = 0; i < this.playerCount; i++) {
      const saved = this.game.lives && this.game.lives[i];
      this.lives.push(saved != null ? saved : 3);
    }
    this.respawnTimers = this.players.map(() => 0);

    this.enemies = [];
    this.bullets = [];
    this.powerups = [];
    this.explosions = [];
    this.particles = new ParticleSystem();
    this.floatTexts = [];
    this.shake = new Shake();
    this.fxEvents = [];           // 本帧视觉事件队列（联网快照用，主机取走后清空）

    this.spawnQueue = buildSpawnQueue(stageIndex);
    this.spawnTimer = 90;         // 开场稍缓再出怪
    this.spawnPointIdx = 0;

    // 击毁统计按玩家分列
    this.killStats = this.players.map(() => ({ basic: 0, fast: 0, power: 0, armor: 0 }));
    this.freezeTimer = 0;
    this.shovelTimer = 0;

    this.state = 'playing';       // playing | clear | over
    this.overReason = null;       // 'tank' | 'base'
    this.stateTimer = 0;
    this.lastShake = { x: 0, y: 0 };
  }

  get audio() { return this.game.audio; }

  // 兼容旧引用：P1 别名（players[0]）
  get player() { return this.players[0]; }

  // 距 (x,y) 最近的存活玩家（敌人 AI 瞄准用）
  nearestAlivePlayer(x, y) {
    let best = null, bd = Infinity;
    for (const p of this.players) {
      if (!p.alive || p.spawnTimer > 0) continue;
      const d = Math.abs(p.x - x) + Math.abs(p.y - y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // ---- 主更新 ----
  // inputs：与 players 对齐的输入数组（单人传 [input]，双人传 [input1, input2]）
  update(inputs) {
    // 结算/结束状态：仅更新视觉残留
    if (this.state !== 'playing') {
      this.stateTimer--;
      this._updateFx();
      return;
    }

    // 冻结计时
    if (this.freezeTimer > 0) {
      this.freezeTimer--;
      if (this.freezeTimer === 0) {
        for (const e of this.enemies) e.frozen = false;
      }
    }
    // 铁锹计时（最后闪烁预警）
    if (this.shovelTimer > 0) {
      this.shovelTimer--;
      if (this.shovelTimer === 0) {
        this.tilemap.fortify(false, (tx, ty) => this._fortifyCellOccupied(tx, ty));
      } else if (this.shovelTimer < SHOVEL_BLINK_TIME) {
        this.tilemap.fortify((this.shovelTimer >> 4) % 2 === 0, (tx, ty) => this._fortifyCellOccupied(tx, ty));
      }
    }
    // 被坦克压住而暂缓的围墙格子：坦克开走后补回
    this.tilemap.retryFortify((tx, ty) => this._fortifyCellOccupied(tx, ty));

    this._updateSpawning();

    // 玩家（各自独立更新/重生）
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i];
      if (p.alive) {
        p.update(this, inputs[i]);
      } else if (this.respawnTimers[i] > 0) {
        this.respawnTimers[i]--;
        if (this.respawnTimers[i] === 0 && this.lives[i] > 0) {
          const sp = SPAWNS[i];
          const sx = sp.tx * TILE, sy = sp.ty * TILE;
          const onSpawn = (t) =>
            t.alive && sx < t.x + t.w && sx + 16 > t.x && sy < t.y + t.h && sy + 16 > t.y;
          // 出生点被敌坦占用：直接压杀（仿 FC 原版），否则重生玩家会与其重叠卡死
          for (const e of this.enemies) {
            if (!onSpawn(e)) continue;
            e.alive = false;
            const c = e.center();
            this.explosions.push(new Explosion(c.x, c.y, true));
            this.fxEvents.push({ k: 'ex', x: c.x, y: c.y, big: true });
            this.audio.explodeBig();
          }
          // 另一名玩家占着出生点则稍后重试
          if (this.players.some(onSpawn)) {
            this.respawnTimers[i] = 30;
          } else {
            p.respawn(sx, sy);
            this.audio.respawn();
          }
        }
      }
    }

    // 敌方
    for (const e of this.enemies) e.update(this);
    this.enemies = this.enemies.filter((e) => e.alive);

    // 子弹
    for (const b of this.bullets) b.update(this);
    this._cancelOpposingBullets();
    this.bullets = this.bullets.filter((b) => b.alive);

    // 道具
    for (const p of this.powerups) p.update();
    for (const pl of this.players) {
      if (!pl.alive || pl.spawnTimer > 0) continue;
      for (const p of this.powerups) {
        if (p.alive && p.overlaps(pl)) {
          p.alive = false;
          this._applyPowerup(p, pl);
        }
      }
    }
    this.powerups = this.powerups.filter((p) => p.alive);

    this._updateFx();

    // 过关判定：出击队列清空、场上无敌、至少一人存活
    if (this.spawnQueue.length === 0 && this.enemies.length === 0 &&
        this.players.some((p) => p.alive)) {
      this.state = 'clear';
      this.stateTimer = 120;
      this.audio.victory();
    }
  }

  _updateFx() {
    for (const ex of this.explosions) ex.update();
    this.explosions = this.explosions.filter((e) => e.alive);
    this.particles.update();
    for (const f of this.floatTexts) f.update();
    this.floatTexts = this.floatTexts.filter((f) => f.alive);
    this.shake.update();
  }

  // ---- 敌方生成 ----
  _updateSpawning() {
    if (this.spawnQueue.length === 0) return;
    const active = this.enemies.filter((e) => e.alive).length;
    if (active >= MAX_ON_FIELD) return;
    this.spawnTimer--;
    if (this.spawnTimer > 0) return;

    // 轮换三个出生点，被占用则稍后重试
    for (let i = 0; i < ENEMY_SPAWNS.length; i++) {
      const sp = ENEMY_SPAWNS[(this.spawnPointIdx + i) % ENEMY_SPAWNS.length];
      const x = sp.tx * TILE, y = sp.ty * TILE;
      if (!this.tankBlocked(null, x, y, 16, 16)) {
        const next = this.spawnQueue.shift();
        const enemy = new Enemy(x, y, next.type, next.hasPowerup, this.rand);
        enemy.id = this.nextId++;
        if (this.freezeTimer > 0) enemy.frozen = true; // 冻结期间出生同样被冻结
        this.enemies.push(enemy);
        this.spawnPointIdx = (this.spawnPointIdx + i + 1) % ENEMY_SPAWNS.length;
        this.spawnTimer = 150;
        return;
      }
    }
    this.spawnTimer = 30;
  }

  // ---- 碰撞辅助 ----
  tankBlocked(self, x, y, w, h) {
    const test = (t) =>
      t !== self && t.alive &&
      x < t.x + t.w && x + w > t.x && y < t.y + t.h && y + h > t.y;
    if (this.players.some(test)) return true;
    return this.enemies.some(test);
  }

  // 基地围墙小格是否被存活坦克占用（铁锹恢复墙时避让，防止把坦克嵌进墙里）
  _fortifyCellOccupied(tx, ty) {
    return this.tankBlocked(null, tx * TILE, ty * TILE, TILE, TILE);
  }

  spawnBullet(tank) {
    const b = new Bullet(tank);
    b.id = this.nextId++;
    this.bullets.push(b);
    // 炮口火光
    const m = tank.muzzle();
    this.particles.burst(m.x, m.y, { count: 4, colors: ['#fff8d0', '#ffd870', '#ffb040'], speed: 0.9, life: 7 });
  }

  // 对向子弹互相抵消
  _cancelOpposingBullets() {
    const pb = this.bullets.filter((b) => b.alive && b.isPlayerBullet);
    const eb = this.bullets.filter((b) => b.alive && !b.isPlayerBullet);
    for (const a of pb) {
      for (const b of eb) {
        if (!b.alive) continue;
        if (Math.abs(a.x - b.x) < 4 && Math.abs(a.y - b.y) < 4) {
          a.alive = false; b.alive = false;
          this.explosions.push(new Explosion((a.x + b.x) / 2, (a.y + b.y) / 2, false));
          this.fxEvents.push({ k: 'ex', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, big: false });
          this.audio.hitWall();
          break;
        }
      }
    }
  }

  // ---- 命中处理 ----
  bulletExplode(bullet, big) {
    bullet.alive = false;
    this.explosions.push(new Explosion(bullet.x, bullet.y, big));
    this.fxEvents.push({ k: 'ex', x: bullet.x, y: bullet.y, big });
    this.particles.spark(bullet.x, bullet.y);
  }

  enemyHit(e, bullet) {
    const killed = e.hit(this);
    if (!killed) return;
    // 击杀归属：玩家子弹按射手 slot 记账，其余（流弹）归 P1
    const slot = bullet && bullet.owner && bullet.owner.isPlayer ? bullet.owner.slot : 0;
    const c = e.center();
    this.game.addScore(e.score);
    this.killStats[slot][e.type]++;
    this.floatTexts.push(new FloatText(c.x, c.y, '+' + e.score, SCORE_COLORS[e.type]));
    this.fxEvents.push({ k: 'ft', x: c.x, y: c.y, text: '+' + e.score, color: SCORE_COLORS[e.type] });
    this.explosions.push(new Explosion(c.x, c.y, true));
    this.fxEvents.push({ k: 'ex', x: c.x, y: c.y, big: true });
    this.particles.burst(c.x, c.y);
    this.shake.add(2, 10);
    this.game.engine.addHitstop(3);
    this.audio.explodeBig();
    if (e.hasPowerup) this._dropPowerup();
  }

  playerHit(bullet, p) {
    if (p.shieldTimer > 0) {
      this.particles.spark(bullet.x, bullet.y);
      return;
    }
    const i = p.slot;
    const c = p.center();
    p.die(this);
    this.lives[i]--;
    this.explosions.push(new Explosion(c.x, c.y, true));
    this.fxEvents.push({ k: 'ex', x: c.x, y: c.y, big: true });
    this.particles.burst(c.x, c.y, { count: 18 });
    this.shake.add(4, 25);
    this.game.engine.addHitstop(5);
    this.audio.explodeBig();
    if (this.lives[i] > 0) {
      this.respawnTimers[i] = 70;
    }
    // 所有玩家都阵亡且无余命才判负（一人倒下另一人继续战斗）
    const canContinue = this.players.some(
      (pl, idx) => pl.alive || this.lives[idx] > 0 || this.respawnTimers[idx] > 0
    );
    if (!canContinue) {
      this.state = 'over';
      this.overReason = 'tank';
      this.stateTimer = 160;
      this.audio.gameOver();
    }
  }

  baseDestroyed() {
    if (this.state !== 'playing') return;
    const b = this.tilemap.baseRect();
    const cx = b.x - FIELD_X + b.w / 2, cy = b.y - FIELD_Y + b.h / 2;
    this.explosions.push(new Explosion(cx, cy, true));
    this.fxEvents.push({ k: 'ex', x: cx, y: cy, big: true });
    this.particles.burst(cx, cy, { count: 24, speed: 2.2, life: 45 });
    this.shake.add(5, 45);
    this.game.engine.addHitstop(8);
    this.audio.explodeBig();
    this.audio.gameOver();
    this.state = 'over';
    this.overReason = 'base';
    this.stateTimer = 180;
  }

  // ---- 道具 ----
  _dropPowerup() {
    this.powerups = []; // 场上只保留一个道具（仿原版）
    const type = POWERUP_TYPES[Math.floor(this.rand() * POWERUP_TYPES.length)];
    const pos = this.tilemap.randomEmptySpot(this.rand);
    const pu = new PowerUp(pos.x, pos.y, type);
    pu.id = this.nextId++;
    this.powerups.push(pu);
    this.audio.powerupSpawn();
  }

  _applyPowerup(p, player) {
    const slot = player.slot;
    this.game.addScore(POWERUP_SCORE);
    this.floatTexts.push(new FloatText(p.x + 8, p.y, '+' + POWERUP_SCORE, '#f8c820'));
    this.fxEvents.push({ k: 'ft', x: p.x + 8, y: p.y, text: '+' + POWERUP_SCORE, color: '#f8c820' });
    this.audio.powerupPick();
    switch (p.type) {
      case 'star':
        player.upgrade();
        break;
      case 'helmet':
        player.giveShield();
        break;
      case 'grenade': {
        this.audio.grenade();
        this.shake.add(4, 30);
        for (const e of this.enemies) {
          if (!e.alive) continue;
          e.alive = false;
          this.game.addScore(e.score);
          this.killStats[slot][e.type]++;
          const ec = e.center();
          this.explosions.push(new Explosion(ec.x, ec.y, true));
          this.fxEvents.push({ k: 'ex', x: ec.x, y: ec.y, big: true });
          this.particles.burst(ec.x, ec.y);
        }
        break;
      }
      case 'life':
        this.lives[slot]++;
        this.audio.oneUp();
        break;
      case 'shovel':
        this.shovelTimer = SHOVEL_TIME;
        this.tilemap.fortify(true, (tx, ty) => this._fortifyCellOccupied(tx, ty));
        this.audio.shovel();
        break;
      case 'clock':
        this.freezeTimer = FREEZE_TIME;
        for (const e of this.enemies) e.frozen = true;
        this.audio.freeze();
        break;
    }
  }

  // ---- 渲染 ----
  // 坦克/道具底部的柔和投影，增强立体感
  _shadow(ctx, x, y) {
    ctx.save();
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.ellipse(FIELD_X + x + 8, FIELD_Y + y + 14.2, 6.4, 1.9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  render(ctx) {
    const assets = this.game.assets;
    const off = this.shake.offset();
    this.lastShake = off;
    ctx.save();
    ctx.translate(off.x, off.y);

    this.tilemap.renderGround(ctx, assets, this.game.engine.frame);
    for (const p of this.powerups) if (p.alive) this._shadow(ctx, p.x, p.y);
    for (const p of this.powerups) p.render(ctx, assets, this.game.engine.frame);
    for (const e of this.enemies) if (e.spawnTimer <= 0) this._shadow(ctx, e.x, e.y);
    for (const e of this.enemies) e.render(ctx, assets, this.game.engine.frame);
    for (const pl of this.players) {
      if (pl.alive && pl.spawnTimer <= 0) this._shadow(ctx, pl.x, pl.y);
      pl.render(ctx, assets, this.game.engine.frame);
    }
    for (const b of this.bullets) b.render(ctx, assets);
    for (const ex of this.explosions) ex.render(ctx, assets);
    this.particles.render(ctx);
    this.tilemap.renderGrass(ctx, assets, this.game.engine.frame);

    ctx.restore();

    // 冻结 / 铁锹剩余时间条（战场顶缘）
    if (this.freezeTimer > 0) {
      ctx.fillStyle = '#68d8f0';
      ctx.fillRect(FIELD_X, FIELD_Y - 2, FIELD_SIZE * this.freezeTimer / FREEZE_TIME, 1);
    }
    if (this.shovelTimer > 0) {
      ctx.fillStyle = this.shovelTimer < SHOVEL_BLINK_TIME && (this.game.engine.frame >> 3) % 2 ? '#f04838' : '#c0c0c0';
      ctx.fillRect(FIELD_X, FIELD_Y - 4, FIELD_SIZE * this.shovelTimer / SHOVEL_TIME, 1);
    }
  }

  // 飘字在显示分辨率层绘制（锐利）
  renderText(dctx) {
    for (const f of this.floatTexts) {
      f.render(dctx, this.lastShake.x * 3, this.lastShake.y * 3);
    }
  }
}
