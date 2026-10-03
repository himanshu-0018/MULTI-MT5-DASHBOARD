// MT5 Dashboard State
let currentAccount = 'all';
let currentMagic = 'all';
let calendarDate = new Date();
let equityChart = null;
let eaChart = null;

// Currency Formatter
const formatUSD = (num) => {
    const val = Number(num) || 0;
    const sign = val >= 0 ? '+$' : '-$';
    return sign + Math.abs(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatPlainUSD = (num) => {
    const val = Number(num) || 0;
    return '$' + val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Initialize Dashboard
document.addEventListener('DOMContentLoaded', async () => {
    lucide.createIcons();
    initFilters();
    initCharts();
    await refreshDashboard();

    // Auto-refresh every 5 seconds for live updates
    setInterval(refreshDashboard, 5000);
});

// Setup Filter Listeners
function initFilters() {
    const accSelect = document.getElementById('accountFilter');
    const magicSelect = document.getElementById('magicFilter');

    accSelect.addEventListener('change', (e) => {
        currentAccount = e.target.value;
        refreshDashboard();
    });

    magicSelect.addEventListener('change', (e) => {
        currentMagic = e.target.value;
        refreshDashboard();
    });
}

// Master Refresh Function
async function refreshDashboard() {
    try {
        await Promise.all([
            fetchOverview(),
            fetchAccountsList(),
            fetchEAList(),
            fetchEquityChart(),
            fetchCalendarData(),
            fetchOpenPositions()
        ]);
        document.getElementById('lastUpdated').textContent = new Date().toLocaleTimeString();
        lucide.createIcons();
    } catch (err) {
        console.error('Refresh error:', err);
    }
}

// 1. Fetch Overview KPIs
async function fetchOverview() {
    const res = await fetch(`/api/overview?account=${currentAccount}&magic=${currentMagic}`);
    const data = await res.json();
    if (!data.success) return;

    // Balance & Equity
    document.getElementById('totalBalance').textContent = formatPlainUSD(data.total_balance);
    document.getElementById('totalEquity').textContent = formatPlainUSD(data.total_equity);
    document.getElementById('accountCountBadge').textContent = `${data.total_accounts} Accs`;

    // Today PnL
    const todayEl = document.getElementById('todayPnl');
    todayEl.textContent = formatUSD(data.today_pnl);
    todayEl.className = `text-2xl font-bold tracking-tight ${data.today_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;

    // Floating PnL
    const floatEl = document.getElementById('floatingPnl');
    floatEl.textContent = formatUSD(data.floating_pnl);
    floatEl.className = `font-semibold ${data.floating_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
    document.getElementById('openCount').textContent = data.open_trades_count;

    // Month & Total PnL
    const monthEl = document.getElementById('monthPnl');
    monthEl.textContent = formatUSD(data.month_pnl);
    monthEl.className = `text-2xl font-bold tracking-tight ${data.month_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
    document.getElementById('totalClosedPnl').textContent = formatUSD(data.total_closed_profit);

    // Performance
    document.getElementById('winRate').textContent = `${data.win_rate}%`;
    document.getElementById('profitFactor').textContent = data.profit_factor;
    document.getElementById('totalTradesCount').textContent = `${data.total_trades} (${data.wins}W / ${data.losses}L)`;
}

// 2. Fetch Accounts (populate cards & dropdown)
async function fetchAccountsList() {
    const res = await fetch('/api/accounts');
    const data = await res.json();
    if (!data.success) return;

    const select = document.getElementById('accountFilter');
    const grid = document.getElementById('accountsGrid');

    // Update dropdown if count changed
    const currentSelected = select.value;
    select.innerHTML = '<option value="all">🌐 All Accounts (Collective)</option>';
    data.accounts.forEach(acc => {
        const opt = document.createElement('option');
        opt.value = acc.account_number;
        opt.textContent = `${acc.account_number} - ${acc.account_name || acc.broker}`;
        if (opt.value === currentSelected) opt.selected = true;
        select.appendChild(opt);
    });

    // Populate Account Cards
    if (data.accounts.length === 0) {
        grid.innerHTML = '<div class="col-span-2 text-center py-6 text-gray-500 text-sm">No MT5 terminals connected yet. Install EA to sync.</div>';
        return;
    }

    grid.innerHTML = data.accounts.map(acc => `
        <div class="bg-gray-900/80 border border-gray-800 p-4 rounded-xl hover:border-gray-700 transition">
            <div class="flex justify-between items-start mb-2">
                <div>
                    <h3 class="font-bold text-sm text-white">${acc.account_name || 'Account #' + acc.account_number}</h3>
                    <p class="text-xs text-gray-400">${acc.broker || 'MT5 Terminal'} • #${acc.account_number}</p>
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
                    <span class="text-[10px] text-gray-500 uppercase block">Today PnL</span>
                    <span class="font-semibold text-sm ${acc.today_profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(acc.today_profit)}</span>
                </div>
            </div>
        </div>
    `).join('');
}

// 3. Fetch EAs List (populate dropdown & horizontal bar chart)
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

    // Update EA chart
    if (eaChart) {
        const categories = data.eas.map(e => e.ea_name);
        const seriesData = data.eas.map(e => Number(e.total_pnl.toFixed(2)));
        const colors = seriesData.map(v => v >= 0 ? '#10b981' : '#ef4444');

        eaChart.updateOptions({
            series: [{ name: 'Strategy Net P&L', data: seriesData }],
            xaxis: { categories: categories },
            colors: colors
        });
    }
}

// 4. Initialize ApexCharts
function initCharts() {
    // 4.1 Equity Curve
    const equityOptions = {
        chart: {
            type: 'area',
            height: 300,
            background: 'transparent',
            toolbar: { show: false },
            zoom: { enabled: false }
        },
        theme: { mode: 'dark' },
        stroke: { curve: 'smooth', width: 3 },
        colors: ['#06b6d4'],
        fill: {
            type: 'gradient',
            gradient: {
                shadeIntensity: 1,
                opacityFrom: 0.45,
                opacityTo: 0.02,
                stops: [0, 90, 100]
            }
        },
        dataLabels: { enabled: false },
        grid: { borderColor: '#1f2937', strokeDashArray: 4 },
        xaxis: {
            type: 'datetime',
            labels: { style: { colors: '#9ca3af', fontSize: '11px' } },
            axisBorder: { show: false },
            axisTicks: { show: false }
        },
        yaxis: {
            labels: {
                style: { colors: '#9ca3af', fontSize: '11px' },
                formatter: (val) => '$' + val.toFixed(0)
            }
        },
        tooltip: {
            theme: 'dark',
            x: { format: 'dd MMM yyyy HH:mm' },
            y: { formatter: (val) => formatUSD(val) }
        },
        series: [{ name: 'Cumulative Profit', data: [] }]
    };
    equityChart = new ApexCharts(document.querySelector("#equityChart"), equityOptions);
    equityChart.render();

    // 4.2 EA Comparison Bar
    const eaOptions = {
        chart: {
            type: 'bar',
            height: 300,
            background: 'transparent',
            toolbar: { show: false }
        },
        theme: { mode: 'dark' },
        plotOptions: {
            bar: {
                borderRadius: 4,
                horizontal: true,
                distributed: true,
                dataLabels: { position: 'top' }
            }
        },
        legend: { show: false },
        grid: { borderColor: '#1f2937' },
        xaxis: {
            labels: {
                style: { colors: '#9ca3af' },
                formatter: (val) => '$' + val
            }
        },
        yaxis: { labels: { style: { colors: '#d1d5db', fontSize: '11px' } } },
        tooltip: {
            theme: 'dark',
            y: { formatter: (val) => formatUSD(val) }
        },
        series: [{ name: 'Profit', data: [] }]
    };
    eaChart = new ApexCharts(document.querySelector("#eaChart"), eaOptions);
    eaChart.render();
}

// 5. Fetch Equity Curve Data
async function fetchEquityChart() {
    const res = await fetch(`/api/charts/equity-curve?account=${currentAccount}&magic=${currentMagic}`);
    const data = await res.json();
    if (!data.success || !equityChart) return;

    const seriesData = data.curve.map(pt => [new Date(pt.time).getTime(), pt.cumulative_profit]);
    equityChart.updateSeries([{ name: 'Cumulative Profit', data: seriesData }]);
}

// 6. Interactive Calendar Logic
async function fetchCalendarData() {
    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth() + 1;

    const res = await fetch(`/api/calendar?year=${year}&month=${month}&account=${currentAccount}&magic=${currentMagic}`);
    const data = await res.json();
    if (!data.success) return;

    // Update Header
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    document.getElementById('calendarCurrentMonth').textContent = `${monthNames[calendarDate.getMonth()]} ${year}`;
    
    const monthTotalEl = document.getElementById('calendarMonthTotal');
    monthTotalEl.textContent = formatUSD(data.month_total_pnl);
    monthTotalEl.className = `font-bold ${data.month_total_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;

    // Map profits by Day: { '2025-03-01': { profit: 150, count: 3 } }
    const dayMap = {};
    data.days.forEach(d => {
        dayMap[d.date] = d;
    });

    const grid = document.getElementById('calendarGrid');
    grid.innerHTML = '';

    const firstDay = new Date(year, month - 1, 1).getDay(); // 0 = Sun
    const startingOffset = (firstDay === 0 ? 6 : firstDay - 1); // Monday start
    const daysInMonth = new Date(year, month, 0).getDate();

    // Leading empty slots
    for (let i = 0; i < startingOffset; i++) {
        grid.innerHTML += '<div class="h-20 bg-gray-900/20 border border-gray-800/40 rounded-xl opacity-25"></div>';
    }

    // Month Days
    for (let day = 1; day <= daysInMonth; day++) {
        const dayStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayData = dayMap[dayStr];
        const isToday = dayStr === new Date().toISOString().slice(0, 10);

        if (dayData) {
            const isProfit = dayData.profit >= 0;
            grid.innerHTML += `
                <div class="h-20 p-2 rounded-xl border ${isProfit ? 'bg-emerald-950/20 border-emerald-500/30' : 'bg-rose-950/20 border-rose-500/30'} flex flex-col justify-between transition hover:scale-[1.02]">
                    <div class="flex justify-between items-center">
                        <span class="text-xs font-semibold ${isToday ? 'text-cyan-400 font-bold' : 'text-gray-400'}">${day}</span>
                        <span class="text-[9px] px-1.5 py-0.2 rounded font-mono ${isProfit ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}">${dayData.trades_count}t</span>
                    </div>
                    <div class="text-right">
                        <span class="text-xs sm:text-sm font-bold block ${isProfit ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(dayData.profit)}</span>
                    </div>
                </div>
            `;
        } else {
            grid.innerHTML += `
                <div class="h-20 p-2 rounded-xl bg-gray-900/40 border border-gray-800/80 flex flex-col justify-between">
                    <span class="text-xs font-medium ${isToday ? 'text-cyan-400 font-bold' : 'text-gray-500'}">${day}</span>
                    <span class="text-[11px] text-gray-600 text-right">-</span>
                </div>
            `;
        }
    }
}

function changeMonth(delta) {
    calendarDate.setMonth(calendarDate.getMonth() + delta);
    fetchCalendarData();
}

// 7. Live Open Positions Table
async function fetchOpenPositions() {
    const res = await fetch(`/api/open-positions?account=${currentAccount}&magic=${currentMagic}`);
    const data = await res.json();
    if (!data.success) return;

    const tbody = document.getElementById('openPositionsTable');
    document.getElementById('liveOpenBadge').textContent = `${data.positions.length} Active`;

    if (data.positions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-6 text-gray-500">No active floating positions</td></tr>';
        return;
    }

    tbody.innerHTML = data.positions.map(p => `
        <tr class="hover:bg-gray-800/50 transition">
            <td class="p-2.5 font-medium text-white">${p.ea_name}<br><span class="text-[10px] text-gray-400">#${p.account_number}</span></td>
            <td class="p-2.5 font-bold">${p.symbol}</td>
            <td class="p-2.5"><span class="px-2 py-0.5 rounded text-[10px] font-bold ${p.trade_type === 'BUY' ? 'bg-blue-500/20 text-blue-400' : 'bg-amber-500/20 text-amber-400'}">${p.trade_type}</span></td>
            <td class="p-2.5 font-mono">${p.volume}</td>
            <td class="p-2.5 font-mono">${p.open_price}</td>
            <td class="p-2.5 text-right font-mono font-bold ${p.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(p.profit + p.swap)}</td>
        </tr>
    `).join('');
}
