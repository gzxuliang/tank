// 粒子系统：爆炸碎片、火花、烟雾
import { FIELD_X, FIELD_Y } from '../core/const.js';

export class ParticleSystem {
  constructor() { this.list = []; }

  // 爆炸碎片
  burst(x, y, { count = 12, colors = ['#f8c820', '#f08020', '#c04020', '#fff8d0'], speed = 1.6, life = 30 } = {}) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.8);
      this.list.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 0.3,
        life: life * (0.6 + Math.random() * 0.6),
        maxLife: life,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: Math.random() < 0.3 ? 2 : 1,
      });
    }
  }

  // 火花（子弹命中）
  spark(x, y) {
    this.burst(x, y, { count: 5, colors: ['#ffffff', '#f8f0a0'], speed: 1.1, life: 12 });
  }

  update() {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.x += p.vx; p.y += p.vy;
      p.vy += 0.05; // 微重力
      p.life--;
      if (p.life <= 0) this.list.splice(i, 1);
    }
  }

  render(ctx) {
    ctx.save();
    // 叠加发光：火花/碎片互相增亮，更有能量感
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.list) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(FIELD_X + p.x, FIELD_Y + p.y, p.size * 0.75, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
