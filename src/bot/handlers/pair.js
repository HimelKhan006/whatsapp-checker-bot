import { InputFile } from 'grammy';
import { keyboards } from '../keyboards/inline.js';
import { sessionManager } from '../../whatsapp/sessionManager.js';
import { generateQRBuffer } from '../../whatsapp/qrHelper.js';
import { formatMaskedPhone } from '../../utils/phoneFormatter.js';

// User session step tracker & active pairing timers/intervals
const userPairingState = new Map();
const activePairingTimers = new Map();
const activePairingIntervals = new Map();
const lastNavPairMsgId = new Map();

function clearUserPairingTrackers(telegramId) {
  if (activePairingTimers.has(telegramId)) {
    clearTimeout(activePairingTimers.get(telegramId));
    activePairingTimers.delete(telegramId);
  }
  if (activePairingIntervals.has(telegramId)) {
    clearInterval(activePairingIntervals.get(telegramId));
    activePairingIntervals.delete(telegramId);
  }
}

function createCountdownBar(secondsRemaining, totalSeconds = 60) {
  const percentage = Math.max(0, Math.floor((secondsRemaining / totalSeconds) * 100));
  const totalBlocks = 10;
  const filledBlocks = Math.round((percentage / 100) * totalBlocks);
  const emptyBlocks = totalBlocks - filledBlocks;
  return '[' + '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks) + '] ' + secondsRemaining + 's';
}

export function registerPairHandlers(bot) {
  // Show WA Session Status & Pairing Options (handles /connect command and nav_pair callback)
  const sendPairingMenu = async (ctx) => {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery().catch(() => {});
    }
    const telegramId = ctx.from.id;
    clearUserPairingTrackers(telegramId);

    const isConnected = sessionManager.isSessionConnected(telegramId);
    const statusStr = sessionManager.getStatus(telegramId);

    const msgText = 
      `📱 <b>WhatsApp Session Management</b>\n\n` +
      `<b>Current Status:</b> ${isConnected ? '🟢 Connected & Ready' : `🔴 ${statusStr.toUpperCase()}`}\n\n` +
      (isConnected 
        ? `Your WhatsApp account is currently linked. You can perform single and bulk checks seamlessly.` 
        : `To check numbers, please pair your WhatsApp account via <b>QR Code</b> or <b>Pairing Code</b> below.`);

    try {
      if (ctx.callbackQuery?.message?.photo) {
        try { await ctx.deleteMessage(); } catch (e) {}
        const sent = await ctx.reply(msgText, {
          parse_mode: 'HTML',
          reply_markup: keyboards.waPairingMenu(isConnected)
        });
        lastNavPairMsgId.set(telegramId, sent.message_id);
        return;
      }

      if (ctx.callbackQuery) {
        const edited = await ctx.editMessageText(msgText, {
          parse_mode: 'HTML',
          reply_markup: keyboards.waPairingMenu(isConnected)
        });
        if (edited && typeof edited === 'object' && edited.message_id) {
          lastNavPairMsgId.set(telegramId, edited.message_id);
        }
      } else {
        const sent = await ctx.reply(msgText, {
          parse_mode: 'HTML',
          reply_markup: keyboards.waPairingMenu(isConnected)
        });
        lastNavPairMsgId.set(telegramId, sent.message_id);
      }
    } catch (e) {
      if (!e.message?.includes('message is not modified')) {
        const sent = await ctx.reply(msgText, {
          parse_mode: 'HTML',
          reply_markup: keyboards.waPairingMenu(isConnected)
        });
        lastNavPairMsgId.set(telegramId, sent.message_id);
      }
    }
  };

  // Register command and callback query
  bot.command('connect', sendPairingMenu);
  bot.callbackQuery('nav_pair', sendPairingMenu);

  // Action: Pair via QR
  bot.callbackQuery('action_pair_qr', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const telegramId = ctx.from.id;
    clearUserPairingTrackers(telegramId);

    if (sessionManager.isSessionConnected(telegramId)) {
      return ctx.reply('✅ WhatsApp session is already connected!');
    }

    const currentMsgId = ctx.callbackQuery?.message?.message_id;
    if (currentMsgId) {
      lastNavPairMsgId.set(telegramId, currentMsgId);
    }

    let qrSentMsgId = null;
    let isConnected = false;
    let secondsLeft = 60;

    try {
      // Edit current message to loading state
      try {
        await ctx.editMessageText('⏳ <b>Initializing WhatsApp QR Client...</b> Please wait a moment.', { parse_mode: 'HTML' });
      } catch (e) {}

      await sessionManager.initSession(telegramId, {
        onQR: async (qrString) => {
          if (!qrSentMsgId) {
            try {
              const buffer = await generateQRBuffer(qrString);
              try { await ctx.deleteMessage(); } catch (e) {}

              const initialBar = createCountdownBar(secondsLeft, 60);

              const sent = await ctx.replyWithPhoto(new InputFile(buffer, 'qr_code.png'), {
                caption: 
                  `📷 <b>Scan WhatsApp QR Code</b>\n\n` +
                  `1. Open WhatsApp on your phone.\n` +
                  `2. Tap <b>Settings</b> > <b>Linked Devices</b> > <b>Link a Device</b>.\n` +
                  `3. Point your camera at this QR Code.\n\n` +
                  `⏱️ <b>Expiration Countdown:</b>\n<code>${initialBar}</code>`,
                parse_mode: 'HTML',
                reply_markup: keyboards.cancelPairing()
              });
              qrSentMsgId = sent.message_id;

              // Real-Time Countdown Progress Bar interval (updates every 1 second)
              const interval = setInterval(async () => {
                secondsLeft--;
                if (secondsLeft > 0 && qrSentMsgId && !isConnected) {
                  const currentBar = createCountdownBar(secondsLeft, 60);
                  try {
                    await ctx.api.editMessageCaption(ctx.chat.id, qrSentMsgId, {
                      caption: 
                        `📷 <b>Scan WhatsApp QR Code</b>\n\n` +
                        `1. Open WhatsApp on your phone.\n` +
                        `2. Tap <b>Settings</b> > <b>Linked Devices</b> > <b>Link a Device</b>.\n` +
                        `3. Point your camera at this QR Code.\n\n` +
                        `⏱️ <b>Expiration Countdown:</b>\n<code>${currentBar}</code>`,
                      parse_mode: 'HTML',
                      reply_markup: keyboards.cancelPairing()
                    });
                  } catch (e) {}
                }
              }, 1000);
              activePairingIntervals.set(telegramId, interval);

              // Expiration Timeout (60 seconds)
              const timer = setTimeout(async () => {
                clearUserPairingTrackers(telegramId);
                if (!isConnected && !sessionManager.isSessionConnected(telegramId)) {
                  console.log(`[WA] QR Code expired for user ${telegramId}`);
                  await sessionManager.logoutSession(telegramId, true);

                  if (qrSentMsgId) {
                    try { await ctx.api.deleteMessage(ctx.chat.id, qrSentMsgId); } catch (e) {}
                  }

                  await ctx.reply(
                    `⏱️ <b>WhatsApp QR Code Expired</b>\n\n` +
                    `The QR code has expired for security reasons.\n` +
                    `Click <b>Try Again</b> below to generate a new QR code.`,
                    {
                      parse_mode: 'HTML',
                      reply_markup: keyboards.tryAgainQR()
                    }
                  );
                }
              }, 60000);
              activePairingTimers.set(telegramId, timer);

            } catch (err) {
              console.error('Failed to send QR image:', err);
            }
          }
        },
        onConnected: async (user) => {
          isConnected = true;
          clearUserPairingTrackers(telegramId);

          const maskedPhone = formatMaskedPhone(user?.id);

          // Send success card INSTANTLY in real-time
          await ctx.reply(
            `🎉 <b>WhatsApp Account Paired Successfully!</b>\n\n` +
            `<b>Connected Account:</b> <code>${maskedPhone}</code>\n` +
            `You are now ready to start checking numbers!`,
            {
              parse_mode: 'HTML',
              reply_markup: keyboards.mainMenu(ctx.state.isAdmin, true)
            }
          );

          // Clean up QR photo card
          if (qrSentMsgId) {
            try { await ctx.api.deleteMessage(ctx.chat.id, qrSentMsgId); } catch (e) {}
          }

          // Delete nav_pair prompt card cleanly
          const navId = lastNavPairMsgId.get(telegramId);
          if (navId) {
            try { await ctx.api.deleteMessage(ctx.chat.id, navId); } catch (e) {}
            lastNavPairMsgId.delete(telegramId);
          }
        }
      }, true);

    } catch (err) {
      clearUserPairingTrackers(telegramId);
      await ctx.reply(`❌ Failed to initialize QR code pairing: ${err.message}`, {
        reply_markup: keyboards.tryAgainQR()
      });
    }
  });

  // Action: Pair via 8-Digit Code
  bot.callbackQuery('action_pair_code', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const telegramId = ctx.from.id;
    clearUserPairingTrackers(telegramId);

    if (sessionManager.isSessionConnected(telegramId)) {
      return ctx.reply('✅ WhatsApp session is already connected!');
    }

    const currentMsgId = ctx.callbackQuery?.message?.message_id;
    if (currentMsgId) {
      lastNavPairMsgId.set(telegramId, currentMsgId);
    }

    userPairingState.set(telegramId, { step: 'AWAITING_PHONE_NUMBER', promptMsgId: currentMsgId });

    const promptText = 
      `🔑 <b>Pair via WhatsApp 8-Digit Code</b>\n\n` +
      `Send or reply with your phone number including full country code:\n` +
      `• Example: <code>+8801712345678</code> or <code>1234567890</code>\n\n` +
      `<i>Type your phone number in chat below...</i>`;

    try {
      const edited = await ctx.editMessageText(promptText, {
        parse_mode: 'HTML',
        reply_markup: keyboards.cancelPairing()
      });
      if (edited && typeof edited === 'object' && edited.message_id) {
        lastNavPairMsgId.set(telegramId, edited.message_id);
      }
    } catch (e) {
      const sent = await ctx.reply(promptText, {
        parse_mode: 'HTML',
        reply_markup: keyboards.cancelPairing()
      });
      lastNavPairMsgId.set(telegramId, sent.message_id);
    }
  });

  // Action: Cancel Active Pairing Attempt
  bot.callbackQuery('action_cancel_pairing', async (ctx) => {
    await ctx.answerCallbackQuery('Pairing cancelled').catch(() => {});
    const telegramId = ctx.from.id;

    userPairingState.delete(telegramId);
    clearUserPairingTrackers(telegramId);

    await sessionManager.logoutSession(telegramId, true);

    const isConnected = sessionManager.isSessionConnected(telegramId);
    const cancelMsg = 
      `❌ <b>Pairing Cancelled</b>\n\n` +
      `Pairing process has been cancelled cleanly.`;

    try {
      await ctx.editMessageText(cancelMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.waPairingMenu(isConnected)
      });
    } catch (e) {
      await ctx.reply(cancelMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.waPairingMenu(isConnected)
      });
    }
  });

  // Handle incoming Phone Number text message ONLY when user clicked "Pair via Code"
  bot.on('message:text', async (ctx, next) => {
    const telegramId = ctx.from.id;
    const state = userPairingState.get(telegramId);
    const replyToId = ctx.message.reply_to_message?.message_id;

    const isReplyingToPrompt = state && state.promptMsgId && replyToId === state.promptMsgId;
    const isWaitingForPhone = state && state.step === 'AWAITING_PHONE_NUMBER';

    if (!isWaitingForPhone && !isReplyingToPrompt) {
      return next();
    }

    const inputPhone = ctx.message.text ? ctx.message.text.trim() : '';

    if (inputPhone.startsWith('/')) {
      return next();
    }

    userPairingState.delete(telegramId);
    const userInputMsgId = ctx.message.message_id;

    const navId = lastNavPairMsgId.get(telegramId);
    if (navId) {
      try { await ctx.api.deleteMessage(ctx.chat.id, navId); } catch (e) {}
      lastNavPairMsgId.delete(telegramId);
    }

    const waitMsg = await ctx.reply('⌛ <i>Connecting to WhatsApp servers & generating 8-digit code...</i>', { parse_mode: 'HTML' });

    let isConnected = false;
    let secondsLeft = 60;
    let codeCardMsgId = null;

    try {
      const code = await sessionManager.requestPairingCode(telegramId, inputPhone, {
        onConnected: async (user) => {
          isConnected = true;
          clearUserPairingTrackers(telegramId);

          const maskedPhone = formatMaskedPhone(user?.id);

          // Send success card INSTANTLY in real-time
          await ctx.reply(
            `🎉 <b>WhatsApp Account Paired Successfully!</b>\n\n` +
            `<b>Connected Account:</b> <code>${maskedPhone}</code>\n` +
            `You are now ready to start checking numbers!`,
            {
              parse_mode: 'HTML',
              reply_markup: keyboards.mainMenu(ctx.state.isAdmin, true)
            }
          );

          if (codeCardMsgId) {
            try { await ctx.api.deleteMessage(ctx.chat.id, codeCardMsgId); } catch (e) {}
          }
          if (userInputMsgId) {
            try { await ctx.api.deleteMessage(ctx.chat.id, userInputMsgId); } catch (e) {}
          }
        }
      });

      try { await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id); } catch (e) {}

      const formattedCode = code ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
      const initialBar = createCountdownBar(secondsLeft, 60);

      const codeCardText = 
        `🔑 <b>WhatsApp 8-Digit Pairing Code</b>\n\n` +
        `Enter this code in WhatsApp on your phone:\n\n` +
        `<code>${formattedCode}</code>\n\n` +
        `1. Open WhatsApp on your phone.\n` +
        `2. Tap <b>Settings</b> > <b>Linked Devices</b> > <b>Link a Device</b>.\n` +
        `3. Tap <b>Link with phone number instead</b>.\n` +
        `4. Enter the 8-digit code shown above.\n\n` +
        `⏱️ <b>Code Expiration Countdown:</b>\n<code>${initialBar}</code>`;

      const codeMsg = await ctx.reply(codeCardText, {
        parse_mode: 'HTML',
        reply_markup: keyboards.cancelPairing()
      });
      codeCardMsgId = codeMsg.message_id;

      // Real-Time Countdown Progress Bar interval (updates every 1 second)
      const interval = setInterval(async () => {
        secondsLeft--;
        if (secondsLeft > 0 && codeCardMsgId && !isConnected) {
          const currentBar = createCountdownBar(secondsLeft, 60);
          try {
            await ctx.api.editMessageText(
              ctx.chat.id,
              codeCardMsgId,
              `🔑 <b>WhatsApp 8-Digit Pairing Code</b>\n\n` +
              `Enter this code in WhatsApp on your phone:\n\n` +
              `<code>${formattedCode}</code>\n\n` +
              `1. Open WhatsApp on your phone.\n` +
              `2. Tap <b>Settings</b> > <b>Linked Devices</b> > <b>Link a Device</b>.\n` +
              `3. Tap <b>Link with phone number instead</b>.\n` +
              `4. Enter the 8-digit code shown above.\n\n` +
              `⏱️ <b>Code Expiration Countdown:</b>\n<code>${currentBar}</code>`,
              {
                parse_mode: 'HTML',
                reply_markup: keyboards.cancelPairing()
              }
            );
          } catch (e) {}
        }
      }, 1000);
      activePairingIntervals.set(telegramId, interval);

      // Expiration Timeout (60 seconds)
      const timer = setTimeout(async () => {
        clearUserPairingTrackers(telegramId);
        if (!isConnected && !sessionManager.isSessionConnected(telegramId)) {
          console.log(`[WA] Pairing code expired for user ${telegramId}`);
          await sessionManager.logoutSession(telegramId, true);

          if (codeCardMsgId) {
            try { await ctx.api.deleteMessage(ctx.chat.id, codeCardMsgId); } catch (e) {}
          }
          if (userInputMsgId) {
            try { await ctx.api.deleteMessage(ctx.chat.id, userInputMsgId); } catch (e) {}
          }

          await ctx.reply(
            `⏱️ <b>WhatsApp Pairing Code Expired</b>\n\n` +
            `The 8-digit pairing code has expired for security reasons.\n` +
            `Click <b>Request New Code</b> below to generate a fresh pairing code.`,
            {
              parse_mode: 'HTML',
              reply_markup: keyboards.tryAgainCode()
            }
          );
        }
      }, 60000);
      activePairingTimers.set(telegramId, timer);

    } catch (err) {
      clearUserPairingTrackers(telegramId);
      try { await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id); } catch (e) {}

      await ctx.reply(`❌ <b>Pairing Code Failed:</b> ${err.message}`, {
        parse_mode: 'HTML',
        reply_markup: keyboards.tryAgainCode()
      });
    }
  });

  // Action: Logout / Unlink Session Confirmation Card
  bot.callbackQuery('action_logout', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const telegramId = ctx.from.id;

    if (!sessionManager.isSessionConnected(telegramId)) {
      return ctx.reply('⚠️ No active WhatsApp session connected to unlink.');
    }

    const confirmMsg = 
      `🚪 <b>Unlink & Logout WhatsApp Session?</b>\n\n` +
      `Are you sure you want to unlink your connected WhatsApp account?\n` +
      `You will need to scan a QR code or request an 8-digit code again to reconnect.`;

    try {
      await ctx.editMessageText(confirmMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.logoutConfirmKeyboard()
      });
    } catch (e) {
      await ctx.reply(confirmMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.logoutConfirmKeyboard()
      });
    }
  });

  // Action: Confirm Unlink & Logout Execution
  bot.callbackQuery('action_logout_confirm', async (ctx) => {
    await ctx.answerCallbackQuery('Unlinking session...').catch(() => {});
    const telegramId = ctx.from.id;

    await sessionManager.logoutSession(telegramId);

    const postLogoutMsg = 
      `🚪 <b>WhatsApp Account Unlinked Successfully</b>\n\n` +
      `Your WhatsApp session has been logged out cleanly.`;

    try {
      await ctx.editMessageText(postLogoutMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.postLogoutKeyboard()
      });
    } catch (e) {
      await ctx.reply(postLogoutMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.postLogoutKeyboard()
      });
    }
  });
}
