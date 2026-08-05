import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { encryptData, decryptData } from '../utils/crypto.js';
import { syncToGist, restoreFromGist } from './gistSync.js';

// Support Render persistent storage or fallback to ROOT_DIR
const customDataDir = process.env.DATA_DIR;
const targetDbPath = customDataDir ? path.join(customDataDir, 'data.db') : config.dbPath;

// Ensure data directory exists
const dbDir = path.dirname(targetDbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(targetDbPath);
db.pragma('journal_mode = WAL');

// Initialize database tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    role TEXT DEFAULT 'user',
    status TEXT DEFAULT 'pending',
    referrer_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_active DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS check_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id INTEGER,
    type TEXT,
    total_checked INTEGER,
    registered_count INTEGER,
    unregistered_count INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS custom_buttons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

try {
  db.exec("ALTER TABLE users ADD COLUMN referrer_id INTEGER;");
} catch (e) {
  // Column already exists
}

// Helper to decrypt user record
function formatUserRecord(row) {
  if (!row) return null;
  return {
    ...row,
    first_name: decryptData(row.first_name),
    username: decryptData(row.username)
  };
}

export const dbService = {
  // Initialize Cloud Sync on startup (Restores Users, Settings, & Check Log Counters from GitHub Gist)
  async initCloudSync() {
    try {
      const backup = await restoreFromGist();
      if (backup && backup.users && Array.isArray(backup.users)) {
        console.log(`📥 Restoring ${backup.users.length} user records from GitHub Gist backup...`);
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO users (telegram_id, username, first_name, role, status, referrer_id, created_at, last_active)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const u of backup.users) {
          stmt.run(
            u.telegram_id,
            u.username || '',
            u.first_name || '',
            u.role || 'user',
            u.status || 'pending',
            u.referrer_id || null,
            u.created_at || new Date().toISOString(),
            u.last_active || new Date().toISOString()
          );
        }
      }

      if (backup && backup.settings && Array.isArray(backup.settings)) {
        const stmt = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
        for (const s of backup.settings) {
          stmt.run(s.key, s.value);
        }
      }

      // Restore Check Logs & Total Counters from Cloud Gist
      if (backup && backup.check_logs && Array.isArray(backup.check_logs)) {
        console.log(`📥 Restoring ${backup.check_logs.length} check log records from GitHub Gist backup...`);
        const stmt = db.prepare(`
          INSERT OR IGNORE INTO check_logs (id, telegram_id, type, total_checked, registered_count, unregistered_count, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const c of backup.check_logs) {
          stmt.run(
            c.id,
            c.telegram_id,
            c.type || 'single',
            c.total_checked || 0,
            c.registered_count || 0,
            c.unregistered_count || 0,
            c.created_at || new Date().toISOString()
          );
        }
      }
    } catch (e) {
      console.error('⚠️ Cloud sync initialization warning:', e.message);
    }
  },

  // Export encrypted database dump & check counters for cloud Gist sync
  triggerGistSync() {
    setTimeout(() => {
      try {
        const rawUsers = db.prepare('SELECT * FROM users').all();
        const settings = db.prepare('SELECT * FROM settings').all();
        const checkLogs = db.prepare('SELECT * FROM check_logs').all();
        const dump = {
          updated_at: new Date().toISOString(),
          users: rawUsers,
          settings,
          check_logs: checkLogs
        };
        syncToGist(dump);
      } catch (e) {
        console.error('⚠️ Gist export error:', e.message);
      }
    }, 500);
  },

  // User Management
  getUser(telegramId) {
    const row = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
    return formatUserRecord(row);
  },

  upsertUser(telegramId, username, firstName, defaultRole = 'user', defaultStatus = 'pending', referrerId = null) {
    const existing = this.getUser(telegramId);
    const encFirstName = encryptData(firstName || '');
    const encUsername = encryptData(username || '');

    if (!existing) {
      db.prepare(`
        INSERT INTO users (telegram_id, username, first_name, role, status, referrer_id, created_at, last_active)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `).run(telegramId, encUsername, encFirstName, defaultRole, defaultStatus, referrerId);
      this.triggerGistSync();
      return this.getUser(telegramId);
    } else {
      db.prepare(`
        UPDATE users SET username = ?, first_name = ?, last_active = CURRENT_TIMESTAMP WHERE telegram_id = ?
      `).run(encUsername, encFirstName, telegramId);
      this.triggerGistSync();
      return this.getUser(telegramId);
    }
  },

  setUserStatus(telegramId, status) {
    db.prepare('UPDATE users SET status = ? WHERE telegram_id = ?').run(status, telegramId);
    this.triggerGistSync();
  },

  setUserRole(telegramId, role) {
    db.prepare('UPDATE users SET role = ? WHERE telegram_id = ?').run(role, telegramId);
    this.triggerGistSync();
  },

  deleteUser(telegramId) {
    db.prepare('DELETE FROM users WHERE telegram_id = ?').run(telegramId);
    db.prepare('DELETE FROM check_logs WHERE telegram_id = ?').run(telegramId);
    this.triggerGistSync();
  },

  setReferrer(telegramId, referrerId) {
    const user = this.getUser(telegramId);
    if (user && !user.referrer_id && Number(referrerId) !== Number(telegramId)) {
      db.prepare('UPDATE users SET referrer_id = ? WHERE telegram_id = ?').run(referrerId, telegramId);
      this.triggerGistSync();
    }
  },

  getUserReferralStats(telegramId) {
    const totalReferred = db.prepare('SELECT COUNT(*) as count FROM users WHERE referrer_id = ?').get(telegramId).count || 0;
    const rawReferred = db.prepare('SELECT telegram_id, first_name, username, created_at FROM users WHERE referrer_id = ? ORDER BY created_at DESC LIMIT 10').all(telegramId);
    
    return {
      totalReferred,
      referredUsers: rawReferred.map(formatUserRecord)
    };
  },

  getReferralLeaderboard() {
    const rawList = db.prepare(`
      SELECT 
        u.telegram_id, 
        u.first_name, 
        u.username, 
        COUNT(ref.telegram_id) as referral_count
      FROM users u
      LEFT JOIN users ref ON ref.referrer_id = u.telegram_id
      GROUP BY u.telegram_id
      HAVING referral_count > 0
      ORDER BY referral_count DESC, u.created_at ASC
    `).all();

    return rawList.map(item => ({
      ...item,
      first_name: decryptData(item.first_name),
      username: decryptData(item.username)
    }));
  },

  getUserRank(telegramId) {
    const leaderboard = this.getReferralLeaderboard();
    const index = leaderboard.findIndex(u => Number(u.telegram_id) === Number(telegramId));
    if (index === -1) {
      return { rank: null, referral_count: 0 };
    }
    return { rank: index + 1, referral_count: leaderboard[index].referral_count };
  },

  getAllUsers() {
    const rows = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
    return rows.map(formatUserRecord);
  },

  getBannedUsers() {
    const rows = db.prepare("SELECT * FROM users WHERE status = 'blocked' ORDER BY created_at DESC").all();
    return rows.map(formatUserRecord);
  },

  approveAllPendingUsers() {
    const res = db.prepare("UPDATE users SET status = 'approved' WHERE status = 'pending'").run();
    this.triggerGistSync();
    return res.changes;
  },

  blockAllPendingUsers() {
    const res = db.prepare("UPDATE users SET status = 'blocked' WHERE status = 'pending'").run();
    this.triggerGistSync();
    return res.changes;
  },

  unbanAllUsers() {
    const res = db.prepare("UPDATE users SET status = 'approved' WHERE status = 'blocked'").run();
    this.triggerGistSync();
    return res.changes;
  },

  getActiveUsersCount(hours = 24) {
    return db.prepare(`
      SELECT COUNT(*) as count FROM users 
      WHERE datetime(last_active) >= datetime('now', '-${hours} hours')
    `).get().count || 0;
  },

  getPendingUsers() {
    const rows = db.prepare("SELECT * FROM users WHERE status = 'pending' ORDER BY created_at ASC").all();
    return rows.map(formatUserRecord);
  },

  // Dynamic Settings
  getSetting(key, defaultValue = null) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : defaultValue;
  },

  setSetting(key, value) {
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
    this.triggerGistSync();
  },

  // Custom Buttons Management
  addCustomButton(label, type, value) {
    db.prepare(`
      INSERT INTO custom_buttons (label, type, value, status)
      VALUES (?, ?, ?, 'active')
    `).run(label, type, value);
  },

  getAllCustomButtons() {
    return db.prepare('SELECT * FROM custom_buttons ORDER BY id ASC').all();
  },

  getActiveCustomButtons() {
    return db.prepare("SELECT * FROM custom_buttons WHERE status = 'active' ORDER BY id ASC").all();
  },

  getCustomButton(id) {
    return db.prepare('SELECT * FROM custom_buttons WHERE id = ?').get(id);
  },

  deleteCustomButton(id) {
    db.prepare('DELETE FROM custom_buttons WHERE id = ?').run(id);
  },

  toggleCustomButtonStatus(id) {
    const btn = this.getCustomButton(id);
    if (btn) {
      const nextStatus = btn.status === 'active' ? 'disabled' : 'active';
      db.prepare('UPDATE custom_buttons SET status = ? WHERE id = ?').run(nextStatus, id);
    }
  },

  // Check Logs & Realtime Counters (Synced to Cloud Gist)
  logCheck(telegramId, type, total, registered, unregistered) {
    db.prepare(`
      INSERT INTO check_logs (telegram_id, type, total_checked, registered_count, unregistered_count)
      VALUES (?, ?, ?, ?, ?)
    `).run(telegramId, type, total, registered, unregistered);
    this.triggerGistSync();
  },

  getUserStats(telegramId) {
    const singleCount = db.prepare("SELECT COUNT(*) as count FROM check_logs WHERE telegram_id = ? AND type = 'single'").get(telegramId).count || 0;
    const bulkCount = db.prepare("SELECT COUNT(*) as count FROM check_logs WHERE telegram_id = ? AND type = 'bulk'").get(telegramId).count || 0;
    const totalChecked = db.prepare("SELECT SUM(total_checked) as count FROM check_logs WHERE telegram_id = ?").get(telegramId).count || 0;
    const registeredCount = db.prepare("SELECT SUM(registered_count) as count FROM check_logs WHERE telegram_id = ?").get(telegramId).count || 0;
    const unregisteredCount = db.prepare("SELECT SUM(unregistered_count) as count FROM check_logs WHERE telegram_id = ?").get(telegramId).count || 0;

    return {
      singleCount,
      bulkCount,
      totalChecked,
      registeredCount,
      unregisteredCount
    };
  },

  getStats() {
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalApprovedUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'approved'").get().count;
    const totalPendingUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'pending'").get().count;
    const totalBannedUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE status = 'blocked'").get().count;
    const activeUsers = this.getActiveUsersCount(24);
    const totalChecks = db.prepare('SELECT SUM(total_checked) as count FROM check_logs').get().count || 0;
    const totalRegistered = db.prepare('SELECT SUM(registered_count) as count FROM check_logs').get().count || 0;
    const totalUnregistered = db.prepare('SELECT SUM(unregistered_count) as count FROM check_logs').get().count || 0;

    return {
      totalUsers,
      totalApprovedUsers,
      totalPendingUsers,
      totalBannedUsers,
      activeUsers,
      totalChecks,
      totalRegistered,
      totalUnregistered
    };
  }
};
