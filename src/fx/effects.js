// 爆炸动画 + 屏幕震动管理
import { FIELD_X, FIELD_Y } from '../core/const.js';
import { blit } from '../core/assets.js';

export class Explosion {
  constructor(x, y, big) {
    this.x = x; // 中心，战场局部坐标
    this.y = y;
    this.big = big;
    this.frame = 0;
    this.alive = true;
  }

  update() {
    this.frame++;
    const total = this.big ? 4 * 5 : 3 * 4; // 每帧动画停留
    if (this.frame >= total) this.alive = false;
  }

  render(ctx, assets) {
    if (this.big) {
      const f = Math.min(3, this.frame / 5 | 0);
      blit(ctx, assets.explBig[f], FIELD_X + this.x - 16, FIELD_Y + this.y - 16);
    } else {
      const f = Math.min(2, this.frame / 4 | 0);
      blit(ctx, assets.explSmall[f], FIELD_X + this.x - 6, FIELD_Y + this.y - 6);
    }
  }
}

// 屏幕震动：返回每帧渲染偏移
export class Shake {
  constructor() { this.t = 0; this.mag = 0; }

  add(mag, frames) {
    if (mag >= this.mag || this.t <= 0) { this.mag = mag; this.t = frames; }
  }

  update() { if (this.t > 0) this.t--; }

  offset() {
    if (this.t <= 0) return { x: 0, y: 0 };
    const m = this.mag * (this.t > 10 ? 1 : this.t / 10);
    return {
      x: Math.round((Math.random() * 2 - 1) * m),
      y: Math.round((Math.random() * 2 - 1) * m),
    };
  }
}
