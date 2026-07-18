@echo off
cd /d %~dp0
echo 正在启动坦克大战...
echo 请在浏览器中访问: http://localhost:8000
echo 按 Ctrl+C 停止服务器
start "" http://localhost:8000
python -m http.server 8000 || py -m http.server 8000
pause
