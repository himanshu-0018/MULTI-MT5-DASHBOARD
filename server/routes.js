const express = require('express');
const router = express.Router();
const db = require('./database');

// Helper to normalize any MT5 date format "2025.03.01 12:00" -> "2025-03-01 12:00"
function normalizeDate(dateStr) {
    if (!dateStr) return new Date().toISOString().replace('T', ' ').slice(0, 19);
    return dateStr.replace(/\./g, '-').trim();
}

// ==========================================
// 📥 1. DATA INGESTION (Called by MT5 EA)
// ==========================================

router.post('/ea/sync', (req, res) => {
    try {
        const { account, open_positions = [], recent_trades = [] } = req.body;

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

            // 2. Refresh Open Positions for this account
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

            // 3. Upsert Closed Trades (History)
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
                    profit: profit,
                    commission: commission,
                    swap: swap,
                    net_profit: Number(trade.net_profit) || netProfit,
                    comment: trade.comment || ''
                });

                // Auto-register magic number if not exists
                if (trade.magic_number && trade.magic_number > 0) {
                    db.prepare(`
                        INSERT OR IGNORE INTO ea_registry (magic_number, ea_name)
                        VALUES (?, ?)
                    `).run(Number(trade.magic_number), `EA #${trade.magic_number}`);
                }
            }

            // 4. Update today's daily snapshot
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

const STALE_SECONDS = 30; // terminals with no sync for 30s are deleted (EA syncs every 5s)

function purgeAccount(accountNumber) {
  const acc = String(accountNumber);
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM open_positions WHERE account_number = ?').run(acc);
    db.prepare('DELETE FROM trades          WHERE account_number = ?').run(acc);
    db.prepare('DELETE FROM daily_snapshots WHERE account_number = ?').run(acc);
    db.prepare('DELETE FROM accounts        WHERE account_number = ?').run(acc);
    db.prepare(`DELETE FROM ea_registry
       WHERE magic_number NOT IN (SELECT DISTINCT magic_number FROM trades)
         AND magic_number NOT IN (SELECT DISTINCT magic_number FROM open_positions)`).run();
  });
  tx();
}

// (a) Explicit disconnect signal from EA
router.post('/ea/disconnect', (req, res) => {
  const b = req.body || {};
  const accountNumber = b.account_number || (b.account && b.account.account_number);
  if (!accountNumber) return res.status(400).json({ success:false, error:'Missing account_number' });
  purgeAccount(accountNumber);
  return res.json({ success:true, message:`Account ${accountNumber} data removed` });
});

// (b) Timeout safety-net triggered every 10s
setInterval(() => {
  const stale = db.prepare(
    `SELECT account_number FROM accounts
     WHERE (julianday('now') - julianday(last_update)) * 86400 > ?`).all(STALE_SECONDS);
  stale.forEach(r => purgeAccount(r.account_number));
}, 10000);


// ==========================================
// 📊 2. DASHBOARD DATA ENDPOINTS
// ==========================================

router.get('/overview', (req, res) => {
    try {
        const { account, magic } = req.query;

        let tradeWhere = 'WHERE 1=1';
        let tradeParams = [];

        if (account && account !== 'all') {
            tradeWhere += ' AND account_number = ?';
            tradeParams.push(account);
        }
        if (magic && magic !== 'all') {
            tradeWhere += ' AND magic_number = ?';
            tradeParams.push(magic);
        }

        // Date range (from/to) — scopes historical aggregates + curve, NOT today/month
        const { from, to } = req.query;
        let rangeWhere = tradeWhere;
        let rangeParams = [...tradeParams];
        if (from) { rangeWhere += " AND substr(REPLACE(close_time, '.', '-'), 1, 10) >= ?"; rangeParams.push(from); }
        if (to)   { rangeWhere += " AND substr(REPLACE(close_time, '.', '-'), 1, 10) <= ?"; rangeParams.push(to); }

        const totalAccounts = db.prepare('SELECT COUNT(*) as count FROM accounts WHERE is_active = 1').get().count;
        
        let accountTotalsQuery = 'SELECT SUM(balance) as total_balance, SUM(equity) as total_equity FROM accounts WHERE is_active = 1';
        let accountTotalsParams = [];
        if (account && account !== 'all') {
            accountTotalsQuery += ' AND account_number = ?';
            accountTotalsParams.push(account);
        }
        const accountTotals = db.prepare(accountTotalsQuery).get(...accountTotalsParams) || { total_balance: 0, total_equity: 0 };

        let openWhere = 'WHERE 1=1';
        let openParams = [];
        if (account && account !== 'all') {
            openWhere += ' AND account_number = ?';
            openParams.push(account);
        }
        if (magic && magic !== 'all') {
            openWhere += ' AND magic_number = ?';
            openParams.push(magic);
        }
        const floatingStats = db.prepare(`SELECT COALESCE(SUM(profit + swap), 0) as floating_pnl, COUNT(*) as open_trades FROM open_positions ${openWhere}`).get(...openParams);

        // Today PnL
        const todayStr = new Date().toISOString().slice(0, 10);
        const todayStats = db.prepare(`
            SELECT COALESCE(SUM(net_profit), 0) as today_pnl 
            FROM trades 
            ${tradeWhere} AND substr(REPLACE(close_time, '.', '-'), 1, 10) = ?
        `).get(...tradeParams, todayStr);

        // Running Month PnL
        const currentMonthStr = todayStr.slice(0, 7);
        const monthStats = db.prepare(`
            SELECT COALESCE(SUM(net_profit), 0) as month_pnl 
            FROM trades 
            ${tradeWhere} AND substr(REPLACE(close_time, '.', '-'), 1, 7) = ?
        `).get(...tradeParams, currentMonthStr);

        // Overall Stats (scoped to the selected date range)
        const overallTrades = db.prepare(`
            SELECT 
                COUNT(*) as total_trades,
                COALESCE(SUM(net_profit), 0) as total_closed_profit,
                SUM(CASE WHEN net_profit > 0 THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN net_profit < 0 THEN 1 ELSE 0 END) as losses,
                COALESCE(SUM(CASE WHEN net_profit > 0 THEN net_profit ELSE 0 END), 0) as gross_profit,
                COALESCE(ABS(SUM(CASE WHEN net_profit < 0 THEN net_profit ELSE 0 END)), 0) as gross_loss
            FROM trades
            ${rangeWhere}
        `).get(...rangeParams);

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
        const accounts = db.prepare(`
            SELECT 
                a.*,
                COALESCE((SELECT SUM(profit + swap) FROM open_positions WHERE account_number = a.account_number), 0) as floating_pnl,
                COALESCE((SELECT COUNT(*) FROM open_positions WHERE account_number = a.account_number), 0) as open_count,
                COALESCE((SELECT SUM(net_profit) FROM trades WHERE account_number = a.account_number AND substr(REPLACE(close_time, '.', '-'), 1, 10) = ?), 0) as today_profit,
                COALESCE((SELECT SUM(net_profit) FROM trades WHERE account_number = a.account_number), 0) as total_profit
            FROM accounts a
            ORDER BY a.account_number ASC
        `).all(todayStr);

        res.json({ success: true, accounts });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


router.get('/eas', (req, res) => {
    try {
        // Date range (from/to) — scopes the leaderboard + bar chart to closed trades in the window
        const { from, to } = req.query;
        let where = 'WHERE 1=1';
        const params = [];
        if (from) { where += " AND substr(REPLACE(t.close_time, '.', '-'), 1, 10) >= ?"; params.push(from); }
        if (to)   { where += " AND substr(REPLACE(t.close_time, '.', '-'), 1, 10) <= ?"; params.push(to); }

        const eas = db.prepare(`
            SELECT 
                t.magic_number,
                COALESCE(r.ea_name, 'EA #' || t.magic_number) as ea_name,
                COALESCE(r.color, '#3b82f6') as color,
                COALESCE(r.description, '') as description,
                COUNT(t.id) as total_trades,
                SUM(t.net_profit) as total_pnl,
                SUM(CASE WHEN t.net_profit > 0 THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN t.net_profit < 0 THEN 1 ELSE 0 END) as losses,
                COALESCE((SELECT SUM(profit + swap) FROM open_positions WHERE magic_number = t.magic_number), 0) as open_pnl
            FROM trades t
            LEFT JOIN ea_registry r ON t.magic_number = r.magic_number
            ${where}
            GROUP BY t.magic_number
            ORDER BY total_pnl DESC
        `).all(...params);

        res.json({ success: true, eas });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


/**
 * 📅 2.5 CALENDAR DATA ENDPOINT (Fixed Date Matching)
 */
router.get('/calendar', (req, res) => {
    try {
        const now = new Date();
        const year = req.query.year || now.getFullYear();
        const month = req.query.month ? String(req.query.month).padStart(2, '0') : String(now.getMonth() + 1).padStart(2, '0');
        const monthPrefix = `${year}-${month}`; // "2025-03"

        const { account, magic } = req.query;

        let where = "WHERE substr(REPLACE(close_time, '.', '-'), 1, 7) = ?";
        let params = [monthPrefix];

        if (account && account !== 'all') {
            where += ' AND account_number = ?';
            params.push(account);
        }
        if (magic && magic !== 'all') {
            where += ' AND magic_number = ?';
            params.push(magic);
        }

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
        const { account, magic } = req.query;

        let where = 'WHERE 1=1';
        let params = [];

        if (account && account !== 'all') {
            where += ' AND account_number = ?';
            params.push(account);
        }
        if (magic && magic !== 'all') {
            where += ' AND magic_number = ?';
            params.push(magic);
        }

        // Date range (from/to) — scopes the growth curve to closed trades in the window
        const { from, to } = req.query;
        if (from) { where += " AND substr(REPLACE(close_time, '.', '-'), 1, 10) >= ?"; params.push(from); }
        if (to)   { where += " AND substr(REPLACE(close_time, '.', '-'), 1, 10) <= ?"; params.push(to); }

        const trades = db.prepare(`
            SELECT 
                REPLACE(close_time, '.', '-') as close_time,
                net_profit,
                symbol,
                magic_number
            FROM trades
            ${where}
            ORDER BY close_time ASC
        `).all(...params);

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
        const { account, magic } = req.query;

        let where = 'WHERE 1=1';
        let params = [];

        if (account && account !== 'all') {
            where += ' AND op.account_number = ?';
            params.push(account);
        }
        if (magic && magic !== 'all') {
            where += ' AND op.magic_number = ?';
            params.push(magic);
        }

        const positions = db.prepare(`
            SELECT 
                op.*,
                COALESCE(r.ea_name, 'EA #' || op.magic_number) as ea_name
            FROM open_positions op
            LEFT JOIN ea_registry r ON op.magic_number = r.magic_number
            ${where}
            ORDER BY op.open_time DESC
        `).all(...params);

        res.json({ success: true, positions });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
