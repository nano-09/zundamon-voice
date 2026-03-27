import { getGuildConfigFromDb, getAllGuildConfigsFromDb, saveGuildConfigToDb } from './db_supabase.js';
import { DEFAULT_PERMISSIONS, DEFAULT_SETTINGS } from './constants.js';

// In-memory cache for performance
const configCache = new Map();

/**
 * Applies default permissions by replacing the "@everyone" placeholder with the actual guild ID.
 */
function getEffectivePermissions(guildId, permissions) {
  if (!permissions || Object.keys(permissions).length === 0) {
    permissions = DEFAULT_PERMISSIONS;
  }
  
  // Clone to avoid mutating the constant or the input
  const result = JSON.parse(JSON.stringify(permissions));
  for (const cmd in result) {
    if (result[cmd]["@everyone"]) {
      result[cmd][guildId] = result[cmd]["@everyone"];
      delete result[cmd]["@everyone"];
    }
  }
  return result;
}

/**
 * Pre-loads all guild configs from Supabase.
 * Should be called once at bot startup.
 */
export async function initConfigs(guildIds) {
  if (!guildIds || guildIds.length === 0) return;
  console.log(`[Config] Initializing configs for ${guildIds.length} guilds...`);
  
  const allData = await getAllGuildConfigsFromDb(guildIds);
  const dataMap = new Map(allData.map(d => [d.guild_id, d]));

  for (const guildId of guildIds) {
    const data = dataMap.get(guildId);
    if (data) {
      configCache.set(guildId, {
        name: data.name,
        settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
        permissions: getEffectivePermissions(guildId, data.permissions),
        status: data.status || '待機中'
      });
    } else {
      // Default empty config
      configCache.set(guildId, { 
        name: '', 
        settings: { ...DEFAULT_SETTINGS }, 
        permissions: getEffectivePermissions(guildId, DEFAULT_PERMISSIONS), 
        status: '待機中' 
      });
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
      settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
      permissions: getEffectivePermissions(guildId, data.permissions),
      status: data.status || '待機中'
    });
    console.log(`[Config] Sync complete for guild ${guildId}`);
    // Notify dashboard of the sync
    const cached = configCache.get(guildId);
    console.log(`[SYS] [CONFIG_UPDATED] ${JSON.stringify({ guildId, name: cached.name, status: cached.status, settings: cached.settings, permissions: cached.permissions })}`);
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
  return configCache.get(guildId) || { name: '', settings: { ...DEFAULT_SETTINGS }, permissions: getEffectivePermissions(guildId, DEFAULT_PERMISSIONS), status: '待機中' };
}

/**
 * Updates config values for a given guild (partial update).
 * @param {string} guildId
 * @param {object} updates
 */
export async function setGuildConfig(guildId, updates) {
  const cached = configCache.get(guildId) || { name: '', settings: {}, permissions: getEffectivePermissions(guildId, DEFAULT_PERMISSIONS), status: '待機中' };
  cached.settings = { ...cached.settings, ...updates };
  configCache.set(guildId, cached);

  // Sync to Supabase in background (excluding permissions to prevent overwriting dashboard changes)
  const { permissions, ...savePayload } = cached;
  saveGuildConfigToDb(guildId, savePayload);

  // Notify dashboard
  console.log(`[SYS] [CONFIG_UPDATED] ${JSON.stringify({ guildId, settings: cached.settings })}`);
}

/**
 * Updates server name, status, or permissions specifically
 */
export async function updateGuildMeta(guildId, { name, status, permissions }) {
  const cached = configCache.get(guildId) || { name: '', settings: {}, permissions: getEffectivePermissions(guildId, DEFAULT_PERMISSIONS), status: '待機中' };
  if (name !== undefined) cached.name = name;
  if (status !== undefined) cached.status = status;
  if (permissions !== undefined) cached.permissions = getEffectivePermissions(guildId, permissions);
  
  configCache.set(guildId, cached);

  // When updating meta, we include permissions ONLY if they were explicitly passed to this function
  const savePayload = { name: cached.name, status: cached.status, settings: cached.settings };
  if (permissions !== undefined) savePayload.permissions = cached.permissions;
  
  saveGuildConfigToDb(guildId, savePayload);
  console.log(`[SYS] [CONFIG_UPDATED] ${JSON.stringify({ guildId, name: cached.name, status: cached.status, settings: cached.settings, permissions: cached.permissions })}`);
}
