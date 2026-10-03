// ═══════════════════════════════════════════════════════════════
// MT5 COMMAND CENTER — FUTURISTIC DASHBOARD ENGINE (vanilla JS)
// Calls your REAL /api endpoints. If an endpoint is unreachable
// (e.g. running the file outside your server), it falls back to
// built-in demo data so the UI still renders.
// ═══════════════════════════════════════════════════════════════

let currentAccount = 'all';
let currentMagic = 'all';
let calendarDate = new Date();
let usingMock = false;

// ─── FORMATTERS ───
const formatUSD = (num) => {
  const v = Number(num) || 0;
  return (v >= 0 ? '+$' : '-$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const formatPlainUSD = (num) => '$' + (Number(num) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = (v) => Math.abs(v) >= 1000 ? '$' + (v / 1000).toFixed(1) + 'k' : '$' + v.toFixed(0);
const $ = (id) => document.getElementById(id);

// ─── SAFE FETCH with mock fallback ───
async function api(path) {
  try {
    const res = await fetch('/api' + path, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) throw new Error('bad status');
    const data = await res.json();
    if (data && data.success === false) throw new Error('api false');
    return data;
  } catch (e) {
    usingMock = true;
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// DEMO / MOCK FALLBACK DATA (only used when /api is unreachable)
// ═══════════════════════════════════════════════════════════════
const MOCK_EAS = [
  { magic_number: 10234, ea_name: 'Quantum Scalper', color: '#22d3ee', total_pnl: 18640.25, total_trades: 420, wins: 290, losses: 130, open_pnl: 640.5 },
  { magic_number: 20481, ea_name: 'Momentum Hunter', color: '#a855f7', total_pnl: 12380.0, total_trades: 210, wins: 128, losses: 82, open_pnl: 180.0 },
  { magic_number: 30119, ea_name: 'Grid Master Pro', color: '#34d399', total_pnl: 9240.75, total_trades: 560, wins: 310, losses: 250, open_pnl: -220.0 },
  { magic_number: 40567, ea_name: 'Trend Rider', color: '#fbbf24', total_pnl: 6820.4, total_trades: 150, wins: 95, losses: 55, open_pnl: 420.0 },
  { magic_number: 60342, ea_name: 'Breakout Bot', color: '#60a5fa', total_pnl: 3790.1, total_trades: 90, wins: 52, losses: 38, open_pnl: 300.0 },
  { magic_number: 50823, ea_name: 'Mean Reversion X', color: '#fb7185', total_pnl: -2140.3, total_trades: 180, wins: 70, losses: 110, open_pnl: -160.0 },
];
const MOCK_ACCOUNTS = [
  { account_number: '5017842', account_name: 'Apollo Prime', broker: 'IC Markets', balance: 48250, equity: 49120, today_profit: 870, open_count: 3, floating_pnl: 870 },
  { account_number: '3390127', account_name: 'Vega Challenge', broker: 'FTMO', balance: 100000, equity: 103250, today_profit: 3250, open_count: 5, floating_pnl: 3250 },
  { account_number: '7781005', account_name: 'Helios Fund', broker: 'Pepperstone', balance: 32100, equity: 31640, today_profit: -460, open_count: 2, floating_pnl: -460 },
  { account_number: '2204556', account_name: 'Orion Swing', broker: 'Exness', balance: 15600, equity: 15820, today_profit: 220, open_count: 1, floating_pnl: 220 },
  { account_number: '9918234', account_name: 'Nova Grid', broker: 'Tickmill', balance: 27400, equity: 26980, today_profit: -420, open_count: 4, floating_pnl: -420 },
];
function mockOverview() {
  const eas = filterEAs(MOCK_EAS);
  const accs = filterAccounts(MOCK_ACCOUNTS);
  const wins = eas.reduce((a, e) => a + e.wins, 0), losses = eas.reduce((a, e) => a + e.losses, 0);
  const trades = wins + losses || 1;
  return {
    success: true,
    total_balance: accs.reduce((a, c) => a + c.balance, 0),
    total_equity: accs.reduce((a, c) => a + c.equity, 0),
    total_accounts: accs.length,
    today_pnl: accs.reduce((a, c) => a + c.today_profit, 0),
    floating_pnl: accs.reduce((a, c) => a + c.floating_pnl, 0),
    open_trades_count: accs.reduce((a, c) => a + c.open_count, 0),
    month_pnl: 12840.65,
    total_closed_profit: eas.reduce((a, e) => a + e.total_pnl, 0),
    win_rate: ((wins / trades) * 100).toFixed(1),
    profit_factor: '2.14', total_trades: trades, wins, losses,
  };
}
function mockCurve() {
  const pts = []; const days = 90; const target = MOCK_EAS.reduce((a, e) => a + e.total_pnl, 0);
  let cum = 0, seed = 42; const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const now = Date.now();
  for (let i = days; i >= 0; i--) {
    const t = now - i * 86400000; const p = (days - i) / days;
    cum = Math.max(0, target * (p - Math.pow(p, 1.8) * 0.15) + (rand() - 0.42) * 2600);
    pts.push({ time: t, cumulative_profit: Math.round(cum) });
  }
  pts[pts.length - 1].cumulative_profit = Math.round(target);
  return pts;
}
function mockCalendar(year, month) {
  const dim = new Date(year, month, 0).getDate(); const days = []; let total = 0;
  let seed = year * 100 + month; const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  const today = new Date();
  for (let d = 1; d <= dim; d++) {
    const date = new Date(year, month - 1, d); if (date > today) continue;
    const dow = date.getDay(); if ((dow === 0 || dow === 6) && rand() > 0.15) continue;
    if (rand() < 0.28) continue;
    const prof = rand() > 0.38; const mag = Math.round(rand() * (prof ? 1600 : 950)) + 40;
    const profit = prof ? mag : -mag; const trades = Math.floor(rand() * 18) + 2;
    const wins = prof ? Math.ceil(trades * (0.55 + rand() * 0.3)) : Math.floor(trades * (0.2 + rand() * 0.25));
    total += profit;
    days.push({ date: `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`, profit, trades_count: trades, wins, losses: trades - wins });
  }
  return { success: true, month_total_pnl: total, days };
}
function mockPositions() {
  const syms = ['XAUUSD', 'EURUSD', 'GBPJPY', 'US30', 'NAS100', 'BTCUSD', 'USDJPY', 'AUDUSD'];
  const out = []; let seed = 7; const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  MOCK_ACCOUNTS.forEach((acc) => {
    for (let i = 0; i < acc.open_count; i++) {
      const ea = MOCK_EAS[Math.floor(rand() * MOCK_EAS.length)];
      out.push({ account_number: acc.account_number, ea_name: ea.ea_name, magic_number: ea.magic_number,
        symbol: syms[Math.floor(rand() * syms.length)], trade_type: rand() > 0.5 ? 'BUY' : 'SELL',
        volume: (Math.floor(rand() * 20) / 10 + 0.1).toFixed(2), open_price: (1000 + rand() * 2000).toFixed(2),
        profit: Math.round((rand() - 0.42) * 900 * 100) / 100, swap: Math.round((rand() - 0.5) * 20) / 10 });
    }
  });
  return out;
}
const filterAccounts = (list) => currentAccount === 'all' ? list : list.filter((a) => String(a.account_number) === String(currentAccount));
const filterEAs = (list) => currentMagic === 'all' ? list : list.filter((e) => String(e.magic_number) === String(currentMagic));
const filterPositions = (list) => list.filter((p) => (currentAccount === 'all' || String(p.account_number) === String(currentAccount)) && (currentMagic === 'all' || String(p.magic_number) === String(currentMagic)));

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

// ─── count-up ───
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

// ─── typing headline ───
function typeHeadline(text) {
  const el = $('typed'); if (!el) return; let i = 0;
  const id = setInterval(() => { i++; el.textContent = text.slice(0, i); if (i >= text.length) clearInterval(id); }, 90);
}

// ─── scroll reveal ───
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
  $('accountFilter').addEventListener('change', (e) => { currentAccount = e.target.value; refreshDashboard(); });
  $('magicFilter').addEventListener('change', (e) => { currentMagic = e.target.value; refreshDashboard(); });

  await refreshDashboard(false, true);

  // reveal loader out
  setTimeout(() => $('loader').classList.add('hidden'), 1700);
  setInterval(() => refreshDashboard(), 5000);
});

let firstLoad = true;
async function refreshDashboard(spin = false, initial = false) {
  if (spin) { const ic = $('refreshIcon'); ic.classList.add('spin-once'); setTimeout(() => ic.classList.remove('spin-once'), 700); }
  await Promise.all([fetchAccountsList(), fetchEAList(), fetchOverview(), fetchEquity(), fetchCalendar(), fetchPositions(), fetchLeaderboard()]);
  $('lastUpdated').textContent = new Date().toLocaleTimeString();
  $('dataMode').textContent = usingMock ? 'Demo data (API offline)' : 'Cloud Sync';
  lucide.createIcons();
  firstLoad = false;
}

// 1. OVERVIEW
async function fetchOverview() {
  const d = await api(`/overview?account=${currentAccount}&magic=${currentMagic}`) || mockOverview();
  const set = (id, t) => { const e = $(id); if (e) e.textContent = t; };
  if (firstLoad) {
    animateValue($('totalBalance'), d.total_balance, { decimals: 2, prefix: '$' });
    animateValue($('monthPnl'), d.month_pnl, { decimals: 2, prefix: d.month_pnl >= 0 ? '+$' : '-$' });
    $('monthPnl').textContent; // placeholder
  } else {
    set('totalBalance', formatPlainUSD(d.total_balance));
    set('monthPnl', formatUSD(d.month_pnl));
  }
  set('totalEquity', formatPlainUSD(d.total_equity));
  set('accountCountBadge', `${d.total_accounts} Accs`);
  set('totalClosedPnl', formatUSD(d.total_closed_profit));

  const today = $('todayPnl'); today.textContent = formatUSD(d.today_pnl);
  today.className = `text-2xl font-extrabold tracking-tight font-display ${d.today_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
  const tIcon = $('todayIcon'); tIcon.setAttribute('data-lucide', d.today_pnl >= 0 ? 'trending-up' : 'trending-down');
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

  // hero stats (once)
  if (firstLoad) {
    animateValue($('heroAccounts'), d.total_accounts);
    animateValue($('heroProfit'), d.total_closed_profit, { prefix: '$' });
    animateValue($('heroWin'), Number(d.win_rate), { decimals: 1, suffix: '%' });
  }
  renderDonut(d.wins, d.losses);
}

// 2. ACCOUNTS (+ filter dropdown)
async function fetchAccountsList() {
  const d = await api('/accounts');
  const list = d ? d.accounts : filterAccounts(MOCK_ACCOUNTS);
  const allList = d ? d.accounts : MOCK_ACCOUNTS;
  const sel = $('accountFilter'); const cur = sel.value;
  sel.innerHTML = '<option value="all">All Accounts</option>';
  allList.forEach((a) => { const o = document.createElement('option'); o.value = a.account_number; o.textContent = `${a.account_name || a.broker} • #${a.account_number}`; if (String(o.value) === cur) o.selected = true; sel.appendChild(o); });

  const shown = d ? filterAccounts(list) : list;
  if (firstLoad) animateValue($('heroAccounts'), (d ? allList.length : MOCK_ACCOUNTS.length));
  const grid = $('accountsGrid');
  if (!shown.length) { grid.innerHTML = '<div class="col-span-2 text-center py-6 text-slate-500 text-sm">No MT5 terminals connected yet</div>'; return; }
  grid.innerHTML = shown.map((acc) => {
    const pos = acc.today_profit >= 0; const pct = Math.min(Math.abs(acc.today_profit) / (acc.balance || 1) * 1000, 100);
    return `<div class="tilt-card bg-slate-900/60 border border-white/5 p-4 rounded-xl hover:border-cyan-400/30 transition-all duration-300">
      <div class="flex justify-between items-start mb-2"><div><h3 class="font-bold text-sm text-white">${acc.account_name || 'Account #' + acc.account_number}</h3><p class="text-xs text-slate-400">${acc.broker || 'MT5'} • #${acc.account_number}</p></div><span class="px-2 py-0.5 rounded text-[10px] font-mono ${pos ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}">${acc.open_count} Open</span></div>
      <div class="mt-3 flex justify-between items-baseline"><div><span class="text-[10px] text-slate-500 uppercase block">Balance</span><span class="font-semibold text-sm text-slate-200">${formatPlainUSD(acc.balance)}</span></div><div class="text-right"><span class="text-[10px] text-slate-500 uppercase block">Today</span><span class="font-semibold text-sm ${pos ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(acc.today_profit)}</span></div></div>
      <div class="mt-2 w-full bg-slate-800 rounded-full h-1 overflow-hidden"><div class="h-1 rounded-full" style="width:${pct}%;background:${pos ? 'linear-gradient(90deg,#34d399,#22d3ee)' : 'linear-gradient(90deg,#fb7185,#f59e0b)'}"></div></div>
    </div>`;
  }).join('');
}

// 3. EA LIST (+ filter dropdown + bar chart)
async function fetchEAList() {
  const d = await api('/eas');
  const all = d ? d.eas : MOCK_EAS;
  const sel = $('magicFilter'); const cur = sel.value;
  sel.innerHTML = '<option value="all">All EAs</option>';
  all.forEach((e) => { const o = document.createElement('option'); o.value = e.magic_number; o.textContent = `${e.ea_name} (${e.magic_number})`; if (String(o.value) === cur) o.selected = true; sel.appendChild(o); });
  if (firstLoad) animateValue($('heroEAs'), all.length);
  renderBars(filterEAs(all));
}

function renderBars(eas) {
  const box = $('eaChart'); const max = Math.max(...eas.map((e) => Math.abs(e.total_pnl)), 1);
  const sorted = [...eas].sort((a, b) => b.total_pnl - a.total_pnl);
  box.innerHTML = sorted.map((ea, i) => {
    const pct = (Math.abs(ea.total_pnl) / max) * 100; const pos = ea.total_pnl >= 0;
    return `<div><div class="flex items-center justify-between text-xs mb-1"><span class="font-semibold text-slate-200">${ea.ea_name}</span><span class="font-mono font-bold ${pos ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(ea.total_pnl)}</span></div>
      <div class="h-2.5 w-full rounded-full bg-slate-800/60 overflow-hidden"><div class="h-full rounded-full eq-bar" data-w="${pct}" style="transition-delay:${i * 90}ms;background:${pos ? 'linear-gradient(90deg,#22d3ee,#34d399)' : 'linear-gradient(90deg,#fb7185,#f59e0b)'};box-shadow:${pos ? '0 0 12px rgba(34,211,238,0.4)' : '0 0 12px rgba(251,113,133,0.4)'}"></div></div></div>`;
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

// 4. EQUITY CURVE (custom SVG)
async function fetchEquity() {
  const d = await api(`/charts/equity-curve?account=${currentAccount}&magic=${currentMagic}`);
  const curve = d ? d.curve : mockCurve();
  renderEquity(curve);
}
function renderEquity(curve) {
  const box = $('equityChart'); if (!curve || !curve.length) { box.innerHTML = ''; return; }
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

// 5. CALENDAR
async function fetchCalendar() {
  const year = calendarDate.getFullYear(), month = calendarDate.getMonth() + 1;
  const d = await api(`/calendar?year=${year}&month=${month}&account=${currentAccount}&magic=${currentMagic}`) || mockCalendar(year, month);
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
      grid.innerHTML += `<div class="h-20 p-2 rounded-xl border transition-all duration-300 hover:scale-[1.06] flex flex-col justify-between ${pos ? 'bg-emerald-950/30 border-emerald-500/25 hover:border-emerald-400/50' : 'bg-rose-950/30 border-rose-500/25 hover:border-rose-400/50'} ${isToday ? 'ring-2 ring-cyan-400/60' : ''}"><div class="flex justify-between items-center"><span class="text-xs font-bold ${isToday ? 'text-cyan-400' : 'text-slate-400'}">${day}</span><span class="text-[9px] px-1.5 py-0.5 rounded-full font-mono ${pos ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}">${dd.wins}W ${dd.losses}L</span></div><div class="text-right"><span class="text-xs sm:text-sm font-extrabold block ${pos ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(dd.profit)}</span><span class="text-[9px] text-slate-500">${dd.trades_count}t</span></div></div>`;
    } else {
      grid.innerHTML += `<div class="h-20 p-2 rounded-xl bg-slate-900/25 border border-white/5 flex flex-col justify-between ${isToday ? 'ring-2 ring-cyan-400/60' : ''}"><span class="text-xs ${isToday ? 'text-cyan-400 font-bold' : 'text-slate-600'}">${day}</span><span class="text-[11px] text-slate-700 text-right">—</span></div>`;
    }
  }
}
function changeMonth(delta) { calendarDate.setMonth(calendarDate.getMonth() + delta); fetchCalendar(); }

// 6. OPEN POSITIONS
async function fetchPositions() {
  const d = await api(`/open-positions?account=${currentAccount}&magic=${currentMagic}`);
  const positions = d ? d.positions : filterPositions(mockPositions());
  $('liveOpenBadge').textContent = `${positions.length} Active`;
  const tb = $('openPositionsTable');
  if (!positions.length) { tb.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-slate-600">No active floating positions</td></tr>'; return; }
  tb.innerHTML = positions.map((p) => {
    const net = p.profit + p.swap;
    return `<tr class="hover:bg-white/5 transition-colors"><td class="p-2.5"><span class="font-semibold text-white">${p.ea_name}</span><br><span class="text-[10px] text-slate-500">#${p.account_number}</span></td><td class="p-2.5 font-bold text-slate-200">${p.symbol}</td><td class="p-2.5"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${p.trade_type === 'BUY' ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/25' : 'bg-amber-500/15 text-amber-400 border border-amber-500/25'}">${p.trade_type}</span></td><td class="p-2.5 font-mono text-slate-300">${p.volume}</td><td class="p-2.5 font-mono text-slate-300">${p.open_price}</td><td class="p-2.5 text-right font-mono font-bold ${net >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(net)}</td></tr>`;
  }).join('');
}

// 7. LEADERBOARD
async function fetchLeaderboard() {
  const d = await api('/eas');
  const eas = filterEAs(d ? d.eas : MOCK_EAS);
  const tb = $('eaLeaderboardBody');
  if (!eas.length) { tb.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-slate-600">No EA data available yet</td></tr>'; return; }
  const sorted = [...eas].sort((a, b) => b.total_pnl - a.total_pnl); const medal = ['🥇', '🥈', '🥉'];
  tb.innerHTML = sorted.map((ea, i) => {
    const wr = ea.total_trades > 0 ? ((ea.wins / ea.total_trades) * 100).toFixed(1) : '0.0';
    const avg = ea.total_trades > 0 ? ea.total_pnl / ea.total_trades : 0; const pos = ea.total_pnl >= 0;
    return `<tr class="hover:bg-white/5 transition-colors"><td class="p-3 text-center text-base">${i < 3 ? medal[i] : '<span class="text-slate-500 font-mono text-sm">#' + (i + 1) + '</span>'}</td>
      <td class="p-3"><div class="flex items-center gap-3"><span class="w-3 h-3 rounded-full" style="background:${ea.color};box-shadow:0 0 10px ${ea.color}88"></span><div><span class="font-bold text-white text-sm">${ea.ea_name}</span><br><span class="text-[10px] text-slate-500 font-mono">Magic: ${ea.magic_number}</span></div></div></td>
      <td class="p-3 text-right font-mono font-bold ${pos ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(ea.total_pnl)}</td>
      <td class="p-3 text-center font-mono text-slate-300">${ea.total_trades}</td>
      <td class="p-3 text-center"><span class="text-emerald-400 font-semibold">${ea.wins}</span><span class="text-slate-600 mx-1">/</span><span class="text-rose-400 font-semibold">${ea.losses}</span></td>
      <td class="p-3"><div class="flex items-center justify-center gap-2"><div class="w-16 bg-slate-800 rounded-full h-2 overflow-hidden"><div class="h-2 rounded-full" style="width:${wr}%;background:${Number(wr) >= 50 ? 'linear-gradient(90deg,#34d399,#22d3ee)' : 'linear-gradient(90deg,#fb7185,#f59e0b)'}"></div></div><span class="text-xs font-bold ${Number(wr) >= 50 ? 'text-emerald-400' : 'text-rose-400'}">${wr}%</span></div></td>
      <td class="p-3 text-right font-mono text-xs ${avg >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(avg)}</td>
      <td class="p-3 text-right font-mono text-xs ${ea.open_pnl >= 0 ? 'text-cyan-400' : 'text-rose-400'}">${formatUSD(ea.open_pnl)}</td></tr>`;
  }).join('');
}
