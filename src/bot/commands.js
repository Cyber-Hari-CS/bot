const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const store = require('../store');
const audit = require('./modules/auditLogger');
const verification = require('./modules/verification');
const antiRaid = require('./modules/antiRaid');
const perms = require('./modules/perms');
const features = require('./featuresCommands');

function err(interaction, text) {
  return interaction.reply({ content: `❌ ${text}`, flags: 64 });
}

function ok(interaction, text) {
  return interaction.reply({ content: text, flags: 64 });
}

function requireModerator(interaction) {
  return interaction.member.permissions.has(PermissionFlagsBits.ManageMessages) ||
    interaction.member.permissions.has(PermissionFlagsBits.KickMembers) ||
    interaction.member.permissions.has(PermissionFlagsBits.BanMembers);
}

function isAdmin(interaction) {
  return interaction.member.permissions.has(PermissionFlagsBits.Administrator);
}

async function endSecureMode(guild, sm) {
  for (const snap of sm.snapshots || []) {
    const channel = guild.channels.cache.get(snap.channelId);
    if (!channel) continue;
    try {
      if (snap.allow === 0 && snap.deny === 0) {
        await channel.permissionOverwrites.delete(guild.id, 'Secure mode ended').catch(() => {});
      } else {
        await channel.permissionOverwrites.create(guild.roles.everyone, { allow: String(snap.allow), deny: String(snap.deny) }, { reason: 'Secure mode ended' }).catch(() => {});
      }
    } catch {}
  }
  try { await guild.setVerificationLevel(1); } catch {}
  antiRaid.endRaid(guild.id);
  store.data.secureMode = store.data.secureMode || {};
  delete store.data.secureMode[guild.id];
  store.save();
  audit.emit(guild, 'secure_mode_end', '🔓 Secure Mode Ended', 'Secure mode expired — channels restored.', 0x57f287);
}

async function handle(interaction) {
  const { commandName } = interaction;
  const settings = store.guildSettings(interaction.guildId);

  const auth = perms.checkRoleAuth(commandName, interaction, settings);
  if (!auth.ok) {
    return interaction.reply({
      content: `🔐 This command is restricted — required role(s): ${auth.roles.map((id) => `<@&${id}>`).join(', ')}`,
      flags: 64,
    });
  }

  if (features.handle(interaction, settings)) return;

  switch (commandName) {
    case 'kick': {
      if (!requireModerator(interaction)) return err(interaction, 'You need moderation permissions to use this.');
      const target = interaction.options.getMember('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      if (!target) return err(interaction, 'User is not in this server.');
      if (!target.kickable) return err(interaction, 'I cannot kick that user.');
      await target.kick(reason);
      audit.modAction(interaction.guild, 'kick', target.user, interaction.user, reason);
      return ok(interaction, `👢 Kicked **${target.user.tag}** — ${reason}`);
    }

    case 'ban': {
      if (!requireModerator(interaction)) return err(interaction, 'You need moderation permissions to use this.');
      const member = interaction.options.getMember('user');
      let target = member ? member.user : interaction.options.getUser('user') || interaction.options.getString('user_id');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const days = interaction.options.getInteger('days') || 0;
      if (!target) return err(interaction, 'User not found.');
      const display = target.tag || target;
      await interaction.guild.members.ban(target.id || target, { reason, deleteMessageSeconds: days * 86400 });
      audit.modAction(interaction.guild, 'ban', display, interaction.user, reason);
      return ok(interaction, `🔨 Banned **${display}** — ${reason}`);
    }

    case 'unban': {
      if (!requireModerator(interaction)) return err(interaction, 'You need moderation permissions to use this.');
      const id = interaction.options.getString('user_id');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      try {
        const user = await interaction.client.users.fetch(id);
        await interaction.guild.members.unban(id, reason);
        audit.modAction(interaction.guild, 'unban', user, interaction.user, reason);
        return ok(interaction, `🔓 Unbanned **${user.tag}**`);
      } catch {
        return err(interaction, 'Could not unban that user (not banned or invalid ID).');
      }
    }

    case 'mute': {
      if (!requireModerator(interaction)) return err(interaction, 'You need moderation permissions to use this.');
      const target = interaction.options.getMember('user');
      const minutes = interaction.options.getInteger('minutes') || 10;
      const reason = interaction.options.getString('reason') || 'No reason provided';
      if (!target) return err(interaction, 'User is not in this server.');
      if (!target.moderatable) return err(interaction, 'I cannot mute that user.');
      await target.timeout(minutes * 60000, reason);
      audit.modAction(interaction.guild, 'timeout', target.user, interaction.user, reason, `${minutes} min`);
      return ok(interaction, `⏰ Muted **${target.user.tag}** for ${minutes} min — ${reason}`);
    }

    case 'unmute': {
      if (!requireModerator(interaction)) return err(interaction, 'You need moderation permissions to use this.');
      const target = interaction.options.getMember('user');
      if (!target || !target.communicationDisabledUntil) return err(interaction, 'User is not muted or not in the server.');
      await target.timeout(null);
      audit.modAction(interaction.guild, 'untimeout', target.user, interaction.user, 'Mute removed');
      return ok(interaction, `🔔 Unmuted **${target.user.tag}**`);
    }

    case 'warn': {
      if (!requireModerator(interaction)) return err(interaction, 'You need moderation permissions to use this.');
      const target = interaction.options.getMember('user') || interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      if (!target) return err(interaction, 'User not found.');
      const warn = store.addWarning(interaction.guildId, target.id, interaction.user.id, reason, 'warn');
      const count = store.getWarnings(interaction.guildId, target.id).length;
      audit.modAction(interaction.guild, 'warn', target, interaction.user, reason);
      return ok(interaction, `⚠️ Warned **${target.tag || target.username}** (#${count}) — ${reason} (warn id \`${warn.id}\`)`);
    }

    case 'warnings': {
      const target = interaction.options.getMember('user') || interaction.options.getUser('user');
      if (!target) return err(interaction, 'User not found.');
      const warns = store.getWarnings(interaction.guildId, target.id);
      if (warns.length === 0) return ok(interaction, `✅ **${target.tag || target.username}** has no warnings.`);
      const lines = warns.map((w, i) => `**${i + 1}.** \`${w.id}\` — ${w.reason}\n      <t:${Math.floor(w.at / 1000)}:f>`).join('\n');
      return ok(interaction, `⚠️ **${target.tag || target.username}** — ${warns.length} warning(s)\n${lines}`);
    }

    case 'clearwarnings': {
      if (!requireModerator(interaction)) return err(interaction, 'You need moderation permissions to use this.');
      const target = interaction.options.getMember('user') || interaction.options.getUser('user');
      if (!target) return err(interaction, 'User not found.');
      store.clearWarnings(interaction.guildId, target.id);
      return ok(interaction, `🧹 Cleared all warnings for **${target.tag || target.username}**.`);
    }

    case 'purge': {
      if (!requireModerator(interaction)) return err(interaction, 'You need moderation permissions to use this.');
      const count = Math.min(interaction.options.getInteger('count') || 10, 100);
      const messages = await interaction.channel.bulkDelete(count, true);
      audit.modAction(interaction.guild, 'purge', `${messages.size} messages`, interaction.user, `Purged in #${interaction.channel.name}`);
      return ok(interaction, `🧹 Purged **${messages.size}** messages in <#${interaction.channel.id}>.`);
    }

    case 'verify': {
      const v = settings.verification;
      if (!v.enabled || !v.roleId) return err(interaction, 'Verification is not enabled on this server.');
      if (verification.isVerified(interaction.guildId, interaction.user.id)) return ok(interaction, 'You are already verified.');
      if (!interaction.client.user.id) return err(interaction, 'Bot error.');
      try {
        const dm = await interaction.user.createDM();
        const challenge = verification.createChallenge(interaction.member);
        await dm.send(`✅ **${interaction.guild.name}** — Verification\nPlease solve: ${challenge.text}\n\nReply with the answer in this DM.`);
        return ok(interaction, '✅ Check your DMs to complete verification.');
      } catch {
        return err(interaction, 'Could not DM you — enable DMs from server members and try again.');
      }
    }

    case 'lockdown': {
      if (!requireModerator(interaction)) return err(interaction, 'You need moderation permissions to use this.');
      const minutes = interaction.options.getInteger('minutes') || 10;
      const until = antiRaid.triggerRaid(interaction.guild, { lockdownDurationMin: minutes });
      audit.emit(interaction.guild, 'lockdown', '🔒 Server Lockdown', `Server locked down by **${interaction.user.tag}** for ${minutes} min.`, 0xed4245);
      return ok(interaction, `🔒 Lockdown enabled for ${minutes} min. New joins are under scrutiny.`);
    }

    case 'raid-end': {
      if (!requireModerator(interaction)) return err(interaction, 'You need moderation permissions to use this.');
      antiRaid.endRaid(interaction.guildId);
      audit.emit(interaction.guild, 'raid_end', '🛡️ Lockdown Ended', `Lockdown ended by **${interaction.user.tag}**.`, 0x57f287);
      return ok(interaction, '🛡️ Lockdown ended.');
    }

    case 'setup-audit': {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return err(interaction, 'Administrator permission required.');
      const channel = interaction.options.getChannel('channel');
      settings.audit.channelId = channel.id;
      settings.audit.enabled = true;
      store.save();
      audit.invalidate(interaction.guildId);
      return ok(interaction, `📋 Audit log channel set to <#${channel.id}>.`);
    }

    case 'setup-verify': {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return err(interaction, 'Administrator permission required.');
      const role = interaction.options.getRole('role');
      settings.verification.enabled = true;
      settings.verification.roleId = role.id;
      store.save();
      return ok(interaction, `✅ Verification enabled — verified members receive **${role.name}**.`);
    }

    case 'disable-verify': {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return err(interaction, 'Administrator permission required.');
      settings.verification.enabled = false;
      store.save();
      return ok(interaction, 'Verification disabled.');
    }

    case 'protect-role': {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return err(interaction, 'Administrator permission required.');
      const role = interaction.options.getRole('role');
      const list = settings.antiNuke.protectedRoles || (settings.antiNuke.protectedRoles = []);
      if (list.includes(role.id)) return ok(interaction, `🛡️ **${role.name}** is already protected.`);
      list.push(role.id);
      store.save();
      return ok(interaction, `🛡️ **${role.name}** is now protected — it cannot be deleted or tampered with.`);
    }

    case 'unprotect-role': {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return err(interaction, 'Administrator permission required.');
      const role = interaction.options.getRole('role');
      const list = settings.antiNuke.protectedRoles || [];
      const idx = list.indexOf(role.id);
      if (idx === -1) return ok(interaction, `**${role.name}** is not protected.`);
      list.splice(idx, 1);
      store.save();
      return ok(interaction, `**${role.name}** is no longer protected.`);
    }

    case 'scan': {
      if (!requireModerator(interaction)) return err(interaction, 'You need moderation permissions to use this.');
      await interaction.deferReply({ flags: 64 });
      const security = require('./modules/security');
      const result = await security.scan(interaction.guild);
      store.pushAlert(interaction.guildId, {
        type: 'scan', level: result.score[0] === 'CRITICAL' || result.score[0] === 'HIGH' ? 'warning' : 'info', title: 'Security Scan',
        message: `Scan completed — ${result.flags.filter((f) => !f.startsWith('🟢')).length} issue(s) found, overall risk ${result.score[0]}`,
      });
      audit.emit(interaction.guild, 'scan', '🔍 Security Scan', `Scan by **${interaction.user.tag}** — risk: **${result.score[0]}** (${result.score[1]})`, 0x5865f2);
      return interaction.editReply({ content: `**🔍 Security Scan — ${interaction.guild.name}**\nRisk level: **${result.score[0]}** ${result.score[1]}\n${result.flags.map((f) => `- ${f}`).join('\n')}\n\nℹ️ ${result.admins} admin holders · ${result.botAdmins} bot(s) with admin · ${result.webhooks} webhook(s)` });
    }

    case 'risk': {
      const target = interaction.options.getMember('user') || interaction.options.getUser('user');
      if (!target) return err(interaction, 'User not found.');
      const security = require('./modules/security');
      const member = interaction.guild.members.cache.get(target.id);
      if (!member) return err(interaction, 'User is not in this server.');
      const score = security.riskScore(member, settings);
      const [levelText, icon] = security.riskLevel(score);
      const age = security.accountAgeDays(member.user).toFixed(1);
      const warns = store.getWarnings(interaction.guildId, target.id).length;
      const bar = '█'.repeat(Math.round(score / 10)).padEnd(10, '░');
      return ok(interaction, `**${icon} Risk Assessment — ${target.tag}**\nScore: **${score}/100** (${levelText})\n\`${bar}\`\nAccount age: **${age} days** · Warnings: **${warns}** · Verified: ${store.data.verified[`${interaction.guildId}:${target.id}`] ? '✅' : '❌'}${member.communicationDisabledUntil ? ' · ⏰ Timed out' : ''}`);
    }

    case 'secure-mode': {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return err(interaction, 'Administrator permission required.');
      const minutes = interaction.options.getInteger('minutes') || 30;
      const guild = interaction.guild;
      const snapshots = [];
      let done = 0;
      for (const channel of guild.channels.cache.values()) {
        if (channel.type === 10 || channel.type === 11 || channel.type === 12) continue;
        if (!channel.isTextBased && !channel.isVoiceBased && channel.type !== 4) continue;
        const ow = channel.permissionOverwrites.cache.get(guild.id);
        snapshots.push({ channelId: channel.id, allow: ow ? ow.allow.bitfield : 0, deny: ow ? ow.deny.bitfield : 0 });
        await channel.permissionOverwrites.create(guild.roles.everyone, {
          SendMessages: false, CreateInstantInvite: false, Connect: false, Speak: false,
        }, { reason: 'Secure mode' }).then(() => done++).catch(() => {});
      }
      store.data.secureMode = store.data.secureMode || {};
      store.data.secureMode[guild.id] = { until: Date.now() + minutes * 60000, snapshots };
      store.save();
      await guild.setVerificationLevel(3).catch(() => {});
      const until = antiRaid.triggerRaid(guild, { lockdownDurationMin: minutes });
      audit.emit(guild, 'secure_mode', '🔐 SECURE MODE', `Secure mode enabled by **${interaction.user.tag}** for ${minutes} min — ${done} channels locked, chat frozen, verification level raised.`, 0xed4245);
      store.pushAlert(guild.id, { type: 'secure_mode', level: 'critical', title: '🔐 SECURE MODE', message: `Enabled by ${interaction.user.tag} for ${minutes} min — all chat disabled` });
      setTimeout(async () => {
        const sm = store.data.secureMode && store.data.secureMode[guild.id];
        if (sm) await endSecureMode(guild, sm);
      }, minutes * 60000);
      return ok(interaction, `🔐 **Secure mode enabled** for ${minutes} min — chat is frozen, invites disabled, verification raised. New members will be locked down.`);
    }

    case 'secure-end': {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return err(interaction, 'Administrator permission required.');
      const sm = store.data.secureMode && store.data.secureMode[interaction.guildId];
      if (!sm) return err(interaction, 'Secure mode is not active on this server.');
      await endSecureMode(interaction.guild, sm);
      audit.emit(interaction.guild, 'secure_mode_end', '🔓 Secure Mode Ended', `Secure mode ended by **${interaction.user.tag}**.`, 0x57f287);
      return ok(interaction, '🔓 Secure mode ended — channels restored.');
    }

    case 'webhooks': {
      if (!requireModerator(interaction)) return err(interaction, 'You need moderation permissions to use this.');
      await interaction.deferReply({ flags: 64 });
      let webhooks = [];
      try { webhooks = [...(await interaction.guild.fetchWebhooks()).values()]; } catch {}
      if (!webhooks.length) return interaction.editReply({ content: 'No webhooks found on this server.' });
      const lines = webhooks.slice(0, 15).map((w) => {
        const danger = !w.owner || w.owner.bot || /^(spam|nitro|giveaway|free|hack)/i.test(w.name || '');
        return `${danger ? '🚨' : '✅'} **${w.name}** → #${w.channel ? w.channel.name : '?'} — ${w.owner ? w.owner.tag : 'no owner'}${w.token ? ' (has token!)' : ''}`;
      });
      return interaction.editReply({ content: `**Webhooks (${webhooks.length})**\n${lines.join('\n')}\n\n⚠️ Delete any 🚨 webhook immediately — scammers use them to spam or hijack.` });
    }

    case 'bots': {
      await interaction.deferReply({ flags: 64 });
      await interaction.guild.members.fetch().catch(() => {});
      const bots = [...interaction.guild.members.cache.values()].filter((m) => m.user.bot);
      if (!bots.length) return interaction.editReply({ content: 'No bots in this server.' });
      const lines = bots.slice(0, 20).map((b) => {
        const admin = b.permissions.has('Administrator');
        const manageGuild = b.permissions.has(PermissionFlagsBits.ManageGuild);
        return `${admin ? '🚨' : manageGuild ? '⚠️' : '✅'} **${b.user.tag}** ${admin ? '— ADMIN' : manageGuild ? '— manages server' : ''}`;
      });
      const dangerous = bots.filter((b) => b.permissions.has('Administrator')).length;
      return interaction.editReply({ content: `**Bots (${bots.length})**${dangerous ? ` — ⚠️ ${dangerous} has Administrator!` : ''}\n${lines.join('\n')}` });
    }

    case 'backup': {
      if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return err(interaction, 'Administrator permission required.');
      await interaction.deferReply({ flags: 64 });
      const security = require('./modules/security');
      const backup = await security.backup(interaction.guild);
      const fs = require('fs');
      const path = require('path');
      const config = require('../config');
      const dir = path.join(path.dirname(config.dataFile), 'backups');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${interaction.guildId}-${Date.now()}.json`);
      fs.writeFileSync(file, JSON.stringify(backup, null, 2), 'utf8');
      audit.emit(interaction.guild, 'backup', '💾 Server Backup', `Backup created by **${interaction.user.tag}** — ${backup.roles.length} roles, ${backup.channels.length} channels.`, 0x57f287);
      return interaction.editReply({ content: `💾 **Server backup created** — ${backup.roles.length} roles, ${backup.channels.length} channels. Use this file to rebuild your server if it gets nuked.`, files: [file] });
    }

    case 'newaccounts': {
      if (!requireModerator(interaction)) return err(interaction, 'You need moderation permissions to use this.');
      const days = interaction.options.getInteger('days') || 7;
      await interaction.deferReply({ flags: 64 });
      await interaction.guild.members.fetch().catch(() => {});
      const cutoff = Date.now() - days * 86400000;
      const newbies = [...interaction.guild.members.cache.values()]
        .filter((m) => !m.user.bot && m.user.createdTimestamp > cutoff)
        .sort((a, b) => b.user.createdTimestamp - a.user.createdTimestamp);
      if (!newbies.length) return interaction.editReply({ content: `No members with accounts younger than ${days} days. 🎉` });
      const lines = newbies.slice(0, 20).map((m) => `- **${m.user.tag}** — account <t:${Math.floor(m.user.createdTimestamp / 1000)}:R>`);
      return interaction.editReply({ content: `**New accounts (${newbies.length} with age < ${days} days)** — potential raid risk\n${lines.join('\n')}` });
    }

    case 'ghost-pings': {
      if (!requireModerator(interaction)) return err(interaction, 'You need moderation permissions to use this.');
      const pings = (store.data.ghostPings || []).filter((p) => p.guildId === interaction.guildId).slice(-10);
      if (!pings.length) return ok(interaction, 'No ghost pings detected. 🎉');
      const lines = pings.reverse().map((p) => `- **${p.tag}** — ${p.mentions} ping(s) in #${p.channelName} <t:${Math.floor(p.at / 1000)}:R>\n  \`\`\`${p.content || ''}\`\`\``);
      return ok(interaction, `**👻 Recent ghost pings**\n${lines.join('\n')}`);
    }

    case 'set-access': {
      if (!isAdmin(interaction)) return err(interaction, 'Administrator permission required.');
      const mode = interaction.options.getString('mode');
      settings.access.mode = mode;
      store.save();
      return ok(interaction, mode === 'allowlist'
        ? '🔒 Access restricted — only allowed users/roles (and owners/admins) can use the bot.'
        : '🌐 Everyone can use the bot again.');
    }

    case 'allow': {
      if (!isAdmin(interaction)) return err(interaction, 'Administrator permission required.');
      const user = interaction.options.getUser('user');
      const role = interaction.options.getRole('role');
      if (!user && !role) return err(interaction, 'Provide a user or role to allow.');
      if (user && !settings.access.users.includes(user.id)) settings.access.users.push(user.id);
      if (role && !settings.access.roles.includes(role.id)) settings.access.roles.push(role.id);
      store.save();
      return ok(interaction, `✅ Authorized ${user ? `**${user.tag}**` : ''}${user && role ? ' and ' : ''}${role ? `**${role.name}**` : ''} to use the bot.`);
    }

    case 'deny': {
      if (!isAdmin(interaction)) return err(interaction, 'Administrator permission required.');
      const user = interaction.options.getUser('user');
      const role = interaction.options.getRole('role');
      if (!user && !role) return err(interaction, 'Provide a user or role to remove.');
      if (user) settings.access.users = settings.access.users.filter((id) => id !== user.id);
      if (role) settings.access.roles = settings.access.roles.filter((id) => id !== role.id);
      store.save();
      return ok(interaction, `Removed ${user ? `**${user.tag}**` : ''}${user && role ? ' and ' : ''}${role ? `**${role.name}**` : ''} from the allowlist.`);
    }

    case 'access': {
      const a = settings.access;
      const users = a.users.map((id) => `<@${id}>`).join(', ') || 'none';
      const roles = a.roles.map((id) => `<@&${id}>`).join(', ') || 'none';
      return ok(interaction, `**🔒 Bot Access Control**\nMode: ${a.mode === 'allowlist' ? '🔒 Allowlist' : '🌐 Everyone'}\nAuthorized users: ${users}\nAuthorized roles: ${roles}\n\nServer owners and Administrator members are always allowed.`);
    }

    case 'set-welcome': {
      if (!isAdmin(interaction)) return err(interaction, 'Administrator permission required.');
      const channel = interaction.options.getChannel('channel');
      settings.welcome.channelId = channel.id;
      settings.welcome.enabled = true;
      store.save();
      return ok(interaction, `👋 Welcome messages enabled in <#${channel.id}>.`);
    }

    case 'set-welcome-message': {
      if (!isAdmin(interaction)) return err(interaction, 'Administrator permission required.');
      const msg = interaction.options.getString('message');
      settings.welcome.message = msg;
      store.save();
      return ok(interaction, `👋 Welcome message set:\n> ${msg}\n\nPlaceholders: {mention} {user} {userTag} {guild} {memberCount}`);
    }

    case 'disable-welcome': {
      if (!isAdmin(interaction)) return err(interaction, 'Administrator permission required.');
      settings.welcome.enabled = false;
      store.save();
      return ok(interaction, 'Welcome messages disabled.');
    }

    case 'set-farewell': {
      if (!isAdmin(interaction)) return err(interaction, 'Administrator permission required.');
      const channel = interaction.options.getChannel('channel');
      settings.farewell.channelId = channel.id;
      settings.farewell.enabled = true;
      store.save();
      return ok(interaction, `👋 Farewell messages enabled in <#${channel.id}>.`);
    }

    case 'set-farewell-message': {
      if (!isAdmin(interaction)) return err(interaction, 'Administrator permission required.');
      const msg = interaction.options.getString('message');
      settings.farewell.message = msg;
      store.save();
      return ok(interaction, `👋 Farewell message set:\n> ${msg}\n\nPlaceholders: {mention} {user} {userTag} {guild} {memberCount}`);
    }

    case 'disable-farewell': {
      if (!isAdmin(interaction)) return err(interaction, 'Administrator permission required.');
      settings.farewell.enabled = false;
      store.save();
      return ok(interaction, 'Farewell messages disabled.');
    }

    case 'botinfo': {
      const me = interaction.guild.members.me;
      const perms = interaction.guild.members.me.permissions.toArray();
      const has = (name) => (perms.includes(name) ? '✅' : '❌');
      const lines = [
        `**🤖 Bot Info — ${me.user.tag}**`,
        `Bot role: **${me.roles.highest.name}** (top role position: ${me.roles.highest.position})`,
        ``,
        `**Permissions**`,
        `${has('Administrator')} Administrator`,
        `${has('KickMembers')} Kick Members`,
        `${has('BanMembers')} Ban Members`,
        `${has('ModerateMembers')} Moderate Members (mute/timeout)`,
        `${has('ManageMessages')} Manage Messages (purge/auto-mod)`,
        `${has('ManageRoles')} Manage Roles (role protect/restore)`,
        `${has('ManageChannels')} Manage Channels (nuke restore)`,
        `${has('ManageGuild')} Manage Server (invite tracking, lockdown)`,
        `${has('ManageWebhooks')} Manage Webhooks (nuke detection)`,
        `${has('ReadMessageHistory')} Read Message History (scan)`,
        `${has('SendMessages')} Send Messages`,
        `${has('ViewChannel')} View Channels`,
        ``,
        `⚠️ For full protection the bot needs: Kick Members, Ban Members, Moderate Members, Manage Messages, Manage Roles, Manage Channels.`,
      ];
      return ok(interaction, lines.join('\n'));
    }

    case 'speak': {
      const vc = interaction.member.voice?.channel;
      if (!vc) return err(interaction, 'Join a voice channel first, then run this command.');
      const text = interaction.options.getString('text');
      const lang = (settings.voice && settings.voice.lang) || 'ta';
      const voice = require('./modules/voice');
      const res = await voice.speak(interaction.guild, vc.id, text, lang);
      if (res.ok) {
        audit.emit(interaction.guild, 'speak', '🔊 Bot Speaking', `**${interaction.user.tag}** made the bot speak in **${vc.name}** (${lang}): "${text.slice(0, 100)}"`, 0x5865f2);
        return ok(interaction, `🔊 Speaking in **${vc.name}** (language: \`${lang}\`).`);
      }
      return err(interaction, `Could not speak: ${res.error}`);
    }

    case 'voicelang': {
      if (!isAdmin(interaction)) return err(interaction, 'Administrator permission required.');
      const lang = interaction.options.getString('lang');
      if (!lang) return ok(interaction, `Current TTS language: **${settings.voice.lang}**\nUse \`/voicelang ta\` to change (e.g. \`ta\` Tamil, \`en\` English, \`hi\` Hindi).`);
      settings.voice.lang = lang.toLowerCase();
      store.save();
      return ok(interaction, `🗣️ TTS language set to **${lang.toLowerCase()}**.`);
    }

    case 'alive': {
      if (!requireModerator(interaction)) return err(interaction, 'Moderator permission required.');
      const state = interaction.options.getString('state');
      const voice = require('./modules/voice');
      if (state === 'off') {
        const stopped = voice.disableMonitor(interaction.guildId);
        return ok(interaction, stopped ? '🎙️ Mic monitoring stopped.' : 'Monitoring is not active.');
      }
      const vc = interaction.member.voice?.channel;
      if (!vc) return err(interaction, 'Join a voice channel first.');
      voice.enableMonitor(interaction.guild, vc.id, interaction.channel);
      audit.emit(interaction.guild, 'alive', '🎙️ Mic Monitor', `Mic monitoring enabled in **${vc.name}** by **${interaction.user.tag}**.`, 0x5865f2);
      return ok(interaction, `🎙️ Mic monitoring **enabled** in **${vc.name}** — reports go to this channel.`);
    }

    case 'listen': {
      if (!requireModerator(interaction)) return err(interaction, 'Moderator permission required.');
      const state = interaction.options.getString('state');
      const listen = require('./modules/listen');
      if (state === 'off') {
        const stopped = listen.stopListen(interaction.guildId);
        return ok(interaction, stopped ? '🎧 Listening stopped.' : 'Listening is not active.');
      }
      const vc = interaction.member.voice?.channel;
      if (!vc) return err(interaction, 'Join a voice channel first.');
      const res = listen.startListen(interaction.guild, vc.id, interaction.channel.id);
      if (!res.ok) return err(interaction, res.error);
      audit.emit(interaction.guild, 'listen', '🎧 VC Listening', `Bot listening in **${vc.name}** — transcripts posted here by **${interaction.user.tag}**.`, 0x5865f2);
      return ok(interaction, `🎧 **Listening enabled** in **${vc.name}** — transcripts will be posted here. First run downloads a small AI model (~40 MB). Use \`/listen off\` to stop.`);
    }

    case 'sttlang': {
      if (!requireModerator(interaction)) return err(interaction, 'Moderator permission required.');
      const lang = interaction.options.getString('lang');
      settings.voice.sttLang = lang.toLowerCase();
      store.save();
      return ok(interaction, `🎧 Transcript language set to **${settings.voice.sttLang}**.`);
    }

    case 'mention': {
      if (!requireModerator(interaction)) return err(interaction, 'Moderator permission required.');
      const target = interaction.options.getUser('user');
      const count = Math.min(Math.max(interaction.options.getInteger('count') || 5, 1), 50);
      audit.emit(interaction.guild, 'mention', '📢 Mention Spam', `**${interaction.user.tag}** mentioned **${target.tag}** ${count} times in <#${interaction.channel.id}>.`, 0xe67e22);
      await interaction.reply({ content: `📢 Mentioning **${target.tag}** ${count} times...` });
      let sent = 0;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      while (sent < count) {
        const batch = Math.min(count - sent, 4);
        await interaction.channel.send(`<@${target.id}>`.repeat(batch)).catch(() => {});
        sent += batch;
        if (sent < count) await sleep(1800);
      }
      return interaction.editReply({ content: `✅ Done — mentioned **${target.tag}** ${count} times.` });
    }

    case 'settings': {
      const lines = [
        `**🛡️ ${interaction.guild.name} — Security Settings**`,
        `Anti-spam: ${settings.antiSpam.enabled ? '✅ on' : '❌ off'} (${settings.antiSpam.maxMessages} msgs / ${settings.antiSpam.windowSec}s, ${settings.antiSpam.maxMentions} mentions)`,
        `Anti-raid: ${settings.antiRaid.enabled ? '✅ on' : '❌ off'} (${settings.antiRaid.maxJoins} joins / ${settings.antiRaid.windowSec}s → ${settings.antiRaid.lockdownDurationMin} min lockdown)`,
        `Anti-nuke: ${settings.antiNuke.enabled ? '✅ on' : '❌ off'} (${settings.antiNuke.maxChannelDeletes} ch / ${settings.antiNuke.maxRoleDeletes} roles / ${settings.antiNuke.maxBans} bans / ${settings.antiNuke.maxKicks} kicks in ${settings.antiNuke.windowSec}s, restore: ${settings.antiNuke.autoRestore ? 'on' : 'off'})`,
        `Role protection: ${settings.antiNuke.autoProtectRoles ? '✅ auto (admin roles)' : '❌ off'}${settings.antiNuke.protectedRoles?.length ? ` + ${settings.antiNuke.protectedRoles.length} custom` : ''}`,
        `Bot protection: ${settings.antiNuke.kickBotsOnJoin ? '✅ new bots kicked unless added by trusted staff' : '❌ off'}`,
        `Auto-mod: ${settings.autoMod.enabled ? '✅ on' : '❌ off'} (links: ${settings.autoMod.blockAllLinks ? 'ALL BLOCKED' : settings.autoMod.filterLinks ? 'allowlist' : 'off'}, invites: ${settings.autoMod.filterInvites ? 'on' : 'off'}, caps: ${settings.autoMod.maxCapsPercent}%)`,
        `Audit logging: ${settings.audit.enabled ? '✅ on' : '❌ off'} ${settings.audit.channelId ? `<#${settings.audit.channelId}>` : '(no channel set)'}`,
        `Verification: ${settings.verification.enabled ? `✅ on (${settings.verification.roleId ? `<@&${settings.verification.roleId}>` : 'no role'})` : '❌ off'}`,
        `Access control: ${settings.access.mode === 'allowlist' ? `🔒 allowlist (${settings.access.users.length} users, ${settings.access.roles.length} roles)` : '🌐 everyone'}`,
        `Voice: TTS lang **${settings.voice.lang}** · transcripts lang **${settings.voice.sttLang || 'auto'}** · model **${settings.voice.sttModel || 'Xenova/whisper-tiny'}**`,
        `Welcome: ${settings.welcome.enabled ? `✅ on <#${settings.welcome.channelId}>` : '❌ off'} · Farewell: ${settings.farewell.enabled ? `✅ on <#${settings.farewell.channelId}>` : '❌ off'}`,
        `\n💻 Full control on the web dashboard.`,
      ];
      return ok(interaction, lines.join('\n'));
    }

    default:
      return err(interaction, 'Unknown command.');
  }
}

function buildCommands() {
  return [
    ...features.build(),
    new SlashCommandBuilder().setName('kick').setDescription('Kick a member')
      .addUserOption((o) => o.setName('user').setDescription('Member to kick').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason')),
    new SlashCommandBuilder().setName('ban').setDescription('Ban a member')
      .addUserOption((o) => o.setName('user').setDescription('Member to ban'))
      .addStringOption((o) => o.setName('user_id').setDescription('User ID to ban (if not in server)'))
      .addIntegerOption((o) => o.setName('days').setDescription('Days of messages to delete').setMinValue(0).setMaxValue(7))
      .addStringOption((o) => o.setName('reason').setDescription('Reason')),
    new SlashCommandBuilder().setName('unban').setDescription('Unban a user')
      .addStringOption((o) => o.setName('user_id').setDescription('User ID to unban').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason')),
    new SlashCommandBuilder().setName('mute').setDescription('Timeout a member')
      .addUserOption((o) => o.setName('user').setDescription('Member to mute').setRequired(true))
      .addIntegerOption((o) => o.setName('minutes').setDescription('Minutes (max 10080)').setMinValue(1).setMaxValue(10080))
      .addStringOption((o) => o.setName('reason').setDescription('Reason')),
    new SlashCommandBuilder().setName('unmute').setDescription('Remove timeout from a member')
      .addUserOption((o) => o.setName('user').setDescription('Member to unmute').setRequired(true)),
    new SlashCommandBuilder().setName('warn').setDescription('Warn a member')
      .addUserOption((o) => o.setName('user').setDescription('Member to warn').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setRequired(true)),
    new SlashCommandBuilder().setName('warnings').setDescription('List a member\'s warnings')
      .addUserOption((o) => o.setName('user').setDescription('Member to check').setRequired(true)),
    new SlashCommandBuilder().setName('clearwarnings').setDescription('Clear a member\'s warnings')
      .addUserOption((o) => o.setName('user').setDescription('Member to clear').setRequired(true)),
    new SlashCommandBuilder().setName('purge').setDescription('Bulk delete messages')
      .addIntegerOption((o) => o.setName('count').setDescription('Number of messages (max 100)').setMinValue(1).setMaxValue(100)),
    new SlashCommandBuilder().setName('verify').setDescription('Complete server verification'),
    new SlashCommandBuilder().setName('lockdown').setDescription('Enable raid lockdown manually')
      .addIntegerOption((o) => o.setName('minutes').setDescription('Duration in minutes').setMinValue(1).setMaxValue(1440)),
    new SlashCommandBuilder().setName('raid-end').setDescription('End the current lockdown'),
    new SlashCommandBuilder().setName('setup-audit').setDescription('Set the audit log channel (Admin)')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel for audit logs').setRequired(true)),
    new SlashCommandBuilder().setName('setup-verify').setDescription('Enable verification with a role (Admin)')
      .addRoleOption((o) => o.setName('role').setDescription('Role to give verified members').setRequired(true)),
    new SlashCommandBuilder().setName('disable-verify').setDescription('Disable verification (Admin)'),
    new SlashCommandBuilder().setName('protect-role').setDescription('Protect a role from deletion/tampering (Admin)')
      .addRoleOption((o) => o.setName('role').setDescription('Role to protect').setRequired(true)),
    new SlashCommandBuilder().setName('unprotect-role').setDescription('Remove role protection (Admin)')
      .addRoleOption((o) => o.setName('role').setDescription('Role to unprotect').setRequired(true)),
    new SlashCommandBuilder().setName('scan').setDescription('Run a full security scan of this server (Mod)'),
    new SlashCommandBuilder().setName('risk').setDescription('Assess a member\'s security risk')
      .addUserOption((o) => o.setName('user').setDescription('Member to assess').setRequired(true)),
    new SlashCommandBuilder().setName('secure-mode').setDescription('Panic mode: freeze chat, disable invites (Admin)')
      .addIntegerOption((o) => o.setName('minutes').setDescription('Duration in minutes').setMinValue(1).setMaxValue(1440)),
    new SlashCommandBuilder().setName('secure-end').setDescription('End secure mode and restore channels (Admin)'),
    new SlashCommandBuilder().setName('webhooks').setDescription('List all webhooks and flag suspicious ones (Mod)'),
    new SlashCommandBuilder().setName('bots').setDescription('List all bots and their dangerous permissions'),
    new SlashCommandBuilder().setName('backup').setDescription('Export full server structure backup (Admin)'),
    new SlashCommandBuilder().setName('newaccounts').setDescription('List members with young accounts (Mod)')
      .addIntegerOption((o) => o.setName('days').setDescription('Account max age in days').setMinValue(1).setMaxValue(90)),
    new SlashCommandBuilder().setName('ghost-pings').setDescription('Show recent ghost pings (Mod)'),
    new SlashCommandBuilder().setName('set-access').setDescription('Restrict who can use the bot (Admin)')
      .addStringOption((o) => o.setName('mode').setDescription('Access mode').setRequired(true).addChoices(
        { name: 'Everyone', value: 'everyone' },
        { name: 'Allowlist only', value: 'allowlist' },
      )),
    new SlashCommandBuilder().setName('allow').setDescription('Allow a user/role to use the bot (Admin)')
      .addUserOption((o) => o.setName('user').setDescription('User to allow'))
      .addRoleOption((o) => o.setName('role').setDescription('Role to allow')),
    new SlashCommandBuilder().setName('deny').setDescription('Remove a user/role from the allowlist (Admin)')
      .addUserOption((o) => o.setName('user').setDescription('User to remove'))
      .addRoleOption((o) => o.setName('role').setDescription('Role to remove')),
    new SlashCommandBuilder().setName('access').setDescription('View bot access control'),
    new SlashCommandBuilder().setName('set-welcome').setDescription('Enable welcome messages in a channel (Admin)')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel for welcome messages').setRequired(true)),
    new SlashCommandBuilder().setName('set-welcome-message').setDescription('Set the welcome message template (Admin)')
      .addStringOption((o) => o.setName('message').setDescription('Template: {mention} {user} {userTag} {guild} {memberCount}').setRequired(true)),
    new SlashCommandBuilder().setName('disable-welcome').setDescription('Disable welcome messages (Admin)'),
    new SlashCommandBuilder().setName('set-farewell').setDescription('Enable farewell messages in a channel (Admin)')
      .addChannelOption((o) => o.setName('channel').setDescription('Channel for farewell messages').setRequired(true)),
    new SlashCommandBuilder().setName('set-farewell-message').setDescription('Set the farewell message template (Admin)')
      .addStringOption((o) => o.setName('message').setDescription('Template: {mention} {user} {userTag} {guild} {memberCount}').setRequired(true)),
    new SlashCommandBuilder().setName('disable-farewell').setDescription('Disable farewell messages (Admin)'),
    new SlashCommandBuilder().setName('botinfo').setDescription('Show the bot\'s role, permissions and powers'),
    new SlashCommandBuilder().setName('speak').setDescription('Make the bot speak out loud in your voice channel')
      .addStringOption((o) => o.setName('text').setDescription('Text to speak').setRequired(true)),
    new SlashCommandBuilder().setName('voicelang').setDescription('Set the TTS language (Admin)')
      .addStringOption((o) => o.setName('lang').setDescription('e.g. ta (Tamil), en, hi, te, ml, kn, bn').setRequired(true)),
    new SlashCommandBuilder().setName('alive').setDescription('Monitor mic activity in a voice channel (Mod)')
      .addStringOption((o) => o.setName('state').setDescription('on or off').setRequired(true).addChoices(
        { name: 'On', value: 'on' },
        { name: 'Off', value: 'off' },
      )),
    new SlashCommandBuilder().setName('listen').setDescription('Transcribe what people say in voice (Mod)')
      .addStringOption((o) => o.setName('state').setDescription('on or off').setRequired(true).addChoices(
        { name: 'On', value: 'on' },
        { name: 'Off', value: 'off' },
      )),
    new SlashCommandBuilder().setName('sttlang').setDescription('Set transcript language, e.g. ta (Admin)')
      .addStringOption((o) => o.setName('lang').setDescription('ta, en, hi or auto').setRequired(true)),
    new SlashCommandBuilder().setName('mention').setDescription('Mention someone many times (Mod, max 50)')
      .addUserOption((o) => o.setName('user').setDescription('User to mention').setRequired(true))
      .addIntegerOption((o) => o.setName('count').setDescription('How many times (1-50)').setRequired(false)),
    new SlashCommandBuilder().setName('settings').setDescription('Show security settings summary'),
  ];
}

module.exports = { handle, buildCommands, endSecureMode };
