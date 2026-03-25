import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

let mcpClient = null;

export async function initMcpClient() {
  if (mcpClient) return mcpClient;

  console.log('[MCP] Initializing open-websearch MCP server...');
  const transport = new StdioClientTransport({
    command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
    args: ['-y', 'open-websearch@latest'],
    env: {
      ...process.env,
      DEFAULT_SEARCH_ENGINE: 'duckduckgo',
      MODE: 'stdio',
    },
    stderr: 'ignore' // Stop it from flooding the dashboard console with its startup logs
  });

  const client = new Client(
    { name: "zundamon-discord-bot", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  try {
    await client.connect(transport);
    console.log('[MCP] Connected to open-websearch server successfully.');
    mcpClient = client;
    return client;
  } catch (error) {
    console.error('[MCP] Failed to connect:', error);
    return null;
  }
}

export async function closeMcpClient() {
  if (mcpClient) {
    try {
      await mcpClient.close();
      console.log('[MCP] Client closed successfully.');
    } catch (e) {
      console.error('[MCP] Error closing client:', e);
    }
    mcpClient = null;
  }
}

export async function getMcpTools() {
  if (!mcpClient) await initMcpClient();
  if (!mcpClient) return [];
  
  try {
    const list = await mcpClient.listTools();
    return list.tools || [];
  } catch (err) {
    console.error('[MCP] Failed to list tools:', err);
    return [];
  }
}

export async function callMcpTool(name, args) {
  if (!mcpClient) await initMcpClient();
  if (!mcpClient) return null;

  try {
    console.log(`[MCP] Calling tool ${name} with args:`, args);
    const result = await mcpClient.callTool({ name, arguments: args });
    return result;
  } catch (err) {
    console.error(`[MCP] Failed to call tool ${name}:`, err);
    return null;
  }
}
