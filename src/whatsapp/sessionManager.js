import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { config } from '../config.js';
import { dbService } from '../db/database.js';

if (!fs.existsSync(config.sessionsDir)) {
  fs.mkdirSync(config.sessionsDir, { recursive: true });
}

// Map of active WhatsApp socket instances & reconnect attempts keyed by telegramId
const activeSessions = new Map();
const sessionStatus = new Map(); // 'disconnected' | 'connecting' | 'connected' | 'qr_ready'
const reconnectAttempts = new Map();
let cachedWaVersion = null;
let autoLogoutListener = null;

const logger = pino({ level: 'silent' });

async function getWaVersion() {
  if (cachedWaVersion) return cachedWaVersion;
  try {
    const vObj = await fetchLatestBaileysVersion();
    if (vObj && vObj.version) {
      cachedWaVersion = vObj.version;
      console.log(`[WA Protocol] Fetched latest WhatsApp Web protocol version: ${cachedWaVersion.join('.')}`);
      return cachedWaVersion;
    }
  } catch (e) {
    console.log('[WA Protocol] Using fallback WhatsApp Web protocol version.');
  }
  cachedWaVersion = [2, 3000, 1015901307];
  return cachedWaVersion;
}

export const sessionManager = {
  setAutoLogoutListener(fn) {
    autoLogoutListener = fn;
  },

  getSessionDir(telegramId) {
    return path.join(config.sessionsDir, `session_${telegramId}`);
  },

  getStatus(telegramId) {
    return sessionStatus.get(String(telegramId)) || 'disconnected';
  },

  getSocket(telegramId) {
    return activeSessions.get(String(telegramId));
  },

  isSessionConnected(telegramId) {
    const status = this.getStatus(telegramId);
    const sock = this.getSocket(telegramId);
    return status === 'connected' && sock && sock.user;
  },

  // Returns user's own connected session, or any available admin/system connected session
  getAvailableSocket(telegramId) {
    if (this.isSessionConnected(telegramId)) {
      return this.getSocket(telegramId);
    }
    // Try Admin sessions
    for (const adminId of config.adminIds) {
      if (this.isSessionConnected(adminId)) {
        return this.getSocket(adminId);
      }
    }
    // Try any connected session
    for (const [key, status] of sessionStatus.entries()) {
      if (status === 'connected') {
        const sock = activeSessions.get(key);
        if (sock && sock.user) return sock;
      }
    }
    return null;
  },

  hasAnyConnectedSession() {
    for (const [key, status] of sessionStatus.entries()) {
      if (status === 'connected') return true;
    }
    return false;
  },

  async initSession(telegramId, callbacks = {}, isFreshPairing = false) {
    const key = String(telegramId);
    const sessionPath = this.getSessionDir(key);

    if (this.isSessionConnected(telegramId)) {
      return activeSessions.get(key);
    }

    sessionStatus.set(key, 'connecting');

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const version = await getWaVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger,
      browser: Browsers.macOS('Chrome'), // Standard macOS Chrome payload for smooth 8-digit pairing code authorization
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      retryRequestDelayMs: 250,
      maxRetries: 5,
      emitOwnEvents: false,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      generateHighQualityLinkPreview: false
    });

    activeSessions.set(key, sock);

    sock.ev.on('creds.update', async () => {
      await saveCreds();
      try {
        dbService.triggerCloudSync();
      } catch (e) {}
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        sessionStatus.set(key, 'qr_ready');
        if (callbacks.onQR) {
          callbacks.onQR(qr);
        }
      }

      if (connection === 'open') {
        sessionStatus.set(key, 'connected');
        reconnectAttempts.delete(key);
        console.log(`[WA] Session connected for TG User: ${key}`);

        // ONLY trigger onConnected notification card when user actively paired account (isFreshPairing === true)
        if (isFreshPairing && callbacks.onConnected) {
          try { callbacks.onConnected(sock.user); } catch (e) {}
        }

        try {
          dbService.triggerCloudSync();
        } catch (e) {}
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        const prevStatus = sessionStatus.get(key);
        console.log(`[WA] Session closed for ${key}. Reason code: ${statusCode}, Reconnect: ${shouldReconnect}, PrevStatus: ${prevStatus}`);

        sessionStatus.set(key, 'disconnected');
        activeSessions.delete(key);

        if (shouldReconnect) {
          const attempts = (reconnectAttempts.get(key) || 0) + 1;
          reconnectAttempts.set(key, attempts);
          const backoffDelay = Math.min(3000 * Math.pow(1.4, attempts - 1), 30000);
          console.log(`[WA] Auto-reconnecting for ${key} (Attempt ${attempts}, backoff ${Math.round(backoffDelay / 1000)}s)...`);

          setTimeout(() => {
            this.initSession(telegramId, callbacks, false).catch(err => console.error('[WA] Reconnect error:', err));
          }, backoffDelay);
        } else {
          reconnectAttempts.delete(key);
          try {
            fs.rmSync(sessionPath, { recursive: true, force: true });
          } catch (e) {}

          if (callbacks.onLoggedOut) {
            callbacks.onLoggedOut();
          }

          // Trigger autoLogoutListener ONLY if the session was previously fully connected!
          if (autoLogoutListener && prevStatus === 'connected') {
            try { autoLogoutListener(telegramId); } catch (e) {}
          }

          try {
            dbService.triggerCloudSync();
          } catch (e) {}
        }

        if (callbacks.onClose) {
          callbacks.onClose(statusCode, shouldReconnect);
        }
      }
    });

    return sock;
  },

  async requestPairingCode(telegramId, phoneNumber, callbacks = {}) {
    const key = String(telegramId);

    // Clean phone number (digits only)
    const cleanNum = phoneNumber.replace(/[^\d]/g, '');
    if (!cleanNum || cleanNum.length < 7) {
      throw new Error('Invalid phone number format. Please include full country code without symbols (e.g. 8801712345678 or 1234567890).');
    }

    // Force purge any old/stale session directory silently before starting clean pairing
    await this.logoutSession(telegramId, true);

    // Pass isFreshPairing = true for explicit user pairing code request
    const sock = await this.initSession(telegramId, callbacks, true);

    // Wait until WebSocket connection is fully open (polling every 100ms)
    let attempts = 0;
    while (!sock.ws || sock.ws.readyState !== 1) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
      if (attempts > 50) break; // max 5 seconds timeout
    }

    // Give socket key registration handshake 1.5 seconds to settle with WhatsApp servers
    await new Promise(r => setTimeout(r, 1500));

    const code = await sock.requestPairingCode(cleanNum);
    return code;
  },

  async logoutSession(telegramId, silent = false) {
    const key = String(telegramId);
    reconnectAttempts.delete(key);
    const sock = activeSessions.get(key);
    if (silent) {
      sessionStatus.set(key, 'disconnected');
    }
    if (sock) {
      try {
        await sock.logout();
      } catch (e) {
        try { sock.end(undefined); } catch (err) {}
      }
      activeSessions.delete(key);
    }
    sessionStatus.set(key, 'disconnected');
    const sessionPath = this.getSessionDir(key);
    if (fs.existsSync(sessionPath)) {
      try {
        fs.rmSync(sessionPath, { recursive: true, force: true });
      } catch (e) {}
    }
    try {
      dbService.triggerCloudSync();
    } catch (e) {}
  },

  getActiveSessionsCount() {
    let count = 0;
    for (const [key, status] of sessionStatus.entries()) {
      if (status === 'connected') count++;
    }
    return count;
  }
};
