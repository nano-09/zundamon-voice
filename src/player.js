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
  StreamType,
} from '@discordjs/voice';
import { synthesize } from './tts.js';
import { getGuildConfig, setGuildConfig, updateGuildMeta, getFullGuildConfig } from './config.js';
import { logToSupabase } from './db_supabase.js';
import OpusScript from 'opusscript';
import { processAudioLocally, isWhisperReady } from './ai.js';
import { clearHistory, clearAllHistory } from './db.js';
import ytExec from 'youtube-dl-exec';
import ytSearch from 'yt-search';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';

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
 * @param {number} [retryCount=0]
 */
export async function joinChannel(voiceChannel, retryCount = 0) {
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

  // Detailed state monitoring for debugging
  connection.on('stateChange', (oldState, newState) => {
    console.log(`[G:${voiceChannel.guild.id}] [VOICE] State: ${oldState.status} -> ${newState.status}`);
  });

  connection.on('error', (err) => {
    console.error(`[G:${voiceChannel.guild.id}] [VOICE] Connection Error:`, err.message);
  });

  console.log(`[G:${voiceChannel.guild.id}] [SYS] Joining voice channel: ${voiceChannel.name} (Attempt: ${retryCount + 1})`);
  updateGuildMeta(voiceChannel.guild.id, { status: 'In Voice', name: voiceChannel.guild.name });
  logToSupabase(voiceChannel.guild.id, 'sys', `Joined voice channel: ${voiceChannel.name}`);

  // Wait for connection to be ready with detailed error and retry logic
  try {
    // Stage 1: Wait for Signalling/Connecting (to verify adapter is working)
    console.log(`[G:${voiceChannel.guild.id}] [SYS] Waiting for initial signaling...`);
    await Promise.race([
      entersState(connection, VoiceConnectionStatus.Signalling, 10_000),
      entersState(connection, VoiceConnectionStatus.Connecting, 10_000),
      entersState(connection, VoiceConnectionStatus.Ready, 10_000),
    ]).catch(() => {
      console.warn(`[G:${voiceChannel.guild.id}] [WARN] Initial signaling slow. Attempting rejoin...`);
      connection.rejoin();
    });

    // Stage 2: Wait for Ready state with a generous timeout
    // Increase timeout to 45s per attempt for slow networks/Windows firewall delays
    await entersState(connection, VoiceConnectionStatus.Ready, 45_000);
    console.log(`[G:${voiceChannel.guild.id}] [SYS] Connection Ready.`);
  } catch (err) {
    console.error(`[G:${voiceChannel.guild.id}] [ERROR] Voice connection failed (Attempt ${retryCount + 1}):`, err.message);
    if (err.stack) console.error(err.stack);
    
    connection.destroy();
    state.connection = null;

    // Retry up to 3 times to handle transient network/Windows UDP issues
    if (retryCount < 2) {
      const delay = 5000 * (retryCount + 1);
      console.log(`[G:${voiceChannel.guild.id}] [SYS] Retrying voice connection in ${delay / 1000}s... (Retry ${retryCount + 1}/2)`);
      await new Promise(r => setTimeout(r, delay));
      return joinChannel(voiceChannel, retryCount + 1);
    }
    
    throw new Error(`ボイスチャンネルへの接続が失敗したのだ。 (Reason: ${err.message})`);
  }

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
    checkAutoExitKaraoke(voiceChannel.guild.id);

    processQueue(voiceChannel.guild.id);
  });

  player.on('error', (err) => {
    console.error(`[G:${voiceChannel.guild.id}] [ERROR] Player Error:`, err.message);
    if (err.stack) console.error(err.stack);
    if (err.resource) {
      console.error(`[Player] Resource details: InputType=${err.resource.inputType}, PlaybackDuration=${err.resource.playbackDuration}`);
    }
    logToSupabase(voiceChannel.guild.id, 'err', `Player Error: ${err.message}`);
    state.playing = false;
    state.currentSong = null;
    
    checkAutoExitKaraoke(voiceChannel.guild.id);
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

  console.log(`[G:${voiceChannel.guild.id}] [SYS] joinChannel completed successfully.`);
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
    setGuildConfig(guildId, { karaokeMode: false });
    updateGuildMeta(guildId, { status: 'Idle' });
    guilds.delete(guildId);
  } else {
    // Fallback: destroy orphaned voice connection not tracked in local Map
    const orphan = getVoiceConnection(guildId);
    if (orphan) {
      orphan.destroy();
      setGuildConfig(guildId, { karaokeMode: false });
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
  if (!state.connection) {
    console.log(`[Player] [DEBUG] Enqueue called for guild ${guildId} but not connected to voice. Use /join.`);
    return; // Not connected, silently ignore
  }
  
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
  if (!state.player) return null;
  
  const status = state.player.state.status;
  if (status === AudioPlayerStatus.Idle) return null;
  
  if (status === AudioPlayerStatus.Paused) {
    state.player.unpause();
    return false; // Result is false = unpaused
  } else {
    state.player.pause();
    return true; // Result is true = paused
  }
}

export function skipMusic(guildId) {
  const state = getGuildState(guildId);
  if (!state.player) return false;

  const status = state.player.state.status;
  console.log(`[Skip] G:${guildId} - Status: ${status}, CurrentSong: ${!!state.currentSong}`);

  if (state.currentSong || status !== AudioPlayerStatus.Idle) {
    // 1. Kill any active transcoding processes immediately
    if (state.currentProcess) {
      try { state.currentProcess.kill(); } catch (e) {}
      state.currentProcess = null;
    }
    
    // 2. Clear current song state immediately
    state.currentSong = null;
    state.playing = false;

    // 3. Check for auto-exit before moving to next (or stopping)
    const musicInUpcoming = state.queue.some(item => item.type === 'music');
    if (!musicInUpcoming) {
      console.log(`[G:${guildId}] [Player] Skipping last song. Exiting karaoke mode.`);
      setGuildConfig(guildId, { karaokeMode: false });
      updateGuildMeta(guildId, { status: 'In Voice' });
    }

    // 4. Force stop the player (clears current resource)
    // This will trigger the Idle event, which will then call processQueue() for the next song.
    state.player.stop(true); 

    return true;
  }
  
  return false;
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

/**
 * Checks if music queue is empty and reverts to TTS mode if needed.
 */
function checkAutoExitKaraoke(guildId) {
  const state = guilds.get(guildId);
  if (!state) return;

  const cfg = getGuildConfig(guildId);
  // We check if queue is empty. We don't check state.playing here because 
  // this is usually called right after a song finishes or errors.
  const musicInQueue = state.queue.some(item => item.type === 'music');
  
  if (cfg.karaokeMode && !musicInQueue) {
    console.log(`[G:${guildId}] [Player] Queue empty. Reverting to TTS mode.`);
    setGuildConfig(guildId, { karaokeMode: false });
    updateGuildMeta(guildId, { status: 'In Voice' });
  }
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
      
      const ytdlpBin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../node_modules/youtube-dl-exec/bin/yt-dlp.exe');
      
      const ytdlp = spawn(ytdlpBin, [
        item.url,
        '--output', '-',
        '--quiet',
        '--no-playlist',
        '--format', 'bestaudio',
        '--no-cache-dir',
        '--no-part',
        '--ignore-config',
        '--js-runtimes', 'node'
      ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

      const cfg = getGuildConfig(guildId);
      const kVolume = cfg.karaokeVolume ?? 1.0;

      const ffmpeg = spawn(ffmpegPath, [
        '-i', 'pipe:0',
        '-af', `volume=${kVolume}`,
        '-c:a', 'libopus',
        '-f', 'opus',
        '-ar', '48000',
        '-ac', '2',
        '-b:a', '128k',
        'pipe:1'
      ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

      ytdlp.stdout.pipe(ffmpeg.stdin);

      // Handle the EPIPE error on stdin to prevent crashing the whole process
      ffmpeg.stdin.on('error', err => {
        if (err.code !== 'EPIPE') {
          console.error(`[G:${guildId}] [ffmpeg.stdin] Error:`, err.message);
        }
      });

      ytdlp.stderr.on('data', data => {
        const msg = data.toString().trim();
        // Ignore the JS runtime warning since we are now providing it or just to keep logs clean
        if (msg && !msg.includes('JavaScript runtime')) {
          console.error(`[G:${guildId}] [yt-dlp] Error:`, msg);
        }
      });
      ffmpeg.stderr.on('data', data => {
        const msg = data.toString().trim();
        if (msg.includes('Error')) console.error(`[G:${guildId}] [ffmpeg] Error:`, msg);
      });
      
      ytdlp.on('error', err => console.error(`[G:${guildId}] [yt-dlp] Spawn error:`, err.message));
      ffmpeg.on('error', err => console.error(`[G:${guildId}] [ffmpeg] Spawn error:`, err.message));

      ytdlp.on('close', (code, signal) => {
        if (signal === 'SIGTERM') console.log(`[G:${guildId}] [yt-dlp] Process terminated.`);
        else if (code && code !== 0) console.warn(`[G:${guildId}] [yt-dlp] Exited with code ${code}`);
      });
      
      state.currentProcess = { 
        kill: () => {
          try { ytdlp.kill(); } catch (e) {}
          try { ffmpeg.kill(); } catch (e) {}
        }
      };
      
      const resource = createAudioResource(ffmpeg.stdout, {
        inputType: StreamType.OggOpus,
        inlineVolume: false // Disable to ensure FFmpeg-encoded Opus pass-through
      });
      console.log(`[Player] Music resource created. StreamType: OggOpus, InlineVolume: false`);
      
      state.player.play(resource);
    } 
    else { // TTS
      state.currentSong = null;
      const { text, streamPromise } = item;
      
      const audioStream = await streamPromise;
      if (!audioStream) throw new Error('Audio synthesis failed or was pre-emptively aborted');

      console.log(`[G:${guildId}] [BOT] Speaking: "${text}"`);

      const cfg = getFullGuildConfig(guildId).settings;
      const ttsVolume = cfg.volume ?? 1.0;

      // Use ffmpeg with libopus to encode playback stream for maximum stability
      const ffmpeg = spawn(ffmpegPath, [
        '-i', 'pipe:0',
        '-af', `volume=${ttsVolume}`,
        '-c:a', 'libopus',
        '-f', 'opus',
        '-ar', '48000',
        '-ac', '2',
        'pipe:1'
      ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

      audioStream.pipe(ffmpeg.stdin);

      const resource = createAudioResource(ffmpeg.stdout, {
        inputType: StreamType.OggOpus,
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
