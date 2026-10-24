const express = require('express');
const router = express.Router();
const db = require('./database');
const auth = require('./auth');

// Helper to normalize any MT5 date format "2025.03.01 12:00" -> "2025-03-01 12:00"
function normalizeDate(dateStr) {
    if (!dateStr) return new Date().toISOString().replace('T', ' ').slice(0, 19);
    return dateStr.replace(/\./g, '-').trim();
}

const DAY = (col) => `substr(REPLACE(${col}, '.', '-'), 1, 10)`;
const isYMD = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const PALETTE = ['#22d3ee', '#a855f7', '#34d399', '#fbbf24', '#60a5fa', '#fb7185', '#f472b6', '#2dd4bf', '#f97316', '#818cf8'];

function colorFor(name, stored) {
    if (stored && stored !== '#3b82f6') return stored;
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return PALETTE[h % PALETTE.length];
}

// ─── broker-clock helpers (MT5 times are broker server time, not UTC) ───
const SAMPLE_MS = 55000;
const FRESH_MS = 90000;
const lastSample = new Map();
const tms = (s) => Date.parse(String(s).replace(/\./g, '-').replace(' ', 'T').slice(0, 19) + 'Z');
const isoOf = (t) => (t == null ? null : new Date(t).toISOString().replace('T', ' ').slice(0, 19));
const brokerTime = (offsetMin) => isoOf(Date.now() + (offsetMin || 0) * 60000);
const r2 = (v) => Number((Number(v) || 0).toFixed(2));

// Uses EA-sent server_time when available, otherwise infers from the newest trade/position time (never decreases)
function resolveOffset(accNo, serverTime, times) {
    const row = db.prepare('SELECT time_offset_min FROM known_accounts WHERE account_number = ?').get(accNo);
    const stored = row && row.time_offset_min != null ? row.time_offset_min : null;
    const now = Date.now();
    const round = (ms) => Math.round((ms - now) / 60000 / 15) * 15;
    let offset;
    const st = serverTime ? tms(serverTime) : NaN;
    if (!isNaN(st)) offset = round(st);
    else {
        const valid = times.map(tms).filter((n) => !isNaN(n)).map(round).filter((o) => o >= -720 && o <= 840);
        offset = Math.max(stored == null ? 0 : stored, ...valid);
    }
    offset = Math.min(840, Math.max(-720, offset));
    if (offset !== stored) db.prepare('UPDATE known_accounts SET time_offset_min = ? WHERE account_number = ?').run(offset, accNo);
    return offset;
}

// ==========================================
// 🔐 0. AUTH (public)
// ==========================================
router.post('/auth/login', auth.login);

// ==========================================
// 📥 1. DATA INGESTION (Called by MT5 EA — public)
// ==========================================

router.post('/ea/sync', (req, res) => {
    try {
        const { account, open_positions = [], pending_orders = [], recent_trades = [] } = req.body;

        if (!account || !account.account_number) {
            return res.status(400).json({ success: false, error: 'Missing account information' });
        }
        const accNo = String(account.account_number);

        const syncTransaction = db.transaction(() => {
            // 1. Upsert Account Info
            db.prepare(`
                INSERT INTO accounts (
                    account_number, account_name, broker, server_name, currency,
                    leverage, balance, equity, margin, free_margin, margin_level,
                    is_active, last_update
                ) VALUES (
                    @account_number, @account_name, @broker, @server_name, @currency,
                    @leverage, @balance, @equity, @margin, @free_margin, @margin_level,
                    1, datetime('now')
                )
                ON CONFLICT(account_number) DO UPDATE SET
                    account_name = excluded.account_name,
                    broker = excluded.broker,
                    server_name = excluded.server_name,
                    currency = excluded.currency,
                    leverage = excluded.leverage,
                    balance = excluded.balance,
                    equity = excluded.equity,
                    margin = excluded.margin,
                    free_margin = excluded.free_margin,
                    margin_level = excluded.margin_level,
                    is_active = 1,
                    last_update = datetime('now')
            `).run({
                account_number: accNo,
                account_name: account.account_name || '',
                broker: account.broker || '',
                server_name: account.server_name || '',
                currency: account.currency || 'USD',
                leverage: String(account.leverage || '1:100'),
                balance: Number(account.balance) || 0,
                equity: Number(account.equity) || 0,
                margin: Number(account.margin) || 0,
                free_margin: Number(account.free_margin) || 0,
                margin_level: Number(account.margin_level) || 0
            });

            // Remember the account permanently (for profile assignment)
            db.prepare(`
                INSERT INTO known_accounts (account_number, account_name, broker, last_seen)
                VALUES (?, ?, ?, datetime('now'))
                ON CONFLICT(account_number) DO UPDATE SET
                    account_name = excluded.account_name, broker = excluded.broker, last_seen = datetime('now')
            `).run(accNo, account.account_name || '', account.broker || '');

            const registerMagic = db.prepare('INSERT OR IGNORE INTO ea_registry (magic_number, ea_name) VALUES (?, ?)');
            const autoRegister = (magic) => {
                const m = Number(magic) || 0;
                if (m > 0) registerMagic.run(m, `EA #${m}`);
            };

            // 2. Refresh Open Positions for this account
            db.prepare('DELETE FROM open_positions WHERE account_number = ?').run(accNo);
            const insertPosition = db.prepare(`
                INSERT OR REPLACE INTO open_positions (
                    account_number, ticket, magic_number, symbol, trade_type,
                    volume, open_price, current_price, open_time, profit, swap, comment, last_update
                ) VALUES (
                    @account_number, @ticket, @magic_number, @symbol, @trade_type,
                    @volume, @open_price, @current_price, @open_time, @profit, @swap, @comment, datetime('now')
                )
            `);
            for (const pos of open_positions) {
                insertPosition.run({
                    account_number: accNo,
                    ticket: String(pos.ticket),
                    magic_number: Number(pos.magic_number) || 0,
                    symbol: pos.symbol || '',
                    trade_type: pos.trade_type || 'BUY',
                    volume: Number(pos.volume) || 0,
                    open_price: Number(pos.open_price) || 0,
                    current_price: Number(pos.current_price) || 0,
                    open_time: normalizeDate(pos.open_time),
                    profit: Number(pos.profit) || 0,
                    swap: Number(pos.swap) || 0,
                    comment: pos.comment || ''
                });
                autoRegister(pos.magic_number);
            }

            // 2b. Floating P&L sample per magic (~1/min) for equity-based drawdown
            const offsetMin = resolveOffset(accNo, account.server_time, [
                ...open_positions.map((p) => p.open_time),
                ...recent_trades.map((t) => t.close_time)
            ]);
            if (open_positions.length && Date.now() - (lastSample.get(accNo) || 0) >= SAMPLE_MS) {
                const perMagic = {};
                for (const pos of open_positions) {
                    const m = Number(pos.magic_number) || 0;
                    perMagic[m] = (perMagic[m] || 0) + (Number(pos.profit) || 0) + (Number(pos.swap) || 0);
                }
                const ts = brokerTime(offsetMin);
                const insSample = db.prepare('INSERT OR REPLACE INTO floating_samples (account_number, magic_number, sample_time, floating) VALUES (?, ?, ?, ?)');
                for (const [m, v] of Object.entries(perMagic)) insSample.run(accNo, Number(m), ts, Number(v.toFixed(2)));
                lastSample.set(accNo, Date.now());
            }

            // 3. Refresh Pending Orders for this account
            db.prepare('DELETE FROM pending_orders WHERE account_number = ?').run(accNo);
            const insertPending = db.prepare(`
                INSERT OR REPLACE INTO pending_orders (
                    account_number, ticket, magic_number, symbol, order_type, volume,
                    price_open, price_current, sl, tp, setup_time, expiration, comment, last_update
                ) VALUES (
                    @account_number, @ticket, @magic_number, @symbol, @order_type, @volume,
                    @price_open, @price_current, @sl, @tp, @setup_time, @expiration, @comment, datetime('now')
                )
            `);
            for (const o of pending_orders) {
                insertPending.run({
                    account_number: accNo,
                    ticket: String(o.ticket),
                    magic_number: Number(o.magic_number) || 0,
                    symbol: o.symbol || '',
                    order_type: o.order_type || 'PENDING',
                    volume: Number(o.volume) || 0,
                    price_open: Number(o.price_open) || 0,
                    price_current: Number(o.price_current) || 0,
                    sl: Number(o.sl) || 0,
                    tp: Number(o.tp) || 0,
                    setup_time: o.setup_time ? normalizeDate(o.setup_time) : '',
                    expiration: o.expiration ? normalizeDate(o.expiration) : '',
                    comment: o.comment || ''
                });
                autoRegister(o.magic_number);
            }

            // 4. Upsert Closed Trades (History)
            const insertTrade = db.prepare(`
                INSERT OR REPLACE INTO trades (
                    account_number, ticket, magic_number, symbol, trade_type,
                    volume, open_price, close_price, open_time, close_time,
                    profit, commission, swap, net_profit, comment
                ) VALUES (
                    @account_number, @ticket, @magic_number, @symbol, @trade_type,
                    @volume, @open_price, @close_price, @open_time, @close_time,
                    @profit, @commission, @swap, @net_profit, @comment
                )
            `);
            for (const trade of recent_trades) {
                const profit = Number(trade.profit) || 0;
                const commission = Number(trade.commission) || 0;
                const swap = Number(trade.swap) || 0;
                insertTrade.run({
                    account_number: accNo,
                    ticket: String(trade.ticket),
                    magic_number: Number(trade.magic_number) || 0,
                    symbol: trade.symbol || '',
                    trade_type: trade.trade_type || 'BUY',
                    volume: Number(trade.volume) || 0,
                    open_price: Number(trade.open_price) || 0,
                    close_price: Number(trade.close_price) || 0,
                    open_time: normalizeDate(trade.open_time),
                    close_time: normalizeDate(trade.close_time),
                    profit,
                    commission,
                    swap,
                    net_profit: Number(trade.net_profit) || (profit + commission + swap),
                    comment: trade.comment || ''
                });
                autoRegister(trade.magic_number);
            }

            // 5. Update today's daily snapshot
            const today = new Date().toISOString().slice(0, 10);
            const todayStats = db.prepare(`
                SELECT
                    COALESCE(SUM(net_profit), 0) as daily_profit,
                    COUNT(*) as total_trades,
                    SUM(CASE WHEN net_profit > 0 THEN 1 ELSE 0 END) as winning_trades,
                    SUM(CASE WHEN net_profit < 0 THEN 1 ELSE 0 END) as losing_trades
                FROM trades
                WHERE account_number = ? AND ${DAY('close_time')} = ?
            `).get(accNo, today);

            db.prepare(`
                INSERT INTO daily_snapshots (
                    account_number, snapshot_date, balance, equity, daily_profit,
                    total_trades, winning_trades, losing_trades
                ) VALUES (
                    @account_number, @snapshot_date, @balance, @equity, @daily_profit,
                    @total_trades, @winning_trades, @losing_trades
                )
                ON CONFLICT(account_number, snapshot_date) DO UPDATE SET
                    balance = excluded.balance,
                    equity = excluded.equity,
                    daily_profit = excluded.daily_profit,
                    total_trades = excluded.total_trades,
                    winning_trades = excluded.winning_trades,
                    losing_trades = excluded.losing_trades
            `).run({
                account_number: accNo,
                snapshot_date: today,
                balance: Number(account.balance) || 0,
                equity: Number(account.equity) || 0,
                daily_profit: todayStats ? todayStats.daily_profit : 0,
                total_trades: todayStats ? todayStats.total_trades : 0,
                winning_trades: todayStats ? todayStats.winning_trades || 0 : 0,
                losing_trades: todayStats ? todayStats.losing_trades || 0 : 0
            });
        });

        syncTransaction();
        return res.json({ success: true, message: 'Sync successful' });
    } catch (err) {
        console.error('Error during EA sync:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

const STALE_SECONDS = 30; // terminals with no sync for 30s are deleted (EA syncs every 5s)

// EA names, profiles, share links and floating P&L history (equity DD) are kept — only live/trade data is removed
function purgeAccount(accountNumber) {
    const acc = String(accountNumber);
    db.transaction(() => {
        db.prepare('DELETE FROM open_positions  WHERE account_number = ?').run(acc);
        db.prepare('DELETE FROM pending_orders  WHERE account_number = ?').run(acc);
        db.prepare('DELETE FROM trades          WHERE account_number = ?').run(acc);
        db.prepare('DELETE FROM daily_snapshots WHERE account_number = ?').run(acc);
        db.prepare('DELETE FROM accounts        WHERE account_number = ?').run(acc);
    })();
}

// (a) Explicit disconnect signal from EA
router.post('/ea/disconnect', (req, res) => {
    const b = req.body || {};
    const accountNumber = b.account_number || (b.account && b.account.account_number);
    if (!accountNumber) return res.status(400).json({ success: false, error: 'Missing account_number' });
    purgeAccount(accountNumber);
    return res.json({ success: true, message: `Account ${accountNumber} data removed` });
});

// (b) Timeout safety-net triggered every 10s
setInterval(() => {
    const stale = db.prepare(
        `SELECT account_number FROM accounts
         WHERE (julianday('now') - julianday(last_update)) * 86400 > ?`).all(STALE_SECONDS);
    stale.forEach((r) => purgeAccount(r.account_number));
}, 10000);

// (c) Samples older than 14 days are compacted to one (worst) value per hour to keep the DB small
function compactSamples() {
    const cutoff = brokerTime(-14 * 24 * 60);
    const floor = brokerTime(-17 * 24 * 60);
    db.transaction(() => {
        const rows = db.prepare(`
            SELECT account_number, magic_number, substr(sample_time, 1, 13) || ':00:00' AS h, MIN(floating) AS f
            FROM floating_samples WHERE sample_time >= ? AND sample_time < ?
            GROUP BY account_number, magic_number, h
        `).all(floor, cutoff);
        db.prepare('DELETE FROM floating_samples WHERE sample_time >= ? AND sample_time < ?').run(floor, cutoff);
        const ins = db.prepare('INSERT OR REPLACE INTO floating_samples (account_number, magic_number, sample_time, floating) VALUES (?, ?, ?, ?)');
        rows.forEach((r) => ins.run(r.account_number, r.magic_number, r.h, r.f));
    })();
}
setInterval(compactSamples, 3600000);


// ==========================================
// 🔒 EVERYTHING BELOW REQUIRES PASSCODE SESSION OR SHARE TOKEN
// ==========================================
router.use(auth.resolveScope);

// ─── scope helpers ───
function inList(col, values, params) {
    if (!values.length) return ' AND 0';
    params.push(...values);
    return ` AND ${col} IN (${values.map(() => '?').join(',')})`;
}

// All magic numbers that belong to an EA name (merged EAs)
function magicsForEA(name) {
    const magics = db.prepare('SELECT magic_number FROM ea_registry WHERE ea_name = ?').all(name).map((r) => r.magic_number);
    const m = /^EA #(-?\d+)$/.exec(name);
    if (m && !db.prepare('SELECT 1 FROM ea_registry WHERE magic_number = ?').get(Number(m[1]))) magics.push(Number(m[1]));
    return [...new Set(magics)];
}

// Builds the WHERE fragment that enforces profile/share scope + account/EA filters
function scopeFilter(req, { acc = 'account_number', magic = 'magic_number', date = null, useAccount = true, useEA = true } = {}) {
    const params = [];
    let sql = '';
    const { account, ea } = req.query;
    const allowed = req.scope.accounts;

    if (useAccount && account && account !== 'all') {
        if (allowed && !allowed.includes(String(account))) sql += ' AND 0';
        else { sql += ` AND ${acc} = ?`; params.push(String(account)); }
    } else if (allowed) {
        sql += inList(acc, allowed, params);
    }
    if (useEA && ea && ea !== 'all') sql += inList(magic, magicsForEA(String(ea)), params);
    if (date && req.scope.minDate) { sql += ` AND ${DAY(date)} >= ?`; params.push(req.scope.minDate); }
    return { sql, params };
}

function rangeFilter(req, col) {
    const params = [];
    let sql = '';
    const { from, to } = req.query;
    if (isYMD(from)) { sql += ` AND ${DAY(col)} >= ?`; params.push(from); }
    if (isYMD(to)) { sql += ` AND ${DAY(col)} <= ?`; params.push(to); }
    return { sql, params };
}

function eaNameMap() {
    const map = {};
    db.prepare('SELECT magic_number, ea_name, color FROM ea_registry').all().forEach((r) => { map[r.magic_number] = r; });
    return map;
}
function nameOf(map, magic) {
    const r = map[magic];
    return (r && r.ea_name && r.ea_name.trim()) || `EA #${magic}`;
}


// ==========================================
// 👤 SESSION INFO
// ==========================================
router.get('/session', (req, res) => {
    const s = req.scope;
    if (s.mode === 'share') {
        db.prepare("UPDATE share_links SET last_accessed = datetime('now') WHERE id = ?").run(s.shareId);
    }
    res.json({ success: true, mode: s.mode, profile: s.profile, min_date: s.minDate });
});


// ==========================================
// 📊 2. DASHBOARD DATA ENDPOINTS
// ==========================================

router.get('/overview', (req, res) => {
    try {
        const t = scopeFilter(req, { date: 'close_time' });
        const tradeWhere = 'WHERE 1=1' + t.sql;
        const r = rangeFilter(req, 'close_time');
        const rangeWhere = tradeWhere + r.sql;
        const rangeParams = [...t.params, ...r.params];

        const a = scopeFilter(req, { useEA: false });
        const accountTotals = db.prepare(`
            SELECT COUNT(*) as count, COALESCE(SUM(balance), 0) as total_balance, COALESCE(SUM(equity), 0) as total_equity
            FROM accounts WHERE is_active = 1 ${a.sql}
        `).get(...a.params);

        const o = scopeFilter(req);
        const floatingStats = db.prepare(`SELECT COALESCE(SUM(profit + swap), 0) as floating_pnl, COUNT(*) as open_trades FROM open_positions WHERE 1=1 ${o.sql}`).get(...o.params);
        const pendingCount = db.prepare(`SELECT COUNT(*) as c FROM pending_orders WHERE 1=1 ${o.sql}`).get(...o.params).c;

        const todayStr = new Date().toISOString().slice(0, 10);
        const todayStats = db.prepare(`SELECT COALESCE(SUM(net_profit), 0) as today_pnl FROM trades ${tradeWhere} AND ${DAY('close_time')} = ?`).get(...t.params, todayStr);
        const monthStats = db.prepare(`SELECT COALESCE(SUM(net_profit), 0) as month_pnl FROM trades ${tradeWhere} AND substr(REPLACE(close_time, '.', '-'), 1, 7) = ?`).get(...t.params, todayStr.slice(0, 7));

        const overall = db.prepare(`
            SELECT
                COUNT(*) as total_trades,
                COALESCE(SUM(net_profit), 0) as total_closed_profit,
                SUM(CASE WHEN net_profit > 0 THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN net_profit < 0 THEN 1 ELSE 0 END) as losses,
                COALESCE(SUM(CASE WHEN net_profit > 0 THEN net_profit ELSE 0 END), 0) as gross_profit,
                COALESCE(ABS(SUM(CASE WHEN net_profit < 0 THEN net_profit ELSE 0 END)), 0) as gross_loss
            FROM trades ${rangeWhere}
        `).get(...rangeParams);

        const winRate = overall.total_trades > 0 ? ((overall.wins / overall.total_trades) * 100).toFixed(1) : 0;
        const profitFactor = overall.gross_loss > 0
            ? (overall.gross_profit / overall.gross_loss).toFixed(2)
            : overall.gross_profit > 0 ? 'MAX' : '0.00';

        res.json({
            success: true,
            total_accounts: accountTotals.count,
            total_balance: accountTotals.total_balance,
            total_equity: accountTotals.total_equity,
            floating_pnl: floatingStats.floating_pnl || 0,
            open_trades_count: floatingStats.open_trades || 0,
            pending_orders_count: pendingCount,
            today_pnl: todayStats.today_pnl,
            month_pnl: monthStats.month_pnl,
            total_closed_profit: overall.total_closed_profit || 0,
            win_rate: Number(winRate),
            profit_factor: profitFactor,
            total_trades: overall.total_trades,
            wins: overall.wins || 0,
            losses: overall.losses || 0
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


router.get('/accounts', (req, res) => {
    try {
        const todayStr = new Date().toISOString().slice(0, 10);
        const f = scopeFilter(req, { acc: 'a.account_number', useAccount: false, useEA: false });
        const minDate = req.scope.minDate;
        const sinceSql = minDate ? ` AND ${DAY('close_time')} >= ?` : '';
        const sinceParams = minDate ? [minDate] : [];
        const accounts = db.prepare(`
            SELECT
                a.*,
                COALESCE((SELECT SUM(profit + swap) FROM open_positions WHERE account_number = a.account_number), 0) as floating_pnl,
                COALESCE((SELECT COUNT(*) FROM open_positions WHERE account_number = a.account_number), 0) as open_count,
                COALESCE((SELECT COUNT(*) FROM pending_orders WHERE account_number = a.account_number), 0) as pending_count,
                COALESCE((SELECT SUM(net_profit) FROM trades WHERE account_number = a.account_number AND ${DAY('close_time')} = ? ${sinceSql}), 0) as today_profit,
                COALESCE((SELECT SUM(net_profit) FROM trades WHERE account_number = a.account_number ${sinceSql}), 0) as total_profit
            FROM accounts a
            WHERE 1=1 ${f.sql}
            ORDER BY a.account_number ASC
        `).all(todayStr, ...sinceParams, ...sinceParams, ...f.params);

        res.json({ success: true, accounts });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


// EAs grouped by NAME — magic numbers sharing a name are merged into one EA.
// Honours the selected date range, account and EA filters so the P&L by EA section matches the header.
router.get('/eas', (req, res) => {
    try {
        const f = scopeFilter(req, { acc: 't.account_number', magic: 't.magic_number', date: 't.close_time' });
        const r = rangeFilter(req, 't.close_time');
        const tradeRows = db.prepare(`
            SELECT t.magic_number,
                COUNT(t.id) as total_trades,
                COALESCE(SUM(t.net_profit), 0) as total_pnl,
                SUM(CASE WHEN t.net_profit > 0 THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN t.net_profit < 0 THEN 1 ELSE 0 END) as losses
            FROM trades t
            WHERE 1=1 ${f.sql} ${r.sql}
            GROUP BY t.magic_number
        `).all(...f.params, ...r.params);

        const o = scopeFilter(req);
        const openRows = db.prepare(`
            SELECT magic_number, COALESCE(SUM(profit + swap), 0) as open_pnl, COUNT(*) as open_count
            FROM open_positions WHERE 1=1 ${o.sql} GROUP BY magic_number
        `).all(...o.params);
        const pendRows = db.prepare(`SELECT magic_number, COUNT(*) as c FROM pending_orders WHERE 1=1 ${o.sql} GROUP BY magic_number`).all(...o.params);

        const reg = eaNameMap();
        const groups = {};
        const group = (magic) => {
            const name = nameOf(reg, magic);
            if (!groups[name]) {
                groups[name] = { ea_name: name, color: colorFor(name, reg[magic] && reg[magic].color), magic_numbers: [], total_trades: 0, total_pnl: 0, wins: 0, losses: 0, open_pnl: 0, open_count: 0, pending_count: 0 };
            }
            if (!groups[name].magic_numbers.includes(magic)) groups[name].magic_numbers.push(magic);
            return groups[name];
        };
        tradeRows.forEach((row) => {
            const g = group(row.magic_number);
            g.total_trades += row.total_trades; g.total_pnl += row.total_pnl; g.wins += row.wins || 0; g.losses += row.losses || 0;
        });
        openRows.forEach((row) => { const g = group(row.magic_number); g.open_pnl += row.open_pnl; g.open_count += row.open_count; });
        pendRows.forEach((row) => { group(row.magic_number).pending_count += row.c; });

        // A single EA selected in the header stays visible even when it has no trades in this period
        const wantedEA = req.query.ea && req.query.ea !== 'all' ? String(req.query.ea) : null;
        if (wantedEA && !groups[wantedEA]) {
            const magics = magicsForEA(wantedEA);
            const stored = magics.map((m) => reg[m] && reg[m].color).filter((c) => c && c !== '#3b82f6')[0];
            groups[wantedEA] = {
                ea_name: wantedEA, color: colorFor(wantedEA, stored),
                magic_numbers: magics.slice().sort((a, b) => a - b),
                total_trades: 0, total_pnl: 0, wins: 0, losses: 0, open_pnl: 0, open_count: 0, pending_count: 0
            };
        }

        const eas = Object.values(groups).map((g) => ({
            ...g,
            total_pnl: Number(g.total_pnl.toFixed(2)),
            open_pnl: Number(g.open_pnl.toFixed(2)),
            magic_numbers: g.magic_numbers.sort((a, b) => a - b),
            magic_number: g.magic_numbers.join(', ')
        })).sort((a, b) => b.total_pnl - a.total_pnl);

        res.json({ success: true, eas });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


// ==========================================
// 📜 CLOSED TRADES OF ONE EA — powers the "Show trades" popup
// Respects the profile / share-link scope, the account filter and the selected date range.
// ==========================================
const TRADES_PAGE_MAX = 500;
const TRADES_PAGE_DEFAULT = 100;

router.get('/ea-trades', (req, res) => {
    try {
        const ea = String(req.query.ea || '').trim();
        if (!ea) return res.status(400).json({ success: false, error: 'Missing EA name' });

        // Every magic number that belongs to this EA (merged EAs share a name)
        const magics = magicsForEA(ea);

        // useEA:false → the ea query param is ignored here, we pin the magics ourselves
        const f = scopeFilter(req, { acc: 't.account_number', magic: 't.magic_number', date: 't.close_time', useEA: false });
        f.sql += inList('t.magic_number', magics, f.params);
        const r = rangeFilter(req, 't.close_time');

        const totals = db.prepare(`
            SELECT
                COUNT(*) as total_trades,
                COALESCE(SUM(t.net_profit), 0) as net_pnl,
                COALESCE(SUM(t.volume), 0) as total_volume,
                SUM(CASE WHEN t.net_profit > 0 THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN t.net_profit < 0 THEN 1 ELSE 0 END) as losses
            FROM trades t
            WHERE 1=1 ${f.sql} ${r.sql}
        `).get(...f.params, ...r.params);

        const limit = Math.min(Math.max(Number(req.query.limit) || TRADES_PAGE_DEFAULT, 1), TRADES_PAGE_MAX);
        const offset = Math.max(Number(req.query.offset) || 0, 0);

        const trades = db.prepare(`
            SELECT
                t.ticket, t.account_number, t.symbol, t.trade_type, t.volume,
                t.open_price, t.close_price, t.open_time, t.close_time,
                t.profit, t.commission, t.swap, t.net_profit, t.comment
            FROM trades t
            WHERE 1=1 ${f.sql} ${r.sql}
            ORDER BY REPLACE(t.close_time, '.', '-') DESC, t.id DESC
            LIMIT ? OFFSET ?
        `).all(...f.params, ...r.params, limit, offset);

        const reg = eaNameMap();
        const stored = magics.map((m) => reg[m] && reg[m].color).filter((c) => c && c !== '#3b82f6')[0];
        const total = totals.total_trades || 0;
        const wins = totals.wins || 0;
        const losses = totals.losses || 0;

        res.json({
            success: true,
            ea: { ea_name: ea, color: colorFor(ea, stored), magic_numbers: magics.slice().sort((a, b) => a - b) },
            period: {
                from: isYMD(req.query.from) ? req.query.from : null,
                to: isYMD(req.query.to) ? req.query.to : null,
                min_date: req.scope.minDate || null
            },
            totals: {
                net_pnl: r2(totals.net_pnl),
                trades: total,
                wins,
                losses,
                win_rate: total ? Number(((wins / total) * 100).toFixed(1)) : 0,
                volume: r2(totals.total_volume)
            },
            total,
            limit,
            offset,
            trades: trades.map((t) => ({
                ...t,
                volume: Number(t.volume) || 0,
                profit: r2(t.profit),
                commission: r2(t.commission),
                swap: r2(t.swap),
                net_profit: r2(t.net_profit)
            }))
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


router.get('/calendar', (req, res) => {
    try {
        const now = new Date();
        const year = Number(req.query.year) || now.getFullYear();
        const month = String(Number(req.query.month) || now.getMonth() + 1).padStart(2, '0');
        const monthPrefix = `${year}-${month}`;

        const f = scopeFilter(req, { date: 'close_time' });
        const dailyStats = db.prepare(`
            SELECT
                ${DAY('close_time')} as date,
                COALESCE(SUM(net_profit), 0) as profit,
                COUNT(*) as trades_count,
                SUM(CASE WHEN net_profit > 0 THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN net_profit < 0 THEN 1 ELSE 0 END) as losses
            FROM trades
            WHERE substr(REPLACE(close_time, '.', '-'), 1, 7) = ? ${f.sql}
            GROUP BY ${DAY('close_time')}
            ORDER BY date ASC
        `).all(monthPrefix, ...f.params);

        res.json({
            success: true,
            year,
            month: Number(month),
            month_prefix: monthPrefix,
            month_total_pnl: dailyStats.reduce((s, d) => s + d.profit, 0),
            month_total_trades: dailyStats.reduce((s, d) => s + d.trades_count, 0),
            days: dailyStats
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


// ==========================================
// 📉 DRAWDOWN ENGINE — balance (closed trades) + equity (closed + floating samples)
// ==========================================
function scoped(req, magics, cols = {}) {
    const f = scopeFilter(req, { ...cols, useEA: !magics });
    if (magics) f.sql += inList(cols.magic || 'magic_number', magics, f.params);
    return f;
}
function rangeStart(req) {
    const from = isYMD(req.query.from) ? req.query.from : null;
    const min = req.scope.minDate;
    if (from && min) return from > min ? from : min;
    return from || min || null;
}
const includesToday = (req) => !isYMD(req.query.to) || req.query.to >= new Date().toISOString().slice(0, 10);

// Accounts that make up the starting balance of this scope (for an EA: only accounts it traded on)
function involvedAccounts(req, magics) {
    const a = scopeFilter(req, { useEA: false });
    let accs = db.prepare(`SELECT account_number, balance FROM accounts WHERE 1=1 ${a.sql}`).all(...a.params);
    if (magics) {
        const p = [];
        const m = inList('magic_number', magics, p);
        const used = new Set(db.prepare(`
            SELECT account_number FROM trades WHERE 1=1 ${m}
            UNION SELECT account_number FROM open_positions WHERE 1=1 ${m}
            UNION SELECT account_number FROM floating_samples WHERE 1=1 ${m}
        `).all(...p, ...p, ...p).map((r) => r.account_number));
        accs = accs.filter((x) => used.has(x.account_number));
    }
    return accs;
}

function tracker(base) {
    return { peak: base, peakT: null, maxDD: 0, maxPct: 0, ddPeak: base, ddPeakT: null, troughT: null, troughV: base, cur: 0, curPct: 0, last: base };
}
function track(k, v, t) {
    if (v > k.peak) { k.peak = v; k.peakT = t; }
    const dd = k.peak - v;
    const pct = k.peak > 0 ? (dd / k.peak) * 100 : 0;
    if (dd > k.maxDD) Object.assign(k, { maxDD: dd, ddPeak: k.peak, ddPeakT: k.peakT, troughT: t, troughV: v });
    if (pct > k.maxPct) k.maxPct = pct;
    Object.assign(k, { cur: dd, curPct: pct, last: v });
    return { dd, pct };
}
function summary(k) {
    return {
        max_dd: r2(k.maxDD), max_dd_pct: r2(k.maxPct), current_dd: r2(k.cur), current_dd_pct: r2(k.curPct),
        peak_value: r2(k.ddPeak), trough_value: r2(k.troughV), current_value: r2(k.last),
        peak_time: k.maxDD > 0 ? isoOf(k.ddPeakT) : null, trough_time: k.maxDD > 0 ? isoOf(k.troughT) : null
    };
}

function ddWalk(req, magics = null, withCurve = false) {
    if (!magics && req.query.ea && req.query.ea !== 'all') magics = magicsForEA(String(req.query.ea));
    const accs = involvedAccounts(req, magics);
    const netAll = {};
    db.prepare('SELECT account_number, COALESCE(SUM(net_profit), 0) AS s FROM trades GROUP BY account_number').all()
        .forEach((r) => { netAll[r.account_number] = r.s; });
    let base = accs.reduce((s, a) => s + a.balance - (netAll[a.account_number] || 0), 0);
    const start = rangeStart(req);
    if (start) {
        const p = scoped(req, magics);
        base += db.prepare(`SELECT COALESCE(SUM(net_profit), 0) AS s FROM trades WHERE ${DAY('close_time')} < ? ${p.sql}`).get(start, ...p.params).s;
    }

    const t = scoped(req, magics, { date: 'close_time' });
    const r = rangeFilter(req, 'close_time');
    const trades = db.prepare(`
        SELECT account_number, REPLACE(close_time, '.', '-') AS time, net_profit, symbol
        FROM trades WHERE 1=1 ${t.sql} ${r.sql} ORDER BY time ASC, id ASC
    `).all(...t.params, ...r.params);
    const s = scoped(req, magics, { date: 'sample_time' });
    const rs = rangeFilter(req, 'sample_time');
    const samples = db.prepare(`
        SELECT account_number, sample_time AS time, SUM(floating) AS fl
        FROM floating_samples WHERE account_number IN (SELECT account_number FROM accounts) ${s.sql} ${rs.sql} GROUP BY account_number, sample_time ORDER BY sample_time
    `).all(...s.params, ...rs.params);

    const events = trades.map((x) => ({ k: 0, t: tms(x.time), x }))
        .concat(samples.map((x) => ({ k: 1, t: tms(x.time), x })))
        .sort((a, b) => a.t - b.t || a.k - b.k);

    let floatingNow = 0;
    if (includesToday(req)) {
        const o = scoped(req, magics);
        const rows = db.prepare(`SELECT account_number, SUM(profit + swap) AS fl FROM open_positions WHERE 1=1 ${o.sql} GROUP BY account_number`).all(...o.params);
        floatingNow = rows.reduce((sum, x) => sum + x.fl, 0);
        const set = new Set(accs.map((a) => a.account_number));
        const offs = db.prepare('SELECT account_number, time_offset_min FROM known_accounts').all()
            .filter((x) => set.has(x.account_number)).map((x) => x.time_offset_min || 0);
        const now = Date.now() + Math.max(0, ...offs) * 60000;
        events.push({ k: 2, t: Math.max(now, events.length ? events[events.length - 1].t : 0), rows });
    }

    const B = tracker(base), E = tracker(base);
    if (events.length) B.peakT = E.peakT = events[0].t - 1000;
    let bal = base, cum = 0;
    const fl = {};
    const curve = [];
    const floatAt = (time, live) => Object.values(fl).reduce((sum, f) => sum + (live || time - f.t <= FRESH_MS ? f.v : 0), 0);
    for (const e of events) {
        if (e.k === 0) {
            bal += e.x.net_profit; cum += e.x.net_profit;
            delete fl[e.x.account_number];
            const d = track(B, bal, e.t);
            if (withCurve) curve.push({ time: e.x.time, profit: e.x.net_profit, cumulative_profit: r2(cum), balance: r2(bal), dd: r2(d.dd), dd_pct: r2(d.pct), symbol: e.x.symbol });
        } else if (e.k === 1) {
            fl[e.x.account_number] = { t: e.t, v: e.x.fl };
        } else {
            Object.keys(fl).forEach((key) => delete fl[key]);
            e.rows.forEach((x) => { fl[x.account_number] = { t: e.t, v: x.fl }; });
        }
        track(E, bal + floatAt(e.t, e.k === 2), e.t);
    }

    return {
        start_balance: r2(base),
        floating_now: r2(floatingNow),
        balance: summary(B),
        equity: summary(E),
        equity_samples: samples.length,
        curve
    };
}

router.get('/charts/equity-curve', (req, res) => {
    try {
        const w = ddWalk(req, null, true);
        res.json({ success: true, curve: w.curve, start_balance: w.start_balance, drawdown: w.balance });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Overall + per-EA max drawdown (balance & equity based), live
router.get('/drawdown', (req, res) => {
    try {
        const overall = ddWalk(req);
        const f = scopeFilter(req, { date: 'close_time' });
        const r = rangeFilter(req, 'close_time');
        const o = scopeFilter(req);
        const s = scopeFilter(req, { date: 'sample_time' });
        const rs = rangeFilter(req, 'sample_time');
        const magics = db.prepare(`
            SELECT magic_number FROM trades WHERE 1=1 ${f.sql} ${r.sql}
            UNION SELECT magic_number FROM open_positions WHERE 1=1 ${o.sql}
            UNION SELECT magic_number FROM floating_samples WHERE account_number IN (SELECT account_number FROM accounts) ${s.sql} ${rs.sql}
        `).all(...f.params, ...r.params, ...o.params, ...s.params, ...rs.params).map((x) => x.magic_number);

        const reg = eaNameMap();
        const groups = {};
        magics.forEach((m) => {
            const name = nameOf(reg, m);
            if (!groups[name]) groups[name] = { ea_name: name, color: colorFor(name, reg[m] && reg[m].color), magic_numbers: [] };
            groups[name].magic_numbers.push(m);
        });
        const eas = Object.values(groups).map((g) => {
            const w = ddWalk(req, g.magic_numbers);
            return { ...g, magic_numbers: g.magic_numbers.sort((a, b) => a - b), start_balance: w.start_balance, floating_now: w.floating_now, balance: w.balance, equity: w.equity, equity_samples: w.equity_samples };
        }).sort((a, b) => b.equity.max_dd - a.equity.max_dd || b.balance.max_dd - a.balance.max_dd);

        const { curve, ...rest } = overall;
        res.json({ success: true, overall: rest, eas });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


router.get('/open-positions', (req, res) => {
    try {
        const f = scopeFilter(req);
        const reg = eaNameMap();
        const positions = db.prepare(`SELECT * FROM open_positions WHERE 1=1 ${f.sql} ORDER BY open_time DESC`).all(...f.params)
            .map((p) => ({ ...p, ea_name: nameOf(reg, p.magic_number) }));
        res.json({ success: true, positions });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


router.get('/pending-orders', (req, res) => {
    try {
        const f = scopeFilter(req);
        const reg = eaNameMap();
        const orders = db.prepare(`SELECT * FROM pending_orders WHERE 1=1 ${f.sql} ORDER BY setup_time DESC`).all(...f.params)
            .map((o) => ({ ...o, ea_name: nameOf(reg, o.magic_number) }));
        res.json({ success: true, orders });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


// ==========================================
// 🛠 3. ADMIN-ONLY MANAGEMENT (never reachable with a share link)
// ==========================================

// ─── EA NAMES ───
router.get('/ea-names', auth.requireAdmin, (req, res) => {
    const reg = eaNameMap();
    const magics = db.prepare(`
        SELECT magic_number FROM ea_registry
        UNION SELECT magic_number FROM trades
        UNION SELECT magic_number FROM open_positions
        UNION SELECT magic_number FROM pending_orders
        ORDER BY magic_number
    `).all().map((r) => r.magic_number);
    const names = magics.map((m) => {
        const name = nameOf(reg, m);
        return { magic_number: m, ea_name: name, is_default: name === `EA #${m}`, color: colorFor(name, reg[m] && reg[m].color) };
    });
    res.json({ success: true, names });
});

router.put('/ea-names/:magic', auth.requireAdmin, (req, res) => {
    const magic = Number(req.params.magic);
    if (!Number.isInteger(magic)) return res.status(400).json({ success: false, error: 'Invalid magic number' });
    let name = String((req.body || {}).ea_name || '').trim().slice(0, 60);
    if (!name) name = `EA #${magic}`;
    // Reuse exact spelling of an existing name (case-insensitive) so EAs merge reliably
    const existing = db.prepare('SELECT ea_name FROM ea_registry WHERE lower(ea_name) = lower(?) LIMIT 1').get(name);
    if (existing) name = existing.ea_name;
    const color = /^#[0-9a-fA-F]{6}$/.test((req.body || {}).color || '') ? req.body.color : '#3b82f6';
    db.prepare(`
        INSERT INTO ea_registry (magic_number, ea_name, color) VALUES (?, ?, ?)
        ON CONFLICT(magic_number) DO UPDATE SET ea_name = excluded.ea_name, color = excluded.color
    `).run(magic, name, color);
    // Keep one colour per merged EA
    if (color !== '#3b82f6') db.prepare('UPDATE ea_registry SET color = ? WHERE ea_name = ?').run(color, name);
    res.json({ success: true, magic_number: magic, ea_name: name });
});

// ─── PROFILES ───
function listProfiles() {
    return db.prepare('SELECT id, name, created_at FROM profiles ORDER BY name').all()
        .map((p) => ({ ...p, accounts: auth.profileAccounts(p.id) }));
}

router.get('/profiles', auth.requireAdmin, (req, res) => {
    res.json({ success: true, profiles: listProfiles() });
});

router.get('/known-accounts', auth.requireAdmin, (req, res) => {
    const accounts = db.prepare(`
        SELECT k.account_number, k.account_name, k.broker, k.last_seen,
               CASE WHEN a.account_number IS NULL THEN 0 ELSE 1 END as online
        FROM known_accounts k LEFT JOIN accounts a ON a.account_number = k.account_number
        UNION
        SELECT pa.account_number, '', '', NULL, 0 FROM profile_accounts pa
        WHERE pa.account_number NOT IN (SELECT account_number FROM known_accounts)
        ORDER BY 1
    `).all();
    res.json({ success: true, accounts });
});

function setProfileAccounts(id, accounts) {
    db.prepare('DELETE FROM profile_accounts WHERE profile_id = ?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO profile_accounts (profile_id, account_number) VALUES (?, ?)');
    [...new Set(accounts.map(String))].forEach((a) => ins.run(id, a));
}

router.post('/profiles', auth.requireAdmin, (req, res) => {
    const name = String((req.body || {}).name || '').trim().slice(0, 40);
    if (!name) return res.status(400).json({ success: false, error: 'Profile name is required' });
    if (db.prepare('SELECT 1 FROM profiles WHERE lower(name) = lower(?)').get(name)) {
        return res.status(409).json({ success: false, error: 'A profile with that name already exists' });
    }
    const id = db.transaction(() => {
        const newId = db.prepare('INSERT INTO profiles (name) VALUES (?)').run(name).lastInsertRowid;
        setProfileAccounts(newId, Array.isArray(req.body.accounts) ? req.body.accounts : []);
        return newId;
    })();
    res.json({ success: true, profile: listProfiles().find((p) => p.id === Number(id)) });
});

router.put('/profiles/:id', auth.requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM profiles WHERE id = ?').get(id)) return res.status(404).json({ success: false, error: 'Profile not found' });
    const { name, accounts } = req.body || {};
    try {
        db.transaction(() => {
            if (name !== undefined) {
                const n = String(name).trim().slice(0, 40);
                if (!n) throw new Error('Profile name is required');
                db.prepare('UPDATE profiles SET name = ? WHERE id = ?').run(n, id);
            }
            if (Array.isArray(accounts)) setProfileAccounts(id, accounts);
        })();
    } catch (err) {
        const msg = /UNIQUE/.test(err.message) ? 'A profile with that name already exists' : err.message;
        return res.status(400).json({ success: false, error: msg });
    }
    res.json({ success: true, profile: listProfiles().find((p) => p.id === id) });
});

router.delete('/profiles/:id', auth.requireAdmin, (req, res) => {
    db.prepare('DELETE FROM profiles WHERE id = ?').run(Number(req.params.id)); // cascades to accounts + share links
    res.json({ success: true });
});

// ─── SHARE LINKS ───
router.get('/shares', auth.requireAdmin, (req, res) => {
    const shares = db.prepare(`
        SELECT s.id, s.token, s.profile_id, p.name as profile_name, s.from_date, s.label, s.created_at, s.last_accessed
        FROM share_links s JOIN profiles p ON p.id = s.profile_id
        WHERE s.revoked = 0 ORDER BY s.created_at DESC
    `).all();
    res.json({ success: true, shares });
});

router.post('/shares', auth.requireAdmin, (req, res) => {
    const { profile_id, from_date, label } = req.body || {};
    const profile = db.prepare('SELECT id FROM profiles WHERE id = ?').get(Number(profile_id));
    if (!profile) return res.status(400).json({ success: false, error: 'Choose a profile to share' });
    if (from_date && !isYMD(from_date)) return res.status(400).json({ success: false, error: 'Invalid start date' });
    const token = auth.newShareToken();
    const id = db.prepare('INSERT INTO share_links (token, profile_id, from_date, label) VALUES (?, ?, ?, ?)')
        .run(token, profile.id, from_date || null, String(label || '').trim().slice(0, 60)).lastInsertRowid;
    res.json({ success: true, share: { id: Number(id), token, profile_id: profile.id, from_date: from_date || null } });
});

router.delete('/shares/:id', auth.requireAdmin, (req, res) => {
    db.prepare('UPDATE share_links SET revoked = 1 WHERE id = ?').run(Number(req.params.id));
    res.json({ success: true });
});

router.post('/shares/revoke-all', auth.requireAdmin, (req, res) => {
    const pid = (req.body || {}).profile_id;
    const info = pid
        ? db.prepare('UPDATE share_links SET revoked = 1 WHERE revoked = 0 AND profile_id = ?').run(Number(pid))
        : db.prepare('UPDATE share_links SET revoked = 1 WHERE revoked = 0').run();
    res.json({ success: true, revoked: info.changes });
});

module.exports = router;
