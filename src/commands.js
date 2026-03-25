// src/commands.js
// Defines all slash command handlers

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder } from 'discord.js';
import { joinChannel, leaveChannel, isConnected, enqueue, pauseMusic, skipMusic, enqueueMusic, getQueue, setLoopMode } from './player.js';
import { getGuildConfig, setGuildConfig, updateGuildMeta, getFullGuildConfig } from './config.js';
import { preloadWhisper, isWhisperReady, onWhisperReady, cancelAiGeneration } from './ai.js';
import { isGuildAuthorized, isGuildBlocked } from './auth.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import axios from 'axios';
import supabase from './db_supabase.js';
import { incrementCommand } from './index.js';
import { trackCommandExecution } from './db_supabase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SOUNDS_DIR = path.join(__dirname, '..', 'sounds');

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName('join')
    .setDescription('ずんだもんがあなたのボイスチャンネルに参加します'),

  new SlashCommandBuilder()
    .setName('leave')
    .setDescription('ずんだもんがボイスチャンネルから退出します'),

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
    .setName('setvoice')
    .setDescription('読み上げる声（話者）を設定します')
    .addIntegerOption((opt) =>
      opt
        .setName('voiceid')
        .setDescription('話者名を選択してください')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  new SlashCommandBuilder()
    .setName('voiceparams')
    .setDescription('あなた専用の声のオプション（速度、ピッチ、音量）を設定します')
    .addNumberOption((opt) => opt.setName('speed').setDescription('速度 (標準: 1.0)'))
    .addNumberOption((opt) => opt.setName('pitch').setDescription('ピッチ (標準: 0.0)'))
    .addNumberOption((opt) => opt.setName('volume').setDescription('音量 (標準: 1.0)')),

  new SlashCommandBuilder()
    .setName('chatmode')
    .setDescription('AIによる書き起こし＋自然会話モードを切り替えます')
    .addBooleanOption((opt) => opt.setName('enabled').setDescription('有効にする (True) または 無効にする (False)').setRequired(true)),
    
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
    .setDescription('YouTubeやSpotifyから音楽を再生します（カラオケモード中のみ）')
    .addStringOption((opt) => opt.setName('query').setDescription('曲のURLまたは検索キーワード').setRequired(true)),

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
    .setName('voices')
    .setDescription('利用可能な主な話者（声）の一覧を表示します'),

  new SlashCommandBuilder()
    .setName('addword')
    .setDescription('Whisperの誤認識を修正する辞書に単語を登録します')
    .addStringOption((opt) => opt.setName('wrong').setDescription('誤って認識される言葉 (例: ホヨバース)').setRequired(true))
    .addStringOption((opt) => opt.setName('correct').setDescription('正しい言葉 (例: HoYoverse)').setRequired(true)),

  new SlashCommandBuilder()
    .setName('delword')
    .setDescription('辞書から単語を削除します')
    .addStringOption((opt) => opt.setName('wrong').setDescription('削除する言葉').setRequired(true)),

  new SlashCommandBuilder()
    .setName('listwords')
    .setDescription('登録されている辞書の一覧を表示します'),

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
    .setName('servervoice')
    .setDescription('サーバー全体のデフォルト話者を設定します')
    .addIntegerOption((opt) => opt.setName('voiceid').setDescription('話者名を選択してください').setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName('servervoiceparams')
    .setDescription('サーバー全体の声のオプション（速度、ピッチ、音量）のデフォルトを設定します')
    .addNumberOption((opt) => opt.setName('speed').setDescription('速度'))
    .addNumberOption((opt) => opt.setName('pitch').setDescription('ピッチ'))
    .addNumberOption((opt) => opt.setName('volume').setDescription('音量')),

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
  'join', 'leave', 'setchannel', 'setvoice', 'voiceparams', 
  'voiceparams speed', 'voiceparams pitch', 'voiceparams volume',
  'chatmode', 'soundboard',
  'serverstatus', 'mystatus', 'help', 'voices', 'addword', 'delword',
  'listwords', 'readname', 'announce', 'cleanchat', 'trim', 'permissions',
  'play', 'pause', 'skip', 'queue', 'lyrics',
  'permissions set', 'permissions list', 'permissions reset',
  'musicvolume', 'servervoice', 'servervoiceparams',
  'servervoiceparams speed', 'servervoiceparams pitch', 'servervoiceparams volume',
  'customsound add', 'customsound remove', 'customsound list',
  'customemoji add', 'customemoji remove', 'customemoji list'
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

  if (interaction.commandName === 'setvoice' || interaction.commandName === 'servervoice') {
    if (focusedOption.name === 'voiceid') {
      const q = String(focusedOption.value).toLowerCase();
      const filtered = VOICES_LIST.filter(v => v.name.includes(q)).slice(0, 25);
      await interaction.respond(filtered);
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
 * @returns {boolean}
 */
function checkPermission(guildId, commandPath, member) {
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
    if (rules[member.id]) return rules[member.id] === 'allow';

    // 2. Role specific rules (excluding @everyone / guildId)
    const roleIds = member.roles.cache.map(r => r.id).filter(id => id !== guildId);
    let hasRoleAllow = false;
    let hasRoleDeny = false;
    
    for (const rid of roleIds) {
      if (rules[rid] === 'allow') hasRoleAllow = true;
      if (rules[rid] === 'deny') hasRoleDeny = true;
    }
    
    if (hasRoleDeny) return false;
    if (hasRoleAllow) return true;

    // 3. @everyone rule
    if (rules[guildId]) return rules[guildId] === 'allow';

    // 4. Default implicit logic
    const hasAnyAllow = Object.values(rules).some(v => v === 'allow');
    if (hasAnyAllow) return false;

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
 * Handles an incoming slash command interaction.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function handleCommand(interaction) {
  const { commandName, guild, member } = interaction;

  if (!guild) {
    return interaction.reply({
      content: 'このコマンドはサーバー内でのみ使用できます。',
      flags: [MessageFlags.Ephemeral],
    });
  }

  // ── 2FA Auth check ──────────────────────────────────────────
  if (!isGuildAuthorized(guild.id)) {
    return interaction.reply({
      content: '⛔ このサーバーは認証されていません。ボットオーナーに認証を依頼してください。',
      flags: [MessageFlags.Ephemeral],
    });
  }

  // ── Blocked check ──────────────────────────────────────────
  if (isGuildBlocked(guild.id)) {
    return interaction.reply({
      content: '🚫 このサーバーはボットオーナーによってブロックされています。コマンドは使用できません。',
      flags: [MessageFlags.Ephemeral],
    });
  }

  // ── Permission check ────────────────────────────────────────
  let fullCommandPath = commandName;
  try {
    const subcommand = interaction.options.getSubcommand(false);
    if (subcommand) fullCommandPath = `${commandName} ${subcommand}`;
  } catch (e) {}

  if (!checkPermission(guild.id, fullCommandPath, member)) {
    return interaction.reply({
      content: '🚫 あなたのユーザーまたはロールではこのコマンドを使用する権限がありません。',
      flags: [MessageFlags.Ephemeral],
    });
  }

  // ── Analytics Tracking ────────────────────────────────────────
  incrementCommand(guild.id, fullCommandPath);
  trackCommandExecution(guild.id, fullCommandPath, member.id);

  // ── /join ──────────────────────────────────────────────────────
  if (commandName === 'join') {
    const voiceChannel = member?.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({
        content: '❌ まずボイスチャンネルに参加してください！',
        flags: [MessageFlags.Ephemeral],
      });
    }

    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    } catch (err) {
      console.warn('⚠️ [join] Discord APIへの応答が3秒以内に間に合わずタイムアウトしました。Discordの遅延が原因の可能性が高いです。');
      return;
    }

    try {
      await joinChannel(voiceChannel);
      setGuildConfig(guild.id, { voiceChannelId: voiceChannel.id });

      const embed = new EmbedBuilder()
        .setColor('#A5D6A7') // Zundamon Light Green
        .setTitle('接続しました')
        .setDescription(
          `🔊 **${voiceChannel.name}** に接続しました。\n\n` +
          `[ダッシュボード/設定](http://localhost:3000) | [利用規約](#) | [お問い合わせ](#)\n\n` +
          `**お知らせ:**\n` +
          `|\n` +
          `ずんだもん読み上げBOTをご利用いただきありがとうございます。\n` +
          `ダッシュボードから詳細な詳細な権限管理や使用状況のアナリティクスを確認できますのだ。\n\n` +
          `Tips: 読み上げるテキストチャンネルは \`/setchannel\` で設定できますのだ！`
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('[join]', err);
      await interaction.editReply('❌ ボイスチャンネルへの参加に失敗しました。');
    }
    return;
  }

  // ── /leave ─────────────────────────────────────────────────────
  if (commandName === 'leave') {
    if (!isConnected(guild.id)) {
      return interaction.reply({
        content: '❌ ボイスチャンネルに参加していません。',
        flags: [MessageFlags.Ephemeral],
      });
    }
    leaveChannel(guild.id);
    setGuildConfig(guild.id, { voiceChannelId: null });
    return interaction.reply({ content: '👋 退出しました！', flags: [MessageFlags.Ephemeral] });
  }

  // ── /setchannel ────────────────────────────────────────────────
  if (commandName === 'setchannel') {
    const channel = interaction.options.getChannel('channel');
    if (!channel?.isTextBased()) {
      return interaction.reply({
        content: '❌ テキストチャンネルを選択してください。',
        flags: [MessageFlags.Ephemeral],
      });
    }
    setGuildConfig(guild.id, { textChannelId: channel.id });
    return interaction.reply({
      content: `✅ <#${channel.id}> のメッセージを読み上げます！`,
      flags: [MessageFlags.Ephemeral],
    });
  }

  // ── /setvoice ────────────────────────────────────────────────
  if (commandName === 'setvoice') {
    const voiceId = interaction.options.getInteger('voiceid');
    const cfg = getFullGuildConfig(guild.id).settings;
    const userVoices = cfg.userVoices || {};
    userVoices[interaction.user.id] = voiceId;
    setGuildConfig(guild.id, { userVoices });
    return interaction.reply({
      content: `✅ あなたの読み上げる声を話者ID **${voiceId}** に設定しました！`,
      flags: [MessageFlags.Ephemeral],
    });
  }

  // ── /voiceparams (per-user) ───────────────────────────────────
  if (commandName === 'voiceparams') {
    const speed = interaction.options.getNumber('speed');
    const pitch = interaction.options.getNumber('pitch');
    const volume = interaction.options.getNumber('volume');

    if (speed !== null && !checkPermission(guild.id, 'voiceparams speed', member)) {
      return interaction.reply({ content: '🚫 速度(speed)を変更する権限がありません。', flags: [MessageFlags.Ephemeral] });
    }
    if (pitch !== null && !checkPermission(guild.id, 'voiceparams pitch', member)) {
      return interaction.reply({ content: '🚫 ピッチ(pitch)を変更する権限がありません。', flags: [MessageFlags.Ephemeral] });
    }
    if (volume !== null && !checkPermission(guild.id, 'voiceparams volume', member)) {
      return interaction.reply({ content: '🚫 音量(volume)を変更する権限がありません。', flags: [MessageFlags.Ephemeral] });
    }

    const cfg = getFullGuildConfig(guild.id).settings;
    const userParams = cfg.userParams || {};
    const myParams = userParams[interaction.user.id] || {};

    if (speed !== null) myParams.speed = speed;
    if (pitch !== null) myParams.pitch = pitch;
    if (volume !== null) myParams.volume = volume;

    if (speed !== null || pitch !== null || volume !== null) {
      userParams[interaction.user.id] = myParams;
      setGuildConfig(guild.id, { userParams });
      return interaction.reply({
        content: `✅ あなた専用の声設定を更新しました！\n速度: ${myParams.speed ?? 'デフォルト'}, ピッチ: ${myParams.pitch ?? 'デフォルト'}, 音量: ${myParams.volume ?? 'デフォルト'}`,
        flags: [MessageFlags.Ephemeral],
      });
    } else {
      return interaction.reply({
        content: '⚠️ 変更するパラメータを指定してください。',
        flags: [MessageFlags.Ephemeral],
      });
    }
  }

  // ── /chatmode ────────────────────────────────────────────────
  if (commandName === 'chatmode') {
    try {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    } catch (err) {
      console.warn('⚠️ [chatmode] Interaction timeout:', err.message);
      return;
    }

    const enabled = interaction.options.getBoolean('enabled');
    
    if (!enabled) {
      setGuildConfig(guild.id, { chatMode: false, chatModeUserId: null });
      cancelAiGeneration(guild.id);
      return interaction.editReply('✅ AIによる自然会話モードを **オフ** にしたのだ。');
    }

    setGuildConfig(guild.id, { chatMode: true, chatModeUserId: interaction.user.id });

    if (isWhisperReady()) {
      return interaction.editReply('✅ AIによる自然会話モードを **オン** にしたのだ！ ボイスチャンネルで話しかけてみるのだ！');
    }

    await interaction.editReply('⏳ AIモードをオンにするのだ！Whisperモデルを起動中なのだ…少し待ってほしいのだ！');

    const cfg = getFullGuildConfig(guild.id).settings;
    const textChannel = cfg.textChannelId
      ? guild.channels.cache.get(cfg.textChannelId)
      : null;

    if (textChannel?.isTextBased()) {
      await textChannel.send(
        '🤖 ずんだもんのAIモードを起動するのだ！\n' +
        'Whisperモデルを読み込んでいるのだ…ちょっとだけ待ってほしいのだ！⏳'
      );
    }

    preloadWhisper();

    onWhisperReady(async () => {
      try {
        if (textChannel?.isTextBased()) {
          await textChannel.send(
            '✅ 準備できたのだ！これからボイスチャンネルで話しかけてくれたら、ずんだもんが答えるのだ！🎤'
          );
        }
        enqueue(guild.id, '準備ができたのだ！これからボイスチャンネルでお喋りできるのだ！');
      } catch (err) {
        console.error('[chatmode] Failed to send ready message:', err.message);
      }
    });

    return;
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
      .setTitle(`📊 サーバー設定ステータス`)
      .setAuthor({ name: guild.name, iconURL: guild.iconURL() })
      .addFields(
        {
          name: '📡 接続状況',
          value: `🔊 ボイス接続: ${connected ? '✅ 接続中' : '❌ 未接続'}\n📢 ボイスチャンネル: ${cfg.voiceChannelId ? `<#${cfg.voiceChannelId}>` : '未設定'}\n📝 読み上げチャンネル: ${cfg.textChannelId ? `<#${cfg.textChannelId}>` : '未設定'}`,
          inline: false
        },
        {
          name: '🎙️ 音声設定',
          value: `🎤 デフォルト話者ID: ${cfg.speakerId !== undefined ? cfg.speakerId : 'ずんだもん (3)'}\n⚙️ デフォルト声設定: 速度=${cfg.speed ?? 1.0}, ピッチ=${cfg.pitch ?? 0.0}, 音量=${cfg.volume ?? 1.0}\n👤 名前読み上げ: ${cfg.readName === false ? '❌ オフ' : '✅ オン'}\n🚪 入退室読み上げ: ${cfg.announceVoice ? '✅ オン' : '❌ オフ'}`,
          inline: false
        },
        {
          name: '🤖 AI・システム設定',
          value: `💬 AI会話モード: ${cfg.chatMode ? '✅ オン' : '❌ オフ'}\n🎙️ チャット使用ユーザー: ${cfg.chatModeUserId ? `<@${cfg.chatModeUserId}>` : '全員'}\n📢 サウンドボード: ${cfg.soundboardMode ? '✅ オン' : '❌ オフ'}\n✂️ 文字数制限: ${cfg.trimWordCount ? `${cfg.trimWordCount}文字` : '無制限'}`,
          inline: false
        },
        {
          name: '🎵 カラオケモード',
          value: `状態: ${cfg.karaokeMode ? '✅ オン' : '❌ オフ'}\n音量: ${cfg.karaokeVolume ?? 1.0}`,
          inline: true
        },
        {
          name: '🔒 権限ルール',
          value: ruleCount > 0 ? `${ruleCount}件設定済み (\`/permissions list\`)` : 'なし (全員に開放)',
          inline: true
        }
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
  }

  // ── /mystatus ──────────────────────────────────────────────────
  if (commandName === 'mystatus') {
    const cfg = getFullGuildConfig(guild.id).settings;
    const userId = interaction.user.id;

    // User voice ID
    const voiceId = cfg.userVoices?.[userId];
    // User params
    const myParams = cfg.userParams?.[userId] || {};

    const embed = new EmbedBuilder()
      .setColor('#81C784')
      .setAuthor({ name: interaction.user.username, iconURL: interaction.user.displayAvatarURL() })
      .setTitle('🎤 あなたの声設定')
      .setDescription('サーバー設定（デフォルト）よりもこの個人設定が優先されますのだ！')
      .addFields(
        { name: '🔊 話者ID', value: `${voiceId !== undefined ? voiceId : `デフォルト (${cfg.speakerId ?? 3})`}`, inline: true },
        { name: '⚡ 速度 (Speed)', value: `${myParams.speed ?? cfg.speed ?? 1.0}${myParams.speed !== undefined ? '' : ' *(鯖デフォ)*'}`, inline: true },
        { name: '🎵 ピッチ (Pitch)', value: `${myParams.pitch ?? cfg.pitch ?? 0.0}${myParams.pitch !== undefined ? '' : ' *(鯖デフォ)*'}`, inline: true },
        { name: '🔈 音量 (Volume)', value: `${myParams.volume ?? cfg.volume ?? 1.0}${myParams.volume !== undefined ? '' : ' *(鯖デフォ)*'}`, inline: true }
      );

    return interaction.reply({ embeds: [embed], flags: [MessageFlags.Ephemeral] });
  }

  // ── /voices ──────────────────────────────────────────────────
  if (commandName === 'voices') {
    const voicesText = [
      '**📢 主なVOICEVOX話者ID一覧**',
      '1 : ずんだもん (あまあま)',
      '3 : ずんだもん (ノーマル)',
      '5 : ずんだもん (セクシー)',
      '7 : ずんだもん (ツンツン)',
      '2 : 四国めたん (あまあま)',
      '4 : 四国めたん (ノーマル)',
      '6 : 四国めたん (セクシー)',
      '8 : 四国めたん (ツンツン)',
      '10: 雨晴はう (ノーマル)',
      '13: 青山龍星 (ノーマル)',
      '14: 冥鳴ひまり (ノーマル)',
      '16: 九州そら (あまあま)',
      '',
      '*※ その他の話者IDはVOICEVOX公式サイトまたはアプリで確認できます。*'
    ].join('\n');
    return interaction.reply({ content: voicesText, flags: [MessageFlags.Ephemeral] });
  }

  // ── /readname ────────────────────────────────────────────────
  if (commandName === 'readname') {
    const enabled = interaction.options.getBoolean('enabled');
    setGuildConfig(guild.id, { readName: enabled });
    return interaction.reply({
      content: `✅ 発言者の名前読み上げを **${enabled ? 'オン' : 'オフ'}** にしました！`,
      flags: [MessageFlags.Ephemeral],
    });
  }

  // ── Dictionary Commands ──────────────────────────────────────
  if (commandName === 'addword') {
    const bad = interaction.options.getString('wrong');
    const good = interaction.options.getString('correct');
    const cfg = getFullGuildConfig(guild.id).settings;
    const dict = cfg.whisperDict || {};
    dict[bad] = good;
    setGuildConfig(guild.id, { whisperDict: dict });
    return interaction.reply({ content: `✅ **辞書に登録したのだ！**\n❌「${bad}」 👉 ⭕「${good}」`, flags: [MessageFlags.Ephemeral] });
  }

  if (commandName === 'delword') {
    const bad = interaction.options.getString('wrong');
    const cfg = getFullGuildConfig(guild.id).settings;
    const dict = cfg.whisperDict || {};
    if (dict[bad]) {
      delete dict[bad];
      setGuildConfig(guild.id, { whisperDict: dict });
      return interaction.reply({ content: `🗑️ 辞書から「${bad}」を削除したのだ！`, flags: [MessageFlags.Ephemeral] });
    } else {
      return interaction.reply({ content: `⚠️ 辞書に「${bad}」は見つからないのだ。`, flags: [MessageFlags.Ephemeral] });
    }
  }

  if (commandName === 'listwords') {
    const cfg = getFullGuildConfig(guild.id).settings;
    const dict = cfg.whisperDict || {};
    const entries = Object.entries(dict);
    if (entries.length === 0) {
      return interaction.reply({ content: `📝 辞書にはまだ何も登録されていないのだ！`, flags: [MessageFlags.Ephemeral] });
    }
    const lines = entries.map(([b, g]) => `・ ${b} 👉 ${g}`);
    return interaction.reply({ content: `📝 **現在のユーザー辞書 (${entries.length}件)**\n${lines.join('\n')}`, flags: [MessageFlags.Ephemeral] });
  }

  // ── /announce ────────────────────────────────────────────────
  if (commandName === 'announce') {
    const enabled = interaction.options.getBoolean('enabled');
    setGuildConfig(guild.id, { announceVoice: enabled });
    return interaction.reply({
      content: `✅ ボイスチャンネルの入退室読み上げを **${enabled ? 'オン' : 'オフ'}** にしました！`,
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
        content: `✂️ 読み上げる最大文字数を **${wordcount}文字** に設定しました！\n超過する場合は「以下略」と読み上げます。`,
        flags: [MessageFlags.Ephemeral],
      });
    } else {
      return interaction.reply({
        content: '✂️ 文字数制限を **無効** にしました！',
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
          content: `❌ 「${cmdName}」は存在しないコマンドです。\n有効なコマンド: ${ALL_COMMAND_NAMES.join(', ')}`,
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
        content: `✅ \`/${cmdName}\` → ${mention} を **${action === 'allow' ? '許可' : '拒否'}** に設定しました！${suffix}`,
        flags: [MessageFlags.Ephemeral],
      });
    }

    if (subcommand === 'list') {
      const fullCfg = getFullGuildConfig(guild.id);
      const perms = fullCfg.permissions || {};
      const entries = Object.entries(perms);

      if (entries.length === 0) {
        return interaction.reply({
          content: '📋 権限ルールはまだ設定されていません。すべてのコマンドが全員に開放されています。',
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
          content: `⚠️ \`/${cmdName}\` には権限ルールが設定されていません。`,
          flags: [MessageFlags.Ephemeral],
        });
      }

      delete perms[cmdName];
      updateGuildMeta(guild.id, { permissions: perms });

      return interaction.reply({
        content: `🗑️ \`/${cmdName}\` の権限ルールをリセットしました！`,
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
          { cmd: 'join', desc: 'ボイスチャンネルに参加' },
          { cmd: 'leave', desc: 'ボイスチャンネルから退出' },
          { cmd: 'setchannel', desc: '読み上げ対象のテキストチャンネルを指定' },
          { cmd: 'serverstatus', desc: 'サーバー設定と接続状態を確認' },
          { cmd: 'mystatus', desc: 'あなたの現在の声設定を確認' },
          { cmd: 'help', desc: 'このヘルプを表示' }
        ]
      },
      {
        name: '🔊 声の設定',
        commands: [
          { cmd: 'setvoice', desc: '自分専用の声を話者名で指定' },
          { cmd: 'servervoice', desc: 'サーバー全体のデフォルト話者を指定' },
          { cmd: 'voiceparams', desc: '速度・ピッチ・音量を個人設定' },
          { cmd: 'servervoiceparams', desc: 'サーバー全体の音声パラメータを指定' },
          { cmd: 'readname', desc: '発言者の名前読み上げ (オン/オフ)' },
          { cmd: 'announce', desc: '入退室読み上げ (オン/オフ)' },
          { cmd: 'trim', desc: '読み上げ最大文字数を設定' },
          { cmd: 'customsound', desc: 'サウンドボード音源を管理' },
          { cmd: 'customemoji', desc: 'カスタム絵文字の読み上げ辞書を管理' },
          { cmd: 'soundboard', desc: 'サウンドボード反応モード (オン/オフ)' }
        ]
      },
      {
        name: '🤖 AI会話 & 辞書',
        commands: [
          { cmd: 'chatmode', desc: 'AI音声会話モードのオン/オフ' },
          { cmd: 'addword', desc: 'Whisper誤認識を補正する辞書に登録' },
          { cmd: 'delword', desc: '辞書ルールを削除' },
          { cmd: 'listwords', desc: '辞書ルール一覧' }
        ]
      },
      {
        name: '🎵 カラオケモード',
        commands: [
          { cmd: 'play', desc: 'YouTubeから曲を再生 (使うとカラオケモードがオンになります)' },
          { cmd: 'pause', desc: '音楽の一時停止 / 再開' },
          { cmd: 'skip', desc: '現在の曲をスキップ' },
          { cmd: 'queue', desc: '再生中・待機中の曲リストとループ状態を表示' },
          { cmd: 'loop', desc: '音楽のループ再生を設定 (オフ/1曲/全曲)' },
          { cmd: 'lyrics', desc: '再生中の曲の歌詞を表示' },
          { cmd: 'musicvolume', desc: 'BGM音量を設定' }
        ]
      },
      {
        name: '🔒 サーバー管理（オーナー等）',
        commands: [
          { cmd: 'permissions', desc: 'ロール設定やユーザー例外でコマンド等を許可/拒否' },
          { cmd: 'cleanchat', desc: 'チャンネルのBOTメッセージを定期自動削除' }
        ]
      }
    ];

    const allowedFields = [];
    for (const category of categories) {
      const allowedCommands = category.commands.filter(c => checkPermission(guild.id, c.cmd, member));
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
      content: `✅ サウンドボードモードを **${enabled ? 'オン' : 'オフ'}** にしました！`,
      flags: [MessageFlags.Ephemeral],
    });
  }

  // ── /play ──────────────────────────────────────────────────────
  if (commandName === 'play') {
    const voiceChannel = member?.voice?.channel;
    if (!voiceChannel && !isConnected(guild.id)) {
      return interaction.reply({ content: '❌ まずボイスチャンネルに参加してください！', flags: [MessageFlags.Ephemeral] });
    }

    // Auto-enable karaoke mode and disable chat mode
    setGuildConfig(guild.id, { karaokeMode: true, chatMode: false });
    
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
        return interaction.editReply(`❌ 指定された曲が見つからなかった、または読み込めなかったのだ。`);
      }
      return interaction.editReply(result);
    } catch (err) {
      console.error('[Play] Error:', err);
      return interaction.editReply(`❌ 曲の処理中にエラーが発生したのだ。`);
    }
  }

  // ── /pause ─────────────────────────────────────────────────────
  if (commandName === 'pause') {
    const isPaused = pauseMusic(guild.id);
    if (isPaused === null) {
      return interaction.reply({ content: `❌ 現在何も再生されていないのだ。`, flags: [MessageFlags.Ephemeral] });
    }
    return interaction.reply({ content: isPaused ? `⏸️ 音楽を一時停止したのだ。` : `▶️ 音楽を再開したのだ！` });
  }

  // ── /skip ──────────────────────────────────────────────────────
  if (commandName === 'skip') {
    const skipped = skipMusic(guild.id);
    if (!skipped) {
      return interaction.reply({ content: `❌ スキップできる曲がないのだ。`, flags: [MessageFlags.Ephemeral] });
    }
    return interaction.reply({ content: `⏭️ 現在の曲をスキップしたのだ！` });
  }

  // ── /queue ─────────────────────────────────────────────────────
  if (commandName === 'queue') {
    const q = getQueue(guild.id);
    if (!q || (!q.current && q.upcoming.length === 0)) {
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
      return interaction.reply({ content: `❌ 現在何も再生されていないため、歌詞を表示できないのだ。`, flags: [MessageFlags.Ephemeral] });
    }

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    try {
      // 1. Try LRCLIB (Global/Spotify)
      let cleanTitle = q.current.title;
      // Extract from Japanese quotes if present (usually denotes the song name)
      const quoteMatch = cleanTitle.match(/[「『](.+?)[」』]/);
      if (quoteMatch && quoteMatch[1]) {
        cleanTitle = quoteMatch[1];
      } else {
        // Aggressive fallback cleaning for covers / utattemita
        cleanTitle = cleanTitle
          .replace(/\[.*?\]|\(.*?\)|【.*?】/g, ' ')
          .replace(/Music Video|Official\s*(Video|Audio|Music Video)?|MV|ft\.|feat\.|Lyric Video/gi, ' ')
          .replace(/歌ってみた|を歌ってみた|cover(ed by| by)?|弾いてみた|叩いてみた|off vocal|instrumental|inst|Remix/gi, ' ')
          .split(/\/|／|\||｜/)[0]
          .replace(/\s+/g, ' ')
          .trim();
      }
      let lyrics = null;
      let source = 'LRCLIB';

      try {
        const res = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(cleanTitle)}`);
        const data = await res.json();
        if (data && data[0] && data[0].plainLyrics) {
          lyrics = data[0].plainLyrics;
        }
      } catch (e) { console.warn('[Lyrics] LRCLIB failed:', e.message); }

      // 2. Fallback to PetitLyrics (Japanese Focus)
      if (!lyrics) {
        try {
          lyrics = await fetchPetitLyrics(cleanTitle);
          if (lyrics) source = 'PetitLyrics';
        } catch (e) { console.warn('[Lyrics] PetitLyrics failed:', e.message); }
      }

      if (!lyrics) {
        return interaction.editReply(`❌ 歌詞データベース（LRCLIB/PetitLyrics）に見つからなかったのだ。申し訳ないのだ。`);
      }

      // Format and send
      const footer = `\n\n*(Source: ${source})*`;
      if (lyrics.length > (1900 - footer.length)) {
        lyrics = lyrics.substring(0, 1800) + '...';
      }

      return interaction.editReply({
        content: `🎶 **${q.current.title}** の歌詞なのだ:\n\n${lyrics}${footer}`,
        flags: [MessageFlags.Ephemeral]
      });
    } catch (err) {
      console.error('[Lyrics] General Error:', err);
      return interaction.editReply(`❌ 歌詞の取得中にエラーが発生したのだ。`);
    }
  }

  // ── /musicvolume ────────────────────────────────────────────────
  if (commandName === 'musicvolume') {
    const vol = interaction.options.getNumber('volume');
    setGuildConfig(guild.id, { karaokeVolume: vol });
    return interaction.reply({ content: `🎵 カラオケモードの音量を **${vol}** に設定したのだ！`, flags: [MessageFlags.Ephemeral] });
  }

  // ── /servervoice ────────────────────────────────────────────────
  if (commandName === 'servervoice') {
    const vid = interaction.options.getInteger('voiceid');
    setGuildConfig(guild.id, { speakerId: vid });
    return interaction.reply({ content: `🎤 サーバー全体のデフォルト話者IDを **${vid}** に設定したのだ！` });
  }

  // ── /servervoiceparams ──────────────────────────────────────────
  if (commandName === 'servervoiceparams') {
    const s = interaction.options.getNumber('speed');
    const p = interaction.options.getNumber('pitch');
    const v = interaction.options.getNumber('volume');

    if (s !== null && !checkPermission(guild.id, 'servervoiceparams speed', member)) {
      return interaction.reply({ content: '🚫 速度(speed)のデフォルトを変更する権限がありません。', flags: [MessageFlags.Ephemeral] });
    }
    if (p !== null && !checkPermission(guild.id, 'servervoiceparams pitch', member)) {
      return interaction.reply({ content: '🚫 ピッチ(pitch)のデフォルトを変更する権限がありません。', flags: [MessageFlags.Ephemeral] });
    }
    if (v !== null && !checkPermission(guild.id, 'servervoiceparams volume', member)) {
      return interaction.reply({ content: '🚫 音量(volume)のデフォルトを変更する権限がありません。', flags: [MessageFlags.Ephemeral] });
    }

    const cfg = getFullGuildConfig(guild.id).settings;
    if (s !== null) cfg.speed = s;
    if (p !== null) cfg.pitch = p;
    if (v !== null) cfg.volume = v;
    setGuildConfig(guild.id, { speed: cfg.speed, pitch: cfg.pitch, volume: cfg.volume });
    return interaction.reply({ content: `⚙️ サーバー全体の声のデフォルト設定を更新したのだ！\n速度=${cfg.speed??1}, ピッチ=${cfg.pitch??0}, 音量=${cfg.volume??1}` });
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
      return interaction.reply({ content: `📝 **登録済みのカスタム音源 (${keys.length}件)**\n${keys.map(k => `・ ${k}`).join('\n')}`, flags: [MessageFlags.Ephemeral] });
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
      return interaction.reply({ content: `📝 **登録済みの絵文字 (${keys.length}件)**\n${listStr}`, flags: [MessageFlags.Ephemeral] });
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
      const channel = client.channels.cache.get(channelId);
      if (!channel) return;
      
      const permissions = channel.permissionsFor(channel.guild?.members?.me);
      if (!permissions || !permissions.has(PermissionFlagsBits.ManageMessages) || !permissions.has(PermissionFlagsBits.ReadMessageHistory)) {
        console.warn(`[CleanChat] ⚠️ Missing manage messages permissions in #${channel.name} (${guildId}). Cleanup skipped.`);
        return;
      }

      const messages = await channel.messages.fetch({ limit: 100 });
      const cutoff = Date.now() - intervalMs;
      const oldMessages = messages.filter(m => m.createdTimestamp < cutoff);

      if (oldMessages.size === 0) return;

      const bulkDeletable = oldMessages.filter(m => (Date.now() - m.createdTimestamp) < 14 * 24 * 60 * 60 * 1000);

      if (bulkDeletable.size > 1) {
        await channel.bulkDelete(bulkDeletable, true);
        console.log(`[G:${guildId}] [CleanChat] Bulk deleted ${bulkDeletable.size} messages in ${channel.name}`);
      } else if (bulkDeletable.size === 1) {
        await bulkDeletable.first().delete();
        console.log(`[G:${guildId}] [CleanChat] Deleted 1 message in ${channel.name}`);
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

/**
 * Custom fetcher for PetitLyrics (Japanese songs)
 * @param {string} title 
 * @returns {Promise<string|null>}
 */
/**
 * Custom fetcher for PetitLyrics (Japanese songs)
 * Uses the stable internal API with a static client key to avoid CSRF/Session issues.
 * @param {string} title 
 * @returns {Promise<string|null>}
 */
async function fetchPetitLyrics(title) {
  try {
    // PetitLyrics internal XML API endpoint
    // Using a known public client_id and search priority 2 (text lyrics)
    const url = `http://pl.t.petitlyrics.com/api/get_lyrics.php?title=${encodeURIComponent(title)}&client_id=p7PetitlyricsAndroid&key=VvVz_98&priority=2`;
    const res = await axios.get(url);
    const xml = res.data;

    // Extract Base64 encoded lyricsData field from the XML response
    const match = xml.match(/<lyricsData>(.*?)<\/lyricsData>/);
    if (!match || !match[1]) return null;

    const base64Data = match[1];
    const decoded = Buffer.from(base64Data, 'base64').toString('utf8');
    
    // Normalize newlines and trim
    return decoded.replace(/\r\n/g, '\n').trim();
  } catch (err) {
    console.error('[PetitLyrics] API error:', err.message);
    return null;
  }
}
