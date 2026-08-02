const { PermissionFlagsBits } = require('discord.js');

function isOwner(member, settings) {
  if (!member) return false;
  if (member.id === member.guild.ownerId) return true;
  if (settings && Array.isArray(settings.extraOwners) && settings.extraOwners.includes(member.id)) return true;
  return false;
}

function isTrusted(member, settings) {
  if (!member) return false;
  if (isOwner(member, settings)) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const a = settings.access || { users: [], roles: [] };
  if ((a.users || []).includes(member.id)) return true;
  return (a.roles || []).some((r) => member.roles.cache.has(r));
}

function isModerator(member, settings) {
  if (!member) return false;
  if (isOwner(member, settings)) return true;
  return member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageMessages) ||
    member.permissions.has(PermissionFlagsBits.KickMembers) ||
    member.permissions.has(PermissionFlagsBits.BanMembers);
}

module.exports = { isTrusted, isModerator, isOwner };
