// 引擎核心：固定时间步长主循环 + 场景栈 + 全局上下文
import { LOGICAL_W, LOGICAL_H, SCALE } from './const.js';

export class Engine {
  constructor(canvas) {
    // 渲染层：768×672 高清画布，逻辑坐标经变换放大 3 倍（抗锯齿）
    this.buffer = document.createElement('canvas');
    this.buffer.width = LOGICAL_W * SCALE;
    this.buffer.height = LOGICAL_H * SCALE;
    this.bctx = this.buffer.getContext('2d');
    this.bctx.imageSmoothingEnabled = true;
    this.bctx.imageSmoothingQuality = 'high';

    // 显示层：与渲染层同尺寸，1:1 上屏
    this.canvas = canvas;
    canvas.width = LOGICAL_W * SCALE;
    canvas.height = LOGICAL_H * SCALE;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = true;

    this.scene = null;          // 当前场景
    this.nextScene = null;      // 待切换场景
    this.acc = 0;
    this.last = 0;
    this.frame = 0;             // 全局帧计数（动画用）
    this.hitstop = 0;           // 顿帧剩余
    this.paused = false;
    this._rafScheduled = false;

    this.STEP = 1000 / 60;
    this._loop = this._loop.bind(this);
  }

  // 全局共享上下文（场景与实体通过它协作）
  attach(game) { this.game = game; }

  changeScene(scene) { this.nextScene = scene; }

  // 顿帧：命中强敌时冻结若干帧逻辑，增强打击感
  addHitstop(frames) { this.hitstop = Math.max(this.hitstop, frames); }

  start() {
    this._scheduleRaf();
    // 后台标签页 rAF 停止（Chrome 隐藏标签节流），用固定间隔兜底驱动，
    // 保证联网主机的广播与客机渲染在窗口切走时不断
    if (document.addEventListener) {
      const sync = () => {
        if (document.hidden) {
          clearInterval(this._bgTimer);
          this._bgTimer = setInterval(() => this._loop(performance.now()), 16.7);
        } else {
          clearInterval(this._bgTimer);
        }
      };
      document.addEventListener('visibilitychange', sync);
      if (document.hidden) sync(); // 页面以后台方式打开时立即启用兜底
    }
  }

  // 前台 rAF 与后台定时器共用同一个调度闸门，防止切回页面后积累多个 rAF 主循环。
  _scheduleRaf() {
    if (this._rafScheduled) return;
    this._rafScheduled = true;
    requestAnimationFrame((now) => {
      this._rafScheduled = false;
      this._loop(now);
    });
  }

  _loop(now) {
    this._scheduleRaf();
    if (!this.last) this.last = now;
    let dt = now - this.last;
    this.last = now;
    if (dt > 250) dt = 250; // 切后台回来不追帧
    this.acc += dt;

    // 每帧最多追 4 个逻辑帧：机器跟不上时丢弃积压，
    // 防止「越慢越追、越追越慢」的死亡螺旋
    let steps = 0;
    while (this.acc >= this.STEP && steps < 4) {
      this.acc -= this.STEP;
      this._tick();
      steps++;
    }
    if (steps === 4 && this.acc >= this.STEP) this.acc = 0;

    // 没有新的逻辑帧就不重绘（高刷新率屏幕下省一半渲染开销）
    if (steps > 0 || !this._didRender) {
      this._render();
      this._didRender = true;
    }
  }

  _tick() {
    if (this.nextScene) {
      if (this.scene && this.scene.exit) this.scene.exit();
      this.scene = this.nextScene;
      this.nextScene = null;
      if (this.scene.enter) this.scene.enter();
    }
    this.frame++;
    if (this.hitstop > 0) {
      this.hitstop--;
      // 顿帧期间仍通知场景（联网主机需继续广播快照，保证客机插值缓冲不断流）
      if (this.scene && this.scene.onHitstop) this.scene.onHitstop();
      return;
    } // 顿帧期间逻辑暂停
    if (this.scene && this.scene.update) this.scene.update();
  }

  _render() {
    // 每帧重置为逻辑坐标变换（场景内全部用 256×224 逻辑坐标作画）
    this.bctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    if (this.scene && this.scene.render) this.scene.render(this.bctx);
    // 1:1 上屏（渲染层已是显示分辨率）
    this.ctx.drawImage(this.buffer, 0, 0);
    // 高清文字层（HUD/菜单中文用系统字体，避免缩放模糊）
    if (this.scene && this.scene.renderText) this.scene.renderText(this.ctx);
  }
}
