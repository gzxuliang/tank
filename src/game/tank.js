// 坦克基类：移动、网格对齐、履带动画、碰撞、开火
import {
  DIR_DX, DIR_DY, TANK_SIZE, FIELD_X, FIELD_Y, MAP_W, MAP_H, TILE,
} from '../core/const.js';

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
    this.stunTimer = 0;       // 队友误伤定身剩余帧（不能移动/开火）
    this.frozen = false;      // 时钟冻结（敌方）
    this.size = TANK_SIZE;    // 碰撞/绘制尺寸（蘑菇道具可变大）
    this.giant = false;       // 蘑菇变大状态（仅玩家）：撞碎砖块、被击中缩回
    // 火力参数（子类覆盖）
    this.bulletSpeed = 2;
    this.bulletPower = 1;     // 1普通 3破钢
    this.maxBullets = 1;
    this.isPlayer = false;
  }

  get w() { return this.size; }
  get h() { return this.size; }
  rect() { return { x: this.x, y: this.y, w: this.w, h: this.h }; }
  center() { return { x: this.x + this.w / 2, y: this.y + this.h / 2 }; }

  // 转向并对齐到 1/4 格网格（2px，比原版 4px 手感更精细）
  setDir(d, world = null) {
    if (this.dir === d) return;
    this.dir = d;
    const snap = 2;
    const x = d === 0 || d === 2 ? Math.round(this.x / snap) * snap : this.x;
    const y = d === 1 || d === 3 ? Math.round(this.y / snap) * snap : this.y;
    // 对齐本身也可能把坦克挤进邻居，只有落点仍可通行时才更新坐标。
    if (!world || this._canEnter(world, x, y)) {
      this.x = x;
      this.y = y;
    }
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
    // 巨型坦克把砖墙视为可通行（进入后撞碎），钢墙/水面/基地仍然阻挡
    return !world.tilemap.isSolidForTank(x, y, this.w, this.h, this.giant) &&
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
    return this.spawnTimer <= 0 && this.stunTimer <= 0 && this.alive &&
           this.activeBullets(world) < this.maxBullets;
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
    if (this.stunTimer > 0) this.stunTimer--;
  }

  paletteName() { return 'basic'; } // 子类覆盖

  // 按实际尺寸贴图（巨型坦克放大绘制）
  _blitSelf(ctx, img, px, py) {
    ctx.drawImage(img, px, py, this.w, this.h);
  }

  render(ctx, assets, frame) {
    if (!this.alive) return;
    if (this.spawnTimer > 0) {
      // 出生法阵动画
      const f = Math.floor((32 - this.spawnTimer) / 8) % 4;
      this._blitSelf(ctx, assets.spawn[Math.min(3, Math.max(0, f))], FIELD_X + this.x, FIELD_Y + this.y);
      return;
    }
    const sprite = (this.giant && assets.tanksBig ? assets.tanksBig : assets.tanks)[this.paletteName()][this.dir][(this.treadFrame >> 3) & 1];
    const px = FIELD_X + this.x;
    const py = FIELD_Y + this.y;
    if (this.hitFlash > 0) {
      // 受击白闪
      ctx.save();
      try { ctx.filter = 'brightness(3)'; } catch (e) { /* 旧浏览器忽略 */ }
      this._blitSelf(ctx, sprite, px, py);
      ctx.restore();
    } else if (this.stunTimer > 0 && ((this.stunTimer >> 2) & 1)) {
      // 误伤定身：灰暗闪烁提示无法行动
      ctx.save();
      try { ctx.filter = 'saturate(0.2) brightness(1.3)'; } catch (e) { }
      this._blitSelf(ctx, sprite, px, py);
      ctx.restore();
    } else if (this.frozen) {
      // 冻结淡蓝
      ctx.save();
      try { ctx.filter = 'saturate(0.3) brightness(1.4)'; } catch (e) { }
      this._blitSelf(ctx, sprite, px, py);
      ctx.restore();
    } else {
      this._blitSelf(ctx, sprite, px, py);
    }
    // 护盾气泡
    if (this.shieldTimer > 0) {
      this._blitSelf(ctx, assets.shield[(frame >> 3) & 1], px, py);
    }
  }
}
