const { EndBehaviorType } = require('@discordjs/voice');
const voice = require('./voice');
const store = require('../../store');

const OpusScript = require('opusscript');
const listeners = new Map();
let asrPipeline = null;

function pcm48kStereoToFloat32(pcm) {
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.byteLength / 2);
  const out = new Float32Array(Math.floor(samples.length / 6));
  let j = 0;
  for (let i = 0; i + 5 < samples.length; i += 6) {
    out[j++] = samples[i] / 32768;
  }
  return out;
}

async function loadPipeline(model) {
  if (asrPipeline) return asrPipeline;
  const { pipeline } = require('@huggingface/transformers');
  asrPipeline = await pipeline('automatic-speech-recognition', model);
  return asrPipeline;
}

async function transcribe(audio, lang, guildId) {
  const settings = store.guildSettings(guildId);
  const model = settings.voice.sttModel || global.__sttModel || 'Xenova/whisper-tiny';
  const pipe = await loadPipeline(model);
  const task = lang && lang !== 'auto' ? { language: lang, task: 'transcribe' } : { task: 'transcribe' };
  const result = await pipe(audio, task);
  return (result.text || '').trim();
}

function flushTranscript(guild, userId, textChannel, pcm) {
  if (pcm.byteLength < 3840 * 60) return;
  const audio = pcm48kStereoToFloat32(pcm);
  const lang = store.guildSettings(guild.id).voice.sttLang || 'auto';
  transcribe(audio, lang, guild.id).then((text) => {
    if (!text) return;
    const member = guild.members.cache.get(userId);
    const name = member ? member.displayName : userId;
    const ch = guild.channels.cache.get(textChannel);
    if (ch && ch.isTextBased()) {
      ch.send(`🎧 **${name}** said: "${text.slice(0, 900)}"`).catch(() => {});
    }
  }).catch((e) => console.error('[LISTEN] Transcription failed:', e.message));
}

function startListen(guild, vcId, textChannelId) {
  const existing = listeners.get(guild.id);
  if (existing) return { ok: false, error: 'Listening is already active. Use off first.' };

  const vs = voice.getOrCreate(guild, vcId);
  const conn = vs.conn;
  const dec = new OpusScript(48000, 2);
  const state = { guild, conn, textChannelId, dec, streams: new Map(), running: true };
  listeners.set(guild.id, state);

  const startForUser = (userId) => {
    if (!state.running) return;
    if (state.streams.has(userId)) return;
    if (userId === guild.client.user.id) return;
    const member = guild.members.cache.get(userId);
    if (!member || member.user.bot) return;
    let pcm = Buffer.alloc(0);
    let stream;
    try {
      stream = conn.receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: 700 } });
    } catch {
      return;
    }
    state.streams.set(userId, stream);
    stream.on('data', (chunk) => {
      try {
        const decoded = dec.decode(chunk, 960);
        if (decoded) pcm = Buffer.concat([pcm, decoded]);
        if (pcm.byteLength > 3840 * 960) {
          const tmp = pcm;
          pcm = Buffer.alloc(0);
          flushTranscript(guild, userId, textChannelId, tmp);
        }
      } catch {}
    });
    stream.on('end', () => {
      state.streams.delete(userId);
      flushTranscript(guild, userId, textChannelId, pcm);
    });
    stream.on('error', () => state.streams.delete(userId));
  };

  state.speakingHandler = (userId) => startForUser(userId);
  conn.receiver.speaking.on('start', state.speakingHandler);

  return { ok: true };
}

function stopListen(guildId) {
  const state = listeners.get(guildId);
  if (!state) return false;
  state.running = false;
  if (state.speakingHandler) state.conn.receiver.speaking.off('start', state.speakingHandler);
  for (const stream of state.streams.values()) {
    try { stream.destroy(); } catch {}
  }
  state.streams.clear();
  listeners.delete(guildId);
  return true;
}

module.exports = { startListen, stopListen, setModel: (m) => { global.__sttModel = m; } };
