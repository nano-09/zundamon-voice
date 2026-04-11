import 'dotenv/config';

const configCache = new Map();

/**
 * List of expected configuration keys.
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
  'VOICEVOX_URL',
  'VOICEVOX_SPEAKER'
];

/**
 * Initializes the global bot configuration using environment variables.
 */
export async function initBotConfig() {
  console.log('[BotConfig] Initializing global config from environment variables...');
  
  for (const key of CONFIG_KEYS) {
    const value = process.env[key];
    if (value) {
      configCache.set(key, value);
    } else {
      console.warn(`[BotConfig] Environment variable "${key}" is missing.`);
    }
  }

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
