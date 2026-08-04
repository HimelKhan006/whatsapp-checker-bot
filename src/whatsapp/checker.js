import { sessionManager } from './sessionManager.js';
import { cleanPhoneNumber } from '../utils/phoneFormatter.js';

export async function checkSingleNumber(telegramId, rawNumber) {
  const sock = sessionManager.getAvailableSocket(telegramId);
  if (!sock) {
    throw new Error('No active WhatsApp session connected. Please pair a WhatsApp account via 📱 WA Session first!');
  }

  const clean = cleanPhoneNumber(rawNumber);
  if (!clean || clean.length < 7) {
    throw new Error('Invalid phone number format. Please provide full country code e.g. +1234567890');
  }

  let results = null;
  try {
    results = await sock.onWhatsApp(clean);
  } catch (e) {
    try {
      results = await sock.onWhatsApp(`${clean}@s.whatsapp.net`);
    } catch (err) {
      console.error(`onWhatsApp query error for ${clean}:`, err);
    }
  }

  const result = (results && Array.isArray(results) && results.length > 0) ? results[0] : null;
  const isRegistered = Boolean(result && result.exists);

  let isBusiness = false;
  if (isRegistered && result.jid) {
    try {
      const bizPromise = sock.getBusinessProfile(result.jid);
      const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 300));
      const biz = await Promise.race([bizPromise, timeoutPromise]);
      if (biz) isBusiness = true;
    } catch (e) {
      // Personal account
    }
  }

  return {
    number: clean,
    registered: isRegistered,
    jid: isRegistered ? result.jid : null,
    isBusiness
  };
}

export async function checkBulkNumbers(telegramId, numberList, options = {}) {
  const sock = sessionManager.getAvailableSocket(telegramId);
  if (!sock) {
    throw new Error('No active WhatsApp session connected. Please pair a WhatsApp account via 📱 WA Session first!');
  }

  const { delayMs = 0, onProgress, isAborted } = options;
  const results = [];
  let registeredCount = 0;
  let unregisteredCount = 0;

  const total = numberList.length;

  for (let i = 0; i < total; i++) {
    if (isAborted && isAborted()) break;

    const num = numberList[i];
    let res;
    try {
      res = await checkSingleNumber(telegramId, num);
    } catch (err) {
      res = {
        number: cleanPhoneNumber(num),
        registered: false,
        jid: null,
        isBusiness: false
      };
    }

    if (res.registered) {
      registeredCount++;
    } else {
      unregisteredCount++;
    }

    results.push(res);

    if (onProgress) {
      await onProgress({
        current: i + 1,
        total,
        registered: registeredCount,
        unregistered: unregisteredCount,
        lastResult: res
      });
    }

    if (delayMs > 0 && i < total - 1) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }

  return {
    totalChecked: results.length,
    registeredCount,
    unregisteredCount,
    results
  };
}
