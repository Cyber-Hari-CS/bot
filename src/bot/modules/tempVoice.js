const { ChannelType, PermissionFlagsBits } = require('discord.js');
const store = require('../../store');

const active = new Map();

function sanitize(name) {
  return name.replace(/[^a-zA-Z0-9_\-\u00C0-\uFFFF ]/g, '').slice(0, 28) || 'voice';
}

async function onVoiceStateUpdate(oldState, newState) {
  const settings = store.guildSettings(newState.guild ? newState.guild.id : oldState.guild.id);
  const tv = settings.tempVoice;
  if (!tv || !tv.enabled) return;

  const guild = newState.guild || oldState.guild;
  if (!guild) return;

  const trigger = guild.channels.cache.get(tv.channelId);

  if (newState.channelId === tv.channelId && newState.member && !newState.member.user.bot) {
    if (!active.has(newState.member.id)) {
      active.set(newState.member.id, true);
      try {
        const name = sanitize(`🔊 ${newState.member.displayName}`);
        const ch = await guild.channels.create({
          name,
          type: ChannelType.GuildVoice,
          parent: tv.categoryId || undefined,
          userLimit: 0,
          permissionOverwrites: [
            { id: guild.id, allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.ViewChannel] },
            { id: newState.member.id, allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers] },
            { id: guild.client.user.id, allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels] },
          ],
          reason: 'Temporary voice channel',
        });
        if (tv.lockOnClaim && trigger) {
          await trigger.permissionOverwrites.create(newState.member.id, { Connect: true }, 'Temp voice claim').catch(() => {});
        }
        await newState.member.voice.setChannel(ch).catch(() => {});
        active.delete(newState.member.id);
      } catch {}
    }
  }

  if (oldState.channel && oldState.channelId !== tv.channelId) {
    const isTemp = oldState.channel.name.startsWith('🔊') &&
      oldState.channel.id !== tv.channelId &&
      oldState.channel.type === ChannelType.GuildVoice;
    if (isTemp) {
      const remaining = oldState.channel.members.size - (oldState.member && oldState.member.id ? 1 : 0);
      if (remaining <= 0) {
        setTimeout(() => {
          const ch = guild.channels.cache.get(oldState.channelId);
          if (ch && ch.members.size === 0) ch.delete('Temp voice empty').catch(() => {});
        }, 5000);
      }
    }
  }
}

module.exports = { onVoiceStateUpdate, active };
