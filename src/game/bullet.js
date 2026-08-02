// 子弹：分段步进检测，命中地形/坦克/边界；对向子弹互相抵消在 world 中处理
import { DIR_DX, DIR_DY, BULLET_SIZE, TANK_SIZE, FIELD_X, FIELD_Y, MAP_W, MAP_H, TILE } from '../core/const.js';
import { blit } from '../core/assets.js';

const FIELD_LIMIT = MAP_W * TILE; // 208

export class Bullet {
  constructor(owner) {
    this.owner = owner;
    this.isPlayerBullet = owner.isPlayer;
    this.dir = owner.dir;
    this.speed = owner.bulletSpeed;
    this.power = owner.bulletPower;
    const m = owner.muzzle();
    this.x = m.x; // 中心点，战场局部坐标
    this.y = m.y;
    this.alive = true;
  }

  // 命中判定矩形：沿飞行方向 4px，垂直方向 8px（破坏砖墙的条带宽度）
  hitRect() {
    const s = BULLET_SIZE / 2;
    if (this.dir === 0 || this.dir === 2) {
      return { x: this.x - 4, y: this.y - s, w: 8, h: BULLET_SIZE };
    }
    return { x: this.x - s, y: this.y - 4, w: BULLET_SIZE, h: 8 };
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
      world.bulletExplode(this, false);
      return;
    }
    // 地形
    const r = this.hitRect();
    const hit = world.tilemap.bulletHit(r.x, r.y, r.w, r.h, this.power);
    if (hit.result === 'base') {
      world.bulletExplode(this, true);
      world.baseDestroyed();
      return;
    }
    if (hit.result === 'brick') {
      world.audio.hitWall();
      world.bulletExplode(this, false);
      return;
    }
    if (hit.result === 'steel') {
      world.audio.hitSteel();
      world.bulletExplode(this, false);
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
          world.bulletExplode(this, false);
          world.enemyHit(e, this);
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
    return this._overlapsAt(t.x, t.y);
  }

  _overlapsAt(x, y) {
    const s = BULLET_SIZE / 2;
    return this.x + s > x && this.x - s < x + TANK_SIZE &&
           this.y + s > y && this.y - s < y + TANK_SIZE;
  }

  render(ctx, assets) {
    blit(ctx, assets.bullet, FIELD_X + this.x - 3, FIELD_Y + this.y - 3);
  }
}
