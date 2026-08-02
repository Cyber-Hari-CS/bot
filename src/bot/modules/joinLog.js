const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const store = require('../../store');
const security = require('./security');

function badges(user) {
  const f = user.flags ? user.flags.toArray() : [];
  if (!f.length) return 'none';
  const map = {
    Staff: '👨‍💼 Staff', Partner: '🤝 Partner', HypeSquadEvents: '🏆 HypeSquad Events',
    BugHunterLevel1: '🐛 Bug Hunter', BugHunterLevel2: '🐛 Bug Hunter L2', HypeSquadBalance: '🟢 Balance',
    HypeSquadBravery: '🔴 Bravery', HypeSquadBrilliance: '🟡 Brilliance', EarlySupporter: '🎗️ Early Supporter',
    VerifiedDeveloper: '🧑‍💻 Developer', CertifiedModerator: '🛡️ Moderator', ActiveDeveloper: '🛠️ Active Dev',
  };
  return f.map((b) => map[b] || b).join(' · ');
}

function formatJoin(member, settings, invite) {
  const u = member.user;
  const created = u.createdTimestamp;
  const ageDays = (Date.now() - created) / 86400000;
  const joinLog = security && security.riskScore ? security.riskScore(member, settings) : 0;
  const emb = new EmbedBuilder()
    .setTitle('📥 Member Joined')
    .setDescription(`**${u.tag}** <@${u.id}>`)
    .setColor(0x57f287)
    .setThumbnail(u.displayAvatarURL({ size: 256 }))
    .addFields([
      { name: 'User ID', value: `\`${u.id}\``, inline: true },
      { name: 'Account Age', value: `**${ageDays.toFixed(1)} days**\n<t:${Math.floor(created / 1000)}:f>`, inline: true },
      { name: 'Joined', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
      { name: 'Badges', value: badges(u), inline: true },
      { name: 'Account Type', value: u.bot ? '🤖 Bot' : '👤 Human', inline: true },
      { name: 'Member #', value: String(member.guild.memberCount), inline: true },
    ]);
  if (invite) {
    emb.addFields([{ name: 'Invite Used', value: `discord.gg/${invite.code} (by **${invite.inviter}**)`, inline: false }]);
  }
  return emb;
}

function formatLeave(member) {
  const u = member.user;
  return new EmbedBuilder()
    .setTitle('📤 Member Left')
    .setDescription(`**${u.tag}** <@${u.id}>`)
    .setColor(0xed4245)
    .setThumbnail(u.displayAvatarURL({ size: 256 }))
    .addFields([
      { name: 'User ID', value: `\`${u.id}\``, inline: true },
      { name: 'Was In Server', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:f>` : 'unknown', inline: true },
      { name: 'Left', value: `<t:${Math.floor(Date.now() / 1000)}:R>`, inline: true },
    ]);
}

async function logJoin(member, settings) {
  if (!settings.joinLog.enabled || !settings.joinLog.channelId) return;
  const ch = member.guild.channels.cache.get(settings.joinLog.channelId);
  if (!ch || !ch.isTextBased()) return;
  let invite = null;
  try {
    const tracker = require('./inviteTracker');
    invite = await tracker.usedInvite(member.guild);
  } catch {}
  const embed = formatJoin(member, settings, invite);
  const score = security.riskScore(member, settings);
  const [levelText] = security.riskLevel(score);
  embed.addFields([{ name: '🛡️ Risk', value: `**${score}/100** (${levelText})`, inline: true }]);
  try {
    await ch.send({ embeds: [embed] });
  } catch {}
}

async function logLeave(member, settings) {
  if (!settings.leaveLog.enabled || !settings.leaveLog.channelId) return;
  const ch = member.guild.channels.cache.get(settings.leaveLog.channelId);
  if (!ch || !ch.isTextBased()) return;
  ch.send({ embeds: [formatLeave(member)] }).catch(() => {});
}

function canView(member) {
  return !!member && (
    member.id === member.guild.ownerId ||
    member.permissions.has(PermissionFlagsBits.ManageMessages) ||
    member.permissions.has(PermissionFlagsBits.KickMembers) ||
    member.permissions.has(PermissionFlagsBits.BanMembers)
  );
}

module.exports = { logJoin, logLeave, canView };
