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
      await ctx.answerCallbackQuery('⚡ Auto-Approve set to: OFF').catch(() => {});
    }

    const autoApprove = dbService.getSetting('auto_approve', 'off');
    const adminMsg = buildAdminMenuText();

    try {
      await ctx.editMessageText(adminMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.adminMenu(currentMode, autoApprove)
      });
    } catch (e) {}
  });

  // Action: Toggle Bot Mode
  bot.callbackQuery('admin_mode_toggle', async (ctx) => {
    if (!checkAdmin(ctx)) return;

    const modes = ['authorized', 'public', 'private'];
    const currentMode = dbService.getSetting('bot_mode', config.botMode);
    const nextIndex = (modes.indexOf(currentMode) + 1) % modes.length;
    const newMode = modes[nextIndex];

    dbService.setSetting('bot_mode', newMode);

    // If switching away from AUTHORIZED mode, auto-turn off Auto-Approve
    if (newMode !== 'authorized') {
      dbService.setSetting('auto_approve', 'off');
    }

    await ctx.answerCallbackQuery(`Mode updated to: ${newMode.toUpperCase()}`).catch(() => {});

    const autoApprove = dbService.getSetting('auto_approve', 'off');
    const adminMsg = buildAdminMenuText();

    await ctx.editMessageText(adminMsg, {
      parse_mode: 'HTML',
      reply_markup: keyboards.adminMenu(newMode, autoApprove)
    });
  });

  // Action: Bulk Approve All Pending Users
  bot.callbackQuery('admin_approve_all', async (ctx) => {
    if (!checkAdmin(ctx)) return;

    const count = dbService.approveAllPendingUsers();
    await ctx.answerCallbackQuery(`✅ ${count} pending user(s) approved!`).catch(() => {});

    const users = dbService.getAllUsers();
    let text = `👥 <b>Registered Bot Users & Whitelist (${users.length})</b>\n━━━━━━━━━━━━━━━━━━━\n\n`;

    for (const u of users.slice(0, 20)) {
      const statusIcon = u.status === 'approved' ? '✅' : u.status === 'pending' ? '⏳' : '🚫';
      const roleTag = u.role === 'admin' ? '👑 Admin' : '👤 User';
      const joinedDate = u.created_at ? u.created_at.split(' ')[0] : 'N/A';
      text += `${statusIcon} <b>${u.first_name}</b> (@${u.username || 'N/A'})\n`;
      text += `└ ID: <code>${u.telegram_id}</code> | ${roleTag} | Status: <code>${u.status}</code> | Joined: <code>${joinedDate}</code>\n\n`;
    }

    try {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: keyboards.userWhitelistMenu(users)
      });
    } catch (e) {}
  });

  // Action: Bulk Block All Pending Users
  bot.callbackQuery('admin_block_all', async (ctx) => {
    if (!checkAdmin(ctx)) return;

    const count = dbService.blockAllPendingUsers();
    await ctx.answerCallbackQuery(`🚫 ${count} pending user(s) blocked!`).catch(() => {});

    const users = dbService.getAllUsers();
    let text = `👥 <b>Registered Bot Users & Whitelist (${users.length})</b>\n━━━━━━━━━━━━━━━━━━━\n\n`;

    for (const u of users.slice(0, 20)) {
      const statusIcon = u.status === 'approved' ? '✅' : u.status === 'pending' ? '⏳' : '🚫';
      const roleTag = u.role === 'admin' ? '👑 Admin' : '👤 User';
      const joinedDate = u.created_at ? u.created_at.split(' ')[0] : 'N/A';
      text += `${statusIcon} <b>${u.first_name}</b> (@${u.username || 'N/A'})\n`;
      text += `└ ID: <code>${u.telegram_id}</code> | ${roleTag} | Status: <code>${u.status}</code> | Joined: <code>${joinedDate}</code>\n\n`;
    }

    try {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: keyboards.userWhitelistMenu(users)
      });
    } catch (e) {}
  });

  // Action: Bulk Unban All Banned Users
  bot.callbackQuery('admin_unban_all', async (ctx) => {
    if (!checkAdmin(ctx)) return;

    const count = dbService.unbanAllUsers();
    await ctx.answerCallbackQuery(`🔓 ${count} banned user(s) unblocked!`).catch(() => {});

    const bannedUsers = dbService.getBannedUsers();
    let text = `🚫 <b>Banned / Blocked Users (${bannedUsers.length})</b>\n━━━━━━━━━━━━━━━━━━━\n\n`;

    if (bannedUsers.length === 0) {
      text += `<i>No banned users found! All users are unblocked.</i>`;
    } else {
      for (const u of bannedUsers.slice(0, 20)) {
        const joinedDate = u.created_at ? u.created_at.split(' ')[0] : 'N/A';
        text += `🚫 <b>${u.first_name}</b> (@${u.username || 'N/A'})\n`;
        text += `└ ID: <code>${u.telegram_id}</code> | Joined: <code>${joinedDate}</code>\n\n`;
      }
    }

    try {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: keyboards.bannedUsersMenu(bannedUsers)
      });
    } catch (e) {}
  });

  // Action: View Banned / Blocked Users
  bot.callbackQuery('admin_banned_users', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!checkAdmin(ctx)) return;

    const bannedUsers = dbService.getBannedUsers();
    let text = `🚫 <b>Banned / Blocked Users (${bannedUsers.length})</b>\n━━━━━━━━━━━━━━━━━━━\n\n`;

    if (bannedUsers.length === 0) {
      text += `<i>No banned users found!</i>`;
    } else {
      for (const u of bannedUsers.slice(0, 20)) {
        const joinedDate = u.created_at ? u.created_at.split(' ')[0] : 'N/A';
        text += `🚫 <b>${u.first_name}</b> (@${u.username || 'N/A'})\n`;
        text += `└ ID: <code>${u.telegram_id}</code> | Joined: <code>${joinedDate}</code>\n\n`;
      }
    }

    try {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: keyboards.bannedUsersMenu(bannedUsers)
      });
    } catch (e) {
      if (!e.message?.includes('message is not modified')) {
        await ctx.reply(text, {
          parse_mode: 'HTML',
          reply_markup: keyboards.bannedUsersMenu(bannedUsers)
        });
      }
    }
  });

  // Action: Direct Message User Preset (from Banned user card)
  bot.callbackQuery(/^admin_direct_msg_preset_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!checkAdmin(ctx)) return;
    const targetId = parseInt(ctx.match[1], 10);

    adminState.set(ctx.from.id, { step: 'AWAITING_DIRECT_TEXT', targetId });

    const promptText = 
      `📩 <b>Send Direct Message to User</b>\n\n` +
      `<b>Target User ID:</b> <code>${targetId}</code>\n\n` +
      `Please reply with the <b>message text</b> you wish to send to this user.`;

    try {
      await ctx.editMessageText(promptText, {
        parse_mode: 'HTML',
        reply_markup: keyboards.cancelAdmin()
      });
    } catch (e) {
      await ctx.reply(promptText, {
        parse_mode: 'HTML',
        reply_markup: keyboards.cancelAdmin()
      });
    }
  });

  // Action: Direct Message User (Step 1: Prompt Telegram ID)
  bot.callbackQuery('admin_direct_msg', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!checkAdmin(ctx)) return;

    adminState.set(ctx.from.id, { step: 'AWAITING_DIRECT_USER_ID' });

    const promptText = 
      `📩 <b>Send Direct Message to User</b>\n\n` +
      `Please reply with the target <b>Telegram User ID</b> (e.g. <code>123456789</code>).\n` +
      `<i>You can revoke/delete the message from the user's chat after sending.</i>`;

    try {
      await ctx.editMessageText(promptText, {
        parse_mode: 'HTML',
        reply_markup: keyboards.cancelAdmin()
      });
    } catch (e) {
      await ctx.reply(promptText, {
        parse_mode: 'HTML',
        reply_markup: keyboards.cancelAdmin()
      });
    }
  });

  // Action: Revoke/Delete Direct Message from User Chat
  bot.callbackQuery(/^action_delete_direct_(\d+)_(\d+)$/, async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const targetChatId = parseInt(ctx.match[1], 10);
    const msgId = parseInt(ctx.match[2], 10);

    await ctx.answerCallbackQuery('Revoking direct message...').catch(() => {});

    try {
      await ctx.api.deleteMessage(targetChatId, msgId);
      await ctx.editMessageText(
        `🗑️ <b>Direct Message Revoked!</b>\n\n` +
        `The message has been deleted from user chat (<code>${targetChatId}</code>).`,
        {
          parse_mode: 'HTML',
          reply_markup: keyboards.adminMenu(dbService.getSetting('bot_mode', config.botMode), dbService.getSetting('auto_approve', 'off'))
        }
      );
    } catch (e) {
      await ctx.reply(`⚠️ Could not delete message from user chat: ${e.message}`);
    }
  });

  // Action: Button Manager Main Options
  bot.callbackQuery('admin_button_mgr', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!checkAdmin(ctx)) return;

    const mgrMsg = 
      `🔘 <b>Dynamic Main Menu Button Manager</b>\n\n` +
      `Add custom URL link buttons directly to the main bot menu below:`;

    try {
      await ctx.editMessageText(mgrMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.buttonManagerMenu()
      });
    } catch (e) {
      await ctx.reply(mgrMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.buttonManagerMenu()
      });
    }
  });

  // Action: Add URL Button (Step 1: Prompt Label)
  bot.callbackQuery('admin_btn_add_url', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!checkAdmin(ctx)) return;

    adminState.set(ctx.from.id, { step: 'AWAITING_BTN_LABEL', type: 'url' });

    const promptText = 
      `🔗 <b>Add Custom URL Link Button (Step 1/2)</b>\n\n` +
      `Please reply with the <b>Button Label / Name</b> (e.g. <code>💬 Official Support</code> or <code>📢 Channel</code>).`;

    try {
      await ctx.editMessageText(promptText, {
        parse_mode: 'HTML',
        reply_markup: keyboards.cancelAdmin()
      });
    } catch (e) {
      await ctx.reply(promptText, {
        parse_mode: 'HTML',
        reply_markup: keyboards.cancelAdmin()
      });
    }
  });

  // Action: List & Manage Custom Buttons
  bot.callbackQuery('admin_btn_list', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!checkAdmin(ctx)) return;

    const buttons = dbService.getAllCustomButtons();
    const listMsg = 
      `📋 <b>Custom Main Menu Buttons (${buttons.length})</b>\n\n` +
      `Tap any button below to toggle active status or delete it:`;

    try {
      await ctx.editMessageText(listMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.customButtonList(buttons)
      });
    } catch (e) {
      await ctx.reply(listMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.customButtonList(buttons)
      });
    }
  });

  // Action: Toggle Custom Button Active / Disabled
  bot.callbackQuery(/^admin_btn_toggle_(\d+)$/, async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const btnId = parseInt(ctx.match[1], 10);
    dbService.toggleCustomButtonStatus(btnId);

    await ctx.answerCallbackQuery('Button status updated!').catch(() => {});

    const buttons = dbService.getAllCustomButtons();
    const listMsg = 
      `📋 <b>Custom Main Menu Buttons (${buttons.length})</b>\n\n` +
      `Tap any button below to toggle active status or delete it:`;

    try {
      await ctx.editMessageText(listMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.customButtonList(buttons)
      });
    } catch (e) {}
  });

  // Action: Delete Custom Button
  bot.callbackQuery(/^admin_btn_del_(\d+)$/, async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const btnId = parseInt(ctx.match[1], 10);
    dbService.deleteCustomButton(btnId);

    await ctx.answerCallbackQuery('Button deleted successfully!').catch(() => {});

    const buttons = dbService.getAllCustomButtons();
    const listMsg = 
      `📋 <b>Custom Main Menu Buttons (${buttons.length})</b>\n\n` +
      `Tap any button below to toggle active status or delete it:`;

    try {
      await ctx.editMessageText(listMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.customButtonList(buttons)
      });
    } catch (e) {}
  });

  // Action: View Users / Whitelist (with interactive Approve / Block buttons)
  bot.callbackQuery('admin_users', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!checkAdmin(ctx)) return;

    const users = dbService.getAllUsers();
    let text = `👥 <b>Registered Bot Users & Whitelist (${users.length})</b>\n━━━━━━━━━━━━━━━━━━━\n\n`;

    for (const u of users.slice(0, 20)) {
      const statusIcon = u.status === 'approved' ? '✅' : u.status === 'pending' ? '⏳' : '🚫';
      const roleTag = u.role === 'admin' ? '👑 Admin' : '👤 User';
      const joinedDate = u.created_at ? u.created_at.split(' ')[0] : 'N/A';
      text += `${statusIcon} <b>${u.first_name}</b> (@${u.username || 'N/A'})\n`;
      text += `└ ID: <code>${u.telegram_id}</code> | ${roleTag} | Status: <code>${u.status}</code> | Joined: <code>${joinedDate}</code>\n\n`;
    }

    try {
      await ctx.editMessageText(text, {
        parse_mode: 'HTML',
        reply_markup: keyboards.userWhitelistMenu(users)
      });
    } catch (e) {
      if (!e.message?.includes('message is not modified')) {
        await ctx.reply(text, {
          parse_mode: 'HTML',
          reply_markup: keyboards.userWhitelistMenu(users)
        });
      }
    }
  });

  // User Approval / Rejection Handlers with Live Card Re-rendering
  bot.callbackQuery(/^user_(approve|reject)_(.+)$/, async (ctx) => {
    if (!checkAdmin(ctx)) return;

    const action = ctx.match[1];
    const targetId = parseInt(ctx.match[2], 10);

    const newStatus = action === 'approve' ? 'approved' : 'blocked';
    dbService.setUserStatus(targetId, newStatus);

    await ctx.answerCallbackQuery(`User ${targetId} ${newStatus}!`).catch(() => {});

    const currentMsgText = ctx.callbackQuery?.message?.text || '';

    // If coming from Banned Users card, re-render Banned Users card!
    if (currentMsgText.includes('Banned') || currentMsgText.includes('Blocked')) {
      const bannedUsers = dbService.getBannedUsers();
      let text = `🚫 <b>Banned / Blocked Users (${bannedUsers.length})</b>\n━━━━━━━━━━━━━━━━━━━\n\n`;

      if (bannedUsers.length === 0) {
        text += `<i>No banned users found! All users are unblocked.</i>`;
      } else {
        for (const u of bannedUsers.slice(0, 20)) {
          const joinedDate = u.created_at ? u.created_at.split(' ')[0] : 'N/A';
          text += `🚫 <b>${u.first_name}</b> (@${u.username || 'N/A'})\n`;
          text += `└ ID: <code>${u.telegram_id}</code> | Joined: <code>${joinedDate}</code>\n\n`;
        }
      }

      try {
        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          reply_markup: keyboards.bannedUsersMenu(bannedUsers)
        });
      } catch (e) {}
    } else {
      // Re-render User Whitelist card
      const users = dbService.getAllUsers();
      let text = `👥 <b>Registered Bot Users & Whitelist (${users.length})</b>\n━━━━━━━━━━━━━━━━━━━\n\n`;

      for (const u of users.slice(0, 20)) {
        const statusIcon = u.status === 'approved' ? '✅' : u.status === 'pending' ? '⏳' : '🚫';
        const roleTag = u.role === 'admin' ? '👑 Admin' : '👤 User';
        const joinedDate = u.created_at ? u.created_at.split(' ')[0] : 'N/A';
        text += `${statusIcon} <b>${u.first_name}</b> (@${u.username || 'N/A'})\n`;
        text += `└ ID: <code>${u.telegram_id}</code> | ${roleTag} | Status: <code>${u.status}</code> | Joined: <code>${joinedDate}</code>\n\n`;
      }

      try {
        await ctx.editMessageText(text, {
          parse_mode: 'HTML',
          reply_markup: keyboards.userWhitelistMenu(users)
        });
      } catch (e) {}
    }

    // Notify user
    try {
      if (action === 'approve') {
        await ctx.api.sendMessage(targetId, '🎉 <b>Access Approved / Unblocked!</b>\n\nYour account access has been unblocked by the admin. You can now use the WhatsApp Checker!', { parse_mode: 'HTML' });
      } else {
        await ctx.api.sendMessage(targetId, '🚫 <b>Access Blocked</b>\n\nYour account status was updated to blocked by the admin.', { parse_mode: 'HTML' });
      }
    } catch (e) {}
  });

  // Action: Global System Diagnostic Stats (Toggles smoothly on the same message card)
  bot.callbackQuery('admin_stats', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!checkAdmin(ctx)) return;

    const stats = dbService.getStats();
    const mode = dbService.getSetting('bot_mode', config.botMode);
    const delay = dbService.getSetting('check_delay_ms', String(config.checkDelayMs));

    const statsMsg = 
      `📈 <b>Global System Diagnostic Statistics</b>\n━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👥 <b>Total Registered Users:</b> <code>${stats.totalUsers}</code>\n` +
      `⚡ <b>Active Users (24h):</b> <code>${stats.activeUsers}</code>\n` +
      `✅ <b>Approved Active Users:</b> <code>${stats.totalApprovedUsers}</code>\n` +
      `⏳ <b>Pending Users:</b> <code>${stats.totalPendingUsers}</code>\n` +
      `🚫 <b>Banned / Blocked Users:</b> <code>${stats.totalBannedUsers}</code>\n` +
      `📱 <b>Active Paired WA Sessions:</b> <code>${sessionManager.getActiveSessionsCount()}</code>\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `⚙️ <b>System Mode:</b> <code>${mode.toUpperCase()}</code>\n` +
      `⏱️ <b>Check Interval:</b> <code>${delay}ms</code> per request\n` +
      `🔍 <b>Total Checks Executed:</b> <code>${stats.totalChecks}</code>\n` +
      `🟢 <b>Total Registered Numbers:</b> <code>${stats.totalRegistered}</code>\n` +
      `🔴 <b>Total Unregistered Numbers:</b> <code>${stats.totalUnregistered}</code>`;

    try {
      await ctx.editMessageText(statsMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.backToAdmin()
      });
    } catch (e) {
      if (!e.message?.includes('message is not modified')) {
        await ctx.reply(statsMsg, {
          parse_mode: 'HTML',
          reply_markup: keyboards.backToAdmin()
        });
      }
    }
  });

  // Action: Change Delay
  bot.callbackQuery('admin_set_delay', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!checkAdmin(ctx)) return;

    const currentDelay = dbService.getSetting('check_delay_ms', String(config.checkDelayMs));
    const cardMsgId = ctx.callbackQuery?.message?.message_id;

    adminState.set(ctx.from.id, { step: 'AWAITING_DELAY', cardMsgId });

    const delayPromptMsg = 
      `⚙️ <b>Set Rate-limiting Check Delay</b>\n\n` +
      `<b>Current Engine Delay:</b> <code>${currentDelay}ms</code>\n\n` +
      `Select a quick preset option below or reply with a custom value in milliseconds:`;

    try {
      await ctx.editMessageText(delayPromptMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.adminDelayMenu()
      });
    } catch (e) {
      await ctx.reply(delayPromptMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.adminDelayMenu()
      });
    }
  });

  // Action: Preset Delay Selected
  bot.callbackQuery(/^admin_delay_set_(\d+)$/, async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const val = parseInt(ctx.match[1], 10);
    adminState.delete(ctx.from.id);

    dbService.setSetting('check_delay_ms', String(val));
    await ctx.answerCallbackQuery(`Delay set to ${val}ms!`).catch(() => {});

    const mode = dbService.getSetting('bot_mode', config.botMode);
    const autoApprove = dbService.getSetting('auto_approve', 'off');
    const adminMsg = buildAdminMenuText();

    try {
      await ctx.editMessageText(adminMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.adminMenu(mode, autoApprove)
      });
    } catch (e) {
      await ctx.reply(adminMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.adminMenu(mode, autoApprove)
      });
    }
  });

  // Action: Initiate Change Admin ID
  bot.callbackQuery('admin_change_id', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!checkAdmin(ctx)) return;

    adminState.set(ctx.from.id, { step: 'AWAITING_NEW_ADMIN_ID' });

    const changeIdPrompt = 
      `🆔 <b>Change / Transfer Telegram Admin ID</b>\n\n` +
      `Please reply with the Telegram User ID you wish to assign as Super Admin (e.g. <code>123456789</code>).\n\n` +
      `<i>You will be asked to confirm your agreement before privileges are granted.</i>`;

    try {
      await ctx.editMessageText(changeIdPrompt, {
        parse_mode: 'HTML',
        reply_markup: keyboards.cancelAdmin()
      });
    } catch (e) {
      await ctx.reply(changeIdPrompt, {
        parse_mode: 'HTML',
        reply_markup: keyboards.cancelAdmin()
      });
    }
  });

  // Action: Agree & Execute Admin ID Change
  bot.callbackQuery(/^action_agree_admin_id_change_(\d+)$/, async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const targetId = parseInt(ctx.match[1], 10);
    const previousAdminId = ctx.from.id;

    // Save custom admin ID in SQLite DB and active config
    const currentCustomAdmins = dbService.getSetting('custom_admin_ids', '');
    const adminSet = new Set(currentCustomAdmins.split(',').map(Number).filter(Boolean));
    adminSet.add(targetId);
    
    if (!config.adminIds.includes(targetId)) {
      config.adminIds.push(targetId);
    }

    dbService.setSetting('custom_admin_ids', Array.from(adminSet).join(','));
    dbService.setUserRole(targetId, 'admin');
    dbService.setUserStatus(targetId, 'approved');

    await ctx.answerCallbackQuery(`Admin ID updated to ${targetId}!`).catch(() => {});

    const successMsg = 
      `🎉 <b>Telegram Admin ID Successfully Changed!</b>\n\n` +
      `• <b>Previous Admin ID:</b> <code>${previousAdminId}</code>\n` +
      `• <b>New Admin Telegram ID:</b> <code>${targetId}</code>\n\n` +
      `Super Admin control panel access has been granted to Telegram ID: <code>${targetId}</code>.`;

    try {
      await ctx.editMessageText(successMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.adminMenu(dbService.getSetting('bot_mode', config.botMode), dbService.getSetting('auto_approve', 'off'))
      });
    } catch (e) {
      await ctx.reply(successMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.adminMenu(dbService.getSetting('bot_mode', config.botMode), dbService.getSetting('auto_approve', 'off'))
      });
    }

    // Notify new Admin
    try {
      await ctx.api.sendMessage(
        targetId,
        `👑 <b>Super Admin Access Granted!</b>\n\n` +
        `Your Telegram ID (<code>${targetId}</code>) has been appointed as a Super Admin.\n` +
        `Use /admin to open the Admin Control Panel.`,
        { parse_mode: 'HTML' }
      );
    } catch (e) {}
  });

  // Action: Broadcast Announcement
  bot.callbackQuery('admin_broadcast', async (ctx) => {
    await ctx.answerCallbackQuery().catch(() => {});
    if (!checkAdmin(ctx)) return;

    adminState.set(ctx.from.id, { step: 'AWAITING_BROADCAST' });

    const promptText = 
      `📢 <b>Broadcast Message to All Users</b>\n\n` +
      `Send the message you wish to broadcast to all registered bot users.`;

    try {
      await ctx.editMessageText(promptText, {
        parse_mode: 'HTML',
        reply_markup: keyboards.cancelAdmin()
      });
    } catch (e) {
      await ctx.reply(promptText, {
        parse_mode: 'HTML',
        reply_markup: keyboards.cancelAdmin()
      });
    }
  });

  // Action: Revoke / Delete Broadcast Message from All Users
  bot.callbackQuery(/^action_delete_broadcast_(.+)$/, async (ctx) => {
    if (!checkAdmin(ctx)) return;
    const jobId = ctx.match[1];
    const items = broadcastCache.get(jobId);

    if (!items || items.length === 0) {
      return ctx.answerCallbackQuery('⚠️ No stored broadcast messages to delete or already revoked.').catch(() => {});
    }

    await ctx.answerCallbackQuery('Revoking broadcast message from all users...').catch(() => {});

    let deletedCount = 0;
    for (const item of items) {
      try {
        await ctx.api.deleteMessage(item.chatId, item.messageId);
        deletedCount++;
      } catch (e) {}
    }

    broadcastCache.delete(jobId);

    try {
      await ctx.editMessageText(
        `🗑️ <b>Broadcast Message Revoked!</b>\n\n` +
        `The broadcast message has been deleted from <b>${deletedCount}</b> user chat(s).`,
        {
          parse_mode: 'HTML',
          reply_markup: keyboards.adminMenu(dbService.getSetting('bot_mode', config.botMode), dbService.getSetting('auto_approve', 'off'))
        }
      );
    } catch (e) {}
  });

  // Handle Admin Text Inputs (Direct Messages, Button Creation, Admin ID, Delay, Broadcast)
  bot.on('message:text', async (ctx, next) => {
    const telegramId = ctx.from.id;
    const state = adminState.get(telegramId);

    if (state && state.step === 'AWAITING_DIRECT_USER_ID') {
      const input = ctx.message.text.trim();
      const targetId = parseInt(input, 10);
      try { await ctx.deleteMessage(); } catch (e) {}

      if (isNaN(targetId) || targetId <= 0) {
        return ctx.reply('❌ <b>Invalid Telegram ID</b>\n\nPlease enter a valid numeric Telegram User ID.', { parse_mode: 'HTML' });
      }

      adminState.set(telegramId, { step: 'AWAITING_DIRECT_TEXT', targetId });

      return ctx.reply(
        `📩 <b>Send Direct Message to User</b>\n\n` +
        `<b>Target Telegram User ID:</b> <code>${targetId}</code>\n\n` +
        `Please reply with the <b>message text</b> you wish to send directly to this user.`,
        { parse_mode: 'HTML', reply_markup: keyboards.cancelAdmin() }
      );
    }

    if (state && state.step === 'AWAITING_DIRECT_TEXT') {
      adminState.delete(telegramId);
      const textMsg = ctx.message.text.trim();
      const targetId = state.targetId;
      try { await ctx.deleteMessage(); } catch (e) {}

      try {
        const sent = await ctx.api.sendMessage(
          targetId,
          `📩 <b>Direct Message from Administrator</b>\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
          `${textMsg}`,
          { parse_mode: 'HTML' }
        );

        const confirmText = 
          `🎉 <b>Direct Message Delivered!</b>\n\n` +
          `• <b>Target User ID:</b> <code>${targetId}</code>\n` +
          `• <b>Message ID:</b> <code>${sent.message_id}</code>\n\n` +
          `<i>Click below to revoke and delete this message from the user's chat at any time:</i>`;

        return ctx.reply(confirmText, {
          parse_mode: 'HTML',
          reply_markup: keyboards.directMessageRevoke(targetId, sent.message_id)
        });
      } catch (err) {
        // Auto-cleanup deleted/blocked account users
        if (err.message?.includes('bot was blocked') || err.message?.includes('user is deactivated') || err.error_code === 403) {
          dbService.deleteUser(targetId);
          return ctx.reply(`⚠️ <b>User Account Deactivated / Blocked Bot</b>\n\nUser ID <code>${targetId}</code> was automatically removed from the database system.`, { parse_mode: 'HTML' });
        }
        return ctx.reply(`❌ <b>Failed to send message:</b> ${err.message}`);
      }
    }

    if (state && state.step === 'AWAITING_BTN_LABEL') {
      const label = ctx.message.text.trim();
      try { await ctx.deleteMessage(); } catch (e) {}

      if (!label) {
        return ctx.reply('❌ Button label cannot be empty.');
      }

      adminState.set(telegramId, { step: 'AWAITING_BTN_VALUE', type: state.type, label });

      return ctx.reply(
        `🔗 <b>Add Custom URL Link Button (Step 2/2)</b>\n\n` +
        `<b>Button Name:</b> <code>${label}</code>\n\n` +
        `Please reply with the target <b>URL Link</b> (e.g. <code>https://t.me/your_channel</code>).`,
        { parse_mode: 'HTML', reply_markup: keyboards.cancelAdmin() }
      );
    }

    if (state && state.step === 'AWAITING_BTN_VALUE') {
      adminState.delete(telegramId);
      const value = ctx.message.text.trim();
      try { await ctx.deleteMessage(); } catch (e) {}

      if (!value) {
        return ctx.reply('❌ Button target content cannot be empty.');
      }

      if (!value.startsWith('http://') && !value.startsWith('https://')) {
        return ctx.reply('❌ Invalid URL link. URL must start with http:// or https://');
      }

      // Add to Database
      dbService.addCustomButton(state.label, 'url', value);

      const successMsg = 
        `🎉 <b>Custom Main Menu Button Created!</b>\n\n` +
        `• <b>Button Label:</b> <code>${state.label}</code>\n` +
        `• <b>Target URL:</b> <code>${value}</code>\n\n` +
        `This button is now live on the Main Menu for all bot users!`;

      const buttons = dbService.getAllCustomButtons();
      return ctx.reply(successMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.customButtonList(buttons)
      });
    }

    if (state && state.step === 'AWAITING_NEW_ADMIN_ID') {
      adminState.delete(telegramId);
      const input = ctx.message.text.trim();
      const targetId = parseInt(input, 10);

      // Auto-delete admin input text message for chat cleanliness
      try { await ctx.deleteMessage(); } catch (e) {}

      if (isNaN(targetId) || targetId <= 0) {
        return ctx.reply('❌ <b>Invalid Telegram ID</b>\n\nPlease enter a valid numeric Telegram ID (e.g. <code>123456789</code>).', { parse_mode: 'HTML' });
      }

      const confirmMsg = 
        `⚠️ <b>Confirm Telegram Admin ID Change</b>\n\n` +
        `You are about to assign Super Admin privileges to:\n` +
        `• <b>Target Telegram ID:</b> <code>${targetId}</code>\n\n` +
        `<b>Do you agree to change and assign this Admin ID?</b>`;

      return ctx.reply(confirmMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.confirmAdminIdChange(targetId)
      });
    }

    if (state && state.step === 'AWAITING_DELAY') {
      adminState.delete(telegramId);
      const val = parseInt(ctx.message.text.trim(), 10);

      // Auto-delete admin input text message for chat cleanliness
      try { await ctx.deleteMessage(); } catch (e) {}

      if (isNaN(val) || val < 0 || val > 10000) {
        return ctx.reply('❌ Invalid delay. Please enter a value between 0 and 10000 ms.');
      }

      dbService.setSetting('check_delay_ms', String(val));
      const mode = dbService.getSetting('bot_mode', config.botMode);
      const autoApprove = dbService.getSetting('auto_approve', 'off');
      const adminMsg = buildAdminMenuText();

      if (state.cardMsgId) {
        try {
          return await ctx.api.editMessageText(ctx.chat.id, state.cardMsgId, adminMsg, {
            parse_mode: 'HTML',
            reply_markup: keyboards.adminMenu(mode, autoApprove)
          });
        } catch (e) {}
      }

      return ctx.reply(adminMsg, {
        parse_mode: 'HTML',
        reply_markup: keyboards.adminMenu(mode, autoApprove)
      });
    }

    if (state && state.step === 'AWAITING_BROADCAST') {
      adminState.delete(telegramId);
      const broadcastMsg = ctx.message.text;

      const users = dbService.getAllUsers();
      let targetUsers = users.filter(u => u.telegram_id !== telegramId);
      if (targetUsers.length === 0) {
        targetUsers = users;
      }

      const deliveredItems = [];
      let sentCount = 0;
      let failCount = 0;

      // Parallel instant broadcast sending to target users with auto-cleanup for deleted/blocked users
      const sendPromises = targetUsers.map(async (u) => {
        try {
          const sent = await ctx.api.sendMessage(u.telegram_id, `📢 <b>Announcement</b>\n\n${broadcastMsg}`, { parse_mode: 'HTML' });
          return { ok: true, chatId: u.telegram_id, messageId: sent.message_id };
        } catch (e) {
          if (e.message?.includes('bot was blocked') || e.message?.includes('user is deactivated') || e.error_code === 403) {
            dbService.deleteUser(u.telegram_id);
          }
          return { ok: false };
        }
      });

      const results = await Promise.allSettled(sendPromises);
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.ok) {
          sentCount++;
          deliveredItems.push({ chatId: r.value.chatId, messageId: r.value.messageId });
        } else {
          failCount++;
        }
      }

      const jobId = `bc_${Date.now()}`;
      broadcastCache.set(jobId, deliveredItems);

      const previewText = broadcastMsg.length > 250 ? broadcastMsg.slice(0, 250) + '...' : broadcastMsg;

      const finalMsgText = 
        `🎉 <b>Broadcast Finished!</b>\n\n` +
        `📝 <b>Sent Broadcast Content:</b>\n` +
        `<i>"${previewText}"</i>\n\n` +
        `✅ Delivered: <code>${sentCount}</code>\n` +
        `❌ Failed / Cleaned: <code>${failCount}</code>\n\n` +
        `<i>Click below to delete this broadcast message from all users' chats:</i>`;

      await ctx.reply(finalMsgText, {
        parse_mode: 'HTML',
        reply_markup: keyboards.broadcastResult(jobId)
      });
      return;
    }

    return next();
  });
}
