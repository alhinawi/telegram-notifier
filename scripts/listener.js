#!/usr/bin/env node

/**
 * Telegram Interactive Listener Daemon (Two-Way Bridge)
 * Listens for commands and prompts from your phone via Telegram Bot,
 * executes them in your active workspace using your AI CLI agent,
 * and reports the results back with interactive buttons.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { loadEnv, TelegramClient } = require('./telegram-api');
const { discoverProjects, formatProjectsMessage, buildProjectsKeyboard, getGitBranch } = require('./projects');

function getStateDir() {
  const homeDir = os.homedir();
  const homeStateDir = path.join(homeDir, '.telegram-notifier');
  try {
    if (!fs.existsSync(homeStateDir)) {
      fs.mkdirSync(homeStateDir, { recursive: true });
    }
    return homeStateDir;
  } catch {
    const localStateDir = path.resolve(__dirname, '..', '.telegram-notifier');
    if (!fs.existsSync(localStateDir)) {
      try {
        fs.mkdirSync(localStateDir, { recursive: true });
      } catch {
        // Ignore
      }
    }
    return localStateDir;
  }
}

function getStateFilePath() {
  return path.join(getStateDir(), 'state.json');
}

function loadState() {
  const stateFile = getStateFilePath();
  try {
    if (fs.existsSync(stateFile)) {
      return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    }
  } catch {
    // Ignore error and use default
  }
  return {
    activeWorkspace: process.cwd(),
    activeAgent: null,
    lastActivity: new Date().toISOString(),
  };
}

function saveState(state) {
  const stateFile = getStateFilePath();
  try {
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save state:', err.message);
  }
}

// Global runtime variables
let runningProcess = null;
let runningTaskInfo = null;
let isStopping = false;

// Pending approval promises / callbacks
const pendingApprovals = new Map();

function getActiveWorkspace(state) {
  if (state.activeWorkspace && fs.existsSync(state.activeWorkspace)) {
    return state.activeWorkspace;
  }
  return process.cwd();
}

/**
 * Clean & truncate output text for Telegram message limits (max 4096 chars)
 */
function formatTelegramOutput(text, maxLength = 3500) {
  if (!text) return '_لا توجد مخرجات_';
  // Strip ANSI color codes
  const clean = text.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '').trim();
  if (clean.length <= maxLength) {
    return '```\n' + clean + '\n```';
  }
  const half = Math.floor(maxLength / 2) - 50;
  return (
    '```\n' +
    clean.slice(0, half) +
    '\n... [تم اختصار المخرجات الطويلة] ...\n' +
    clean.slice(clean.length - half) +
    '\n```'
  );
}

async function main() {
  const env = loadEnv();
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const authorizedChatId = String(env.TELEGRAM_CHAT_ID || '').trim();
  const agentCli = env.AI_AGENT_CLI || 'gemini';
  const taskTimeoutSec = parseInt(env.TASK_TIMEOUT || '600', 10);
  const lang = (env.LISTENER_LANGUAGE || env.NOTIFICATION_LANGUAGE || 'ar-eg').toLowerCase();
  const isArabic = lang.startsWith('ar');

  if (!botToken || !authorizedChatId) {
    console.error('[Daemon Error] TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set in .env');
    process.exit(1);
  }

  const client = new TelegramClient(botToken);
  let state = loadState();

  console.log('========================================================');
  console.log('🤖 Telegram Notifier - Interactive Listener Daemon');
  console.log(`📱 Authorized Chat ID: ${authorizedChatId}`);
  console.log(`🧠 AI Agent CLI: ${agentCli}`);
  console.log(`📂 Active Workspace: ${getActiveWorkspace(state)}`);
  console.log(`⏱️ Task Timeout: ${taskTimeoutSec}s`);
  console.log('========================================================\n');

  // Verify connection with Telegram
  try {
    const me = await client.getMe();
    console.log(`✅ Connected as @${me.username} (${me.first_name})`);
  } catch (err) {
    console.error(`❌ Failed to connect to Telegram API: ${err.message}`);
    process.exit(1);
  }

  // Register bot commands
  try {
    await client.setMyCommands([
      { command: 'projects', description: '📂 عرض واختيار المشاريع الأخيرة' },
      { command: 'status', description: '📊 حالة الـ Daemon والمشروع النشط' },
      { command: 'stop', description: '🛑 إيقاف المهمة الجارية حالياً' },
      { command: 'help', description: 'ℹ️ المساعدة وقائمة الأوامر' },
    ]);
  } catch (e) {
    console.warn(`⚠️ Could not register commands: ${e.message}`);
  }

  // Handle SIGINT / SIGTERM
  const cleanup = () => {
    isStopping = true;
    if (runningProcess) {
      try {
        runningProcess.kill('SIGTERM');
      } catch {
        // Ignore
      }
    }
    console.log('\n👋 Telegram Listener Daemon shutting down.');
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Send startup notification to user's phone
  try {
    const startMsg = isArabic
      ? `🟢 *تم تشغيل جسر التحكم التفاعلي (Daemon)*\n\n📂 المشروع النشط: \`${path.basename(getActiveWorkspace(state))}\`\n🧠 المساعد: \`${agentCli}\`\n\nأرسل أي برومبت أو أمر \`/projects\` للبدء.`
      : `🟢 *Telegram Interactive Daemon Started*\n\n📂 Active Workspace: \`${path.basename(getActiveWorkspace(state))}\`\n🧠 AI Agent: \`${agentCli}\`\n\nSend any prompt or \`/projects\` to start.`;

    await client.sendMessage(authorizedChatId, startMsg);
  } catch (err) {
    console.warn(`⚠️ Could not send startup notification: ${err.message}`);
  }

  let offset = 0;

  // Main Long Polling Loop
  while (!isStopping) {
    try {
      const updates = await client.getUpdates(offset, 30);

      if (Array.isArray(updates) && updates.length > 0) {
        for (const update of updates) {
          offset = update.update_id + 1;

          // Handle Callback Queries (Button Clicks)
          if (update.callback_query) {
            await handleCallbackQuery(client, update.callback_query, state, authorizedChatId, lang);
          }

          // Handle Normal Messages
          if (update.message) {
            await handleMessage(client, update.message, state, authorizedChatId, agentCli, taskTimeoutSec, lang);
          }
        }
      }
    } catch (err) {
      if (!isStopping) {
        console.error(`⚠️ Polling error: ${err.message}`);
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
  }
}

/**
 * Handle incoming text message / command
 */
async function handleMessage(client, message, state, authorizedChatId, agentCli, timeoutSec, lang) {
  const chatId = String(message.chat.id);
  const isArabic = lang.startsWith('ar');

  // Security gate
  if (chatId !== authorizedChatId) {
    console.warn(`[Security Alert] Unauthorized access attempt from chat_id: ${chatId}`);
    try {
      await client.sendMessage(chatId, '⛔ *غير مصرح*: هذا البوت مخصص للاستخدام الشخصي فقط.');
    } catch {
      // Ignore
    }
    return;
  }

  const text = (message.text || '').trim();
  if (!text) return;

  const currentWorkspace = getActiveWorkspace(state);
  const projectName = path.basename(currentWorkspace);

  // Command Routing
  if (text === '/start' || text === '/help') {
    const welcome = isArabic
      ? [
          '👋 *مرحباً بك في جسر التحكم التفاعلي!*',
          '',
          `📂 المشروع النشط: \`${projectName}\``,
          `📁 المسار: \`${currentWorkspace}\``,
          `🧠 المساعد الافتراضي: \`${agentCli}\``,
          '',
          '📌 *الأوامر المتاحة:*',
          '• `/projects` - عرض واختيار آخر المشاريع عبر أزرار تفاعلية',
          '• `/status` - تفاصيل المشروع النشط والمهمة الجارية',
          '• `/stop` - إلغاء المهمة الجارية حالياً',
          '• `/help` - عرض هذه الرسالة',
          '',
          '💡 *للتنفيذ*: اكتب أي برومبت أو مهمة مباشرة وسيتم تشغيلها داخل المشروع النشط وإشعارك بالنتيجة!',
        ].join('\n')
      : [
          '👋 *Welcome to Telegram Interactive Agent Bridge!*',
          '',
          `📂 Active Project: \`${projectName}\``,
          `📁 Path: \`${currentWorkspace}\``,
          `🧠 AI Agent: \`${agentCli}\``,
          '',
          '📌 *Available Commands:*',
          '• `/projects` - Browse & switch projects with buttons',
          '• `/status` - Current project & task status',
          '• `/stop` - Cancel running task',
          '• `/help` - Show this message',
          '',
          '💡 *To execute*: Simply type any prompt or task, and it will run inside the active project!',
        ].join('\n');

    await client.sendMessage(chatId, welcome);
    return;
  }

  if (text === '/projects' || text === '/recent') {
    const projects = discoverProjects(8);
    const msgText = formatProjectsMessage(projects, currentWorkspace, lang);
    const keyboard = buildProjectsKeyboard(projects, currentWorkspace);
    await client.sendMessageWithButtons(chatId, msgText, keyboard);
    return;
  }

  if (text === '/status') {
    const branch = getGitBranch(currentWorkspace);
    const statusMsg = isArabic
      ? [
          '📊 *حالة النظام:*',
          `📂 المشروع النشط: \`${projectName}\``,
          `🌿 الفرع (Git): \`${branch || 'None'}\``,
          `📁 المسار: \`${currentWorkspace}\``,
          `🧠 المساعد: \`${agentCli}\``,
          `⚙️ حالة المهمة: ${runningProcess ? '⏳ جاري تنفيذ مهمة...' : '🟢 جاهز لاستقبال الأوامر'}`,
          runningTaskInfo ? `📝 المهمة: _"${runningTaskInfo.prompt}"_` : '',
        ]
          .filter(Boolean)
          .join('\n')
      : [
          '📊 *System Status:*',
          `📂 Active Project: \`${projectName}\``,
          `🌿 Git Branch: \`${branch || 'None'}\``,
          `📁 Workspace: \`${currentWorkspace}\``,
          `🧠 Agent: \`${agentCli}\``,
          `⚙️ Task Status: ${runningProcess ? '⏳ Running...' : '🟢 Idle / Ready'}`,
          runningTaskInfo ? `📝 Task: _"${runningTaskInfo.prompt}"_` : '',
        ]
          .filter(Boolean)
          .join('\n');

    await client.sendMessage(chatId, statusMsg);
    return;
  }

  if (text === '/stop') {
    if (runningProcess) {
      try {
        runningProcess.kill('SIGTERM');
      } catch {
        // Ignore
      }
      const stopMsg = isArabic ? '🛑 *تم إرسال أمر إيقاف المهمة الجارية.*' : '🛑 *Stopping running task...*';
      await client.sendMessage(chatId, stopMsg);
    } else {
      const idleMsg = isArabic ? 'ℹ️ لا توجد مهمة قيد التنفيذ حالياً.' : 'ℹ️ No task is currently running.';
      await client.sendMessage(chatId, idleMsg);
    }
    return;
  }

  // Handle Regular Prompt Execution
  if (runningProcess) {
    const busyMsg = isArabic
      ? '⚠️ *توجد مهمة قيد التنفيذ بالفعل!*\n\nيمكنك إيقافها باستخدام أمر `/stop` أولاً.'
      : '⚠️ *A task is already running!*\n\nYou can abort it by sending `/stop`.';
    await client.sendMessage(chatId, busyMsg);
    return;
  }

  await executePrompt(client, text, currentWorkspace, agentCli, timeoutSec, chatId, lang);
}

/**
 * Handle button clicks (Callback Queries)
 */
async function handleCallbackQuery(client, callbackQuery, state, authorizedChatId, lang) {
  const chatId = String(callbackQuery.message.chat.id);
  const data = callbackQuery.data || '';
  const queryId = callbackQuery.id;
  const isArabic = lang.startsWith('ar');

  if (chatId !== authorizedChatId) return;

  // 1. Project selection: proj:<index>
  if (data.startsWith('proj:')) {
    const index = parseInt(data.replace('proj:', ''), 10);
    const projects = discoverProjects(8);
    const selected = projects[index];

    if (selected) {
      state.activeWorkspace = selected.path;
      state.lastActivity = new Date().toISOString();
      saveState(state);

      await client.answerCallbackQuery(queryId, isArabic ? `تم اختيار: ${selected.name}` : `Selected: ${selected.name}`);

      const branch = selected.branch ? ` \`[${selected.branch}]\`` : '';
      const confirmMsg = isArabic
        ? `✅ *تم تبديل مسار العمل النشط!*\n\n📂 المشروع: *${selected.name}*${branch}\n📁 المسار: \`${selected.path}\`\n\n🚀 أي برومبت ترسله الآن سيُنفذ مباشرة داخل هذا المشروع.`
        : `✅ *Active Workspace Switched!*\n\n📂 Project: *${selected.name}*${branch}\n📁 Path: \`${selected.path}\`\n\n🚀 Next prompts will be executed in this workspace.`;

      await client.sendMessage(chatId, confirmMsg);
    } else {
      await client.answerCallbackQuery(queryId, isArabic ? 'المشروع غير موجود' : 'Project not found');
    }
    return;
  }

  // 2. Interactive approvals: approve:<id> or reject:<id>
  if (data.startsWith('approval:')) {
    const parts = data.split(':');
    const action = parts[1]; // 'approve' or 'reject'
    const approvalId = parts[2];

    const isApprove = action === 'approve';
    await client.answerCallbackQuery(
      queryId,
      isApprove ? (isArabic ? 'تمت الموافقة ✅' : 'Approved ✅') : isArabic ? 'تم الرفض ❌' : 'Rejected ❌'
    );

    if (pendingApprovals.has(approvalId)) {
      const handler = pendingApprovals.get(approvalId);
      handler(isApprove);
      pendingApprovals.delete(approvalId);
    }

    const actionText = isApprove
      ? isArabic
        ? '🟢 *تمت الموافقة من تليجرام.* جاري استكمال التنفيذ...'
        : '🟢 *Approved via Telegram.* Proceeding...'
      : isArabic
      ? '🔴 *تم الرفض من تليجرام.* تم إلغاء الإجراء.'
      : '🔴 *Rejected via Telegram.* Operation aborted.';

    await client.sendMessage(chatId, actionText);
    return;
  }

  await client.answerCallbackQuery(queryId);
}

/**
 * Execute prompt with configured AI CLI Agent
 */
async function executePrompt(client, promptText, workspacePath, agentCli, timeoutSec, chatId, lang) {
  const isArabic = lang.startsWith('ar');
  const projectName = path.basename(workspacePath);

  // Send "Task Started" acknowledgement
  const startMsg = isArabic
    ? `⏳ *جاري تنفيذ المهمة...*\n\n📂 المشروع: \`${projectName}\`\n📝 البرومبت: _"${promptText.slice(0, 150)}${promptText.length > 150 ? '...' : ''}"_\n🧠 المساعد: \`${agentCli}\`\n\n_أرسل \`/stop\` إذا أردت الإلغاء._`
    : `⏳ *Starting Task Execution...*\n\n📂 Project: \`${projectName}\`\n📝 Prompt: _"${promptText.slice(0, 150)}${promptText.length > 150 ? '...' : ''}"_\n🧠 Agent: \`${agentCli}\`\n\n_Send \`/stop\` to cancel anytime._`;

  await client.sendMessage(chatId, startMsg);

  runningTaskInfo = {
    prompt: promptText,
    workspace: workspacePath,
    startTime: Date.now(),
  };

  let stdoutData = '';
  let stderrData = '';

  // Prepare command arguments based on CLI agent type
  let cmd = agentCli;
  let args = [];

  if (agentCli.includes(' ')) {
    // If user provided a command with arguments e.g. "gemini run" or "npx agent"
    const tokens = agentCli.split(' ');
    cmd = tokens[0];
    args = tokens.slice(1);
    args.push(promptText);
  } else if (agentCli === 'gemini') {
    // Gemini CLI format: gemini -p "prompt"
    args = ['-p', promptText];
  } else if (agentCli === 'claude') {
    // Claude Code format: claude -p "prompt"
    args = ['-p', promptText];
  } else if (agentCli === 'aider') {
    args = ['--message', promptText];
  } else {
    args = [promptText];
  }

  console.log(`[Executing] ${cmd} in ${workspacePath}`);

  try {
    runningProcess = spawn(cmd, args, {
      cwd: workspacePath,
      shell: true,
      env: {
        ...process.env,
        TELEGRAM_ACTIVE_WORKSPACE: workspacePath,
      },
    });

    let timeoutTimer = setTimeout(() => {
      if (runningProcess) {
        console.warn(`[Timeout] Task exceeded ${timeoutSec}s, terminating.`);
        runningProcess.kill('SIGTERM');
      }
    }, timeoutSec * 1000);

    runningProcess.stdout.on('data', (d) => {
      stdoutData += d.toString();
    });

    runningProcess.stderr.on('data', (d) => {
      stderrData += d.toString();
    });

    runningProcess.on('close', async (code) => {
      clearTimeout(timeoutTimer);
      const durationSec = Math.round((Date.now() - runningTaskInfo.startTime) / 1000);
      runningProcess = null;
      runningTaskInfo = null;

      console.log(`[Task Closed] Exit code: ${code}, Duration: ${durationSec}s`);

      if (code === 0) {
        const successTitle = isArabic ? `✅ *اكتملت المهمة بنجاح* (${durationSec}s)` : `✅ *Task Finished Successfully* (${durationSec}s)`;
        const formattedOutput = formatTelegramOutput(stdoutData || stderrData);
        const resultMsg = `${successTitle}\n📂 \`${projectName}\`\n\n${formattedOutput}`;
        await client.sendMessage(chatId, resultMsg);
      } else {
        const failTitle = isArabic ? `❌ *انتهت المهمة مع خطأ* (Code: ${code}, ${durationSec}s)` : `❌ *Task Failed* (Code: ${code}, ${durationSec}s)`;
        const errorContent = stderrData || stdoutData || 'Process terminated or command not found.';
        const formattedOutput = formatTelegramOutput(errorContent);
        const resultMsg = `${failTitle}\n📂 \`${projectName}\`\n\n${formattedOutput}`;
        await client.sendMessage(chatId, resultMsg);
      }
    });

    runningProcess.on('error', async (err) => {
      clearTimeout(timeoutTimer);
      runningProcess = null;
      runningTaskInfo = null;

      console.error(`[Process Error]: ${err.message}`);
      const errTitle = isArabic ? '❌ *فشل تشغيل أمر المساعد*' : '❌ *Failed to spawn AI Agent CLI*';
      const errMsg = `${errTitle}\n\n⚠️ ${err.message}\n💡 _تأكد من أن \`${agentCli}\` مثبت ومتاح في مسار PATH أو حدد الأمر في .env (AI_AGENT_CLI)._`;
      await client.sendMessage(chatId, errMsg);
    });
  } catch (err) {
    runningProcess = null;
    runningTaskInfo = null;
    console.error(`[Execution Exception]: ${err.message}`);
    await client.sendMessage(chatId, `❌ Exception: ${err.message}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal daemon error:', err);
    process.exit(1);
  });
}

module.exports = {
  main,
  formatTelegramOutput,
};
