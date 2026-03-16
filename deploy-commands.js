// deploy-commands.js
// Run this once to register slash commands globally with Discord.
// Usage: node deploy-commands.js

import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commandDefinitions } from './src/commands.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;

if (!token || !clientId) {
  console.error(
    '❌ DISCORD_TOKEN と CLIENT_ID を .env に設定してください。'
  );
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);

console.log('🔄 スラッシュコマンドを登録中...');

rest
  .put(Routes.applicationCommands(clientId), { body: commandDefinitions })
  .then((data) => {
    console.log(`✅ ${data.length} 件のスラッシュコマンドを登録しました。`);
  })
  .catch(console.error);
