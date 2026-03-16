// src/commands.js
// Defines all slash command handlers

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { joinChannel, leaveChannel, isConnected, enqueue } from './player.js';
import { getGuildConfig, setGuildConfig } from './config.js';
import { preloadWhisper, isWhisperReady, onWhisperReady } from './ai.js';

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
    .setDescription('読み上げる声（話者ID）を設定します')
    .addIntegerOption((opt) =>
      opt
        .setName('voiceid')
        .setDescription('話者ID（例: 3=ずんだもん ノーマル）')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('voiceparams')
    .setDescription('声のオプション（速度、ピッチ、音量）を設定します')
    .addNumberOption((opt) => opt.setName('speed').setDescription('速度 (標準: 1.0)'))
    .addNumberOption((opt) => opt.setName('pitch').setDescription('ピッチ (標準: 0.0)'))
    .addNumberOption((opt) => opt.setName('volume').setDescription('音量 (標準: 1.0)')),

  new SlashCommandBuilder()
    .setName('chatmode')
    .setDescription('AIによる書き起こし＋自然会話モードを切り替えます')
    .addBooleanOption((opt) => opt.setName('enabled').setDescription('有効にする (True) または 無効にする (False)').setRequired(true)),
    
  new SlashCommandBuilder()
    .setName('status')
    .setDescription('現在の設定と接続状態を表示します'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('ボットのコマンド一覧と使い方を表示します'),
  new SlashCommandBuilder()
    .setName('voices')
    .setDescription('利用可能な主な話者（声）の一覧を表示します'),

  new SlashCommandBuilder()
    .setName('readname')
    .setDescription('発言者の名前を読み上げるかどうかを設定します')
    .addBooleanOption((opt) =>
      opt
        .setName('enabled')
        .setDescription('名前を読み上げる (True) または 読み上げない (False)')
        .setRequired(true)
    ),
].map((cmd) => cmd.toJSON());

/**
 * Handles an incoming slash command interaction.
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function handleCommand(interaction) {
  const { commandName, guild, member } = interaction;

  if (!guild) {
    return interaction.reply({
      content: 'このコマンドはサーバー内でのみ使用できます。',
      flags: [MessageFlags.Ephemeral], // MessageFlags.Ephemeral
    });
  }

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
      await interaction.editReply(
        `✅ **${voiceChannel.name}** に参加しました！\n\`/setchannel\` で読み上げるテキストチャンネルを設定してください。`
      );
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
    setGuildConfig(guild.id, { speakerId: voiceId });
    return interaction.reply({
      content: `✅ 読み上げる声を話者ID **${voiceId}** に設定しました！`,
      flags: [MessageFlags.Ephemeral],
    });
  }

  // ── /voiceparams ──────────────────────────────────────────────
  if (commandName === 'voiceparams') {
    const speed = interaction.options.getNumber('speed');
    const pitch = interaction.options.getNumber('pitch');
    const volume = interaction.options.getNumber('volume');

    const updates = {};
    if (speed !== null) updates.speed = speed;
    if (pitch !== null) updates.pitch = pitch;
    if (volume !== null) updates.volume = volume;

    if (Object.keys(updates).length > 0) {
      setGuildConfig(guild.id, updates);
      return interaction.reply({
        content: `✅ 声の設定を更新しました！\n速度: ${updates.speed ?? '変更なし'}, ピッチ: ${updates.pitch ?? '変更なし'}, 音量: ${updates.volume ?? '変更なし'}`,
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
    const enabled = interaction.options.getBoolean('enabled');
    setGuildConfig(guild.id, { chatMode: enabled });

    try {
      // First, acknowledge the interaction to prevent 3s timeout
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
    } catch (err) {
      console.warn('⚠️ [chatmode] Interaction timeout:', err.message);
      return;
    }

    if (!enabled) {
      return interaction.editReply('✅ AIによる自然会話モードを **オフ** にしたのだ。');
    }

    // ── Chatmode ON ──────────────────────────────────────────────
    // If Whisper is already ready, just confirm immediately
    if (isWhisperReady()) {
      return interaction.editReply('✅ AIによる自然会話モードを **オン** にしたのだ！ ボイスチャンネルで話しかけてみるのだ！');
    }

    // Whisper is not yet loaded — edit the response and send a channel notice
    await interaction.editReply('⏳ AIモードをオンにするのだ！Whisperモデルを起動中なのだ…少し待ってほしいのだ！');

    // Find the configured text channel to post public status messages
    const cfg = getGuildConfig(guild.id);
    const textChannel = cfg.textChannelId
      ? guild.channels.cache.get(cfg.textChannelId)
      : null;

    if (textChannel?.isTextBased()) {
      await textChannel.send(
        '🤖 ずんだもんのAIモードを起動するのだ！\n' +
        'Whisperモデルを読み込んでいるのだ…ちょっとだけ待ってほしいのだ！⏳'
      );
    }

    // Kick off background loading
    preloadWhisper();

    // When ready, send a follow-up message in the text channel and speak in voice
    onWhisperReady(async () => {
      try {
        if (textChannel?.isTextBased()) {
          await textChannel.send(
            '✅ 準備できたのだ！これからボイスチャンネルで話しかけてくれたら、ずんだもんが答えるのだ！🎤'
          );
        }
        // Speak in voice channel to notify
        enqueue(guild.id, '準備ができたのだ！これからボイスチャンネルでお喋りできるのだ！');
      } catch (err) {
        console.error('[chatmode] Failed to send ready message:', err.message);
      }
    });

    return;
  }

  // ── /status ────────────────────────────────────────────────────
  if (commandName === 'status') {
    const cfg = getGuildConfig(guild.id);
    const connected = isConnected(guild.id);
    const lines = [
      `🔊 ボイス接続: ${connected ? '✅ 接続中' : '❌ 未接続'}`,
      cfg.voiceChannelId
        ? `📢 ボイスチャンネル: <#${cfg.voiceChannelId}>`
        : '📢 ボイスチャンネル: 未設定',
      cfg.textChannelId
        ? `📝 読み上げチャンネル: <#${cfg.textChannelId}>`
        : '📝 読み上げチャンネル: 未設定',
      `🎤 話者ID: ${cfg.speakerId !== undefined ? cfg.speakerId : 'デフォルト (ずんだもん)'}`,
      `⚙️ 声の設定: 速度=${cfg.speed ?? 1.0}, ピッチ=${cfg.pitch ?? 0.0}, 音量=${cfg.volume ?? 1.0}`,
      `💬 AI会話モード: ${cfg.chatMode ? '✅ オン' : '❌ オフ'}`,
      `👤 名前読み上げ: ${cfg.readName === false ? '❌ オフ' : '✅ オン'}`,
    ];
    return interaction.reply({ content: lines.join('\n'), flags: [MessageFlags.Ephemeral] });
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

  // ── /help ──────────────────────────────────────────────────────
  if (commandName === 'help') {
    const helpText = [
      '**📢 ずんだもん ボイス読み上げボット コマンド一覧**',
      '',
      '🔹 `/join` - 現在あなたが参加しているボイスチャンネルにボットを呼びます',
      '🔹 `/leave` - ボットをボイスチャンネルから退出させます',
      '🔹 `/setchannel <チャンネル>` - 読み上げ対象のテキストチャンネルを設定します',
      '🔹 `/setvoice <話者ID>` - 読み上げる声（話者ID）を変更します',
      '🔹 `/voices` - 利用可能な主な話者（声）のID一覧を表示します',
      '🔹 `/readname <True/False>` - 発言者の名前を読み上げるかどうかを設定します',
      '🔹 `/status` - 現在のボットの接続状態や設定を確認します',
      '🔹 `/help` - このヘルプメッセージを表示します',
      '',
      '*※ 話者IDはVOICEVOXの仕様に準拠します。一覧は公式サイト等をご確認ください。*'
    ].join('\n');
    return interaction.reply({ content: helpText, flags: [MessageFlags.Ephemeral] });
  }
}
