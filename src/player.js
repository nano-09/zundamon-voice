// src/player.js
// Manages per-guild voice connections and queued TTS audio playback

import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} from '@discordjs/voice';
import { synthesize } from './tts.js';

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
    const audioStream = await synthesize(text);
    const resource = createAudioResource(audioStream, {
      // WAV format — no special input type needed
      inlineVolume: false,
    });
    state.player.play(resource);
  } catch (err) {
    console.error('[TTS] Synthesis error:', err.message);
    state.playing = false;
    processQueue(guildId); // Try next item
  }
}
