const store = require('../../store');

const sessions = new Map();

function createChallenge(member) {
  const a = Math.floor(1000 + Math.random() * 9000);
  const b = Math.floor(1000 + Math.random() * 9000);
  const answer = a + b;
  const token = `${member.id}:${Date.now().toString(36)}`;
  sessions.set(token, { answer, tries: 0, until: Date.now() + 3 * 60000, guildId: member.guild ? member.guild.id : null });
  return { token, text: `**${a} + ${b} = ?**`, answer };
}

function findActiveSession(userId) {
  for (const [token, s] of sessions) {
    if (token.startsWith(`${userId}:`) && Date.now() <= s.until) return { token, guildId: s.guildId };
  }
  return null;
}

function checkAnswer(token, guess, member) {
  const s = sessions.get(token);
  if (!s || Date.now() > s.until) {
    sessions.delete(token);
    return { ok: false, error: 'challenge expired, run /verify again' };
  }
  s.tries++;
  if (String(s.answer) !== String(guess).trim()) {
    if (s.tries >= 3) {
      sessions.delete(token);
      return { ok: false, error: 'too many attempts, run /verify again' };
    }
    return { ok: false, error: 'incorrect answer' };
  }
  sessions.delete(token);
  return { ok: true };
}

function isVerified(guildId, userId) {
  return !!store.data.verified[`${guildId}:${userId}`];
}

function markVerified(guildId, userId, method) {
  store.data.verified[`${guildId}:${userId}`] = { at: Date.now(), method };
  store.save();
}

module.exports = { createChallenge, findActiveSession, checkAnswer, isVerified, markVerified };
