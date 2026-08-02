// 排行榜：展示服务器共享榜单（每个名字保留最佳成绩），Enter/P 返回标题
import { LOGICAL_W, LOGICAL_H } from '../core/const.js';
import { drawText } from '../core/text.js';
import { TitleScene } from './title.js';
import { fetchTop } from '../net/leaderboard.js';

export class RankScene {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.status = 'loading'; // loading | ok | error
    this.list = [];
  }

  enter() {
    fetchTop(10).then((list) => {
      if (list) { this.list = list; this.status = 'ok'; }
      else this.status = 'error';
    });
  }

  update() {
    const input = this.game.input;
    this.t++;
    if (input.pressed('start') || input.pressed('fire') || input.pressed('pause')) {
      this.game.engine.changeScene(new TitleScene(this.game));
    }
    input.postUpdate();
  }

  render(ctx) {
    // 与标题画面一致的深蓝黑渐变背景
    const grad = ctx.createLinearGradient(0, 0, 0, LOGICAL_H);
    grad.addColorStop(0, '#050510');
    grad.addColorStop(0.7, '#0a0a20');
    grad.addColorStop(1, '#141428');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
  }

  renderText(dctx) {
    const cx = LOGICAL_W / 2;
    drawText(dctx, '排行榜', cx, 24, {
      size: 14, align: 'center', color: '#f8c820', glow: '#a06810',
    });
    if (this.status === 'loading') {
      drawText(dctx, '加载中…', cx, 100, { size: 9, align: 'center', color: '#a0a0a0', shadow: null });
    } else if (this.status === 'error') {
      drawText(dctx, '排行榜不可用', cx, 96, { size: 9, align: 'center', color: '#f04838', shadow: null });
      drawText(dctx, '服务器未开启或网络异常', cx, 112, { size: 7, align: 'center', color: '#888888', shadow: null });
    } else if (this.list.length === 0) {
      drawText(dctx, '还没有成绩，快来抢榜首！', cx, 100, { size: 8, align: 'center', color: '#a0a0a0', shadow: null });
    } else {
      for (let i = 0; i < this.list.length; i++) {
        const e = this.list[i];
        const y = 52 + i * 15;
        const self = e.name === this.game.username;
        const rankColor = i < 3 ? '#f8c820' : '#a0a0a0';
        drawText(dctx, `#${i + 1}`, 40, y, { size: 8, color: rankColor, shadow: null });
        // 名字最长 12 字符，超 9 字省略，防止与分数列重叠
        const name = e.name.length > 9 ? e.name.slice(0, 9) + '…' : e.name;
        drawText(dctx, name, 70, y, { size: 8, color: self ? '#68d8f0' : '#f0f0f0', shadow: null });
        drawText(dctx, String(e.score), 172, y, { size: 8, color: '#f8c820', align: 'right', shadow: null });
        drawText(dctx, e.cleared ? '通关' : `第${e.stage}关`, 182, y, { size: 8, color: '#a0a0a0', shadow: null });
      }
    }
    if ((this.t >> 5) % 2 === 0) {
      drawText(dctx, 'Enter 返回', cx, 205, { size: 7, align: 'center', color: '#888888', shadow: null });
    }
  }
}
