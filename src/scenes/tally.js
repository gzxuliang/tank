// 过关结算：按敌坦类型逐个跳分统计（仿原版 tally 画面）
import { LOGICAL_W, LOGICAL_H } from '../core/const.js';
import { drawText } from '../core/text.js';
import { blit } from '../core/assets.js';
import { ENEMY_TYPES } from '../game/enemy.js';
import { LEVELS } from '../game/levels.js';
import { IntroScene } from './intro.js';
import { TitleScene } from './title.js';

const ORDER = ['basic', 'fast', 'power', 'armor'];
const NAMES = { basic: '普通', fast: '快速', power: '火力', armor: '装甲' };

export class TallyScene {
  constructor(game, stageIndex, killStats) {
    this.game = game;
    this.stageIndex = stageIndex;
    this.killStats = killStats;
    this.t = 0;
    this.line = 0;          // 当前统计到第几类
    this.shown = [0, 0, 0, 0]; // 各类已显示数量
    this.done = false;
    this.doneTimer = 0;
    this.clearedAll = stageIndex + 1 >= LEVELS.length;
  }

  get total() {
    return ORDER.reduce((s, k) => s + this.killStats[k] * ENEMY_TYPES[k].score, 0);
  }

  update() {
    const input = this.game.input;
    this.t++;
    if (!this.done) {
      // 每 4 帧给当前行 +1，伴随滴答声
      if (this.line < ORDER.length && this.t % 4 === 0) {
        const key = ORDER[this.line];
        if (this.shown[this.line] < this.killStats[key]) {
          this.shown[this.line]++;
          this.game.audio.hitWall();
        } else {
          this.line++;
          if (this.line >= ORDER.length) {
            this.done = true;
            this.game.audio.victory();
          }
        }
      } else if (this.line >= ORDER.length) {
        this.done = true;
      }
    } else {
      this.doneTimer++;
      if (this.doneTimer > 240 || input.pressed('start') || input.pressed('fire')) {
        if (this.clearedAll) {
          this.game.commitHiScore(); // 通关也结算最高分
          this.game.engine.changeScene(new TitleScene(this.game));
        } else {
          this.game.engine.changeScene(new IntroScene(this.game, this.stageIndex + 1));
        }
      }
    }
    input.postUpdate();
  }

  render(ctx) {
    ctx.fillStyle = '#0a0a14';
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    // 展示各型坦克图标
    const A = this.game.assets;
    for (let i = 0; i < ORDER.length; i++) {
      const y = 66 + i * 24;
      blit(ctx, A.tanks[ORDER[i] === 'armor' ? 'armor4' : ORDER[i]][1][0], 56, y - 4);
    }
  }

  renderText(dctx) {
    const cx = LOGICAL_W / 2;
    drawText(dctx, `第 ${this.stageIndex + 1} 关 · 战果`, cx, 26, {
      size: 14, align: 'center', color: '#f8c820', glow: '#a06810',
    });
    if (this.clearedAll && this.done) {
      drawText(dctx, '恭喜通关！', cx, 44, {
        size: 10, align: 'center', color: '#68d8f0', glow: '#2050a0',
      });
    }
    for (let i = 0; i < ORDER.length; i++) {
      const key = ORDER[i];
      const y = 62 + i * 24;
      drawText(dctx, NAMES[key], 84, y, { size: 9, color: '#c0c0c0', shadow: null });
      drawText(dctx, `× ${this.shown[i]}`, 128, y, {
        size: 9, color: '#f0f0f0', align: 'left', shadow: null,
      });
      drawText(dctx, String(this.shown[i] * ENEMY_TYPES[key].score), 196, y, {
        size: 9, color: '#f8c820', align: 'right', shadow: null,
      });
    }
    if (this.done) {
      drawText(dctx, `本关得分  ${this.total}`, cx, 170, {
        size: 10, align: 'center', color: '#f0f0f0',
      });
      if ((this.t >> 5) % 2 === 0) {
        drawText(dctx, this.clearedAll ? 'Enter 返回标题' : 'Enter 进入下一关', cx, 194, {
          size: 7, align: 'center', color: '#888888', shadow: null,
        });
      }
    }
  }
}
