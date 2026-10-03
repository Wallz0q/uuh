
# Gacha Nokos Bot

Single-file Telegram bot (Node.js) designed for Pterodactyl long-polling.

## Setup

1. Edit `config.json` and fill `BOT_TOKEN` with your bot token.
2. (Optional) Adjust OWNER_ID, GROUP_USERNAME, CHANNEL_USERNAME, NOTIF_CHANNEL.
3. Install deps:
   ```
   npm install
   ```
4. Run:
   ```
   npm start
   ```

## Files
- `bot.js` - main bot code
- `config.json` - bot settings (token, owner id, groups)
- `db.json` - database (auto-created if missing)
- `package.json` - npm settings

## Owner Commands
- `/add <number>` - add number to pool (owner only)
- `/list` - show stats

## Notes
- Numbers added are unlimited (not removed on gacha).
- OTP valid 60 seconds.
- Referral system gives inviter +10 limit.
