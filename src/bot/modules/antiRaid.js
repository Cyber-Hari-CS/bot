const store = require('../../store');

const raidState = new Map();

function isActive(guildId) {
  const r = raidState.get(guildId);
  return r && Date.now() < r.until;
}

function remaining(guildId) {
  const r = raidState.get(guildId);
  if (!r) return 0;
  return Math.max(0, Math.ceil((r.until - Date.now()) / 1000));
}

function triggerRaid(guild, settings) {
  const until = Date.now() + settings.lockdownDurationMin * 60 * 1000;
  raidState.set(guild.id, { until, lockdown: settings.lockdownDurationMin });
  store.pushAlert(guild.id, {
    type: 'raid',
    level: 'critical',
    title: 'RAID DETECTED',
    message: `Possible raid in progress — server locked down for ${settings.lockdownDurationMin} min.`,
  });
  return until;
}

function endRaid(guildId) {
  raidState.delete(guildId);
}

function checkJoin(guild, member, settings) {
  if (!settings.enabled) return { raid: false };
  const now = Date.now();
  const state = raidState.get(guild.id) || { joins: [], until: 0 };
  state.joins = state.joins.filter((j) => now - j < settings.windowSec * 1000);
  state.joins.push(now);
  raidState.set(guild.id, state);

  if (state.joins.length >= settings.maxJoins) {
    if (!isActive(guild.id)) {
      triggerRaid(guild, settings);
    }
    return { raid: true, joins: state.joins.length };
  }
  return { raid: false, joins: state.joins.length };
}

module.exports = { checkJoin, isActive, remaining, endRaid, triggerRaid };
