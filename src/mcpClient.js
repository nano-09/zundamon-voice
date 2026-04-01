import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execSync } from 'child_process';

let mcpClient = null;

/**
 * On macOS, GUI-launched .command files don't inherit the full login PATH.
 * This function resolves the npx binary from common install locations.
 */
function getNpxCommand() {
  if (process.platform === 'win32') return 'npx.cmd';
  try {
    // Try to find npx from the shell's actual PATH
    const npxPath = execSync('which npx 2>/dev/null || echo ""', { shell: '/bin/zsh', env: { ...process.env, PATH: `${process.env.HOME}/.nvm/versions/node/$(ls ${process.env.HOME}/.nvm/versions/node 2>/dev/null | tail -1)/bin:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH || ''}` } }).toString().trim();
    if (npxPath && npxPath !== '') return npxPath;
  } catch (_) {}
  // Fallback: common macOS node install paths
  const candidates = [
    '/opt/homebrew/bin/npx',
    '/usr/local/bin/npx',
    '/usr/bin/npx',
  ];
  for (const c of candidates) {
    try { execSync(`test -x "${c}"`, { shell: '/bin/sh' }); return c; } catch (_) {}
  }
  return 'npx'; // last resort
}

export async function initMcpClient() {
  if (mcpClient) return mcpClient;

  const npxCmd = getNpxCommand();
  console.log(`[MCP] Initializing open-websearch MCP server (npx: ${npxCmd})...`);
  const transport = new StdioClientTransport({
    command: npxCmd,
    args: ['-y', 'open-websearch@latest'],
    env: {
      ...process.env,
      DEFAULT_SEARCH_ENGINE: 'duckduckgo',
      MODE: 'stdio',
      PORT: '0',
      // Ensure PATH includes common node binary locations
      PATH: `/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ''}`,
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
    // Reset the stale client so the next call forces a fresh connection
    mcpClient = null;
    return null;
  }
}

export function isMcpReady() {
  return mcpClient !== null;
}
