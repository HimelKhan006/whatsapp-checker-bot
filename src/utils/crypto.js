import crypto from 'crypto';

// Encryption Algorithm: AES-256-GCM
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Standard 96-bit IV for GCM
const AUTH_TAG_LENGTH = 16;

/**
 * Derive a 32-byte (256-bit) buffer key from the provided secret phrase/env key.
 */
function getDerivedKey(secretKey) {
  const keyInput = secretKey || process.env.ENCRYPTION_KEY || 'default_antigravity_secret_key_32bytes_min!';
  return crypto.createHash('sha256').update(keyInput).digest();
}

/**
 * Encrypt a plain text string into a secure hex string containing IV, Auth Tag, and Ciphertext.
 */
export function encryptData(text, secretKey = null) {
  if (!text) return text;
  try {
    const key = getDerivedKey(secretKey);
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');
    const ivHex = iv.toString('hex');

    // Format: iv:authTag:encryptedText
    return `${ivHex}:${authTag}:${encrypted}`;
  } catch (err) {
    console.error('Encryption error:', err);
    return text;
  }
}

/**
 * Decrypt a secure hex string back to plain text.
 */
export function decryptData(encryptedString, secretKey = null) {
  if (!encryptedString || typeof encryptedString !== 'string') return encryptedString;
  const parts = encryptedString.split(':');
  if (parts.length !== 3) {
    // Return original string if not in encrypted format (backward compatibility)
    return encryptedString;
  }

  try {
    const [ivHex, authTagHex, encryptedHex] = parts;
    const key = getDerivedKey(secretKey);
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    console.error('Decryption error:', err.message);
    return encryptedString;
  }
}
