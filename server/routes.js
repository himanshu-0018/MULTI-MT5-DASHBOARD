const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('./database');

const ADMIN_PIN = process.env.ADMIN_PIN || '8888';

// ─── HELPERS ───
function normalizeDate(dateStr) {
    if (!dateStr) return new Date().toISOString().replace('T', ' ').slice(0, 19);
    return dateStr.replace(/\./g, '-').trim();
}

function slugify(text) {
    return text.toString().toLowerCase().trim()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-]+/g, '')
        .replace(/\-\-+/g, '-');
}

// ─── QUERY SCOPING HELPERS ───
function resolveAllowedAccounts(req) {
    // 1. Share scope active (highest priority — non-bypassable)
    if (req.shareScope) {
        if (req.shareScope.allowedAccounts && req.shareScope.allowedAccounts.length > 0) {
            if (req.query.account && req.query.account !== 'all') {
                return req.shareScope.allowedAccounts.includes(String(req.query.account))
                    ? [String(req.query.account)]
                    : req.shareScope.allowedAccounts;
            }
            return req.shareScope.allowedAccounts;
        }
        if (req.query.account && req.query.account !== 'all') {
            return [String(req.query.account)];
        }
        return null;
    }

    // 2. Profile filter (Master Admin)
    if (req.query.profile && req.query.profile !== 'all') {
        const profile = db.prepare('SELECT account_numbers FROM profiles WHERE id = ? OR slug = ?').get(req.query.profile, req.query.profile);
        if (profile && profile.account_numbers) {
            const accs = profile.account_numbers.split(',').map(s => s.trim()).filter(Boolean);
            if (accs.length > 0) {
                if (req.query.account && req.query.account !== 'all') {
                    return accs.includes(String(req.query.account)) ? [String(req.query.account)] : accs;
                }
                return accs;
            }
        }
    }

    // 3. Direct account filter
    if (req.query.account && req.query.account !== 'all') {
        return [String(req.query.account)];
    }

    return null;
}

function resolveEffectiveFromDate(req) {
    const clientFrom = req.query.from || null;
    const shareFrom = req.shareScope ? req.shareScope.fromDate : null;

    if (shareFrom && clientFrom) {
        return clientFrom > shareFrom ? clientFrom : shareFrom;
    }
    return shareFrom || clientFrom;
}

function resolveMagicNumbers(magicOrName) {
    if (!magicOrName || magicOrName === 'all') return null;

    const byName = db.prepare(`
        SELECT magic_number FROM ea_registry 
        WHERE ea_name = ? OR CAST(magic_number AS TEXT) = ?
    `).all(String(magicOrName), String(magicOrName));

    if (byName.length > 0) {
        return byName.map(r => r.magic_number);
    }

    const num = Number(magicOrName);
    return isNaN(num) ? null : [num];
}

function buildFilterSQL(req, options = {}) {
    const {
        accountCol = 'account_number',
        magicCol = 'magic_number',
        dateCol = 'close_time',
        includeDate = true
    } = options;

    let where = 'WHERE 1=1';
    const params = [];

    // Accounts
    const allowedAccounts = resolveAllowedAccounts(req);
    if (allowedAccounts && allowedAccounts.length > 0) {
        const placeholders = allowedAccounts.map(() => '?').join(',');
        where += ` AND ${accountCol} IN (${placeholders})`;
        params.push(...allowedAccounts);
    }

    // Magics (Merged by EA Name)
    const targetMagics = resolveMagicNumbers(req.query.magic);
    if (targetMagics && targetMagics.length > 0) {
        const placeholders = targetMagics.map(() => '?').join(',');
        where += ` AND ${magicCol} IN (${placeholders})`;
        params.push(...targetMagics);
    }

    // Date Range
    if (includeDate) {
        const effectiveFrom = resolveEffectiveFromDate(req);
        const to = req.query.to || null;

        if (effectiveFrom) {
            where += ` AND substr(REPLACE(${dateCol}, '.', '-'), 1, 10) >= ?`;
            params.push(effectiveFrom);
        }
        if (to) {
            where += ` AND substr(REPLACE(${dateCol}, '.', '-'), 1, 10) <= ?`;
            params.push(to);
        }
    }

    return { where, params };
}

// ==========================================
// 🔐 0. AUTHENTICATION
// ==========================================

router.post('/auth/login', (req, res) => {
    try {
        const { pin } = req.body || {};
        if (!pin) {
            return res.status(400).json({ success: false, error: 'Passcode is required' });
        }
        if (String(pin).trim() === String(ADMIN_PIN).trim()) {
            return res.json({ success: true, token: ADMIN_PIN });
        }
        return res.status(401).json({ success: false, error: 'Incorrect Master Passcode' });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// 📥 1. DATA INGESTION (Called by MT5 EA)
// ==========================================

router.post('/ea/sync', (req, res) => {
    try {
        const { account, open_positions = [], pending_orders = [], recent_trades = [] } = req.body;

        if (!account || !account.account_number) {
            return res.status(400).json({ success: false, error: 'Missing account information' });
        }

        const syncTransaction = db.transaction(() => {
            // 1. Upsert Account Info
            const upsertAccount = db.prepare(`
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
            `);

            upsertAccount.run({
                account_number: String(account.account_number),
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

            // 2. Refresh Open Positions
            db.prepare('DELETE FROM open_positions WHERE account_number = ?').run(String(account.account_number));
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
                const magic = Number(pos.magic_number) || 0;
                insertPosition.run({
                    account_number: String(account.account_number),
                    ticket: String(pos.ticket),
                    magic_number: magic,
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

                if (magic > 0) {
                    db.prepare(`INSERT OR IGNORE INTO ea_registry (magic_number, ea_name) VALUES (?, ?)`).run(magic, `EA #${magic}`);
                }
            }

            // 3. Refresh Pending Orders
            db.prepare('DELETE FROM pending_orders WHERE account_number = ?').run(String(account.account_number));
            const insertPending = db.prepare(`
                INSERT OR REPLACE INTO pending_orders (
                    account_number, ticket, magic_number, symbol, order_type,
                    volume, price_open, price_current, sl, tp, setup_time, expiration, comment, last_update
                ) VALUES (
                    @account_number, @ticket, @magic_number, @symbol, @order_type,
                    @volume, @price_open, @price_current, @sl, @tp, @setup_time, @expiration, @comment, datetime('now')
                )
            `);

            for (const ord of pending_orders) {
                const magic = Number(ord.magic_number) || 0;
                insertPending.run({
                    account_number: String(account.account_number),
                    ticket: String(ord.ticket),
                    magic_number: magic,
                    symbol: ord.symbol || '',
                    order_type: ord.order_type || 'BUY_LIMIT',
                    volume: Number(ord.volume) || 0,
                    price_open: Number(ord.price_open) || 0,
                    price_current: Number(ord.price_current) || 0,
                    sl: Number(ord.sl) || 0,
                    tp: Number(ord.tp) || 0,
                    setup_time: normalizeDate(ord.setup_time),
                    expiration: ord.expiration ? normalizeDate(ord.expiration) : '',
                    comment: ord.comment || ''
                });

                if (magic > 0) {
                    db.prepare(`INSERT OR IGNORE INTO ea_registry (magic_number, ea_name) VALUES (?, ?)`).run(magic, `EA #${magic}`);
                }
            }

            // 4. Upsert Closed Trades
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
                const netProfit = Number(trade.net_profit) !== undefined ? Number(trade.net_profit) : (profit + commission + swap);
                const magic = Number(trade.magic_number) || 0;

                insertTrade.run({
                    account_number: String(account.account_number),
                    ticket: String(trade.ticket),
                    magic_number: magic,
                    symbol: trade.symbol || '',
                    trade_type: trade.trade_type || 'BUY',
                    volume: Number(trade.volume) || 0,
                    open_price: Number(trade.open_price) || 0,
                    close_price: Number(trade.close_price) || 0,
                    open_time: normalizeDate(trade.open_time),
                    close_time: normalizeDate(trade.close_time),
                    profit: profit,
                    commission: commission,
                    swap: swap,
                    net_profit: netProfit,
                    comment: trade.comment || ''
                });

                if (magic > 0) {
                    db.prepare(`INSERT OR IGNORE INTO ea_registry (magic_number, ea_name) VALUES (?, ?)`).run(magic, `EA #${magic}`);
                }
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
                WHERE account_number = ? AND substr(REPLACE(close_time, '.', '-'), 1, 10) = ?
            `).get(String(account.account_number), today);

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
                account_number: String(account.account_number),
                snapshot_date: today,
                balance: Number(account.balance) || 0,
                equity: Number(account.equity) || 0,
                daily_profit: todayStats ? todayStats.daily_profit : 0,
                total_trades: todayStats ? todayStats.total_trades : 0,
                winning_trades: todayStats ? todayStats.winning_trades : 0,
                losing_trades: todayStats ? todayStats.losing_trades : 0
            });
        });

        syncTransaction();
        return res.json({ success: true, message: 'Sync successful' });
    } catch (err) {
        console.error('Error during EA sync:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

// Stale accounts auto-purge
const STALE_SECONDS = 30;
function purgeAccount(accountNumber) {
    const acc = String(accountNumber);
    const tx = db.transaction(() => {
        db.prepare('DELETE FROM open_positions WHERE account_number = ?').run(acc);
        db.prepare('DELETE FROM pending_orders WHERE account_number = ?').run(acc);
        db.prepare('DELETE FROM trades         WHERE account_number = ?').run(acc);
        db.prepare('DELETE FROM daily_snapshots WHERE account_number = ?').run(acc);
        db.prepare('DELETE FROM accounts       WHERE account_number = ?').run(acc);
    });
    tx();
}

router.post('/ea/disconnect', (req, res) => {
    const b = req.body || {};
    const accountNumber = b.account_number || (b.account && b.account.account_number);
    if (!accountNumber) return res.status(400).json({ success: false, error: 'Missing account_number' });
    purgeAccount(accountNumber);
    return res.json({ success: true, message: `Account ${accountNumber} data removed` });
});

setInterval(() => {
    const stale = db.prepare(
        `SELECT account_number FROM accounts WHERE (julianday('now') - julianday(last_update)) * 86400 > ?`
    ).all(STALE_SECONDS);
    stale.forEach(r => purgeAccount(r.account_number));
}, 10000);


// ==========================================
// 🏷️ 2. EA REGISTRY (RENAME & MERGE BY NAME)
// ==========================================

router.get('/ea-registry', (req, res) => {
    try {
        const rows = db.prepare(`
            SELECT magic_number, ea_name, description, color, updated_at
            FROM ea_registry
            ORDER BY ea_name ASC, magic_number ASC
        `).all();

        const activeMagics = db.prepare(`
            SELECT DISTINCT magic_number FROM trades WHERE magic_number > 0
            UNION
            SELECT DISTINCT magic_number FROM open_positions WHERE magic_number > 0
            UNION
            SELECT DISTINCT magic_number FROM pending_orders WHERE magic_number > 0
        `).all();

        for (const m of activeMagics) {
            if (!rows.some(r => r.magic_number === m.magic_number)) {
                db.prepare(`INSERT OR IGNORE INTO ea_registry (magic_number, ea_name) VALUES (?, ?)`).run(m.magic_number, `EA #${m.magic_number}`);
                rows.push({ magic_number: m.magic_number, ea_name: `EA #${m.magic_number}`, description: '', color: '#3b82f6', updated_at: new Date().toISOString() });
            }
        }

        const mergedMap = {};
        rows.forEach(r => {
            const name = r.ea_name || `EA #${r.magic_number}`;
            if (!mergedMap[name]) {
                mergedMap[name] = {
                    ea_name: name,
                    color: r.color || '#3b82f6',
                    description: r.description || '',
                    magic_numbers: []
                };
            }
            mergedMap[name].magic_numbers.push(r.magic_number);
        });

        res.json({
            success: true,
            registry: rows,
            merged_eas: Object.values(mergedMap)
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/ea-registry/rename', (req, res) => {
    if (req.shareScope) return res.status(403).json({ success: false, error: 'Read-only link' });

    try {
        const { magic_number, magic_numbers, ea_name, color, description } = req.body;
        const targetMagics = magic_numbers && Array.isArray(magic_numbers)
            ? magic_numbers.map(Number)
            : [Number(magic_number)].filter(Boolean);

        if (!targetMagics.length || !ea_name) {
            return res.status(400).json({ success: false, error: 'Missing magic_number(s) or ea_name' });
        }

        const cleanName = String(ea_name).trim();
        const cleanColor = color || '#3b82f6';
        const cleanDesc = description || '';

        const upsert = db.prepare(`
            INSERT INTO ea_registry (magic_number, ea_name, color, description, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'))
            ON CONFLICT(magic_number) DO UPDATE SET
                ea_name = excluded.ea_name,
                color = excluded.color,
                description = excluded.description,
                updated_at = datetime('now')
        `);

        const tx = db.transaction(() => {
            for (const mag of targetMagics) {
                upsert.run(mag, cleanName, cleanColor, cleanDesc);
            }
        });
        tx();

        res.json({ success: true, message: `Updated ${targetMagics.length} magic numbers to "${cleanName}"` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


// ==========================================
// 👤 3. PROFILES & SHARE LINKS
// ==========================================

router.get('/profiles', (req, res) => {
    try {
        if (req.shareScope) {
            return res.json({
                success: true,
                profiles: [{
                    id: req.shareScope.profileId,
                    name: req.shareScope.profileName || 'Shared View',
                    slug: 'shared',
                    account_numbers: (req.shareScope.allowedAccounts || []).join(','),
                    is_default: 1,
                    is_shared: true
                }]
            });
        }

        const profiles = db.prepare(`SELECT * FROM profiles ORDER BY is_default DESC, name ASC`).all();
        res.json({ success: true, profiles });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/profiles', (req, res) => {
    if (req.shareScope) return res.status(403).json({ success: false, error: 'Read-only link' });

    try {
        const { name, account_numbers = '', is_default = 0 } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'Profile name is required' });

        const slug = slugify(name);
        const cleanAccs = Array.isArray(account_numbers) ? account_numbers.join(',') : String(account_numbers);

        const info = db.prepare(`
            INSERT INTO profiles (name, slug, account_numbers, is_default)
            VALUES (?, ?, ?, ?)
        `).run(name.trim(), slug, cleanAccs, is_default ? 1 : 0);

        res.json({ success: true, id: info.lastInsertRowid, slug });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/profiles/:id', (req, res) => {
    if (req.shareScope) return res.status(403).json({ success: false, error: 'Read-only link' });

    try {
        const { name, account_numbers, is_default } = req.body;
        const profileId = req.params.id;

        const current = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
        if (!current) return res.status(404).json({ success: false, error: 'Profile not found' });

        const newName = name ? name.trim() : current.name;
        const newSlug = slugify(newName);
        const newAccs = account_numbers !== undefined
            ? (Array.isArray(account_numbers) ? account_numbers.join(',') : String(account_numbers))
            : current.account_numbers;
        const newDef = is_default !== undefined ? (is_default ? 1 : 0) : current.is_default;

        db.prepare(`
            UPDATE profiles
            SET name = ?, slug = ?, account_numbers = ?, is_default = ?, updated_at = datetime('now')
            WHERE id = ?
        `).run(newName, newSlug, newAccs, newDef, profileId);

        res.json({ success: true, message: 'Profile updated' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/profiles/:id', (req, res) => {
    if (req.shareScope) return res.status(403).json({ success: false, error: 'Read-only link' });

    try {
        const profileId = req.params.id;
        const current = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profileId);
        if (!current) return res.status(404).json({ success: false, error: 'Profile not found' });
        if (current.slug === 'all') return res.status(400).json({ success: false, error: 'Cannot delete default "All Accounts" profile' });

        db.prepare('DELETE FROM profiles WHERE id = ?').run(profileId);
        res.json({ success: true, message: 'Profile deleted' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/share', (req, res) => {
    if (req.shareScope) return res.status(403).json({ success: false, error: 'Cannot generate share link from a shared view' });

    try {
        const { profile_id, label = '', from_date = null, expires_days = null } = req.body;
        if (!profile_id) return res.status(400).json({ success: false, error: 'Missing profile_id' });

        const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(profile_id);
        if (!profile) return res.status(404).json({ success: false, error: 'Profile not found' });

        const token = crypto.randomBytes(12).toString('hex');
        let expiresAt = null;
        if (expires_days && Number(expires_days) > 0) {
            const exp = new Date();
            exp.setDate(exp.getDate() + Number(expires_days));
            expiresAt = exp.toISOString();
        }

        db.prepare(`
            INSERT INTO share_links (token, profile_id, label, from_date, expires_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(token, profile_id, label || `${profile.name} Share`, from_date || null, expiresAt);

        res.json({
            success: true,
            token,
            share_url: `/?share=${token}`,
            from_date: from_date || null,
            profile_name: profile.name
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/share/list', (req, res) => {
    if (req.shareScope) return res.status(403).json({ success: false, error: 'Unauthorized' });

    try {
        const links = db.prepare(`
            SELECT s.*, p.name as profile_name
            FROM share_links s
            JOIN profiles p ON p.id = s.profile_id
            ORDER BY s.created_at DESC
        `).all();

        res.json({ success: true, links });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/share/:token', (req, res) => {
    if (req.shareScope) return res.status(403).json({ success: false, error: 'Unauthorized' });

    try {
        db.prepare('DELETE FROM share_links WHERE token = ?').run(req.params.token);
        res.json({ success: true, message: 'Share link revoked' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/share/info', (req, res) => {
    if (!req.shareScope) {
        return res.json({ success: true, is_shared: false });
    }
    return res.json({
        success: true,
        is_shared: true,
        profile_name: req.shareScope.profileName,
        from_date: req.shareScope.fromDate,
        allowed_accounts_count: req.shareScope.allowedAccounts ? req.shareScope.allowedAccounts.length : 'All'
    });
});


// ==========================================
// 📊 4. DASHBOARD DATA ENDPOINTS
// ==========================================

router.get('/overview', (req, res) => {
    try {
        const allowedAccounts = resolveAllowedAccounts(req);
        let accWhere = 'WHERE is_active = 1';
        let accParams = [];
        if (allowedAccounts && allowedAccounts.length > 0) {
            accWhere += ` AND account_number IN (${allowedAccounts.map(() => '?').join(',')})`;
            accParams.push(...allowedAccounts);
        }

        const totalAccounts = db.prepare(`SELECT COUNT(*) as count FROM accounts ${accWhere}`).get(...accParams).count;
        const accountTotals = db.prepare(`SELECT SUM(balance) as total_balance, SUM(equity) as total_equity FROM accounts ${accWhere}`).get(...accParams) || { total_balance: 0, total_equity: 0 };

        // Floating P&L
        const openFilter = buildFilterSQL(req, { includeDate: false });
        const floatingStats = db.prepare(`
            SELECT COALESCE(SUM(profit + swap), 0) as floating_pnl, COUNT(*) as open_trades
            FROM open_positions ${openFilter.where}
        `).get(...openFilter.params);

        // Pending Orders Count
        const pendingFilter = buildFilterSQL(req, { includeDate: false });
        const pendingStats = db.prepare(`
            SELECT COUNT(*) as pending_count
            FROM pending_orders ${pendingFilter.where}
        `).get(...pendingFilter.params);

        // Today PnL
        const todayStr = new Date().toISOString().slice(0, 10);
        const todayFilter = buildFilterSQL(req, { includeDate: false });
        const todayStats = db.prepare(`
            SELECT COALESCE(SUM(net_profit), 0) as today_pnl 
            FROM trades 
            ${todayFilter.where} AND substr(REPLACE(close_time, '.', '-'), 1, 10) = ?
        `).get(...todayFilter.params, todayStr);

        // Running Month PnL
        const currentMonthStr = todayStr.slice(0, 7);
        const monthFilter = buildFilterSQL(req, { includeDate: false });
        const monthStats = db.prepare(`
            SELECT COALESCE(SUM(net_profit), 0) as month_pnl 
            FROM trades 
            ${monthFilter.where} AND substr(REPLACE(close_time, '.', '-'), 1, 7) = ?
        `).get(...monthFilter.params, currentMonthStr);

        // Overall Closed Stats
        const rangeFilter = buildFilterSQL(req, { includeDate: true });
        const overallTrades = db.prepare(`
            SELECT 
                COUNT(*) as total_trades,
                COALESCE(SUM(net_profit), 0) as total_closed_profit,
                SUM(CASE WHEN net_profit > 0 THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN net_profit < 0 THEN 1 ELSE 0 END) as losses,
                COALESCE(SUM(CASE WHEN net_profit > 0 THEN net_profit ELSE 0 END), 0) as gross_profit,
                COALESCE(ABS(SUM(CASE WHEN net_profit < 0 THEN net_profit ELSE 0 END)), 0) as gross_loss
            FROM trades
            ${rangeFilter.where}
        `).get(...rangeFilter.params);

        const winRate = overallTrades.total_trades > 0 
            ? ((overallTrades.wins / overallTrades.total_trades) * 100).toFixed(1) 
            : 0;

        const profitFactor = overallTrades.gross_loss > 0 
            ? (overallTrades.gross_profit / overallTrades.gross_loss).toFixed(2) 
            : overallTrades.gross_profit > 0 ? 'MAX' : '0.00';

        res.json({
            success: true,
            total_accounts: totalAccounts,
            total_balance: accountTotals.total_balance || 0,
            total_equity: accountTotals.total_equity || 0,
            floating_pnl: floatingStats.floating_pnl || 0,
            open_trades_count: floatingStats.open_trades || 0,
            pending_trades_count: pendingStats.pending_count || 0,
            today_pnl: todayStats ? todayStats.today_pnl : 0,
            month_pnl: monthStats ? monthStats.month_pnl : 0,
            total_closed_profit: overallTrades.total_closed_profit || 0,
            win_rate: Number(winRate),
            profit_factor: profitFactor,
            total_trades: overallTrades.total_trades,
            wins: overallTrades.wins || 0,
            losses: overallTrades.losses || 0
        });

    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/accounts', (req, res) => {
    try {
        const todayStr = new Date().toISOString().slice(0, 10);
        const allowedAccounts = resolveAllowedAccounts(req);
        let accWhere = 'WHERE 1=1';
        let accParams = [];

        if (allowedAccounts && allowedAccounts.length > 0) {
            accWhere += ` AND a.account_number IN (${allowedAccounts.map(() => '?').join(',')})`;
            accParams.push(...allowedAccounts);
        }

        const accounts = db.prepare(`
            SELECT 
                a.*,
                COALESCE((SELECT SUM(profit + swap) FROM open_positions WHERE account_number = a.account_number), 0) as floating_pnl,
                COALESCE((SELECT COUNT(*) FROM open_positions WHERE account_number = a.account_number), 0) as open_count,
                COALESCE((SELECT COUNT(*) FROM pending_orders WHERE account_number = a.account_number), 0) as pending_count,
                COALESCE((SELECT SUM(net_profit) FROM trades WHERE account_number = a.account_number AND substr(REPLACE(close_time, '.', '-'), 1, 10) = ?), 0) as today_profit,
                COALESCE((SELECT SUM(net_profit) FROM trades WHERE account_number = a.account_number), 0) as total_profit
            FROM accounts a
            ${accWhere}
            ORDER BY a.account_number ASC
        `).all(todayStr, ...accParams);

        res.json({ success: true, accounts });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/eas', (req, res) => {
    try {
        const filter = buildFilterSQL(req, { accountCol: 't.account_number', magicCol: 't.magic_number', dateCol: 't.close_time', includeDate: true });

        const rows = db.prepare(`
            SELECT 
                COALESCE(NULLIF(r.ea_name, ''), 'EA #' || t.magic_number) as ea_name,
                COALESCE(r.color, '#3b82f6') as color,
                COALESCE(r.description, '') as description,
                GROUP_CONCAT(DISTINCT t.magic_number) as magic_numbers_csv,
                COUNT(t.id) as total_trades,
                SUM(t.net_profit) as total_pnl,
                SUM(CASE WHEN t.net_profit > 0 THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN t.net_profit < 0 THEN 1 ELSE 0 END) as losses
            FROM trades t
            LEFT JOIN ea_registry r ON t.magic_number = r.magic_number
            ${filter.where}
            GROUP BY ea_name
            ORDER BY total_pnl DESC
        `).all(...filter.params);

        const allowedAccounts = resolveAllowedAccounts(req);
        let posWhere = 'WHERE 1=1';
        let posParams = [];
        if (allowedAccounts && allowedAccounts.length > 0) {
            posWhere += ` AND op.account_number IN (${allowedAccounts.map(() => '?').join(',')})`;
            posParams.push(...allowedAccounts);
        }

        const openRows = db.prepare(`
            SELECT 
                COALESCE(NULLIF(r.ea_name, ''), 'EA #' || op.magic_number) as ea_name,
                SUM(op.profit + op.swap) as open_pnl,
                COUNT(*) as open_count
            FROM open_positions op
            LEFT JOIN ea_registry r ON op.magic_number = r.magic_number
            ${posWhere}
            GROUP BY ea_name
        `).all(...posParams);

        const openMap = {};
        openRows.forEach(o => { openMap[o.ea_name] = o; });

        const eas = rows.map(ea => {
            const op = openMap[ea.ea_name] || { open_pnl: 0, open_count: 0 };
            const magics = (ea.magic_numbers_csv || '').split(',').map(Number).filter(Boolean);
            return {
                ...ea,
                magic_numbers: magics,
                primary_magic: magics[0] || 0,
                open_pnl: op.open_pnl || 0,
                open_count: op.open_count || 0
            };
        });

        res.json({ success: true, eas });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/calendar', (req, res) => {
    try {
        const now = new Date();
        const year = req.query.year || now.getFullYear();
        const month = req.query.month ? String(req.query.month).padStart(2, '0') : String(now.getMonth() + 1).padStart(2, '0');
        const monthPrefix = `${year}-${month}`;

        const filter = buildFilterSQL(req, { includeDate: false });
        let where = `${filter.where} AND substr(REPLACE(close_time, '.', '-'), 1, 7) = ?`;
        let params = [...filter.params, monthPrefix];

        const dailyStats = db.prepare(`
            SELECT 
                substr(REPLACE(close_time, '.', '-'), 1, 10) as date,
                COALESCE(SUM(net_profit), 0) as profit,
                COUNT(*) as trades_count,
                SUM(CASE WHEN net_profit > 0 THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN net_profit < 0 THEN 1 ELSE 0 END) as losses
            FROM trades
            ${where}
            GROUP BY substr(REPLACE(close_time, '.', '-'), 1, 10)
            ORDER BY date ASC
        `).all(...params);

        const monthTotal = dailyStats.reduce((sum, d) => sum + d.profit, 0);
        const totalMonthTrades = dailyStats.reduce((sum, d) => sum + d.trades_count, 0);

        res.json({
            success: true,
            year: Number(year),
            month: Number(month),
            month_prefix: monthPrefix,
            month_total_pnl: monthTotal,
            month_total_trades: totalMonthTrades,
            days: dailyStats
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/charts/equity-curve', (req, res) => {
    try {
        const filter = buildFilterSQL(req, { includeDate: true });

        const trades = db.prepare(`
            SELECT 
                REPLACE(close_time, '.', '-') as close_time,
                net_profit,
                symbol,
                magic_number
            FROM trades
            ${filter.where}
            ORDER BY close_time ASC
        `).all(...filter.params);

        let cumulative = 0;
        const curve = trades.map(t => {
            cumulative += t.net_profit;
            return {
                time: t.close_time,
                profit: t.net_profit,
                cumulative_profit: Number(cumulative.toFixed(2)),
                symbol: t.symbol
            };
        });

        res.json({ success: true, curve });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/open-positions', (req, res) => {
    try {
        const filter = buildFilterSQL(req, { accountCol: 'op.account_number', magicCol: 'op.magic_number', includeDate: false });

        const positions = db.prepare(`
            SELECT 
                op.*,
                COALESCE(NULLIF(r.ea_name, ''), 'EA #' || op.magic_number) as ea_name
            FROM open_positions op
            LEFT JOIN ea_registry r ON op.magic_number = r.magic_number
            ${filter.where}
            ORDER BY op.open_time DESC
        `).all(...filter.params);

        res.json({ success: true, positions });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/pending-orders', (req, res) => {
    try {
        const filter = buildFilterSQL(req, { accountCol: 'po.account_number', magicCol: 'po.magic_number', includeDate: false });

        const orders = db.prepare(`
            SELECT 
                po.*,
                COALESCE(NULLIF(r.ea_name, ''), 'EA #' || po.magic_number) as ea_name
            FROM pending_orders po
            LEFT JOIN ea_registry r ON po.magic_number = r.magic_number
            ${filter.where}
            ORDER BY po.setup_time DESC
        `).all(...filter.params);

        res.json({ success: true, orders });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
