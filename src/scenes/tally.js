// 过关结算：按敌坦类型逐个跳分统计（仿原版 tally 画面）
// 双人模式：击杀数按 P1/P2 分列统计
import { LOGICAL_W, LOGICAL_H } from '../core/const.js';
import { drawText } from '../core/text.js';
import { blit } from '../core/assets.js';
import { ENEMY_TYPES } from '../game/enemy.js';
import { LEVELS } from '../game/levels.js';
import { IntroScene } from './intro.js';
import { TitleScene } from './title.js';
import { submitScore } from '../net/leaderboard.js';

const ORDER = ['basic', 'fast', 'power', 'armor'];
const NAMES = { basic: '普通', fast: '快速', power: '火力', armor: '装甲' };

export class TallyScene {
  // killStats：按玩家分列的击毁数组 [{basic,fast,power,armor}, ...]
  constructor(game, stageIndex, killStats) {
    this.game = game;
    this.stageIndex = stageIndex;
    this.perPlayer = Array.isArray(killStats) ? killStats : [killStats];
    this.twoPlayer = this.perPlayer.length > 1;
    // 跳分动画按两人合计数驱动
    this.combined = {};
    for (const k of ORDER) {
      this.combined[k] = this.perPlayer.reduce((s, ks) => s + ks[k], 0);
    }
    this.t = 0;
    this.line = 0;          // 当前统计到第几类
    this.shown = [0, 0, 0, 0]; // 各类已显示数量
    this.done = false;
    this.doneTimer = 0;
    this.clearedAll = stageIndex + 1 >= LEVELS.length;
    this.retryAt = 0;
    // 通关同样上传排行榜（普通失败在 GameOverScene 上传）
    if (this.clearedAll && game.score > 0) {
      submitScore({ name: game.username, score: game.score, stage: LEVELS.length, mode: game.mode, cleared: true });
    }
  }

  get total() {
    return ORDER.reduce((s, k) => s + this.combined[k] * ENEMY_TYPES[k].score, 0);
  }

  playerTotal(i) {
    return ORDER.reduce((s, k) => s + this.perPlayer[i][k] * ENEMY_TYPES[k].score, 0);
  }

  update() {
    const input = this.game.input;
    this.t++;
    if (!this.done) {
      // 每 4 帧给当前行 +1，伴随滴答声
      if (this.line < ORDER.length && this.t % 4 === 0) {
        const key = ORDER[this.line];
        if (this.shown[this.line] < this.combined[key]) {
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
        if (this.game.net) {
          // 与结束画面一样按服务端确认重发，断线恢复后不会卡在结算画面
          if (!this.game.net.isReady() && this.t >= this.retryAt) {
            this.game.net.ready();
            this.retryAt = this.t + 30;
          }
        } else if (this.clearedAll) {
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
    // 展示各型坦克图标（与 renderText 的行 y 对齐：文字中心 y+4.5 ≈ 图标中心 y+5）
    const A = this.game.assets;
    for (let i = 0; i < ORDER.length; i++) {
      const y = 62 + i * 24;
      blit(ctx, A.tanks[ORDER[i] === 'armor' ? 'armor4' : ORDER[i]][1][0], 40, y - 3);
    }
  }

  renderText(dctx) {
    const cx = LOGICAL_W / 2;
    drawText(dctx, `第 ${this.stageIndex + 1} 关 · 战果`, cx, 18, {
      size: 14, align: 'center', color: '#f8c820', glow: '#a06810',
    });
    if (this.clearedAll && this.done) {
      drawText(dctx, '恭喜通关！', cx, 38, {
        size: 10, align: 'center', color: '#68d8f0', glow: '#2050a0',
      });
    }
    // 双人：表头
    if (this.twoPlayer) {
      drawText(dctx, 'P1', 116, 48, { size: 8, color: '#f8c820', shadow: null });
      drawText(dctx, 'P2', 148, 48, { size: 8, color: '#68d858', shadow: null });
    }
    for (let i = 0; i < ORDER.length; i++) {
      const key = ORDER[i];
      const y = 62 + i * 24;
      drawText(dctx, NAMES[key], 68, y, { size: 9, color: '#c0c0c0', shadow: null });
      if (this.twoPlayer) {
        // 分列显示各自击毁（按合计进度揭示）
        const p1 = Math.min(this.perPlayer[0][key], this.shown[i]);
        const p2 = Math.min(this.perPlayer[1][key], this.shown[i] - p1);
        drawText(dctx, `×${p1}`, 124, y, { size: 9, color: '#f8c820', align: 'right', shadow: null });
        drawText(dctx, `×${p2}`, 156, y, { size: 9, color: '#68d858', align: 'right', shadow: null });
      } else {
        drawText(dctx, `× ${this.shown[i]}`, 128, y, {
          size: 9, color: '#f0f0f0', align: 'left', shadow: null,
        });
      }
      drawText(dctx, String(this.shown[i] * ENEMY_TYPES[key].score), 210, y, {
        size: 9, color: '#f8c820', align: 'right', shadow: null,
      });
    }
    if (this.done) {
      if (this.twoPlayer) {
        drawText(dctx, `P1 得分 ${this.playerTotal(0)}   P2 得分 ${this.playerTotal(1)}`, cx, 162, {
          size: 8, align: 'center', color: '#f0f0f0', shadow: null,
        });
        drawText(dctx, `本关合计  ${this.total}`, cx, 176, {
          size: 10, align: 'center', color: '#f8c820',
        });
      } else {
        drawText(dctx, `本关得分  ${this.total}`, cx, 170, {
          size: 10, align: 'center', color: '#f0f0f0',
        });
      }
      if ((this.t >> 5) % 2 === 0) {
        drawText(dctx, this.clearedAll ? 'Enter 返回标题' : 'Enter 进入下一关', cx, 198, {
          size: 7, align: 'center', color: '#888888', shadow: null,
        });
      }
    }
  }
}
