const fs = require('fs');
const path = require('path');
const { PermissionFlagsBits, ChannelType } = require('discord.js');
const store = require('../store');
const audit = require('./modules/auditLogger');
const antiRaid = require('./modules/antiRaid');
const security = require('./modules/security');
const access = require('./modules/access');
const voice = require('./modules/voice');
const { endSecureMode } = require('./commands');
const config = require('../config');

const voiceSessions = new Map();
const scheduledAlerts = new Map();

const CATALOG = [
  { cat: '📊 Info & System', level: 'everyone', items: [
    ['help', 'help | h | hlp', 'Open the help interface'],
    ['cmdlist', 'cmdlist | list | cmds', 'List all commands'],
    ['ping', 'ping | p', 'Bot latency and API roundtrip'],
    ['about', 'about | stats', 'Bot uptime and versions'],
  ]},
  { cat: '🛡️ Server Security', level: 'everyone', items: [
    ['backup', 'backup', 'Take a full server structure backup'],
    ['restore', 'restore', 'Restore server layout from backup (Admin)'],
    ['whitelist', 'whitelist | wl | trust', 'Manage bot/whitelist access (Admin)'],
    ['autorole', 'autorole | ar', 'Auto role for joining members (Admin)'],
    ['autonick', 'autonick | an', 'Auto nickname for joining members (Admin)'],
    ['vc247', 'vc247 | 247', 'Keep the bot in a voice channel 24/7 (Admin)'],
    ['lockdown', 'lockdown | panic | freeze', 'Freeze all channels (Admin)'],
    ['unlock', 'unlock | unfreeze', 'Lift lockdown and restore perms (Admin)'],
    ['fixoverwrites', 'fixoverwrites | fixperms', 'Repair broken channel permissions (Admin)'],
    ['deletechannels', 'deletechannels', '⚠️ Wipe all channels (Owner, needs confirm)'],
    ['deleteroles', 'deleteroles', '⚠️ Wipe all custom roles (Owner, needs confirm)'],
    ['deleteall', 'deleteall | wipe', '⚠️ Wipe everything (Owner, needs confirm)'],
  ]},
  { cat: '🔨 Moderation', level: 'mod', items: [
    ['ban', 'ban | b', 'Ban a user'],
    ['unban', 'unban | ub', 'Unban a user'],
    ['unbanall', 'unbanall', 'Unban everyone'],
    ['kick', 'kick | k', 'Kick a user'],
    ['mute', 'mute | m', 'Timeout a user'],
    ['unmute', 'unmute | um', 'Remove timeout'],
    ['nuke', 'nuke | n', 'Clone the channel and wipe messages'],
    ['cleanwebhooks', 'cleanwebhooks | delwebhooks', 'Delete all webhooks (Admin)'],
    ['hide', 'hide | h', 'Hide channel from @everyone'],
    ['unhide', 'unhide | uh', 'Unhide channel for @everyone'],
    ['role', 'role | r', 'Add/remove/toggle a role'],
    ['roleall', 'roleall', 'Give a role to all humans (Owner)'],
    ['rolebots', 'rolebots', 'Give a role to all bots (Owner)'],
    ['kickall', 'kickall | masskick', '⚠️ Kick all non-whitelisted (Owner, confirm)'],
    ['banall', 'banall | massban', '⚠️ Ban all non-whitelisted (Owner, confirm)'],
    ['timeoutall', 'timeoutall | masstimeout', '⚠️ 24h timeout all non-whitelisted (Owner, confirm)'],
    ['invitepurge', 'invitepurge', 'Delete all invites (Owner)'],
    ['wordblock', 'wordblock | blockword', 'Manage banned words (Admin)'],
    ['leaveserver', 'leaveserver | guilds', 'Force bot to leave a server (Owner)'],
    ['cleardm', 'cleardm', 'Clear the bot\'s own DM messages with a user (Owner)'],
  ]},
  { cat: '⏰ Alerts', level: 'mod', items: [
    ['alert', 'alert | setalert', 'Schedule an alert message'],
  ]},
  { cat: '🔊 Voice & Mic', level: 'everyone', items: [
    ['speak', 'speak | say | tts | loud | voice', 'Make the bot speak out loud (TTS)'],
    ['speakstop', 'speakstop | stop', 'Stop the bot speaking'],
    ['voicelang', 'voicelang | lang', 'Set TTS language (Admin)'],
    ['mention', 'mention | pingthem', 'Mention someone many times (Mod, max 50)'],
    ['listen', 'listen | transcribe | hear | stt', 'Transcribe what people say in VC (Mod)'],
    ['sttlang', 'sttlang | listenlang', 'Set transcript language, e.g. ta (Admin)'],
    ['alive', 'alive | mic | micmonitor', 'Report who is speaking in voice (Mod)'],
  ]},
  { cat: '⚙️ Developer & Profiles', level: 'everyone', items: [
    ['profile', 'profile | badge', 'Your warnings, verification and risk'],
    ['whois', 'whois | user', 'Full account details of a user'],
    ['rank', 'rank | level', 'Your chat level and XP'],
    ['leaderboard', 'leaderboard | lb | top', 'Messages / level leaderboard'],
    ['botstats', 'botstats | stats | dev', 'Developer info: uptime, memory, versions'],
    ['eval', 'eval | ev', '⚠️ Evaluate code (Owner only)'],
  ]},
  { cat: '🪙 Game & Economy', level: 'everyone', items: [
    ['balance', 'balance | bal | coins', 'Check your coin balance'],
    ['daily', 'daily | claim', 'Claim daily coins'],
    ['work', 'work | earn', 'Work for coins (1h cooldown)'],
    ['pay', 'pay <user> <amount>', 'Send coins to a user'],
    ['gamble', 'gamble <amount>', 'Coin flip — double or lose'],
    ['rich', 'rich | richlist', 'Richest members'],
  ]},
  { cat: '🧪 Quarantine & Ownership', level: 'mod', items: [
    ['quarantine', 'quarantine <user> [reason]', 'Strip all roles and isolate a member (Mod)'],
    ['unquarantine', 'unquarantine <user>', 'Release and restore roles (Mod)'],
    ['extraowner', 'extraowner | coowner', 'Manage extra owners (Admin)'],
    ['roleauth', 'roleauth', 'Require roles for commands (Admin)'],
  ]},
  { cat: '🖼️ Media & Channels', level: 'mod', items: [
    ['media', 'media add <#channel>', 'Make a channel media-only (Admin)'],
    ['tempvoice', 'tempvoice <on|off>', 'Temporary voice channels (Admin)'],
    ['vc', 'vc kick|mute|move <user>', 'Voice management (Mod)'],
  ]},
  { cat: '💬 Automations', level: 'mod', items: [
    ['responder', 'responder | autoresponder', 'Keyword auto-replies (Admin)'],
    ['cc', 'cc | customcmd', 'Custom exact-word commands (Admin)'],
    ['giveaway', 'giveaway start <5m> <winners> <prize>', 'Start/end giveaways (Admin)'],
    ['activityrole', 'activityrole | lvlrole', 'Roles at message counts (Admin)'],
  ]},
  { cat: '📦 Miscellaneous', level: 'everyone', items: [
    ['antiraid', 'antiraid | settings', 'Toggle anti-raid gates'],
    ['ticket', 'ticket | tickets', 'Ticket system'],
  ]},
];

function normalize(text) {
  const m = text.match(/^<@!?(\d+)>$/);
  return m ? m[1] : /^\d+$/.test(text) ? text : null;
}

function resolveUser(text, guild) {
  const id = normalize(text);
  if (!id) return null;
  return guild.members.cache.get(id) || guild.client.users.cache.get(id) || null;
}

function resolveRole(text, guild) {
  const m = text.match(/^<@&(\d+)>$/);
  const id = m ? m[1] : /^\d+$/.test(text) ? text : null;
  if (!id) return null;
  return guild.roles.cache.get(id) || null;
}

function resolveChannel(text, guild) {
  const m = text.match(/^<#(\d+)>$/);
  const id = m ? m[1] : /^\d+$/.test(text) ? text : null;
  if (!id) return null;
  return guild.channels.cache.get(id) || null;
}

function reply(message, text) {
  return message.reply({ content: String(text).slice(0, 1900) }).catch(() => {});
}

async function applyBackup(guild, backup) {
  let roles = 0, channels = 0;
  for (const r of backup.roles || []) {
    try {
      await guild.roles.create({ name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions: r.permissions });
      roles++;
    } catch {}
  }
  for (const c of backup.channels || []) {
    try {
      await guild.channels.create({
        name: c.name, type: c.type, topic: c.topic, nsfw: c.nsfw,
        rateLimitPerUser: c.slowmode, bitrate: c.bitrate, userLimit: c.userLimit,
        parent: c.parentId || undefined,
        permissionOverwrites: (c.overwrites || []).map((o) => ({ id: o.id, type: o.type, allow: String(o.allow), deny: String(o.deny) })),
      });
      channels++;
    } catch {}
  }
  return { roles, channels };
}

async function handlePrefix(client, message) {
  const settings = store.guildSettings(message.guildId);
  const prefix = settings.prefix || '?';
  if (!message.content.startsWith(prefix)) return false;

  const rest = message.content.slice(prefix.length).trim();
  const parts = rest.split(/\s+/);
  const cmd = parts.shift().toLowerCase();
  const args = parts;

  const ALIASES = {
    help: ['help', 'hlp', 'h', 'commands'],
    cmdlist: ['cmdlist', 'list', 'cmds', 'clist', 'cl', 'l', 'rclist', 'c', 'cmd'],
    ping: ['ping', 'p'],
    about: ['about', 'stats'],
    backup: ['backup', 'serverbackup', 'backup-server'],
    restore: ['restore', 'loadbackup', 'restorebackup', 'restore-backup', 'load-backup'],
    whitelist: ['whitelist', 'wl', 'trust'],
    autorole: ['autorole', 'ar'],
    autonick: ['autonick', 'an', 'autonickname'],
    vc247: ['vc247', '247', 'vc24-7'],
    lockdown: ['lockdown', 'panic', 'freeze'],
    unlock: ['unlock', 'unfreeze'],
    fixoverwrites: ['fixoverwrites', 'repair', 'fixperms', 'fixchannels'],
    deleteall: ['deleteall', 'delall', 'wipe'],
    deletechannels: ['deletechannels', 'delchannels', 'wipechannels'],
    deleteroles: ['deleteroles', 'delroles', 'wiperoles'],
    ban: ['ban', 'b'],
    unban: ['unban', 'ub'],
    unbanall: ['unbanall', 'uball'],
    kick: ['kick', 'k'],
    kickall: ['kickall', 'masskick'],
    banall: ['banall', 'massban'],
    timeoutall: ['timeoutall', 'masstimeout'],
    mute: ['mute', 'm'],
    unmute: ['unmute', 'um'],
    nuke: ['nuke', 'n'],
    cleanwebhooks: ['cleanwebhooks', 'clearwebhooks', 'deletewebhooks', 'delwebhooks'],
    hide: ['hide', 'h'],
    unhide: ['unhide', 'uh'],
    role: ['role', 'r'],
    roleall: ['roleall', 'addroleall', 'roleallmembers'],
    rolebots: ['rolebots', 'rolebot'],
    leaveserver: ['leaveserver', 'leavesrv', 'serverleave', 'serverlist', 'guilds'],
    cleardm: ['cleardm', 'dmclear', 'purgedm', 'dmpurge', 'cleardms'],
    invitepurge: ['invitepurge', 'purgeinvites', 'delinvites', 'clearinvites'],
    wordblock: ['wordblock', 'blockword', 'blacklistword', 'filterword', 'wordsblock'],
    alert: ['alert', 'schedulealert', 'setalert'],
    eval: ['eval', 'ev'],
    profile: ['profile', 'badge'],
    whois: ['whois', 'user'],
    antiraid: ['antiraid', 'lockdownmode', 'securitysettings', 'settings'],
    ticket: ['ticket', 'tickets', 'tsetup'],
    speak: ['speak', 'say', 'tts', 'loud', 'voice'],
    mention: ['mention', 'spammention', 'pingthem', 'notify', 'mentionspam'],
    speakstop: ['speak-stop', 'stopspeak', 'stfu', 'quiet'],
    voicelang: ['voicelang', 'ttslang', 'lang', 'language'],
    alive: ['alive', 'mic', 'micmonitor', 'listen', 'vcmonitor'],
    listen: ['listen', 'transcribe', 'hear', 'stt'],
    sttlang: ['sttlang', 'listenlang', 'transcribelang'],
    rank: ['rank', 'level', 'lvl', 'xp'],
    leaderboard: ['leaderboard', 'lb', 'top', 'levels'],
    balance: ['balance', 'bal', 'coins', 'wallet', 'cash'],
    daily: ['daily', 'claim', 'dailycoins'],
    work: ['work', 'earn', 'job'],
    pay: ['pay', 'give', 'transfer', 'sendcoins'],
    gamble: ['gamble', 'bet', 'coinflip', 'flip'],
    rich: ['rich', 'richlist', 'richest'],
    quarantine: ['quarantine', 'quar', 'jail'],
    unquarantine: ['unquarantine', 'release', 'unjail'],
    extraowner: ['extraowner', 'coowner', 'addowner', 'extraowners'],
    roleauth: ['roleauth', 'auth'],
    media: ['media', 'medialock', 'mediaonly'],
    tempvoice: ['tempvoice', 'tv', 'tempvc'],
    vc: ['vc', 'voice', 'voicekick', 'vckick', 'vcmute'],
    responder: ['responder', 'autoresponder', 'ar', 'autoreply'],
    cc: ['cc', 'customcmd', 'customcommand', 'custom'],
    giveaway: ['giveaway', 'gw', 'gaw'],
    activityrole: ['activityrole', 'lvlrole', 'levelrole', 'activity'],
    botstats: ['botstats', 'stats', 'dev', 'developer', 'devinfo'],
    poll: ['poll', 'vote'],
    avatar: ['avatar', 'av', 'pfp'],
    banner: ['banner', 'bn'],
    serverinfo: ['serverinfo', 'server', 'guildinfo', 'si'],
    emoji: ['emoji', 'bigemoji', 'steal'],
  };

  let name = null;
  for (const [key, list] of Object.entries(ALIASES)) {
    if (list.includes(cmd)) { name = key; break; }
  }
  if (!name) return false;

  const isMod = access.isModerator(message.member, settings);
  const isOwner = access.isOwner(message.member, settings);
  const isAdmin = isOwner || message.member.permissions.has(PermissionFlagsBits.Administrator);

  switch (name) {
    case 'help': {
      const lines = CATALOG.map((c) => `**${c.cat}**\n${c.items.map((i) => `• \`${prefix}${i[0]}\` — ${i[2]}`).join('\n')}`).join('\n\n');
      return reply(message, `**🛡️ ${message.guild.name} — Security Bot Commands**\n\n${lines}\n\nUse \`${prefix}cmdlist\` for the full alias list.`);
    }

    case 'cmdlist': {
      const lines = CATALOG.map((c) => `**${c.cat}**\n${c.items.map((i) => `• \`${prefix}${i[0]}\` (${i[1]})`).join('\n')}`).join('\n\n');
      return reply(message, lines);
    }

    case 'ping': {
      const t0 = Date.now();
      const msg = await message.reply('Pinging...').catch(() => null);
      if (!msg) return;
      const roundtrip = Date.now() - t0;
      return msg.edit(`🏓 **Pong!**\nWebsocket heartbeat: **${client.ws.ping}ms**\nAPI roundtrip: **${roundtrip}ms**`).catch(() => {});
    }

    case 'about': {
      const up = process.uptime();
      const h = Math.floor(up / 3600), m = Math.floor((up % 3600) / 60), s = Math.floor(up % 60);
      return reply(message, `**🤖 About ${client.user.tag}**\nUptime: **${h}h ${m}m ${s}s**\nNode: ${process.version}\ndiscord.js: ${require('discord.js').version}\nServers: ${client.guilds.cache.size} · Members: ${client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)}`);
    }

    case 'backup': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      const backup = await security.backup(message.guild);
      const dir = path.join(path.dirname(config.dataFile), 'backups');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${message.guildId}-${Date.now()}.json`);
      fs.writeFileSync(file, JSON.stringify(backup, null, 2), 'utf8');
      audit.emit(message.guild, 'backup', '💾 Server Backup', `Backup created by **${message.author.tag}** — ${backup.roles.length} roles, ${backup.channels.length} channels.`, 0x57f287);
      return message.channel.send({ content: `💾 Backup saved — ${backup.roles.length} roles, ${backup.channels.length} channels.`, files: [file] }).catch(() => reply(message, '💾 Backup saved.'));
    }

    case 'restore': {
      if (!isOwner) return reply(message, '👑 Owner only.');
      const dir = path.join(path.dirname(config.dataFile), 'backups');
      if (!fs.existsSync(dir)) return reply(message, 'No backups found.');
      let files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
      const wanted = args[0];
      if (wanted && !wanted.includes('.')) files = files.filter((f) => f.includes(wanted));
      if (!files.length) return reply(message, 'No matching backup found. Use `?backup` first.');
      files.sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs);
      const file = path.join(dir, files[0]);
      const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (args.includes('confirm')) {
        const res = await applyBackup(message.guild, backup);
        audit.emit(message.guild, 'restore', '♻️ Backup Restored', `Restored by **${message.author.tag}** — ${res.roles} roles, ${res.channels} channels.`, 0x57f287);
        return reply(message, `♻️ Restore complete — created **${res.roles}** roles and **${res.channels}** channels from \`${files[0]}\`.`);
      }
      return reply(message, `⚠️ This will re-create **${backup.roles.length}** roles and **${backup.channels.length}** channels from \`${files[0]}\`.\nType \`${prefix}restore confirm\` to proceed.`);
    }

    case 'whitelist': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      const sub = args[0];
      if (!sub) {
        const a = settings.access;
        return reply(message, `**🔒 Whitelist**\nUsers: ${a.users.map((id) => `<@${id}>`).join(', ') || 'none'}\nRoles: ${a.roles.map((id) => `<@&${id}>`).join(', ') || 'none'}\n\nUse: \`${prefix}whitelist add <user|role>\`, \`${prefix}whitelist remove <user|role>\``);
      }
      const target = args[1] ? resolveUser(args[1], message.guild) || resolveRole(args[1], message.guild) : null;
      if (!target) return reply(message, 'Provide a user or role mention/ID.');
      if (sub === 'add' || sub === 'trust') {
        if (target.user) { if (!settings.access.users.includes(target.id)) settings.access.users.push(target.id); }
        else { if (!settings.access.roles.includes(target.id)) settings.access.roles.push(target.id); }
        store.save();
        audit.emit(message.guild, 'whitelist', '✅ Whitelisted', `${target.user ? target.user.tag : 'Role ' + target.name} was whitelisted by **${message.author.tag}**.`, 0x57f287);
        return reply(message, `✅ Whitelisted **${target.user ? target.user.tag : target.name}** — they bypass spam filters and are protected from mass actions.`);
      }
      if (sub === 'remove' || sub === 'del') {
        settings.access.users = settings.access.users.filter((id) => id !== target.id);
        settings.access.roles = settings.access.roles.filter((id) => id !== target.id);
        store.save();
        return reply(message, `Removed **${target.user ? target.user.tag : target.name}** from the whitelist.`);
      }
      return reply(message, 'Usage: `?whitelist add <user|role>` / `?whitelist remove <user|role>` / `?whitelist`');
    }

    case 'autorole': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      if (!args[0]) {
        return reply(message, settings.autoRole.enabled && settings.autoRole.roleId
          ? `✅ Auto-role: <@&${settings.autoRole.roleId}>\nUse \`${prefix}autorole off\` to disable.`
          : `Auto-role is off. Use \`${prefix}autorole <role>\` to set it.`);
      }
      if (args[0] === 'off') {
        settings.autoRole.enabled = false;
        store.save();
        return reply(message, 'Auto-role disabled.');
      }
      const role = resolveRole(args[0], message.guild);
      if (!role) return reply(message, 'Role not found.');
      settings.autoRole.roleId = role.id;
      settings.autoRole.enabled = true;
      store.save();
      return reply(message, `✅ New members will automatically receive **${role.name}**.`);
    }

    case 'autonick': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      if (args[0] === 'off') {
        settings.autoNick.enabled = false;
        store.save();
        return reply(message, 'Auto-nickname disabled.');
      }
      const prefix_ = args[0] || '';
      const suffix = args.slice(1).join(' ') || '';
      settings.autoNick.enabled = true;
      settings.autoNick.prefix = prefix_;
      settings.autoNick.suffix = suffix;
      store.save();
      return reply(message, `✅ New members will be nicknamed: \`${prefix_}<username>${suffix}\``);
    }

    case 'vc247': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      const member = message.member;
      if (args[0] === 'off' || args[0] === 'stop') {
        const ses = voiceSessions.get(message.guildId);
        if (ses) {
          ses.player.stop();
          voiceSessions.delete(message.guildId);
        }
        return reply(message, 'Left the voice channel.');
      }
      const vc = member.voice.channel;
      if (!vc) return reply(message, 'Join a voice channel first, then run this command.');
      try {
        const { joinVoiceChannel } = require('@discordjs/voice');
        const player = joinVoiceChannel({ channelId: vc.id, guildId: message.guildId, adapterCreator: message.guild.voiceAdapterCreator, selfDeaf: true });
        voiceSessions.set(message.guildId, { player, channelId: vc.id });
        player.on('stateChange', (oldS, newS) => {
          if (newS.status === 'disconnected') {
            setTimeout(() => {
              const ses = voiceSessions.get(message.guildId);
              if (ses) {
                try {
                  const rejoin = joinVoiceChannel({ channelId: ses.channelId, guildId: message.guildId, adapterCreator: message.guild.voiceAdapterCreator, selfDeaf: true });
                  voiceSessions.set(message.guildId, { player: rejoin, channelId: ses.channelId });
                } catch {}
              }
            }, 3000);
          }
        });
        return reply(message, `🔊 I'll stay in **${vc.name}** 24/7. Use \`${prefix}vc247 off\` to leave.`);
      } catch (e) {
        return reply(message, `Failed to join voice: ${e.message}`);
      }
    }

    case 'lockdown': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      const minutes = Number(args[0]) || 30;
      const snapshots = [];
      let done = 0;
      for (const channel of message.guild.channels.cache.values()) {
        if (channel.type === 10 || channel.type === 11 || channel.type === 12) continue;
        const ow = channel.permissionOverwrites.cache.get(message.guildId);
        snapshots.push({ channelId: channel.id, allow: ow ? ow.allow.bitfield : 0, deny: ow ? ow.deny.bitfield : 0 });
        await channel.permissionOverwrites.create(message.guild.roles.everyone, { SendMessages: false, CreateInstantInvite: false, Connect: false, Speak: false }, { reason: 'Lockdown' }).then(() => done++).catch(() => {});
      }
      store.data.secureMode = store.data.secureMode || {};
      store.data.secureMode[message.guildId] = { until: Date.now() + minutes * 60000, snapshots };
      store.save();
      antiRaid.triggerRaid(message.guild, { lockdownDurationMin: minutes });
      audit.emit(message.guild, 'secure_mode', '🔐 SECURE MODE', `Lockdown by **${message.author.tag}** for ${minutes} min — ${done} channels frozen.`, 0xed4245);
      return reply(message, `🔐 **Lockdown active** for ${minutes} min — chat frozen in ${done} channels. Use \`${prefix}unlock\` to end it early.`);
    }

    case 'unlock': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      const sm = store.data.secureMode && store.data.secureMode[message.guildId];
      if (!sm) return reply(message, 'No active lockdown to lift.');
      await endSecureMode(message.guild, sm);
      return reply(message, '🔓 Lockdown lifted — channel permissions restored.');
    }

    case 'fixoverwrites': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      let fixed = 0;
      for (const channel of message.guild.channels.cache.values()) {
        const ow = channel.permissionOverwrites.cache.get(message.guildId);
        if (!ow) continue;
        const deny = ow.deny;
        if (deny.has(PermissionFlagsBits.ViewChannel) || deny.has(PermissionFlagsBits.SendMessages) || deny.has(PermissionFlagsBits.Connect)) {
          const patch = {};
          if (deny.has(PermissionFlagsBits.ViewChannel)) patch.ViewChannel = null;
          if (deny.has(PermissionFlagsBits.SendMessages)) patch.SendMessages = null;
          if (deny.has(PermissionFlagsBits.Connect)) patch.Connect = null;
          await ow.edit({ ...patch }, 'fixoverwrites').then(() => fixed++).catch(() => {});
        }
      }
      return reply(message, `🔧 Fixed @everyone permission locks in **${fixed}** channel(s).`);
    }

    case 'deletechannels': {
      if (!isOwner) return reply(message, '👑 Owner only.');
      if (!args.includes('confirm')) return reply(message, `⚠️ This will delete **ALL ${message.guild.channels.cache.size} channels**! Type \`${prefix}deletechannels confirm\` to proceed.`);
      const count = message.guild.channels.cache.size;
      for (const c of [...message.guild.channels.cache.values()]) {
        await c.delete('deletechannels').catch(() => {});
      }
      audit.emit(message.guild, 'wipe', '🧨 Channels Wiped', `${count} channels deleted by **${message.author.tag}**.`, 0xed4245);
      return reply(message, `🧨 Deleted **${count}** channels.`);
    }

    case 'deleteroles': {
      if (!isOwner) return reply(message, '👑 Owner only.');
      if (!args.includes('confirm')) return reply(message, `⚠️ This will delete all custom roles! Type \`${prefix}deleteroles confirm\` to proceed.`);
      let count = 0;
      for (const r of [...message.guild.roles.cache.values()]) {
        if (r.id === message.guildId || r.managed) continue;
        await r.delete('deleteroles').then(() => count++).catch(() => {});
      }
      audit.emit(message.guild, 'wipe', '🧨 Roles Wiped', `${count} roles deleted by **${message.author.tag}**.`, 0xed4245);
      return reply(message, `🧨 Deleted **${count}** roles.`);
    }

    case 'deleteall': {
      if (!isOwner) return reply(message, '👑 Owner only.');
      if (!args.includes('confirm')) return reply(message, `⚠️ This will delete **EVERYTHING** (${message.guild.channels.cache.size} channels, ${message.guild.roles.cache.size - 1} roles)! Type \`${prefix}deleteall confirm\` to proceed.`);
      for (const c of [...message.guild.channels.cache.values()]) await c.delete('deleteall').catch(() => {});
      let roles = 0;
      for (const r of [...message.guild.roles.cache.values()]) {
        if (r.id === message.guildId || r.managed) continue;
        await r.delete('deleteall').then(() => roles++).catch(() => {});
      }
      audit.emit(message.guild, 'wipe', '🧨 SERVER WIPED', `Full wipe by **${message.author.tag}** — ${roles} roles deleted.`, 0xed4245);
      return reply(message, '🧨 Server wiped.');
    }

    case 'ban': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      const target = resolveUser(args[0], message.guild);
      if (!target) return reply(message, 'Provide a user mention/ID.');
      const reason = args.slice(1).join(' ') || 'No reason provided';
      try {
        await message.guild.members.ban(target.id, { reason });
        audit.modAction(message.guild, 'ban', target, message.author, reason);
        return reply(message, `🔨 Banned **${target.tag || target.username}** — ${reason}`);
      } catch (e) {
        return reply(message, `Could not ban: ${e.message}`);
      }
    }

    case 'unban': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      const id = normalize(args[0]);
      if (!id) return reply(message, 'Provide a user ID.');
      try {
        const user = await client.users.fetch(id);
        await message.guild.members.unban(id, 'unban');
        audit.modAction(message.guild, 'unban', user, message.author, 'Unbanned');
        return reply(message, `🔓 Unbanned **${user.tag}**.`);
      } catch {
        return reply(message, 'Could not unban — not banned or invalid ID.');
      }
    }

    case 'unbanall': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      const bans = await message.guild.bans.fetch().catch(() => []);
      if (!bans.size) return reply(message, 'No bans to lift.');
      if (!args.includes('confirm')) return reply(message, `⚠️ This will unban **${bans.size}** users. Type \`${prefix}unbanall confirm\` to proceed.`);
      let done = 0;
      for (const ban of bans.values()) {
        await message.guild.members.unban(ban.user.id, 'unbanall').then(() => done++).catch(() => {});
      }
      return reply(message, `🔓 Unbanned **${done}** users.`);
    }

    case 'kick': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      const target = resolveUser(args[0], message.guild);
      if (!target) return reply(message, 'Provide a user mention/ID.');
      const reason = args.slice(1).join(' ') || 'No reason provided';
      try {
        const member = message.guild.members.cache.get(target.id);
        if (!member) return reply(message, 'User is not in this server.');
        await member.kick(reason);
        audit.modAction(message.guild, 'kick', target, message.author, reason);
        return reply(message, `👢 Kicked **${target.tag}** — ${reason}`);
      } catch (e) {
        return reply(message, `Could not kick: ${e.message}`);
      }
    }

    case 'mute': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      const target = resolveUser(args[0], message.guild);
      const minutes = Number(args[1]) || 10;
      const reason = args.slice(2).join(' ') || 'No reason provided';
      if (!target) return reply(message, 'Provide a user mention/ID.');
      try {
        const member = message.guild.members.cache.get(target.id);
        if (!member) return reply(message, 'User is not in this server.');
        await member.timeout(minutes * 60000, reason);
        audit.modAction(message.guild, 'timeout', target, message.author, reason, `${minutes} min`);
        return reply(message, `⏰ Muted **${target.tag}** for ${minutes} min — ${reason}`);
      } catch (e) {
        return reply(message, `Could not mute: ${e.message}`);
      }
    }

    case 'unmute': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      const target = resolveUser(args[0], message.guild);
      if (!target) return reply(message, 'Provide a user mention/ID.');
      const member = message.guild.members.cache.get(target.id);
      if (!member) return reply(message, 'User is not in this server.');
      await member.timeout(null).then(() => reply(message, `🔔 Unmuted **${target.tag}**.`)).catch((e) => reply(message, `Failed: ${e.message}`));
      return;
    }

    case 'nuke': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      const ch = message.channel;
      if (ch.type !== ChannelType.GuildText) return reply(message, 'This only works in a text channel.');
      try {
        const clone = await ch.clone({ reason: `nuke by ${message.author.tag}` });
        await clone.setPosition(ch.position).catch(() => {});
        await ch.delete('nuke');
        clone.send(`🧹 **Channel nuked.** (${message.author.tag})`).catch(() => {});
        audit.emit(message.guild, 'nuke', '🧹 Channel Nuked', `#${clone.name} was cloned and cleared by **${message.author.tag}**.`, 0xfee75c);
      } catch (e) {
        return reply(message, `Failed: ${e.message}`);
      }
      return;
    }

    case 'cleanwebhooks': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      let webhooks = [];
      try { webhooks = [...(await message.guild.fetchWebhooks()).values()]; } catch {}
      if (!webhooks.length) return reply(message, 'No webhooks found.');
      let done = 0;
      for (const w of webhooks) await w.delete('cleanwebhooks').then(() => done++).catch(() => {});
      audit.emit(message.guild, 'webhooks_cleaned', '🧹 Webhooks Cleaned', `${done} webhooks deleted by **${message.author.tag}**.`, 0x57f287);
      return reply(message, `🧹 Deleted **${done}** webhooks.`);
    }

    case 'hide': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      await message.channel.permissionOverwrites.create(message.guild.roles.everyone, { ViewChannel: false }, 'hide').then(() => reply(message, `🙈 <#${message.channel.id}> is now hidden from @everyone.`)).catch((e) => reply(message, `Failed: ${e.message}`));
      return;
    }

    case 'unhide': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      await message.channel.permissionOverwrites.delete(message.guild.roles.everyone, 'unhide').then(() => reply(message, `👁️ <#${message.channel.id}> is visible to @everyone again.`)).catch((e) => reply(message, `Failed: ${e.message}`));
      return;
    }

    case 'role': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      const target = resolveUser(args[1], message.guild);
      const role = resolveRole(args[2], message.guild);
      if (!target || !role) return reply(message, 'Usage: `?role add|remove @user @role` or `?role @user @role` (toggle)');
      const member = message.guild.members.cache.get(target.id);
      if (!member) return reply(message, 'User is not in this server.');
      const action = args[0] === 'add' ? 'add' : args[0] === 'remove' ? 'remove' : member.roles.cache.has(role.id) ? 'remove' : 'add';
      if (action === 'add') await member.roles.add(role, `role by ${message.author.tag}`).then(() => reply(message, `✅ Added **${role.name}** to **${target.tag}**.`));
      else await member.roles.remove(role, `role by ${message.author.tag}`).then(() => reply(message, `Removed **${role.name}** from **${target.tag}**.`));
      return;
    }

    case 'roleall': {
      if (!isOwner) return reply(message, '👑 Owner only.');
      const role = resolveRole(args[0], message.guild);
      if (!role) return reply(message, 'Provide a role mention/ID.');
      if (!args.includes('confirm')) return reply(message, `⚠️ This gives **${role.name}** to ALL human members. Type \`${prefix}roleall <role> confirm\` to proceed.`);
      await message.guild.members.fetch().catch(() => {});
      let done = 0;
      for (const m of [...message.guild.members.cache.values()]) {
        if (m.user.bot) continue;
        await m.roles.add(role, 'roleall').then(() => done++).catch(() => {});
      }
      return reply(message, `✅ Gave **${role.name}** to **${done}** members.`);
    }

    case 'rolebots': {
      if (!isOwner) return reply(message, '👑 Owner only.');
      const role = resolveRole(args[0], message.guild);
      if (!role) return reply(message, 'Provide a role mention/ID.');
      await message.guild.members.fetch().catch(() => {});
      let done = 0;
      for (const m of [...message.guild.members.cache.values()]) {
        if (!m.user.bot) continue;
        await m.roles.add(role, 'rolebots').then(() => done++).catch(() => {});
      }
      return reply(message, `✅ Gave **${role.name}** to **${done}** bots.`);
    }

    case 'kickall': {
      if (!isOwner) return reply(message, '👑 Owner only.');
      if (!args.includes('confirm')) return reply(message, `⚠️ Kicks ALL non-whitelisted members. Type \`${prefix}kickall confirm\` to proceed.`);
      await message.guild.members.fetch().catch(() => {});
      let done = 0;
      for (const m of [...message.guild.members.cache.values()]) {
        if (m.user.bot || m.id === message.guild.ownerId || m.permissions.has(PermissionFlagsBits.Administrator)) continue;
        if (settings.access.users.includes(m.id) || settings.access.roles.some((r) => m.roles.cache.has(r))) continue;
        await m.kick('kickall').then(() => done++).catch(() => {});
      }
      audit.emit(message.guild, 'mass_action', '👢 Mass Kick', `${done} members kicked by **${message.author.tag}**.`, 0xed4245);
      return reply(message, `👢 Kicked **${done}** non-whitelisted members.`);
    }

    case 'banall': {
      if (!isOwner) return reply(message, '👑 Owner only.');
      if (!args.includes('confirm')) return reply(message, `⚠️ Bans ALL non-whitelisted members. Type \`${prefix}banall confirm\` to proceed.`);
      await message.guild.members.fetch().catch(() => {});
      let done = 0;
      for (const m of [...message.guild.members.cache.values()]) {
        if (m.user.bot || m.id === message.guild.ownerId || m.permissions.has(PermissionFlagsBits.Administrator)) continue;
        if (settings.access.users.includes(m.id) || settings.access.roles.some((r) => m.roles.cache.has(r))) continue;
        await message.guild.members.ban(m.id, { reason: 'banall' }).then(() => done++).catch(() => {});
      }
      audit.emit(message.guild, 'mass_action', '🔨 Mass Ban', `${done} members banned by **${message.author.tag}**.`, 0xed4245);
      return reply(message, `🔨 Banned **${done}** non-whitelisted members.`);
    }

    case 'timeoutall': {
      if (!isOwner) return reply(message, '👑 Owner only.');
      if (!args.includes('confirm')) return reply(message, `⚠️ Applies a 24h timeout to ALL non-whitelisted members. Type \`${prefix}timeoutall confirm\` to proceed.`);
      await message.guild.members.fetch().catch(() => {});
      let done = 0;
      for (const m of [...message.guild.members.cache.values()]) {
        if (m.user.bot || m.id === message.guild.ownerId || m.permissions.has(PermissionFlagsBits.Administrator)) continue;
        if (settings.access.users.includes(m.id) || settings.access.roles.some((r) => m.roles.cache.has(r))) continue;
        await m.timeout(86400000, 'timeoutall').then(() => done++).catch(() => {});
      }
      audit.emit(message.guild, 'mass_action', '⏰ Mass Timeout', `${done} members timed out by **${message.author.tag}**.`, 0xed4245);
      return reply(message, `⏰ Timed out **${done}** non-whitelisted members for 24h.`);
    }

    case 'invitepurge': {
      if (!isOwner) return reply(message, '👑 Owner only.');
      let invites = [];
      try { invites = [...(await message.guild.invites.fetch()).values()]; } catch {}
      if (!invites.length) return reply(message, 'No invites to purge.');
      let done = 0;
      for (const inv of invites) await inv.delete('invitepurge').then(() => done++).catch(() => {});
      return reply(message, `🧹 Deleted **${done}** invites.`);
    }

    case 'wordblock': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      const sub = args[0];
      const words = args.slice(1).join(' ');
      if (!sub) return reply(message, `**Blocked words (${settings.autoMod.bannedWords.length})**: ${settings.autoMod.bannedWords.join(', ') || 'none'}\nUse \`${prefix}wordblock add <words>\`, \`${prefix}wordblock remove <word>\`, \`${prefix}wordblock clear\``);
      if (sub === 'add') {
        const list = words.split(/[,;]/).map((w) => w.trim().toLowerCase()).filter(Boolean);
        settings.autoMod.bannedWords.push(...list);
        store.save();
        audit.emit(message.guild, 'wordblock', '⛔ Words Blocked', `${list.length} word(s) added by **${message.author.tag}**.`, 0xfee75c);
        return reply(message, `⛔ Blocked: ${list.join(', ')}`);
      }
      if (sub === 'remove') {
        settings.autoMod.bannedWords = settings.autoMod.bannedWords.filter((w) => w !== words.toLowerCase());
        store.save();
        return reply(message, `Removed \`${words}\` from the blocklist.`);
      }
      if (sub === 'clear') {
        settings.autoMod.bannedWords = [];
        store.save();
        return reply(message, 'Cleared the blocklist.');
      }
      return reply(message, 'Invalid usage.');
    }

    case 'alert': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      const minutes = Number(args[0]);
      if (!minutes || minutes < 1 || minutes > 10080) return reply(message, 'Usage: `?alert <minutes> <message>` — schedules an alert in this channel.');
      const text = args.slice(1).join(' ');
      if (!text) return reply(message, 'Provide a message to send.');
      const when = Date.now() + minutes * 60000;
      const timer = setTimeout(async () => {
        await message.channel.send(`⏰ **Alert:** ${text}`).catch(() => {});
        scheduledAlerts.delete(message.id);
        audit.emit(message.guild, 'alert', '⏰ Alert Sent', `Scheduled alert by **${message.author.tag}** fired: ${text}`, 0x5865f2);
      }, minutes * 60000);
      scheduledAlerts.set(message.id, timer);
      store.pushAlert(message.guildId, { type: 'alert', level: 'info', title: 'Alert Scheduled', message: `Alert in ${minutes} min: ${text}` });
      return reply(message, `⏰ Alert scheduled — I'll send it <t:${Math.floor(when / 1000)}:R> (in ${minutes} min).`);
    }

    case 'eval': {
      if (!isOwner) return reply(message, '👑 Developer only.');
      const code = args.join(' ');
      if (!code) return reply(message, 'Provide code to evaluate.');
      try {
        const result = await eval(`(async()=>{${code}})()`);
        audit.emit(message.guild, 'eval', '⚙️ Eval Executed', `Code evaluated by **${message.author.tag}**.\n\`\`\`js\n${code.slice(0, 200)}\`\`\``, 0x5865f2);
        return reply(message, `✅ **Result:**\n\`\`\`js\n${String(result).slice(0, 1500) || 'undefined'}\`\`\``);
      } catch (e) {
        return reply(message, `❌ **Error:**\n\`\`\`js\n${e.message.slice(0, 1500)}\`\`\``);
      }
    }

    case 'profile': {
      const warns = store.getWarnings(message.guildId, message.author.id);
      const score = security.riskScore(message.member, settings);
      const [level] = security.riskLevel(score);
      const joined = Math.floor(message.member.joinedTimestamp / 1000);
      return reply(message, `**📛 ${message.author.tag}**\nJoined: <t:${joined}:f>\nWarnings: **${warns.length}**\nVerified: ${store.data.verified[`${message.guildId}:${message.author.id}`] ? '✅' : '❌'}\nRisk score: **${score}/100** (${level})\nWhitelisted: ${access.isTrusted(message.member, settings) ? '✅' : '❌'}`);
    }

    case 'whois': {
      const target = args[0] ? resolveUser(args[0], message.guild) || message.author : message.author;
      const member = message.guild.members.cache.get(target.id);
      const created = Math.floor(target.createdTimestamp / 1000);
      const lines = [`**🔎 ${target.tag}** (${target.id})`, `Account created: <t:${created}:f> (<t:${created}:R>)`];
      if (member) {
        lines.push(`Joined server: <t:${Math.floor(member.joinedTimestamp / 1000)}:f>`);
        lines.push(`Roles: ${member.roles.cache.map((r) => r.name).filter((n) => n !== '@everyone').join(', ') || 'none'}`);
        const warns = store.getWarnings(message.guildId, target.id).length;
        lines.push(`Warnings: **${warns}**`);
        if (member.communicationDisabledUntil) lines.push('⏰ Currently timed out');
      }
      lines.push(target.bot ? '🤖 This is a bot account' : '👤 Human account');
      return reply(message, lines.join('\n'));
    }

    case 'antiraid': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      settings.antiRaid.enabled = !settings.antiRaid.enabled;
      store.save();
      return reply(message, `🛡️ Anti-raid is now **${settings.antiRaid.enabled ? 'ENABLED' : 'DISABLED'}**.`);
    }

    case 'ticket': {
      const sub = args[0];
      if (sub === 'close') {
        if (!message.channel.name.startsWith('ticket-')) return reply(message, 'This is not a ticket channel.');
        await message.channel.delete('ticket closed').catch(() => {});
        return;
      }
      let category = message.guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === 'Tickets');
      if (!category) {
        category = await message.guild.channels.create({ name: 'Tickets', type: ChannelType.GuildCategory, reason: 'ticket system' }).catch(() => null);
      }
      const existing = message.guild.channels.cache.find((c) => c.name === `ticket-${message.author.username.toLowerCase()}`);
      if (existing) return reply(message, `You already have a ticket open: <#${existing.id}>`);
      try {
        const ch = await message.guild.channels.create({
          name: `ticket-${message.author.username.toLowerCase()}`,
          type: ChannelType.GuildText,
          parent: category ? category.id : undefined,
          topic: `Ticket for ${message.author.tag}`,
          reason: 'ticket system',
          permissionOverwrites: [
            { id: message.guildId, deny: [PermissionFlagsBits.ViewChannel] },
            { id: message.author.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          ],
        });
        audit.emit(message.guild, 'ticket', '🎫 Ticket Opened', `Ticket opened by **${message.author.tag}** — <#${ch.id}>.`, 0x5865f2);
        ch.send(`🎫 Welcome **${message.author.tag}**! A staff member will help you shortly.`).catch(() => {});
        return reply(message, `🎫 Ticket opened: <#${ch.id}>`);
      } catch (e) {
        return reply(message, `Failed to open ticket: ${e.message}`);
      }
    }

    case 'speak': {
      const vc = message.member.voice.channel;
      if (!vc) return reply(message, 'Join a voice channel first, then run this command.');
      const text = args.join(' ');
      if (!text) return reply(message, 'Usage: `?speak <text>` — I\'ll speak it out loud in your voice channel.');
      const res = await voice.speak(message.guild, vc.id, text, settings.voice.lang);
      if (res.ok) {
        audit.emit(message.guild, 'speak', '🔊 Bot Speaking', `**${message.author.tag}** made the bot speak in **${vc.name}** (${settings.voice.lang}): "${text.slice(0, 100)}"`, 0x5865f2);
        return reply(message, `🔊 Speaking in **${vc.name}** (language: \`${settings.voice.lang}\`): "${text.slice(0, 100)}"`);
      }
      return reply(message, `❌ Could not speak: ${res.error}`);
    }

    case 'voicelang': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      if (!args[0]) return reply(message, `Current TTS language: **${settings.voice.lang}**\nUsage: \`?voicelang <code>\` — e.g. \`ta\` (Tamil), \`en\` (English), \`hi\` (Hindi), \`te\` (Telugu), \`ml\` (Malayalam), \`kn\` (Kannada), \`bn\` (Bengali)`);
      settings.voice.lang = args[0].toLowerCase();
      store.save();
      return reply(message, `🗣️ TTS language set to **${settings.voice.lang}**. Now use \`?speak <text>\` in a voice channel.`);
    }

    case 'speakstop': {
      const stopped = voice.stopSpeaking(message.guildId);
      return reply(message, stopped ? '🔇 Speech stopped.' : 'Nothing is playing.');
    }

    case 'alive': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      if (args[0] === 'off' || args[0] === 'stop') {
        const stopped = voice.disableMonitor(message.guildId);
        return reply(message, stopped ? '🎙️ Mic monitoring stopped.' : 'Monitoring is not active.');
      }
      const vc = message.member.voice.channel;
      if (!vc) return reply(message, 'Join a voice channel first, then run this command.');
      voice.enableMonitor(message.guild, vc.id, message.channel);
      audit.emit(message.guild, 'alive', '🎙️ Mic Monitor', `Mic monitoring enabled in **${vc.name}** by **${message.author.tag}** — reports go to <#${message.channel.id}>.`, 0x5865f2);
      return reply(message, `🎙️ Mic monitoring **enabled** in **${vc.name}** — I'll report whenever someone speaks. Reports go to <#${message.channel.id}>. Use \`?alive off\` to stop.`);
    }

    case 'listen': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      const listen = require('./modules/listen');
      if (args[0] === 'off' || args[0] === 'stop') {
        const stopped = listen.stopListen(message.guildId);
        return reply(message, stopped ? '🎧 Listening stopped.' : 'Listening is not active.');
      }
      const vc = message.member.voice.channel;
      if (!vc) return reply(message, 'Join a voice channel first, then run this command.');
      const res = listen.startListen(message.guild, vc.id, message.channel.id);
      if (!res.ok) return reply(message, `❌ ${res.error}`);
      audit.emit(message.guild, 'listen', '🎧 VC Listening', `Bot listening in **${vc.name}** — transcripts will be posted here by **${message.author.tag}**.`, 0x5865f2);
      return reply(message, `🎧 **Listening enabled** in **${vc.name}** — I'll transcribe what people say here. First time needs a one-time AI model download (~40 MB, takes a minute). Use \`?listen off\` to stop.`);
    }

    case 'sttlang': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      if (!args[0]) return reply(message, `Current transcript language: **${settings.voice.sttLang || 'auto'}**\nUsage: \`?sttlang <code>\` — e.g. \`ta\` (Tamil), \`en\` (English), \`hi\` (Hindi), or \`auto\` (auto-detect)`);
      settings.voice.sttLang = args[0].toLowerCase();
      store.save();
      return reply(message, `🎧 Transcript language set to **${settings.voice.sttLang}**.`);
    }

    case 'mention': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      const target = resolveUser(args[0], message.guild);
      const count = Math.min(Math.max(parseInt(args[1], 10) || 5, 1), 50);
      if (!target) return reply(message, 'Usage: `?mention <user> <count>` — mention someone up to 50 times.');
      audit.emit(message.guild, 'mention', '📢 Mention Spam', `**${message.author.tag}** mentioned **${target.tag}** ${count} times in <#${message.channel.id}>.`, 0xe67e22);
      await message.delete().catch(() => {});
      let sent = 0;
      const id = target.id || target;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      while (sent < count) {
        const batch = Math.min(count - sent, 4);
        await message.channel.send(`<@${id}>`.repeat(batch)).catch(() => {});
        sent += batch;
        if (sent < count) await sleep(1800);
      }
      return null;
    }

    case 'leaveserver': {
      if (!isOwner) return reply(message, '👑 Owner only.');
      const id = normalize(args[0]);
      if (id) {
        const g = client.guilds.cache.get(id);
        if (!g) return reply(message, 'Server not found.');
        await g.leave();
        return reply(message, `Left server **${g.name}**.`);
      }
      const list = client.guilds.cache.map((g) => `${g.id} — ${g.name} (${g.memberCount})`).join('\n');
      return reply(message, `**Servers (${client.guilds.cache.size})**\n${list}\n\nUse \`${prefix}leaveserver <id>\` to make me leave one.`);
    }

    case 'cleardm': {
      if (!isOwner) return reply(message, '👑 Owner only.');
      const target = resolveUser(args[0], message.guild);
      if (!target) return reply(message, 'Provide a user mention/ID.');
      try {
        const dm = await target.createDM();
        let deleted = 0;
        let before = undefined;
        for (let i = 0; i < 5; i++) {
          const msgs = await dm.messages.fetch({ limit: 100, before }).catch(() => null);
          if (!msgs || !msgs.size) break;
          const mine = msgs.filter((m) => m.author.id === client.user.id);
          for (const m of mine.values()) {
            await m.delete().then(() => deleted++).catch(() => {});
          }
          before = msgs.last().id;
        }
        return reply(message, `🧹 Deleted **${deleted}** of my messages in DMs with **${target.tag}**.`);
      } catch (e) {
        return reply(message, `Failed: ${e.message}`);
      }
    }

    case 'rank': {
      const store2 = require('./store');
      const lv = store2.getLevel(message.guildId, message.author.id);
      if (!lv.messages) return reply(message, 'No XP yet — start chatting!');
      const { levelFromXp } = require('./modules/levels');
      const lvl = levelFromXp(lv.xp);
      const cur = Math.floor(100 * Math.pow(lvl, 1.5));
      const next = Math.floor(100 * Math.pow(lvl + 1, 1.5));
      const pct = Math.min(100, Math.floor(((lv.xp - cur) / (next - cur)) * 100));
      const bar = '█'.repeat(Math.round(pct / 10)).padEnd(10, '░');
      return reply(message, `**📈 ${message.author.tag}** — Level **${lvl}**\nXP: ${lv.xp} · Messages: **${lv.messages}**\n\`${bar}\` ${pct}% to level ${lvl + 1}`);
    }

    case 'leaderboard': {
      const store2 = require('./store');
      await message.guild.members.fetch().catch(() => {});
      const top = store2.getTopLevels(message.guildId, 10);
      if (!top.length) return reply(message, 'No activity data yet — start chatting!');
      const lines = top.map((l, n) => {
        const member = message.guild.members.cache.get(l.userId);
        return `${['🥇', '🥈', '🥉'][n] || `${n + 1}.`} **${member ? member.user.tag : l.userId}** — ${l.messages} msgs`;
      });
      return reply(message, `**💬 Message Leaderboard**\n${lines.join('\n')}`);
    }

    case 'balance': {
      const economy = require('./modules/economy');
      const target = args[0] ? resolveUser(args[0], message.guild) || message.author : message.author;
      economy.ensure(message.guildId, message.author.id, settings.economy);
      const acc = economy.balance(message.guildId, target.id);
      return reply(message, `🪙 **${target.tag}** has **${acc.balance.toLocaleString()}** coins (${acc.earned.toLocaleString()} earned).`);
    }

    case 'daily': {
      const economy = require('./modules/economy');
      const res = economy.daily(message.guildId, message.author.id, settings.economy);
      if (!res.ok) return reply(message, `❌ Already claimed today. Come back <t:${Math.floor(res.nextAt / 1000)}:R> (${res.left} left).`);
      return reply(message, `✅ Daily claimed: **+${res.amount.toLocaleString()} 🪙**. Next claim <t:${Math.floor(res.nextAt / 1000)}:R>.`);
    }

    case 'work': {
      const economy = require('./modules/economy');
      const res = economy.work(message.guildId, message.author.id, settings.economy);
      if (!res.ok) return reply(message, `❌ You're tired. Work again <t:${Math.floor(res.nextAt / 1000)}:R> (${res.left} left).`);
      return reply(message, `💼 You ${res.msg} and earned **+${res.amount.toLocaleString()} 🪙**.`);
    }

    case 'pay': {
      const economy = require('./modules/economy');
      const target = resolveUser(args[0], message.guild);
      const amount = parseInt(args[1], 10);
      if (!target || !amount) return reply(message, 'Usage: `?pay <user> <amount>`');
      if (target.id === message.author.id) return reply(message, 'You cannot pay yourself.');
      const res = economy.pay(message.guildId, message.author.id, target.id, amount);
      if (!res.ok) return reply(message, `❌ ${res.error}`);
      return reply(message, `💸 Sent **${amount.toLocaleString()} 🪙** to **${target.tag}**.`);
    }

    case 'gamble': {
      const economy = require('./modules/economy');
      const amount = parseInt(args[0], 10);
      if (!amount) return reply(message, 'Usage: `?gamble <amount>` — coin flip, double or lose.');
      const res = economy.gamble(message.guildId, message.author.id, amount);
      if (!res.ok) return reply(message, `❌ ${res.error}`);
      return res.win
        ? reply(message, `🪙 **You won!** +${res.amount.toLocaleString()} — new balance **${res.newBalance.toLocaleString()}**.`)
        : reply(message, `😵 **You lost** ${res.amount.toLocaleString()} — new balance **${res.newBalance.toLocaleString()}**.`);
    }

    case 'rich': {
      const economy = require('./modules/economy');
      await message.guild.members.fetch().catch(() => {});
      const top = economy.top(message.guildId);
      if (!top.length) return reply(message, 'No economy data yet.');
      const lines = top.map((a, n) => {
        const member = message.guild.members.cache.get(a.userId);
        return `${['🥇', '🥈', '🥉'][n] || `${n + 1}.`} **${member ? member.user.tag : a.userId}** — ${a.balance.toLocaleString()} 🪙`;
      });
      return reply(message, `**🪙 Richest Members**\n${lines.join('\n')}`);
    }

    case 'quarantine': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      if (!settings.quarantine.roleId) return reply(message, 'No quarantine role set. Use `/quarantine-setup` first.');
      const target = resolveUser(args[0], message.guild);
      if (!target) return reply(message, 'Usage: `?quarantine <user> [reason]`');
      const member = message.guild.members.cache.get(target.id);
      if (!member) return reply(message, 'User is not in this server.');
      if (access.isModerator(member, settings)) return reply(message, 'You cannot quarantine a moderator or owner.');
      const quarantine = require('./modules/quarantine');
      if (quarantine.isQuarantined(message.guildId, target.id)) return reply(message, 'User is already quarantined.');
      await quarantine.quarantine(member, message.author, args.slice(1).join(' '));
      return reply(message, `🧪 Quarantined **${target.tag}** — all roles removed. Use \`?unquarantine\` to restore.`);
    }

    case 'unquarantine': {
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      const target = resolveUser(args[0], message.guild);
      if (!target) return reply(message, 'Usage: `?unquarantine <user>`');
      const member = message.guild.members.cache.get(target.id);
      if (!member) return reply(message, 'User is not in this server.');
      const quarantine = require('./modules/quarantine');
      const entry = await quarantine.unquarantine(member, message.author);
      if (!entry) return reply(message, 'User is not quarantined.');
      return reply(message, `✅ Released **${target.tag}** — **${entry.roles.length}** roles restored.`);
    }

    case 'extraowner': {
      const list = settings.extraOwners || (settings.extraOwners = []);
      const sub = args[0];
      if (!sub || sub === 'list') {
        return reply(message, `**👑 Extra Owners (${list.length})**\n${list.map((id) => `<@${id}>`).join('\n') || 'none'}\n\nUsage: \`?extraowner add|remove <user>\``);
      }
      if (!isAdmin) return reply(message, '👑 Administrator permission required.');
      const target = resolveUser(args[1], message.guild);
      if (!target) return reply(message, 'Provide a user mention/ID.');
      if (sub === 'add') {
        if (list.includes(target.id)) return reply(message, 'Already an extra owner.');
        list.push(target.id);
        store.save();
        return reply(message, `👑 **${target.tag}** is now an extra owner — full owner powers.`);
      }
      settings.extraOwners = list.filter((id) => id !== target.id);
      store.save();
      return reply(message, `Removed **${target.tag}** from extra owners.`);
    }

    case 'roleauth': {
      const ra = settings.roleAuth;
      const sub = args[0];
      if (!sub || sub === 'list') {
        if (!ra.rules.length) return reply(message, 'No role auth rules. Usage: `?roleauth add <command> <role>`, `?roleauth enable|disable`, `?roleauth list`');
        const lines = ra.rules.map((r) => `- \`/${r.command}\` → ${r.roles.map((id) => `<@&${id}>`).join(', ')}`);
        return reply(message, `**🔐 Role Auth ${ra.enabled ? '(ON)' : '(OFF)'}**\n${lines.join('\n')}`);
      }
      if (!isAdmin) return reply(message, '👑 Administrator permission required.');
      if (sub === 'enable') { ra.enabled = true; store.save(); return reply(message, '🔐 Role auth enabled.'); }
      if (sub === 'disable') { ra.enabled = false; store.save(); return reply(message, '🔐 Role auth disabled.'); }
      if (sub === 'add') {
        const cmd = (args[1] || '').toLowerCase().replace(/^\//, '');
        const role = resolveRole(args[2], message.guild);
        if (!cmd || !role) return reply(message, 'Usage: `?roleauth add <command> <role>`');
        let rule = ra.rules.find((r) => r.command === cmd);
        if (!rule) { rule = { command: cmd, roles: [] }; ra.rules.push(rule); }
        if (rule.roles.includes(role.id)) return reply(message, 'Role already required.');
        rule.roles.push(role.id);
        store.save();
        return reply(message, `🔐 \`/${cmd}\` now requires **${role.name}**.`);
      }
      if (sub === 'remove') {
        const cmd = (args[1] || '').toLowerCase().replace(/^\//, '');
        const role = resolveRole(args[2], message.guild);
        const rule = ra.rules.find((r) => r.command === cmd);
        if (!rule || !role) return reply(message, 'Usage: `?roleauth remove <command> <role>`');
        rule.roles = rule.roles.filter((id) => id !== role.id);
        if (!rule.roles.length) ra.rules = ra.rules.filter((r) => r.command !== cmd);
        store.save();
        return reply(message, `Removed **${role.name}** from \`/${cmd}\`.`);
      }
      return reply(message, 'Usage: `?roleauth add|remove|enable|disable|list`');
    }

    case 'media': {
      const list = settings.mediaChannels || (settings.mediaChannels = []);
      const sub = args[0];
      if (!sub || sub === 'list') {
        return reply(message, `**🖼️ Media-only channels (${list.length})**\n${list.map((id) => `<#${id}>`).join('\n') || 'none'}\n\nUsage: \`?media add|remove <#channel>\``);
      }
      if (!isAdmin) return reply(message, '👑 Administrator permission required.');
      const ch = args[1] ? resolveChannel(args[1], message.guild) : null;
      if (!ch) return reply(message, 'Provide a channel mention/ID.');
      if (sub === 'add') {
        if (list.includes(ch.id)) return reply(message, 'Already media-only.');
        list.push(ch.id);
        store.save();
        return reply(message, `🖼️ <#${ch.id}> is now **media-only** — plain text messages are auto-deleted.`);
      }
      settings.mediaChannels = list.filter((id) => id !== ch.id);
      store.save();
      return reply(message, `Removed media-only mode from <#${ch.id}>.`);
    }

    case 'tempvoice': {
      if (!isAdmin) return reply(message, '👑 Administrator permission required.');
      const sub = args[0];
      if (sub === 'off' || sub === 'stop' || sub === 'disable') {
        settings.tempVoice.enabled = false;
        store.save();
        return reply(message, 'Temporary voice disabled.');
      }
      if (sub === 'lock') {
        settings.tempVoice.lockOnClaim = !settings.tempVoice.lockOnClaim;
        store.save();
        return reply(message, `🔒 Temp channels ${settings.tempVoice.lockOnClaim ? 'are now private to the creator' : 'are now public'}.`);
      }
      const vc = message.member.voice.channel;
      if (!vc) return reply(message, 'Join the trigger voice channel first, then run `?tempvoice on`.');
      settings.tempVoice.enabled = true;
      settings.tempVoice.channelId = vc.id;
      store.save();
      return reply(message, `🎛️ Temp voice enabled — joining **${vc.name}** spawns a private channel (auto-deleted when empty).`);
    }

    case 'vc': {
      const sub = args[0];
      if (!isMod) return reply(message, '❌ Moderator permission required.');
      const target = resolveUser(args[1], message.guild);
      if (sub === 'list' || !sub) {
        const vcs = [...message.guild.channels.cache.values()].filter((c) => c.type === ChannelType.GuildVoice && c.members.size > 0);
        if (!vcs.length) return reply(message, 'No one is in voice channels.');
        const lines = vcs.map((c) => `**${c.name}** (${c.members.size}) — ${c.members.map((m) => m.user.tag).join(', ')}`);
        return reply(message, `**🎙️ Voice Channels**\n${lines.join('\n')}`);
      }
      if (!target) return reply(message, `Usage: \`?vc ${sub} <user>\``);
      const member = message.guild.members.cache.get(target.id);
      if (!member) return reply(message, 'User is not in this server.');
      if (!member.voice || !member.voice.channelId) return reply(message, 'User is not in a voice channel.');
      if (sub === 'kick' || sub === 'dc' || sub === 'disconnect') {
        await member.voice.disconnect('vc kick').catch((e) => reply(message, `Failed: ${e.message}`));
        return reply(message, `🎙️ Disconnected **${target.tag}** from voice.`);
      }
      if (sub === 'mute') { await member.voice.setMute(true).catch((e) => reply(message, `Failed: ${e.message}`)); return reply(message, `🔇 Muted **${target.tag}** in voice.`); }
      if (sub === 'unmute') { await member.voice.setMute(false).catch((e) => reply(message, `Failed: ${e.message}`)); return reply(message, `🔊 Unmuted **${target.tag}** in voice.`); }
      if (sub === 'deafen') { await member.voice.setDeaf(true).catch((e) => reply(message, `Failed: ${e.message}`)); return reply(message, `🔕 Deafened **${target.tag}** in voice.`); }
      if (sub === 'undeafen') { await member.voice.setDeaf(false).catch((e) => reply(message, `Failed: ${e.message}`)); return reply(message, `🎧 Undeafened **${target.tag}** in voice.`); }
      if (sub === 'move') {
        const vc = resolveChannel(args[2], message.guild);
        if (!vc || vc.type !== ChannelType.GuildVoice) return reply(message, 'Provide a target voice channel.');
        await member.voice.setChannel(vc).catch((e) => reply(message, `Failed: ${e.message}`));
        return reply(message, `➡️ Moved **${target.tag}** to **${vc.name}**.`);
      }
      return reply(message, 'Usage: `?vc kick|mute|unmute|deafen|undeafen|move|list`');
    }

    case 'responder': {
      const ar = settings.autoResponder;
      const sub = args[0];
      if (!sub || sub === 'list') {
        if (!ar.rules.length) return reply(message, 'No triggers. Usage: `?responder add <trigger> <response>`, `?responder remove <trigger>`, `?responder on|off`');
        const lines = ar.rules.slice(0, 25).map((r) => `- \`${r.trigger}\`${r.exact ? ' (exact)' : ''} → ${String(r.response).slice(0, 60)}`);
        return reply(message, `**🤖 Auto Responder ${ar.enabled ? '(ON)' : '(OFF)'} — ${ar.rules.length} trigger(s)**\n${lines.join('\n')}`);
      }
      if (!isAdmin) return reply(message, '👑 Administrator permission required.');
      if (sub === 'on') { ar.enabled = true; store.save(); return reply(message, '🤖 Auto responder ON.'); }
      if (sub === 'off') { ar.enabled = false; store.save(); return reply(message, '🤖 Auto responder OFF.'); }
      if (sub === 'add') {
        const trigger = args[1];
        const response = args.slice(2).join(' ');
        if (!trigger || !response) return reply(message, 'Usage: `?responder add <trigger> <response>`');
        if (ar.rules.some((r) => r.trigger.toLowerCase() === trigger.toLowerCase())) return reply(message, 'Trigger already exists.');
        ar.rules.push({ trigger, response, exact: false, enabled: true });
        store.save();
        return reply(message, `🤖 Added trigger \`${trigger}\`.`);
      }
      if (sub === 'remove') {
        ar.rules = ar.rules.filter((r) => r.trigger.toLowerCase() !== (args[1] || '').toLowerCase());
        store.save();
        return reply(message, 'Trigger removed.');
      }
      return reply(message, 'Usage: `?responder add|remove|list|on|off`');
    }

    case 'cc': {
      const autoResponder = require('./modules/autoResponder');
      const sub = args[0];
      if (!sub || sub === 'list') {
        const list = autoResponder.listCustomCommands(message.guildId);
        if (!list.length) return reply(message, 'No custom commands. Usage: `?cc add <name> <response>`');
        return reply(message, `**💬 Custom Commands (${list.length})**\n${list.map(([k, v]) => `- \`${k}\` → ${String(v).slice(0, 60)}`).join('\n')}`);
      }
      if (!isAdmin) return reply(message, '👑 Administrator permission required.');
      if (sub === 'add') {
        const name = (args[1] || '').toLowerCase();
        const response = args.slice(2).join(' ');
        if (!name || !response) return reply(message, 'Usage: `?cc add <name> <response>`');
        if (name.length > 24) return reply(message, 'Command name must be 24 characters or fewer.');
        autoResponder.addCustomCommand(message.guildId, name, response);
        return reply(message, `💬 Custom command \`${name}\` added — send \`${name}\` in chat to trigger it.`);
      }
      if (sub === 'remove') {
        const removed = autoResponder.removeCustomCommand(message.guildId, args[1] || '');
        return removed ? reply(message, `Removed \`${args[1]}\`.`) : reply(message, 'Command not found.');
      }
      return reply(message, 'Usage: `?cc add|remove|list`');
    }

    case 'giveaway': {
      const giveaway = require('./modules/giveaway');
      const sub = args[0];
      if (!sub || sub === 'list') {
        const list = giveaway.listActive(message.guildId);
        if (!list.length) return reply(message, 'No active giveaways. Usage: `?giveaway start <5m> <winners> <prize>`');
        return reply(message, `**🎉 Active giveaways (${list.length})**\n${list.map((g) => `- **${g.prize}** — ends <t:${Math.floor(g.endsAt / 1000)}:R>, ${g.entries.length} entries`).join('\n')}`);
      }
      if (!isAdmin) return reply(message, '👑 Administrator permission required.');
      if (sub === 'start') {
        const res = await giveaway.start(message.guild, message.channel, args[1], parseInt(args[2], 10) || 1, args.slice(3).join(' '), message.author);
        if (!res.ok) return reply(message, `❌ ${res.error}`);
        return reply(message, `🎉 Giveaway started — **${res.g.prize}**, ${res.g.winners} winner(s).`);
      }
      if (sub === 'end' || sub === 'reroll') {
        const id = args[1];
        if (!id) return reply(message, `Usage: \`?giveaway ${sub} <message-id>\``);
        const res = await giveaway.finish(message.guild, id, sub === 'reroll' ? { manualWinners: 1 } : {});
        if (!res.ok) return reply(message, `❌ ${res.error}`);
        return reply(message, sub === 'reroll'
          ? `🎲 Rerolled — winner: ${res.winnerIds.map((w) => `<@${w}>`).join(', ') || 'no entries'}.`
          : `🎉 Giveaway ended — winner(s): ${res.winnerIds.map((w) => `<@${w}>`).join(', ') || 'no entries'}.`);
      }
      return reply(message, 'Usage: `?giveaway start <5m> <winners> <prize>` / `?giveaway end|reroll <id>`');
    }

    case 'activityrole': {
      const list = settings.activityRoles || (settings.activityRoles = []);
      const sub = args[0];
      if (!sub || sub === 'list') {
        if (!list.length) return reply(message, 'No activity roles. Usage: `?activityrole add <role> <messages>`');
        return reply(message, `**🏅 Activity Roles (${list.length})**\n${list.map((r) => `- <@&${r.roleId}> at **${r.messages}** messages`).join('\n')}`);
      }
      if (!isAdmin) return reply(message, '👑 Administrator permission required.');
      if (sub === 'add') {
        const role = resolveRole(args[1], message.guild);
        const msgs = parseInt(args[2], 10);
        if (!role || !msgs) return reply(message, 'Usage: `?activityrole add <role> <messages>`');
        const idx = list.findIndex((r) => r.roleId === role.id);
        if (idx >= 0) list[idx].messages = msgs;
        else list.push({ roleId: role.id, messages: msgs });
        store.save();
        return reply(message, `🏅 **${role.name}** is granted after **${msgs}** messages.`);
      }
      if (sub === 'remove') {
        const role = resolveRole(args[1], message.guild);
        if (!role) return reply(message, 'Provide a role.');
        settings.activityRoles = list.filter((r) => r.roleId !== role.id);
        store.save();
        return reply(message, `Removed **${role.name}** from activity roles.`);
      }
      return reply(message, 'Usage: `?activityrole add|remove|list`');
    }

    case 'botstats': {
      const up = process.uptime();
      const h = Math.floor(up / 3600), m = Math.floor((up % 3600) / 60), s = Math.floor(up % 60);
      const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
      return reply(message, `**🤖 Dev Info — ${client.user.tag}**\nUptime: **${h}h ${m}m ${s}s**\nHeap: **${mem} MB**\nNode: ${process.version} · discord.js: ${require('discord.js').version}\nGuilds: **${client.guilds.cache.size}** · Members: **${client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)}**`);
    }

    case 'avatar': {
      const target = args[0] ? resolveUser(args[0], message.guild) || message.author : message.author;
      return message.channel.send({ content: `**${target.tag}**`, files: [target.displayAvatarURL({ size: 1024, extension: 'png' })] }).catch(() => reply(message, `**${target.tag}**: ${target.displayAvatarURL({ size: 1024 })}`));
    }

    case 'banner': {
      const target = args[0] ? resolveUser(args[0], message.guild) || message.author : message.author;
      const full = await target.fetch(true).catch(() => null);
      const url = full && full.banner ? full.bannerURL({ size: 1024 }) : null;
      if (!url) return reply(message, `${target.tag} has no banner.`);
      return message.channel.send({ content: `**${target.tag}**`, files: [url] }).catch(() => reply(message, url));
    }

    case 'serverinfo': {
      const g = message.guild;
      await g.members.fetch().catch(() => {});
      const bots = [...g.members.cache.values()].filter((m) => m.user.bot).length;
      return reply(message, `**📋 ${g.name}** \`${g.id}\`\nOwner: <@${g.ownerId}>\nMembers: **${g.memberCount}** (${bots} bots) · Channels: ${g.channels.cache.size} · Roles: ${g.roles.cache.size - 1}\nBoost tier: **${g.premiumTier}/3** (${g.premiumSubscriptionCount || 0} boosts)\nCreated: <t:${Math.floor(g.createdTimestamp / 1000)}:f>`);
    }

    case 'emoji': {
      const m = (args[0] || '').match(/<(a?):(\w+):(\d+)>/);
      if (!m) return reply(message, 'Usage: `?emoji <emoji>` — use a custom emoji like `<:name:id>`.');
      const url = `https://cdn.discordapp.com/emojis/${m[3]}.${m[1] === 'a' ? 'gif' : 'png'}?size=256`;
      return message.channel.send({ files: [url] }).catch(() => reply(message, url));
    }

    case 'poll': {
      const question = args.join(' ');
      if (!question) return reply(message, 'Usage: `?poll <question>` — people vote 👍/👎.');
      const msg = await message.channel.send(`📊 **${question}**`).catch(() => null);
      if (msg) {
        await msg.react('👍').catch(() => {});
        await msg.react('👎').catch(() => {});
      }
      return null;
    }

    default:
      return false;
  }
}

module.exports = { handlePrefix };
