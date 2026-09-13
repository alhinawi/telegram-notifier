/**
 * Telegram API Client (Zero-Dependency)
 * Uses native Node.js https module.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Helper to find and load .env file across potential locations
 */
function loadEnv(extraPaths = []) {
  const env = { ...process.env };
  const homeDir = os.homedir();
  const possiblePaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '..', '.env'),
    path.join(homeDir, '.gemini', 'config', 'plugins', 'telegram-notifier', '.env'),
    ...extraPaths,
  ];

  for (const envPath of possiblePaths) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf8');
        content.split(/\r?\n/).forEach((line) => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx !== -1) {
              const key = trimmed.slice(0, eqIdx).trim();
              const value = trimmed.slice(eqIdx + 1).trim();
              if (key && !env[key]) {
                env[key] = value;
              }
            }
          }
        });
      } catch {
        // Continue to next path
      }
    }
  }
  return env;
}

class TelegramClient {
  constructor(token) {
    this.token = token;
  }

  request(apiMethod, payload = {}) {
    return new Promise((resolve, reject) => {
      if (!this.token) {
        return reject(new Error('TELEGRAM_BOT_TOKEN is not configured'));
      }

      const body = JSON.stringify(payload);
      const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${this.token}/${apiMethod}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.ok) {
              resolve(parsed.result);
            } else {
              reject(new Error(parsed.description || `Telegram API error: ${res.statusCode}`));
            }
          } catch (e) {
            reject(new Error(`Failed to parse Telegram response: ${data.slice(0, 100)}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.write(body);
      req.end();
    });
  }

  getMe() {
    return this.request('getMe');
  }

  getUpdates(offset = null, timeout = 30, limit = 100, allowedUpdates = ['message', 'callback_query']) {
    const payload = { timeout, limit, allowed_updates: allowedUpdates };
    if (offset !== null) payload.offset = offset;
    return this.request('getUpdates', payload);
  }

  sendMessage(chatId, text, options = {}) {
    const payload = {
      chat_id: chatId,
      text: text,
      parse_mode: options.parse_mode !== undefined ? options.parse_mode : 'Markdown',
      disable_web_page_preview: options.disable_web_page_preview ?? true,
      ...options,
    };
    return this.request('sendMessage', payload);
  }

  sendMessageWithButtons(chatId, text, inlineKeyboard = [], options = {}) {
    return this.sendMessage(chatId, text, {
      ...options,
      reply_markup: {
        inline_keyboard: inlineKeyboard,
      },
    });
  }

  editMessageText(chatId, messageId, text, options = {}) {
    const payload = {
      chat_id: chatId,
      message_id: messageId,
      text: text,
      parse_mode: options.parse_mode !== undefined ? options.parse_mode : 'Markdown',
      disable_web_page_preview: options.disable_web_page_preview ?? true,
      ...options,
    };
    return this.request('editMessageText', payload);
  }

  answerCallbackQuery(callbackQueryId, text = '', showAlert = false) {
    const payload = {
      callback_query_id: callbackQueryId,
      text: text,
      show_alert: showAlert,
    };
    return this.request('answerCallbackQuery', payload);
  }

  setMyCommands(commands = []) {
    return this.request('setMyCommands', { commands });
  }
}

module.exports = {
  loadEnv,
  TelegramClient,
};
