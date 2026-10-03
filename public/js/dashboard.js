// ═══════════════════════════════════════════════════════════════
// MT5 COMMAND CENTER - ENHANCED DASHBOARD ENGINE v3
// Richer visuals • animated counters • redesigned growth curve
// Falls back to live demo data when the /api backend is offline.
// ═══════════════════════════════════════════════════════════════

let currentAccount = 'all';
let currentMagic = 'all';
let currentRange = 'ALL';
let calendarDate = new Date();
let equityChart = null;
let eaChart = null;
let winLossChart = null;
let fullCurve = [];          // unfiltered curve data [[ts, cumulative], ...]
let usingDemo = false;

// ─── FORMATTERS ───
const formatUSD = (num) => {
    const val = Number(num) || 0;
    const sign = val >= 0 ? '+$' : '-$';
    return sign + Math.abs(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const formatPlainUSD = (num) => {
    const val = Number(num) || 0;
    return '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const compactUSD = (val) => {
    const a = Math.abs(val);
    if (a >= 1000) return (val < 0 ? '-$' : '$') + (a / 1000).toFixed(1) + 'k';
    return (val < 0 ? '-$' : '$') + a.toFixed(0);
};

// ─── ANIMATED NUMBER COUNTER ───
function animateValue(el, to, render) {
    if (!el) return;
    const from = Number(el.dataset.val || 0);
    if (from === to) { el.textContent = render(to); return; }
    el.dataset.val = to;
    const start = performance.now();
    const dur = 650;
    const step = (now) => {
        const t = Math.min((now - start) / dur, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = render(from + (to - from) * eased);
        if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

// ─── SAFE FETCH (returns null on any failure) ───
async function safeFetch(url) {
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();
        return (data && data.success !== false) ? data : null;
    } catch (e) {
        return null;
    }
}

// ═══════════════════════════════════════════════
// DEMO DATA (keeps the dashboard alive without a backend)
// ═══════════════════════════════════════════════
const DEMO_EAS = [
    { magic_number: 1111, ea_name: 'Gold Sniper EA', color: '#f59e0b' },
    { magic_number: 2222, ea_name: 'EURUSD Scalper', color: '#22d3ee' },
    { magic_number: 3333, ea_name: 'Grid Master PRO', color: '#10b981' },
    { magic_number: 4444, ea_name: 'London Breakout', color: '#8b5cf6' },
    { magic_number: 5555, ea_name: 'Trend Rider X', color: '#f43f5e' },
];
let _demoCache = null;
function buildDemo() {
    if (_demoCache) return _demoCache;
    const now = Date.now();
    const DAY = 86400000;
    // 90 days of trades building a cumulative curve
    const curve = [];
    const dayMap = {};
    const eaAgg = {};
    DEMO_EAS.forEach(e => eaAgg[e.magic_number] = { ...e, total_pnl: 0, wins: 0, losses: 0, total_trades: 0, open_pnl: 0 });
    let cum = 0, wins = 0, losses = 0;
    let rnd = 42;
    const rand = () => { rnd = (rnd * 9301 + 49297) % 233280; return rnd / 233280; };
    for (let d = 90; d >= 0; d--) {
        const dayTs = now - d * DAY;
        const dateStr = new Date(dayTs).toISOString().slice(0, 10);
        const tradesToday = 1 + Math.floor(rand() * 5);
        let dayProfit = 0, dw = 0, dl = 0;
        for (let k = 0; k < tradesToday; k++) {
            const ea = DEMO_EAS[Math.floor(rand() * DEMO_EAS.length)];
            const win = rand() > 0.42;
            const pnl = win ? (20 + rand() * 180) : -(15 + rand() * 120);
            cum += pnl; dayProfit += pnl;
            if (win) { wins++; dw++; eaAgg[ea.magic_number].wins++; }
            else { losses++; dl++; eaAgg[ea.magic_number].losses++; }
            eaAgg[ea.magic_number].total_pnl += pnl;
            eaAgg[ea.magic_number].total_trades++;
            const ts = dayTs + Math.floor(rand() * DAY);
            curve.push({ time: new Date(ts).toISOString(), cumulative_profit: Number(cum.toFixed(2)) });
        }
        dayMap[dateStr] = { date: dateStr, profit: Number(dayProfit.toFixed(2)), trades_count: tradesToday, wins: dw, losses: dl };
    }
    curve.sort((a, b) => new Date(a.time) - new Date(b.time));
    const eas = Object.values(eaAgg).map(e => {
        e.open_pnl = Number(((rand() - 0.4) * 300).toFixed(2));
        e.total_pnl = Number(e.total_pnl.toFixed(2));
        return e;
    });
    const total = wins + losses;
    const grossP = eas.reduce((s, e) => s + Math.max(e.total_pnl, 0), 0);
    const openPositions = [
        { ea_name: 'Gold Sniper EA', account_number: '1001', symbol: 'XAUUSD', trade_type: 'BUY', volume: 0.25, open_price: 2648.40, profit: 128.5, swap: -2.1 },
        { ea_name: 'EURUSD Scalper', account_number: '1002', symbol: 'EURUSD', trade_type: 'SELL', volume: 1.0, open_price: 1.0872, profit: -43.2, swap: 0 },
        { ea_name: 'Trend Rider X', account_number: '1003', symbol: 'GBPUSD', trade_type: 'BUY', volume: 0.5, open_price: 1.2691, profit: 76.9, swap: -1.4 },
        { ea_name: 'Grid Master PRO', account_number: '1003', symbol: 'US30', trade_type: 'BUY', volume: 0.1, open_price: 42180, profit: 212.0, swap: 0 },
    ];
    const accounts = [
        { account_number: '1001', account_name: 'Scalp Account', broker: 'IC Markets', balance: 5420.5, today_profit: 142.3, floating_pnl: 126.4, open_count: 1 },
        { account_number: '1002', account_name: 'Swing Account', broker: 'FTMO', balance: 102500, today_profit: -210.5, floating_pnl: -43.2, open_count: 1 },
        { account_number: '1003', account_name: 'Gold Bot Acc', broker: 'Exness', balance: 12340, today_profit: 318.7, floating_pnl: 288.9, open_count: 2 },
    ];
    _demoCache = {
        curve, dayMap, eas, openPositions, accounts,
        overview: {
            total_accounts: accounts.length,
            total_balance: accounts.reduce((s, a) => s + a.balance, 0),
            total_equity: accounts.reduce((s, a) => s + a.balance + a.floating_pnl, 0),
            floating_pnl: openPositions.reduce((s, p) => s + p.profit + p.swap, 0),
            open_trades_count: openPositions.length,
            today_pnl: accounts.reduce((s, a) => s + a.today_profit, 0),
            month_pnl: Number((cum * 0.35).toFixed(2)),
            total_closed_profit: Number(cum.toFixed(2)),
            win_rate: total ? Number(((wins / total) * 100).toFixed(1)) : 0,
            profit_factor: '1.74',
            total_trades: total, wins, losses
        }
    };
    return _demoCache;
}

// ─── INIT ───
document.addEventListener('DOMContentLoaded', async () => {
    lucide.createIcons();
    initFilters();
    initRangeTabs();
    initCharts();
    await refreshDashboard();
    setInterval(refreshDashboard, 5000);
});

function initFilters() {
    document.getElementById('accountFilter').addEventListener('change', (e) => {
        currentAccount = e.target.value; refreshDashboard();
    });
    document.getElementById('magicFilter').addEventListener('change', (e) => {
        currentMagic = e.target.value; refreshDashboard();
    });
}

function initRangeTabs() {
    document.querySelectorAll('.eq-range').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.eq-range').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentRange = btn.dataset.range;
            renderEquity();
        });
    });
}

// ─── MASTER REFRESH ───
async function refreshDashboard(manual = false) {
    if (manual) {
        const b = document.getElementById('refreshBtn');
        if (b) { b.classList.add('spin'); setTimeout(() => b.classList.remove('spin'), 800); }
    }
    try {
        await Promise.all([
            fetchOverview(), fetchAccountsList(), fetchEAList(),
            fetchEquityChart(), fetchCalendarData(), fetchOpenPositions(), fetchEALeaderboard()
        ]);
        document.getElementById('lastUpdated').textContent =
            (usingDemo ? 'Demo • ' : '') + new Date().toLocaleTimeString();
        const sync = document.getElementById('syncStatus');
        if (sync) sync.textContent = usingDemo ? 'Demo Preview Mode' : 'Cloud Sync Active';
        lucide.createIcons();
    } catch (err) {
        console.error('Dashboard refresh error:', err);
    }
}

// ═══════════════════════════════════════════════
// 1. OVERVIEW KPI CARDS
// ═══════════════════════════════════════════════
async function fetchOverview() {
    let data = await safeFetch(`/api/overview?account=${currentAccount}&magic=${currentMagic}`);
    if (!data || !data.total_accounts) { usingDemo = true; data = buildDemo().overview; }

    animateValue(document.getElementById('totalBalance'), data.total_balance, formatPlainUSD);
    animateValue(document.getElementById('totalEquity'), data.total_equity, formatPlainUSD);
    document.getElementById('accountCountBadge').textContent = `${data.total_accounts} Accs`;

    const todayEl = document.getElementById('todayPnl');
    animateValue(todayEl, data.today_pnl, formatUSD);
    todayEl.className = `text-2xl font-extrabold count mono ${data.today_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
    const todayCard = document.getElementById('todayCard');
    todayCard.className = `glass-panel lift p-5 rounded-2xl ${data.today_pnl >= 0 ? 'glow-green' : 'glow-red'}`;

    const floatEl = document.getElementById('floatingPnl');
    floatEl.textContent = formatUSD(data.floating_pnl);
    floatEl.className = `font-semibold mono ${data.floating_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
    document.getElementById('openCount').textContent = data.open_trades_count;

    const monthEl = document.getElementById('monthPnl');
    animateValue(monthEl, data.month_pnl, formatUSD);
    monthEl.className = `text-2xl font-extrabold count mono ${data.month_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
    document.getElementById('totalClosedPnl').textContent = formatUSD(data.total_closed_profit);

    animateValue(document.getElementById('winRate'), data.win_rate, (v) => v.toFixed(1) + '%');
    document.getElementById('profitFactor').textContent = data.profit_factor;
    document.getElementById('totalTradesCount').textContent = `${data.total_trades} (${data.wins}W / ${data.losses}L)`;

    if (winLossChart) winLossChart.updateSeries([data.wins || 0, data.losses || 0]);
}

// ═══════════════════════════════════════════════
// 2. ACCOUNTS
// ═══════════════════════════════════════════════
async function fetchAccountsList() {
    let data = await safeFetch('/api/accounts');
    if (!data || !data.accounts || data.accounts.length === 0) { data = { accounts: buildDemo().accounts }; }

    const select = document.getElementById('accountFilter');
    const grid = document.getElementById('accountsGrid');
    const currentSelected = select.value;

    select.innerHTML = '<option value="all">All Accounts</option>';
    data.accounts.forEach(acc => {
        const opt = document.createElement('option');
        opt.value = acc.account_number;
        opt.textContent = `${acc.account_number} - ${acc.account_name || acc.broker}`;
        if (opt.value === currentSelected) opt.selected = true;
        select.appendChild(opt);
    });

    if (data.accounts.length === 0) {
        grid.innerHTML = '<div class="col-span-2 text-center py-6 text-gray-500 text-sm">No MT5 terminals connected yet</div>';
        return;
    }

    grid.innerHTML = data.accounts.map((acc, i) => `
        <div class="reveal d${Math.min(i + 1, 8)} bg-slate-900/70 border border-white/8 p-4 rounded-xl hover:border-cyan-500/40 transition-all duration-300 hover:shadow-lg hover:shadow-cyan-500/10 hover:-translate-y-1" data-testid="account-card">
            <div class="flex justify-between items-start mb-2">
                <div>
                    <h3 class="font-bold text-sm text-white">${acc.account_name || 'Account #' + acc.account_number}</h3>
                    <p class="text-xs text-gray-400">${acc.broker || 'MT5'} • #${acc.account_number}</p>
                </div>
                <span class="px-2 py-0.5 rounded text-[10px] mono ${acc.floating_pnl >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}">
                    ${acc.open_count} Open
                </span>
            </div>
            <div class="mt-3 flex justify-between items-baseline">
                <div>
                    <span class="text-[10px] text-gray-500 uppercase block">Balance</span>
                    <span class="font-semibold text-sm text-gray-200 mono">${formatPlainUSD(acc.balance)}</span>
                </div>
                <div class="text-right">
                    <span class="text-[10px] text-gray-500 uppercase block">Today</span>
                    <span class="font-semibold text-sm mono ${acc.today_profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(acc.today_profit)}</span>
                </div>
            </div>
            <div class="mt-2 w-full bg-slate-800 rounded-full h-1 overflow-hidden">
                <div class="h-1 rounded-full transition-all duration-700 ${acc.today_profit >= 0 ? 'bg-gradient-to-r from-emerald-500 to-cyan-400' : 'bg-gradient-to-r from-rose-500 to-orange-400'}" style="width: ${Math.min(Math.abs(acc.today_profit) / (acc.balance || 1) * 1000, 100)}%"></div>
            </div>
        </div>
    `).join('');
}

// ═══════════════════════════════════════════════
// 3. EA LIST & BAR CHART
// ═══════════════════════════════════════════════
async function fetchEAList() {
    let data = await safeFetch('/api/eas');
    if (!data || !data.eas || data.eas.length === 0) { data = { eas: buildDemo().eas }; }

    const select = document.getElementById('magicFilter');
    const currentSelected = select.value;
    select.innerHTML = '<option value="all">All EAs</option>';
    data.eas.forEach(ea => {
        const opt = document.createElement('option');
        opt.value = ea.magic_number;
        opt.textContent = `${ea.ea_name} (Magic: ${ea.magic_number})`;
        if (String(opt.value) === String(currentSelected)) opt.selected = true;
        select.appendChild(opt);
    });

    if (eaChart && data.eas.length > 0) {
        const sorted = [...data.eas].sort((a, b) => b.total_pnl - a.total_pnl);
        const categories = sorted.map(e => e.ea_name);
        const seriesData = sorted.map(e => Number(Number(e.total_pnl).toFixed(2)));
        const colors = seriesData.map(v => v >= 0 ? '#22d3ee' : '#f43f5e');
        eaChart.updateOptions({ series: [{ name: 'Net P&L', data: seriesData }], xaxis: { categories }, colors });
    }
}

// ═══════════════════════════════════════════════
// 4. INITIALIZE CHARTS
// ═══════════════════════════════════════════════
function initCharts() {

    // ── 4.1 CUMULATIVE GROWTH CURVE ──
    equityChart = new ApexCharts(document.querySelector("#equityChart"), {
        chart: {
            type: 'area', height: 420, background: 'transparent', fontFamily: 'Inter, sans-serif',
            toolbar: { show: true, tools: { download: true, selection: true, zoom: true, zoomin: true, zoomout: true, pan: true, reset: true }, autoSelected: 'zoom' },
            zoom: { enabled: true, type: 'x', autoScaleYaxis: true },
            animations: { enabled: true, easing: 'easeinout', speed: 1300, animateGradually: { enabled: true, delay: 150 }, dynamicAnimation: { enabled: true, speed: 500 } },
            dropShadow: { enabled: true, top: 2, left: 0, blur: 18, opacity: 0.4, color: '#22d3ee' },
            events: { mounted: () => addPulse(), updated: () => addPulse() }
        },
        theme: { mode: 'dark' },
        stroke: { curve: 'smooth', width: 3.5, lineCap: 'round' },
        colors: ['#22d3ee'],
        fill: {
            type: 'gradient',
            gradient: {
                shadeIntensity: 1, type: 'vertical', opacityFrom: 0.55, opacityTo: 0, stops: [0, 60, 100],
                colorStops: [
                    { offset: 0, color: '#22d3ee', opacity: 0.45 },
                    { offset: 45, color: '#8b5cf6', opacity: 0.18 },
                    { offset: 100, color: '#8b5cf6', opacity: 0 }
                ]
            }
        },
        markers: { size: 0, colors: ['#22d3ee'], strokeColors: '#0b1220', strokeWidth: 3, hover: { size: 7, sizeOffset: 3 }, discrete: [] },
        dataLabels: { enabled: false },
        grid: { show: true, borderColor: 'rgba(148,163,184,0.1)', strokeDashArray: 5, xaxis: { lines: { show: false } }, yaxis: { lines: { show: true } }, padding: { top: 10, right: 12, bottom: 5, left: 12 } },
        xaxis: {
            type: 'datetime',
            labels: { style: { colors: '#64748b', fontSize: '11px', fontWeight: 500 }, datetimeUTC: false },
            axisBorder: { show: false }, axisTicks: { show: false },
            crosshairs: { show: true, width: 1, position: 'back', stroke: { color: '#22d3ee', width: 1, dashArray: 3 } }
        },
        yaxis: {
            labels: { style: { colors: '#64748b', fontSize: '11px', fontWeight: 500 }, formatter: (v) => compactUSD(v), offsetX: -5 },
            crosshairs: { show: true, stroke: { color: '#475569', width: 1, dashArray: 4 } }
        },
        tooltip: {
            enabled: true, theme: 'dark', custom: equityTooltip
        },
        annotations: {
            yaxis: [{ y: 0, borderColor: '#334155', strokeDashArray: 4, label: { text: 'Break Even', position: 'left', style: { color: '#64748b', background: '#1e293b', fontSize: '10px', fontWeight: 600, padding: { left: 8, right: 8, top: 3, bottom: 3 } } } }]
        },
        series: [{ name: 'Cumulative Profit', data: [] }]
    });
    equityChart.render();

    // ── 4.2 EA HORIZONTAL BAR ──
    eaChart = new ApexCharts(document.querySelector("#eaChart"), {
        chart: { type: 'bar', height: 300, background: 'transparent', fontFamily: 'Inter, sans-serif', toolbar: { show: false }, animations: { enabled: true, easing: 'easeinout', speed: 900, animateGradually: { enabled: true, delay: 120 } } },
        theme: { mode: 'dark' },
        plotOptions: { bar: { borderRadius: 7, horizontal: true, distributed: true, barHeight: '62%', dataLabels: { position: 'top' } } },
        legend: { show: false },
        dataLabels: { enabled: true, textAnchor: 'start', formatter: (val) => formatUSD(val), offsetX: 6, style: { fontSize: '11px', fontWeight: 700, colors: ['#e2e8f0'] }, dropShadow: { enabled: true, top: 1, left: 1, blur: 2, opacity: 0.5 } },
        grid: { borderColor: 'rgba(148,163,184,0.08)', strokeDashArray: 4, xaxis: { lines: { show: true } } },
        xaxis: { labels: { style: { colors: '#64748b' }, formatter: (val) => compactUSD(val) }, axisBorder: { show: false } },
        yaxis: { labels: { style: { colors: '#cbd5e1', fontSize: '12px', fontWeight: 600 } } },
        tooltip: { theme: 'dark', y: { formatter: (val) => formatUSD(val) } },
        series: [{ name: 'Profit', data: [] }]
    });
    eaChart.render();

    // ── 4.3 WIN/LOSS DONUT ──
    winLossChart = new ApexCharts(document.querySelector("#winLossChart"), {
        chart: { type: 'donut', height: 300, background: 'transparent', fontFamily: 'Inter, sans-serif', animations: { enabled: true, easing: 'easeinout', speed: 1100, animateGradually: { enabled: true, delay: 180 } }, dropShadow: { enabled: true, top: 4, left: 0, blur: 14, opacity: 0.2, color: '#22d3ee' } },
        theme: { mode: 'dark' },
        labels: ['Winning Trades', 'Losing Trades'],
        colors: ['#22d3ee', '#f43f5e'],
        plotOptions: {
            pie: {
                donut: {
                    size: '74%',
                    labels: {
                        show: true,
                        name: { show: true, fontSize: '13px', fontWeight: 600, color: '#e2e8f0' },
                        value: { show: true, fontSize: '22px', fontWeight: 800, color: '#ffffff', formatter: (val) => val + ' trades' },
                        total: { show: true, label: 'Win Rate', fontSize: '12px', fontWeight: 500, color: '#94a3b8', formatter: (w) => { const total = w.globals.seriesTotals.reduce((a, b) => a + b, 0); const wins = w.globals.seriesTotals[0] || 0; return total > 0 ? ((wins / total) * 100).toFixed(1) + '%' : '0%'; } }
                    }
                },
                expandOnClick: true
            }
        },
        stroke: { width: 3, colors: ['#0b0f19'] },
        dataLabels: { enabled: false },
        legend: { position: 'bottom', labels: { colors: '#94a3b8' }, fontSize: '12px', fontWeight: 600, markers: { width: 10, height: 10, radius: 3 } },
        tooltip: { theme: 'dark', y: { formatter: (val) => val + ' trades' } },
        series: [0, 0]
    });
    winLossChart.render();
}

// Glass tooltip for equity chart
function equityTooltip({ series, seriesIndex, dataPointIndex, w }) {
    const value = series[seriesIndex][dataPointIndex];
    const timestamp = w.globals.seriesX[seriesIndex][dataPointIndex];
    const date = new Date(timestamp);
    const dateStr = date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
    const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const isProfit = value >= 0;
    const color = isProfit ? '#22d3ee' : '#f43f5e';
    const bg = isProfit ? 'rgba(34,211,238,0.1)' : 'rgba(244,63,94,0.1)';
    const border = isProfit ? 'rgba(34,211,238,0.35)' : 'rgba(244,63,94,0.35)';
    const arrow = isProfit ? '▲' : '▼';
    return `
        <div style="background:rgba(11,18,32,0.92); backdrop-filter:blur(10px); border:1px solid ${border}; border-radius:14px; padding:12px 16px; box-shadow:0 10px 40px rgba(0,0,0,0.5), 0 0 24px ${border};">
            <div style="font-size:11px; color:#64748b; margin-bottom:7px; font-weight:500;">${dateStr} • ${timeStr}</div>
            <div style="background:${bg}; border-radius:9px; padding:8px 12px; display:flex; align-items:center; gap:9px;">
                <span style="font-size:15px; color:${color};">${arrow}</span>
                <div>
                    <div style="font-size:10px; color:#94a3b8; text-transform:uppercase; letter-spacing:1px; font-weight:600;">Cumulative P&L</div>
                    <div style="font-size:19px; font-weight:800; color:${color}; letter-spacing:-0.5px; font-family:'JetBrains Mono',monospace;">${formatUSD(value)}</div>
                </div>
            </div>
        </div>`;
}

// Animated pulsing ring on the latest (current) data point
function addPulse() {
    try {
        const svg = document.querySelector('#equityChart .apexcharts-svg');
        if (!svg) return;
        svg.querySelectorAll('.eq-live-pulse').forEach(n => n.remove());
        const markers = document.querySelectorAll('#equityChart .apexcharts-series circle.apexcharts-marker');
        if (!markers.length) return;
        let target = null, maxCx = -Infinity;
        markers.forEach(m => { const cx = parseFloat(m.getAttribute('cx')); if (cx > maxCx) { maxCx = cx; target = m; } });
        if (!target) return;
        const cx = target.getAttribute('cx'), cy = target.getAttribute('cy');
        const fill = target.getAttribute('fill') || '#22d3ee';
        const ns = 'http://www.w3.org/2000/svg';
        const g = document.createElementNS(ns, 'g');
        g.setAttribute('class', 'eq-live-pulse');
        const ring = document.createElementNS(ns, 'circle');
        ring.setAttribute('cx', cx); ring.setAttribute('cy', cy); ring.setAttribute('r', 5);
        ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', fill); ring.setAttribute('stroke-width', '2');
        ring.innerHTML = `
            <animate attributeName="r" from="5" to="20" dur="1.6s" repeatCount="indefinite"/>
            <animate attributeName="opacity" from="0.8" to="0" dur="1.6s" repeatCount="indefinite"/>`;
        const core = document.createElementNS(ns, 'circle');
        core.setAttribute('cx', cx); core.setAttribute('cy', cy); core.setAttribute('r', 4.5);
        core.setAttribute('fill', fill);
        core.setAttribute('filter', 'drop-shadow(0 0 6px ' + fill + ')');
        g.appendChild(ring); g.appendChild(core);
        target.parentNode.appendChild(g);
    } catch (e) { /* non-fatal */ }
}

// ═══════════════════════════════════════════════
// 5. EQUITY CURVE DATA + RANGE FILTER + STAT BADGES
// ═══════════════════════════════════════════════
async function fetchEquityChart() {
    let data = await safeFetch(`/api/charts/equity-curve?account=${currentAccount}&magic=${currentMagic}`);
    if (!data || !data.curve || data.curve.length === 0) { data = { curve: buildDemo().curve }; }
    fullCurve = data.curve.map(pt => [new Date(pt.time).getTime(), pt.cumulative_profit]);
    renderEquity();
}

function filterByRange(curve) {
    if (currentRange === 'ALL' || curve.length === 0) return curve;
    const spanDays = { '1W': 7, '1M': 30, '3M': 90 }[currentRange] || 99999;
    const cutoff = curve[curve.length - 1][0] - spanDays * 86400000;
    const filtered = curve.filter(p => p[0] >= cutoff);
    return filtered.length > 1 ? filtered : curve;
}

function renderEquity() {
    if (!equityChart) return;
    const seriesData = filterByRange(fullCurve);
    const empty = document.getElementById('equityEmpty');
    if (empty) empty.classList.toggle('hidden', seriesData.length > 0);

    const lastValue = seriesData.length ? seriesData[seriesData.length - 1][1] : 0;
    const isPositive = lastValue >= 0;
    const lineColor = isPositive ? '#22d3ee' : '#f43f5e';

    // peak / valley / drawdown
    let peakIdx = 0, valleyIdx = 0, runMax = -Infinity, maxDD = 0;
    seriesData.forEach((pt, i) => {
        if (pt[1] > seriesData[peakIdx][1]) peakIdx = i;
        if (pt[1] < seriesData[valleyIdx][1]) valleyIdx = i;
        if (pt[1] > runMax) runMax = pt[1];
        const dd = runMax - pt[1];
        if (dd > maxDD) maxDD = dd;
    });
    const peakVal = seriesData.length ? seriesData[peakIdx][1] : 0;
    const valleyVal = seriesData.length ? seriesData[valleyIdx][1] : 0;

    // stat badges
    const bal = buildDemo().overview.total_balance || 100000;
    animateValue(document.getElementById('eqLiveValue'), lastValue, formatUSD);
    document.getElementById('eqLiveValue').className = `text-xl font-extrabold mono ${isPositive ? 'text-cyan-300' : 'text-rose-400'}`;
    const eqNet = document.getElementById('eqNet');
    animateValue(eqNet, lastValue, formatUSD);
    eqNet.className = `mt-1.5 text-lg font-extrabold mono ${isPositive ? 'text-emerald-400' : 'text-rose-400'}`;
    document.getElementById('eqNetSub').textContent = 'ROI ' + ((lastValue / (usingDemo ? bal : 100000)) * 100).toFixed(1) + '%';
    animateValue(document.getElementById('eqPeak'), peakVal, formatUSD);
    animateValue(document.getElementById('eqDrawdown'), -Math.abs(maxDD), formatUSD);
    document.getElementById('eqPoints').textContent = seriesData.length;
    document.getElementById('eqRange').textContent = { '1W': 'Last 7 days', '1M': 'Last 30 days', '3M': 'Last 90 days', 'ALL': 'All time' }[currentRange];

    const gradientStops = isPositive
        ? [{ offset: 0, color: '#22d3ee', opacity: 0.45 }, { offset: 45, color: '#8b5cf6', opacity: 0.18 }, { offset: 100, color: '#8b5cf6', opacity: 0 }]
        : [{ offset: 0, color: '#f43f5e', opacity: 0.45 }, { offset: 45, color: '#fb923c', opacity: 0.15 }, { offset: 100, color: '#ef4444', opacity: 0 }];

    const discrete = [];
    if (seriesData.length > 2) {
        discrete.push({ seriesIndex: 0, dataPointIndex: peakIdx, fillColor: '#10b981', strokeColor: '#0b1220', size: 7 });
        discrete.push({ seriesIndex: 0, dataPointIndex: valleyIdx, fillColor: '#f43f5e', strokeColor: '#0b1220', size: 7 });
        discrete.push({ seriesIndex: 0, dataPointIndex: seriesData.length - 1, fillColor: lineColor, strokeColor: '#0b1220', size: 6 });
    }

    equityChart.updateOptions({
        colors: [lineColor],
        fill: { type: 'gradient', gradient: { shadeIntensity: 1, type: 'vertical', opacityFrom: 0.5, opacityTo: 0, stops: [0, 60, 100], colorStops: gradientStops } },
        markers: { size: 0, colors: [lineColor], strokeColors: '#0b1220', strokeWidth: 3, hover: { size: 7, sizeOffset: 3 }, discrete },
        chart: { dropShadow: { enabled: true, top: 2, left: 0, blur: 18, opacity: 0.4, color: lineColor } },
        annotations: {
            yaxis: [{ y: 0, borderColor: '#334155', strokeDashArray: 5, label: { text: 'Break Even', position: 'left', style: { color: '#64748b', background: '#1e293b', fontSize: '10px', fontWeight: 600, padding: { left: 8, right: 8, top: 3, bottom: 3 } } } }],
            points: seriesData.length > 2 ? [
                { x: seriesData[peakIdx][0], y: peakVal, marker: { size: 0 }, label: { text: `Peak ${compactUSD(peakVal)}`, borderColor: '#10b981', style: { color: '#10b981', background: '#0f2a1e', fontSize: '10px', fontWeight: 700, padding: { left: 7, right: 7, top: 3, bottom: 3 } } } },
                { x: seriesData[valleyIdx][0], y: valleyVal, marker: { size: 0 }, label: { text: `Low ${compactUSD(valleyVal)}`, borderColor: '#f43f5e', style: { color: '#f43f5e', background: '#2a0f17', fontSize: '10px', fontWeight: 700, padding: { left: 7, right: 7, top: 3, bottom: 3 } } } }
            ] : []
        }
    }, false, false);
    equityChart.updateSeries([{ name: 'Cumulative Profit', data: seriesData }]);
    setTimeout(addPulse, 650);
}

// ═══════════════════════════════════════════════
// 6. CALENDAR
// ═══════════════════════════════════════════════
async function fetchCalendarData() {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth() + 1;

    let data = await safeFetch(`/api/calendar?year=${year}&month=${month}&account=${currentAccount}&magic=${currentMagic}`);
    if (!data || !data.days) {
        const dm = buildDemo().dayMap;
        const prefix = `${year}-${String(month).padStart(2, '0')}`;
        const days = Object.values(dm).filter(d => d.date.startsWith(prefix));
        data = { days, month_total_pnl: days.reduce((s, d) => s + d.profit, 0) };
    }

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    document.getElementById('calendarCurrentMonth').textContent = `${monthNames[calendarDate.getMonth()]} ${year}`;

    const monthTotalEl = document.getElementById('calendarMonthTotal');
    monthTotalEl.textContent = formatUSD(data.month_total_pnl);
    monthTotalEl.className = `font-bold mono ${data.month_total_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;

    const dayMap = {};
    data.days.forEach(d => { dayMap[d.date] = d; });

    const grid = document.getElementById('calendarGrid');
    grid.innerHTML = '';
    const firstDay = new Date(year, month - 1, 1).getDay();
    const startingOffset = (firstDay === 0 ? 6 : firstDay - 1);
    const daysInMonth = new Date(year, month, 0).getDate();

    for (let i = 0; i < startingOffset; i++) {
        grid.innerHTML += '<div class="h-20 bg-slate-900/20 border border-white/5 rounded-xl opacity-15"></div>';
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dayStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayData = dayMap[dayStr];
        const isToday = dayStr === new Date().toISOString().slice(0, 10);
        if (dayData) {
            const isProfit = dayData.profit >= 0;
            grid.innerHTML += `
                <div class="h-20 p-2 rounded-xl border transition-all duration-300 hover:scale-[1.07] cursor-default
                    ${isProfit ? 'bg-emerald-950/30 border-emerald-500/25 hover:border-emerald-400/60 hover:shadow-lg hover:shadow-emerald-500/20' : 'bg-rose-950/30 border-rose-500/25 hover:border-rose-400/60 hover:shadow-lg hover:shadow-rose-500/20'}
                    ${isToday ? 'ring-2 ring-cyan-400/60' : ''} flex flex-col justify-between">
                    <div class="flex justify-between items-center">
                        <span class="text-xs font-bold ${isToday ? 'text-cyan-400' : 'text-gray-400'}">${day}</span>
                        <span class="text-[9px] px-1.5 py-0.5 rounded-full mono ${isProfit ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}">${dayData.wins}W ${dayData.losses}L</span>
                    </div>
                    <div class="text-right">
                        <span class="text-xs sm:text-sm font-extrabold block mono ${isProfit ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(dayData.profit)}</span>
                        <span class="text-[9px] text-gray-500">${dayData.trades_count}t</span>
                    </div>
                </div>`;
        } else {
            grid.innerHTML += `
                <div class="h-20 p-2 rounded-xl bg-slate-900/25 border border-white/5 flex flex-col justify-between transition-all duration-200 hover:bg-slate-900/40
                    ${isToday ? 'ring-2 ring-cyan-400/60' : ''}">
                    <span class="text-xs font-medium ${isToday ? 'text-cyan-400 font-bold' : 'text-gray-600'}">${day}</span>
                    <span class="text-[11px] text-gray-700 text-right">—</span>
                </div>`;
        }
    }
}

function changeMonth(delta) {
    calendarDate.setMonth(calendarDate.getMonth() + delta);
    fetchCalendarData();
}

// ═══════════════════════════════════════════════
// 7. OPEN POSITIONS
// ═══════════════════════════════════════════════
async function fetchOpenPositions() {
    let data = await safeFetch(`/api/open-positions?account=${currentAccount}&magic=${currentMagic}`);
    if (!data || !data.positions) { data = { positions: usingDemo ? buildDemo().openPositions : [] }; }

    const tbody = document.getElementById('openPositionsTable');
    document.getElementById('liveOpenBadge').textContent = `${data.positions.length} Active`;

    if (data.positions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-600">No active floating positions</td></tr>';
        return;
    }
    tbody.innerHTML = data.positions.map(p => `
        <tr class="hover:bg-cyan-500/5 transition-colors duration-200">
            <td class="p-2.5"><span class="font-semibold text-white">${p.ea_name}</span><br><span class="text-[10px] text-gray-500 mono">#${p.account_number}</span></td>
            <td class="p-2.5 font-bold text-gray-200">${p.symbol}</td>
            <td class="p-2.5"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${p.trade_type === 'BUY' ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/25' : 'bg-amber-500/15 text-amber-400 border border-amber-500/25'}">${p.trade_type}</span></td>
            <td class="p-2.5 mono text-gray-300">${p.volume}</td>
            <td class="p-2.5 mono text-gray-300">${p.open_price}</td>
            <td class="p-2.5 text-right mono font-bold ${(p.profit + p.swap) >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(p.profit + p.swap)}</td>
        </tr>
    `).join('');
}

// ═══════════════════════════════════════════════
// 8. EA LEADERBOARD TABLE
// ═══════════════════════════════════════════════
async function fetchEALeaderboard() {
    let data = await safeFetch('/api/eas');
    if (!data || !data.eas || data.eas.length === 0) { data = { eas: buildDemo().eas }; }

    const container = document.getElementById('eaLeaderboardBody');
    if (!container) return;
    if (data.eas.length === 0) {
        container.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-gray-600">No EA data available yet</td></tr>';
        return;
    }

    const sorted = [...data.eas].sort((a, b) => b.total_pnl - a.total_pnl);
    const rankStyle = ['from-amber-400 to-amber-600', 'from-slate-300 to-slate-500', 'from-orange-500 to-amber-700'];

    container.innerHTML = sorted.map((ea, index) => {
        const winRate = ea.total_trades > 0 ? ((ea.wins / ea.total_trades) * 100).toFixed(1) : '0.0';
        const isProfit = ea.total_pnl >= 0;
        const rankBadge = index < 3
            ? `<span class="inline-grid place-items-center w-7 h-7 rounded-full bg-gradient-to-br ${rankStyle[index]} text-[11px] font-extrabold text-slate-900 shadow-lg">${index + 1}</span>`
            : `<span class="text-gray-500 mono font-semibold">#${index + 1}</span>`;
        const avgTrade = ea.total_trades > 0 ? ea.total_pnl / ea.total_trades : 0;
        return `
            <tr class="hover:bg-cyan-500/5 transition-all duration-200">
                <td class="p-3 text-center">${rankBadge}</td>
                <td class="p-3">
                    <div class="flex items-center gap-3">
                        <div class="w-3 h-3 rounded-full" style="background: ${ea.color || '#22d3ee'}; box-shadow: 0 0 10px ${ea.color || '#22d3ee'}88;"></div>
                        <div>
                            <span class="font-bold text-white text-sm">${ea.ea_name}</span>
                            <br><span class="text-[10px] text-gray-500 mono">Magic: ${ea.magic_number}</span>
                        </div>
                    </div>
                </td>
                <td class="p-3 text-right mono font-bold text-sm ${isProfit ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(ea.total_pnl)}</td>
                <td class="p-3 text-center mono text-sm text-gray-300">${ea.total_trades}</td>
                <td class="p-3 text-center">
                    <span class="text-emerald-400 font-semibold">${ea.wins}</span>
                    <span class="text-gray-600 mx-1">/</span>
                    <span class="text-rose-400 font-semibold">${ea.losses}</span>
                </td>
                <td class="p-3 text-center">
                    <div class="flex items-center justify-center gap-2">
                        <div class="w-16 bg-slate-800 rounded-full h-2 overflow-hidden">
                            <div class="h-2 rounded-full transition-all duration-700 ${Number(winRate) >= 50 ? 'bg-gradient-to-r from-emerald-500 to-cyan-400' : 'bg-gradient-to-r from-rose-500 to-orange-400'}" style="width: ${winRate}%"></div>
                        </div>
                        <span class="text-xs font-bold ${Number(winRate) >= 50 ? 'text-emerald-400' : 'text-rose-400'}">${winRate}%</span>
                    </div>
                </td>
                <td class="p-3 text-right mono text-xs ${avgTrade >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(avgTrade)}</td>
                <td class="p-3 text-right mono text-xs ${ea.open_pnl >= 0 ? 'text-cyan-400' : 'text-rose-400'}">${formatUSD(ea.open_pnl)}</td>
            </tr>`;
    }).join('');
}
