const { PermissionFlagsBits } = require('discord.js');
const store = require('../../store');
const audit = require('./auditLogger');

async function quarantine(member, moderator, reason) {
  const settings = store.guildSettings(member.guild.id);
  const q = settings.quarantine || {};
  const entry = {
    roles: [...member.roles.cache.values()].filter((r) => r.id !== member.guild.id && r.id !== settings.quarantine.roleId).map((r) => r.id),
    nick: member.nickname || null,
    at: Date.now(),
    moderatorId: moderator.id,
    reason: reason || 'No reason provided',
  };
  await member.roles.set([], `Quarantine by ${moderator.tag}: ${entry.reason}`).catch(() => {});
  if (q.roleId) await member.roles.add(q.roleId, 'Quarantine').catch(() => {});
  if (q.channelId && member.voice?.channel) {
    const vc = member.guild.channels.cache.get(q.channelId);
    if (vc && vc.isVoiceBased()) await member.voice.setChannel(vc).catch(() => {});
  }
  store.data.jail[`${member.guild.id}:${member.id}`] = entry;
  store.save();
  audit.emit(member.guild, 'quarantine', '🧪 Quarantined', `**${member.user.tag}** was quarantined by **${moderator.tag}**.\nReason: ${entry.reason}`, 0xfee75c);
  store.pushAlert(member.guild.id, {
    type: 'quarantine', level: 'warning', title: 'Quarantined',
    message: `${member.user.tag} was quarantined (all roles removed)`,
    userId: member.id,
  });
  return entry;
}

async function unquarantine(member, moderator) {
  const key = `${member.guild.id}:${member.id}`;
  const entry = store.data.jail[key];
  if (!entry) return null;
  const settings = store.guildSettings(member.guild.id);
  await member.roles.remove(member.roles.cache.filter((r) => r.id !== member.guild.id), 'Unquarantine').catch(() => {});
  for (const id of entry.roles || []) {
    const role = member.guild.roles.cache.get(id);
    if (role) await member.roles.add(role, 'Unquarantine').catch(() => {});
  }
  if (entry.nick) await member.setNickname(entry.nick, 'Unquarantine').catch(() => {});
  delete store.data.jail[key];
  store.save();
  audit.emit(member.guild, 'unquarantine', '✅ Unquarantined', `**${member.user.tag}** was released by **${moderator.tag}** — roles restored.`, 0x57f287);
  return entry;
}

function isQuarantined(guildId, userId) {
  return !!store.data.jail[`${guildId}:${userId}`];
}

function quarantineChannel(settings) {
  return settings.quarantine && settings.quarantine.channelId;
}

module.exports = { quarantine, unquarantine, isQuarantined, quarantineChannel };
