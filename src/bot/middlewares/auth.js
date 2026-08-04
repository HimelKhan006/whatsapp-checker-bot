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

  // Get current Bot Mode and Auto-Approve setting from database (Default auto_approve to 'on')
  const botMode = dbService.getSetting('bot_mode', config.botMode);

  // Default status for new user registrations is 'approved' for smooth user onboarding
  let defaultStatus = 'approved';

  let isNewUser = false;
  let user = dbService.getUser(telegramId);

  if (!user) {
    isNewUser = true;
    user = dbService.upsertUser(telegramId, username, firstName, defaultRole, defaultStatus);
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

  return next();
}
