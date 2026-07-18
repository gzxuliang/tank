// 游戏结束：GAME OVER 演出、新纪录提示、返回标题
import { LOGICAL_W, LOGICAL_H } from '../core/const.js';
import { drawText } from '../core/text.js';
import { blit } from '../core/assets.js';
import { TitleScene } from './title.js';

export class GameOverScene {
  constructor(game, stageIndex, reason) {
    this.game = game;
    this.stageIndex = stageIndex;
    this.reason = reason; // 'tank' | 'base'
    this.t = 0;
    this.newRecord = game.commitHiScore();
  }

  update() {
    const input = this.game.input;
    this.t++;
    if (this.t > 40 && (input.pressed('start') || input.pressed('fire'))) {
      this.game.engine.changeScene(new TitleScene(this.game));
    }
    // 超时自动返回标题
    if (this.t > 60 * 12) {
      this.game.engine.changeScene(new TitleScene(this.game));
    }
    input.postUpdate();
  }

  render(ctx) {
    ctx.fillStyle = '#0a0508';
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    // 基地被毁：展示残骸
    if (this.reason === 'base') {
      blit(ctx, this.game.assets.baseDead, LOGICAL_W / 2 - 8, 118);
    }
  }

  renderText(dctx) {
    const cx = LOGICAL_W / 2;
    // GAME OVER 下落动画
    const p = Math.min(1, this.t / 30);
    const y = -20 + (70 + 20) * (p * p); // 加速落下
    drawText(dctx, 'GAME OVER', cx, y, {
      size: 22, align: 'center', color: '#f04838', glow: '#801010', shadow: '#400808',
    });
    if (this.t > 34) {
      drawText(dctx, this.reason === 'base' ? '基地被摧毁！' : '坦克全灭！', cx, 100, {
        size: 9, align: 'center', color: '#c0c0c0', shadow: null,
      });
      drawText(dctx, `得分 ${this.game.score}   到达第 ${this.stageIndex + 1} 关`, cx, 146, {
        size: 8, align: 'center', color: '#f0f0f0', shadow: null,
      });
      if (this.newRecord && (this.t >> 4) % 2 === 0) {
        drawText(dctx, '★ 新纪录 ★', cx, 164, {
          size: 10, align: 'center', color: '#f8c820', glow: '#a06810', shadow: null,
        });
      }
      if (this.t > 60 && (this.t >> 5) % 2 === 0) {
        drawText(dctx, 'Enter 返回标题', cx, 194, {
          size: 7, align: 'center', color: '#888888', shadow: null,
        });
      }
    }
  }
}
