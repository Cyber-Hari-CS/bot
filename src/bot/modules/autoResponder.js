const store = require('../../store');

function normalize(text) {
  return String(text || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function matchRule(content, rule) {
  const msg = normalize(content);
  const trigger = normalize(rule.trigger);
  if (!trigger) return false;
  if (rule.exact) return msg === trigger;
  return msg.includes(trigger) || new RegExp(`\\b${trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(content);
}

function fillVars(text, message) {
  return String(text || '')
    .replace(/{user}/g, message.author.username)
    .replace(/{tag}/g, message.author.tag)
    .replace(/{mention}/g, `<@${message.author.id}>`)
    .replace(/{guild}/g, message.guild.name)
    .replace(/{channel}/g, `<#${message.channel.id}>`)
    .replace(/{content}/g, message.content.slice(0, 100));
}

function handleMessage(message) {
  if (message.author.bot) return false;
  const settings = store.guildSettings(message.guildId);

  const cc = store.data.customCommands[message.guildId] || {};
  if (cc[message.content.toLowerCase()]) {
    message.channel.send(fillVars(cc[message.content.toLowerCase()], message)).catch(() => {});
    return true;
  }

  const ar = settings.autoResponder;
  if (!ar || !ar.enabled || !ar.rules || !ar.rules.length) return false;
  for (const rule of ar.rules) {
    if (!rule.enabled && rule.enabled !== undefined && rule.enabled === false) continue;
    if (matchRule(message.content, rule)) {
      message.channel.send(fillVars(rule.response, message)).catch(() => {});
      return true;
    }
  }
  return false;
}

function listCustomCommands(guildId) {
  const cc = store.data.customCommands[guildId] || {};
  return Object.entries(cc);
}

function addCustomCommand(guildId, name, response) {
  store.data.customCommands[guildId] = store.data.customCommands[guildId] || {};
  store.data.customCommands[guildId][name.toLowerCase()] = response;
  store.save();
}

function removeCustomCommand(guildId, name) {
  const cc = store.data.customCommands[guildId] || {};
  const hit = Object.keys(cc).find((k) => k === name.toLowerCase());
  if (!hit) return false;
  delete cc[hit];
  store.save();
  return true;
}

module.exports = { handleMessage, listCustomCommands, addCustomCommand, removeCustomCommand };
