import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

export const config = {
  botToken: process.env.BOT_TOKEN || '',
  adminIds: (process.env.ADMIN_IDS || '').split(',').map(id => id.trim()).filter(Boolean).map(Number),
  botMode: process.env.BOT_MODE || 'authorized', // 'public' | 'authorized' | 'private'
  checkDelayMs: parseInt(process.env.CHECK_DELAY_MS || '0', 10), // Default 0ms for instant check
  maxBulkLimit: parseInt(process.env.MAX_BULK_LIMIT || '5000', 10),
  dbPath: path.join(ROOT_DIR, 'data.db'),
  sessionsDir: path.join(ROOT_DIR, 'sessions'),
  tempDir: path.join(ROOT_DIR, 'temp'),
  rootDir: ROOT_DIR,
};
