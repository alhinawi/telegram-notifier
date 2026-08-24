param(
    [string]$Type = "info",
    [string]$Title = "Notification",
    [string]$Message = "",
    [string]$Project = (Split-Path -Leaf (Get-Location))
)

$ErrorActionPreference = "Stop"

$PluginDir = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $PluginDir ".env"

$BotToken = $env:TELEGRAM_BOT_TOKEN
$ChatId = $env:TELEGRAM_CHAT_ID

if (Test-Path $EnvFile) {
    Get-Content $EnvFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#")) {
            $eqIdx = $line.IndexOf("=")
            if ($eqIdx -gt 0) {
                $key = $line.Substring(0, $eqIdx).Trim()
                $val = $line.Substring($eqIdx + 1).Trim()
                if ($key -eq "TELEGRAM_BOT_TOKEN" -and -not $BotToken) { $BotToken = $val }
                if ($key -eq "TELEGRAM_CHAT_ID" -and -not $ChatId) { $ChatId = $val }
            }
        }
    }
}

if (-not $BotToken -or -not $ChatId) {
    Write-Error "[Telegram Notifier] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in .env"
    exit 1
}

$Emoji = "🔔"
$EventLabel = "Notification"

switch ($Type.ToLower()) {
    { $_ -in "finish", "task_finish", "task_finished", "task_complete", "task_completed", "success" } {
        $Emoji = "✅"
        $EventLabel = "Task Finished"
    }
    { $_ -in "approval", "approval_required", "approval_needed", "feedback", "prompt" } {
        $Emoji = "⚠️"
        $EventLabel = "Approval Required"
    }
    { $_ -in "error", "failed", "exception", "alert" } {
        $Emoji = "❌"
        $EventLabel = "Error Occurred"
    }
}

$Timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
$TelegramText = "$Emoji *[$EventLabel]* ``$Project```n*$Title*"
if ($Message) {
    $TelegramText += "`n$Message"
}
$TelegramText += "`n`n🕒 _$Timestamp_"

$Body = @{
    chat_id = $ChatId
    text = $TelegramText
    parse_mode = "Markdown"
    disable_web_page_preview = $true
} | ConvertTo-Json

$Uri = "https://api.telegram.org/bot$BotToken/sendMessage"

try {
    $Response = Invoke-RestMethod -Uri $Uri -Method Post -Body $Body -ContentType "application/json; charset=utf-8"
    if ($Response.ok) {
        Write-Host "[Telegram Notifier] Sent Telegram notification ($EventLabel)."
    } else {
        Write-Error "[Telegram Notifier] Failed: $($Response.description)"
    }
} catch {
    Write-Error "[Telegram Notifier] Error: $($_.Exception.Message)"
}
