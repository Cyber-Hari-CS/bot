const { PermissionFlagsBits } = require('discord.js');
const store = require('../../store');

function extraOwners(settings) {
  return settings.extraOwners || [];
}

function isExtraOwner(member, settings) {
  if (!member) return false;
  return (settings.extraOwners || []).includes(member.id);
}

function isOwner(member, settings) {
  return !!member && (member.id === member.guild.ownerId || isExtraOwner(member, settings));
}

function isAdmin(member, settings) {
  return isOwner(member, settings) || (!!member && member.permissions.has(PermissionFlagsBits.Administrator));
}

function isModerator(member, settings) {
  return isAdmin(member, settings) || (!!member && (
    member.permissions.has(PermissionFlagsBits.ManageMessages) ||
    member.permissions.has(PermissionFlagsBits.KickMembers) ||
    member.permissions.has(PermissionFlagsBits.BanMembers)
  ));
}

function isTrusted(member, settings) {
  if (isModerator(member, settings)) return true;
  const a = settings.access || { users: [], roles: [] };
  if ((a.users || []).includes(member.id)) return true;
  return (a.roles || []).some((r) => member.roles.cache.has(r));
}

function checkRoleAuth(commandName, interaction, settings) {
  const auth = settings.roleAuth;
  if (!auth || !auth.enabled || !auth.rules || !auth.rules.length) return { ok: true };
  const rule = auth.rules.find((r) => r.command === commandName);
  if (!rule || !rule.roles || !rule.roles.length) return { ok: true };
  const member = interaction.member;
  if (!member) return { ok: true };
  if (isOwner(member, settings)) return { ok: true };
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return { ok: true };
  if (rule.roles.some((id) => member.roles.cache.has(id))) return { ok: true };
  return { ok: false, roles: rule.roles };
}

module.exports = { extraOwners, isExtraOwner, isOwner, isAdmin, isModerator, isTrusted, checkRoleAuth };
