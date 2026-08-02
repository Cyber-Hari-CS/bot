const store = require('../../store');

const buckets = new Map();

function prune() {
  const now = Date.now();
  for (const [key, b] of buckets) {
    b.times = b.times.filter((t) => now - t < 60000);
    if (b.times.length === 0) buckets.delete(key);
  }
}

setInterval(prune, 30000);

function check(guild, member, message, settings) {
  if (!settings.enabled) return null;
  if (!member || member.id === guild.client.user.id) return null;

  const key = `${guild.id}:${member.id}`;
  const now = Date.now();
  const bucket = buckets.get(key) || { times: [], mentions: 0, warned: false, nextAction: 0 };
  bucket.times = bucket.times.filter((t) => now - t < settings.windowSec * 1000);
  bucket.times.push(now);

  if (message && message.mentions && message.mentions.users.size > 0) {
    bucket.mentions += message.mentions.users.size;
  }
  buckets.set(key, bucket);

  if (now < bucket.nextAction) return null;

  if (bucket.times.length >= settings.maxMessages) {
    bucket.nextAction = now + settings.windowSec * 1000;
    return { type: 'spam', reason: `Sent ${bucket.times.length} messages in ${settings.windowSec}s` };
  }

  if (message && message.mentions && message.mentions.users.size >= settings.maxMentions) {
    bucket.nextAction = now + settings.windowSec * 1000;
    return { type: 'mentions', reason: `Mentioned ${message.mentions.users.size} users in one message` };
  }

  return null;
}

module.exports = { check };
