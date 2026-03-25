// src/index.js
// Main entry point for the Zundamon Discord TTS bot

import 'dotenv/config';
import { Client, GatewayIntentBits, Events, REST, Routes, MessageFlags, Partials } from 'discord.js';
import { commandDefinitions, handleCommand, startCleanChatTimer } from './commands.js';
import { enqueue, leaveChannel, leaveAllChannels, enqueueFile, joinChannel } from './player.js';
import { getGuildConfig, setGuildConfig, initConfigs, getFullGuildConfig, refreshConfig } from './config.js';
import { initMcpClient } from './mcpClient.js';
import { isGuildAuthorized, sendLocalOtp, verifyLocalOtp } from './auth.js';
import { initGuildTable, snapshotGuildAnalytics, logToSupabase, deleteGuildConfigFromDb } from './db_supabase.js';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import emojiRegex from 'emoji-regex';

// ── Per-guild activity counters (reset every hourly snapshot) ─────────────────
// Map<guildId, { texts_spoken, ai_queries, voice_minutes, errors, members_active, commands_used }>
const guildCounters = new Map();

// Tracks session-wide total commands per guild
const sessionCommands = new Map();

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
  if (field === 'texts_spoken') c.texts_spoken++;
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const emojiDictPath = path.join(__dirname, 'emoji_ja.json');
const emojiDict = JSON.parse(fs.readFileSync(emojiDictPath, 'utf8'));
const customEmojisPath = path.join(__dirname, '..', 'custom_emojis.json');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token) {
  console.error('❌ DISCORD_TOKEN が設定されていません。.env を確認してください。');
  process.exit(1);
}

// ── Register slash commands on startup ────────────────────────────────────────
if (clientId) {
  const rest = new REST({ version: '10' }).setToken(token);
  rest
    .put(Routes.applicationCommands(clientId), { body: commandDefinitions })
    .then(() => console.log('✅ スラッシュコマンドを登録しました。'))
    .catch((err) => console.warn('⚠️ コマンド登録失敗:', err.message));
} else {
  console.warn(
    '⚠️ CLIENT_ID が未設定です。スラッシュコマンドは登録されません。\n' +
    '   deploy-commands.js を先に実行してください。'
  );
}

// ── Create Discord client ─────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent, // Privileged intent — enable in Dev Portal!
    GatewayIntentBits.DirectMessages,  // For 2FA auth code DMs
  ],
  partials: [Partials.Channel, Partials.Message], // Required for DM events (Message partial is critical)
});

// ── Ready ─────────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, async (c) => {
  console.log(`✅ ログイン成功: ${c.user.tag}`);
  console.log(`   VOICEVOX: ${process.env.VOICEVOX_URL || 'http://localhost:50021'}`);
  console.log(`   スピーカー ID: ${process.env.VOICEVOX_SPEAKER || '3'} (ずんだもん)`);

  // Initialize configs from Supabase
  const guildIds = client.guilds.cache.map(g => g.id);
  await initConfigs(guildIds);

  // Resume clean chat intervals natively upon boot
  // Resume clean chat intervals natively upon boot
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

  // Auto-rejoin last voice channel
  for (const guildId of guildIds) {
    const cfg = getGuildConfig(guildId);
    if (cfg.voiceChannelId) {
      const channel = client.channels.cache.get(cfg.voiceChannelId);
      if (channel && channel.isVoiceBased()) {
        const humans = channel.members.filter(m => !m.user.bot);
        if (humans.size === 0) {
          console.log(`[SYS] Skipping auto-rejoin for empty channel: ${channel.name} (${guildId})`);
          continue;
        }
        try {
          await joinChannel(channel);
          console.log(`[SYS] Auto-rejoined voice channel: ${channel.name} (${guildId})`);
        } catch (err) {
          console.error(`[SYS] Auto-rejoin failed for ${guildId}:`, err.message);
        }
      }
    }
  }

  // Restart 2FA Flow for any unauthorized guilds found during startup
  const ownerId = process.env.OWNER_DISCORD_ID;
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

  // Periodically log stats and sync heartbeats to Supabase
  setInterval(() => {
    const guildsDetail = client.guilds.cache.map(g => {
      const full = getFullGuildConfig(g.id);
      return {
        id: g.id,
        name: g.name,
        icon: g.iconURL(),
        memberCount: g.memberCount,
        joined_at: g.joinedAt,
        sessionCommands: sessionCommands.get(g.id) || 0,
        voiceChannelId: g.members.me?.voice?.channelId || null,
        textChannelId: full.settings.textChannelId || null,
        status: full.status || 'Idle'
      };
    });

    const stats = {
      type: 'HEARTBEAT',
      guilds: client.guilds.cache.size,
      channels: client.channels.cache.size,
      ping: Math.round(client.ws.ping),
      uptime: client.uptime,
      guildsDetail: guildsDetail,
      user: {
        username: client.user.username,
        avatar: client.user.displayAvatarURL(),
      }
    };
    console.log(`[SYS] [DASHBOARD_STATS] ${JSON.stringify(stats)}`);
  }, 5000);
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

  const ownerId = process.env.OWNER_DISCORD_ID;
  if (!ownerId) {
    console.warn('[2FA] OWNER_DISCORD_ID not set in .env — cannot send auth DM.');
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

  const ownerId = process.env.OWNER_DISCORD_ID;
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

// ── 1-minute analytics snapshot ──────────────────────────────────────────────
setInterval(async () => {
  for (const guildId of client.guilds.cache.keys()) {
    const c = getGuildCounters(guildId);
    
    // Only log if there was actual activity in this minute
    const hasActivity = 
      c.texts_spoken > 0 || 
      c.ai_queries > 0 || 
      c.voice_minutes > 0 || 
      c.errors > 0 || 
      c.members_active.size > 0 || 
      Object.keys(c.commands_used).length > 0;

    if (hasActivity) {
      await snapshotGuildAnalytics(guildId, {
        texts_spoken:   c.texts_spoken,
        ai_queries:     c.ai_queries,
        voice_minutes:  c.voice_minutes,
        errors:         c.errors,
        members_active: c.members_active.size,
        commands_used:  c.commands_used,
      });
    }

    // Reset counters after snapshot (or if skipping to ensure they stay 0)
    guildCounters.set(guildId, {
      texts_spoken: 0, ai_queries: 0, voice_minutes: 0, errors: 0,
      members_active: new Set(), commands_used: {},
    });
  }
  console.log('[SYS] 1-minute guild analytics snapshot evaluated.');
}, 1 * 60 * 1000); // every 1 minute

// ── Message listener → TTS ───────────────────────────────────────────────────
client.on(Events.MessageCreate, async (message) => {
  // Ignore bots (including self)
  if (message.author.bot) return;
  if (!message.guild) return;

  // Block unauthorized guilds
  if (!isGuildAuthorized(message.guild.id)) return;

  const cfg = getGuildConfig(message.guild.id);

  if (cfg.karaokeMode) return;

  // Only process messages in the configured text channel
  if (!cfg.textChannelId || message.channel.id !== cfg.textChannelId) return;

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

  // Apply User Dictionary (whisperDict) replacements
  const userDict = cfg.whisperDict || {};
  for (const [wrong, correct] of Object.entries(userDict)) {
    // Escape special regex chars in the "wrong" word to prevent crashes
    const escaped = wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(escaped, 'g'), correct);
  }

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

  enqueue(message.guild.id, fullText, message.author.id);
  // Track TTS activity for analytics
  incrementCounter(message.guild.id, 'texts_spoken', message.author.id);
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
        leaveChannel(guildId);
        setGuildConfig(guildId, { voiceChannelId: null });
      }
    }
  }

  // Voice Chat Announcements logic
  const isBot = newState.member?.user.bot || oldState.member?.user.bot;
  if (!isBot && botChannelId && getGuildConfig(guildId).announceVoice && !getGuildConfig(guildId).karaokeMode) {
    const displayName = newState.member?.displayName || oldState.member?.displayName;
    if (displayName) {
      // User joined the bot's channel
      if (newState.channelId === botChannelId && oldState.channelId !== botChannelId) {
        enqueue(guildId, `${displayName}さんが入室したのだ`);
      }
      // User left the bot's channel
      else if (oldState.channelId === botChannelId && newState.channelId !== botChannelId) {
        enqueue(guildId, `${displayName}さんが退室したのだ`);
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
process.stdin.on('data', (data) => {
  const msg = data.trim();
  if (msg === 'SHUTDOWN') {
    shutdown();
  }
  if (msg.startsWith('SYNC_CONFIG:')) {
    const guildId = msg.split(':')[1];
    refreshConfig(guildId);
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
});

// ── Start ─────────────────────────────────────────────────────────────────────
client.login(token);
