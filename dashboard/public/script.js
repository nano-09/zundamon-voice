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
  const colors = { ok: '#05cd99', pending: '#ffb547', error: '#ee5d50', info: '#4318ff' };
  toast.style.cssText = `background:#1a1f5e;color:#fff;padding:12px 18px;border-radius:12px;font-size:13px;font-weight:600;border-left:4px solid ${colors[type] || colors.info};box-shadow:0 8px 24px rgba(0,0,0,0.2);animation:slideToast 0.3s ease;max-width:320px;`;
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
  dbGuilds: [],
  guilds: [],
  pingHistory: [],
  cpuHistory: [],
  ramHistory: [],
  pingStats: { sum: 0, count: 0, min: 10000, max: 0, history: [] },
  charts: {},
  errors: [],
  heartbeatTimeout: null,
  originalPermsJson: '',
  voiceNames: {
    1: 'ずんだもん (あまあま)',
    3: 'ずんだもん (ノーマル)',
    5: 'ずんだもん (セクシー)',
    7: 'ずんだもん (ツンツン)',
    2: '四国めたん (あまあま)',
    4: '四国めたん (ノーマル)',
    6: '四国めたん (セクシー)',
    8: '四国めたん (ツンツン)',
    10: '雨晴はう (ノーマル)',
    13: '青山龍星 (ノーマル)',
    14: '冥鳴ひまり (ノーマル)',
    16: '九州そら (あまあま)'
  },
  logCache: new Map(), // Key: "guildId:type", Value: Array
  metadataCache: {}, // { guildId: { id: { type, name, avatar, color } } }
  isLocked: false,
  pendingOtpAction: null, // { type: 'leave'|'block', guildId, data }
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
function now() { return new Date().toLocaleTimeString('ja', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

// ── Navigation ─────────────────────────────────────────────────────────────────
function switchTab(tab) {
  const titles = {
    'tab-dashboard': 'ダッシュボード',
    'tab-logs': 'サーバーログ',
    'tab-commands': 'コマンド',
    'tab-account': 'アカウント',
  };
  document.querySelectorAll('.nav-item').forEach(i => {
    i.classList.toggle('active', i.dataset.tab === tab);
  });
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.id === tab);
  });
  state.activeTab = tab;
  localStorage.setItem('activeTab', tab);
  el('page-title').textContent = titles[tab] || '';
  if (tab === 'tab-logs') loadGuildList();
  if (tab === 'tab-account') {
    loadGlobalErrors();
    // Clear notification badge when viewing account tab
    state.errors = [];
    const badge = el('notif-badge');
    if (badge) {
      badge.textContent = '0';
      badge.style.display = 'none';
      badge.classList.remove('has-new');
    }
  }
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
  // Clear global errors button
  el('btn-clear-global-errors')?.addEventListener('click', async () => {
    if (!confirm('本当にすべてのエラーログをデータベースから削除しますか？')) return;
    try {
      const res = await fetch('/api/logs/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'err' })
      });
      if (!res.ok) throw new Error('Clear failed');
      
      state.errors = [];
      state.logCache.delete('global:err');
      renderLogsFromCache('global', 'err');
      const badge = el('notif-badge');
      if (badge) {
        badge.textContent = '0';
        badge.style.display = 'none';
        badge.classList.remove('has-new');
      }
      el('kpi-errors').textContent = '0';
      showToast('🗑 エラーログをクリアしました', 'ok');
    } catch (err) {
      showToast('❌ ログのクリアに失敗しました', 'error');
    }
  });
}

// ── Charts ─────────────────────────────────────────────────────────────────────
const CHART_OPTS = (label, color, fill = true) => ({
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
  state.charts.resource = new Chart(el('resourceChart'), CHART_OPTS('CPU 使用率', '#4318ff'));
  state.charts.ping = new Chart(el('pingChart'), CHART_OPTS('遅延 (ms)', '#05cd99', false));
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
      chart.data.datasets[0].data = [...state.cpuHistory.map(x => x.v)];
      chart.data.labels = [...state.cpuHistory.map(x => x.t)];
      chart.data.datasets[0].label = 'CPU 使用率';
      chart.data.datasets[0].borderColor = '#4318ff';
      chart.data.datasets[0].backgroundColor = '#4318ff22';
    } else {
      chart.data.datasets[0].data = [...state.ramHistory.map(x => x.v)];
      chart.data.labels = [...state.ramHistory.map(x => x.t)];
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
  setPip('pip-bot', 'warning'); // Default to connecting until heartbeat arrives
});
socket.on('disconnect', () => {
  el('offline-overlay').classList.add('show');
  setPip('pip-bot', 'error');
});

socket.on('system_shutdown', () => {
  showToast('⛔ システムがシャットダウン中です。タブを閉じます...', 'error');
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

function updateOwnerInfo(owner) {
  if (!owner) return;
  const { username, avatar, email } = owner;
  const nameEl = el('owner-username');
  if (nameEl) nameEl.textContent = username;
  const emailEl = el('owner-email');
  if (emailEl) emailEl.textContent = email;
  if (avatar) {
    const img = el('owner-avatar');
    if (img) { img.src = avatar; img.style.display = 'block'; }
    const fallback = el('owner-fallback');
    if (fallback) fallback.style.display = 'none';
  }
}

socket.on('stats_update', (data) => {
  if (data.type === 'SYSTEM_INIT') {
    updateOwnerInfo(data.owner);
    return;
  }

  if (data.type === 'BOT_LOG') {
    const gId = data.guildId || 'global';
    appendLogToCache(gId, 'bot', data.content);
    if (state.selectedGuildId === data.guildId && state.activeTab === 'tab-logs' && state.activeLTab === 'bot') {
      renderLogsFromCache(gId, 'bot');
    }
    return;
  }

  if (data.type === 'ERROR_LOG') {
    const gId = data.guildId || 'global';
    appendLogToCache(gId, 'err', data.message || data.content);
    if (gId === (state.selectedGuildId || 'global')) {
      if (state.activeTab === 'tab-logs' && state.activeLTab === 'err') renderLogsFromCache(gId, 'err');
      if (state.activeTab === 'tab-account') renderLogsFromCache('global', 'err');
    }
    return;
  }

  if (data.type !== 'HEARTBEAT') return;

  // KPIs
  el('kpi-guilds').textContent = data.guilds;
  el('kpi-uptime').textContent = fmt(data.uptime || 0);
  el('kpi-ping').textContent = `${data.ping} ms`;
  el('badge-servers').textContent = `${data.guilds} サーバー`;

  // Sync Profiles
  updateOwnerInfo(data.owner);

  // Global Lock Sync
  if (data.isLocked !== undefined) {
    state.isLocked = data.isLocked;
    const lockOverlay = el('lock-overlay');
    if (lockOverlay) {
      lockOverlay.style.display = state.isLocked ? 'flex' : 'none';
    }
  }

  // Bot Status Pill & Top-right Pip
  const statusPill = el('bot-status-pill');
  if (data.status === 'online') {
    if (statusPill) {
      statusPill.textContent = '● オンライン';
      statusPill.className = 'status-online-pill online';
    }
    setPip('pip-bot', 'online');
    if (el('btn-start')) el('btn-start').style.display = 'none';
    if (el('btn-stop')) el('btn-stop').style.display = 'inline-block';
  } else if (data.status === 'connecting') {
    if (statusPill) {
      statusPill.textContent = '● 接続中';
      statusPill.className = 'status-online-pill connecting';
    }
    setPip('pip-bot', 'warning');
    if (el('btn-start')) el('btn-start').style.display = 'none';
    if (el('btn-stop')) el('btn-stop').style.display = 'inline-block';
  } else {
    if (statusPill) {
      statusPill.textContent = '● オフライン';
      statusPill.className = 'status-online-pill offline';
    }
    setPip('pip-bot', 'error');
    if (el('btn-start')) el('btn-start').style.display = 'inline-block';
    if (el('btn-stop')) el('btn-stop').style.display = 'none';
  }

  // Watchdog: detect if heartbeats stop entirely
  clearTimeout(state.heartbeatTimeout);
  state.heartbeatTimeout = setTimeout(() => {
    const pill = el('bot-status-pill');
    if (pill) {
      pill.textContent = '● 切断';
      pill.className = 'status-online-pill offline';
    }
    setPip('pip-bot', 'error');
    if (el('btn-start')) el('btn-start').style.display = 'inline-block';
    if (el('btn-stop')) el('btn-stop').style.display = 'none';
    showToast('📡 ボットへの接続が失われました。', 'error');
  }, 10000); // 10 seconds without HB = disconnected

  // Account tab mirrors
  el('acct-guilds').textContent = data.guilds;
  el('acct-uptime').textContent = fmt(data.uptime || 0);
  el('acct-ping').textContent = `${data.ping} ms`;

  // Bot avatar
  if (data.user) {
    const botName = data.user.username;
    const sideName = el('bot-username-side');
    if (sideName) sideName.textContent = botName;
    const acctName = el('acct-username');
    if (acctName) acctName.textContent = botName;

    if (data.user.avatar) {
      const sideAv = el('bot-avatar-side');
      if (sideAv) { sideAv.src = data.user.avatar; sideAv.style.display = 'block'; }
      const acctAv = el('acct-avatar');
      if (acctAv) { acctAv.src = data.user.avatar; acctAv.style.display = 'block'; }

      const sideFall = el('bot-av-fallback');
      if (sideFall) sideFall.style.display = 'none';
      const acctFall = el('acct-fallback');
      if (acctFall) acctFall.style.display = 'none';
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
    // Sort by TTS Read + Commands
    data.guildsDetail.sort((a, b) => ((b.ttsCount || 0) + (b.cmdCount || 0)) - ((a.ttsCount || 0) + (a.cmdCount || 0)));
    state.guilds = data.guildsDetail;

    // Extract metadata from heartbeat
    data.guildsDetail.forEach(g => {
      if (!state.metadataCache[g.id]) state.metadataCache[g.id] = {};
      if (g.textChannelId && g.textChannelName) {
        state.metadataCache[g.id][g.textChannelId] = { type: 'channel', name: g.textChannelName };
      }
      if (g.voiceChannelId && g.voiceChannelName) {
        state.metadataCache[g.id][g.voiceChannelId] = { type: 'channel', name: g.voiceChannelName };
      }

      // Update dbGuilds status for live gallery update
      if (state.dbGuilds) {
        const dg = state.dbGuilds.find(x => x.guild_id === g.id);
        if (dg) {
          const newStatus = g.voiceChannelId ? '通話中' : '待機中';
          dg.live_status = newStatus;
          dg.live_icon = g.icon || dg.icon_url;
        }
      }
    });

    renderServerTable(data.guildsDetail);
    if (state.activeTab === 'tab-logs') {
      renderGuildItems(el('guild-search')?.value || '');

      // Update detail panel if open for this guild
      if (state.selectedGuildId) {
        const live = data.guildsDetail.find(x => x.id === state.selectedGuildId);
        if (live) {
          const status = live.voiceChannelId ? '通話中' : '待機中';
          const sBadge = el('detail-status-badge');
          if (sBadge && sBadge.textContent !== status) {
            sBadge.textContent = status;
            sBadge.className = 'status-badge-mini ' + (status.includes('通話') || status.includes('再生') ? 'voice' : 'idle');
          }
          const iconEl = el('detail-icon');
          if (iconEl && live.icon && iconEl.src !== live.icon) {
            iconEl.src = live.icon;
            iconEl.style.display = 'block';
          }
        }
      }
    }
  }
});

socket.on('config_updated', (data) => {
  if (!data.guildId) return;

  // Find in dbGuilds if possible
  const dg = state.dbGuilds?.find(x => x.guild_id === data.guildId);
  if (dg) {
    if (data.name !== undefined) dg.name = data.name;
    if (data.permissions !== undefined) dg.permissions = data.permissions;
    if (data.settings !== undefined) dg.settings = data.settings;
    if (data.status !== undefined) {
      dg.status = data.status;
      dg.live_status = data.status;
    }
    if (data.icon !== undefined) dg.live_icon = data.icon;
  }

  // Update active view if this guild is selected
  if (state.selectedGuildId === data.guildId) {
    const activeSettings = data.settings || dg?.settings || {};
    const activePerms = data.permissions || dg?.permissions || {};

    // If name or status changed, update the header
    if (data.name) el('detail-name').textContent = data.name;
    if (data.status) {
      dg.live_status = data.status;
      const sBadge = el('detail-status-badge');
      if (sBadge) {
        sBadge.textContent = data.status;
        sBadge.className = 'status-badge-mini ' + (data.status.includes('通話') || data.status.includes('再生') ? 'voice' : data.status.includes('Karaoke') ? 'karaoke' : 'idle');
      }
    }

    renderConfig(activeSettings, activePerms);

    // Visual feedback
    if (data.permissions !== undefined) {
      showToast('🔒 サーバーの権限設定が更新されました', 'info');
    } else if (data.settings !== undefined) {
      showToast('⚙️ サーバー設定が更新されました', 'info');
    }
  }

  renderGuildItems(el('guild-search')?.value || '');
});

socket.on('metadata_resolved', (data) => {
  if (data.guildId) {
    if (!state.metadataCache[data.guildId]) state.metadataCache[data.guildId] = {};
    Object.assign(state.metadataCache[data.guildId], data.results);
    if (state.selectedGuildId === data.guildId) {
      const dg = state.dbGuilds.find(g => g.guild_id === data.guildId);
      renderConfig(dg?.settings || {}, dg?.permissions || {});
    }
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
});

socket.on('action_response', (res) => {
  showToast(res.message, res.status);
});

socket.on('snapshot_update', (snap) => {
  if (state.selectedGuildId !== snap.guildId) return;

  // 1. Update KPIs (Add deltas)
  if (el('a-tts')) el('a-tts').textContent = parseInt(el('a-tts').textContent || 0) + (snap.texts_spoken || 0);
  
  const snapCmdTotal = Object.values(snap.commands_used || {}).reduce((s, v) => s + v, 0);
  if (el('a-cmds')) el('a-cmds').textContent = parseInt(el('a-cmds').textContent || 0) + snapCmdTotal;
  
  if (el('a-users')) el('a-users').textContent = Math.max(parseInt(el('a-users').textContent || 0), snap.members_active || 0);

  // 2. Update Line Chart
  if (activityChartInst) {
    const timeLabel = new Date(snap.snapshot_at).toLocaleTimeString('ja', { hour: '2-digit', minute: '2-digit' });
    activityChartInst.data.labels.push(timeLabel);
    activityChartInst.data.datasets[0].data.push(snap.texts_spoken || 0);
    activityChartInst.data.datasets[1].data.push(snapCmdTotal);
    
    // Keep max 100 points to prevent bloat
    if (activityChartInst.data.labels.length > 100) {
      activityChartInst.data.labels.shift();
      activityChartInst.data.datasets.forEach(d => d.data.shift());
    }
    activityChartInst.update('none');
  }
});

socket.on('guild_added', async (data) => {
  console.log('[Socket] Guild added:', data.guildId);
  await loadGuildList();
  showToast('🆕 新しいサーバーに参加しました！', 'ok');
});

socket.on('guild_removed', async (data) => {
  console.log('[Socket] Guild removed:', data.guildId);
  if (state.selectedGuildId === data.guildId) {
    el('log-detail').style.display = 'none';
    el('log-placeholder').style.display = 'flex';
    state.selectedGuildId = null;
  }
  await loadGuildList();
  showToast('🚪 サーバーから退出しました。', 'warning');
});

socket.on('log', (msg) => {
  const gId = msg.guildId || 'global';
  const typeToPane = { bot: 'bot', sys: 'sys', err: 'err', tts: 'tts', cmd: 'cmd' };
  const type = msg.type || 'sys';

  appendLogToCache(gId, type, msg.text || msg.message);

  // Real-time UI update if viewing
  if (state.activeTab === 'tab-logs' && state.selectedGuildId === msg.guildId) {
    if (state.activeLTab === typeToPane[type]) {
      renderLogsFromCache(gId, typeToPane[type]);
    }
  } else if (state.activeTab === 'tab-account' && !msg.guildId && type === 'err') {
    renderLogsFromCache('global', 'err');
  }

  // Error notification sync
  if (type === 'err') {
    pushError(msg.text || msg.message);
  }
});

// ── Security / 2FA ─────────────────────────────────────────────────────────────
function showOtpModal(description, actionData) {
  state.pendingOtpAction = actionData;
  el('otp-description').textContent = description;
  el('otp-input').value = '';
  el('otp-error').style.display = 'none';
  el('otp-modal').style.display = 'flex';
  socket.emit('request_otp', { action: actionData.type });
}

el('btn-close-otp')?.addEventListener('click', () => el('otp-modal').style.display = 'none');
el('btn-cancel-otp')?.addEventListener('click', () => el('otp-modal').style.display = 'none');

el('btn-submit-otp')?.addEventListener('click', async () => {
  const code = el('otp-input').value.trim();
  if (code.length < 6) return;

  const { type, guildId, data } = state.pendingOtpAction;
  
  if (type === 'leave') {
    socket.emit('leave_guild', { guildId, code });
    el('otp-modal').style.display = 'none';
  } else if (type === 'block') {
    try {
      const res = await fetch('/api/block-guild', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildId, blocked: true, code }),
      });
      if (res.status === 401) {
        el('otp-error').textContent = '認証コードが正しくありません。';
        el('otp-error').style.display = 'block';
      } else if (!res.ok) throw new Error('API Error');
      else {
        showToast('🚫 サーバーをブロックしました。', 'ok');
        el('otp-modal').style.display = 'none';
        // Refresh guild status
        const g = state.dbGuilds.find(x => x.guild_id === guildId);
        if (g) {
          if (!g.settings) g.settings = {};
          g.settings.blocked = true;
          // Refresh detail panel if open
          if (state.selectedGuildId === guildId) {
            const blockBtn = el('btn-block-guild');
            blockBtn.textContent = '✅ サーバーのブロックを解除';
            blockBtn.className = 'action-btn secondary';
          }
        }
      }
    } catch (err) {
      showToast('❌ 操作に失敗しました。', 'error');
    }
  }
});

el('btn-lock-unlock')?.addEventListener('click', () => {
  const code = el('lock-unlock-input').value.trim();
  if (code.length < 6) return;
  socket.emit('unlock_system', { code });
});

socket.on('unlock_result', (res) => {
  if (res.success) {
    el('lock-overlay').style.display = 'none';
    el('lock-unlock-input').value = '';
    el('lock-error').style.display = 'none';
    showToast('🔓 ボットのロックを解除しました！', 'ok');
  } else {
    const errorEl = el('lock-error') || el('otp-error');
    if (errorEl) {
      errorEl.textContent = '解除コードが正しくありません。';
      errorEl.style.display = 'block';
    }
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
    const statusTxt = isVoice ? '通話中' : '待機中';
    const iconHtml = g.icon
      ? `<img src="${g.icon}" class="srv-icon-sm" alt="">`
      : `<div style="width:28px;height:28px;border-radius:8px;background:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;font-size:12px">${g.name?.[0] || '?'}</div>`;

    tbody.insertAdjacentHTML('beforeend', `<tr>
      <td><div class="srv-name">${iconHtml} ${escHtml(g.name || 'Unknown')}</div></td>
      <td>${g.memberCount ?? '—'}</td>
      <td><span class="srv-status-dot" style="background:${statusColor}"></span>${statusTxt}</td>
      <td>${g.joined_at ? new Date(g.joined_at).toLocaleDateString() : '—'}</td>
      <td style="font-weight:700;color:var(--accent)">${g.ttsCount || 0}</td>
      <td>${g.cmdCount || 0}</td>
    </tr>`);
  });
}

function appendLogToCache(guildId, type, message) {
  const key = `${guildId || 'global'}:${type}`;
  if (!state.logCache.has(key)) state.logCache.set(key, []);
  const logs = state.logCache.get(key);
  logs.push({ t: new Date(), message });
  if (logs.length > 100) logs.shift();
}

function renderLogsFromCache(guildId, type) {
  const containerId = (guildId === 'global' && type === 'err') ? 'global-error-console' : `console-${type}`;
  const container = el(containerId);
  if (!container) return;

  const key = `${guildId}:${type}`;
  const logs = state.logCache.get(key) || [];

  if (logs.length === 0) {
    container.innerHTML = `<span style="color:#555">${type === 'err' ? '最近のエラーはありません。' : 'ログが見つかりません。'}</span>`;
    return;
  }

  container.innerHTML = logs.map(l => {
    const time = l.t.toLocaleTimeString();
    const isErr = type === 'err';
    return `<div class="log-line ${isErr ? 'err' : ''}">
      <span style="color:var(--text-muted)">[${time}]</span> 
      <span>${escHtml(l.message)}</span>
    </div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
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
      dg.live_status = live.voiceChannelId ? '通話中' : '待機中';
      dg.live_icon = live.icon || dg.icon_url;
    } else {
      dg.live_status = dg.status || '待機中';
      dg.live_icon = dg.icon_url;
    }
  });
  renderGuildItems();
  
  // Persist selected guild if we are in logs tab and have a saved ID
  const savedGid = localStorage.getItem('selectedGuildId');
  if (savedGid && !state.selectedGuildId) {
    const g = state.dbGuilds.find(x => x.guild_id === savedGid);
    if (g) openGuildDetail(g);
  }
}

function renderGuildItems(filter = '') {
  const container = el('guild-items');
  if (!container) return;
  const list = (state.dbGuilds || state.guilds.map(g => ({
    guild_id: g.id, name: g.name, live_icon: g.icon, live_status: g.voiceChannelId ? '通話中' : '待機中'
  }))).filter(g => g.name?.toLowerCase().includes(filter.toLowerCase()));

  container.innerHTML = '';
  list.forEach(g => {
    const iconHtml = g.live_icon
      ? `<img src="${g.live_icon}" class="guild-item-icon" alt="">`
      : `<div class="guild-item-icon-fallback">${(g.name || '?')[0].toUpperCase()}</div>`;
    const isSelected = state.selectedGuildId === g.guild_id;
    const item = document.createElement('div');
    item.className = 'guild-item' + (isSelected ? ' selected' : '');
    item.dataset.guildId = g.guild_id;
    item.innerHTML = `${iconHtml}<div class="guild-item-info"><div class="guild-item-name">${escHtml(g.name || '不明なサーバー')}</div><div class="guild-item-status">${g.live_status || '待機中'}</div></div>`;
    item.addEventListener('click', () => openGuildDetail(g));
    container.appendChild(item);
  });
}

el('guild-search')?.addEventListener('input', e => renderGuildItems(e.target.value));

// ── Guild Detail Panel ─────────────────────────────────────────────────────────
async function openGuildDetail(g) {
  state.selectedGuildId = g.guild_id;
  localStorage.setItem('selectedGuildId', g.guild_id);
  renderGuildItems(el('guild-search')?.value || '');

  el('log-placeholder').style.display = 'none';
  el('log-detail').style.display = 'flex';
  el('log-detail').style.flexDirection = 'column';

  // Header
  el('detail-name').textContent = g.name || 'Unknown';
  const iconEl = el('detail-icon');
  if (g.live_icon) { iconEl.src = g.live_icon; iconEl.style.display = 'block'; }
  else iconEl.style.display = 'none';

  const status = g.live_status || g.status || '待機中';
  const sBadge = el('detail-status-badge');
  sBadge.textContent = status;
  sBadge.className = 'status-badge-mini ' + (status.includes('通話') || status.includes('再生') ? 'voice' : status.includes('Karaoke') ? 'karaoke' : 'idle');

  // Switch to last active sub-tab (or default to analytics)
  const savedLTab = localStorage.getItem('activeLTab') || 'analytics';
  switchLTab(savedLTab);

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
    blockBtn.textContent = isBlocked ? '✅ サーバーのブロックを解除' : '🚫 サーバーをブロック';
    blockBtn.className = `action-btn ${isBlocked ? 'secondary' : 'danger'}`;
  };
  updateBlockBtn();
  blockBtn.onclick = async () => {
    const isCurrentlyBlocked = g.settings?.blocked === true;
    if (isCurrentlyBlocked) {
      // Unblocking doesn't require OTP (as per request)
      if (!confirm('✅ サーバーのブロックを解除しますか？')) return;
      try {
        const res = await fetch('/api/block-guild', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guildId: g.guild_id, blocked: false }),
        });
        if (res.ok) {
          showToast('✅ ブロックを解除しました。', 'ok');
          g.settings.blocked = false;
          updateBlockBtn();
        }
      } catch (e) { showToast('❌ 失敗しました。', 'error'); }
    } else {
      // Blocking requires OTP
      showOtpModal(`🚫 "${g.name}" をブロックするには認証が必要です。`, { type: 'block', guildId: g.guild_id });
    }
  };

  el('btn-edit-perms').onclick = () => {
    openPermModal(g.permissions || {});
  };

  el('btn-leave-guild').onclick = () => {
    showOtpModal(`🚪 "${g.name}" から退出するには認証が必要です。`, { type: 'leave', guildId: g.guild_id });
  };
  el('btn-reset-perms').onclick = async () => {
    if (!confirm(`⚠️ 本当に "${g.name}" の全権限をリセットしますか？\nすべてのカスタム許可/拒否ルールが削除されます。`)) return;
    showToast('🗑 権限をリセット中...', 'pending');
    try {
      const res = await fetch('/api/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildId: g.guild_id, permissions: {} }) // Empty triggers default on backend
      });
      if (!res.ok) throw new Error('Reset failed');
      const result = await res.json();
      showToast('✅ 権限をリセットしました！', 'ok');
      g.permissions = result.permissions || {};
      state.originalPermsJson = JSON.stringify(g.permissions);
      renderConfig(g.settings || {}, g.permissions);
    } catch (err) {
      showToast('❌ 権限のリセットに失敗しました。', 'error');
    }
  };
}

async function saveGuildSettings(guildId) {
  if (!guildId) return;
  const container = el('config-info-list');
  if (!container) return;

  const settings = {};
  container.querySelectorAll('input, select').forEach(input => {
    const key = input.dataset.key;
    if (!key) return;

    if (input.type === 'checkbox') {
      settings[key] = input.checked;
    } else if (input.type === 'number') {
      const val = parseFloat(input.value);
      settings[key] = isNaN(val) ? null : val;
    } else {
      settings[key] = input.value || null;
    }
  });

  showToast('⚙️ 設定を保存中...', 'pending');
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId, settings })
    });
    if (!res.ok) throw new Error('Save failed');
    const result = await res.json();
    showToast('✅ サーバー設定を更新しました！', 'ok');

    // Update local state
    const dg = state.dbGuilds?.find(x => x.guild_id === guildId);
    if (dg) dg.settings = result.settings;
  } catch (err) {
    console.error('[Settings] Save error:', err);
    showToast('❌ 設定の保存に失敗しました。', 'error');
  }
}

function removeGuildSetting(key) {
  if (!state.selectedGuildId) return;
  const dg = state.dbGuilds?.find(x => x.guild_id === state.selectedGuildId);
  if (!dg) return;

  dg.settings[key] = null;
  renderConfig(dg.settings, dg.permissions);
}

// Detail log tabs
document.querySelectorAll('.ltab').forEach(btn => {
  btn.addEventListener('click', () => switchLTab(btn.dataset.ltab));
});

function switchLTab(tab) {
  state.activeLTab = tab;
  localStorage.setItem('activeLTab', tab);
  document.querySelectorAll('.ltab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.lpane').forEach(p => p.classList.remove('active'));
  document.querySelector(`.ltab[data-ltab="${tab}"]`)?.classList.add('active');
  el(`lpane-${tab}`)?.classList.add('active');

  if (tab === 'bot' && state.selectedGuildId) renderLogsFromCache(state.selectedGuildId, 'bot');
  if (tab === 'tts' && state.selectedGuildId) renderLogsFromCache(state.selectedGuildId, 'tts');
  if (tab === 'cmd' && state.selectedGuildId) renderLogsFromCache(state.selectedGuildId, 'cmd');
  if (tab === 'err' && state.selectedGuildId) renderLogsFromCache(state.selectedGuildId, 'err');

  // Load backend logs for these types
  if (['bot', 'tts', 'cmd', 'sys', 'err'].includes(tab) && state.selectedGuildId) {
    loadLogsForPane(tab);
  }
}

async function loadLogsForPane(type) {
  const key = `${state.selectedGuildId}:${type}`;
  if (state.logCache.has(key)) {
    renderLogsFromCache(state.selectedGuildId, type);
    return;
  }

  const consoleEl = el(`console-${type}`);
  if (!consoleEl) return;
  consoleEl.innerHTML = '<span style="color:#555">読み込み中...</span>';

  const data = await safeFetch(`/api/logs?guildId=${state.selectedGuildId}&type=${type}&limit=100`);
  if (Array.isArray(data)) {
    state.logCache.set(key, data.map(l => ({ t: new Date(l.timestamp), message: l.message })));
    renderLogsFromCache(state.selectedGuildId, type);
  } else {
    consoleEl.innerHTML = '<span style="color:#555">ログが見つかりません。</span>';
  }
}

async function loadGlobalErrors() {
  const key = 'global:err';
  if (state.logCache.has(key)) {
    renderLogsFromCache('global', 'err');
    return;
  }

  const consoleEl = el('global-error-console');
  if (!consoleEl) return;
  consoleEl.innerHTML = '<span style="color:#555">読み込み中...</span>';

  const data = await safeFetch('/api/logs?type=err&limit=50');
  if (Array.isArray(data)) {
    state.logCache.set(key, data.map(l => ({ t: new Date(l.timestamp), message: l.message })));
    renderLogsFromCache('global', 'err');
  } else {
    consoleEl.innerHTML = '<span style="color:#555">最近のエラーはありません。</span>';
  }
}

function appendLog(pane, text, type) {
  // Legacy fallback for stdout stream categorization
  const gId = state.selectedGuildId || 'global';
  appendLogToCache(gId, pane, text);
  if (state.activeLTab === pane) renderLogsFromCache(gId, pane);
}

// Activity line chart
let activityChartInst = null;
let cmdChartInst = null;
let currentActivityRange = '24h';

// Graph controls listeners
document.querySelectorAll('#graph-range-picker .chip').forEach(chip => {
  chip.onclick = () => {
    document.querySelectorAll('#graph-range-picker .chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    currentActivityRange = chip.dataset.range;
    if (state.selectedGuildId) loadDetailAnalytics(state.selectedGuildId);
  };
});

el('graph-interval-value')?.addEventListener('change', () => {
  if (state.selectedGuildId) loadDetailAnalytics(state.selectedGuildId);
});
el('graph-interval-unit')?.addEventListener('change', () => {
  if (state.selectedGuildId) loadDetailAnalytics(state.selectedGuildId);
});

async function loadDetailAnalytics(guildId) {
  const hoursMap = { '24h': 24, '7d': 168, '30d': 720 };
  const hrs = hoursMap[currentActivityRange] || 24;
  const rawData = await safeFetch(`/api/analytics?guildId=${guildId}&hours=${hrs}`);
  if (!Array.isArray(rawData)) return;

  // 1. Grouping Logic
  const intVal = parseInt(el('graph-interval-value').value) || 1;
  const intUnit = el('graph-interval-unit').value; // 'm', 'h', 'd'
  const unitToMs = { 'm': 60000, 'h': 3600000, 'd': 86400000 };
  const intervalMs = intVal * unitToMs[intUnit];

  const groupedMap = new Map();
  rawData.forEach(r => {
    const t = new Date(r.snapshot_at).getTime();
    const bucket = Math.floor(t / intervalMs) * intervalMs;
    if (!groupedMap.has(bucket)) {
      groupedMap.set(bucket, {
        snapshot_at: bucket,
        texts_spoken: 0,
        commands_used: {},
        members_active: 0
      });
    }
    const bData = groupedMap.get(bucket);
    bData.texts_spoken += (r.texts_spoken || 0);
    bData.members_active = Math.max(bData.members_active, r.members_active || 0);
    Object.entries(r.commands_used || {}).forEach(([k, v]) => {
      bData.commands_used[k] = (bData.commands_used[k] || 0) + v;
    });
  });

  const data = Array.from(groupedMap.values()).sort((a, b) => a.snapshot_at - b.snapshot_at);

  // KPIs (Summary of ALL raw data in range, not just grouped)
  let totalTts = 0;
  let totalCmds = 0;
  let peakUsers = 0;

  rawData.forEach(r => {
    totalTts += (r.texts_spoken || 0);
    peakUsers = Math.max(peakUsers, r.members_active || 0);
    Object.values(r.commands_used || {}).forEach(v => {
      totalCmds += v;
    });
  });

  el('a-tts').textContent = totalTts;
  el('a-cmds').textContent = totalCmds;
  el('a-users').textContent = peakUsers;

  // Activity line chart
  // Activity line chart
  const labels = data.map(r => {
    const d = new Date(r.snapshot_at);
    if (intUnit === 'd' || (intUnit === 'h' && intVal >= 24)) {
      return d.toLocaleDateString('ja', { month: '2-digit', day: '2-digit' });
    }
    return d.toLocaleTimeString('ja', { hour: '2-digit', minute: '2-digit' });
  });
  const ttsSeries = data.map(r => r.texts_spoken || 0);
  const cmdSeries = data.map(r => Object.values(r.commands_used || {}).reduce((s, v) => s + v, 0));

  if (activityChartInst) activityChartInst.destroy();
  activityChartInst = new Chart(el('activityChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: '読み上げメッセージ', data: ttsSeries, backgroundColor: '#4318ffcc', borderRadius: 4, barPercentage: 0.8, categoryPercentage: 0.8 },
        { label: 'コマンド', data: cmdSeries, backgroundColor: '#05cd99cc', borderRadius: 4, barPercentage: 0.8, categoryPercentage: 0.8 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { position: 'top', labels: { font: { size: 11 }, boxWidth: 12 } } },
      scales: { 
        x: { grid: { display: false }, ticks: { font: { size: 9 } } }, 
        y: { beginAtZero: true, ticks: { font: { size: 10 } } } 
      }
    }
  });

  // Command breakdown bar chart
  const cmdBreakdown = {};
  data.forEach(r => {
    Object.entries(r.commands_used || {}).forEach(([k, v]) => {
      cmdBreakdown[k] = (cmdBreakdown[k] || 0) + v;
    });
  });
  const totals = { cmdBreakdown };

  const cmdKeys = Object.keys(totals.cmdBreakdown).sort((a, b) => totals.cmdBreakdown[b] - totals.cmdBreakdown[a]).slice(0, 10);
  const cmdVals = cmdKeys.map(k => totals.cmdBreakdown[k]);

  if (cmdChartInst) cmdChartInst.destroy();
  cmdChartInst = new Chart(el('cmdChart'), {
    type: 'bar',
    data: {
      labels: cmdKeys.map(k => `/${k}`),
      datasets: [{ label: '回数', data: cmdVals, backgroundColor: '#4318ffcc', borderRadius: 6 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { font: { size: 10 } } }, y: { beginAtZero: true, ticks: { font: { size: 10 } } } }
    }
  });
}

// Config pane
function renderConfig(settings, permissions) {
  const infoList = el('config-info-list');
  const permList = el('config-perm-list');
  if (!infoList || !permList) return;

  // Render placeholders first
  const rows = [
    { key: 'textChannelId', label: 'テキストチャンネル', type: 'select' },
    { key: 'readName', label: '名前読み上げ', type: 'checkbox' },
    { key: 'trimWordCount', label: '最大文字数', type: 'number', placeholder: '制限なし' },
    { key: 'announceVoice', label: '入退室通知 (VC)', type: 'checkbox' },
    { key: 'speakerId', label: '話者 ID', type: 'select_voice' },
    { key: 'speed', label: '速度 (Speed)', type: 'number', step: '0.1' },
    { key: 'pitch', label: 'ピッチ (Pitch)', type: 'number', step: '0.1' },
    { key: 'volume', label: '音量 (Volume)', type: 'number', step: '0.1' },
    { key: 'soundboardMode', label: 'サウンドボード', type: 'checkbox' },
    { key: 'karaokeVolume', label: '音楽音量', type: 'number', step: '0.1' },
  ];

  infoList.innerHTML = rows.map(r => {
    let inputHtml = '';
    const val = settings[r.key];

    if (r.type === 'checkbox') {
      inputHtml = `<input type="checkbox" data-key="${r.key}" ${val !== false ? 'checked' : ''}>`;
    } else if (r.type === 'select') {
      if (val) {
        // State A: Set
        const meta = state.metadataCache[state.selectedGuildId]?.[val];
        const name = meta?.name || val;
        inputHtml = `
          <div class="channel-badge" id="config-badge-${r.key}">
            <span class="channel-name-text">#${escHtml(name)}</span>
            <button class="btn-remove-channel" title="解除" onclick="removeGuildSetting('${r.key}')">✕</button>
            <input type="hidden" data-key="${r.key}" value="${val}">
          </div>`;
      } else {
        // State B: Unset
        inputHtml = `<select data-key="${r.key}" id="config-select-${r.key}"><option value="">読み込み中...</option></select>`;
      }
    } else if (r.type === 'select_voice') {
      const options = Object.entries(state.voiceNames).map(([id, name]) => 
        `<option value="${id}" ${Number(id) === Number(val) ? 'selected' : ''}>${escHtml(name)}</option>`
      ).join('');
      inputHtml = `<select data-key="${r.key}">${options}</select>`;
    } else {
      inputHtml = `<input type="${r.type}" data-key="${r.key}" step="${r.step || '1'}" value="${val ?? ''}" placeholder="${r.placeholder || ''}">`;
    }

    const isSingleLine = r.type === 'select' && !!val;
    const label = isSingleLine ? `${r.label}:` : r.label;

    return `<div class="config-row ${isSingleLine ? 'single-line' : ''}"><span>${label}</span><span>${inputHtml}</span></div>`;
  }).join('');

  // Async: Populate channel dropdown (only if in select state)
  const select = el('config-select-textChannelId');
  if (state.selectedGuildId && select) {
    safeFetch(`/api/guild-channels?guildId=${state.selectedGuildId}`).then(data => {
      if (!select) return;
      if (data && Array.isArray(data.channels)) {
        select.innerHTML = '<option value="">(選択してください)</option>' + data.channels.map(c =>
          `<option value="${c.id}">#${escHtml(c.name)}</option>`
        ).join('');
      } else {
        select.innerHTML = '<option value="">取得失敗</option>';
      }
    });
  }

  // Add listener for Save Settings button (one-time setup if not already)
  const saveBtn = el('btn-save-settings');
  if (saveBtn) {
    saveBtn.onclick = () => saveGuildSettings(state.selectedGuildId);
  }

  const permObj = (permissions && Object.keys(permissions).length > 0) ? permissions : (settings.permissions || {});
  state.currentPerms = JSON.parse(JSON.stringify(permObj));

  const permEntries = Object.entries(permObj);
  if (permEntries.length) {
    const categories = {
      '🎮 基本・一般': [],
      '🎙️ ユーザー設定': [],
      '🎶 音楽再生': [],
      '🔒 権限・防衛': [],
      '🛡️ サーバー管理': [],
      '⚙️ デフォルト設定': [],
      '🔊 サウンドボード': [],
      '📖 辞書・絵文字': [],
      '📦 その他': []
    };

    const mapping = {
      'vc': '🎮 基本・一般', 'help': '🎮 基本・一般', 'mystatus': '🎮 基本・一般', 'serverstatus': '🎮 基本・一般',
      'set': '🎙️ ユーザー設定',
      'readname': '🛡️ サーバー管理', 'announce': '🛡️ サーバー管理', 'trim': '🛡️ サーバー管理',
      'play': '🎶 音楽再生', 'pause': '🎶 音楽再生', 'skip': '🎶 音楽再生', 'queue': '🎶 音楽再生', 'lyrics': '🎶 音楽再生', 'musicvolume': '🎶 音楽再生', 'loop': '🎶 音楽再生',
      'soundboard': '🔊 サウンドボード', 'customsound': '🔊 サウンドボード',
      'customemoji': '📖 辞書・絵文字', 'addword': '📖 辞書・絵文字', 'delword': '📖 辞書・絵文字', 'listwords': '📖 辞書・絵文字',
      'setchannel': '🛡️ サーバー管理', 'cleanchat': '🛡️ サーバー管理',
      'set-server': '⚙️ デフォルト設定',
      'permissions': '🔒 権限・防衛'
    };

    permEntries.forEach(([cmd, rules]) => {
      const baseCmd = cmd.split(' ')[0];
      const cat = mapping[baseCmd] || '📦 その他';
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
          const isEveryone = id === state.selectedGuildId || id === '@everyone' || id === 'everyone';
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
        fetch(`/api/resolve-metadata?guildId=${state.selectedGuildId}&ids=${unknownIds.join(',')}`).catch(() => { });
      }
    }
  } else {
    permList.innerHTML = '<div class="config-row"><span>カスタム権限なし</span></div>';
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
  'vc', 'setchannel', 'set voice', 'set speed', 'set pitch', 'set volume',
  'soundboard', 'serverstatus', 'mystatus', 'help',
  'readname', 'announce', 'cleanchat', 'trim',
  'permissions set', 'permissions list', 'permissions reset',
  'play', 'pause', 'skip', 'queue', 'lyrics', 'musicvolume', 'loop',
  'set-server voice', 'set-server speed', 'set-server pitch', 'set-server volume',
  'customsound add', 'customsound remove', 'customsound list',
  'customemoji add', 'customemoji remove', 'customemoji list'
];

const COMMAND_CATEGORIES = {
  '🎮 基本・一般': ['vc', 'help', 'mystatus', 'serverstatus'],
  '🎙️ ユーザー設定': ['set voice', 'set speed', 'set pitch', 'set volume'],
  '🎶 音楽再生': ['play', 'pause', 'skip', 'loop', 'queue', 'lyrics', 'musicvolume'],
  '🔒 権限・防衛': ['permissions set', 'permissions list', 'permissions reset'],
  '🛡️ サーバー管理': ['setchannel', 'cleanchat', 'readname', 'announce', 'trim'],
  '⚙️ デフォルト設定': ['set-server voice', 'set-server speed', 'set-server pitch', 'set-server volume'],
  '🔊 サウンドボード': ['soundboard', 'customsound add', 'customsound remove', 'customsound list'],
  '📖 辞書・絵文字': ['customemoji add', 'customemoji remove', 'customemoji list']
};

// ── Permission Modal (Two-Panel Redesign) ──────────────────────────────────────

// Guild member+role cache for the currently open guild
let permModalMembers = [];
let permModalRoles = [];
let permActivePtab = 'members'; // 'members' | 'roles'

function openPermModal(perms, focusCmd) {
  state.originalPermsJson = JSON.stringify(perms || {});
  state.editingPerms = JSON.parse(state.originalPermsJson);
  state.selectedPermCmd = focusCmd || null;
  state.selectedPermCategory = null;

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
    permModalRoles = [];
    fetch(`/api/guild-members-roles?guildId=${state.selectedGuildId}`)
      .then(r => r.json())
      .then(data => {
        if (data && Array.isArray(data.members)) permModalMembers = data.members;
        if (data && Array.isArray(data.roles)) permModalRoles = data.roles;
        renderPickerGrid();
      })
      .catch(() => { });
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

  Object.entries(COMMAND_CATEGORIES).forEach(([catName, cmdList]) => {
    const filtered = cmdList.filter(cmd => cmd.toLowerCase().includes(q));
    if (filtered.length === 0) return;

    const catHeader = document.createElement('div');
    catHeader.className = 'perm-cmd-category-header' + (state.selectedPermCategory === catName ? ' active' : '');
    catHeader.textContent = catName;
    catHeader.addEventListener('click', () => {
      state.selectedPermCategory = catName;
      state.selectedPermCmd = null;
      renderPermCmdList();
      renderPickerGrid();
      updateSelectedCmdLabel();
    });
    container.appendChild(catHeader);

    filtered.forEach(cmd => {
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
        state.selectedPermCategory = null;
        renderPermCmdList();
        renderPickerGrid();
        updateSelectedCmdLabel();
      });
      container.appendChild(row);
    });
  });
}

function updateSelectedCmdLabel() {
  const label = el('perm-selected-cmd-label');
  const bulk = el('perm-bulk-actions');
  if (!label || !bulk) return;
  if (state.selectedPermCmd) {
    label.textContent = `編集中のコマンド: /${state.selectedPermCmd}`;
    label.classList.add('active');
    bulk.style.display = 'flex';
  } else if (state.selectedPermCategory) {
    label.textContent = `編集中のカテゴリー: ${state.selectedPermCategory}`;
    label.classList.add('active');
    bulk.style.display = 'flex';
  } else {
    label.textContent = '← コマンドまたはカテゴリーを選択するのだ';
    label.classList.remove('active');
    bulk.style.display = 'none';
  }
}

function renderPickerGrid() {
  const q = (el('perm-picker-search')?.value || '').toLowerCase();
  renderEntityGrid('members', permModalMembers.filter(m => m.name.toLowerCase().includes(q)));
  renderEntityGrid('roles', permModalRoles.filter(r => r.name.toLowerCase().includes(q)));
}

function renderEntityGrid(type, items) {
  const gridId = type === 'members' ? 'perm-members-grid' : 'perm-roles-grid';
  const grid = el(gridId);
  if (!grid) return;

  if (items.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);font-size:13px;padding:24px;">${state.selectedGuildId ? (permModalMembers.length === 0 && type === 'members' ? '読み込み中…' : '結果なし') : '先にサーバーを選択してほしいのだ'}</div>`;
    return;
  }

  grid.innerHTML = '';
  items.forEach(item => {
    const id = item.id;
    const cmd = state.selectedPermCmd;
    const cat = state.selectedPermCategory;

    let currentState = null;
    if (cmd) {
      currentState = state.editingPerms[cmd]?.[id] || null;
    } else if (cat) {
      const cmds = COMMAND_CATEGORIES[cat] || [];
      const states = cmds.map(c => state.editingPerms[c]?.[id] || null);
      if (states.every(s => s === states[0])) currentState = states[0];
      else currentState = 'mixed';
    }

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

    const stateLabel = currentState === 'allow' ? '許可' : currentState === 'deny' ? '拒否' : (currentState === 'mixed' ? '混合' : 'なし');
    const stateClass = currentState === 'allow' ? 'st-allow' : currentState === 'deny' ? 'st-deny' : (currentState === 'mixed' ? 'st-pending' : 'st-none');

    card.innerHTML = `
      ${avatarHtml}
      <div class="perm-entity-name">${escHtml(item.name)}</div>
      <div class="perm-entity-state ${stateClass}">${stateLabel}</div>
    `;

    card.addEventListener('click', () => {
      if (!state.selectedPermCmd && !state.selectedPermCategory) {
        showToast('← 先に左側でコマンドかカテゴリーを選択してほしいのだ', 'pending');
        return;
      }

      const cmds = state.selectedPermCmd ? [state.selectedPermCmd] : COMMAND_CATEGORIES[state.selectedPermCategory];

      // Get current state for cycling
      let cur;
      if (state.selectedPermCmd) {
        cur = state.editingPerms[state.selectedPermCmd]?.[id] || null;
      } else {
        // For category, if mixed or any are different, cycle starts from first command's state
        cur = state.editingPerms[cmds[0]]?.[id] || null;
        // If it's mixed, let's just default to 'allow' as first click
        const states = cmds.map(c => state.editingPerms[c]?.[id] || null);
        if (!states.every(s => s === states[0])) cur = 'mixed';
      }

      let next;
      if (cur === null) next = 'allow';
      else if (cur === 'allow') next = 'deny';
      else if (cur === 'deny') next = null;
      else next = 'allow'; // from mixed to allow

      cmds.forEach(c => {
        if (!state.editingPerms[c]) state.editingPerms[c] = {};
        if (next === null) {
          delete state.editingPerms[c][id];
          if (Object.keys(state.editingPerms[c]).length === 0) delete state.editingPerms[c];
        } else {
          state.editingPerms[c][id] = next;
        }
      });

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
    el('perm-roles-grid').style.display = permActivePtab === 'roles' ? '' : 'none';
  });
});

el('perm-cmd-search').oninput = renderPermCmdList;
el('perm-picker-search').oninput = renderPickerGrid;

el('btn-close-perms').onclick = closePermModal;
el('btn-cancel-perms').onclick = closePermModal;

function closePermModal() {
  if (JSON.stringify(state.editingPerms) !== state.originalPermsJson) {
    if (!confirm('保存されていない変更があります。破棄して閉じますか？')) return;
  }
  el('perm-modal').style.display = 'none';
}
el('btn-save-perms').onclick = savePermissions;

el('btn-perm-allow-all').onclick = () => setBulkPermission('allow');
el('btn-perm-deny-all').onclick = () => setBulkPermission('deny');

function setBulkPermission(action) {
  if ((!state.selectedPermCmd && !state.selectedPermCategory) || !state.selectedGuildId) return;
  const cmds = state.selectedPermCmd ? [state.selectedPermCmd] : COMMAND_CATEGORIES[state.selectedPermCategory];

  cmds.forEach(c => {
    state.editingPerms[c] = { [state.selectedGuildId]: action };
  });

  renderPermCmdList();
  renderPickerGrid();
  showToast(`✅ ${state.selectedPermCmd ? '/' + state.selectedPermCmd : state.selectedPermCategory} を全員 ${action === 'allow' ? '許可' : '拒否'} に設定しました`, 'ok');
}

async function savePermissions() {
  showToast('💾 権限を保存中...', 'pending');
  try {
    const res = await fetch('/api/permissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guildId: state.selectedGuildId, permissions: state.editingPerms })
    });
    if (!res.ok) throw new Error('Save failed');
    const result = await res.json();
    showToast('✅ 権限を更新しました！', 'ok');
    el('perm-modal').style.display = 'none';

    const dg = state.dbGuilds.find(g => g.guild_id === state.selectedGuildId);
    if (dg) {
      dg.permissions = result.permissions || state.editingPerms;
      state.originalPermsJson = JSON.stringify(dg.permissions);
    }
    renderConfig(dg?.settings || {}, dg?.permissions || state.editingPerms);
  } catch (err) {
    showToast('❌ 権限の保存に失敗しました。', 'error');
  }
}

// ── Error Notifications ────────────────────────────────────────────────────────
function pushError(msg) {
  state.errors.push({ msg, time: now() });
  // Badge
  const badge = el('notif-badge');
  if (badge && state.activeTab !== 'tab-account') {
    badge.textContent = state.errors.length;
    badge.style.display = 'flex';
    badge.classList.add('has-new');
  }
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
  if (confirm('ボットエコシステムを再起動しますか？現在のエラーダッシュボードもクリアされます。')) {
    socket.emit('restart_bot');
    // Clear local error state
    state.errors = [];
    const badge = el('notif-badge');
    if (badge) { badge.textContent = '0'; badge.style.display = 'none'; }
    const list = el('notif-list');
    if (list) {
      list.innerHTML = '<p class="notif-empty">エラーログはありません。</p>';
    }
    el('kpi-errors').textContent = '0';
    showToast('↺ 再起動してログをクリア中…', 'pending');
  }
});
el('btn-stop')?.addEventListener('click', () => { socket.emit('stop_bot'); showToast('⏹ 停止をリクエストしました…', 'pending'); });
el('btn-start')?.addEventListener('click', () => { socket.emit('start_bot'); showToast('▶ 起動をリクエストしました…', 'pending'); });
el('btn-kill-all')?.addEventListener('click', () => { if (confirm('全サービスを終了しますか？')) { socket.emit('kill_all'); showToast('⏻ シャットダウン中…', 'pending'); } });

// ── Utility ───────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getSessionCommandsForGuild(guildId) {
  const g = state.guilds.find(x => x.id === guildId);
  return g ? (g.cmdCount || 0) : 0;
}

// ── Boot ──────────────────────────────────────────────────────────────────────
setupNav();
const initialTab = localStorage.getItem('activeTab') || 'tab-dashboard';
switchTab(initialTab);
initCharts();

// Load recent global logs for boot
safeFetch('/api/logs?limit=30').then(logs => {
  if (Array.isArray(logs)) {
    logs.forEach(l => {
      if (l.type === 'err') pushError(l.message);
    });
  }
});
