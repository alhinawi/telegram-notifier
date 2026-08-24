#!/usr/bin/env node

/**
 * Universal Telegram Notifier Script
 * Sends formatted Telegram alerts when:
 * 1. A task finishes
 * 2. User approval is required
 * 3. An error occurs
 *
 * Works with any AI Agent, CLI tool, or automated pipeline.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Helper to load .env file from script parent dir or current working dir
function loadEnv() {
  const env = { ...process.env };
  const possiblePaths = [
    path.resolve(__dirname, '..', '.env'),
    path.resolve(process.cwd(), '.env')
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
      } catch (err) {
        console.error(`[Telegram Notifier] Error reading .env (${envPath}): ${err.message}`);
      }
    }
  }
  return env;
}

const env = loadEnv();
const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN || !CHAT_ID) {
  console.error('[Telegram Notifier] Error: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in .env or environment variables.');
  process.exit(1);
}

// Parse command line arguments
// Usage: node notify.js --type=[task_finished|approval_required|error] --title="Title" --message="Details" --project="Project Name"
const args = process.argv.slice(2);
const params = {};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith('--')) {
    const eqIdx = arg.indexOf('=');
    if (eqIdx !== -1) {
      const key = arg.slice(2, eqIdx);
      const val = arg.slice(eqIdx + 1);
      params[key] = val;
    } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
      const key = arg.slice(2);
      params[key] = args[i + 1];
      i++;
    } else {
      params[arg.slice(2)] = true;
    }
  }
}

const type = (params.type || 'info').toLowerCase();
const title = params.title || 'Notification';
const message = params.message || params.text || '';
const project = params.project || path.basename(process.cwd()) || 'General Project';

// Format emoji and header based on event type
let headerEmoji = 'ℹ️';
let eventLabel = 'Notification';

switch (type) {
  case 'finish':
  case 'task_finish':
  case 'task_finished':
  case 'task_complete':
  case 'task_completed':
  case 'success':
    headerEmoji = '✅';
    eventLabel = 'Task Finished';
    break;

  case 'approval':
  case 'approval_required':
  case 'approval_needed':
  case 'feedback':
  case 'prompt':
    headerEmoji = '⚠️';
    eventLabel = 'Approval Required';
    break;

  case 'error':
  case 'failed':
  case 'exception':
  case 'alert':
    headerEmoji = '❌';
    eventLabel = 'Error Occurred';
    break;

  default:
    headerEmoji = '🔔';
    eventLabel = 'Alert';
    break;
}

const now = new Date().toLocaleString();

// Construct message text using Markdown formatting
const telegramText = [
  `${headerEmoji} *[${eventLabel}]* \`${project}\``,
  `*${title}*`,
  message ? `\n${message}` : '',
  `\n🕒 _${now}_`
].join('\n');

function sendTelegramMessage(text) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      chat_id: CHAT_ID,
      text: text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });

    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${BOT_TOKEN}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
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
            console.log(`[Telegram Notifier] Notification sent successfully (${eventLabel}).`);
            resolve(parsed);
          } else {
            console.error(`[Telegram Notifier] Telegram API error:`, parsed.description);
            reject(new Error(parsed.description));
          }
        } catch (e) {
          console.error(`[Telegram Notifier] Failed to parse response:`, data);
          reject(e);
        }
      });
    });

    req.on('error', (e) => {
      console.error(`[Telegram Notifier] Network error:`, e.message);
      reject(e);
    });

    req.write(payload);
    req.end();
  });
}

sendTelegramMessage(telegramText)
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
