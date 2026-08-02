const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const store = require('../../store');
const audit = require('./auditLogger');

function msFromDuration(text) {
  const m = String(text).match(/^(\d+)([smhdw])$/);
  if (!m) return null;
  const mult = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 }[m[2]];
  return Number(m[1]) * mult;
}

async function start(guild, channel, durationText, winners, prize, host) {
  const durationMs = msFromDuration(durationText);
  if (!durationMs) return { ok: false, error: 'Invalid duration. Use formats like 30s, 5m, 2h, 3d, 1w.' };
  if (winners < 1 || winners > 20) return { ok: false, error: 'Winner count must be between 1 and 20.' };
  const endsAt = Date.now() + durationMs;
  const embed = new EmbedBuilder()
    .setTitle('🎉 GIVEAWAY')
    .setDescription(`**${prize}**\n\nClick the button below to enter!\nWinners: **${winners}**\nHosted by: ${host}`)
    .setColor(0x5865f2)
    .setFooter({ text: 'Ends' })
    .setTimestamp(endsAt);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('giveaway_enter').setLabel('🎉 Enter Giveaway').setStyle(ButtonStyle.Primary),
  );
  const msg = await channel.send({ embeds: [embed], components: [row] });
  const g = {
    id: msg.id,
    guildId: guild.id,
    channelId: channel.id,
    prize,
    winners,
    hostId: host.id,
    endsAt,
    entries: [],
  };
  store.data.giveaways[msg.id] = g;
  store.save();
  audit.emit(guild, 'giveaway', '🎉 Giveaway Started', `**${prize}** — ${winners} winner(s), ends <t:${Math.floor(endsAt / 1000)}:R>. Hosted by **${host.tag}**.`, 0x5865f2);
  const timer = setTimeout(() => finish(guild, msg.id).catch(() => {}), durationMs + 1500);
  g.timer = timer;
  return { ok: true, msg, g };
}

async function finish(guild, id, opts = {}) {
  const g = store.data.giveaways[id];
  if (!g) return { ok: false, error: 'Giveaway not found.' };
  const channel = guild.channels.cache.get(g.channelId);
  const winners = opts.manualWinners || g.winners || 1;
  const pool = g.entries.filter((e) => opts.exclude ? !opts.exclude.includes(e) : true);
  if (!pool.length) {
    const embed = new EmbedBuilder().setTitle('🎉 GIVEAWAY ENDED').setDescription(`**${g.prize}**\n\nNo valid entries — no winner.`).setColor(0xed4245);
    if (channel) channel.send({ embeds: [embed] }).catch(() => {});
    delete store.data.giveaways[id];
    store.save();
    return { ok: true, winnerIds: [] };
  }
  const winnerIds = [];
  for (let i = 0; i < winners && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    winnerIds.push(pool[idx]);
    pool.splice(idx, 1);
  }
  const embed = new EmbedBuilder().setTitle('🎉 GIVEAWAY ENDED').setDescription(`**${g.prize}**\n\nWinner(s): ${winnerIds.map((w) => `<@${w}>`).join(', ')}\nHosted by: <@${g.hostId}>`).setColor(0x57f287);
  if (channel) {
    await channel.send({ content: winnerIds.map((w) => `<@${w}>`).join(' '), embeds: [embed] }).catch(() => {});
  }
  delete store.data.giveaways[id];
  store.save();
  audit.emit(guild, 'giveaway_end', '🎉 Giveaway Won', `**${g.prize}** won by ${winnerIds.map((w) => `<@${w}>`).join(', ')}.`, 0x57f287);
  return { ok: true, winnerIds };
}

function addEntry(userId) {
  return { userId, at: Date.now() };
}

function listActive(guildId) {
  return Object.values(store.data.giveaways).filter((g) => g.guildId === guildId);
}

function cleanupTimers() {
  const now = Date.now();
  for (const [id, g] of Object.entries(store.data.giveaways)) {
    if (g.endsAt <= now) {
      const guild = null;
      store.data.giveaways[id] = g;
      if (g.timer) clearTimeout(g.timer);
    }
  }
}

module.exports = { start, finish, addEntry, listActive, msFromDuration };
