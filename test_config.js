import 'dotenv/config';
import { initBotConfig, getAllBotConfig } from './src/botConfig.js';

async function test() {
  await initBotConfig();
  console.log("Configs:", getAllBotConfig());
  process.exit();
}
test();
