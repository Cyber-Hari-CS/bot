const store = require('../../store');

const WORK_MESSAGES = [
  'swept the floors', 'moderated the chat', 'fixed a bug in the bot', 'ran a security scan',
  'cleaned the server logs', 'helped a new member', 'organized the channels', 'counted the members',
  'wrote a report', 'answered a ticket', 'patrolled the voice channels', 'updated the rules',
];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function ensure(guildId, userId, settings) {
  return store.initBalance(guildId, userId, settings.economy.startBalance);
}

function balance(guildId, userId) {
  return store.getBalance(guildId, userId);
}

function daily(guildId, userId, settings) {
  const acc = ensure(guildId, userId, settings);
  const now = Date.now();
  const dayMs = 86400000;
  const last = acc.lastDaily || 0;
  if (now - last < dayMs) {
    const next = new Date(last + dayMs);
    return { ok: false, nextAt: last + dayMs, left: `${Math.floor((last + dayMs - now) / 3600000)}h ${Math.ceil(((last + dayMs - now) % 3600000) / 60000)}m` };
  }
  acc.lastDaily = now;
  store.addMoney(guildId, userId, settings.economy.daily);
  return { ok: true, amount: settings.economy.daily, nextAt: now + dayMs };
}

function work(guildId, userId, settings) {
  const acc = ensure(guildId, userId, settings);
  const cooldown = 60 * 60 * 1000;
  const last = acc.lastWork || 0;
  if (Date.now() - last < cooldown) {
    return { ok: false, nextAt: last + cooldown, left: `${Math.ceil((last + cooldown - Date.now()) / 60000)}m` };
  }
  const amount = randomInt(settings.economy.workMin, settings.economy.workMax);
  acc.lastWork = Date.now();
  store.addMoney(guildId, userId, amount);
  const msg = WORK_MESSAGES[randomInt(0, WORK_MESSAGES.length - 1)];
  return { ok: true, amount, msg, nextAt: Date.now() + cooldown };
}

function pay(guildId, fromId, toId, amount) {
  if (amount <= 0) return { ok: false, error: 'Amount must be positive.' };
  const from = store.getBalance(guildId, fromId);
  if (from.balance < amount) return { ok: false, error: `You only have ${from.balance.toLocaleString()} coins.` };
  store.addMoney(guildId, fromId, -amount);
  store.addMoney(guildId, toId, amount);
  return { ok: true };
}

function gamble(guildId, userId, amount) {
  if (amount <= 0) return { ok: false, error: 'Amount must be positive.' };
  const acc = store.getBalance(guildId, userId);
  if (acc.balance < amount) return { ok: false, error: `You only have ${acc.balance.toLocaleString()} coins.` };
  const win = Math.random() < 0.5;
  if (win) {
    store.addMoney(guildId, userId, amount);
    return { ok: true, win: true, amount, newBalance: acc.balance + amount };
  }
  store.addMoney(guildId, userId, -amount);
  return { ok: true, win: false, amount, newBalance: acc.balance - amount };
}

function top(guildId) {
  return store.getTopBalances(guildId, 10);
}

module.exports = { ensure, balance, daily, work, pay, gamble, top };
