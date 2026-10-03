const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── MIDDLEWARE ───
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ─── SERVE FRONTEND ───
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── TEST ROUTE ───
app.get('/api/health', (req, res) => {
    res.json({
        status: 'running',
        message: 'MT5 Dashboard Server is alive!',
        timestamp: new Date().toISOString()
    });
});

// ─── START SERVER ───
app.listen(PORT, () => {
    console.log('');
    console.log('===========================================');
    console.log('   🚀 MT5 DASHBOARD SERVER STARTED');
    console.log('===========================================');
    console.log(`   🌐 URL: http://localhost:${PORT}`);
    console.log(`   ❤️  Health: http://localhost:${PORT}/api/health`);
    console.log('===========================================');
    console.log('');
});
