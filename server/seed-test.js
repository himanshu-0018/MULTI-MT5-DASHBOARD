const db = require('./database');

console.log('🌱 Seeding mock data for testing...');

// Insert 3 mock accounts
const insertAccount = db.prepare(`
    INSERT OR REPLACE INTO accounts (account_number, account_name, broker, server_name, currency, leverage, balance, equity)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

insertAccount.run('1001', 'Scalp Account', 'IC Markets', 'ICMarkets-Live01', 'USD', '1:500', 5420.50, 5530.20);
insertAccount.run('1002', 'Swing Account', 'FTMO', 'FTMO-Server2', 'USD', '1:100', 102500.00, 101800.00);
insertAccount.run('1003', 'Gold Bot Acc', 'Exness', 'Exness-Real5', 'USD', '1:200', 12340.00, 12650.00);

// Insert EA Names
const insertEA = db.prepare('INSERT OR REPLACE INTO ea_registry (magic_number, ea_name, color) VALUES (?, ?, ?)');
insertEA.run(1111, 'Gold Sniper EA', '#f59e0b');
insertEA.run(2222, 'EURUSD Scalper', '#3b82f6');
insertEA.run(3333, 'Grid Master PRO', '#10b981');

// Insert some trades for today and yesterday
const insertTrade = db.prepare(`
    INSERT OR REPLACE INTO trades (account_number, ticket, magic_number, symbol, trade_type, volume, open_price, close_price, open_time, close_time, profit, net_profit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

insertTrade.run('1001', '90001', 1111, 'XAUUSD', 'BUY', 0.1, 2650.00, 2660.00, `${yesterday} 10:00:00`, `${yesterday} 12:00:00`, 100.0, 95.0);
insertTrade.run('1001', '90002', 1111, 'XAUUSD', 'SELL', 0.1, 2665.00, 2655.00, `${today} 08:00:00`, `${today} 09:30:00`, 100.0, 96.0);
insertTrade.run('1002', '90003', 2222, 'EURUSD', 'BUY', 1.0, 1.0850, 1.0880, `${today} 07:00:00`, `${today} 11:15:00`, 300.0, 285.0);
insertTrade.run('1003', '90004', 3333, 'GBPUSD', 'SELL', 0.5, 1.2950, 1.2970, `${today} 06:00:00`, `${today} 08:45:00`, -100.0, -105.0);

console.log('✅ Mock data created!');
