import { keyboards } from '../keyboards/inline.js';
import { dbService } from '../../db/database.js';
import { sessionManager } from '../../whatsapp/sessionManager.js';
import { config } from '../../config.js';

const adminState = new Map();
const broadcastCache = new Map();

export function registerAdminHandlers(bot) {
  // Admin Guard helper
  function checkAdmin(ctx) {
    if (!ctx.state.isAdmin) {
      ctx.reply('🔒 <b>Admin Only Access</b>\n\nThis section is restricted to administrators.', { parse_mode: 'HTML' });
      return false;
    }
    return true;
  }

  // Helper to format Admin Control Panel Card message text
  function buildAdminMenuText() {
    const stats = dbService.getStats();
    const mode = dbService.getSetting('bot_mode', config.botMode);
    const autoApprove = dbService.getSetting('auto_approve', 'off');
    const activeWaSessions = sessionManager.getActiveSessionsCount();

    return (
      `👑 <b>Professional Admin Control Panel</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👥 <b>Total Users:</b> <code>${stats.totalUsers}</code> | ⚡ <b>Active (24h):</b> <code>${stats.activeUsers}</code>\n` +
      `✅ <b>Approved:</b> <code>${stats.totalApprovedUsers}</code> | ⏳ <b>Pending:</b> <code>${stats.totalPendingUsers}</code> | 🚫 <b>Banned:</b> <code>${stats.totalBannedUsers}</code>\n` +
      `📱 <b>Active Paired WA Sessions (Realtime):</b> <code>${activeWaSessions}</code>\n` +
      `📊 <b>Global Total Checked Numbers:</b> <code>${stats.totalChecks}</code> (✅ <code>${stats.totalRegistered}</code> | ❌ <code>${stats.totalUnregistered}</code>)\n` +
      `☁️ <b>Cloud Gist Counters Database:</b> <code>Synced & Restored ✅</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `<b>System Mode:</b> <code>${mode.toUpperCase()}</code>\n` +
      `<b>Auto-Approve:</b> <code>${autoApprove.toUpperCase()}</code>\n\n` +
      `Manage system settings, users, and broadcasts below:`
    );
  }

  // Command: /admin
  bot.command('admin', async (ctx) => {
    if (!checkAdmin(ctx)) return;

    const telegramId = ctx.from.id;
    adminState.delete(telegramId);

    const mode = dbService.getSetting('bot_mode', config.botMode);
    const autoApprove = dbService.getSetting('auto_approve', 'off');
    const adminMsg = buildAdminMenuText();

    await ctx.reply(adminMsg, {
      parse_mode: 'HTML',
      reply_markup: keyboards.adminMenu(mode, autoApprove)
    });
  });

  // Action: Nav Admin Panel (In-place editing & state cleanup)
  bot.callbackQuery('nav_admin', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!checkAdmin(ctx)) return;

    const telegramId = ctx.from.id;
    adminState.delete(telegramId);

    const mode = dbService.getSetting('bot_mode', config.botMode);
    const autoApprove = dbService.getSetting('auto_approve', 'off');
    const adminMsg = buildAdminMenuText();

    try {
      await ctx.editMessageText(adminMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.adminMenu(mode, autoApprove)
      });
    } catch (e) {
      if (!e.message?.includes('message is not modified')) {
        await ctx.reply(adminMsg, {
          parse_mode: 'HTML',
          reply_markup: keyboards.adminMenu(mode, autoApprove)
        });
      }
    }
  });

  // Action: Toggle Auto-Approve Mode (Requires AUTHORIZED Mode Guard)
  bot.callbackQuery('admin_toggle_auto_approve', async (ctx) => {
    if (!checkAdmin(ctx)) return;

    const currentMode = dbService.getSetting('bot_mode', config.botMode);
    const currentSetting = dbService.getSetting('auto_approve', 'off');

    // Enforce Guard: Bot Mode MUST be AUTHORIZED to turn Auto-Approve ON!
    if (currentSetting === 'off') {
      if (currentMode !== 'authorized') {
        return ctx.answerCallbackQuery({
          text: '⚠️ Auto-Approve is designed for AUTHORIZED mode! Please switch Bot Mode to AUTHORIZED first.',
          show_alert: true
        }).catch(() => {});
      }
      dbService.setSetting('auto_approve', 'on');
      await ctx.answerCallbackQuery('⚡ Auto-Approve set to: ON').catch(() => {});
    } else {
      dbService.setSetting('auto_approve', 'off');
      await ctx.answerCallbackQuery('🔴 Auto-Approve set to: OFF').catch(() => {});
    }

    const mode = dbService.getSetting('bot_mode', config.botMode);
    const autoApprove = dbService.getSetting('auto_approve', 'off');
    const adminMsg = buildAdminMenuText();

    try {
      await ctx.editMessageText(adminMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.adminMenu(mode, autoApprove)
      });
    } catch (e) {}
  });

  // Action: Toggle System Bot Mode (AUTHORIZED <-> PUBLIC <-> PRIVATE)
  bot.callbackQuery('admin_mode_toggle', async (ctx) => {
    if (!checkAdmin(ctx)) return;

    const modes = ['authorized', 'public', 'private'];
    const currentMode = dbService.getSetting('bot_mode', config.botMode);
    const nextIdx = (modes.indexOf(currentMode) + 1) % modes.length;
    const nextMode = modes[nextIdx];

    dbService.setSetting('bot_mode', nextMode);

    // Guard: If switching away from AUTHORIZED mode, force Auto-Approve to OFF
    if (nextMode !== 'authorized') {
      dbService.setSetting('auto_approve', 'off');
    }

    await ctx.answerCallbackQuery(`🔐 Bot Mode set to: ${nextMode.toUpperCase()}`).catch(() => {});

    const autoApprove = dbService.getSetting('auto_approve', 'off');
    const adminMsg = buildAdminMenuText();

    try {
      await ctx.editMessageText(adminMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.adminMenu(nextMode, autoApprove)
      });
    } catch (e) {}
  });

  // Action: User Whitelist & Approval Management
  bot.callbackQuery('admin_users', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!checkAdmin(ctx)) return;

    const users = dbService.getAllUsers();
    const pendingCount = users.filter(u => u.status === 'pending').length;

    let userMsg =
      `👥 <b>User Whitelist & Authorization Management</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `<b>Total Users:</b> <code>${users.length}</code> | <b>Pending Requests:</b> <code>${pendingCount}</code>\n\n` +
      `Click any user action below to approve or block users:`;

    try {
      await ctx.editMessageText(userMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.userWhitelistMenu(users)
      });
    } catch (e) {}
  });

  // Action: Approve All Pending Users
  bot.callbackQuery('admin_approve_all', async (ctx) => {
    if (!checkAdmin(ctx)) return;

    const pendingUsers = dbService.getPendingUsers();
    const count = dbService.approveAllPendingUsers();

    await ctx.answerCallbackQuery(`✅ Approved all ${count} pending users!`).catch(() => {});

    // Notify approved users
    for (const u of pendingUsers) {
      try {
        await bot.api.sendMessage(
          u.telegram_id,
          '🎉 <b>Account Approved!</b>\n\nAn administrator has approved your access. You can now start using all bot features!',
          { parse_mode: 'HTML', reply_markup: keyboards.mainMenu(false, sessionManager.isSessionConnected(u.telegram_id)) }
        );
      } catch (e) {}
    }

    const users = dbService.getAllUsers();
    const userMsg =
      `👥 <b>User Whitelist & Authorization Management</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `<b>Total Users:</b> <code>${users.length}</code> | <b>Pending Requests:</b> <code>0</code>\n\n` +
      `✅ <i>Successfully approved all pending users!</i>`;

    try {
      await ctx.editMessageText(userMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.userWhitelistMenu(users)
      });
    } catch (e) {}
  });

  // Action: Block All Pending Users
  bot.callbackQuery('admin_block_all', async (ctx) => {
    if (!checkAdmin(ctx)) return;

    const count = dbService.blockAllPendingUsers();
    await ctx.answerCallbackQuery(`🚫 Blocked all ${count} pending users.`).catch(() => {});

    const users = dbService.getAllUsers();
    const userMsg =
      `👥 <b>User Whitelist & Authorization Management</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `<b>Total Users:</b> <code>${users.length}</code> | <b>Pending Requests:</b> <code>0</code>\n\n` +
      `🚫 <i>Successfully blocked all pending users!</i>`;

    try {
      await ctx.editMessageText(userMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.userWhitelistMenu(users)
      });
    } catch (e) {}
  });

  // Action: Single User Approve Callback query
  bot.callbackQuery(/^user_approve_(\d+)$/, async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const targetId = parseInt(ctx.match[1], 10);

    dbService.setUserStatus(targetId, 'approved');
    await ctx.answerCallbackQuery('✅ User access approved!').catch(() => {});

    try {
      await bot.api.sendMessage(
        targetId,
        '🎉 <b>Account Approved!</b>\n\nAn administrator has approved your access. You can now start using all bot features!',
        { parse_mode: 'HTML', reply_markup: keyboards.mainMenu(false, sessionManager.isSessionConnected(targetId)) }
      );
    } catch (e) {}

    const users = dbService.getAllUsers();
    try {
      await ctx.editMessageText(
        `👥 <b>User Whitelist & Authorization Management</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `<b>Total Users:</b> <code>${users.length}</code>\n\n` +
        `✅ <i>Approved access for user ID ${targetId}.</i>`,
        { parse_mode: 'HTML', reply_markup: keyboards.userWhitelistMenu(users) }
      );
    } catch (e) {}
  });

  // Action: Single User Reject/Block Callback query
  bot.callbackQuery(/^user_reject_(\d+)$/, async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const targetId = parseInt(ctx.match[1], 10);

    dbService.setUserStatus(targetId, 'blocked');
    await ctx.answerCallbackQuery('🚫 User access blocked!').catch(() => {});

    try {
      await bot.api.sendMessage(
        targetId,
        '🚫 <b>Account Access Suspended</b>\n\nYour account access has been restricted by an administrator.',
        { parse_mode: 'HTML' }
      );
    } catch (e) {}

    const users = dbService.getAllUsers();
    try {
      await ctx.editMessageText(
        `👥 <b>User Whitelist & Authorization Management</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `<b>Total Users:</b> <code>${users.length}</code>\n\n` +
        `🚫 <i>Blocked access for user ID ${targetId}.</i>`,
        { parse_mode: 'HTML', reply_markup: keyboards.userWhitelistMenu(users) }
      );
    } catch (e) {}
  });

  // Action: View Banned Users List
  bot.callbackQuery('admin_banned_users', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!checkAdmin(ctx)) return;

    const bannedUsers = dbService.getBannedUsers();

    let msg =
      `🚫 <b>Banned & Blocked Users Panel</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `<b>Total Banned Users:</b> <code>${bannedUsers.length}</code>\n\n`;

    if (bannedUsers.length === 0) {
      msg += `<i>No users are currently banned or blocked.</i>`;
    } else {
      msg += `Click any user button below to unblock or message them:`;
    }

    try {
      await ctx.editMessageText(msg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.bannedUsersMenu(bannedUsers)
      });
    } catch (e) {}
  });

  // Action: Unban All Banned Users
  bot.callbackQuery('admin_unban_all', async (ctx) => {
    if (!checkAdmin(ctx)) return;

    const count = dbService.unbanAllUsers();
    await ctx.answerCallbackQuery(`🔓 Unbanned all ${count} blocked users!`).catch(() => {});

    const bannedUsers = dbService.getBannedUsers();
    try {
      await ctx.editMessageText(
        `🚫 <b>Banned & Blocked Users Panel</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `<b>Total Banned Users:</b> <code>0</code>\n\n` +
        `🔓 <i>Successfully unbanned all blocked users!</i>`,
        { parse_mode: 'HTML', reply_markup: keyboards.bannedUsersMenu(bannedUsers) }
      );
    } catch (e) {}
  });

  // Action: Global System Stats
  bot.callbackQuery('admin_stats', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!checkAdmin(ctx)) return;

    const stats = dbService.getStats();
    const mode = dbService.getSetting('bot_mode', config.botMode);
    const delay = dbService.getSetting('check_delay_ms', String(config.checkDelayMs));
    const activeWaSessions = sessionManager.getActiveSessionsCount();

    const statsMsg =
      `📈 <b>Global System Diagnostics & Analytics</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👥 <b>Total Registered Users:</b> <code>${stats.totalUsers}</code>\n` +
      `⚡ <b>Active Users (24 Hours):</b> <code>${stats.activeUsers}</code>\n` +
      `✅ <b>Approved Whitelist Users:</b> <code>${stats.totalApprovedUsers}</code>\n` +
      `⏳ <b>Pending Approval Users:</b> <code>${stats.totalPendingUsers}</code>\n` +
      `🚫 <b>Banned & Blocked Users:</b> <code>${stats.totalBannedUsers}</code>\n` +
      `📱 <b>Active Paired WA Sessions:</b> <code>${activeWaSessions}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `📊 <b>Global Total Checked Numbers:</b> <code>${stats.totalChecks}</code>\n` +
      `✅ <b>Global Registered WhatsApp:</b> <code>${stats.totalRegistered}</code>\n` +
      `❌ <b>Global Unregistered Numbers:</b> <code>${stats.totalUnregistered}</code>\n` +
      `☁️ <b>Cloud Gist Database:</b> <code>Synced & Restored ✅</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `⚙️ <b>System Mode:</b> <code>${mode.toUpperCase()}</code>\n` +
      `⚡ <b>Check Delay:</b> <code>${delay}ms</code>`;

    try {
      await ctx.editMessageText(statsMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.backToAdmin()
      });
    } catch (e) {}
  });

  // Action: Change Admin ID
  bot.callbackQuery('admin_change_id', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!checkAdmin(ctx)) return;

    const telegramId = ctx.from.id;
    adminState.set(telegramId, { step: 'AWAITING_NEW_ADMIN_ID' });

    const promptText =
      `🆔 <b>Change System Admin Telegram ID</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Send or reply with the new Telegram User ID to add/set as Super Admin (e.g. <code>6798979733</code>).\n\n` +
      `<i>Current Admin ID: <code>${telegramId}</code></i>`;

    try {
      await ctx.editMessageText(promptText, {
        parse_mode: 'HTML',
        reply_markup: keyboards.cancelAdmin()
      });
    } catch (e) {}
  });

  // Action: Change Delay Menu
  bot.callbackQuery('admin_set_delay', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!checkAdmin(ctx)) return;

    const currentDelay = dbService.getSetting('check_delay_ms', String(config.checkDelayMs));

    const delayText =
      `⚙️ <b>Change Bulk Checking Speed & Batch Delay</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Current Check Delay: <code>${currentDelay}ms</code>\n\n` +
      `Select a check delay option below:`;

    try {
      await ctx.editMessageText(delayText, {
        parse_mode: 'HTML',
        reply_markup: keyboards.adminDelayMenu()
      });
    } catch (e) {}
  });

  // Action: Set Delay Handler Callbacks
  bot.callbackQuery(/^admin_delay_set_(\d+)$/, async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const newDelay = parseInt(ctx.match[1], 10);

    dbService.setSetting('check_delay_ms', newDelay);
    await ctx.answerCallbackQuery(`⚡ Check delay set to: ${newDelay}ms`).catch(() => {});

    const mode = dbService.getSetting('bot_mode', config.botMode);
    const autoApprove = dbService.getSetting('auto_approve', 'off');
    const adminMsg = buildAdminMenuText();

    try {
      await ctx.editMessageText(adminMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.adminMenu(mode, autoApprove)
      });
    } catch (e) {}
  });

  // Action: Button Manager Menu
  bot.callbackQuery('admin_button_mgr', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!checkAdmin(ctx)) return;

    const telegramId = ctx.from.id;
    adminState.delete(telegramId);

    const msg =
      `🔘 <b>Custom Button Manager Panel</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Create and attach custom URL link buttons to the Main Menu!\n\n` +
      `Select an option below:`;

    try {
      await ctx.editMessageText(msg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.buttonManagerMenu()
      });
    } catch (e) {}
  });

  // Action: Add URL Button Wizard
  bot.callbackQuery('admin_btn_add_url', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!checkAdmin(ctx)) return;

    const telegramId = ctx.from.id;
    adminState.set(telegramId, { step: 'AWAITING_BTN_LABEL' });

    const msg =
      `➕ <b>Add Custom URL Link Button (Step 1/2)</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Send the button text/label (e.g. <code>📢 Support Channel</code>):`;

    try {
      await ctx.editMessageText(msg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.cancelAdmin()
      });
    } catch (e) {}
  });

  // Action: View & Manage Buttons List
  bot.callbackQuery('admin_btn_list', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!checkAdmin(ctx)) return;

    const buttons = dbService.getAllCustomButtons();

    let msg =
      `📋 <b>Active Custom Buttons List</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

    if (buttons.length === 0) {
      msg += `<i>No custom buttons created yet.</i>`;
    } else {
      msg += `Click any button to toggle status or delete:`;
    }

    try {
      await ctx.editMessageText(msg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.customButtonList(buttons)
      });
    } catch (e) {}
  });

  // Action: Toggle Button Status
  bot.callbackQuery(/^admin_btn_toggle_(\d+)$/, async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const btnId = parseInt(ctx.match[1], 10);

    dbService.toggleCustomButtonStatus(btnId);
    await ctx.answerCallbackQuery('🟢 Button status updated!').catch(() => {});

    const buttons = dbService.getAllCustomButtons();
    try {
      await ctx.editMessageText(
        `📋 <b>Active Custom Buttons List</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Click any button to toggle status or delete:`,
        { parse_mode: 'HTML', reply_markup: keyboards.customButtonList(buttons) }
      );
    } catch (e) {}
  });

  // Action: Delete Custom Button
  bot.callbackQuery(/^admin_btn_del_(\d+)$/, async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const btnId = parseInt(ctx.match[1], 10);

    dbService.deleteCustomButton(btnId);
    await ctx.answerCallbackQuery('🗑️ Button deleted!').catch(() => {});

    const buttons = dbService.getAllCustomButtons();
    try {
      await ctx.editMessageText(
        `📋 <b>Active Custom Buttons List</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Click any button to toggle status or delete:`,
        { parse_mode: 'HTML', reply_markup: keyboards.customButtonList(buttons) }
      );
    } catch (e) {}
  });

  // Action: Broadcast Announcement Wizard
  bot.callbackQuery('admin_broadcast', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!checkAdmin(ctx)) return;

    const telegramId = ctx.from.id;
    adminState.set(telegramId, { step: 'AWAITING_BROADCAST_MSG' });

    const msg =
      `📢 <b>Broadcast Announcement Wizard</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Send or forward the message you want to broadcast to all registered bot users.\n` +
      `<i>Supports HTML text, photos, and formatting!</i>`;

    try {
      await ctx.editMessageText(msg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.cancelAdmin()
      });
    } catch (e) {}
  });

  // Action: Direct Message User Wizard
  bot.callbackQuery('admin_direct_msg', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!checkAdmin(ctx)) return;

    const telegramId = ctx.from.id;
    adminState.set(telegramId, { step: 'AWAITING_DIRECT_USER_ID' });

    const msg =
      `📩 <b>Direct Message User Wizard</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Send the Telegram User ID of the recipient (e.g. <code>6798979733</code>):`;

    try {
      await ctx.editMessageText(msg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.cancelAdmin()
      });
    } catch (e) {}
  });

  // Preset Direct Message action from banned user list
  bot.callbackQuery(/^admin_direct_msg_preset_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!checkAdmin(ctx)) return;

    const targetUserId = parseInt(ctx.match[1], 10);
    const telegramId = ctx.from.id;
    adminState.set(telegramId, { step: 'AWAITING_DIRECT_MSG_TEXT', targetUserId });

    const msg =
      `📩 <b>Direct Message User</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Target User ID: <code>${targetUserId}</code>\n\n` +
      `Send the message text you want to send directly to this user:`;

    try {
      await ctx.editMessageText(msg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.cancelAdmin()
      });
    } catch (e) {}
  });

  // Handle Admin Input Messages (Text)
  bot.on('message:text', async (ctx, next) => {
    const telegramId = ctx.from.id;
    const state = adminState.get(telegramId);
    if (!state) return next();

    const rawText = ctx.message.text ? ctx.message.text.trim() : '';

    if (state.step === 'AWAITING_NEW_ADMIN_ID') {
      const targetId = parseInt(rawText, 10);
      if (isNaN(targetId) || targetId < 1000) {
        return ctx.reply('❌ Invalid Telegram ID format. Please send a valid numeric Telegram ID.');
      }
      adminState.delete(telegramId);

      const confirmMsg =
        `⚠️ <b>Confirm Admin ID Addition</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Are you sure you want to add/set Telegram User ID <code>${targetId}</code> as Super Admin?`;

      return ctx.reply(confirmMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.confirmAdminIdChange(targetId)
      });
    }

    if (state.step === 'AWAITING_BTN_LABEL') {
      adminState.set(telegramId, { step: 'AWAITING_BTN_URL', label: rawText });
      return ctx.reply(
        `🔗 <b>Add Custom URL Link Button (Step 2/2)</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Button Label: <code>${rawText}</code>\n\n` +
        `Send the full URL link (e.g. <code>https://t.me/yourchannel</code>):`,
        { parse_mode: 'HTML', reply_markup: keyboards.cancelAdmin() }
      );
    }

    if (state.step === 'AWAITING_BTN_URL') {
      if (!rawText.startsWith('http://') && !rawText.startsWith('https://')) {
        return ctx.reply('❌ Invalid URL format. URL must start with http:// or https://');
      }
      dbService.addCustomButton(state.label, 'url', rawText);
      adminState.delete(telegramId);

      return ctx.reply(
        `✅ <b>Custom Button Created Successfully!</b>\n\n` +
        `Label: <b>${state.label}</b>\nURL: <code>${rawText}</code>`,
        { parse_mode: 'HTML', reply_markup: keyboards.buttonManagerMenu() }
      );
    }

    if (state.step === 'AWAITING_DIRECT_USER_ID') {
      const targetUserId = parseInt(rawText, 10);
      if (isNaN(targetUserId)) {
        return ctx.reply('❌ Invalid Telegram ID. Please send a numeric User ID.');
      }

      adminState.set(telegramId, { step: 'AWAITING_DIRECT_MSG_TEXT', targetUserId });
      return ctx.reply(
        `📩 <b>Direct Message User</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Target User ID: <code>${targetUserId}</code>\n\n` +
        `Send the text message to deliver:`,
        { parse_mode: 'HTML', reply_markup: keyboards.cancelAdmin() }
      );
    }

    if (state.step === 'AWAITING_DIRECT_MSG_TEXT') {
      const targetUserId = state.targetUserId;
      adminState.delete(telegramId);

      try {
        const sent = await bot.api.sendMessage(
          targetUserId,
          `💬 <b>Direct Message from Administrator:</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `${rawText}\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
          { parse_mode: 'HTML' }
        );

        return ctx.reply(
          `✅ <b>Direct Message Delivered!</b>\n\nTarget User: <code>${targetUserId}</code>`,
          {
            parse_mode: 'HTML',
            reply_markup: keyboards.directMessageRevoke(targetUserId, sent.message_id)
          }
        );
      } catch (err) {
        return ctx.reply(`❌ Failed to deliver message to user ${targetUserId}: ${err.message}`, {
          reply_markup: keyboards.backToAdmin()
        });
      }
    }

    if (state.step === 'AWAITING_BROADCAST_MSG') {
      adminState.delete(telegramId);
      const allUsers = dbService.getAllUsers();
      const jobId = `bcast_${Date.now()}`;

      const waitMsg = await ctx.reply(`🚀 <i>Broadcasting message to ${allUsers.length} users...</i>`, { parse_mode: 'HTML' });

      let successCount = 0;
      let failCount = 0;
      const sentMsgRecords = [];

      for (const u of allUsers) {
        try {
          const sent = await bot.api.sendMessage(
            u.telegram_id,
            `📢 <b>Announcement:</b>\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
            `${rawText}\n` +
            `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            { parse_mode: 'HTML' }
          );
          successCount++;
          sentMsgRecords.push({ chatId: u.telegram_id, messageId: sent.message_id });
        } catch (e) {
          failCount++;
        }
      }

      broadcastCache.set(jobId, sentMsgRecords);

      const resText =
        `🎉 <b>Broadcast Completed!</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `✅ <b>Delivered:</b> <code>${successCount}</code> users\n` +
        `❌ <b>Failed/Blocked:</b> <code>${failCount}</code> users\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━`;

      try {
        await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, resText, {
          parse_mode: 'HTML',
          reply_markup: keyboards.broadcastResult(jobId)
        });
      } catch (e) {
        await ctx.reply(resText, {
          parse_mode: 'HTML',
          reply_markup: keyboards.broadcastResult(jobId)
        });
      }
      return;
    }

    return next();
  });

  // Action: Revoke/Delete Direct Message from User Chat
  bot.callbackQuery(/^action_delete_direct_(\d+)_(\d+)$/, async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const targetChatId = parseInt(ctx.match[1], 10);
    const targetMsgId = parseInt(ctx.match[2], 10);

    try {
      await bot.api.deleteMessage(targetChatId, targetMsgId);
      await ctx.answerCallbackQuery('🗑️ Message deleted from user chat!').catch(() => {});
    } catch (err) {
      await ctx.answerCallbackQuery({ text: `❌ Could not delete message: ${err.message}`, show_alert: true }).catch(() => {});
    }
  });

  // Action: Delete Broadcast Message from All User Chats
  bot.callbackQuery(/^action_delete_broadcast_(.+)$/, async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const jobId = ctx.match[1];
    const records = broadcastCache.get(jobId);

    if (!records || records.length === 0) {
      return ctx.answerCallbackQuery({ text: '⚠️ Broadcast record expired or already deleted.', show_alert: true }).catch(() => {});
    }

    let deletedCount = 0;
    for (const r of records) {
      try {
        await bot.api.deleteMessage(r.chatId, r.messageId);
        deletedCount++;
      } catch (e) {}
    }

    broadcastCache.delete(jobId);
    await ctx.answerCallbackQuery(`🗑️ Deleted broadcast from ${deletedCount} user chats!`).catch(() => {});

    try {
      await ctx.editMessageText(
        `🗑️ <b>Broadcast Recalled & Deleted</b>\n\n` +
        `Successfully deleted broadcast message from <code>${deletedCount}</code> user chats.`,
        { parse_mode: 'HTML', reply_markup: keyboards.backToAdmin() }
      );
    } catch (e) {}
  });

  // Action: Agree & Change Admin ID Callback
  bot.callbackQuery(/^action_agree_admin_id_change_(\d+)$/, async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const targetId = parseInt(ctx.match[1], 10);

    const currentSetting = dbService.getSetting('custom_admin_ids', '');
    const currentList = currentSetting ? currentSetting.split(',').map(id => String(id).trim()).filter(Boolean) : [];
    
    if (!currentList.includes(String(targetId))) {
      currentList.push(String(targetId));
      dbService.setSetting('custom_admin_ids', currentList.join(','));
    }

    dbService.setUserRole(targetId, 'admin');
    dbService.setUserStatus(targetId, 'approved');

    await ctx.answerCallbackQuery('✅ Super Admin ID added successfully!').catch(() => {});

    try {
      await bot.api.sendMessage(
        targetId,
        '👑 <b>You have been granted Super Admin Rights!</b>\n\nYou now have full administrator access to the bot control panel via /admin.',
        { parse_mode: 'HTML', reply_markup: keyboards.mainMenu(true, sessionManager.isSessionConnected(targetId)) }
      );
    } catch (e) {}

    const mode = dbService.getSetting('bot_mode', config.botMode);
    const autoApprove = dbService.getSetting('auto_approve', 'off');
    const adminMsg = buildAdminMenuText();

    try {
      await ctx.editMessageText(adminMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.adminMenu(mode, autoApprove)
      });
    } catch (e) {}
  });
}
