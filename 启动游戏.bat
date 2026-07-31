@echo off
chcp 65001
cd /d %~dp0
echo 正在启动坦克大战服务器...
echo 浏览器打开: http://localhost:8000
echo 局域网对战: 让好友打开 http://^<本机IP^>:8000
echo 按 Ctrl+C 停止服务器
start "" http://localhost:8000
node server/server.js
pause
