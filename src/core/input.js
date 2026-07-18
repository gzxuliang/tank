// 输入管理器：键盘映射、按住状态、按下沿检测
// 光标键移动，空格/J 射击，Enter 确认，P 暂停，M 静音，C 切换 CRT 滤镜

const KEYMAP = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Space: 'fire', KeyJ: 'fire',
  Enter: 'start', NumpadEnter: 'start',
  KeyP: 'pause',
  KeyM: 'mute',
  KeyC: 'crt',
};

export class Input {
  constructor() {
    this.state = {};    // 当前按住
    this.pressedSet = {}; // 本帧按下沿
    window.addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      e.preventDefault();
      if (!this.state[a]) this.pressedSet[a] = true;
      this.state[a] = true;
    });
    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
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
