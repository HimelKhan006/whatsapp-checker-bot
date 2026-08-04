import { Bot } from 'grammy';
import { config } from '../config.js';
import { authMiddleware } from './middlewares/auth.js';
import { registerStartHandlers } from './handlers/start.js';
import { registerPairHandlers } from './handlers/pair.js';
import { registerCheckHandlers } from './handlers/check.js';
import { registerAdminHandlers } from './handlers/admin.js';
import { sessionManager } from '../whatsapp/sessionManager.js';
import { keyboards } from './keyboards/inline.js';

export function createBot() {
  if (!config.botToken) {
    throw new Error('BOT_TOKEN is missing! Please configure BOT_TOKEN in .env file.');
  }

  const bot = new Bot(config.botToken);

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

  console.log('🚀 Starting bot polling...');
  await bot.start({
    onStart(botInfo) {
      console.log(`✅ Bot is live as @${botInfo.username} (${botInfo.first_name})`);
    }
  });
}
