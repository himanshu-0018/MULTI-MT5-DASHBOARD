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

// ─── HELPER: Check if column exists ───
function columnExists(table, column) {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all();
    return rows.some(r => r.name === column);
}

// ─── CREATE ALL TABLES ───
function initDB() {

    // TABLE 1: ACCOUNTS
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
            profile_id INTEGER DEFAULT 1,
            is_active INTEGER DEFAULT 1,
            first_seen TEXT DEFAULT (datetime('now')),
            last_update TEXT DEFAULT (datetime('now'))
        )
    `);

    // Migration: add profile_id if upgrading existing DB
    if (!columnExists('accounts', 'profile_id')) {
        db.exec(`ALTER TABLE accounts ADD COLUMN profile_id INTEGER DEFAULT 1`);
    }

    // TABLE 2: TRADES
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

    // TABLE 6: PENDING ORDERS (NEW)
    // Live pending orders (limit/stop orders waiting to trigger)
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
            setup_time TEXT NOT NULL,
            expiration TEXT DEFAULT '',
            comment TEXT DEFAULT '',
            last_update TEXT DEFAULT (datetime('now')),
            UNIQUE(account_number, ticket)
        )
    `);

    // TABLE 7: PROFILES (NEW)
    // Groups accounts into logical profiles (e.g. "Main", "Testing", "Prop Firm")
    db.exec(`
        CREATE TABLE IF NOT EXISTS profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            description TEXT DEFAULT '',
            color TEXT DEFAULT '#22d3ee',
            icon TEXT DEFAULT 'briefcase',
            is_default INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        )
    `);

    // Seed default profiles if empty
    const profileCount = db.prepare('SELECT COUNT(*) as c FROM profiles').get().c;
    if (profileCount === 0) {
        db.prepare(`
            INSERT INTO profiles (id, name, description, color, icon, is_default)
            VALUES (1, 'Main', 'Main trading accounts', '#22d3ee', 'briefcase', 1)
        `).run();
        db.prepare(`
            INSERT INTO profiles (name, description, color, icon)
            VALUES ('Testing', 'Testing & experimental accounts', '#fbbf24', 'flask-conical')
        `).run();
    }

    // TABLE 8: SHARE TOKENS (NEW)
    // Secure tokens for sharing read-only dashboard views
    db.exec(`
        CREATE TABLE IF NOT EXISTS share_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token TEXT UNIQUE NOT NULL,
            profile_id INTEGER,
            account_number TEXT,
            from_date TEXT DEFAULT NULL,
            label TEXT DEFAULT '',
            is_active INTEGER DEFAULT 1,
            view_count INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            last_viewed TEXT DEFAULT NULL
        )
    `);

    // TABLE 9: SETTINGS (NEW)
    // Stores master passcode (hashed) and app-level settings
    db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT DEFAULT (datetime('now'))
        )
    `);

    // Seed default passcode if none exists (default: "1234" — change on first login)
    const passExists = db.prepare('SELECT value FROM settings WHERE key = ?').get('master_passcode');
    if (!passExists) {
        const crypto = require('crypto');
        const defaultHash = crypto.createHash('sha256').update('1234').digest('hex');
        db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).run('master_passcode', defaultHash);
        console.log('🔐 Default master passcode set to: 1234 (change it in settings!)');
    }

    // ─── INDEXES ───
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_trades_account ON trades(account_number);
        CREATE INDEX IF NOT EXISTS idx_trades_magic ON trades(magic_number);
        CREATE INDEX IF NOT EXISTS idx_trades_close ON trades(close_time);
        CREATE INDEX IF NOT EXISTS idx_trades_combo ON trades(account_number, magic_number);
        CREATE INDEX IF NOT EXISTS idx_snapshots_date ON daily_snapshots(account_number, snapshot_date);
        CREATE INDEX IF NOT EXISTS idx_open_account ON open_positions(account_number);
        CREATE INDEX IF NOT EXISTS idx_pending_account ON pending_orders(account_number);
        CREATE INDEX IF NOT EXISTS idx_accounts_profile ON accounts(profile_id);
        CREATE INDEX IF NOT EXISTS idx_tokens_token ON share_tokens(token);
    `);

    console.log('✅ Database initialized with 9 tables (profiles + share tokens + pending orders)');
}

initDB();
module.exports = db;
