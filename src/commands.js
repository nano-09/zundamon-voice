// src/commands.js
// Defines all slash command handlers

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { joinChannel, leaveChannel, isConnected } from './player.js';
import { getGuildConfig, setGuildConfig } from './config.js';

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
    .setName('status')
    .setDescription('現在の設定と接続状態を表示します'),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('ボットのコマンド一覧と使い方を表示します'),
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

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
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
    ];
    return interaction.reply({ content: lines.join('\n'), flags: [MessageFlags.Ephemeral] });
  }

  // ── /help ──────────────────────────────────────────────────────
  if (commandName === 'help') {
    const helpText = [
      '**📢 ずんだもん ボイス読み上げボット コマンド一覧**',
      '',
      '🔹 `/join` - 現在あなたが参加しているボイスチャンネルにボットを呼びます',
      '🔹 `/leave` - ボットをボイスチャンネルから退出させます',
      '🔹 `/setchannel <チャンネル>` - 読み上げ対象のテキストチャンネルを設定します',
      '🔹 `/setvoice <話者ID>` - 読み上げる声（話者ID）を変更します（例：3=ずんだもん ノーマル、2=四国めたん ノーマル）',
      '🔹 `/status` - 現在のボットの接続状態や設定を確認します',
      '🔹 `/help` - このヘルプメッセージを表示します',
      '',
      '*※ 話者IDはVOICEVOXの仕様に準拠します。一覧は公式サイト等をご確認ください。*'
    ].join('\n');
    return interaction.reply({ content: helpText, flags: [MessageFlags.Ephemeral] });
  }
}
