import { InlineKeyboard } from 'grammy';
import { dbService } from '../../db/database.js';

export const keyboards = {
  mainMenu(isAdmin = false, isConnected = false) {
    const connectTag = isConnected ? '🟢 Connected' : '📱 Connect';

    const kb = new InlineKeyboard()
      .text(connectTag, 'nav_pair')
      .text('🔍 Check Numbers', 'nav_check_unified')
      .row()
      .text('🎁 Referral Program', 'nav_referral')
      .text('🏆 Leaderboard', 'nav_leaderboard')
      .row()
      .text('👤 My Profile', 'nav_profile');

    // Dynamic Custom Buttons from DB
    try {
      const activeCustomButtons = dbService.getActiveCustomButtons();
      if (activeCustomButtons && activeCustomButtons.length > 0) {
        for (const btn of activeCustomButtons) {
          kb.row();
          if (btn.type === 'url') {
            kb.url(btn.label, btn.value);
          } else {
            kb.text(btn.label, `custom_btn_text_${btn.id}`);
          }
        }
      }
    } catch (e) {}

    if (isAdmin) {
      kb.row().text('👑 Admin Control Panel', 'nav_admin');
    }

    kb.row().text('ℹ️ Help & Info', 'nav_help');
    return kb;
  },

  waPairingMenu(isConnected = false) {
    const kb = new InlineKeyboard();
    if (!isConnected) {
      kb.text('📷 Pair via QR Image', 'action_pair_qr')
        .text('🔢 Pair via Code', 'action_pair_code')
        .row();
    } else {
      kb.text('🚪 Unlink / Logout Session', 'action_logout')
        .row();
    }
    kb.text('🔄 Refresh Status', 'nav_pair')
      .text('🔙 Main Menu', 'nav_main');
    return kb;
  },

  profileKeyboard(isConnected = false) {
    const kb = new InlineKeyboard();
    if (isConnected) {
      kb.text('🚪 Logout Connected Account', 'action_logout').row();
    }
    kb.text('🔙 Main Menu', 'nav_main');
    return kb;
  },

  logoutConfirmKeyboard() {
    return new InlineKeyboard()
      .text('✅ Yes, Unlink & Logout', 'action_logout_confirm')
      .text('❌ Cancel', 'nav_pair');
  },

  postLogoutKeyboard() {
    return new InlineKeyboard()
      .text('📱 Connect Menu', 'nav_pair')
      .text('🔙 Main Menu', 'nav_main');
  },

  tryAgainQR() {
    return new InlineKeyboard()
      .text('🔄 Try Again', 'action_pair_qr')
      .text('📱 Connect Menu', 'nav_pair');
  },

  tryAgainCode() {
    return new InlineKeyboard()
      .text('🔄 Request New Code', 'action_pair_code')
      .text('📱 Connect Menu', 'nav_pair');
  },

  adminMenu(currentBotMode = 'authorized', autoApprove = 'off') {
    const autoApproveTag = autoApprove === 'on' ? '🟢 ON' : '🔴 OFF';

    return new InlineKeyboard()
      .text('👥 User Whitelist', 'admin_users')
      .text('🚫 Banned Users', 'admin_banned_users')
      .row()
      .text(`🔐 Bot Mode [${currentBotMode.toUpperCase()}]`, 'admin_mode_toggle')
      .text(`⚡ Auto-Approve [${autoApproveTag}]`, 'admin_toggle_auto_approve')
      .row()
      .text('📢 Broadcast Announcement', 'admin_broadcast')
      .text('📩 Direct Message User', 'admin_direct_msg')
      .row()
      .text('📈 Global System Stats', 'admin_stats')
      .text('⚙️ Change Delay', 'admin_set_delay')
      .row()
      .text('🆔 Change Admin ID', 'admin_change_id')
      .text('🔘 Button Manager', 'admin_button_mgr')
      .row()
      .text('🔙 Main Menu', 'nav_main');
  },

  userWhitelistMenu(users) {
    const kb = new InlineKeyboard();
    const pendingUsers = users.filter(u => u.status === 'pending');

    if (pendingUsers.length > 0) {
      kb.text('✅ Approve All Pending', 'admin_approve_all')
        .text('🚫 Block All Pending', 'admin_block_all')
        .row();
    }

    const targetUsers = users.filter(u => u.role !== 'admin').slice(0, 10);
    for (const u of targetUsers) {
      const isApproved = u.status === 'approved';
      const actionText = isApproved ? `🚫 Block ${u.first_name}` : `✅ Approve ${u.first_name}`;
      const callbackData = isApproved ? `user_reject_${u.telegram_id}` : `user_approve_${u.telegram_id}`;
      
      kb.text(actionText, callbackData).row();
    }

    kb.text('🔙 Admin Menu', 'nav_admin');
    return kb;
  },

  bannedUsersMenu(bannedUsers) {
    const kb = new InlineKeyboard();
    if (bannedUsers.length === 0) {
      kb.text('🔙 Admin Menu', 'nav_admin');
      return kb;
    }

    kb.text('🔓 Unban All Banned Users', 'admin_unban_all').row();

    for (const u of bannedUsers.slice(0, 10)) {
      kb.text(`🔓 Unblock ${u.first_name}`, `user_approve_${u.telegram_id}`)
        .text(`📩 Message`, `admin_direct_msg_preset_${u.telegram_id}`)
        .row();
    }

    kb.text('🔙 Admin Menu', 'nav_admin');
    return kb;
  },

  buttonManagerMenu() {
    return new InlineKeyboard()
      .text('🔗 Add URL Link Button', 'admin_btn_add_url')
      .row()
      .text('📋 View & Manage Buttons', 'admin_btn_list')
      .row()
      .text('🔙 Admin Menu', 'nav_admin');
  },

  customButtonList(buttons) {
    const kb = new InlineKeyboard();
    if (buttons.length === 0) {
      kb.text('➕ Add New Button', 'admin_button_mgr').row();
    } else {
      for (const b of buttons) {
        const statusIcon = b.status === 'active' ? '🟢' : '🔴';
        const typeIcon = b.type === 'url' ? '🔗' : '💬';
        kb.text(`${statusIcon} ${typeIcon} ${b.label}`, `admin_btn_toggle_${b.id}`)
          .text('🗑️ Delete', `admin_btn_del_${b.id}`)
          .row();
      }
      kb.text('➕ Add New Button', 'admin_button_mgr').row();
    }
    kb.text('🔙 Admin Menu', 'nav_admin');
    return kb;
  },

  directMessageRevoke(chatId, messageId) {
    return new InlineKeyboard()
      .text('🗑️ Delete Message from User Chat', `action_delete_direct_${chatId}_${messageId}`)
      .row()
      .text('🔙 Admin Menu', 'nav_admin');
  },

  confirmAdminIdChange(targetId) {
    return new InlineKeyboard()
      .text('✅ Yes, Agree & Change Admin ID', `action_agree_admin_id_change_${targetId}`)
      .row()
      .text('❌ No, Cancel', 'nav_admin');
  },

  adminDelayMenu() {
    return new InlineKeyboard()
      .text('⚡ 0ms (Instant)', 'admin_delay_set_0')
      .text('⏱️ 500ms', 'admin_delay_set_500')
      .row()
      .text('⏱️ 1000ms', 'admin_delay_set_1000')
      .text('⏱️ 2000ms', 'admin_delay_set_2000')
      .row()
      .text('❌ Cancel', 'nav_admin');
  },

  broadcastResult(jobId) {
    return new InlineKeyboard()
      .text('🗑️ Delete Broadcast Message from All Users', `action_delete_broadcast_${jobId}`)
      .row()
      .text('🔙 Admin Menu', 'nav_admin');
  },

  userApproval(telegramId) {
    return new InlineKeyboard()
      .text('✅ Approve', `user_approve_${telegramId}`)
      .text('❌ Reject/Block', `user_reject_${telegramId}`);
  },

  reportExport(bulkJobId) {
    return new InlineKeyboard()
      .text('📊 Full CSV', `export_csv_all_${bulkJobId}`)
      .text('📄 Full TXT', `export_txt_all_${bulkJobId}`)
      .row()
      .text('✅ Registered Only', `export_csv_registered_${bulkJobId}`)
      .text('❌ Unregistered Only', `export_csv_unregistered_${bulkJobId}`)
      .row()
      .text('🔙 Main Menu', 'nav_main');
  },

  backToMain() {
    return new InlineKeyboard().text('🔙 Main Menu', 'nav_main');
  },

  backToAdmin() {
    return new InlineKeyboard().text('🔙 Admin Menu', 'nav_admin');
  },

  cancelAdmin() {
    return new InlineKeyboard().text('❌ Cancel', 'nav_admin');
  },

  cancelCheck() {
    return new InlineKeyboard().text('❌ Cancel', 'nav_main');
  },

  cancelPairing() {
    return new InlineKeyboard().text('❌ Cancel Pairing', 'action_cancel_pairing');
  },

  cancelAction() {
    return new InlineKeyboard().text('❌ Cancel', 'action_cancel');
  }
};
