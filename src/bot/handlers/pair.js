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

              // Live Countdown Progress Bar interval
              const interval = setInterval(async () => {
                secondsLeft -= 4;
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
              }, 4000);
              activePairingIntervals.set(telegramId, interval);

              // Expiration Timeout (60 seconds)
              const timer = setTimeout(async () => {
                clearUserPairingTrackers(telegramId);
                if (!isConnected && !sessionManager.isSessionConnected(telegramId)) {
                  console.log(`[WA] QR Code expired for user ${telegramId}`);
                  await sessionManager.logoutSession(telegramId);

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

          if (qrSentMsgId) {
            try { await ctx.api.deleteMessage(ctx.chat.id, qrSentMsgId); } catch (e) {}
          }

          const maskedPhone = formatMaskedPhone(user?.id);

          await ctx.reply(
            `🎉 <b>WhatsApp Account Paired Successfully!</b>\n\n` +
            `<b>Connected Account:</b> <code>${maskedPhone}</code>\n` +
            `You are now ready to start checking numbers!`,
            {
              parse_mode: 'HTML',
              reply_markup: keyboards.mainMenu(ctx.state.isAdmin, true)
            }
          );
        },
        onLoggedOut: async () => {
          clearUserPairingTrackers(telegramId);
        }
      });
    } catch (err) {
      clearUserPairingTrackers(telegramId);
      await ctx.reply(`❌ <b>Failed to initialize pairing:</b> ${err.message}`, { parse_mode: 'HTML' });
    }
  });

  // Action: Pair via Code (Prompt user for phone number)
  bot.callbackQuery('action_pair_code', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const telegramId = ctx.from.id;
    clearUserPairingTrackers(telegramId);

    if (sessionManager.isSessionConnected(telegramId)) {
      return ctx.reply('✅ WhatsApp session is already connected!');
    }

    const currentMsgId = ctx.callbackQuery?.message?.message_id;
    userPairingState.set(telegramId, { step: 'AWAITING_PHONE', promptMsgId: currentMsgId });

    try {
      await ctx.editMessageText(
        `🔢 <b>Pair via WhatsApp 8-Digit Code</b>\n\n` +
        `Please reply with your WhatsApp phone number including country code.\n` +
        `<i>Example:</i> <code>+XXXXXXXXXX</code> or <code>88018XXXXXXXX</code>`,
        {
          parse_mode: 'HTML',
          reply_markup: keyboards.cancelPairing()
        }
      );
    } catch (e) {
      const sent = await ctx.reply(
        `🔢 <b>Pair via WhatsApp 8-Digit Code</b>\n\n` +
        `Please reply with your WhatsApp phone number including country code.\n` +
        `<i>Example:</i> <code>+XXXXXXXXXX</code> or <code>88018XXXXXXXX</code>`,
        {
          parse_mode: 'HTML',
          reply_markup: keyboards.cancelPairing()
        }
      );
      userPairingState.set(telegramId, { step: 'AWAITING_PHONE', promptMsgId: sent.message_id });
    }
  });

  // Handle incoming text message for pairing phone number
  bot.on('message:text', async (ctx, next) => {
    const telegramId = ctx.from.id;
    const pairingState = userPairingState.get(telegramId);

    if (pairingState && pairingState.step === 'AWAITING_PHONE') {
      const initialPromptMsgId = pairingState.promptMsgId;
      userPairingState.delete(telegramId);
      clearUserPairingTrackers(telegramId);

      const rawText = ctx.message.text.trim();
      const userMsgId = ctx.message.message_id;
      const chatId = ctx.chat.id;

      // Keep initialPromptMsgId visible on screen while user enters code!

      // Send brand new message for 8-digit pairing code
      const waitMsg = await ctx.reply('⏳ <b>Requesting 8-digit pairing code from WhatsApp...</b>', { parse_mode: 'HTML' });
      const codeSentMsgId = waitMsg.message_id;

      try {
        let isCodeConnected = false;

        const pairingCode = await sessionManager.requestPairingCode(telegramId, rawText, {
          onConnected: async (user) => {
            isCodeConnected = true;
            clearUserPairingTrackers(telegramId);

            // DELETE ALL TEMPORARY MESSAGES (initial prompt card, pairing code card, user typed text) ONLY WHEN onConnected FIRES!
            if (initialPromptMsgId) {
              try { await ctx.api.deleteMessage(chatId, initialPromptMsgId); } catch (e) {}
            }
            if (codeSentMsgId) {
              try { await ctx.api.deleteMessage(chatId, codeSentMsgId); } catch (e) {}
            }
            if (userMsgId) {
              try { await ctx.api.deleteMessage(chatId, userMsgId); } catch (e) {}
            }

            const maskedPhone = formatMaskedPhone(user?.id);
            await ctx.api.sendMessage(
              chatId,
              `🎉 <b>WhatsApp Account Paired Successfully!</b>\n\n` +
              `<b>Connected Account:</b> <code>${maskedPhone}</code>\n` +
              `You are now ready to start checking numbers!`,
              {
                parse_mode: 'HTML',
                reply_markup: keyboards.mainMenu(ctx.state.isAdmin, true)
              }
            );
          }
        });
        
        // Format pairing code e.g. ABCD-1234
        const formattedCode = pairingCode ? pairingCode.match(/.{1,4}/g)?.join('-') || pairingCode : pairingCode;

        let secondsLeft = 60;
        const initialBar = createCountdownBar(secondsLeft, 60);

        // Edit brand new message to display 8-digit pairing code
        await ctx.api.editMessageText(
          chatId,
          codeSentMsgId,
          `🔑 <b>Your WhatsApp 8-Digit Pairing Code:</b>\n\n` +
          `<code>${formattedCode}</code>\n\n` +
          `<b>Instructions to link your phone:</b>\n` +
          `1. Open <b>WhatsApp</b> on your phone.\n` +
          `2. Tap <b>Settings</b> (or 3 Dots) > <b>Linked Devices</b>.\n` +
          `3. Tap <b>Link a Device</b>.\n` +
          `4. Tap <b>"Link with phone number instead"</b> at the bottom.\n` +
          `5. Enter the code: <code>${formattedCode}</code>\n\n` +
          `⏱️ <b>Expiration Countdown:</b>\n<code>${initialBar}</code>`,
          {
            parse_mode: 'HTML',
            reply_markup: keyboards.cancelPairing()
          }
        );

        // Interval to update pairing code expiration progress bar
        const interval = setInterval(async () => {
          secondsLeft -= 4;
          if (secondsLeft > 0 && !isCodeConnected) {
            const currentBar = createCountdownBar(secondsLeft, 60);
            try {
              await ctx.api.editMessageText(
                chatId,
                codeSentMsgId,
                `🔑 <b>Your WhatsApp 8-Digit Pairing Code:</b>\n\n` +
                `<code>${formattedCode}</code>\n\n` +
                `<b>Instructions to link your phone:</b>\n` +
                `1. Open <b>WhatsApp</b> on your phone.\n` +
                `2. Tap <b>Settings</b> (or 3 Dots) > <b>Linked Devices</b>.\n` +
                `3. Tap <b>Link a Device</b>.\n` +
                `4. Tap <b>"Link with phone number instead"</b> at the bottom.\n` +
                `5. Enter the code: <code>${formattedCode}</code>\n\n` +
                `⏱️ <b>Expiration Countdown:</b>\n<code>${initialBar}</code>`,
                {
                  parse_mode: 'HTML',
                  reply_markup: keyboards.cancelPairing()
                }
              );
            } catch (e) {}
          }
        }, 4000);
        activePairingIntervals.set(telegramId, interval);

        // Set 60-second expiration timer for pairing code
        const timer = setTimeout(async () => {
          clearUserPairingTrackers(telegramId);
          if (!isCodeConnected && !sessionManager.isSessionConnected(telegramId)) {
            console.log(`[WA] Pairing code expired for user ${telegramId}`);
            await sessionManager.logoutSession(telegramId);

            try {
              await ctx.api.editMessageText(
                chatId,
                codeSentMsgId,
                `⏱️ <b>WhatsApp Pairing Code Expired</b>\n\n` +
                `The 8-digit pairing code has expired.\n` +
                `Click <b>Request New Code</b> below to generate a fresh pairing code.`,
                {
                  parse_mode: 'HTML',
                  reply_markup: keyboards.tryAgainCode()
                }
              );
            } catch (e) {}
          }
        }, 60000);

        activePairingTimers.set(telegramId, timer);
      } catch (err) {
        clearUserPairingTrackers(telegramId);
        try {
          await ctx.api.editMessageText(
            chatId,
            codeSentMsgId,
            `❌ <b>Pairing Code Error:</b> ${err.message}`,
            {
              parse_mode: 'HTML',
              reply_markup: keyboards.backToMain()
            }
          );
        } catch (e) {
          await ctx.reply(`❌ <b>Pairing Code Error:</b> ${err.message}`, { parse_mode: 'HTML' });
        }
      }
      return;
    }

    return next();
  });

  // Action: Prompt Logout Confirmation
  bot.callbackQuery('action_logout', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    const telegramId = ctx.from.id;
    clearUserPairingTrackers(telegramId);

    const isConnected = sessionManager.isSessionConnected(telegramId);
    const sock = sessionManager.getSocket(telegramId);
    const maskedPhone = (isConnected && sock?.user?.id) ? formatMaskedPhone(sock.user.id) : 'Connected Account';

    const confirmMsg = 
      `⚠️ <b>Confirm WhatsApp Session Logout</b>\n\n` +
      `<b>Linked Account:</b> <code>${maskedPhone}</code>\n\n` +
      `Are you sure you want to unlink and logout this WhatsApp account?\n` +
      `<i>Unlinking will clear your saved session data securely. You will need to scan a new QR code or request a pairing code to check numbers again.</i>`;

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

  // Action: Confirm Logout Execution
  bot.callbackQuery('action_logout_confirm', async (ctx) => {
    await ctx.answerCallbackQuery('Session unlinked successfully.').catch(() => {});
    const telegramId = ctx.from.id;
    clearUserPairingTrackers(telegramId);

    await sessionManager.logoutSession(telegramId);

    const successMsg = 
      `🚪 <b>WhatsApp Session Logged Out & Unlinked!</b>\n\n` +
      `Your WhatsApp account has been disconnected and session files have been securely deleted.\n\n` +
      `<b>Current Status:</b> 🔴 DISCONNECTED`;

    try {
      await ctx.editMessageText(successMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.postLogoutKeyboard()
      });
    } catch (e) {
      await ctx.reply(successMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.postLogoutKeyboard()
      });
    }
  });

  // Instant Cancel Pairing (Restores/edits the SAME WhatsApp Session Management card)
  bot.callbackQuery(['action_cancel_pairing', 'action_cancel'], async (ctx) => {
    await ctx.answerCallbackQuery('Pairing cancelled.').catch(() => {});
    const telegramId = ctx.from.id;

    clearUserPairingTrackers(telegramId);
    userPairingState.delete(telegramId);

    if (!sessionManager.isSessionConnected(telegramId)) {
      await sessionManager.logoutSession(telegramId);
    }

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
        await ctx.deleteMessage();
        await ctx.reply(msgText, {
          parse_mode: 'HTML',
          reply_markup: keyboards.waPairingMenu(isConnected)
        });
        return;
      }
    } catch (e) {}

    try {
      await ctx.editMessageText(msgText, {
        parse_mode: 'HTML',
        reply_markup: keyboards.waPairingMenu(isConnected)
      });
    } catch (e) {
      await ctx.reply(msgText, {
        parse_mode: 'HTML',
        reply_markup: keyboards.waPairingMenu(isConnected)
      });
    }
  });
}
