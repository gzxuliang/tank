// 玩家坦克：方向键控制、三级升级、冰面打滑、护盾复活、蘑菇变大
import { Tank } from './tank.js';
import {
  SHIELD_TIME, SPAWN_SHIELD_TIME, TANK_SIZE, GIANT_SIZE, GIANT_HIT_SHIELD,
  PLAYER_SPEED,
} from '../core/const.js';

export class Player extends Tank {
  constructor(x, y, slot = 0) {
    super(x, y, 0);
    this.isPlayer = true;
    this.slot = slot;      // 0=P1 1=P2（配色/计分归属）
    this.speed = PLAYER_SPEED;
    this.level = 0;          // 0初始 1快弹 2双弹 3破钢
    this.spawnTimer = 32;    // 出生动画
    this.shieldTimer = SPAWN_SHIELD_TIME;
    this.slideTimer = 0;     // 冰面滑行剩余帧
    this.slideDir = 0;
    this._applyLevel();
  }

  _applyLevel() {
    this.bulletSpeed = this.level >= 1 ? 4 : 2.4;
    this.maxBullets = this.level >= 2 ? 2 : 1;
    this.bulletPower = this.level >= 3 ? 3 : 1;
  }

  upgrade() {
    if (this.level < 3) {
      this.level++;
      this._applyLevel();
      return true;
    }
    return false;
  }

  giveShield(frames = SHIELD_TIME) { this.shieldTimer = frames; }

  // 巨型状态的派生属性（尺寸）；快照同步后同样要重设
  _applyGiantState() {
    this.size = this.giant ? GIANT_SIZE : TANK_SIZE;
  }

  // 蘑菇：变大成 GIANT_SIZE，撞碎砖块；不叠加护盾/速度（保持普通移速）
  becomeGiant(world) {
    if (this.giant) return;
    const d = GIANT_SIZE - this.size; // 需要多占的边长
    // 候选落点：优先保持中心，退化到各偏移；砖墙不算障碍（会撞碎）
    for (const ox of [-d / 2, 0, -d]) {
      for (const oy of [-d / 2, 0, -d]) {
        const nx = this.x + ox, ny = this.y + oy;
        if (world.tilemap.isSolidForTank(nx, ny, GIANT_SIZE, GIANT_SIZE, true)) continue;
        if (world.tankBlocked(this, nx, ny, GIANT_SIZE, GIANT_SIZE)) continue;
        this.x = nx; this.y = ny;
        this.giant = true;
        this._applyGiantState();
        world._smashBricks(this);
        return;
      }
    }
  }

  // 巨型被敌方击中：缩回普通大小（不致死，马力欧蘑菇规则），附短暂无敌
  shrinkFromGiant() {
    const d = GIANT_SIZE - TANK_SIZE;
    this.giant = false;
    this._applyGiantState();
    this.x += d / 2; // 保持中心；缩小后的范围在原包围盒内，不会卡进障碍
    this.y += d / 2;
    this.hitFlash = 8;
    this.giveShield(GIANT_HIT_SHIELD);
  }

  // P1 黄色系 player0-3；P2 绿色系 ally0-3（FC 原版配色）
  paletteName() { return (this.slot === 0 ? 'player' : 'ally') + this.level; }

  update(world, input) {
    this.tickTimers();
    this.applyControl(world, input);
  }

  // 执行一条玩家操作；联网服务器和客户端预测必须共用同一套移动规则。
  // 世界计时由 update 或权威世界单独推进，重放输入时不能重复扣计时器。
  applyControl(world, input, allowFire = true) {
    if (!this.alive || this.spawnTimer > 0) return false;
    // 队友误伤定身：不能移动/开火（联网服务器与客户端预测共用此门控）
    if (this.stunTimer > 0) {
      this.moving = false;
      this.slideTimer = 0;
      return false;
    }

    const d = input.dirHeld();
    if (d >= 0) {
      this.setDir(d, world);
      this.tryMove(world);
      this.slideTimer = 0;
      // 记录冰面滑行方向
      if (world.tilemap.onIce(this.x, this.y, this.w, this.h)) {
        this.slideTimer = 8;
        this.slideDir = d;
      }
    } else {
      this.moving = false;
      // 冰面打滑：松开后继续滑一小段
      if (this.slideTimer > 0) {
        this.slideTimer--;
        this.setDir(this.slideDir, world);
        const bak = this.speed;
        this.speed = bak * 0.7;
        this.tryMove(world);
        this.speed = bak;
      }
    }

    // 巨型坦克：撞碎身下压着的砖墙（移动/转向对齐后统一处理）
    if (this.giant) world._smashBricks(this);

    if (allowFire && input.pressed('fire') && this.canFire(world)) {
      world.spawnBullet(this);
      world.audio.shoot();
      return true;
    }
    return false;
  }

  die(world) {
    this.alive = false;
    this.level = 0;
    this._applyLevel();
    // 阵亡后复活为普通大小
    this.giant = false;
    this._applyGiantState();
  }

  // 复活
  respawn(x, y) {
    this.x = x; this.y = y;
    this.dir = 0;
    this.alive = true;
    this.spawnTimer = 32;
    this.shieldTimer = SPAWN_SHIELD_TIME;
    this.stunTimer = 0;
    this.treadFrame = 0;
  }
}
