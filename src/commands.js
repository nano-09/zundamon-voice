// src/commands.js
// Defines all slash command handlers

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { joinChannel, leaveChannel, isConnected, enqueue, pauseMusic, skipMusic, enqueueMusic, getQueue, setLoopMode, subscribeToMusic, getNowPlayingMessageId } from './player.js';
import { getGuildConfig, setGuildConfig, updateGuildMeta, getFullGuildConfig } from './config.js';
import { isGuildAuthorized, isGuildBlocked, isBotLocked } from './auth.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import axios from 'axios';
import ytExec from 'youtube-dl-exec';
import ytSearch from 'yt-search';
import supabase, { logToSupabase, getUserPresets, saveUserPreset, deleteUserPreset } from './db_supabase.js';
import { incrementCommand, incrementCounter } from './stats.js';
import { DEFAULT_PERMISSIONS } from './constants.js';
import { fetchLyrics } from './lyrics_utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SOUNDS_DIR = path.join(__dirname, '..', 'sounds');

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName('vc')
    .setDescription('ボイスチャンネルへの参加・退出・移動を切り替えるのだ'),

  new SlashCommandBuilder()
    .setName('set')
    .setDescription('あなた個人の声の設定（話者、速度、ピッチ、音量）を変更するのだ')
    .addSubcommand(sub => sub.setName('voice').setDescription('話者（ボイスID）を設定するのだ').addIntegerOption(opt => opt.setName('voiceid').setDescription('話者名を選択してください').setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub => sub.setName('speed').setDescription('速度を設定するのだ').addNumberOption(opt => opt.setName('value').setDescription('速度 (標準: 1.0)').setRequired(true)))
    .addSubcommand(sub => sub.setName('pitch').setDescription('ピッチを設定するのだ').addNumberOption(opt => opt.setName('value').setDescription('ピッチ (標準: 0.0)').setRequired(true)))
    .addSubcommand(sub => sub.setName('volume').setDescription('音量を設定するのだ').addNumberOption(opt => opt.setName('value').setDescription('音量 (標準: 1.0)').setRequired(true))),

  new SlashCommandBuilder()
    .setName('preset')
    .setDescription('あなたの声の設定（話者、速度、ピッチ、音量）を保存・読み込みするのだ')
    .addSubcommand(sub => sub.setName('save').setDescription('現在の声の設定をプリセットとして保存するのだ').addStringOption(opt => opt.setName('name').setDescription('プリセット名').setRequired(true)))
    .addSubcommand(sub => sub.setName('load').setDescription('保存したプリセットを読み込むのだ').addStringOption(opt => opt.setName('name').setDescription('プリセット名').setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub => sub.setName('list').setDescription('保存されているプリセット一覧を表示するのだ')),

  new SlashCommandBuilder()
    .setName('setchannel')
    .setDescription('読み上げるテキストチャンネルを設定します')
    .addChannelOption((opt) =>
      opt
        .setName('channel')
        .setDescription('読み上げ対象のテキストチャンネル')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('serverstatus')
    .setDescription('サーバーの設定と接続状態を表示します'),

  new SlashCommandBuilder()
    .setName('soundboard')
    .setDescription('サウンドボードモード（キーワードに反応してSEを再生）を切り替えます')
    .addBooleanOption((opt) => opt.setName('enabled').setDescription('有効にする (True) または 無効にする (False)').setRequired(true)),

  new SlashCommandBuilder()
    .setName('mystatus')
    .setDescription('あなた個人の声の設定を表示します'),

  new SlashCommandBuilder()
    .setName('play')
    .setDescription('YouTubeから音楽を再生します（キーワード検索対応、カラオケモード中のみ）')
    .addStringOption((opt) => opt.setName('query').setDescription('YouTubeのURLまたは検索ワード').setRequired(true)),

  new SlashCommandBuilder()
    .setName('pause')
    .setDescription('再生中の音楽を一時停止または再開します'),

  new SlashCommandBuilder()
    .setName('skip')
    .setDescription('現在の曲をスキップします'),

  new SlashCommandBuilder()
    .setName('queue')
    .setDescription('現在の再生キューを表示します'),

  new SlashCommandBuilder()
    .setName('lyrics')
    .setDescription('現在再生中の曲の歌詞を表示します'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('ボットのコマンド一覧と使い方を表示します'),



  new SlashCommandBuilder()
    .setName('readname')
    .setDescription('発言者の名前を読み上げるかどうかを設定します')
    .addBooleanOption((opt) =>
      opt
        .setName('enabled')
        .setDescription('名前を読み上げる (True) または 読み上げない (False)')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('ボイスチャンネルの入退室を読み上げるかどうかを設定します')
    .addBooleanOption((opt) =>
      opt
        .setName('enabled')
        .setDescription('入退室を読み上げる (True) または 読み上げない (False)')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('cleanchat')
    .setDescription('チャンネルのボットメッセージを定期的に自動削除します')
    .addIntegerOption((opt) =>
      opt
        .setName('minutes')
        .setDescription('何分ごとに削除するか（0 = 無効化）')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('trim')
    .setDescription('読み上げる最大文字数を設定します（超過分は「以下略」で省略）')
    .addIntegerOption((opt) =>
      opt
        .setName('wordcount')
        .setDescription('最大文字数（0 = 無効化）')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('permissions')
    .setDescription('コマンドのロール権限を管理します（サーバーオーナー専用）')
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('コマンドへのロール権限を設定します')
        .addStringOption((opt) => opt.setName('command').setDescription('対象コマンド名').setRequired(true).setAutocomplete(true))
        .addMentionableOption((opt) => opt.setName('target').setDescription('対象のユーザーまたはロール').setRequired(true))
        .addStringOption((opt) =>
          opt
            .setName('action')
            .setDescription('許可 (allow) または 拒否 (deny)')
            .setRequired(true)
            .addChoices(
              { name: 'allow（許可）', value: 'allow' },
              { name: 'deny（拒否）', value: 'deny' }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('list')
        .setDescription('現在の権限ルール一覧を表示します')
    )
    .addSubcommand((sub) =>
      sub
        .setName('reset')
        .setDescription('指定コマンドの権限ルールをリセットします')
        .addStringOption((opt) => opt.setName('command').setDescription('対象コマンド名').setRequired(true).setAutocomplete(true))
    ),

  new SlashCommandBuilder()
    .setName('musicvolume')
    .setDescription('カラオケモード(音楽)の音量を設定します')
    .addNumberOption((opt) => opt.setName('volume').setDescription('音量 (例: 0.5で半分、1.0で標準)').setRequired(true)),

  new SlashCommandBuilder()
    .setName('set-server')
    .setDescription('サーバー全体のデフォルトの声設定（話者、速度、ピッチ、音量）を変更するのだ')
    .addSubcommand(sub => sub.setName('voice').setDescription('デフォルト話者を設定するのだ').addIntegerOption(opt => opt.setName('voiceid').setDescription('話者名を選択してください').setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub => sub.setName('speed').setDescription('デフォルト速度を設定するのだ').addNumberOption(opt => opt.setName('value').setDescription('速度').setRequired(true)))
    .addSubcommand(sub => sub.setName('pitch').setDescription('デフォルトピッチを設定するのだ').addNumberOption(opt => opt.setName('value').setDescription('ピッチ').setRequired(true)))
    .addSubcommand(sub => sub.setName('volume').setDescription('デフォルト音量を設定するのだ').addNumberOption(opt => opt.setName('value').setDescription('音量').setRequired(true))),

  new SlashCommandBuilder()
    .setName('customsound')
    .setDescription('サーバー専用のサウンドボード音源を管理します')
    .addSubcommand((sub) => sub.setName('add').setDescription('音源を追加します')
      .addStringOption(opt => opt.setName('keyword').setDescription('反応するキーワード').setRequired(true))
      .addAttachmentOption(opt => opt.setName('file').setDescription('音声ファイル (mp3/wav)').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('音源を削除します')
      .addStringOption(opt => opt.setName('keyword').setDescription('削除するキーワード').setRequired(true)))
    .addSubcommand((sub) => sub.setName('list').setDescription('登録されている音源一覧を表示します')),

  new SlashCommandBuilder()
    .setName('customemoji')
    .setDescription('サーバー専用の絵文字読み上げ辞書を管理します')
    .addSubcommand((sub) => sub.setName('add').setDescription('絵文字の読み方を登録します')
      .addStringOption(opt => opt.setName('emoji').setDescription('Discordの絵文字 (例: <:zunda:123>)').setRequired(true))
      .addStringOption(opt => opt.setName('readtext').setDescription('読み上げるテキスト').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('絵文字の読み方を削除します')
      .addStringOption(opt => opt.setName('emoji').setDescription('削除する絵文字').setRequired(true)))
    .addSubcommand((sub) => sub.setName('list').setDescription('登録されている絵文字一覧を表示します')),

  new SlashCommandBuilder()
    .setName('loop')
    .setDescription('音楽のループ再生を設定します')
    .addStringOption((opt) =>
      opt.setName('mode')
        .setDescription('ループモードを選択')
        .setRequired(true)
        .addChoices(
          { name: 'オフ (Off)', value: 'off' },
          { name: '1曲リピート (Track)', value: 'track' },
          { name: '全曲リピート (Queue)', value: 'queue' }
        )
    ),
].map((cmd) => cmd.toJSON());

/**
 * Active auto-clean timers per guild+channel
 * Key: `${guildId}-${channelId}`, Value: intervalId
 */
const cleanTimers = new Map();

// List of all command names for permission validation
const ALL_COMMAND_NAMES = [
  'vc', 'set', 'set voice', 'set speed', 'set pitch', 'set volume',
  'setchannel', 'soundboard', 'serverstatus', 'mystatus', 'help',
  'readname', 'announce', 'cleanchat', 'trim', 'permissions',
  'play', 'pause', 'skip', 'queue', 'lyrics', 'musicvolume',
  'set-server', 'set-server voice', 'set-server speed', 'set-server pitch', 'set-server volume',
  'customsound add', 'customsound remove', 'customsound list',
  'customemoji add', 'customemoji remove', 'customemoji list', 'loop',
  'preset', 'preset save', 'preset load', 'preset list'
];

const VOICES_LIST = [
  { name: 'ずんだもん (あまあま)', value: 1 },
  { name: 'ずんだもん (ノーマル)', value: 3 },
  { name: 'ずんだもん (セクシー)', value: 5 },
  { name: 'ずんだもん (ツンツン)', value: 7 },
  { name: '四国めたん (あまあま)', value: 2 },
  { name: '四国めたん (ノーマル)', value: 4 },
  { name: '四国めたん (セクシー)', value: 6 },
  { name: '四国めたん (ツンツン)', value: 8 },
  { name: '雨晴はう (ノーマル)', value: 10 },
  { name: '青山龍星 (ノーマル)', value: 13 },
  { name: '冥鳴ひまり (ノーマル)', value: 14 },
  { name: '九州そら (あまあま)', value: 16 }
];

export async function handleAutocomplete(interaction) {
  const focusedOption = interaction.options.getFocused(true);

  if (interaction.commandName === 'set' || interaction.commandName === 'set-server' || (interaction.commandName === 'preset' && focusedOption.name === 'name')) {
    if (focusedOption.name === 'voiceid') {
      const q = String(focusedOption.value).toLowerCase();
      const filtered = VOICES_LIST.filter(v => v.name.includes(q)).slice(0, 25);
      await interaction.respond(filtered);
    } else if (focusedOption.name === 'name') {
      try {
        const userId = interaction.user.id;
        const presets = await getUserPresets(userId);
        const q = String(focusedOption.value).toLowerCase();
        const filtered = presets
          .filter(p => p.name.toLowerCase().includes(q))
          .slice(0, 25)
          .map(p => ({ name: p.name, value: p.name }));
        await interaction.respond(filtered);
      } catch (e) {
        await interaction.respond([]);
      }
    }
  } else if (interaction.commandName === 'permissions') {
    if (focusedOption.name === 'command') {
      const q = focusedOption.value.toLowerCase();
      const filtered = ALL_COMMAND_NAMES.filter(c => c.startsWith(q) || c.includes(q)).slice(0, 25);
      await interaction.respond(filtered.map(c => ({ name: c, value: c })));
    }
  }
}

/**
 * Checks if a member has permission to use a command based on guild permission rules.
 * @param {string} guildId
 * @param {string} commandPath
 * @param {import('discord.js').GuildMember} member
 * @param {string} [channelId]
 * @returns {boolean}
 */
function checkPermission(guildId, commandPath, member, channelId) {
  // Server owner always has access
  if (member.id === member.guild.ownerId) return true;

  const fullCfg = getFullGuildConfig(guildId);
  const perms = fullCfg.permissions;

  if (!perms) {
    if (commandPath.startsWith('permissions')) return false;
    return true;
  }

  const checkRules = (cmd) => {
    if (!perms[cmd] || Object.keys(perms[cmd]).length === 0) return null;
    const rules = perms[cmd];

    // 1. User specific rule overrides everything
    if (rules[member.id]) {
      console.log(`[SYS] [Permission] Found user override for ${member.user.tag}: ${rules[member.id]}`);
      return rules[member.id] === 'allow';
    }

    // 1.5 Channel specific rule
    if (channelId && rules[channelId]) {
      console.log(`[SYS] [Permission] Found channel override for #${channelId}: ${rules[channelId]}`);
      return rules[channelId] === 'allow';
    }

    // 2. Role specific rules (excluding @everyone / guildId)
    const roleIds = member.roles.cache.map(r => r.id).filter(id => id !== guildId);
    let hasRoleAllow = false;
    let hasRoleDeny = false;

    for (const rid of roleIds) {
      if (rules[rid] === 'allow') hasRoleAllow = true;
      if (rules[rid] === 'deny') hasRoleDeny = true;
    }

    if (hasRoleDeny) {
      console.log(`[SYS] [Permission] Found role DENY for ${member.user.tag}`);
      return false;
    }
    if (hasRoleAllow) {
      console.log(`[SYS] [Permission] Found role ALLOW for ${member.user.tag}`);
      return true;
    }

    // 3. @everyone rule
    if (rules[guildId]) {
      console.log(`[SYS] [Permission] Found @everyone override: ${rules[guildId]}`);
      return rules[guildId] === 'allow';
    }

    // 4. Default implicit logic
    const hasAnyAllow = Object.values(rules).some(v => v === 'allow');
    if (hasAnyAllow) {
      console.log(`[SYS] [Permission] Implicit DENY (whitelist mode active) for ${member.user.tag}`);
      return false;
    }

    return true;
  };

  const specificResult = checkRules(commandPath);
  if (specificResult !== null) return specificResult;

  if (commandPath.includes(' ')) {
    const baseCmd = commandPath.split(' ')[0];
    const baseResult = checkRules(baseCmd);
    if (baseResult !== null) return baseResult;
  }

  if (commandPath.startsWith('permissions')) return false;

  return true;
}

/**
 * Extracts YouTube Video ID from various URL formats.
 * @param {string} url
 * @returns {string|null}
 */
function getYouTubeId(url) {
  if (!url) return null;
  const match = url.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/\n\s]+\/\S+\/|(?:v|e(?:mbed)?)\/|\S*?[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

/**
 * Handles an incoming slash command interaction.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function handleCommand(interaction) {
  const { commandName, guild, member } = interaction;

  if (!guild) {
    return interaction.reply({
      content: 'このコマンドはサーバー内でのみ使用できるのだ。',
      flags: [MessageFlags.Ephemeral],
    });
  }

  // ── Pre-process command path for logging ────────────────────
  let fullCommandPath = commandName;
  try {
    const subcommand = interaction.options.getSubcommand(false);
    if (subcommand) fullCommandPath = `${commandName} ${subcommand}`;
  } catch (e) { }

  // ── Global Bot Lock check ──────────────────────────────────
  if (isBotLocked()) {
    return interaction.reply({
      content: '🔓 ボットは現在、保守またはオーナーによる操作のため **グローバルロック** されているのだ。解除されるまでお待ちくださいなのだ。',
      flags: [MessageFlags.Ephemeral],
    });
  }

  // ── 2FA Auth check ──────────────────────────────────────────
  if (!isGuildAuthorized(guild.id)) {
    logToSupabase(guild.id, 'cmd', `[CMD] User: ${interaction.user.username}, Command: /${fullCommandPath}, Status: Denied (Unauthorized/2FA)`);
    return interaction.reply({
      content: '⛔ このサーバーは認証されていないのだ。ボットオーナーに認証を依頼してほしいのだ！',
      flags: [MessageFlags.Ephemeral],
    });
  }

  // ── Blocked check ──────────────────────────────────────────
  if (isGuildBlocked(guild.id)) {
    logToSupabase(guild.id, 'cmd', `[CMD] User: ${interaction.user.username}, Command: /${fullCommandPath}, Status: Denied (Blocked)`);
    return interaction.reply({
      content: '🚫 このサーバーはボットオーナーによってブロックされているのだ。コマンドは使用できないのだ。',
      flags: [MessageFlags.Ephemeral],
    });
  }

  // ── Permission check ────────────────────────────────────────
  if (!checkPermission(guild.id, fullCommandPath, member, interaction.channelId)) {
    logToSupabase(guild.id, 'cmd', `[CMD] User: ${interaction.user.username}, Command: /${fullCommandPath}, Status: Denied (No Permission)`);
    return interaction.reply({
      content: '🚫 あなたのユーザー、現在のチャンネル、またはロールではこのコマンドを使用する権限がないのだ。',
      flags: [MessageFlags.Ephemeral],
    });
  }

  // ── Analytics Tracking ────────────────────────────────────────
  const { emitLiveSnapshot, broadcastStats } = await import('./index.js');
  incrementCommand(guild.id, fullCommandPath);
  
  // Immediate Reporting
  emitLiveSnapshot(guild.id, { commands_used: { [fullCommandPath]: 1 } });
  broadcastStats();

  console.log(`[G:${guild.id}] [CMD] Command: /${fullCommandPath} (User: ${interaction.user.username})`);
  const logMsg = `[CMD] User: ${interaction.user.username}, Command: /${fullCommandPath}, Status: Success`;
  logToSupabase(guild.id, 'cmd', logMsg);

  // ── /vc (Join/Leave/Move Toggle) ────────────────────────────────
  if (commandName === 'vc') {
    const voiceChannel = member?.voice?.channel;
    if (!voiceChannel) {
      logToSupabase(guild.id, 'cmd', `[CMD] User: ${interaction.user.username}, Command: /${fullCommandPath}, Status: Failed (Not in VC)`);
      return interaction.reply({
        content: '❌ まずボイスチャンネルに参加してほしいのだ！',
        flags: [MessageFlags.Ephemeral],
      });
    }

    const currentChannel = guild.members.me.voice.channel;

    if (currentChannel && currentChannel.id === voiceChannel.id) {
      // Leave
      leaveChannel(guild.id);
      setGuildConfig(guild.id, { voiceChannelId: null, lastUserId: null });
      console.log(`[G:${guild.id}] [SYS] Left voice channel: ${currentChannel.name}`);
      logToSupabase(guild.id, 'sys', `Left voice channel: ${currentChannel.name}`);
      const embed = new EmbedBuilder()
        .setColor('#FF8A80') // Light Red/Pinkish for leaving
        .setTitle('退出しました')
        .setDescription(`❌ **${currentChannel.name}** から退出したのだ！`)
        .setTimestamp();
      return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
    } else {
      // Join or Move
      try {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      } catch (err) {
        console.warn('⚠️ [vc] Interaction timeout:', err.message);
        return;
      }

      try {
        await joinChannel(voiceChannel);
        setGuildConfig(guild.id, { voiceChannelId: voiceChannel.id });
        console.log(`[G:${guild.id}] [SYS] Joined voice channel: ${voiceChannel.name}`);
        logToSupabase(guild.id, 'sys', `Joined voice channel: ${voiceChannel.name}`);

        const actionText = currentChannel ? '移動しました' : '接続しました';
        const embed = new EmbedBuilder()
          .setColor('#A5D6A7')
          .setTitle(actionText)
          .setDescription(`🔊 **${voiceChannel.name}** に${currentChannel ? '移動' : '接続'}したのだ！`)
          .setTimestamp();

        await interaction.editReply({ embeds: [embed] });
      } catch (err) {
        console.error('[vc]', err);
        await interaction.editReply('❌ ボイスチャンネルへの参加に失敗したのだ。');
      }
    }
    return;
  }

  // ── /set ──────────────────────────────────────────────────
  if (commandName === 'set') {
    const sub = interaction.options.getSubcommand();
    const cfg = getFullGuildConfig(guild.id).settings;
    const userId = interaction.user.id;

    if (sub === 'voice') {
      const voiceId = interaction.options.getInteger('voiceid');
      const userVoices = cfg.userVoices || {};
      userVoices[userId] = voiceId;
      setGuildConfig(guild.id, { userVoices });
      return interaction.reply({ content: `✅ あなたの声を話者ID **${voiceId}** に設定したのだ！`, flags: [MessageFlags.Ephemeral] });
    }

    // speed, pitch, volume
    const value = interaction.options.getNumber('value');
    const userParams = cfg.userParams || {};
    const myParams = userParams[userId] || {};

    if (sub === 'speed') myParams.speed = value;
    if (sub === 'pitch') myParams.pitch = value;
    if (sub === 'volume') myParams.volume = value;

    userParams[userId] = myParams;
    setGuildConfig(guild.id, { userParams });
    return interaction.reply({
      content: `✅ あなたの **${sub}** を **${value}** に設定したのだ！`,
      flags: [MessageFlags.Ephemeral],
    });
  }

  // ── /preset (Global) ──────────────────────────────────────────
  if (commandName === 'preset') {
    const sub = interaction.options.getSubcommand();
    const cfg = getFullGuildConfig(guild.id).settings;
    const userId = interaction.user.id;

    if (sub === 'save') {
      const presetName = interaction.options.getString('name');
      const voiceId = cfg.userVoices?.[userId] ?? cfg.speakerId ?? 3;
      const userParams = cfg.userParams?.[userId] || {};
      const speed = userParams.speed ?? cfg.speed ?? 1.0;
      const pitch = userParams.pitch ?? cfg.pitch ?? 0.0;
      const volume = userParams.volume ?? cfg.volume ?? 1.0;

      await saveUserPreset(userId, presetName, { voiceId, speed, pitch, volume });

      const voiceInfo = VOICES_LIST.find(v => v.value === parseInt(voiceId));
      const vName = voiceInfo ? voiceInfo.name : '不明な話者';

      return interaction.reply({
        content: `💾 プリセット **${presetName}** を保存したのだ！ (${vName} / 速度:${speed} / ﾋﾟｯﾁ:${pitch} / 音量:${volume})`,
        flags: [MessageFlags.Ephemeral]
      });
    }

    if (sub === 'load') {
      const presetName = interaction.options.getString('name');
      const presets = await getUserPresets(userId);
      const preset = presets.find(p => p.name === presetName);

      if (!preset) {
        return interaction.reply({
          content: `❌ **${presetName}** というプリセットは見つからないのだ。`,
          flags: [MessageFlags.Ephemeral]
        });
      }

      const userVoices = cfg.userVoices || {};
      const userParams = cfg.userParams || {};

      userVoices[userId] = preset.voice_id;
      userParams[userId] = {
        speed: preset.speed,
        pitch: preset.pitch,
        volume: preset.volume
      };
      
      setGuildConfig(guild.id, { userVoices, userParams });

      const voiceInfo = VOICES_LIST.find(v => v.value === parseInt(preset.voice_id));
      const vName = voiceInfo ? voiceInfo.name : '不明な話者';

      return interaction.reply({
        content: `🔄 グローバルプリセット **${presetName}** を読み込んだのだ！\n・話者: ${vName}\n・速度: ${preset.speed}\n・ピッチ: ${preset.pitch}\n・音量: ${preset.volume}`,
        flags: [MessageFlags.Ephemeral]
      });
    }

    if (sub === 'list') {
      const presets = await getUserPresets(userId);
      if (presets.length === 0) {
        return interaction.reply({
          content: `📌 あなたはまだプリセットを保存していないのだ。\n\`/preset save <名前>\` で保存できるのだ！`,
          flags: [MessageFlags.Ephemeral]
        });
      }

      const embed = new EmbedBuilder()
        .setColor('#4318ff')
        .setTitle('📌 あなたのグローバルプリセット')
        .setDescription('保存したプリセットは全てのサーバーで共通で使用できるのだ！');

      presets.forEach((p) => {
        const voiceInfo = VOICES_LIST.find(v => v.value === parseInt(p.voice_id));
        const vName = voiceInfo ? voiceInfo.name : '不明な話者';
        embed.addFields({
          name: `🔖 ${p.name}`,
          value: `・話者: ${vName}\n・速度: ${p.speed} | ピッチ: ${p.pitch} | 音量: ${p.volume}`,
          inline: false
        });
      });

      return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
    }
  }

  // ── /setchannel ──────────────────────────────────────────────
  if (commandName === 'setchannel') {
    const channel = interaction.options.getChannel('channel');
    if (!channel || !channel.isTextBased()) {
      return interaction.reply({
        content: '❌ テキストチャンネルを選択してほしいのだ！',
        flags: [MessageFlags.Ephemeral],
      });
    }

    await setGuildConfig(guild.id, { textChannelId: channel.id });
    
    const embed = new EmbedBuilder()
      .setColor('#81C784')
      .setTitle('📢 読み上げチャンネル設定')
      .setDescription(`✅ これから **${channel.name}** での発言を読み上げるのだ！`)
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // ── /serverstatus ──────────────────────────────────────────────
  if (commandName === 'serverstatus') {
    const fullCfg = getFullGuildConfig(guild.id);
    const cfg = fullCfg.settings;

    const connected = isConnected(guild.id);

    // Count permissions
    const perms = fullCfg.permissions;
    let ruleCount = 0;
    if (perms && Object.keys(perms).length > 0) {
      ruleCount = Object.values(perms).reduce((sum, r) => sum + Object.keys(r).length, 0);
    }

    const embed = new EmbedBuilder()
      .setColor('#81C784')
      .setTitle(`📊 サーバーの設定状況なのだ`)
      .setAuthor({ name: guild.name, iconURL: guild.iconURL() })
      .addFields(
        {
          name: '📡 接続状況',
          value: `> **ボイス:** ${cfg.voiceChannelId ? `<#${cfg.voiceChannelId}>` : '`未接続`'}\n` +
            `> **テキスト:** ${cfg.textChannelId ? `<#${cfg.textChannelId}>` : '`未設定`'}`,
          inline: true
        },
        {
          name: '🎵 音楽・機能',
          value: `\n` +
            `> **カラオケ:** ${cfg.karaokeMode ? '`ON`' : '`OFF`'}\n` +
            `> **音楽音量:** \`${cfg.karaokeVolume ?? 1.0}\`\n` +
            `> **サウンドボード:** ${cfg.soundboardMode ? '`ON`' : '`OFF`'}`,
          inline: true
        },
        {
          name: '🎙️ デフォルト音声設定',
          value: `> **話者:** \`ずんだもん (${cfg.speakerId ?? 3})\`\n` +
            `> **詳細:** \`/set-server\` で設定可能なのだ (速度 \`${cfg.speed ?? 1.0}\` | ピッチ \`${cfg.pitch ?? 0.0}\` | 音量 \`${cfg.volume ?? 1.0}\`)`,
          inline: false
        },
        {
          name: '⚙️ システム設定',
          value: `> **名前読込:** ${cfg.readName === false ? '`OFF`' : '`ON`'}\n` +
            `> **入退告知:** ${cfg.announceVoice ? '`ON`' : '`OFF`'}\n` +
            `> **自動削除:** ${cfg.cleanChatTasks?.[interaction.channelId] ? `\`${cfg.cleanChatTasks[interaction.channelId]}分\`` : '`OFF`'}`,
          inline: true
        },
        {
          name: '🔒 制限・権限',
          value: `> **字数制限:** \`${cfg.trimWordCount || '無制限'}\`\n` +
            `> **個別設定:** \`${ruleCount > 0 ? `${ruleCount}件` : 'なし'}\``,
          inline: true
        }
      )
      .setFooter({ text: 'ずんだもんが高精度にお知らせするのだ！' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
  }

  // ── /mystatus ──────────────────────────────────────────────────
  if (commandName === 'mystatus') {
    const cfg = getFullGuildConfig(guild.id).settings;
    const userId = interaction.user.id;

    // User voice ID
    const voiceId = cfg.userVoices?.[userId] ?? cfg.speakerId ?? 3;
    const voiceInfo = VOICES_LIST.find(v => v.value === parseInt(voiceId));
    const vName = voiceInfo ? voiceInfo.name : `ID: ${voiceId}`;

    // User params
    const myParams = cfg.userParams?.[userId] || {};

    const embed = new EmbedBuilder()
      .setColor('#81C784')
      .setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() })
      .setTitle('🎤 あなたの声設定')
      .setDescription('`/set` で個別に設定した内容は、サーバー設定より優先されるのだ！')
      .addFields(
        { name: '🎙️ 話者', value: `\`${vName}\`${cfg.userVoices?.[userId] !== undefined ? '' : ' (鯖デフォ)'}`, inline: true },
        { name: '⚡ 速度', value: `\`${myParams.speed ?? cfg.speed ?? 1.0}\`${myParams.speed !== undefined ? '' : ' (鯖デフォ)'}`, inline: true },
        { name: '🎵 ピッチ', value: `\`${myParams.pitch ?? cfg.pitch ?? 0.0}\`${myParams.pitch !== undefined ? '' : ' (鯖デフォ)'}`, inline: true },
        { name: '🔈 音量', value: `\`${myParams.volume ?? cfg.volume ?? 1.0}\`${myParams.volume !== undefined ? '' : ' (鯖デフォ)'}`, inline: true }
      );

    return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
  }


  // ── /readname ────────────────────────────────────────────────
  if (commandName === 'readname') {
    const enabled = interaction.options.getBoolean('enabled');
    setGuildConfig(guild.id, { readName: enabled });
    return interaction.reply({
      content: `✅ 発言者の名前読み上げを **${enabled ? 'オン' : 'オフ'}** にしたのだ！`,
      flags: [MessageFlags.Ephemeral],
    });
  }


  // ── /announce ────────────────────────────────────────────────
  if (commandName === 'announce') {
    const enabled = interaction.options.getBoolean('enabled');
    setGuildConfig(guild.id, { announceVoice: enabled });
    return interaction.reply({
      content: `✅ ボイスチャンネルの入退室読み上げを **${enabled ? 'オン' : 'オフ'}** にしたのだ！`,
      flags: [MessageFlags.Ephemeral],
    });
  }

  // ── /cleanchat ──────────────────────────────────────────────
  if (commandName === 'cleanchat') {
    const minutes = interaction.options.getInteger('minutes');
    const channel = interaction.channel;

    // Save to Postgres
    const cfg = getFullGuildConfig(guild.id).settings;
    const cleanTasks = cfg.cleanChatTasks || {};

    if (minutes <= 0) {
      delete cleanTasks[channel.id];
      setGuildConfig(guild.id, { cleanChatTasks: cleanTasks });

      const timerKey = `${guild.id}-${channel.id}`;
      if (cleanTimers.has(timerKey)) {
        clearInterval(cleanTimers.get(timerKey));
        cleanTimers.delete(timerKey);
      }
      return interaction.reply({
        content: '🛑 このチャンネルの自動メッセージ削除を **無効** にしたのだ！',
        flags: [MessageFlags.Ephemeral],
      });
    }

    cleanTasks[channel.id] = minutes;
    setGuildConfig(guild.id, { cleanChatTasks: cleanTasks });

    startCleanChatTimer(interaction.client, guild.id, channel.id, minutes * 60 * 1000);

    const logMsg = `[CLEANCHAT] Enabled for #${channel.name} every ${minutes} minutes.`;
    console.log(`[G:${guild.id}] [SYS] ${logMsg}`);
    logToSupabase(guild.id, 'sys', logMsg);

    return interaction.reply({
      content: `🧹 このチャンネルのメッセージを **${minutes}分ごと** に自動削除するのだ！\n（${minutes}分より古いメッセージが対象なのだ）\n無効にするには \`/cleanchat minutes:0\` を使うのだ。`,
      flags: [MessageFlags.Ephemeral],
    });
  }

  // ── /trim ──────────────────────────────────────────────────────
  if (commandName === 'trim') {
    const wordcount = interaction.options.getInteger('wordcount');
    setGuildConfig(guild.id, { trimWordCount: wordcount > 0 ? wordcount : 0 });
    if (wordcount > 0) {
      return interaction.reply({
        content: `✂️ 読み上げる最大文字数を **${wordcount}文字** に設定したのだ！\n超過する場合は「以下略」と読み上げるのだ。`,
        flags: [MessageFlags.Ephemeral],
      });
    } else {
      return interaction.reply({
        content: '✂️ 文字数制限を **無効** にしたのだ！',
        flags: [MessageFlags.Ephemeral],
      });
    }
  }

  // ── /permissions ──────────────────────────────────────────────
  if (commandName === 'permissions') {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'set') {
      const cmdName = interaction.options.getString('command').toLowerCase();
      const target = interaction.options.getMentionable('target');
      const action = interaction.options.getString('action');

      if (!ALL_COMMAND_NAMES.includes(cmdName)) {
        return interaction.reply({
          content: `❌ 「${cmdName}」は存在しないコマンドなのだ。\n有効なコマンドはこれらなのだ: ${ALL_COMMAND_NAMES.join(', ')}`,
          flags: [MessageFlags.Ephemeral],
        });
      }

      const fullCfg = getFullGuildConfig(guild.id);
      const perms = fullCfg.permissions || {};
      if (!perms[cmdName]) perms[cmdName] = {};
      perms[cmdName][target.id] = action;

      // Auto deny the general public if granting a specific user/role an allow exception
      // Skip this if the target is already @everyone
      if (action === 'allow' && target.id !== guild.id) {
        perms[cmdName][guild.id] = 'deny';
      }

      // Use updateGuildMeta to ensure perms save to the top-level column, not the settings JSON
      updateGuildMeta(guild.id, { permissions: perms });

      const isRole = guild.roles.cache.has(target.id);
      const mention = (target.id === guild.id) ? '@everyone' : (isRole ? `<@&${target.id}>` : `<@${target.id}>`);
      const suffix = action === 'allow' ? '\n（※他のすべてのユーザー（@everyone）は自動で拒否設定になります）' : '';

      return interaction.reply({
        content: `✅ \`/${cmdName}\` → ${mention} を **${action === 'allow' ? '許可' : '拒否'}** に設定したのだ！${suffix}`,
        flags: [MessageFlags.Ephemeral],
      });
    }

    if (subcommand === 'list') {
      const fullCfg = getFullGuildConfig(guild.id);
      const perms = fullCfg.permissions || {};
      const entries = Object.entries(perms);

      if (entries.length === 0) {
        return interaction.reply({
          content: '📋 権限ルールはまだ設定されていないのだ。すべてのコマンドが全員に開放されているのだ！',
          flags: [MessageFlags.Ephemeral],
        });
      }

      const lines = [];
      for (const [cmdName, rules] of entries) {
        for (const [targetId, action] of Object.entries(rules)) {
          const isEveryone = targetId === guild.id;
          const isRole = guild.roles.cache.has(targetId);
          const mention = isEveryone ? '@everyone' : (isRole ? `<@&${targetId}>` : `<@${targetId}>`);
          lines.push(`\`/${cmdName}\` → ${mention} : **${action === 'allow' ? '✅ 許可' : '🚫 拒否'}**`);
        }
      }

      return interaction.reply({
        content: `📋 **権限ルール一覧 (${lines.length}件)**\n${lines.join('\n')}`,
        flags: [MessageFlags.Ephemeral],
      });
    }

    if (subcommand === 'reset') {
      const cmdName = interaction.options.getString('command').toLowerCase();
      const fullCfg = getFullGuildConfig(guild.id);
      const perms = fullCfg.permissions || {};

      if (!perms[cmdName]) {
        return interaction.reply({
          content: `⚠️ \`/${cmdName}\` には権限ルールが設定されていないのだ。`,
          flags: [MessageFlags.Ephemeral],
        });
      }

      if (DEFAULT_PERMISSIONS[cmdName]) {
        perms[cmdName] = DEFAULT_PERMISSIONS[cmdName];
      } else {
        delete perms[cmdName];
      }
      updateGuildMeta(guild.id, { permissions: perms });

      return interaction.reply({
        content: `🗑️ \`/${cmdName}\` の権限ルールをリセットしたのだ！`,
        flags: [MessageFlags.Ephemeral],
      });
    }
  }

  // ── /help ──────────────────────────────────────────────────────
  if (commandName === 'help') {
    const categories = [
      {
        name: '🎮 基本操作',
        commands: [
          { cmd: 'vc', desc: '参加・退出・移動' },
          { cmd: 'help', desc: 'ヘルプを表示' },
        ]
      },
      {
        name: '🔊 声の設定 (個人)',
        commands: [
          { cmd: 'set voice', desc: '声の種類(ID)を設定' },
          { cmd: 'set speed', desc: '話す速度を設定' },
          { cmd: 'set pitch', desc: '声の低さを設定' },
          { cmd: 'set volume', desc: '声の大きさを設定' },
          { cmd: 'mystatus', desc: '自分の設定を確認' },
        ]
      },
      {
        name: '🏷️ プリセット管理',
        commands: [
          { cmd: 'preset save', desc: '全鯖共通で設定を保存' },
          { cmd: 'preset load', desc: '保存設定を読込・適用' },
          { cmd: 'preset list', desc: '保存設定の一覧を表示' },
        ]
      },
      {
        name: '🎙️ サウンド & 絵文字',
        commands: [
          { cmd: 'customsound add', desc: 'キーワード反応SE追加' },
          { cmd: 'customsound remove', desc: 'キーワード反応SE削除' },
          { cmd: 'customsound list', desc: '登録済みSE一覧を表示' },
          { cmd: 'customemoji add', desc: '絵文字の読みを辞書追加' },
          { cmd: 'customemoji remove', desc: '絵文字の読みを辞書削除' },
          { cmd: 'customemoji list', desc: '登録済み絵文字辞書表示' },
          { cmd: 'soundboard', desc: 'サウンドボード(ON/OFF)' },
        ]
      },
      {
        name: '🌐 サーバー設定 (管理者用)',
        commands: [
          { cmd: 'setchannel', desc: '読み上げチャンネル指定' },
          { cmd: 'set-server voice', desc: '鯖デフォ話者を指定' },
          { cmd: 'readname', desc: '名前読み上げの設定' },
          { cmd: 'announce', desc: '入退室読み上げの設定' },
          { cmd: 'trim', desc: '最大文字数の設定' },
          { cmd: 'permissions', desc: '使用権限(ロール)管理' },
          { cmd: 'cleanchat', desc: 'メッセージ自動削除設定' },
          { cmd: 'serverstatus', desc: '現在のサーバー設定を表示' },
        ]
      },
      {
        name: '🎵 音楽再生',
        commands: [
          { cmd: 'play', desc: 'YouTubeから曲を再生' },
          { cmd: 'pause', desc: '一時停止 / 再開' },
          { cmd: 'skip', desc: '現在の曲をスキップ' },
          { cmd: 'queue', desc: '再生待ちリストを表示' },
          { cmd: 'loop', desc: 'ループ再生を設定' },
          { cmd: 'lyrics', desc: '曲の歌詞を表示' },
          { cmd: 'musicvolume', desc: '再生音量を設定' },
        ]
      }
    ];

    const allowedFields = [];
    for (const category of categories) {
      const allowedCommands = category.commands.filter(c => checkPermission(guild.id, c.cmd, member, interaction.channelId));
      if (allowedCommands.length > 0) {
        allowedFields.push({
          name: category.name,
          value: allowedCommands.map(c => `\`/${c.cmd}\` — ${c.desc}`).join('\n')
        });
      }
    }

    const embed = new EmbedBuilder()
      .setColor('#81C784')
      .setTitle('📢 ずんだもん コマンドヘルプ')
      .setDescription('あなたが使用可能なコマンドの一覧と使い方なのだ！ダッシュボードからより詳細な設定ができるのだ！')
      .addFields(allowedFields)
      .setTimestamp();

    return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
  }

  // ── /soundboard ──────────────────────────────────────────────
  if (commandName === 'soundboard') {
    const enabled = interaction.options.getBoolean('enabled');
    setGuildConfig(guild.id, { soundboardMode: enabled });
    return interaction.reply({
      content: `✅ サウンドボードモードを **${enabled ? 'オン' : 'オフ'}** にしたのだ！`,
      flags: [MessageFlags.Ephemeral],
    });
  }

  // ── /play ──────────────────────────────────────────────────────
  if (commandName === 'play') {
    const voiceChannel = member?.voice?.channel;
    if (!voiceChannel && !isConnected(guild.id)) {
      logToSupabase(guild.id, 'cmd', `[CMD] User: ${interaction.user.username}, Command: /${fullCommandPath}, Status: Failed (Not in VC)`);
      return interaction.reply({ content: '❌ まずボイスチャンネルに参加してほしいのだ！', flags: [MessageFlags.Ephemeral] });
    }

    // Auto-enable karaoke mode and disable chat mode if not already active
    const cfg = getGuildConfig(guild.id);
    if (!cfg.karaokeMode) {
      setGuildConfig(guild.id, { karaokeMode: true });
      subscribeToMusic(guild.id);
    }

    const query = interaction.options.getString('query');
    await interaction.deferReply();

    try {
      // Auto-join if not connected
      if (!isConnected(guild.id)) {
        await joinChannel(voiceChannel);
        setGuildConfig(guild.id, { voiceChannelId: voiceChannel.id });
      }

      const result = await enqueueMusic(guild.id, query, interaction.user.id);
      if (!result) {
        logToSupabase(guild.id, 'cmd', `[CMD] User: ${interaction.user.username}, Command: /${fullCommandPath}, Status: Failed (Song not found)`);
        return interaction.editReply(`❌ 指定された曲が見つからなかった、または読み込めなかったのだ。`);
      }
      return interaction.editReply(result);
    } catch (err) {
      console.error('[Play] Error:', err);
      logToSupabase(guild.id, 'cmd', `[CMD] User: ${interaction.user.username}, Command: /${fullCommandPath}, Status: Failed (Error: ${err.message})`);
      return interaction.editReply(`❌ 曲の処理中にエラーが発生したのだ。`);
    }
  }

  // ── /pause ─────────────────────────────────────────────────────
  if (commandName === 'pause') {
    const isPaused = pauseMusic(guild.id);
    if (isPaused === null) {
      logToSupabase(guild.id, 'cmd', `[CMD] User: ${interaction.user.username}, Command: /${fullCommandPath}, Status: Failed (Not playing)`);
      return interaction.reply({ content: `❌ 現在何も再生されていないのだ。`, flags: [MessageFlags.Ephemeral] });
    }
    return interaction.reply({ content: isPaused ? `⏸️ 音楽を一時停止したのだ。` : `▶️ 音楽を再開したのだ！` });
  }

  // ── /skip ──────────────────────────────────────────────────────
  if (commandName === 'skip') {
    const skipped = skipMusic(guild.id);
    if (!skipped) {
      logToSupabase(guild.id, 'cmd', `[CMD] User: ${interaction.user.username}, Command: /${fullCommandPath}, Status: Failed (Nothing to skip)`);
      return interaction.reply({ content: `❌ スキップできる曲がないのだ。`, flags: [MessageFlags.Ephemeral] });
    }
    return interaction.reply({ content: `⏭️ 現在の曲をスキップしたのだ！` });
  }

  // ── /queue ─────────────────────────────────────────────────────
  if (commandName === 'queue') {
    const q = getQueue(guild.id);
    if (!q || (!q.current && q.upcoming.length === 0)) {
      logToSupabase(guild.id, 'cmd', `[CMD] User: ${interaction.user.username}, Command: /${fullCommandPath}, Status: Failed (Queue empty)`);
      return interaction.reply({ content: `🎶 現在キューに曲はないのだ。`, flags: [MessageFlags.Ephemeral] });
    }

    const loopStr = q.loopMode === 'track' ? '🔂 1曲リピート' : q.loopMode === 'queue' ? '🔁 全曲リピート' : '▶️ リピートオフ';
    let text = `🎧 **現在のキュー** (${loopStr}):\n`;
    if (q.current) {
      text += `▶️ **[再生中]** ${q.current.title} (${q.current.duration})\n\n`;
    }
    if (q.upcoming.length > 0) {
      text += `⏳ **[待機中]**\n`;
      q.upcoming.slice(0, 10).forEach((item, i) => {
        text += `${i + 1}. ${item.title} (${item.duration})\n`;
      });
      if (q.upcoming.length > 10) {
        text += `...他 ${q.upcoming.length - 10} 曲\n`;
      }
    }
    return interaction.reply({ content: text, flags: [MessageFlags.Ephemeral] });
  }

  // ── /loop ──────────────────────────────────────────────────────
  if (commandName === 'loop') {
    if (!isConnected(guild.id)) {
      logToSupabase(guild.id, 'cmd', `[CMD] User: ${interaction.user.username}, Command: /${fullCommandPath}, Status: Failed (Not in VC)`);
      return interaction.reply({ content: '❌ ボイスチャンネルに参加していないのだ！', flags: [MessageFlags.Ephemeral] });
    }
    const mode = interaction.options.getString('mode');
    setLoopMode(guild.id, mode);

    const modeStr = mode === 'track' ? '🔂 **1曲リピート**' : mode === 'queue' ? '🔁 **全曲リピート**' : '▶️ **リピートオフ**';
    return interaction.reply({ content: `✅ ループモードを ${modeStr} に設定したのだ！` });
  }

  // ── /lyrics ─────────────────────────────────────────────────────
  if (commandName === 'lyrics') {
    const q = getQueue(guild.id);
    if (!q || !q.current) {
      logToSupabase(guild.id, 'cmd', `[CMD] User: ${interaction.user.username}, Command: /${fullCommandPath}, Status: Failed (Not playing)`);
      return interaction.reply({ content: `❌ 現在何も再生されていないため、歌詞を表示できないのだ。`, flags: [MessageFlags.Ephemeral] });
    }

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    try {
      const result = await fetchLyrics(q.current);
      let lyrics = result.lyrics;
      const source = result.source;

      if (!lyrics) {
        if (result.cooldown) {
          return interaction.editReply(`❌ この曲の歌詞は見つからなかったのだ。再試行まであと **${result.daysLeft}日** 待ってほしいのだ。`);
        }
        return interaction.editReply(`❌ 歌詞データベースおよび動画説明文に見つからなかったのだ。申し訳ないのだ。`);
      }

      // Format
      const footer = `\n\n*(Source: ${source})*`;
      if (lyrics.length > (1900 - footer.length)) {
        lyrics = lyrics.substring(0, 1800) + '...';
      }

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('lyrics_correct')
          .setLabel('✅ 正しい')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId('lyrics_incorrect')
          .setLabel('❌ 間違っている')
          .setStyle(ButtonStyle.Danger)
      );

      return interaction.editReply({
        content: `🎶 **${q.current.title}** の歌詞なのだ:\n\n${lyrics}${footer}`,
        components: [row]
      });
    } catch (err) {
      console.error('[Lyrics] General Error:', err);
      incrementCounter(guild.id, 'errors', interaction.user.id);
      emitLiveSnapshot(guild.id, { errors: 1 });
      broadcastStats();
      return interaction.editReply(`❌ 歌詞の取得中にエラーが発生したのだ。`);
    }
  }

  // ── /musicvolume ────────────────────────────────────────────────
  if (commandName === 'musicvolume') {
    const vol = interaction.options.getNumber('volume');
    setGuildConfig(guild.id, { karaokeVolume: vol });
    return interaction.reply({ content: `🎵 カラオケモードの音量を **${vol}** に設定したのだ！`, flags: [MessageFlags.Ephemeral] });
  }

  // ── /set-server ──────────────────────────────────────────────────
  if (commandName === 'set-server') {
    const sub = interaction.options.getSubcommand();
    const cfg = getFullGuildConfig(guild.id).settings;

    if (sub === 'voice') {
      const vid = interaction.options.getInteger('voiceid');
      setGuildConfig(guild.id, { speakerId: vid });
      return interaction.reply({ content: `🎤 サーバー全体のデフォルト話者IDを **${vid}** に設定したのだ！` });
    }

    const val = interaction.options.getNumber('value');
    if (sub === 'speed') cfg.speed = val;
    if (sub === 'pitch') cfg.pitch = val;
    if (sub === 'volume') cfg.volume = val;

    setGuildConfig(guild.id, { speed: cfg.speed, pitch: cfg.pitch, volume: cfg.volume });
    return interaction.reply({ content: `⚙️ サーバー全体の **${sub}** デフォルトを **${val}** に更新したのだ！` });
  }

  // ── /customsound ────────────────────────────────────────────────
  if (commandName === 'customsound') {
    const sub = interaction.options.getSubcommand();
    const cfg = getFullGuildConfig(guild.id).settings;
    const sounds = cfg.customSounds || {};

    if (sub === 'add') {
      const keyword = interaction.options.getString('keyword');
      const file = interaction.options.getAttachment('file');

      if (!file.contentType?.startsWith('audio/') && !file.contentType?.startsWith('video/')) {
        return interaction.reply({ content: '❌ 音声/動画ファイル(mp3/wav/ogg等)をアップロードしてほしいのだ！', flags: [MessageFlags.Ephemeral] });
      }

      await interaction.deferReply();
      try {
        const ext = path.extname(file.name) || '.mp3';
        const fileName = `${guild.id}_${Date.now()}${ext}`;

        const res = await fetch(file.url);
        if (!res.ok) throw new Error('Download failed');
        const arrayBuffer = await res.arrayBuffer();

        // Upload to Supabase Storage Bucket
        const { error } = await supabase.storage.from('sounds').upload(fileName, arrayBuffer, {
          contentType: file.contentType || 'audio/mpeg',
          upsert: true
        });
        if (error) throw error;

        const publicUrl = supabase.storage.from('sounds').getPublicUrl(fileName).data.publicUrl;

        sounds[keyword] = { url: publicUrl, path: fileName };
        setGuildConfig(guild.id, { customSounds: sounds });

        return interaction.editReply(`✅ キーワード「**${keyword}**」の音源を追加したのだ！`);
      } catch (e) {
        console.error('[CustomSound]', e);
        incrementCounter(guild.id, 'errors', interaction.user.id);
        emitLiveSnapshot(guild.id, { errors: 1 });
        broadcastStats();
        return interaction.editReply(`❌ 音源ファイルのアップロード中にエラーが起きたのだ。(Supabase Bucket "sounds" をパブリック設定で作成したか確認してください)`);
      }
    }

    if (sub === 'remove') {
      const keyword = interaction.options.getString('keyword');
      if (sounds[keyword]) {
        const fileData = sounds[keyword];

        // Delete file from Supabase Storage
        if (fileData.path) {
          await supabase.storage.from('sounds').remove([fileData.path]).catch(console.error);
        }

        delete sounds[keyword];
        setGuildConfig(guild.id, { customSounds: sounds });
        return interaction.reply({ content: `🗑️ キーワード「**${keyword}**」の音源を削除したのだ！` });
      }
      return interaction.reply({ content: `⚠️ そのキーワードは登録されていないのだ。`, flags: [MessageFlags.Ephemeral] });
    }

    if (sub === 'list') {
      const keys = Object.keys(sounds);
      if (keys.length === 0) return interaction.reply({ content: '📝 カスタム音源はまだ登録されていないのだ！', flags: [MessageFlags.Ephemeral] });
      return interaction.reply({ content: `📝 **登録済みのカスタム音源 (${keys.length}件) なのだ！**\n${keys.map(k => `・ ${k}`).join('\n')}`, flags: [MessageFlags.Ephemeral] });
    }
  }

  // ── /customemoji ────────────────────────────────────────────────
  if (commandName === 'customemoji') {
    const sub = interaction.options.getSubcommand();
    const cfg = getFullGuildConfig(guild.id).settings;
    const emojis = cfg.customEmojis || {};

    if (sub === 'add') {
      const emojiInput = interaction.options.getString('emoji');
      const readText = interaction.options.getString('readtext');

      const match = emojiInput.match(/<a?:\w+:(\d+)>/);
      const emojiId = match ? match[1] : emojiInput.trim();

      emojis[emojiId] = readText;
      setGuildConfig(guild.id, { customEmojis: emojis });
      return interaction.reply({ content: `✅ 絵文字 ${emojiInput} を「**${readText}**」と読み上げるように登録したのだ！` });
    }

    if (sub === 'remove') {
      const emojiInput = interaction.options.getString('emoji');
      const match = emojiInput.match(/<a?:\w+:(\d+)>/);
      const emojiId = match ? match[1] : emojiInput.trim();

      if (emojis[emojiId]) {
        delete emojis[emojiId];
        setGuildConfig(guild.id, { customEmojis: emojis });
        return interaction.reply({ content: `🗑️ 絵文字 ${emojiInput} の設定を削除したのだ！` });
      }
      return interaction.reply({ content: `⚠️ その絵文字は登録されていないのだ。`, flags: [MessageFlags.Ephemeral] });
    }

    if (sub === 'list') {
      const keys = Object.keys(emojis);
      if (keys.length === 0) return interaction.reply({ content: '📝 絵文字辞書はまだ登録されていないのだ！', flags: [MessageFlags.Ephemeral] });
      const listStr = keys.map(k => `・ ID:${k} 👉 ${emojis[k]}`).join('\n');
      return interaction.reply({ content: `📝 **登録済みの絵文字 (${keys.length}件) なのだ！**\n${listStr}`, flags: [MessageFlags.Ephemeral] });
    }
  }
}
// ── CleanChat Background Job ───────────────────────────────────────────
export function startCleanChatTimer(client, guildId, channelId, intervalMs) {
  const timerKey = `${guildId}-${channelId}`;
  if (cleanTimers.has(timerKey)) {
    clearInterval(cleanTimers.get(timerKey));
  }

  const cleanFn = async () => {
    try {
      if (isBotLocked() || isGuildBlocked(guildId)) return; // Skip while locked or blocked

      const channel = client.channels.cache.get(channelId);
      if (!channel) return;

      const permissions = channel.permissionsFor(channel.guild?.members?.me);
      if (!permissions || !permissions.has(PermissionFlagsBits.ManageMessages) || !permissions.has(PermissionFlagsBits.ReadMessageHistory)) {
        console.warn(`[CleanChat] ⚠️ Missing manage messages permissions in #${channel.name} (${guildId}). Cleanup skipped.`);
        return;
      }

      const messages = await channel.messages.fetch({ limit: 100 });
      const cutoff = Date.now() - intervalMs;
      
      const q = getQueue(guildId);
      const isMusicPlaying = q && (q.current || q.upcoming.length > 0);
      const activeNowPlayingId = getNowPlayingMessageId(guildId);

      const oldMessages = messages.filter(m => {
        if (m.createdTimestamp >= cutoff) return false;
        
        // Protect currently playing song message
        if (isMusicPlaying) {
          if (m.id === activeNowPlayingId) return false;
          
          // Protect any message that looks like a Now Playing embed while music is active
          // to satisfy "only delete when there is no songs in queue"
          if (m.author.id === client.user.id && m.embeds?.[0]?.title === '🎶 Now Playing') {
            return false;
          }
        }
        
        return true;
      });

      if (oldMessages.size === 0) return;

      const bulkDeletable = oldMessages.filter(m => (Date.now() - m.createdTimestamp) < 14 * 24 * 60 * 60 * 1000);

      if (bulkDeletable.size > 1) {
        await channel.bulkDelete(bulkDeletable, true);
        console.log(`[G:${guildId}] [SYS] [CleanChat] Bulk deleted ${bulkDeletable.size} messages in ${channel.name}`);
        logToSupabase(guildId, 'sys', `Cleaned up ${bulkDeletable.size} messages in #${channel.name}`);
      } else if (bulkDeletable.size === 1) {
        await bulkDeletable.first().delete();
        console.log(`[G:${guildId}] [SYS] [CleanChat] Deleted 1 message in ${channel.name}`);
        logToSupabase(guildId, 'sys', `Cleaned up 1 message in #${channel.name}`);
      }
    } catch (err) {
      if (err.code === 50013) {
        console.warn(`[G:${guildId}] [CleanChat] ⚠️ Missing Access API Error in channel ${channelId}.`);
      } else {
        console.error(`[G:${guildId}] [CleanChat] Error cleaning messages:`, err.message);
      }
    }
  };

  cleanFn(); // Execute initial pass immediately
  const timerId = setInterval(cleanFn, intervalMs);
  cleanTimers.set(timerKey, timerId);
}

