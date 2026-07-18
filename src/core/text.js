// 文字绘制辅助：在显示分辨率层绘制，逻辑坐标 ×SCALE，保证中文锐利
import { SCALE } from './const.js';

export function drawText(dctx, text, lx, ly, opts = {}) {
  const {
    size = 8,                // 逻辑像素字号
    color = '#ffffff',
    align = 'left',
    baseline = 'top',
    weight = 'bold',
    font = '"Microsoft YaHei", "PingFang SC", "SimHei", sans-serif',
    shadow = '#000000',
    glow = null,
  } = opts;
  dctx.save();
  dctx.font = `${weight} ${size * SCALE}px ${font}`;
  dctx.textAlign = align;
  dctx.textBaseline = baseline;
  const x = lx * SCALE, y = ly * SCALE;
  if (glow) {
    dctx.shadowColor = glow;
    dctx.shadowBlur = size * SCALE * 0.6;
  }
  if (shadow) {
    dctx.fillStyle = shadow;
    dctx.fillText(text, x + SCALE, y + SCALE);
  }
  dctx.fillStyle = color;
  dctx.fillText(text, x, y);
  dctx.restore();
}
