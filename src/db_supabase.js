import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import { DEFAULT_PERMISSIONS } from './constants.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ═══════════════════════════════════════════════════════════
// GUILD INIT  — called when bot joins a new server + 2FA ok
// ═══════════════════════════════════════════════════════════
/**
 * Creates or updates the guild_configs row when a server is joined and verified.
 * @param {import('discord.js').Guild} guild
 */
export async function initGuildTable(guild) {
  try {
    const payload = {
      guild_id: guild.id,
      name: guild.name,
      icon_url: guild.iconURL({ dynamic: true, size: 128 }) ?? null,
      owner_id: guild.ownerId,
      member_count: guild.memberCount,
      permissions: DEFAULT_PERMISSIONS,
      joined_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('guild_configs')
      .upsert(payload, { onConflict: 'guild_id', ignoreDuplicates: false });

    if (error) throw error;
    console.log(`[Supabase] Guild initialized: ${guild.name} (${guild.id})`);
  } catch (err) {
    console.error(`[Supabase] initGuildTable error for ${guild.id}:`, err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// HOURLY SNAPSHOT  — called once per hour per guild
// ═══════════════════════════════════════════════════════════
/**
 * Writes an hourly analytics snapshot for a guild.
 * @param {string} guildId
 * @param {object} data
 * @param {number} data.texts_spoken
 * @param {number} data.ai_queries
 * @param {number} data.voice_minutes
 * @param {number} data.errors
 * @param {number} data.members_active
 * @param {object} data.commands_used  e.g. {join:2, play:5}
 */
export async function snapshotGuildAnalytics(guildId, data) {
  try {
    const { error } = await supabase.from('guild_analytics').insert([{
      guild_id: guildId,
      snapshot_at: new Date().toISOString(),
      texts_spoken:   data.texts_spoken   ?? 0,
      ai_queries:     data.ai_queries     ?? 0,
      voice_minutes:  data.voice_minutes  ?? 0,
      errors:         data.errors         ?? 0,
      members_active: data.members_active ?? 0,
      commands_used:  data.commands_used  ?? {},
    }]);
    if (error) throw error;
  } catch (err) {
    console.error(`[Supabase] snapshotGuildAnalytics error for ${guildId}:`, err.message);
  }
}

/**
 * Retrieves recent analytics snapshots for a guild.
 * @param {string} guildId
 * @param {number} hours  — how many hours back to fetch (default 24)
 * @returns {Promise<object[]>}
 */
export async function getGuildAnalytics(guildId, hours = 24) {
  try {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('guild_analytics')
      .select('*')
      .eq('guild_id', guildId)
      .gte('snapshot_at', since)
      .order('snapshot_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  } catch (err) {
    console.error(`[Supabase] getGuildAnalytics error for ${guildId}:`, err.message);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════
// GUILD CONFIG  — settings persistence
// ═══════════════════════════════════════════════════════════
export async function getGuildConfigFromDb(guildId) {
  try {
    const { data, error } = await supabase
      .from('guild_configs')
      .select('*')
      .eq('guild_id', guildId)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  } catch (err) {
    console.error(`[Supabase] getGuildConfigFromDb error for ${guildId}:`, err.message);
    return null;
  }
}

export async function getAllGuildConfigsFromDb(guildIds) {
  try {
    if (!guildIds || guildIds.length === 0) return [];
    const { data, error } = await supabase
      .from('guild_configs')
      .select('*')
      .in('guild_id', guildIds);
    if (error) throw error;
    return data ?? [];
  } catch (err) {
    console.error(`[Supabase] getAllGuildConfigsFromDb error:`, err.message);
    return [];
  }
}

export async function saveGuildConfigToDb(guildId, updates) {
  try {
    const payload = {
      guild_id: guildId,
      updated_at: new Date().toISOString(),
      ...updates,
    };
    const { error } = await supabase
      .from('guild_configs')
      .update(payload)
      .eq('guild_id', guildId);
    if (error) throw error;
  } catch (err) {
    console.error(`[Supabase] saveGuildConfigToDb error for ${guildId}:`, err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// LOGGING
// ═══════════════════════════════════════════════════════════
/**
 * @param {string|null} guildId
 * @param {'bot'|'sys'|'err'} type
 * @param {string} message
 */
export async function logToSupabase(guildId, type, message) {
  try {
    const { error } = await supabase.from('logs_v2').insert([{
      guild_id:  guildId,
      type,
      message,
      timestamp: new Date().toISOString(),
    }]);
    if (error) throw error;
  } catch (err) {
    // Silent fail – never block bot logic over logging errors
  }
}

/**
 * Clears all error logs from the database.
 */
export async function clearErrorLogs() {
  try {
    const { error } = await supabase
      .from('logs_v2')
      .delete()
      .eq('type', 'err');
    if (error) throw error;
  } catch (err) {
    console.error(`[Supabase] clearErrorLogs error:`, err.message);
    throw err;
  }
}

export async function deleteGuildConfigFromDb(guildId) {
  try {
    const { error } = await supabase
      .from('guild_configs')
      .delete()
      .eq('guild_id', guildId);
    if (error) throw error;
    console.log(`[Supabase] Guild config deleted: ${guildId}`);
  } catch (err) {
    console.error(`[Supabase] deleteGuildConfigFromDb error for ${guildId}:`, err.message);
  }
}

// ═══════════════════════════════════════════════════════════
// USER PRESETS  — cross-server profiles
// ═══════════════════════════════════════════════════════════
export async function getUserPresets(userId) {
  try {
    const { data, error } = await supabase
      .from('user_presets')
      .select('*')
      .eq('user_id', userId);
    if (error) throw error;
    return data ?? [];
  } catch (err) {
    console.error(`[Supabase] getUserPresets error for ${userId}:`, err.message);
    return [];
  }
}

export async function saveUserPreset(userId, name, data) {
  try {
    const payload = {
      user_id: userId,
      name,
      voice_id: parseInt(data.voiceId),
      speed: parseFloat(data.speed),
      pitch: parseFloat(data.pitch),
      volume: parseFloat(data.volume),
      updated_at: new Date().toISOString()
    };
    const { error } = await supabase
      .from('user_presets')
      .upsert(payload, { onConflict: 'user_id,name' });
    if (error) throw error;
  } catch (err) {
    console.error(`[Supabase] saveUserPreset error for ${userId}:`, err.message);
    throw err;
  }
}

export async function deleteUserPreset(userId, name) {
  try {
    const { error } = await supabase
      .from('user_presets')
      .delete()
      .match({ user_id: userId, name });
    if (error) throw error;
  } catch (err) {
    console.error(`[Supabase] deleteUserPreset error for ${userId}:`, err.message);
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════
// MUSIC LYRICS  — pre-fetched and cached lyrics
// ═══════════════════════════════════════════════════════════
export async function getLyricsFromCache(videoUrl) {
  try {
    const { data, error } = await supabase
      .from('music_lyrics')
      .select('*')
      .eq('video_url', videoUrl)
      .maybeSingle();
    if (error) throw error;
    return data;
  } catch (err) {
    console.error(`[Supabase] getLyricsFromCache error:`, err.message);
    return null;
  }
}

export async function saveLyricsToCache(videoUrl, lyrics, source, found = true) {
  try {
    const payload = {
      video_url: videoUrl,
      lyrics,
      source,
      found,
      updated_at: new Date().toISOString()
    };
    const { error } = await supabase
      .from('music_lyrics')
      .upsert(payload, { onConflict: 'video_url' });
    if (error) throw error;
  } catch (err) {
    console.error(`[Supabase] saveLyricsToCache error:`, err.message);
  }
}

export async function reportIncorrectLyrics(videoUrl) {
  try {
    const { error } = await supabase
      .from('music_lyrics')
      .update({
        found: false,
        lyrics: null,
        updated_at: new Date().toISOString()
      })
      .eq('video_url', videoUrl);
    if (error) throw error;
  } catch (err) {
    console.error(`[Supabase] reportIncorrectLyrics error:`, err.message);
  }
}

export default supabase;
