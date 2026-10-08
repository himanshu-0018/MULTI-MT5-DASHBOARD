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

// EA names, profiles and share links are kept — only live/trade data is removed
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


// EAs grouped by NAME — magic numbers sharing a name are merged into one EA
router.get('/eas', (req, res) => {
    try {
        const f = scopeFilter(req, { acc: 't.account_number', magic: 't.magic_number', date: 't.close_time', useAccount: false, useEA: false });
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

        const o = scopeFilter(req, { useAccount: false, useEA: false });
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


router.get('/charts/equity-curve', (req, res) => {
    try {
        const f = scopeFilter(req, { date: 'close_time' });
        const r = rangeFilter(req, 'close_time');
        const trades = db.prepare(`
            SELECT REPLACE(close_time, '.', '-') as close_time, net_profit, symbol, magic_number
            FROM trades
            WHERE 1=1 ${f.sql} ${r.sql}
            ORDER BY close_time ASC
        `).all(...f.params, ...r.params);

        let cumulative = 0;
        const curve = trades.map((t) => {
            cumulative += t.net_profit;
            return { time: t.close_time, profit: t.net_profit, cumulative_profit: Number(cumulative.toFixed(2)), symbol: t.symbol };
        });
        res.json({ success: true, curve });
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
