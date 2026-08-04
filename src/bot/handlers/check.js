import { InputFile } from 'grammy';
import { keyboards } from '../keyboards/inline.js';
import { sessionManager } from '../../whatsapp/sessionManager.js';
import { checkSingleNumber, checkBulkNumbers } from '../../whatsapp/checker.js';
import { parseBulkNumbers, isValidPhoneNumber, cleanPhoneNumber } from '../../utils/phoneFormatter.js';
import { generateCSVReport, generateTXTReport } from '../../utils/reportExporter.js';
import { dbService } from '../../db/database.js';
import { config } from '../../config.js';

// Cache for bulk check results keyed by jobId
const bulkJobsCache = new Map();
const userCheckState = new Map();

export function registerCheckHandlers(bot) {
  // Command: /check <number or numbers>
  bot.command('check', async (ctx) => {
    const telegramId = ctx.from.id;

    if (!sessionManager.getAvailableSocket(telegramId)) {
      return ctx.reply(
        '⚠️ <b>WhatsApp Account Not Paired</b>\n\n' +
        'Please link a WhatsApp account first via 📱 <b>Connect</b> menu before checking numbers.',
        { parse_mode: 'HTML', reply_markup: keyboards.waPairingMenu(false) }
      );
    }

    const args = ctx.match ? ctx.match.trim() : '';
    if (!args) {
      const promptMsg = await ctx.reply(
        `🔍 <b>WhatsApp Registration Checker</b>\n\n` +
        `Send phone numbers in any format:\n` +
        `• Single number (e.g. <code>+1234567890</code>)\n` +
        `• Multiple numbers (one per line, comma or space separated)\n` +
        `• Upload a <code>.txt</code> or <code>.csv</code> file\n\n` +
        `⚡ <i>Check Delay: 0ms (Instant Checking Engine)</i>`,
        { parse_mode: 'HTML', reply_markup: keyboards.cancelCheck() }
      );
      userCheckState.set(telegramId, { step: 'AWAITING_UNIFIED_INPUT', promptMsgId: promptMsg.message_id });
      return;
    }

    const { validNumbers } = parseBulkNumbers(args);
    if (validNumbers.length === 0) {
      return ctx.reply('❌ No valid phone numbers detected.');
    }

    if (validNumbers.length === 1) {
      await runSingleCheckProcess(ctx, telegramId, validNumbers[0]);
    } else {
      const waitMsg = await ctx.reply('⌛ <i>Preparing instant bulk queue...</i>', { parse_mode: 'HTML' });
      await runBulkCheckProcess(ctx, telegramId, validNumbers, waitMsg.message_id);
    }
  });

  // Action: Unified Check Callback
  bot.callbackQuery(['nav_check_unified', 'nav_check_single', 'nav_check_bulk', 'action_check_single', 'action_check_bulk'], async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const telegramId = ctx.from.id;

    if (!sessionManager.getAvailableSocket(telegramId)) {
      return ctx.reply(
        '⚠️ <b>WhatsApp Account Not Paired</b>\n\n' +
        'Please link a WhatsApp account first via 📱 <b>Connect</b> menu.',
        { parse_mode: 'HTML', reply_markup: keyboards.waPairingMenu(false) }
      );
    }

    const promptText = 
      `🔍 <b>WhatsApp Registration Checker</b>\n\n` +
      `Send or reply to this message with phone numbers in any format:\n` +
      `• Single number (e.g. <code>+1234567890</code>)\n` +
      `• Multiple numbers (one per line, comma or space separated)\n` +
      `• Upload a <code>.txt</code> or <code>.csv</code> file\n\n` +
      `⚡ <i>Check Delay: 0ms (Instant Checking Engine)</i>`;

    try {
      const edited = await ctx.editMessageText(promptText, {
        parse_mode: 'HTML',
        reply_markup: keyboards.cancelCheck()
      });
      userCheckState.set(telegramId, { step: 'AWAITING_UNIFIED_INPUT', promptMsgId: edited?.message_id });
    } catch (e) {
      const promptMsg = await ctx.reply(promptText, {
        parse_mode: 'HTML',
        reply_markup: keyboards.cancelCheck()
      });
      userCheckState.set(telegramId, { step: 'AWAITING_UNIFIED_INPUT', promptMsgId: promptMsg.message_id });
    }
  });

  // Process Document File Upload (TXT / CSV) ONLY when checking is active
  bot.on('message:document', async (ctx, next) => {
    const telegramId = ctx.from.id;
    const state = userCheckState.get(telegramId);
    const replyToId = ctx.message.reply_to_message?.message_id;

    const isReplyingToPrompt = state && state.promptMsgId && replyToId === state.promptMsgId;
    const isWaitingForInput = state && state.step === 'AWAITING_UNIFIED_INPUT';

    if (!isWaitingForInput && !isReplyingToPrompt) {
      return next();
    }

    if (!sessionManager.getAvailableSocket(telegramId)) {
      userCheckState.delete(telegramId);
      return ctx.reply(
        '⚠️ <b>WhatsApp Account Not Paired</b>\n\n' +
        'Please link a WhatsApp account first via 📱 <b>Connect</b> menu.',
        { parse_mode: 'HTML', reply_markup: keyboards.waPairingMenu(false) }
      );
    }

    const doc = ctx.message.document;
    if (doc.file_name?.endsWith('.txt') || doc.file_name?.endsWith('.csv')) {
      userCheckState.delete(telegramId);

      if (state && state.promptMsgId) {
        try { await ctx.api.deleteMessage(ctx.chat.id, state.promptMsgId); } catch (e) {}
      }

      const waitMsg = await ctx.reply('📥 <i>Downloading file & parsing numbers...</i>', { parse_mode: 'HTML' });
      try {
        const file = await ctx.api.getFile(doc.file_id);
        const fileUrl = `https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`;
        
        const response = await fetch(fileUrl);
        const textContent = await response.text();

        const { validNumbers } = parseBulkNumbers(textContent);

        if (validNumbers.length === 0) {
          return ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, '❌ No valid phone numbers found in the uploaded file.');
        }

        if (validNumbers.length === 1) {
          await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id);
          await runSingleCheckProcess(ctx, telegramId, validNumbers[0]);
        } else {
          await runBulkCheckProcess(ctx, telegramId, validNumbers, waitMsg.message_id);
        }
        return;
      } catch (err) {
        return ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, `❌ File processing error: ${err.message}`);
      }
    }

    return next();
  });

  // Handle incoming text message for single or bulk check ONLY when activated
  bot.on('message:text', async (ctx, next) => {
    const telegramId = ctx.from.id;
    const state = userCheckState.get(telegramId);
    const replyToId = ctx.message.reply_to_message?.message_id;

    const isReplyingToPrompt = state && state.promptMsgId && replyToId === state.promptMsgId;
    const isWaitingForInput = state && state.step === 'AWAITING_UNIFIED_INPUT';

    if (!isWaitingForInput && !isReplyingToPrompt) {
      return next();
    }

    const rawText = ctx.message.text ? ctx.message.text.trim() : '';
    if (rawText.startsWith('/')) return next();

    const sock = sessionManager.getAvailableSocket(telegramId);
    if (!sock) {
      userCheckState.delete(telegramId);
      return ctx.reply(
        '⚠️ <b>WhatsApp Account Not Paired</b>\n\n' +
        'Please link a WhatsApp account first via 📱 <b>Connect</b> menu.',
        { parse_mode: 'HTML', reply_markup: keyboards.waPairingMenu(false) }
      );
    }

    const { validNumbers } = parseBulkNumbers(rawText);
    if (validNumbers.length > 0) {
      userCheckState.delete(telegramId);

      // Auto-delete user input text message for clean chat
      try { await ctx.deleteMessage(); } catch (e) {}

      // Clean up prompt card message
      if (state && state.promptMsgId) {
        try { await ctx.api.deleteMessage(ctx.chat.id, state.promptMsgId); } catch (e) {}
      }

      if (validNumbers.length === 1) {
        await runSingleCheckProcess(ctx, telegramId, validNumbers[0]);
      } else {
        const waitMsg = await ctx.reply('⌛ <i>Preparing instant bulk queue...</i>', { parse_mode: 'HTML' });
        await runBulkCheckProcess(ctx, telegramId, validNumbers, waitMsg.message_id);
      }
      return;
    }

    return next();
  });

  // Handle Export Callbacks
  bot.callbackQuery(/^export_(csv|txt)_(all|registered|unregistered)_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const match = ctx.match;
    const format = match[1];     // csv or txt
    const filter = match[2];     // all, registered, unregistered
    const jobId = match[3];

    const cachedResults = bulkJobsCache.get(jobId);
    if (!cachedResults) {
      return ctx.reply('⚠️ Export session expired. Please run a new check.');
    }

    try {
      let fileInfo;
      if (format === 'csv') {
        fileInfo = generateCSVReport(cachedResults, filter);
      } else {
        fileInfo = generateTXTReport(cachedResults, filter);
      }

      await ctx.replyWithDocument(new InputFile(fileInfo.filePath, fileInfo.filename), {
        caption: `📊 <b>Export Report:</b> ${filter.toUpperCase()} (${fileInfo.count} records)`,
        parse_mode: 'HTML'
      });
    } catch (err) {
      await ctx.reply(`❌ Failed to generate report file: ${err.message}`);
    }
  });
}

// Instant Single check executor helper
async function runSingleCheckProcess(ctx, telegramId, number) {
  const waitMsg = await ctx.reply('🔍 <i>Checking WhatsApp status...</i>', { parse_mode: 'HTML' });

  try {
    const res = await checkSingleNumber(telegramId, number);
    dbService.logCheck(telegramId, 'single', 1, res.registered ? 1 : 0, res.registered ? 0 : 1);

    const statusTag = res.registered ? '✅ <b>REGISTERED</b>' : '❌ <b>NOT REGISTERED</b>';
    const typeTag = res.isBusiness ? '🏢 Business Account' : '👤 Personal Account';

    const resultMsg = 
      `📱 <b>WhatsApp Check Result</b>\n` +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `<b>Phone Number:</b> <code>+${res.number}</code>\n` +
      `<b>Status:</b> ${statusTag}\n` +
      (res.registered ? `<b>Account Type:</b> ${typeTag}\n` : '') +
      `━━━━━━━━━━━━━━━━━━━`;

    await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, resultMsg, {
      parse_mode: 'HTML',
      reply_markup: keyboards.backToMain()
    });
  } catch (err) {
    await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, `❌ <b>Check Failed:</b> ${err.message}`, {
      parse_mode: 'HTML',
      reply_markup: keyboards.backToMain()
    });
  }
}

// Ultra-Fast Bulk check executor helper with live progress bar
async function runBulkCheckProcess(ctx, telegramId, numbers, statusMsgId) {
  const customDelay = parseInt(dbService.getSetting('check_delay_ms', String(config.checkDelayMs)), 10);
  const total = Math.min(numbers.length, config.maxBulkLimit);
  const targetNumbers = numbers.slice(0, total);

  const jobId = `job_${telegramId}_${Date.now()}`;
  let lastEditTime = 0;

  const summary = await checkBulkNumbers(telegramId, targetNumbers, {
    delayMs: customDelay,
    onProgress: async (p) => {
      const now = Date.now();
      if (now - lastEditTime > 1200 || p.current === p.total) {
        lastEditTime = now;
        const pct = Math.floor((p.current / p.total) * 100);
        const progressBar = createProgressBar(pct);

        const progressText = 
          `⏳ <b>WhatsApp Bulk Registration Checking...</b>\n\n` +
          `${progressBar} <b>${pct}%</b> (${p.current}/${p.total})\n\n` +
          `✅ <b>Registered WA:</b> <code>${p.registered}</code>\n` +
          `❌ <b>Unregistered:</b> <code>${p.unregistered}</code>\n\n` +
          `⚡ <i>Delay: ${customDelay}ms (Ultra-Fast Batching)</i>`;

        try {
          await ctx.api.editMessageText(ctx.chat.id, statusMsgId, progressText, { parse_mode: 'HTML' });
        } catch (e) {}
      }
    }
  });

  // Log to DB
  dbService.logCheck(telegramId, 'bulk', summary.totalChecked, summary.registeredCount, summary.unregisteredCount);

  // Cache results for download buttons
  bulkJobsCache.set(jobId, summary.results);

  // Final summary message
  const finalMsgText = 
    `🎉 <b>Bulk Check Completed!</b>\n\n` +
    `📊 <b>Total Checked:</b> <code>${summary.totalChecked}</code>\n` +
    `✅ <b>Registered WhatsApp:</b> <code>${summary.registeredCount}</code>\n` +
    `❌ <b>Not Registered:</b> <code>${summary.unregisteredCount}</code>\n\n` +
    `Download your check report using the buttons below:`;

  try {
    await ctx.api.editMessageText(ctx.chat.id, statusMsgId, finalMsgText, {
      parse_mode: 'HTML',
      reply_markup: keyboards.reportExport(jobId)
    });
  } catch (e) {
    await ctx.reply(finalMsgText, {
      parse_mode: 'HTML',
      reply_markup: keyboards.reportExport(jobId)
    });
  }
}

function createProgressBar(percentage) {
  const totalBlocks = 10;
  const filledBlocks = Math.round((percentage / 100) * totalBlocks);
  const emptyBlocks = totalBlocks - filledBlocks;
  return '[' + '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks) + ']';
}
