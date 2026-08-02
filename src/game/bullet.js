// 子弹：分段步进检测，命中地形/坦克/边界；对向子弹互相抵消在 world 中处理
import { DIR_DX, DIR_DY, BULLET_SIZE, TANK_SIZE, FIELD_X, FIELD_Y, MAP_W, MAP_H, TILE } from '../core/const.js';
import { blit } from '../core/assets.js';

const FIELD_LIMIT = MAP_W * TILE; // 208

export class Bullet {
  constructor(owner) {
    this.owner = owner;
    this.isPlayerBullet = owner.isPlayer;
    this.dir = owner.dir;
    this.speed = owner.bulletSpeed * (owner.giant ? 1.6 : 1); // 巨型射导弹：飞行更快
    this.power = owner.bulletPower;
    this.big = !!owner.giant; // 巨型坦克射导弹（更大弹体、命中范围与爆炸威力）
    const m = owner.muzzle();
    this.x = m.x; // 中心点，战场局部坐标
    this.y = m.y;
    this.alive = true;
  }

  // 弹体碰撞尺寸（导弹更大）
  get size() { return this.big ? 6 : BULLET_SIZE; }

  // 命中判定矩形：沿飞行方向一个弹体，垂直方向条带（普通 8px / 导弹 12px，破坏砖墙的范围）
  hitRect() {
    const s = this.size / 2;
    const wide = this.big ? 12 : 8;
    if (this.dir === 0 || this.dir === 2) {
      return { x: this.x - wide / 2, y: this.y - s, w: wide, h: this.size };
    }
    return { x: this.x - s, y: this.y - wide / 2, w: this.size, h: wide };
  }

  update(world) {
    this.ageFrames = (this.ageFrames || 0) + 1;
    // 分段步进，防止高速穿透
    const steps = Math.ceil(this.speed);
    for (let i = 0; i < steps && this.alive; i++) {
      this.x += DIR_DX[this.dir] * (this.speed / steps);
      this.y += DIR_DY[this.dir] * (this.speed / steps);
      this._collide(world);
    }
  }

  _collide(world) {
    // 出界
    if (this.x < 0 || this.x > FIELD_LIMIT || this.y < 0 || this.y > FIELD_LIMIT) {
      this.x = Math.max(0, Math.min(FIELD_LIMIT, this.x));
      this.y = Math.max(0, Math.min(FIELD_LIMIT, this.y));
      if (this.big) world.shellBlast(this); else world.bulletExplode(this, false);
      return;
    }
    // 地形
    const r = this.hitRect();
    const hit = world.tilemap.bulletHit(r.x, r.y, r.w, r.h, this.power);
    if (hit.result === 'base') {
      // 导弹命中基地：爆炸范围与基地损毁一并结算
      if (this.big) world.shellBlast(this);
      else world.bulletExplode(this, true);
      world.baseDestroyed();
      return;
    }
    if (hit.result === 'brick' || hit.result === 'steel') {
      if (this.big) world.shellBlast(this); // 导弹炸开一片
      else {
        if (hit.result === 'steel') world.audio.hitSteel(); else world.audio.hitWall();
        world.bulletExplode(this, false);
      }
      return;
    }
    // 坦克
    if (this.isPlayerBullet) {
      // 联网玩家子弹按“开火时看到的帧 + 已飞行帧数”查询敌人历史位置。
      // 这样历史时间会随子弹飞行推进，不会永远停在开火瞬间。
      const backFrame = typeof this.rewindStartHf === 'number'
        ? this.rewindStartHf + (this.ageFrames || 0)
        : null;
      for (const e of world.enemies) {
        if (!e.alive || e.spawnTimer > 0) continue;
        let ox = e.x, oy = e.y;
        if (backFrame !== null) {
          const hp = world.enemyPosAt(backFrame, e.id);
          if (hp) { ox = hp.x; oy = hp.y; } // 历史缺失时回退当前
        }
        if (this._overlapsAt(ox, oy)) {
          if (this.big) {
            world.enemyHit(e, this, 2); // 导弹直击 2 点伤害
            world.shellBlast(this);
          } else {
            world.bulletExplode(this, false);
            world.enemyHit(e, this);
          }
          return;
        }
      }
      // 合作模式同样需要阻挡队友子弹；只排除发射者自身，命中规则仍完全由服务端执行。
      for (const p of world.players) {
        if (p === this.owner || p.id === this.ownerId || !p.alive || p.spawnTimer > 0) continue;
        if (this._overlaps(p)) {
          world.bulletExplode(this, false);
          world.playerHit(this, p);
          return;
        }
      }
    } else {
      for (const p of world.players) {
        if (!p.alive || p.spawnTimer > 0) continue;
        if (this._overlaps(p)) {
          world.bulletExplode(this, false);
          world.playerHit(this, p);
          return;
        }
      }
    }
  }

  _overlaps(t) {
    return this._overlapsAt(t.x, t.y, t.w);
  }

  // size：目标碰撞边长（巨型玩家坦克更大；敌坦走默认 TANK_SIZE）
  _overlapsAt(x, y, size = TANK_SIZE) {
    const s = this.size / 2;
    return this.x + s > x && this.x - s < x + size &&
           this.y + s > y && this.y - s < y + size;
  }

  render(ctx, assets) {
    // 巨型坦克的导弹：方向感弹体（尾焰朝后）
    if (this.big) { blit(ctx, assets.missile[this.dir], FIELD_X + this.x - 6, FIELD_Y + this.y - 6); return; }
    blit(ctx, assets.bullet, FIELD_X + this.x - 3, FIELD_Y + this.y - 3);
  }
}
