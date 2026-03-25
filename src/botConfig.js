// src/botConfig.js
// Service for fetching global bot configuration from Supabase Vault

import supabase from './db_supabase.js';

const configCache = new Map();

/**
 * List of expected configuration keys.
 * These will be fetched from Supabase Vault at startup.
 */
const CONFIG_KEYS = [
  'DISCORD_TOKEN',
  'CLIENT_ID',
  'OWNER_DISCORD_ID',
  'OWNER_EMAIL',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'OLLAMA_URL',
  'OLLAMA_MODEL',
  'VOICEVOX_URL',
  'VOICEVOX_SPEAKER'
];

/**
 * Initializes the global bot configuration by fetching all keys from Supabase Vault.
 */
export async function initBotConfig() {
  console.log('[BotConfig] Initializing global config from Supabase Vault...');
  
  const promises = CONFIG_KEYS.map(async (key) => {
    try {
      const { data, error } = await supabase.rpc('get_bot_secret', { secret_name: key });
      
      if (error) {
        // Fallback to process.env if vault retrieval fails (useful for local dev or transition)
        const fallback = process.env[key];
        if (fallback) {
          configCache.set(key, fallback);
          return;
        }
        console.warn(`[BotConfig] Failed to fetch secret "${key}":`, error.message);
        return;
      }

      if (data !== null) {
        configCache.set(key, data);
      } else {
        // Fallback to process.env
        const fallback = process.env[key];
        if (fallback) {
          configCache.set(key, fallback);
        } else {
          console.warn(`[BotConfig] Secret "${key}" not found in Vault and no .env fallback.`);
        }
      }
    } catch (err) {
      console.error(`[BotConfig] Error fetching secret "${key}":`, err.message);
    }
  });

  await Promise.all(promises);
  console.log(`[BotConfig] Config initialization complete. (${configCache.size}/${CONFIG_KEYS.length} keys loaded)`);
}

/**
 * Returns a configuration value by key.
 * @param {string} key
 * @param {any} defaultValue
 * @returns {any}
 */
export function getBotConfig(key, defaultValue = null) {
  if (configCache.has(key)) {
    return configCache.get(key);
  }
  return defaultValue;
}

/**
 * Returns all loaded configuration (useful for debugging/dashboard).
 */
export function getAllBotConfig() {
  return Object.fromEntries(configCache);
}
