import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import { spawn, exec } from 'child_process';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

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
    res.json(data || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch command usage analytics
app.get('/api/usage', async (req, res) => {
  const { guildId } = req.query;
  if (!guildId) return res.status(400).json({ error: 'guildId required' });
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('command_usage')
      .select('command_name, timestamp')
      .eq('guild_id', guildId)
      .gte('timestamp', twentyFourHoursAgo);

    if (error) throw error;
    res.json(Array.isArray(data) ? data : []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch absolute global command usage across all servers
app.get('/api/global-commands', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('command_usage')
      .select('command_name');

    if (error) throw error;

    const counts = {};
    for (const row of Array.isArray(data) ? data : []) {
      const name = row.command_name;
      if (name) counts[name] = (counts[name] || 0) + 1;
    }
    res.json(counts);
  } catch (err) {
    console.error('[API] /api/global-commands error:', err.message);
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
    res.json(Array.isArray(data) ? data : []);
  } catch (err) {
    console.error('[API] /api/guilds error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Save permissions for a guild
app.post('/api/permissions', async (req, res) => {
  const { guildId, permissions } = req.body;
  if (!guildId) return res.status(400).json({ error: 'guildId required' });
  try {
    const { error } = await supabase
      .from('guild_configs')
      .update({ permissions: permissions || {} })
      .eq('guild_id', guildId);
    if (error) throw error;
    if (botProcess && botProcess.stdin.writable) {
      botProcess.stdin.write(`SYNC_CONFIG:${guildId}\n`);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[API] /api/permissions error:', err.message);
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
let latestBotStats = { guilds: '-', channels: '-', ping: '-', uptime: '-', user: null };
let messageCount = 0;

// ═══ HELPERS ═══
function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  return `${h}h ${m}m`;
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

  botProcess.stdout.on('data', (data) => {
    // Decode as UTF-8, strip unreadable non-ASCII control chars for display
    const text = data.toString('utf8');
    const clean = text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '').trim();
    if (!clean) return;
    console.log('[BOT]', clean);

    const guildMatch = clean.match(/\[G:(\d+)\]/);
    const guildId = guildMatch ? guildMatch[1] : null;
    const cleanText = clean.replace(/\[G:\d+\]\s*/, '');

    // Classify log type
    let logType = 'bot';
    if (cleanText.includes('[SYS]') || cleanText.includes('[2FA]') || cleanText.includes('[Config]')) logType = 'sys';
    if (cleanText.includes('[ERROR]') || cleanText.includes('❌')) logType = 'err';

    io.emit('log', { text: cleanText, guildId, type: logType });

    if (cleanText.includes('[DASHBOARD_STATS]')) {
      try {
        const stats = JSON.parse(cleanText.split('[DASHBOARD_STATS]')[1].trim());
        if (stats.type === 'HEARTBEAT') latestBotStats = stats;
        io.emit('stats_update', stats);
      } catch (e) {}
    }

    if (cleanText.includes('[GUILD_ADDED]')) {
      const guildId = cleanText.split('[GUILD_ADDED]')[1].trim();
      io.emit('guild_added', { guildId });
    }

    if (cleanText.includes('[GUILD_REMOVED]')) {
      const guildId = cleanText.split('[GUILD_REMOVED]')[1].trim();
      io.emit('guild_removed', { guildId });
    }
  });

  botProcess.stderr.on('data', (data) => {
    const text = data.toString('utf8').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '').trim();
    if (!text) return;
    console.error('[BOT ERR]', text);
    io.emit('log', { text: `[ERR] ${text}`, type: 'err' });
  });

  botProcess.on('close', (code) => {
    io.emit('log', { text: `[SYS] Bot exited code ${code}`, type: 'sys' });
    botProcess = null;
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
  socket.emit('action_response', { action: 'connected', status: 'ok', message: 'Dashboard connected.' });

  socket.on('start_bot', () => {
    startBot();
    io.emit('action_response', { action: 'start_bot', status: 'ok', message: '✅ Bot started.' });
  });
  socket.on('stop_bot', () => {
    stopBot();
    io.emit('action_response', { action: 'stop_bot', status: 'ok', message: '⏹ Bot stopped.' });
  });
  socket.on('restart_bot', () => {
    io.emit('action_response', { action: 'restart_bot', status: 'pending', message: '↺ Restarting bot...' });
    
    if (!botProcess) {
      startBot();
      io.emit('action_response', { action: 'restart_bot', status: 'ok', message: '✅ Bot restarted.' });
      return;
    }

    const oldProcess = botProcess;
    oldProcess.once('close', () => {
      setTimeout(() => {
        startBot();
        io.emit('action_response', { action: 'restart_bot', status: 'ok', message: '✅ Bot restarted.' });
      }, 500);
    });

    stopBot();
  });
  socket.on('kill_all', () => {
    io.emit('action_response', { action: 'kill_all', status: 'pending', message: '⏻ Shutting down ecosystem...' });
    spawn('cmd.exe', ['/c', 'ShutdownZundamon.bat'], { cwd: path.join(__dirname, '..'), detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => process.exit(0), 1500);
  });
  // Legacy alias
  socket.on('shutdown_all', () => socket.emit('kill_all'));

  socket.on('leave_guild', ({ guildId }) => {
    io.emit('action_response', { action: 'leave_guild', status: 'pending', message: `🚪 Leaving guild ${guildId}...` });
    if (botProcess && botProcess.stdin.writable) {
      botProcess.stdin.write(`LEAVE_GUILD:${guildId}\n`);
      setTimeout(() => {
        io.emit('action_response', { action: 'leave_guild', status: 'ok', message: `✅ Left guild ${guildId}.` });
      }, 2000);
    } else {
      io.emit('action_response', { action: 'leave_guild', status: 'error', message: `❌ Bot is not running.` });
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
    guildsDetail: latestBotStats.guildsDetail
  });
}, 3000);

startBot();
server.listen(3000, () => console.log('Dashboard on http://localhost:3000'));
