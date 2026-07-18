// 全局常量定义
// 逻辑分辨率仿 FC：256×224，整数倍放大渲染保证像素锐利

export const LOGICAL_W = 256;        // 逻辑画布宽
export const LOGICAL_H = 224;        // 逻辑画布高
export const SCALE = 3;              // 显示放大倍数（768×672）

export const TILE = 8;               // 小地块边长（逻辑像素）
export const SUB = 4;                // 砖墙可破坏子块边长（1/4 格）
export const MAP_W = 26;             // 地图宽（小格）
export const MAP_H = 26;             // 地图高（小格）
export const FIELD_X = 16;           // 战场在逻辑画布中的偏移
export const FIELD_Y = 8;
export const FIELD_SIZE = MAP_W * TILE; // 208

export const TANK_SIZE = 16;         // 坦克碰撞/绘制尺寸（2×2 小格）
export const BULLET_SIZE = 4;        // 子弹碰撞尺寸（绘制稍大）

export const HUD_X = FIELD_X + FIELD_SIZE + 8; // 右侧 HUD 起始 x = 232

// 方向：0上 1右 2下 3左
export const DIR = { UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3 };
export const DIR_DX = [0, 1, 0, -1];
export const DIR_DY = [-1, 0, 1, 0];

// 地形类型
export const T = {
  EMPTY: 0,
  BRICK: 1,
  STEEL: 2,
  GRASS: 3,
  WATER: 4,
  ICE: 5,
};

// 基地占据的小格范围（16×16，底部正中）
export const BASE_TX = 12;
export const BASE_TY = 24;

// 出生点（小格坐标，坦克 16×16 左上角）
// 玩家出生点在加厚的基地围墙（第 10 列）左侧留出 4 格宽的通道
export const PLAYER_SPAWN = { tx: 6, ty: 24 };
export const ENEMY_SPAWNS = [
  { tx: 0, ty: 0 },
  { tx: 12, ty: 0 },
  { tx: 24, ty: 0 },
];

// 每关敌方坦克总数 / 同屏上限
export const ENEMIES_PER_STAGE = 20;
export const MAX_ON_FIELD = 4;

// 计时（帧，60fps）
export const SHIELD_TIME = 60 * 10;      // 护盾/出生无敌
export const SPAWN_SHIELD_TIME = 60 * 3; // 出生短暂无敌
export const FREEZE_TIME = 60 * 10;      // 时钟冻结
export const SHOVEL_TIME = 60 * 20;      // 铁锹钢墙
export const SHOVEL_BLINK_TIME = 60 * 3; // 恢复前闪烁
export const POWERUP_LIFE = 60 * 12;     // 道具存在时长
export const POWERUP_SCORE = 500;

// 存档键
export const LS_HISCORE = 'tank_hiscore';
export const LS_STAGE = 'tank_unlock_stage';
