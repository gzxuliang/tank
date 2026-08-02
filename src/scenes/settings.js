// 设置：修改用户名（首次启动未设置时强制先设置，保存后进入标题）
import { LOGICAL_W, LOGICAL_H } from '../core/const.js';
import { drawText } from '../core/text.js';
import { TitleScene } from './title.js';

export class SettingsScene {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.menuIndex = 0;
    this.editing = false;
    // 首次：未设置用户名，必须设置后才能继续（保存后自动进入标题）
    this.required = !game.username;
  }

  enter() {
    // 首次强制：自动打开输入框，直接进入设置流程
    if (this.required) this._editName();
  }

  get items() {
    return this.required
      ? ['用户名（未设置，按 Enter 设置）']
      : ['用户名 ' + this.game.username, '返回'];
  }

  update() {
    const input = this.game.input;
    this.t++;
    if (this.editing) { input.postUpdate(); return; }
    if (input.pressed('down')) {
      this.menuIndex = (this.menuIndex + 1) % this.items.length;
      this.game.audio.hitWall();
    }
    if (input.pressed('up')) {
      this.menuIndex = (this.menuIndex + this.items.length - 1) % this.items.length;
      this.game.audio.hitWall();
    }
    if (input.pressed('start') || input.pressed('fire')) {
      this.game.audio.ensure();
      this.game.audio.pause(); // 确认音
      if (this.menuIndex === 0) this._editName();
      else this._back();
    }
    input.postUpdate();
  }

  // 保存用户名并进入标题（首次设置后继续游戏）
  save(name) {
    this.game.setUsername(name);
    this.game.engine.changeScene(new TitleScene(this.game));
  }

  _back() {
    this.game.audio.stopBgm();
    this.game.engine.changeScene(new TitleScene(this.game));
  }

  // 内嵌输入框编辑用户名：Enter 保存（保存后进入标题），Esc/失焦取消
  _editName() {
    if (this.editing) return;
    const wrap = document.getElementById('stage-wrap');
    const input = document.createElement('input');
    // 无真实 DOM 的环境（Node 测试桩）：跳过编辑，保持场景可用
    if (typeof input.addEventListener !== 'function' || typeof wrap.appendChild !== 'function') return;
    this.editing = true;
    input.className = 'name-input';
    input.maxLength = 12;
    input.value = this.game.username;
    let closed = false;
    const close = (commit) => {
      if (closed) return;
      closed = true;
      input.remove();
      this.editing = false;
      if (commit) this.save(input.value);
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation(); // 防止游戏 Input 收到方向键/Enter
      if (e.isComposing) return; // 中文输入法组合中，Enter 仅上屏
      if (e.key === 'Enter') close(true);
      else if (e.key === 'Escape') close(false);
    });
    input.addEventListener('blur', () => close(false));
    wrap.appendChild(input);
    input.focus();
    input.select();
  }

  render(ctx) {
    // 与标题画面一致的深蓝黑渐变背景
    const grad = ctx.createLinearGradient(0, 0, 0, LOGICAL_H);
    grad.addColorStop(0, '#050510');
    grad.addColorStop(0.7, '#0a0a20');
    grad.addColorStop(1, '#141428');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
  }

  renderText(dctx) {
    const cx = LOGICAL_W / 2;
    drawText(dctx, '设置', cx, 24, {
      size: 14, align: 'center', color: '#f8c820', glow: '#a06810',
    });
    if (this.required) {
      drawText(dctx, '首次游戏请先设置用户名', cx, 70, {
        size: 8, align: 'center', color: '#68d8f0', shadow: null,
      });
    }
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      const sel = i === this.menuIndex;
      drawText(dctx, items[i], cx, 96 + i * 18, {
        size: 10, align: 'center',
        color: sel ? '#f8c820' : '#a0a0a0',
        glow: sel ? '#a06810' : null,
      });
    }
    if (!this.required && (this.t >> 5) % 2 === 0) {
      drawText(dctx, 'Enter 编辑 · 方向键选择', cx, 160, {
        size: 7, align: 'center', color: '#888888', shadow: null,
      });
    }
  }
}
