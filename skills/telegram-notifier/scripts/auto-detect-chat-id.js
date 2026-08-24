#!/usr/bin/env node

/**
 * Auto-detects your personal Telegram Chat ID from recent messages sent to your bot,
 * and updates .env automatically.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const envPath = path.resolve(__dirname, '..', '.env');

function getBotToken() {
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('TELEGRAM_BOT_TOKEN=')) {
        return trimmed.substring('TELEGRAM_BOT_TOKEN='.length).trim();
      }
    }
  }
  return null;
}

const botToken = getBotToken();
if (!botToken || botToken === 'your_bot_token_here') {
  console.error('[Telegram Notifier] TELEGRAM_BOT_TOKEN is missing or set to placeholder in .env');
  console.error('Please open .env and set TELEGRAM_BOT_TOKEN first.');
  process.exit(1);
}

console.log('Fetching latest updates from Telegram Bot API...');

https.get(`https://api.telegram.org/bot${botToken}/getUpdates`, (res) => {
  let data = '';
  res.on('data', (c) => (data += c));
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      if (!json.ok) {
        console.error('[Telegram Notifier] Telegram API error:', json.description);
        process.exit(1);
      }

      const updates = json.result || [];
      if (updates.length === 0) {
        console.log('⚠️ No recent messages found yet.');
        console.log('👉 Please open Telegram, search for your bot, send /start or any message, then re-run this command:');
        console.log('   npm run detect-chat-id');
        process.exit(2);
      }

      // Get latest message
      const latest = updates[updates.length - 1];
      const msg = latest.message || latest.channel_post || latest.callback_query?.message;
      if (!msg || !msg.chat || !msg.chat.id) {
        console.error('Could not find chat ID in latest update.');
        process.exit(1);
      }

      const chatId = msg.chat.id.toString();
      const sender = msg.from ? `${msg.from.first_name || ''} (@${msg.from.username || 'unknown'})` : 'User';
      console.log(`✅ Detected message from ${sender}!`);
      console.log(`🔑 Chat ID: ${chatId}`);

      // Update .env
      let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
      if (content.includes('TELEGRAM_CHAT_ID=')) {
        content = content.replace(/TELEGRAM_CHAT_ID=.*/g, `TELEGRAM_CHAT_ID=${chatId}`);
      } else {
        content += `\nTELEGRAM_CHAT_ID=${chatId}\n`;
      }
      fs.writeFileSync(envPath, content, 'utf8');
      console.log(`🎉 Successfully updated TELEGRAM_CHAT_ID in ${envPath}`);
    } catch (e) {
      console.error('Error processing updates:', e.message);
      process.exit(1);
    }
  });
}).on('error', (e) => {
  console.error('Network error:', e.message);
  process.exit(1);
});
