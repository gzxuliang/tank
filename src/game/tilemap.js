// 地形系统：26×26 小格地图、砖墙整格破坏、分层渲染（地面层 / 草丛遮挡层）
// 静态层走离屏缓存：只有地形变化才重绘，避免每帧 676 次贴图
import { T, TILE, MAP_W, MAP_H, FIELD_X, FIELD_Y, FIELD_SIZE, BASE_TX, BASE_TY } from '../core/const.js';
import { blit, createLayer } from '../core/assets.js';

// 基地周围保护墙的小格坐标（加厚拱门形：顶行 6 格宽，左右侧壁 2 格厚）
//   ■■■■■■
//   ■■  ■■
//   ■■  ■■
export const BASE_WALL_CELLS = [
  [10, 23], [11, 23], [12, 23], [13, 23], [14, 23], [15, 23],
  [10, 24], [11, 24], [14, 24], [15, 24],
  [10, 25], [11, 25], [14, 25], [15, 25],
];

export class TileMap {
  constructor() {
    this.cells = new Uint8Array(MAP_W * MAP_H);
    this.brickMask = new Uint8Array(MAP_W * MAP_H); // 砖墙存活标记：0b1111 存在 / 0 已整格摧毁
    this.baseAlive = true;
    this._fortified = false;
    this._pendingFortify = new Set(); // 被坦克占用而暂缓恢复的围墙格子
    // 离屏缓存（首次渲染时创建）
    this._groundCache = null; this._gctx = null;
    this._grassCache = null; this._grctx = null;
    this._dirty = true;      // 地面层需重绘
    this._dirtyGrass = true; // 草丛层需重绘
    this._grassFrame = -1;   // 草丛缓存对应的摆动帧
  }

  idx(tx, ty) { return ty * MAP_W + tx; }
  inMap(tx, ty) { return tx >= 0 && ty >= 0 && tx < MAP_W && ty < MAP_H; }
  cellAt(tx, ty) { return this.inMap(tx, ty) ? this.cells[this.idx(tx, ty)] : T.STEEL; }

  // 加载关卡：13×13 大格字符画，每大格扩展为 2×2 小格
  loadLevel(rows) {
    this.cells.fill(T.EMPTY);
    this.brickMask.fill(0);
    this.baseAlive = true;
    this._fortified = false;
    this._pendingFortify.clear();
    this._dirty = true;
    this._dirtyGrass = true;
    const charMap = { '#': T.BRICK, '@': T.STEEL, '%': T.GRASS, '~': T.WATER, '-': T.ICE };
    for (let by = 0; by < 13; by++) {
      const row = rows[by] || '';
      for (let bx = 0; bx < 13; bx++) {
        const t = charMap[row[bx]] || T.EMPTY;
        if (t === T.EMPTY) continue;
        for (let sy = 0; sy < 2; sy++) {
          for (let sx = 0; sx < 2; sx++) {
            const tx = bx * 2 + sx, ty = by * 2 + sy;
            this.cells[this.idx(tx, ty)] = t;
            if (t === T.BRICK) this.brickMask[this.idx(tx, ty)] = 0b1111;
          }
        }
      }
    }
  }

  baseRect() {
    return { x: FIELD_X + BASE_TX * TILE, y: FIELD_Y + BASE_TY * TILE, w: TILE * 2, h: TILE * 2 };
  }

  destroyBase() { this.baseAlive = false; this._dirty = true; }

  // 铁锹：基地围墙砖 ↔ 钢
  // isOccupied(tx, ty)：可选，返回该小格是否被坦克占用；占用的格子跳过并记入待恢复列表
  fortify(on, isOccupied) {
    this._fortified = on;
    for (const [tx, ty] of BASE_WALL_CELLS) {
      const i = this.idx(tx, ty);
      if (isOccupied && isOccupied(tx, ty)) {
        this._pendingFortify.add(i); // 有坦克压着：暂不写入，避免把坦克嵌进墙里卡死
        continue;
      }
      this._pendingFortify.delete(i);
      this._writeFortifyCell(i, on);
    }
  }

  _writeFortifyCell(i, on) {
    if (on) {
      this.cells[i] = T.STEEL;
      this.brickMask[i] = 0;
    } else {
      this.cells[i] = T.BRICK;
      this.brickMask[i] = 0b1111;
    }
    this._dirty = true;
  }

  // 每帧重试：坦克开走后按当前铁锹状态补回被跳过的格子
  retryFortify(isOccupied) {
    if (this._pendingFortify.size === 0) return;
    for (const i of [...this._pendingFortify]) {
      const tx = i % MAP_W, ty = Math.floor(i / MAP_W);
      if (isOccupied(tx, ty)) continue;
      this._pendingFortify.delete(i);
      this._writeFortifyCell(i, this._fortified);
    }
  }

  // ---- 坦克通行判定（像素矩形，战场局部坐标系不含 FIELD 偏移）----
  // ignoreBricks：巨型坦克专用，砖墙视为可通行（进入后由世界撞碎）
  isSolidForTank(x, y, w, h, ignoreBricks = false) {
    if (x < 0 || y < 0 || x + w > MAP_W * TILE || y + h > MAP_H * TILE) return true;
    const x0 = Math.floor(x / TILE), x1 = Math.floor((x + w - 0.01) / TILE);
    const y0 = Math.floor(y / TILE), y1 = Math.floor((y + h - 0.01) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const c = this.cellAt(tx, ty);
        if (c === T.STEEL || c === T.WATER) return true;
        if (!ignoreBricks && c === T.BRICK && this.brickMask[this.idx(tx, ty)] !== 0) return true;
      }
    }
    // 基地永远不可通行
    const b = this.baseRect();
    const bx = b.x - FIELD_X, by = b.y - FIELD_Y;
    if (x < bx + b.w && x + w > bx && y < by + b.h && y + h > by) return true;
    return false;
  }

  // 坦克是否压在冰面上（打滑用）
  onIce(x, y, w, h) {
    const cx = Math.floor((x + w / 2) / TILE), cy = Math.floor((y + h / 2) / TILE);
    return this.cellAt(cx, cy) === T.ICE;
  }

  // ---- 子弹命中地形 ----
  // hitRect：战场局部坐标；power>=3 可破钢
  // 返回 { result: 'brick'|'steel'|'base'|null }
  bulletHit(hx, hy, hw, hh, power, apply = true) {
    // 基地判定优先
    const b = this.baseRect();
    const bx = b.x - FIELD_X, by = b.y - FIELD_Y;
    if (this.baseAlive &&
        hx < bx + b.w && hx + hw > bx && hy < by + b.h && hy + hh > by) {
      if (apply) this.destroyBase();
      return { result: 'base' };
    }
    const x0 = Math.floor(hx / TILE), x1 = Math.floor((hx + hw - 0.01) / TILE);
    const y0 = Math.floor(hy / TILE), y1 = Math.floor((hy + hh - 0.01) / TILE);
    let hitBrick = false, hitSteel = false;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!this.inMap(tx, ty)) continue;
        const i = this.idx(tx, ty);
        const c = this.cells[i];
        if (c === T.BRICK && this.brickMask[i] !== 0) {
          // 整格破坏：一两发即可打出坦克可通行的缺口
          if (apply) {
            this.brickMask[i] = 0;
            this.cells[i] = T.EMPTY;
            this._dirty = true;
          }
          hitBrick = true;
        } else if (c === T.STEEL) {
          if (power >= 3) {
            if (apply) {
              this.cells[i] = T.EMPTY;
              this._dirty = true;
            }
            hitBrick = true; // 破钢的打击感按砖墙处理
          } else {
            hitSteel = true;
          }
        }
      }
    }
    if (hitBrick) return { result: 'brick' };
    if (hitSteel) return { result: 'steel' };
    return { result: null };
  }

  // 找道具生成点：随机空格（战场局部坐标，返回像素）
  randomEmptySpot(rand) {
    for (let tries = 0; tries < 50; tries++) {
      const tx = 1 + Math.floor(rand() * (MAP_W - 4));
      const ty = 1 + Math.floor(rand() * (MAP_H - 4));
      const c = this.cellAt(tx, ty);
      if (c === T.EMPTY || c === T.GRASS) {
        return { x: tx * TILE, y: ty * TILE };
      }
    }
    return { x: 6 * TILE, y: 12 * TILE };
  }

  // ---- 渲染 ----
  _ensureCaches() {
    if (this._groundCache) return;
    [this._groundCache, this._gctx] = createLayer(FIELD_SIZE, FIELD_SIZE);
    [this._grassCache, this._grctx] = createLayer(FIELD_SIZE, FIELD_SIZE);
  }

  // 地面静态层：砖/钢/冰 + 基地（水面有两帧动画，走动态绘制）
  _rebuildGround(assets) {
    const g = this._gctx;
    g.clearRect(0, 0, FIELD_SIZE, FIELD_SIZE);
    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        const i = this.idx(tx, ty);
        const c = this.cells[i];
        const px = tx * TILE, py = ty * TILE;
        if (c === T.BRICK && this.brickMask[i] !== 0) blit(g, assets.brick, px, py);
        else if (c === T.STEEL) blit(g, assets.steel, px, py);
        else if (c === T.ICE) blit(g, assets.ice, px, py);
      }
    }
    const b = this.baseRect();
    blit(g, this.baseAlive ? assets.base : assets.baseDead, b.x - FIELD_X, b.y - FIELD_Y);
  }

  _rebuildGrass(assets, sway) {
    const g = this._grctx;
    g.clearRect(0, 0, FIELD_SIZE, FIELD_SIZE);
    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        if (this.cells[this.idx(tx, ty)] === T.GRASS) {
          blit(g, assets.grass[(tx + ty + sway) & 1], tx * TILE, ty * TILE);
        }
      }
    }
  }

  renderGround(ctx, assets, frame) {
    this._ensureCaches();
    if (this._dirty) {
      this._rebuildGround(assets);
      this._dirty = false;
    }
    ctx.drawImage(this._groundCache, FIELD_X, FIELD_Y, FIELD_SIZE, FIELD_SIZE);
    // 水面动态（两帧波动）
    const waterFrame = (frame >> 5) & 1;
    for (let ty = 0; ty < MAP_H; ty++) {
      for (let tx = 0; tx < MAP_W; tx++) {
        if (this.cells[this.idx(tx, ty)] === T.WATER) {
          blit(ctx, assets.water[waterFrame], FIELD_X + tx * TILE, FIELD_Y + ty * TILE);
        }
      }
    }
  }

  // 草丛在坦克之上绘制，形成遮挡
  renderGrass(ctx, assets, frame) {
    this._ensureCaches();
    const sway = (frame >> 6) & 1;
    if (this._dirtyGrass || this._grassFrame !== sway) {
      this._rebuildGrass(assets, sway);
      this._dirtyGrass = false;
      this._grassFrame = sway;
    }
    ctx.drawImage(this._grassCache, FIELD_X, FIELD_Y, FIELD_SIZE, FIELD_SIZE);
  }
}
