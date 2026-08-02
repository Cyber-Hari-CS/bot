const config = require('./config');
const store = require('./store');
const { createClient } = require('./bot/client');
const { startWebServer } = require('./web/server');
const eventHandlers = require('./bot/events');
require('./bot/modules/alertWebhook');
const inviteTracker = require('./bot/modules/inviteTracker');

try {
  const ffmpegPath = require('ffmpeg-static');
  if (ffmpegPath) process.env.FFMPEG_PATH = ffmpegPath;
} catch {}

if (!config.token || config.token === 'your_bot_token_here') {
  console.error('❌ DISCORD_TOKEN is not set. Copy .env.example to .env and add your bot token.');
  process.exit(1);
}

store.load();
inviteTracker.load();
console.log('[APP] Store loaded');

const client = createClient();

client.on('error', (e) => console.error('[BOT] Client error:', e.message));
process.on('unhandledRejection', (e) => console.error('[APP] Unhandled rejection:', e?.message || e));

startWebServer(client);

for (const [event, handler] of Object.entries(eventHandlers)) {
  client.on(event, handler);
}

client.login(config.token).then(() => {
  console.log('[APP] Bot login initiated');
}).catch((e) => {
  console.error('❌ Failed to login:', e.message);
  process.exit(1);
});
