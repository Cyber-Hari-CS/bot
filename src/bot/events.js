const { Events, PermissionFlagsBits, GuildAuditLogsEvent } = require('discord.js');
const store = require('../store');
const audit = require('./modules/auditLogger');
const antiSpam = require('./modules/antiSpam');
const autoMod = require('./modules/autoMod');
const antiRaid = require('./modules/antiRaid');
const antiNuke = require('./modules/antiNuke');
const restore = require('./modules/restore');
const inviteTracker = require('./modules/inviteTracker');
const verification = require('./modules/verification');
const { isTrusted } = require('./modules/access');
const { handlePrefix } = require('./prefixCommands');
const perms = require('./modules/perms');
const joinLog = require('./modules/joinLog');
const tempVoice = require('./modules/tempVoice');
const autoResponder = require('./modules/autoResponder');
const levels = require('./modules/levels');
const mediaLock = require('./modules/mediaLock');
const giveaway = require('./modules/giveaway');
const tickets = require('./modules/tickets');

function applyPunishment(guild, member, settings, result) {
  const map = {
    spam: { action: settings.antiSpam.action, minutes: settings.antiSpam.timeoutMinutes },
    mentions: { action: settings.antiSpam.mentionAction, minutes: settings.antiSpam.timeoutMinutes },
    'banned-word': { action: 'timeout', minutes: settings.autoMod.timeoutMinutes },
    invite: { action: 'timeout', minutes: settings.autoMod.timeoutMinutes },
    link: { action: 'timeout', minutes: settings.autoMod.timeoutMinutes },
    caps: { action: 'timeout', minutes: settings.autoMod.timeoutMinutes },
    everyone: { action: 'timeout', minutes: settings.autoMod.timeoutMinutes },
  };
  const p = map[result.type] || { action: 'timeout', minutes: 5 };

  if (p.action === 'timeout') {
    member.timeout(p.minutes * 60000, `Auto-mod: ${result.reason}`).then(() => {
      audit.emit(guild, 'automod', '⛔ Auto-Mod Action', `**${member.user.tag}** was timed out for ${p.minutes} min.\nReason: ${result.reason}`, 0xed4245);
    }).catch(() => {});
  } else if (p.action === 'kick') {
    member.kick(`Auto-mod: ${result.reason}`).then(() => {
      audit.emit(guild, 'automod', '⛔ Auto-Mod Action', `**${member.user.tag}** was kicked.\nReason: ${result.reason}`, 0xed4245);
    }).catch(() => {});
  } else if (p.action === 'ban') {
    member.ban({ reason: `Auto-mod: ${result.reason}` }).then(() => {
      audit.emit(guild, 'automod', '⛔ Auto-Mod Action', `**${member.user.tag}** was banned.\nReason: ${result.reason}`, 0xed4245);
    }).catch(() => {});
  }
  store.pushAlert(guild.id, {
    type: 'automod',
    level: p.action === 'ban' ? 'critical' : 'warning',
    title: 'Auto-Mod Action',
    message: `${result.reason} → ${p.action} on ${member.user.tag}`,
    userId: member.id,
  });
}

function fillTemplate(tpl, member) {
  return (tpl || '')
    .replace(/{mention}/g, `<@${member.id}>`)
    .replace(/{user}/g, member.user.username)
    .replace(/{userTag}/g, member.user.tag)
    .replace(/{guild}/g, member.guild.name)
    .replace(/{memberCount}/g, member.guild.memberCount);
}

module.exports = {
  [Events.ClientReady]: async (client) => {
    client.user.setActivity('🛡️ security dashboard', { type: 3 });
    console.log(`[BOT] Logged in as ${client.user.tag} (${client.user.id})`);

    const guilds = await client.guilds.fetch();
    for (const g of guilds.values()) {
      try {
        const guild = await g.fetch();
        console.log(`[BOT] Watching guild: ${guild.name} (${guild.id}) — ${guild.memberCount} members`);
      } catch {}
    }

    const { REST, Routes } = require('discord.js');
    const { buildCommands } = require('./commands');
    const config = require('../config');
    const rest = new REST({ version: '10' }).setToken(config.token);
    try {
      await rest.put(Routes.applicationCommands(client.user.id), { body: buildCommands().map((c) => c.toJSON()) });
      console.log(`[BOT] Registered ${buildCommands().length} slash commands globally`);
    } catch (e) {
      console.error('[BOT] Failed to register commands:', e.message);
    }

    client.guilds.cache.forEach((g) => {
      restore.cacheGuild(g);
      inviteTracker.track(g);
    });
  },

  [Events.InteractionCreate]: async (interaction) => {
    if (interaction.isChatInputCommand()) {
      const { handle } = require('./commands');
      try {
        if (interaction.guildId) {
          const settings = store.guildSettings(interaction.guildId);
          const access = settings.access || { mode: 'everyone', users: [], roles: [] };
          if (access.mode === 'allowlist') {
            const isOwner = interaction.guild.ownerId === interaction.user.id;
            const isAdmin = interaction.member?.permissions.has(PermissionFlagsBits.Administrator);
            const allowedUser = (access.users || []).includes(interaction.user.id);
            const allowedRole = (access.roles || []).some((r) => interaction.member?.roles.cache.has(r));
            if (!isOwner && !isAdmin && !allowedUser && !allowedRole) {
              return interaction.reply({ content: '🔒 This bot is restricted — contact a server admin to get access.', flags: 64 });
            }
          }
        }
        await handle(interaction);
      } catch (e) {
        console.error('[CMD]', interaction.commandName, e);
        if (!interaction.replied && !interaction.deferred) {
          interaction.reply({ content: '❌ Something went wrong running this command.', flags: 64 }).catch(() => {});
        }
      }
      return;
    }

    if (interaction.isButton()) {
      const settings = store.guildSettings(interaction.guildId);
      const id = interaction.customId;

      if (id === 'giveaway_enter') {
        let g = store.data.giveaways && Object.values(store.data.giveaways).find((x) => x.channelId === interaction.channelId);
        if (!g) return interaction.reply({ content: '❌ This giveaway is no longer active.', flags: 64 });
        const already = g.entries.includes(interaction.user.id);
        g.entries = g.entries.filter((e) => e !== interaction.user.id);
        if (!already) g.entries.push(interaction.user.id);
        store.save();
        return interaction.reply({ content: already ? '❌ You left the giveaway.' : `✅ You entered the giveaway — ${g.entries.length} entrant(s).`, flags: 64 });
      }

      if (id === 'ticket_open') {
        if (!settings.tickets || !settings.tickets.enabled) {
          return interaction.reply({ content: '❌ Ticket system is not enabled.', flags: 64 });
        }
        try {
          await tickets.createTicket(interaction);
        } catch (e) {
          console.error('[TICKET]', e);
          if (!interaction.replied && !interaction.deferred) {
            interaction.reply({ content: `❌ Could not open a ticket: ${e.message}`, flags: 64 }).catch(() => {});
          }
        }
        return;
      }

      if (id === 'ticket_close') {
        if (!tickets.isTicketChannel(interaction.channel)) {
          return interaction.reply({ content: '❌ This is not a ticket channel.', flags: 64 });
        }
        if (!tickets.hasSupportPerms(interaction.member, settings)) {
          return interaction.reply({ content: '❌ Staff permission required to close tickets.', flags: 64 });
        }
        await interaction.reply({ content: '🔒 Closing ticket...', flags: 64 });
        try {
          await tickets.closeTicket(interaction.channel, interaction.user, 'Closed via button');
        } catch (e) {
          console.error('[TICKET]', e);
        }
        return;
      }
    }
  },

  [Events.MessageCreate]: async (message) => {
    if (message.author.bot) return;

    // DM verification answers
    if (message.guildId === null) {
      const active = verification.findActiveSession(message.author.id);
      if (active) {
        const res = verification.checkAnswer(active.token, message.content, message.author);
        if (res.ok) {
          const settings = store.guildSettings(active.guildId);
          const guild = message.client.guilds.cache.get(active.guildId);
          if (guild) {
            const member = guild.members.cache.get(message.author.id) || (await guild.members.fetch(message.author.id).catch(() => null));
            if (member) {
              const role = guild.roles.cache.get(settings.verification.roleId);
              if (role) await member.roles.add(role).catch(() => {});
              verification.markVerified(active.guildId, message.author.id, 'captcha');
              audit.verify(guild, message.author, 'captcha');
              store.pushAlert(active.guildId, {
                type: 'verify', level: 'info', title: 'Member Verified',
                message: `${message.author.tag} completed verification`,
              });
              return message.reply('✅ **Verified!** You now have access to the server. Welcome aboard!');
            }
          }
          return message.reply('✅ Verified! You can now join the server and you\'re all set.');
        }
        return message.reply(`❌ ${res.error}`);
      }
      return;
    }

    const settings = store.guildSettings(message.guildId);
    store.touchUserMessages(message.guildId, message.author.id, message.author.tag);
    if (!message.member) return;

    const handled = await handlePrefix(message.client, message);
    if (handled) return;

    mediaLock.checkMessage(message, settings).catch(() => {});

    const responded = autoResponder.handleMessage(message);
    if (responded) return;

    levels.onMessage(message, settings).catch(() => {});

    const trusted = isTrusted(message.member, settings);

    // Auto-mod filters
    const modHit = autoMod.check(message, settings.autoMod);
    if (modHit) {
      if (!trusted) {
        message.delete().catch(() => {});
        applyPunishment(message.guild, message.member, settings, modHit);
      } else {
        store.pushAlert(message.guildId, { type: 'automod_bypass', level: 'info', title: 'Trusted Bypass', message: `${message.author.tag} bypassed filter: ${modHit.reason}` });
      }
      return;
    }

    // Anti-spam
    if (!trusted) {
      const spamHit = antiSpam.check(message.guild, message.member, message, settings.antiSpam);
      if (spamHit) {
        applyPunishment(message.guild, message.member, settings, spamHit);
      }
    }
  },

  [Events.MessageDelete]: (message) => {
    if (!message.guild || message.author?.bot) return;
    if (message.mentions?.users?.size && !message.member?.permissions?.has('ManageMessages')) {
      const ghost = store.pushGhostPing({
        guildId: message.guild.id,
        userId: message.author.id,
        tag: message.author.tag,
        channelId: message.channel.id,
        channelName: message.channel.name || 'unknown',
        content: (message.content || '').slice(0, 150),
        mentions: message.mentions.users.size + message.mentions.roles.size,
      });
      audit.emit(message.guild, 'ghost_ping', '👻 Ghost Ping', `**${message.author.tag}** pinged ${ghost.mentions} user(s)/role(s) then deleted the message in <#${message.channel.id}>.\n\`\`\`${ghost.content}\`\`\``, 0xfee75c);
      store.pushAlert(message.guild.id, {
        type: 'ghost_ping', level: 'warning', title: 'Ghost Ping',
        message: `${message.author.tag} ghost-pinged ${ghost.mentions} target(s) in #${message.channel.name}`,
        userId: message.author.id,
      });
    }
    const settings = store.guildSettings(message.guildId);
    if (!settings.audit.enabled || !settings.audit.logMessages) return;
    audit.messageDeleted(message.guild, message);
  },

  [Events.MessageUpdate]: (oldMessage, newMessage) => {
    if (!oldMessage.guild || oldMessage.author?.bot) return;
    if (oldMessage.content === newMessage.content) return;
    const settings = store.guildSettings(oldMessage.guildId);
    if (!settings.audit.enabled || !settings.audit.logMessages) return;
    audit.messageEdited(oldMessage.guild, oldMessage, newMessage);
  },

  [Events.GuildMemberAdd]: async (member) => {
    const settings = store.guildSettings(member.guild.id);
    store.joinUser(member.guild.id, member.user.id, member.user.tag);

    joinLog.logJoin(member, settings);

    const w = settings.welcome;
    if (w.enabled && w.channelId) {
      const ch = member.guild.channels.cache.get(w.channelId);
      if (ch && ch.isTextBased()) {
        ch.send(fillTemplate(w.message, member)).catch(() => {});
      }
    }

    if (!member.user.bot) {
      if (settings.autoRole.enabled && settings.autoRole.roleId) {
        const role = member.guild.roles.cache.get(settings.autoRole.roleId);
        if (role) member.roles.add(role, 'auto-role').catch(() => {});
      }
      if (settings.autoNick.enabled) {
        member.setNickname(`${settings.autoNick.prefix || ''}${member.user.username}${settings.autoNick.suffix || ''}`, 'auto-nick').catch(() => {});
      }
    }

    if (member.user.bot) {
      if (settings.antiNuke.kickBotsOnJoin) {
        let trustedAdd = false;
        try {
          const logs = await member.guild.fetchAuditLogs({ type: GuildAuditLogsEvent.BotAdd, limit: 5 });
          const entry = logs.entries.find((e) => e.target && e.target.id === member.user.id);
          if (entry && entry.executor) {
            const executorMember = member.guild.members.cache.get(entry.executor.id);
            if (executorMember && isTrusted(executorMember, settings)) trustedAdd = true;
          }
        } catch {}
        if (!trustedAdd) {
          const kicked = await member.kick('Anti-bot: bots must be added by trusted staff').then(() => true).catch(async () => {
            return member.ban({ reason: 'Anti-bot: bots must be added by trusted staff' }).then(() => true).catch(() => false);
          });
          store.pushAlert(member.guild.id, {
            type: 'bot_kicked', level: 'critical', title: '🤖 Bot Removed',
            message: `${member.user.tag} (${member.user.id}) was ${kicked ? 'kicked' : 'attempted to be removed'} — bots must be added by trusted staff`,
            userId: member.user.id,
          });
          audit.emit(member.guild, 'bot_kicked', '🤖 Bot Kicked', `**${member.user.tag}** joined but was not added by a trusted member — ${kicked ? 'kicked from the server' : 'removal failed (check bot permissions)'}.`, 0xed4245);
          if (!kicked) {
            store.pushAlert(member.guild.id, {
              type: 'nuke', level: 'critical', title: '⚠️ Bot Removal Failed',
              message: `Could not kick ${member.user.tag} — verify the bot has Kick Members permission`,
            });
          }
          return;
        }
      }
      const nuked = await antiNuke.check(member.guild, 'bot', null, 'new bot added');
      store.pushAlert(member.guild.id, {
        type: 'bot_join', level: nuked ? 'critical' : 'warning', title: 'Bot Joined',
        message: `${member.user.tag} (${member.user.id}) joined the server`,
        userId: member.user.id,
      });
    }

    const res = antiRaid.checkJoin(member.guild, member, settings.antiRaid);

    if (res.raid) {
      store.pushAlert(member.guild.id, {
        type: 'raid_join', level: 'critical', title: 'Raid Join',
        message: `${member.user.tag} joined during active lockdown (${res.joins} joins in ${settings.antiRaid.windowSec}s)`,
        userId: member.user.id,
      });
      try {
        await member.timeout(settings.antiRaid.lockdownDurationMin * 60000, 'Auto-locked during raid');
      } catch {}
      audit.emit(member.guild, 'lockdown_join', '🔒 Lockdown Join', `**${member.user.tag}** joined during a raid lockdown and was timed out.`, 0xed4245);
      return;
    }

    if (settings.audit.enabled && settings.audit.logMembers) {
      audit.memberJoin(member.guild, member);
      const inv = await inviteTracker.usedInvite(member.guild);
      if (inv) {
        audit.emit(member.guild, 'member_join_invite', 'Invite Used', `**${member.user.tag}** joined using invite **discord.gg/${inv.code}** created by **${inv.inviter}**.`, 0x57f287);
      }
    }

    if (settings.verification.enabled && settings.verification.roleId) {
      try {
        const dm = await member.user.createDM();
        const challenge = verification.createChallenge(member);
        await dm.send(`🛡️ **${member.guild.name}** — Verification required\nPlease solve: ${challenge.text}\n\nReply with the answer in this DM to unlock the server.`);
        store.pushAlert(member.guild.id, {
          type: 'verify_pending', level: 'info', title: 'Verification Required',
          message: `${member.user.tag} was sent a verification challenge`,
          userId: member.user.id,
        });
      } catch {
        store.pushAlert(member.guild.id, {
          type: 'verify_dm_failed', level: 'warning', title: 'Verification DM Failed',
          message: `${member.user.tag} could not receive the verification DM (DMs disabled)`,
          userId: member.user.id,
        });
      }
    }
  },

  [Events.GuildBanAdd]: (ban) => {
    const settings = store.guildSettings(ban.guild.id);
    if (!settings.audit.enabled) return;
    ban.guild.fetchAuditLogs({ type: 22, limit: 1 }).then((logs) => {
      const entry = logs.entries.first();
      if (entry && entry.target?.id === ban.user.id) {
        audit.memberBanned(ban.guild, ban.user, entry.reason || 'No reason provided');
      } else {
        audit.memberBanned(ban.guild, ban.user);
      }
    }).catch(() => audit.memberBanned(ban.guild, ban.user));
  },

  [Events.GuildBanRemove]: (ban) => {
    const settings = store.guildSettings(ban.guild.id);
    if (settings.audit.enabled) audit.memberUnbanned(ban.guild, ban.user);
  },

  [Events.ChannelCreate]: (channel) => {
    if (!channel.guild) return;
    restore.updateChannel(channel);
    const settings = store.guildSettings(channel.guild.id);
    if (settings.audit.enabled && settings.audit.logChannels) audit.channelCreated(channel.guild, channel);
  },

  [Events.ChannelUpdate]: (oldChannel, newChannel) => {
    if (!newChannel.guild) return;
    restore.updateChannel(newChannel);
  },

  [Events.ChannelDelete]: async (channel) => {
    if (!channel.guild) return;
    const settings = store.guildSettings(channel.guild.id);
    if (settings.audit.enabled && settings.audit.logChannels) audit.channelDeleted(channel.guild, channel);
    try {
      const logs = await channel.guild.fetchAuditLogs({ type: GuildAuditLogsEvent.ChannelDelete, limit: 1 });
      const entry = logs.entries.first();
      if (entry) {
        const nuked = await antiNuke.check(channel.guild, 'channelDelete', entry.executor, entry.reason);
        if (nuked || restore.shouldRestore(channel.guild.id)) {
          const restored = await restore.restoreChannel(channel.guild, channel.id);
          if (restored) {
            audit.emit(channel.guild, 'channel_restore', '🔄 Channel Restored', `**#${channel.name}** was restored by anti-nuke protection.`, 0x57f287);
            store.pushAlert(channel.guild.id, { type: 'restore', level: 'info', title: 'Channel Restored', message: `#${channel.name} was restored automatically` });
          }
        }
      }
    } catch {}
  },

  [Events.RoleCreate]: async (role) => {
    if (!role.guild) return;
    restore.updateRole(role);
    const settings = store.guildSettings(role.guild.id);
    try {
      const logs = await role.guild.fetchAuditLogs({ type: GuildAuditLogsEvent.RoleCreate, limit: 1 });
      const entry = logs.entries.first();
      if (entry && entry.executor && entry.executor.id !== role.guild.client.user.id) {
        if (role.permissions.has(PermissionFlagsBits.Administrator)) {
          const isAdmin = entry.executor.id === role.guild.ownerId ||
            (role.guild.members.cache.get(entry.executor.id)?.permissions.has(PermissionFlagsBits.Administrator));
          if (!isAdmin) {
            await role.delete('Anti-nuke: unauthorized admin role creation').catch(() => {});
            store.pushAlert(role.guild.id, {
              type: 'nuke', level: 'critical', title: '⚠️ Unauthorized Admin Role',
              message: `${entry.executor.tag} created an Administrator role — it was deleted`,
              userId: entry.executor.id,
            });
            if (!antiRaid.isActive(role.guild.id)) antiRaid.triggerRaid(role.guild, { lockdownDurationMin: settings.antiNuke.lockdownMinutes });
            const actor = role.guild.members.cache.get(entry.executor.id);
            if (actor && actor.moderatable) await actor.timeout(settings.antiNuke.lockdownMinutes * 60000, 'Anti-nuke: admin role creation').catch(() => {});
          }
        }
      }
    } catch {}
  },

  [Events.RoleUpdate]: async (oldRole, newRole) => {
    if (!newRole.guild) return;
    restore.updateRole(newRole);
    const settings = store.guildSettings(newRole.guild.id);
    if (!restore.isProtectedRole(newRole, settings)) return;
    if (oldRole.permissions.bitfield !== newRole.permissions.bitfield || oldRole.name !== newRole.name) {
      try {
        await newRole.setPermissions(oldRole.permissions.bitfield, 'Anti-nuke: protected role permissions reverted').catch(() => {});
        await newRole.setName(oldRole.name, 'Anti-nuke: protected role name reverted').catch(() => {});
        const logs = await newRole.guild.fetchAuditLogs({ type: GuildAuditLogsEvent.RoleUpdate, limit: 1 });
        const entry = logs.entries.first();
        store.pushAlert(newRole.guild.id, {
          type: 'nuke', level: 'critical', title: '⚠️ Protected Role Tampered',
          message: `**${newRole.name}** was modified${entry && entry.executor ? ` by **${entry.executor.tag}**` : ''} — changes reverted`,
          userId: entry ? entry.executor?.id : undefined,
        });
        audit.emit(newRole.guild, 'role_revert', '🔄 Role Changes Reverted', `**${newRole.name}** is a protected role — permission/name changes were rolled back.`, 0xfee75c);
        if (entry && entry.executor && !entry.executor.bot) {
          const actor = newRole.guild.members.cache.get(entry.executor.id);
          if (actor && actor.moderatable) await actor.timeout(settings.antiNuke.lockdownMinutes * 60000, 'Anti-nuke: protected role tampering').catch(() => {});
        }
      } catch {}
    }
  },

  [Events.RoleDelete]: async (role) => {
    if (!role.guild) return;
    const settings = store.guildSettings(role.guild.id);
    try {
      const logs = await role.guild.fetchAuditLogs({ type: GuildAuditLogsEvent.RoleDelete, limit: 1 });
      const entry = logs.entries.first();
      if (entry) {
        const nuked = await antiNuke.check(role.guild, 'roleDelete', entry.executor, entry.reason);
        const protectedRole = restore.isProtectedRole(role, settings) || nuked;
        if (protectedRole || restore.shouldRestore(role.guild.id)) {
          const restored = await restore.restoreRole(role.guild, role.id);
          if (restored) {
            audit.emit(role.guild, 'role_restore', '🔄 Role Restored', `**${role.name}** was restored by anti-nuke protection.`, 0x57f287);
            store.pushAlert(role.guild.id, { type: 'restore', level: 'info', title: 'Role Restored', message: `${role.name} was restored automatically` });
          }
        }
      }
    } catch {}
  },

  [Events.GuildBanAdd]: async (ban) => {
    const settings = store.guildSettings(ban.guild.id);
    if (settings.audit.enabled) {
      ban.guild.fetchAuditLogs({ type: 22, limit: 1 }).then((logs) => {
        const entry = logs.entries.first();
        if (entry && entry.target?.id === ban.user.id) {
          audit.memberBanned(ban.guild, ban.user, entry.reason || 'No reason provided');
        } else {
          audit.memberBanned(ban.guild, ban.user);
        }
      }).catch(() => audit.memberBanned(ban.guild, ban.user));
    }
    try {
      const logs = await ban.guild.fetchAuditLogs({ type: GuildAuditLogsEvent.MemberBanAdd, limit: 1 });
      const entry = logs.entries.first();
      if (entry) await antiNuke.check(ban.guild, 'ban', entry.executor, entry.reason);
    } catch {}
  },

  [Events.GuildMemberRemove]: async (member) => {
    const settings = store.guildSettings(member.guild.id);
    if (settings.audit.enabled && settings.audit.logMembers) audit.memberLeave(member.guild, member);
    joinLog.logLeave(member, settings);
    const f = settings.farewell;
    if (f.enabled && f.channelId) {
      const ch = member.guild.channels.cache.get(f.channelId);
      if (ch && ch.isTextBased()) {
        ch.send(fillTemplate(f.message, member)).catch(() => {});
      }
    }
    try {
      const logs = await member.guild.fetchAuditLogs({ type: GuildAuditLogsEvent.MemberKick, limit: 1 });
      const entry = logs.entries.first();
      if (entry && entry.target?.id === member.id && Date.now() - entry.createdTimestamp < 10000) {
        await antiNuke.check(member.guild, 'kick', entry.executor, entry.reason);
      }
    } catch {}
  },

  [Events.WebhooksUpdate]: async (channel) => {
    if (!channel.guild) return;
    const settings = store.guildSettings(channel.guild.id);
    try {
      const logs = await channel.guild.fetchAuditLogs({ type: GuildAuditLogsEvent.WebhookCreate, limit: 1 });
      const entry = logs.entries.first();
      if (entry && Date.now() - entry.createdTimestamp < 10000) {
        await antiNuke.check(channel.guild, 'webhook', entry.executor, entry.reason);
      }
    } catch {}
  },

  [Events.VoiceStateUpdate]: (oldState, newState) => {
    tempVoice.onVoiceStateUpdate(oldState, newState).catch((e) => console.error('[TEMPVOICE]', e));
  },
};
