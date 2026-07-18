// 玩家坦克：方向键控制、三级升级、冰面打滑、护盾复活
import { Tank } from './tank.js';
import { SHIELD_TIME, SPAWN_SHIELD_TIME } from '../core/const.js';

export class Player extends Tank {
  constructor(x, y) {
    super(x, y, 0);
    this.isPlayer = true;
    this.speed = 1.3;
    this.level = 0;          // 0初始 1快弹 2双弹 3破钢
    this.spawnTimer = 32;    // 出生动画
    this.shieldTimer = SPAWN_SHIELD_TIME;
    this.slideTimer = 0;     // 冰面滑行剩余帧
    this.slideDir = 0;
    this._applyLevel();
  }

  _applyLevel() {
    this.bulletSpeed = this.level >= 1 ? 4 : 2.4;
    this.maxBullets = this.level >= 2 ? 2 : 1;
    this.bulletPower = this.level >= 3 ? 3 : 1;
  }

  upgrade() {
    if (this.level < 3) {
      this.level++;
      this._applyLevel();
      return true;
    }
    return false;
  }

  giveShield(frames = SHIELD_TIME) { this.shieldTimer = frames; }

  paletteName() { return 'player' + this.level; }

  update(world, input) {
    this.tickTimers();
    if (!this.alive || this.spawnTimer > 0) return;

    const d = input.dirHeld();
    if (d >= 0) {
      this.setDir(d);
      this.tryMove(world);
      this.slideTimer = 0;
      // 记录冰面滑行方向
      if (world.tilemap.onIce(this.x, this.y, this.w, this.h)) {
        this.slideTimer = 8;
        this.slideDir = d;
      }
    } else {
      this.moving = false;
      // 冰面打滑：松开后继续滑一小段
      if (this.slideTimer > 0) {
        this.slideTimer--;
        this.setDir(this.slideDir);
        const bak = this.speed;
        this.speed = bak * 0.7;
        this.tryMove(world);
        this.speed = bak;
      }
    }

    if (input.pressed('fire') && this.canFire(world)) {
      world.spawnBullet(this);
      world.audio.shoot();
    }
  }

  die(world) {
    this.alive = false;
    this.level = 0;
    this._applyLevel();
  }

  // 复活
  respawn(x, y) {
    this.x = x; this.y = y;
    this.dir = 0;
    this.alive = true;
    this.spawnTimer = 32;
    this.shieldTimer = SPAWN_SHIELD_TIME;
    this.treadFrame = 0;
  }
}
