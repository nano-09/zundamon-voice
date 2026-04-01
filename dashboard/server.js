import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { spawn, exec } from 'child_process';
import path from 'path';
import os from 'os';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import { DEFAULT_PERMISSIONS, DEFAULT_SETTINGS } from '../src/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ═══ API ENDPOINTS ═══

// Fetch historical logs from Supabase
app.get('/api/logs', async (req, res) => {
  const { guildId, type, limit = 50 } = req.query;
  try {
    let query = supabase.from('logs_v2').select('*').order('timestamp', { ascending: false }).limit(parseInt(limit));
    
    if (guildId) query = query.eq('guild_id', guildId);
    else query = query.is('guild_id', null); // Global logs

    if (type) query = query.eq('type', type);

    const { data, error } = await query;
    if (error) throw error;
    res.json(Array.isArray(data) ? data.reverse() : []);
  } catch (err) {
    console.error('[API] Error fetching logs:', err.message);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// Clear all error logs from database
app.post('/api/logs/clear', async (req, res) => {
  const { type } = req.body;
  if (type !== 'err') return res.status(400).json({ error: 'Only error logs can be cleared currently.' });
  try {
    const { error } = await supabase.from('logs_v2').delete().eq('type', 'err');
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[API] Error clearing logs:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Fetch guild meta (name, permissions, settings, status)
app.get('/api/guild-meta', async (req, res) => {
  const { guildId } = req.query;
  if (!guildId) return res.status(400).json({ error: 'guildId required' });
  try {
    const { data, error } = await supabase
      .from('guild_configs')
      .select('*')
      .eq('guild_id', guildId)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    const finalData = data || {};
    finalData.settings = { ...DEFAULT_SETTINGS, ...(finalData.settings || {}) };
    if (!finalData.permissions || Object.keys(finalData.permissions).length === 0) {
      finalData.permissions = DEFAULT_PERMISSIONS;
    }
    res.json(finalData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Fetch ALL guilds for the server gallery
app.get('/api/guilds', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('guild_configs')
      .select('guild_id, name, icon_url, joined_at, member_count, status, settings, permissions')
      .order('name', { ascending: true });

    if (error) throw error;
    const guilds = Array.isArray(data) ? data : [];
    guilds.forEach(g => {
      g.settings = { ...DEFAULT_SETTINGS, ...(g.settings || {}) };
      if (!g.permissions || Object.keys(g.permissions).length === 0) {
        g.permissions = DEFAULT_PERMISSIONS;
      }
    });
    res.json(guilds);
  } catch (err) {
    console.error('[API] /api/guilds error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Fetch guild members + roles (proxied via bot IPC)
app.get('/api/guild-members-roles', async (req, res) => {
  const { guildId } = req.query;
  if (!guildId) return res.status(400).json({ error: 'guildId required' });
  if (!botProcess || !botProcess.stdin.writable) {
    return res.status(503).json({ error: 'Bot process not running.' });
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingMembersRoles.delete(guildId);
      res.status(504).json({ error: 'Bot did not respond in time.' });
      resolve();
    }, 6000);
    pendingMembersRoles.set(guildId, {
      resolve: (data) => { res.json(data); resolve(); },
      timeout,
    });
    botProcess.stdin.write(`LIST_MEMBERS_ROLES:${guildId}\n`);
  });
});

// Resolve role/channel/user metadata (via bot IPC)
app.get('/api/resolve-metadata', async (req, res) => {
  const { guildId, ids } = req.query;
  if (!guildId || !ids) return res.status(400).json({ error: 'Missing guildId or ids' });
  if (botProcess && botProcess.stdin.writable) {
    botProcess.stdin.write(`RESOLVE_METADATA:${guildId}:${ids}\n`);
    return res.json({ ok: true });
  }
  res.status(503).json({ error: 'Bot not running' });
});

// Fetch all text channels for a guild (proxied via bot IPC)
app.get('/api/guild-channels', async (req, res) => {
  const { guildId } = req.query;
  if (!guildId) return res.status(400).json({ error: 'guildId required' });
  if (!botProcess || !botProcess.stdin.writable) {
    return res.status(503).json({ error: 'Bot process not running.' });
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      pendingChannels.delete(guildId);
      res.status(504).json({ error: 'Bot did not respond in time.' });
      resolve();
    }, 6000);
    pendingChannels.set(guildId, {
      resolve: (data) => { res.json(data); resolve(); },
      timeout,
    });
    botProcess.stdin.write(`LIST_CHANNELS:${guildId}\n`);
  });
});

// Save permissions for a guild
app.post('/api/permissions', async (req, res) => {
  const { guildId, permissions } = req.body;
  if (!guildId) return res.status(400).json({ error: 'guildId required' });
  try {
    const finalPerms = (permissions && Object.keys(permissions).length > 0) ? permissions : DEFAULT_PERMISSIONS;
    console.log(`[API] Saving permissions for ${guildId}:`, Object.keys(finalPerms).length, 'commands');
    const { error } = await supabase
      .from('guild_configs')
      .update({ permissions: finalPerms })
      .eq('guild_id', guildId);
    if (error) throw error;
    if (botProcess && botProcess.stdin.writable) {
      botProcess.stdin.write(`SYNC_CONFIG:${guildId}\n`);
    }
    res.json({ ok: true, permissions: finalPerms });
  } catch (err) {
    console.error('[API] /api/permissions error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Save general settings for a guild
app.post('/api/settings', async (req, res) => {
  const { guildId, settings } = req.body;
  if (!guildId || !settings) return res.status(400).json({ error: 'guildId and settings required' });
  try {
    // Merge with existing settings to avoid overwriting unrelated fields
    const { data: existing } = await supabase
      .from('guild_configs').select('settings').eq('guild_id', guildId).single();
    
    const mergedSettings = { ...(existing?.settings || {}), ...settings };
    
    const { error } = await supabase
      .from('guild_configs')
      .update({ settings: mergedSettings })
      .eq('guild_id', guildId);
      
    if (error) throw error;
    
    if (botProcess && botProcess.stdin.writable) {
      botProcess.stdin.write(`SYNC_CONFIG:${guildId}\n`);
    }
    
    res.json({ ok: true, settings: mergedSettings });
  } catch (err) {
    console.error('[API] /api/settings error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Block / Unblock a guild
app.post('/api/block-guild', async (req, res) => {
  const { guildId, blocked } = req.body;
  if (!guildId) return res.status(400).json({ error: 'guildId required' });
  try {
    // Read current settings, merge `blocked` flag
    const { data: existing } = await supabase
      .from('guild_configs').select('settings').eq('guild_id', guildId).single();
    const settings = existing?.settings || {};
    settings.blocked = !!blocked;
    const { error } = await supabase
      .from('guild_configs')
      .update({ settings })
      .eq('guild_id', guildId);
    if (error) throw error;
    if (botProcess && botProcess.stdin.writable) {
      botProcess.stdin.write(`SYNC_CONFIG:${guildId}\n`);
    }
    res.json({ ok: true, blocked: settings.blocked });
  } catch (err) {
    console.error('[API] /api/block-guild error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Fetch hourly analytics snapshots for a guild
app.get('/api/analytics', async (req, res) => {
  const { guildId, hours = 24 } = req.query;
  if (!guildId) return res.status(400).json({ error: 'guildId required' });
  try {
    const since = new Date(Date.now() - parseInt(hours) * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('guild_analytics')
      .select('*')
      .eq('guild_id', guildId)
      .gte('snapshot_at', since)
      .order('snapshot_at', { ascending: true });

    if (error) throw error;
    res.json(Array.isArray(data) ? data : []);
  } catch (err) {
    console.error('[API] /api/analytics error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

let botProcess = null;
// Pending one-shot callbacks for LIST_MEMBERS_ROLES responses
const pendingMembersRoles = new Map(); // guildId -> { resolve, timeout }
const pendingChannels     = new Map(); // guildId -> { resolve, timeout }
let latestBotStats = { guilds: '-', channels: '-', ping: '-', uptime: '-', user: null };
let ownerEmailCache = 'Not set';
let messageCount = 0;

// Fetch owner email from Supabase table at startup
async function fetchOwnerEmail() {
  try {
    const { data, error } = await supabase
      .from('bot_secrets')
      .select('value')
      .eq('name', 'OWNER_EMAIL')
      .single();
    if (error) throw error;
    if (data) {
      ownerEmailCache = data.value;
      console.log('[Dashboard] Owner email fetched from Supabase:', ownerEmailCache);
    }
  } catch (err) {
    console.error('[Dashboard] Failed to fetch owner email from Supabase:', err.message);
  }
}
fetchOwnerEmail();

// ═══ HELPERS ═══
function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  return `${h}時間 ${m}分`;
}

let lastCpuInfo = null;
function getCpuUsage() {
  const cpus = os.cpus();
  let totalIdle = 0, totalTick = 0;
  cpus.forEach(cpu => {
    for (const type in cpu.times) totalTick += cpu.times[type];
    totalIdle += cpu.times.idle;
  });
  const idle = totalIdle / cpus.length;
  const total = totalTick / cpus.length;
  if (lastCpuInfo) {
    const idleDiff = idle - lastCpuInfo.idle;
    const totalDiff = total - lastCpuInfo.total;
    lastCpuInfo = { idle, total };
    return totalDiff > 0 ? Math.max(0, ((1 - idleDiff / totalDiff) * 100)) : 0;
  }
  lastCpuInfo = { idle, total };
  return 0;
}

function getRAM() {
  const totalGB = os.totalmem() / (1024 ** 3);
  const freeGB = os.freemem() / (1024 ** 3);
  return { total: totalGB, used: totalGB - freeGB };
}

// ═══ BOT PROCESS MANAGEMENT ═══
function startBot() {
  if (botProcess) return;
  const projectRoot = path.join(__dirname, '..');
  botProcess = spawn('node', ['src/index.js'], { cwd: projectRoot });

  const rl = readline.createInterface({ input: botProcess.stdout, terminal: false });

  rl.on('line', (text) => {
    // Strip unreadable non-ASCII control chars for display
    const clean = text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '').trim();
    if (!clean) return;
    console.log('[BOT]', clean);

    const guildMatch = clean.match(/\[G:(\d+)\]/);
    const guildId = guildMatch ? guildMatch[1] : null;
    const cleanText = clean.replace(/\[G:\d+\]\s*/, '');

    // Classify log type
    let logType = 'bot';
    if (cleanText.includes('[SYS]') || cleanText.includes('[2FA]') || cleanText.includes('[Config]')) logType = 'sys';
    if (cleanText.includes('[ERROR]') || cleanText.includes('❌') || cleanText.startsWith('[ERR]')) logType = 'err';
    if (cleanText.includes('[TTS]')) logType = 'tts';
    if (cleanText.includes('[CMD]')) logType = 'cmd';

    // Filter out noisy voice state changes
    if (cleanText.includes('[VOICE] State:')) return;

    io.emit('log', { text: cleanText, guildId, type: logType });

    if (cleanText.includes('[DASHBOARD_STATS]')) {
      try {
        const stats = JSON.parse(cleanText.split('[DASHBOARD_STATS]')[1].trim());
        if (stats.type === 'HEARTBEAT') latestBotStats = stats;
        io.emit('stats_update', stats);
      } catch (e) {}
    }

    if (cleanText.includes('[METADATA]')) {
      try {
        const mdata = JSON.parse(cleanText.split('[METADATA]')[1].trim());
        io.emit('metadata_resolved', mdata);
      } catch (e) {}
    }

    if (cleanText.includes('[SNAPSHOT]')) {
      try {
        const snap = JSON.parse(cleanText.split('[SNAPSHOT]')[1].trim());
        io.emit('snapshot_update', snap);
      } catch (e) {}
    }

    if (cleanText.includes('[MEMBERS_ROLES]')) {
      try {
        const payload = JSON.parse(cleanText.split('[MEMBERS_ROLES]')[1].trim());
        io.emit('members_roles_resolved', payload);
        const pending = pendingMembersRoles.get(payload.guildId);
        if (pending) {
          clearTimeout(pending.timeout);
          pendingMembersRoles.delete(payload.guildId);
          pending.resolve(payload);
        }
      } catch (e) {
        console.error('[DASHBOARD] Failed to parse [MEMBERS_ROLES]:', e.message);
      }
    }
    
    if (cleanText.includes('[CHANNELS]')) {
      try {
        const payload = JSON.parse(cleanText.split('[CHANNELS]')[1].trim());
        const pending = pendingChannels.get(payload.guildId);
        if (pending) {
          clearTimeout(pending.timeout);
          pendingChannels.delete(payload.guildId);
          pending.resolve(payload);
        }
      } catch (e) {
        console.error('[DASHBOARD] Failed to parse [CHANNELS]:', e.message);
      }
    }

    if (cleanText.includes('[GUILD_ADDED]')) {
      const gId = cleanText.split('[GUILD_ADDED]')[1].trim();
      io.emit('guild_added', { guildId: gId });
    }

    if (cleanText.includes('[GUILD_REMOVED]')) {
      const gId = cleanText.split('[GUILD_REMOVED]')[1].trim();
      io.emit('guild_removed', { guildId: gId });
    }

    if (cleanText.includes('[CONFIG_UPDATED]')) {
      try {
        const payload = JSON.parse(cleanText.split('[CONFIG_UPDATED]')[1].trim());
        io.emit('config_updated', payload);
      } catch (e) {}
    }
  });

  botProcess.stderr.on('data', (data) => {
    const text = data.toString('utf8').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '').trim();
    if (!text) return;
    console.error('[BOT ERR]', text);
    io.emit('log', { text: `[ERR] ${text}`, type: 'err' });
  });

  botProcess.on('close', (code) => {
    io.emit('log', { text: `[SYS] ボットが終了しました (コード ${code})`, type: 'sys' });
    botProcess = null;
    io.emit('stats_update', { type: 'HEARTBEAT', status: '待機中', guilds: 0, uptime: 0, ping: 0 }); // Clear stats
  });
}

function stopBot() {
  if (botProcess) {
    const p = botProcess;
    p.stdin.write('SHUTDOWN\n');
    setTimeout(() => { 
      // Hard kill the specific process instance if it's still somehow alive
      try { p.kill('SIGKILL'); } catch(e) {} 
    }, 3000);
  }
}

// ═══ SOCKET ═══
io.on('connection', (socket) => {
  // Send current service status on connect
  socket.emit('action_response', { action: 'connected', status: 'ok', message: 'ダッシュボードが接続されました。' });

  socket.on('start_bot', () => {
    startBot();
    io.emit('action_response', { action: 'start_bot', status: 'ok', message: '✅ ボットを起動しました。' });
  });
  socket.on('stop_bot', () => {
    stopBot();
    io.emit('action_response', { action: 'stop_bot', status: 'ok', message: '⏹ ボットを停止しました。' });
  });
  socket.on('restart_bot', () => {
    io.emit('action_response', { action: 'restart_bot', status: 'pending', message: '↺ ボットを再起動中...' });
    
    if (!botProcess) {
      startBot();
      io.emit('action_response', { action: 'restart_bot', status: 'ok', message: '✅ ボットを再起動しました。' });
      return;
    }

    const oldProcess = botProcess;
    oldProcess.once('close', () => {
      setTimeout(() => {
        startBot();
        io.emit('action_response', { action: 'restart_bot', status: 'ok', message: '✅ ボットを再起動しました。' });
      }, 500);
    });

    stopBot();
  });
  socket.on('kill_all', () => {
    io.emit('system_shutdown');
    io.emit('action_response', { action: 'kill_all', status: 'pending', message: '⏻ エコシステムを終了中...' });
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'ShutdownZundamon.bat'], { cwd: path.join(__dirname, '..'), detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('sh', ['stop-macOS.command'], { cwd: path.join(__dirname, '..'), detached: true, stdio: 'ignore' }).unref();
    }
    setTimeout(() => process.exit(0), 1500);
  });
  // Legacy alias
  socket.on('shutdown_all', () => socket.emit('kill_all'));

  socket.on('leave_guild', ({ guildId }) => {
    io.emit('action_response', { action: 'leave_guild', status: 'pending', message: `🚪 サーバー ${guildId} から退出中...` });
    if (botProcess && botProcess.stdin.writable) {
      botProcess.stdin.write(`LEAVE_GUILD:${guildId}\n`);
      setTimeout(() => {
        io.emit('action_response', { action: 'leave_guild', status: 'ok', message: `✅ サーバー ${guildId} から退出しました。` });
      }, 2000);
    } else {
      io.emit('action_response', { action: 'leave_guild', status: 'error', message: `❌ ボットが起動していません。` });
    }
  });
});

// ═══ PERIODIC EMITTERS ═══
async function checkService(url) {
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(tid);
    return res.ok;
  } catch { return false; }
}

setInterval(async () => {
  const cpuPercent = getCpuUsage();
  const ram = getRAM();
  const voicevoxUrl = process.env.VOICEVOX_URL || 'http://localhost:50021';
  const ollamaUrl   = process.env.OLLAMA_URL   || 'http://localhost:11434';
  const [voicevoxOk, ollamaOk] = await Promise.all([
    checkService(`${voicevoxUrl}/version`),
    checkService(`${ollamaUrl}/api/tags`),
  ]);
  io.emit('system_resources', { cpuPercent, ramUsed: ram.used, ramTotal: ram.total, voicevoxOk, ollamaOk });
}, 5000);

setInterval(() => {
  io.emit('stats_update_summary', {
    uptime: latestBotStats.uptime !== '-' ? formatUptime(latestBotStats.uptime) : '-',
    guilds: latestBotStats.guilds,
    ping: latestBotStats.ping,
    user: latestBotStats.user,
    owner: {
      ...latestBotStats.owner,
      email: ownerEmailCache
    },
    guildsDetail: latestBotStats.guildsDetail
  });
}, 3000);

startBot();
server.listen(3000, () => console.log('Dashboard on http://localhost:3000'));
