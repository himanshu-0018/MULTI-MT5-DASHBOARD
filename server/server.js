const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const db = require('./database');
const apiRoutes = require('./routes');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── MIDDLEWARE ───
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Large limit for bulk trade history

// ─── SHARE TOKEN RESOLVER MIDDLEWARE ───
// If a request carries ?share=<token>, we resolve it on the SERVER
// and attach the allowed account list to req.shareScope.
// This way the user cannot bypass restriction by editing the URL —
// the backend itself enforces which accounts are visible.
app.use('/api', (req, res, next) => {
    const token = req.query.share || req.headers['x-share-token'];
    if (!token) {
        req.shareScope = null;
        return next();
    }

    try {
        const row = db.prepare(`
            SELECT s.token, s.profile_id, s.from_date, s.expires_at,
                   p.name AS profile_name, p.account_numbers
            FROM share_links s
            LEFT JOIN profiles p ON p.id = s.profile_id
            WHERE s.token = ?
        `).get(String(token));

        if (!row) {
            return res.status(403).json({ success: false, error: 'Invalid share link' });
        }

        if (row.expires_at && new Date(row.expires_at) < new Date()) {
            return res.status(403).json({ success: false, error: 'Share link expired' });
        }

        // Parse CSV of account numbers → array of strings
        const allowedAccounts = (row.account_numbers || '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);

        req.shareScope = {
            token: row.token,
            profileId: row.profile_id,
            profileName: row.profile_name,
            allowedAccounts,          // e.g. ["5017842"]
            fromDate: row.from_date,  // e.g. "2025-01-15" or null
            expiresAt: row.expires_at
        };
        return next();
    } catch (err) {
        console.error('Share resolver error:', err);
        return res.status(500).json({ success: false, error: 'Share resolver failure' });
    }
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
    console.log('====================================================');
    console.log('');
});
