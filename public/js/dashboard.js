// ═══════════════════════════════════════════════════════════════
// MT5 COMMAND CENTER — ADVANCED FRONTEND TELEMETRY ENGINE
// ═══════════════════════════════════════════════════════════════

let currentProfileId = '1'; // Default to "Main" profile (ID 1)
let currentAccount = 'all';
let currentMagic = 'all';

// Initialize default range as Current Month (from 1st of month to today)
const todayInit = new Date();
const initYear = todayInit.getFullYear();
const initMonth = String(todayInit.getMonth() + 1).padStart(2, '0');
const initDay = String(todayInit.getDate()).padStart(2, '0');

let currentFrom = `${initYear}-${initMonth}-01`; 
let currentTo = `${initYear}-${initMonth}-${initDay}`; 

let calendarDate = new Date();
let usingMock = false;

// ─── NEW SECURITY & PROFILE STATE VARIABLES ───
let shareToken = null;
let isSharedView = false;
let sharedRestrictions = null;
let firstLoad = true;

// ─── EXTRACT SHARE TOKEN FROM URL PATH ───
// Matches patterns like /share/a5b6c7...
const pathSegments = window.location.pathname.split('/');
const shareIndex = pathSegments.indexOf('share');
if (shareIndex !== -1 && pathSegments[shareIndex + 1]) {
    shareToken = pathSegments[shareIndex + 1];
    isSharedView = true;
}

// ─── DATE RANGE HELPERS ───
function toYMD(d) { 
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); 
    return z.toISOString().slice(0, 10); 
}

function dateParams() { 
    const q = []; 
    if (currentFrom) q.push('from=' + currentFrom); 
    if (currentTo) q.push('to=' + currentTo); 
    return q; 
}

function rangeInfo() {
    if (!currentFrom && !currentTo) return { days: null };
    const from = currentFrom ? new Date(currentFrom) : null;
    const to = currentTo ? new Date(currentTo) : new Date();
    const days = from ? Math.max(1, Math.round((to - from) / 86400000) + 1) : null;
    return { days };
}

function rangeFactor() { 
    const { days } = rangeInfo(); 
    return days == null ? 1 : Math.min(Math.max(days / 90, 0.04), 1); 
}

function applyRangeToEAs(list) {
    const f = rangeFactor(); 
    if (f >= 1) return list;
    return list.map((e) => ({ 
        ...e, 
        total_pnl: +(e.total_pnl * f).toFixed(2), 
        total_trades: Math.max(1, Math.round(e.total_trades * f)), 
        wins: Math.round(e.wins * f), 
        losses: Math.round(e.losses * f) 
    }));
}

// ─── FORMATTERS ───
const formatUSD = (num) => {
    const v = Number(num) || 0;
    return (v >= 0 ? '+$' : '-$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatPlainUSD = (num) => '$' + (Number(num) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const compact = (v) => Math.abs(v) >= 1000 ? '$' + (v / 1000).toFixed(1) + 'k' : '$' + v.toFixed(0);

const $ = (id) => document.getElementById(id);

// ─── SECURE API FETCH ───
// Intercepts query paths and appends active share token parameters
async function api(path) {
    try {
        let separator = path.includes('?') ? '&' : '?';
        let url = '/api' + path;
        
        if (shareToken) {
            url += separator + 'share_token=' + shareToken;
        }
        
        const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (res.status === 403 || res.status === 401) {
            if (isSharedView) {
                alert('This secure share link has been revoked or is invalid.');
                return null;
            }
        }
        if (!res.ok) throw new Error('Bad network response');
        const data = await res.json();
        if (data && data.success === false) throw new Error('API request failed');
        return data;
    } catch (e) {
        usingMock = true;
        return null;
    }
}

// ═══════════════════════════════════════════════════════════════
// DEMO / MOCK FALLBACK DATA (only used when /api is offline)
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
    { account_number: '5017842', account_name: 'Apollo Prime', broker: 'IC Markets', balance: 48250, equity: 49120, today_profit: 870, open_count: 3, floating_pnl: 870, profile_id: 1, pending_count: 2 },
    { account_number: '3390127', account_name: 'Vega Challenge', broker: 'FTMO', balance: 100000, equity: 103250, today_profit: 3250, open_count: 5, floating_pnl: 3250, profile_id: 1, pending_count: 4 },
    { account_number: '7781005', account_name: 'Helios Fund', broker: 'Pepperstone', balance: 32100, equity: 31640, today_profit: -460, open_count: 2, floating_pnl: -460, profile_id: 1, pending_count: 1 },
    { account_number: '2204556', account_name: 'Orion Swing', broker: 'Exness', balance: 15600, equity: 15820, today_profit: 220, open_count: 1, floating_pnl: 220, profile_id: 1, pending_count: 0 },
    { account_number: '9918234', account_name: 'Nova Grid', broker: 'Tickmill', balance: 27400, equity: 26980, today_profit: -420, open_count: 4, floating_pnl: -420, profile_id: 1, pending_count: 3 },
    { account_number: '8810243', account_name: 'Alpha Sandbox', broker: 'Darwinex', balance: 5000, equity: 4900, today_profit: -100, open_count: 2, floating_pnl: -50, profile_id: 2, pending_count: 2 }
];

function mockOverview() {
    const eas = filterEAs(applyRangeToEAs(MOCK_EAS));
    const accs = filterAccounts(MOCK_ACCOUNTS);
    const wins = eas.reduce((a, e) => a + e.wins, 0);
    const losses = eas.reduce((a, e) => a + e.losses, 0);
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

function buildFullCurve() {
    const pts = []; 
    const days = 90; 
    const target = MOCK_EAS.reduce((a, e) => a + e.total_pnl, 0);
    let cum = 0, seed = 42; 
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const now = Date.now();
    for (let i = days; i >= 0; i--) {
        const t = now - i * 86400000; 
        const p = (days - i) / days;
        cum = Math.max(0, target * (p - Math.pow(p, 1.8) * 0.15) + (rand() - 0.42) * 2600);
        pts.push({ time: t, cumulative_profit: Math.round(cum) });
    }
    pts[pts.length - 1].cumulative_profit = Math.round(target);
    return pts;
}

function mockCurve() {
    const full = buildFullCurve();
    const info = rangeInfo();
    if (info.days == null) return full;
    let pts;
    if (currentFrom) {
        const fromT = new Date(currentFrom).getTime();
        const toT = (currentTo ? new Date(currentTo).getTime() : Date.now()) + 86400000;
        pts = full.filter((p) => p.time >= fromT && p.time <= toT);
    } else {
        pts = full.slice(-info.days);
    }
    if (pts.length < 2) pts = full.slice(-2);
    const base = pts[0].cumulative_profit;
    return pts.map((p) => ({ time: p.time, cumulative_profit: p.cumulative_profit - base }));
}

function mockCalendar(year, month) {
    const dim = new Date(year, month, 0).getDate(); 
    const days = []; 
    let total = 0;
    let seed = year * 100 + month; 
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const today = new Date();
    for (let d = 1; d <= dim; d++) {
        const date = new Date(year, month - 1, d); 
        if (date > today) continue;
        const dow = date.getDay(); 
        if ((dow === 0 || dow === 6) && rand() > 0.15) continue;
        if (rand() < 0.28) continue;
        const prof = rand() > 0.38; 
        const mag = Math.round(rand() * (prof ? 1600 : 950)) + 40;
        const profit = prof ? mag : -mag; 
        const trades = Math.floor(rand() * 18) + 2;
        const wins = prof ? Math.ceil(trades * (0.55 + rand() * 0.3)) : Math.floor(trades * (0.2 + rand() * 0.25));
        total += profit;
        days.push({ 
            date: `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`, 
            profit, 
            trades_count: trades, 
            wins, 
            losses: trades - wins 
        });
    }
    return { success: true, month_total_pnl: total, days };
}

function mockPositions() {
    const syms = ['XAUUSD', 'EURUSD', 'GBPJPY', 'US30', 'NAS100', 'BTCUSD', 'USDJPY', 'AUDUSD'];
    const out = []; 
    let seed = 7; 
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    MOCK_ACCOUNTS.forEach((acc) => {
        for (let i = 0; i < acc.open_count; i++) {
            const ea = MOCK_EAS[Math.floor(rand() * MOCK_EAS.length)];
            out.push({ 
                account_number: acc.account_number, 
                ea_name: ea.ea_name, 
                magic_number: ea.magic_number,
                symbol: syms[Math.floor(rand() * syms.length)], 
                trade_type: rand() > 0.5 ? 'BUY' : 'SELL',
                volume: (Math.floor(rand() * 20) / 10 + 0.1).toFixed(2), 
                open_price: (1000 + rand() * 2000).toFixed(2),
                profit: Math.round((rand() - 0.42) * 900 * 100) / 100, 
                swap: Math.round((rand() - 0.5) * 20) / 10 
            });
        }
    });
    return out;
}

function mockPendingOrders() {
    const syms = ['XAUUSD', 'EURUSD', 'US30', 'NAS100'];
    const types = ['BUY_LIMIT', 'SELL_LIMIT', 'BUY_STOP', 'SELL_STOP'];
    const out = []; 
    let seed = 12; 
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    MOCK_ACCOUNTS.forEach((acc) => {
        for (let i = 0; i < acc.pending_count; i++) {
            const ea = MOCK_EAS[Math.floor(rand() * MOCK_EAS.length)];
            out.push({
                account_number: acc.account_number,
                ea_name: ea.ea_name,
                magic_number: ea.magic_number,
                symbol: syms[Math.floor(rand() * syms.length)],
                order_type: types[Math.floor(rand() * types.length)],
                volume: (Math.floor(rand() * 10) / 10 + 0.1).toFixed(2),
                price_open: (1100 + rand() * 1800).toFixed(2),
                price_current: (1100 + rand() * 1800).toFixed(2),
                sl: 0, tp: 0,
                setup_time: '2025-03-01 12:00:00',
                expiration: ''
            });
        }
    });
    return out;
}

// Filter mock items based on selected Profile & Accounts
const filterAccounts = (list) => {
    let pool = list;
    if (isSharedView && sharedRestrictions) {
        if (sharedRestrictions.account_number) {
            return pool.filter(a => String(a.account_number) === String(sharedRestrictions.account_number));
        } else if (sharedRestrictions.profile_id) {
            return pool.filter(a => Number(a.profile_id) === Number(sharedRestrictions.profile_id));
        }
    } else {
        pool = pool.filter((a) => Number(a.profile_id) === Number(currentProfileId));
    }
    return currentAccount === 'all' ? pool : pool.filter((a) => String(a.account_number) === String(currentAccount));
};

const filterEAs = (list) => currentMagic === 'all' ? list : list.filter((e) => String(e.magic_number) === String(currentMagic));

const filterPositions = (list) => {
    return list.filter((p) => {
        const matchAcc = isSharedView && sharedRestrictions 
            ? (sharedRestrictions.account_number ? String(p.account_number) === String(sharedRestrictions.account_number) : true)
            : (currentAccount === 'all' ? true : String(p.account_number) === String(currentAccount));
        const matchMagic = currentMagic === 'all' ? true : String(p.magic_number) === String(currentMagic);
        return matchAcc && matchMagic;
    });
};

// ═══════════════════════════════════════════════════════════════
// BACKGROUND ANIMATION
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
    const canvas = $('stars'); 
    if (!canvas) return;
    const ctx = canvas.getContext('2d'); 
    const DPR = Math.min(devicePixelRatio || 1, 2);
    let w, h, stars;
    const resize = () => {
        w = canvas.width = innerWidth * DPR; 
        h = canvas.height = innerHeight * DPR;
        canvas.style.width = innerWidth + 'px'; 
        canvas.style.height = innerHeight + 'px';
        const count = Math.floor((innerWidth * innerHeight) / 11000);
        stars = Array.from({ length: count }, () => ({ 
            x: Math.random() * w, 
            y: Math.random() * h, 
            z: Math.random() * 0.8 + 0.2, 
            r: Math.random() * 1.4 * DPR + 0.3, 
            tw: Math.random() * Math.PI * 2 
        }));
    };
    resize(); 
    addEventListener('resize', resize);
    (function draw() {
        ctx.clearRect(0, 0, w, h);
        for (const s of stars) {
            s.y += s.z * 0.12 * DPR; 
            s.tw += 0.02; 
            if (s.y > h) s.y = 0;
            const a = 0.35 + Math.sin(s.tw) * 0.35; 
            const hue = s.z > 0.7 ? '180,230,255' : '150,180,255';
            ctx.beginPath(); 
            ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); 
            ctx.fillStyle = `rgba(${hue},${a})`; 
            ctx.fill();
        }
        requestAnimationFrame(draw);
    })();
}

// ─── Value Count Up Animation ───
function animateValue(el, end, { decimals = 0, prefix = '', suffix = '', duration = 1600 } = {}) {
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fmt = (v) => prefix + v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix;
    if (reduced) { el.textContent = fmt(end); return; }
    const t0 = performance.now();
    (function tick(now) {
        const p = Math.min((now - t0) / duration, 1); 
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = fmt(end * eased);
        if (p < 1) requestAnimationFrame(tick); else el.textContent = fmt(end);
    })(performance.now());
}

function updateHero(id, value, { decimals = 0, prefix = '', suffix = '' } = {}) {
    const el = $(id); 
    if (!el) return;
    if (firstLoad) { 
        animateValue(el, value, { decimals, prefix, suffix }); 
    } else { 
        el.textContent = prefix + Number(value).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) + suffix; 
    }
}

// ─── Typing headline animation ───
function typeHeadline(text) {
    const el = $('typed'); 
    if (!el) return; 
    let i = 0;
    const id = setInterval(() => {
        i++; 
        el.textContent = text.slice(0, i);
        if (i >= text.length) { 
            clearInterval(id); 
            setTimeout(() => { 
                const c = $('typeCaret'); 
                if (c) c.style.display = 'none'; 
            }, 1200); 
        }
    }, 90);
}

// ─── Scroll Reveal Init ───
function initReveal() {
    const obs = new IntersectionObserver((entries) => {
        entries.forEach((en) => { 
            if (en.isIntersecting) { 
                en.target.classList.add('visible'); 
                obs.unobserve(en.target); 
            } 
        });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    document.querySelectorAll('.reveal').forEach((n) => obs.observe(n));
}


// ═══════════════════════════════════════════════════════════════
// INITIALIZATION ENTRYPOINT
// ═══════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
    lucide.createIcons();
    initBackground();
    initReveal();
    typeHeadline('Center');

    // Attach Event Listeners
    $('accountFilter').addEventListener('change', (e) => { currentAccount = e.target.value; refreshDashboard(); });
    $('magicFilter').addEventListener('change', (e) => { currentMagic = e.target.value; refreshDashboard(); });
    $('profileFilter').addEventListener('change', (e) => { currentProfileId = e.target.value; currentAccount = 'all'; refreshDashboard(); });
    
    initRangeFilter();
    initInteractiveModals();
    initEAEditEventDelegation();

    // Determine security state
    if (isSharedView) {
        // Shared view hides administrative tools and overrides profile drop-downs
        $('profileSelectorWrap').classList.add('hidden');
        $('btnOpenShare').classList.add('hidden');
        $('btnOpenAdmin').classList.add('hidden');
        $('navSyncLabel').textContent = 'Secure Shared Link View';
        
        const validated = await validateShareToken();
        if (validated) {
            await refreshDashboard(false, true);
        }
    } else {
        // Regular view enforces Master Passcode validation check
        const authStatus = await api('/auth/status');
        if (authStatus && authStatus.passcode_set) {
            // Check if authenticated in current browser session
            if (sessionStorage.getItem('dashboard_authenticated') === 'true') {
                await loadAdminAndRun();
            } else {
                $('lockScreen').classList.remove('hidden');
                $('loader').classList.add('hidden');
            }
        } else {
            await loadAdminAndRun();
        }
    }

    // Secondary removal of initial loaders
    setTimeout(() => {
        const loader = $('loader');
        if (loader && !loader.classList.contains('hidden')) {
            loader.classList.add('hidden');
        }
    }, 1800);

    // Periodic synchronization thread
    setInterval(() => refreshDashboard(), 5000);
});

async function validateShareToken() {
    const d = await api(`/share/validate/${shareToken}`);
    if (d && d.success) {
        sharedRestrictions = d;
        if (d.from_date) {
            currentFrom = d.from_date;
            // Force Range Select UI to match shared constraints
            const opt = document.createElement('option');
            opt.value = 'shared_restricted';
            opt.textContent = `From ${d.from_date} (Locked)`;
            opt.selected = true;
            $('rangeFilter').appendChild(opt);
            $('rangeFilter').disabled = true;
        }
        return true;
    }
    return false;
}

async function loadAdminAndRun() {
    await fetchProfiles();
    await refreshDashboard(false, true);
    setTimeout(() => $('loader').classList.add('hidden'), 1000);
}

// ─── VERIFY MASTER PASSCODE ───
$('btnVerifyPasscode').addEventListener('click', async () => {
    const passcode = $('passcodeInput').value;
    try {
        const res = await fetch('/api/auth/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ passcode })
        });
        const d = await res.json();
        if (d && d.success) {
            sessionStorage.setItem('dashboard_authenticated', 'true');
            $('lockScreen').classList.add('opacity-0');
            setTimeout(() => $('lockScreen').classList.add('hidden'), 500);
            await loadAdminAndRun();
        } else {
            showLockError();
        }
    } catch (e) {
        showLockError();
    }
});

function showLockError() {
    $('lockError').classList.remove('hidden');
    $('passcodeInput').value = '';
    $('passcodeInput').focus();
}

// ─── INITIALIZE RANGE FILTER SELECTOR ───
function initRangeFilter() {
    const sel = $('rangeFilter'); 
    const custom = $('customRange');
    sel.addEventListener('change', (e) => {
        const v = e.target.value; 
        const today = new Date();
        if (v === 'custom') {
            custom.classList.remove('hidden'); 
            custom.classList.add('flex');
            $('toDate').value = toYMD(today);
            const f = new Date(today); 
            f.setDate(f.getDate() - 30); 
            $('fromDate').value = toYMD(f);
            return;
        }
        custom.classList.add('hidden'); 
        custom.classList.remove('flex');
        if (v === 'all') { 
            currentFrom = null; 
            currentTo = null; 
        } else if (v === 'current_month') {
            const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
            currentFrom = toYMD(firstDay);
            currentTo = toYMD(today);
        } else if (v === '7d') { 
            const f = new Date(today); 
            f.setDate(f.getDate() - 6); 
            currentFrom = toYMD(f); 
            currentTo = toYMD(today); 
        } else if (v === '30d') { 
            const f = new Date(today); 
            f.setDate(f.getDate() - 29); 
            currentFrom = toYMD(f); 
            currentTo = toYMD(today); 
        }
        refreshDashboard();
    });
    $('applyRange').addEventListener('click', () => {
        currentFrom = $('fromDate').value || null;
        currentTo = $('toDate').value || null;
        refreshDashboard();
    });
}

// ─── MODAL CONTROLLERS & SECURE CONSOLE LOGS ───
function initInteractiveModals() {
    const toggleModal = (modalId, show) => {
        const modal = $(modalId);
        if (modal) {
            if (show) modal.classList.remove('hidden');
            else modal.classList.add('hidden');
        }
    };

    // Share link consoles
    $('btnOpenShare').addEventListener('click', () => {
        toggleModal('shareModal', true);
        loadSharingConsole();
    });
    $('btnCloseShare').addEventListener('click', () => toggleModal('shareModal', false));

    // Admin configuration consoles
    $('btnOpenAdmin').addEventListener('click', () => {
        toggleModal('adminModal', true);
        loadAdminConsole();
    });
    $('btnCloseAdmin').addEventListener('click', () => toggleModal('adminModal', false));

    // Rename strategy windows
    $('btnCloseRename').addEventListener('click', () => toggleModal('renameModal', false));

    // Passcode updater inside Admin console
    $('btnChangePasscode').addEventListener('click', async () => {
        const old_passcode = $('adminOldPass').value;
        const new_passcode = $('adminNewPass').value;
        const errEl = $('adminPassError');
        const msgEl = $('adminPassMessage');
        errEl.classList.add('hidden');
        msgEl.classList.add('hidden');

        try {
            const res = await fetch('/api/auth/change-passcode', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ old_passcode, new_passcode })
            });
            const d = await res.json();
            if (d && d.success) {
                msgEl.classList.remove('hidden');
                $('adminOldPass').value = '';
                $('adminNewPass').value = '';
            } else {
                errEl.textContent = d.error || 'Error changing passcode';
                errEl.classList.remove('hidden');
            }
        } catch (e) {
            errEl.textContent = 'Server communications error.';
            errEl.classList.remove('hidden');
        }
    });

    // Create profile process
    $('btnCreateProfile').addEventListener('click', async () => {
        const name = $('newProfileName').value;
        if (!name) return;
        try {
            const res = await fetch('/api/profiles', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            const d = await res.json();
            if (d && d.success) {
                $('newProfileName').value = '';
                await fetchProfiles();
                await loadAdminConsole();
            } else {
                alert(d.error || 'Error creating profile');
            }
        } catch (e) {
            console.error(e);
        }
    });

    // Share generator process
    $('btnGenerateShare').addEventListener('click', async () => {
        const label = $('shareLabel').value || 'Shared Dashboard';
        const from_date = $('shareFromDate').value || null;
        const profile_id = $('shareProfileSelect').value || null;
        const account_number = $('shareAccountSelect').value || null;

        try {
            const res = await fetch('/api/share/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label, from_date, profile_id, account_number })
            });
            const d = await res.json();
            if (d && d.success) {
                $('shareResultBox').classList.remove('hidden');
                $('shareResultUrl').value = d.share_url;
                loadSharingConsole();
            }
        } catch (e) {
            console.error(e);
        }
    });

    $('btnCopyShare').addEventListener('click', () => {
        $('shareResultUrl').select();
        document.execCommand('copy');
        $('btnCopyShare').textContent = 'Copied!';
        setTimeout(() => $('btnCopyShare').textContent = 'Copy', 1500);
    });

    // Save customized strategy details (rename modal)
    $('btnSaveRename').addEventListener('click', async () => {
        const magic_number = $('renameMagicNumber').value;
        const ea_name = $('renameNameInput').value;
        const color = $('renameColorInput').value;
        const description = $('renameDescInput').value;

        try {
            const res = await fetch('/api/ea-registry', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ magic_number, ea_name, color, description })
            });
            const d = await res.json();
            if (d && d.success) {
                toggleModal('renameModal', false);
                await refreshDashboard(true);
            }
        } catch (e) {
            console.error(e);
        }
    });
}

// ─── EVENT DELEGATION TO CATCH CLICKS ON MAGIC NUMBERS ───
function initEAEditEventDelegation() {
    document.addEventListener('click', (e) => {
        const target = e.target.closest('.rename-magic');
        if (target) {
            const magic = target.getAttribute('data-magic');
            const name = target.getAttribute('data-name') || '';
            const color = target.getAttribute('data-color') || '#3b82f6';
            const desc = target.getAttribute('data-desc') || '';
            
            if (isSharedView) return; // Read-only viewing restriction
            
            $('renameMagicNumber').value = magic;
            $('renameMagicDisplay').textContent = magic;
            $('renameNameInput').value = name;
            $('renameColorInput').value = color;
            $('renameDescInput').value = desc;
            
            $('renameModal').classList.remove('hidden');
        }
    });
}

// ─── ADMIN CONSOLE RENDERS ───
async function loadAdminConsole() {
    const accountResponse = await api('/accounts');
    const profileResponse = await fetch('/api/profiles').then(r => r.json());

    if (!accountResponse || !profileResponse) return;

    const accounts = accountResponse.accounts;
    const profiles = profileResponse.profiles;

    // Render assignments list
    const container = $('adminAccountAllocList');
    container.innerHTML = accounts.map(acc => {
        const selectOptions = profiles.map(p => `
            <option value="${p.id}" ${Number(p.id) === Number(acc.profile_id) ? 'selected' : ''}>${p.name}</option>
        `).join('');

        return `
            <div class="flex items-center justify-between gap-4 p-2 bg-slate-900 border border-white/5 rounded">
                <div>
                    <div class="font-bold text-[11px] text-white">${acc.account_name || 'Account'}</div>
                    <div class="text-[10px] text-slate-400">#${acc.account_number}</div>
                </div>
                <select onchange="assignAccountProfile('${acc.account_number}', this.value)" class="h-8 bg-slate-950 border border-white/15 rounded text-[10px] px-2 text-slate-300 focus:outline-none">
                    ${selectOptions}
                </select>
            </div>
        `;
    }).join('');
}

async function assignAccountProfile(accountNumber, profileId) {
    try {
        const res = await fetch(`/api/accounts/${accountNumber}/profile`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profile_id: profileId })
        });
        const d = await res.json();
        if (d && d.success) {
            await fetchProfiles();
            await refreshDashboard(true);
        }
    } catch (e) {
        console.error(e);
    }
}

// ─── SHARING CONSOLE RENDERS ───
async function loadSharingConsole() {
    const profileRes = await fetch('/api/profiles').then(r => r.json());
    const accountRes = await api('/accounts');
    const tokenRes = await fetch('/api/share/tokens').then(r => r.json());

    if (profileRes && profileRes.success) {
        const pSel = $('shareProfileSelect');
        pSel.innerHTML = '<option value="">Choose profile...</option>' + 
            profileRes.profiles.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    }

    if (accountRes && accountRes.success) {
        const aSel = $('shareAccountSelect');
        aSel.innerHTML = '<option value="">No restriction (Profile scope)</option>' + 
            accountRes.accounts.map(a => `<option value="${a.account_number}">${a.account_name || a.broker} (#${a.account_number})</option>`).join('');
    }

    if (tokenRes && tokenRes.success) {
        const list = $('activeTokensList');
        if (!tokenRes.tokens.length) {
            list.innerHTML = '<div class="text-slate-500 text-[10px] text-center py-2">No active tokens generated yet.</div>';
            return;
        }
        list.innerHTML = tokenRes.tokens.map(t => {
            const dateStr = t.from_date ? ` from ${t.from_date}` : ' (All data)';
            const scope = t.account_number ? `Acc: #${t.account_number}` : `Profile: ${t.profile_name || 'Main'}`;
            const activeStatus = t.is_active ? 'Active' : 'Revoked';
            
            return `
                <div class="flex items-center justify-between p-2.5 rounded bg-slate-900 border border-white/5 text-[10px] ${!t.is_active ? 'opacity-40' : ''}">
                    <div class="space-y-0.5">
                        <div class="font-bold text-white">${t.label || 'Share Token'}</div>
                        <div class="text-slate-400">${scope}${dateStr} • Views: ${t.view_count}</div>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="px-1.5 py-0.5 rounded text-[8px] ${t.is_active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-500'}">${activeStatus}</span>
                        ${t.is_active ? `<button onclick="revokeToken(${t.id})" class="text-rose-400 hover:text-rose-300 transition text-[9px] font-semibold">Revoke</button>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }
}

async function revokeToken(tokenId) {
    if (!confirm('Are you sure you want to revoke this secure link? Friends will instantly lose dashboard access.')) return;
    try {
        const res = await fetch(`/api/share/tokens/${tokenId}`, { method: 'DELETE' });
        const d = await res.json();
        if (d && d.success) {
            loadSharingConsole();
        }
    } catch (e) {
        console.error(e);
    }
}

// ─── CONSOLE REFRESH CONTROL THREAD ───
async function refreshDashboard(spin = false, initial = false) {
    if (spin) { 
        const ic = $('refreshIcon'); 
        ic.classList.add('spin-once'); 
        setTimeout(() => ic.classList.remove('spin-once'), 700); 
    }
    
    await Promise.all([
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
    $('dataMode').textContent = usingMock ? 'Demo data (API offline)' : 'Cloud Sync';
    lucide.createIcons();
    firstLoad = false;
}

// ─── FETCH PROFILES FOR DROP DOWN ───
async function fetchProfiles() {
    try {
        const d = await fetch('/api/profiles').then(r => r.json());
        if (d && d.success) {
            const filter = $('profileFilter');
            filter.innerHTML = d.profiles.map(p => `
                <option value="${p.id}" ${Number(p.id) === Number(currentProfileId) ? 'selected' : ''}>${p.name} Profile</option>
            `).join('');
        }
    } catch (e) {
        console.error(e);
    }
}

// 1. OVERVIEW AGGREGATIONS
async function fetchOverview() {
    const dp = dateParams();
    const d = await api(`/overview?account=${currentAccount}&magic=${currentMagic}${dp.length ? '&' + dp.join('&') : ''}`) || mockOverview();
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

    const today = $('todayPnl'); 
    today.textContent = formatUSD(d.today_pnl);
    today.className = `text-2xl font-extrabold tracking-tight font-display ${d.today_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
    
    const tIcon = $('todayIcon'); 
    tIcon.setAttribute('data-lucide', d.today_pnl >= 0 ? 'trending-up' : 'trending-down');
    
    $('todayIconWrap').className = `p-2 rounded-lg ${d.today_pnl >= 0 ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`;
    $('todayOrb').style.background = d.today_pnl >= 0 ? '#34d399' : '#fb7185';
    $('todayCard').style.setProperty('--accent', d.today_pnl >= 0 ? '#34d399' : '#fb7185');

    const fl = $('floatingPnl'); 
    fl.textContent = formatUSD(d.floating_pnl);
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

// 2. CONNECTED TERMINALS LIST
async function fetchAccountsList() {
    const d = await api('/accounts');
    const list = d ? d.accounts : filterAccounts(MOCK_ACCOUNTS);
    const allList = d ? d.accounts : MOCK_ACCOUNTS;
    const sel = $('accountFilter'); 
    const cur = sel.value;
    
    sel.innerHTML = '<option value="all">All Accounts</option>';
    allList.forEach((a) => { 
        // Sync account filters dynamically
        const matchesActiveProfile = isSharedView && sharedRestrictions
            ? (sharedRestrictions.account_number ? String(a.account_number) === String(sharedRestrictions.account_number) : Number(a.profile_id) === Number(sharedRestrictions.profile_id))
            : Number(a.profile_id) === Number(currentProfileId);
            
        if (matchesActiveProfile) {
            const o = document.createElement('option'); 
            o.value = a.account_number; 
            o.textContent = `${a.account_name || a.broker} • #${a.account_number}`; 
            if (String(o.value) === cur) o.selected = true; 
            sel.appendChild(o); 
        }
    });

    const shown = d ? list : filterAccounts(list);
    const grid = $('accountsGrid');
    if (!shown.length) { 
        grid.innerHTML = '<div class="text-center py-6 text-slate-500 text-xs">No MT5 terminals linked in this profile.</div>'; 
        return; 
    }
    grid.innerHTML = shown.map((acc) => {
        const pos = acc.today_profit >= 0; 
        const pct = Math.min(Math.abs(acc.today_profit) / (acc.balance || 1) * 1000, 100);
        return `
            <div class="tilt-card bg-slate-900/60 border border-white/5 p-4 rounded-xl hover:border-cyan-400/30 transition-all duration-300">
                <div class="flex justify-between items-start mb-2">
                    <div>
                        <h3 class="font-bold text-sm text-white">${acc.account_name || 'Account #' + acc.account_number}</h3>
                        <p class="text-xs text-slate-400">${acc.broker || 'MT5'} • #${acc.account_number}</p>
                    </div>
                    <div class="flex flex-col items-end gap-1">
                        <span class="px-2 py-0.5 rounded text-[9px] font-mono ${acc.open_count > 0 ? 'bg-rose-500/10 text-rose-400' : 'bg-slate-850 text-slate-500'}">${acc.open_count} Open</span>
                        <span class="px-2 py-0.5 rounded text-[9px] font-mono ${acc.pending_count > 0 ? 'bg-amber-500/10 text-amber-400' : 'bg-slate-850 text-slate-500'}">${acc.pending_count || 0} Pending</span>
                    </div>
                </div>
                <div class="mt-3 flex justify-between items-baseline">
                    <div>
                        <span class="text-[10px] text-slate-500 uppercase block">Balance</span>
                        <span class="font-semibold text-sm text-slate-200">${formatPlainUSD(acc.balance)}</span>
                    </div>
                    <div class="text-right">
                        <span class="text-[10px] text-slate-500 uppercase block">Today</span>
                        <span class="font-semibold text-sm ${pos ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(acc.today_profit)}</span>
                    </div>
                </div>
                <div class="mt-2 w-full bg-slate-800 rounded-full h-1 overflow-hidden">
                    <div class="h-1 rounded-full" style="width:${pct}%;background:${pos ? 'linear-gradient(90deg,#34d399,#22d3ee)' : 'linear-gradient(90deg,#fb7185,#f59e0b)'}"></div>
                </div>
            </div>
        `;
    }).join('');
}

// 3. EA LISTING & GRAPHIC MERGINGS
async function fetchEAList() {
    const dp = dateParams();
    const d = await api('/eas' + (dp.length ? '?' + dp.join('&') : ''));
    const all = d ? d.eas : applyRangeToEAs(MOCK_EAS);
    const sel = $('magicFilter'); 
    const cur = sel.value;
    
    sel.innerHTML = '<option value="all">All EAs</option>';
    all.forEach((e) => { 
        // Populate filters with EAs. 
        // EAs represent visual groupings of Magic Numbers
        const o = document.createElement('option'); 
        o.value = e.magic_numbers ? e.magic_numbers.split(',')[0] : e.magic_number; 
        o.textContent = `${e.ea_name}`; 
        if (String(o.value) === cur) o.selected = true; 
        sel.appendChild(o); 
    });
    
    updateHero('heroEAs', filterEAs(all).length);
    renderBars(filterEAs(all));
}

function renderBars(eas) {
    const box = $('eaChart'); 
    const max = Math.max(...eas.map((e) => Math.abs(e.total_pnl)), 1);
    const sorted = [...eas].sort((a, b) => b.total_pnl - a.total_pnl);
    
    box.innerHTML = sorted.map((ea, i) => {
        const pct = (Math.abs(ea.total_pnl) / max) * 100; 
        const pos = ea.total_pnl >= 0;
        return `
            <div>
                <div class="flex items-center justify-between text-xs mb-1">
                    <span class="font-semibold text-slate-200">${ea.ea_name}</span>
                    <span class="font-mono font-bold ${pos ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(ea.total_pnl)}</span>
                </div>
                <div class="h-2.5 w-full rounded-full bg-slate-800/60 overflow-hidden">
                    <div class="h-full rounded-full eq-bar" data-w="${pct}" style="transition-delay:${i * 90}ms;background:${pos ? 'linear-gradient(90deg,#22d3ee,#34d399)' : 'linear-gradient(90deg,#fb7185,#f59e0b)'};box-shadow:${pos ? '0 0 12px rgba(34,211,238,0.4)' : '0 0 12px rgba(251,113,133,0.4)'}"></div>
                </div>
            </div>
        `;
    }).join('');
    
    requestAnimationFrame(() => box.querySelectorAll('.eq-bar').forEach((b) => { b.style.width = b.dataset.w + '%'; }));
}

function renderDonut(wins, losses) {
    const box = $('winLossChart'); 
    const total = wins + losses || 1; 
    const winPct = (wins / total) * 100;
    const R = 70, C = 2 * Math.PI * R; 
    const len = (winPct / 100) * C;
    
    box.innerHTML = `
        <div class="flex flex-col items-center">
            <div class="relative w-[180px] h-[180px]">
                <svg viewBox="0 0 180 180" class="w-full h-full" style="transform:rotate(-90deg)">
                    <defs>
                        <linearGradient id="winGrad" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0%" stop-color="#22d3ee"/>
                            <stop offset="100%" stop-color="#34d399"/>
                        </linearGradient>
                    </defs>
                    <circle cx="90" cy="90" r="${R}" fill="none" stroke="#fb7185" stroke-width="16" stroke-opacity="0.85"/>
                    <circle cx="90" cy="90" r="${R}" fill="none" stroke="url(#winGrad)" stroke-width="16" stroke-linecap="round" stroke-dasharray="0 ${C}" style="filter:drop-shadow(0 0 6px rgba(34,211,238,0.5))" id="donutArc"/>
                </svg>
                <div class="absolute inset-0 flex flex-col items-center justify-center">
                    <span class="text-[10px] uppercase tracking-widest text-slate-500">Win Rate</span>
                    <span class="text-3xl font-extrabold text-white">${winPct.toFixed(1)}%</span>
                </div>
            </div>
            <div class="mt-4 flex items-center gap-5 text-xs">
                <span class="flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-sm bg-cyan-400"></span>
                    <span class="text-slate-300">${wins} Wins</span>
                </span>
                <span class="flex items-center gap-2">
                    <span class="w-2.5 h-2.5 rounded-sm bg-rose-400"></span>
                    <span class="text-slate-300">${losses} Losses</span>
                </span>
            </div>
        </div>
    `;
    
    requestAnimationFrame(() => { 
        const arc = $('donutArc'); 
        if (arc) { 
            arc.style.transition = 'stroke-dasharray 1.3s cubic-bezier(.22,1,.36,1)'; 
            arc.setAttribute('stroke-dasharray', `${len} ${C}`); 
        } 
    });
}

// 4. EQUITY CURVES (SVGs)
async function fetchEquity() {
    const dp = dateParams();
    const d = await api(`/charts/equity-curve?account=${currentAccount}&magic=${currentMagic}${dp.length ? '&' + dp.join('&') : ''}`);
    const curve = d ? d.curve : mockCurve();
    renderEquity(curve);
}

function renderEquity(curve) {
    const box = $('equityChart'); 
    if (!curve || !curve.length) { 
        box.innerHTML = '<div class="text-center py-12 text-slate-500 text-xs">No transaction records found for curve calculations.</div>'; 
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
    let peak = 0, valley = 0; 
    pts.forEach((p, i) => { 
        if (p.v > pts[peak].v) peak = i; 
        if (p.v < pts[valley].v) valley = i; 
    });
    
    const zeroY = sy(0);
    let grid = ''; 
    for (let i = 0; i <= 4; i++) { 
        const val = minY + (maxY - minY) * i / 4; 
        const y = sy(val); 
        grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="rgba(148,163,184,0.08)" stroke-dasharray="5 6"/>`; 
    }
    
    let labels = ''; 
    for (let i = 0; i <= 4; i++) { 
        const val = minY + (maxY - minY) * i / 4; 
        labels += `<span class="absolute left-1 text-[10px] font-mono text-slate-500" style="top:${(sy(val) / H) * 100}%;transform:translateY(-50%)">${compact(val)}</span>`; 
    }

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

    const svg = $('eqSvg'); 
    const cross = $('eqCross'); 
    const tip = $('eqTip');
    
    svg.addEventListener('mousemove', (e) => {
        const rect = svg.getBoundingClientRect(); 
        const relX = ((e.clientX - rect.left) / rect.width) * W;
        let n = 0, dist = Infinity; 
        pts.forEach((p, i) => { 
            const dd = Math.abs(p.x - relX); 
            if (dd < dist) { dist = dd; n = i; } 
        });
        const p = pts[n];
        cross.style.display = ''; 
        $('eqCrossLine').setAttribute('x1', p.x); 
        $('eqCrossLine').setAttribute('x2', p.x);
        $('eqCrossDot').setAttribute('cx', p.x); 
        $('eqCrossDot').setAttribute('cy', p.y);
        
        tip.style.display = ''; 
        tip.style.left = (p.x / W) * 100 + '%'; 
        tip.style.top = (p.y / H) * 100 + '%'; 
        tip.style.marginTop = '-14px';
        
        tip.innerHTML = `
            <div class="box">
                <div class="text-[10px] text-slate-400">${new Date(p.t).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                <div class="text-[10px] uppercase tracking-wider text-slate-500">Cumulative P&amp;L</div>
                <div class="text-base font-extrabold ${p.v >= 0 ? 'text-cyan-300' : 'text-rose-400'}">${formatUSD(p.v)}</div>
            </div>`;
    });
    
    svg.addEventListener('mouseleave', () => { cross.style.display = 'none'; tip.style.display = 'none'; });
}

// 5. CALENDAR PLOTTER
async function fetchCalendar() {
    const year = calendarDate.getFullYear(), month = calendarDate.getMonth() + 1;
    const d = await api(`/calendar?year=${year}&month=${month}&account=${currentAccount}&magic=${currentMagic}`) || mockCalendar(year, month);
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    
    $('calendarCurrentMonth').textContent = `${months[month - 1]} ${year}`;
    
    const mt = $('calendarMonthTotal'); 
    mt.textContent = formatUSD(d.month_total_pnl); 
    mt.className = `font-bold ${d.month_total_pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`;
    
    const map = {}; 
    d.days.forEach((x) => map[x.date] = x);
    
    const grid = $('calendarGrid'); 
    grid.innerHTML = '';
    
    const firstDay = new Date(year, month - 1, 1).getDay(); 
    const offset = firstDay === 0 ? 6 : firstDay - 1;
    const dim = new Date(year, month, 0).getDate(); 
    const todayStr = new Date().toISOString().slice(0, 10);
    
    for (let i = 0; i < offset; i++) grid.innerHTML += '<div class="h-20 bg-slate-900/20 border border-white/5 rounded-xl opacity-20"></div>';
    
    for (let day = 1; day <= dim; day++) {
        const ds = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`; 
        const dd = map[ds]; 
        const isToday = ds === todayStr;
        if (dd) {
            const pos = dd.profit >= 0;
            grid.innerHTML += `
                <div class="h-20 p-2 rounded-xl border transition-all duration-300 hover:scale-[1.06] flex flex-col justify-between ${pos ? 'bg-emerald-950/30 border-emerald-500/25 hover:border-emerald-400/50' : 'bg-rose-950/30 border-rose-500/25 hover:border-rose-400/50'} ${isToday ? 'ring-2 ring-cyan-400/60' : ''}">
                    <div class="flex justify-between items-center">
                        <span class="text-xs font-bold ${isToday ? 'text-cyan-400' : 'text-slate-400'}">${day}</span>
                        <span class="text-[9px] px-1.5 py-0.5 rounded-full font-mono ${pos ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}">${dd.wins}W ${dd.losses}L</span>
                    </div>
                    <div class="text-right">
                        <span class="text-xs sm:text-sm font-extrabold block ${pos ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(dd.profit)}</span>
                        <span class="text-[9px] text-slate-500">${dd.trades_count}t</span>
                    </div>
                </div>`;
        } else {
            grid.innerHTML += `
                <div class="h-20 p-2 rounded-xl bg-slate-900/25 border border-white/5 flex flex-col justify-between ${isToday ? 'ring-2 ring-cyan-400/60' : ''}">
                    <span class="text-xs ${isToday ? 'text-cyan-400 font-bold' : 'text-slate-600'}">${day}</span>
                    <span class="text-[11px] text-slate-700 text-right">—</span>
                </div>`;
        }
    }
}

function changeMonth(delta) { 
    calendarDate.setMonth(calendarDate.getMonth() + delta); 
    fetchCalendar(); 
}

// 6. LIVE OPEN POSITION RECORDS
async function fetchPositions() {
    const d = await api(`/open-positions?account=${currentAccount}&magic=${currentMagic}`);
    const positions = d ? d.positions : filterPositions(mockPositions());
    
    $('liveOpenBadge').textContent = `${positions.length} Active`;
    const tb = $('openPositionsTable');
    if (!positions.length) { 
        tb.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-slate-600">No active positions tracking currently</td></tr>'; 
        return; 
    }
    tb.innerHTML = positions.map((p) => {
        const net = p.profit + p.swap;
        return `
            <tr class="hover:bg-white/5 transition-colors">
                <td class="p-2.5">
                    <span class="font-semibold text-white cursor-pointer rename-magic text-gradient" data-magic="${p.magic_number}" data-name="${p.ea_name}" data-color="${p.color || '#3b82f6'}" data-desc="${p.description || ''}">${p.ea_name}</span>
                    <br><span class="text-[9px] text-slate-500">#${p.account_number}</span>
                </td>
                <td class="p-2.5 font-bold text-slate-200">
                    ${p.symbol}
                    <br><span class="text-[9px] font-normal text-slate-500">Vol: ${p.volume}</span>
                </td>
                <td class="p-2.5">
                    <span class="px-2 py-0.5 rounded-full text-[9px] font-bold ${p.trade_type === 'BUY' ? 'bg-cyan-500/15 text-cyan-400' : 'bg-amber-500/15 text-amber-400'}">${p.trade_type}</span>
                </td>
                <td class="p-2.5 text-right font-mono font-bold ${net >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(net)}</td>
            </tr>`;
    }).join('');
}

// 7. LIVE PENDING ORDERS
async function fetchPendingOrders() {
    const d = await api(`/pending-orders?account=${currentAccount}&magic=${currentMagic}`);
    const orders = d ? d.orders : filterPositions(mockPendingOrders());
    
    $('livePendingBadge').textContent = `${orders.length} Active`;
    const tb = $('pendingOrdersTable');
    if (!orders.length) {
        tb.innerHTML = '<tr><td colspan="4" class="text-center py-8 text-slate-600">No active pending orders</td></tr>';
        return;
    }
    tb.innerHTML = orders.map((o) => {
        return `
            <tr class="hover:bg-white/5 transition-colors">
                <td class="p-2.5">
                    <span class="font-semibold text-white cursor-pointer rename-magic text-gradient" data-magic="${o.magic_number}" data-name="${o.ea_name}" data-color="${o.color || '#3b82f6'}" data-desc="${o.description || ''}">${o.ea_name}</span>
                    <br><span class="text-[9px] text-slate-500">#${o.account_number}</span>
                </td>
                <td class="p-2.5 font-bold text-slate-200">
                    ${o.symbol}
                    <br><span class="text-[9px] font-normal text-slate-500">Vol: ${o.volume}</span>
                </td>
                <td class="p-2.5">
                    <span class="px-1.5 py-0.5 rounded text-[8px] font-mono bg-slate-800 text-slate-300 border border-white/5">${o.order_type}</span>
                </td>
                <td class="p-2.5 text-right font-mono text-slate-200">
                    ${Number(o.price_open).toFixed(2)}
                    <br><span class="text-[9px] text-slate-500">Curr: ${Number(o.price_current).toFixed(2)}</span>
                </td>
            </tr>
        `;
    }).join('');
}

// 8. EA PERFORMANCE LEADERBOARDS (Click Magic Number to Rename)
async function fetchLeaderboard() {
    const dp = dateParams();
    const d = await api('/eas' + (dp.length ? '?' + dp.join('&') : ''));
    const eas = filterEAs(d ? d.eas : applyRangeToEAs(MOCK_EAS));
    const tb = $('eaLeaderboardBody');
    if (!eas.length) { 
        tb.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-slate-600">No trading activities logged for this period</td></tr>'; 
        return; 
    }
    const sorted = [...eas].sort((a, b) => b.total_pnl - a.total_pnl); 
    const medal = ['🥇', '🥈', '🥉'];
    
    tb.innerHTML = sorted.map((ea, i) => {
        const wr = ea.total_trades > 0 ? ((ea.wins / ea.total_trades) * 100).toFixed(1) : '0.0';
        const avg = ea.total_trades > 0 ? ea.total_pnl / ea.total_trades : 0; 
        const pos = ea.total_pnl >= 0;
        
        // Grab representative magic number for renaming trigger
        const repMagic = ea.magic_numbers ? ea.magic_numbers.split(',')[0] : ea.magic_number;
        
        return `
            <tr class="hover:bg-white/5 transition-colors">
                <td class="p-3 text-center text-base">${i < 3 ? medal[i] : '<span class="text-slate-500 font-mono text-sm">#' + (i + 1) + '</span>'}</td>
                <td class="p-3">
                    <div class="flex items-center gap-3">
                        <span class="w-3 h-3 rounded-full" style="background:${ea.color};box-shadow:0 0 10px ${ea.color}88"></span>
                        <div>
                            <span class="font-bold text-white text-sm cursor-pointer hover:underline rename-magic" data-magic="${repMagic}" data-name="${ea.ea_name}" data-color="${ea.color}" data-desc="${ea.description}">${ea.ea_name}</span>
                            <br><span class="text-[9px] text-slate-500 font-mono">Magics: ${ea.magic_numbers || ea.magic_number}</span>
                        </div>
                    </div>
                </td>
                <td class="p-3 text-right font-mono font-bold ${pos ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(ea.total_pnl)}</td>
                <td class="p-3 text-center font-mono text-slate-300">${ea.total_trades}</td>
                <td class="p-3 text-center">
                    <span class="text-emerald-400 font-semibold">${ea.wins}</span><span class="text-slate-600 mx-1">/</span><span class="text-rose-400 font-semibold">${ea.losses}</span>
                </td>
                <td class="p-3">
                    <div class="flex items-center justify-center gap-2">
                        <div class="w-16 bg-slate-800 rounded-full h-2 overflow-hidden">
                            <div class="h-2 rounded-full" style="width:${wr}%;background:${Number(wr) >= 50 ? 'linear-gradient(90deg,#34d399,#22d3ee)' : 'linear-gradient(90deg,#fb7185,#f59e0b)'}"></div>
                        </div>
                        <span class="text-xs font-bold ${Number(wr) >= 50 ? 'text-emerald-400' : 'text-rose-400'}">${wr}%</span>
                    </div>
                </td>
                <td class="p-3 text-right font-mono text-xs ${avg >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${formatUSD(avg)}</td>
                <td class="p-3 text-right font-mono text-xs ${ea.open_pnl >= 0 ? 'text-cyan-400' : 'text-rose-400'}">${formatUSD(ea.open_pnl)}</td>
            </tr>`;
    }).join('');
}
