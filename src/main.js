// 启动入口：初始化引擎、输入、音频、资源，进入标题场景
import { Engine } from './core/engine.js';
import { Input } from './core/input.js';
import { AudioMan } from './core/audio.js';
import { buildAssets } from './core/assets.js';
import { LS_HISCORE, LS_STAGE } from './core/const.js';
import { TitleScene } from './scenes/title.js';
import { LEVELS } from './game/levels.js';

const canvas = document.getElementById('game');
const engine = new Engine(canvas);
const input = new Input();
const audio = new AudioMan();
const assets = buildAssets();

const game = {
  engine, input, audio, assets,
  score: 0,
  hiScore: parseInt(localStorage.getItem(LS_HISCORE) || '0', 10) || 0,
  crtOn: false, // 高清画质默认关闭 CRT 滤镜（标题菜单/按 C 可开启）

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

  toggleCrt() {
    this.crtOn = !this.crtOn;
    document.getElementById('stage-wrap').classList.toggle('crt', this.crtOn);
  },
};

// 浏览器策略：首次按键后才能创建 AudioContext
window.addEventListener('keydown', () => audio.ensure(), { once: true });

// 全局快捷键：M 静音、C CRT 滤镜
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') { audio.ensure(); audio.toggleMute(); }
  if (e.code === 'KeyC') { game.toggleCrt(); }
});

engine.attach(game);
engine.changeScene(new TitleScene(game));
engine.start();

// 调试/测试句柄
window.__tank = game;
