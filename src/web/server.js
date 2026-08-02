const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const config = require('../config');
const store = require('../store');
const antiRaid = require('../bot/modules/antiRaid');
const audit = require('../bot/modules/auditLogger');

let client = null;
let io = null;

function requireAuth(req, res, next) {
  const token = req.headers.authorization || req.query.token;
  if (token === config.dashboardToken) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

function broadcastAll() {
  if (!io || !client) return;
  const payload = getStatsPayload();
  io.emit('snapshot', payload);
}

function getStatsPayload() {
  const now = Date.now();
  const guilds = client ? [...client.guilds.cache.values()] : [];
  const totalMembers = guilds.reduce((a, g) => a + (g.memberCount || 0), 0);

  const guildStats = guilds.map((g) => {
    const settings = store.guildSettings(g.id);
    const events = store.data.events.filter((e) => e.guildId === g.id);
    const last24h = events.filter((e) => now - e.at < 86400000);
    return {
      id: g.id,
      name: g.name,
      icon: g.iconURL({ size: 64 }),
      members: g.memberCount || 0,
      online: g.approximatePresenceCount || 0,
      moderation: last24h.filter((e) => e.type.startsWith('mod_')).length,
      automod: last24h.filter((e) => e.type === 'automod').length,
      joins: last24h.filter((e) => e.type === 'member_join').length,
      leaves: last24h.filter((e) => e.type === 'member_leave').length,
      raidLockdown: antiRaid.isActive(g.id),
      raidRemaining: antiRaid.remaining(g.id),
      settings,
      alerts: store.data.alerts.filter((a) => a.guildId === g.id).slice(-5),
    };
  });

  return {
    uptime: process.uptime(),
    clientReady: !!client && client.isReady(),
    botUser: client ? { tag: client.user?.tag, id: client.user?.id } : null,
    totalGuilds: guilds.length,
    totalMembers,
    guilds: guildStats,
    events: store.data.events.slice(-100),
    alerts: store.data.alerts.slice(-50),
    warnings: store.data.warnings,
    verified: store.data.verified,
    users: store.data.users,
    raidActive: guilds.some((g) => antiRaid.isActive(g.id)),
  };
}

function startWebServer(botClient) {
  client = botClient;
  const app = express();
  const server = http.createServer(app);
  io = new Server(server, { cors: { origin: '*' } });

  store.emitter.on('event', () => broadcastAll());
  store.emitter.on('alert', () => broadcastAll());

  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (token === config.dashboardToken) return next();
    return next(new Error('Unauthorized'));
  });

  io.on('connection', (socket) => {
    socket.emit('snapshot', getStatsPayload());
  });

  app.get('/api/stats', requireAuth, (req, res) => res.json(getStatsPayload()));

  app.post('/api/guild/:guildId/settings', requireAuth, (req, res) => {
    if (!client.guilds.cache.has(req.params.guildId)) return res.status(404).json({ error: 'Guild not found' });
    const settings = store.guildSettings(req.params.guildId);
    Object.assign(settings, req.body.settings || {});
    store.save();
    audit.invalidate(req.params.guildId);
    broadcastAll();
    res.json({ ok: true, settings });
  });

  app.post('/api/guild/:guildId/ban', requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });
    const { userId, reason, days } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    try {
      await guild.members.ban(userId, { reason: reason || 'Banned from dashboard', deleteMessageSeconds: (days || 0) * 86400 });
      const user = await client.users.fetch(userId).catch(() => null);
      audit.modAction(guild, 'ban', user || userId, { tag: 'Web Dashboard' }, reason || 'Banned from dashboard');
      broadcastAll();
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/guild/:guildId/kick', requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });
    const { userId, reason } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    try {
      const member = await guild.members.fetch(userId);
      await member.kick(reason || 'Kicked from dashboard');
      audit.modAction(guild, 'kick', member.user, { tag: 'Web Dashboard' }, reason || 'Kicked from dashboard');
      broadcastAll();
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/guild/:guildId/mute', requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });
    const { userId, minutes, reason } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    try {
      const member = await guild.members.fetch(userId);
      await member.timeout((minutes || 10) * 60000, reason || 'Muted from dashboard');
      audit.modAction(guild, 'timeout', member.user, { tag: 'Web Dashboard' }, reason || 'Muted from dashboard', `${minutes || 10} min`);
      broadcastAll();
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/guild/:guildId/lockdown', requireAuth, (req, res) => {
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });
    const settings = store.guildSettings(guild.id);
    const minutes = Number(req.body.minutes) || settings.antiRaid.lockdownDurationMin;
    antiRaid.triggerRaid(guild, { lockdownDurationMin: minutes });
    audit.emit(guild, 'lockdown', '🔒 Server Lockdown', `Server locked down from web dashboard for ${minutes} min.`, 0xed4245);
    broadcastAll();
    res.json({ ok: true });
  });

  app.post('/api/guild/:guildId/raid-end', requireAuth, (req, res) => {
    antiRaid.endRaid(req.params.guildId);
    broadcastAll();
    res.json({ ok: true });
  });

  app.get('/api/guild/:guildId/members', requireAuth, async (req, res) => {
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });
    try {
      const members = await guild.members.fetch();
      const list = [...members.values()].map((m) => ({
        id: m.id,
        tag: m.user.tag,
        username: m.user.username,
        avatar: m.user.displayAvatarURL({ size: 32 }),
        roles: m.roles.cache.map((r) => ({ id: r.id, name: r.name })),
        joinedAt: m.joinedAt,
        isBot: m.user.bot,
      }));
      res.json({ members: list });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get('/api/events', requireAuth, (req, res) => res.json({ events: store.data.events.slice(-200) }));
  app.get('/api/alerts', requireAuth, (req, res) => res.json({ alerts: store.data.alerts.slice(-100) }));

  server.listen(config.port, () => {
    console.log(`[WEB] Dashboard running at http://localhost:${config.port}`);
  });
}

module.exports = { startWebServer, broadcastAll, getStatsPayload };
