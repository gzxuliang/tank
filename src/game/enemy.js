// 敌方坦克：4 种类型 + AI（随机转向 + 基地倾向 + 自动开火）
import { Tank } from './tank.js';
import { MAP_H, TILE } from '../core/const.js';

export const ENEMY_TYPES = {
  basic: { speed: 0.6, bulletSpeed: 2, hp: 1, score: 100 },
  fast:  { speed: 1.2, bulletSpeed: 2, hp: 1, score: 200 },
  power: { speed: 0.9, bulletSpeed: 4, hp: 1, score: 300 },
  armor: { speed: 0.9, bulletSpeed: 2, hp: 4, score: 400 },
};

export class Enemy extends Tank {
  constructor(x, y, type, hasPowerup, rand) {
    super(x, y, 2); // 出生朝下
    const spec = ENEMY_TYPES[type];
    this.type = type;
    this.speed = spec.speed;
    this.bulletSpeed = spec.bulletSpeed;
    this.hp = spec.hp;
    this.maxHp = spec.hp;
    this.score = spec.score;
    this.hasPowerup = hasPowerup; // 闪光红坦：击毁掉落道具
    this.rand = rand;
    this.spawnTimer = 32;
    this.dirTimer = 0;
    this.fireTimer = 60 + Math.floor(rand() * 80);
    this.maxBullets = 1;
  }

  paletteName() {
    // 道具坦红白闪烁
    if (this.hasPowerup && (Math.floor(this.treadFrame / 4) % 2 === 0)) return 'flash';
    if (this.type === 'armor') return 'armor' + (this.maxHp - this.hp + 1);
    return this.type;
  }

  // AI：倾向朝基地方向推进，定期换向，随机开火
  _pickDir(world) {
    const r = this.rand();
    let d;
    if (r < 0.45) {
      d = 2; // 大倾向：向下（基地方向）
    } else if (r < 0.7) {
      // 朝最近的存活玩家横向对齐
      const p = world.nearestAlivePlayer(this.x, this.y);
      if (p) d = p.x > this.x ? 1 : 3;
      else d = this.rand() < 0.5 ? 1 : 3;
    } else {
      d = Math.floor(this.rand() * 4);
    }
    this.setDir(d, world);
    this.dirTimer = 30 + Math.floor(this.rand() * 90);
  }

  update(world) {
    this.tickTimers();
    if (!this.alive || this.spawnTimer > 0) return;
    if (this.frozen) { this.moving = false; return; }

    this.dirTimer--;
    if (this.dirTimer <= 0) this._pickDir(world);

    const moved = this.tryMove(world);
    if (!moved) {
      // 被挡住：尽快换向
      if (this.dirTimer > 12) this.dirTimer = 12;
    }

    this.fireTimer--;
    if (this.fireTimer <= 0) {
      this.fireTimer = 50 + Math.floor(this.rand() * 120);
      if (this.canFire(world)) {
        world.spawnBullet(this);
        world.audio.shoot();
      }
    }
  }

  // 被玩家子弹命中；dmg 支持炮弹溅射（一次多段伤害）；返回 true 表示被击毁
  hit(world, dmg = 1) {
    this.hp -= dmg;
    if (this.hp <= 0) {
      this.alive = false;
      return true;
    }
    this.hitFlash = 6;
    world.audio.hitTank();
    return false;
  }
}
