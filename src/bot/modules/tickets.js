const { ChannelType, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const store = require('../../store');
const audit = require('./auditLogger');

const TICKET_PREFIX = 'ticket-';

async function setupPanel(guild, channel, settings) {
  settings.tickets.enabled = true;
  settings.tickets.panelChannelId = channel.id;
  store.save();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_open').setLabel('🎫 Open a Ticket').setStyle(ButtonStyle.Primary),
  );
  const embed = new EmbedBuilder()
    .setTitle('🎫 Support Tickets')
    .setDescription('Click the button below to open a ticket with staff.\nPlease describe your issue and wait for a staff member.')
    .setColor(0x5865f2);
  await channel.send({ embeds: [embed], components: [row] }).catch(() => {});
  audit.emit(guild, 'ticket_setup', '🎫 Ticket Panel', `Ticket panel posted in <#${channel.id}> by setup.`, 0x57f287);
}

async function createTicket(interaction) {
  const settings = store.guildSettings(interaction.guildId);
  const t = settings.tickets;
  if (!t.enabled) {
    return interaction.reply({ content: '❌ Ticket system is not set up on this server.', flags: 64 });
  }
  const existing = interaction.guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildText && c.name === `${TICKET_PREFIX}${interaction.user.username.toLowerCase()}`,
  );
  if (existing) return interaction.reply({ content: `You already have a ticket open: <#${existing.id}>`, flags: 64 });

  let category = t.categoryId ? interaction.guild.channels.cache.get(t.categoryId) : null;
  if (!category) category = interaction.guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === 'Tickets');
  if (!category) {
    category = await interaction.guild.channels.create({ name: 'Tickets', type: ChannelType.GuildCategory, reason: 'ticket system' }).catch(() => null);
  }

  const supportOverwrites = [];
  if (t.supportRoleId) {
    supportOverwrites.push({ id: t.supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  }

  const ch = await interaction.guild.channels.create({
    name: `${TICKET_PREFIX}${interaction.user.username.toLowerCase()}`,
    type: ChannelType.GuildText,
    parent: category ? category.id : undefined,
    topic: `Ticket for ${interaction.user.tag}`,
    reason: 'ticket system',
    permissionOverwrites: [
      { id: interaction.guildId, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] },
      ...supportOverwrites,
    ],
  });

  store.data.tickets[ch.id] = {
    guildId: interaction.guildId,
    userId: interaction.user.id,
    openedAt: Date.now(),
    channelId: ch.id,
  };
  store.save();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_close').setLabel('🔒 Close Ticket').setStyle(ButtonStyle.Danger),
  );
  await ch.send({
    content: `<@${interaction.user.id}>`,
    embeds: [new EmbedBuilder().setTitle('🎫 Ticket Opened').setDescription('Staff will be with you shortly. Describe your issue. Use **🔒 Close Ticket** when done.').setColor(0x5865f2)],
    components: [row],
  }).catch(() => {});
  audit.emit(interaction.guild, 'ticket', '🎫 Ticket Opened', `Ticket opened by **${interaction.user.tag}** — <#${ch.id}>.`, 0x5865f2);
  return interaction.reply({ content: `🎫 Ticket opened: <#${ch.id}>`, flags: 64 });
}

function isTicketChannel(channel) {
  return !!channel && channel.type === ChannelType.GuildText && channel.name.startsWith(TICKET_PREFIX);
}

function hasSupportPerms(member, settings) {
  if (!member) return false;
  if (member.id === member.guild.ownerId) return true;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const t = settings.tickets || {};
  if (t.supportRoleId && member.roles.cache.has(t.supportRoleId)) return true;
  return member.permissions.has(PermissionFlagsBits.ManageChannels);
}

async function closeTicket(channel, closer, reason = 'Closed') {
  let transcript = [];
  try {
    const messages = await channel.messages.fetch({ limit: 100 });
    transcript = [...messages.values()].reverse().map((m) => ({
      tag: `${m.author.tag}${m.author.bot ? ' [BOT]' : ''}`,
      content: (m.content || '') + (m.attachments.size ? ` [${m.attachments.size} attachment(s)]` : ''),
      at: m.createdTimestamp,
    }));
  } catch {}
  const entry = store.data.tickets[channel.id];
  if (entry) {
    store.saveTranscript({
      guildId: entry.guildId,
      channelId: channel.id,
      userId: entry.userId,
      closedBy: closer ? closer.tag : 'unknown',
      reason,
      lines: transcript.length,
      messages: transcript,
    });
    delete store.data.tickets[channel.id];
  }
  store.save();
  audit.emit(channel.guild, 'ticket_close', '🔒 Ticket Closed', `Ticket <#${channel.id}> closed by **${closer ? closer.tag : 'system'}** — ${transcript.length} messages archived. Reason: ${reason}`, 0x57f287);
  await channel.delete(`Ticket closed: ${reason}`).catch(() => {});
  return transcript.length;
}

module.exports = { setupPanel, createTicket, isTicketChannel, hasSupportPerms, closeTicket, TICKET_PREFIX };
