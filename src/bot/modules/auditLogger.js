const store = require('../../store');

const auditChannels = new Map();

function getChannel(guild) {
  if (auditChannels.has(guild.id)) return auditChannels.get(guild.id);
  const settings = store.guildSettings(guild.id);
  const channel = settings.audit.channelId ? guild.channels.cache.get(settings.audit.channelId) : null;
  auditChannels.set(guild.id, channel);
  return channel;
}

function invalidate(guildId) {
  auditChannels.delete(guildId);
}

function emit(guild, type, title, description, color = 0x2f3136) {
  store.pushEvent(guild.id, { type, title, description, color });
  const channel = getChannel(guild);
  if (channel && channel.isTextBased() && channel.permissionsFor(guild.client.user)?.has('SendMessages')) {
    channel.send({
      embeds: [{
        color,
        title: `🛡️ ${title}`,
        description,
        footer: { text: guild.name, iconURL: guild.iconURL() },
        timestamp: new Date().toISOString(),
      }],
    }).catch(() => {});
  }
}

function memberJoin(guild, member) {
  emit(guild, 'member_join', 'Member Joined', `**${member.user.tag}** (${member.id}) joined the server.`, 0x57f287);
}

function memberLeave(guild, member) {
  emit(guild, 'member_leave', 'Member Left', `**${member.user.tag}** (${member.id}) left the server.`, 0xed4245);
}

function memberBanned(guild, user, reason) {
  emit(guild, 'member_ban', 'Member Banned', `**${user.tag}** (${user.id}) was banned. ${reason ? `\nReason: ${reason}` : ''}`, 0xed4245);
}

function memberUnbanned(guild, user) {
  emit(guild, 'member_unban', 'Member Unbanned', `**${user.tag}** (${user.id}) was unbanned.`, 0x57f287);
}

function messageDeleted(guild, message) {
  emit(guild, 'message_delete', 'Message Deleted', `**${message.author?.tag || 'Unknown'}** in <#${message.channel.id}>\n\`\`\`${message.content || 'No content'}\`\`\``, 0xed4245);
}

function messageEdited(guild, oldMsg, newMsg) {
  emit(guild, 'message_edit', 'Message Edited', `**${oldMsg.author?.tag || 'Unknown'}** in <#${oldMsg.channel.id}>\n**Before:**\`\`\`${oldMsg.content || ''}\`\`\`\n**After:**\`\`\`${newMsg.content || ''}\`\`\``, 0xfee75c);
}

function modAction(guild, type, user, moderator, reason, duration) {
  const map = {
    kick: ['Member Kicked', '👢'],
    ban: ['Member Banned', '🔨'],
    timeout: ['Member Timed Out', '⏰'],
    unban: ['Member Unbanned', '🔓'],
    warn: ['Member Warned', '⚠️'],
    untimeout: ['Timeout Removed', '🔔'],
    purge: ['Messages Purged', '🧹'],
  };
  const [title, icon] = map[type] || [type, '🛡️'];
  const durationText = duration ? ` for **${duration}**` : '';
  emit(guild, `mod_${type}`, `${icon} ${title}`, `**${user}**${durationText} — moderator **${moderator}**${reason ? `\nReason: ${reason}` : ''}`, 0x5865f2);
}

function verify(guild, user, method) {
  emit(guild, 'member_verify', 'Member Verified', `**${user.tag}** (${user.id}) verified via **${method}**.`, 0x57f287);
}

function channelCreated(guild, channel) {
  emit(guild, 'channel_create', 'Channel Created', `**#${channel.name}** (${channel.type}) was created by ${channel.creator ? channel.creator.tag : 'unknown'}.`, 0x57f287);
}

function channelDeleted(guild, channel) {
  emit(guild, 'channel_delete', 'Channel Deleted', `**#${channel.name}** was deleted.`, 0xed4245);
}

module.exports = { emit, getChannel, invalidate, memberJoin, memberLeave, memberBanned, memberUnbanned, messageDeleted, messageEdited, modAction, verify, channelCreated, channelDeleted };
