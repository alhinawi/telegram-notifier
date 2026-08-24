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
const os = require('os');

// Helper to find .env file across potential locations (local project, script parent, or global plugin dir)
function loadEnv() {
  const env = { ...process.env };
  const homeDir = os.homedir();
  const possiblePaths = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(__dirname, '..', '.env'),
    path.join(homeDir, '.gemini', 'config', 'plugins', 'telegram-notifier', '.env'),
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
        // silently continue to next possible location
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
  console.error('Run `npm run setup` to configure your credentials interactively.');
  process.exit(1);
}

// Parse command line arguments
// Usage: node notify.js --type=[task_finished|approval_required|error] --title="Title" --message="Details" --project="Project Name" --lang="en|ar-eg|ar"
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

const rawType = (params.type || 'info').toLowerCase();
const lang = (params.lang || env.NOTIFICATION_LANGUAGE || 'en').toLowerCase();

// Language and Preset Localization Dictionary
const LOCALES = {
  en: {
    task_finished: { title: 'Task Finished', emoji: '✅', label: 'Task Finished' },
    approval_required: { title: 'Approval Required', emoji: '⚠️', label: 'Approval Required' },
    error: { title: 'Error Occurred', emoji: '❌', label: 'Error Occurred' },
    info: { title: 'Notification', emoji: 'ℹ️', label: 'Notification' },
    alert: { title: 'Alert', emoji: '🔔', label: 'Alert' },
  },
  'ar-eg': {
    task_finished: { title: 'خلصت يا معلم', emoji: '✅', label: 'تمت المهمة' },
    approval_required: { title: 'محتاج اذنك يا معلم', emoji: '⚠️', label: 'مطلوب إذنك' },
    error: { title: 'فيه مشكلة يا معلم', emoji: '❌', label: 'حدث خطأ' },
    info: { title: 'إشعار', emoji: 'ℹ️', label: 'إشعار' },
    alert: { title: 'تنبيه', emoji: '🔔', label: 'تنبيه' },
  },
  ar: {
    task_finished: { title: 'اكتملت المهمة بنجاح', emoji: '✅', label: 'اكتملت المهمة' },
    approval_required: { title: 'مطلوب مراجعة وتأكيد', emoji: '⚠️', label: 'مطلوب الموافقة' },
    error: { title: 'حدث خطأ أثناء التنفيذ', emoji: '❌', label: 'حدث خطأ' },
    info: { title: 'إشعار', emoji: 'ℹ️', label: 'إشعار' },
    alert: { title: 'تنبيه', emoji: '🔔', label: 'تنبيه' },
  },
};

const activeLocale = LOCALES[lang] || LOCALES.en;

// Normalize event type key
let normalizedKey = 'info';
if (['finish', 'task_finish', 'task_finished', 'task_complete', 'task_completed', 'success', 'done'].includes(rawType)) {
  normalizedKey = 'task_finished';
} else if (['approval', 'approval_required', 'approval_needed', 'feedback', 'prompt', 'ask'].includes(rawType)) {
  normalizedKey = 'approval_required';
} else if (['error', 'failed', 'exception', 'failure', 'bug'].includes(rawType)) {
  normalizedKey = 'error';
}

const config = activeLocale[normalizedKey] || activeLocale.info;
const headerEmoji = config.emoji;
const eventLabel = config.label;
const title = params.title || config.title;
const message = params.message || params.text || '';
const project = params.project || path.basename(process.cwd()) || 'Project';

const now = new Date().toLocaleString();

// Construct message text using Markdown formatting
const telegramText = [
  `${headerEmoji} *[${eventLabel}]* \`${project}\``,
  `*${title}*`,
  message ? `\n${message}` : '',
  `\n🕒 _${now}_`,
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
