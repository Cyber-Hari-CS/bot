const { ChannelType } = require('discord.js');
const store = require('../../store');

function accountAgeDays(user) {
  return (Date.now() - user.createdTimestamp) / 86400000;
}

function joinedDaysAgo(member) {
  return (Date.now() - member.joinedTimestamp) / 86400000;
}

function riskScore(member, settings) {
  let score = 0;
  const age = accountAgeDays(member.user);
  if (age < 1) score += 45;
  else if (age < 7) score += 35;
  else if (age < 30) score += 20;
  else if (age < 90) score += 8;

  const joined = joinedDaysAgo(member);
  if (joined < 1) score += 15;
  else if (joined < 7) score += 8;

  score += store.getWarnings(member.guild.id, member.id).length * 5;

  if (settings.verification.enabled && !store.data.verified[`${member.guild.id}:${member.id}`]) score += 15;
  if (member.communicationDisabledUntil) score += 10;

  return Math.min(100, score);
}

function riskLevel(score) {
  if (score >= 75) return ['CRITICAL', '🚨'];
  if (score >= 50) return ['HIGH', '⚠️'];
  if (score >= 25) return ['MEDIUM', '🟡'];
  return ['LOW', '🟢'];
}

async function scan(guild) {
  const settings = store.guildSettings(guild.id);
  const flags = [];
  await guild.members.fetch().catch(() => {});
  await guild.roles.fetch().catch(() => {});
  const members = [...guild.members.cache.values()];

  const admins = members.filter((m) => !m.user.bot && m.permissions.has('Administrator'));
  const botAdmins = members.filter((m) => m.user.bot && m.permissions.has('Administrator'));
  const newAccounts = members.filter((m) => accountAgeDays(m.user) < 7 && !m.user.bot);
  const unverified = settings.verification.enabled
    ? members.filter((m) => !m.user.bot && !store.data.verified[`${guild.id}:${m.id}`] && !m.permissions.has('Administrator'))
    : [];

  if (admins.length > 5) flags.push(`⚠️ **${admins.length}** members hold Administrator — verify these are all trusted`);
  botAdmins.forEach((b) => flags.push(`🚨 Bot **${b.user.tag}** (${b.id}) has Administrator — potential backdoor`));
  if (newAccounts.length > 3) flags.push(`⚠️ **${newAccounts.length}** members have accounts younger than 7 days`);
  unverified.slice(0, 5).forEach((m) => flags.push(`🟡 **${m.user.tag}** is unverified (joined <t:${Math.floor(m.joinedTimestamp / 1000)}:R>)`));

  let webhooks = [];
  try { webhooks = [...(await guild.fetchWebhooks()).values()]; } catch {}
  const suspiciousWebhooks = webhooks.filter((w) => !w.owner || (w.owner && w.owner.bot) || /^(spam|nitro|giveaway|free|hack)/i.test(w.name || ''));
  suspiciousWebhooks.slice(0, 3).forEach((w) => flags.push(`🚨 Webhook **${w.name}** in #${w.channel ? w.channel.name : '?'} — ${w.owner ? 'owner: ' + w.owner.tag : 'no owner found'}`));

  if (!settings.antiNuke.enabled) flags.push('🟡 Anti-nuke protection is disabled');
  if (!settings.antiRaid.enabled) flags.push('🟡 Anti-raid protection is disabled');
  if (!settings.antiSpam.enabled) flags.push('🟡 Anti-spam is disabled');
  if (!settings.verification.enabled) flags.push('🟡 Member verification is disabled');
  if (!settings.audit.channelId) flags.push('🟡 No audit log channel is set');

  if (flags.length === 0) flags.push('🟢 All checks passed — server looks clean');

  const score = Math.min(100, flags.filter((f) => !f.startsWith('🟢')).length * 12 + (botAdmins.length ? 25 : 0));
  return { flags, score: riskLevel(score), admins: admins.length, botAdmins: botAdmins.length, webhooks: webhooks.length };
}

async function backup(guild) {
  await guild.roles.fetch().catch(() => {});
  await guild.channels.fetch().catch(() => {});
  const roles = [...guild.roles.cache.values()]
    .filter((r) => r.id !== guild.id)
    .map((r) => ({ name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions: r.permissions.bitfield, position: r.position }));
  const channels = [...guild.channels.cache.values()]
    .filter((c) => c.type < ChannelType.PublicThread)
    .map((c) => ({
      name: c.name, type: c.type, position: c.position, parentId: c.parentId, topic: c.topic,
      nsfw: c.nsfw, slowmode: c.rateLimitPerUser || 0, bitrate: c.bitrate || 64000, userLimit: c.userLimit || 0,
      overwrites: c.permissionOverwrites.cache.map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield })),
    }));
  return { exportedAt: new Date().toISOString(), guildName: guild.name, guildId: guild.id, roles, channels };
}

module.exports = { accountAgeDays, riskScore, riskLevel, scan, backup };
