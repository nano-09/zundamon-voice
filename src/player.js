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
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { synthesize } from './tts.js';
import { getGuildConfig, setGuildConfig, updateGuildMeta, getFullGuildConfig } from './config.js';
import { logToSupabase } from './db_supabase.js';
import { clearHistory, clearAllHistory } from './db.js';
import ytExec from 'youtube-dl-exec';
import ytSearch from 'yt-search';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import ffmpegPath from 'ffmpeg-static';

let discordClient = null;
export function setDiscordClient(client) {
  discordClient = client;
}

// Map of guildId -> { connection, musicPlayer, ttsPlayer, queue, ttsQueue, playing, aiGenerating, currentSong, ... }
const guilds = new Map();

function getGuildState(guildId) {
  if (!guilds.has(guildId)) {
    guilds.set(guildId, {
      connection: null,
      musicPlayer: null,
      ttsPlayer: null,
      queue: [],
      ttsQueue: [],
      playing: false,
      ttsPlaying: false,
      aiGenerating: false,
      currentSong: null,
      currentProcess: null,
      loopMode: 'off', // 'off', 'track', 'queue'
      nowPlayingMessage: null,
      nowPlayingInterval: null,
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
  updateGuildMeta(voiceChannel.guild.id, { status: '通話中', name: voiceChannel.guild.name });
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

  const musicPlayer = createAudioPlayer();
  const ttsPlayer = createAudioPlayer();
  
  // Initially subscribe to ttsPlayer (default for readMode)
  connection.subscribe(ttsPlayer);

  musicPlayer.on(AudioPlayerStatus.Idle, () => {
    state.playing = false;
    const finishedSong = state.currentSong;
    state.currentSong = null;

    if (state.currentProcess) {
      try { state.currentProcess.kill(); } catch (e) { }
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
    
    clearNowPlaying(voiceChannel.guild.id);

    // Auto-exit karaoke mode if queue is empty
    checkAutoExitKaraoke(voiceChannel.guild.id);

    processQueue(voiceChannel.guild.id);
  });

  musicPlayer.on('error', (err) => {
    console.error(`[G:${voiceChannel.guild.id}] [ERROR] Music Player Error:`, err.message);
    if (err.stack) console.error(err.stack);
    if (err.resource) {
      console.error(`[MusicPlayer] Resource details: InputType=${err.resource.inputType}, PlaybackDuration=${err.resource.playbackDuration}`);
    }
    logToSupabase(voiceChannel.guild.id, 'err', `Music Player Error: ${err.message}`);
    state.playing = false;
    state.currentSong = null;

    clearNowPlaying(voiceChannel.guild.id);
    checkAutoExitKaraoke(voiceChannel.guild.id);
    processQueue(voiceChannel.guild.id);
  });

  ttsPlayer.on(AudioPlayerStatus.Idle, () => {
    state.ttsPlaying = false;
    processTtsQueue(voiceChannel.guild.id);
  });

  ttsPlayer.on('error', (err) => {
    console.error(`[G:${voiceChannel.guild.id}] [ERROR] TTS Player Error:`, err.message);
    logToSupabase(voiceChannel.guild.id, 'err', `TTS Player Error: ${err.message}`);
    state.ttsPlaying = false;
    processTtsQueue(voiceChannel.guild.id);
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


  state.connection = connection;
  state.musicPlayer = musicPlayer;
  state.ttsPlayer = ttsPlayer;
  state.queue = [];
  state.ttsQueue = [];
  state.playing = false;
  state.ttsPlaying = false;

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
      try { state.currentProcess.kill(); } catch (e) { }
      state.currentProcess = null;
    }
    state.connection.destroy();
    setGuildConfig(guildId, { karaokeMode: false });
    updateGuildMeta(guildId, { status: '待機中' });
    guilds.delete(guildId);
  } else {
    // Fallback: destroy orphaned voice connection not tracked in local Map
    const orphan = getVoiceConnection(guildId);
    if (orphan) {
      orphan.destroy();
      setGuildConfig(guildId, { karaokeMode: false });
      updateGuildMeta(guildId, { status: '待機中' });
    }
  }
  clearNowPlaying(guildId);
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
      try { state.currentProcess.kill(); } catch (e) { }
      state.currentProcess = null;
    }
    if (state.connection) {
      state.connection.destroy();
    }
    clearNowPlaying(guildId);
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
 * @param {string} [userName=null]
 */
export function enqueue(guildId, text, userId = null, userName = null) {
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
  
  state.ttsQueue.push({ type: 'tts', text, userId, userName, streamPromise });
  if (!state.ttsPlaying) {
    processTtsQueue(guildId);
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
    let artist = null;
    let track = null;

    // If it's not a direct youtube URL, search it with yt-search
    if (!query.includes('youtube.com') && !query.includes('youtu.be')) {
      console.log(`[G:${guildId}] [SYS] Searching YouTube for: "${query}"`);
      logToSupabase(guildId, 'sys', `Searching YouTube: ${query}`);
      const searchResult = await ytSearch(query);
      if (!searchResult || !searchResult.videos || searchResult.videos.length === 0) return null;

      const video = searchResult.videos[0];
      // Ensure the URL is absolute (yt-search often returns '/watch?...')
      url = video.url.startsWith('http') ? video.url : `https://www.youtube.com${video.url}`;
      title = video.title;
      duration = video.timestamp;
      artist = video.author?.name || null;
    } else {
      // If it is a direct URL, grab the basic info metadata via yt-search
      const videoId = query.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/)?.[1];
      if (videoId) {
        console.log(`[G:${guildId}] [SYS] Fetching metadata for Video ID: ${videoId}`);
        const video = await ytSearch({ videoId });
        title = video.title;
        const d = video.duration.seconds;
        const m = Math.floor(d / 60);
        const s = String(d % 60).padStart(2, '0');
        duration = video.duration.timestamp || `${m}:${s}`;
        artist = video.author?.name || null;
      } else {
        // Fallback to ytExec if Video ID extraction fails (unlikely)
        const info = await ytExec(query, { dumpSingleJson: true, noPlaylist: true });
        title = info.title || 'Unknown Title';
        const d = parseInt(info.duration) || 0;
        const m = Math.floor(d / 60);
        const s = String(d % 60).padStart(2, '0');
        duration = info.duration_string || `${m}:${s}`;
        artist = info.artist || info.uploader || null;
        track = info.track || info.alt_title || null;
      }
    }

    state.queue.push({
      type: 'music',
      url: url,
      title: title,
      duration: duration,
      artist,
      track,
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
  if (!state.musicPlayer) return null;

  const status = state.musicPlayer.state.status;
  if (status === AudioPlayerStatus.Idle) return null;

  if (status === AudioPlayerStatus.Paused) {
    // 1. Stop TTS player to clear any current speech immediately
    if (state.ttsPlayer) state.ttsPlayer.stop(true);

    state.musicPlayer.unpause();
    // 2. Switch to musicPlayer
    if (state.connection) state.connection.subscribe(state.musicPlayer);
    setGuildConfig(guildId, { karaokeMode: true });
    updateGuildMeta(guildId, { status: '再生中 (音楽)' });
    return false; // Result is false = unpaused
  } else {
    state.musicPlayer.pause();
    // Switch back to ttsPlayer to allow TTS while music is paused
    if (state.connection) {
      state.connection.subscribe(state.ttsPlayer);
    }
    setGuildConfig(guildId, { karaokeMode: false });
    updateGuildMeta(guildId, { status: '一時停止中 (TTS有効)' });
    return true; // Result is true = paused
  }
}

export function skipMusic(guildId) {
  const state = getGuildState(guildId);
  if (!state.musicPlayer) return false;

  const status = state.musicPlayer.state.status;
  console.log(`[Skip] G:${guildId} - Status: ${status}, CurrentSong: ${!!state.currentSong}`);

  if (state.currentSong || status !== AudioPlayerStatus.Idle) {
    // 1. Kill any active transcoding processes immediately
    if (state.currentProcess) {
      try { state.currentProcess.kill(); } catch (e) { }
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
      updateGuildMeta(guildId, { status: '通話中' });
      // Switch back to ttsPlayer
      if (state.connection && state.ttsPlayer) {
        state.connection.subscribe(state.ttsPlayer);
      }
    }

    clearNowPlaying(guildId);

    // 4. Force stop the player (clears current resource)
    // This will trigger the Idle event if the player was playing/buffering,
    // which then calls processQueue() for the next song.
    if (status !== AudioPlayerStatus.Idle) {
      state.musicPlayer.stop(true);
    } else {
      // If already Idle, the stop() won't trigger the Idle event,
      // so we manually trigger the queue processing/exit check.
      console.log(`[G:${guildId}] [Player] Skip already Idle. Manually processing next.`);
      checkAutoExitKaraoke(guildId);
      processQueue(guildId);
    }

    return true;
  }

  return false;
}

export function subscribeToMusic(guildId) {
  const state = getGuildState(guildId);
  if (state.connection && state.musicPlayer) {
    state.connection.subscribe(state.musicPlayer);
  }
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
    const logMsg = `Queue empty. Reverting to TTS mode.`;
    console.log(`[G:${guildId}] [Player] ${logMsg}`);
    logToSupabase(guildId, 'sys', logMsg);
    
    setGuildConfig(guildId, { karaokeMode: false });
    updateGuildMeta(guildId, { status: '通話中' });
    // Switch back to ttsPlayer
    if (state.connection && state.ttsPlayer) {
      const subMsg = `Subscribing back to TTS player.`;
      console.log(`[G:${guildId}] [Player] ${subMsg}`);
      logToSupabase(guildId, 'sys', subMsg);
      state.connection.subscribe(state.ttsPlayer);
    }
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
      state.musicPlayer.play(resource);
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

      let accumulatedErr = '';
      ytdlp.stderr.on('data', data => {
        const msg = data.toString().trim();
        accumulatedErr += data.toString();
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
        if (signal === 'SIGTERM') {
          console.log(`[G:${guildId}] [yt-dlp] Process terminated.`);
        } else if (code && code !== 0) {
          console.warn(`[G:${guildId}] [yt-dlp] Exited with code ${code}`);
          const isRestricted = accumulatedErr.includes('Sign in to confirm your age');
          const isPrivate = accumulatedErr.includes('Private video');
          const isUnavailable = accumulatedErr.includes('Video unavailable');
          
          if ((isRestricted || isPrivate || isUnavailable) && discordClient) {
             const cfg = getGuildConfig(guildId);
             if (cfg.textChannelId) {
                const channel = discordClient.channels.cache.get(cfg.textChannelId);
                if (channel) {
                   let reason = '利用できません';
                   if (isRestricted) reason = '年齢制限がかかっています';
                   if (isPrivate) reason = '非公開動画です';
                   
                   const errEmbed = new EmbedBuilder()
                     .setColor('#E57373')
                     .setTitle('⚠️ 再生エラー')
                     .setDescription(`**${item.title}** は${reason}ため再生できないのだ。スキップするのだ！`);
                   channel.send({ embeds: [errEmbed] }).catch(()=>null);
                }
             }
          }
        }
      });

      state.currentProcess = {
        kill: () => {
          try { ytdlp.kill(); } catch (e) { }
          try { ffmpeg.kill(); } catch (e) { }
        }
      };

      const resource = createAudioResource(ffmpeg.stdout, {
        inputType: StreamType.OggOpus,
        inlineVolume: false // Disable to ensure FFmpeg-encoded Opus pass-through
      });
      console.log(`[Player] Music resource created. StreamType: OggOpus, InlineVolume: false`);

      state.musicPlayer.play(resource);
      
      sendNowPlayingEmbed(guildId, item, resource);
    }
  } catch (err) {
    console.error('[Player] Music playback error:', err.message || err);
    state.playing = false;
    state.currentSong = null;
    processQueue(guildId); // Try next item
  }
}

async function processTtsQueue(guildId) {
  const state = guilds.get(guildId);
  if (!state || state.ttsPlaying || state.ttsQueue.length === 0) return;

  state.ttsPlaying = true;
  const item = state.ttsQueue.shift();

  try {
    const { text, streamPromise } = item;
    const audioStream = await streamPromise;
    if (!audioStream) throw new Error('Audio synthesis failed or was pre-emptively aborted');

    const userLabel = item.userName || item.userId || 'System';
    // Redundant Speaking log removed as TTS log in index.js handles this

    const cfg = getFullGuildConfig(guildId).settings;
    const ttsVolume = cfg.volume ?? 1.0;

    const ffmpeg = spawn(ffmpegPath, [
      '-f', 'wav',
      '-i', 'pipe:0',
      '-af', `volume=${ttsVolume}`,
      '-c:a', 'libopus',
      '-b:a', '128k',
      '-application', 'voip',
      '-packet_loss', '0',
      '-f', 'opus',
      '-ar', '48000',
      '-ac', '2',
      'pipe:1'
    ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

    audioStream.pipe(ffmpeg.stdin);

    ffmpeg.stderr.on('data', data => {
      const msg = data.toString().trim();
      if (msg.includes('Error')) console.error(`[G:${guildId}] [TTS ffmpeg] Error:`, msg);
    });

    const resource = createAudioResource(ffmpeg.stdout, {
      inputType: StreamType.OggOpus,
      inlineVolume: false,
    });
    state.ttsPlayer.play(resource);
  } catch (err) {
    console.error('[Player] TTS error:', err.message || err);
    state.ttsPlaying = false;
    processTtsQueue(guildId);
  }
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const m = Math.floor(seconds / 60);
  const s = String(seconds % 60).padStart(2, '0');
  return `${m}:${s}`;
}

async function sendNowPlayingEmbed(guildId, song, resource) {
  const state = guilds.get(guildId);
  if (!state || !discordClient) return;

  const cfg = getGuildConfig(guildId);
  if (!cfg.textChannelId) return;

  const channel = discordClient.channels.cache.get(cfg.textChannelId);
  if (!channel) return;

  clearNowPlaying(guildId);

  const embed = new EmbedBuilder()
    .setColor('#42A5F5')
    .setTitle('🎶 再生中')
    .setDescription(`**[${song.title}](${song.url})**\n⏰ \`0:00 / ${song.duration}\``);

  if (song.artist) embed.addFields({ name: '🎤 アーティスト', value: song.artist, inline: true });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('music_pause')
      .setLabel('⏯️ 再生/一時停止')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('music_skip')
      .setLabel('⏭️ スキップ')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('music_stop')
      .setLabel('⏹️ 停止')
      .setStyle(ButtonStyle.Danger)
  );

  try {
    const msg = await channel.send({ embeds: [embed], components: [row] });
    state.nowPlayingMessage = msg;

    state.nowPlayingInterval = setInterval(() => {
      if (!state.nowPlayingMessage) {
        clearInterval(state.nowPlayingInterval);
        return;
      }
      
      const currentStatus = state.musicPlayer?.state.status;
      if (currentStatus === AudioPlayerStatus.Paused) {
        return;
      }

      const elapsed = formatDuration(resource.playbackDuration);
      const newEmbed = EmbedBuilder.from(embed).setDescription(`**[${song.title}](${song.url})**\n⏰ \`${elapsed} / ${song.duration}\``);
      
      msg.edit({ embeds: [newEmbed] }).catch(() => {
        clearInterval(state.nowPlayingInterval);
      });
    }, 10000);
  } catch (err) {
    console.warn(`[G:${guildId}] [NowPlaying] Failed to send embed:`, err.message);
  }
}

function clearNowPlaying(guildId) {
  const state = guilds.get(guildId);
  if (!state) return;

  if (state.nowPlayingInterval) {
    clearInterval(state.nowPlayingInterval);
    state.nowPlayingInterval = null;
  }

  if (state.nowPlayingMessage) {
    // Disable components instead of deleting message to keep history
    const oldEmbeds = state.nowPlayingMessage.embeds;
    if (oldEmbeds && oldEmbeds.length > 0 && state.nowPlayingMessage.editable) {
      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music_pause').setLabel('⏯️ 再生/一時停止').setStyle(ButtonStyle.Primary).setDisabled(true),
        new ButtonBuilder().setCustomId('music_skip').setLabel('⏭️ スキップ').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId('music_stop').setLabel('⏹️ 停止').setStyle(ButtonStyle.Danger).setDisabled(true)
      );
      state.nowPlayingMessage.edit({ embeds: oldEmbeds, components: [disabledRow] }).catch(() => null);
    }
    state.nowPlayingMessage = null;
  }
}

export function stopMusic(guildId) {
  const state = getGuildState(guildId);
  if (!state) return false;
  state.queue = [];
  state.loopMode = 'off';
  return skipMusic(guildId);
}

