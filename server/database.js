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

// Helper to safely add missing columns without crashing or needing manual SQL
function ensureColumn(tableName, columnName, columnDefinition) {
    try {
        const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
        const exists = columns.some(c => c.name === columnName);
        if (!exists) {
            db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
            console.log(`🔧 Auto-migrated: Added ${columnName} to ${tableName}`);
        }
    } catch (err) {
        console.warn(`Migration check warning for ${tableName}.${columnName}:`, err.message);
    }
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

    // Ensure updated_at column exists in ea_registry with a constant default
    ensureColumn('ea_registry', 'updated_at', 'TEXT DEFAULT NULL');

    // TABLE 6: PENDING ORDERS
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

    // TABLE 7: PROFILES
    db.exec(`
        CREATE TABLE IF NOT EXISTS profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            account_numbers TEXT DEFAULT '',
            is_default INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    `);

    // TABLE 8: SHARE LINKS
    db.exec(`
        CREATE TABLE IF NOT EXISTS share_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token TEXT UNIQUE NOT NULL,
            profile_id INTEGER NOT NULL,
            label TEXT DEFAULT '',
            from_date TEXT DEFAULT NULL,
            expires_at TEXT DEFAULT NULL,
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

    // ─── SEED DEFAULT "All Accounts" PROFILE ON FIRST RUN ───
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
