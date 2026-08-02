// 输入管理器：键盘映射、按住状态、按下沿检测
// P1：光标键移动，空格/J 射击，Enter 确认，P 暂停
// P2：WASD 移动，F 射击（本地双人）
// M 静音为全局快捷键，在 main.js 单独处理

// P1 键位表（含菜单/暂停等全局动作）
export const KEYMAP_P1 = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Space: 'fire', KeyJ: 'fire',
  Enter: 'start', NumpadEnter: 'start',
  KeyP: 'pause',
};

// P2 键位表（仅移动与射击，菜单统一由 P1 操作）
export const KEYMAP_P2 = {
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
  KeyF: 'fire',
};

export class Input {
  constructor(keymap = KEYMAP_P1) {
    this.keymap = keymap;
    this.state = {};    // 当前按住
    this.pressedSet = {}; // 本帧按下沿
    window.addEventListener('keydown', (e) => {
      const a = this.keymap[e.code];
      if (!a) return;
      e.preventDefault();
      if (!this.state[a]) this.pressedSet[a] = true;
      this.state[a] = true;
    });
    window.addEventListener('keyup', (e) => {
      const a = this.keymap[e.code];
      if (!a) return;
      e.preventDefault();
      this.state[a] = false;
    });
    // 失焦时清空，防止按键卡住
    window.addEventListener('blur', () => { this.state = {}; });
  }

  down(action) { return !!this.state[action]; }
  pressed(action) { return !!this.pressedSet[action]; }

  // 当前按下的方向（0-3），无则 -1；斜向时取最后按下的方向
  dirHeld() {
    // 优先级：上下左右中最近按下的。简单处理：按固定优先级取一个
    if (this.state.up) return 0;
    if (this.state.right) return 1;
    if (this.state.down) return 2;
    if (this.state.left) return 3;
    return -1;
  }

  // 每帧逻辑结束后调用，清除按下沿
  postUpdate() { this.pressedSet = {}; }
}

// 可编程输入：接口与 Input 一致，供测试与非键盘控制使用
export class NetInput {
  constructor() {
    this.state = {};
    this.pressedSet = {};
  }

  down(action) { return !!this.state[action]; }
  pressed(action) { return !!this.pressedSet[action]; }

  dirHeld() {
    if (this.state.up) return 0;
    if (this.state.right) return 1;
    if (this.state.down) return 2;
    if (this.state.left) return 3;
    return -1;
  }

  // 应用远端发来的一帧输入：held 为按住状态表，edges 为本帧按下沿表
  applyRemote(held, edges) {
    this.state = { ...held };
    this.pressedSet = { ...edges };
  }

  // 采集一帧输入快照
  static snapshotOf(input) {
    return {
      held: { ...input.state },
      edges: { ...input.pressedSet },
    };
  }

  postUpdate() { this.pressedSet = {}; }
}
