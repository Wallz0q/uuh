
/**
 * bot.js
 * Gacha Nokos - single-file Telegram bot (Node.js)
 * - Designed for long-polling (Pterodactyl)
 * - Uses config.json for settings
 *
 * Features:
 *  - /start (with referral support)
 *  - /gacha (checks group & channel membership, uses limit)
 *  - Dapatkan Kode button -> generates OTP 6-digit (60s)
 *  - OTP verification by sending 6-digit message
 *  - /add <number> (owner only) to add unlimited numbers
 *  - /list stats
 *  - Referral system (+10 limit to inviter)
 *  - Join-group bonus (+10 limit once)
 *  - Notifications to channel
 *
 * IMPORTANT: fill BOT_TOKEN in config.json before running.
 */

const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');

const CONFIG_PATH = path.join(__dirname, 'config.json');
const DB_PATH = path.join(__dirname, 'db.json');

if (!fs.existsSync(CONFIG_PATH)) {
  console.error('config.json not found! Please create it and set BOT_TOKEN.');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const BOT_TOKEN = config.BOT_TOKEN || '';
const OWNER_ID = config.OWNER_ID;
const GROUP_USERNAME = config.GROUP_USERNAME;
const CHANNEL_USERNAME = config.CHANNEL_USERNAME;
const NOTIF_CHANNEL = config.NOTIF_CHANNEL;

if (!BOT_TOKEN || BOT_TOKEN === 'REPLACE_WITH_YOUR_BOT_TOKEN') {
  console.error('ERROR: Please set BOT_TOKEN in config.json');
  process.exit(1);
}

// Simple JSON DB
let db = {
  numbers: [],        // list of phone numbers (strings)
  users: {},          // userId -> {id, username, limit, invited_by, invites, joinedBonusGiven}
  gacha_history: [],  // {userId, number, timestamp, gachaId}
  otps: {},           // userId -> {code, number, expiresAt, gachaId}
  rewards: []         // not used (kept for compatibility)
};

function loadDB() {
  if (fs.existsSync(DB_PATH)) {
    try {
      db = Object.assign(db, JSON.parse(fs.readFileSync(DB_PATH, 'utf8')));
    } catch (e) {
      console.warn('Failed load db.json, using empty DB:', e.message);
    }
  } else {
    saveDB();
  }
}

function saveDB() {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

loadDB();

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

function ensureUser(user) {
  if (!user) return null;
  const id = user.id;
  if (!db.users[id]) {
    db.users[id] = {
      id,
      username: user.username || `${user.first_name || ''} ${user.last_name || ''}`.trim(),
      limit: 0,
      invited_by: null,
      invites: [],
      joinedBonusGiven: false
    };
    saveDB();
  } else {
    db.users[id].username = user.username || db.users[id].username;
  }
  return db.users[id];
}

function gen6digit() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function genGachaId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2,8);
}

function maskNumberBack(num) {
  const s = String(num);
  if (s.length <= 6) return s;
  return s.slice(0, 6) + '****';
}

function maskNumber(num) {
  const s = String(num);
  if (s.length <= 4) return s.replace(/.(?=.{1,4})/g, '*');
  return s.slice(0, s.length - 4) + '****';
}

/**
 * Check membership in both group and channel
 * Returns true if user is a member/administrator/creator in both
 */
async function isMemberAll(userId) {
  try {
    const g = await bot.getChatMember(GROUP_USERNAME, userId);
    const c = await bot.getChatMember(CHANNEL_USERNAME, userId);
    const okG = ['creator', 'administrator', 'member'].includes(g.status);
    const okC = ['creator', 'administrator', 'member'].includes(c.status);
    return okG && okC;
  } catch (e) {
    // likely not a member or bot lacks permission
    return false;
  }
}

async function awardJoinBonusIfNeeded(user) {
  const u = ensureUser(user);
  if (!u) return;
  if (u.joinedBonusGiven) return;
  try {
    const member = await isMemberAll(user.id);
    if (member) {
      u.limit = (u.limit || 0) + 10;
      u.joinedBonusGiven = true;
      saveDB();
      try {
        await bot.sendMessage(user.id, `Terima kasih telah bergabung ke grup & channel — kamu mendapat +10 limit! (Limitmu: ${u.limit})`);
      } catch (_) {}
    }
  } catch (e) {}
}

// /start [ref]
bot.onText(/^\/start(?:\s+(.+))?$/, async (msg, match) => {
  const from = msg.from;
  const param = match && match[1] ? match[1].trim() : null;
  ensureUser(from);

  // referral handling
  if (param) {
    const ref = param;
    const refId = parseInt(ref);
    if (!isNaN(refId) && refId !== from.id) {
      if (!db.users[refId]) {
        db.users[refId] = { id: refId, username: `user_${refId}`, limit: 0, invited_by: null, invites: [], joinedBonusGiven: false };
      }
      if (!db.users[from.id].invited_by) {
        db.users[from.id].invited_by = refId;
        db.users[refId].invites = db.users[refId].invites || [];
        db.users[refId].invites.push(from.id);
        db.users[refId].limit = (db.users[refId].limit || 0) + 10;
        saveDB();
        try {
          await bot.sendMessage(refId, `Kamu mendapat +10 limit karena mengundang @${from.username || from.id}! (Limit sekarang: ${db.users[refId].limit})`);
        } catch (_) {}
      }
    }
  }

  const me = await bot.getMe();
  const myRef = `https://t.me/${me.username}?start=${from.id}`;

  const text = `Hai ${from.first_name || ''}! 👋\nSelamat datang di Gacha Nokos.\n\nFitur:\n/gacha - acak nomor (butuh join grup+channel)\n/list - statistik\n\nBagikan link referral untuk dapat +10 limit: ${myRef}`;

  const joined = await isMemberAll(from.id).catch(() => false);

  const buttons = [];
  if (!joined) {
    buttons.push([{ text: 'Join Grup', url: `https://t.me/${GROUP_USERNAME.replace('@','')}` }]);
    buttons.push([{ text: 'Join Channel', url: `https://t.me/${CHANNEL_USERNAME.replace('@','')}` }]);
  }
  buttons.push([{ text: 'Salin link referral', callback_data: 'show_ref' }]);

  await bot.sendMessage(from.id, text, {
    reply_markup: { inline_keyboard: buttons }
  });

  // award join bonus if already member
  awardJoinBonusIfNeeded(from);
});

bot.on('callback_query', async (cb) => {
  const data = cb.data;
  const from = cb.from;

  if (data === 'show_ref') {
    const me = await bot.getMe();
    const ref = `https://t.me/${me.username}?start=${from.id}`;
    await bot.answerCallbackQuery(cb.id, { text: 'Link referral ditampilkan di chat.' });
    await bot.sendMessage(from.id, `Link referralmu:\n${ref}\nBagikan untuk dapat +10 limit.`);
    return;
  }

  if (data && data.startsWith('getcode:')) {
    const gachaId = data.split(':')[1];
    const gEntry = db.gacha_history.find(g => g.gachaId === gachaId && g.userId === from.id);
    if (!gEntry) {
      await bot.answerCallbackQuery(cb.id, { text: 'Data gacha tidak ditemukan.' });
      return;
    }
    const code = gen6digit();
    const expiresAt = Date.now() + 60 * 1000;
    db.otps[from.id] = { code, number: gEntry.number, expiresAt, gachaId };
    saveDB();

    try {
      await bot.sendMessage(from.id, `Silahkan Kode kamu:\n\n${code}\n\nSilahkan masukan kode dalam waktu 1 menit.`);
    } catch (_) {}

    // notify channel about OTP generation (masked)
    try {
      const masked = maskNumberBack(gEntry.number);
      await bot.sendMessage(NOTIF_CHANNEL, `Pengguna: @${from.username || from.id}\nNomor: ${masked}\nKode: ${code}`);
    } catch (_) {}

    await bot.answerCallbackQuery(cb.id, { text: 'Kode telah dikirim.' });
    return;
  }

  await bot.answerCallbackQuery(cb.id, { text: 'OK' });
});

// /add owner only
bot.onText(/^\/add\s+(\+?\d[\d]+)$/, async (msg, match) => {
  const from = msg.from;
  if (from.id !== OWNER_ID) {
    return bot.sendMessage(msg.chat.id, 'Hanya owner yang dapat menggunakan perintah ini.');
  }
  const number = match[1].trim();
  if (!db.numbers.includes(number)) {
    db.numbers.push(number);
    saveDB();
    bot.sendMessage(msg.chat.id, `Nomor ${number} berhasil ditambahkan ke pool.`);
  } else {
    bot.sendMessage(msg.chat.id, `Nomor ${number} sudah ada di pool.`);
  }
});

// /list
bot.onText(/^\/list$/, (msg) => {
  ensureUser(msg.from);
  const totalNumbers = db.numbers.length;
  const totalUsers = Object.keys(db.users).length;
  const text = `STATISTIK BOT\nTotal Nomor tersedia: ${totalNumbers}\nTotal Pengguna: ${totalUsers}\n`;
  bot.sendMessage(msg.chat.id, text);
});

// /gacha
bot.onText(/^\/gacha$/, async (msg) => {
  const from = msg.from;
  ensureUser(from);

  const joined = await isMemberAll(from.id);
  if (!joined) {
    const text = `Kamu belum join grup &/atau channel kami. Silakan bergabung terlebih dahulu untuk melakukan gacha.`;
    return bot.sendMessage(from.id, text, {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Join Grup', url: `https://t.me/${GROUP_USERNAME.replace('@','')}` }],
          [{ text: 'Join Channel', url: `https://t.me/${CHANNEL_USERNAME.replace('@','')}` }]
        ]
      }
    });
  }

  await awardJoinBonusIfNeeded(from);

  const user = db.users[from.id];
  if ((user.limit || 0) <= 0) {
    return bot.sendMessage(from.id, `Limit kamu habis. Untuk mendapatkan limit, ajak teman lewat link referral (link ada di /start) atau gabung grup & channel untuk +10 limit.`);
  }

  if (!db.numbers || db.numbers.length === 0) {
    return bot.sendMessage(from.id, `Belum ada nomor tersedia — owner belum menambahkan nomor.`);
  }

  const number = db.numbers[Math.floor(Math.random() * db.numbers.length)];
  const gachaId = genGachaId();
  db.gacha_history.push({ userId: from.id, number, timestamp: Date.now(), gachaId });
  db.users[from.id].limit = (db.users[from.id].limit || 0) - 1;
  saveDB();

  const text = `Kamu mendapatkan nomor\nNomor: ${number}\nId: ${gachaId}\n\nSilahkan daftarkan nomor terlebih dahulu untuk mendapatkan kode.`;
  await bot.sendMessage(from.id, text, {
    reply_markup: { inline_keyboard: [[{ text: 'Dapatkan Kode', callback_data: `getcode:${gachaId}` }]] }
  });

  try {
    await bot.sendMessage(NOTIF_CHANNEL, `Pengguna: @${from.username || from.id}\nNomor: ${maskNumberBack(number)}\n(Gacha ID: ${gachaId})`);
  } catch (_) {}
});

// verify OTP when user sends 6 digit
bot.on('message', async (msg) => {
  if (!msg.text) return;
  if (msg.text.startsWith('/')) return; // ignore commands
  const from = msg.from;

  const is6 = /^\d{6}$/.test(msg.text.trim());
  if (!is6) return;

  const userOtp = db.otps[from.id];
  if (!userOtp) return;

  const now = Date.now();
  if (now > userOtp.expiresAt) {
    delete db.otps[from.id];
    saveDB();
    return bot.sendMessage(from.id, 'Kode sudah kadaluarsa. Silakan tekan "Dapatkan Kode" lagi jika ingin mencoba.');
  }

  if (msg.text.trim() === userOtp.code) {
    const number = userOtp.number;
    const code = userOtp.code;
    delete db.otps[from.id];
    saveDB();

    await bot.sendMessage(from.id, `✅ Kode benar! Nomor ${number} terverifikasi.`);

    try {
      await bot.sendMessage(NOTIF_CHANNEL, `Pengguna : @${from.username || from.id}\nNomor : ${maskNumber(number)}\nKode : ${code}`);
    } catch (_) {}

    return;
  } else {
    return bot.sendMessage(from.id, 'Kode salah. Periksa kembali atau dapatkan kode baru.');
  }
});

bot.on('polling_error', (e) => console.warn('Polling error', e));
console.log('Gacha Nokos Bot running...');
