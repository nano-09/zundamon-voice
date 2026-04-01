import { processSearchCommand } from './src/ai.js';

async function test() {
  console.log("Testing processSearchCommand...");
  try {
    const res = await processSearchCommand('test-guild-id', 'test-user-id', '東京の天気について教えて');
    console.log("Result:", res);
  } catch (e) {
    console.error("Error:", e);
  } finally {
    process.exit();
  }
}
test();
