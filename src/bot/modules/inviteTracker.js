const fs = require('fs');
const config = require('../../config');

let cached = {};
let saving = false;

function load() {
  try {
    cached = JSON.parse(fs.readFileSync(config.invitesFile, 'utf8'));
  } catch {
    cached = {};
  }
}

function save() {
  if (saving) return;
  saving = true;
  fs.writeFileSync(config.invitesFile, JSON.stringify(cached, null, 2), 'utf8', () => { saving = false; });
}

async function track(guild) {
  try {
    const invites = await guild.invites.fetch();
    cached[guild.id] = {};
    invites.forEach((inv) => { cached[guild.id][inv.code] = inv.uses || 0; });
    save();
  } catch {}
}

async function usedInvite(guild) {
  if (!cached[guild.id]) await track(guild);
  const before = cached[guild.id] || {};
  try {
    const invites = await guild.invites.fetch();
    let found = null;
    invites.forEach((inv) => {
      const uses = inv.uses || 0;
      if ((before[inv.code] || 0) < uses) {
        found = { code: inv.code, inviter: inv.inviter ? inv.inviter.tag : 'Unknown', uses };
      }
    });
    cached[guild.id] = cached[guild.id] || {};
    invites.forEach((inv) => { cached[guild.id][inv.code] = inv.uses || 0; });
    save();
    return found;
  } catch {
    return null;
  }
}

module.exports = { load, track, usedInvite };
