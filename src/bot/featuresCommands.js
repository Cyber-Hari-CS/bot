const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
} = require('discord.js');
const store = require('../store');
const audit = require('./modules/auditLogger');
const perms = require('./modules/perms');
const joinLog = require('./modules/joinLog');
const quarantine = require('./modules/quarantine');
const tempVoice = require('./modules/tempVoice');
const giveaway = require('./modules/giveaway');
const economy = require('./modules/economy');
const levels = require('./modules/levels');
const tickets = require('./modules/tickets');
const security = require('./modules/security');
const config = require('../config');

function err(interaction, text) {
  return interaction.reply({ content: `❌ ${text}`, flags: 64 });
}
function ok(interaction, text) {
  if (text && typeof text === 'object') return interaction.reply({ ...text, flags: 64 });
  return interaction.reply({ content: text, flags: 64 });
}

function hexToInt(hex) {
  const m = String(hex || '').replace('#', '').match(/^[0-9a-fA-F]{6}$/);
  return m ? parseInt(m[0], 16) : null;
}

const CMD = {};
const BUILT = [];

function def(builder, handler) {
  const name = builder.name;
  BUILT.push(builder);
  CMD[name] = handler;
}

def(
  new SlashCommandBuilder().setName('userinfo').setDescription('Full account information of a user (join logs)')
    .addUserOption((o) => o.setName('user').setDescription('User to inspect')),
  async (i, s) => {
    const target = i.options.getUser('user') || i.user;
    const member = i.guild.members.cache.get(target.id) || (await i.guild.members.fetch(target.id).catch(() => null));
    const created = Math.floor(target.createdTimestamp / 1000);
    const flags = target.flags ? target.flags.toArray() : [];
    const score = member ? security.riskScore(member, s) : 0;
    const [lvl] = security.riskLevel(score);
    const lines = [
      `**🔎 ${target.tag}** \`${target.id}\``,
      `Account created: <t:${created}:f> (<t:${created}:R>)`,
      target.bot ? '🤖 Bot account' : '👤 Human account',
      flags.length ? `Badges: ${flags.join(', ')}` : 'Badges: none',
    ];
    if (member) {
      lines.push(`Joined server: <t:${Math.floor(member.joinedTimestamp / 1000)}:f>`);
      lines.push(`Roles (${member.roles.cache.size - 1}): ${member.roles.cache.map((r) => r.name).filter((n) => n !== '@everyone').slice(0, 10).join(', ') || 'none'}`);
      lines.push(`Warnings: **${store.getWarnings(i.guildId, target.id).length}** · Risk: **${score}/100** (${lvl})`);
      lines.push(`Quarantined: ${quarantine.isQuarantined(i.guildId, target.id) ? '⚠️ yes' : 'no'} · Verified: ${store.data.verified[`${i.guildId}:${target.id}`] ? '✅' : '❌'}`);
      if (member.communicationDisabledUntil) lines.push('⏰ Currently timed out');
    }
    const emb = new EmbedBuilder().setDescription(lines.join('\n')).setThumbnail(target.displayAvatarURL({ size: 256 })).setColor(0x5865f2);
    return ok(i, { content: '', embeds: [emb] });
  },
);

def(
  new SlashCommandBuilder().setName('joinlog').setDescription('Log detailed member info when someone joins (Admin)')
    .addSubcommand((sc) => sc.setName('setup').setDescription('Set the join log channel').addChannelOption((o) => o.setName('channel').setDescription('Channel for join logs').setRequired(true)))
    .addSubcommand((sc) => sc.setName('off').setDescription('Disable join logging')),
  async (i, s) => {
    if (!perms.isAdmin(i.member, s)) return err(i, 'Administrator permission required.');
    if (i.options.getSubcommand() === 'off') {
      s.joinLog.enabled = false;
      store.save();
      return ok(i, 'Join logging disabled.');
    }
    const ch = i.options.getChannel('channel');
    s.joinLog.enabled = true;
    s.joinLog.channelId = ch.id;
    store.save();
    return ok(i, `📥 Join logs will be posted in <#${ch.id}> — user info, account age, badges, invite used, risk score.`);
  },
);

def(
  new SlashCommandBuilder().setName('leavelog').setDescription('Log when members leave (Admin)')
    .addSubcommand((sc) => sc.setName('setup').setDescription('Set the leave log channel').addChannelOption((o) => o.setName('channel').setDescription('Channel for leave logs').setRequired(true)))
    .addSubcommand((sc) => sc.setName('off').setDescription('Disable leave logging')),
  async (i, s) => {
    if (!perms.isAdmin(i.member, s)) return err(i, 'Administrator permission required.');
    if (i.options.getSubcommand() === 'off') {
      s.leaveLog.enabled = false;
      store.save();
      return ok(i, 'Leave logging disabled.');
    }
    const ch = i.options.getChannel('channel');
    s.leaveLog.enabled = true;
    s.leaveLog.channelId = ch.id;
    store.save();
    return ok(i, `📤 Leave logs will be posted in <#${ch.id}>.`);
  },
);

def(
  new SlashCommandBuilder().setName('extraowner').setDescription('Manage extra owners (Admin)')
    .addSubcommand((sc) => sc.setName('add').setDescription('Add an extra owner').addUserOption((o) => o.setName('user').setDescription('User to add').setRequired(true)))
    .addSubcommand((sc) => sc.setName('remove').setDescription('Remove an extra owner').addUserOption((o) => o.setName('user').setDescription('User to remove').setRequired(true)))
    .addSubcommand((sc) => sc.setName('list').setDescription('List extra owners')),
  async (i, s) => {
    const list = s.extraOwners || (s.extraOwners = []);
    if (i.options.getSubcommand() === 'list') {
      return ok(i, `**👑 Extra Owners (${list.length})**\n${list.map((id) => `<@${id}>`).join('\n') || 'none'}`);
    }
    if (!perms.isAdmin(i.member, s)) return err(i, 'Administrator permission required.');
    const user = i.options.getUser('user');
    if (i.options.getSubcommand() === 'add') {
      if (list.includes(user.id)) return err(i, 'Already an extra owner.');
      list.push(user.id);
      store.save();
      audit.emit(i.guild, 'extra_owner', '👑 Extra Owner', `**${user.tag}** was added as an extra owner by **${i.user.tag}**.`, 0x5865f2);
      return ok(i, `👑 **${user.tag}** is now an extra owner — full owner powers.`);
    }
    s.extraOwners = list.filter((id) => id !== user.id);
    store.save();
    return ok(i, `Removed **${user.tag}** from extra owners.`);
  },
);

def(
  new SlashCommandBuilder().setName('quarantine').setDescription('Quarantine a member: strip all roles (Mod)')
    .addUserOption((o) => o.setName('user').setDescription('Member to quarantine').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason')),
  async (i, s) => {
    if (!perms.isModerator(i.member, s)) return err(i, 'Moderator permission required.');
    const target = i.options.getMember('user');
    if (!target) return err(i, 'User is not in this server.');
    if (perms.isModerator(target, s)) return err(i, 'You cannot quarantine a moderator or owner.');
    if (quarantine.isQuarantined(i.guildId, target.id)) return err(i, 'User is already quarantined.');
    if (!s.quarantine.roleId) return err(i, 'No quarantine role set. Use `/quarantine-setup` first.');
    await quarantine.quarantine(target, i.user, i.options.getString('reason'));
    return ok(i, `🧪 Quarantined **${target.user.tag}** — all roles removed, voice moved to quarantine. Use \`/unquarantine\` to restore.`);
  },
);

def(
  new SlashCommandBuilder().setName('quarantine-setup').setDescription('Set the quarantine role and channel (Admin)')
    .addRoleOption((o) => o.setName('role').setDescription('Role given to quarantined members').setRequired(true))
    .addChannelOption((o) => o.setName('channel').setDescription('Voice channel to move quarantined members to')),
  async (i, s) => {
    if (!perms.isAdmin(i.member, s)) return err(i, 'Administrator permission required.');
    const role = i.options.getRole('role');
    const ch = i.options.getChannel('channel');
    s.quarantine.roleId = role.id;
    if (ch) s.quarantine.channelId = ch.id;
    store.save();
    return ok(i, `🧪 Quarantine role set to **${role.name}**${ch ? `, quarantine voice channel <#${ch.id}>` : ''}.`);
  },
);

def(
  new SlashCommandBuilder().setName('unquarantine').setDescription('Release a quarantined member and restore roles (Mod)')
    .addUserOption((o) => o.setName('user').setDescription('Member to release').setRequired(true)),
  async (i, s) => {
    if (!perms.isModerator(i.member, s)) return err(i, 'Moderator permission required.');
    const target = i.options.getMember('user');
    if (!target) return err(i, 'User is not in this server.');
    const entry = await quarantine.unquarantine(target, i.user);
    if (!entry) return err(i, 'User is not quarantined.');
    return ok(i, `✅ Released **${target.user.tag}** — **${entry.roles.length}** roles restored.`);
  },
);

def(
  new SlashCommandBuilder().setName('role-create').setDescription('Create a role (Admin)')
    .addStringOption((o) => o.setName('name').setDescription('Role name').setRequired(true))
    .addStringOption((o) => o.setName('color').setDescription('Hex color, e.g. FF0000'))
    .addBooleanOption((o) => o.setName('hoist').setDescription('Display separately in the member list'))
    .addBooleanOption((o) => o.setName('mentionable').setDescription('Allow everyone to mention it')),
  async (i, s) => {
    if (!perms.isAdmin(i.member, s)) return err(i, 'Administrator permission required.');
    const color = hexToInt(i.options.getString('color')) || 0;
    const role = await i.guild.roles.create({
      name: i.options.getString('name'),
      color,
      hoist: i.options.getBoolean('hoist') || false,
      mentionable: i.options.getBoolean('mentionable') || false,
      reason: `role-create by ${i.user.tag}`,
    }).catch((e) => null);
    if (!role) return err(i, 'Could not create the role (check bot permissions).');
    audit.emit(i.guild, 'role_create', '🆕 Role Created', `**${role.name}** created by **${i.user.tag}**.`, 0x57f287);
    return ok(i, `✅ Created role **${role.name}** (${color ? `color \`#${color.toString(16).padStart(6, '0')}\`` : 'default color'}).`);
  },
);

def(
  new SlashCommandBuilder().setName('role-delete').setDescription('Delete a role (Admin)')
    .addRoleOption((o) => o.setName('role').setDescription('Role to delete').setRequired(true)),
  async (i, s) => {
    if (!perms.isAdmin(i.member, s)) return err(i, 'Administrator permission required.');
    const role = i.options.getRole('role');
    if (role.managed) return err(i, 'Cannot delete an integrated role.');
    if (role.position >= i.member.roles.highest.position) return err(i, 'That role is above your highest role.');
    await role.delete(`role-delete by ${i.user.tag}`).catch((e) => err(i, `Failed: ${e.message}`));
    audit.emit(i.guild, 'role_delete', '🗑️ Role Deleted', `**${role.name}** deleted by **${i.user.tag}**.`, 0xed4245);
    return ok(i, `🗑️ Deleted role **${role.name}**.`);
  },
);

def(
  new SlashCommandBuilder().setName('role-rename').setDescription('Rename a role (Admin)')
    .addRoleOption((o) => o.setName('role').setDescription('Role to rename').setRequired(true))
    .addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true)),
  async (i, s) => {
    if (!perms.isAdmin(i.member, s)) return err(i, 'Administrator permission required.');
    const role = i.options.getRole('role');
    await role.setName(i.options.getString('name'), `role-rename by ${i.user.tag}`).catch((e) => err(i, `Failed: ${e.message}`));
    return ok(i, `✏️ Renamed role to **${role.name}**.`);
  },
);

def(
  new SlashCommandBuilder().setName('role-color').setDescription('Change a role color (Admin)')
    .addRoleOption((o) => o.setName('role').setDescription('Role to recolor').setRequired(true))
    .addStringOption((o) => o.setName('color').setDescription('Hex color, e.g. FF0000').setRequired(true)),
  async (i, s) => {
    if (!perms.isAdmin(i.member, s)) return err(i, 'Administrator permission required.');
    const color = hexToInt(i.options.getString('color'));
    if (color === null) return err(i, 'Invalid color. Use hex like FF0000 or #FF0000.');
    const role = i.options.getRole('role');
    await role.setColor(color, `role-color by ${i.user.tag}`).catch((e) => err(i, `Failed: ${e.message}`));
    return ok(i, `🎨 **${role.name}** is now \`#${color.toString(16).padStart(6, '0')}\`.`);
  },
);

def(
  new SlashCommandBuilder().setName('role-members').setDescription('List members holding a role')
    .addRoleOption((o) => o.setName('role').setDescription('Role to inspect').setRequired(true)),
  async (i, s) => {
    const role = i.options.getRole('role');
    await i.guild.members.fetch().catch(() => {});
    const members = [...i.guild.members.cache.values()].filter((m) => m.roles.cache.has(role.id));
    if (!members.length) return ok(i, `No members have **${role.name}**.`);
    const lines = members.slice(0, 20).map((m) => `- **${m.user.tag}**${m.user.bot ? ' 🤖' : ''}`);
    return ok(i, `**${role.name}** — ${members.length} member(s)\n${lines.join('\n')}`);
  },
);

def(
  new SlashCommandBuilder().setName('roleauth').setDescription('Restrict commands to specific roles (Admin)')
    .addSubcommand((sc) => sc.setName('enable').setDescription('Enable role auth'))
    .addSubcommand((sc) => sc.setName('disable').setDescription('Disable role auth'))
    .addSubcommand((sc) => sc.setName('add').setDescription('Require a role for a command').addStringOption((o) => o.setName('command').setDescription('Command name without slash').setRequired(true)).addRoleOption((o) => o.setName('role').setDescription('Required role').setRequired(true)))
    .addSubcommand((sc) => sc.setName('remove').setDescription('Remove a role requirement').addStringOption((o) => o.setName('command').setDescription('Command name').setRequired(true)).addRoleOption((o) => o.setName('role').setDescription('Role to remove').setRequired(true)))
    .addSubcommand((sc) => sc.setName('list').setDescription('List auth rules')),
  async (i, s) => {
    const sub = i.options.getSubcommand();
    const ra = s.roleAuth;
    if (sub === 'list') {
      if (!ra.rules.length) return ok(i, 'No role auth rules set.');
      const lines = ra.rules.map((r) => `- \`/${r.command}\` → ${r.roles.map((id) => `<@&${id}>`).join(', ')}`);
      return ok(i, `**🔐 Role Auth ${ra.enabled ? '(ON)' : '(OFF)'}**\n${lines.join('\n')}`);
    }
    if (!perms.isAdmin(i.member, s)) return err(i, 'Administrator permission required.');
    if (sub === 'enable') { ra.enabled = true; store.save(); return ok(i, '🔐 Role auth enabled — restricted commands now check roles.'); }
    if (sub === 'disable') { ra.enabled = false; store.save(); return ok(i, '🔐 Role auth disabled.'); }
    const cmd = (i.options.getString('command') || '').toLowerCase().replace(/^\//, '');
    const role = i.options.getRole('role');
    let rule = ra.rules.find((r) => r.command === cmd);
    if (sub === 'add') {
      if (!rule) { rule = { command: cmd, roles: [] }; ra.rules.push(rule); }
      if (rule.roles.includes(role.id)) return err(i, 'That role is already required.');
      rule.roles.push(role.id);
      store.save();
      return ok(i, `🔐 \`/${cmd}\` now requires **${role.name}**.`);
    }
    if (!rule) return err(i, `No auth rule for \`/${cmd}\`.`);
    rule.roles = rule.roles.filter((id) => id !== role.id);
    if (!rule.roles.length) ra.rules = ra.rules.filter((r) => r.command !== cmd);
    store.save();
    return ok(i, `Removed **${role.name}** from \`/${cmd}\`.`);
  },
);

def(
  new SlashCommandBuilder().setName('vc').setDescription('Voice channel management (Mod)')
    .addSubcommand((sc) => sc.setName('kick').setDescription('Disconnect a user from voice').addUserOption((o) => o.setName('user').setDescription('User to disconnect').setRequired(true)))
    .addSubcommand((sc) => sc.setName('mute').setDescription('Server-mute a user in voice').addUserOption((o) => o.setName('user').setDescription('User to mute').setRequired(true)))
    .addSubcommand((sc) => sc.setName('unmute').setDescription('Unmute a user in voice').addUserOption((o) => o.setName('user').setDescription('User to unmute').setRequired(true)))
    .addSubcommand((sc) => sc.setName('deafen').setDescription('Deafen a user in voice').addUserOption((o) => o.setName('user').setDescription('User to deafen').setRequired(true)))
    .addSubcommand((sc) => sc.setName('undeafen').setDescription('Undeafen a user in voice').addUserOption((o) => o.setName('user').setDescription('User to undeafen').setRequired(true)))
    .addSubcommand((sc) => sc.setName('move').setDescription('Move a user to another voice channel').addUserOption((o) => o.setName('user').setDescription('User to move').setRequired(true)).addChannelOption((o) => o.setName('channel').setDescription('Target voice channel').setRequired(true)))
    .addSubcommand((sc) => sc.setName('list').setDescription('List everyone in voice channels')),
  async (i, s) => {
    const sub = i.options.getSubcommand();
    if (sub !== 'list' && !perms.isModerator(i.member, s)) return err(i, 'Moderator permission required.');
    if (sub === 'list') {
      const vcs = [...i.guild.channels.cache.values()].filter((c) => c.type === ChannelType.GuildVoice && c.members.size > 0);
      if (!vcs.length) return ok(i, 'No one is in voice channels.');
      const lines = vcs.map((c) => `**${c.name}** (${c.members.size}) — ${c.members.map((m) => `**${m.user.tag}**${m.voice.mute ? ' 🔇' : ''}${m.voice.deaf ? ' 🔕' : ''}`).join(', ')}`);
      return ok(i, `**🎙️ Voice Channels**\n${lines.join('\n')}`);
    }
    const target = i.options.getMember('user');
    if (!target) return err(i, 'User is not in this server.');
    if (!target.voice || !target.voice.channelId) return err(i, 'User is not in a voice channel.');
    const actions = {
      kick: () => target.voice.disconnect('vc kick'),
      mute: () => target.voice.setMute(true, 'vc mute'),
      unmute: () => target.voice.setMute(false, 'vc unmute'),
      deafen: () => target.voice.setDeaf(true, 'vc deafen'),
      undeafen: () => target.voice.setDeaf(false, 'vc undeafen'),
    };
    if (sub === 'move') {
      const ch = i.options.getChannel('channel');
      if (!ch || ch.type !== ChannelType.GuildVoice) return err(i, 'Pick a voice channel.');
      await target.voice.setChannel(ch, 'vc move').catch((e) => err(i, `Failed: ${e.message}`));
      return ok(i, `➡️ Moved **${target.user.tag}** to **${ch.name}**.`);
    }
    const labels = { kick: 'Disconnected', mute: 'Muted', unmute: 'Unmuted', deafen: 'Deafened', undeafen: 'Undeafened' };
    await actions[sub]().catch((e) => err(i, `Failed: ${e.message}`));
    audit.emit(i.guild, 'vc_action', '🎙️ Voice Action', `**${target.user.tag}** ${labels[sub].toLowerCase()} in voice by **${i.user.tag}**.`, 0x5865f2);
    return ok(i, `🎙️ ${labels[sub]} **${target.user.tag}** in voice.`);
  },
);

def(
  new SlashCommandBuilder().setName('tempvoice').setDescription('Temporary voice channels (Admin)')
    .addSubcommand((sc) => sc.setName('setup').setDescription('Set the trigger channel').addChannelOption((o) => o.setName('channel').setDescription('Channel users join to spawn a temp channel').setRequired(true)).addChannelOption((o) => o.setName('category').setDescription('Category for spawned channels')))
    .addSubcommand((sc) => sc.setName('lock').setDescription('Toggle: private temp channels claimed by the creator'))
    .addSubcommand((sc) => sc.setName('off').setDescription('Disable temp voice')),
  async (i, s) => {
    if (!perms.isAdmin(i.member, s)) return err(i, 'Administrator permission required.');
    const sub = i.options.getSubcommand();
    if (sub === 'setup') {
      const ch = i.options.getChannel('channel');
      if (ch.type !== ChannelType.GuildVoice) return err(i, 'Pick a voice channel.');
      const cat = i.options.getChannel('category');
      s.tempVoice.enabled = true;
      s.tempVoice.channelId = ch.id;
      s.tempVoice.categoryId = cat ? cat.id : '';
      store.save();
      return ok(i, `🎛️ Temp voice enabled — joining **${ch.name}** spawns a private channel (auto-deleted when empty).`);
    }
    if (sub === 'lock') {
      s.tempVoice.lockOnClaim = !s.tempVoice.lockOnClaim;
      store.save();
      return ok(i, `🔒 Temp channels are now ${s.tempVoice.lockOnClaim ? '**private** to the creator (only they can join the trigger channel after claiming)' : '**public** (everyone can spawn one)'}.`);
    }
    s.tempVoice.enabled = false;
    store.save();
    return ok(i, 'Temporary voice disabled.');
  },
);

def(
  new SlashCommandBuilder().setName('channel').setDescription('Channel management (Admin)')
    .addSubcommand((sc) => sc.setName('create').setDescription('Create a channel').addStringOption((o) => o.setName('name').setDescription('Channel name').setRequired(true)).addStringOption((o) => o.setName('type').setDescription('text or voice').addChoices({ name: 'Text', value: 'text' }, { name: 'Voice', value: 'voice' })).addChannelOption((o) => o.setName('category').setDescription('Category')).addStringOption((o) => o.setName('topic').setDescription('Topic (text only)')))
    .addSubcommand((sc) => sc.setName('delete').setDescription('Delete a channel').addChannelOption((o) => o.setName('channel').setDescription('Channel to delete').setRequired(true)))
    .addSubcommand((sc) => sc.setName('rename').setDescription('Rename a channel').addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true)).addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true)))
    .addSubcommand((sc) => sc.setName('topic').setDescription('Set a channel topic').addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true)).addStringOption((o) => o.setName('topic').setDescription('Topic text').setRequired(true)))
    .addSubcommand((sc) => sc.setName('slowmode').setDescription('Set slowmode seconds').addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true)).addIntegerOption((o) => o.setName('seconds').setDescription('Seconds (0-21600)').setMinValue(0).setMaxValue(21600).setRequired(true)))
    .addSubcommand((sc) => sc.setName('category').setDescription('Move a channel to a category').addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true)).addChannelOption((o) => o.setName('category').setDescription('Category')))
    .addSubcommand((sc) => sc.setName('nsfw').setDescription('Toggle NSFW on a text channel').addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true)).addBooleanOption((o) => o.setName('enabled').setDescription('on/off').setRequired(true)))
    .addSubcommand((sc) => sc.setName('lock').setDescription('Lock a channel to @everyone').addChannelOption((o) => o.setName('channel').setDescription('Channel')))
    .addSubcommand((sc) => sc.setName('unlock').setDescription('Unlock a channel for @everyone').addChannelOption((o) => o.setName('channel').setDescription('Channel'))),
  async (i, s) => {
    if (!perms.isAdmin(i.member, s)) return err(i, 'Administrator permission required.');
    const sub = i.options.getSubcommand();
    const pick = () => i.options.getChannel('channel') || i.channel;
    if (sub === 'create') {
      const type = i.options.getString('type') === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
      const cat = i.options.getChannel('category');
      const ch = await i.guild.channels.create({
        name: i.options.getString('name'),
        type,
        topic: i.options.getString('topic') || undefined,
        parent: cat ? cat.id : undefined,
        reason: `channel create by ${i.user.tag}`,
      }).catch((e) => null);
      if (!ch) return err(i, 'Could not create the channel.');
      audit.emit(i.guild, 'channel_create', '🆕 Channel Created', `**${ch.name}** created by **${i.user.tag}**.`, 0x57f287);
      return ok(i, `✅ Created ${type === ChannelType.GuildVoice ? '🔊' : '💬'} **${ch.name}**.`);
    }
    if (sub === 'delete') {
      const ch = i.options.getChannel('channel');
      if (!ch.deletable) return err(i, 'I cannot delete that channel.');
      await ch.delete(`channel delete by ${i.user.tag}`).catch((e) => err(i, `Failed: ${e.message}`));
      audit.emit(i.guild, 'channel_delete', '🗑️ Channel Deleted', `**${ch.name}** deleted by **${i.user.tag}**.`, 0xed4245);
      return ok(i, `🗑️ Deleted **${ch.name}**.`);
    }
    if (sub === 'rename') {
      const ch = pick();
      await ch.setName(i.options.getString('name'), `channel rename by ${i.user.tag}`).catch((e) => err(i, `Failed: ${e.message}`));
      return ok(i, `✏️ Channel renamed to **#${ch.name}**.`);
    }
    if (sub === 'topic') {
      const ch = pick();
      if (!ch.isTextBased()) return err(i, 'Topics only work on text channels.');
      await ch.setTopic(i.options.getString('topic'), `channel topic by ${i.user.tag}`).catch((e) => err(i, `Failed: ${e.message}`));
      return ok(i, `📌 Topic set on <#${ch.id}>.`);
    }
    if (sub === 'slowmode') {
      const ch = pick();
      if (!ch.isTextBased()) return err(i, 'Slowmode only works on text channels.');
      const secs = i.options.getInteger('seconds');
      await ch.setRateLimitPerUser(secs, `slowmode by ${i.user.tag}`).catch((e) => err(i, `Failed: ${e.message}`));
      return ok(i, `🐌 Slowmode on <#${ch.id}> set to **${secs}s**.`);
    }
    if (sub === 'category') {
      const ch = pick();
      const cat = i.options.getChannel('category');
      await ch.setParent(cat ? cat.id : null, { reason: `channel category by ${i.user.tag}` }).catch((e) => err(i, `Failed: ${e.message}`));
      return ok(i, `📁 Moved <#${ch.id}> ${cat ? `into **${cat.name}**` : 'out of any category'}.`);
    }
    if (sub === 'nsfw') {
      const ch = pick();
      if (!ch.isTextBased()) return err(i, 'NSFW only works on text channels.');
      await ch.setNSFW(i.options.getBoolean('enabled'), `nsfw by ${i.user.tag}`).catch((e) => err(i, `Failed: ${e.message}`));
      return ok(i, `🔞 <#${ch.id}> NSFW ${ch.nsfw ? 'enabled' : 'disabled'}.`);
    }
    if (sub === 'lock' || sub === 'unlock') {
      const ch = pick();
      if (sub === 'lock') {
        await ch.permissionOverwrites.create(i.guild.roles.everyone, { SendMessages: false, Connect: false }, 'channel lock').catch((e) => err(i, `Failed: ${e.message}`));
        return ok(i, `🔒 <#${ch.id}> locked.`);
      }
      await ch.permissionOverwrites.create(i.guild.roles.everyone, { SendMessages: null, Connect: null }, 'channel unlock').catch((e) => err(i, `Failed: ${e.message}`));
      return ok(i, `🔓 <#${ch.id}> unlocked.`);
    }
    return err(i, 'Unknown subcommand.');
  },
);

def(
  new SlashCommandBuilder().setName('media').setDescription('Media-only channels: text deleted unless it has an image/video (Admin)')
    .addSubcommand((sc) => sc.setName('add').setDescription('Make a channel media-only').addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true)))
    .addSubcommand((sc) => sc.setName('remove').setDescription('Remove media-only mode').addChannelOption((o) => o.setName('channel').setDescription('Channel').setRequired(true)))
    .addSubcommand((sc) => sc.setName('list').setDescription('List media-only channels')),
  async (i, s) => {
    const list = s.mediaChannels || (s.mediaChannels = []);
    if (i.options.getSubcommand() === 'list') {
      return ok(i, `**🖼️ Media-only channels (${list.length})**\n${list.map((id) => `<#${id}>`).join('\n') || 'none'}`);
    }
    if (!perms.isAdmin(i.member, s)) return err(i, 'Administrator permission required.');
    const ch = i.options.getChannel('channel');
    if (i.options.getSubcommand() === 'add') {
      if (list.includes(ch.id)) return err(i, 'Already media-only.');
      list.push(ch.id);
      store.save();
      return ok(i, `🖼️ <#${ch.id}> is now **media-only** — plain text messages are auto-deleted.`);
    }
    s.mediaChannels = list.filter((id) => id !== ch.id);
    store.save();
    return ok(i, `Removed media-only mode from <#${ch.id}>.`);
  },
);

def(
  new SlashCommandBuilder().setName('logconfig').setDescription('Configure audit logging toggles (Admin)')
    .addSubcommand((sc) => sc.setName('show').setDescription('Show current logging config'))
    .addSubcommand((sc) => sc.setName('set').setDescription('Toggle a log type').addStringOption((o) => o.setName('type').setDescription('Log type').setRequired(true).addChoices(
      { name: 'messages', value: 'messages' }, { name: 'members', value: 'members' }, { name: 'modactions', value: 'modactions' },
      { name: 'channels', value: 'channels' }, { name: 'roles', value: 'roles' },
    )).addBooleanOption((o) => o.setName('enabled').setDescription('on/off').setRequired(true))),
  async (i, s) => {
    if (i.options.getSubcommand() === 'show') {
      const a = s.audit;
      return ok(i, `**📋 Logging Management**\nAudit channel: ${a.channelId ? `<#${a.channelId}>` : 'not set'}\nMessages: ${a.logMessages ? '✅' : '❌'} · Members: ${a.logMembers ? '✅' : '❌'} · Mod actions: ${a.logModActions ? '✅' : '❌'}\nChannels: ${a.logChannels ? '✅' : '❌'} · Roles: ${a.logRoles ? '✅' : '❌'}\nUse \`/logconfig set\` to toggle.`);
    }
    if (!perms.isAdmin(i.member, s)) return err(i, 'Administrator permission required.');
    const map = {
      messages: 'logMessages', members: 'logMembers', modactions: 'logModActions',
      channels: 'logChannels', roles: 'logRoles',
    };
    const key = map[i.options.getString('type')];
    s.audit[key] = i.options.getBoolean('enabled');
    store.save();
    return ok(i, `📋 \`${key}\` is now ${s.audit[key] ? '✅ enabled' : '❌ disabled'}.`);
  },
);

def(
  new SlashCommandBuilder().setName('responder').setDescription('Auto responder: keyword triggers a reply (Admin)')
    .addSubcommand((sc) => sc.setName('add').setDescription('Add a trigger').addStringOption((o) => o.setName('trigger').setDescription('Keyword or phrase').setRequired(true)).addStringOption((o) => o.setName('response').setDescription('Reply text').setRequired(true)).addBooleanOption((o) => o.setName('exact').setDescription('Match exact message (default contains)')))
    .addSubcommand((sc) => sc.setName('remove').setDescription('Remove a trigger').addStringOption((o) => o.setName('trigger').setDescription('Trigger to remove').setRequired(true)))
    .addSubcommand((sc) => sc.setName('list').setDescription('List all triggers'))
    .addSubcommand((sc) => sc.setName('toggle').setDescription('Enable/disable the auto responder').addBooleanOption((o) => o.setName('enabled').setDescription('on/off').setRequired(true))),
  async (i, s) => {
    const sub = i.options.getSubcommand();
    const ar = s.autoResponder;
    if (sub === 'list') {
      if (!ar.rules.length) return ok(i, 'No auto responder triggers. Use `/responder add`.');
      const lines = ar.rules.slice(0, 25).map((r) => `- \`${r.trigger}\`${r.exact ? ' (exact)' : ''} → ${String(r.response).slice(0, 60)}`);
      return ok(i, `**🤖 Auto Responder ${ar.enabled ? '(ON)' : '(OFF)'} — ${ar.rules.length} trigger(s)**\n${lines.join('\n')}`);
    }
    if (!perms.isAdmin(i.member, s)) return err(i, 'Administrator permission required.');
    if (sub === 'toggle') {
      ar.enabled = i.options.getBoolean('enabled');
      store.save();
      return ok(i, `🤖 Auto responder is now ${ar.enabled ? '**ON**' : '**OFF**'}.`);
    }
    if (sub === 'add') {
      const trigger = i.options.getString('trigger');
      if (ar.rules.some((r) => r.trigger.toLowerCase() === trigger.toLowerCase())) return err(i, 'That trigger already exists.');
      ar.rules.push({ trigger, response: i.options.getString('response'), exact: i.options.getBoolean('exact') || false, enabled: true });
      store.save();
      return ok(i, `🤖 Added trigger \`${trigger}\` → \`${i.options.getString('response').slice(0, 80)}\``);
    }
    ar.rules = ar.rules.filter((r) => r.trigger.toLowerCase() !== i.options.getString('trigger').toLowerCase());
    store.save();
    return ok(i, 'Trigger removed.');
  },
);

def(
  new SlashCommandBuilder().setName('cc').setDescription('Custom bot commands: exact word triggers a response (Admin)')
    .addSubcommand((sc) => sc.setName('add').setDescription('Add a custom command').addStringOption((o) => o.setName('name').setDescription('Command word').setRequired(true)).addStringOption((o) => o.setName('response').setDescription('Response text').setRequired(true)))
    .addSubcommand((sc) => sc.setName('remove').setDescription('Remove a custom command').addStringOption((o) => o.setName('name').setDescription('Command word').setRequired(true)))
    .addSubcommand((sc) => sc.setName('list').setDescription('List custom commands')),
  async (i, s) => {
    const responder = require('./modules/autoResponder');
    if (i.options.getSubcommand() === 'list') {
      const list = responder.listCustomCommands(i.guildId);
      if (!list.length) return ok(i, 'No custom commands. Use `/cc add`.');
      return ok(i, `**💬 Custom Commands (${list.length})**\n${list.map(([k, v]) => `- \`${k}\` → ${String(v).slice(0, 60)}`).join('\n')}`);
    }
    if (!perms.isAdmin(i.member, s)) return err(i, 'Administrator permission required.');
    const name = (i.options.getString('name') || '').toLowerCase();
    if (i.options.getSubcommand() === 'add') {
      if (name.length > 24) return err(i, 'Command name must be 24 characters or fewer.');
      responder.addCustomCommand(i.guildId, name, i.options.getString('response'));
      return ok(i, `💬 Custom command \`${name}\` added — send \`${name}\` in chat to trigger it.`);
    }
    const removed = responder.removeCustomCommand(i.guildId, name);
    return removed ? ok(i, `Removed \`${name}\`.`) : err(i, `No custom command named \`${name}\`.`);
  },
);

def(
  new SlashCommandBuilder().setName('ticket').setDescription('Ticket system (Admin)')
    .addSubcommand((sc) => sc.setName('setup').setDescription('Post the ticket panel in a channel').addChannelOption((o) => o.setName('channel').setDescription('Channel for the panel').setRequired(true)).addChannelOption((o) => o.setName('category').setDescription('Category for tickets')).addRoleOption((o) => o.setName('support').setDescription('Support role that sees tickets')))
    .addSubcommand((sc) => sc.setName('add').setDescription('Add a user to this ticket').addUserOption((o) => o.setName('user').setDescription('User to add').setRequired(true)))
    .addSubcommand((sc) => sc.setName('remove').setDescription('Remove a user from this ticket').addUserOption((o) => o.setName('user').setDescription('User to remove').setRequired(true)))
    .addSubcommand((sc) => sc.setName('rename').setDescription('Rename this ticket').addStringOption((o) => o.setName('name').setDescription('New name').setRequired(true)))
    .addSubcommand((sc) => sc.setName('close').setDescription('Close this ticket').addStringOption((o) => o.setName('reason').setDescription('Reason')))
    .addSubcommand((sc) => sc.setName('transcripts').setDescription('List saved ticket transcripts')),
  async (i, s) => {
    const sub = i.options.getSubcommand();
    const t = s.tickets;
    if (sub === 'setup') {
      if (!perms.isAdmin(i.member, s)) return err(i, 'Administrator permission required.');
      const ch = i.options.getChannel('channel');
      const cat = i.options.getChannel('category');
      const support = i.options.getRole('support');
      t.panelChannelId = ch.id;
      if (cat) t.categoryId = cat.id;
      if (support) t.supportRoleId = support.id;
      await tickets.setupPanel(i.guild, ch, s);
      return ok(i, `🎫 Ticket panel posted in <#${ch.id}>.`);
    }
    if (sub === 'transcripts') {
      const list = store.data.transcripts.filter((x) => x.guildId === i.guildId).slice(-10).reverse();
      if (!list.length) return ok(i, 'No saved transcripts yet.');
      const lines = list.map((x) => `- <#${x.channelId}> — ${x.lines} msgs, closed by ${x.closedBy} <t:${Math.floor(x.at / 1000)}:R>`);
      return ok(i, `**📜 Transcripts (${list.length})**\n${lines.join('\n')}\n\nNote: full transcripts are stored locally in the bot data.`);
    }
    if (!tickets.isTicketChannel(i.channel)) return err(i, 'Run this in a ticket channel.');
    if (!tickets.hasSupportPerms(i.member, s) && sub !== 'close' && i.channel.name !== `ticket-${i.user.username.toLowerCase()}`) {
      return err(i, 'Support permission required.');
    }
    if (sub === 'add' || sub === 'remove') {
      const user = i.options.getUser('user');
      const perms2 = i.channel.permissionOverwrites.cache.get(user.id);
      if (sub === 'add') {
        await i.channel.permissionOverwrites.create(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }, 'ticket add').catch((e) => err(i, `Failed: ${e.message}`));
        return ok(i, `✅ Added <@${user.id}> to this ticket.`);
      }
      if (perms2 && perms2.allow.has(PermissionFlagsBits.ViewChannel)) {
        await i.channel.permissionOverwrites.delete(user.id, 'ticket remove').catch((e) => err(i, `Failed: ${e.message}`));
        return ok(i, `Removed <@${user.id}> from this ticket.`);
      }
      return err(i, 'User has no access to remove.');
    }
    if (sub === 'rename') {
      const name = i.options.getString('name').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 80);
      await i.channel.setName(`ticket-${name}`, 'ticket rename').catch((e) => err(i, `Failed: ${e.message}`));
      return ok(i, `✏️ Ticket renamed to **#${i.channel.name}**.`);
    }
    if (sub === 'close') {
      const reason = i.options.getString('reason') || 'No reason';
      await i.reply({ content: `🔒 Closing ticket...`, flags: 64 });
      const lines = await tickets.closeTicket(i.channel, i.user, reason);
      return null;
    }
    return err(i, 'Unknown subcommand.');
  },
);

def(
  new SlashCommandBuilder().setName('giveaway').setDescription('Giveaway management (Admin)')
    .addSubcommand((sc) => sc.setName('start').setDescription('Start a giveaway').addStringOption((o) => o.setName('duration').setDescription('e.g. 30s, 5m, 2h, 3d').setRequired(true)).addIntegerOption((o) => o.setName('winners').setDescription('Number of winners (1-20)').setRequired(true).setMinValue(1).setMaxValue(20)).addStringOption((o) => o.setName('prize').setDescription('What is being given away').setRequired(true)).addChannelOption((o) => o.setName('channel').setDescription('Channel (default: this one)')))
    .addSubcommand((sc) => sc.setName('end').setDescription('End a giveaway early').addStringOption((o) => o.setName('id').setDescription('Giveaway message ID').setRequired(true)))
    .addSubcommand((sc) => sc.setName('reroll').setDescription('Reroll a finished giveaway').addStringOption((o) => o.setName('id').setDescription('Giveaway message ID').setRequired(true)))
    .addSubcommand((sc) => sc.setName('list').setDescription('List active giveaways')),
  async (i, s) => {
    const sub = i.options.getSubcommand();
    if (sub === 'list') {
      const list = giveaway.listActive(i.guildId);
      if (!list.length) return ok(i, 'No active giveaways.');
      return ok(i, `**🎉 Active giveaways (${list.length})**\n${list.map((g) => `- **${g.prize}** — ${g.winners} winner(s), ends <t:${Math.floor(g.endsAt / 1000)}:R>, ${g.entries.length} entries`).join('\n')}`);
    }
    if (!perms.isAdmin(i.member, s)) return err(i, 'Administrator permission required.');
    if (sub === 'start') {
      const ch = i.options.getChannel('channel') || i.channel;
      const res = await giveaway.start(i.guild, ch, i.options.getString('duration'), i.options.getInteger('winners'), i.options.getString('prize'), i.user);
      if (!res.ok) return err(i, res.error);
      return ok(i, `🎉 Giveaway started in <#${ch.id}> — **${i.options.getString('prize')}**, ${i.options.getInteger('winners')} winner(s).`);
    }
    if (sub === 'end') {
      const id = i.options.getString('id');
      const res = await giveaway.finish(i.guild, id);
      if (!res.ok) return err(i, res.error);
      return ok(i, `🎉 Giveaway ended — winner(s): ${res.winnerIds.map((w) => `<@${w}>`).join(', ') || 'no entries'}.`);
    }
    if (sub === 'reroll') {
      const id = i.options.getString('id');
      const res = await giveaway.finish(i.guild, id, { manualWinners: 1 });
      if (!res.ok) return err(i, res.error);
      return ok(i, `🎲 Rerolled — new winner: ${res.winnerIds.map((w) => `<@${w}>`).join(', ') || 'no entries'}.`);
    }
    return err(i, 'Unknown subcommand.');
  },
);

def(
  new SlashCommandBuilder().setName('leaderboard').setDescription('Leaderboards (messages / level / economy)')
    .addStringOption((o) => o.setName('type').setDescription('Leaderboard type').setRequired(true).addChoices(
      { name: 'Messages', value: 'messages' }, { name: 'Level', value: 'level' }, { name: 'Economy (rich)', value: 'economy' },
    )),
  async (i, s) => {
    const type = i.options.getString('type');
    await i.guild.members.fetch().catch(() => {});
    if (type === 'economy') {
      const top = economy.top(i.guildId);
      if (!top.length) return ok(i, 'No economy data yet. Use `/work` and `/daily`.');
      const lines = top.map((a, n) => {
        const member = i.guild.members.cache.get(a.userId);
        return `${['🥇', '🥈', '🥉'][n] || `${n + 1}.`} **${member ? member.user.tag : a.userId}** — ${a.balance.toLocaleString()} 🪙`;
      });
      return ok(i, `**🪙 Economy Leaderboard**\n${lines.join('\n')}`);
    }
    const top = store.getTopLevels(i.guildId, 10);
    if (!top.length) return ok(i, 'No activity data yet — start chatting!');
    const lines = top.map((l, n) => {
      const member = i.guild.members.cache.get(l.userId);
      const lv = levels.levelFromXp(l.xp);
      return `${['🥇', '🥈', '🥉'][n] || `${n + 1}.`} **${member ? member.user.tag : l.userId}** — lvl ${lv} · ${l.messages} msgs`;
    });
    const title = type === 'messages' ? '💬 Message Leaderboard' : '📈 Level Leaderboard';
    return ok(i, `**${title}**\n${lines.join('\n')}`);
  },
);

def(
  new SlashCommandBuilder().setName('activityrole').setDescription('Auto-grant roles based on activity (Admin)')
    .addSubcommand((sc) => sc.setName('add').setDescription('Grant a role at a message count').addRoleOption((o) => o.setName('role').setDescription('Role to grant').setRequired(true)).addIntegerOption((o) => o.setName('messages').setDescription('Messages required').setRequired(true).setMinValue(1)))
    .addSubcommand((sc) => sc.setName('remove').setDescription('Remove an activity role').addRoleOption((o) => o.setName('role').setDescription('Role to remove').setRequired(true)))
    .addSubcommand((sc) => sc.setName('list').setDescription('List activity roles')),
  async (i, s) => {
    const list = s.activityRoles || (s.activityRoles = []);
    if (i.options.getSubcommand() === 'list') {
      if (!list.length) return ok(i, 'No activity roles set.');
      return ok(i, `**🏅 Activity Roles (${list.length})**\n${list.map((r) => `- <@&${r.roleId}> at **${r.messages}** messages`).join('\n')}`);
    }
    if (!perms.isAdmin(i.member, s)) return err(i, 'Administrator permission required.');
    const role = i.options.getRole('role');
    if (i.options.getSubcommand() === 'add') {
      const msg = i.options.getInteger('messages');
      const idx = list.findIndex((r) => r.roleId === role.id);
      if (idx >= 0) list[idx].messages = msg;
      else list.push({ roleId: role.id, messages: msg });
      store.save();
      return ok(i, `🏅 **${role.name}** is granted after **${msg}** messages.`);
    }
    s.activityRoles = list.filter((r) => r.roleId !== role.id);
    store.save();
    return ok(i, `Removed **${role.name}** from activity roles.`);
  },
);

def(
  new SlashCommandBuilder().setName('balance').setDescription('Check a wallet (economy)')
    .addUserOption((o) => o.setName('user').setDescription('User to check')),
  async (i, s) => {
    const target = i.options.getUser('user') || i.user;
    economy.ensure(i.guildId, i.user.id, s.economy);
    const acc = economy.balance(i.guildId, target.id);
    return ok(i, `🪙 **${target.tag}** has **${acc.balance.toLocaleString()}** coins (${acc.earned.toLocaleString()} earned).`);
  },
);

def(
  new SlashCommandBuilder().setName('daily').setDescription('Claim your daily coins (economy)'),
  async (i, s) => {
    const res = economy.daily(i.guildId, i.user.id, s.economy);
    if (!res.ok) return err(i, `Already claimed today. Come back <t:${Math.floor(res.nextAt / 1000)}:R> (${res.left} left).`);
    return ok(i, `✅ Daily claimed: **+${res.amount.toLocaleString()} 🪙**. Next claim <t:${Math.floor(res.nextAt / 1000)}:R>.`);
  },
);

def(
  new SlashCommandBuilder().setName('work').setDescription('Work for coins (economy, 1h cooldown)'),
  async (i, s) => {
    const res = economy.work(i.guildId, i.user.id, s.economy);
    if (!res.ok) return err(i, `You're tired. Work again <t:${Math.floor(res.nextAt / 1000)}:R> (${res.left} left).`);
    return ok(i, `💼 You ${res.msg} and earned **+${res.amount.toLocaleString()} 🪙**.`);
  },
);

def(
  new SlashCommandBuilder().setName('pay').setDescription('Send coins to another user (economy)')
    .addUserOption((o) => o.setName('user').setDescription('Recipient').setRequired(true))
    .addIntegerOption((o) => o.setName('amount').setDescription('Coins to send').setRequired(true).setMinValue(1)),
  async (i, s) => {
    const target = i.options.getUser('user');
    if (target.id === i.user.id) return err(i, 'You cannot pay yourself.');
    if (target.bot) return err(i, 'Bots do not accept coins.');
    const amount = i.options.getInteger('amount');
    const res = economy.pay(i.guildId, i.user.id, target.id, amount);
    if (!res.ok) return err(i, res.error);
    return ok(i, `💸 Sent **${amount.toLocaleString()} 🪙** to **${target.tag}**.`);
  },
);

def(
  new SlashCommandBuilder().setName('gamble').setDescription('Coin flip — double or lose (economy)')
    .addIntegerOption((o) => o.setName('amount').setDescription('Coins to bet').setRequired(true).setMinValue(1)),
  async (i, s) => {
    const amount = i.options.getInteger('amount');
    const res = economy.gamble(i.guildId, i.user.id, amount);
    if (!res.ok) return err(i, res.error);
    return res.win
      ? ok(i, `🪙 **You won!** +${res.amount.toLocaleString()} 🪙 — new balance **${res.newBalance.toLocaleString()}**.`)
      : ok(i, `😵 **You lost** ${res.amount.toLocaleString()} 🪙 — new balance **${res.newBalance.toLocaleString()}**.`);
  },
);

def(
  new SlashCommandBuilder().setName('avatar').setDescription('Show a user\'s avatar')
    .addUserOption((o) => o.setName('user').setDescription('User (default: you)')),
  async (i) => {
    const target = i.options.getUser('user') || i.user;
    const emb = new EmbedBuilder()
      .setTitle(`${target.tag}'s avatar`)
      .setImage(target.displayAvatarURL({ size: 1024 }))
      .setColor(0x5865f2);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open PNG').setURL(target.displayAvatarURL({ size: 1024, extension: 'png' })),
    );
    return ok(i, { content: '', embeds: [emb], components: [row] });
  },
);

def(
  new SlashCommandBuilder().setName('banner').setDescription('Show a user\'s banner')
    .addUserOption((o) => o.setName('user').setDescription('User (default: you)')),
  async (i) => {
    const target = i.options.getUser('user') || i.user;
    const full = await target.fetch(true).catch(() => null);
    const bannerURL = full && full.banner ? full.bannerURL({ size: 1024 }) : null;
    if (!bannerURL) return err(i, `${target.tag} has no banner.`);
    return ok(i, { content: '', embeds: [new EmbedBuilder().setTitle(`${target.tag}'s banner`).setImage(bannerURL).setColor(0x5865f2)] });
  },
);

def(
  new SlashCommandBuilder().setName('roleinfo').setDescription('Show role details')
    .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),
  async (i) => {
    const role = i.options.getRole('role');
    await i.guild.members.fetch().catch(() => {});
    const count = [...i.guild.members.cache.values()].filter((m) => m.roles.cache.has(role.id)).length;
    const keyPerms = ['Administrator', 'ManageGuild', 'BanMembers', 'KickMembers', 'ManageRoles', 'ManageChannels', 'ManageMessages', 'ModerateMembers']
      .filter((p) => role.permissions.has(p));
    return ok(i, `**${role.name}** \`${role.id}\`\nColor: \`#${role.color.toString(16).padStart(6, '0')}\`\nHoisted: ${role.hoist ? '✅' : '❌'} · Mentionable: ${role.mentionable ? '✅' : '❌'}\nMembers: **${count}**\n${keyPerms.length ? `Dangerous perms: ${keyPerms.join(', ')}` : 'No key permissions.'}`);
  },
);

def(
  new SlashCommandBuilder().setName('poll').setDescription('Create a poll')
    .addStringOption((o) => o.setName('question').setDescription('Poll question').setRequired(true))
    .addStringOption((o) => o.setName('option1').setDescription('Option 1'))
    .addStringOption((o) => o.setName('option2').setDescription('Option 2'))
    .addStringOption((o) => o.setName('option3').setDescription('Option 3'))
    .addStringOption((o) => o.setName('option4').setDescription('Option 4')),
  async (i) => {
    const q = i.options.getString('question');
    const opts = [1, 2, 3, 4].map((n) => i.options.getString(`option${n}`)).filter(Boolean);
    if (opts.length === 0) {
      await i.reply({ content: `📊 **${q}**`, flags: 64 });
      const msg = await i.fetchReply();
      await msg.react('👍').catch(() => {});
      await msg.react('👎').catch(() => {});
      return null;
    }
    if (opts.length > 4) return err(i, 'Max 4 options.');
    const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];
    await i.reply({ content: `📊 **${q}**\n\n${opts.map((o, n) => `${emojis[n]} ${o}`).join('\n')}` });
    const msg = await i.fetchReply();
    for (let n = 0; n < opts.length; n++) {
      await msg.react(emojis[n]).catch(() => {});
    }
    return null;
  },
);

def(
  new SlashCommandBuilder().setName('emoji').setDescription('Enlarge an emoji')
    .addStringOption((o) => o.setName('emoji').setDescription('Emoji to enlarge').setRequired(true)),
  async (i) => {
    const input = i.options.getString('emoji');
    const m = input.match(/<(a?):(\w+):(\d+)>/);
    if (!m) return err(i, 'That is not a custom emoji. Use `<:name:id>` or `<a:name:id>`.');
    const url = `https://cdn.discordapp.com/emojis/${m[3]}.${m[1] === 'a' ? 'gif' : 'png'}?size=256`;
    return ok(i, { content: `**${m[2]}**`, embeds: [new EmbedBuilder().setImage(url).setColor(0x5865f2)] });
  },
);

def(
  new SlashCommandBuilder().setName('serverinfo').setDescription('Show server information'),
  async (i) => {
    const g = i.guild;
    await g.members.fetch().catch(() => {});
    const bots = [...g.members.cache.values()].filter((m) => m.user.bot).length;
    const emb = new EmbedBuilder()
      .setTitle(g.name)
      .setThumbnail(g.iconURL({ size: 256 }) || null)
      .setColor(0x5865f2)
      .addFields([
        { name: 'ID', value: `\`${g.id}\``, inline: true },
        { name: 'Owner', value: g.ownerId ? `<@${g.ownerId}>` : 'unknown', inline: true },
        { name: 'Created', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:f>`, inline: true },
        { name: 'Members', value: `${g.memberCount} (${bots} bots, ${g.memberCount - bots} humans)`, inline: true },
        { name: 'Channels', value: String(g.channels.cache.size), inline: true },
        { name: 'Roles', value: String(g.roles.cache.size - 1), inline: true },
        { name: 'Boost Tier', value: `${g.premiumTier}/3 · ${g.premiumSubscriptionCount || 0} boosts`, inline: true },
        { name: 'Verification', value: String(g.verificationLevel), inline: true },
      ]);
    return ok(i, { content: '', embeds: [emb] });
  },
);

def(
  new SlashCommandBuilder().setName('boostinfo').setDescription('Server boost information'),
  async (i) => {
    const g = i.guild;
    return ok(i, `**🚀 Boost info — ${g.name}**\nTier: **${g.premiumTier}/3**\nBoosts: **${g.premiumSubscriptionCount || 0}**\nBoosted since: ${g.premiumSince ? `<t:${Math.floor(g.premiumSince.getTime() / 1000)}:f>` : 'never'}\n\nBoost the server to unlock more emoji slots, higher bitrate and animated icons!`);
  },
);

def(
  new SlashCommandBuilder().setName('botstats').setDescription('Developer info: bot statistics'),
  async (i) => {
    const up = process.uptime();
    const h = Math.floor(up / 3600), m = Math.floor((up % 3600) / 60), s = Math.floor(up % 60);
    const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
    const djs = require('discord.js').version;
    return ok(i, `**🤖 Dev Info — ${i.client.user.tag}**\nUptime: **${h}h ${m}m ${s}s**\nHeap: **${mem} MB**\nNode: ${process.version} · discord.js: ${djs}\nGuilds: **${i.client.guilds.cache.size}** · Members: **${i.client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)}**\nSlash commands: **${BUILT.length + 44}** (44 core + ${BUILT.length} feature)\nShard: 0/0`);
  },
);

function handle(interaction, settings) {
  if (!CMD[interaction.commandName]) return false;
  CMD[interaction.commandName](interaction, settings).catch((e) => {
    console.error('[FEAT]', interaction.commandName, e);
    if (!interaction.replied && !interaction.deferred) {
      interaction.reply({ content: '❌ Something went wrong.', flags: 64 }).catch(() => {});
    }
  });
  return true;
}

function build() {
  return BUILT;
}

module.exports = { handle, build };
