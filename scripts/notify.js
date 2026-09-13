#!/usr/bin/env node

/**
 * Universal Telegram Notifier Script
 * Sends formatted Telegram alerts when:
 * 1. A task finishes
 * 2. User approval is required (with optional interactive buttons)
 * 3. An error occurs
 *
 * Works with any AI Agent, CLI tool, or automated pipeline.
 */

const path = require('path');
const { loadEnv, TelegramClient } = require('./telegram-api');

const env = loadEnv();
const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN || !CHAT_ID) {
  console.error('[Telegram Notifier] Error: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in .env or environment variables.');
  console.error('Run `npm run setup` to configure your credentials interactively.');
  process.exit(1);
}

const client = new TelegramClient(BOT_TOKEN);

// Parse command line arguments
// Usage: node notify.js --type=[task_finished|approval_required|error] --title="Title" --message="Details" --project="Project Name" --lang="en|ar-eg|ar" --buttons
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
    approveBtn: '🟢 Approve',
    rejectBtn: '🔴 Reject',
  },
  'ar-eg': {
    task_finished: { title: 'خلصت يا معلم', emoji: '✅', label: 'تمت المهمة' },
    approval_required: { title: 'محتاج اذنك يا معلم', emoji: '⚠️', label: 'مطلوب إذنك' },
    error: { title: 'فيه مشكلة يا معلم', emoji: '❌', label: 'حدث خطأ' },
    info: { title: 'إشعار', emoji: 'ℹ️', label: 'إشعار' },
    alert: { title: 'تنبيه', emoji: '🔔', label: 'تنبيه' },
    approveBtn: '🟢 موافق يا معلم',
    rejectBtn: '🔴 ارفض يا معلم',
  },
  ar: {
    task_finished: { title: 'اكتملت المهمة بنجاح', emoji: '✅', label: 'اكتملت المهمة' },
    approval_required: { title: 'مطلوب مراجعة وتأكيد', emoji: '⚠️', label: 'مطلوب الموافقة' },
    error: { title: 'حدث خطأ أثناء التنفيذ', emoji: '❌', label: 'حدث خطأ' },
    info: { title: 'إشعار', emoji: 'ℹ️', label: 'إشعار' },
    alert: { title: 'تنبيه', emoji: '🔔', label: 'تنبيه' },
    approveBtn: '🟢 موافقة وتأكيد',
    rejectBtn: '🔴 إلغاء ورفض',
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

// Optional Interactive Buttons for Approvals
let inlineKeyboard = null;
const shouldAddButtons = params.buttons || (normalizedKey === 'approval_required' && params['no-buttons'] !== true);

if (shouldAddButtons) {
  const approvalId = Date.now().toString(36);
  inlineKeyboard = [
    [
      { text: activeLocale.approveBtn || '🟢 Approve', callback_data: `approval:approve:${approvalId}` },
      { text: activeLocale.rejectBtn || '🔴 Reject', callback_data: `approval:reject:${approvalId}` },
    ],
  ];
}

async function send() {
  try {
    if (inlineKeyboard) {
      await client.sendMessageWithButtons(CHAT_ID, telegramText, inlineKeyboard);
    } else {
      await client.sendMessage(CHAT_ID, telegramText);
    }
    console.log(`[Telegram Notifier] Notification sent successfully (${eventLabel}).`);
    process.exit(0);
  } catch (err) {
    console.error(`[Telegram Notifier] Failed to send notification: ${err.message}`);
    process.exit(1);
  }
}

send();
