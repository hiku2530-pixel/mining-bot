const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('ERROR: BOT_TOKEN is not set!');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const PORT = process.env.PORT || 3000;

const users = {};
const MAX_USERS = 20;
const MINING_DURATION = 2 * 60 * 60 * 1000;
const MINING_REWARD = 200;
const LT_TO_USD = 0.10;
const LISTING_END = Date.now() + 7 * 24 * 60 * 60 * 1000;

function getUser(id, username) {
  if (!users[id]) {
    users[id] = {
      id,
      username: username || 'Miner',
      balance: 0,
      miningStartedAt: null,
      lastClaim: null,
    };
  }
  return users[id];
}

function verifyInitData(initData) {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
    const calculatedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (calculatedHash !== hash) return null;
    const userStr = params.get('user');
    if (!userStr) return null;
    return JSON.parse(userStr);
  } catch (e) {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const initData = req.headers['x-telegram-init-data'] || req.body.initData;
  if (!initData) return res.status(401).json({ error: 'No initData' });
  const tgUser = verifyInitData(initData);
  if (!tgUser) return res.status(401).json({ error: 'Invalid initData' });
  req.tgUser = tgUser;
  next();
}

app.get('/api/user', authMiddleware, (req, res) => {
  const tgUser = req.tgUser;
  const existing = users[tgUser.id];
  if (!existing && Object.keys(users).length >= MAX_USERS) {
    return res.status(403).json({ error: 'User limit reached (20 users max)' });
  }
  const user = getUser(tgUser.id, tgUser.username || tgUser.first_name);
  res.json({
    user: { id: user.id, username: user.username },
    balance: user.balance,
    balanceUsd: (user.balance * LT_TO_USD).toFixed(2),
    miningStartedAt: user.miningStartedAt,
    miningDuration: MINING_DURATION,
    miningReward: MINING_REWARD,
    listingEnd: LISTING_END,
    totalUsers: Object.keys(users).length,
    maxUsers: MAX_USERS,
  });
});

app.post('/api/mining/start', authMiddleware, (req, res) => {
  const user = getUser(req.tgUser.id, req.tgUser.username);
  if (user.miningStartedAt) {
    return res.status(400).json({ error: 'Mining already in progress' });
  }
  user.miningStartedAt = Date.now();
  res.json({ success: true, miningStartedAt: user.miningStartedAt });
});

app.post('/api/mining/claim', authMiddleware, (req, res) => {
  const user = getUser(req.tgUser.id, req.tgUser.username);
  if (!user.miningStartedAt) {
    return res.status(400).json({ error: 'No mining in progress' });
  }
  const elapsed = Date.now() - user.miningStartedAt;
  if (elapsed < MINING_DURATION) {
    return res.status(400).json({ error: 'Mining not finished yet' });
  }
  user.balance += MINING_REWARD;
  user.miningStartedAt = null;
  user.lastClaim = Date.now();
  res.json({ success: true, balance: user.balance, balanceUsd: (user.balance * LT_TO_USD).toFixed(2) });
});

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const existing = users[userId];
  if (!existing && Object.keys(users).length >= MAX_USERS) {
    bot.sendMessage(chatId, '⚠️ User limit reached (20 users max).');
    return;
  }
  const user = getUser(userId, msg.from.username || msg.from.first_name);
  bot.sendMessage(chatId, `Welcome, ${user.username}!\n\nBalance: ${user.balance} LT ($${(user.balance * LT_TO_USD).toFixed(2)})`, {
    reply_markup: {
      inline_keyboard: [[
        { text: 'Open Wallet', web_app: { url: process.env.WEBAPP_URL || 'https://example.com' } }
      ]]
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Bot started`);
});
