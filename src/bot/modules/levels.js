const store = require('../../store');
const audit = require('./auditLogger');

const cooldowns = new Map();

function xpForLevel(level) {
  return Math.floor(100 * Math.pow(level, 1.5));
}

function levelFromXp(xp) {
  let level = 0;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

async function onMessage(message, settings) {
  if (message.author.bot) return;
  const key = `${message.guildId}:${message.author.id}`;
  const now = Date.now();
  const last = cooldowns.get(key) || 0;
  if (now - last < 30000) return;
  cooldowns.set(key, now);

  const before = levelFromXp(store.getLevel(message.guildId, message.author.id).xp);
  const lv = store.addXp(message.guildId, message.author.id, Math.floor(15 + Math.random() * 10));
  const after = levelFromXp(lv.xp);

  if (after > before) {
    const member = message.member;
    const roles = settings.activityRoles || [];
    for (const r of roles) {
      const need = Number(r.messages) || 0;
      if (need > 0 && lv.messages >= need && member && r.roleId && !member.roles.cache.has(r.roleId)) {
        const role = message.guild.roles.cache.get(r.roleId);
        if (role) {
          await member.roles.add(role, `Activity role: ${lv.messages} messages`).catch(() => {});
        }
      }
    }
    audit.emit(message.guild, 'level_up', '⬆️ Level Up', `**${message.author.tag}** reached level **${after}**!`, 0x5865f2);
  }
}

function checkActivityRoles(member, settings) {
  const lv = store.getLevel(member.guild.id, member.id);
  const roles = settings.activityRoles || [];
  const granted = [];
  for (const r of roles) {
    const need = Number(r.messages) || 0;
    if (need > 0 && lv.messages >= need && r.roleId && !member.roles.cache.has(r.roleId)) {
      const role = member.guild.roles.cache.get(r.roleId);
      if (role) {
        member.roles.add(role, 'Activity role').then(() => granted.push(role.name)).catch(() => {});
      }
    }
  }
  return granted;
}

module.exports = { onMessage, checkActivityRoles, levelFromXp, xpForLevel };
