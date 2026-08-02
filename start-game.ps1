# Tank Battle local launcher (PowerShell / Windows)
# Usage: powershell -ExecutionPolicy Bypass -File start-game.ps1
# Or right-click -> Run with PowerShell (if policy allows)

Set-Location $PSScriptRoot

Write-Host "Starting Tank Battle server..."
Write-Host "Open: http://localhost:8000"
Write-Host "LAN play: http://<this-machine-ip>:8000"
Write-Host "Press Ctrl+C to stop the server"

Start-Process "http://localhost:8000"
node server/server.js

Write-Host ""
Write-Host "Server stopped."
Read-Host "Press Enter to close"
