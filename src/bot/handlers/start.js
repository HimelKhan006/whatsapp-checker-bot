import { keyboards } from '../keyboards/inline.js';
import { sessionManager } from '../../whatsapp/sessionManager.js';
import { dbService } from '../../db/database.js';
import { config } from '../../config.js';
import { formatMaskedPhone, maskName } from '../../utils/phoneFormatter.js';

export function registerStartHandlers(bot) {
  bot.command('start', async (ctx) => {
    const telegramId = ctx.from.id;
    const isAdmin = ctx.state.isAdmin;
    const isNewUser = ctx.state.isNewUser || false;
    const isWaConnected = sessionManager.isSessionConnected(telegramId);

    // Check referral payload e.g. /start ref_6798979733
    const match = ctx.match ? ctx.match.trim() : '';
    if (match.startsWith('ref_')) {
      const referrerId = parseInt(match.replace('ref_', ''), 10);
      if (!isNaN(referrerId) && referrerId !== telegramId) {
        const existingUser = dbService.getUser(telegramId);
        if (!existingUser || !existingUser.referrer_id) {
          dbService.setReferrer(telegramId, referrerId);
          try {
            await ctx.api.sendMessage(
              referrerId,
              `🎉 <b>New Referral Joined!</b>\n\nUser <b>${ctx.from.first_name}</b> (@${ctx.from.username || 'N/A'}) registered using your referral link!`,
              { parse_mode: 'HTML' }
            );
          } catch (e) { }
        }
      }
    }

    const waStatusTag = isWaConnected ? '🟢 Connected' : '🔴 Not Connected';

    let welcomeMsg = '';
    if (isNewUser) {
      welcomeMsg =
        `🎉 <b>Welcome to WhatsApp Registration Checker!</b> 🎉\n\n` +
        `Hello <b>${ctx.from.first_name}</b>! Thank you for joining our bot for the first time!\n` +
        `Use this professional engine to verify WhatsApp accounts in bulk or single format.\n\n` +
        `📱 <b>WhatsApp Client Status:</b> ${waStatusTag}\n` +
        `🔐 <b>Role:</b> <code>${isAdmin ? 'Admin 👑' : 'Authorized User 👤'}</code>\n\n` +
        `Select an option below to get started:`;
    } else {
      welcomeMsg =
        `⚡ <b>WhatsApp Registration & Status Checker System</b> ⚡\n\n` +
        `📱 <b>WhatsApp Client Status:</b> ${waStatusTag}\n` +
        `🔐 <b>Role:</b> <code>${isAdmin ? 'Admin 👑' : 'Authorized User 👤'}</code>\n\n` +
        `Select an option from the menu below:`;
    }

    await ctx.reply(welcomeMsg, {
      parse_mode: 'HTML',
      reply_markup: keyboards.mainMenu(isAdmin, isWaConnected)
    });
  });

  // Action / Command: Referral Program
  const sendReferralCard = async (ctx) => {
    const telegramId = ctx.from.id;
    const refStats = dbService.getUserReferralStats(telegramId);
    const botInfo = ctx.me;

    const refLink = `https://t.me/${botInfo.username}?start=ref_${telegramId}`;

    const refMsg =
      `🎁 <b>Referral & Invite Program</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Share your personal referral link with friends and colleagues to invite them to the bot!\n\n` +
      `<b>🔗 Your Personal Referral Link:</b>\n` +
      `<code>${refLink}</code>\n\n` +
      `<b>📊 Your Referral Statistics:</b>\n` +
      `• <b>Total Referred Users:</b> <code>${refStats.totalReferred}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    try {
      if (ctx.callbackQuery) {
        await ctx.editMessageText(refMsg, {
          parse_mode: 'HTML',
          reply_markup: keyboards.backToMain()
        });
      } else {
        await ctx.reply(refMsg, {
          parse_mode: 'HTML',
          reply_markup: keyboards.backToMain()
        });
      }
    } catch (e) {
      await ctx.reply(refMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.backToMain()
      });
    }
  };

  bot.command('referral', sendReferralCard);
  bot.callbackQuery('nav_referral', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => { });
    await sendReferralCard(ctx);
  });

  // Action / Command: Top 10 Referral Leaderboard
  const sendLeaderboardCard = async (ctx) => {
    const telegramId = ctx.from.id;
    const isAdmin = ctx.state.isAdmin;
    const leaderboard = dbService.getReferralLeaderboard();
    const stats = dbService.getStats();
    const userRankInfo = dbService.getUserRank(telegramId);

    const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

    let leaderText =
      `🏆 <b>Top Referrers Leaderboard</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (leaderboard.length === 0) {
      leaderText += `<i>No referrals recorded yet! Be the first to invite friends using your referral link.</i>\n\n`;
    } else {
      const top10 = leaderboard.slice(0, 10);
      top10.forEach((item, idx) => {
        const medal = medals[idx] || `#${idx + 1}`;
        const isSelf = Number(item.telegram_id) === Number(telegramId);

        if (isAdmin) {
          // Admin sees full names, usernames, and Telegram IDs
          const nameStr = `${item.first_name}${item.username ? ` (@${item.username})` : ''}`;
          leaderText += `${medal} <b>${nameStr}</b>\n└ ID: <code>${item.telegram_id}</code> | Referrals: <code>${item.referral_count}</code>\n\n`;
        } else {
          // Regular users see masked names unless it's themselves
          if (isSelf) {
            leaderText += `${medal} <b>${item.first_name}</b> 👉 YOU (#${idx + 1}) — <code>${item.referral_count} refs</code>\n`;
          } else {
            const masked = maskName(item.first_name);
            leaderText += `${medal} <b>${masked}</b> — <code>${item.referral_count} refs</code>\n`;
          }
        }
      });
    }

    leaderText +=
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👥 <b>Total Users:</b> <code>${stats.totalUsers}</code> | ⚡ <b>Active (24h):</b> <code>${stats.activeUsers}</code>\n`;

    if (!isAdmin) {
      if (userRankInfo.rank) {
        leaderText += `👤 <b>Your Rank:</b> <code>#${userRankInfo.rank}</code> | <b>Total Referrals:</b> <code>${userRankInfo.referral_count}</code>\n`;
      } else {
        leaderText += `👤 <b>Your Rank:</b> <code>Not Ranked Yet</code> (Invite friends via 🎁 Referral Program to join the leaderboard!)\n`;
      }
    }

    try {
      if (ctx.callbackQuery) {
        await ctx.editMessageText(leaderText, {
          parse_mode: 'HTML',
          reply_markup: keyboards.backToMain()
        });
      } else {
        await ctx.reply(leaderText, {
          parse_mode: 'HTML',
          reply_markup: keyboards.backToMain()
        });
      }
    } catch (e) {
      if (!e.message?.includes('message is not modified')) {
        await ctx.reply(leaderText, {
          parse_mode: 'HTML',
          reply_markup: keyboards.backToMain()
        });
      }
    }
  };

  bot.command('leaderboard', sendLeaderboardCard);
  bot.callbackQuery('nav_leaderboard', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => { });
    await sendLeaderboardCard(ctx);
  });

  const sendProfileCard = async (ctx) => {
    const telegramId = ctx.from.id;
    const user = ctx.state.user || dbService.getUser(telegramId);
    const uStats = dbService.getUserStats(telegramId);
    const isAdmin = ctx.state.isAdmin;

    const isConnected = sessionManager.isSessionConnected(telegramId);
    const sock = sessionManager.getSocket(telegramId);
    const maskedPhone = isConnected ? formatMaskedPhone(sock?.user?.id) : null;
    const joinedDate = user?.created_at ? user.created_at.split(' ')[0] : 'N/A';

    let profileMsg =
      `👤 <b>User Profile & Account Details</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `<b>👤 Telegram User Info:</b>\n` +
      `• <b>Name:</b> ${ctx.from.first_name} ${ctx.from.last_name || ''}\n` +
      `• <b>Username:</b> @${ctx.from.username || 'Not set'}\n` +
      `• <b>Telegram ID:</b> <code>${telegramId}</code>\n` +
      `• <b>Joined Date:</b> <code>📅 ${joinedDate}</code>\n` +
      `• <b>Role:</b> <code>${isAdmin ? '👑 Super Admin' : '👤 Authorized User'}</code>\n` +
      `• <b>Status:</b> <code>${user?.status?.toUpperCase() || 'APPROVED'} ✅</code>\n\n` +
      `📱 <b>WhatsApp Client Status:</b>\n` +
      `• <b>Status:</b> ${isConnected ? `🟢 Linked & Active (<code>${maskedPhone}</code>)` : '🔴 Not Paired'}\n\n` +
      `📊 <b>Usage Diagnostics:</b>\n` +
      `• <b>System Status:</b> 🟢 Online\n`;

    if (isAdmin) {
      const mode = dbService.getSetting('bot_mode', config.botMode);
      const delay = dbService.getSetting('check_delay_ms', String(config.checkDelayMs));
      profileMsg +=
        `• <b>Bot Mode:</b> <code>${mode.toUpperCase()}</code>\n` +
        `• <b>Engine Delay:</b> <code>${delay}ms</code>\n`;
    }

    profileMsg +=
      `• <b>Total Numbers Checked:</b> <code>${uStats.totalChecked}</code>\n` +
      `• <b>Registered WA Found:</b> <code>${uStats.registeredCount}</code>\n` +
      `• <b>Unregistered Numbers:</b> <code>${uStats.unregisteredCount}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    try {
      if (ctx.callbackQuery) {
        await ctx.editMessageText(profileMsg, {
          parse_mode: 'HTML',
          reply_markup: keyboards.profileKeyboard(isConnected)
        });
      } else {
        await ctx.reply(profileMsg, {
          parse_mode: 'HTML',
          reply_markup: keyboards.profileKeyboard(isConnected)
        });
      }
    } catch (e) {
      if (!e.message?.includes('message is not modified')) {
        await ctx.reply(profileMsg, {
          parse_mode: 'HTML',
          reply_markup: keyboards.profileKeyboard(isConnected)
        });
      }
    }
  };

  bot.command('profile', sendProfileCard);
  bot.callbackQuery('nav_profile', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => { });
    await sendProfileCard(ctx);
  });

  bot.command('help', async (ctx) => {
    const helpMsg =
      `📖 <b>How to Use WhatsApp Registration Checker</b>\n\n` +
      `1️⃣ <b>Pair WhatsApp Account:</b>\n` +
      `   • Click 📱 <b>Connect</b> from main menu.\n` +
      `   • Choose <b>Pair via QR</b> (Scan with WhatsApp > Linked Devices) OR <b>Pair via Code</b> (Receive 8-digit code).\n\n` +
      `2️⃣ <b>Unified Number Checking:</b>\n` +
      `   • Click 🔍 <b>Check Numbers</b> and send a single number (e.g. <code>+1234567890</code>), multiple numbers, or a <code>.txt</code>/<code>.csv</code> file!\n\n` +
      `3️⃣ <b>Reports & Exporter:</b>\n` +
      `   • Export full reports (CSV/TXT) or filter Registered/Unregistered numbers instantly.`;

    await ctx.reply(helpMsg, {
      parse_mode: 'HTML',
      reply_markup: keyboards.backToMain()
    });
  });

  bot.callbackQuery('nav_main', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => { });
    const isAdmin = ctx.state.isAdmin;
    const isWaConnected = sessionManager.isSessionConnected(ctx.from.id);
    const waStatusTag = isWaConnected ? '🟢 Connected' : '🔴 Not Connected';

    const welcomeMsg =
      `⚡ <b>WhatsApp Registration & Status Checker System</b> ⚡\n\n` +
      `📱 <b>WhatsApp Client Status:</b> ${waStatusTag}\n` +
      `🔐 <b>Role:</b> <code>${isAdmin ? 'Admin 👑' : 'Authorized User 👤'}</code>\n\n` +
      `Select an option from the menu below:`;

    const currentMsgText = ctx.callbackQuery?.message?.text || '';

    // If navigating back to main menu from a result box, send a NEW message to preserve check results in chat history!
    if (currentMsgText.includes('Check Result') || currentMsgText.includes('Bulk Check Completed') || currentMsgText.includes('Export Report')) {
      return ctx.reply(welcomeMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.mainMenu(isAdmin, isWaConnected)
      });
    }

    try {
      await ctx.editMessageText(welcomeMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.mainMenu(isAdmin, isWaConnected)
      });
    } catch (e) {
      if (!e.message?.includes('message is not modified')) {
        await ctx.reply(welcomeMsg, {
          parse_mode: 'HTML',
          reply_markup: keyboards.mainMenu(isAdmin, isWaConnected)
        });
      }
    }
  });

  bot.callbackQuery('nav_help', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => { });
    const helpMsg =
      `📖 <b>How to Use WhatsApp Registration Checker</b>\n\n` +
      `1️⃣ <b>Pair WhatsApp Account:</b>\n` +
      `   • Click 📱 <b>Connect</b> from main menu.\n` +
      `   • Choose <b>Pair via QR</b> (Scan with WhatsApp > Linked Devices) OR <b>Pair via Code</b> (Receive 8-digit code).\n\n` +
      `2️⃣ <b>Unified Number Checking:</b>\n` +
      `   • Click 🔍 <b>Check Numbers</b> and send a single number (e.g. <code>+1234567890</code>), multiple numbers, or a <code>.txt</code>/<code>.csv</code> file!\n\n` +
      `3️⃣ <b>Reports & Exporter:</b>\n` +
      `   • Export full reports (CSV/TXT) or filter Registered/Unregistered numbers instantly.`;

    try {
      await ctx.editMessageText(helpMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.backToMain()
      });
    } catch (e) { }
  });

  bot.callbackQuery('nav_stats', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => { });
    const stats = dbService.getStats();
    const isConnected = sessionManager.isSessionConnected(ctx.from.id);

    const statsMsg =
      `📊 <b>System Diagnostic Statistics</b>\n\n` +
      `📱 <b>My WA Client:</b> ${isConnected ? '🟢 Active' : '🔴 Offline'}\n` +
      `🔍 <b>Total Checks System-wide:</b> <code>${stats.totalChecks}</code>\n` +
      `✅ <b>Registered WA Found:</b> <code>${stats.totalRegistered}</code>\n` +
      `❌ <b>Unregistered Numbers:</b> <code>${stats.totalUnregistered}</code>\n` +
      `👥 <b>Total Active Approved Users:</b> <code>${stats.totalApprovedUsers}</code>`;

    try {
      await ctx.editMessageText(statsMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.backToMain()
      });
    } catch (e) { }
  });
}
