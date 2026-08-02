const TOKEN_KEY = 'secbot_token';
let socket = null;
let state = null;
let currentGuild = null;
let membersCache = [];
let settingsDraft = null;

const $ = (id) => document.getElementById(id);

function fmtTime(ts) {
  const d = new Date(ts);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function esc(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

/* ---------------- Login ---------------- */

function showLogin() {
  $('login-screen').classList.remove('hidden');
  $('app').classList.add('hidden');
}

function showApp() {
  $('login-screen').classList.add('hidden');
  $('app').classList.remove('hidden');
}

function login() {
  const token = $('token-input').value.trim();
  if (!token) return;
  $('login-btn').disabled = true;
  $('login-error').classList.add('hidden');

  const probe = fetch('/api/stats', { headers: { authorization: token } })
    .then((r) => {
      if (!r.ok) throw new Error('bad');
      return r.json();
    })
    .then((data) => {
      localStorage.setItem(TOKEN_KEY, token);
      connectSocket(token);
      state = data;
      showApp();
      render();
    })
    .catch(() => {
      $('login-error').classList.remove('hidden');
    })
    .finally(() => { $('login-btn').disabled = false; });
}

$('login-btn').addEventListener('click', login);
$('token-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
$('logout-btn').addEventListener('click', () => {
  localStorage.removeItem(TOKEN_KEY);
  if (socket) socket.disconnect();
  state = null;
  showLogin();
});

/* ---------------- Socket ---------------- */

function connectSocket(token) {
  socket = io({ auth: { token } });
  socket.on('snapshot', (snap) => {
    state = snap;
    render();
  });
  socket.on('connect_error', () => showLogin());
}

/* ---------------- Navigation ---------------- */

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    const view = btn.dataset.view;
    const titles = { overview: 'Overview', events: 'Event Feed', alerts: 'Security Alerts', members: 'Members', settings: 'Settings' };
    $('page-title').textContent = titles[view];
    $(`view-${view}`).classList.add('active');
    if (view === 'members') loadMembers();
  });
});

$('guild-select').addEventListener('change', (e) => {
  currentGuild = e.target.value || null;
  render();
});

/* ---------------- Render ---------------- */

function render() {
  if (!state) return;
  updateStatus();
  updateGuildSelect();
  renderOverview();
  renderEvents();
  renderAlerts();
  renderSettings();
  renderMembersTable();
}

function updateStatus() {
  const el = $('bot-status');
  if (state.clientReady) {
    el.textContent = `● Online — ${state.botUser ? state.botUser.tag : ''}`;
    el.className = 'bot-status online';
  } else {
    el.textContent = '● Offline';
    el.className = 'bot-status offline';
  }
  const up = state.uptime || 0;
  const h = Math.floor(up / 3600), m = Math.floor((up % 3600) / 60);
  $('uptime').textContent = `Uptime ${h}h ${m}m · ${state.totalGuilds} server(s) · ${state.totalMembers.toLocaleString()} members`;
}

function updateGuildSelect() {
  const sel = $('guild-select');
  const current = sel.value;
  sel.innerHTML = '';
  const allOpt = document.createElement('option');
  allOpt.value = '';
  allOpt.textContent = '🌐 All servers';
  sel.appendChild(allOpt);
  (state.guilds || []).forEach((g) => {
    const opt = document.createElement('option');
    opt.value = g.id;
    opt.textContent = g.raidLockdown ? `🔒 ${g.name}` : g.name;
    sel.appendChild(opt);
  });
  if ([...sel.options].some((o) => o.value === current)) sel.value = current;
  currentGuild = sel.value || null;
}

function guildName(id) {
  const g = (state.guilds || []).find((x) => x.id === id);
  return g ? g.name : 'Unknown server';
}

function renderOverview() {
  const gs = state.guilds || [];
  $('stat-guilds').textContent = gs.length;
  $('stat-members').textContent = state.totalMembers.toLocaleString();
  $('stat-mod').textContent = gs.reduce((a, g) => a + g.moderation, 0);
  $('stat-alerts').textContent = (state.alerts || []).length;

  const raidGuild = gs.find((g) => g.raidLockdown);
  const banner = $('raid-banner');
  if (raidGuild) {
    banner.classList.remove('hidden');
    $('raid-countdown').textContent = `${raidGuild.name} — ends in ${raidGuild.raidRemaining}s`;
  } else {
    banner.classList.add('hidden');
  }

  const cards = $('guild-cards');
  cards.innerHTML = gs.length ? gs.map((g) => `
    <div class="guild-card">
      <div class="head">
        <img src="${g.icon || ''}" alt="">
        <div>
          <div class="name">${esc(g.name)}</div>
          <div class="meta">${g.members.toLocaleString()} members · ${g.online} online</div>
        </div>
      </div>
      <div class="stats">
        <span>🛠️ <b>${g.moderation}</b> mod</span>
        <span>⛔ <b>${g.automod}</b> auto</span>
        <span>⬆️ <b>${g.joins}</b> joins</span>
        <span>⬇️ <b>${g.leaves}</b> leaves</span>
      </div>
      ${g.raidLockdown ? '<span class="badge raid">🔒 RAID LOCKDOWN</span>' : '<span class="badge ok">✅ Protected</span>'}
    </div>
  `).join('') : '<div class="feed-empty">Bot is not in any servers yet. Add it to a server first.</div>';

  const feed = $('live-feed');
  feed.innerHTML = renderFeedItems((state.events || []).filter((e) => !currentGuild || e.guildId === currentGuild).slice(-25));
}

function feedIcon(e) {
  if (e.type === 'automod' || e.type === 'raid_join') return '⛔';
  if (e.type.startsWith('mod_')) return '🛠️';
  if (e.type === 'member_join') return '⬆️';
  if (e.type === 'member_leave') return '⬇️';
  if (e.type === 'member_ban') return '🔨';
  if (e.type === 'member_verify') return '✅';
  if (e.type === 'member_unban') return '🔓';
  if (e.type === 'message_delete') return '🗑️';
  if (e.type === 'message_edit') return '✏️';
  if (e.type === 'lockdown') return '🔒';
  if (e.type === 'raid_end') return '🛡️';
  return '📋';
}

function renderFeedItems(events) {
  if (!events.length) return '<div class="feed-empty">No activity yet.</div>';
  return events.slice().reverse().map((e) => `
    <div class="feed-item">
      <span class="icon">${feedIcon(e)}</span>
      <div class="body">
        <div class="title">${esc(e.title || e.type)}</div>
        <div class="desc">${esc(e.description || e.message || '')}</div>
        <div class="time" style="margin-top:3px">${esc(guildName(e.guildId))}</div>
      </div>
      <span class="time">${timeAgo(e.at)}</span>
    </div>
  `).join('');
}

function renderEvents() {
  const events = (state.events || []).filter((e) => !currentGuild || e.guildId === currentGuild);
  $('events-feed').innerHTML = renderFeedItems(events.slice(-150));
}

function renderAlerts() {
  const alerts = (state.alerts || []).filter((a) => !currentGuild || a.guildId === currentGuild);
  $('alerts-feed').innerHTML = alerts.length ? alerts.slice().reverse().map((a) => `
    <div class="feed-item ${a.level || 'info'}">
      <span class="icon">${a.level === 'critical' ? '🚨' : a.level === 'warning' ? '⚠️' : 'ℹ️'}</span>
      <div class="body">
        <div class="title">${esc(a.title)}</div>
        <div class="desc">${esc(a.message)}</div>
        <div class="time" style="margin-top:3px">${esc(guildName(a.guildId))}</div>
      </div>
      <span class="time">${timeAgo(a.at)}</span>
    </div>
  `).join('') : '<div class="feed-empty">No security alerts. 🎉</div>';
}

/* ---------------- Members ---------------- */

let membersSearch = '';
$('member-search').addEventListener('input', (e) => { membersSearch = e.target.value.toLowerCase(); renderMembersTable(); });

function renderMembersTable() {
  const list = $('members-list');
  const filtered = membersCache.filter((m) => !membersSearch || m.tag.toLowerCase().includes(membersSearch));
  list.innerHTML = filtered.length ? filtered.map((m) => {
    const warns = state.warnings ? (state.warnings[`${currentGuild}:${m.id}`] || []).length : 0;
    return `
    <div class="member-row">
      <img src="${m.avatar}" alt="">
      <div>
        <div class="m-name">${esc(m.tag)}${m.isBot ? ' 🤖' : ''}</div>
        <div class="m-id">${m.id}</div>
      </div>
      ${warns ? `<div class="m-warns">⚠️ ${warns} warn(s)</div>` : ''}
      <div class="m-btns">
        <button class="btn-mute" onclick="memberAction('${m.id}','mute')">Mute 10m</button>
        <button class="btn-kick" onclick="memberAction('${m.id}','kick')">Kick</button>
        <button class="btn-ban" onclick="memberAction('${m.id}','ban')">Ban</button>
      </div>
    </div>`;
  }).join('') : '<div class="feed-empty">No members found.</div>';
}

async function loadMembers() {
  if (!currentGuild) { membersCache = []; renderMembersTable(); return; }
  try {
    const res = await fetch(`/api/guild/${currentGuild}/members`, { headers: { authorization: localStorage.getItem(TOKEN_KEY) } });
    const data = await res.json();
    membersCache = data.members || [];
    renderMembersTable();
  } catch {
    membersCache = [];
    renderMembersTable();
  }
}

async function memberAction(userId, action) {
  const name = prompt(`${action.toUpperCase()} this member? Reason (optional):`);
  if (name === null) return;
  const res = await fetch(`/api/guild/${currentGuild}/${action}`, {
    method: 'POST',
    headers: { authorization: localStorage.getItem(TOKEN_KEY), 'content-type': 'application/json' },
    body: JSON.stringify({ userId, reason: name || undefined, minutes: 10 }),
  });
  const data = await res.json();
  alert(data.error ? `❌ ${data.error}` : `✅ Done`);
  loadMembers();
}

/* ---------------- Settings ---------------- */

function renderSettings() {
  if (!currentGuild) {
    $('settings-wrap').innerHTML = '<div class="panel"><div class="feed-empty">Select a server to manage its settings.</div></div>';
    return;
  }
  const g = (state.guilds || []).find((x) => x.id === currentGuild);
  if (!g) return;
  settingsDraft = JSON.parse(JSON.stringify(g.settings));
  const s = settingsDraft;

  $('settings-wrap').innerHTML = `
    <div class="panel">
      <div class="setting-group" data-mod="antiSpam">
        <h4>🚫 Anti-Spam</h4>
        ${toggle('antiSpam', 'enabled', 'Enable anti-spam', 'Timeout members who send too many messages')}
        ${number('antiSpam', 'maxMessages', 'Max messages', 'Before triggering')}
        ${number('antiSpam', 'windowSec', 'Window (seconds)', 'Counting window')}
        ${select('antiSpam', 'action', 'Action', { timeout: 'Timeout', kick: 'Kick', ban: 'Ban' })}
        ${number('antiSpam', 'timeoutMinutes', 'Timeout (minutes)', 'Duration')}
        ${number('antiSpam', 'maxMentions', 'Max mentions per message', 'Mass-mention protection')}
      </div>
      <div class="setting-group" data-mod="antiRaid">
        <h4>🛡️ Anti-Raid</h4>
        ${toggle('antiRaid', 'enabled', 'Enable anti-raid', 'Detect rapid account joins')}
        ${number('antiRaid', 'maxJoins', 'Max joins', 'Joins per window')}
        ${number('antiRaid', 'windowSec', 'Window (seconds)', 'Detection window')}
        ${number('antiRaid', 'lockdownDurationMin', 'Lockdown (minutes)', 'Duration of lockdown')}
        ${toggle('antiRaid', 'autoVerify', 'Force verification on raid', 'New members must verify')}
      </div>
      <div class="setting-group" data-mod="autoMod">
        <h4>🤖 Auto-Mod</h4>
        ${toggle('autoMod', 'enabled', 'Enable auto-mod', 'Content filters')}
        ${toggle('autoMod', 'filterLinks', 'Filter links', 'Blocks links outside the allowlist')}
        ${toggle('autoMod', 'blockAllLinks', 'Block ALL links', 'No URLs allowed at all — overrides the allowlist')}
        ${toggle('autoMod', 'filterInvites', 'Block Discord invites', 'No invite links in chat')}
        ${toggle('autoMod', 'filterEveryone', 'Block @everyone/@here', 'Non-mods cannot ping the whole server')}
        ${number('autoMod', 'maxCapsPercent', 'Max caps %', 'Caps filter threshold')}
        ${number('autoMod', 'minLengthForCaps', 'Min length for caps', 'Ignore short messages')}
        ${number('autoMod', 'timeoutMinutes', 'Timeout (minutes)', 'Punishment for filter hits')}
        ${text('autoMod', 'allowedDomains', 'Allowed domains (comma)', 'e.g. youtube.com, github.com')}
        ${text('autoMod', 'bannedWords', 'Banned words (comma)', 'Words that get filtered')}
      </div>
      <div class="setting-group" data-mod="antiNuke">
        <h4>☢️ Anti-Nuke</h4>
        ${toggle('antiNuke', 'enabled', 'Enable anti-nuke', 'Detects mass destructive actions and locks the server down')}
        ${toggle('antiNuke', 'autoRestore', 'Auto-restore deleted channels/roles', 'Rebuilds channels and roles destroyed during a nuke')}
        ${toggle('antiNuke', 'autoProtectRoles', 'Auto-protect admin roles', 'Locks Administrator roles from tampering')}
        ${text('antiNuke', 'protectedRoles', 'Protected role IDs (comma)', 'Extra roles that can never be deleted/tampered')}
        ${number('antiNuke', 'maxChannelDeletes', 'Max channel deletes', 'Per window')}
        ${number('antiNuke', 'maxRoleDeletes', 'Max role deletes', 'Per window')}
        ${number('antiNuke', 'maxBans', 'Max bans', 'Per window')}
        ${number('antiNuke', 'maxKicks', 'Max kicks', 'Per window')}
        ${number('antiNuke', 'maxWebhooks', 'Max webhook creates', 'Per window')}
        ${number('antiNuke', 'maxBots', 'Max bot adds', 'Per window')}
        ${toggle('antiNuke', 'kickBotsOnJoin', 'Kick new bots automatically', 'Any bot not added by trusted staff gets kicked immediately')}
        ${number('antiNuke', 'windowSec', 'Window (seconds)', 'Detection window')}
        ${number('antiNuke', 'lockdownMinutes', 'Lockdown (minutes)', 'Attacker is timed out for this long')}
      </div>
      <div class="setting-group" data-mod="audit">
        <h4>📋 Audit Logging</h4>
        ${toggle('audit', 'enabled', 'Enable audit logging', 'Log security events to a channel')}
        ${toggle('audit', 'logMessages', 'Log message edits/deletes', '')}
        ${toggle('audit', 'logMembers', 'Log member joins/leaves', '')}
        ${toggle('audit', 'logModActions', 'Log moderation actions', '')}
        ${toggle('audit', 'logChannels', 'Log channel changes', '')}
        ${text('audit', 'channelId', 'Audit channel ID', 'Channel where logs are posted')}
      </div>
      <div class="setting-group" data-mod="verification">
        <h4>✅ Verification</h4>
        ${toggle('verification', 'enabled', 'Enable verification', 'New members solve a captcha via DM')}
        ${text('verification', 'roleId', 'Verified role ID', 'Role given after verification')}
      </div>
      <div class="setting-group" data-mod="access">
        <h4>🔒 Bot Access Control</h4>
        ${select('access', 'mode', 'Access mode', { everyone: 'Everyone', allowlist: 'Allowlist only' })}
        ${text('access', 'users', 'Allowed user IDs (comma)', 'Users allowed to use the bot')}
        ${text('access', 'roles', 'Allowed role IDs (comma)', 'Roles allowed to use the bot')}
      </div>
      <div class="setting-group" data-mod="welcome">
        <h4>👋 Welcome Messages</h4>
        ${toggle('welcome', 'enabled', 'Send welcome messages', 'When a new member joins')}
        ${text('welcome', 'channelId', 'Channel ID', 'Where welcomes are posted')}
        ${text('welcome', 'message', 'Message template', 'Placeholders: {mention} {user} {userTag} {guild} {memberCount}')}
      </div>
      <div class="setting-group" data-mod="farewell">
        <h4>👋 Farewell Messages</h4>
        ${toggle('farewell', 'enabled', 'Send farewell messages', 'When a member leaves')}
        ${text('farewell', 'channelId', 'Channel ID', 'Where farewells are posted')}
        ${text('farewell', 'message', 'Message template', 'Placeholders: {mention} {user} {userTag} {guild} {memberCount}')}
      </div>
    </div>
    <div class="save-bar">
      <span class="save-msg" id="save-msg"></span>
      <div>
        <button id="lockdown-btn" style="background:var(--red);margin-right:8px">🔒 Lockdown</button>
        <button id="save-btn">Save Settings</button>
      </div>
    </div>
  `;

  document.querySelectorAll('#settings-wrap [data-k]').forEach((el) => {
    el.addEventListener('change', () => {
      const mod = el.dataset.mod, key = el.dataset.k;
      if (el.type === 'checkbox') {
        setPath(s, `${mod}.${key}`, el.checked);
      } else if (el.type === 'number') {
        setPath(s, `${mod}.${key}`, Number(el.value));
      } else {
        const val = el.value;
        setPath(s, `${mod}.${key}`, ['bannedWords', 'allowedDomains', 'users', 'roles'].includes(key) ? val.split(',').map((x) => x.trim()).filter(Boolean) : val);
      }
    });
  });

  $('save-btn').addEventListener('click', saveSettings);
  $('lockdown-btn').addEventListener('click', async () => {
    const minutes = prompt('Lockdown duration (minutes):', '10');
    if (!minutes) return;
    await fetch(`/api/guild/${currentGuild}/lockdown`, {
      method: 'POST',
      headers: { authorization: localStorage.getItem(TOKEN_KEY), 'content-type': 'application/json' },
      body: JSON.stringify({ minutes: Number(minutes) }),
    });
  });
}

function setPath(obj, path, val) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
  cur[parts[parts.length - 1]] = val;
}

function toggle(mod, key, label, desc) {
  return `
    <div class="setting-row">
      <div>${esc(label)}<div class="desc">${esc(desc)}</div></div>
      <label class="switch">
        <input type="checkbox" data-mod="${mod}" data-k="${key}" ${settingsDraft[mod][key] ? 'checked' : ''}>
        <span class="slider"></span>
      </label>
    </div>`;
}

function number(mod, key, label, desc) {
  return `
    <div class="setting-row">
      <div>${esc(label)}<div class="desc">${esc(desc)}</div></div>
      <input type="number" data-mod="${mod}" data-k="${key}" value="${settingsDraft[mod][key]}">
    </div>`;
}

function select(mod, key, label, options) {
  return `
    <div class="setting-row">
      <div>${esc(label)}</div>
      <select data-mod="${mod}" data-k="${key}">
        ${Object.entries(options).map(([v, l]) => `<option value="${v}" ${settingsDraft[mod][key] === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </div>`;
}

function text(mod, key, label, desc) {
  const val = Array.isArray(settingsDraft[mod][key]) ? settingsDraft[mod][key].join(', ') : (settingsDraft[mod][key] || '');
  return `
    <div class="setting-row">
      <div>${esc(label)}<div class="desc">${esc(desc)}</div></div>
      <input type="text" data-mod="${mod}" data-k="${key}" value="${esc(val)}" style="width:240px">
    </div>`;
}

async function saveSettings() {
  if (!settingsDraft) return;
  const res = await fetch(`/api/guild/${currentGuild}/settings`, {
    method: 'POST',
    headers: { authorization: localStorage.getItem(TOKEN_KEY), 'content-type': 'application/json' },
    body: JSON.stringify({ settings: settingsDraft }),
  });
  const data = await res.json();
  $('save-msg').textContent = data.ok ? `✅ Saved at ${fmtTime(Date.now())}` : '❌ Failed to save';
  setTimeout(() => { $('save-msg').textContent = ''; }, 3000);
}

/* ---------------- Boot ---------------- */

$('raid-end-btn').addEventListener('click', async () => {
  const raidGuild = (state.guilds || []).find((g) => g.raidLockdown);
  if (!raidGuild) return;
  await fetch(`/api/guild/${raidGuild.id}/raid-end`, { method: 'POST', headers: { authorization: localStorage.getItem(TOKEN_KEY) } });
});

(function boot() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) {
    fetch('/api/stats', { headers: { authorization: token } })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        connectSocket(token);
        state = data;
        showApp();
        render();
      })
      .catch(showLogin);
  } else {
    showLogin();
  }
})();
