// 得分飘字（+100/+500）：上升并淡出
// 在显示分辨率层绘制（renderText），保证文字锐利
import { FIELD_X, FIELD_Y, SCALE } from '../core/const.js';

export class FloatText {
  constructor(x, y, text, color = '#ffffff') {
    this.x = x; // 战场局部坐标
    this.y = y;
    this.text = text;
    this.color = color;
    this.timer = 50;
    this.alive = true;
  }

  update() {
    this.timer--;
    this.y -= 0.25;
    if (this.timer <= 0) this.alive = false;
  }

  // 在显示画布上绘制（带震动偏移）
  render(dctx, ox = 0, oy = 0) {
    const alpha = Math.min(1, this.timer / 25);
    dctx.save();
    dctx.globalAlpha = alpha;
    dctx.font = 'bold 21px "Consolas", monospace';
    dctx.textAlign = 'center';
    dctx.textBaseline = 'middle';
    const px = (FIELD_X + this.x) * SCALE + ox;
    const py = (FIELD_Y + this.y) * SCALE + oy;
    dctx.fillStyle = '#000000';
    dctx.fillText(this.text, px + 2, py + 2);
    dctx.fillStyle = this.color;
    dctx.fillText(this.text, px, py);
    dctx.restore();
  }
}
