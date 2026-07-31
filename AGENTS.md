# AGENTS.md

写给 AI 编码代理的项目指南。本文假设读者对本项目一无所知。

## 项目概览

**坦克大战 Battle City** —— 红白机（FC）经典《坦克大战》的网页复刻版。

- 纯原生 JavaScript（ES Module）+ Canvas 2D，**无任何前端框架、无构建步骤**：浏览器直接加载 `src/main.js`。
- 所有像素美术由代码程序化绘制（`src/core/assets.js`），所有音效由 WebAudio 实时合成（`src/core/audio.js`），项目内没有图片/音频资源文件。
- 支持单人、本地双人（同键盘）、联网双人合作闯关，共 10 个手工设计关卡。
- 唯一的 npm 依赖是 `ws`（WebSocket 库），仅服务器端使用；浏览器端零依赖。

## 运行与构建

```bash
npm install        # 只装 ws
npm start          # 启动服务器：node server/server.js
npm test           # 运行冒烟测试：node test/smoke.mjs
```

- 启动后浏览器打开 <http://localhost:8000>；Windows 下也可双击 `启动游戏.bat`（自动打开浏览器并启动服务器）。
- 端口由 `PORT` 环境变量控制，默认 8000，监听 `0.0.0.0`（局域网可直接访问）。
- 没有打包/转译/ lint 配置：改完源码刷新浏览器即可。

## 架构与模块划分

```
src/
├── main.js            # 入口：初始化引擎/输入/音频/资源，组装全局 game 上下文，进标题场景
├── core/              # 引擎层
│   ├── engine.js      # 固定时间步长主循环（60Hz）+ 场景栈 + 顿帧（hit-stop）
│   ├── const.js       # 全部全局常量（逻辑分辨率、地形类型、出生点、计时、存档键）
│   ├── input.js       # 键盘输入（Input，含 P1/P2 两套键位表）+ NetInput（联网远端输入）
│   ├── assets.js      # 程序化像素图集（坦克履带动画、水面波纹、出生法阵等）
│   ├── audio.js       # WebAudio 合成 8-bit 音效与 BGM
│   └── text.js        # 文字渲染
├── scenes/            # 场景：title（标题）/ lobby（联机大厅）/ intro（关卡开幕）
│                      #        game（战斗）/ tally（战果结算）/ gameover（结束）
├── game/              # 玩法层
│   ├── world.js       # 世界状态：实体管理、生成调度、胜负判定、道具效果、全局计时
│   ├── tilemap.js     # 26×26 格地形，砖墙 1/4 格（brickMask）精细破坏
│   ├── tank.js / player.js / enemy.js / bullet.js / powerup.js
│   └── levels.js      # 10 个手工关卡（13×13 字符地图）+ 出击队列
├── net/               # 联机层
│   ├── client.js      # WebSocket 客户端 + 房间协议，传输层可注入（测试用内存管道）
│   ├── session.js     # 主机会话 / 客机会话
│   └── sync.js        # 世界快照序列化/应用、地形同步、位置平滑
└── fx/                # 特效：粒子、爆炸/震屏、飘字
server/
└── server.js          # Node 服务器：静态托管 + WebSocket 房间中继（唯一入口）
worker/
├── index.js           # Cloudflare 版：Worker 入口 + RoomLobby Durable Object（同一房间协议）
└── build-public.mjs   # 生成 public/（Workers Static Assets 目录）
test/
└── smoke.mjs          # Node 冒烟测试（详见下文）
```

### 关键架构约定

- **全局上下文 `game`**：在 `main.js` 中组装的普通对象（引擎、音频、资源、输入、模式、分数、命数等），场景与实体通过它协作。`window.__tank` 暴露该句柄供调试与测试。
- **逻辑分辨率 256×224**（仿 FC），渲染层放大 3 倍到 768×672（`SCALE`）。场景内全部用逻辑坐标作画。
- **固定时间步长主循环**：60Hz 逻辑帧，每帧最多追 4 帧，帧计数与计时一律以帧（60fps）为单位，常量集中在 `core/const.js`。
- **场景栈**：`engine.changeScene(scene)` 切换；场景可带 `enter/exit/update/render/renderText` 方法。
- **联机采用「主机权威 + 快照同步」**：主机跑完整游戏逻辑，每 2 帧（30Hz）广播世界快照；客机只发输入、按快照渲染镜像世界（位置指数平滑、特效本地重建、音效事件随快照下发）。服务器只做房间配对与消息转发，**不解析游戏内容**。
- 游戏模式四种：`'1p'` / `'2p'` / `'net-host'` / `'net-client'`（`game.mode`）。双人规则：命数与升级按人独立，道具谁捡归谁。

## 代码风格约定

- **注释、日志、用户可见文本一律使用简体中文**（每个文件开头都有一行中文注释说明职责），写代码时请延续这一约定。
- ES Module（`"type": "module"`），命名：`PascalCase` 类、`camelCase` 函数/变量、`UPPER_SNAKE` 常量。
- 无 lint / formatter 配置；风格以现有代码为准：2 空格缩进、单引号、行尾分号、简短的行内中文注释解释意图。
- 遵循「最小改动」原则：本项目无框架、无抽象层，优先复用 `core/const.js` 常量和现有模式，不要引入构建工具或新依赖。

## 测试

- 唯一测试是 `test/smoke.mjs`（`npm test`），Node 直接运行：stub 浏览器 API（Canvas 2D、WebAudio、localStorage、rAF、键盘事件），驱动**真实游戏逻辑**做端到端验证。
- 覆盖：场景流转、全部关卡的出怪点畅通与连通性（BFS 防孤岛回归）、移动/射击、地形破坏规则、六种道具效果、围墙恢复避让、拐角辅助、60 秒混战稳定性、失败流程、本地双人规则、联网快照同步、联网会话端到端（内存管道双端对跑）、服务器集成（真实子进程跑 `server/server.js`，验证建房/加入/转发/断开/超限消息）。
- 当前基线：**约 100 通过，0 失败**（混战随机路径会让用例数小幅浮动，属正常）。提交改动前必须运行 `npm test` 保持全绿；新增玩法规则时按现有 `check(name, cond)` 模式补用例。
- 测试里有多处针对历史 bug 的回归注释（如关卡封死出怪点、第 6 关河流孤岛）——修改关卡数据或地形逻辑时特别留意。

## 部署

两条正式部署路径，二选一（也可并存）：

- **Docker / VPS**：根目录自带 `Dockerfile`（node:20-alpine + 生产依赖）：`docker build -t tank . && docker run -d -p 8000:8000 --restart unless-stopped tank`；也可直接 `npm install && npm start`（Node 18+）。同一进程同时托管静态文件与 WebSocket，客户端默认连同源地址（`net/client.js` 的 `defaultServerUrl()`，可被 URL 参数 `?server=ws://…` 或 localStorage `tank_server` 覆盖，用于页面与服务器分离托管）。
- **Cloudflare Worker（serverless）**：`worker/index.js`（Workers 静态托管 + Durable Object 房间中继，与 `server/server.js` 同一房间协议，客户端零改动）。`wrangler.toml` 定义配置，`worker/build-public.mjs` 把 `index.html` + `src/` 拷到 `public/`（构建产物，不入库）。推送 main 分支由 `.github/workflows/deploy-worker.yml` 自动部署（需仓库 secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`）。
- 详细公网部署步骤（VPS / nginx+HTTPS / 内网穿透 / Cloudflare Worker）见 `README.zh-CN.md`「公网部署」。
- 服务器环境变量：`PORT`、`TLS_CERT`/`TLS_KEY`（同时设置则启用 HTTPS/WSS）、`MAX_CONN_PER_IP`（默认 20）、`ROOM_IDLE_MINUTES`（默认 30）。
- 最高分与关卡进度存在浏览器 localStorage（键：`tank_hiscore`、`tank_unlock_stage`）。

## 安全注意事项

- 服务器静态文件服务已限制在项目根目录内（`server.js` 中的路径穿越检查），修改该文件时不得削弱此防护。
- 服务器对中继消息只做 JSON 解析与原样转发，不要在其中加入游戏逻辑（Cloudflare 版 Durable Object 同理）。
- 公网加固已内置：30s 心跳终止沉默连接、空闲房间超时回收、每 IP 连接数上限、`maxPayload` 64KB——修改 `server.js` 或 `worker/index.js` 时不得移除这些限制。
- 房间码仅 4 位数字、无鉴权，设计用途是局域网/好友对战；不要把它当作安全边界。
