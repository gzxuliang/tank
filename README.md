# 坦克大战 Battle City

红白机（FC）经典《坦克大战》的网页复刻版。原生 JavaScript + Canvas 实现，所有像素美术由代码程序化绘制，所有音效由 WebAudio 实时合成。支持**单人**、**本地双人**与**联网双人**合作闯关。

## 启动方式

Windows 下直接运行（自动打开浏览器并启动服务器）：

```powershell
powershell -ExecutionPolicy Bypass -File start-game.ps1
```

或在项目目录下运行：

```bash
npm install
npm start
```

然后浏览器打开 <http://localhost:8000>。

> 服务器只有一个 `ws` 依赖，同时托管静态页面并运行权威对局。
> 局域网对战：好友浏览器直接打开 `http://<你的IP>:8000`。

## 公网部署

联机走同一台 Node 服务器（静态页面 + WebSocket + 权威对局同端口）。服务器已做公网加固：心跳清理死连接、空闲房间超时回收、每 IP 连接数限制、64KB 消息上限。

### 方式一：云 VPS（推荐）

**环境要求**：Node.js 18+（建议 20 LTS）、512MB 内存即可；唯一依赖是 `ws`。

```bash
git clone <本仓库> && cd tank
npm install
npm start          # 或 PORT=80 npm start
```

防火墙/安全组放行对应端口后，好友浏览器打开 `http://<服务器IP>:<端口>` 即可。常驻运行可用 pm2（`pm2 start server/server.js --name tank`）或 systemd。

**Docker（推荐，Windows 本机打包上传）**：项目自带 `Dockerfile`（node:20-alpine + 生产依赖）。在 Windows 开发机上一键部署：

```powershell
powershell -ExecutionPolicy Bypass -File deploy.ps1
```

脚本默认交互式：先列出之前缓存过的服务器（缓存存于 `%APPDATA%\TankDeploy\servers.json`，部署成功后自动写入，不提交仓库），可选择复用或录入新服务器；也可用参数跳过交互：

```powershell
powershell -ExecutionPolicy Bypass -File deploy.ps1 -Server root@1.2.3.4 -Port 9000
```

容器对外端口需在云服务器安全组放行对应 TCP 端口后外网可访问。

> 服务器上手动构建同样可行：`git clone <本仓库> && docker build -t tank . && docker run -d --name tank -p 8000:8000 --restart unless-stopped tank`，但要求服务器能访问 npm/Docker Hub。

可用环境变量：`PORT`（端口，默认 8000）、`MAX_CONN_PER_IP`（每 IP 连接上限，默认 20）、`ROOM_IDLE_MINUTES`（空闲房间存活分钟数，默认 30）、`TLS_CERT`/`TLS_KEY`（HTTPS/WSS 证书）。Docker 下用 `-e PORT=8000` 形式传入。

### 方式二：域名 + HTTPS

用域名访问且启用 HTTPS 时，WebSocket 会升级为 WSS。两种做法：

- nginx 反代（配合 certbot 签证书），反代时带上 WebSocket 升级头：
  `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`
- 或直接让 Node 加载证书：`TLS_CERT=/path/fullchain.pem TLS_KEY=/path/privkey.pem npm start`

### 方式三：无公网 IP —— 内网穿透

本机跑着游戏，用 frp、cloudflared tunnel 等工具把 8000 端口暴露出去，好友访问穿透后的地址即可，无需改代码。

### 页面与服务器分离（可选）

页面可以托管在别处（如 GitHub Pages），通过 URL 参数指定 Node 权威服务器：

```
https://<页面地址>/?server=wss://<服务器地址>
```

地址合法时会记住在 localStorage（`tank_server`），之后免参数直连；大厅界面底部会显示当前连接的服务器。

## 操作

| 玩家 | 移动 | 射击 |
| --- | --- | --- |
| P1（黄） | 光标键（方向键） | 空格 / J |
| P2（绿） | W A S D | F |

通用：Enter 确认 · P 暂停 · M 静音（菜单统一由 P1 操作）

## 模式

- **单人游戏**：经典一人守基地
- **本地双人**：同键盘合作，P1 方向键、P2 WASD
- **联网对战**：一人创建房间得 4 位房间码，好友输入房间码加入；房主为 P1、加入者为 P2

双人规则（仿 FC 原版）：两人各自独立命数与升级，道具谁捡归谁；一人阵亡另一人继续战斗，全员命数耗尽或基地被毁才判负；过关结算按 P1/P2 分列击毁统计。

## 玩法（忠于 FC 原版）

- **目标**：保卫底部老鹰基地，歼灭每关 20 辆敌方坦克；基地被毁或命数耗尽则游戏结束
- **地形**：砖墙（可被子弹逐块打穿）/ 钢墙（三星后可击穿）/ 草丛（隐蔽）/ 水面（挡车不挡弹）/ 冰面（打滑）
- **敌方坦克 4 型**：普通 / 快速 / 火力 / 装甲（4 段变色）
- **闪光红坦**：击毁掉落随机道具——⭐升级 · 🛡无敌 · 💣清屏 · 🚜加命 · 🔧基地钢墙 · ⏱冻结敌坦
- **升级**：吃星三级强化——快速弹 → 同屏双弹 → 击穿钢墙（跨关保留）
- **流程**：标题 → 关卡开幕 → 战斗 → 战果结算 → 下一关，共 10 个手工设计关卡
- 最高分与关卡进度自动保存（localStorage）

## 技术要点

- 固定时间步长主循环（60Hz）+ 场景栈（标题/大厅/开幕/战斗/结算/结束）
- 26×26 格地图，砖墙 1/4 格精细破坏；分层渲染（草丛遮挡坦克）
- 程序化像素图集：坦克履带动画、水面波纹、出生法阵、护盾气泡
- 打击感：爆炸粒子、屏幕震动、顿帧（hit-stop）、受击白闪、得分飘字
- WebAudio 合成全套 8-bit 音效与标题 BGM
- 联机：**服务器权威 + 客户端预测 + 权威纠偏**——Node 服务端 60Hz 运行完整世界、30Hz 发送快照；
  两端浏览器都立即预测自己的移动和开火，只在预测与权威结果不一致时重放未确认输入；
  远端实体采用 4～10 帧自适应插值，服务端按玩家看到的历史帧判定子弹命中

## 目录结构

```
src/
├── main.js            # 入口
├── core/              # 引擎：主循环/场景栈/输入(双键位表+NetInput)/音频/像素图集/文字
├── scenes/            # 场景：标题/大厅/开幕/战斗/结算/结束
├── game/              # 玩法：世界/地形/坦克/敌坦AI/子弹/道具/关卡
├── net/               # 联机：WebSocket 客户端/双端统一会话/快照同步
└── fx/                # 特效：粒子/爆炸震动/飘字
server/
├── server.js          # Node 入口：静态托管 + WebSocket
├── runtime/           # 可复用实时对局内核
└── games/             # 游戏适配器（坦克规则）
test/
├── smoke.mjs          # 本地玩法与快照冒烟测试
└── net-v2.mjs         # 延迟抖动、恢复连接和真实服务器测试
```

运行测试：

```bash
npm test
```
