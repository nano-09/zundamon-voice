import { initMcpClient, callMcpTool } from './src/mcpClient.js';

async function test() {
  console.log("Starting test...");
  try {
    await initMcpClient();
    console.log("Connected");
    const result = await callMcpTool('search', {
      query: "weather in tokyo",
      limit: 10,
      engines: ["duckduckgo"]
    });
    console.log("Result:", JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Error:", err);
  } finally {
    process.exit();
  }
}
test();
