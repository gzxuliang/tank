// 坦克基类：移动、网格对齐、履带动画、碰撞、开火
import {
  DIR_DX, DIR_DY, TANK_SIZE, FIELD_X, FIELD_Y, MAP_W, MAP_H, TILE,
} from '../core/const.js';
import { blit } from '../core/assets.js';

export class Tank {
  constructor(x, y, dir) {
    this.x = x;               // 战场局部坐标（像素，左上）
    this.y = y;
    this.dir = dir;
    this.speed = 1;
    this.alive = true;
    this.moving = false;
    this.treadFrame = 0;      // 履带动画帧
    this.spawnTimer = 0;      // 出生动画剩余帧（期间无敌且不能行动）
    this.shieldTimer = 0;     // 护盾剩余帧
    this.hitFlash = 0;        // 受击白闪
    this.frozen = false;      // 时钟冻结（敌方）
    // 火力参数（子类覆盖）
    this.bulletSpeed = 2;
    this.bulletPower = 1;     // 1普通 3破钢
    this.maxBullets = 1;
    this.isPlayer = false;
  }

  get w() { return TANK_SIZE; }
  get h() { return TANK_SIZE; }
  rect() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
  center() { return { x: this.x + this.w / 2, y: this.y + this.h / 2 }; }

  // 转向并对齐到 1/4 格网格（2px，比原版 4px 手感更精细）
  setDir(d) {
    if (this.dir === d) return;
    this.dir = d;
    const snap = 2;
    if (d === 0 || d === 2) this.x = Math.round(this.x / snap) * snap;
    else this.y = Math.round(this.y / snap) * snap;
  }

  // 尝试沿当前方向移动一帧；被阻挡返回 false
  tryMove(world) {
    const dx = DIR_DX[this.dir], dy = DIR_DY[this.dir];
    const nx = this.x + dx * this.speed;
    const ny = this.y + dy * this.speed;
    if (this._canEnter(world, nx, ny)) return this._applyMove(nx, ny);
    // 拐角辅助：直进被挡时，沿垂直方向微调最多 4px，自动引导进狭窄缺口
    for (const off of [1, -1, 2, -2, 3, -3, 4, -4]) {
      const ox = nx + dy * off; // (dy, dx) 即移动方向的垂直单位向量
      const oy = ny + dx * off;
      if (this._canEnter(world, ox, oy)) return this._applyMove(ox, oy);
    }
    this.moving = false;
    return false;
  }

  _canEnter(world, x, y) {
    return !world.tilemap.isSolidForTank(x, y, this.w, this.h) &&
           !world.tankBlocked(this, x, y, this.w, this.h);
  }

  _applyMove(x, y) {
    this.x = x; this.y = y;
    this.moving = true;
    this.treadFrame++;
    return true;
  }

  activeBullets(world) {
    let n = 0;
    for (const b of world.bullets) if (b.alive && b.owner === this) n++;
    return n;
  }

  canFire(world) {
    return this.spawnTimer <= 0 && this.alive && this.activeBullets(world) < this.maxBullets;
  }

  muzzle() {
    const c = this.center();
    return {
      x: c.x + DIR_DX[this.dir] * (this.w / 2),
      y: c.y + DIR_DY[this.dir] * (this.h / 2),
    };
  }

  tickTimers() {
    if (this.spawnTimer > 0) this.spawnTimer--;
    if (this.shieldTimer > 0) this.shieldTimer--;
    if (this.hitFlash > 0) this.hitFlash--;
  }

  paletteName() { return 'basic'; } // 子类覆盖

  render(ctx, assets, frame) {
    if (this.spawnTimer > 0) {
      // 出生法阵动画
      const f = Math.floor((32 - this.spawnTimer) / 8) % 4;
      blit(ctx, assets.spawn[Math.min(3, Math.max(0, f))], FIELD_X + this.x, FIELD_Y + this.y);
      return;
    }
    const sprite = assets.tanks[this.paletteName()][this.dir][(this.treadFrame >> 3) & 1];
    // 联网客机的纠偏残差只影响画面，不污染移动和碰撞使用的权威坐标。
    const px = FIELD_X + this.x + (this._visualOffsetX || 0);
    const py = FIELD_Y + this.y + (this._visualOffsetY || 0);
    if (this.hitFlash > 0) {
      // 受击白闪
      ctx.save();
      try { ctx.filter = 'brightness(3)'; } catch (e) { /* 旧浏览器忽略 */ }
      blit(ctx, sprite, px, py);
      ctx.restore();
    } else if (this.frozen) {
      // 冻结淡蓝
      ctx.save();
      try { ctx.filter = 'saturate(0.3) brightness(1.4)'; } catch (e) { }
      blit(ctx, sprite, px, py);
      ctx.restore();
    } else {
      blit(ctx, sprite, px, py);
    }
    // 护盾气泡
    if (this.shieldTimer > 0) {
      blit(ctx, assets.shield[(frame >> 3) & 1], px, py);
    }
  }
}
