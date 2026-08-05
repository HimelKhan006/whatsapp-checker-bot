import fs from 'fs';
import path from 'path';
import http from 'http';
import { config } from './src/config.js';
import { dbService } from './src/db/database.js';
import { startBot, sendServerOfflineAlert } from './src/bot/index.js';
import { sessionManager } from './src/whatsapp/sessionManager.js';

let isShuttingDown = false;

// Start a lightweight HTTP server for Render health checks, port binding, and keep-alive ping
const PORT = process.env.PORT || 10000;
const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify({
    status: 'online',
    service: 'WhatsApp Registration Checker Bot',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  }));
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Health check & Keep-Alive HTTP server bound to port ${PORT}`);
  startSelfPingLoop();
});

// Self-Ping Keep-Alive loop to prevent Render free-tier from suspending/spinning down
function startSelfPingLoop() {
  const externalUrl = process.env.RENDER_EXTERNAL_URL;
  console.log(`📡 Keep-Alive Engine initialized. Self-ping interval active (4 mins). External URL: ${externalUrl || 'Localhost'}`);

  setInterval(async () => {
    if (isShuttingDown) return;
    try {
      const targetUrl = externalUrl || `http://127.0.0.1:${PORT}`;
      const res = await fetch(targetUrl);
      if (res.ok) {
        console.log(`[Keep-Alive] Successfully pinged server to prevent suspend: ${targetUrl}`);
      }
    } catch (e) {
      console.log(`[Keep-Alive] Ping pulse sent to keep server active.`);
    }
  }, 4 * 60 * 1000); // Pings every 4 minutes
}

// Process Shutdown Hook to send Server Offline Alerts to Admins
async function handleShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n🛑 System received ${signal} signal. Triggering graceful shutdown & admin alerts...`);

  try {
    // Send Offline Alert to Admins
    await sendServerOfflineAlert();
    console.log('📢 Server Offline alert delivered to administrators.');
    // Give Node.js network event loop 1.5 seconds to flush TCP packets to Telegram API
    await new Promise(r => setTimeout(r, 1500));
  } catch (err) {
    console.error('Error delivering offline alert:', err.message);
  }

  try {
    httpServer.close();
  } catch (e) {}

  process.exit(0);
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGHUP', () => handleShutdown('SIGHUP'));

// Uncaught Exception / Rejection Guard to prevent silent crashes
process.on('uncaughtException', (err) => {
  console.error('[System] Uncaught Exception:', err.message || err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[System] Unhandled Rejection:', reason?.message || reason);
});

async function main() {
  console.log('====================================================');
  console.log('  ⚡ Professional WhatsApp Registration Checker Bot ⚡');
  console.log('====================================================');

  if (!config.botToken || config.botToken === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
    console.error('\n❌ ERROR: BOT_TOKEN is missing or set to default template.');
    console.error('Please edit the .env file and set your real Telegram Bot Token.\n');
    process.exit(1);
  }

  // Initialize GitHub Gist Cloud Sync and Database Restoration with error catch
  try {
    await dbService.initCloudSync();
  } catch (err) {
    console.error('[Init] Cloud Sync warning:', err.message);
  }

  // Restore active WhatsApp sessions asynchronously without blocking bot launch
  if (fs.existsSync(config.sessionsDir)) {
    try {
      const folders = fs.readdirSync(config.sessionsDir).filter(f => f.startsWith('session_'));
      if (folders.length > 0) {
        console.log(`[Init] Found ${folders.length} saved WhatsApp session(s). Restoring connections...`);
        for (const folder of folders) {
          const tgId = folder.replace('session_', '');
          sessionManager.initSession(tgId).catch(err => {
            console.error(`[Init] Non-blocking restore notice for ${tgId}:`, err.message);
          });
        }
      }
    } catch (e) {}
  }

  // Launch Telegram Bot with automatic retry on boot
  let botStarted = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await startBot();
      botStarted = true;
      break;
    } catch (err) {
      console.error(`[Boot] Bot start attempt ${attempt} failed: ${err.message}. Retrying in 3s...`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  if (!botStarted) {
    console.error('❌ Failed to start Telegram Bot listener after 5 attempts.');
  }
}

main().catch((err) => {
  if (err.error_code === 409 || (err.message && err.message.includes('409'))) {
    console.error('\n⚠️ CONFLICT ERROR: Another instance of this bot is already running in another window!');
    console.error('👉 Please close all other command prompt windows running start.bat or node.exe before launching.\n');
  } else {
    console.error('Fatal Application Error:', err);
  }
});
