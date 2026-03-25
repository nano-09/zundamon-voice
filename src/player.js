// src/player.js
// Manages per-guild voice connections and queued TTS audio playback

import {
  joinVoiceChannel,
  getVoiceConnection,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  EndBehaviorType,
} from '@discordjs/voice';
import { synthesize } from './tts.js';
import { getGuildConfig, setGuildConfig, updateGuildMeta } from './config.js';
import { logToSupabase } from './db_supabase.js';
import OpusScript from 'opusscript';
import { processAudioLocally, isWhisperReady } from './ai.js';
import { clearHistory, clearAllHistory } from './db.js';
import ytExec from 'youtube-dl-exec';
import ytSearch from 'yt-search';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

// Map of guildId -> { connection, player, queue, playing, aiGenerating, currentSong }
const guilds = new Map();

function getGuildState(guildId) {
  if (!guilds.has(guildId)) {
    guilds.set(guildId, {
      connection: null,
      player: null,
      queue: [],
      playing: false,
      aiGenerating: false,
      currentSong: null,
      currentProcess: null,
      loopMode: 'off', // 'off', 'track', 'queue'
    });
  }
  return guilds.get(guildId);
}

/**
 * Joins a voice channel for the given guild.
 * @param {import('discord.js').VoiceChannel} voiceChannel
 * @param {import('discord.js').TextChannel} adapterChannel - for voice adapter
 */
export async function joinChannel(voiceChannel) {
  const state = getGuildState(voiceChannel.guild.id);

  // If already connected to this channel, no-op
  if (
    state.connection &&
    state.connection.joinConfig.channelId === voiceChannel.id
  ) {
    return;
  }

  // Disconnect previous connection if any
  if (state.connection) {
    state.connection.destroy();
  }

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    selfDeaf: false,
  });

  console.log(`[G:${voiceChannel.guild.id}] [SYS] Joining voice channel: ${voiceChannel.name}`);
  updateGuildMeta(voiceChannel.guild.id, { status: 'In Voice', name: voiceChannel.guild.name });
  logToSupabase(voiceChannel.guild.id, 'sys', `Joined voice channel: ${voiceChannel.name}`);

  // Wait for connection to be ready
  await entersState(connection, VoiceConnectionStatus.Ready, 30_000);

  const player = createAudioPlayer();
  connection.subscribe(player);

  player.on(AudioPlayerStatus.Idle, () => {
    state.playing = false;
    const finishedSong = state.currentSong;
    state.currentSong = null;
    
    if (state.currentProcess) {
      try { state.currentProcess.kill(); } catch (e) {}
      state.currentProcess = null;
    }

    // Handle Looping for Music
    if (finishedSong && finishedSong.type === 'music') {
      if (state.loopMode === 'track') {
        state.queue.unshift(finishedSong); // play again immediately
      } else if (state.loopMode === 'queue') {
        state.queue.push(finishedSong); // add to end of queue
      }
    }

    // Auto-exit karaoke mode if queue is empty
    const cfg = getGuildConfig(voiceChannel.guild.id);
    if (cfg.karaokeMode && state.queue.length === 0) {
      setGuildConfig(voiceChannel.guild.id, { karaokeMode: false });
      updateGuildMeta(voiceChannel.guild.id, { status: 'In Voice' });
    }

    processQueue(voiceChannel.guild.id);
  });

  player.on('error', (err) => {
    console.error(`[G:${voiceChannel.guild.id}] [ERROR] Player Error:`, err.message);
    logToSupabase(voiceChannel.guild.id, 'err', `Player Error: ${err.message}`);
    state.playing = false;
    processQueue(voiceChannel.guild.id);
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      // Reconnected, keep going
    } catch {
      connection.destroy();
      guilds.delete(voiceChannel.guild.id);
    }
  });

  // Track active listeners per user to avoid duplicate streams
  const activeListeners = new Set();

  // Setup AI Receiver
  connection.receiver.speaking.on('start', (userId) => {
    const cfg = getGuildConfig(voiceChannel.guild.id);
    if (!cfg.chatMode) return;
    if (cfg.chatModeUserId && userId !== cfg.chatModeUserId) return;
    if (userId === connection.joinConfig?.selfId) return;

    const state = getGuildState(voiceChannel.guild.id);
    if (state.aiGenerating) return;

    // Skip if we're already capturing this user's audio
    if (activeListeners.has(userId)) return;
    activeListeners.add(userId);

    const opusStream = connection.receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 1500, // wait 1.5s of silence before ending capture
      },
    });

    const decoder = new OpusScript(48000, 2, OpusScript.Application.AUDIO);
    const pcmChunks = [];

    console.log(`[G:${voiceChannel.guild.id}] [BOT] Listening to user...`);

    opusStream.on('data', (packet) => {
      try {
        // Ignore extremely small packets (usually silence/empty frames) to prevent OpusScript crash
        if (packet.length < 5) return;

        const decoded = decoder.decode(packet);
        // OpusScript returns an Int16Array-backed buffer — wrap it to ensure Buffer.concat works
        pcmChunks.push(Buffer.from(decoded.buffer, decoded.byteOffset, decoded.byteLength));
      } catch (err) {
        // Ignore corrupted/initial packets
      }
    });

    opusStream.on('end', async () => {
      activeListeners.delete(userId);

      try {
        decoder.delete(); // Free WASM memory
      } catch (e) {
        // Ignore errors on delete
      }

      if (pcmChunks.length === 0) {
        console.log(`❌ [ChatMode] No audio chunks received from user ID: ${userId}, ignoring.`);
        return;
      }

      const pcmBuffer = Buffer.concat(pcmChunks);

      // Need at least ~1s of audio (192000 bytes = 1s at 48kHz stereo Int16)
      // A higher threshold greatly reduces hallucinations from brief background noise
      if (pcmBuffer.length > 192000) {
        // Drop audio silently if Whisper isn't ready yet
        if (!isWhisperReady()) {
          console.log(`⏳ [ChatMode] Whisper not ready yet, dropping audio from user ID: ${userId}.`);
          return;
        }
        const state = getGuildState(voiceChannel.guild.id);
        if (state.aiGenerating) return; // Drop audio if currently generating

        console.log(`[G:${voiceChannel.guild.id}] [BOT] Processing ${(pcmBuffer.length / 192000).toFixed(1)}s of audio...`);
        
        state.aiGenerating = true;
        let result = null;
        try {
          result = await processAudioLocally(pcmBuffer, voiceChannel.guild.id, userId);
        } finally {
          state.aiGenerating = false;
        }

        // null means hallucination was detected or generation was aborted
        if (!result) return;

        const { transcription, reply, urls } = result;
        console.log(`[G:${voiceChannel.guild.id}] [BOT] User Said: "${transcription}"`);
        console.log(`[G:${voiceChannel.guild.id}] [BOT] Zundamon: "${reply}"`);
        logToSupabase(voiceChannel.guild.id, 'bot', `User: ${transcription}`);
        logToSupabase(voiceChannel.guild.id, 'bot', `Zundamon: ${reply}`);

        if (reply) {
          // If chatmode was disabled during generation, abort speaking
          if (getGuildConfig(voiceChannel.guild.id).chatMode) {
            enqueue(voiceChannel.guild.id, reply);
          }

          if (urls && urls.length > 0) {
            const cfg = getGuildConfig(voiceChannel.guild.id);
            const textChannel = cfg.textChannelId ? voiceChannel.guild.channels.cache.get(cfg.textChannelId) : null;
            if (textChannel?.isTextBased()) {
              textChannel.send(`🔍 参考リンクなのだ！\n${urls.map(u => `- <${u}>`).join('\n')}`).catch(console.error);
            }
          }
        }
      } else {
        console.log(`❌ [ChatMode] Audio too short (${pcmBuffer.length} bytes) from user ID: ${userId}, ignoring.`);
      }
    });

    opusStream.on('error', (err) => {
      activeListeners.delete(userId);
      console.error(`[ChatMode] Stream error for user ID ${userId}:`, err.message);
    });
  });

  state.connection = connection;
  state.player = player;
  state.queue = [];
  state.playing = false;
}

/**
 * Disconnects the bot from voice in the given guild.
 * @param {string} guildId
 */
export function leaveChannel(guildId) {
  const state = guilds.get(guildId);
  if (state?.connection) {
    if (state.currentProcess) {
      try { state.currentProcess.kill(); } catch (e) {}
      state.currentProcess = null;
    }
    state.connection.destroy();
    updateGuildMeta(guildId, { status: 'Idle' });
    guilds.delete(guildId);
  } else {
    // Fallback: destroy orphaned voice connection not tracked in local Map
    const orphan = getVoiceConnection(guildId);
    if (orphan) {
      orphan.destroy();
      updateGuildMeta(guildId, { status: 'Idle' });
    }
  }
  // Clear conversation history so the bot doesn't respond to old context
  clearHistory(guildId).catch(() => { });
  console.log(`[Player] Left channel and cleared history for guild ${guildId}`);
}

/**
 * Disconnects the bot from all voice channels gracefully.
 */
export function leaveAllChannels() {
  for (const [guildId, state] of guilds.entries()) {
    if (state.currentProcess) {
      try { state.currentProcess.kill(); } catch (e) {}
      state.currentProcess = null;
    }
    if (state.connection) {
      state.connection.destroy();
    }
  }
  guilds.clear();
  // Clear all conversation history on full shutdown
  clearAllHistory().catch(() => { });
  console.log('[Player] Left all channels and cleared all history.');
}

/**
 * Adds text to the TTS queue for a guild.
 * @param {string} guildId
 * @param {string} text
 * @param {string} [userId=null]
 */
export function enqueue(guildId, text, userId = null) {
  const state = getGuildState(guildId);
  if (!state.connection) return; // Not connected, silently ignore
  
  // Do not enqueue TTS if karaoke mode is active
  const cfg = getGuildConfig(guildId);
  if (cfg.karaokeMode) return;

  let speakerId = cfg.speakerId ?? 3; // Default to normal Zundamon
  if (userId && cfg.userVoices && cfg.userVoices[userId] !== undefined) {
    speakerId = cfg.userVoices[userId];
  }

  // Per-user voice params with guild-level fallback
  const userParams = (userId && cfg.userParams?.[userId]) || {};
  const speed = userParams.speed ?? cfg.speed;
  const pitch = userParams.pitch ?? cfg.pitch;
  const volume = userParams.volume ?? cfg.volume;

  // Background synthesis immediately (parallel dispatch)
  const streamPromise = synthesize(text, speakerId, speed, pitch, volume).catch(e => {
    console.error('[TTS] Parallel synthesis failed:', e.message);
    return null;
  });

  state.queue.push({ type: 'tts', text, userId, streamPromise });
  if (!state.playing) {
    processQueue(guildId);
  }
}

/**
 * Adds a local audio file to the playback queue.
 * @param {string} guildId
 * @param {string} filePath
 */
export function enqueueFile(guildId, filePath) {
  const state = getGuildState(guildId);
  if (!state.connection) return;
  state.queue.push({ type: 'file', filePath });
  if (!state.playing) {
    processQueue(guildId);
  }
}

/**
 * Fetches and adds music (YouTube/Spotify via play-dl) to the playback queue.
 * @param {string} guildId
 * @param {string} query Search term or URL
 * @param {string} userId User who requested
 */
export async function enqueueMusic(guildId, query, userId) {
  const state = getGuildState(guildId);
  if (!state.connection) return null;
  
  try {
    let url = query;
    let title = 'Unknown Title';
    let duration = '0:00';

    // If it's not a direct youtube URL, search it with yt-search
    if (!query.includes('youtube.com') && !query.includes('youtu.be')) {
      console.log(`[G:${guildId}] [BOT] Searching YouTube for: "${query}"`);
      logToSupabase(guildId, 'bot', `Searching YouTube: ${query}`);
      const searchResult = await ytSearch(query);
      if (!searchResult || !searchResult.videos || searchResult.videos.length === 0) return null;
      
      const video = searchResult.videos[0];
      // Ensure the URL is absolute (yt-search often returns '/watch?...')
      url = video.url.startsWith('http') ? video.url : `https://www.youtube.com${video.url}`;
      title = video.title;
      duration = video.timestamp;
    } else {
      // If it is a direct URL, grab the basic info metadata via youtube-dl-exec
      const info = await ytExec(query, { dumpSingleJson: true, noPlaylist: true });
      title = info.title || 'Unknown Title';
      
      const d = parseInt(info.duration) || 0;
      const m = Math.floor(d / 60);
      const s = String(d % 60).padStart(2, '0');
      duration = info.duration_string || `${m}:${s}`;
    }
    
    state.queue.push({ 
      type: 'music', 
      url: url, 
      title: title, 
      duration: duration,
      userId 
    });
    
    if (!state.playing) {
      processQueue(guildId);
    }
    
    return `🎵 **${title}** を再生予約したのだ！`;
  } catch (err) {
    console.error('[Music] Error queueing music:', err.message || err);
    return null;
  }
}

export function pauseMusic(guildId) {
  const state = getGuildState(guildId);
  if (!state.connection || !state.player) return null;
  if (!state.playing && state.player.state.status !== AudioPlayerStatus.Paused) return null;
  
  if (state.player.state.status === AudioPlayerStatus.Paused) {
    state.player.unpause();
    return false; // Result is false = unpaused
  } else {
    state.player.pause();
    return true; // Result is true = paused
  }
}

export function skipMusic(guildId) {
  const state = getGuildState(guildId);
  if (!state.connection || !state.player || !state.playing) return false;
  
  if (state.currentProcess) {
    try { state.currentProcess.kill(); } catch (e) {}
    state.currentProcess = null;
  }
  
  state.player.stop(); // This triggers Idle event to play the next song
  return true;
}

export function getQueue(guildId) {
  const state = getGuildState(guildId);
  if (!state) return null;
  return {
    current: state.currentSong || null,
    upcoming: state.queue.filter(q => q.type === 'music'),
    loopMode: state.loopMode
  };
}

export function setLoopMode(guildId, mode) {
  const state = getGuildState(guildId);
  if (state) state.loopMode = mode;
}

/**
 * Returns true if the bot is currently connected to voice in this guild.
 * @param {string} guildId
 */
export function isConnected(guildId) {
  const state = guilds.get(guildId);
  if (state?.connection) return true;
  // Fallback: check for orphaned voice connections after bot restart
  return !!getVoiceConnection(guildId);
}

async function processQueue(guildId) {
  const state = guilds.get(guildId);
  if (!state || state.playing || state.queue.length === 0) return;

  state.playing = true;
  const item = state.queue.shift();

  try {
    if (item.type === 'file') {
      state.currentSong = null;
      const resource = createAudioResource(item.filePath, { inlineVolume: false });
      state.player.play(resource);
    } 
    else if (item.type === 'music') {
      state.currentSong = item;
      
      // Use raw child_process.spawn to avoid tinyspawn's ChildProcessError on SIGTERM
      // Robust binary path resolution for yt-dlp
      const ytdlpBin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../node_modules/youtube-dl-exec/bin/yt-dlp.exe');
      
      const subprocess = spawn(ytdlpBin, [
        item.url, '--output', '-', '--quiet', '--no-playlist', '--format', 'bestaudio', '--limit-rate', '10M',
        '--js-runtimes', 'node'
      ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

      subprocess.stderr.on('data', data => console.error(`[G:${guildId}] [yt-dlp] Error:`, data.toString().trim()));
      subprocess.on('error', err => console.error(`[G:${guildId}] [yt-dlp] Spawn error:`, err.message));
      subprocess.on('close', (code, signal) => {
        if (signal === 'SIGTERM') console.log(`[G:${guildId}] [yt-dlp] Process terminated (skip/leave).`);
        else if (code && code !== 0) console.warn(`[G:${guildId}] [yt-dlp] Exited with code ${code}`);
      });
      state.currentProcess = subprocess;
      
      const resource = createAudioResource(subprocess.stdout, {
        inlineVolume: true
      });
      const cfg = getGuildConfig(guildId);
      const kVolume = cfg.karaokeVolume ?? 1.0;
      resource.volume.setVolume(kVolume);
      
      state.player.play(resource);
    } 
    else { // TTS
      state.currentSong = null;
      const { text, streamPromise } = item;
      
      const audioStream = await streamPromise;
      if (!audioStream) throw new Error('Audio synthesis failed or was pre-emptively aborted');

      console.log(`[G:${guildId}] [BOT] Speaking: "${text}"`);
      const resource = createAudioResource(audioStream, {
        inlineVolume: false,
      });
      state.player.play(resource);
    }
  } catch (err) {
    console.error('[Player] Playback/Synthesis error:', err.message || err);
    state.playing = false;
    state.currentSong = null;
    processQueue(guildId); // Try next item
  }
}
