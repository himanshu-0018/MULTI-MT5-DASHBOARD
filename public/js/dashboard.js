/**
 * QuantPulse Multi-MT5 Executive Terminal Controller
 * Features: Passcode Security, Multi-Profile Scoping, Magic Merging, Active Pending Orders, and ApexCharts
 */

// ============================================================================
// 1. GLOBAL STATE & CONFIGURATION
// ============================================================================
const AppState = {
  auth: {
    isAdmin: false,
    adminPin: localStorage.getItem('quantpulse_admin_pin') || '',
    shareToken: null,
    isShareMode: false,
    shareInfo: null
  },
  filters: {
    selectedProfileId: 'ALL',
    selectedAccountId: 'ALL',
    dateRange: 'all', // all, month, week, today, custom
    customStartDate: null,
    customEndDate: null,
    searchQuery: ''
  },
  data: {
    accounts: [],
    profiles: [],
    openPositions: [],
    pendingOrders: [],
    closedTrades: [],
    eaPerformance: [],
    equityCurve: []
  },
  charts: {
    equityBalance: null,
    eaDistribution: null
  },
  pollTimer: null,
  pollIntervalMs: 3000
};

// ============================================================================
// 2. INITIALIZATION & LIFECYCLE
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  checkUrlParamsForShare();

  if (AppState.auth.isShareMode) {
    // Authenticate via Share Token
    await validateShareTokenAndInit();
  } else if (AppState.auth.adminPin) {
    // Attempt Auto-Login with stored PIN
    await attemptAdminLogin(AppState.auth.adminPin, true);
  } else {
    // Show Master Passcode Lock Screen
    showLockScreen();
  }
});

function checkUrlParamsForShare() {
  const urlParams = new URLSearchParams(window.location.search);
  const share = urlParams.get('share');
  if (share && share.trim().length > 0) {
    AppState.auth.shareToken = share.trim();
    AppState.auth.isShareMode = true;
  }
}

// ============================================================================
// 3. AUTHENTICATION & LOCK SCREEN LOGIC
// ============================================================================
function showLockScreen(errorMsg = null) {
  const lockScreen = document.getElementById('lockScreen');
  const errorEl = document.getElementById('lockErrorMsg');
  const errorText = document.getElementById('lockErrorText');

  lockScreen.classList.add('active');
  if (errorMsg) {
    errorText.textContent = errorMsg;
    errorEl.classList.remove('hidden');
  } else {
    errorEl.classList.add('hidden');
  }
  document.getElementById('pinInput').value = '';
  document.getElementById('pinInput').focus();
}

function hideLockScreen() {
  document.getElementById('lockScreen').classList.remove('active');
}

async function attemptAdminLogin(pin, isAutoLogin = false) {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      AppState.auth.isAdmin = true;
      AppState.auth.adminPin = pin;
      localStorage.setItem('quantpulse_admin_pin', pin);
      hideLockScreen();
      initializeTerminal();
    } else {
      if (isAutoLogin) {
        localStorage.removeItem('quantpulse_admin_pin');
        AppState.auth.adminPin = '';
      }
      showLockScreen(data.message || 'Invalid Master Passcode.');
    }
  } catch (err) {
    console.error('Login request failed:', err);
    showLockScreen('Connection to server failed. Please retry.');
  }
}

async function validateShareTokenAndInit() {
  try {
    const res = await fetch(`/api/share/info?token=${encodeURIComponent(AppState.auth.shareToken)}`);
    const data = await res.json();

    if (res.ok && data.success) {
      AppState.auth.shareInfo = data.share;
      hideLockScreen();

      // Adjust UI for Shared Read-Only View
      document.getElementById('adminActionTools').classList.add('hidden');
      document.getElementById('shareModeBadge').classList.remove('hidden');

      if (data.share.from_date) {
        AppState.filters.customStartDate = data.share.from_date;
        AppState.filters.dateRange = 'custom';
      }

      initializeTerminal();
    } else {
      // Invalid or expired token: kick back to Lock Screen
      showLockScreen(data.message || 'Shared link is expired or invalid.');
    }
  } catch (err) {
    console.error('Share verification failed:', err);
    showLockScreen('Unable to verify share link.');
  }
}

function lockTerminal() {
  localStorage.removeItem('quantpulse_admin_pin');
  AppState.auth.isAdmin = false;
  AppState.auth.adminPin = '';
  if (AppState.pollTimer) clearInterval(AppState.pollTimer);
  showLockScreen();
}

// ============================================================================
// 4. API REQUEST WRAPPER (INJECTS HEADERS AUTOMATICALLY)
// ============================================================================
async function apiFetch(endpoint, options = {}) {
  const headers = options.headers || {};

  if (AppState.auth.isAdmin && AppState.auth.adminPin) {
    headers['x-admin-token'] = AppState.auth.adminPin;
  } else if (AppState.auth.isShareMode && AppState.auth.shareToken) {
    headers['x-share-token'] = AppState.auth.shareToken;
  }

  options.headers = headers;

  const url = new URL(endpoint, window.location.origin);
  if (AppState.filters.selectedProfileId && AppState.filters.selectedProfileId !== 'ALL') {
    url.searchParams.set('profileId', AppState.filters.selectedProfileId);
  }
  if (AppState.filters.selectedAccountId && AppState.filters.selectedAccountId !== 'ALL') {
    url.searchParams.set('accountId', AppState.filters.selectedAccountId);
  }
  if (AppState.filters.dateRange !== 'all') {
    url.searchParams.set('range', AppState.filters.dateRange);
    if (AppState.filters.dateRange === 'custom') {
      if (AppState.filters.customStartDate) url.searchParams.set('startDate', AppState.filters.customStartDate);
      if (AppState.filters.customEndDate) url.searchParams.set('endDate', AppState.filters.customEndDate);
    }
  }

  const response = await fetch(url.toString(), options);

  if (response.status === 401) {
    // Session unauthorized -> lock terminal
    lockTerminal();
    throw new Error('Unauthorized Access. Terminal Locked.');
  }

  return response.json();
}

// ============================================================================
// 5. INITIALIZE DASHBOARD & DATA POLLING
// ============================================================================
async function initializeTerminal() {
  initCharts();
  await loadProfiles();
  await refreshDashboardData();

  if (AppState.pollTimer) clearInterval(AppState.pollTimer);
  AppState.pollTimer = setInterval(refreshDashboardData, AppState.pollIntervalMs);
}

async function refreshDashboardData() {
  try {
    const [accData, posData, pendData, tradesData, eaData, curveData] = await Promise.all([
      apiFetch('/api/accounts'),
      apiFetch('/api/positions'),
      apiFetch('/api/pending'),
      apiFetch('/api/trades'),
      apiFetch('/api/ea/performance'),
      apiFetch('/api/equity-curve')
    ]);

    if (accData.success) AppState.data.accounts = accData.accounts || [];
    if (posData.success) AppState.data.openPositions = posData.positions || [];
    if (pendData.success) AppState.data.pendingOrders = pendData.pending || [];
    if (tradesData.success) AppState.data.closedTrades = tradesData.trades || [];
    if (eaData.success) AppState.data.eaPerformance = eaData.eaPerformance || [];
    if (curveData.success) AppState.data.equityCurve = curveData.curve || [];

    renderKPIs();
    renderAccountFilterDropdown();
    renderOpenPositions();
    renderPendingOrders();
    renderEAPerformance();
    renderClosedTrades();
    renderAccountsMatrix();
    updateCharts();

    document.getElementById('lastSyncedTime').textContent = `Last Sync: ${new Date().toLocaleTimeString()}`;
    document.getElementById('serverStatusBadge').className = 'connection-status-pill online';
    document.getElementById('serverStatusText').textContent = 'LIVE FEED';
  } catch (err) {
    console.error('Data refresh error:', err);
    document.getElementById('serverStatusBadge').className = 'connection-status-pill offline';
    document.getElementById('serverStatusText').textContent = 'RECONNECTING...';
  }
}

// ============================================================================
// 6. UI EVENT LISTENERS SETUP
// ============================================================================
function setupEventListeners() {
  // Lock screen PIN submission
  document.getElementById('lockForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const pin = document.getElementById('pinInput').value.trim();
    if (pin) attemptAdminLogin(pin);
  });

  // Toggle PIN visibility
  document.getElementById('btnTogglePin').addEventListener('click', () => {
    const pinInput = document.getElementById('pinInput');
    pinInput.type = pinInput.type === 'password' ? 'text' : 'password';
  });

  // Lock Terminal button
  document.getElementById('btnLockTerminal').addEventListener('click', lockTerminal);

  // Profile selector change
  document.getElementById('profileSelect').addEventListener('change', (e) => {
    AppState.filters.selectedProfileId = e.target.value;
    AppState.filters.selectedAccountId = 'ALL';
    updateActiveProfileLabel();
    refreshDashboardData();
  });

  // Account filter dropdown change
  document.getElementById('accountFilter').addEventListener('change', (e) => {
    AppState.filters.selectedAccountId = e.target.value;
    refreshDashboardData();
  });

  // Date Range Pills
  document.querySelectorAll('.date-filter-group .btn-filter-pill').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const range = btn.getAttribute('data-range');
      if (range) {
        document.querySelectorAll('.date-filter-group .btn-filter-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        AppState.filters.dateRange = range;
        refreshDashboardData();
      }
    });
  });

  // Custom Date Modal Trigger
  document.getElementById('btnCustomDate').addEventListener('click', () => {
    openModal('customDateModal');
  });

  document.getElementById('btnApplyCustomDate').addEventListener('click', () => {
    const start = document.getElementById('customStartDateInput').value;
    const end = document.getElementById('customEndDateInput').value;
    if (start) {
      AppState.filters.dateRange = 'custom';
      AppState.filters.customStartDate = start;
      AppState.filters.customEndDate = end || null;
      document.querySelectorAll('.date-filter-group .btn-filter-pill').forEach(b => b.classList.remove('active'));
      document.getElementById('btnCustomDate').classList.add('active');
      closeModal('customDateModal');
      refreshDashboardData();
    }
  });

  // Main Tabs navigation
  document.querySelectorAll('.table-nav-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.table-nav-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const targetTabId = btn.getAttribute('data-tab');
      document.getElementById(targetTabId).classList.add('active');
    });
  });

  // Closed Trades Filter Search
  document.getElementById('tradeSearchInput').addEventListener('input', (e) => {
    AppState.filters.searchQuery = e.target.value.toLowerCase();
    renderClosedTrades();
  });

  // Profile Manager Modal
  document.getElementById('btnOpenProfiles').addEventListener('click', () => {
    populateProfileAccountsList();
    renderExistingProfilesList();
    openModal('profileManagerModal');
  });

  document.getElementById('btnCreateProfileSubmit').addEventListener('click', createNewProfile);

  // Share Generator Modal
  document.getElementById('btnOpenShare').addEventListener('click', () => {
    populateShareProfileDropdown();
    renderActiveSharesList();
    document.getElementById('generatedShareUrlBox').classList.add('hidden');
    openModal('shareLinkModal');
  });

  document.getElementById('btnGenerateShareSubmit').addEventListener('click', generateShareLink);

  document.getElementById('btnCopyGeneratedUrl').addEventListener('click', () => {
    const input = document.getElementById('shareGeneratedUrlInput');
    input.select();
    navigator.clipboard.writeText(input.value);
    const alert = document.getElementById('copySuccessAlert');
    alert.style.display = 'block';
    setTimeout(() => { alert.style.display = 'none'; }, 3000);
  });

  // EA Rename / Merge Modal Submit
  document.getElementById('btnSaveEaNameSubmit').addEventListener('click', submitEaRename);

  // Generic modal close handler
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close');
      closeModal(modalId);
    });
  });
}

function openModal(modalId) {
  document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
}

function updateActiveProfileLabel() {
  const select = document.getElementById('profileSelect');
  const selectedText = select.options[select.selectedIndex]?.text || 'All Accounts';
  document.getElementById('activeProfileLabel').textContent = `Profile: ${selectedText}`;
}

// ============================================================================
// 7. RENDER KPI CARDS
// ============================================================================
function renderKPIs() {
  const accounts = AppState.data.accounts;
  const positions = AppState.data.openPositions;
  const pending = AppState.data.pendingOrders;
  const trades = AppState.data.closedTrades;

  // Aggregate Balance & Equity
  const totalBalance = accounts.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);
  const totalEquity = accounts.reduce((sum, a) => sum + (Number(a.equity) || 0), 0);
  const totalFreeMargin = accounts.reduce((sum, a) => sum + (Number(a.free_margin) || 0), 0);
  const floatingPnl = positions.reduce((sum, p) => sum + (Number(p.profit) || 0), 0);

  // Closed Trades Stats
  let grossProfit = 0;
  let grossLoss = 0;
  let wins = 0;
  let todayPnl = 0;
  const todayStr = new Date().toISOString().slice(0, 10);

  trades.forEach(t => {
    const p = Number(t.profit) || 0;
    if (p > 0) {
      grossProfit += p;
      wins++;
    } else {
      grossLoss += Math.abs(p);
    }
    if (t.close_time && t.close_time.startsWith(todayStr)) {
      todayPnl += p;
    }
  });

  const totalTrades = trades.length;
  const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0';
  const netClosedPnl = grossProfit - grossLoss;
  const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : (grossProfit > 0 ? 'MAX' : '0.00');

  // Pending totals
  const pendingCount = pending.length;
  const pendingLots = pending.reduce((sum, o) => sum + (Number(o.lots) || 0), 0);

  // DOM Bindings
  document.getElementById('kpiBalance').textContent = formatCurrency(totalBalance);
  document.getElementById('kpiEquity').textContent = formatCurrency(totalEquity);
  document.getElementById('kpiFreeMargin').textContent = `Free Margin: ${formatCurrency(totalFreeMargin)}`;

  const floatingEl = document.getElementById('kpiFloatingPnl');
  floatingEl.textContent = formatCurrency(floatingPnl);
  floatingEl.className = `kpi-value ${floatingPnl >= 0 ? 'text-positive' : 'text-negative'}`;
  document.getElementById('kpiOpenPositionsCount').textContent = `${positions.length} Open Positions`;

  const closedEl = document.getElementById('kpiClosedPnl');
  closedEl.textContent = formatCurrency(netClosedPnl);
  closedEl.className = `kpi-value ${netClosedPnl >= 0 ? 'text-positive' : 'text-negative'}`;
  document.getElementById('kpiWinRate').textContent = `Win Rate: ${winRate}% (${wins}/${totalTrades})`;

  const todayEl = document.getElementById('kpiTodayPnl');
  todayEl.textContent = formatCurrency(todayPnl);
  todayEl.className = `kpi-value ${todayPnl >= 0 ? 'text-positive' : 'text-negative'}`;
  document.getElementById('kpiProfitFactor').textContent = `Profit Factor: ${profitFactor}`;

  document.getElementById('kpiPendingCount').textContent = pendingCount;
  document.getElementById('kpiPendingLots').textContent = `Total Lots: ${pendingLots.toFixed(2)}`;

  document.getElementById('tabBadgeOpen').textContent = positions.length;
  document.getElementById('tabBadgePending').textContent = pendingCount;
}

// ============================================================================
// 8. RENDER DATA TABLES
// ============================================================================

// Live Open Positions Table
function renderOpenPositions() {
  const tbody = document.getElementById('openPositionsTableBody');
  const positions = AppState.data.openPositions;

  if (!positions || positions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="empty-state">No open positions currently active.</td></tr>`;
    return;
  }

  tbody.innerHTML = positions.map(pos => {
    const profitClass = (pos.profit >= 0) ? 'text-positive' : 'text-negative';
    const typeClass = (pos.type && pos.type.toUpperCase() === 'BUY') ? 'badge-buy' : 'badge-sell';

    return `
      <tr>
        <td class="font-mono">${escapeHtml(pos.ticket)}</td>
        <td><span class="badge-account">${escapeHtml(pos.account_number)}</span></td>
        <td class="font-bold">${escapeHtml(pos.symbol)}</td>
        <td><span class="${typeClass}">${escapeHtml(pos.type)}</span></td>
        <td>${Number(pos.lots).toFixed(2)}</td>
        <td class="font-mono">${Number(pos.open_price).toFixed(5)}</td>
        <td class="font-mono">${Number(pos.current_price).toFixed(5)}</td>
        <td class="font-mono">${Number(pos.sl || 0).toFixed(5)} / ${Number(pos.tp || 0).toFixed(5)}</td>
        <td>
          <span class="badge-ea-tag" onclick="openEaRenameModal('${pos.magic_number}', '${escapeHtml(pos.ea_name)}')">
            <i class="fa-solid fa-robot"></i> ${escapeHtml(pos.ea_name || 'Manual / ' + pos.magic_number)}
          </span>
        </td>
        <td>${formatDateTime(pos.open_time)}</td>
        <td class="${profitClass} font-bold font-mono">${formatCurrency(pos.profit)}</td>
      </tr>
    `;
  }).join('');
}

// Active Pending Orders Table
function renderPendingOrders() {
  const tbody = document.getElementById('pendingOrdersTableBody');
  const pending = AppState.data.pendingOrders;

  if (!pending || pending.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="empty-state">No active pending orders at this moment.</td></tr>`;
    return;
  }

  tbody.innerHTML = pending.map(ord => {
    const type = (ord.order_type || '').toUpperCase();
    const typeClass = type.includes('BUY') ? 'badge-buy' : 'badge-sell';
    
    // Calculate distance in points if available
    let distancePoints = '-';
    if (ord.current_price && ord.price_target) {
      const diff = Math.abs(Number(ord.price_target) - Number(ord.current_price));
      distancePoints = diff.toFixed(5);
    }

    return `
      <tr>
        <td class="font-mono">${escapeHtml(ord.ticket)}</td>
        <td><span class="badge-account">${escapeHtml(ord.account_number)}</span></td>
        <td class="font-bold">${escapeHtml(ord.symbol)}</td>
        <td><span class="${typeClass}">${escapeHtml(type)}</span></td>
        <td>${Number(ord.lots).toFixed(2)}</td>
        <td class="font-mono font-bold">${Number(ord.price_target).toFixed(5)}</td>
        <td class="font-mono">${Number(ord.current_price || 0).toFixed(5)}</td>
        <td class="font-mono text-muted">${distancePoints}</td>
        <td class="font-mono">${Number(ord.sl || 0).toFixed(5)} / ${Number(ord.tp || 0).toFixed(5)}</td>
        <td>
          <span class="badge-ea-tag" onclick="openEaRenameModal('${ord.magic_number}', '${escapeHtml(ord.ea_name)}')">
            <i class="fa-solid fa-robot"></i> ${escapeHtml(ord.ea_name || 'Magic ' + ord.magic_number)}
          </span>
        </td>
        <td>${formatDateTime(ord.setup_time)}</td>
      </tr>
    `;
  }).join('');
}

// EA Performance & Magic Merging Table
function renderEAPerformance() {
  const tbody = document.getElementById('eaPerformanceTableBody');
  const eaList = AppState.data.eaPerformance;

  if (!eaList || eaList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="empty-state">No EA performance records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = eaList.map(ea => {
    const netClass = (ea.net_profit >= 0) ? 'text-positive' : 'text-negative';
    const magicsDisplay = (ea.magic_numbers || []).join(', ');

    return `
      <tr>
        <td class="font-bold text-highlight">
          <i class="fa-solid fa-robot"></i> ${escapeHtml(ea.ea_name)}
        </td>
        <td><span class="badge-magic-group font-mono">${magicsDisplay || 'None'}</span></td>
        <td>${ea.active_accounts_count || 1} Account(s)</td>
        <td>${ea.total_trades}</td>
        <td>${Number(ea.win_rate || 0).toFixed(1)}%</td>
        <td>${Number(ea.profit_factor || 0).toFixed(2)}</td>
        <td class="text-positive font-mono">${formatCurrency(ea.gross_profit || 0)}</td>
        <td class="text-negative font-mono">${formatCurrency(ea.gross_loss || 0)}</td>
        <td class="${netClass} font-bold font-mono">${formatCurrency(ea.net_profit || 0)}</td>
        <td>${Number(ea.open_lots || 0).toFixed(2)}</td>
        <td>
          <button class="btn-action-sm" onclick="openEaRenameModal('${(ea.magic_numbers || [])[0] || ''}', '${escapeHtml(ea.ea_name)}')">
            <i class="fa-solid fa-pen-to-square"></i> Rename / Merge
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// Closed Trade History Table
function renderClosedTrades() {
  const tbody = document.getElementById('closedTradesTableBody');
  let trades = AppState.data.closedTrades;

  if (AppState.filters.searchQuery) {
    trades = trades.filter(t => 
      (t.symbol && t.symbol.toLowerCase().includes(AppState.filters.searchQuery)) ||
      (t.ea_name && t.ea_name.toLowerCase().includes(AppState.filters.searchQuery)) ||
      (t.ticket && String(t.ticket).includes(AppState.filters.searchQuery))
    );
  }

  document.getElementById('closedTradesSummary').textContent = `Showing ${trades.length} trades`;

  if (!trades || trades.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="empty-state">No closed trades matching the current filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = trades.slice(0, 150).map(t => {
    const profitClass = (t.profit >= 0) ? 'text-positive' : 'text-negative';
    const typeClass = (t.type && t.type.toUpperCase() === 'BUY') ? 'badge-buy' : 'badge-sell';

    return `
      <tr>
        <td class="font-mono">${escapeHtml(t.ticket)}</td>
        <td><span class="badge-account">${escapeHtml(t.account_number)}</span></td>
        <td class="font-bold">${escapeHtml(t.symbol)}</td>
        <td><span class="${typeClass}">${escapeHtml(t.type)}</span></td>
        <td>${Number(t.lots).toFixed(2)}</td>
        <td>${formatDateTime(t.open_time)}</td>
        <td>${formatDateTime(t.close_time)}</td>
        <td class="font-mono">${Number(t.open_price).toFixed(5)}</td>
        <td class="font-mono">${Number(t.close_price).toFixed(5)}</td>
        <td><span class="badge-ea-tag">${escapeHtml(t.ea_name || 'Magic ' + t.magic_number)}</span></td>
        <td class="${profitClass} font-bold font-mono">${formatCurrency(t.profit)}</td>
      </tr>
    `;
  }).join('');
}

// Accounts Matrix Tab
function renderAccountsMatrix() {
  const container = document.getElementById('accountsMatrixContainer');
  const accounts = AppState.data.accounts;

  if (!accounts || accounts.length === 0) {
    container.innerHTML = `<div class="empty-state">No accounts connected or matching profile.</div>`;
    return;
  }

  container.innerHTML = accounts.map(acc => {
    const isOnline = acc.is_online === 1 || acc.is_online === true;
    const statusClass = isOnline ? 'status-online' : 'status-offline';
    const statusText = isOnline ? 'ONLINE' : 'OFFLINE';

    return `
      <div class="account-card">
        <div class="account-card-header">
          <div>
            <div class="account-number font-bold">${escapeHtml(acc.account_number)}</div>
            <div class="account-broker text-muted">${escapeHtml(acc.broker || 'MT5 Broker')} &bull; ${escapeHtml(acc.server || 'Demo')}</div>
          </div>
          <span class="badge-status ${statusClass}">${statusText}</span>
        </div>
        <div class="account-card-body">
          <div class="acc-metric-row">
            <span>Balance:</span>
            <span class="font-mono font-bold">${formatCurrency(acc.balance)}</span>
          </div>
          <div class="acc-metric-row">
            <span>Equity:</span>
            <span class="font-mono font-bold text-highlight">${formatCurrency(acc.equity)}</span>
          </div>
          <div class="acc-metric-row">
            <span>Free Margin:</span>
            <span class="font-mono">${formatCurrency(acc.free_margin)}</span>
          </div>
          <div class="acc-metric-row">
            <span>Leverage:</span>
            <span class="font-mono">1:${acc.leverage || 100}</span>
          </div>
        </div>
        <div class="account-card-footer">
          <small class="text-muted">Updated: ${formatDateTime(acc.last_seen)}</small>
        </div>
      </div>
    `;
  }).join('');
}

function renderAccountFilterDropdown() {
  const select = document.getElementById('accountFilter');
  const accounts = AppState.data.accounts;
  const currentVal = AppState.filters.selectedAccountId;

  select.innerHTML = '<option value="ALL">All Profile Accounts</option>';
  accounts.forEach(acc => {
    const opt = document.createElement('option');
    opt.value = acc.account_number;
    opt.textContent = `${acc.account_number} (${acc.broker || 'MT5'})`;
    select.appendChild(opt);
  });

  select.value = currentVal;
}

// ============================================================================
// 9. CHARTS INTEGRATION (APEXCHARTS)
// ============================================================================
function initCharts() {
  // 1. Balance vs Equity Curve Chart
  const equityOptions = {
    chart: {
      type: 'area',
      height: 300,
      background: 'transparent',
      toolbar: { show: false },
      fontFamily: 'Inter, sans-serif'
    },
    series: [
      { name: 'Balance', data: [] },
      { name: 'Equity', data: [] }
    ],
    colors: ['#3b82f6', '#10b981'],
    stroke: { curve: 'smooth', width: 2 },
    fill: {
      type: 'gradient',
      gradient: { shadeIntensity: 1, opacityFrom: 0.35, opacityTo: 0.05, stops: [0, 95, 100] }
    },
    dataLabels: { enabled: false },
    xaxis: {
      type: 'category',
      labels: { style: { colors: '#94a3b8' } },
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    yaxis: {
      labels: {
        style: { colors: '#94a3b8' },
        formatter: (val) => '$' + Number(val).toLocaleString()
      }
    },
    grid: { borderColor: '#1e293b', strokeDashArray: 4 },
    tooltip: { theme: 'dark' }
  };

  AppState.charts.equityBalance = new ApexCharts(document.querySelector('#equityBalanceChart'), equityOptions);
  AppState.charts.equityBalance.render();

  // 2. EA Distribution Pie / Donut Chart
  const eaDonutOptions = {
    chart: {
      type: 'donut',
      height: 300,
      background: 'transparent',
      fontFamily: 'Inter, sans-serif'
    },
    series: [],
    labels: [],
    colors: ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4'],
    legend: { position: 'bottom', labels: { colors: '#94a3b8' } },
    dataLabels: { enabled: true, formatter: (val) => val.toFixed(1) + '%' },
    tooltip: { theme: 'dark' }
  };

  AppState.charts.eaDistribution = new ApexCharts(document.querySelector('#eaDistributionChart'), eaDonutOptions);
  AppState.charts.eaDistribution.render();
}

function updateCharts() {
  const curve = AppState.data.equityCurve;
  const eaList = AppState.data.eaPerformance;

  // Update Equity Curve
  if (AppState.charts.equityBalance && curve) {
    const categories = curve.map(c => c.time_label || '');
    const balanceSeries = curve.map(c => Number(c.balance) || 0);
    const equitySeries = curve.map(c => Number(c.equity) || 0);

    AppState.charts.equityBalance.updateOptions({
      xaxis: { categories }
    });
    AppState.charts.equityBalance.updateSeries([
      { name: 'Balance', data: balanceSeries },
      { name: 'Equity', data: equitySeries }
    ]);
  }

  // Update EA Profit Distribution
  if (AppState.charts.eaDistribution && eaList) {
    const filteredEas = eaList.filter(e => (Number(e.net_profit) > 0));
    const labels = filteredEas.map(e => e.ea_name);
    const series = filteredEas.map(e => Number(e.net_profit));

    if (series.length > 0) {
      AppState.charts.eaDistribution.updateOptions({ labels });
      AppState.charts.eaDistribution.updateSeries(series);
    } else {
      AppState.charts.eaDistribution.updateOptions({ labels: ['No Profit Data'] });
      AppState.charts.eaDistribution.updateSeries([1]);
    }
  }
}

// ============================================================================
// 10. EA RENAMING & MAGIC MERGING HANDLERS
// ============================================================================
window.openEaRenameModal = function(magicNumber, currentName) {
  if (AppState.auth.isShareMode) return; // Prevent modification in share mode

  document.getElementById('eaModalMagicNumber').value = magicNumber || '0';
  document.getElementById('eaModalCurrentName').value = currentName || 'Default EA';
  document.getElementById('eaModalNewNameInput').value = currentName || '';
  openModal('eaRenameModal');
};

async function submitEaRename() {
  const magicNumber = document.getElementById('eaModalMagicNumber').value;
  const eaName = document.getElementById('eaModalNewNameInput').value.trim();

  if (!eaName) {
    alert('Please specify a valid EA display name.');
    return;
  }

  try {
    const res = await apiFetch('/api/ea/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ magicNumber, eaName })
    });

    if (res.success) {
      closeModal('eaRenameModal');
      await refreshDashboardData();
    } else {
      alert(res.message || 'Failed to rename EA.');
    }
  } catch (err) {
    console.error('Rename EA error:', err);
    alert('Failed to save EA Name.');
  }
}

// ============================================================================
// 11. PROFILE MANAGEMENT
// ============================================================================
async function loadProfiles() {
  try {
    const data = await apiFetch('/api/profiles');
    if (data.success) {
      AppState.data.profiles = data.profiles || [];
      const select = document.getElementById('profileSelect');
      select.innerHTML = '<option value="ALL">🌐 All Active Accounts</option>';
      AppState.data.profiles.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `📁 ${p.name} (${p.account_count || 0} Accounts)`;
        select.appendChild(opt);
      });
    }
  } catch (err) {
    console.error('Load profiles error:', err);
  }
}

function populateProfileAccountsList() {
  const container = document.getElementById('profileAccountsCheckboxList');
  container.innerHTML = AppState.data.accounts.map(a => `
    <label class="checkbox-item">
      <input type="checkbox" value="${a.account_number}" class="profile-acc-checkbox" />
      <span>${a.account_number} (${a.broker || 'MT5'})</span>
    </label>
  `).join('');
}

async function renderExistingProfilesList() {
  const container = document.getElementById('existingProfilesList');
  const data = await apiFetch('/api/profiles');
  const profiles = data.profiles || [];

  if (profiles.length === 0) {
    container.innerHTML = `<div class="text-muted">No custom profiles created yet.</div>`;
    return;
  }

  container.innerHTML = profiles.map(p => `
    <div class="existing-item-row">
      <div>
        <strong>${escapeHtml(p.name)}</strong>
        <div class="text-muted small">${(p.account_numbers || []).join(', ')}</div>
      </div>
      <button class="btn-danger-sm" onclick="deleteProfile('${p.id}')">
        <i class="fa-solid fa-trash"></i>
      </button>
    </div>
  `).join('');
}

async function createNewProfile() {
  const name = document.getElementById('newProfileNameInput').value.trim();
  const checkedBoxes = document.querySelectorAll('.profile-acc-checkbox:checked');
  const accountNumbers = Array.from(checkedBoxes).map(cb => cb.value);

  if (!name) {
    alert('Please enter a profile name.');
    return;
  }
  if (accountNumbers.length === 0) {
    alert('Please select at least one account for this profile.');
    return;
  }

  try {
    const res = await apiFetch('/api/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, accountNumbers })
    });

    if (res.success) {
      document.getElementById('newProfileNameInput').value = '';
      await loadProfiles();
      await renderExistingProfilesList();
      alert('Profile created successfully!');
    }
  } catch (err) {
    alert('Failed to create profile.');
  }
}

window.deleteProfile = async function(profileId) {
  if (!confirm('Are you sure you want to delete this profile?')) return;
  try {
    const res = await apiFetch(`/api/profiles/${profileId}`, { method: 'DELETE' });
    if (res.success) {
      await loadProfiles();
      await renderExistingProfilesList();
    }
  } catch (err) {
    alert('Failed to delete profile.');
  }
};

// ============================================================================
// 12. SECURE SHARE LINK GENERATOR
// ============================================================================
function populateShareProfileDropdown() {
  const select = document.getElementById('shareProfileSelect');
  select.innerHTML = '<option value="">🌐 All Connected Accounts</option>';
  AppState.data.profiles.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `📁 Profile: ${p.name}`;
    select.appendChild(opt);
  });
}

async function generateShareLink() {
  const label = document.getElementById('shareLabelInput').value.trim() || 'Shared View';
  const profileId = document.getElementById('shareProfileSelect').value || null;
  const fromDate = document.getElementById('shareFromDateInput').value || null;

  try {
    const res = await apiFetch('/api/share/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, profileId, fromDate })
    });

    if (res.success && res.token) {
      const fullUrl = `${window.location.origin}/?share=${res.token}`;
      document.getElementById('shareGeneratedUrlInput').value = fullUrl;
      document.getElementById('generatedShareUrlBox').classList.remove('hidden');
      await renderActiveSharesList();
    }
  } catch (err) {
    alert('Failed to generate share link.');
  }
}

async function renderActiveSharesList() {
  const container = document.getElementById('activeSharesList');
  try {
    const data = await apiFetch('/api/share/list');
    const shares = data.shares || [];

    if (shares.length === 0) {
      container.innerHTML = `<div class="text-muted">No active share links.</div>`;
      return;
    }

    container.innerHTML = shares.map(s => `
      <div class="existing-item-row">
        <div>
          <strong>${escapeHtml(s.label || 'Share Link')}</strong>
          <div class="text-muted small">From: ${s.from_date || 'All History'} | Views: ${s.access_count || 0}</div>
        </div>
        <button class="btn-danger-sm" onclick="revokeShareLink('${s.token}')">
          <i class="fa-solid fa-ban"></i> Revoke
        </button>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = `<div class="text-muted">Failed to load share links.</div>`;
  }
}

window.revokeShareLink = async function(token) {
  if (!confirm('Revoke this share link? Anyone using it will be locked out immediately.')) return;
  try {
    const res = await apiFetch(`/api/share/${token}`, { method: 'DELETE' });
    if (res.success) {
      await renderActiveSharesList();
    }
  } catch (err) {
    alert('Failed to revoke link.');
  }
};

// ============================================================================
// 13. UTILITIES & FORMATTERS
// ============================================================================
function formatCurrency(num) {
  const val = Number(num) || 0;
  return '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
