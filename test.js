import { searchWeb, searchSocial } from './src/search.js';

async function run() {
  console.log("Testing searchWeb...");
  const res1 = await searchWeb("バロラントっていうゲームがあるんだけど その情報を教えて");
  console.log("Web Result:\n", res1.substring(0, 300) + "...\n");

  console.log("Testing searchSocial...");
  const res2 = await searchSocial("最近話題のAIについてレディットの反応を教えて");
  console.log("Social Result:\n", res2.substring(0, 300) + "...\n");
}

run();
