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
