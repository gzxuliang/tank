// 战斗场景：世界编排 + HUD + 暂停 + 幕帘转场
import {
  LOGICAL_W, LOGICAL_H, HUD_X, FIELD_X, FIELD_Y, FIELD_SIZE,
} from '../core/const.js';
import { drawText } from '../core/text.js';
import { blit, createLayer } from '../core/assets.js';
import { World } from '../game/world.js';
import { TallyScene } from './tally.js';
import { GameOverScene } from './gameover.js';

// 静态背景离屏缓存：边框渐变、战场底色、微网格、HUD 面板只画一次
let bgCache = null;
function getBackground() {
  if (bgCache) return bgCache;
  const [c, g] = createLayer(LOGICAL_W, LOGICAL_H);

  // 现代深色边框（纵向渐变）
  const bg = g.createLinearGradient(0, 0, 0, LOGICAL_H);
  bg.addColorStop(0, '#3d4454');
  bg.addColorStop(1, '#222734');
  g.fillStyle = bg;
  g.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  // 战场：径向渐变的深蓝黑底 + 微网格 + 细描边
  const fx = FIELD_X, fy = FIELD_Y, fs = FIELD_SIZE;
  const fg = g.createRadialGradient(fx + fs / 2, fy + fs / 2, 24, fx + fs / 2, fy + fs / 2, fs * 0.72);
  fg.addColorStop(0, '#151b26');
  fg.addColorStop(1, '#090c12');
  g.fillStyle = fg;
  g.fillRect(fx, fy, fs, fs);
  g.strokeStyle = 'rgba(255,255,255,0.035)';
  g.lineWidth = 0.4;
  g.beginPath();
  for (let i = 1; i < 13; i++) {
    g.moveTo(fx + i * 16, fy); g.lineTo(fx + i * 16, fy + fs);
    g.moveTo(fx, fy + i * 16); g.lineTo(fx + fs, fy + i * 16);
  }
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.09)';
  g.lineWidth = 0.8;
  g.strokeRect(fx - 0.4, fy - 0.4, fs + 0.8, fs + 0.8);

  // HUD 面板
  g.fillStyle = 'rgba(13,17,24,0.75)';
  g.beginPath();
  g.roundRect(HUD_X - 5, 5, LOGICAL_W - HUD_X + 1, LOGICAL_H - 10, 3);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.lineWidth = 0.6;
  g.stroke();

  bgCache = c;
  return c;
}

export class GameScene {
  constructor(game, stageIndex, curtainFrames = 0) {
    this.game = game;
    this.stageIndex = stageIndex;
    this.curtain = curtainFrames; // 剩余幕帘开启帧数
    this.paused = false;
    this.world = null;
  }

  enter() {
    this.world = new World(this.game, this.stageIndex);
  }

  update() {
    const input = this.game.input;

    if (this.curtain > 0) {
      this.curtain--;
      input.postUpdate();
      return;
    }

    if (input.pressed('pause')) {
      this.paused = !this.paused;
      this.game.audio.pause();
    }
    if (this.paused) { input.postUpdate(); return; }

    this.world.update(input);
    input.postUpdate();

    // 场景流转
    if (this.world.state === 'clear' && this.world.stateTimer <= 0) {
      // 跨关保留升级与命数
      this.game.playerLevel = this.world.player.level;
      this.game.lives = this.world.lives;
      this.game.unlockStage(this.stageIndex + 2);
      this.game.engine.changeScene(new TallyScene(this.game, this.stageIndex, this.world.killStats));
    } else if (this.world.state === 'over' && this.world.stateTimer <= 0) {
      this.game.engine.changeScene(new GameOverScene(this.game, this.stageIndex, this.world.overReason));
    }
  }

  render(ctx) {
    // 静态背景（离屏缓存，一帧一次贴图）
    ctx.drawImage(getBackground(), 0, 0, LOGICAL_W, LOGICAL_H);

    this.world.render(ctx);

    // ---- HUD：剩余敌坦图标 ----
    const A = this.game.assets;
    const remaining = this.world.spawnQueue.length;
    for (let i = 0; i < remaining; i++) {
      const col = i % 2, row = Math.floor(i / 2);
      blit(ctx, A.enemyIcon, HUD_X + 2 + col * 10, 62 + row * 10);
    }
    // 玩家命数图标
    blit(ctx, A.lifeIcon, HUD_X + 2, 172);
    // 关卡旗帜
    blit(ctx, A.flagIcon, HUD_X + 2, 196);

    // 暂停遮罩
    if (this.paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(FIELD_X, FIELD_Y, FIELD_SIZE, FIELD_SIZE);
    }

    // 幕帘开启动画
    if (this.curtain > 0) {
      const p = this.curtain / 20;
      const h = Math.round((LOGICAL_H / 2) * p);
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, LOGICAL_W, h);
      ctx.fillRect(0, LOGICAL_H - h, LOGICAL_W, h);
    }
  }

  renderText(dctx) {
    const w = this.world;
    // 分数区
    drawText(dctx, '得分', HUD_X, 8, { size: 7, color: '#e8e8e8', shadow: null });
    drawText(dctx, String(this.game.score).padStart(6, '0'), HUD_X + 24, 20, {
      size: 8, color: '#f8c820', align: 'right', shadow: null,
    });
    drawText(dctx, '最高', HUD_X, 38, { size: 7, color: '#e8e8e8', shadow: null });
    drawText(dctx, String(this.game.hiScore).padStart(6, '0'), HUD_X + 24, 50, {
      size: 8, color: '#f0f0f0', align: 'right', shadow: null,
    });

    // 命数与关卡号
    drawText(dctx, '×' + Math.max(0, w.lives - 1), HUD_X + 12, 172, {
      size: 8, color: '#f0f0f0', shadow: null,
    });
    drawText(dctx, String(this.stageIndex + 1), HUD_X + 12, 196, {
      size: 8, color: '#f0f0f0', shadow: null,
    });

    // 飘字
    w.renderText(dctx);

    if (this.paused) {
      drawText(dctx, '暂 停', FIELD_X + FIELD_SIZE / 2, FIELD_Y + FIELD_SIZE / 2 - 10, {
        size: 14, align: 'center', color: '#f8c820', glow: '#a06810',
      });
      drawText(dctx, '按 P 继续', FIELD_X + FIELD_SIZE / 2, FIELD_Y + FIELD_SIZE / 2 + 12, {
        size: 7, align: 'center', color: '#c0c0c0', shadow: null,
      });
    }
  }
}
