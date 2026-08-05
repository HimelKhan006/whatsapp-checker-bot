import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

let isSyncing = false;
let pendingSync = false;

/**
 * Download database backup snapshot and WhatsApp sessions from GitHub Gist on startup
 */
export async function restoreFromGist() {
  const gistToken = process.env.GITHUB_GIST_TOKEN || process.env.GIST_TOKEN;
  const gistId = process.env.GIST_ID;

  if (!gistToken || !gistId) {
    console.log('ℹ️ GitHub Gist Cloud Sync skipped (GITHUB_GIST_TOKEN or GIST_ID not provided in environment).');
    return false;
  }

  try {
    console.log('🔄 Checking GitHub Gist for remote database & session backup...');
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
    
    // 1. Restore Database
    const dbFile = gistData.files && (gistData.files['database.sqlite.json'] || gistData.files['database_backup.json']);
    let backupData = false;
    if (dbFile && dbFile.content) {
      backupData = JSON.parse(dbFile.content);
      const dbDir = path.dirname(config.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }
      fs.writeFileSync(path.join(dbDir, 'gist_cloud_restore.json'), JSON.stringify(backupData, null, 2));
      console.log('✅ Remote database backup successfully fetched from GitHub Gist!');
    }

    // 2. Restore Paired WhatsApp Sessions across Render container resets
    const sessionFile = gistData.files && gistData.files['wa_sessions.json'];
    if (sessionFile && sessionFile.content) {
      try {
        const sessionsMap = JSON.parse(sessionFile.content);
        if (sessionsMap && typeof sessionsMap === 'object') {
          for (const [folderName, files] of Object.entries(sessionsMap)) {
            const targetFolder = path.join(config.sessionsDir, folderName);
            if (!fs.existsSync(targetFolder)) {
              fs.mkdirSync(targetFolder, { recursive: true });
            }
            for (const [filename, fileContent] of Object.entries(files)) {
              fs.writeFileSync(path.join(targetFolder, filename), fileContent, 'utf-8');
            }
          }
          console.log('✅ Paired WhatsApp sessions successfully restored from GitHub Gist Cloud!');
        }
      } catch (e) {
        console.error('⚠️ Warning restoring cloud WA sessions:', e.message);
      }
    }

    return backupData;
  } catch (err) {
    console.error('❌ Failed to restore backup from GitHub Gist:', err.message);
  }

  return false;
}

/**
 * Upload database snapshot and WhatsApp sessions to GitHub Gist asynchronously
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
    // Pack all active WhatsApp session credential files for cloud persistence
    const waSessionsMap = {};
    if (fs.existsSync(config.sessionsDir)) {
      const folders = fs.readdirSync(config.sessionsDir).filter(f => f.startsWith('session_'));
      for (const folder of folders) {
        const folderPath = path.join(config.sessionsDir, folder);
        if (fs.statSync(folderPath).isDirectory()) {
          const files = fs.readdirSync(folderPath);
          waSessionsMap[folder] = {};
          for (const file of files) {
            // Backup creds.json and key state files
            if (file.endsWith('.json')) {
              const content = fs.readFileSync(path.join(folderPath, file), 'utf-8');
              waSessionsMap[folder][file] = content;
            }
          }
        }
      }
    }

    const payload = {
      description: 'Encrypted Professional WhatsApp Checker Bot Cloud Backup',
      files: {
        'database.sqlite.json': {
          content: JSON.stringify(databaseDump, null, 2)
        },
        'wa_sessions.json': {
          content: JSON.stringify(waSessionsMap, null, 2)
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
      console.log('☁️ Database & WhatsApp sessions successfully backed up to GitHub Gist Cloud!');
    } else {
      console.error(`⚠️ GitHub Gist upload failed with status ${response.status}`);
    }
  } catch (err) {
    console.error('❌ Error uploading snapshot to GitHub Gist:', err.message);
  } finally {
    isSyncing = false;
    if (pendingSync) {
      pendingSync = false;
      syncToGist(databaseDump);
    }
  }
}
