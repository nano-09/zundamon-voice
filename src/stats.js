// src/stats.js
// Handles per-guild command and activity statistics

// Map<guildId, { texts_spoken, ai_queries, voice_minutes, errors, members_active, commands_used }>
const guildCounters = new Map();

// Tracks session-wide total commands per guild
const sessionCommands = new Map();
// Tracks session-wide total TTS per guild
const sessionTextsSpoken = new Map();

export function getGuildCounters(guildId) {
  if (!guildCounters.has(guildId)) {
    guildCounters.set(guildId, {
      texts_spoken: 0,
      ai_queries: 0,
      voice_minutes: 0,
      errors: 0,
      members_active: new Set(),
      commands_used: {},
    });
  }
  return guildCounters.get(guildId);
}

export function incrementCounter(guildId, field, userId = null) {
  const c = getGuildCounters(guildId);
  if (field === 'texts_spoken') {
    c.texts_spoken++;
    sessionTextsSpoken.set(guildId, (sessionTextsSpoken.get(guildId) || 0) + 1);
  }
  else if (field === 'ai_queries') c.ai_queries++;
  else if (field === 'voice_minutes') c.voice_minutes++;
  else if (field === 'errors') c.errors++;
  if (userId) c.members_active.add(userId);
}

export function incrementCommand(guildId, commandName) {
  const c = getGuildCounters(guildId);
  c.commands_used[commandName] = (c.commands_used[commandName] || 0) + 1;
  sessionCommands.set(guildId, (sessionCommands.get(guildId) || 0) + 1);
}

export function getSessionCommands(guildId) {
  return sessionCommands.get(guildId) || 0;
}

export function getSessionTextsSpoken(guildId) {
  return sessionTextsSpoken.get(guildId) || 0;
}

export function getAndResetDeltas(guildId) {
  const c = getGuildCounters(guildId);
  const deltas = {
    texts_spoken: c.texts_spoken,
    ai_queries: c.ai_queries,
    voice_minutes: c.voice_minutes,
    errors: c.errors,
    members_active: c.members_active.size,
    commands_used: { ...c.commands_used },
  };

  // Reset deltas
  c.texts_spoken = 0;
  c.ai_queries = 0;
  c.voice_minutes = 0;
  c.errors = 0;
  c.members_active.clear();
  c.commands_used = {};

  return deltas;
}

export function getAllGuildCounters() {
  return guildCounters;
}
