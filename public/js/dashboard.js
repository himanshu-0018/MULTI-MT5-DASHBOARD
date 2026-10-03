// ═══════════════════════════════════════════════
// MT5 DASHBOARD - ENHANCED INTERACTIVE ENGINE
// ═══════════════════════════════════════════════

let currentAccount = 'all';
let currentMagic = 'all';
let calendarDate = new Date();
let equityChart = null;
let eaChart = null;
let dailyPnlChart = null;
let winLossChart = null;

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

// ─── INITIALIZATION ───
document.addEventListener('DOMContentLoaded', async () => {
    lucide.createIcons();
    initFilters();
    initCharts();
    await refreshDashboard();
    setInterval(refreshDashboard, 5000);
});

function initFilters() {
    document.getElementById('accountFilter').addEventListener('change', (e) => {
        currentAccount = e.target.value;
        refreshDashboard();
    });
    document.getElementById('magicFilter').addEventListener('change', (e) => {
        currentMagic = e.target.value;
        refreshDashboard();
    });
}

// ─── MASTER REFRESH ───
async function refreshDashboard() {
    try {
        await Promise.all([
            fetchOverview(),
            fetchAccountsList(),
            fetchEAList(),
            fetchEquityChart(),
            fetchCalendarData(),
            fetchOpenPositions(),
            fetchEALeaderboard()
        ]);
        document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString();
        lucide.createIcons();
    } catch (err) {
        console.error('Dashboard refresh error:', err);
    }
}

// ═══════════════════════════════════════════════
// 1. OVERVIEW KPI CARDS
// ═══════════════════════════════════════════════
async function fetchOverview() {
    const res = await fetch(`/api/overview?account=${currentAccount}&magic=${currentMagic}`);
    const data = await res.json();
    if (!data.success) return;

    document.getElementById('totalBalance').textContent = formatPlainUSD(data.total_balance);
    document.getElementById('totalEquity').textContent = formatPlainUSD(data.total_equity);
    document.getElementById('accountCountBadge').textContent = `${data.total_accounts} Accs`;

    const todayEl = document.getElementById('todayPnl');
    todayEl.textContent = formatUSD(data.today_pnl);
    todayEl.className = `text-2xl font-bold tracking-tight ${data.today_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;

    const todayCard = document.getElementById('todayCard');
    todayCard.className = `glass-panel p-5 rounded-2xl relative overflow-hidden group ${data.today_pnl >= 0 ? 'glow-green' : 'glow-red'}`;

    const floatEl = document.getElementById('floatingPnl');
    floatEl.textContent = formatUSD(data.floating_pnl);
    floatEl.className = `font-semibold ${data.floating_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
    document.getElementById('openCount').textContent = data.open_trades_count;

    const monthEl = document.getElementById('monthPnl');
    monthEl.textContent = formatUSD(data.month_pnl);
    monthEl.className = `text-2xl font-bold tracking-tight ${data.month_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
    document.getElementById('totalClosedPnl').textContent = formatUSD(data.total_closed_profit);

    document.getElementById('winRate').textContent = `${data.win_rate}%`;
    document.getElementById('profitFactor').textContent = data.profit_factor;
    document.getElementById('totalTradesCount').textContent = `${data.total_trades} (${data.wins}W / ${data.losses}L)`;
}

// ═══════════════════════════════════════════════
// 2. ACCOUNTS LIST
// ═══════════════════════════════════════════════
async function fetchAccountsList() {
    const res = await fetch('/api/accounts');
    const data = await res.json();
    if (!data.success) return;

    const select = document.getElementById('accountFilter');
    const grid = document.getElementById('accountsGrid');
    const currentSelected = select.value;

    select.innerHTML = '<option value="all">🌐 All Accounts (Collective)</option>';
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

    grid.innerHTML = data.accounts.map(acc => `
        <div class="bg-gray-900/80 border border-gray-800 p-4 rounded-xl hover:border-gray-600 transition-all duration-300 hover:shadow-lg hover:shadow-blue-500/5 hover:-translate-y-0.5">
            <div class="flex justify-between items-start mb-2">
                <div>
                    <h3 class="font-bold text-sm text-white">${acc.account_name || 'Account #' + acc.account_number}</h3>
                    <p class="text-xs text-gray-400">${acc.broker || 'MT5'} • #${acc.account_number}</p>
                </div>
                <span class="px-2 py-0.5 rounded text-[10px] font-mono ${acc.floating_pnl >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}">
                    ${acc.open_count} Open
                </span>
            </div>
            <div class="mt-3 flex justify-between items-baseline">
                <div>
                    <span class="text-[10px] text-gray-500 uppercase block">Balance</span>
                    <span class="font-semibold text-sm text-gray-200">${formatPlainUSD(acc.balance)}</span>
                </div>
                <div class="text-right">
                    <span class="text-[10px] text-gray-500 uppercase block">Today</span>
                    <span class="font-semibold text-sm ${acc.today_profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(acc.today_profit)}</span>
                </div>
            </div>
            <div class="mt-2 w-full bg-gray-800 rounded-full h-1">
                <div class="h-1 rounded-full transition-all duration-700 ${acc.today_profit >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}" style="width: ${Math.min(Math.abs(acc.today_profit) / (acc.balance || 1) * 1000, 100)}%"></div>
            </div>
        </div>
    `).join('');
}

// ═══════════════════════════════════════════════
// 3. EA LIST (Dropdown + EA Bar Chart)
// ═══════════════════════════════════════════════
async function fetchEAList() {
    const res = await fetch('/api/eas');
    const data = await res.json();
    if (!data.success) return;

    const select = document.getElementById('magicFilter');
    const currentSelected = select.value;
    select.innerHTML = '<option value="all">⚡ All EAs & Strategies</option>';

    data.eas.forEach(ea => {
        const opt = document.createElement('option');
        opt.value = ea.magic_number;
        opt.textContent = `${ea.ea_name} (Magic: ${ea.magic_number})`;
        if (String(opt.value) === String(currentSelected)) opt.selected = true;
        select.appendChild(opt);
    });

    // Update EA Breakdown Chart
    if (eaChart && data.eas.length > 0) {
        const categories = data.eas.map(e => e.ea_name);
        const seriesData = data.eas.map(e => Number(e.total_pnl.toFixed(2)));
        const colors = seriesData.map(v => v >= 0 ? '#10b981' : '#ef4444');

        eaChart.updateOptions({
            series: [{ name: 'Net P&L', data: seriesData }],
            xaxis: { categories },
            colors
        });
    }
}

// ═══════════════════════════════════════════════
// 4. INITIALIZE ALL CHARTS (Animated + Interactive)
// ═══════════════════════════════════════════════
function initCharts() {

    // ── 4.1 CUMULATIVE EQUITY GROWTH CURVE ──
    equityChart = new ApexCharts(document.querySelector("#equityChart"), {
        chart: {
            type: 'area',
            height: 340,
            background: 'transparent',
            fontFamily: 'Inter, sans-serif',
            toolbar: { show: true, tools: { download: true, selection: true, zoom: true, zoomin: true, zoomout: true, pan: true, reset: true } },
            zoom: { enabled: true, type: 'x' },
            animations: {
                enabled: true,
                easing: 'easeinout',
                speed: 1200,
                dynamicAnimation: { enabled: true, speed: 500 }
            },
            dropShadow: {
                enabled: true,
                top: 8,
                left: 0,
                blur: 12,
                opacity: 0.3,
                color: '#06b6d4'
            }
        },
        theme: { mode: 'dark' },
        stroke: { curve: 'smooth', width: 3.5, lineCap: 'round' },
        colors: ['#06b6d4'],
        fill: {
            type: 'gradient',
            gradient: {
                shade: 'dark',
                type: 'vertical',
                shadeIntensity: 0.6,
                gradientToColors: ['#8b5cf6'],
                opacityFrom: 0.5,
                opacityTo: 0.02,
                stops: [0, 90, 100]
            }
        },
        markers: {
            size: 0,
            hover: { size: 6, sizeOffset: 3 },
            strokeColors: '#06b6d4',
            strokeWidth: 2,
            fillOpacity: 1
        },
        dataLabels: { enabled: false },
        grid: {
            borderColor: '#1e293b',
            strokeDashArray: 5,
            xaxis: { lines: { show: false } },
            yaxis: { lines: { show: true } },
            padding: { top: 0, right: 10, bottom: 0, left: 10 }
        },
        xaxis: {
            type: 'datetime',
            labels: { style: { colors: '#64748b', fontSize: '11px', fontWeight: 500 }, datetimeUTC: false },
            axisBorder: { show: false },
            axisTicks: { show: false },
            crosshairs: { show: true, stroke: { color: '#475569', width: 1, dashArray: 4 } }
        },
        yaxis: {
            labels: {
                style: { colors: '#64748b', fontSize: '11px', fontWeight: 500 },
                formatter: (val) => '$' + val.toFixed(0)
            },
            crosshairs: { show: true, stroke: { color: '#475569', width: 1, dashArray: 4 } }
        },
        tooltip: {
            theme: 'dark',
            x: { format: 'dd MMM yyyy HH:mm' },
            y: { formatter: (val) => formatUSD(val) },
            style: { fontSize: '12px' },
            marker: { show: true }
        },
        series: [{ name: 'Cumulative Profit', data: [] }]
    });
    equityChart.render();

    // ── 4.2 DAILY P&L HISTOGRAM ──
    dailyPnlChart = new ApexCharts(document.querySelector("#dailyPnlChart"), {
        chart: {
            type: 'bar',
            height: 340,
            background: 'transparent',
            fontFamily: 'Inter, sans-serif',
            toolbar: { show: true, tools: { download: true, zoom: true, reset: true } },
            animations: {
                enabled: true,
                easing: 'easeinout',
                speed: 800,
                animateGradually: { enabled: true, delay: 50 },
                dynamicAnimation: { enabled: true, speed: 400 }
            }
        },
        theme: { mode: 'dark' },
        plotOptions: {
            bar: {
                borderRadius: 5,
                borderRadiusApplication: 'end',
                columnWidth: '70%',
                distributed: false,
                colors: {
                    ranges: [
                        { from: -999999, to: -0.01, color: '#ef4444' },
                        { from: 0, to: 999999, color: '#10b981' }
                    ]
                }
            }
        },
        dataLabels: { enabled: false },
        grid: {
            borderColor: '#1e293b',
            strokeDashArray: 5,
            xaxis: { lines: { show: false } },
            yaxis: { lines: { show: true } }
        },
        xaxis: {
            type: 'datetime',
            labels: { style: { colors: '#64748b', fontSize: '10px' }, datetimeUTC: false, format: 'dd MMM' },
            axisBorder: { show: false },
            axisTicks: { show: false }
        },
        yaxis: {
            labels: {
                style: { colors: '#64748b', fontSize: '11px' },
                formatter: (val) => '$' + val.toFixed(0)
            }
        },
        tooltip: {
            theme: 'dark',
            x: { format: 'dd MMM yyyy' },
            y: { formatter: (val) => formatUSD(val) }
        },
        series: [{ name: 'Daily P&L', data: [] }]
    });
    dailyPnlChart.render();

    // ── 4.3 EA COMPARISON HORIZONTAL BAR ──
    eaChart = new ApexCharts(document.querySelector("#eaChart"), {
        chart: {
            type: 'bar',
            height: 300,
            background: 'transparent',
            fontFamily: 'Inter, sans-serif',
            toolbar: { show: false },
            animations: {
                enabled: true,
                easing: 'easeinout',
                speed: 1000,
                animateGradually: { enabled: true, delay: 120 },
                dynamicAnimation: { enabled: true, speed: 500 }
            }
        },
        theme: { mode: 'dark' },
        plotOptions: {
            bar: {
                borderRadius: 6,
                horizontal: true,
                distributed: true,
                barHeight: '65%',
                dataLabels: { position: 'top' }
            }
        },
        legend: { show: false },
        dataLabels: {
            enabled: true,
            textAnchor: 'start',
            formatter: (val) => formatUSD(val),
            offsetX: 5,
            style: { fontSize: '11px', fontWeight: 700, colors: ['#e2e8f0'] },
            dropShadow: { enabled: true, top: 1, left: 1, blur: 2, opacity: 0.5 }
        },
        grid: { borderColor: '#1e293b', strokeDashArray: 4, xaxis: { lines: { show: true } } },
        xaxis: {
            labels: { style: { colors: '#64748b' }, formatter: (val) => '$' + val },
            axisBorder: { show: false }
        },
        yaxis: { labels: { style: { colors: '#d1d5db', fontSize: '12px', fontWeight: 600 } } },
        tooltip: { theme: 'dark', y: { formatter: (val) => formatUSD(val) } },
        series: [{ name: 'Profit', data: [] }]
    });
    eaChart.render();

    // ── 4.4 WIN/LOSS DONUT CHART ──
    winLossChart = new ApexCharts(document.querySelector("#winLossChart"), {
        chart: {
            type: 'donut',
            height: 300,
            background: 'transparent',
            fontFamily: 'Inter, sans-serif',
            animations: {
                enabled: true,
                easing: 'easeinout',
                speed: 1200,
                animateGradually: { enabled: true, delay: 200 },
                dynamicAnimation: { enabled: true, speed: 600 }
            },
            dropShadow: {
                enabled: true,
                top: 3,
                left: 0,
                blur: 10,
                opacity: 0.2
            }
        },
        theme: { mode: 'dark' },
        labels: ['Wins', 'Losses'],
        colors: ['#10b981', '#ef4444'],
        plotOptions: {
            pie: {
                donut: {
                    size: '72%',
                    labels: {
                        show: true,
                        name: { show: true, fontSize: '14px', fontWeight: 600, color: '#e2e8f0' },
                        value: { show: true, fontSize: '22px', fontWeight: 800, color: '#ffffff', formatter: (val) => val + ' trades' },
                        total: {
                            show: true,
                            label: 'Win Rate',
                            fontSize: '13px',
                            fontWeight: 500,
                            color: '#94a3b8',
                            formatter: (w) => {
                                const total = w.globals.seriesTotals.reduce((a, b) => a + b, 0);
                                const wins = w.globals.seriesTotals[0] || 0;
                                return total > 0 ? ((wins / total) * 100).toFixed(1) + '%' : '0%';
                            }
                        }
                    }
                },
                expandOnClick: true
            }
        },
        stroke: { width: 2, colors: ['#0b0f19'] },
        dataLabels: { enabled: false },
        legend: {
            position: 'bottom',
            labels: { colors: '#94a3b8' },
            fontSize: '13px',
            fontWeight: 600,
            markers: { width: 10, height: 10, radius: 3 }
        },
        tooltip: {
            theme: 'dark',
            y: { formatter: (val) => val + ' trades' }
        },
        series: [0, 0]
    });
    winLossChart.render();
}

// ═══════════════════════════════════════════════
// 5. FETCH EQUITY CURVE + DAILY PNL HISTOGRAM
// ═══════════════════════════════════════════════
async function fetchEquityChart() {
    const res = await fetch(`/api/charts/equity-curve?account=${currentAccount}&magic=${currentMagic}`);
    const data = await res.json();
    if (!data.success) return;

    // Equity Curve
    const equitySeries = data.curve.map(pt => [new Date(pt.time).getTime(), pt.cumulative_profit]);
    if (equityChart) {
        equityChart.updateSeries([{ name: 'Cumulative Profit', data: equitySeries }]);
    }

    // Build Daily PnL from same data
    const dailyMap = {};
    data.curve.forEach(pt => {
        const day = pt.time.slice(0, 10);
        dailyMap[day] = (dailyMap[day] || 0) + pt.profit;
    });

    const dailySeries = Object.entries(dailyMap).map(([date, profit]) => ({
        x: new Date(date).getTime(),
        y: Number(profit.toFixed(2)),
        fillColor: profit >= 0 ? '#10b981' : '#ef4444'
    }));

    if (dailyPnlChart) {
        dailyPnlChart.updateSeries([{ name: 'Daily P&L', data: dailySeries }]);
    }

    // Win/Loss Donut from overview
    const overviewRes = await fetch(`/api/overview?account=${currentAccount}&magic=${currentMagic}`);
    const overviewData = await overviewRes.json();
    if (overviewData.success && winLossChart) {
        winLossChart.updateSeries([overviewData.wins || 0, overviewData.losses || 0]);
    }
}

// ═══════════════════════════════════════════════
// 6. CALENDAR
// ═══════════════════════════════════════════════
async function fetchCalendarData() {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth() + 1;

    const res = await fetch(`/api/calendar?year=${year}&month=${month}&account=${currentAccount}&magic=${currentMagic}`);
    const data = await res.json();
    if (!data.success) return;

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    document.getElementById('calendarCurrentMonth').textContent = `${monthNames[calendarDate.getMonth()]} ${year}`;

    const monthTotalEl = document.getElementById('calendarMonthTotal');
    monthTotalEl.textContent = formatUSD(data.month_total_pnl);
    monthTotalEl.className = `font-bold ${data.month_total_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;

    const dayMap = {};
    data.days.forEach(d => { dayMap[d.date] = d; });

    const grid = document.getElementById('calendarGrid');
    grid.innerHTML = '';

    const firstDay = new Date(year, month - 1, 1).getDay();
    const startingOffset = (firstDay === 0 ? 6 : firstDay - 1);
    const daysInMonth = new Date(year, month, 0).getDate();

    for (let i = 0; i < startingOffset; i++) {
        grid.innerHTML += '<div class="h-20 bg-gray-900/20 border border-gray-800/40 rounded-xl opacity-20"></div>';
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dayStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayData = dayMap[dayStr];
        const isToday = dayStr === new Date().toISOString().slice(0, 10);

        if (dayData) {
            const isProfit = dayData.profit >= 0;
            grid.innerHTML += `
                <div class="h-20 p-2 rounded-xl border transition-all duration-300 hover:scale-105 cursor-default
                    ${isProfit ? 'bg-emerald-950/30 border-emerald-500/30 hover:border-emerald-400/60 hover:shadow-lg hover:shadow-emerald-500/10' : 'bg-rose-950/30 border-rose-500/30 hover:border-rose-400/60 hover:shadow-lg hover:shadow-rose-500/10'}
                    ${isToday ? 'ring-2 ring-cyan-500/50' : ''}
                    flex flex-col justify-between">
                    <div class="flex justify-between items-center">
                        <span class="text-xs font-bold ${isToday ? 'text-cyan-400' : 'text-gray-400'}">${day}</span>
                        <span class="text-[9px] px-1.5 py-0.5 rounded-full font-mono ${isProfit ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}">${dayData.wins}W ${dayData.losses}L</span>
                    </div>
                    <div class="text-right">
                        <span class="text-xs sm:text-sm font-extrabold block ${isProfit ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(dayData.profit)}</span>
                        <span class="text-[9px] text-gray-500">${dayData.trades_count} trades</span>
                    </div>
                </div>`;
        } else {
            grid.innerHTML += `
                <div class="h-20 p-2 rounded-xl bg-gray-900/30 border border-gray-800/50 flex flex-col justify-between transition-all duration-200 hover:bg-gray-900/50
                    ${isToday ? 'ring-2 ring-cyan-500/50' : ''}">
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
// 7. OPEN POSITIONS TABLE
// ═══════════════════════════════════════════════
async function fetchOpenPositions() {
    const res = await fetch(`/api/open-positions?account=${currentAccount}&magic=${currentMagic}`);
    const data = await res.json();
    if (!data.success) return;

    const tbody = document.getElementById('openPositionsTable');
    document.getElementById('liveOpenBadge').textContent = `${data.positions.length} Active`;

    if (data.positions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-500">No active floating positions</td></tr>';
        return;
    }

    tbody.innerHTML = data.positions.map(p => `
        <tr class="hover:bg-gray-800/60 transition-colors duration-200">
            <td class="p-2.5">
                <span class="font-semibold text-white">${p.ea_name}</span>
                <br><span class="text-[10px] text-gray-500">#${p.account_number}</span>
            </td>
            <td class="p-2.5 font-bold text-gray-200">${p.symbol}</td>
            <td class="p-2.5">
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${p.trade_type === 'BUY' ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'}">${p.trade_type}</span>
            </td>
            <td class="p-2.5 font-mono text-gray-300">${p.volume}</td>
            <td class="p-2.5 font-mono text-gray-300">${p.open_price}</td>
            <td class="p-2.5 text-right font-mono font-bold ${(p.profit + p.swap) >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(p.profit + p.swap)}</td>
        </tr>
    `).join('');
}

// ═══════════════════════════════════════════════
// 8. TOP PERFORMING EAs LEADERBOARD TABLE
// ═══════════════════════════════════════════════
async function fetchEALeaderboard() {
    const res = await fetch('/api/eas');
    const data = await res.json();
    if (!data.success) return;

    const container = document.getElementById('eaLeaderboardBody');
    if (!container) return;

    if (data.eas.length === 0) {
        container.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-gray-500">No EA data available yet. Waiting for trade history...</td></tr>';
        return;
    }

    // Sort by total PnL descending
    const sorted = [...data.eas].sort((a, b) => b.total_pnl - a.total_pnl);

    container.innerHTML = sorted.map((ea, index) => {
        const winRate = ea.total_trades > 0 ? ((ea.wins / ea.total_trades) * 100).toFixed(1) : '0.0';
        const isProfit = ea.total_pnl >= 0;
        const rankEmoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;
        const avgTrade = ea.total_trades > 0 ? ea.total_pnl / ea.total_trades : 0;

        return `
            <tr class="hover:bg-gray-800/60 transition-all duration-200 border-b border-gray-800/50">
                <td class="p-3 text-center">
                    <span class="text-lg">${rankEmoji}</span>
                </td>
                <td class="p-3">
                    <div class="flex items-center gap-3">
                        <div class="w-3 h-3 rounded-full" style="background: ${ea.color}; box-shadow: 0 0 8px ${ea.color}44;"></div>
                        <div>
                            <span class="font-bold text-white text-sm">${ea.ea_name}</span>
                            <br><span class="text-[10px] text-gray-500 font-mono">Magic: ${ea.magic_number}</span>
                        </div>
                    </div>
                </td>
                <td class="p-3 text-right font-mono font-bold text-sm ${isProfit ? 'text-emerald-400' : 'text-rose-400'}">
                    ${formatUSD(ea.total_pnl)}
                </td>
                <td class="p-3 text-center font-mono text-sm text-gray-300">${ea.total_trades}</td>
                <td class="p-3 text-center">
                    <span class="text-emerald-400 font-semibold">${ea.wins}</span>
                    <span class="text-gray-600 mx-1">/</span>
                    <span class="text-rose-400 font-semibold">${ea.losses}</span>
                </td>
                <td class="p-3 text-center">
                    <div class="flex items-center justify-center gap-2">
                        <div class="w-16 bg-gray-800 rounded-full h-2 overflow-hidden">
                            <div class="h-2 rounded-full transition-all duration-700 ${Number(winRate) >= 50 ? 'bg-emerald-500' : 'bg-rose-500'}" style="width: ${winRate}%"></div>
                        </div>
                        <span class="text-xs font-bold ${Number(winRate) >= 50 ? 'text-emerald-400' : 'text-rose-400'}">${winRate}%</span>
                    </div>
                </td>
                <td class="p-3 text-right font-mono text-xs ${avgTrade >= 0 ? 'text-emerald-400' : 'text-rose-400'}">
                    ${formatUSD(avgTrade)}
                </td>
                <td class="p-3 text-right font-mono text-xs ${ea.open_pnl >= 0 ? 'text-cyan-400' : 'text-rose-400'}">
                    ${formatUSD(ea.open_pnl)}
                </td>
            </tr>
        `;
    }).join('');
}
