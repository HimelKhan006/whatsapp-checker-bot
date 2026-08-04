import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

let isSyncing = false;
let pendingSync = false;

/**
 * Download database backup snapshot from GitHub Gist on startup
 */
export async function restoreFromGist() {
  const gistToken = process.env.GITHUB_GIST_TOKEN || process.env.GIST_TOKEN;
  const gistId = process.env.GIST_ID;

  if (!gistToken || !gistId) {
    console.log('ℹ️ GitHub Gist Cloud Sync skipped (GITHUB_GIST_TOKEN or GIST_ID not provided in environment).');
    return false;
  }

  try {
    console.log('🔄 Checking GitHub Gist for remote database backup...');
    const response = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers: {
        'Authorization': `token ${gistToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'WhatsAppCheckerBot'
      }
    });

    if (!response.ok) {
      console.error(`⚠️ GitHub Gist fetch failed with status ${response.status}`);
      return false;
    }

    const gistData = await response.json();
    const dbFile = gistData.files && (gistData.files['database.sqlite.json'] || gistData.files['database_backup.json']);

    if (dbFile && dbFile.content) {
      const backupData = JSON.parse(dbFile.content);
      const dbDir = path.dirname(config.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      // Write backup data to local JSON file for SQLite sync
      fs.writeFileSync(path.join(dbDir, 'gist_cloud_restore.json'), JSON.stringify(backupData, null, 2));
      console.log('✅ Remote database backup successfully fetched from GitHub Gist!');
      return backupData;
    }
  } catch (err) {
    console.error('❌ Failed to restore database from GitHub Gist:', err.message);
  }

  return false;
}

/**
 * Upload database snapshot to GitHub Gist asynchronously
 */
export async function syncToGist(databaseDump) {
  const gistToken = process.env.GITHUB_GIST_TOKEN || process.env.GIST_TOKEN;
  const gistId = process.env.GIST_ID;

  if (!gistToken || !gistId) {
    return;
  }

  if (isSyncing) {
    pendingSync = true;
    return;
  }

  isSyncing = true;

  try {
    const payload = {
      description: 'Encrypted Professional WhatsApp Checker Bot Database Backup',
      files: {
        'database.sqlite.json': {
          content: JSON.stringify(databaseDump, null, 2)
        }
      }
    };

    const response = await fetch(`https://api.github.com/gists/${gistId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `token ${gistToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'User-Agent': 'WhatsAppCheckerBot'
      },
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      console.log('☁️ Database snapshot successfully backed up to GitHub Gist!');
    } else {
      console.error(`⚠️ GitHub Gist upload failed with status ${response.status}`);
    }
  } catch (err) {
    console.error('❌ Failed to upload database snapshot to GitHub Gist:', err.message);
  } finally {
    isSyncing = false;
    if (pendingSync) {
      pendingSync = false;
      syncToGist(databaseDump);
    }
  }
}
