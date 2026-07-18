// 关卡开幕：黑色幕帘收拢显示关卡号，随后交给战斗场景拉开帷幕
import { LOGICAL_W, LOGICAL_H } from '../core/const.js';
import { drawText } from '../core/text.js';
import { GameScene } from './game.js';

const CLOSE_FRAMES = 20;
const HOLD_FRAMES = 60;

export class IntroScene {
  constructor(game, stageIndex) {
    this.game = game;
    this.stageIndex = stageIndex;
    this.t = 0;
  }

  enter() { this.game.audio.stageStart(); }

  update() {
    this.t++;
    if (this.t >= CLOSE_FRAMES + HOLD_FRAMES) {
      this.game.engine.changeScene(new GameScene(this.game, this.stageIndex, CLOSE_FRAMES));
    }
    this.game.input.postUpdate();
  }

  render(ctx) {
    const bg = ctx.createLinearGradient(0, 0, 0, LOGICAL_H);
    bg.addColorStop(0, '#3d4454');
    bg.addColorStop(1, '#222734');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
    // 幕帘收拢
    const p = Math.min(1, this.t / CLOSE_FRAMES);
    const h = Math.round((LOGICAL_H / 2) * p);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, LOGICAL_W, h);
    ctx.fillRect(0, LOGICAL_H - h, LOGICAL_W, h);
  }

  renderText(dctx) {
    if (this.t > CLOSE_FRAMES / 2) {
      drawText(dctx, `第 ${this.stageIndex + 1} 关`, LOGICAL_W / 2, LOGICAL_H / 2 - 8, {
        size: 14, align: 'center', color: '#f0f0f0', glow: '#404040',
      });
    }
  }
}
