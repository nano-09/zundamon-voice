// src/db.js
// Handles saving and retrieving conversation history locally in memory

// Map to store chat history per guild
// Key: guildId, Value: Array of message objects { role, content, timestamp }
const chatHistory = new Map();

/**
 * Saves a message to the in-memory chat history.
 * @param {string} guildId The Discord server ID
 * @param {string} userId The Discord user ID who triggered this message
 * @param {string} role 'user', 'assistant', or 'tool'
 * @param {string} content The message content
 */
export async function saveMessage(guildId, userId, role, content) {
  if (!chatHistory.has(guildId)) {
    chatHistory.set(guildId, []);
  }
  
  const history = chatHistory.get(guildId);
  history.push({
    role,
    content,
    timestamp: Date.now()
  });

  // Keep memory footprint small (e.g., max 50 messages per guild)
  if (history.length > 50) {
    history.shift();
  }
}

/**
 * Retrieves the recent chat history for a given guild to use as AI context.
 * @param {string} guildId The Discord server ID
 * @param {number} limit The maximum number of past messages to fetch
 * @returns {Promise<Array<{role: string, content: string}>>} Array of message objects
 */
export async function getRecentHistory(guildId, limit = 10) {
  if (!chatHistory.has(guildId)) return [];

  const history = chatHistory.get(guildId);
  
  // Return the most recent `limit` messages
  // Array.slice(-limit) grabs the end of the array (newest stuff)
  const recent = history.slice(-limit);

  return recent.map(msg => ({
    role: msg.role,
    content: msg.content
  }));
}

/**
 * Clears all chat history for a specific guild.
 * Called when the bot disconnects from a voice channel.
 * @param {string} guildId
 */
export async function clearHistory(guildId) {
  if (chatHistory.has(guildId)) {
    chatHistory.delete(guildId);
    console.log(`[Memory] Cleared local chat history for guild ${guildId}`);
  }
}

/**
 * Clears all chat history across all guilds.
 * Called on bot shutdown.
 */
export async function clearAllHistory() {
  chatHistory.clear();
  console.log('[Memory] Cleared all local chat histories.');
}
