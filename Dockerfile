# 坦克大战一体化服务器镜像：静态页面 + WebSocket 房间中继
FROM node:20-alpine

WORKDIR /app

# 只装生产依赖（ws）
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 页面与游戏源码
COPY index.html ./
COPY src ./src
COPY server ./server

ENV PORT=8000
EXPOSE 8000

CMD ["node", "server/server.js"]
