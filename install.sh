#!/usr/bin/env bash
# Telegram Notifier - 1-Liner Installer for Linux & macOS
# Usage: curl -fsSL https://raw.githubusercontent.com/alhinawi/telegram-notifier/main/install.sh | bash

set -e
echo ""
echo "🚀 Initializing Telegram Notifier Setup..."

TEMP_DIR=$(mktemp -d 2>/dev/null || mktemp -d -t 'telegram-notifier')
trap "rm -rf '$TEMP_DIR'" EXIT

echo "📦 Downloading latest files..."
git clone https://github.com/alhinawi/telegram-notifier.git "$TEMP_DIR" --depth 1 -q
cd "$TEMP_DIR"
node scripts/setup.js
