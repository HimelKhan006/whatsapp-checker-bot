# ⚡ WhatsApp Registration Checker Bot - Deployment & Update Guide

This guide contains all setup instructions and future update commands for pushing updates to **GitHub** and keeping your bot running 24/7 on **Render.com**.

---

## 💻 1. Commands for Future Code Updates & Pushing to GitHub

Whenever you modify any code or add new features in the future, run these commands in your command prompt (`cmd`) inside `c:\tele bot`:

```bash
# Step 1: Stage all updated files
git add .

# Step 2: Commit your changes with a description message
git commit -m "Update: Describe your new feature or fix here"

# Step 3: Push updates to GitHub (Render will auto-redeploy automatically!)
git push
```

---

## 🔑 2. How to Get GitHub Gist Token & Gist ID

### 2.1 Get `GITHUB_GIST_TOKEN`

1. Open [GitHub Personal Access Tokens](https://github.com/settings/tokens).
2. Click **Generate new token** ➔ **Generate new token (classic)**.
3. Note: `WhatsApp Bot Gist Token`.
4. Expiration: **No expiration**.
5. Check the scope: `[✓] gist` (Create gists).
6. Click **Generate token** and copy the code starting with `ghp_...`.

### 2.2 Get `GIST_ID`

1. Open [GitHub Gist Creator](https://gist.github.com/).
2. Gist description: `WhatsApp Bot Encrypted Database Backup`.
3. Filename: `database.sqlite.json`.
4. Content: `{}`
5. Click **Create secret gist**.
6. Copy the alphanumeric hex code from the end of the URL:
   `https://gist.github.com/HimelKhan006/a1b2c3d4e5f67890abcdef1234567890`
   👉 `a1b2c3d4e5f67890abcdef1234567890` is your **`GIST_ID`**.

---

## 🚀 3. Render.com Hosting Setup

### 3.1 Create Service on Render

1. Open [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** ➔ **Background Worker** (or **Web Service**).
3. Connect your repository **`HimelKhan006/whatsapp-checker-bot`**.

### 3.2 Build & Start Settings

- **Name:** `whatsapp-checker-bot`
- **Runtime:** `Node`
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Instance Type:** `Free`

### 3.3 Required Environment Variables on Render

Add the following 7 Key-Value pairs under **Environment Variables**:

| Environment Key | Recommended Value |
| :--- | :--- |
| `BOT_TOKEN` | Your Telegram Bot Token from @BotFather |
| `ADMIN_IDS` | `6798979733` |
| `BOT_MODE` | `authorized` |
| `CHECK_DELAY_MS` | `0` |
| `ENCRYPTION_KEY` | `my_super_secret_key_32chars_min!` |
| `GITHUB_GIST_TOKEN` | `ghp_...` *(from Step 2.1)* |
| `GIST_ID` | `a1b2c3d4e5f6...` *(from Step 2.2)* |

---

## 🛡️ 4. Security & Cloud Data Protection

- All user data and admin settings are encrypted at rest using **AES-256-GCM**.
- Database backups automatically sync to GitHub Gist and restore on startup.
- Unsafe files (`.env`, `sessions/`, `data.db`) are automatically protected by `.gitignore`.
