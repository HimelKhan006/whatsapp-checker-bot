import { Bot } from 'grammy';
import { config } from '../config.js';
import { dbService } from '../db/database.js';
import { authMiddleware } from './middlewares/auth.js';
import { registerStartHandlers } from './handlers/start.js';
import { registerPairHandlers } from './handlers/pair.js';
import { registerCheckHandlers } from './handlers/check.js';
import { registerAdminHandlers } from './handlers/admin.js';
import { sessionManager } from '../whatsapp/sessionManager.js';
import { keyboards } from './keyboards/inline.js';

let globalBotInstance = null;

function getActiveAdminIds() {
  const customAdminSetting = dbService.getSetting('custom_admin_ids', '');
  const customAdminIds = customAdminSetting ? customAdminSetting.split(',').map(Number).filter(Boolean) : [];
  return [...new Set([...config.adminIds, ...customAdminIds])];
}

function getFormattedTime() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').slice(0, 19);
}

// Send Server Online Alert to Admins
async function sendServerOnlineAlert(bot) {
  const adminIds = getActiveAdminIds();
  if (adminIds.length === 0) return;

  const mode = dbService.getSetting('bot_mode', config.botMode).toUpperCase();
  const activeWaSessions = sessionManager.getActiveSessionsCount();
  const stats = dbService.getStats();
  const timeStr = getFormattedTime();

  const msgText = 
    `🟢 <b>Server Status Alert: ONLINE</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚡ <b>WhatsApp Registration Checker Engine</b> is now <b>ONLINE</b> and operational!\n\n` +
    `📅 <b>Boot Time:</b> <code>${timeStr} UTC</code>\n` +
    `⚙️ <b>System Mode:</b> <code>${mode}</code>\n` +
    `📱 <b>Active Paired WA Sessions:</b> <code>${activeWaSessions}</code>\n` +
    `👥 <b>Total Registered Users:</b> <code>${stats.totalUsers}</code>\n` +
    `☁️ <b>Cloud Gist Database:</b> <code>Synced & Restored ✅</code>`;

  for (const adminId of adminIds) {
    try {
      await bot.api.sendMessage(adminId, msgText, { parse_mode: 'HTML' });
    } catch (e) {}
  }
}

// Send Server Offline Alert to Admins
export async function sendServerOfflineAlert() {
  if (!globalBotInstance) return;

  const adminIds = getActiveAdminIds();
  if (adminIds.length === 0) return;

  const timeStr = getFormattedTime();

  const msgText = 
    `🔴 <b>Server Status Alert: OFFLINE</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚠️ <b>WhatsApp Registration Checker Engine</b> is going <b>OFFLINE</b> / Restarting...\n\n` +
    `📅 <b>Shutdown Time:</b> <code>${timeStr} UTC</code>\n` +
    `💾 <b>Database Snapshot:</b> <code>Saved & Synced ☁️</code>\n\n` +
    `<i>The system will automatically send an ONLINE alert once boot sequence completes.</i>`;

  const sendPromises = adminIds.map(adminId => 
    globalBotInstance.api.sendMessage(adminId, msgText, { parse_mode: 'HTML' }).catch(() => {})
  );

  await Promise.allSettled(sendPromises);
}

export function createBot() {
  if (!config.botToken) {
    throw new Error('BOT_TOKEN is missing! Please configure BOT_TOKEN in .env file.');
  }

  const bot = new Bot(config.botToken);
  globalBotInstance = bot;

  // Set Auto Logout Push Notifier
  sessionManager.setAutoLogoutListener(async (telegramId) => {
    try {
      await bot.api.sendMessage(
        telegramId,
        `🚪 <b>WhatsApp Account Disconnected / Unlinked!</b>\n\n` +
        `Your paired WhatsApp session was unlinked or logged out by WhatsApp.\n` +
        `Please pair a new session via 📱 <b>Connect</b> menu to continue checking.`,
        {
          parse_mode: 'HTML',
          reply_markup: keyboards.postLogoutKeyboard()
        }
      );
    } catch (e) {}
  });

  // Authentication & Access Middleware
  bot.use(authMiddleware);

  // Register Handler Modules
  registerStartHandlers(bot);
  registerPairHandlers(bot);
  registerCheckHandlers(bot);
  registerAdminHandlers(bot);

  // Global Error Handler
  bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Error while handling update ${ctx.update.update_id}:`);
    const e = err.error;
    console.error('Error details:', e);
  });

  return bot;
}

export async function startBot() {
  const bot = createBot();
  console.log('🤖 Telegram Bot initialized successfully.');

  // Set Telegram Bot Commands Menu (ONLY /start command as requested)
  try {
    await bot.api.setMyCommands([
      { command: 'start', description: '⚡ Start Bot & Main Menu' }
    ]);
    console.log('📋 Telegram Command Menu updated with /start command only.');
  } catch (e) {
    console.error('Failed to set bot commands menu:', e.message);
  }

  // Send Server Online Alert to Admins
  await sendServerOnlineAlert(bot);

  console.log('🚀 Starting bot polling...');
  await bot.start({
    onStart(botInfo) {
      console.log(`✅ Bot is live as @${botInfo.username} (${botInfo.first_name})`);
    }
  });
}
