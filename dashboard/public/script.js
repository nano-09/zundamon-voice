const socket = io();

// ── Toast Notifications ───────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;display:flex;flex-direction:column;gap:10px;';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  const colors = { ok:'#05cd99', pending:'#ffb547', error:'#ee5d50', info:'#4318ff' };
  toast.style.cssText = `background:#1a1f5e;color:#fff;padding:12px 18px;border-radius:12px;font-size:13px;font-weight:600;border-left:4px solid ${colors[type]||colors.info};box-shadow:0 8px 24px rgba(0,0,0,0.2);animation:slideToast 0.3s ease;max-width:320px;`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.4s'; setTimeout(() => toast.remove(), 400); }, 3500);
}

// Add toast animation to head
const toastStyle = document.createElement('style');
toastStyle.textContent = '@keyframes slideToast{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}';
document.head.appendChild(toastStyle);

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  activeTab: 'tab-dashboard',
  selectedGuildId: null,
  activeLTab: 'analytics',
  guilds: [],
  pingHistory: [],
  cpuHistory: [],
  ramHistory: [],
  pingStats: { min: Infinity, max: -Infinity, sum: 0, count: 0 },
  charts: {},
  errors: [],
  metadataCache: {}, // { guildId: { id: { type, name, avatar, color } } }
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }
function fmt(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
}
function safeFetch(url) {
  return fetch(url).then(r => r.json()).catch(() => null);
}
function now() { return new Date().toLocaleTimeString('ja',{hour:'2-digit',minute:'2-digit',second:'2-digit'}); }

// ── Navigation ─────────────────────────────────────────────────────────────────
function switchTab(tab) {
  const titles = {
    'tab-dashboard': 'Dashboard',
    'tab-logs':      'Server Logs',
    'tab-commands':  'Commands',
    'tab-account':   'Account',
  };
  document.querySelectorAll('.nav-item').forEach(i => {
    i.classList.toggle('active', i.dataset.tab === tab);
  });
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.id === tab);
  });
  state.activeTab = tab;
  el('page-title').textContent = titles[tab] || '';
  if (tab === 'tab-logs') loadGuildList();
}

function setupNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      const tab = item.dataset.tab;
      if (tab) switchTab(tab);
    });
  });
  // Notification icon redirect
  el('btn-notify')?.addEventListener('click', () => switchTab('tab-account'));
}

// ── Charts ─────────────────────────────────────────────────────────────────────
const CHART_OPTS = (label, color, fill=true) => ({
  type: 'line',
  data: {
    labels: [],
    datasets: [{
      label,
      data: [],
      borderColor: color,
      backgroundColor: fill ? color + '22' : 'transparent',
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.4,
      fill,
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { display: false },
      y: {
        grid: { color: 'rgba(200,200,200,0.08)' },
        ticks: { font: { size: 10 }, color: '#a3aed0' },
        beginAtZero: true,
      }
    }
  }
});

function initCharts() {
  state.charts.resource = new Chart(el('resourceChart'), CHART_OPTS('CPU %', '#4318ff'));
  state.charts.ping     = new Chart(el('pingChart'),     CHART_OPTS('Ping (ms)', '#05cd99', false));
}

function pushChartPoint(chart, label, value, maxPoints = 20) {
  chart.data.labels.push(label);
  chart.data.datasets[0].data.push(value);
  if (chart.data.labels.length > maxPoints) {
    chart.data.labels.shift();
    chart.data.datasets[0].data.shift();
  }
  chart.update('none');
}

// Resource chip tabs
document.querySelectorAll('.chip[data-res]').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip[data-res]').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    const res = chip.dataset.res;
    const chart = state.charts.resource;
    if (res === 'cpu') {
      chart.data.datasets[0].data = [...state.cpuHistory.map(x=>x.v)];
      chart.data.labels = [...state.cpuHistory.map(x=>x.t)];
      chart.data.datasets[0].label = 'CPU %';
      chart.data.datasets[0].borderColor = '#4318ff';
      chart.data.datasets[0].backgroundColor = '#4318ff22';
    } else {
      chart.data.datasets[0].data = [...state.ramHistory.map(x=>x.v)];
      chart.data.labels = [...state.ramHistory.map(x=>x.t)];
      chart.data.datasets[0].label = 'RAM GB';
      chart.data.datasets[0].borderColor = '#ffb547';
      chart.data.datasets[0].backgroundColor = '#ffb54722';
    }
    chart.update();
  });
});

// ── Socket Events ──────────────────────────────────────────────────────────────
socket.on('connect', () => {
  el('offline-overlay').classList.remove('show');
  setPip('pip-bot', 'online');
});
socket.on('disconnect', () => {
  el('offline-overlay').classList.add('show');
  setPip('pip-bot', 'error');
});

socket.on('system_shutdown', () => {
  showToast('⛔ System is shutting down. Closing tab...', 'error');
  setTimeout(() => {
    window.close();
    window.location.href = 'about:blank'; // Fallback if window.close() is blocked
  }, 2000);
});

function setPip(id, state) {
  const pip = el(id);
  if (!pip) return;
  pip.className = 'pip';
  pip.classList.add(state);
}

socket.on('stats_update', (data) => {
  if (data.type !== 'HEARTBEAT') return;

  // KPIs
  el('kpi-guilds').textContent = data.guilds;
  el('kpi-uptime').textContent = fmt(data.uptime || 0);
  el('kpi-ping').textContent   = `${data.ping} ms`;
  el('badge-servers').textContent = `${data.guilds} server${data.guilds !== 1 ? 's' : ''}`;

  // Account tab mirrors
  el('acct-guilds').textContent = data.guilds;
  el('acct-uptime').textContent = fmt(data.uptime || 0);
  el('acct-ping').textContent   = `${data.ping} ms`;

  // Bot avatar
  if (data.user) {
    const botName = data.user.username;
    el('bot-username-side').textContent = botName;
    el('acct-username').textContent     = botName;
    if (data.user.avatar) {
      const imgs = [el('bot-avatar-side'), el('acct-avatar')];
      imgs.forEach(img => { if (img) { img.src = data.user.avatar; img.style.display = 'block'; } });
      el('bot-av-fallback').style.display = 'none';
      el('acct-fallback').style.display   = 'none';
    }
  }

  // Ping chart & stats
  const p = data.ping;
  state.pingStats.sum += p;
  state.pingStats.count++;
  state.pingStats.min = Math.min(state.pingStats.min, p);
  state.pingStats.max = Math.max(state.pingStats.max, p);
  pushChartPoint(state.charts.ping, now(), p);
  el('ping-cur').textContent = `${p} ms`;
  el('ping-avg').textContent = `${Math.round(state.pingStats.sum / state.pingStats.count)} ms`;
  el('ping-min').textContent = `${state.pingStats.min} ms`;
  el('ping-max').textContent = `${state.pingStats.max} ms`;

  // Guilds list → server table
  if (Array.isArray(data.guildsDetail)) {
    state.guilds = data.guildsDetail;
    renderServerTable(data.guildsDetail);
    if (state.activeTab === 'tab-logs') renderGuildItems();
  }
});

socket.on('system_resources', (res) => {
  const t = now();
  const cpu = Math.round(res.cpuPercent || 0);
  const ram = parseFloat((res.ramUsed || 0).toFixed(1));

  state.cpuHistory.push({ t, v: cpu });
  state.ramHistory.push({ t, v: ram });
  if (state.cpuHistory.length > 20) state.cpuHistory.shift();
  if (state.ramHistory.length > 20) state.ramHistory.shift();

  // Active chip determines which data to show
  const activeChip = document.querySelector('.chip[data-res].active');
  if (activeChip?.dataset.res === 'cpu') {
    pushChartPoint(state.charts.resource, t, cpu);
  }

  // Service pill for Voicebox
  if (res.voicevoxOk !== undefined) setPip('pip-voicevox', res.voicevoxOk ? 'online' : 'error');
  if (res.ollamaOk !== undefined)   setPip('pip-ollama',   res.ollamaOk   ? 'online' : 'warning');
});

socket.on('action_response', (res) => {
  showToast(res.message, res.status);
});

socket.on('guild_added', async (data) => {
  console.log('[Socket] Guild added:', data.guildId);
  await loadGuildList();
  showToast('🆕 New server joined!', 'ok');
});

socket.on('guild_removed', async (data) => {
  console.log('[Socket] Guild removed:', data.guildId);
  if (state.selectedGuildId === data.guildId) {
    el('log-detail').style.display = 'none';
    el('log-placeholder').style.display = 'flex';
    state.selectedGuildId = null;
  }
  await loadGuildList();
  showToast('🚪 Bot left a server.', 'warning');
});

socket.on('log', (msg) => {
  if (msg.guildId === state.selectedGuildId && state.activeLTab !== 'analytics') {
    const typeToPane = { bot:'bot', sys:'sys', err:'err' };
    const paneKey = typeToPane[msg.type] || 'sys';
    appendLog(paneKey, msg.text || msg.message, msg.type);
  }
  // Error notification
  if (msg.type === 'err') {
    pushError(msg.text || msg.message);
  }
});

socket.on('metadata_resolved', (data) => {
  if (!state.metadataCache[data.guildId]) state.metadataCache[data.guildId] = {};
  Object.assign(state.metadataCache[data.guildId], data.results);
  
  // Update UI chips if we are currently looking at this guild
  if (state.selectedGuildId === data.guildId) {
    Object.entries(data.results).forEach(([id, meta]) => {
      document.querySelectorAll(`.perm-tag[data-id="${id}"]`).forEach(el => {
        el.innerHTML = createTagInnerHtml(id, meta);
      });
    });
  }
});

// ── Server Table (Dashboard) ───────────────────────────────────────────────────
function renderServerTable(guilds) {
  const tbody = el('server-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  guilds.forEach(g => {
    const isVoice = !!g.voiceChannelId;
    const statusColor = isVoice ? '#05cd99' : '#a3aed0';
    const statusTxt   = isVoice ? 'In Voice' : 'Idle';
    const iconHtml    = g.icon
      ? `<img src="${g.icon}" class="srv-icon-sm" alt="">`
      : `<div style="width:28px;height:28px;border-radius:8px;background:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;font-size:12px">${g.name?.[0]||'?'}</div>`;

    tbody.insertAdjacentHTML('beforeend', `<tr>
      <td><div class="srv-name">${iconHtml} ${escHtml(g.name||'Unknown')}</div></td>
      <td>${g.memberCount ?? '—'}</td>
      <td><span class="srv-status-dot" style="background:${statusColor}"></span>${statusTxt}</td>
      <td>${g.joined_at ? new Date(g.joined_at).toLocaleDateString() : '—'}</td>
      <td>${g.sessionCommands !== undefined ? g.sessionCommands : '—'}</td>
    </tr>`);
  });
}

// ── Global Commands Tracker ────────────────────────────────────────────────────
async function loadGlobalCommandsUsage() {
  const data = await safeFetch('/api/global-commands');
  if (!data) return;

  document.querySelectorAll('.cmd-row').forEach(row => {
    const codeEl = row.querySelector('code');
    if (!codeEl) return;
    
    const cmdName = codeEl.textContent.replace('/', '').trim();
    const count = data[cmdName] || 0;
    
    let badge = row.querySelector('.cmd-usage-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'cmd-usage-badge';
      
      const spanEl = row.querySelector('span:not(.cmd-usage-badge)');
      if (spanEl) {
         const rightWrap = document.createElement('div');
         rightWrap.style.display = 'flex';
         rightWrap.style.flexDirection = 'column';
         rightWrap.style.alignItems = 'flex-end';
         rightWrap.style.gap = '4px';
         
         row.insertBefore(rightWrap, spanEl);
         rightWrap.appendChild(spanEl);
         rightWrap.appendChild(badge);
      }
    }
    badge.innerHTML = `🔥 ${count.toLocaleString()} executed`;
  });
}

// ── Server Gallery (Logs tab) ──────────────────────────────────────────────────
async function loadGuildList() {
  const data = await safeFetch('/api/guilds');
  if (Array.isArray(data)) {
    // Merge with live status from state.guilds
    state.dbGuilds = data;
  } else {
    state.dbGuilds = [];
  }
  state.dbGuilds.forEach(dg => {
    const live = state.guilds.find(g => g.id === dg.guild_id);
    if (live) {
      dg.live_status  = live.voiceChannelId ? 'In Voice' : 'Idle';
      dg.live_icon    = live.icon || dg.icon_url;
    } else {
      dg.live_status  = dg.status || 'Idle';
      dg.live_icon    = dg.icon_url;
    }
  });
  renderGuildItems();
}

function renderGuildItems(filter = '') {
  const container = el('guild-items');
  if (!container) return;
  const list = (state.dbGuilds || state.guilds.map(g => ({
    guild_id: g.id, name: g.name, live_icon: g.icon, live_status: g.voiceChannelId ? 'In Voice' : 'Idle'
  }))).filter(g => g.name?.toLowerCase().includes(filter.toLowerCase()));

  container.innerHTML = '';
  list.forEach(g => {
    const iconHtml = g.live_icon
      ? `<img src="${g.live_icon}" class="guild-item-icon" alt="">`
      : `<div class="guild-item-icon-fallback">${(g.name||'?')[0].toUpperCase()}</div>`;
    const isSelected = state.selectedGuildId === g.guild_id;
    const item = document.createElement('div');
    item.className = 'guild-item' + (isSelected ? ' selected' : '');
    item.dataset.guildId = g.guild_id;
    item.innerHTML = `${iconHtml}<div class="guild-item-info"><div class="guild-item-name">${escHtml(g.name||'Unknown')}</div><div class="guild-item-status">${g.live_status||'Idle'}</div></div>`;
    item.addEventListener('click', () => openGuildDetail(g));
    container.appendChild(item);
  });
}

el('guild-search')?.addEventListener('input', e => renderGuildItems(e.target.value));

// ── Guild Detail Panel ─────────────────────────────────────────────────────────
async function openGuildDetail(g) {
  state.selectedGuildId = g.guild_id;
  renderGuildItems(el('guild-search')?.value || '');

  el('log-placeholder').style.display = 'none';
  el('log-detail').style.display = 'flex';
  el('log-detail').style.flexDirection = 'column';

  // Header
  el('detail-name').textContent = g.name || 'Unknown';
  const iconEl = el('detail-icon');
  if (g.live_icon) { iconEl.src = g.live_icon; iconEl.style.display = 'block'; }
  else iconEl.style.display = 'none';

  const status = g.live_status || g.status || 'Idle';
  const sBadge = el('detail-status-badge');
  sBadge.textContent = status;
  sBadge.className = 'status-badge-mini ' + (status.includes('Voice') ? 'voice' : status.includes('Karaoke') ? 'karaoke' : 'idle');

  // Switch to analytics tab first
  switchLTab('analytics');

  // Load analytics
  loadDetailAnalytics(g.guild_id);

  // Load config (Always re-fetch to ensure sync with Discord-side changes)
  const meta = await safeFetch(`/api/guild-meta?guildId=${g.guild_id}`);
  if (meta) {
    g.settings = meta.settings || {};
    g.permissions = meta.permissions || {};
    renderConfig(g.settings, g.permissions);
  } else if (g.settings || g.permissions) {
    renderConfig(g.settings || {}, g.permissions || {});
  }

  // Action buttons
  const blockBtn = el('btn-block-guild');
  const updateBlockBtn = () => {
    const isBlocked = g.settings?.blocked === true;
    blockBtn.textContent = isBlocked ? '✅ Unblock Server' : '🚫 Block Server';
    blockBtn.className = `action-btn ${isBlocked ? 'secondary' : 'danger'}`;
  };
  updateBlockBtn();
  blockBtn.onclick = async () => {
    const isCurrentlyBlocked = g.settings?.blocked === true;
    const newBlocked = !isCurrentlyBlocked;
    const action = newBlocked ? 'block' : 'unblock';
    if (!confirm(`${newBlocked ? '🚫' : '✅'} "${g.name}" を${newBlocked ? 'ブロック' : 'アンブロック'}しますか？\n${newBlocked ? 'このサーバーの全コマンドが無効化されます。' : 'このサーバーのコマンドが再び有効になります。'}`)) return;
    try {
      const res = await fetch('/api/block-guild', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildId: g.guild_id, blocked: newBlocked }),
      });
      if (!res.ok) throw new Error('Failed');
      showToast(`${newBlocked ? '🚫' : '✅'} ${g.name} を${newBlocked ? 'ブロック' : 'アンブロック'}しました。`, 'ok');
      // Update local state
      if (!g.settings) g.settings = {};
      g.settings.blocked = newBlocked;
      updateBlockBtn();
    } catch (err) {
      showToast('❌ ブロック状態の変更に失敗しました。', 'error');
    }
  };
  el('btn-edit-perms').onclick = () => {
    openPermModal(g.permissions || {});
  };
  el('btn-leave-guild').onclick = () => {
    if (confirm(`本当に "${g.name}" から退出しますか？\nこの操作は取り消せません。`)) {
      socket.emit('leave_guild', { guildId: g.guild_id });
      showToast(`🚪 "${g.name}" からの退出を要求しました…`, 'pending');
    }
  };
  el('btn-reset-perms').onclick = async () => {
    if (!confirm(`⚠️ Are you sure you want to RESET ALL permissions for "${g.name}"?\nThis will delete all custom allow/deny rules.`)) return;
    showToast('🗑 Resetting permissions...', 'pending');
    try {
      const res = await fetch('/api/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildId: g.guild_id, permissions: {} }) // Empty clears all
      });
      if (!res.ok) throw new Error('Reset failed');
      showToast('✅ Permissions reset successfully!', 'ok');
      g.permissions = {};
      renderConfig(g.settings || {}, {});
    } catch (err) {
      showToast('❌ Failed to reset permissions.', 'error');
    }
  };
}

// Detail log tabs
document.querySelectorAll('.ltab').forEach(btn => {
  btn.addEventListener('click', () => switchLTab(btn.dataset.ltab));
});

function switchLTab(tab) {
  state.activeLTab = tab;
  document.querySelectorAll('.ltab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.lpane').forEach(p => p.classList.remove('active'));
  document.querySelector(`.ltab[data-ltab="${tab}"]`)?.classList.add('active');
  el(`lpane-${tab}`)?.classList.add('active');

  // Load logs when switching to log panes
  if (['bot','sys','err'].includes(tab) && state.selectedGuildId) {
    loadLogsForPane(tab);
  }
}

async function loadLogsForPane(type) {
  const consoleEl = el(`console-${type}`);
  if (!consoleEl) return;
  consoleEl.innerHTML = '<span style="color:#555">Loading...</span>';
  const data = await safeFetch(`/api/logs?guildId=${state.selectedGuildId}&type=${type}&limit=100`);
  consoleEl.innerHTML = '';
  if (Array.isArray(data) && data.length) {
    data.forEach(l => appendLog(type, l.message, l.type));
  } else {
    consoleEl.innerHTML = '<span style="color:#555">No logs found.</span>';
  }
}

function appendLog(pane, text, type) {
  const container = el(`console-${pane}`);
  if (!container) return;
  const line = document.createElement('span');
  line.className = 'log-line ' + (type || '');
  line.textContent = `[${now()}] ${text}`;
  container.appendChild(line);
  container.appendChild(document.createElement('br'));
  // Scroll to bottom
  container.parentElement?.scroll({ top: 999999, behavior: 'smooth' });
}

// ── Analytics Charts ──────────────────────────────────────────────────────────
let activityChartInst = null;
let cmdChartInst = null;

async function loadDetailAnalytics(guildId) {
  const data = await safeFetch(`/api/analytics?guildId=${guildId}&hours=24`);
  if (!Array.isArray(data)) return;

  // KPIs — sum of last 24h snapshots
  const totals = data.reduce((acc, row) => {
    acc.tts  += row.texts_spoken || 0;
    acc.ai   += row.ai_queries || 0;
    acc.users = Math.max(acc.users, row.members_active || 0);
    const cmds = row.commands_used || {};
    acc.cmds += Object.values(cmds).reduce((s,v) => s + v, 0);
    Object.entries(cmds).forEach(([k,v]) => { acc.cmdBreakdown[k] = (acc.cmdBreakdown[k]||0)+v; });
    return acc;
  }, { tts:0, ai:0, cmds:0, users:0, cmdBreakdown:{} });

  el('a-tts').textContent   = totals.tts;
  el('a-ai').textContent    = totals.ai;
  el('a-cmds').textContent  = totals.cmds;
  el('a-users').textContent = totals.users;

  // Activity line chart
  const labels = data.map(r => new Date(r.snapshot_at).toLocaleTimeString('ja',{hour:'2-digit',minute:'2-digit'}));
  const ttsSeries  = data.map(r => r.texts_spoken||0);
  const cmdSeries  = data.map(r => Object.values(r.commands_used||{}).reduce((s,v)=>s+v,0));

  if (activityChartInst) activityChartInst.destroy();
  activityChartInst = new Chart(el('activityChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label:'TTS Messages', data:ttsSeries, borderColor:'#4318ff', backgroundColor:'#4318ff22', borderWidth:2, tension:0.4, pointRadius:0, fill:true },
        { label:'Commands',     data:cmdSeries, borderColor:'#05cd99', backgroundColor:'#05cd9922', borderWidth:2, tension:0.4, pointRadius:0, fill:true },
      ]
    },
    options: {
      responsive:true, maintainAspectRatio:false, animation:false,
      plugins: { legend: { position:'top', labels:{ font:{size:11}, boxWidth:12 } } },
      scales: { x:{ticks:{font:{size:9}}}, y:{beginAtZero:true, ticks:{font:{size:10}}} }
    }
  });

  // Command breakdown bar chart
  const cmdKeys = Object.keys(totals.cmdBreakdown).slice(0, 10);
  const cmdVals = cmdKeys.map(k => totals.cmdBreakdown[k]);

  if (cmdChartInst) cmdChartInst.destroy();
  cmdChartInst = new Chart(el('cmdChart'), {
    type: 'bar',
    data: {
      labels: cmdKeys.map(k => `/${k}`),
      datasets: [{ label:'Uses', data:cmdVals, backgroundColor:'#4318ffcc', borderRadius:6 }]
    },
    options: {
      responsive:true, maintainAspectRatio:false, animation:false,
      plugins:{ legend:{display:false} },
      scales:{ x:{ticks:{font:{size:10}}}, y:{beginAtZero:true, ticks:{font:{size:10}}} }
    }
  });
}

// Config pane
function renderConfig(settings, permissions) {
  const infoList = el('config-info-list');
  const permList = el('config-perm-list');
  if (!infoList || !permList) return;

  const settingRows = [
    ['Chat Mode',     settings.chatMode     ? 'Enabled' : 'Disabled'],
    ['Read Name',     settings.readName === false ? 'Off' : 'On'],
    ['Speaker ID',    settings.speakerId || '3'],
    ['Text Channel',  settings.textChannelId ? `#${settings.textChannelId}` : 'Not set'],
    ['Announce VC',   settings.announceVoice ? 'Enabled' : 'Disabled'],
    ['Soundboard',    settings.soundboardMode ? 'Enabled' : 'Disabled'],
    ['CleanChat',     settings.cleanChatTasks?.[settings.textChannelId] ? `${settings.cleanChatTasks[settings.textChannelId]} min` : 'Off'],
    ['Music Volume',  settings.karaokeVolume ?? '1.0'],
  ];

  infoList.innerHTML = settingRows.map(([k,v]) =>
    `<div class="config-row"><span>${k}</span><span>${v}</span></div>`
  ).join('');

  const permObj = (permissions && Object.keys(permissions).length > 0) ? permissions : (settings.permissions || {});
  state.currentPerms = JSON.parse(JSON.stringify(permObj));

  const permEntries = Object.entries(permObj);
  if (permEntries.length) {
    const categories = {
      '🎮 Basic': [],
      '🎙️ Voice Settings': [],
      '🎵 Music & Sound': [],
      '⚙️ Server Admin': [],
      '📖 Dictionary & Customs': [],
      '📦 Other': []
    };

    const mapping = {
      'join':'🎮 Basic', 'leave':'🎮 Basic', 'help':'🎮 Basic', 'mystatus':'🎮 Basic',
      'setvoice':'🎙️ Voice Settings', 'voiceparams':'🎙️ Voice Settings', 'readname':'🎙️ Voice Settings', 'chatmode':'🎙️ Voice Settings', 'announce':'🎙️ Voice Settings',
      'play':'🎵 Music & Sound', 'pause':'🎵 Music & Sound', 'skip':'🎵 Music & Sound', 'queue':'🎵 Music & Sound', 'lyrics':'🎵 Music & Sound', 'musicvolume':'🎵 Music & Sound', 'soundboard':'🎵 Music & Sound',
      'setchannel':'⚙️ Server Admin', 'permissions':'⚙️ Server Admin', 'serverstatus':'⚙️ Server Admin', 'servervoice':'⚙️ Server Admin', 'servervoiceparams':'⚙️ Server Admin', 'cleanchat':'⚙️ Server Admin', 'trim':'⚙️ Server Admin',
      'addword':'📖 Dictionary & Customs', 'delword':'📖 Dictionary & Customs', 'listwords':'📖 Dictionary & Customs', 'customsound':'📖 Dictionary & Customs', 'customemoji':'📖 Dictionary & Customs'
    };

    permEntries.forEach(([cmd, rules]) => {
      const baseCmd = cmd.split(' ')[0];
      const cat = mapping[baseCmd] || '📦 Other';
      categories[cat].push([cmd, rules]);
    });

    permList.innerHTML = `<div class="config-perm-container"></div>`;
    const container = permList.querySelector('.config-perm-container');
    const resolveList = new Set();

    Object.entries(categories).forEach(([catName, items]) => {
      if (items.length === 0) return;

      const catSection = document.createElement('div');
      catSection.className = 'config-perm-category';
      catSection.innerHTML = `<h4>${catName}</h4><div class="config-perm-grid"></div>`;
      const grid = catSection.querySelector('.config-perm-grid');

      items.forEach(([cmd, rules]) => {
        const card = document.createElement('div');
        card.className = 'perm-mini-card';
        card.onclick = () => openPermModal(permObj, cmd);

        const tagHtml = Object.entries(rules).map(([id, act]) => {
          const isEveryone = id === state.selectedGuildId;
          if (!isEveryone) resolveList.add(id);
          const meta = state.metadataCache[state.selectedGuildId]?.[id];
          return `<div class="perm-tag ${isEveryone ? 'everyone' : ''} ${act}" data-id="${id}">${isEveryone ? 'Everyone' : (meta ? createTagInnerHtml(id, meta) : `<span style="opacity:0.5">${id.slice(-4)}...</span>`)}</div>`;
        }).join('');
        card.innerHTML = `<div class="perm-mini-header"><code>/${cmd}</code></div><div class="perm-tag-list">${tagHtml}</div>`;
        grid.appendChild(card);
      });
      container.appendChild(catSection);
    });

    if (resolveList.size > 0) {
      const unknownIds = [...resolveList].filter(id => !state.metadataCache[state.selectedGuildId]?.[id]);
      if (unknownIds.length > 0) {
        fetch(`/api/resolve-metadata?guildId=${state.selectedGuildId}&ids=${unknownIds.join(',')}`).catch(() => {});
      }
    }
  } else {
    permList.innerHTML = '<div class="config-row"><span>No custom permissions</span></div>';
  }
}

function createTagInnerHtml(id, meta) {
  if (meta.type === 'role') {
    return `<span class="role-dot" style="background:${meta.color || '#fff'}"></span>${escHtml(meta.name)}`;
  } else if (meta.type === 'channel') {
    return `<span style="color:var(--text-muted); font-weight:800; margin-right:4px;">#</span>${escHtml(meta.name)}`;
  } else {
    const avatar = meta.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png';
    return `<img src="${avatar}" class="avatar-micro" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">${escHtml(meta.name)}`;
  }
}

const ALL_COMMANDS = [
  'join', 'leave', 'setchannel', 'setvoice', 'voiceparams',
  'voiceparams speed', 'voiceparams pitch', 'voiceparams volume',
  'chatmode', 'soundboard', 'serverstatus', 'mystatus', 'help',
  'addword', 'delword', 'listwords', 'readname', 'announce', 'cleanchat', 'trim',
  'permissions', 'play', 'pause', 'skip', 'queue', 'lyrics', 'musicvolume',
  'servervoice', 'servervoiceparams', 'servervoiceparams speed', 'servervoiceparams pitch', 'servervoiceparams volume',
  'customsound add', 'customsound remove', 'customsound list',
  'customemoji add', 'customemoji remove', 'customemoji list', 'loop'
];

// ── Permission Modal (Two-Panel Redesign) ──────────────────────────────────────

// Guild member+role cache for the currently open guild
let permModalMembers = [];
let permModalRoles   = [];
let permActivePtab   = 'members'; // 'members' | 'roles'

function openPermModal(perms, focusCmd) {
  state.editingPerms = JSON.parse(JSON.stringify(perms || {}));
  state.selectedPermCmd = focusCmd || null;

  // Reset picker tab
  permActivePtab = 'members';
  document.querySelectorAll('.perm-ptab').forEach(t => t.classList.toggle('active', t.dataset.ptab === 'members'));
  el('perm-members-grid').style.display = '';
  el('perm-roles-grid').style.display = 'none';

  renderPermCmdList();
  renderPickerGrid();
  updateSelectedCmdLabel();

  el('perm-modal').style.display = 'flex';

  // Load members/roles from bot (async – updates grids when ready)
  if (state.selectedGuildId) {
    permModalMembers = [];
    permModalRoles   = [];
    fetch(`/api/guild-members-roles?guildId=${state.selectedGuildId}`)
      .then(r => r.json())
      .then(data => {
        if (data && Array.isArray(data.members)) permModalMembers = data.members;
        if (data && Array.isArray(data.roles))   permModalRoles   = data.roles;
        renderPickerGrid();
      })
      .catch(() => {});
  }

  // If a command was pre-focused, scroll it into view
  if (focusCmd) {
    setTimeout(() => {
      const row = document.querySelector(`.perm-cmd-row[data-cmd="${CSS.escape(focusCmd)}"]`);
      row?.scrollIntoView({ block: 'nearest' });
    }, 50);
  }
}

function renderPermCmdList() {
  const container = el('perm-cmd-list');
  if (!container) return;
  const q = (el('perm-cmd-search')?.value || '').toLowerCase();
  container.innerHTML = '';
  ALL_COMMANDS.filter(cmd => cmd.includes(q)).forEach(cmd => {
    const rules = state.editingPerms[cmd] || {};
    const ruleCount = Object.keys(rules).length;
    const row = document.createElement('div');
    row.className = 'perm-cmd-row' + (state.selectedPermCmd === cmd ? ' active' : '');
    row.dataset.cmd = cmd;
    row.innerHTML = `
      <span>/${cmd}</span>
      <span class="perm-rule-badge${ruleCount ? ' has-rules' : ''}">${ruleCount || '—'}</span>
    `;
    row.addEventListener('click', () => {
      state.selectedPermCmd = cmd;
      renderPermCmdList();
      renderPickerGrid();
      updateSelectedCmdLabel();
    });
    container.appendChild(row);
  });
}

function updateSelectedCmdLabel() {
  const label = el('perm-selected-cmd-label');
  const bulk  = el('perm-bulk-actions');
  if (!label || !bulk) return;
  if (state.selectedPermCmd) {
    label.textContent = `Editing: /${state.selectedPermCmd}`;
    label.classList.add('active');
    bulk.style.display = 'flex';
  } else {
    label.textContent = '← Select a command';
    label.classList.remove('active');
    bulk.style.display = 'none';
  }
}

function renderPickerGrid() {
  const q = (el('perm-picker-search')?.value || '').toLowerCase();
  renderEntityGrid('members', permModalMembers.filter(m => m.name.toLowerCase().includes(q)));
  renderEntityGrid('roles',   permModalRoles.filter(r => r.name.toLowerCase().includes(q)));
}

function renderEntityGrid(type, items) {
  const gridId = type === 'members' ? 'perm-members-grid' : 'perm-roles-grid';
  const grid = el(gridId);
  if (!grid) return;

  if (items.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);font-size:13px;padding:24px;">${state.selectedGuildId ? (permModalMembers.length === 0 && type === 'members' ? 'Loading…' : 'No results') : 'Select a server first'}</div>`;
    return;
  }

  grid.innerHTML = '';
  items.forEach(item => {
    const id = item.id;
    const cmd = state.selectedPermCmd;
    const currentState = cmd ? (state.editingPerms[cmd]?.[id] || null) : null;

    const card = document.createElement('div');
    card.className = 'perm-entity-card' + (currentState === 'allow' ? ' state-allow' : currentState === 'deny' ? ' state-deny' : '');
    card.title = currentState ? `${item.name}: ${currentState}` : item.name;

    let avatarHtml;
    if (type === 'members') {
      avatarHtml = `<img src="${item.avatar}" class="perm-entity-avatar" alt="" onerror="this.style.display='none'">`;
    } else {
      // Role: colored circle with first letter
      const color = item.color && item.color !== '#000000' ? item.color : '#7551ff';
      avatarHtml = `<div class="perm-entity-avatar role-av" style="background:${color}">${escHtml(item.name[0]?.toUpperCase() || '?')}</div>`;
    }

    const stateLabel = currentState === 'allow' ? 'Allow' : currentState === 'deny' ? 'Deny' : 'None';
    const stateClass = currentState === 'allow' ? 'st-allow' : currentState === 'deny' ? 'st-deny' : 'st-none';

    card.innerHTML = `
      ${avatarHtml}
      <div class="perm-entity-name">${escHtml(item.name)}</div>
      <div class="perm-entity-state ${stateClass}">${stateLabel}</div>
    `;

    card.addEventListener('click', () => {
      if (!state.selectedPermCmd) {
        showToast('← First select a command on the left', 'pending');
        return;
      }
      // Cycle: none → allow → deny → none
      const cur = state.editingPerms[state.selectedPermCmd]?.[id] || null;
      if (!state.editingPerms[state.selectedPermCmd]) state.editingPerms[state.selectedPermCmd] = {};
      if (cur === null)    state.editingPerms[state.selectedPermCmd][id] = 'allow';
      else if (cur === 'allow') state.editingPerms[state.selectedPermCmd][id] = 'deny';
      else {
        // none — remove rule
        delete state.editingPerms[state.selectedPermCmd][id];
        if (Object.keys(state.editingPerms[state.selectedPermCmd]).length === 0) {
          delete state.editingPerms[state.selectedPermCmd];
        }
      }
      renderPermCmdList();
      renderPickerGrid();
    });

    grid.appendChild(card);
  });
}

// Picker tab switching
document.querySelectorAll('.perm-ptab').forEach(tab => {
  tab.addEventListener('click', () => {
    permActivePtab = tab.dataset.ptab;
    document.querySelectorAll('.perm-ptab').forEach(t => t.classList.toggle('active', t === tab));
    el('perm-members-grid').style.display = permActivePtab === 'members' ? '' : 'none';
    el('perm-roles-grid').style.display   = permActivePtab === 'roles'   ? '' : 'none';
  });
});

el('perm-cmd-search').oninput   = renderPermCmdList;
el('perm-picker-search').oninput = renderPickerGrid;

el('btn-close-perms').onclick  = () => el('perm-modal').style.display = 'none';
el('btn-cancel-perms').onclick = () => el('perm-modal').style.display = 'none';
el('btn-save-perms').onclick   = savePermissions;

el('btn-perm-allow-all').onclick = () => setBulkPermission('allow');
el('btn-perm-deny-all').onclick  = () => setBulkPermission('deny');

function setBulkPermission(action) {
  if (!state.selectedPermCmd || !state.selectedGuildId) return;
  state.editingPerms[state.selectedPermCmd] = { [state.selectedGuildId]: action };
  renderPermCmdList();
  renderPickerGrid();
  showToast(`✅ Set /${state.selectedPermCmd} to ${action} all`, 'ok');
}

async function savePermissions() {
  showToast('💾 Saving permissions...', 'pending');
  try {
    const res = await fetch('/api/permissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId: state.selectedGuildId, permissions: state.editingPerms })
    });
    if (!res.ok) throw new Error('Save failed');
    showToast('✅ Permissions updated!', 'ok');
    el('perm-modal').style.display = 'none';

    const dg = state.dbGuilds.find(g => g.guild_id === state.selectedGuildId);

    if (dg) dg.permissions = state.editingPerms;
    renderConfig(dg.settings || {}, state.editingPerms);
  } catch (err) {
    showToast('❌ Failed to save permissions.', 'error');
  }
}

// ── Error Notifications ────────────────────────────────────────────────────────
function pushError(msg) {
  state.errors.push({ msg, time: now() });
  // Badge
  const badge = el('notif-badge');
  if (badge) { badge.textContent = state.errors.length; badge.style.display = 'flex'; }
  // Account tab list
  const list = el('notif-list');
  if (!list) return;
  const empty = list.querySelector('.notif-empty');
  if (empty) empty.remove();
  const item = document.createElement('div');
  item.className = 'notif-item';
  item.innerHTML = `<div><strong>${now()}</strong><br>${escHtml(msg)}</div>`;
  list.prepend(item);
  el('kpi-errors').textContent = state.errors.length;
}

// ── Control Buttons ───────────────────────────────────────────────────────────
el('btn-restart')?.addEventListener('click', () => {
  if (confirm('Restart the bot ecosystem? This will also clear the current error dashboard.')) {
    socket.emit('restart_bot');
    // Clear local error state
    state.errors = [];
    const badge = el('notif-badge');
    if (badge) { badge.textContent = '0'; badge.style.display = 'none'; }
    const list = el('notif-list');
    if (list) {
      list.innerHTML = '<p class="notif-empty">No errors recorded.</p>';
    }
    el('kpi-errors').textContent = '0';
    showToast('↺ Restarting & Clearing logs…', 'pending');
  }
});
el('btn-stop')?.addEventListener('click',    () => { socket.emit('stop_bot');    showToast('⏹ Stop requested…', 'pending'); });
el('btn-kill-all')?.addEventListener('click',() => { if(confirm('Kill all services?')) { socket.emit('kill_all'); showToast('⏻ Shutting down…', 'pending'); } });

// ── Utility ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Boot ──────────────────────────────────────────────────────────────────────
setupNav();
initCharts();

// Load recent global logs for boot
safeFetch('/api/logs?limit=30').then(logs => {
  if (Array.isArray(logs)) {
    logs.forEach(l => {
      if (l.type === 'err') pushError(l.message);
    });
  }
});

// Load commands usage for the Commands tab
loadGlobalCommandsUsage();
