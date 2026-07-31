// 联网对战大厅：创建房间（显示房间码等待好友）/ 输入房间码加入
// 配对成功后：房主作为主机（P1）、加入者作为客机（P2），进入合作闯关
import { LOGICAL_W, LOGICAL_H } from '../core/const.js';
import { drawText } from '../core/text.js';
import { TitleScene } from './title.js';
import { IntroScene } from './intro.js';
import { NetClient, defaultServerUrl } from '../net/client.js';
import { NetHostSession, NetClientSession } from '../net/session.js';

export class LobbyScene {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.phase = 'menu';   // menu | wait | join-input | joining
    this.menuIndex = 0;
    this.code = '';        // 输入中的房间码
    this.roomCode = '';    // 创建成功的房间码
    this.error = '';
    this.client = null;
    this.role = null;      // host | guest
    this._digitHandler = null;
  }

  get items() { return ['创建房间', '加入房间', '返回标题']; }

  exit() { this._unhookDigits(); }

  _hookDigits() {
    this._unhookDigits();
    this._digitHandler = (e) => {
      if (this.phase !== 'join-input') return;
      if (/^Digit[0-9]$/.test(e.code) || /^Numpad[0-9]$/.test(e.code)) {
        if (this.code.length < 4) this.code += e.code.slice(-1);
      } else if (e.code === 'Backspace') {
        this.code = this.code.slice(0, -1);
      }
    };
    window.addEventListener('keydown', this._digitHandler);
  }

  _unhookDigits() {
    if (this._digitHandler) window.removeEventListener('keydown', this._digitHandler);
    this._digitHandler = null;
  }

  _connect(asHost) {
    this.error = '';
    this.role = asHost ? 'host' : 'guest';
    const client = new NetClient(defaultServerUrl());
    this.client = client;
    client.on('created', (m) => {
      this.roomCode = m.code;
      this.phase = 'wait'; // 等待好友加入
    });
    client.on('peer-joined', () => this._startGame());
    client.on('joined', () => this._startGame());
    client.on('error', (m) => {
      this.error = m.msg || '加入失败';
      this.phase = 'menu';
      client.close();
      this.client = null;
    });
    client.on('socket-error', () => {
      this.error = '无法连接服务器';
      this.phase = 'menu';
      this.client = null;
    });
    client.connect();
    client.on('open', () => {
      if (asHost) client.createRoom();
      else { client.joinRoom(this.code); }
    });
  }

  _startGame() {
    const game = this.game;
    const client = this.client;
    const isHost = this.role === 'host';
    game.mode = isHost ? 'net-host' : 'net-client';
    game.net = {
      client,
      createGameSession(scene) {
        return isHost ? new NetHostSession(game, scene) : new NetClientSession(game, scene);
      },
    };
    game.resetRun();
    game.audio.stopBgm();
    game.engine.changeScene(new IntroScene(game, 0)); // 联机固定从第 1 关开始
  }

  update() {
    const input = this.game.input;
    this.t++;

    if (this.phase === 'menu') {
      if (input.pressed('up')) {
        this.menuIndex = (this.menuIndex + this.items.length - 1) % this.items.length;
        this.game.audio.hitWall();
      }
      if (input.pressed('down')) {
        this.menuIndex = (this.menuIndex + 1) % this.items.length;
        this.game.audio.hitWall();
      }
      if (input.pressed('start') || input.pressed('fire')) {
        this.game.audio.pause();
        if (this.menuIndex === 0) {
          this.phase = 'joining';
          this._connect(true);
        } else if (this.menuIndex === 1) {
          this.phase = 'join-input';
          this.code = '';
          this._hookDigits();
        } else {
          this.game.engine.changeScene(new TitleScene(this.game));
        }
      }
    } else if (this.phase === 'join-input') {
      // 数字录入在 _digitHandler；Enter 提交，P 返回
      if (input.pressed('start') && this.code.length === 4) {
        this.game.audio.pause();
        this.phase = 'joining';
        this._unhookDigits();
        this._connect(false);
      }
      if (input.pressed('pause')) {
        this.phase = 'menu';
        this._unhookDigits();
      }
    } else if (this.phase === 'wait' || this.phase === 'joining') {
      // 等待中可按 P 取消
      if (input.pressed('pause')) {
        if (this.client) { this.client.close(); this.client = null; }
        this.phase = 'menu';
      }
    }
    input.postUpdate();
  }

  render(ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, LOGICAL_H);
    grad.addColorStop(0, '#050510');
    grad.addColorStop(1, '#141428');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
  }

  renderText(dctx) {
    const cx = LOGICAL_W / 2;
    drawText(dctx, '联网对战', cx, 36, {
      size: 18, align: 'center', color: '#f8c820', glow: '#c04010',
    });

    if (this.phase === 'menu') {
      for (let i = 0; i < this.items.length; i++) {
        const sel = i === this.menuIndex;
        drawText(dctx, this.items[i], cx, 84 + i * 20, {
          size: 10, align: 'center',
          color: sel ? '#f8c820' : '#a0a0a0',
          glow: sel ? '#a06810' : null,
        });
      }
      if (this.error) {
        drawText(dctx, this.error, cx, 158, { size: 8, align: 'center', color: '#f04838', shadow: null });
      }
      drawText(dctx, '合作闯关：房主为 P1，加入者为 P2', cx, 182, {
        size: 7, align: 'center', color: '#888888', shadow: null,
      });
      // 当前连接的中继服务器地址（可用 ?server=ws://host:port 指定）
      drawText(dctx, '服务器：' + defaultServerUrl(), cx, 200, {
        size: 6, align: 'center', color: '#666677', shadow: null,
      });
    } else if (this.phase === 'join-input') {
      drawText(dctx, '输入 4 位房间码', cx, 84, { size: 10, align: 'center', color: '#f0f0f0' });
      drawText(dctx, this.code.padEnd(4, '_').split('').join(' '), cx, 112, {
        size: 16, align: 'center', color: '#68d8f0', glow: '#2050a0',
      });
      drawText(dctx, 'Enter 加入 · P 返回', cx, 152, { size: 7, align: 'center', color: '#888888', shadow: null });
    } else if (this.phase === 'wait') {
      drawText(dctx, '房间已创建，把房间码告诉好友', cx, 84, {
        size: 9, align: 'center', color: '#f0f0f0',
      });
      drawText(dctx, this.roomCode.split('').join(' '), cx, 110, {
        size: 20, align: 'center', color: '#68d8f0', glow: '#2050a0',
      });
      if ((this.t >> 4) % 2 === 0) {
        drawText(dctx, '等待好友加入…', cx, 148, { size: 8, align: 'center', color: '#f8c820', shadow: null });
      }
      drawText(dctx, 'P 取消', cx, 182, { size: 7, align: 'center', color: '#888888', shadow: null });
    } else { // joining
      drawText(dctx, '连接中…', cx, 100, { size: 10, align: 'center', color: '#f0f0f0' });
    }
  }
}
