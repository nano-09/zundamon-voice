// src/index.js
// Main entry point for the Zundamon Discord TTS bot

import 'dotenv/config';
import { Client, GatewayIntentBits, Events, REST, Routes, MessageFlags, Partials } from 'discord.js';
import { commandDefinitions, handleCommand, startCleanChatTimer } from './commands.js';
import { enqueue, leaveChannel, leaveAllChannels, enqueueFile, joinChannel, isConnected as isBotConnected } from './player.js';
import { initBotConfig, getBotConfig } from './botConfig.js';
import { getGuildConfig, setGuildConfig, initConfigs, getFullGuildConfig, refreshConfig } from './config.js';
import { initMcpClient, isMcpReady } from './mcpClient.js';
import { isGuildAuthorized, isGuildBlocked, sendLocalOtp, verifyLocalOtp } from './auth.js';
import { initGuildTable, snapshotGuildAnalytics, logToSupabase, deleteGuildConfigFromDb } from './db_supabase.js';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import emojiRegex from 'emoji-regex';

import { getGuildCounters, incrementCounter, incrementCommand, getAllGuildCounters, getSessionCommands, getSessionTextsSpoken, getAndResetDeltas } from './stats.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envToken = process.env.DISCORD_TOKEN;
const envClientId = process.env.CLIENT_ID;

// ── 1. FAST-TRACK DISCORD LOGIN (ABSOLUTE PRIORITY) ──────────────────────────
// Establishing the connection is our first priority to ensure the bot appears 
// online as quickly as possible while other systems initialize in parallel.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, 
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

let ownerUser    = null;
let loginStarted = false;

function tryLogin(token) {
  if (loginStarted || !token) return;
  loginStarted = true;
  console.log('[SYS] [INIT] Attempting Discord login (Fast-Track)...');
  client.login(token).catch(err => {
    loginStarted = false;
    console.warn(`[SYS] [WARN] Fast-track login failed: ${err.message}`);
  });
}

if (envToken) {
  tryLogin(envToken);
}

// ── 2. ASYNC INITIALIZATIONS ──────────────────────────────────────────────────
// These are started in parallel with the Discord connection process.
const configPromise = initBotConfig();

// Load dictionary asynchronously to avoid blocking the event loop
let emojiDict = {};
(async () => {
  try {
    const emojiDictPath = path.join(__dirname, 'emoji_ja.json');
    const data = await fs.promises.readFile(emojiDictPath, 'utf8');
    emojiDict = JSON.parse(data);
    console.log('[SYS] [INIT] Emoji dictionary loaded (Async).');
  } catch (err) {
    console.error('[SYS] [WARN] Failed to load emoji dictionary:', err.message);
  }
})();

const customEmojisPath = path.join(__dirname, '..', 'custom_emojis.json');

// ── 3. ERROR HANDLERS ─────────────────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[SYS] [CRITICAL] Uncaught Exception:', err);
  logToSupabase(null, 'err', `Uncaught Exception: ${err.message}`);
  // Global error count? 
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[SYS] [CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
  logToSupabase(null, 'err', `Unhandled Rejection: ${reason}`);
});

// ── 4. BACKGROUND TASKS ──────────────────────────────────────────────────────
// Register slash commands once config is loaded (but don't block login)
configPromise.then(() => {
  const token = getBotConfig('DISCORD_TOKEN') || envToken;
  const clientId = getBotConfig('CLIENT_ID') || envClientId;

  if (token && clientId) {
    // If login hasn't started yet (e.g. no envToken), try with vault token
    if (!loginStarted) tryLogin(token);

    const rest = new REST({ version: '10' }).setToken(token);
    rest
      .put(Routes.applicationCommands(clientId), { body: commandDefinitions })
      .then(() => console.log('[SYS] ✅ スラッシュコマンドを登録しました。'))
      .catch((err) => console.warn('⚠️ コマンド登録失敗:', err.message));
  } else {
    console.warn('⚠️ DISCORD_TOKEN または CLIENT_ID が未設定のため、スラッシュコマンド登録をスキップします。');
  }
});

// ── Ready ─────────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, async (c) => {
  console.log(`[SYS] [INFO] Ready event fired! Bot user: ${c.user.tag}`);

  // ── 1. IMMEDIATE HEARTBEAT & STATS LOOP ────────────────────────────────────
  // We start this immediately so the dashboard sees us as "Online" right away.
  broadcastStats();
  const startStatsLoop = () => {
    setInterval(broadcastStats, 5000);
    // Trigger immediate broadcast on relevant events for "live" feel
    client.on(Events.VoiceStateUpdate, (oldS, newS) => {
      if (oldS.member.id === client.user.id || newS.member.id === client.user.id) {
        broadcastStats();
      }
    });
    client.on(Events.GuildCreate, () => broadcastStats());
    client.on(Events.GuildDelete, () => broadcastStats());
  };
  startStatsLoop();

  // ── 2. BACKGROUND INITIALIZATION ───────────────────────────────────────────
  // We run these in the background so they don't block the Ready event return.
  (async () => {
    try {
      await configPromise;
      
      const ownerId = getBotConfig('OWNER_DISCORD_ID');
      if (ownerId && !ownerUser) {
        const user = await client.users.fetch(ownerId).catch(() => null);
        if (user) {
          ownerUser = user;
          const ownerEmail = getBotConfig('OWNER_EMAIL');
          const ownerStats = {
            type: 'SYSTEM_INIT',
            owner: {
              username: user.username,
              avatar: user.displayAvatarURL(),
              email: ownerEmail || 'Not set'
            }
          };
          console.log(`[SYS] [DASHBOARD_STATS] ${JSON.stringify(ownerStats)}`);
        }
      }

      console.log(`   VOICEVOX: ${getBotConfig('VOICEVOX_URL') || 'http://localhost:50021'}`);
      console.log(`   スピーカー ID: ${getBotConfig('VOICEVOX_SPEAKER') || '3'} (ずんだもん)`);

      const guildIds = client.guilds.cache.map(g => g.id);
      await initConfigs(guildIds);
      console.log(`[SYS] [INFO] Config initialization complete.`);

      // Resume clean chat intervals
      for (const guildId of guildIds) {
        const cfg = getGuildConfig(guildId);
        if (cfg.cleanChatTasks) {
          for (const [channelId, minutes] of Object.entries(cfg.cleanChatTasks)) {
            if (minutes > 0) {
              startCleanChatTimer(client, guildId, channelId, minutes * 60 * 1000);
            }
          }
        }
      }

      // Auto-rejoin stabilization (Reduced wait to 1s)
      console.log(`[SYS] [INFO] Waiting 1 second for gateway to settle before auto-rejoin...`);
      await new Promise(r => setTimeout(r, 1000));

      // Parallel Auto-rejoin
      const rejoinPromises = guildIds.map(async (guildId) => {
        const cfg = getGuildConfig(guildId);
        if (cfg.voiceChannelId) {
          const channel = client.channels.cache.get(cfg.voiceChannelId);
          if (channel && channel.isVoiceBased()) {
            // Check if guild is blocked
            if (isGuildBlocked(guildId)) {
              console.log(`[G:${guildId}] [SYS] Skipping auto-rejoin: Guild is blocked.`);
              return;
            }

            // REVISED: Only rejoin if the "last user" is present in the channel
            const isLastUserPresent = cfg.lastUserId ? channel.members.has(cfg.lastUserId) : false;
            
            // If lastUserId is not saved yet (legacy), fallback to "any human"
            const humans = channel.members.filter(m => !m.user.bot);
            const shouldRejoin = cfg.lastUserId ? isLastUserPresent : (humans.size > 0);

            if (!shouldRejoin) return;
            
            try {
              await joinChannel(channel);
              console.log(`[G:${guildId}] [SYS] Auto-rejoined voice channel: ${channel.name}`);
              logToSupabase(guildId, 'sys', `Auto-rejoined voice channel: ${channel.name}`);
            } catch (err) {
              console.error(`[SYS] Auto-rejoin failed for ${guildId}:`, err.message);
            }
          }
        }
      });
      await Promise.allSettled(rejoinPromises);

      // Restart 2FA Flow for any unauthorized guilds found during startup
      for (const guild of client.guilds.cache.values()) {
        if (!isGuildAuthorized(guild.id)) {
          console.log(`[SYS] Unauthorized guild detected on startup: ${guild.name} (${guild.id}). Starting 2FA flow.`);
          await sendLocalOtp(guild.id, guild.name);
          
          if (ownerId) {
            try {
              const owner = await client.users.fetch(ownerId);
              await owner.send(
                `🔐 **サーバー認証リクエスト**\n\n` +
                `ボットが未認証のサーバーに存在しています。\n` +
                `📛 サーバー名: **${guild.name}**\n` +
                `🆔 サーバーID: \`${guild.id}\`\n\n` +
                `このサーバーを認証するには、**ボットからあなたのメールアドレスに送信された6桁の認証コード** をこのDMに返信してください。\n` +
                `認証しない場合は無視してください。ボットはそのサーバーで機能しません。`
              );
            } catch (err) {
              console.error('[2FA] Failed to DM owner on startup:', err.message);
            }
          }
        }
      }

      // Pre-initialize the MCP server so the first search isn't delayed by NPX starting
      initMcpClient().catch(err => console.error('[MCP] Pre-initialization failed:', err));

      console.log('[SYS] [INIT] Startup background tasks finalized.');
    } catch (err) {
      console.error('[SYS] [CRITICAL] Background initialization failed:', err);
    }
  })();
});

// ── 2FA: Bot joins a new guild → DM owner with auth code ─────────────────────
client.on(Events.GuildCreate, async (guild) => {
  console.log(`[2FA] Bot joined new guild: ${guild.name} (${guild.id})`);

  // Initialize guild table in Supabase with join metadata
  await initGuildTable(guild).catch(e => console.error('[Supabase] initGuildTable:', e));
  console.log(`[SYS] [GUILD_ADDED] ${guild.id}`);
  await logToSupabase(guild.id, 'sys', `Bot joined server: ${guild.name}`);

  // If already authorized, skip 2FA flow
  if (isGuildAuthorized(guild.id)) {
    console.log(`[2FA] Guild ${guild.id} is already authorized.`);
    return;
  }

  const ownerId = getBotConfig('OWNER_DISCORD_ID');
  if (!ownerId) {
    console.warn('[2FA] OWNER_DISCORD_ID not set — cannot send auth DM.');
    return;
  }

  console.log(`[2FA] Generating local OTP for guild ${guild.name}`);
  await sendLocalOtp(guild.id, guild.name);

  try {
    const owner = await client.users.fetch(ownerId);
    await owner.send(
      `🔐 **サーバー認証リクエスト**\n\n` +
      `ボットが新しいサーバーに追加されました！\n` +
      `📛 サーバー名: **${guild.name}**\n` +
      `🆔 サーバーID: \`${guild.id}\`\n\n` +
      `このサーバーを認証するには、**ボットからあなたのメールアドレスに送信された6桁の認証コード** をこのDMに返信してください。\n` +
      `認証しない場合は無視してください。ボットはそのサーバーで機能しません。`
    );
    console.log(`[2FA] Auth DM sent to owner ${ownerId}.`);
  } catch (err) {
    console.error('[2FA] Failed to DM owner:', err.message);
  }
});

// ── Bot leaves a guild → Clean up and signal dashboard ────────────────────────
client.on(Events.GuildDelete, async (guild) => {
  console.log(`[SYS] Bot left guild: ${guild.name} (${guild.id})`);

  try {
    await deleteGuildConfigFromDb(guild.id);
    console.log(`[SYS] [GUILD_REMOVED] ${guild.id}`);
    await logToSupabase(null, 'sys', `Bot left server: ${guild.name} (${guild.id})`);
  } catch (err) {
    console.error('[Supabase] Error after guild leave:', err.message);
  }
});

// ── Slash command interactions ────────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isAutocomplete()) {
    try {
      const { handleAutocomplete } = await import('./commands.js');
      await handleAutocomplete(interaction);
    } catch (err) {
      console.error('[Autocomplete]', err);
    }
    return;
  }
  
  if (!interaction.isChatInputCommand()) return;
  try {
    await handleCommand(interaction);
  } catch (err) {
    console.error('[InteractionCreate]', err);
    incrementCounter(interaction.guildId, 'errors', interaction.user.id);
    
    // Log failure to Command Log
    const logMsg = `[CMD] User: ${interaction.user.username}, Command: /${interaction.commandName}, Status: Error (${err.message})`;
    logToSupabase(interaction.guildId, 'cmd', logMsg);

    emitLiveSnapshot(interaction.guildId, { errors: 1 });
    broadcastStats();

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: '❌ エラーが発生しました。', flags: [MessageFlags.Ephemeral] }).catch(() => { });
    } else {
      await interaction.reply({ content: '❌ エラーが発生しました。', flags: [MessageFlags.Ephemeral] }).catch(() => { });
    }
  }
});

// ── DM listener → 2FA code verification ─────────────────────────────────────
client.on(Events.MessageCreate, async (message) => {
  // Only handle DMs from the bot owner
  if (message.author.bot) return;
  if (message.guild) return; // Skip guild messages — handled below

  const ownerId = getBotConfig('OWNER_DISCORD_ID');
  if (!ownerId || message.author.id !== ownerId) return;

  const code = message.content.trim();
  if (!/^\d{6}$/.test(code)) return; // Only 6-digit codes

  const result = await verifyLocalOtp(code);
  if (result) {
    await message.reply(`✅ サーバー「**${result.guildName}**」を認証しました！ボットが使用可能です。`);
    console.log(`[2FA] Guild ${result.guildName} (${result.guildId}) authorized by owner.`);
    // Refresh guild metadata now that it's verified
    const verifiedGuild = client.guilds.cache.get(result.guildId);
    if (verifiedGuild) {
      await initGuildTable(verifiedGuild).catch(() => {});
      await logToSupabase(result.guildId, 'sys', `Server verified by owner: ${result.guildName}`);
    }
  } else {
    await message.reply('❌ そのコードは無効または期限切れです（またはメールアドレスが未設定です）。');
  }
  return;
});

// ── Real-time Analytics Snapshot ──────────────────────────────────────────
/**
 * Emits a snapshot delta to the console for the dashboard and optionally saves to Supabase.
 * @param {string} guildId 
 * @param {object} deltaData 
 */
export async function emitLiveSnapshot(guildId, deltaData) {
  const snapshotAt = new Date().toISOString();
  // Delta for dashboard (prevents dashboard chart from having too many points)
  console.log(`[SYS] [SNAPSHOT] ${JSON.stringify({ guildId, ...deltaData, snapshot_at: snapshotAt })}`);
  
  // Persistence to Supabase (We still want to save to DB, but maybe throttled or just as-is)
  // For now, we save every live event to DB to ensure no data loss.
  await snapshotGuildAnalytics(guildId, deltaData).catch(err => {
    console.error(`[Supabase] Live snapshot failed for ${guildId}:`, err.message);
  });
}

/**
 * Broadcasts bot status and guild details to the dashboard.
 */
export const broadcastStats = () => {
  if (!client.isReady()) return;

  const guildsDetail = client.guilds.cache.map(g => {
    const full = getFullGuildConfig(g.id);
    return {
      id: g.id,
      name: g.name,
      icon: g.iconURL(),
      memberCount: g.memberCount,
      joined_at: g.joinedAt,
      ttsCount: getSessionTextsSpoken(g.id), // Use session-wide total
      cmdCount: getSessionCommands(g.id),    // Use session-wide total
      voiceChannelId: g.members.me?.voice?.channelId || null,
      voiceChannelName: g.members.me?.voice?.channel?.name || null,
      textChannelId: full.settings.textChannelId || null,
      textChannelName: client.channels.cache.get(full.settings.textChannelId)?.name || null,
      status: full.status || '待機中'
    };
  });

  const wsStatus = client.ws.status;
  const wsPing   = Math.round(client.ws.ping);
  const isOnline = client.isReady() && wsPing >= 0 && wsStatus === 0;

  const stats = {
    type: 'HEARTBEAT',
    status: isOnline ? 'online' : (wsStatus === 1 || wsStatus === 2 ? 'connecting' : 'offline'),
    guilds: client.guilds.cache.size,
    channels: client.channels.cache.size,
    ping: Math.round(client.ws.ping),
    uptime: client.uptime,
    websearchStatus: isMcpReady() ? 'online' : 'connecting',
    guildsDetail: guildsDetail,
    user: {
      username: client.user.username,
      avatar: client.user.displayAvatarURL(),
    },
    owner: {
      username: ownerUser?.username || 'Owner',
      avatar: ownerUser?.displayAvatarURL?.() || null,
      email: getBotConfig('OWNER_EMAIL') || 'Not set'
    }
  };
  console.log(`[SYS] [DASHBOARD_STATS] ${JSON.stringify(stats)}`);
};

// ── Background Maintenance (1-minute interval for time-based metrics) ────────
setInterval(async () => {
  if (!client.isReady()) return;

  for (const guildId of client.guilds.cache.keys()) {
    const guild = client.guilds.cache.get(guildId);
    const botMember = guild.members.me;
    
    // Voice Minutes Tracking
    if (botMember?.voice?.channelId) {
      // Check if there are other humans in the channel
      const channel = botMember.voice.channel;
      const humans = channel.members.filter(m => !m.user.bot);
      if (humans.size > 0) {
        incrementCounter(guildId, 'voice_minutes');
        emitLiveSnapshot(guildId, { voice_minutes: 1 });
      }
    }
  }
  broadcastStats();
  console.log('[SYS] Background maintenance tick (voice minutes updated).');
}, 1 * 60 * 1000);

// ── Message listener → TTS ───────────────────────────────────────────────────
client.on(Events.MessageCreate, async (message) => {
  console.log(`[TTS] [DEBUG] Message received from ${message.author.tag} in channel ${message.channel.id}`);
  // Ignore bots (including self)
  if (message.author.bot) return;
  if (!message.guild) return;

  // Block unauthorized guilds
  if (!isGuildAuthorized(message.guild.id)) {
    console.log(`[TTS] [DEBUG] Skipping: Guild ${message.guild.id} ("${message.guild.name}") is not authorized.`);
    return;
  }

  const cfg = getGuildConfig(message.guild.id);
  // console.log(`[TTS] [DEBUG] Config for ${message.guild.id}:`, JSON.stringify(cfg));

  if (cfg.karaokeMode) {
    console.log(`[TTS] [DEBUG] Skipping: Karaoke mode is active.`);
    return;
  }

  // Only process messages in the configured text channel
  if (!cfg.textChannelId) {
    console.log(`[TTS] [DEBUG] Skipping: No textChannelId configured for guild ${message.guild.id}. Use /setchannel.`);
    return;
  }
  if (message.channel.id !== cfg.textChannelId) {
    // Usually silent, but log if we suspect issues
    // console.log(`[TTS] [DEBUG] Skipping: Match failed. Found: ${message.channel.id}, Expected: ${cfg.textChannelId}`);
    return;
  }

  // Check for soundboard keywords first
  const sounds = cfg.customSounds || {};
  if (cfg.soundboardMode) {
    for (const [keyword, fileData] of Object.entries(sounds)) {
      if (message.content.includes(keyword)) {
        // fileData is either a legacy string absolute path, or the new `{ url, path }` shape
        const targetUrl = typeof fileData === 'string' ? fileData : fileData.url;
        enqueueFile(message.guild.id, targetUrl);
        return; // Stop processing TTS
      }
    }
  }

  // Build the text to read:
  // - Replace custom emojis with custom text if configured, otherwise strip
  // - Strip mention syntax (<@123>, <@!123>, <#123>, <@&123>)
  // - Strip URLs
  // - Collapse whitespace
  
  const customEmojis = cfg.customEmojis || {};

  let text = message.content
    .replace(/<a?:\w+:(\d+)>/g, (match, id) => customEmojis[id] || '')   // custom emoji
    .replace(/<[@#&!]\d+>/g, '')    // mentions
    .replace(/https?:\/\/\S+/g, 'URL') // URLs → "URL"
    .replace(emojiRegex(), (match) => {
      const entry = emojiDict[match];
      return entry ? entry.short_name : match;
    })
    .replace(/\s+/g, ' ')
    .trim();


  // Handle attachments/embeds with no text
  if (!text) {
    if (message.attachments.size > 0) text = '添付ファイル';
    else if (message.embeds.length > 0) text = 'リンク';
    else return; // nothing to say
  }

  // Prepend the author's display name if readName is not false
  const name = message.member?.displayName ?? message.author.username;
  let fullText = cfg.readName === false ? text : `${name}。${text}`;

  // Apply trim if configured
  if (cfg.trimWordCount && cfg.trimWordCount > 0 && text.length > cfg.trimWordCount) {
    const trimmedText = text.slice(0, cfg.trimWordCount) + '、以下略';
    fullText = cfg.readName === false ? trimmedText : `${name}。${trimmedText}`;
  }

    // Track TTS activity for analytics - only if bot is in a voice channel
    const botVoiceChannelId = message.guild.members.me?.voice?.channelId;
    if (botVoiceChannelId) {
      enqueue(message.guild.id, fullText, message.author.id, name);
      incrementCounter(message.guild.id, 'texts_spoken', message.author.id);
      
      // Immediate Reporting
      emitLiveSnapshot(message.guild.id, { texts_spoken: 1 });
      broadcastStats();

      // Log to Supabase and Console for Dashboard
      const logMsg = `[TTS] User: ${name}, Text: ${text.slice(0, 100)}${text.length > 100 ? '...' : ''}`;
      console.log(`[G:${message.guild.id}] ${logMsg}`);
      logToSupabase(message.guild.id, 'tts', logMsg);
    } else {
    console.log(`[TTS] [DEBUG] Skipping: Bot is not in a voice channel in guild ${message.guild.id}.`);
  }
});

// ── Voice State Update (Auto-disconnect & Announcements) ──────────────────────
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  const guildId = oldState.guild.id;
  const botChannelId = oldState.guild.members.cache.get(client.user.id)?.voice.channelId;

  // Auto-disconnect logic
  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    const channel = oldState.channel;
    if (channel && channel.id === botChannelId) {
      const humanMembers = channel.members.filter(m => !m.user.bot);
      if (humanMembers.size === 0) {
        console.log(`[G:${guildId}] [SYS] No humans left in #${channel.name}. Recording last user ${oldState.member?.user.tag} and disconnecting.`);
        leaveChannel(guildId);
        // Record last user but KEEP channel ID for potential return
        setGuildConfig(guildId, { lastUserId: oldState.member?.id });
      }
    }
  }

  // Voice Chat Announcements logic
  const isBot = newState.member?.user.bot || oldState.member?.user.bot;
  const botMember = oldState.guild.members.me;

  // Log voice state changes for bot
  if (newState.member?.id === client.user.id) {
    if (!oldState.channelId && newState.channelId) {
      const logMsg = `[SYS] Joined voice channel: ${newState.channel.name}`;
      console.log(`[G:${guildId}] ${logMsg}`);
      logToSupabase(guildId, 'sys', logMsg);
    } else if (oldState.channelId && !newState.channelId) {
      const logMsg = `[SYS] Left voice channel: ${oldState.channel.name}`;
      console.log(`[G:${guildId}] ${logMsg}`);
      logToSupabase(guildId, 'sys', logMsg);
    } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
      const logMsg = `[SYS] Moved voice channel: ${oldState.channel.name} -> ${newState.channel.name}`;
      console.log(`[G:${guildId}] ${logMsg}`);
      logToSupabase(guildId, 'sys', logMsg);
    }
  }

  // Log voice state changes for users (if in same channel)
  if (!isBot && botChannelId) {
    const displayName = newState.member?.displayName || oldState.member?.displayName;
    if (newState.channelId === botChannelId && oldState.channelId !== botChannelId) {
      const logMsg = `[VOICE] User joined: ${displayName}`;
      console.log(`[G:${guildId}] ${logMsg}`);
      logToSupabase(guildId, 'sys', logMsg);
      
      if (getGuildConfig(guildId).announceVoice && !getGuildConfig(guildId).karaokeMode) {
        enqueue(guildId, `${displayName}さんが入室したのだ`, newState.member?.id, displayName);
      }
    } else if (oldState.channelId === botChannelId && newState.channelId !== botChannelId) {
      const logMsg = `[VOICE] User left: ${displayName}`;
      console.log(`[G:${guildId}] ${logMsg}`);
      logToSupabase(guildId, 'sys', logMsg);

      if (getGuildConfig(guildId).announceVoice && !getGuildConfig(guildId).karaokeMode) {
        enqueue(guildId, `${displayName}さんが退室したのだ`, oldState.member?.id, displayName);
      }
    }
  }
});

// ── Graceful Shutdown ─────────────────────────────────────────────────────────
function shutdown() {
  console.log('\n🛑 終了シグナルを受信しました。すべてのボイスチャンネルから退出します...');
  leaveAllChannels();
  client.destroy();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Listen for custom IPC shutdown from dashboard (for Windows graceful exit)
process.stdin.setEncoding('utf8');
// ── Member/Role Cache for Dashboard ──────────────────────────────────────────
const memberRoleCache = new Map(); // guildId -> { members, roles, timestamp }
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

process.stdin.on('data', async (data) => {
  const msg = data.trim();
  if (msg === 'SHUTDOWN') {
    shutdown();
  }
  if (msg.startsWith('SYNC_CONFIG:')) {
    const guildId = msg.split(':')[1];
    await refreshConfig(guildId).catch(console.error);
  }
  if (msg.startsWith('LEAVE_GUILD:')) {
    const guildId = msg.split(':')[1];
    const guild = client.guilds.cache.get(guildId);
    if (guild) {
      leaveChannel(guildId);
      guild.leave().then(() => {
        console.log(`[SYS] Left guild ${guild.name} (${guildId}) via dashboard command.`);
      }).catch(err => {
        console.error(`[SYS] Failed to leave guild ${guildId}:`, err.message);
      });
    } else {
      console.warn(`[SYS] LEAVE_GUILD: Guild ${guildId} not found in cache.`);
    }
  }
  if (msg.startsWith('RESOLVE_METADATA:')) {
    const [_, guildId, idList] = msg.split(':');
    const ids = idList ? idList.split(',') : [];
    const guild = client.guilds.cache.get(guildId);
    if (guild) {
      (async () => {
        const results = {};
        for (const id of ids) {
          // Check Roles
          const role = guild.roles.cache.get(id);
          if (role) {
            results[id] = { type: 'role', name: role.name, color: role.hexColor };
            continue;
          }
          // Check Channels
          const channel = guild.channels.cache.get(id);
          if (channel) {
             results[id] = { type: 'channel', name: channel.name };
             continue;
          }
          // Check Members
          try {
            const member = await guild.members.fetch(id).catch(() => null);
            if (member) {
              results[id] = { type: 'user', name: member.displayName, avatar: member.user.displayAvatarURL() };
            }
          } catch (e) {}
        }
        console.log(`[SYS] [METADATA] ${JSON.stringify({ guildId, results })}`);
      })();
    }
  }
  if (msg.startsWith('LIST_MEMBERS_ROLES:')) {
    const guildId = msg.split(':')[1];
    const guild = client.guilds.cache.get(guildId);
    if (guild) {
      (async () => {
        try {
          const now = Date.now();
          const cached = memberRoleCache.get(guildId);
          if (cached && (now - cached.timestamp < CACHE_DURATION)) {
            console.log(`[SYS] Using cached members/roles for ${guild.name}`);
            console.log(`[SYS] [MEMBERS_ROLES] ${JSON.stringify({ guildId, members: cached.members, roles: cached.roles })}`);
            return;
          }

          console.log(`[SYS] Fetching members for ${guild.name} (Rate limit protection active)...`);
          await guild.members.fetch();
          const members = guild.members.cache
            .filter(m => !m.user.bot)
            .map(m => ({ id: m.id, name: m.displayName, avatar: m.user.displayAvatarURL({ size: 64 }) }))
            .slice(0, 200);
          const roles = guild.roles.cache
            .filter(r => r.id !== guild.id)
            .sort((a, b) => b.position - a.position)
            .map(r => ({ id: r.id, name: r.name, color: r.hexColor }))
            .slice(0, 100);
          
          memberRoleCache.set(guildId, { members, roles, timestamp: now });
          console.log(`[SYS] [MEMBERS_ROLES] ${JSON.stringify({ guildId, members, roles })}`);
        } catch (e) {
          console.error(`[SYS] Failed to fetch members/roles for ${guildId}:`, e.message);
          // Fallback to cache if available
          const cached = memberRoleCache.get(guildId);
          if (cached) {
            console.log(`[SYS] [MEMBERS_ROLES] ${JSON.stringify({ guildId, members: cached.members, roles: cached.roles })}`);
          }
        }
      })();
    } else {
      console.warn(`[SYS] LIST_MEMBERS_ROLES: Guild ${guildId} not found in cache.`);
    }
  }
  if (msg.startsWith('LIST_CHANNELS:')) {
    const guildId = msg.split(':')[1];
    const guild = client.guilds.cache.get(guildId);
    if (guild) {
      const channels = guild.channels.cache
        .filter(c => c.isTextBased())
        .map(c => ({ id: c.id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      console.log(`[SYS] [CHANNELS] ${JSON.stringify({ guildId, channels })}`);
    } else {
      console.warn(`[SYS] LIST_CHANNELS: Guild ${guildId} not found in cache.`);
    }
  }
});

// ── Start (Fallback Login) ───────────────────────────────────────────────────
configPromise.then(() => {
  const token = getBotConfig('DISCORD_TOKEN') || envToken;
  if (!loginStarted && token) {
    tryLogin(token);
  } else if (!loginStarted && !token) {
    console.error('❌ DISCORD_TOKEN が見つかりません。プログラムを終了します。');
    process.exit(1);
  }
});
