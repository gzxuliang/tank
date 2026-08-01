// 战斗场景：世界编排 + HUD + 暂停 + 幕帘转场
// 单人/本地双人：直接驱动 World；联网模式由 net/session.js 接管输入与快照
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

  // HUD 面板（比内容略宽，保证 6 位数字与图标都在框内）
  g.fillStyle = 'rgba(13,17,24,0.75)';
  g.beginPath();
  g.roundRect(HUD_X - 6, 5, LOGICAL_W - HUD_X + 5, LOGICAL_H - 10, 3);
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
    this.session = null; // 联网会话（NetHostSession / NetClientSession），本地模式为 null
  }

  enter() {
    this.world = new World(this.game, this.stageIndex);
    // 联网模式：让会话接管世界（主机驱动输入与广播，客机改为镜像渲染）
    if (this.game.net) {
      this.session = this.game.net.createGameSession(this);
    }
  }

  // 引擎顿帧期间调用：主机仍需广播快照（帧号推进），保证客机插值缓冲不断流
  onHitstop() {
    if (this.session && this.session.isHost) this.session.onHitstop();
  }

  update() {
    const input = this.game.input;

    if (this.curtain > 0) {
      this.curtain--;
      input.postUpdate();
      this.game.inputs[1].postUpdate();
      return;
    }

    // 暂停：本地模式与联网主机可暂停；客机的 paused 仅作遮罩显示（由快照驱动）
    const canPause = !this.session || this.session.isHost;
    if (input.pressed('pause') && canPause) {
      this.paused = !this.paused;
      this.game.audio.pause();
    }
    if (this.paused && canPause) {
      input.postUpdate();
      if (this.session) this.session.updatePaused(); // 通知客机同步暂停遮罩
      return;
    }

    if (this.session) {
      // 联网：主机跑权威逻辑 + 广播快照；客机发输入 + 应用快照
      this.session.update();
    } else {
      this.world.update(this.game.inputs.slice(0, this.world.playerCount));
    }
    input.postUpdate();
    this.game.inputs[1].postUpdate();

    // 场景流转
    if (this.world.state === 'clear' && this.world.stateTimer <= 0) {
      // 跨关保留升级与命数（按玩家）
      this.game.playerLevels = this.world.players.map((p) => p.level);
      this.game.lives = [...this.world.lives];
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

    // ---- HUD：剩余敌坦图标（两列整体居中，奇数个时末尾图标居中）----
    const A = this.game.assets;
    const CX = HUD_X + 8; // HUD 面板水平中心
    const remaining = this.world.spawnQueue.length;
    for (let i = 0; i < remaining; i++) {
      const col = i % 2, row = Math.floor(i / 2);
      const lastOdd = i === remaining - 1 && remaining % 2 === 1;
      blit(ctx, A.enemyIcon, lastOdd ? CX - 4 : CX - 9 + col * 10, 62 + row * 10);
    }
    // 玩家命数图标（双人两行）与关卡旗帜：与文字组成行组居中
    blit(ctx, A.lifeIcon, CX - 9, this.world.playerCount > 1 ? 166 : 172);
    if (this.world.playerCount > 1) {
      blit(ctx, A.lifeIcon, CX - 9, 178);
    }
    blit(ctx, A.flagIcon, CX - 9, 196);

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
    const CX = HUD_X + 8; // HUD 面板水平中心
    // 分数区：标签与数值统一按面板居中
    drawText(dctx, '得分', CX, 10, { size: 7, align: 'center', color: '#e8e8e8', shadow: null });
    drawText(dctx, String(this.game.score).padStart(6, '0'), CX, 20, {
      size: 7, align: 'center', color: '#f8c820', shadow: null,
    });
    drawText(dctx, '最高', CX, 38, { size: 7, align: 'center', color: '#e8e8e8', shadow: null });
    drawText(dctx, String(this.game.hiScore).padStart(6, '0'), CX, 48, {
      size: 7, align: 'center', color: '#f0f0f0', shadow: null,
    });

    // 命数与关卡号：图标 + 文字组成行组，整体居中
    if (w.playerCount > 1) {
      drawText(dctx, '×' + Math.max(0, w.lives[0] - 1), CX + 1, 166, {
        size: 8, color: '#f8c820', shadow: null,
      });
      drawText(dctx, '×' + Math.max(0, w.lives[1] - 1), CX + 1, 178, {
        size: 8, color: '#68d858', shadow: null,
      });
    } else {
      drawText(dctx, '×' + Math.max(0, w.lives[0] - 1), CX + 1, 172, {
        size: 8, color: '#f0f0f0', shadow: null,
      });
    }
    drawText(dctx, String(this.stageIndex + 1), CX + 1, 196, {
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
