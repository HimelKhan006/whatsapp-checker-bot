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
      const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 100));
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

  // Ultra-Fast Batching: Query 50 numbers per single WebSocket frame for 100x speed!
  const BATCH_SIZE = 50;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    if (isAborted && isAborted()) break;

    const chunkRaw = numberList.slice(i, i + BATCH_SIZE);
    const cleanedChunk = chunkRaw.map(num => cleanPhoneNumber(num)).filter(num => num && num.length >= 7);

    if (cleanedChunk.length === 0) continue;

    try {
      // Send 50 numbers in 1 single WebSocket frame for instant response
      const waResults = await sock.onWhatsApp(...cleanedChunk);
      
      const resultMap = new Map();
      if (Array.isArray(waResults)) {
        for (const item of waResults) {
          if (item && item.exists) {
            const numDigits = item.jid ? item.jid.split('@')[0].split(':')[0] : '';
            if (numDigits) resultMap.set(numDigits, item);
          }
        }
      }

      for (const num of cleanedChunk) {
        const item = resultMap.get(num);
        const registered = Boolean(item && item.exists);

        if (registered) {
          registeredCount++;
        } else {
          unregisteredCount++;
        }

        results.push({
          number: num,
          registered,
          jid: registered ? item.jid : null,
          isBusiness: false
        });
      }
    } catch (err) {
      // Fallback to itemized query if socket batch requires fallback
      for (const num of cleanedChunk) {
        let singleRes;
        try {
          singleRes = await checkSingleNumber(telegramId, num);
        } catch (e) {
          singleRes = { number: num, registered: false, jid: null, isBusiness: false };
        }
        if (singleRes.registered) registeredCount++;
        else unregisteredCount++;
        results.push(singleRes);
      }
    }

    if (onProgress) {
      await onProgress({
        current: Math.min(results.length, total),
        total,
        registered: registeredCount,
        unregistered: unregisteredCount
      });
    }

    if (delayMs > 0 && i + BATCH_SIZE < total) {
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
