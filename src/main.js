// 启动入口：初始化引擎、输入、音频、资源，进入标题场景
import { Engine } from './core/engine.js';
import { Input, KEYMAP_P1, KEYMAP_P2 } from './core/input.js';
import { AudioMan } from './core/audio.js';
import { buildAssets } from './core/assets.js';
import { LS_HISCORE, LS_STAGE } from './core/const.js';
import { TitleScene } from './scenes/title.js';
import { LEVELS } from './game/levels.js';

const canvas = document.getElementById('game');
const engine = new Engine(canvas);
const input1 = new Input(KEYMAP_P1); // P1：方向键 + 空格/J（兼菜单操作）
const input2 = new Input(KEYMAP_P2); // P2：WASD + F（本地双人）
const audio = new AudioMan();
const assets = buildAssets();

const game = {
  engine, audio, assets,
  input: input1,            // 菜单/全局操作统一用 P1 输入
  inputs: [input1, input2], // 战斗场景按玩家取用
  mode: '1p',               // 1p | 2p | net-host | net-client
  net: null,                // 联网会话（lobby 场景建立）
  score: 0,
  playerLevels: [0, 0],     // 跨关保留的升级等级（按玩家）
  lives: [3, 3],            // 跨关保留的命数（按玩家）
  hiScore: parseInt(localStorage.getItem(LS_HISCORE) || '0', 10) || 0,

  // 新开局重置进度（按模式）
  resetRun() {
    this.score = 0;
    this.playerLevels = [0, 0];
    this.lives = [3, 3];
  },

  addScore(n) {
    this.score += n;
    if (this.score > this.hiScore) this.hiScore = this.score;
  },

  // 结算最高分；返回是否新纪录
  commitHiScore() {
    const prev = parseInt(localStorage.getItem(LS_HISCORE) || '0', 10) || 0;
    if (this.score > prev) {
      localStorage.setItem(LS_HISCORE, String(this.score));
      return true;
    }
    return false;
  },

  // 解锁关卡进度
  unlockStage(n) {
    const cur = parseInt(localStorage.getItem(LS_STAGE) || '1', 10) || 1;
    if (n > cur) localStorage.setItem(LS_STAGE, String(Math.min(n, LEVELS.length)));
  },
};

// 浏览器策略：首次按键后才能创建 AudioContext
window.addEventListener('keydown', () => audio.ensure(), { once: true });

// 全局快捷键：M 静音
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') { audio.ensure(); audio.toggleMute(); }
});

engine.attach(game);
engine.changeScene(new TitleScene(game));
engine.start();

// 调试/测试句柄
window.__tank = game;
