// ═══════════════════════════════════════════════════════════════
// MT5 COMMAND CENTER — FUTURISTIC DASHBOARD ENGINE (vanilla JS)
// ═══════════════════════════════════════════════════════════════

// ─── STATE MANAGEMENT ───
let currentProfile = 'all';
let currentAccount = 'all';
let currentMagic = 'all'; // Can be magic number or EA name (for merged groups)

// Initialize default range as Current Month (from 1st of month to today)
const todayInit = new Date();
const initYear = todayInit.getFullYear();
const initMonth = String(todayInit.getMonth() + 1).padStart(2, '0');
const initDay = String(todayInit.getDate()).padStart(2, '0');

let currentFrom = `${initYear}-${initMonth}-01`;
let currentTo = `${initYear}-${initMonth}-${initDay}`;

let calendarDate = new Date();
let usingMock = false;
let firstLoad = true;
let isSharedMode = false;
let shareScopeInfo = null;

// Check URL for share token (?share=token)
const urlParams = new URLSearchParams(window.location.search);
const shareToken = urlParams.get('share') || null;

// Caches for fast modal population
let cachedAccounts = [];
let cachedProfiles = [];
let cachedEAs = [];

// ─── HELPERS ───
const $ = (id) => document.getElementById(id);
const toYMD = (d) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); };
const formatUSD = (num) => {
  const v = Number(num) || 0;
  return (v >= 0 ? '+$' : '-$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const formatPlainUSD = (num) => '$' + (Number(num) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = (v) => Math.abs(v) >= 1000 ? '$' + (v / 1000).toFixed(1) + 'k' : '$' + v.toFixed(0);

// Modal helpers
function openModal(id) {
  const m = $(id);
  if (m) {
    m.classList.remove('hidden');
    m.classList.add('flex');
    lucide.createIcons();
  }
}
function closeModal(id) {
  const m = $(id);
  if (m) {
    m.classList.add('hidden');
    m.classList.remove('flex');
  }
}
window.closeModal = closeModal;
window.openModal = openModal;

// Query parameter builder
function buildQueryParams() {
  const q = [];
  if (currentProfile && currentProfile !== 'all') q.push('profile=' + encodeURIComponent(currentProfile));
  if (currentAccount && currentAccount !== 'all') q.push('account=' + encodeURIComponent(currentAccount));
  if (currentMagic && currentMagic !== 'all') q.push('magic=' + encodeURIComponent(currentMagic));
  if (currentFrom) q.push('from=' + encodeURIComponent(currentFrom));
  if (currentTo) q.push('to=' + encodeURIComponent(currentTo));
  if (shareToken) q.push('share=' + encodeURIComponent(shareToken));
  return q.length ? '?' + q.join('&') : '';
}

// ─── SAFE API FETCH with automatic share token injection ───
async function api(path, options = {}) {
  try {
    const sep = path.includes('?') ? '&' : '?';
    const shareQuery = shareToken ? `${sep}share=${encodeURIComponent(shareToken)}` : '';
    const headers = {
      'Accept': 'application/json',
      ...(options.headers || {}),
      ...(shareToken ? { 'x-share-token': shareToken } : {})
    };

    const res = await fetch('/api' + path + shareQuery, { ...options, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data && data.success === false) throw new Error(data.error || 'API Error');
    return data;
  } catch (e) {
    console.warn(`API call failed for /api${path}:`, e.message);
    usingMock = true;
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// BACKGROUND & VISUALS
// ═══════════════════════════════════════════════════════════════
function initBackground() {
  const spot = $('spotlight');
  if (spot) {
    let frame;
    window.addEventListener('mousemove', (e) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        spot.style.background = `radial-gradient(600px circle at ${e.clientX}px ${e.clientY}px, rgba(34,211,238,0.07), transparent 70%)`;
      });
    });
  }
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const canvas = $('stars'); if (!canvas) return;
  const ctx = canvas.getContext('2d'); const DPR = Math.min(devicePixelRatio || 1, 2);
  let w, h, stars;
  const resize = () => {
    w = canvas.width = innerWidth * DPR; h = canvas.height = innerHeight * DPR;
    canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px';
    const count = Math.floor((innerWidth * innerHeight) / 11000);
    stars = Array.from({ length: count }, () => ({ x: Math.random() * w, y: Math.random() * h, z: Math.random() * 0.8 + 0.2, r: Math.random() * 1.4 * DPR + 0.3, tw: Math.random() * Math.PI * 2 }));
  };
  resize(); addEventListener('resize', resize);
  (function draw() {
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      s.y += s.z * 0.12 * DPR; s.tw += 0.02; if (s.y > h) s.y = 0;
      const a = 0.35 + Math.sin(s.tw) * 0.35; const hue = s.z > 0.7 ? '180,230,255' : '150,180,255';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fillStyle = `rgba(${hue},${a})`; ctx.fill();
    }
    requestAnimationFrame(draw);
  })();
}

function animateValue(el, end, { decimals = 0, prefix = '', suffix = '', duration = 1400 } = {}) {
  if (!el) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmt = (v) => prefix + v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
  if (reduced) { el.textContent = fmt(end); return; }
  const t0 = performance.now();
  (function tick(now) {
    const p = Math.min((now - t0) / duration, 1); const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(end * eased);
    if (p < 1) requestAnimationFrame(tick); else el.textContent = fmt(end);
  })(performance.now());
}

function updateHero(id, value, { decimals = 0, prefix = '', suffix = '' } = {}) {
  const el = $(id); if (!el) return;
  if (firstLoad) { animateValue(el, value, { decimals, prefix, suffix }); }
  else { el.textContent = prefix + Number(value).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix; }
}

function typeHeadline(text) {
  const el = $('typed'); if (!el) return; let i = 0;
  const id = setInterval(() => {
    i++; el.textContent = text.slice(0, i);
    if (i >= text.length) { clearInterval(id); setTimeout(() => { const c = $('typeCaret'); if (c) c.style.display = 'none'; }, 1200); }
  }, 90);
}

function initReveal() {
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('visible'); obs.unobserve(en.target); } });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  document.querySelectorAll('.reveal').forEach((n) => obs.observe(n));
}

// ═══════════════════════════════════════════════════════════════
// 🚀 INITIALIZATION
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  lucide.createIcons();
  initBackground();
  initReveal();
  typeHeadline('Center');

  // Check if session is in Shared Mode
  await checkShareSession();

  // Filters event listeners
  $('profileFilter').addEventListener('change', (e) => { currentProfile = e.target.value; refreshDashboard(); });
  $('accountFilter').addEventListener('change', (e) => { currentAccount = e.target.value; refreshDashboard(); });
  $('magicFilter').addEventListener('change', (e) => { currentMagic = e.target.value; refreshDashboard(); });
  initRangeFilter();

  // Setup Modals & Buttons
  setupModals();

  // Initial Data Fetch
  await refreshDashboard(false, true);

  // Reveal loader out
  setTimeout(() => $('loader').classList.add('hidden'), 1500);
  setInterval(() => refreshDashboard(), 5000);
});

// ─── SHARE SESSION VERIFICATION ───
async function checkShareSession() {
  const info = await api('/share/info');
  if (info && info.is_shared) {
    isSharedMode = true;
    shareScopeInfo = info;

    // Show shared banner
    $('sharedBanner').classList.remove('hidden');
    $('sharedProfileName').textContent = info.profile_name || 'Shared Fleet';
    if (info.from_date) {
      $('sharedDateScope').textContent = `(Restricted: trades from ${info.from_date} onwards)`;
    }

    // Hide admin controls in shared mode
    $('profileControlWrap').style.display = 'none';
    $('openShareModalBtn').style.display = 'none';
  }
}

// ─── DATE RANGE FILTER ───
function initRangeFilter() {
  const sel = $('rangeFilter'); const custom = $('customRange');
  sel.addEventListener('change', (e) => {
    const v = e.target.value; const today = new Date();
    if (v === 'custom') {
      custom.classList.remove('hidden'); custom.classList.add('flex');
      $('toDate').value = toYMD(today);
      const f = new Date(today); f.setDate(f.getDate() - 30); $('fromDate').value = toYMD(f);
      return;
    }
    custom.classList.add('hidden'); custom.classList.remove('flex');
    if (v === 'all') { currentFrom = null; currentTo = null; }
    else if (v === 'current_month') {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      currentFrom = toYMD(firstDay);
      currentTo = toYMD(today);
    }
    else if (v === '7d') { const f = new Date(today); f.setDate(f.getDate() - 6); currentFrom = toYMD(f); currentTo = toYMD(today); }
    else if (v === '30d') { const f = new Date(today); f.setDate(f.getDate() - 29); currentFrom = toYMD(f); currentTo = toYMD(today); }
    refreshDashboard();
  });
  $('applyRange').addEventListener('click', () => {
    currentFrom = $('fromDate').value || null;
    currentTo = $('toDate').value || null;
    refreshDashboard();
  });
}

// ─── MASTER REFRESH ───
async function refreshDashboard(spin = false, initial = false) {
  if (spin) { const ic = $('refreshIcon'); ic.classList.add('spin-once'); setTimeout(() => ic.classList.remove('spin-once'), 700); }
  
  await Promise.all([
    fetchProfilesList(),
    fetchAccountsList(),
    fetchEAList(),
    fetchOverview(),
    fetchEquity(),
    fetchCalendar(),
    fetchPositions(),
    fetchPendingOrders(),
    fetchLeaderboard()
  ]);

  $('lastUpdated').textContent = new Date().toLocaleTimeString();
  $('dataMode').textContent = usingMock ? 'Demo data (API offline)' : (isSharedMode ? 'Shared Link' : 'Cloud Sync');
  lucide.createIcons();
  firstLoad = false;
}

// ═══════════════════════════════════════════════════════════════
// 1. DATA FETCHING METHODS
// ═══════════════════════════════════════════════════════════════

// 1. OVERVIEW
async function fetchOverview() {
  const d = await api('/overview' + buildQueryParams()) || {
    total_balance: 0, total_equity: 0, total_accounts: 0, today_pnl: 0,
    floating_pnl: 0, open_trades_count: 0, pending_trades_count: 0, month_pnl: 0,
    total_closed_profit: 0, win_rate: 0, profit_factor: '0.00', total_trades: 0, wins: 0, losses: 0
  };

  const set = (id, t) => { const e = $(id); if (e) e.textContent = t; };

  if (firstLoad) {
    animateValue($('totalBalance'), d.total_balance, { decimals: 2, prefix: '$' });
    animateValue($('monthPnl'), d.month_pnl, { decimals: 2, prefix: d.month_pnl >= 0 ? '+$' : '-$' });
  } else {
    set('totalBalance', formatPlainUSD(d.total_balance));
    set('monthPnl', formatUSD(d.month_pnl));
  }

  set('totalEquity', formatPlainUSD(d.total_equity));
  set('accountCountBadge', `${d.total_accounts} Accs`);
  set('totalClosedPnl', formatUSD(d.total_closed_profit));

  const today = $('todayPnl'); today.textContent = formatUSD(d.today_pnl);
  today.className = `text-2xl font-extrabold tracking-tight font-display ${d.today_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
  const tIcon = $('todayIcon'); if (tIcon) tIcon.setAttribute('data-lucide', d.today_pnl >= 0 ? 'trending-up' : 'trending-down');
  $('todayIconWrap').className = `p-2 rounded-lg ${d.today_pnl >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`;
  $('todayOrb').style.background = d.today_pnl >= 0 ? '#34d399' : '#fb7185';
  $('todayCard').style.setProperty('--accent', d.today_pnl >= 0 ? '#34d399' : '#fb7185');

  const fl = $('floatingPnl'); fl.textContent = formatUSD(d.floating_pnl);
  fl.className = `font-semibold ${d.floating_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
  set('openCount', d.open_trades_count);
  $('monthPnl').className = `text-2xl font-extrabold tracking-tight font-display ${d.month_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
  set('winRate', `${d.win_rate}%`);
  set('profitFactor', d.profit_factor);
  set('totalTradesCount', `${d.total_trades} (${d.wins}W / ${d.losses}L)`);

  updateHero('heroAccounts', d.total_accounts);
  updateHero('heroProfit', d.total_closed_profit, { prefix: '$' });
  updateHero('heroWin', Number(d.win_rate), { decimals: 1, suffix: '%' });
  renderDonut(d.wins, d.losses);
}

// 2. PROFILES LIST (+ Dropdown)
async function fetchProfilesList() {
  if (isSharedMode) return;
  const d = await api('/profiles');
  if (!d || !d.profiles) return;
  cachedProfiles = d.profiles;

  const sel = $('profileFilter'); const cur = sel.value;
  sel.innerHTML = '';

  d.profiles.forEach((p) => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = `Profile: ${p.name}`;
    if (String(p.id) === String(currentProfile) || (currentProfile === 'all' && p.slug === 'all')) {
      o.selected = true;
    }
    sel.appendChild(o);
  });
}

// 3. ACCOUNTS LIST (+ Filter dropdown & Grid)
async function fetchAccountsList() {
  const d = await api('/accounts' + buildQueryParams());
  const accounts = d ? d.accounts : [];
  cachedAccounts = accounts;

  const sel = $('accountFilter'); const cur = sel.value;
  sel.innerHTML = '<option value="all">All Accounts</option>';
  accounts.forEach((a) => {
    const o = document.createElement('option');
    o.value = a.account_number;
    o.textContent = `${a.account_name || a.broker} • #${a.account_number}`;
    if (String(o.value) === String(cur)) o.selected = true;
    sel.appendChild(o);
  });

  const grid = $('accountsGrid');
  if (!accounts.length) {
    grid.innerHTML = '<div class="col-span-2 text-center py-6 text-slate-500 text-sm">No MT5 terminals in this scope</div>';
    return;
  }

  grid.innerHTML = accounts.map((acc) => {
    const pos = acc.today_profit >= 0;
    const pct = Math.min(Math.abs(acc.today_profit) / (acc.balance || 1) * 1000, 100);
    return `<div class="tilt-card bg-slate-900/60 border border-white/5 p-4 rounded-xl hover:border-cyan-400/30 transition-all duration-300">
      <div class="flex justify-between items-start mb-2">
        <div>
          <h3 class="font-bold text-sm text-white">${acc.account_name || 'Account #' + acc.account_number}</h3>
          <p class="text-xs text-slate-400">${acc.broker || 'MT5'} • #${acc.account_number}</p>
        </div>
        <div class="flex items-center gap-1">
          <span class="px-2 py-0.5 rounded text-[10px] font-mono ${pos ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}">${acc.open_count} Open</span>
          ${acc.pending_count > 0 ? `<span class="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-400">${acc.pending_count} Pend</span>` : ''}
        </div>
      </div>
      <div class="mt-3 flex justify-between items-baseline">
        <div><span class="text-[10px] text-slate-500 uppercase block">Balance</span><span class="font-semibold text-sm text-slate-200">${formatPlainUSD(acc.balance)}</span></div>
        <div class="text-right"><span class="text-[10px] text-slate-500 uppercase block">Today</span><span class="font-semibold text-sm ${pos ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(acc.today_profit)}</span></div>
      </div>
      <div class="mt-2 w-full bg-slate-800 rounded-full h-1 overflow-hidden"><div class="h-1 rounded-full" style="width:${pct}%;background:${pos ? 'linear-gradient(90deg,#34d399,#22d3ee)' : 'linear-gradient(90deg,#fb7185,#f59e0b)'}"></div></div>
    </div>`;
  }).join('');
}

// 4. EAS LIST (+ Merge-by-name Bar Chart)
async function fetchEAList() {
  const d = await api('/eas' + buildQueryParams());
  const eas = d ? d.eas : [];
  cachedEAs = eas;

  const sel = $('magicFilter'); const cur = sel.value;
  sel.innerHTML = '<option value="all">All EAs</option>';

  eas.forEach((e) => {
    const o = document.createElement('option');
    o.value = e.ea_name; // Filter by merged name
    const magicsStr = (e.magic_numbers || []).join(', ');
    o.textContent = `${e.ea_name} (${magicsStr})`;
    if (String(o.value) === String(cur)) o.selected = true;
    sel.appendChild(o);
  });

  updateHero('heroEAs', eas.length);
  renderBars(eas);
}

function renderBars(eas) {
  const box = $('eaChart');
  if (!eas.length) { box.innerHTML = '<div class="text-center py-6 text-slate-500 text-sm">No EA activity recorded</div>'; return; }

  const max = Math.max(...eas.map((e) => Math.abs(e.total_pnl)), 1);
  const sorted = [...eas].sort((a, b) => b.total_pnl - a.total_pnl);

  box.innerHTML = sorted.map((ea, i) => {
    const pct = (Math.abs(ea.total_pnl) / max) * 100; const pos = ea.total_pnl >= 0;
    const magicsStr = (ea.magic_numbers || []).join(',');
    return `<div class="group cursor-pointer" onclick="openRenameModal('${magicsStr}', '${ea.ea_name.replace(/'/g, "\\'")}', '${ea.color || '#3b82f6'}', '${(ea.description || '').replace(/'/g, "\\'")}')">
      <div class="flex items-center justify-between text-xs mb-1">
        <span class="font-semibold text-slate-200 group-hover:text-cyan-300 transition flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full" style="background:${ea.color || '#3b82f6'}"></span>
          ${ea.ea_name}
          <span class="text-[10px] font-mono text-slate-500">(${magicsStr})</span>
        </span>
        <span class="font-mono font-bold ${pos ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(ea.total_pnl)}</span>
      </div>
      <div class="h-2.5 w-full rounded-full bg-slate-800/60 overflow-hidden"><div class="h-full rounded-full eq-bar" data-w="${pct}" style="transition-delay:${i * 90}ms;background:${pos ? 'linear-gradient(90deg,#22d3ee,#34d399)' : 'linear-gradient(90deg,#fb7185,#f59e0b)'};box-shadow:${pos ? '0 0 12px rgba(34,211,238,0.4)' : '0 0 12px rgba(251,113,133,0.4)'}"></div></div>
    </div>`;
  }).join('');

  requestAnimationFrame(() => box.querySelectorAll('.eq-bar').forEach((b) => { b.style.width = b.dataset.w + '%'; }));
}

// WIN/LOSS DONUT
function renderDonut(wins, losses) {
  const box = $('winLossChart'); const total = wins + losses || 1; const winPct = (wins / total) * 100;
  const R = 70, C = 2 * Math.PI * R; const len = (winPct / 100) * C;
  box.innerHTML = `<div class="flex flex-col items-center"><div class="relative w-[180px] h-[180px]"><svg viewBox="0 0 180 180" class="w-full h-full" style="transform:rotate(-90deg)"><defs><linearGradient id="winGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#22d3ee"/><stop offset="100%" stop-color="#34d399"/></linearGradient></defs><circle cx="90" cy="90" r="${R}" fill="none" stroke="#fb7185" stroke-width="16" stroke-opacity="0.85"/><circle cx="90" cy="90" r="${R}" fill="none" stroke="url(#winGrad)" stroke-width="16" stroke-linecap="round" stroke-dasharray="0 ${C}" style="filter:drop-shadow(0 0 6px rgba(34,211,238,0.5))" id="donutArc"/></svg><div class="absolute inset-0 flex flex-col items-center justify-center"><span class="text-[10px] uppercase tracking-widest text-slate-500">Win Rate</span><span class="text-3xl font-extrabold text-white">${winPct.toFixed(1)}%</span></div></div><div class="mt-4 flex items-center gap-5 text-xs"><span class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-sm bg-cyan-400"></span><span class="text-slate-300">${wins} Wins</span></span><span class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-sm bg-rose-400"></span><span class="text-slate-300">${losses} Losses</span></span></div></div>`;
  requestAnimationFrame(() => { const arc = $('donutArc'); if (arc) { arc.style.transition = 'stroke-dasharray 1.3s cubic-bezier(.22,1,.36,1)'; arc.setAttribute('stroke-dasharray', `${len} ${C}`); } });
}

// 5. EQUITY CURVE (Custom SVG)
async function fetchEquity() {
  const d = await api('/charts/equity-curve' + buildQueryParams());
  const curve = d ? d.curve : [];
  renderEquity(curve);
}
function renderEquity(curve) {
  const box = $('equityChart');
  if (!curve || !curve.length) {
    box.innerHTML = '<div class="text-center py-12 text-slate-500 text-sm">No trade history available for selected filter</div>';
    return;
  }
  const W = 1000, H = 400, padT = 24, padB = 28, padL = 8, padR = 8;
  const data = curve.map((p) => ({ t: new Date(p.time).getTime(), v: p.cumulative_profit }));
  const xs = data.map((d) => d.t), ys = data.map((d) => d.v);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys, 0), maxY = Math.max(...ys);
  const sx = (x) => padL + ((x - minX) / (maxX - minX || 1)) * (W - padL - padR);
  const sy = (y) => padT + (1 - (y - minY) / (maxY - minY || 1)) * (H - padT - padB);
  const pts = data.map((d) => ({ x: sx(d.t), y: sy(d.v), v: d.v, t: d.t }));
  let line = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    line += ` C ${p1.x + (p2.x - p0.x) / 6},${p1.y + (p2.y - p0.y) / 6} ${p2.x - (p3.x - p1.x) / 6},${p2.y - (p3.y - p1.y) / 6} ${p2.x},${p2.y}`;
  }
  const area = `${line} L ${pts[pts.length - 1].x},${H - padB} L ${pts[0].x},${H - padB} Z`;
  let peak = 0, valley = 0; pts.forEach((p, i) => { if (p.v > pts[peak].v) peak = i; if (p.v < pts[valley].v) valley = i; });
  const zeroY = sy(0);
  let grid = ''; for (let i = 0; i <= 4; i++) { const val = minY + (maxY - minY) * i / 4; const y = sy(val); grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(148,163,184,0.08)" stroke-dasharray="5 6"/>`; }
  let labels = ''; for (let i = 0; i <= 4; i++) { const val = minY + (maxY - minY) * i / 4; labels += `<span class="absolute left-1 text-[10px] font-mono text-slate-500" style="top:${(sy(val) / H) * 100}%;transform:translateY(-50%)">${compact(val)}</span>`; }

  box.innerHTML = `
    <svg id="eqSvg" viewBox="0 0 ${W} ${H}" class="w-full h-[400px]" preserveAspectRatio="none">
      <defs>
        <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#22d3ee" stop-opacity="0.45"/><stop offset="45%" stop-color="#a855f7" stop-opacity="0.16"/><stop offset="100%" stop-color="#7c3aed" stop-opacity="0"/></linearGradient>
        <linearGradient id="eqStroke" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#22d3ee"/><stop offset="100%" stop-color="#a855f7"/></linearGradient>
        <filter id="eqGlow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      ${grid}
      <line x1="${padL}" y1="${zeroY}" x2="${W - padR}" y2="${zeroY}" stroke="rgba(100,116,139,0.5)" stroke-dasharray="4 5"/>
      <path d="${area}" fill="url(#eqFill)" class="eq-area"/>
      <path d="${line}" fill="none" stroke="url(#eqStroke)" stroke-width="3" stroke-linecap="round" filter="url(#eqGlow)" class="eq-line"/>
      <circle cx="${pts[peak].x}" cy="${pts[peak].y}" r="5" fill="#34d399" stroke="#05070f" stroke-width="2"/>
      <circle cx="${pts[valley].x}" cy="${pts[valley].y}" r="5" fill="#fb7185" stroke="#05070f" stroke-width="2"/>
      <circle cx="${pts[pts.length - 1].x}" cy="${pts[pts.length - 1].y}" r="6" fill="#22d3ee" stroke="#05070f" stroke-width="2" class="pulse-dot"/>
      <g id="eqCross" style="display:none"><line id="eqCrossLine" y1="${padT}" y2="${H - padB}" stroke="rgba(34,211,238,0.4)" stroke-dasharray="3 3"/><circle id="eqCrossDot" r="5" fill="#fff" stroke="#22d3ee" stroke-width="2"/></g>
    </svg>
    <div class="absolute inset-0 pointer-events-none">${labels}</div>
    <div id="eqTip" class="eq-tooltip" style="display:none"></div>`;

  const svg = $('eqSvg'); const cross = $('eqCross'); const tip = $('eqTip');
  svg.addEventListener('mousemove', (e) => {
    const rect = svg.getBoundingClientRect(); const relX = ((e.clientX - rect.left) / rect.width) * W;
    let n = 0, dist = Infinity; pts.forEach((p, i) => { const dd = Math.abs(p.x - relX); if (dd < dist) { dist = dd; n = i; } });
    const p = pts[n];
    cross.style.display = ''; $('eqCrossLine').setAttribute('x1', p.x); $('eqCrossLine').setAttribute('x2', p.x);
    $('eqCrossDot').setAttribute('cx', p.x); $('eqCrossDot').setAttribute('cy', p.y);
    tip.style.display = ''; tip.style.left = (p.x / W) * 100 + '%'; tip.style.top = (p.y / H) * 100 + '%'; tip.style.marginTop = '-14px';
    tip.innerHTML = `<div class="box"><div class="text-[10px] text-slate-400">${new Date(p.t).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</div><div class="text-[10px] uppercase tracking-wider text-slate-500">Cumulative P&amp;L</div><div class="text-base font-extrabold ${p.v >= 0 ? 'text-cyan-300' : 'text-rose-400'}">${formatUSD(p.v)}</div></div>`;
  });
  svg.addEventListener('mouseleave', () => { cross.style.display = 'none'; tip.style.display = 'none'; });
}

// 6. CALENDAR
async function fetchCalendar() {
  const year = calendarDate.getFullYear(), month = calendarDate.getMonth() + 1;
  const d = await api(`/calendar${buildQueryParams()}&year=${year}&month=${month}`) || { month_total_pnl: 0, days: [] };
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  $('calendarCurrentMonth').textContent = `${months[month - 1]} ${year}`;
  const mt = $('calendarMonthTotal'); mt.textContent = formatUSD(d.month_total_pnl); mt.className = `font-bold ${d.month_total_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
  
  const map = {}; d.days.forEach((x) => map[x.date] = x);
  const grid = $('calendarGrid'); grid.innerHTML = '';
  const firstDay = new Date(year, month - 1, 1).getDay(); const offset = firstDay === 0 ? 6 : firstDay - 1;
  const dim = new Date(year, month, 0).getDate(); const todayStr = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < offset; i++) grid.innerHTML += '<div class="h-20 bg-slate-900/20 border border-white/5 rounded-xl opacity-20"></div>';
  for (let day = 1; day <= dim; day++) {
    const ds = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`; const dd = map[ds]; const isToday = ds === todayStr;
    if (dd) {
      const pos = dd.profit >= 0;
      grid.innerHTML += `<div class="h-20 p-2 rounded-xl border transition-all duration-300 hover:scale-[1.06] flex flex-col justify-between ${pos ? 'bg-emerald-950/30 border-emerald-500/25 hover:border-emerald-400/50' : 'bg-rose-950/30 border-rose-500/25 hover:border-rose-400/50'} ${isToday ? 'ring-2 ring-cyan-400/60' : ''}">
        <div class="flex justify-between items-center"><span class="text-xs font-bold ${isToday ? 'text-cyan-400' : 'text-slate-400'}">${day}</span><span class="text-[9px] px-1.5 py-0.5 rounded-full font-mono ${pos ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}">${dd.wins}W ${dd.losses}L</span></div>
        <div class="text-right"><span class="text-xs sm:text-sm font-extrabold block ${pos ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(dd.profit)}</span><span class="text-[9px] text-slate-500">${dd.trades_count}t</span></div>
      </div>`;
    } else {
      grid.innerHTML += `<div class="h-20 p-2 rounded-xl bg-slate-900/25 border border-white/5 flex flex-col justify-between ${isToday ? 'ring-2 ring-cyan-400/60' : ''}"><span class="text-xs ${isToday ? 'text-cyan-400 font-bold' : 'text-slate-600'}">${day}</span><span class="text-[11px] text-slate-700 text-right">—</span></div>`;
    }
  }
}
function changeMonth(delta) { calendarDate.setMonth(calendarDate.getMonth() + delta); fetchCalendar(); }
window.changeMonth = changeMonth;

// 7. OPEN POSITIONS
async function fetchPositions() {
  const d = await api('/open-positions' + buildQueryParams());
  const positions = d ? d.positions : [];
  $('liveOpenBadge').textContent = `${positions.length} Active`;
  const tb = $('openPositionsTable');
  if (!positions.length) { tb.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-slate-600">No active floating positions</td></tr>'; return; }
  tb.innerHTML = positions.map((p) => {
    const net = p.profit + p.swap;
    return `<tr class="hover:bg-white/5 transition-colors">
      <td class="p-2.5"><span class="font-semibold text-white">${p.ea_name}</span><br><span class="text-[10px] text-slate-500 font-mono">#${p.account_number}</span></td>
      <td class="p-2.5 font-bold text-slate-200">${p.symbol}</td>
      <td class="p-2.5"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${p.trade_type === 'BUY' ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/25' : 'bg-amber-500/15 text-amber-400 border border-amber-500/25'}">${p.trade_type}</span></td>
      <td class="p-2.5 font-mono text-slate-300">${p.volume}</td>
      <td class="p-2.5 font-mono text-slate-300">${p.open_price}</td>
      <td class="p-2.5 text-right font-mono font-bold ${net >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(net)}</td>
    </tr>`;
  }).join('');
}

// 8. ACTIVE PENDING ORDERS (NEW)
async function fetchPendingOrders() {
  const d = await api('/pending-orders' + buildQueryParams());
  const orders = d ? d.orders : [];
  $('pendingOrdersBadge').textContent = `${orders.length} Pending`;
  const tb = $('pendingOrdersTable');
  if (!orders.length) { tb.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-slate-600">No active pending orders</td></tr>'; return; }

  tb.innerHTML = orders.map((o) => {
    let typeBadgeClass = 'bg-blue-500/15 text-blue-400 border-blue-500/25';
    if (o.order_type.includes('SELL')) typeBadgeClass = 'bg-rose-500/15 text-rose-400 border-rose-500/25';
    if (o.order_type.includes('STOP')) typeBadgeClass = 'bg-violet-500/15 text-violet-400 border-violet-500/25';

    const slStr = o.sl > 0 ? o.sl.toFixed(2) : '-';
    const tpStr = o.tp > 0 ? o.tp.toFixed(2) : '-';

    return `<tr class="hover:bg-white/5 transition-colors">
      <td class="p-2.5"><span class="font-semibold text-white">${o.ea_name}</span><br><span class="text-[10px] text-slate-500 font-mono">#${o.account_number}</span></td>
      <td class="p-2.5 font-bold text-slate-200">${o.symbol}</td>
      <td class="p-2.5"><span class="px-2 py-0.5 rounded text-[10px] font-bold border ${typeBadgeClass}">${o.order_type}</span></td>
      <td class="p-2.5 font-mono text-slate-300">${o.volume}</td>
      <td class="p-2.5 font-mono text-cyan-300 font-semibold">${o.price_open}</td>
      <td class="p-2.5 font-mono text-slate-400">${o.price_current}</td>
      <td class="p-2.5 font-mono text-[11px] text-slate-400">${slStr} / ${tpStr}</td>
      <td class="p-2.5 text-right font-mono text-[11px] text-slate-400">${o.setup_time.slice(5, 16)}</td>
    </tr>`;
  }).join('');
}

// 9. LEADERBOARD
async function fetchLeaderboard() {
  const d = await api('/eas' + buildQueryParams());
  const eas = d ? d.eas : [];
  const tb = $('eaLeaderboardBody');
  if (!eas.length) { tb.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-slate-600">No EA performance data available</td></tr>'; return; }

  const sorted = [...eas].sort((a, b) => b.total_pnl - a.total_pnl);
  const medal = ['🥇', '🥈', '🥉'];

  tb.innerHTML = sorted.map((ea, i) => {
    const wr = ea.total_trades > 0 ? ((ea.wins / ea.total_trades) * 100).toFixed(1) : '0.0';
    const avg = ea.total_trades > 0 ? ea.total_pnl / ea.total_trades : 0; const pos = ea.total_pnl >= 0;
    const magicsStr = (ea.magic_numbers || []).join(',');

    return `<tr class="hover:bg-white/5 transition-colors cursor-pointer group" onclick="openRenameModal('${magicsStr}', '${ea.ea_name.replace(/'/g, "\\'")}', '${ea.color || '#3b82f6'}', '${(ea.description || '').replace(/'/g, "\\'")}')">
      <td class="p-3 text-center text-base">${i < 3 ? medal[i] : '<span class="text-slate-500 font-mono text-sm">#' + (i + 1) + '</span>'}</td>
      <td class="p-3">
        <div class="flex items-center gap-3">
          <span class="w-3 h-3 rounded-full flex-shrink-0" style="background:${ea.color};box-shadow:0 0 10px ${ea.color}88"></span>
          <div>
            <span class="font-bold text-white text-sm group-hover:text-cyan-300 transition">${ea.ea_name}</span>
            <br>
            <span class="text-[10px] text-slate-500 font-mono">Magic(s): ${magicsStr}</span>
          </div>
        </div>
      </td>
      <td class="p-3 text-right font-mono font-bold ${pos ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(ea.total_pnl)}</td>
      <td class="p-3 text-center font-mono text-slate-300">${ea.total_trades}</td>
      <td class="p-3 text-center"><span class="text-emerald-400 font-semibold">${ea.wins}</span><span class="text-slate-600 mx-1">/</span><span class="text-rose-400 font-semibold">${ea.losses}</span></td>
      <td class="p-3"><div class="flex items-center justify-center gap-2"><div class="w-16 bg-slate-800 rounded-full h-2 overflow-hidden"><div class="h-2 rounded-full" style="width:${wr}%;background:${Number(wr) >= 50 ? 'linear-gradient(90deg,#34d399,#22d3ee)' : 'linear-gradient(90deg,#fb7185,#f59e0b)'}"></div></div><span class="text-xs font-bold ${Number(wr) >= 50 ? 'text-emerald-400' : 'text-rose-400'}">${wr}%</span></div></td>
      <td class="p-3 text-right font-mono text-xs ${avg >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(avg)}</td>
      <td class="p-3 text-right font-mono text-xs ${ea.open_pnl >= 0 ? 'text-cyan-400' : 'text-rose-400'}">${formatUSD(ea.open_pnl)}</td>
    </tr>`;
  }).join('');
}


// ═══════════════════════════════════════════════════════════════
// ⚙️ 2. MODALS & CONFIGURATION LOGIC
// ═══════════════════════════════════════════════════════════════

function setupModals() {
  // 1. EA RENAME MODAL
  $('renameColorInput').addEventListener('input', (e) => { $('renameColorHex').textContent = e.target.value; });
  $('saveEaRenameBtn').addEventListener('click', async () => {
    const rawMagics = $('renameMagicInput').value;
    const ea_name = $('renameEaNameInput').value.trim();
    const color = $('renameColorInput').value;
    const description = $('renameDescInput').value.trim();

    if (!rawMagics || !ea_name) {
      alert('Please enter magic number(s) and a display name.');
      return;
    }

    const magic_numbers = rawMagics.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0);
    if (!magic_numbers.length) {
      alert('Please enter valid numeric magic number(s).');
      return;
    }

    const res = await api('/ea-registry/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ magic_numbers, ea_name, color, description })
    });

    if (res && res.success) {
      closeModal('eaRenameModal');
      await refreshDashboard();
    } else {
      alert(res ? res.error : 'Failed to save EA configuration');
    }
  });

  // 2. PROFILE MANAGER MODAL
  $('manageProfilesBtn').addEventListener('click', () => {
    populateProfileManager();
    openModal('profileManagerModal');
  });

  $('createProfileBtn').addEventListener('click', async () => {
    const name = $('newProfileName').value.trim();
    if (!name) { alert('Please enter a profile name'); return; }

    const checkedBoxes = document.querySelectorAll('.profile-acc-check:checked');
    const account_numbers = Array.from(checkedBoxes).map(cb => cb.value).join(',');

    const res = await api('/profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, account_numbers })
    });

    if (res && res.success) {
      $('newProfileName').value = '';
      populateProfileManager();
      await fetchProfilesList();
    } else {
      alert(res ? res.error : 'Failed to create profile');
    }
  });

  // 3. SHARE MODAL
  $('openShareModalBtn').addEventListener('click', () => {
    populateShareModal();
    openModal('shareModal');
  });

  document.querySelectorAll('input[name="shareDateType"]').forEach(r => {
    r.addEventListener('change', (e) => {
      const isSpecific = e.target.value === 'specific';
      $('shareStartDateInput').classList.toggle('hidden', !isSpecific);
      if (isSpecific && !$('shareStartDateInput').value) {
        const d = new Date(); d.setDate(d.getDate() - 30);
        $('shareStartDateInput').value = toYMD(d);
      }
    });
  });

  $('generateShareBtn').addEventListener('click', async () => {
    const profile_id = $('shareProfileSelect').value;
    const isSpecific = document.querySelector('input[name="shareDateType"]:checked').value === 'specific';
    const from_date = isSpecific ? $('shareStartDateInput').value : null;
    const label = $('shareLabelInput').value.trim();

    const res = await api('/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile_id, from_date, label })
    });

    if (res && res.success) {
      const fullUrl = window.location.origin + res.share_url;
      $('shareUrlOutput').value = fullUrl;
      $('generatedLinkBox').classList.remove('hidden');
      loadActiveShareLinks();
    } else {
      alert(res ? res.error : 'Failed to generate link');
    }
  });

  $('copyShareBtn').addEventListener('click', () => {
    const out = $('shareUrlOutput');
    out.select();
    navigator.clipboard.writeText(out.value);
    $('copyShareBtn').textContent = 'Copied!';
    setTimeout(() => { $('copyShareBtn').textContent = 'Copy Link'; }, 2000);
  });
}

// ─── MODAL OPEN HANDLERS ───
function openRenameModal(magics, name, color, desc) {
  if (isSharedMode) return; // Disallow editing in shared mode
  $('renameMagicInput').value = magics || '';
  $('renameEaNameInput').value = name || '';
  $('renameColorInput').value = color || '#3b82f6';
  $('renameColorHex').textContent = color || '#3b82f6';
  $('renameDescInput').value = desc || '';
  openModal('eaRenameModal');
}
window.openRenameModal = openRenameModal;

function populateProfileManager() {
  // Render Account checkboxes
  const cbContainer = $('profileAccountsCheckboxList');
  cbContainer.innerHTML = cachedAccounts.map(a => `
    <label class="flex items-center gap-2 text-slate-300 hover:text-white cursor-pointer select-none">
      <input type="checkbox" value="${a.account_number}" class="profile-acc-check rounded border-white/20 bg-slate-900 text-amber-500 focus:ring-0" />
      <span>${a.account_name || a.broker} (#${a.account_number})</span>
    </label>
  `).join('');

  // Render Existing Profiles list
  const list = $('existingProfilesList');
  list.innerHTML = cachedProfiles.map(p => {
    const isAll = p.slug === 'all';
    const accCount = p.account_numbers ? p.account_numbers.split(',').length : 'All';
    return `<div class="flex items-center justify-between p-2.5 rounded-lg bg-slate-950 border border-white/5">
      <div>
        <span class="font-bold text-white">${p.name}</span>
        <span class="text-[11px] text-slate-500 ml-2 font-mono">(${accCount} Accounts)</span>
      </div>
      ${!isAll ? `<button onclick="deleteProfile(${p.id})" class="text-rose-400 hover:text-rose-300 text-xs px-2 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 transition">Delete</button>` : '<span class="text-[10px] text-slate-600 font-mono">Default</span>'}
    </div>`;
  }).join('');
}

async function deleteProfile(id) {
  if (!confirm('Are you sure you want to delete this profile?')) return;
  const res = await api(`/profiles/${id}`, { method: 'DELETE' });
  if (res && res.success) {
    populateProfileManager();
    await fetchProfilesList();
  } else {
    alert(res ? res.error : 'Failed to delete');
  }
}
window.deleteProfile = deleteProfile;

function populateShareModal() {
  $('generatedLinkBox').classList.add('hidden');
  const sel = $('shareProfileSelect');
  sel.innerHTML = cachedProfiles.map(p => `<option value="${p.id}">${p.name} (${p.account_numbers ? p.account_numbers.split(',').length + ' accounts' : 'All Accounts'})</option>`).join('');
  loadActiveShareLinks();
}

async function loadActiveShareLinks() {
  const d = await api('/share/list');
  const list = $('activeShareLinksList');
  if (!d || !d.links || !d.links.length) {
    list.innerHTML = '<div class="text-slate-600 text-xs py-2">No active share links created yet.</div>';
    return;
  }

  list.innerHTML = d.links.map(l => {
    const fullUrl = `${window.location.origin}/?share=${l.token}`;
    const dateScope = l.from_date ? `from ${l.from_date}` : 'All past data';
    return `<div class="flex items-center justify-between p-2.5 rounded-lg bg-slate-950 border border-white/5 text-xs">
      <div>
        <div class="font-bold text-cyan-300">${l.label || l.profile_name}</div>
        <div class="text-[11px] text-slate-500">Profile: <strong class="text-slate-400">${l.profile_name}</strong> • ${dateScope}</div>
      </div>
      <div class="flex items-center gap-2">
        <button onclick="navigator.clipboard.writeText('${fullUrl}');alert('Link copied!')" class="text-xs px-2.5 py-1 rounded bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 transition">Copy</button>
        <button onclick="revokeShareLink('${l.token}')" class="text-xs px-2.5 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 transition">Revoke</button>
      </div>
    </div>`;
  }).join('');
}

async function revokeShareLink(token) {
  if (!confirm('Revoke this share link immediately?')) return;
  const res = await api(`/share/${token}`, { method: 'DELETE' });
  if (res && res.success) {
    loadActiveShareLinks();
  }
}
window.revokeShareLink = revokeShareLink;
