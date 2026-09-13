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

const fs = require('fs');
const path = require('path');
const os = require('os');
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

function getSavedLanguage() {
  try {
    const stateFile = path.join(os.homedir(), '.telegram-notifier', 'state.json');
    if (fs.existsSync(stateFile)) {
      const data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      if (data && data.language) return data.language;
    }
  } catch {
    // Ignore
  }
  return null;
}

// Parse command line arguments
// Usage: node notify.js --type=[task_finished|approval_required|error] --title="Title" --message="Details" --project="Project Name" --lang="en|ar" --buttons
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
const savedLang = getSavedLanguage();
const lang = (params.lang || env.NOTIFICATION_LANGUAGE || savedLang || 'en').toLowerCase();

const i18n = require('./i18n');
const locale = i18n.getLocale(lang);
const events = locale.events || {};
const buttons = locale.buttons || {};

// Normalize event type key
let normalizedKey = 'info';
if (['finish', 'task_finish', 'task_finished', 'task_complete', 'task_completed', 'success', 'done'].includes(rawType)) {
  normalizedKey = 'task_finished';
} else if (['approval', 'approval_required', 'approval_needed', 'feedback', 'prompt', 'ask'].includes(rawType)) {
  normalizedKey = 'approval_required';
} else if (['error', 'failed', 'exception', 'failure', 'bug'].includes(rawType)) {
  normalizedKey = 'error';
}

const config = events[normalizedKey] || events.info || { title: 'Notification', emoji: '', label: 'Notification' };
const headerEmoji = config.emoji ? `${config.emoji} ` : '';
const eventLabel = config.label;
const title = params.title || config.title;
const message = params.message || params.text || '';
const project = params.project || path.basename(process.cwd()) || 'Project';

const now = new Date().toLocaleString();

// Construct message text using Markdown formatting
const telegramText = [
  `${headerEmoji}*[${eventLabel}]* \`${project}\``.trim(),
  `*${title}*`,
  message ? `\n${message}` : '',
  `\n_${now}_`,
].join('\n');

// Optional Interactive Buttons for Approvals
let inlineKeyboard = null;
const shouldAddButtons = params.buttons || (normalizedKey === 'approval_required' && params['no-buttons'] !== true);

if (shouldAddButtons) {
  const approvalId = Date.now().toString(36);
  inlineKeyboard = [
    [
      { text: buttons.approve || 'Approve', callback_data: `approval:approve:${approvalId}` },
      { text: buttons.reject || 'Reject', callback_data: `approval:reject:${approvalId}` },
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
