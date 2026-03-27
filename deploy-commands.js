// deploy-commands.js
// Run this once to register slash commands globally with Discord.
// Usage: node deploy-commands.js

import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commandDefinitions } from './src/commands.js';

import { initBotConfig, getBotConfig } from './src/botConfig.js';

async function deploy() {
  await initBotConfig();

  const token = getBotConfig('DISCORD_TOKEN');
  const clientId = getBotConfig('CLIENT_ID');

  if (!token || !clientId) {
    console.error(
      '❌ DISCORD_TOKEN と CLIENT_ID が取得できません。Supabase Vault または .env を確認してください。'
    );
    process.exit(1);
  }

  const rest = new REST({ version: '10' }).setToken(token);

  console.log('🔄 スラッシュコマンドを登録中...');

  try {
    const data = await rest.put(Routes.applicationCommands(clientId), { body: commandDefinitions });
    console.log(`✅ ${data.length} 件のスラッシュコマンドを登録しました。`);
  } catch (error) {
    console.error(error);
  }
}

deploy();
