// src/config.js
// Persists per-guild bot configuration to config.json

import { readFileSync, writeFileSync, existsSync } from 'fs';

const CONFIG_PATH = './config.json';

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function saveConfig(data) {
  writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * Returns the config object for a given guild.
 * @param {string} guildId
 * @returns {{ textChannelId?: string, voiceChannelId?: string, speakerId?: number, readName?: boolean, speed?: number, pitch?: number, volume?: number, chatMode?: boolean }}
 */
export function getGuildConfig(guildId) {
  const all = loadConfig();
  return all[guildId] || {};
}

/**
 * Updates config values for a given guild (partial update).
 * @param {string} guildId
 * @param {{ textChannelId?: string, voiceChannelId?: string, speakerId?: number, readName?: boolean, speed?: number, pitch?: number, volume?: number }} updates
 */
export function setGuildConfig(guildId, updates) {
  const all = loadConfig();
  all[guildId] = { ...(all[guildId] || {}), ...updates };
  saveConfig(all);
}
