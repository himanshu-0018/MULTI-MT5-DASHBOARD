// ═══════════════════════════════════════════════════════════════
// MT5 COMMAND CENTER — FUTURISTIC DASHBOARD ENGINE (vanilla JS)
// Owner mode  : unlocked with the master passcode (all profiles + management)
// Shared mode : opened with ?share=TOKEN — read-only, locked to one profile/date
// ═══════════════════════════════════════════════════════════════

const SHARE_TOKEN = new URLSearchParams(location.search).get('share');
const TOKEN_KEY = 'mt5_admin_token';
const PROFILE_KEY = 'mt5_profile';
const isShare = () => !!SHARE_TOKEN;

let session = null;
let profiles = [];
let currentProfile = isShare() ? 'all' : (localStorage.getItem(PROFILE_KEY) || 'all');
let currentAccount = 'all';
let currentEA = 'all';

const todayInit = new Date();
let currentFrom = `${todayInit.getFullYear()}-${String(todayInit.getMonth() + 1).padStart(2, '0')}-01`;
let currentTo = `${todayInit.getFullYear()}-${String(todayInit.getMonth() + 1).padStart(2, '0')}-${String(todayInit.getDate()).padStart(2, '0')}`;

let calendarDate = new Date();
let refreshTimer = null;
let firstLoad = true;

// ─── HELPERS ───
function toYMD(d) { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); }
function dateParams() { const q = []; if (currentFrom) q.push('from=' + currentFrom); if (currentTo) q.push('to=' + currentTo); return q; }
const formatUSD = (num) => {
  const v = Number(num) || 0;
  return (v >= 0 ? '+$' : '-$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const formatPlainUSD = (num) => '$' + (Number(num) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = (v) => Math.abs(v) >= 1000 ? '$' + (v / 1000).toFixed(1) + 'k' : '$' + v.toFixed(0);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtPrice = (v) => (Number(v) ? Number(v).toFixed(5).replace(/0+$/, '').replace(/\.$/, '') : '—');
const fmtDate = (s) => (s ? esc(String(s).slice(0, 16)) : '—');
const magicChip = (m) => `<button type="button" class="magic-chip" data-magic="${esc(m)}" data-testid="magic-chip-${esc(m)}" title="Rename this magic number"><i data-lucide="hash" class="w-2.5 h-2.5"></i>${esc(m)}</button>`;

function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'error' : ''}`; el.textContent = msg; el.setAttribute('data-testid', 'toast');
  $('toasts').appendChild(el); setTimeout(() => el.remove(), 3200);
}

// ─── API ───
class AuthError extends Error {}
function authHeaders() {
  const h = { Accept: 'application/json' };
  if (isShare()) h['X-Share-Token'] = SHARE_TOKEN;
  else { const t = localStorage.getItem(TOKEN_KEY); if (t) h.Authorization = 'Bearer ' + t; }
  return h;
}
async function request(path, { method = 'GET', body } = {}) {
  const headers = authHeaders();
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let url = '/api' + path;
  if (!isShare() && method === 'GET' && currentProfile !== 'all') url += (url.includes('?') ? '&' : '?') + 'profile=' + encodeURIComponent(currentProfile);
  const res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  if (res.status === 401 || (res.status === 403 && isShare())) { handleAuthFailure(); throw new AuthError('auth'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
async function api(path) {
  try { return await request(path); } catch (e) { return null; }
}

// ═══════════════════════════════════════════════════════════════
// LOCK SCREEN / SESSION
// ═══════════════════════════════════════════════════════════════
function showLock(message = '') {
  stopRefresh();
  document.body.classList.add('locked');
  $('lockForm').classList.toggle('hidden', isShare());
  $('shareInvalid').classList.toggle('hidden', !isShare());
  $('lockError').textContent = message;
  if (!isShare()) setTimeout(() => $('passcodeInput').focus(), 50);
}
function hideLock() { document.body.classList.remove('locked'); }
function handleAuthFailure() {
  if (!isShare()) localStorage.removeItem(TOKEN_KEY);
  showLock(isShare() ? '' : 'Session expired — please unlock again.');
}
function stopRefresh() { if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; } }

function initLock() {
  $('unlockForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('unlockBtn'); btn.disabled = true; $('lockError').textContent = '';
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passcode: $('passcodeInput').value }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token) throw new Error(data.error || 'Unlock failed');
      localStorage.setItem(TOKEN_KEY, data.token);
      $('passcodeInput').value = '';
      await boot();
    } catch (err) {
      $('lockError').textContent = err.message;
      const card = document.querySelector('.lock-card'); card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
    } finally { btn.disabled = false; }
  });
  $('lockBtn').addEventListener('click', () => { localStorage.removeItem(TOKEN_KEY); showLock(); });
}

async function boot() {
  if (!isShare() && !localStorage.getItem(TOKEN_KEY)) return showLock();
  try { session = await request('/session'); }
  catch (e) { if (!(e instanceof AuthError)) showLock('Server unreachable — try again.'); return; }
  applyModeUI();
  if (!isShare()) await loadProfiles();
  hideLock();
  firstLoad = true;
  await refreshDashboard();
  stopRefresh();
  refreshTimer = setInterval(() => refreshDashboard(), 5000);
}

function applyModeUI() {
  if (!isShare()) { document.body.classList.remove('share-mode'); return; }
  document.body.classList.add('share-mode');
  const p = session.profile ? session.profile.name : 'Shared';
  $('shareBadgeText').textContent = `Shared view • ${p}${session.min_date ? ' • since ' + session.min_date : ''}`;
  $('heroTag').textContent = `Shared performance • ${p}`;
  if (session.min_date) { $('fromDate').min = session.min_date; $('toDate').min = session.min_date; }
}

// ═══════════════════════════════════════════════════════════════
// BACKGROUND: starfield + cursor spotlight
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

function animateValue(el, end, { decimals = 0, prefix = '', suffix = '', duration = 1600 } = {}) {
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
  if (firstLoad) animateValue(el, value, { decimals, prefix, suffix });
  else el.textContent = prefix + Number(value).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
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
// INIT
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  lucide.createIcons();
  initBackground();
  initReveal();
  typeHeadline('Center');
  initLock();
  initModal();
  $('accountFilter').addEventListener('change', (e) => { currentAccount = e.target.value; refreshDashboard(); });
  $('eaFilter').addEventListener('change', (e) => { currentEA = e.target.value; refreshDashboard(); });
  $('profileFilter').addEventListener('change', (e) => {
    currentProfile = e.target.value; localStorage.setItem(PROFILE_KEY, currentProfile);
    currentAccount = 'all'; currentEA = 'all'; refreshDashboard();
  });
  $('refreshBtn').addEventListener('click', () => refreshDashboard(true));
  $('eaNamesBtn').addEventListener('click', () => openEANames());
  $('profilesBtn').addEventListener('click', () => openProfiles());
  $('shareBtn').addEventListener('click', () => openShare());
  document.addEventListener('click', (e) => {
    const chip = e.target.closest('button.magic-chip[data-magic]');
    if (chip && !isShare()) openEANames(Number(chip.dataset.magic));
    const st = e.target.closest('button.show-trades-btn[data-ea]');
    if (st) openEATrades(st.dataset.ea);
  });
  });
  initRangeFilter();
  initDDMode();
  setTimeout(() => $('loader').classList.add('hidden'), 1200);
  await boot();
});

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
    else if (v === 'current_month') { currentFrom = toYMD(new Date(today.getFullYear(), today.getMonth(), 1)); currentTo = toYMD(today); }
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

let refreshing = false;
async function refreshDashboard(spin = false) {
  if (document.body.classList.contains('locked') || refreshing) return;
  refreshing = true;
  if (spin) { const ic = $('refreshIcon'); ic.classList.add('spin-once'); setTimeout(() => ic.classList.remove('spin-once'), 700); }
  try {
    await Promise.all([fetchAccountsList(), fetchEAList(), fetchOverview(), fetchEquity(), fetchDrawdown(), fetchCalendar(), fetchPositions(), fetchPendingOrders()]);
    $('lastUpdated').textContent = new Date().toLocaleTimeString();
    $('dataMode').textContent = isShare() ? 'Shared read-only view' : 'Cloud Sync';
    lucide.createIcons();
    firstLoad = false;
  } finally { refreshing = false; }
}

const filterQS = () => `account=${encodeURIComponent(currentAccount)}&ea=${encodeURIComponent(currentEA)}`;

// 1. OVERVIEW
async function fetchOverview() {
  const dp = dateParams();
  const d = await api(`/overview?${filterQS()}${dp.length ? '&' + dp.join('&') : ''}`);
  if (!d) return;
  const set = (id, t) => { const e = $(id); if (e) e.textContent = t; };
  if (firstLoad) {
    animateValue($('totalBalance'), d.total_balance, { decimals: 2, prefix: '$' });
    animateValue($('monthPnl'), Math.abs(d.month_pnl), { decimals: 2, prefix: d.month_pnl >= 0 ? '+$' : '-$' });
  } else {
    set('totalBalance', formatPlainUSD(d.total_balance));
    set('monthPnl', formatUSD(d.month_pnl));
  }
  set('totalEquity', formatPlainUSD(d.total_equity));
  set('accountCountBadge', `${d.total_accounts} Accs`);
  set('totalClosedPnl', formatUSD(d.total_closed_profit));

  const today = $('todayPnl'); today.textContent = formatUSD(d.today_pnl);
  today.className = `text-2xl font-extrabold tracking-tight font-display ${d.today_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
  $('todayIcon').setAttribute('data-lucide', d.today_pnl >= 0 ? 'trending-up' : 'trending-down');
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

// 2. ACCOUNTS (+ filter dropdown)
async function fetchAccountsList() {
  const d = await api('/accounts');
  if (!d) return;
  const sel = $('accountFilter');
  sel.innerHTML = '<option value="all">All Accounts</option>';
  d.accounts.forEach((a) => {
    const o = document.createElement('option'); o.value = a.account_number;
    o.textContent = `${a.account_name || a.broker} • #${a.account_number}`;
    if (String(o.value) === String(currentAccount)) o.selected = true;
    sel.appendChild(o);
  });
  if (currentAccount !== 'all' && !d.accounts.some((a) => String(a.account_number) === String(currentAccount))) { currentAccount = 'all'; sel.value = 'all'; }

  const shown = currentAccount === 'all' ? d.accounts : d.accounts.filter((a) => String(a.account_number) === String(currentAccount));
  const grid = $('accountsGrid');
  if (!shown.length) { grid.innerHTML = '<div class="col-span-2 text-center py-6 text-slate-500 text-sm">No MT5 terminals connected in this view</div>'; return; }
  grid.innerHTML = shown.map((acc) => {
    const pos = acc.today_profit >= 0; const pct = Math.min(Math.abs(acc.today_profit) / (acc.balance || 1) * 1000, 100);
    return `<div class="tilt-card bg-slate-900/60 border border-white/5 p-4 rounded-xl hover:border-cyan-400/30 transition-all duration-300" data-testid="account-card-${esc(acc.account_number)}">
      <div class="flex justify-between items-start mb-2"><div><h3 class="font-bold text-sm text-white">${esc(acc.account_name || 'Account #' + acc.account_number)}</h3><p class="text-xs text-slate-400">${esc(acc.broker || 'MT5')} • #${esc(acc.account_number)}</p></div><div class="flex flex-col items-end gap-1"><span class="px-2 py-0.5 rounded text-[10px] font-mono ${pos ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}">${acc.open_count} Open</span>${acc.pending_count ? `<span class="px-2 py-0.5 rounded text-[10px] font-mono bg-sky-500/10 text-sky-300">${acc.pending_count} Pending</span>` : ''}</div></div>
      <div class="mt-3 flex justify-between items-baseline"><div><span class="text-[10px] text-slate-500 uppercase block">Balance</span><span class="font-semibold text-sm text-slate-200">${formatPlainUSD(acc.balance)}</span></div><div class="text-right"><span class="text-[10px] text-slate-500 uppercase block">Today</span><span class="font-semibold text-sm ${pos ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(acc.today_profit)}</span></div></div>
      <div class="mt-2 w-full bg-slate-800 rounded-full h-1 overflow-hidden"><div class="h-1 rounded-full" style="width:${pct}%;background:${pos ? 'linear-gradient(90deg,#34d399,#22d3ee)' : 'linear-gradient(90deg,#fb7185,#f59e0b)'}"></div></div>
    </div>`;
  }).join('');
}

// 3. EA LIST (+ filter dropdown + bar chart + leaderboard) — EAs are grouped by name
async function fetchEAList() {
  const dp = dateParams();
  const d = await api('/eas' + (dp.length ? '?' + dp.join('&') : ''));
  if (!d) return;
  const all = d.eas;
  const sel = $('eaFilter');
  sel.innerHTML = '<option value="all">All EAs</option>';
  all.forEach((e) => {
    const o = document.createElement('option'); o.value = e.ea_name;
    o.textContent = e.magic_numbers.length > 1 ? `${e.ea_name} (${e.magic_numbers.length} magics)` : e.ea_name;
    if (o.value === currentEA) o.selected = true;
    sel.appendChild(o);
  });
  if (currentEA !== 'all' && !all.some((e) => e.ea_name === currentEA)) {
    const o = document.createElement('option'); o.value = currentEA; o.textContent = currentEA; o.selected = true; sel.appendChild(o);
  }
  $('eaNameOptions').innerHTML = all.map((e) => `<option value="${esc(e.ea_name)}"></option>`).join('');
  const shown = currentEA === 'all' ? all : all.filter((e) => e.ea_name === currentEA);
  updateHero('heroEAs', shown.length);
  renderBars(shown);
  renderLeaderboard(shown);
}

function renderBars(eas) {
  const box = $('eaChart'); const max = Math.max(...eas.map((e) => Math.abs(e.total_pnl)), 1);
  if (!eas.length) { box.innerHTML = '<div class="text-center py-6 text-slate-600 text-sm">No EA data in this range</div>'; return; }
  box.innerHTML = eas.map((ea, i) => {
    const pct = (Math.abs(ea.total_pnl) / max) * 100; const pos = ea.total_pnl >= 0;
    return `<div><div class="flex items-center justify-between text-xs mb-1"><span class="font-semibold text-slate-200">${esc(ea.ea_name)}${ea.magic_numbers.length > 1 ? ` <span class="text-[10px] text-slate-500 font-normal">• ${ea.magic_numbers.length} merged</span>` : ''}</span><span class="flex items-center gap-2.5"><span class="font-mono font-bold ${pos ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(ea.total_pnl)}</span><button type="button" class="show-trades-btn" data-ea="${esc(ea.ea_name)}" data-testid="show-trades-btn-${i}"><i data-lucide="list" class="w-3 h-3"></i>Show trades</button></span></div>
      <div class="h-2.5 w-full rounded-full bg-slate-800/60 overflow-hidden"><div class="h-full rounded-full eq-bar" data-w="${pct}" style="transition-delay:${i * 90}ms;background:${pos ? 'linear-gradient(90deg,#22d3ee,#34d399)' : 'linear-gradient(90deg,#fb7185,#f59e0b)'};box-shadow:${pos ? '0 0 12px rgba(34,211,238,0.4)' : '0 0 12px rgba(251,113,133,0.4)'}"></div></div></div>`;
  }).join('');
  requestAnimationFrame(() => box.querySelectorAll('.eq-bar').forEach((b) => { b.style.width = b.dataset.w + '%'; }));
}

function renderLeaderboard(eas) {
  const tb = $('eaLeaderboardBody');
  if (!eas.length) { tb.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-slate-600">No EA data available yet</td></tr>'; return; }
  const medal = ['🥇', '🥈', '🥉'];
  tb.innerHTML = eas.map((ea, i) => {
    const wr = ea.total_trades > 0 ? ((ea.wins / ea.total_trades) * 100).toFixed(1) : '0.0';
    const avg = ea.total_trades > 0 ? ea.total_pnl / ea.total_trades : 0; const pos = ea.total_pnl >= 0;
    return `<tr class="hover:bg-white/5 transition-colors" data-testid="leaderboard-row-${i}"><td class="p-3 text-center text-base">${i < 3 ? medal[i] : '<span class="text-slate-500 font-mono text-sm">#' + (i + 1) + '</span>'}</td>
      <td class="p-3"><div class="flex items-center gap-3"><span class="w-3 h-3 rounded-full shrink-0" style="background:${esc(ea.color)};box-shadow:0 0 10px ${esc(ea.color)}88"></span><div><span class="font-bold text-white text-sm" data-testid="leaderboard-ea-name-${i}">${esc(ea.ea_name)}</span><div class="mt-1 flex flex-wrap gap-1">${ea.magic_numbers.map(magicChip).join('')}</div></div></div></td>
      <td class="p-3 text-right font-mono font-bold ${pos ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(ea.total_pnl)}</td>
      <td class="p-3 text-center font-mono text-slate-300">${ea.total_trades}</td>
      <td class="p-3 text-center"><span class="text-emerald-400 font-semibold">${ea.wins}</span><span class="text-slate-600 mx-1">/</span><span class="text-rose-400 font-semibold">${ea.losses}</span></td>
      <td class="p-3"><div class="flex items-center justify-center gap-2"><div class="w-16 bg-slate-800 rounded-full h-2 overflow-hidden"><div class="h-2 rounded-full" style="width:${wr}%;background:${Number(wr) >= 50 ? 'linear-gradient(90deg,#34d399,#22d3ee)' : 'linear-gradient(90deg,#fb7185,#f59e0b)'}"></div></div><span class="text-xs font-bold ${Number(wr) >= 50 ? 'text-emerald-400' : 'text-rose-400'}">${wr}%</span></div></td>
      <td class="p-3 text-right font-mono text-xs ${avg >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(avg)}</td>
      <td class="p-3 text-right font-mono text-xs ${ea.open_pnl >= 0 ? 'text-cyan-400' : 'text-rose-400'}">${formatUSD(ea.open_pnl)}${ea.pending_count ? `<br><span class="text-[10px] text-sky-300">${ea.pending_count} pending</span>` : ''}</td></tr>`;
  }).join('');
}

// WIN/LOSS DONUT
function renderDonut(wins, losses) {
  const box = $('winLossChart'); const total = wins + losses || 1; const winPct = (wins / total) * 100;
  const R = 70, C = 2 * Math.PI * R; const len = (winPct / 100) * C;
  box.innerHTML = `<div class="flex flex-col items-center"><div class="relative w-[180px] h-[180px]"><svg viewBox="0 0 180 180" class="w-full h-full" style="transform:rotate(-90deg)"><defs><linearGradient id="winGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#22d3ee"/><stop offset="100%" stop-color="#34d399"/></linearGradient></defs><circle cx="90" cy="90" r="${R}" fill="none" stroke="#fb7185" stroke-width="16" stroke-opacity="0.85"/><circle cx="90" cy="90" r="${R}" fill="none" stroke="url(#winGrad)" stroke-width="16" stroke-linecap="round" stroke-dasharray="0 ${C}" style="filter:drop-shadow(0 0 6px rgba(34,211,238,0.5))" id="donutArc"/></svg><div class="absolute inset-0 flex flex-col items-center justify-center"><span class="text-[10px] uppercase tracking-widest text-slate-500">Win Rate</span><span class="text-3xl font-extrabold text-white">${winPct.toFixed(1)}%</span></div></div><div class="mt-4 flex items-center gap-5 text-xs"><span class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-sm bg-cyan-400"></span><span class="text-slate-300">${wins} Wins</span></span><span class="flex items-center gap-2"><span class="w-2.5 h-2.5 rounded-sm bg-rose-400"></span><span class="text-slate-300">${losses} Losses</span></span></div></div>`;
  requestAnimationFrame(() => { const arc = $('donutArc'); if (arc) { arc.style.transition = 'stroke-dasharray 1.3s cubic-bezier(.22,1,.36,1)'; arc.setAttribute('stroke-dasharray', `${len} ${C}`); } });
}

// 4. GROWTH CURVE — balance step-line on a true time axis + underwater strip (custom SVG)
let eqData = null;
let ddMode = 'usd';
const parseT = (s) => new Date(String(s).replace(' ', 'T')).getTime();
const fmtDay = (t) => new Date(t).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
const fmtStamp = (t) => new Date(t).toLocaleString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

async function fetchEquity() {
  const dp = dateParams();
  const d = await api(`/charts/equity-curve?${filterQS()}${dp.length ? '&' + dp.join('&') : ''}`);
  if (d) { eqData = d; renderEquity(); }
}

function initDDMode() {
  const sync = () => document.querySelectorAll('.dd-mode').forEach((b) => b.classList.toggle('active', b.dataset.mode === ddMode));
  document.querySelectorAll('.dd-mode').forEach((b) => b.addEventListener('click', () => { ddMode = b.dataset.mode; sync(); renderEquity(true); }));
  sync();
}

const stepPath = (pts) => pts.reduce((acc, p, i) => acc + (i ? ` H ${p.x} V ${p.y}` : `M ${p.x},${p.y}`), '');

function renderEquity(noAnim = false) {
  const box = $('equityChart'), uw = $('underwaterChart');
  const d = eqData;
  if (!d || !d.curve || !d.curve.length) {
    box.innerHTML = '<div class="h-[200px] flex items-center justify-center text-slate-600 text-sm">No closed trades in this range</div>';
    uw.innerHTML = ''; return;
  }
  const start = Number(d.start_balance) || 0;
  const t0 = parseT(d.curve[0].time);
  const data = [{ t: t0 - 1000, v: start, c: 0, dd: 0, ddp: 0, p: 0, start: true }]
    .concat(d.curve.map((p) => ({ t: parseT(p.time), v: p.balance, c: p.cumulative_profit, dd: p.dd, ddp: p.dd_pct, p: p.profit })));
  const anim = firstLoad && !noAnim;
  const W = 1000, H = 360, padT = 20, padB = 26, padL = 8, padR = 8;
  const UH = 120, uPadT = 6, uPadB = 18;
  const xs = data.map((p) => p.t), ys = data.map((p) => p.v);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  const padY = (maxY - minY || Math.abs(maxY) || 1) * 0.06; minY -= padY; maxY += padY;
  const sx = (x) => padL + ((x - minX) / (maxX - minX || 1)) * (W - padL - padR);
  const sy = (y) => padT + (1 - (y - minY) / (maxY - minY || 1)) * (H - padT - padB);
  const pts = data.map((p) => ({ ...p, x: sx(p.t), y: sy(p.v) }));
  const line = stepPath(pts);
  const last = pts[pts.length - 1];
  const area = `${line} H ${last.x} V ${H - padB} H ${pts[0].x} Z`;
  let peak = 0, valley = 0; pts.forEach((p, i) => { if (p.v > pts[peak].v) peak = i; if (p.v < pts[valley].v) valley = i; });

  let grid = '', labels = '';
  for (let i = 0; i <= 4; i++) {
    const val = minY + (maxY - minY) * i / 4; const y = sy(val);
    grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(148,163,184,0.08)" stroke-dasharray="5 6"/>`;
    labels += `<span class="absolute left-1 text-[10px] font-mono text-slate-500" style="top:${(y / H) * 100}%;transform:translateY(-50%)">${compact(val)}</span>`;
  }
  let xLabels = '';
  if (maxX > minX) for (let i = 0; i <= 4; i++) {
    const t = minX + (maxX - minX) * i / 4;
    xLabels += `<span class="absolute bottom-0 text-[10px] font-mono text-slate-500" style="left:${(sx(t) / W) * 100}%;transform:translateX(${i === 0 ? '0' : i === 4 ? '-100%' : '-50%'})">${fmtDay(t)}</span>`;
  }
  let zone = '';
  const dd = d.drawdown || {};
  if (dd.peak_time && dd.trough_time) {
    const x1 = Math.max(padL, sx(parseT(dd.peak_time))), x2 = Math.min(W - padR, sx(parseT(dd.trough_time)));
    if (x2 > x1) zone = `<rect x="${x1}" y="${padT}" width="${x2 - x1}" height="${H - padT - padB}" fill="#fb7185" fill-opacity="0.08"/><line x1="${x1}" y1="${padT}" x2="${x1}" y2="${H - padB}" stroke="rgba(251,113,133,0.35)" stroke-dasharray="3 4"/><line x1="${x2}" y1="${padT}" x2="${x2}" y2="${H - padB}" stroke="rgba(251,113,133,0.35)" stroke-dasharray="3 4"/>`;
  }
  const startY = sy(start);

  box.innerHTML = `
    <svg id="eqSvg" viewBox="0 0 ${W} ${H}" class="w-full h-[360px]" preserveAspectRatio="none" data-testid="growth-curve-svg">
      <defs>
        <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#22d3ee" stop-opacity="0.32"/><stop offset="45%" stop-color="#a855f7" stop-opacity="0.12"/><stop offset="100%" stop-color="#7c3aed" stop-opacity="0"/></linearGradient>
        <linearGradient id="eqStroke" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#22d3ee"/><stop offset="100%" stop-color="#a855f7"/></linearGradient>
        <filter id="eqGlow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      </defs>
      ${grid}
      ${zone}
      <line x1="${padL}" y1="${startY}" x2="${W - padR}" y2="${startY}" stroke="rgba(100,116,139,0.55)" stroke-dasharray="4 5"/>
      <path d="${area}" fill="url(#eqFill)" class="${anim ? 'eq-area' : ''}"/>
      <path d="${line}" pathLength="4000" fill="none" stroke="url(#eqStroke)" stroke-width="2" stroke-linejoin="round" filter="url(#eqGlow)" class="${anim ? 'eq-line' : ''}"/>
      <circle cx="${pts[peak].x}" cy="${pts[peak].y}" r="5" fill="#34d399" stroke="#05070f" stroke-width="2"/>
      <circle cx="${pts[valley].x}" cy="${pts[valley].y}" r="5" fill="#fb7185" stroke="#05070f" stroke-width="2"/>
      <circle cx="${last.x}" cy="${last.y}" r="6" fill="#22d3ee" stroke="#05070f" stroke-width="2" class="pulse-dot"/>
      <g id="eqCross" style="display:none"><line id="eqCrossLine" y1="${padT}" y2="${H - padB}" stroke="rgba(34,211,238,0.4)" stroke-dasharray="3 3"/><circle id="eqCrossDot" r="5" fill="#fff" stroke="#22d3ee" stroke-width="2"/></g>
    </svg>
    <div class="absolute inset-0 pointer-events-none">${labels}${xLabels}</div>
    <div id="eqTip" class="eq-tooltip" style="display:none" data-testid="growth-curve-tooltip"></div>`;

  // Underwater strip
  const key = ddMode === 'usd' ? 'dd' : 'ddp';
  const minU = Math.min(...data.map((p) => -p[key]), -0.01);
  const uy = (v) => uPadT + (v / minU) * (UH - uPadT - uPadB);
  const upts = data.map((p) => ({ x: sx(p.t), y: uy(-p[key]) }));
  const uline = stepPath(upts);
  const uarea = `${uline} H ${upts[upts.length - 1].x} V ${uy(0)} H ${upts[0].x} Z`;
  const ufmt = (v) => (ddMode === 'usd' ? '-' + compact(Math.abs(v)) : v.toFixed(1) + '%');
  uw.innerHTML = `
    <svg id="uwSvg" viewBox="0 0 ${W} ${UH}" class="w-full h-[120px]" preserveAspectRatio="none">
      <line x1="${padL}" y1="${uy(0)}" x2="${W - padR}" y2="${uy(0)}" stroke="rgba(100,116,139,0.45)" stroke-dasharray="4 5"/>
      <line x1="${padL}" y1="${uy(minU / 2)}" x2="${W - padR}" y2="${uy(minU / 2)}" stroke="rgba(148,163,184,0.08)" stroke-dasharray="5 6"/>
      <path d="${uarea}" fill="#fb7185" fill-opacity="0.18"/>
      <path d="${uline}" fill="none" stroke="#fb7185" stroke-width="1.4" stroke-linejoin="round"/>
      <line id="uwCross" y1="${uPadT}" y2="${UH - uPadB}" stroke="rgba(34,211,238,0.4)" stroke-dasharray="3 3" style="display:none"/>
    </svg>
    <div class="absolute inset-0 pointer-events-none">
      <span class="absolute left-1 text-[10px] font-mono text-slate-500" style="top:${(uy(0) / UH) * 100}%;transform:translateY(-50%)">0</span>
      <span class="absolute left-1 text-[10px] font-mono text-rose-300/70" style="top:${(uy(minU) / UH) * 100}%;transform:translateY(-50%)">${ufmt(minU)}</span>
    </div>`;

  const tip = $('eqTip');
  const show = (e, svgEl) => {
    const rect = svgEl.getBoundingClientRect(); const relX = ((e.clientX - rect.left) / rect.width) * W;
    let n = 0, dist = Infinity; pts.forEach((p, i) => { const dx = Math.abs(p.x - relX); if (dx < dist) { dist = dx; n = i; } });
    const p = pts[n];
    $('eqCross').style.display = ''; $('eqCrossLine').setAttribute('x1', p.x); $('eqCrossLine').setAttribute('x2', p.x);
    $('eqCrossDot').setAttribute('cx', p.x); $('eqCrossDot').setAttribute('cy', p.y);
    const uc = $('uwCross'); uc.style.display = ''; uc.setAttribute('x1', p.x); uc.setAttribute('x2', p.x);
    tip.style.display = ''; tip.style.left = Math.min(Math.max((p.x / W) * 100, 8), 92) + '%'; tip.style.top = (p.y / H) * 100 + '%'; tip.style.marginTop = '-14px';
    tip.innerHTML = `<div class="box"><div class="text-[10px] text-slate-400">${p.start ? 'Starting balance' : fmtStamp(p.t)}</div>
      <div class="text-[10px] uppercase tracking-wider text-slate-500">Balance</div><div class="text-base font-extrabold text-cyan-300">${formatPlainUSD(p.v)}</div>
      ${p.start ? '' : `<div class="text-[11px] text-slate-400">Trade <span class="${p.p >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(p.p)}</span> • Cum <span class="${p.c >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(p.c)}</span></div>
      <div class="text-[11px] text-rose-300">DD ${formatPlainUSD(p.dd)} (${Number(p.ddp).toFixed(2)}%)</div>`}</div>`;
  };
  const hide = () => { $('eqCross').style.display = 'none'; $('uwCross').style.display = 'none'; tip.style.display = 'none'; };
  [$('eqSvg'), $('uwSvg')].forEach((el) => { el.addEventListener('mousemove', (e) => show(e, el)); el.addEventListener('mouseleave', hide); });
}

// 4b. DRAWDOWN — KPI card + live per-EA table
const ddAmt = (v) => (Number(v) > 0 ? '-' : '') + formatPlainUSD(v);
const ddPct = (v) => (Number(v) > 0 ? '-' : '') + Number(v || 0).toFixed(2) + '%';

async function fetchDrawdown() {
  const dp = dateParams();
  const d = await api(`/drawdown?${filterQS()}${dp.length ? '&' + dp.join('&') : ''}`);
  if (!d) return;
  const o = d.overall;
  const set = (id, t) => { const e = $(id); if (e) e.textContent = t; };
  set('ddEquity', ddAmt(o.equity.max_dd)); set('ddEquityPct', ddPct(o.equity.max_dd_pct));
  set('ddBalance', ddAmt(o.balance.max_dd)); set('ddBalancePct', ddPct(o.balance.max_dd_pct));
  set('ddCurrent', ddAmt(o.equity.current_dd)); set('ddCurrentPct', ddPct(o.equity.current_dd_pct));
  renderDrawdownTable(d.eas);
  const noSamples = d.eas.filter((e) => !e.equity_samples).length;
  set('ddSamplesNote', noSamples ? 'Equity drawdown uses floating P&L saved once a minute while positions are open. Until history builds up, earlier periods fall back to the closed-trade balance plus the live floating value.' : '');
}

function ddCell(s, color) {
  const w = Math.min(Number(s.max_dd_pct) * 4, 100);
  return `<div class="min-w-[150px]"><div class="flex items-baseline gap-2"><span class="font-mono font-bold ${color}">${ddAmt(s.max_dd)}</span><span class="text-[11px] font-mono text-slate-400">${ddPct(s.max_dd_pct)}</span></div>
    <div class="mt-1.5 h-1.5 w-full rounded-full bg-slate-800/70 overflow-hidden"><div class="h-full rounded-full" style="width:${w}%;background:linear-gradient(90deg,#fb7185,#f59e0b)"></div></div></div>`;
}

function renderDrawdownTable(eas) {
  const tb = $('eaDrawdownBody');
  if (!eas.length) { tb.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-slate-600">No EA activity in this range</td></tr>'; return; }
  const span = (s) => (s.peak_time ? `<span class="text-slate-300">${fmtDate(s.peak_time)}</span><span class="text-slate-600 mx-1">→</span><span class="text-rose-300">${fmtDate(s.trough_time)}</span>` : '<span class="text-slate-600">No drawdown</span>');
  tb.innerHTML = eas.map((ea, i) => `<tr class="hover:bg-white/5 transition-colors" data-testid="ea-drawdown-row-${i}">
    <td class="p-3"><div class="flex items-center gap-3"><span class="w-3 h-3 rounded-full shrink-0" style="background:${esc(ea.color)};box-shadow:0 0 10px ${esc(ea.color)}88"></span><div><span class="font-bold text-white text-sm" data-testid="ea-drawdown-name-${i}">${esc(ea.ea_name)}</span><div class="mt-1 flex flex-wrap gap-1">${ea.magic_numbers.map(magicChip).join('')}</div></div></div></td>
    <td class="p-3" data-testid="ea-drawdown-equity-${i}">${ddCell(ea.equity, 'text-rose-400')}</td>
    <td class="p-3" data-testid="ea-drawdown-balance-${i}">${ddCell(ea.balance, 'text-amber-300')}</td>
    <td class="p-3 text-right font-mono text-xs" data-testid="ea-drawdown-current-${i}"><div class="${ea.equity.current_dd > 0 ? 'text-rose-300' : 'text-slate-400'}">${ddAmt(ea.equity.current_dd)}</div><div class="text-[10px] text-slate-500">${ddPct(ea.equity.current_dd_pct)}</div></td>
    <td class="p-3 font-mono text-[11px]">${span(ea.equity.max_dd >= ea.balance.max_dd ? ea.equity : ea.balance)}</td>
    <td class="p-3 text-right font-mono text-xs ${ea.floating_now >= 0 ? 'text-cyan-400' : 'text-rose-400'}" data-testid="ea-drawdown-floating-${i}">${formatUSD(ea.floating_now)}</td></tr>`).join('');
}

// 5. CALENDAR
async function fetchCalendar() {
  const year = calendarDate.getFullYear(), month = calendarDate.getMonth() + 1;
  const d = await api(`/calendar?year=${year}&month=${month}&${filterQS()}`);
  if (!d) return;
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  $('calendarCurrentMonth').textContent = `${months[month - 1]} ${year}`;
  const mt = $('calendarMonthTotal'); mt.textContent = formatUSD(d.month_total_pnl); mt.className = `font-bold ${d.month_total_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
  const map = {}; d.days.forEach((x) => { map[x.date] = x; });
  const firstDay = new Date(year, month - 1, 1).getDay(); const offset = firstDay === 0 ? 6 : firstDay - 1;
  const dim = new Date(year, month, 0).getDate(); const todayStr = toYMD(new Date());
  let html = '';
  for (let i = 0; i < offset; i++) html += '<div class="h-20 bg-slate-900/20 border border-white/5 rounded-xl opacity-20"></div>';
  for (let day = 1; day <= dim; day++) {
    const ds = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`; const dd = map[ds]; const isToday = ds === todayStr;
    if (dd) {
      const pos = dd.profit >= 0;
      html += `<div class="h-20 p-2 rounded-xl border transition-all duration-300 hover:scale-[1.06] flex flex-col justify-between ${pos ? 'bg-emerald-950/30 border-emerald-500/25 hover:border-emerald-400/50' : 'bg-rose-950/30 border-rose-500/25 hover:border-rose-400/50'} ${isToday ? 'ring-2 ring-cyan-400/60' : ''}"><div class="flex justify-between items-center"><span class="text-xs font-bold ${isToday ? 'text-cyan-400' : 'text-slate-400'}">${day}</span><span class="text-[9px] px-1.5 py-0.5 rounded-full font-mono ${pos ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}">${dd.wins}W ${dd.losses}L</span></div><div class="text-right"><span class="text-xs sm:text-sm font-extrabold block ${pos ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(dd.profit)}</span><span class="text-[9px] text-slate-500">${dd.trades_count}t</span></div></div>`;
    } else {
      html += `<div class="h-20 p-2 rounded-xl bg-slate-900/25 border border-white/5 flex flex-col justify-between ${isToday ? 'ring-2 ring-cyan-400/60' : ''}"><span class="text-xs ${isToday ? 'text-cyan-400 font-bold' : 'text-slate-600'}">${day}</span><span class="text-[11px] text-slate-700 text-right">—</span></div>`;
    }
  }
  $('calendarGrid').innerHTML = html;
}
function changeMonth(delta) { calendarDate.setMonth(calendarDate.getMonth() + delta); fetchCalendar(); }

// 6. OPEN POSITIONS
async function fetchPositions() {
  const d = await api(`/open-positions?${filterQS()}`);
  if (!d) return;
  const positions = d.positions;
  $('liveOpenBadge').textContent = `${positions.length} Active`;
  const tb = $('openPositionsTable');
  if (!positions.length) { tb.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-slate-600">No active floating positions</td></tr>'; return; }
  tb.innerHTML = positions.map((p) => {
    const net = p.profit + p.swap;
    return `<tr class="hover:bg-white/5 transition-colors"><td class="p-2.5"><span class="font-semibold text-white">${esc(p.ea_name)}</span><div class="mt-0.5 flex items-center gap-1.5">${magicChip(p.magic_number)}<span class="text-[10px] text-slate-500">#${esc(p.account_number)}</span></div></td><td class="p-2.5 font-bold text-slate-200">${esc(p.symbol)}</td><td class="p-2.5"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${p.trade_type === 'BUY' ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/25' : 'bg-amber-500/15 text-amber-400 border border-amber-500/25'}">${esc(p.trade_type)}</span></td><td class="p-2.5 font-mono text-slate-300">${p.volume}</td><td class="p-2.5 font-mono text-slate-300">${fmtPrice(p.open_price)}</td><td class="p-2.5 text-right font-mono font-bold ${net >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(net)}</td></tr>`;
  }).join('');
}

// 7. PENDING ORDERS
async function fetchPendingOrders() {
  const d = await api(`/pending-orders?${filterQS()}`);
  if (!d) return;
  const orders = d.orders;
  $('pendingBadge').textContent = `${orders.length} Pending`;
  const tb = $('pendingOrdersTable');
  if (!orders.length) { tb.innerHTML = '<tr><td colspan="13" class="text-center py-8 text-slate-600">No pending orders</td></tr>'; return; }
  tb.innerHTML = orders.map((o) => {
    const buy = o.order_type.startsWith('BUY');
    const dist = o.price_current ? ((o.price_open - o.price_current) / o.price_current) * 100 : 0;
    return `<tr class="hover:bg-white/5 transition-colors" data-testid="pending-order-row-${esc(o.ticket)}">
      <td class="p-2.5"><span class="font-semibold text-white">${esc(o.ea_name)}</span><div class="mt-0.5 flex items-center gap-1.5">${magicChip(o.magic_number)}<span class="text-[10px] text-slate-500">#${esc(o.account_number)}</span></div></td>
      <td class="p-2.5 font-mono text-slate-400">${esc(o.ticket)}</td>
      <td class="p-2.5 font-bold text-slate-200">${esc(o.symbol)}</td>
      <td class="p-2.5"><span class="type-pill ${buy ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/25' : 'bg-amber-500/15 text-amber-300 border-amber-500/25'}">${esc(o.order_type.replace(/_/g, ' '))}</span></td>
      <td class="p-2.5 text-right font-mono">${o.volume}</td>
      <td class="p-2.5 text-right font-mono text-white">${fmtPrice(o.price_open)}</td>
      <td class="p-2.5 text-right font-mono">${fmtPrice(o.price_current)}</td>
      <td class="p-2.5 text-right font-mono ${Math.abs(dist) < 0.1 ? 'text-amber-300' : 'text-slate-400'}">${o.price_current ? (dist >= 0 ? '+' : '') + dist.toFixed(2) + '%' : '—'}</td>
      <td class="p-2.5 text-right font-mono text-rose-300">${fmtPrice(o.sl)}</td>
      <td class="p-2.5 text-right font-mono text-emerald-300">${fmtPrice(o.tp)}</td>
      <td class="p-2.5 font-mono text-slate-400">${fmtDate(o.setup_time)}</td>
      <td class="p-2.5 font-mono text-slate-400">${o.expiration ? fmtDate(o.expiration) : 'GTC'}</td>
      <td class="p-2.5 text-slate-400 max-w-[160px] truncate" title="${esc(o.comment)}">${esc(o.comment) || '—'}</td></tr>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
// MODALS (owner only)
// ═══════════════════════════════════════════════════════════════
function initModal() {
  $('modal').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
}
function openModal(title, html) {
  $('modalTitle').textContent = title; $('modalBody').innerHTML = html;
  $('modal').classList.remove('hidden'); $('modal').classList.add('flex');
  lucide.createIcons();
  return $('modalBody');
}
function closeModal() { $('modal').classList.add('hidden'); $('modal').classList.remove('flex'); }

async function loadProfiles() {
  const d = await api('/profiles');
  if (!d) return;
  profiles = d.profiles;
  const sel = $('profileFilter');
  sel.innerHTML = '<option value="all">All Profiles</option>' + profiles.map((p) => `<option value="${p.id}">${esc(p.name)} (${p.accounts.length})</option>`).join('');
  if (currentProfile !== 'all' && !profiles.some((p) => String(p.id) === String(currentProfile))) { currentProfile = 'all'; localStorage.setItem(PROFILE_KEY, 'all'); }
  sel.value = currentProfile;
}

// ─── EA NAMES ───
async function openEANames(focusMagic) {
  let d;
  try { d = await request('/ea-names'); } catch (e) { if (!(e instanceof AuthError)) toast(e.message, 'error'); return; }
  const names = [...new Set(d.names.filter((n) => !n.is_default).map((n) => n.ea_name))];
  $('eaNameOptions').innerHTML = names.map((n) => `<option value="${esc(n)}"></option>`).join('');
  const rows = d.names.map((n) => `
    <form class="ea-row flex flex-wrap items-center gap-2 p-2.5 rounded-xl border border-white/5 bg-slate-900/40 ${n.magic_number === focusMagic ? 'row-focus' : ''}" data-magic="${n.magic_number}" data-testid="ea-name-row-${n.magic_number}">
      <span class="font-mono text-xs text-slate-400 w-24 shrink-0">#${n.magic_number}</span>
      <input name="name" class="field flex-1 min-w-[160px] h-9" list="eaNameOptions" placeholder="EA #${n.magic_number}" value="${n.is_default ? '' : esc(n.ea_name)}" data-testid="ea-name-input-${n.magic_number}" />
      <input name="color" type="color" value="${esc(n.color)}" class="h-9 w-10 rounded-lg bg-transparent border border-white/10 cursor-pointer" title="EA colour" data-testid="ea-color-input-${n.magic_number}" />
      <button class="btn-ghost" type="submit" data-testid="ea-name-save-${n.magic_number}"><i data-lucide="check" class="w-3.5 h-3.5"></i>Save</button>
    </form>`).join('');
  const body = openModal('Name your EAs', `
    <p class="text-xs text-slate-400 mb-4">Set a name for each magic number. <span class="text-cyan-300">Give several magic numbers the exact same name to merge them into one EA</span> — their trades, P&amp;L and positions are combined everywhere. Leave empty to reset to the magic number.</p>
    <div class="space-y-2">${rows || '<p class="text-sm text-slate-500">No magic numbers seen yet.</p>'}</div>`);
  body.querySelectorAll('form.ea-row').forEach((f) => f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const magic = f.dataset.magic;
    try {
      const r = await request(`/ea-names/${magic}`, { method: 'PUT', body: { ea_name: f.name.value, color: f.color.value } });
      f.name.value = r.ea_name === `EA #${magic}` ? '' : r.ea_name;
      toast(`Magic #${magic} → ${r.ea_name}`);
      refreshDashboard();
    } catch (err) { if (!(err instanceof AuthError)) toast(err.message, 'error'); }
  }));
  const focused = body.querySelector('.row-focus');
  if (focused) { focused.scrollIntoView({ block: 'center' }); focused.querySelector('input[name=name]').focus(); }
}

// ─── PROFILES ───
async function openProfiles() {
  let known;
  try { [known] = await Promise.all([request('/known-accounts'), loadProfiles()]); } catch (e) { if (!(e instanceof AuthError)) toast(e.message, 'error'); return; }
  const accs = known.accounts;
  const accLabel = (a) => `#${esc(a.account_number)}${a.account_name ? ' • ' + esc(a.account_name) : ''}${a.broker ? ' <span class="text-slate-500">(' + esc(a.broker) + ')</span>' : ''}`;
  const card = (p) => `
    <form class="profile-card p-4 rounded-xl border border-white/5 bg-slate-900/40 space-y-3" data-id="${p.id}" data-testid="profile-card-${p.id}">
      <div class="flex items-center gap-2"><input name="pname" class="field flex-1 h-9" value="${esc(p.name)}" data-testid="profile-name-input-${p.id}" />
        <button type="submit" class="btn-ghost" data-testid="profile-save-${p.id}"><i data-lucide="check" class="w-3.5 h-3.5"></i>Save</button>
        <button type="button" class="btn-ghost btn-danger" data-del="${p.id}" data-testid="profile-delete-${p.id}"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button></div>
      <div class="grid sm:grid-cols-2 gap-1.5">${accs.map((a) => `
        <label class="flex items-center gap-2 text-xs text-slate-300 px-2 py-1.5 rounded-lg hover:bg-white/5 cursor-pointer">
          <input type="checkbox" value="${esc(a.account_number)}" ${p.accounts.includes(String(a.account_number)) ? 'checked' : ''} class="accent-cyan-400" data-testid="profile-${p.id}-account-${esc(a.account_number)}" />
          <span class="w-1.5 h-1.5 rounded-full ${a.online ? 'bg-emerald-400' : 'bg-slate-600'}"></span>${accLabel(a)}</label>`).join('') || '<p class="text-xs text-slate-500">No accounts have connected yet.</p>'}</div>
    </form>`;
  const body = openModal('Profiles', `
    <p class="text-xs text-slate-400 mb-4">Group your MT5 accounts into profiles (e.g. <em>Main</em> for your 5 live accounts, <em>Testing</em> for the test account). Switch profiles from the header. Share links are always locked to a single profile.</p>
    <form id="newProfileForm" class="flex gap-2 mb-5"><input id="newProfileName" class="field flex-1" placeholder="New profile name" data-testid="new-profile-name-input" /><button class="btn-primary" type="submit" data-testid="create-profile-button"><i data-lucide="plus" class="w-4 h-4"></i>Create</button></form>
    <div class="space-y-3">${profiles.map(card).join('') || '<p class="text-sm text-slate-500">No profiles yet.</p>'}</div>`);

  body.querySelector('#newProfileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await request('/profiles', { method: 'POST', body: { name: $('newProfileName').value } }); toast('Profile created'); openProfiles(); }
    catch (err) { if (!(err instanceof AuthError)) toast(err.message, 'error'); }
  });
  body.querySelectorAll('form.profile-card').forEach((f) => {
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const accounts = [...f.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value);
      try { await request(`/profiles/${f.dataset.id}`, { method: 'PUT', body: { name: f.pname.value, accounts } }); toast('Profile saved'); await loadProfiles(); refreshDashboard(); }
      catch (err) { if (!(err instanceof AuthError)) toast(err.message, 'error'); }
    });
    f.querySelector('[data-del]').addEventListener('click', async () => {
      if (!confirm('Delete this profile? All its share links will stop working.')) return;
      try { await request(`/profiles/${f.dataset.id}`, { method: 'DELETE' }); toast('Profile deleted'); await loadProfiles(); openProfiles(); refreshDashboard(); }
      catch (err) { if (!(err instanceof AuthError)) toast(err.message, 'error'); }
    });
  });
}

// ─── SHARE LINKS ───
const shareUrl = (token) => `${location.origin}/?share=${encodeURIComponent(token)}`;
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch (e) { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
  toast('Link copied to clipboard');
}

async function openShare() {
  let shares;
  try { [shares] = await Promise.all([request('/shares'), loadProfiles()]); } catch (e) { if (!(e instanceof AuthError)) toast(e.message, 'error'); return; }
  const preselect = currentProfile !== 'all' ? String(currentProfile) : '';
  const body = openModal('Share a profile', `
    ${profiles.length ? `
    <form id="shareForm" class="space-y-4">
      <div><label class="kpi-label block mb-1.5">Profile to share</label>
        <select id="shareProfile" class="field w-full" data-testid="share-profile-select">${profiles.map((p) => `<option value="${p.id}" ${String(p.id) === preselect ? 'selected' : ''}>${esc(p.name)} (${p.accounts.length} account${p.accounts.length === 1 ? '' : 's'})</option>`).join('')}</select></div>
      <div><label class="kpi-label block mb-1.5">Data visible to your friend</label>
        <div class="grid sm:grid-cols-2 gap-2">
          <label class="flex items-center gap-2 p-3 rounded-xl border border-white/10 bg-slate-900/40 cursor-pointer text-sm"><input type="radio" name="scope" value="all" checked class="accent-cyan-400" data-testid="share-scope-all" />All past data</label>
          <label class="flex items-center gap-2 p-3 rounded-xl border border-white/10 bg-slate-900/40 cursor-pointer text-sm"><input type="radio" name="scope" value="from" class="accent-cyan-400" data-testid="share-scope-from" />Only from a date</label>
        </div>
        <input type="date" id="shareFrom" class="field w-full mt-2 hidden" value="${toYMD(new Date())}" data-testid="share-from-date" /></div>
      <div><label class="kpi-label block mb-1.5">Label (optional)</label><input id="shareLabel" class="field w-full" placeholder="e.g. For Rahul" data-testid="share-label-input" /></div>
      <button class="btn-primary w-full" type="submit" data-testid="generate-share-link-button"><i data-lucide="link" class="w-4 h-4"></i>Generate share link</button>
    </form>
    <div id="shareResult" class="hidden mt-4 p-3 rounded-xl border border-cyan-400/30 bg-cyan-400/5">
      <div class="kpi-label mb-1.5 text-cyan-300">Your read-only link</div>
      <div class="flex gap-2"><input id="shareLinkOutput" readonly class="field flex-1 font-mono text-xs" data-testid="share-link-output" /><button class="btn-primary" id="copyNewLink" type="button" data-testid="copy-share-link-button"><i data-lucide="copy" class="w-4 h-4"></i>Copy</button></div>
      <p class="text-[11px] text-slate-400 mt-2">Your friend only sees this profile's accounts${'<span id="shareResultDate"></span>'}. Removing the token from the URL shows the passcode lock screen.</p>
    </div>` : '<p class="text-sm text-slate-400">Create a profile first (Profiles button in the header), then share it.</p>'}
    <div class="mt-6 pt-5 border-t border-white/5" id="shareList">${shareListHtml(shares.shares)}</div>`);

  const form = body.querySelector('#shareForm');
  if (form) {
    form.querySelectorAll('input[name=scope]').forEach((r) => r.addEventListener('change', () => $('shareFrom').classList.toggle('hidden', form.scope.value !== 'from')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const from = form.scope.value === 'from' ? $('shareFrom').value : null;
      if (form.scope.value === 'from' && !from) return toast('Pick a start date', 'error');
      try {
        const r = await request('/shares', { method: 'POST', body: { profile_id: Number($('shareProfile').value), from_date: from, label: $('shareLabel').value } });
        const url = shareUrl(r.share.token);
        $('shareResult').classList.remove('hidden'); $('shareLinkOutput').value = url;
        $('shareResultDate').textContent = from ? `, starting ${from}` : ', including all past data';
        $('copyNewLink').onclick = () => copyText(url);
        copyText(url);
        reloadShareList();
      } catch (err) { if (!(err instanceof AuthError)) toast(err.message, 'error'); }
    });
  }
  bindShareList(body);
}

function shareListHtml(list) {
  const rows = list.map((s) => `
    <div class="flex flex-wrap items-center gap-2 p-3 rounded-xl border border-white/5 bg-slate-900/40" data-testid="share-row-${s.id}">
      <div class="flex-1 min-w-[180px]"><div class="text-sm font-semibold text-white">${esc(s.profile_name)}${s.label ? ` <span class="text-slate-400 font-normal">• ${esc(s.label)}</span>` : ''}</div>
        <div class="text-[11px] text-slate-500">${s.from_date ? 'Data from ' + esc(s.from_date) : 'All past data'} • created ${esc(String(s.created_at).slice(0, 10))}${s.last_accessed ? ' • last opened ' + esc(String(s.last_accessed).slice(0, 16)) : ' • never opened'}</div></div>
      <button class="btn-ghost" data-copy="${esc(s.token)}" data-testid="share-copy-${s.id}"><i data-lucide="copy" class="w-3.5 h-3.5"></i>Copy</button>
      <button class="btn-ghost btn-danger" data-revoke="${s.id}" data-testid="share-revoke-${s.id}"><i data-lucide="ban" class="w-3.5 h-3.5"></i>Revoke</button>
    </div>`).join('');
  return `<div class="flex items-center justify-between mb-3"><h4 class="font-display font-bold text-white text-sm">Active share links (${list.length})</h4>
      ${list.length ? '<button class="btn-ghost btn-danger" id="revokeAll" data-testid="revoke-all-shares-button"><i data-lucide="shield-off" class="w-3.5 h-3.5"></i>Revoke all</button>' : ''}</div>
    <div class="space-y-2">${rows || '<p class="text-xs text-slate-500">No active links.</p>'}</div>`;
}

async function reloadShareList() {
  const d = await api('/shares');
  const box = $('shareList');
  if (!d || !box) return;
  box.innerHTML = shareListHtml(d.shares);
  lucide.createIcons();
  bindShareList(box);
}

function bindShareList(body) {
  body.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', () => copyText(shareUrl(b.dataset.copy))));
  body.querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Revoke this link? Anyone using it will lose access immediately.')) return;
    try { await request(`/shares/${b.dataset.revoke}`, { method: 'DELETE' }); toast('Link revoked'); reloadShareList(); }
    catch (err) { if (!(err instanceof AuthError)) toast(err.message, 'error'); }
  }));
  const all = body.querySelector('#revokeAll');
  if (all) all.addEventListener('click', async () => {
    if (!confirm('Revoke ALL active share links?')) return;
    try { const r = await request('/shares/revoke-all', { method: 'POST', body: {} }); toast(`${r.revoked} link(s) revoked`); reloadShareList(); }
    catch (err) { if (!(err instanceof AuthError)) toast(err.message, 'error'); }
  });
}
