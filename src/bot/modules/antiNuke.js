const store = require('../../store');
const antiRaid = require('./antiRaid');

const buckets = new Map();

const ACTIONS = {
  channelDelete: { threshold: 'maxChannelDeletes', label: 'channels deleted' },
  roleDelete: { threshold: 'maxRoleDeletes', label: 'roles deleted' },
  ban: { threshold: 'maxBans', label: 'members banned' },
  kick: { threshold: 'maxKicks', label: 'members kicked' },
  webhook: { threshold: 'maxWebhooks', label: 'webhooks created' },
  bot: { threshold: 'maxBots', label: 'bots added' },
};

function prune() {
  const now = Date.now();
  for (const [guildId, actions] of buckets) {
    for (const [action, times] of actions) {
      buckets.get(guildId).set(action, times.filter((t) => now - t < 120000));
    }
    if ([...actions.values()].every((t) => t.length === 0)) buckets.delete(guildId);
  }
}

setInterval(prune, 30000);

function count(guildId, action, settings) {
  const now = Date.now();
  if (!buckets.has(guildId)) buckets.set(guildId, new Map());
  const actions = buckets.get(guildId);
  const times = (actions.get(action) || []).filter((t) => now - t < settings.windowSec * 1000);
  times.push(now);
  actions.set(action, times);
  return times.length;
}

async function check(guild, action, actor, reason) {
  const settings = store.guildSettings(guild.id);
  const nuke = settings.antiNuke;
  if (!nuke.enabled) return false;
  if (actor && actor.id === guild.client.user.id) return false;

  const meta = ACTIONS[action];
  if (!meta) return false;

  const c = count(guild.id, action, nuke);
  if (c < nuke[meta.threshold]) return false;

  const by = actor ? actor.tag : 'Unknown';

  if (!antiRaid.isActive(guild.id)) {
    antiRaid.triggerRaid(guild, { lockdownDurationMin: nuke.lockdownMinutes });
  }

  store.pushAlert(guild.id, {
    type: 'nuke',
    level: 'critical',
    title: '⚠️ NUKE DETECTED',
    message: `${c} ${meta.label} in ${nuke.windowSec}s by **${by}** — lockdown enabled${reason ? ` (${reason})` : ''}`,
    userId: actor ? actor.id : undefined,
  });

  if (actor && !actor.bot) {
    try {
      const member = await guild.members.fetch(actor.id).catch(() => null);
      if (member && member.moderatable) {
        await member.timeout(nuke.lockdownMinutes * 60000, `Anti-nuke: ${c} ${meta.label} in ${nuke.windowSec}s`);
      }
    } catch {}
  }

  return true;
}

module.exports = { check, count, ACTIONS };
