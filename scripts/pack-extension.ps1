<#
.SYNOPSIS
    校验并打包 Edge 扩展，产物输出到 dist/fudan-login-monitor-<version>.zip
.DESCRIPTION
    只打包运行时需要的文件（manifest 位于 zip 根目录），不包含 README.md。
    打包前做静态检查：manifest 可解析、关键文件存在、JS 语法通过 node --check。
#>
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$ext = Join-Path $root 'edge-extension'
$manifestPath = Join-Path $ext 'manifest.json'

if (-not (Test-Path $manifestPath)) { throw "找不到 $manifestPath" }
$manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json

foreach ($file in $manifest.background.service_worker, $manifest.action.default_popup, $manifest.options_ui.page, 'options.js', 'popup.js') {
    $path = Join-Path $ext $file
    if (-not (Test-Path $path)) { throw "manifest 引用的文件不存在：$file" }
}

foreach ($icon in $manifest.icons.PSObject.Properties) {
    if (-not (Test-Path (Join-Path $ext $icon.Value))) { throw "缺少图标：$($icon.Value)" }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw '需要 node 做语法检查' }
Get-ChildItem $ext -Filter *.js | ForEach-Object {
    node --check $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "语法错误：$($_.Name)" }
}

$staging = Join-Path $env:TEMP 'opencode\fudan-ext-pack'
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Path $staging -Force | Out-Null

# README.md 供仓库阅读，不需要随包发布
Get-ChildItem $ext -File | Where-Object { $_.Name -ne 'README.md' } | Copy-Item -Destination $staging

$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Path $dist -Force | Out-Null
$zip = Join-Path $dist ('fudan-login-monitor-{0}.zip' -f $manifest.version)
if (Test-Path $zip) { Remove-Item $zip -Force }

Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $zip -CompressionLevel Optimal

Add-Type -AssemblyName System.IO.Compression.FileSystem
$entries = [System.IO.Compression.ZipFile]::OpenRead($zip).Entries.FullName
if ($entries -notcontains 'manifest.json') { throw 'zip 根目录缺少 manifest.json' }

Write-Host "已打包：$zip"
Write-Host ("版本 {0}，{1} 个文件，{2:N1} KB" -f $manifest.version, $entries.Count, ((Get-Item $zip).Length / 1KB))
$entries | Sort-Object | ForEach-Object { Write-Host "  $_" }
