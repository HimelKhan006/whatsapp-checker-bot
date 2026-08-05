/**
 * Utility functions for cleaning, validating, and formatting phone numbers and names.
 */

export function cleanPhoneNumber(raw) {
  if (!raw) return '';
  // Remove all non-digits except optional leading '+'
  let str = String(raw).trim();
  str = str.replace(/[^\d+]/g, '');
  if (str.startsWith('+')) {
    str = str.slice(1);
  }
  return str;
}

export function isValidPhoneNumber(number) {
  const cleaned = cleanPhoneNumber(number);
  // Phone numbers worldwide are generally between 7 and 15 digits long
  return /^\d{7,15}$/.test(cleaned);
}

export function formatFullPhone(rawJidOrNumber) {
  if (!rawJidOrNumber) return 'N/A';
  let digits = String(rawJidOrNumber).split('@')[0].split(':')[0].replace(/[^\d]/g, '');
  return digits ? `+${digits}` : 'N/A';
}

export function formatMaskedPhone(rawJidOrNumber) {
  if (!rawJidOrNumber) return 'N/A';
  let digits = String(rawJidOrNumber).split('@')[0].split(':')[0].replace(/[^\d]/g, '');
  if (!digits || digits.length <= 6) return digits ? `+${digits}` : 'N/A';

  const prefix = digits.slice(0, 5);
  const suffix = digits.slice(-3);
  return `+${prefix}****${suffix}`;
}

export function maskName(name) {
  if (!name) return 'Anonymous';
  const trimmed = name.trim();
  if (trimmed.length <= 2) return trimmed[0] + '*';
  if (trimmed.length <= 4) return trimmed[0] + '**' + trimmed[trimmed.length - 1];
  const keepFirst = 2;
  const keepLast = 2;
  const stars = '*'.repeat(Math.max(2, trimmed.length - keepFirst - keepLast));
  return trimmed.slice(0, keepFirst) + stars + trimmed.slice(-keepLast);
}

export function parseBulkNumbers(textOrBuffer) {
  const content = typeof textOrBuffer === 'string' 
    ? textOrBuffer 
    : textOrBuffer.toString('utf-8');

  // Split by newline, comma, semicolon, or whitespace (spaces & tabs)
  const lines = content.split(/[\r\n,;\s]+/);
  const validNumbers = [];
  const invalidEntries = [];

  const seen = new Set();

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    const cleaned = cleanPhoneNumber(line);
    if (isValidPhoneNumber(cleaned)) {
      if (!seen.has(cleaned)) {
        seen.add(cleaned);
        validNumbers.push(cleaned);
      }
    } else {
      invalidEntries.push(line);
    }
  }

  return {
    validNumbers,
    invalidEntries,
    totalParsed: validNumbers.length + invalidEntries.length
  };
}
