const { PermissionFlagsBits, ChannelType } = require('discord.js');
const store = require('../../store');
const antiRaid = require('./antiRaid');

const channelCache = new Map();
const roleCache = new Map();

function snapshotChannel(channel) {
  if (channel.type >= ChannelType.PublicThread) return null;
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    position: channel.position,
    parentId: channel.parentId,
    topic: channel.topic,
    nsfw: channel.nsfw,
    slowmode: channel.rateLimitPerUser || 0,
    bitrate: channel.bitrate || 64000,
    userLimit: channel.userLimit || 0,
    overwrites: channel.permissionOverwrites.cache.map((o) => ({
      id: o.id,
      type: o.type,
      allow: o.allow.bitfield,
      deny: o.deny.bitfield,
    })),
  };
}

function snapshotRole(role) {
  return {
    id: role.id,
    name: role.name,
    color: role.color,
    hoist: role.hoist,
    mentionable: role.mentionable,
    position: role.position,
    permissions: role.permissions.bitfield,
  };
}

function cacheGuildChannels(guild) {
  if (!channelCache.has(guild.id)) channelCache.set(guild.id, new Map());
  const map = channelCache.get(guild.id);
  guild.channels.cache.forEach((c) => {
    const snap = snapshotChannel(c);
    if (snap) map.set(c.id, snap);
  });
}

function cacheGuildRoles(guild) {
  if (!roleCache.has(guild.id)) roleCache.set(guild.id, new Map());
  const map = roleCache.get(guild.id);
  guild.roles.cache.forEach((r) => map.set(r.id, snapshotRole(r)));
}

function cacheGuild(guild) {
  cacheGuildChannels(guild);
  cacheGuildRoles(guild);
}

function updateChannel(channel) {
  if (!channelCache.has(channel.guildId)) channelCache.set(channel.guildId, new Map());
  const snap = snapshotChannel(channel);
  if (snap) channelCache.get(channel.guildId).set(channel.id, snap);
}

function updateRole(role) {
  if (!roleCache.has(role.guild.id)) roleCache.set(role.guild.id, new Map());
  roleCache.get(role.guild.id).set(role.id, snapshotRole(role));
}

function isProtectedRole(role, settings) {
  const list = settings.antiNuke.protectedRoles || [];
  if (list.includes(role.id)) return true;
  if (settings.antiNuke.autoProtectRoles && role.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return false;
}

async function restoreChannel(guild, channelId) {
  const map = channelCache.get(guild.id);
  const snap = map && map.get(channelId);
  if (!snap) return false;
  try {
    await guild.channels.create({
      name: snap.name,
      type: snap.type,
      topic: snap.topic,
      nsfw: snap.nsfw,
      rateLimitPerUser: snap.slowmode,
      bitrate: snap.bitrate,
      userLimit: snap.userLimit,
      parent: snap.parentId || undefined,
      permissionOverwrites: snap.overwrites.map((o) => ({
        id: o.id,
        type: o.type,
        allow: String(o.allow),
        deny: String(o.deny),
      })),
      reason: 'Anti-nuke: channel restored',
    }).then(async (created) => {
      try { await created.setPosition(snap.position); } catch {}
    });
    map.delete(channelId);
    return true;
  } catch (e) {
    console.error('[RESTORE] Failed to restore channel:', e.message);
    return false;
  }
}

async function restoreRole(guild, roleId) {
  const map = roleCache.get(guild.id);
  const snap = map && map.get(roleId);
  if (!snap) return false;
  try {
    const created = await guild.roles.create({
      name: snap.name,
      color: snap.color,
      hoist: snap.hoist,
      mentionable: snap.mentionable,
      permissions: snap.permissions,
      reason: 'Anti-nuke: role restored',
    });
    try { await created.setPosition(snap.position); } catch {}
    map.delete(roleId);
    return true;
  } catch (e) {
    console.error('[RESTORE] Failed to restore role:', e.message);
    return false;
  }
}

function shouldRestore(guildId) {
  return antiRaid.isActive(guildId);
}

module.exports = { cacheGuild, cacheGuildChannels, cacheGuildRoles, updateChannel, updateRole, isProtectedRole, restoreChannel, restoreRole, shouldRestore };
