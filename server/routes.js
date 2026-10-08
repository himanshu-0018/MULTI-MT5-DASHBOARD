const express = require('express');
const router = express.Router();
const db = require('./database');
const crypto = require('crypto');

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function normalizeDate(dateStr) {
    if (!dateStr) return new Date().toISOString().replace('T', ' ').slice(0, 19);
    return dateStr.replace(/\./g, '-').trim();
}

// Validate share token and return restrictions (or null if no token)
function getShareRestrictions(req) {
    const token = req.query.share_token;
    if (!token) return null;
    const row = db.prepare('SELECT * FROM share_tokens WHERE token = ? AND is_active = 1').get(token);
    if (!row) return { invalid: true };
    return {
        invalid: false,
        profile_id: row.profile_id,
        account_number: row.account_number,
        from_date: row.from_date
    };
}

// Build account-level WHERE fragment (works for trades, positions, accounts, etc.)
function buildAccountWhere(share, reqAccount, tableAlias) {
    const col = tableAlias ? `${tableAlias}.account_number` : 'account_number';
    let where = '';
    const params = [];

    if (share && !share.invalid) {
        if (share.account_number) {
            where += ` AND ${col} = ?`;
            params.push(share.account_number);
        } else if (share.profile_id) {
            where += ` AND ${col} IN (SELECT account_number FROM accounts WHERE profile_id = ?)`;
            params.push(share.profile_id);
        }
    } else if (reqAccount && reqAccount !== 'all') {
        where += ` AND ${col} = ?`;
        params.push(reqAccount);
    }
    return { where, params };
}

// Build trade-date WHERE fragment (from/to) — share from_date overrides req.from
function buildTradeDateWhere(share, reqFrom, reqTo) {
    let where = '';
    const params = [];
    const fromDate = (share && !share.invalid && share.from_date) ? share.from_date : reqFrom;
    if (fromDate) {
        where += " AND substr(REPLACE(close_time, '.', '-'), 1, 10) >= ?";
        params.push(fromDate);
    }
    if (reqTo) {
        where += " AND substr(REPLACE(close_time, '.', '-'), 1, 10) <= ?";
        params.push(reqTo);
    }
    return { where, params };
}


// ═══════════════════════════════════════════════════════════════
// 🔐 AUTH ENDPOINTS
// ═══════════════════════════════════════════════════════════════

router.post('/auth/verify', (req, res) => {
    try {
        const { passcode } = req.body;
        if (!passcode) return res.status(400).json({ success: false, error: 'Missing passcode' });

        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('master_passcode');
        if (!row) return res.json({ success: true, message: 'No passcode configured' });

        const hash = crypto.createHash('sha256').update(String(passcode)).digest('hex');
        if (hash === row.value) {
            return res.json({ success: true, message: 'Authenticated' });
        }
        return res.status(401).json({ success: false, error: 'Incorrect passcode' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/auth/change-passcode', (req, res) => {
    try {
        const { old_passcode, new_passcode } = req.body;
        if (!old_passcode || !new_passcode) return res.status(400).json({ success: false, error: 'Missing passcodes' });
        if (new_passcode.length < 4) return res.status(400).json({ success: false, error: 'New passcode must be at least 4 characters' });

        const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('master_passcode');
        const oldHash = crypto.createHash('sha256').update(String(old_passcode)).digest('hex');
        if (row && row.value !== oldHash) return res.status(401).json({ success: false, error: 'Current passcode is incorrect' });

        const newHash = crypto.createHash('sha256').update(String(new_passcode)).digest('hex');
        db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
                     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
          .run('master_passcode', newHash);

        res.json({ success: true, message: 'Passcode changed' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Check if passcode is configured (for lock screen logic)
router.get('/auth/status', (req, res) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('master_passcode');
    res.json({ success: true, passcode_set: !!row });
});


// ═══════════════════════════════════════════════════════════════
// 👤 PROFILE ENDPOINTS
// ═══════════════════════════════════════════════════════════════

router.get('/profiles', (req, res) => {
    try {
        const profiles = db.prepare(`
            SELECT p.*, 
                   COUNT(a.id) as account_count
            FROM profiles p
            LEFT JOIN accounts a ON a.profile_id = p.id AND a.is_active = 1
            GROUP BY p.id
            ORDER BY p.is_default DESC, p.id ASC
        `).all();
        res.json({ success: true, profiles });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/profiles', (req, res) => {
    try {
        const { name, description, color, icon } = req.body;
        if (!name) return res.status(400).json({ success: false, error: 'Profile name required' });
        const result = db.prepare(`
            INSERT INTO profiles (name, description, color, icon)
            VALUES (?, ?, ?, ?)
        `).run(name, description || '', color || '#22d3ee', icon || 'briefcase');
        res.json({ success: true, id: result.lastInsertRowid, message: 'Profile created' });
    } catch (err) {
        if (err.message.includes('UNIQUE')) return res.status(409).json({ success: false, error: 'Profile name already exists' });
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/profiles/:id', (req, res) => {
    try {
        const { name, description, color, icon } = req.body;
        db.prepare(`
            UPDATE profiles SET name = COALESCE(?, name), description = COALESCE(?, description),
                                color = COALESCE(?, color), icon = COALESCE(?, icon)
            WHERE id = ?
        `).run(name, description, color, icon, req.params.id);
        res.json({ success: true, message: 'Profile updated' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/profiles/:id', (req, res) => {
    try {
        const id = Number(req.params.id);
        if (id === 1) return res.status(400).json({ success: false, error: 'Cannot delete the default profile' });
        // Move accounts back to default profile
        db.prepare('UPDATE accounts SET profile_id = 1 WHERE profile_id = ?').run(id);
        db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
        res.json({ success: true, message: 'Profile deleted, accounts moved to Main' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Assign an account to a profile
router.put('/accounts/:accountNumber/profile', (req, res) => {
    try {
        const { profile_id } = req.body;
        if (!profile_id) return res.status(400).json({ success: false, error: 'Missing profile_id' });
        db.prepare('UPDATE accounts SET profile_id = ? WHERE account_number = ?')
          .run(Number(profile_id), String(req.params.accountNumber));
        res.json({ success: true, message: 'Account moved to profile' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


// ═══════════════════════════════════════════════════════════════
// 🤖 EA REGISTRY ENDPOINTS (Rename & Merge)
// ═══════════════════════════════════════════════════════════════

router.get('/ea-registry', (req, res) => {
    try {
        const registry = db.prepare(`
            SELECT r.*,
                   (SELECT COUNT(*) FROM trades WHERE magic_number = r.magic_number) as trade_count,
                   (SELECT COUNT(*) FROM open_positions WHERE magic_number = r.magic_number) as open_count
            FROM ea_registry r
            ORDER BY r.ea_name ASC, r.magic_number ASC
        `).all();
        res.json({ success: true, registry });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Update EA name/color/description (renaming to an existing name merges them visually)
router.put('/ea-registry', (req, res) => {
    try {
        const { magic_number, ea_name, color, description } = req.body;
        if (!magic_number) return res.status(400).json({ success: false, error: 'Missing magic_number' });

        db.prepare(`
            INSERT INTO ea_registry (magic_number, ea_name, color, description)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(magic_number) DO UPDATE SET
                ea_name = COALESCE(excluded.ea_name, ea_registry.ea_name),
                color = COALESCE(excluded.color, ea_registry.color),
                description = COALESCE(excluded.description, ea_registry.description)
        `).run(
            Number(magic_number),
            ea_name || `EA #${magic_number}`,
            color || '#3b82f6',
            description || ''
        );
        res.json({ success: true, message: 'EA registry updated' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


// ═══════════════════════════════════════════════════════════════
// 🔗 SHARE TOKEN ENDPOINTS
// ═══════════════════════════════════════════════════════════════

router.post('/share/generate', (req, res) => {
    try {
        const { profile_id, account_number, from_date, label } = req.body;
        const token = crypto.randomBytes(32).toString('hex');

        db.prepare(`
            INSERT INTO share_tokens (token, profile_id, account_number, from_date, label)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            token,
            profile_id || null,
            account_number || null,
            from_date || null,
            label || 'Shared Link'
        );

        const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
        const shareUrl = `${baseUrl}/share/${token}`;

        res.json({ success: true, token, share_url: shareUrl, message: 'Share link generated' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Validate a share token (called by frontend on /share/<token> page load)
router.get('/share/validate/:token', (req, res) => {
    try {
        const row = db.prepare('SELECT * FROM share_tokens WHERE token = ? AND is_active = 1').get(req.params.token);
        if (!row) return res.status(403).json({ success: false, error: 'Invalid or revoked share link' });

        // Increment view count
        db.prepare('UPDATE share_tokens SET view_count = view_count + 1, last_viewed = datetime("now") WHERE id = ?').run(row.id);

        // Get profile name for display
        let profile_name = null;
        if (row.profile_id) {
            const p = db.prepare('SELECT name FROM profiles WHERE id = ?').get(row.profile_id);
            profile_name = p ? p.name : null;
        }

        // Get account name for display
        let account_name = null;
        if (row.account_number) {
            const a = db.prepare('SELECT account_name, broker FROM accounts WHERE account_number = ?').get(row.account_number);
            account_name = a ? (a.account_name || a.broker || row.account_number) : row.account_number;
        }

        res.json({
            success: true,
            profile_id: row.profile_id,
            profile_name,
            account_number: row.account_number,
            account_name,
            from_date: row.from_date,
            label: row.label
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/share/tokens', (req, res) => {
    try {
        const tokens = db.prepare(`
            SELECT st.*, p.name as profile_name,
                   a.account_name as account_display
            FROM share_tokens st
            LEFT JOIN profiles p ON st.profile_id = p.id
            LEFT JOIN accounts a ON st.account_number = a.account_number
            ORDER BY st.created_at DESC
        `).all();
        res.json({ success: true, tokens });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/share/tokens/:id', (req, res) => {
    try {
        db.prepare('UPDATE share_tokens SET is_active = 0 WHERE id = ?').run(Number(req.params.id));
        res.json({ success: true, message: 'Share link revoked' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


// ═══════════════════════════════════════════════════════════════
// 📥 DATA INGESTION (Called by MT5 EA)
// ═══════════════════════════════════════════════════════════════

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
                insertPosition.run({
                    account_number: String(account.account_number),
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
            }

            // 3. Refresh Pending Orders (NEW)
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
                insertPending.run({
                    account_number: String(account.account_number),
                    ticket: String(ord.ticket),
                    magic_number: Number(ord.magic_number) || 0,
                    symbol: ord.symbol || '',
                    order_type: ord.order_type || 'PENDING',
                    volume: Number(ord.volume) || 0,
                    price_open: Number(ord.price_open) || 0,
                    price_current: Number(ord.price_current) || 0,
                    sl: Number(ord.sl) || 0,
                    tp: Number(ord.tp) || 0,
                    setup_time: normalizeDate(ord.setup_time),
                    expiration: ord.expiration ? normalizeDate(ord.expiration) : '',
                    comment: ord.comment || ''
                });
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
                const netProfit = profit + commission + swap;

                insertTrade.run({
                    account_number: String(account.account_number),
                    ticket: String(trade.ticket),
                    magic_number: Number(trade.magic_number) || 0,
                    symbol: trade.symbol || '',
                    trade_type: trade.trade_type || 'BUY',
                    volume: Number(trade.volume) || 0,
                    open_price: Number(trade.open_price) || 0,
                    close_price: Number(trade.close_price) || 0,
                    open_time: normalizeDate(trade.open_time),
                    close_time: normalizeDate(trade.close_time),
                    profit, commission, swap,
                    net_profit: Number(trade.net_profit) || netProfit,
                    comment: trade.comment || ''
                });

                if (trade.magic_number && trade.magic_number > 0) {
                    db.prepare(`INSERT OR IGNORE INTO ea_registry (magic_number, ea_name) VALUES (?, ?)`)
                      .run(Number(trade.magic_number), `EA #${trade.magic_number}`);
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
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(account_number, snapshot_date) DO UPDATE SET
                    balance = excluded.balance, equity = excluded.equity,
                    daily_profit = excluded.daily_profit, total_trades = excluded.total_trades,
                    winning_trades = excluded.winning_trades, losing_trades = excluded.losing_trades
            `).run(
                String(account.account_number), today,
                Number(account.balance) || 0, Number(account.equity) || 0,
                todayStats ? todayStats.daily_profit : 0,
                todayStats ? todayStats.total_trades : 0,
                todayStats ? todayStats.winning_trades : 0,
                todayStats ? todayStats.losing_trades : 0
            );
        });

        syncTransaction();
        return res.json({ success: true, message: 'Sync successful' });
    } catch (err) {
        console.error('Error during EA sync:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});


// ─── DISCONNECT & PURGE ───
const STALE_SECONDS = 30;

function purgeAccount(accountNumber) {
    const acc = String(accountNumber);
    const tx = db.transaction(() => {
        db.prepare('DELETE FROM open_positions  WHERE account_number = ?').run(acc);
        db.prepare('DELETE FROM pending_orders   WHERE account_number = ?').run(acc);
        db.prepare('DELETE FROM trades           WHERE account_number = ?').run(acc);
        db.prepare('DELETE FROM daily_snapshots  WHERE account_number = ?').run(acc);
        db.prepare('DELETE FROM accounts         WHERE account_number = ?').run(acc);
        db.prepare(`DELETE FROM ea_registry
            WHERE magic_number NOT IN (SELECT DISTINCT magic_number FROM trades)
              AND magic_number NOT IN (SELECT DISTINCT magic_number FROM open_positions)`).run();
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
        `SELECT account_number FROM accounts
         WHERE (julianday('now') - julianday(last_update)) * 86400 > ?`).all(STALE_SECONDS);
    stale.forEach(r => purgeAccount(r.account_number));
}, 10000);


// ═══════════════════════════════════════════════════════════════
// 📊 DASHBOARD DATA ENDPOINTS (Share-Token Aware)
// ═══════════════════════════════════════════════════════════════

// ─── OVERVIEW ───
router.get('/overview', (req, res) => {
    try {
        const share = getShareRestrictions(req);
        if (share && share.invalid) return res.status(403).json({ success: false, error: 'Invalid or revoked share link' });

        const { account, magic, from, to } = req.query;
        const accW = buildAccountWhere(share, account);
        const dateW = buildTradeDateWhere(share, from, to);

        // Active accounts count
        let accCountQ = 'SELECT COUNT(*) as count FROM accounts WHERE is_active = 1';
        let accCountP = [];
        if (share && !share.invalid) {
            if (share.account_number) { accCountQ += ' AND account_number = ?'; accCountP.push(share.account_number); }
            else if (share.profile_id) { accCountQ += ' AND profile_id = ?'; accCountP.push(share.profile_id); }
        } else if (account && account !== 'all') {
            accCountQ += ' AND account_number = ?'; accCountP.push(account);
        }
        const totalAccounts = db.prepare(accCountQ).get(...accCountP).count;

        // Balance & Equity
        let accTotQ = 'SELECT SUM(balance) as total_balance, SUM(equity) as total_equity FROM accounts WHERE is_active = 1';
        let accTotP = [];
        if (share && !share.invalid) {
            if (share.account_number) { accTotQ += ' AND account_number = ?'; accTotP.push(share.account_number); }
            else if (share.profile_id) { accTotQ += ' AND profile_id = ?'; accTotP.push(share.profile_id); }
        } else if (account && account !== 'all') {
            accTotQ += ' AND account_number = ?'; accTotP.push(account);
        }
        const accountTotals = db.prepare(accTotQ).get(...accTotP) || { total_balance: 0, total_equity: 0 };

        // Floating PnL
        const openW = buildAccountWhere(share, account);
        let openMagicW = openW.where;
        let openMagicP = [...openW.params];
        if (magic && magic !== 'all' && (!share || share.invalid === false)) {
            openMagicW += ' AND magic_number = ?'; openMagicP.push(magic);
        }
        const floatingStats = db.prepare(
            `SELECT COALESCE(SUM(profit + swap), 0) as floating_pnl, COUNT(*) as open_trades FROM open_positions WHERE 1=1 ${openMagicW}`
        ).get(...openMagicP);

        // Today PnL
        const todayStr = new Date().toISOString().slice(0, 10);
        const todayStats = db.prepare(`
            SELECT COALESCE(SUM(net_profit), 0) as today_pnl FROM trades
            WHERE 1=1 ${accW.where} AND substr(REPLACE(close_time, '.', '-'), 1, 10) = ?
        `).get(...accW.params, todayStr);

        // Month PnL
        const currentMonthStr = todayStr.slice(0, 7);
        const monthStats = db.prepare(`
            SELECT COALESCE(SUM(net_profit), 0) as month_pnl FROM trades
            WHERE 1=1 ${accW.where} AND substr(REPLACE(close_time, '.', '-'), 1, 7) = ?
        `).get(...accW.params, currentMonthStr);

        // Overall Stats (scoped to date range + share from_date)
        const overallTrades = db.prepare(`
            SELECT 
                COUNT(*) as total_trades,
                COALESCE(SUM(net_profit), 0) as total_closed_profit,
                SUM(CASE WHEN net_profit > 0 THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN net_profit < 0 THEN 1 ELSE 0 END) as losses,
                COALESCE(SUM(CASE WHEN net_profit > 0 THEN net_profit ELSE 0 END), 0) as gross_profit,
                COALESCE(ABS(SUM(CASE WHEN net_profit < 0 THEN net_profit ELSE 0 END)), 0) as gross_loss
            FROM trades WHERE 1=1 ${accW.where} ${dateW.where}
        `).get(...accW.params, ...dateW.params);

        const winRate = overallTrades.total_trades > 0
            ? ((overallTrades.wins / overallTrades.total_trades) * 100).toFixed(1) : 0;
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


// ─── ACCOUNTS ───
router.get('/accounts', (req, res) => {
    try {
        const share = getShareRestrictions(req);
        if (share && share.invalid) return res.status(403).json({ success: false, error: 'Invalid or revoked share link' });

        const todayStr = new Date().toISOString().slice(0, 10);
        let profileWhere = '';
        let profileParams = [];
        if (share && !share.invalid) {
            if (share.account_number) { profileWhere = ' AND a.account_number = ?'; profileParams.push(share.account_number); }
            else if (share.profile_id) { profileWhere = ' AND a.profile_id = ?'; profileParams.push(share.profile_id); }
        }

        const accounts = db.prepare(`
            SELECT a.*,
                COALESCE((SELECT SUM(profit + swap) FROM open_positions WHERE account_number = a.account_number), 0) as floating_pnl,
                COALESCE((SELECT COUNT(*) FROM open_positions WHERE account_number = a.account_number), 0) as open_count,
                COALESCE((SELECT SUM(net_profit) FROM trades WHERE account_number = a.account_number AND substr(REPLACE(close_time, '.', '-'), 1, 10) = ?), 0) as today_profit,
                COALESCE((SELECT SUM(net_profit) FROM trades WHERE account_number = a.account_number), 0) as total_profit,
                COALESCE((SELECT COUNT(*) FROM pending_orders WHERE account_number = a.account_number), 0) as pending_count
            FROM accounts a
            WHERE 1=1 ${profileWhere}
            ORDER BY a.account_number ASC
        `).all(todayStr, ...profileParams);

        res.json({ success: true, accounts });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


// ─── EAs (Grouped by EA Name — merges same-named EAs) ───
router.get('/eas', (req, res) => {
    try {
        const share = getShareRestrictions(req);
        if (share && share.invalid) return res.status(403).json({ success: false, error: 'Invalid or revoked share link' });

        const { magic, from, to } = req.query;
        const accW = buildAccountWhere(share, req.query.account);
        const dateW = buildTradeDateWhere(share, from, to);

        let magicWhere = '';
        let magicParams = [];
        if (magic && magic !== 'all' && !share) {
            magicWhere = ' AND t.magic_number = ?';
            magicParams.push(magic);
        }

        // Group by ea_name so same-named EAs merge into one row
        const eas = db.prepare(`
            SELECT 
                COALESCE(r.ea_name, 'EA #' || t.magic_number) as ea_name,
                GROUP_CONCAT(DISTINCT t.magic_number) as magic_numbers,
                COALESCE(MIN(r.color), '#3b82f6') as color,
                COALESCE(MIN(r.description), '') as description,
                COUNT(t.id) as total_trades,
                SUM(t.net_profit) as total_pnl,
                SUM(CASE WHEN t.net_profit > 0 THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN t.net_profit < 0 THEN 1 ELSE 0 END) as losses
            FROM trades t
            LEFT JOIN ea_registry r ON t.magic_number = r.magic_number
            WHERE 1=1 ${accW.where} ${dateW.where} ${magicWhere}
            GROUP BY COALESCE(r.ea_name, 'EA #' || t.magic_number)
            ORDER BY total_pnl DESC
        `).all(...accW.params, ...dateW.params, ...magicParams);

        // Compute open_pnl per merged EA name
        for (const ea of eas) {
            const magics = ea.magic_numbers.split(',');
            const placeholders = magics.map(() => '?').join(',');
            const openPnl = db.prepare(
                `SELECT COALESCE(SUM(profit + swap), 0) as open_pnl FROM open_positions WHERE magic_number IN (${placeholders})`
            ).get(...magics);
            ea.open_pnl = openPnl.open_pnl;
        }

        res.json({ success: true, eas });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


// ─── CALENDAR ───
router.get('/calendar', (req, res) => {
    try {
        const share = getShareRestrictions(req);
        if (share && share.invalid) return res.status(403).json({ success: false, error: 'Invalid or revoked share link' });

        const now = new Date();
        const year = req.query.year || now.getFullYear();
        const month = req.query.month ? String(req.query.month).padStart(2, '0') : String(now.getMonth() + 1).padStart(2, '0');
        const monthPrefix = `${year}-${month}`;

        const accW = buildAccountWhere(share, req.query.account);
        let magicWhere = '';
        let magicParams = [];
        if (req.query.magic && req.query.magic !== 'all' && !share) {
            magicWhere = ' AND magic_number = ?';
            magicParams.push(req.query.magic);
        }

        const dailyStats = db.prepare(`
            SELECT 
                substr(REPLACE(close_time, '.', '-'), 1, 10) as date,
                COALESCE(SUM(net_profit), 0) as profit,
                COUNT(*) as trades_count,
                SUM(CASE WHEN net_profit > 0 THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN net_profit < 0 THEN 1 ELSE 0 END) as losses
            FROM trades
            WHERE substr(REPLACE(close_time, '.', '-'), 1, 7) = ?
              ${accW.where} ${magicWhere}
            GROUP BY substr(REPLACE(close_time, '.', '-'), 1, 10)
            ORDER BY date ASC
        `).all(monthPrefix, ...accW.params, ...magicParams);

        const monthTotal = dailyStats.reduce((sum, d) => sum + d.profit, 0);
        const totalMonthTrades = dailyStats.reduce((sum, d) => sum + d.trades_count, 0);

        res.json({
            success: true, year: Number(year), month: Number(month),
            month_prefix: monthPrefix, month_total_pnl: monthTotal,
            month_total_trades: totalMonthTrades, days: dailyStats
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


// ─── EQUITY CURVE ───
router.get('/charts/equity-curve', (req, res) => {
    try {
        const share = getShareRestrictions(req);
        if (share && share.invalid) return res.status(403).json({ success: false, error: 'Invalid or revoked share link' });

        const accW = buildAccountWhere(share, req.query.account);
        const dateW = buildTradeDateWhere(share, req.query.from, req.query.to);
        let magicWhere = '';
        let magicParams = [];
        if (req.query.magic && req.query.magic !== 'all' && !share) {
            magicWhere = ' AND magic_number = ?';
            magicParams.push(req.query.magic);
        }

        const trades = db.prepare(`
            SELECT REPLACE(close_time, '.', '-') as close_time, net_profit, symbol, magic_number
            FROM trades WHERE 1=1 ${accW.where} ${dateW.where} ${magicWhere}
            ORDER BY close_time ASC
        `).all(...accW.params, ...dateW.params, ...magicParams);

        let cumulative = 0;
        const curve = trades.map(t => {
            cumulative += t.net_profit;
            return { time: t.close_time, profit: t.net_profit, cumulative_profit: Number(cumulative.toFixed(2)), symbol: t.symbol };
        });

        res.json({ success: true, curve });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


// ─── OPEN POSITIONS ───
router.get('/open-positions', (req, res) => {
    try {
        const share = getShareRestrictions(req);
        if (share && share.invalid) return res.status(403).json({ success: false, error: 'Invalid or revoked share link' });

        const accW = buildAccountWhere(share, req.query.account, 'op');
        let magicWhere = '';
        let magicParams = [];
        if (req.query.magic && req.query.magic !== 'all' && !share) {
            magicWhere = ' AND op.magic_number = ?';
            magicParams.push(req.query.magic);
        }

        const positions = db.prepare(`
            SELECT op.*, COALESCE(r.ea_name, 'EA #' || op.magic_number) as ea_name
            FROM open_positions op
            LEFT JOIN ea_registry r ON op.magic_number = r.magic_number
            WHERE 1=1 ${accW.where} ${magicWhere}
            ORDER BY op.open_time DESC
        `).all(...accW.params, ...magicParams);

        res.json({ success: true, positions });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


// ─── PENDING ORDERS (NEW) ───
router.get('/pending-orders', (req, res) => {
    try {
        const share = getShareRestrictions(req);
        if (share && share.invalid) return res.status(403).json({ success: false, error: 'Invalid or revoked share link' });

        const accW = buildAccountWhere(share, req.query.account, 'po');
        let magicWhere = '';
        let magicParams = [];
        if (req.query.magic && req.query.magic !== 'all' && !share) {
            magicWhere = ' AND po.magic_number = ?';
            magicParams.push(req.query.magic);
        }

        const orders = db.prepare(`
            SELECT po.*, COALESCE(r.ea_name, 'EA #' || po.magic_number) as ea_name
            FROM pending_orders po
            LEFT JOIN ea_registry r ON po.magic_number = r.magic_number
            WHERE 1=1 ${accW.where} ${magicWhere}
            ORDER BY po.setup_time DESC
        `).all(...accW.params, ...magicParams);

        res.json({ success: true, orders });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


module.exports = router;
