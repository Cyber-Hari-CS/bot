const config = require('../../config');
const store = require('../../store');

const colors = { critical: 0xed4245, warning: 0xfee75c, info: 0x57f287 };

async function send(alert) {
  if (!config.alertWebhook) return;
  try {
    await fetch(config.alertWebhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: 'Security Alerts',
        embeds: [{
          color: colors[alert.level] || 0x2f3136,
          title: `${alert.level === 'critical' ? '🚨' : alert.level === 'warning' ? '⚠️' : 'ℹ️'} ${alert.title}`,
          description: alert.message || '',
          fields: alert.userId ? [{ name: 'User ID', value: alert.userId, inline: true }] : [],
          timestamp: new Date(alert.at).toISOString(),
        }],
      }),
    });
  } catch (e) {
    console.error('[WEBHOOK] Failed to forward alert:', e.message);
  }
}

store.emitter.on('alert', (alert) => send(alert));

module.exports = { send };
