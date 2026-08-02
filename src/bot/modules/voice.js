const { joinVoiceChannel, createAudioPlayer, createAudioResource, StreamType, NoSubscriberBehavior, getVoiceConnection, AudioPlayerStatus } = require('@discordjs/voice');
const { spawn } = require('child_process');

let ffmpegPath = null;
try { ffmpegPath = require('ffmpeg-static'); } catch {}
if (ffmpegPath) process.env.FFMPEG_PATH = ffmpegPath;

const state = new Map();

function transcodeToOggOpus(buf) {
  const ff = spawn(ffmpegPath, ['-loglevel', 'error', '-i', 'pipe:0', '-f', 'ogg', '-c:a', 'libopus', 'pipe:1']);
  ff.on('error', (e) => console.error('[VOICE] ffmpeg error:', e.message));
  ff.stdin.on('error', () => {});
  ff.stdin.end(buf);
  return {
    stream: ff.stdout,
    done: new Promise((resolve) => ff.on('close', () => resolve())),
  };
}

function getOrCreate(guild, channelId) {
  const existing = state.get(guild.id);
  if (existing) {
    clearTimeout(existing.leaveTimer);
    return existing;
  }
  const conn = joinVoiceChannel({ channelId, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator, selfDeaf: true });
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } });
  player.on('error', (e) => {
    console.error('[VOICE] Player error:', e.message);
    const cur = state.get(guild.id);
    if (cur && cur.player.state.status !== AudioPlayerStatus.Playing) scheduleLeave(guild, 1500);
  });
  conn.subscribe(player);
  const s = { player, conn, monitorTextId: null, lastSpeaking: new Map(), speakingHandler: null, leaveTimer: null };
  state.set(guild.id, s);
  conn.on('stateChange', (oldS, newS) => {
    if (newS.status === 'disconnected' && !getVoiceConnection(guild.id)) state.delete(guild.id);
  });
  return s;
}

function scheduleLeave(guild, delay = 4000) {
  const s = state.get(guild.id);
  if (!s) return;
  clearTimeout(s.leaveTimer);
  s.leaveTimer = setTimeout(() => {
    const cur = state.get(guild.id);
    if (cur && cur.player.state.status !== AudioPlayerStatus.Playing) {
      cur.conn.destroy();
      state.delete(guild.id);
    }
  }, delay);
}

async function speak(guild, channelId, text, lang = 'en') {
  const s = getOrCreate(guild, channelId);
  try {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(String(text).slice(0, 190))}`;
    const res = await fetch(url);
    if (!res.ok) return { ok: false, error: `TTS service returned HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    const { stream, done } = transcodeToOggOpus(buf);
    s.player.play(createAudioResource(stream, { inputType: StreamType.OggOpus }));
    done.then(() => {
      if (s.player.state.status !== AudioPlayerStatus.Playing) scheduleLeave(guild);
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function stopSpeaking(guildId) {
  const s = state.get(guildId);
  if (!s) return false;
  s.player.stop();
  const guild = s.conn.joinConfig.guildId;
  const g = s.conn;
  scheduleLeave({ id: guildId }, 1000);
  return true;
}

function enableMonitor(guild, channelId, textChannel) {
  const s = getOrCreate(guild, channelId);
  s.monitorTextId = textChannel.id;
  if (!s.speakingHandler) {
    s.speakingHandler = (userId) => {
      if (userId === guild.client.user.id) return;
      const now = Date.now();
      if (now - (s.lastSpeaking.get(userId) || 0) < 10000) return;
      s.lastSpeaking.set(userId, now);
      const ch = guild.channels.cache.get(s.monitorTextId);
      if (ch && ch.isTextBased()) {
        ch.send(`🎙️ **Mic activity:** <@${userId}> is speaking in voice!`).catch(() => {});
      }
    };
    s.conn.receiver.speaking.on('start', s.speakingHandler);
  }
  return s;
}

function disableMonitor(guildId) {
  const s = state.get(guildId);
  if (!s) return false;
  if (s.speakingHandler) {
    s.conn.receiver.speaking.off('start', s.speakingHandler);
    s.speakingHandler = null;
  }
  s.monitorTextId = null;
  return true;
}

function leave(guildId) {
  const s = state.get(guildId);
  if (!s) return false;
  clearTimeout(s.leaveTimer);
  s.conn.destroy();
  state.delete(guildId);
  return true;
}

module.exports = { speak, stopSpeaking, enableMonitor, disableMonitor, leave, getOrCreate };
