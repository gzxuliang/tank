// 标题画面：复古 LOGO、菜单小坦克光标、关卡选择、最高分展示
import { LOGICAL_W, LOGICAL_H, LS_STAGE } from '../core/const.js';
import { drawText } from '../core/text.js';
import { blit } from '../core/assets.js';
import { IntroScene } from './intro.js';
import { LEVELS } from '../game/levels.js';

export class TitleScene {
  constructor(game) {
    this.game = game;
    this.menuIndex = 0;
    this.t = 0;
    // 已解锁的最高关卡
    this.unlocked = Math.min(
      parseInt(localStorage.getItem(LS_STAGE) || '1', 10) || 1,
      LEVELS.length
    );
    this.startStage = 1;
  }

  enter() {
    if (this.game.audio.ctx) this.game.audio.startBgm('title');
  }

  get items() {
    return [
      '开始游戏',
      `选择关卡 < 第 ${this.startStage} 关 >`,
      `CRT 滤镜：${this.game.crtOn ? '开' : '关'}`,
    ];
  }

  update() {
    const input = this.game.input;
    this.t++;

    if (input.pressed('up')) {
      this.menuIndex = (this.menuIndex + this.items.length - 1) % this.items.length;
      this.game.audio.hitWall();
    }
    if (input.pressed('down')) {
      this.menuIndex = (this.menuIndex + 1) % this.items.length;
      this.game.audio.hitWall();
    }
    if (this.menuIndex === 1) {
      if (input.pressed('left') && this.startStage > 1) { this.startStage--; this.game.audio.hitWall(); }
      if (input.pressed('right') && this.startStage < this.unlocked) { this.startStage++; this.game.audio.hitWall(); }
    }
    if (input.pressed('start') || input.pressed('fire')) {
      this.game.audio.ensure();
      this.game.audio.pause(); // 确认音
      if (this.menuIndex === 2) {
        this.game.toggleCrt();
      } else {
        if (this.menuIndex === 0) this.startStage = 1;
        this.game.score = 0;
        this.game.playerLevel = 0; // 新游戏重置升级与命数
        this.game.lives = 3;
        this.game.audio.stopBgm();
        this.game.engine.changeScene(new IntroScene(this.game, this.startStage - 1));
      }
    }
    input.postUpdate();
  }

  render(ctx) {
    // 深蓝黑渐变背景 + 底部地面
    const grad = ctx.createLinearGradient(0, 0, 0, LOGICAL_H);
    grad.addColorStop(0, '#050510');
    grad.addColorStop(0.7, '#0a0a20');
    grad.addColorStop(1, '#141428');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

    // 装饰：底部砖墙地面
    const A = this.game.assets;
    for (let x = 0; x < LOGICAL_W; x += 8) {
      blit(ctx, A.brick, x, LOGICAL_H - 16);
      blit(ctx, A.brick, x, LOGICAL_H - 8);
    }
    // 装饰坦克：玩家与敌坦对视
    blit(ctx, A.tanks.player3[1][(this.t >> 3) & 1], 40, LOGICAL_H - 34);
    blit(ctx, A.tanks.armor1[3][(this.t >> 3) & 1], LOGICAL_W - 56, LOGICAL_H - 34);
    // 草丛点缀
    for (let x = 80; x < LOGICAL_W - 80; x += 24) {
      blit(ctx, A.grass[(x >> 3) & 1], x, LOGICAL_H - 20);
    }
    // 菜单小坦克光标（履带滚动）
    blit(ctx, A.tanks.player0[1][(this.t >> 3) & 1], 52, 122 + this.menuIndex * 18);
  }

  renderText(dctx) {
    const cx = LOGICAL_W / 2;
    // LOGO
    drawText(dctx, '坦克大战', cx, 42, {
      size: 26, align: 'center', color: '#f8c820', glow: '#c04010', shadow: '#401008',
    });
    drawText(dctx, 'BATTLE  CITY', cx, 74, {
      size: 8, align: 'center', color: '#68d8f0', shadow: null,
    });

    // 最高分
    drawText(dctx, `最高分 ${this.game.hiScore}`, cx, 96, {
      size: 8, align: 'center', color: '#f0f0f0',
    });

    // 菜单
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      const sel = i === this.menuIndex;
      drawText(dctx, items[i], cx, 124 + i * 18, {
        size: 10, align: 'center',
        color: sel ? '#f8c820' : '#a0a0a0',
        glow: sel ? '#a06810' : null,
      });
    }

    // 操作提示（闪烁）
    if ((this.t >> 5) % 2 === 0) {
      drawText(dctx, '方向键选择 · Enter 确认', cx, 196, {
        size: 7, align: 'center', color: '#888888', shadow: null,
      });
    }
  }
}
