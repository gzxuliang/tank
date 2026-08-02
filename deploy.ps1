# ============================================================
# Tank Battle one-click deploy script (PowerShell / Windows)
# Usage:
#   powershell -ExecutionPolicy Bypass -File deploy.ps1
#     -> interactive: pick a cached server or enter a new one
#   powershell -ExecutionPolicy Bypass -File deploy.ps1 -Server root@1.2.3.4 -Port 9000
#     -> one-shot, no prompt (nothing cached)
#
# Cached servers are stored in %APPDATA%\TankDeploy\servers.json
# (user profile dir, never committed to the repo).
# Build the image locally (docker save), upload it to the server,
# then load & run it there. The server never builds or pulls any
# external dependency - only this machine needs network access.
# ============================================================
param(
    [string]$Server = "",   # one-shot override, skips the picker
    [int]$Port     = 0
)

$ErrorActionPreference = 'Stop'
$ImageName    = "tank"
$Container    = "tank"
$TempDir      = Join-Path $env:TEMP "tank-deploy"
$LocalTar     = Join-Path $TempDir "tank-image.tar"
$LocalTarGz   = "$LocalTar.gz"
$RemoteTar    = "/tmp/tank-image.tar.gz"

# ---------- cached server list ----------
$CacheDir   = Join-Path $env:APPDATA "TankDeploy"
$CacheFile  = Join-Path $CacheDir "servers.json"
$cache = @()
if (Test-Path $CacheFile) {
    try { $cache = @(Get-Content $CacheFile -Raw | ConvertFrom-Json) } catch { $cache = @() }
}
$NewName = ""

# ---------- target selection ----------
if (-not $Server) {
    Write-Host ""
    Write-Host "=== Deploy target ==="
    $n = 0
    foreach ($entry in $cache) {
        $n++
        Write-Host ("  [{0}] {1}  ({2}:{3})" -f $n, $entry.name, $entry.server, $entry.port)
    }
    $n++
    Write-Host ("  [{0}] Enter a new server" -f $n)
    $choice = Read-Host ("Select [1-{0}]" -f $n)
    $choiceNum = 0
    if (-not [int]::TryParse($choice, [ref]$choiceNum) -or $choiceNum -lt 1 -or $choiceNum -gt $n) {
        Write-Host "Invalid selection."
        exit 1
    }
    if ($choiceNum -lt $n) {
        $entry = $cache[$choiceNum - 1]
        $Server = $entry.server
        $Port   = [int]$entry.port
    } else {
        $NewName = Read-Host "Name (optional, e.g. my-vps)"
        $Server  = Read-Host "Server (user@host)"
        $portStr = Read-Host "Public port"
        if (-not $Server -or -not [int]::TryParse($portStr, [ref]$Port) -or $Port -le 0) {
            Write-Host "Invalid server or port."
            exit 1
        }
        if (-not $NewName) { $NewName = $Server }
    }
}
if (-not $Server -or $Port -le 0) {
    Write-Host "No deploy target. Pass -Server/-Port or pick one from the menu."
    exit 1
}

Write-Host ""
Write-Host ("Deploying to {0}:{1} ..." -f $Server, $Port)

# ---------- 1. build locally ----------
Write-Host "==> [1/5] Build image locally: $ImageName"
docker build -t $ImageName .

# ---------- 2. export & compress ----------
Write-Host "==> [2/5] Export and compress image"
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
docker save -o $LocalTar $ImageName
$in  = [System.IO.File]::OpenRead($LocalTar)
$out = [System.IO.File]::Create($LocalTarGz)
$gz  = New-Object System.IO.Compression.GzipStream($out, [System.IO.Compression.CompressionMode]::Compress)
$in.CopyTo($gz)
$gz.Dispose(); $out.Dispose(); $in.Dispose()
Remove-Item $LocalTar
Write-Host ("    image size: {0:N0} KB" -f ((Get-Item $LocalTarGz).Length / 1KB))

# ---------- 3. upload ----------
Write-Host "==> [3/5] Upload to $Server"
scp $LocalTarGz "${Server}:${RemoteTar}"

# ---------- 4. load on server ----------
Write-Host "==> [4/5] Load image on server"
ssh $Server "docker load -i $RemoteTar"

# ---------- 5. start container & verify ----------
Write-Host "==> [5/5] Start container (public port ${Port} -> container 8000)"
ssh $Server "docker rm -f $Container 2>/dev/null; docker run -d --name $Container -p ${Port}:8000 --restart unless-stopped $ImageName && sleep 2 && curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://localhost:${Port}/ && docker ps --filter name=$Container --format '{{.Names}} {{.Status}} {{.Ports}}'"

Remove-Item -Recurse -Force $TempDir

# ---------- cache the target (only after successful deploy) ----------
if ($NewName) {
    New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
    $existing = @($cache | Where-Object { $_.server -eq $Server -and $_.port -eq $Port })
    if ($existing) {
        $cache = @($cache | ForEach-Object {
            if ($_.server -eq $Server -and $_.port -eq $Port) {
                [pscustomobject]@{ name = $NewName; server = $_.server; port = $_.port; updatedAt = (Get-Date).ToString('s') }
            } else { $_ }
        })
    } else {
        $cache += [pscustomobject]@{ name = $NewName; server = $Server; port = $Port; updatedAt = (Get-Date).ToString('s') }
    }
    $cache | ConvertTo-Json | Set-Content $CacheFile -Encoding UTF8
}

Write-Host "==> Done"
Write-Host "    URL: http://<server-ip>:${Port}"
Write-Host "    If unreachable, open TCP ${Port} in the cloud firewall"
