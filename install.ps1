# Telegram Notifier - 1-Liner Installer for Windows PowerShell
# Usage: irm https://raw.githubusercontent.com/alhinawi/telegram-notifier/main/install.ps1 | iex

$ErrorActionPreference = "Stop"
Write-Host "`n🚀 Initializing Telegram Notifier Setup..." -ForegroundColor Cyan

$TempDir = Join-Path $env:TEMP "telegram-notifier-setup"
if (Test-Path $TempDir) {
    Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}

try {
    Write-Host "📦 Downloading latest files..." -ForegroundColor Gray
    git clone https://github.com/alhinawi/telegram-notifier.git $TempDir --depth 1 -q
    Set-Location $TempDir
    node scripts/setup.js
} catch {
    Write-Error "Setup failed: $($_.Exception.Message)"
} finally {
    if (Test-Path $TempDir) {
        # Keep temp files clean
        Remove-Item $TempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
