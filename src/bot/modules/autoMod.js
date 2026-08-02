const store = require('../../store');

const urlRegex = /(https?:\/\/[^\s]+)/gi;
const inviteRegex = /(?:discord\.(?:gg|io|me|li)\/|discord(?:app)?\.com\/invite\/)[A-Za-z0-9_-]+/gi;

function capsRatio(text) {
  const letters = text.replace(/[^a-zA-Z]/g, '');
  if (letters.length === 0) return 0;
  const caps = letters.replace(/[^A-Z]/g, '').length;
  return caps / letters.length;
}

function check(message, settings) {
  if (!settings.enabled) return null;
  const content = message.content || '';

  for (const word of settings.bannedWords) {
    if (word && content.toLowerCase().includes(word.toLowerCase())) {
      return { type: 'banned-word', reason: `Message contains a banned word (${word})` };
    }
  }

  if (settings.filterEveryone && /@everyone|@here/.test(content)) {
    if (!message.member?.permissions.has('MentionEveryone')) {
      return { type: 'everyone', reason: '@everyone/@here mention' };
    }
  }

  if (settings.filterInvites && inviteRegex.test(content)) {
    return { type: 'invite', reason: 'Message contains a Discord invite link' };
  }

  if (settings.filterLinks && urlRegex.test(content)) {
    const urls = content.match(urlRegex) || [];
    for (const url of urls) {
      let host = '';
      try { host = new URL(url).hostname.toLowerCase(); } catch { host = url.toLowerCase(); }
      if (settings.blockAllLinks) {
        return { type: 'link', reason: `Links and URLs are blocked in this server (${host})` };
      }
      if (!settings.allowedDomains.some((d) => host === d || host.endsWith('.' + d))) {
        return { type: 'link', reason: `Message contains a blocked link (${host})` };
      }
    }
  }

  if (content.length >= settings.minLengthForCaps && capsRatio(content) >= settings.maxCapsPercent / 100) {
    return { type: 'caps', reason: 'Excessive caps usage in message' };
  }

  return null;
}

module.exports = { check };
