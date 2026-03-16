// src/index.js
// Main entry point for the Zundamon Discord TTS bot

import 'dotenv/config';
import { Client, GatewayIntentBits, Events, REST, Routes, MessageFlags } from 'discord.js';
import { commandDefinitions, handleCommand } from './commands.js';
import { enqueue, leaveChannel } from './player.js';
import { getGuildConfig } from './config.js';

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
  ],
});

// ── Ready ─────────────────────────────────────────────────────────────────────
client.once(Events.ClientReady, (c) => {
  console.log(`✅ ログイン成功: ${c.user.tag}`);
  console.log(`   VOICEVOX: ${process.env.VOICEVOX_URL || 'http://localhost:50021'}`);
  console.log(`   スピーカー ID: ${process.env.VOICEVOX_SPEAKER || '3'} (ずんだもん)`);
});

// ── Slash command interactions ────────────────────────────────────────────────
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await handleCommand(interaction);
  } catch (err) {
    console.error('[InteractionCreate]', err);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: '❌ エラーが発生しました。', flags: [MessageFlags.Ephemeral] }).catch(() => {});
    } else {
      await interaction.reply({ content: '❌ エラーが発生しました。', flags: [MessageFlags.Ephemeral] }).catch(() => {});
    }
  }
});

// ── Message listener → TTS ───────────────────────────────────────────────────
client.on(Events.MessageCreate, async (message) => {
  // Ignore bots (including self)
  if (message.author.bot) return;
  if (!message.guild) return;

  const cfg = getGuildConfig(message.guild.id);

  // Only process messages in the configured text channel
  if (!cfg.textChannelId || message.channel.id !== cfg.textChannelId) return;

  // Build the text to read:
  // - Strip mention syntax (<@123>, <@!123>, <#123>, <@&123>)
  // - Strip custom emoji syntax <:name:id> and <a:name:id>
  // - Strip URLs
  // - Collapse whitespace
  let text = message.content
    .replace(/<a?:\w+:\d+>/g, '')   // custom emoji
    .replace(/<[@#&!]\d+>/g, '')    // mentions
    .replace(/https?:\/\/\S+/g, 'URL') // URLs → "URL"
    .replace(/\s+/g, ' ')
    .trim();

  // Handle attachments/embeds with no text
  if (!text) {
    if (message.attachments.size > 0) text = '添付ファイル';
    else if (message.embeds.length > 0) text = 'リンク';
    else return; // nothing to say
  }

  // Prepend the author's display name
  const name = message.member?.displayName ?? message.author.username;
  const fullText = `${name}。${text}`;

  enqueue(message.guild.id, fullText);
});

// ── Auto-disconnect on empty voice channel ────────────────────────────────────
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  // We only care if someone leaves or moves channels
  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    const channel = oldState.channel;
    if (channel) {
      // Check if the bot is in this channel
      const botMember = channel.members.get(client.user.id);
      if (botMember) {
        // Count non-bot members
        const humanMembers = channel.members.filter(m => !m.user.bot);
        if (humanMembers.size === 0) {
          leaveChannel(oldState.guild.id);
        }
      }
    }
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
client.login(token);
