import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import pino from 'pino';
import { config } from '../config.js';

if (!fs.existsSync(config.sessionsDir)) {
  fs.mkdirSync(config.sessionsDir, { recursive: true });
}

// Map of active WhatsApp socket instances keyed by telegramId
const activeSessions = new Map();
const sessionStatus = new Map(); // 'disconnected' | 'connecting' | 'connected' | 'qr_ready'
let autoLogoutListener = null;

const logger = pino({ level: 'silent' });

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

  async initSession(telegramId, callbacks = {}) {
    const key = String(telegramId);
    const sessionPath = this.getSessionDir(key);

    if (this.isSessionConnected(telegramId)) {
      return activeSessions.get(key);
    }

    sessionStatus.set(key, 'connecting');

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger,
      browser: Browsers.macOS('Desktop'), // Standard macOS Desktop payload recognized cleanly by WhatsApp
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 25000,
      emitOwnEvents: false,
      markOnlineOnConnect: false,
      syncFullHistory: false
    });

    activeSessions.set(key, sock);

    sock.ev.on('creds.update', saveCreds);

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
        console.log(`[WA] Session connected for TG User: ${key}`);
        if (callbacks.onConnected) {
          callbacks.onConnected(sock.user);
        }
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        console.log(`[WA] Session closed for ${key}. Reason code: ${statusCode}, Reconnect: ${shouldReconnect}`);

        sessionStatus.set(key, 'disconnected');
        activeSessions.delete(key);

        if (shouldReconnect) {
          console.log(`[WA] Auto-reconnecting for ${key}...`);
          setTimeout(() => {
            this.initSession(telegramId, callbacks).catch(err => console.error('[WA] Reconnect error:', err));
          }, 3000);
        } else {
          try {
            fs.rmSync(sessionPath, { recursive: true, force: true });
          } catch (e) {}

          if (callbacks.onLoggedOut) {
            callbacks.onLoggedOut();
          }

          if (autoLogoutListener) {
            try { autoLogoutListener(telegramId); } catch (e) {}
          }
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

    // Force purge any old/stale session directory for clean registration
    await this.logoutSession(telegramId);

    const sock = await this.initSession(telegramId, callbacks);

    // Fast WebSocket connection wait (polls every 100ms for ultra-fast response)
    let attempts = 0;
    while (!sock.ws || sock.ws.readyState !== 1) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
      if (attempts > 50) break; // max 5 seconds timeout
    }

    const code = await sock.requestPairingCode(cleanNum);
    return code;
  },

  async logoutSession(telegramId) {
    const key = String(telegramId);
    const sock = activeSessions.get(key);
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
  },

  getActiveSessionsCount() {
    let count = 0;
    for (const [key, status] of sessionStatus.entries()) {
      if (status === 'connected') count++;
    }
    return count;
  }
};
