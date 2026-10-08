const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const db = require('./database');
const apiRoutes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

// Master PIN / Passcode (Configure in Railway Variables: ADMIN_PIN=your_custom_pin)
const ADMIN_PIN = process.env.ADMIN_PIN || '8888';

// ─── MIDDLEWARE ───
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ─── MASTER SECURITY & SHARE RESOLVER MIDDLEWARE ───
app.use('/api', (req, res, next) => {
    // 1. Unrestricted Public Endpoints (EA Ingestion & Auth Login)
    const publicPaths = ['/health', '/ea/sync', '/ea/disconnect', '/auth/login', '/share/info'];
    if (publicPaths.some(p => req.path.startsWith(p))) {
        return next();
    }

    // 2. Check for Master Admin Auth (Header or Query Token)
    const adminToken = req.headers['x-admin-token'] || req.query.admin_token;
    if (adminToken && String(adminToken) === String(ADMIN_PIN)) {
        req.isAdmin = true;
        req.shareScope = null;
        return next();
    }

    // 3. Check for Share Link Token
    const shareToken = req.query.share || req.headers['x-share-token'];
    if (shareToken) {
        try {
            const row = db.prepare(`
                SELECT s.token, s.profile_id, s.from_date, s.expires_at,
                       p.name AS profile_name, p.account_numbers
                FROM share_links s
                LEFT JOIN profiles p ON p.id = s.profile_id
                WHERE s.token = ?
            `).get(String(shareToken));

            if (!row) {
                return res.status(403).json({ success: false, error: 'Invalid share link' });
            }

            if (row.expires_at && new Date(row.expires_at) < new Date()) {
                return res.status(403).json({ success: false, error: 'Share link expired' });
            }

            const allowedAccounts = (row.account_numbers || '')
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);

            req.isAdmin = false;
            req.shareScope = {
                token: row.token,
                profileId: row.profile_id,
                profileName: row.profile_name,
                allowedAccounts,
                fromDate: row.from_date,
                expiresAt: row.expires_at
            };
            return next();
        } catch (err) {
            console.error('Share resolver error:', err);
            return res.status(500).json({ success: false, error: 'Share resolver failure' });
        }
    }

    // 4. If neither Master Admin nor Share Token -> ACCESS DENIED
    return res.status(401).json({
        success: false,
        error: 'Unauthorized: Master Passcode required to access fleet data'
    });
});

// ─── STATIC FILES ───
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── MOUNT API ROUTES ───
app.use('/api', apiRoutes);

// ─── HEALTH ROUTE ───
app.get('/api/health', (req, res) => {
    res.json({
        status: 'online',
        server_time: new Date().toISOString(),
        message: 'MT5 Dashboard API ready'
    });
});

// Fallback to index.html for frontend routing
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ─── START SERVER ───
app.listen(PORT, () => {
    console.log('');
    console.log('====================================================');
    console.log('   🚀 MT5 MULTI-ACCOUNT SERVER RUNNING');
    console.log('====================================================');
    console.log(`   📊 Dashboard : http://localhost:${PORT}`);
    console.log(`   📡 EA API    : http://localhost:${PORT}/api/ea/sync`);
    console.log(`   🔐 Master PIN: ${ADMIN_PIN}`);
    console.log('====================================================');
    console.log('');
});
