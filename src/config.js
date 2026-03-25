import { getGuildConfigFromDb, saveGuildConfigToDb } from './db_supabase.js';

// In-memory cache for performance
const configCache = new Map();

/**
 * Pre-loads all guild configs from Supabase.
 * Should be called once at bot startup.
 */
export async function initConfigs(guildIds) {
  console.log('[Config] Initializing configs from Supabase...');
  for (const guildId of guildIds) {
    const data = await getGuildConfigFromDb(guildId);
    if (data) {
      configCache.set(guildId, {
        name: data.name,
        settings: data.settings || {},
        permissions: data.permissions || {},
        status: data.status || 'Idle'
      });
    } else {
      // Default empty config
      configCache.set(guildId, { name: '', settings: {}, permissions: {}, status: 'Idle' });
    }
  }
}

/**
 * Re-fetches a single guild's config from Supabase and updates the cache.
 * @param {string} guildId
 */
export async function refreshConfig(guildId) {
  const data = await getGuildConfigFromDb(guildId);
  if (data) {
    configCache.set(guildId, {
      name: data.name,
      settings: data.settings || {},
      permissions: data.permissions || {},
      status: data.status || 'Idle'
    });
    console.log(`[Config] Sync complete for guild ${guildId}`);
  }
}

/**
 * Returns the config object for a given guild.
 * @param {string} guildId
 */
export function getGuildConfig(guildId) {
  const cached = configCache.get(guildId);
  if (cached) return cached.settings;
  return {};
}

/**
 * Returns the full guild record (name, settings, permissions, status)
 */
export function getFullGuildConfig(guildId) {
  return configCache.get(guildId) || { name: '', settings: {}, permissions: {}, status: 'Idle' };
}

/**
 * Updates config values for a given guild (partial update).
 * @param {string} guildId
 * @param {object} updates
 */
export async function setGuildConfig(guildId, updates) {
  const cached = configCache.get(guildId) || { name: '', settings: {}, permissions: {}, status: 'Idle' };
  cached.settings = { ...cached.settings, ...updates };
  configCache.set(guildId, cached);

  // Sync to Supabase in background
  saveGuildConfigToDb(guildId, cached);
}

/**
 * Updates server name, status, or permissions specifically
 */
export async function updateGuildMeta(guildId, { name, status, permissions }) {
  const cached = configCache.get(guildId) || { name: '', settings: {}, permissions: {}, status: 'Idle' };
  if (name !== undefined) cached.name = name;
  if (status !== undefined) cached.status = status;
  if (permissions !== undefined) cached.permissions = permissions;
  
  configCache.set(guildId, cached);
  saveGuildConfigToDb(guildId, cached);
}
