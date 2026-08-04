import fs from 'fs';
import path from 'path';
import { config } from './src/config.js';
import { dbService } from './src/db/database.js';
import { startBot } from './src/bot/index.js';
import { sessionManager } from './src/whatsapp/sessionManager.js';

async function main() {
  console.log('====================================================');
  console.log('  ⚡ Professional WhatsApp Registration Checker Bot ⚡');
  console.log('====================================================');

  if (!config.botToken || config.botToken === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
    console.error('\n❌ ERROR: BOT_TOKEN is missing or set to default template.');
    console.error('Please edit the .env file and set your real Telegram Bot Token.\n');
    process.exit(1);
  }

  // Initialize GitHub Gist Cloud Sync and Database Restoration
  await dbService.initCloudSync();

  // Restore active WhatsApp sessions from sessions directory
  if (fs.existsSync(config.sessionsDir)) {
    const folders = fs.readdirSync(config.sessionsDir).filter(f => f.startsWith('session_'));
    if (folders.length > 0) {
      console.log(`[Init] Found ${folders.length} saved WhatsApp session(s). Restoring connections...`);
      for (const folder of folders) {
        const tgId = folder.replace('session_', '');
        try {
          await sessionManager.initSession(tgId);
          console.log(`[Init] Session restored for TG User: ${tgId}`);
        } catch (err) {
          console.error(`[Init] Failed to restore session for ${tgId}:`, err.message);
        }
      }
    }
  }

  // Launch Telegram Bot
  await startBot();
}

main().catch((err) => {
  if (err.error_code === 409 || (err.message && err.message.includes('409'))) {
    console.error('\n⚠️ CONFLICT ERROR: Another instance of this bot is already running in another window!');
    console.error('👉 Please close all other command prompt windows running start.bat or node.exe before launching.\n');
  } else {
    console.error('Fatal Application Error:', err);
  }
  process.exit(1);
});
