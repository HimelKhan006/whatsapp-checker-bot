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
let hasSentOnlineAlert = false;

function getActiveAdminIds() {
  const customAdminSetting = dbService.getSetting('custom_admin_ids', '');
  const customAdminIds = customAdminSetting ? customAdminSetting.split(',').map(id => String(id).trim()).filter(Boolean) : [];
  const baseAdminIds = (config.adminIds || []).map(id => String(id).trim()).filter(Boolean);
  return [...new Set([...baseAdminIds, ...customAdminIds])];
}

function getFormattedTime() {
  const now = new Date();
  return now.toISOString().replace('T', ' ').slice(0, 19);
}

// Send Server Online Alert to Admins (Guaranteed Exactly ONCE per process boot)
async function sendServerOnlineAlert(bot) {
  if (hasSentOnlineAlert) return;
  hasSentOnlineAlert = true;

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

// Send Server Offline Alert to Admins (Deduplicated String Admin IDs)
export async function sendServerOfflineAlert() {
  const adminIds = getActiveAdminIds();
  if (adminIds.length === 0 || !config.botToken) return;

  const timeStr = getFormattedTime();

  const msgText = 
    `🔴 <b>Server Status Alert: OFFLINE</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `⚠️ <b>WhatsApp Registration Checker Engine</b> is going <b>OFFLINE</b> / Restarting...\n\n` +
    `📅 <b>Shutdown Time:</b> <code>${timeStr} UTC</code>\n` +
    `💾 <b>Database Snapshot:</b> <code>Saved & Synced ☁️</code>\n\n` +
    `<i>The system will automatically send an ONLINE alert once boot sequence completes.</i>`;

  const sendPromises = adminIds.map(adminId => {
    if (globalBotInstance) {
      return globalBotInstance.api.sendMessage(adminId, msgText, { parse_mode: 'HTML' }).catch(() => {});
    } else {
      const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: adminId, text: msgText, parse_mode: 'HTML' })
      }).catch(() => {});
    }
  });

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

  return bot;
}

export async function startBot() {
  const bot = createBot();

  console.log('🤖 Starting Telegram Bot listener...');

  // Verify connection with Telegram API & send Online Alert card instantly
  try {
    const me = await bot.api.getMe();
    console.log(`✅ Connected to Telegram API as @${me.username}`);
    sendServerOnlineAlert(bot).catch(err => console.error('Online alert notice:', err));
  } catch (e) {
    console.error('Telegram API connection check notice:', e.message);
  }

  // Gracefully handle 409 Conflict on startup when Render replaces containers
  let botStartedSuccessfully = false;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      await bot.start({
        onStart: (botInfo) => {
          botStartedSuccessfully = true;
          console.log(`\n✅ Telegram Bot polling active as @${botInfo.username}!`);
          console.log('🚀 System is ready to accept commands and process requests.\n');
        }
      });
      break;
    } catch (err) {
      if (botStartedSuccessfully) break;
      console.error(`[Boot] Bot startup attempt ${attempt}/10 notice: ${err.message}. Retrying in 3s...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}
