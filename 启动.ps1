# 数独 · 一键启动
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

$port = 8731
$url = "http://127.0.0.1:$port/index.html"

# 端口已被占用时直接开浏览器
$busy = $false
try {
    $null = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
    $busy = $true
} catch { $busy = $false }

if ($busy) {
    Write-Host "检测到数独服务已在运行，直接打开。" -ForegroundColor Green
    Start-Process $url
    exit 0
}

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command py -ErrorAction SilentlyContinue }

if ($python) {
    Write-Host "正在启动本地服务…" -ForegroundColor Cyan
    $args = if ($python.Name -eq 'py.exe') { @('-3', 'serve.py', "$port") } else { @('serve.py', "$port") }
    Start-Process -FilePath $python.Source -ArgumentList $args -WorkingDirectory $PSScriptRoot -WindowStyle Minimized
} else {
    Write-Host "没找到 Python，改为以文件方式打开（图片识别将不可用）。" -ForegroundColor Yellow
    Start-Process (Join-Path $PSScriptRoot 'index.html')
    exit 0
}

Start-Sleep -Milliseconds 1200
Start-Process $url
Write-Host "已在浏览器打开 $url" -ForegroundColor Green
