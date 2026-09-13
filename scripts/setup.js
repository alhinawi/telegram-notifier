#!/usr/bin/env node

/**
 * Interactive Setup Wizard for Telegram Notifier
 * Configures Bot Token, Chat ID, Language, Global/Local Agent integration, and sends a test alert.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');
const os = require('os');
const serviceManager = require('./service-manager');
const i18n = require('./i18n');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const ask = (query) => new Promise((resolve) => rl.question(query, resolve));

const ROOT_DIR = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT_DIR, '.env');

function printHeader() {
  console.log('\n========================================================');
  console.log('Telegram Notifier - Interactive 1-Liner Setup Wizard');
  console.log('Universal AI Agent Notifications & Remote Setup');
  console.log('========================================================\n');
}

function loadExistingEnv() {
  const env = {};
  const possiblePaths = [
    ENV_PATH,
    path.join(os.homedir(), '.gemini', 'config', 'plugins', 'telegram-notifier', '.env'),
    path.join(process.cwd(), '.env'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
      lines.forEach((line) => {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx !== -1) {
            const k = trimmed.slice(0, eqIdx).trim();
            const v = trimmed.slice(eqIdx + 1).trim();
            if (k && !env[k]) env[k] = v;
          }
        }
      });
    }
  }
  return env;
}

function saveEnv(envConfig, targetFile) {
  const lines = [
    '# Telegram Bot Credentials & Configuration',
    `TELEGRAM_BOT_TOKEN=${envConfig.TELEGRAM_BOT_TOKEN || ''}`,
    `TELEGRAM_CHAT_ID=${envConfig.TELEGRAM_CHAT_ID || ''}`,
    `NOTIFICATION_LANGUAGE=${envConfig.NOTIFICATION_LANGUAGE || 'en'}`,
    '',
    '# Two-Way Interactive Bridge Configuration',
    `WORKSPACE_DIRS=${envConfig.WORKSPACE_DIRS || '~/workspace'}`,
    `AI_AGENT_CLI=${envConfig.AI_AGENT_CLI || 'gemini'}`,
    `TASK_TIMEOUT=${envConfig.TASK_TIMEOUT || '600'}`,
    '',
  ];
  fs.writeFileSync(targetFile, lines.join('\n'), 'utf8');
  console.log(`Saved configuration to: ${targetFile}`);
}

async function detectChatId(botToken) {
  console.log('\nAuto-detecting Telegram Chat ID...');
  console.log('Please open Telegram, search for your bot, and send /start or any message.');
  console.log('Waiting for your message...\n');

  for (let attempt = 1; attempt <= 15; attempt++) {
    try {
      const result = await new Promise((resolve, reject) => {
        https
          .get(`https://api.telegram.org/bot${botToken}/getUpdates`, (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => {
              try {
                const json = JSON.parse(data);
                if (json.ok && json.result && json.result.length > 0) {
                  const latest = json.result[json.result.length - 1];
                  const msg = latest.message || latest.channel_post || latest.callback_query?.message;
                  if (msg && msg.chat && msg.chat.id) {
                    return resolve({
                      chatId: msg.chat.id.toString(),
                      sender: msg.from ? `${msg.from.first_name || ''} (@${msg.from.username || 'unknown'})` : 'User',
                    });
                  }
                }
                resolve(null);
              } catch (e) {
                reject(e);
              }
            });
          })
          .on('error', reject);
      });

      if (result) {
        console.log(`Message detected from ${result.sender}!`);
        console.log(`Chat ID: ${result.chatId}`);
        return result.chatId;
      }
    } catch (err) {
      // retry silently
    }

    process.stdout.write(`   [Attempt ${attempt}/15] Checking again in 3s...\r`);
    await new Promise((r) => setTimeout(r, 3000));
  }

  console.log('\nCould not detect message automatically.');
  return null;
}

function sendTestNotification(botToken, chatId, lang) {
  return new Promise((resolve, reject) => {
    const title = i18n.t('setup.test_title', lang);
    const message = i18n.t('setup.test_message', lang);

    const text = [
      `*[Telegram Notifier]* \`Installation\``,
      `*${title}*`,
      `\n${message}`,
      `\n_${new Date().toLocaleString()}_`,
    ].join('\n');

    const payload = JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });

    const req = https.request(
      {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${botToken}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.ok) {
              resolve(true);
            } else {
              reject(new Error(parsed.description));
            }
          } catch (e) {
            reject(e);
          }
        });
      }
    );

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function copyDir(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  const entries = fs.readdirSync(srcDir);
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry);
    const destPath = path.join(destDir, entry);
    if (fs.statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function installGlobalPlugin(envConfig) {
  try {
    const homeDir = os.homedir();
    const globalPluginDir = path.join(homeDir, '.gemini', 'config', 'plugins', 'telegram-notifier');
    fs.mkdirSync(globalPluginDir, { recursive: true });

    // Copy package metadata
    const filesToCopy = ['package.json', 'plugin.json', 'README.md', 'LICENSE', '.env.example', 'SKILL.md'];
    filesToCopy.forEach((f) => {
      const src = path.join(ROOT_DIR, f);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(globalPluginDir, f));
    });

    // Copy scripts & locales
    copyDir(path.join(ROOT_DIR, 'scripts'), path.join(globalPluginDir, 'scripts'));
    i18n.copyLocales(globalPluginDir);

    // Copy skill for plugin discovery
    const targetSkills = path.join(globalPluginDir, 'skills', 'telegram-notifier');
    fs.mkdirSync(targetSkills, { recursive: true });
    const skillSrc = path.join(ROOT_DIR, 'SKILL.md');
    if (fs.existsSync(skillSrc)) {
      fs.copyFileSync(skillSrc, path.join(targetSkills, 'SKILL.md'));
    }

    // Save global .env
    saveEnv(envConfig, path.join(globalPluginDir, '.env'));

    console.log(`Global plugin successfully installed to: ${globalPluginDir}`);
    return true;
  } catch (err) {
    console.error(`Could not install global plugin: ${err.message}`);
    return false;
  }
}

async function main() {
  printHeader();

  const existingEnv = loadExistingEnv();

  // If running non-interactively without TTY, skip asking for input
  if (!process.stdin.isTTY && (!existingEnv.TELEGRAM_BOT_TOKEN || existingEnv.TELEGRAM_BOT_TOKEN === 'your_bot_token_here')) {
    console.log('Non-interactive environment detected. Run in an interactive terminal to configure.');
    rl.close();
    return;
  }

  // 1. Bot Token
  let botToken = existingEnv.TELEGRAM_BOT_TOKEN || '';
  if (botToken && botToken !== 'your_bot_token_here') {
    const useExisting = await ask(`Found existing Bot Token (${botToken.slice(0, 8)}...). Use it? [Y/n]: `);
    if (useExisting.trim().toLowerCase() === 'n') {
      botToken = '';
    }
  }

  while (!botToken || botToken === 'your_bot_token_here') {
    console.log('Enter your Telegram Bot Token from @BotFather (e.g. 1234567890:ABCdefGh...):');
    const input = await ask('Bot Token: ');
    botToken = input.trim();
    if (!botToken) {
      console.log('Token cannot be empty. Please enter a valid token.');
    }
  }

  // 2. Chat ID
  let chatId = existingEnv.TELEGRAM_CHAT_ID || '';
  console.log('\n--------------------------------------------------------');
  console.log('Telegram Chat ID Setup:');
  console.log('  [1] Auto-detect automatically via Telegram (Recommended)');
  console.log('  [2] Enter Chat ID manually');
  const chatChoice = await ask('Choose option [1/2] (Default: 1): ');

  if (chatChoice.trim() === '2') {
    const input = await ask('Enter your Telegram Chat ID: ');
    chatId = input.trim();
  } else {
    while (!chatId) {
      const detected = await detectChatId(botToken);
      if (detected) {
        chatId = detected;
        break;
      }

      console.log('\n--------------------------------------------------------');
      console.log('What would you like to do?');
      console.log('  [1] Try again (Retry auto-detection)');
      console.log('  [2] Enter Chat ID manually');
      console.log('  [3] Exit');
      const retryChoice = await ask('Choose option [1/2/3] (Default: 1): ');
      const val = retryChoice.trim() || '1';

      switch (val) {
        case '2': {
          const input = await ask('Please enter your Telegram Chat ID: ');
          chatId = input.trim();
          break;
        }
        case '3':
          console.log('\nSetup cancelled. Exiting...');
          rl.close();
          process.exit(0);
        default:
          break;
      }
    }
  }

  // 3. Language Selection
  console.log('\n--------------------------------------------------------');
  console.log('Choose Default Notification Language:');
  const availableLangs = i18n.getAvailableLanguages();
  availableLangs.forEach((l, idx) => {
    console.log(`  [${idx + 1}] ${l.nativeName} (${l.name}) [${l.code}]`);
  });
  const langChoice = await ask(`Choose language [1-${availableLangs.length}] (Default: 1): `);

  const choiceIdx = parseInt(langChoice.trim(), 10) - 1;
  const lang = (availableLangs[choiceIdx] && availableLangs[choiceIdx].code) || 'en';

  // 4. Two-Way Interactive Bridge Configuration
  console.log('\n--------------------------------------------------------');
  console.log('Two-Way Interactive Bridge Configuration:');
  const defaultDirs = existingEnv.WORKSPACE_DIRS || '~/workspace';
  console.log('Project Workspaces to scan (comma-separated):');
  if (lang === 'ar') {
    console.log('ملاحظة: كتابة المسارات تبدأ من مجلد المستخدم (~) أو المسار الكامل، مثل: ~/workspace');
  } else {
    console.log('Note: Paths should start from your Home directory (~) or full absolute path, e.g. ~/workspace');
  }
  console.log(`   (Default: ${defaultDirs})`);
  const dirsInput = await ask('Workspace directories: ');
  const workspaceDirs = dirsInput.trim() || defaultDirs;

  const defaultAgent = existingEnv.AI_AGENT_CLI || 'gemini';
  console.log(`\nAI Agent CLI tool (e.g. gemini, claude, aider):`);
  console.log(`   (Default: ${defaultAgent})`);
  const agentInput = await ask('AI Agent CLI: ');
  const aiAgentCli = agentInput.trim() || defaultAgent;

  const envConfig = {
    TELEGRAM_BOT_TOKEN: botToken,
    TELEGRAM_CHAT_ID: chatId,
    NOTIFICATION_LANGUAGE: lang,
    WORKSPACE_DIRS: workspaceDirs,
    AI_AGENT_CLI: aiAgentCli,
    TASK_TIMEOUT: existingEnv.TASK_TIMEOUT || '600',
  };

  // Always save local .env in current folder if it's the repo
  if (fs.existsSync(path.join(ROOT_DIR, 'package.json'))) {
    saveEnv(envConfig, ENV_PATH);
  }

  // 5. Installation Scope (Auto Global)
  console.log('\n--------------------------------------------------------');
  console.log('Installing plugin globally for all projects & AI Agents...');
  installGlobalPlugin(envConfig);

  // 6. Test Notification
  console.log('\n--------------------------------------------------------');
  console.log('Sending a test notification to your phone...');
  try {
    await sendTestNotification(botToken, chatId, lang);
    console.log('Test notification delivered successfully! Check your Telegram.');
  } catch (err) {
    console.error(`Failed to send test message: ${err.message}`);
  }

  // 7. Auto-start Background Service Setup
  console.log('\n--------------------------------------------------------');
  console.log('Background Daemon Service (Two-Way Interactive Bridge):');
  console.log('Installing and auto-starting OS background service automatically...');
  serviceManager.installService();

  console.log('\n========================================================');
  console.log('Setup Complete! Your AI Agents will now notify your phone automatically.');
  console.log('========================================================\n');

  rl.close();
}

main().catch((err) => {
  console.error('\nSetup error:', err);
  rl.close();
  process.exit(1);
});
