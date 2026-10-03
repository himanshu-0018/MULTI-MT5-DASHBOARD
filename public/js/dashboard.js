// ═══════════════════════════════════════════════════════════════
// MT5 COMMAND CENTER - ENHANCED DASHBOARD ENGINE v2
// ═══════════════════════════════════════════════════════════════

let currentAccount = 'all';
let currentMagic = 'all';
let calendarDate = new Date();
let equityChart = null;
let eaChart = null;
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

// ─── INIT ───
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
    todayEl.className = `text-2xl font-extrabold tracking-tight ${data.today_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;

    const todayCard = document.getElementById('todayCard');
    todayCard.className = `glass-panel p-5 rounded-2xl relative overflow-hidden group ${data.today_pnl >= 0 ? 'glow-green' : 'glow-red'}`;

    const floatEl = document.getElementById('floatingPnl');
    floatEl.textContent = formatUSD(data.floating_pnl);
    floatEl.className = `font-semibold ${data.floating_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
    document.getElementById('openCount').textContent = data.open_trades_count;

    const monthEl = document.getElementById('monthPnl');
    monthEl.textContent = formatUSD(data.month_pnl);
    monthEl.className = `text-2xl font-extrabold tracking-tight ${data.month_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
    document.getElementById('totalClosedPnl').textContent = formatUSD(data.total_closed_profit);

    document.getElementById('winRate').textContent = `${data.win_rate}%`;
    document.getElementById('profitFactor').textContent = data.profit_factor;
    document.getElementById('totalTradesCount').textContent = `${data.total_trades} (${data.wins}W / ${data.losses}L)`;

    // Update Win/Loss Donut
    if (winLossChart) {
        winLossChart.updateSeries([data.wins || 0, data.losses || 0]);
    }
}

// ═══════════════════════════════════════════════
// 2. ACCOUNTS
// ═══════════════════════════════════════════════
async function fetchAccountsList() {
    const res = await fetch('/api/accounts');
    const data = await res.json();
    if (!data.success) return;

    const select = document.getElementById('accountFilter');
    const grid = document.getElementById('accountsGrid');
    const currentSelected = select.value;

    select.innerHTML = '<option value="all">🌐 All Accounts</option>';
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
        <div class="bg-gray-900/80 border border-gray-800 p-4 rounded-xl hover:border-gray-600 transition-all duration-300 hover:shadow-lg hover:shadow-cyan-500/5 hover:-translate-y-0.5">
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
                <div class="h-1 rounded-full transition-all duration-700 ${acc.today_profit >= 0 ? 'bg-gradient-to-r from-emerald-500 to-cyan-400' : 'bg-gradient-to-r from-rose-500 to-orange-400'}" style="width: ${Math.min(Math.abs(acc.today_profit) / (acc.balance || 1) * 1000, 100)}%"></div>
            </div>
        </div>
    `).join('');
}

// ═══════════════════════════════════════════════
// 3. EA LIST & BAR CHART
// ═══════════════════════════════════════════════
async function fetchEAList() {
    const res = await fetch('/api/eas');
    const data = await res.json();
    if (!data.success) return;

    const select = document.getElementById('magicFilter');
    const currentSelected = select.value;
    select.innerHTML = '<option value="all">⚡ All EAs</option>';

    data.eas.forEach(ea => {
        const opt = document.createElement('option');
        opt.value = ea.magic_number;
        opt.textContent = `${ea.ea_name} (Magic: ${ea.magic_number})`;
        if (String(opt.value) === String(currentSelected)) opt.selected = true;
        select.appendChild(opt);
    });

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
// 4. INITIALIZE CHARTS
// ═══════════════════════════════════════════════
function initCharts() {

    // ── 4.1 STUNNING EQUITY CURVE ──
    equityChart = new ApexCharts(document.querySelector("#equityChart"), {
        chart: {
            type: 'area',
            height: 420,
            background: 'transparent',
            fontFamily: 'Inter, sans-serif',
            toolbar: {
                show: true,
                tools: { download: true, selection: true, zoom: true, zoomin: true, zoomout: true, pan: true, reset: true },
                autoSelected: 'zoom'
            },
            zoom: { enabled: true, type: 'x', autoScaleYaxis: true },
            animations: {
                enabled: true,
                easing: 'easeinout',
                speed: 1400,
                dynamicAnimation: { enabled: true, speed: 600 }
            },
            dropShadow: {
                enabled: true,
                top: 0,
                left: 0,
                blur: 20,
                opacity: 0.35,
                color: '#00e5ff'
            },
            sparkline: { enabled: false },
            selection: {
                enabled: true,
                stroke: { width: 1, dashArray: 3, color: '#00e5ff' },
                fill: { color: '#00e5ff', opacity: 0.1 }
            }
        },
        theme: { mode: 'dark' },
        stroke: {
            curve: 'smooth',
            width: 3.5,
            lineCap: 'round'
        },
        colors: ['#00e5ff'],
        fill: {
            type: 'gradient',
            gradient: {
                shade: 'dark',
                type: 'vertical',
                shadeIntensity: 1,
                gradientToColors: ['#7c3aed'],
                inverseColors: false,
                opacityFrom: 0.55,
                opacityTo: 0.0,
                stops: [0, 50, 100],
                colorStops: [
                    { offset: 0, color: '#00e5ff', opacity: 0.4 },
                    { offset: 40, color: '#a855f7', opacity: 0.2 },
                    { offset: 100, color: '#7c3aed', opacity: 0 }
                ]
            }
        },
        markers: {
            size: 0,
            colors: ['#00e5ff'],
            strokeColors: '#0f172a',
            strokeWidth: 3,
            hover: {
                size: 8,
                sizeOffset: 4
            },
            discrete: []
        },
        dataLabels: { enabled: false },
        grid: {
            show: true,
            borderColor: '#1e293b50',
            strokeDashArray: 6,
            xaxis: { lines: { show: false } },
            yaxis: { lines: { show: true } },
            padding: { top: 10, right: 15, bottom: 5, left: 15 }
        },
        xaxis: {
            type: 'datetime',
            labels: {
                style: { colors: '#475569', fontSize: '11px', fontWeight: 500 },
                datetimeUTC: false
            },
            axisBorder: { show: false },
            axisTicks: { show: false },
            crosshairs: {
                show: true,
                width: 1,
                position: 'back',
                opacity: 0.5,
                stroke: { color: '#00e5ff', width: 1, dashArray: 0 },
                fill: { type: 'solid', color: '#00e5ff' },
                dropShadow: { enabled: true, top: 0, left: 0, blur: 3, opacity: 0.4, color: '#00e5ff' }
            }
        },
        yaxis: {
            labels: {
                style: { colors: '#475569', fontSize: '11px', fontWeight: 500 },
                formatter: (val) => {
                    if (Math.abs(val) >= 1000) return '$' + (val / 1000).toFixed(1) + 'k';
                    return '$' + val.toFixed(0);
                },
                offsetX: -5
            },
            crosshairs: {
                show: true,
                stroke: { color: '#475569', width: 1, dashArray: 4 }
            }
        },
        tooltip: {
            enabled: true,
            theme: 'dark',
            x: { format: 'dd MMM yyyy HH:mm' },
            y: {
                formatter: (val) => {
                    const color = val >= 0 ? '#00e5ff' : '#f43f5e';
                    return `<span style="color:${color}; font-weight:800">${formatUSD(val)}</span>`;
                }
            },
            style: { fontSize: '13px', fontFamily: 'Inter, sans-serif' },
            marker: { show: true },
            custom: function({ series, seriesIndex, dataPointIndex, w }) {
                const value = series[seriesIndex][dataPointIndex];
                const timestamp = w.globals.seriesX[seriesIndex][dataPointIndex];
                const date = new Date(timestamp);
                const dateStr = date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
                const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                const isProfit = value >= 0;
                const color = isProfit ? '#00e5ff' : '#f43f5e';
                const bgColor = isProfit ? 'rgba(0,229,255,0.08)' : 'rgba(244,63,94,0.08)';
                const borderColor = isProfit ? 'rgba(0,229,255,0.3)' : 'rgba(244,63,94,0.3)';
                const arrow = isProfit ? '▲' : '▼';
                
                return `
                    <div style="background:#0f172a; border:1px solid ${borderColor}; border-radius:12px; padding:12px 16px; box-shadow: 0 8px 32px rgba(0,0,0,0.4), 0 0 20px ${borderColor};">
                        <div style="font-size:11px; color:#64748b; margin-bottom:6px; font-weight:500;">${dateStr} • ${timeStr}</div>
                        <div style="background:${bgColor}; border-radius:8px; padding:8px 12px; display:flex; align-items:center; gap:8px;">
                            <span style="font-size:16px; color:${color};">${arrow}</span>
                            <div>
                                <div style="font-size:10px; color:#94a3b8; text-transform:uppercase; letter-spacing:1px; font-weight:600;">Cumulative P&L</div>
                                <div style="font-size:18px; font-weight:800; color:${color}; letter-spacing:-0.5px;">${formatUSD(value)}</div>
                            </div>
                        </div>
                    </div>
                `;
            }
        },
        annotations: {
            yaxis: [{
                y: 0,
                borderColor: '#334155',
                strokeDashArray: 4,
                label: {
                    text: 'Break Even',
                    position: 'left',
                    style: { color: '#64748b', background: '#1e293b', fontSize: '10px', fontWeight: 600, padding: { left: 8, right: 8, top: 3, bottom: 3 } }
                }
            }]
        },
        series: [{ name: 'Cumulative Profit', data: [] }]
    });
    equityChart.render();

    // ── 4.2 EA HORIZONTAL BAR ──
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
                barHeight: '60%',
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
        grid: { borderColor: '#1e293b40', strokeDashArray: 4, xaxis: { lines: { show: true } } },
        xaxis: {
            labels: { style: { colors: '#475569' }, formatter: (val) => '$' + val },
            axisBorder: { show: false }
        },
        yaxis: { labels: { style: { colors: '#cbd5e1', fontSize: '12px', fontWeight: 600 } } },
        tooltip: { theme: 'dark', y: { formatter: (val) => formatUSD(val) } },
        series: [{ name: 'Profit', data: [] }]
    });
    eaChart.render();

    // ── 4.3 WIN/LOSS DONUT ──
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
                top: 4,
                left: 0,
                blur: 12,
                opacity: 0.15
            }
        },
        theme: { mode: 'dark' },
        labels: ['Winning Trades', 'Losing Trades'],
        colors: ['#00e5ff', '#f43f5e'],
        plotOptions: {
            pie: {
                donut: {
                    size: '74%',
                    labels: {
                        show: true,
                        name: { show: true, fontSize: '13px', fontWeight: 600, color: '#e2e8f0' },
                        value: { show: true, fontSize: '20px', fontWeight: 800, color: '#ffffff', formatter: (val) => val + ' trades' },
                        total: {
                            show: true,
                            label: 'Win Rate',
                            fontSize: '12px',
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
        stroke: { width: 3, colors: ['#0b0f19'] },
        dataLabels: { enabled: false },
        legend: {
            position: 'bottom',
            labels: { colors: '#94a3b8' },
            fontSize: '12px',
            fontWeight: 600,
            markers: { width: 10, height: 10, radius: 3 }
        },
        tooltip: { theme: 'dark', y: { formatter: (val) => val + ' trades' } },
        series: [0, 0]
    });
    winLossChart.render();
}

// ═══════════════════════════════════════════════
// 5. FETCH EQUITY CURVE DATA
// ═══════════════════════════════════════════════
async function fetchEquityChart() {
    const res = await fetch(`/api/charts/equity-curve?account=${currentAccount}&magic=${currentMagic}`);
    const data = await res.json();
    if (!data.success || !equityChart) return;

    const seriesData = data.curve.map(pt => [new Date(pt.time).getTime(), pt.cumulative_profit]);

    // Dynamic color: if latest cumulative profit > 0 → cyan/green, else → red/pink
    const lastValue = seriesData.length > 0 ? seriesData[seriesData.length - 1][1] : 0;
    const isPositive = lastValue >= 0;

    const lineColor = isPositive ? '#00e5ff' : '#f43f5e';
    const glowColor = isPositive ? '#00e5ff' : '#f43f5e';
    const gradientStops = isPositive
        ? [
            { offset: 0, color: '#00e5ff', opacity: 0.4 },
            { offset: 40, color: '#a855f7', opacity: 0.15 },
            { offset: 100, color: '#7c3aed', opacity: 0 }
        ]
        : [
            { offset: 0, color: '#f43f5e', opacity: 0.4 },
            { offset: 40, color: '#fb923c', opacity: 0.15 },
            { offset: 100, color: '#ef4444', opacity: 0 }
        ];

    // Find min and max for peak/valley markers
    let peakIdx = 0, valleyIdx = 0;
    seriesData.forEach((pt, i) => {
        if (pt[1] > seriesData[peakIdx][1]) peakIdx = i;
        if (pt[1] < seriesData[valleyIdx][1]) valleyIdx = i;
    });

    const discreteMarkers = [];
    if (seriesData.length > 2) {
        // Peak Marker
        discreteMarkers.push({
            seriesIndex: 0,
            dataPointIndex: peakIdx,
            fillColor: '#10b981',
            strokeColor: '#0f172a',
            size: 7,
            shape: 'circle'
        });
        // Valley Marker
        discreteMarkers.push({
            seriesIndex: 0,
            dataPointIndex: valleyIdx,
            fillColor: '#f43f5e',
            strokeColor: '#0f172a',
            size: 7,
            shape: 'circle'
        });
        // Latest Point Marker (pulsing effect via larger size)
        discreteMarkers.push({
            seriesIndex: 0,
            dataPointIndex: seriesData.length - 1,
            fillColor: lineColor,
            strokeColor: '#0f172a',
            size: 8,
            shape: 'circle'
        });
    }

    equityChart.updateOptions({
        colors: [lineColor],
        fill: {
            type: 'gradient',
            gradient: {
                shade: 'dark',
                type: 'vertical',
                shadeIntensity: 1,
                opacityFrom: 0.5,
                opacityTo: 0,
                stops: [0, 50, 100],
                colorStops: gradientStops
            }
        },
        markers: {
            size: 0,
            colors: [lineColor],
            strokeColors: '#0f172a',
            strokeWidth: 3,
            hover: { size: 8, sizeOffset: 4 },
            discrete: discreteMarkers
        },
        chart: {
            dropShadow: {
                enabled: true,
                top: 0,
                left: 0,
                blur: 20,
                opacity: 0.35,
                color: glowColor
            }
        },
        annotations: {
            yaxis: [{
                y: 0,
                borderColor: '#334155',
                strokeDashArray: 5,
                label: {
                    text: 'Break Even',
                    position: 'left',
                    style: { color: '#64748b', background: '#1e293b', fontSize: '10px', fontWeight: 600, padding: { left: 8, right: 8, top: 3, bottom: 3 } }
                }
            }],
            points: seriesData.length > 2 ? [
                {
                    x: seriesData[peakIdx][0],
                    y: seriesData[peakIdx][1],
                    marker: { size: 0 },
                    label: {
                        text: `Peak: ${formatUSD(seriesData[peakIdx][1])}`,
                        borderColor: '#10b981',
                        style: { color: '#10b981', background: '#0f2a1e', fontSize: '10px', fontWeight: 700, padding: { left: 8, right: 8, top: 4, bottom: 4 } }
                    }
                },
                {
                    x: seriesData[valleyIdx][0],
                    y: seriesData[valleyIdx][1],
                    marker: { size: 0 },
                    label: {
                        text: `Low: ${formatUSD(seriesData[valleyIdx][1])}`,
                        borderColor: '#f43f5e',
                        style: { color: '#f43f5e', background: '#2a0f17', fontSize: '10px', fontWeight: 700, padding: { left: 8, right: 8, top: 4, bottom: 4 } }
                    }
                }
            ] : []
        }
    }, false, false);

    equityChart.updateSeries([{ name: 'Cumulative Profit', data: seriesData }]);
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
        grid.innerHTML += '<div class="h-20 bg-gray-900/20 border border-gray-800/30 rounded-xl opacity-15"></div>';
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dayStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayData = dayMap[dayStr];
        const isToday = dayStr === new Date().toISOString().slice(0, 10);

        if (dayData) {
            const isProfit = dayData.profit >= 0;
            grid.innerHTML += `
                <div class="h-20 p-2 rounded-xl border transition-all duration-300 hover:scale-105 cursor-default
                    ${isProfit ? 'bg-emerald-950/25 border-emerald-500/25 hover:border-emerald-400/50 hover:shadow-lg hover:shadow-emerald-500/10' : 'bg-rose-950/25 border-rose-500/25 hover:border-rose-400/50 hover:shadow-lg hover:shadow-rose-500/10'}
                    ${isToday ? 'ring-2 ring-cyan-400/50' : ''}
                    flex flex-col justify-between">
                    <div class="flex justify-between items-center">
                        <span class="text-xs font-bold ${isToday ? 'text-cyan-400' : 'text-gray-400'}">${day}</span>
                        <span class="text-[9px] px-1.5 py-0.5 rounded-full font-mono ${isProfit ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}">${dayData.wins}W ${dayData.losses}L</span>
                    </div>
                    <div class="text-right">
                        <span class="text-xs sm:text-sm font-extrabold block ${isProfit ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(dayData.profit)}</span>
                        <span class="text-[9px] text-gray-500">${dayData.trades_count}t</span>
                    </div>
                </div>`;
        } else {
            grid.innerHTML += `
                <div class="h-20 p-2 rounded-xl bg-gray-900/25 border border-gray-800/40 flex flex-col justify-between transition-all duration-200 hover:bg-gray-900/40
                    ${isToday ? 'ring-2 ring-cyan-400/50' : ''}">
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
    const res = await fetch(`/api/open-positions?account=${currentAccount}&magic=${currentMagic}`);
    const data = await res.json();
    if (!data.success) return;

    const tbody = document.getElementById('openPositionsTable');
    document.getElementById('liveOpenBadge').textContent = `${data.positions.length} Active`;

    if (data.positions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-600">No active floating positions</td></tr>';
        return;
    }

    tbody.innerHTML = data.positions.map(p => `
        <tr class="hover:bg-gray-800/50 transition-colors duration-200">
            <td class="p-2.5"><span class="font-semibold text-white">${p.ea_name}</span><br><span class="text-[10px] text-gray-500">#${p.account_number}</span></td>
            <td class="p-2.5 font-bold text-gray-200">${p.symbol}</td>
            <td class="p-2.5"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${p.trade_type === 'BUY' ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/25' : 'bg-amber-500/15 text-amber-400 border border-amber-500/25'}">${p.trade_type}</span></td>
            <td class="p-2.5 font-mono text-gray-300">${p.volume}</td>
            <td class="p-2.5 font-mono text-gray-300">${p.open_price}</td>
            <td class="p-2.5 text-right font-mono font-bold ${(p.profit + p.swap) >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(p.profit + p.swap)}</td>
        </tr>
    `).join('');
}

// ═══════════════════════════════════════════════
// 8. EA LEADERBOARD TABLE
// ═══════════════════════════════════════════════
async function fetchEALeaderboard() {
    const res = await fetch('/api/eas');
    const data = await res.json();
    if (!data.success) return;

    const container = document.getElementById('eaLeaderboardBody');
    if (!container) return;

    if (data.eas.length === 0) {
        container.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-gray-600">No EA data available yet</td></tr>';
        return;
    }

    const sorted = [...data.eas].sort((a, b) => b.total_pnl - a.total_pnl);

    container.innerHTML = sorted.map((ea, index) => {
        const winRate = ea.total_trades > 0 ? ((ea.wins / ea.total_trades) * 100).toFixed(1) : '0.0';
        const isProfit = ea.total_pnl >= 0;
        const rankEmoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;
        const avgTrade = ea.total_trades > 0 ? ea.total_pnl / ea.total_trades : 0;

        return `
            <tr class="hover:bg-gray-800/50 transition-all duration-200 border-b border-gray-800/40">
                <td class="p-3 text-center"><span class="text-lg">${rankEmoji}</span></td>
                <td class="p-3">
                    <div class="flex items-center gap-3">
                        <div class="w-3 h-3 rounded-full" style="background: ${ea.color}; box-shadow: 0 0 10px ${ea.color}55;"></div>
                        <div>
                            <span class="font-bold text-white text-sm">${ea.ea_name}</span>
                            <br><span class="text-[10px] text-gray-500 font-mono">Magic: ${ea.magic_number}</span>
                        </div>
                    </div>
                </td>
                <td class="p-3 text-right font-mono font-bold text-sm ${isProfit ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(ea.total_pnl)}</td>
                <td class="p-3 text-center font-mono text-sm text-gray-300">${ea.total_trades}</td>
                <td class="p-3 text-center">
                    <span class="text-emerald-400 font-semibold">${ea.wins}</span>
                    <span class="text-gray-600 mx-1">/</span>
                    <span class="text-rose-400 font-semibold">${ea.losses}</span>
                </td>
                <td class="p-3 text-center">
                    <div class="flex items-center justify-center gap-2">
                        <div class="w-16 bg-gray-800 rounded-full h-2 overflow-hidden">
                            <div class="h-2 rounded-full transition-all duration-700 ${Number(winRate) >= 50 ? 'bg-gradient-to-r from-emerald-500 to-cyan-400' : 'bg-gradient-to-r from-rose-500 to-orange-400'}" style="width: ${winRate}%"></div>
                        </div>
                        <span class="text-xs font-bold ${Number(winRate) >= 50 ? 'text-emerald-400' : 'text-rose-400'}">${winRate}%</span>
                    </div>
                </td>
                <td class="p-3 text-right font-mono text-xs ${avgTrade >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(avgTrade)}</td>
                <td class="p-3 text-right font-mono text-xs ${ea.open_pnl >= 0 ? 'text-cyan-400' : 'text-rose-400'}">${formatUSD(ea.open_pnl)}</td>
            </tr>
        `;
    }).join('');
}
