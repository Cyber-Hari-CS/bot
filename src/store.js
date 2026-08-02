const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const config = require('./config');

const emitter = new EventEmitter();
let data = null;
let saveTimer = null;

function ensureFile(file) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, '{}', 'utf8');
}

function load() {
  ensureFile(config.dataFile);
  try {
    data = JSON.parse(fs.readFileSync(config.dataFile, 'utf8'));
  } catch {
    data = {};
  }
  data.settings = data.settings || {};
  data.events = data.events || [];
  data.warnings = data.warnings || {};
  data.alerts = data.alerts || [];
  data.verified = data.verified || {};
  data.users = data.users || {};
  data.jail = data.jail || {};
  data.guilds = data.guilds || {};
  data.ghostPings = data.ghostPings || [];
  data.secureMode = data.secureMode || {};
  data.jail = data.jail || {};
  data.economy = data.economy || {};
  data.giveaways = data.giveaways || {};
  data.levels = data.levels || {};
  data.customCommands = data.customCommands || {};
  data.tickets = data.tickets || {};
  data.transcripts = data.transcripts || [];
  return data;
}

function save() {
  if (!data) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    ensureFile(config.dataFile);
    fs.writeFileSync(config.dataFile, JSON.stringify(data, null, 2), 'utf8');
  }, 150);
}

function deepMerge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function guildSettings(guildId) {
  const stored = data.guilds[guildId];
  const merged = deepMerge(JSON.parse(JSON.stringify(config.defaults)), stored || {});
  data.guilds[guildId] = merged;
  return merged;
}

function pushEvent(guildId, event) {
  data.events.push({ id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, guildId, at: Date.now(), ...event });
  if (data.events.length > 2000) data.events = data.events.slice(-2000);
  save();
  emitter.emit('event', data.events[data.events.length - 1]);
}

function pushGhostPing(entry) {
  data.ghostPings.push({ id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, at: Date.now(), ...entry });
  if (data.ghostPings.length > 200) data.ghostPings = data.ghostPings.slice(-200);
  save();
  return data.ghostPings[data.ghostPings.length - 1];
}

function pushAlert(guildId, alert) {
  const entry = { id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, guildId, at: Date.now(), ...alert };
  data.alerts.push(entry);
  if (data.alerts.length > 500) data.alerts = data.alerts.slice(-500);
  save();
  emitter.emit('alert', entry);
  return entry;
}

function addWarning(guildId, userId, moderatorId, reason, action) {
  const key = `${guildId}:${userId}`;
  data.warnings[key] = data.warnings[key] || [];
  const warn = { id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, at: Date.now(), moderatorId, reason, action };
  data.warnings[key].push(warn);
  if (data.warnings[key].length > 100) data.warnings[key] = data.warnings[key].slice(-100);
  save();
  return warn;
}

function getWarnings(guildId, userId) {
  return data.warnings[`${guildId}:${userId}`] || [];
}

function clearWarnings(guildId, userId) {
  delete data.warnings[`${guildId}:${userId}`];
  save();
}

function trackUser(guildId, userId, username) {
  const key = `${guildId}:${userId}`;
  data.users[key] = data.users[key] || { userId, guildId, username, messages: 0, joins: 0, firstSeen: Date.now(), lastSeen: Date.now(), flags: 0 };
  data.users[key].username = username;
  data.users[key].lastSeen = Date.now();
  return data.users[key];
}

function touchUserMessages(guildId, userId, username) {
  const u = trackUser(guildId, userId, username);
  u.messages++;
  save();
  return u;
}

function joinUser(guildId, userId, username) {
  const u = trackUser(guildId, userId, username);
  u.joins++;
  save();
  return u;
}

function getUsers(guildId) {
  return Object.values(data.users).filter((u) => u.guildId === guildId);
}

function getLevel(guildId, userId) {
  const key = `${guildId}:${userId}`;
  data.levels[key] = data.levels[key] || { userId, guildId, xp: 0, messages: 0 };
  return data.levels[key];
}

function addXp(guildId, userId, amount) {
  const lv = getLevel(guildId, userId);
  lv.xp += amount;
  lv.messages++;
  save();
  return lv;
}

function getBalance(guildId, userId) {
  const key = `${guildId}:${userId}`;
  data.economy[key] = data.economy[key] || { userId, guildId, balance: 0, earned: 0, lastDaily: 0 };
  return data.economy[key];
}

function initBalance(guildId, userId, amount) {
  const acc = getBalance(guildId, userId);
  if (acc.balance === 0) acc.balance = amount;
  save();
  return acc;
}

function addMoney(guildId, userId, amount) {
  const acc = getBalance(guildId, userId);
  acc.balance += amount;
  if (amount > 0) acc.earned += amount;
  save();
  return acc;
}

function getTopBalances(guildId, limit = 10) {
  return Object.values(data.economy)
    .filter((a) => a.guildId === guildId)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, limit);
}

function getTopLevels(guildId, limit = 10) {
  return Object.values(data.levels)
    .filter((l) => l.guildId === guildId)
    .sort((a, b) => b.xp - a.xp)
    .slice(0, limit);
}

function saveTranscript(entry) {
  data.transcripts.push({ id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, at: Date.now(), ...entry });
  if (data.transcripts.length > 200) data.transcripts = data.transcripts.slice(-200);
  save();
  return data.transcripts[data.transcripts.length - 1];
}

module.exports = {
  load, save, guildSettings, pushEvent, pushAlert, pushGhostPing,
  addWarning, getWarnings, clearWarnings,
  trackUser, touchUserMessages, joinUser, getUsers,
  getLevel, addXp, getTopLevels,
  getBalance, initBalance, addMoney, getTopBalances,
  saveTranscript,
  emitter,
};
Object.defineProperty(module.exports, 'data', { get: () => data, enumerable: true });
