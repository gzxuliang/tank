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

- 启动后浏览器打开 <http://localhost:8000>；Windows 下可运行 `powershell -ExecutionPolicy Bypass -File start-game.ps1`（自动打开浏览器并启动服务器）。
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
│   ├── session.js     # 双端统一会话：预测、纠偏、插值、断线恢复
│   └── sync.js        # 权威快照序列化/应用、地形同步、位置插值
└── fx/                # 特效：粒子、爆炸/震屏、飘字
server/
├── server.js          # Node 入口：静态托管 + WebSocket
├── runtime/           # 通用实时对局内核：房间、席位、输入、帧循环、快照、恢复
└── games/             # 游戏适配器；tank-match.js 驱动真实 World 逻辑
test/
├── smoke.mjs          # 本地玩法与快照冒烟测试
└── net-v2.mjs         # 服务端权威、高延迟抖动、恢复连接和真实服务器测试
```

### 关键架构约定

- **全局上下文 `game`**：在 `main.js` 中组装的普通对象（引擎、音频、资源、输入、模式、分数、命数等），场景与实体通过它协作。`window.__tank` 暴露该句柄供调试与测试。
- **逻辑分辨率 256×224**（仿 FC），渲染层放大 3 倍到 768×672（`SCALE`）。场景内全部用逻辑坐标作画。
- **固定时间步长主循环**：60Hz 逻辑帧，每帧最多追 4 帧，帧计数与计时一律以帧（60fps）为单位，常量集中在 `core/const.js`。
- **场景栈**：`engine.changeScene(scene)` 切换；场景可带 `enter/exit/update/render/renderText` 方法。
- **联机采用「服务器权威 + 客户端预测 + 权威纠偏」**：Node 服务端以 60Hz 运行完整世界，每 2 帧（30Hz）发送快照。两个浏览器只发送带序号的输入，立即预测自己的移动与开火；快照的 `ack` 只确认服务端真正执行过的输入，预测不一致时才回到权威状态并重放未确认输入。远端实体使用 4～10 帧自适应插值，子弹命中按客户端看到的服务端帧做延迟补偿。双方全灭后房间保留，双方确认即可重开当前关卡。
- **服务端分层**：`server/runtime/realtime-service.js` 是可复用的实时对局内核，只负责房间、席位、输入队列、固定帧、快照、断线恢复；具体玩法由 `GameDefinition` 适配器提供，坦克规则位于 `server/games/tank-match.js`。
- 游戏模式三种：`'1p'` / `'2p'` / `'net'`（`game.mode`）。双人规则：命数与升级按人独立，道具谁捡归谁。

## 代码风格约定

- **注释、日志、用户可见文本一律使用简体中文**（每个文件开头都有一行中文注释说明职责），写代码时请延续这一约定。
- ES Module（`"type": "module"`），命名：`PascalCase` 类、`camelCase` 函数/变量、`UPPER_SNAKE` 常量。
- 无 lint / formatter 配置；风格以现有代码为准：2 空格缩进、单引号、行尾分号、简短的行内中文注释解释意图。
- 遵循「最小改动」原则：本项目无框架、无抽象层，优先复用 `core/const.js` 常量和现有模式，不要引入构建工具或新依赖。

## 测试

- `npm test` 依次运行 `test/smoke.mjs` 与 `test/net-v2.mjs`，Node 直接驱动真实玩法和联机逻辑。
- 覆盖：场景流转、关卡连通性、移动/射击、地形与道具、本地双人、阵亡坦克隐藏、转向防重叠、快照同步、通用对局运行时、250ms 往返延迟与 60ms 抖动、移动不倒退、开火精确一次、同房间重开、跨关/重开后输入与开火序号延续、阶段间隙队列清空防漂移、30 秒恢复/超时单人继续，以及真实 `server/server.js` 协议与 64KB 上限。
- 当前基线：**128 通过，0 失败**。提交改动前必须运行 `npm test` 保持全绿；新增玩法或协议规则时按现有 `check(name, cond)` 模式补用例。
- 测试里有多处针对历史 bug 的回归注释（如关卡封死出怪点、第 6 关河流孤岛）——修改关卡数据或地形逻辑时特别留意。

## 部署

- **本机打包 → 服务器运行（推荐，Windows）**：`deploy.ps1` 本机构建镜像、`docker save` 压缩上传、服务器 `docker load` 后启动容器；服务器不构建、不拉取任何外部依赖（科学上网只需开发机）。脚本交互式选择：可挑选之前缓存过的服务器（存于 `%APPDATA%\TankDeploy\servers.json`，不提交仓库）或录入新服务器；也可用参数跳过交互：`powershell -ExecutionPolicy Bypass -File deploy.ps1 -Server user@host -Port <port>`。容器以 `--restart unless-stopped` 运行。
- **服务器直装**：根目录自带 `Dockerfile`（node:20-alpine + 生产依赖）：`docker build -t tank . && docker run -d -p 8000:8000 --restart unless-stopped tank`；也可直接 `npm install && npm start`（Node 18+）。同一进程托管静态文件、WebSocket 和权威对局。页面可用 `?server=ws://…` 指定独立服务器。
- 详细公网部署步骤见 `README.md`「公网部署」。Cloudflare Worker 中继路径已移除，因为权威世界需要持续的 60Hz 进程。
- 服务器环境变量：`PORT`、`TLS_CERT`/`TLS_KEY`（同时设置则启用 HTTPS/WSS）、`MAX_CONN_PER_IP`（默认 20）、`ROOM_IDLE_MINUTES`（默认 30）。Docker 下用 `-e PORT=8000` 形式传入。
- 最高分与关卡进度存在浏览器 localStorage（键：`tank_hiscore`、`tank_unlock_stage`）。

## 安全注意事项

- 服务器静态文件服务采用**白名单**（仅 `/index.html` 与 `/src/` 可访问，其余一律 403）+ 路径穿越检查双重防护（`server.js` 中的 `onRequest`），防止 `.git`、`server/`、部署脚本、镜像包等仓库内敏感文件被 HTTP 下载；修改该文件时不得削弱这两层防护。
- 通用运行时不得直接引用坦克实体；游戏规则只能通过 `GameDefinition` 适配器接入。
- 公网加固已内置：30s 心跳终止沉默连接、空闲房间超时回收、每 IP 连接数上限、`maxPayload` 64KB——修改 `server.js` 时不得移除这些限制。
- 房间码仅 4 位数字、无鉴权，设计用途是局域网/好友对战；不要把它当作安全边界。
