// src/player.js
// Manages per-guild voice connections and queued TTS audio playback

import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  EndBehaviorType,
} from '@discordjs/voice';
import { synthesize } from './tts.js';
import { getGuildConfig } from './config.js';
import OpusScript from 'opusscript';
import { processAudioLocally, isWhisperReady } from './ai.js';

// Map of guildId -> { connection, player, queue, playing }
const guilds = new Map();

function getGuildState(guildId) {
  if (!guilds.has(guildId)) {
    guilds.set(guildId, {
      connection: null,
      player: null,
      queue: [],
      playing: false,
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

  // Wait for connection to be ready
  await entersState(connection, VoiceConnectionStatus.Ready, 30_000);

  const player = createAudioPlayer();
  connection.subscribe(player);

  player.on(AudioPlayerStatus.Idle, () => {
    state.playing = false;
    processQueue(voiceChannel.guild.id);
  });

  player.on('error', (err) => {
    console.error('[Player] Error:', err.message);
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
    if (userId === connection.joinConfig?.selfId) return;

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
    
    console.log(`\n🎧 [ChatMode] Listening to user ID: ${userId}...`);

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
        console.log(`⌛ [ChatMode] Processing ${(pcmBuffer.length / 192000).toFixed(1)}s of audio from user ID: ${userId}...`);
        const result = await processAudioLocally(pcmBuffer);

        // null means hallucination was detected — skip silently
        if (!result) return;

        const { transcription, reply } = result;
        console.log(`🗣️  [ChatMode] User Said: "${transcription}"`);
        console.log(`🤖 [ChatMode] Zundamon: "${reply}"`);
        
        if (reply) {
          enqueue(voiceChannel.guild.id, reply);
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
    state.connection.destroy();
    guilds.delete(guildId);
  }
}

/**
 * Disconnects the bot from all voice channels gracefully.
 */
export function leaveAllChannels() {
  for (const [guildId, state] of guilds.entries()) {
    if (state.connection) {
      state.connection.destroy();
    }
  }
  guilds.clear();
}

/**
 * Adds text to the TTS queue for a guild.
 * @param {string} guildId
 * @param {string} text
 */
export function enqueue(guildId, text) {
  const state = getGuildState(guildId);
  if (!state.connection) return; // Not connected, silently ignore
  state.queue.push(text);
  if (!state.playing) {
    processQueue(guildId);
  }
}

/**
 * Returns true if the bot is currently connected to voice in this guild.
 * @param {string} guildId
 */
export function isConnected(guildId) {
  const state = guilds.get(guildId);
  return !!(state?.connection);
}

async function processQueue(guildId) {
  const state = guilds.get(guildId);
  if (!state || state.playing || state.queue.length === 0) return;

  state.playing = true;
  const text = state.queue.shift();

  try {
    const cfg = getGuildConfig(guildId);
    const audioStream = await synthesize(text, cfg.speakerId, cfg.speed, cfg.pitch, cfg.volume);
    const resource = createAudioResource(audioStream, {
      // WAV format — no special input type needed
      inlineVolume: false,
    });
    state.player.play(resource);
  } catch (err) {
    console.error('[TTS] Synthesis error:', err.response?.data?.message || err.message || err.code || err);
    state.playing = false;
    processQueue(guildId); // Try next item
  }
}
