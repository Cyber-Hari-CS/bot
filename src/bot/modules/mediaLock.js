const { PermissionFlagsBits } = require('discord.js');
const store = require('../../store');
const perms = require('./perms');

function isMediaChannel(channelId, settings) {
  return (settings.mediaChannels || []).includes(channelId);
}

async function checkMessage(message, settings) {
  if (message.author.bot) return;
  if (!isMediaChannel(message.channel.id, settings)) return;
  if (perms.isModerator(message.member, settings)) return;
  const prefix = settings.prefix || '?';
  if (message.content.startsWith(prefix)) return;
  const hasAttachment = message.attachments.size > 0 ||
    (message.embeds && message.embeds.some((e) => e.image || e.thumbnail || e.video)) ||
    (message.content && /https?:\/\//.test(message.content) && message.content.match(/\.(png|jpe?g|gif|webp|mp4|webm|mov|mp3|wav|ogg|zip|pdf|txt)(\?.*)?/i));
  if (hasAttachment) return;
  if (message.content && /^\s*(<a?:\w+:\d+>|\p{Emoji})+\s*$/u.test(message.content)) return;
  if (!message.content.trim()) return;
  await message.delete().catch(() => {});
  message.channel.send(`❌ <@${message.author.id}>, this is a **media-only** channel — images/videos only.`).catch(() => {});
  return true;
}

module.exports = { isMediaChannel, checkMessage };
