const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// ─── CREATE DATA FOLDER IF NOT EXISTS ───
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// ─── CONNECT TO DATABASE ───
const dbPath = path.join(dataDir, 'mt5dashboard.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// ─── CREATE ALL TABLES ───
function initDB() {

    // TABLE 1: ACCOUNTS
    // One row per MT5 account
    db.exec(`
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_number TEXT UNIQUE NOT NULL,
            account_name TEXT DEFAULT '',
            broker TEXT DEFAULT '',
            server_name TEXT DEFAULT '',
            currency TEXT DEFAULT 'USD',
            leverage TEXT DEFAULT '',
            balance REAL DEFAULT 0,
            equity REAL DEFAULT 0,
            margin REAL DEFAULT 0,
            free_margin REAL DEFAULT 0,
            margin_level REAL DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            first_seen TEXT DEFAULT (datetime('now')),
            last_update TEXT DEFAULT (datetime('now'))
        )
    `);

    // TABLE 2: TRADES (closed trades)
    db.exec(`
        CREATE TABLE IF NOT EXISTS trades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_number TEXT NOT NULL,
            ticket TEXT NOT NULL,
            magic_number INTEGER DEFAULT 0,
            symbol TEXT NOT NULL,
            trade_type TEXT NOT NULL,
            volume REAL DEFAULT 0,
            open_price REAL DEFAULT 0,
            close_price REAL DEFAULT 0,
            open_time TEXT NOT NULL,
            close_time TEXT NOT NULL,
            profit REAL DEFAULT 0,
            commission REAL DEFAULT 0,
            swap REAL DEFAULT 0,
            net_profit REAL DEFAULT 0,
            comment TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(account_number, ticket)
        )
    `);

    // TABLE 3: DAILY SNAPSHOTS
    db.exec(`
        CREATE TABLE IF NOT EXISTS daily_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_number TEXT NOT NULL,
            snapshot_date TEXT NOT NULL,
            balance REAL DEFAULT 0,
            equity REAL DEFAULT 0,
            daily_profit REAL DEFAULT 0,
            total_trades INTEGER DEFAULT 0,
            winning_trades INTEGER DEFAULT 0,
            losing_trades INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(account_number, snapshot_date)
        )
    `);

    // TABLE 4: OPEN POSITIONS
    db.exec(`
        CREATE TABLE IF NOT EXISTS open_positions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_number TEXT NOT NULL,
            ticket TEXT NOT NULL,
            magic_number INTEGER DEFAULT 0,
            symbol TEXT NOT NULL,
            trade_type TEXT NOT NULL,
            volume REAL DEFAULT 0,
            open_price REAL DEFAULT 0,
            current_price REAL DEFAULT 0,
            open_time TEXT NOT NULL,
            profit REAL DEFAULT 0,
            swap REAL DEFAULT 0,
            comment TEXT DEFAULT '',
            last_update TEXT DEFAULT (datetime('now')),
            UNIQUE(account_number, ticket)
        )
    `);

    // TABLE 5: EA REGISTRY
    // Name your EAs by magic number
    // Multiple magic numbers may share the SAME ea_name → merged in UI
    db.exec(`
        CREATE TABLE IF NOT EXISTS ea_registry (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            magic_number INTEGER UNIQUE NOT NULL,
            ea_name TEXT DEFAULT 'Unknown EA',
            description TEXT DEFAULT '',
            color TEXT DEFAULT '#3b82f6',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    `);

    // TABLE 6: PENDING ORDERS  (NEW)
    // Live pending orders (buy/sell limit/stop) streamed from the EA
    db.exec(`
        CREATE TABLE IF NOT EXISTS pending_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_number TEXT NOT NULL,
            ticket TEXT NOT NULL,
            magic_number INTEGER DEFAULT 0,
            symbol TEXT NOT NULL,
            order_type TEXT NOT NULL,            -- BUY_LIMIT / SELL_LIMIT / BUY_STOP / SELL_STOP / BUY_STOP_LIMIT / SELL_STOP_LIMIT
            volume REAL DEFAULT 0,
            price_open REAL DEFAULT 0,           -- requested entry price
            price_current REAL DEFAULT 0,        -- live market price
            sl REAL DEFAULT 0,
            tp REAL DEFAULT 0,
            setup_time TEXT NOT NULL,            -- when the pending was placed
            expiration TEXT DEFAULT '',          -- expiry (if any)
            comment TEXT DEFAULT '',
            last_update TEXT DEFAULT (datetime('now')),
            UNIQUE(account_number, ticket)
        )
    `);

    // TABLE 7: PROFILES  (NEW)
    // A "profile" = a saved group of MT5 accounts you want to view together
    // e.g. "Main" (5 accounts) / "Testing" (1 account) / "All" (everything)
    db.exec(`
        CREATE TABLE IF NOT EXISTS profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            slug TEXT UNIQUE NOT NULL,          -- URL-safe identifier, e.g. "main", "testing"
            account_numbers TEXT DEFAULT '',    -- CSV: "5017842,3390127,7781005"  (empty = ALL accounts)
            is_default INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    `);

    // TABLE 8: SHARE LINKS  (NEW)
    // Each row = one shareable public link scoped to a profile
    // Enforced server-side: viewer cannot see other accounts even by URL hacking
    db.exec(`
        CREATE TABLE IF NOT EXISTS share_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token TEXT UNIQUE NOT NULL,         -- random URL-safe token
            profile_id INTEGER NOT NULL,
            label TEXT DEFAULT '',              -- optional note e.g. "Shared with John"
            from_date TEXT DEFAULT NULL,        -- YYYY-MM-DD → viewer only sees trades on/after this date
            expires_at TEXT DEFAULT NULL,       -- optional expiry
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
        )
    `);

    // ─── INDEXES ───
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_trades_account ON trades(account_number);
        CREATE INDEX IF NOT EXISTS idx_trades_magic ON trades(magic_number);
        CREATE INDEX IF NOT EXISTS idx_trades_close ON trades(close_time);
        CREATE INDEX IF NOT EXISTS idx_trades_combo ON trades(account_number, magic_number);
        CREATE INDEX IF NOT EXISTS idx_snapshots_date ON daily_snapshots(account_number, snapshot_date);
        CREATE INDEX IF NOT EXISTS idx_open_account ON open_positions(account_number);
        CREATE INDEX IF NOT EXISTS idx_pending_account ON pending_orders(account_number);
        CREATE INDEX IF NOT EXISTS idx_pending_magic ON pending_orders(magic_number);
        CREATE INDEX IF NOT EXISTS idx_sharelinks_token ON share_links(token);
        CREATE INDEX IF NOT EXISTS idx_profiles_slug ON profiles(slug);
    `);

    // ─── SEED DEFAULT "ALL" PROFILE ON FIRST RUN ───
    // So the UI always has at least one profile to select
    const existing = db.prepare('SELECT COUNT(*) AS c FROM profiles').get();
    if (existing.c === 0) {
        db.prepare(`
            INSERT INTO profiles (name, slug, account_numbers, is_default)
            VALUES (?, ?, ?, ?)
        `).run('All Accounts', 'all', '', 1);
        console.log('🌱 Seeded default profile: "All Accounts"');
    }

    console.log('✅ Database initialized with 8 tables');
}

initDB();
module.exports = db;
