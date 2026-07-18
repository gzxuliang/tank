// 道具：生成、闪烁、拾取效果（⭐升级 🛡无敌 💣清屏 🚜加命 🔧钢墙 ⏱冻结）
import { POWERUP_LIFE, FIELD_X, FIELD_Y } from '../core/const.js';
import { blit } from '../core/assets.js';

export const POWERUP_TYPES = ['star', 'helmet', 'grenade', 'life', 'shovel', 'clock'];

export class PowerUp {
  constructor(x, y, type) {
    this.x = x; // 战场局部坐标（16×16）
    this.y = y;
    this.type = type;
    this.timer = POWERUP_LIFE;
    this.alive = true;
  }

  update() {
    this.timer--;
    if (this.timer <= 0) this.alive = false;
  }

  overlaps(t) {
    return this.x < t.x + t.w && this.x + 16 > t.x &&
           this.y < t.y + t.h && this.y + 16 > t.y;
  }

  render(ctx, assets, frame) {
    // 即将消失时闪烁
    if (this.timer < 180 && (frame >> 3) % 2 === 0) return;
    blit(ctx, assets.powerups[this.type], FIELD_X + this.x, FIELD_Y + this.y);
  }
}
