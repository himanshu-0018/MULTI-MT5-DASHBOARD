const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// ─── CREATE DATA FOLDER IF NOT EXISTS ───
// On Railway mount a Volume and set DATA_DIR to its mount path so data survives redeploys
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// ─── CONNECT TO DATABASE ───
const dbPath = path.join(dataDir, 'mt5dashboard.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── CREATE ALL TABLES ───
function initDB() {

    // TABLE 1: ACCOUNTS (live terminals)
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

    // TABLE 5: EA REGISTRY (magic number -> EA name). Same name on many magics = merged EA
    db.exec(`
        CREATE TABLE IF NOT EXISTS ea_registry (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            magic_number INTEGER UNIQUE NOT NULL,
            ea_name TEXT DEFAULT 'Unknown EA',
            description TEXT DEFAULT '',
            color TEXT DEFAULT '#3b82f6',
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);

    // TABLE 6: PENDING ORDERS (limit / stop orders)
    db.exec(`
        CREATE TABLE IF NOT EXISTS pending_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            account_number TEXT NOT NULL,
            ticket TEXT NOT NULL,
            magic_number INTEGER DEFAULT 0,
            symbol TEXT NOT NULL,
            order_type TEXT NOT NULL,
            volume REAL DEFAULT 0,
            price_open REAL DEFAULT 0,
            price_current REAL DEFAULT 0,
            sl REAL DEFAULT 0,
            tp REAL DEFAULT 0,
            setup_time TEXT DEFAULT '',
            expiration TEXT DEFAULT '',
            comment TEXT DEFAULT '',
            last_update TEXT DEFAULT (datetime('now')),
            UNIQUE(account_number, ticket)
        )
    `);

    // TABLE 7: KNOWN ACCOUNTS (never purged — used to assign accounts to profiles)
    db.exec(`
        CREATE TABLE IF NOT EXISTS known_accounts (
            account_number TEXT PRIMARY KEY,
            account_name TEXT DEFAULT '',
            broker TEXT DEFAULT '',
            last_seen TEXT DEFAULT (datetime('now'))
        )
    `);

    // TABLE 8 + 9: PROFILES (account groups)
    db.exec(`
        CREATE TABLE IF NOT EXISTS profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS profile_accounts (
            profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
            account_number TEXT NOT NULL,
            PRIMARY KEY (profile_id, account_number)
        );
    `);

    // TABLE 10: SHARE LINKS (read-only, locked to one profile + optional start date)
    db.exec(`
        CREATE TABLE IF NOT EXISTS share_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token TEXT UNIQUE NOT NULL,
            profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
            from_date TEXT,
            label TEXT DEFAULT '',
            revoked INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            last_accessed TEXT
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
        CREATE INDEX IF NOT EXISTS idx_registry_name ON ea_registry(ea_name);
    `);

    console.log('✅ Database initialized');
}

initDB();
module.exports = db;
