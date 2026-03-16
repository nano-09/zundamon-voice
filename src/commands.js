// src/commands.js
// Defines all slash command handlers

import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
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
    .setName('status')
    .setDescription('現在の設定と接続状態を表示します'),
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
      ephemeral: true,
    });
  }

  // ── /join ──────────────────────────────────────────────────────
  if (commandName === 'join') {
    const voiceChannel = member?.voice?.channel;
    if (!voiceChannel) {
      return interaction.reply({
        content: '❌ まずボイスチャンネルに参加してください！',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });
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
        ephemeral: true,
      });
    }
    leaveChannel(guild.id);
    return interaction.reply({ content: '👋 退出しました！', ephemeral: true });
  }

  // ── /setchannel ────────────────────────────────────────────────
  if (commandName === 'setchannel') {
    const channel = interaction.options.getChannel('channel');
    if (!channel?.isTextBased()) {
      return interaction.reply({
        content: '❌ テキストチャンネルを選択してください。',
        ephemeral: true,
      });
    }
    setGuildConfig(guild.id, { textChannelId: channel.id });
    return interaction.reply({
      content: `✅ <#${channel.id}> のメッセージを読み上げます！`,
      ephemeral: true,
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
    ];
    return interaction.reply({ content: lines.join('\n'), ephemeral: true });
  }
}
