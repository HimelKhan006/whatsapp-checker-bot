import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

if (!fs.existsSync(config.tempDir)) {
  fs.mkdirSync(config.tempDir, { recursive: true });
}

export function generateCSVReport(results, filter = 'all') {
  let filtered = results;
  if (filter === 'registered') {
    filtered = results.filter(r => r.registered);
  } else if (filter === 'unregistered') {
    filtered = results.filter(r => !r.registered);
  }

  const headers = ['Phone Number', 'Status', 'WhatsApp JID', 'Is Business', 'Checked At'];
  const rows = filtered.map(r => [
    `"${r.number}"`,
    `"${r.registered ? 'REGISTERED' : 'UNREGISTERED'}"`,
    `"${r.jid || 'N/A'}"`,
    `"${r.isBusiness ? 'YES' : 'NO'}"`,
    `"${new Date().toISOString()}"`
  ]);

  const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  
  const filename = `wa_check_${filter}_${Date.now()}.csv`;
  const filePath = path.join(config.tempDir, filename);
  fs.writeFileSync(filePath, csvContent, 'utf-8');

  return { filePath, filename, count: filtered.length };
}

export function generateTXTReport(results, filter = 'all') {
  let filtered = results;
  if (filter === 'registered') {
    filtered = results.filter(r => r.registered);
  } else if (filter === 'unregistered') {
    filtered = results.filter(r => !r.registered);
  }

  const lines = filtered.map(r => r.number);
  const txtContent = lines.join('\n');

  const filename = `wa_check_${filter}_${Date.now()}.txt`;
  const filePath = path.join(config.tempDir, filename);
  fs.writeFileSync(filePath, txtContent, 'utf-8');

  return { filePath, filename, count: filtered.length };
}
