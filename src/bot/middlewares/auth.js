import { config } from '../../config.js';
import { dbService } from '../../db/database.js';
import { keyboards } from '../keyboards/inline.js';

export async function authMiddleware(ctx, next) {
  if (!ctx.from) return next();

  const telegramId = ctx.from.id;
  const username = ctx.from.username || '';
  const firstName = ctx.from.first_name || '';

  // Retrieve dynamic admin IDs from database settings along with config
  const customAdminSetting = dbService.getSetting('custom_admin_ids', '');
  const customAdminIds = customAdminSetting ? customAdminSetting.split(',').map(Number).filter(Boolean) : [];
  const activeAdminIds = [...new Set([...config.adminIds, ...customAdminIds])];

  const isAdmin = activeAdminIds.includes(telegramId);
  const defaultRole = isAdmin ? 'admin' : 'user';

  // Get current Bot Mode and Auto-Approve setting from database
  const botMode = dbService.getSetting('bot_mode', config.botMode);
  const autoApprove = dbService.getSetting('auto_approve', 'off') === 'on';

  // Determine default status for new user registrations
  let defaultStatus = 'pending';
  if (isAdmin || botMode === 'public') {
    defaultStatus = 'approved';
  } else if (botMode === 'authorized' && autoApprove) {
    defaultStatus = 'approved';
  }

  let isNewUser = false;
  let user = dbService.getUser(telegramId);

  if (!user) {
    isNewUser = true;
    user = dbService.upsertUser(telegramId, username, firstName, defaultRole, defaultStatus);

    // Notify admins if new user pending approval in authorized mode when autoApprove is OFF
    if (botMode === 'authorized' && user.status === 'pending') {
      for (const adminId of activeAdminIds) {
        try {
          await ctx.api.sendMessage(
            adminId,
            `🔔 <b>New Access Request</b>\n\n` +
            `<b>User:</b> ${firstName} (@${username || 'N/A'})\n` +
            `<b>Telegram ID:</b> <code>${telegramId}</code>`,
            {
              parse_mode: 'HTML',
              reply_markup: keyboards.userApproval(telegramId)
            }
          );
        } catch (err) {
          console.error(`Failed to notify admin ${adminId}:`, err);
        }
      }
    }
  } else {
    // If user is configured as admin, ensure role is admin & approved
    if (isAdmin && user.role !== 'admin') {
      dbService.setUserRole(telegramId, 'admin');
      dbService.setUserStatus(telegramId, 'approved');
      user.role = 'admin';
      user.status = 'approved';
    } else {
      user = dbService.upsertUser(telegramId, username, firstName, user.role, user.status);
    }
  }

  // Save to ctx state for handlers
  ctx.state = ctx.state || {};
  ctx.state.user = user;
  ctx.state.isNewUser = isNewUser;
  ctx.state.isAdmin = user.role === 'admin' || isAdmin;
  ctx.state.botMode = botMode;

  // Access Checks
  if (ctx.state.isAdmin) {
    return next();
  }

  if (botMode === 'private') {
    return ctx.reply('🔒 <b>Access Denied</b>\n\nThis bot is currently in <b>Private Mode</b> (Admin Only).', { parse_mode: 'HTML' });
  }

  if (user.status === 'blocked') {
    return ctx.reply('🚫 <b>Access Blocked</b>\n\nYour account has been restricted by an admin.', { parse_mode: 'HTML' });
  }

  if (botMode === 'authorized' && user.status === 'pending') {
    return ctx.reply(
      '⏳ <b>Access Request Pending</b>\n\n' +
      'Your account is waiting for admin authorization. You will be notified once approved!',
      { parse_mode: 'HTML' }
    );
  }

  return next();
}
