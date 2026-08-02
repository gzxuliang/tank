// 标题画面：复古 LOGO、菜单小坦克光标、模式选择、关卡选择、最高分展示
import { LOGICAL_W, LOGICAL_H, LS_STAGE } from '../core/const.js';
import { drawText } from '../core/text.js';
import { blit } from '../core/assets.js';
import { IntroScene } from './intro.js';
import { LobbyScene } from './lobby.js';
import { RankScene } from './rank.js';
import { SettingsScene } from './settings.js';
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
    // 断线等瞬态提示（联网会话结束时写入），展示几秒后消失
    this.notice = game.notice || null;
    game.notice = null;
  }

  enter() {
    if (this.game.audio.ctx) this.game.audio.startBgm('title');
  }

  get items() {
    return [
      '单人游戏',
      '双人游戏',
      '联网对战',
      '排行榜',
      `选择关卡 < 第 ${this.startStage} 关 >`,
      '设置',
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
    if (this.menuIndex === 4) {
      // 选择关卡
      if (input.pressed('left') && this.startStage > 1) { this.startStage--; this.game.audio.hitWall(); }
      if (input.pressed('right') && this.startStage < this.unlocked) { this.startStage++; this.game.audio.hitWall(); }
    }
    if (input.pressed('start') || input.pressed('fire')) {
      this.game.audio.ensure();
      this.game.audio.pause(); // 确认音
      if (this.menuIndex === 2) {
        // 联网对战：进入大厅（创建/加入房间）
        this.game.audio.stopBgm();
        this.game.engine.changeScene(new LobbyScene(this.game));
      } else if (this.menuIndex === 3) {
        // 排行榜
        this.game.audio.stopBgm();
        this.game.engine.changeScene(new RankScene(this.game));
      } else if (this.menuIndex === 5) {
        // 设置（修改用户名）
        this.game.audio.stopBgm();
        this.game.engine.changeScene(new SettingsScene(this.game));
      } else {
        // 单人 / 双人本地开局（在「选择关卡」上确认则按所选关卡以单人开局）
        this.game.mode = this.menuIndex === 1 ? '2p' : '1p';
        if (this.menuIndex === 0 || this.menuIndex === 1) this.startStage = 1;
        this.game.resetRun();
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
    const cursorY = this.menuIndex >= 4 ? 170 + (this.menuIndex - 4) * 12 : 105 + this.menuIndex * 16;
    blit(ctx, A.tanks.player0[1][(this.t >> 3) & 1], 52, cursorY);
    // 主入口与辅助项之间的分隔线
    ctx.fillStyle = '#262640';
    ctx.fillRect(84, 168, 88, 1);
  }

  renderText(dctx) {
    const cx = LOGICAL_W / 2;
    // LOGO
    drawText(dctx, '坦克大战', cx, 36, {
      size: 26, align: 'center', color: '#f8c820', glow: '#c04010', shadow: '#401008',
    });
    drawText(dctx, 'BATTLE  CITY', cx, 68, {
      size: 8, align: 'center', color: '#68d8f0', shadow: null,
    });

    // 最高分
    drawText(dctx, `最高分 ${this.game.hiScore}`, cx, 86, {
      size: 8, align: 'center', color: '#f0f0f0',
    });

    // 断线提示
    if (this.notice && this.t < 300) {
      drawText(dctx, this.notice, cx, 98, {
        size: 7, align: 'center', color: '#f04838', shadow: null,
      });
    }

    // 菜单：主入口（大字号）与辅助项（小字号暗色）分层，避免拥挤
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      const sel = i === this.menuIndex;
      const aux = i >= 4;
      drawText(dctx, items[i], cx, aux ? 174 + (i - 4) * 12 : 108 + i * 16, {
        size: aux ? 8 : 10, align: 'center',
        color: sel ? '#f8c820' : (aux ? '#787888' : '#a0a0a0'),
        glow: sel ? '#a06810' : null,
      });
    }

    // 操作提示（闪烁）：避开底部砖墙/草丛装饰
    if ((this.t >> 5) % 2 === 0) {
      drawText(dctx, '方向键选择 · Enter 确认', cx, 201, {
        size: 7, align: 'center', color: '#888888', shadow: null,
      });
    }
  }
}
