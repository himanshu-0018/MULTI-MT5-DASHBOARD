const crypto = require('crypto');
const db = require('./database');

const SESSION_DAYS = 30;
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const attempts = new Map(); // ip -> { count, until }

const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();

// Session secret is derived from MASTER_PASSCODE (changing the passcode logs everyone out)
function secret() {
    return process.env.SESSION_SECRET || sha('mt5-session:' + process.env.MASTER_PASSCODE).toString('hex');
}
function sign(data) {
    return crypto.createHmac('sha256', secret()).update(data).digest('base64url');
}
function safeEqual(a, b) {
    return crypto.timingSafeEqual(sha(a), sha(b));
}

function createSession() {
    const payload = Buffer.from(JSON.stringify({ t: 'admin', exp: Date.now() + SESSION_DAYS * 86400000 })).toString('base64url');
    return `${payload}.${sign(payload)}`;
}

function verifySession(token) {
    if (!process.env.MASTER_PASSCODE || !token || !token.includes('.')) return false;
    const [payload, sig] = token.split('.');
    if (!safeEqual(sig, sign(payload))) return false;
    try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
        return data.t === 'admin' && data.exp > Date.now();
    } catch (e) {
        return false;
    }
}

function login(req, res) {
    const master = process.env.MASTER_PASSCODE;
    if (!master) return res.status(503).json({ success: false, error: 'MASTER_PASSCODE is not configured on the server' });

    const ip = req.ip;
    const now = Date.now();
    const rec = attempts.get(ip) || { count: 0, until: 0 };
    if (rec.until > now) {
        return res.status(429).json({ success: false, error: `Too many attempts. Try again in ${Math.ceil((rec.until - now) / 60000)} min` });
    }

    const passcode = String((req.body || {}).passcode || '');
    if (!safeEqual(passcode, master)) {
        rec.count += 1;
        if (rec.count >= MAX_ATTEMPTS) { rec.until = now + LOCK_MINUTES * 60000; rec.count = 0; }
        attempts.set(ip, rec);
        return res.status(401).json({ success: false, error: 'Wrong passcode' });
    }
    attempts.delete(ip);
    return res.json({ success: true, token: createSession() });
}

function profileAccounts(profileId) {
    return db.prepare('SELECT account_number FROM profile_accounts WHERE profile_id = ?').all(profileId).map((r) => r.account_number);
}

// Decides what the caller may see. Share tokens are hard-locked to their profile + start date.
function resolveScope(req, res, next) {
    const shareToken = req.get('X-Share-Token');
    if (shareToken) {
        const share = db.prepare(`
            SELECT s.id, s.profile_id, s.from_date, p.name AS profile_name
            FROM share_links s JOIN profiles p ON p.id = s.profile_id
            WHERE s.token = ? AND s.revoked = 0
        `).get(shareToken);
        if (!share) return res.status(403).json({ success: false, error: 'share_invalid' });
        req.scope = {
            mode: 'share',
            shareId: share.id,
            profile: { id: share.profile_id, name: share.profile_name },
            accounts: profileAccounts(share.profile_id),
            minDate: share.from_date || null
        };
        return next();
    }

    const header = req.get('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!verifySession(token)) return res.status(401).json({ success: false, error: 'unauthorized' });

    let profile = null;
    let accounts = null; // null = every account
    const pid = req.query.profile;
    if (pid && pid !== 'all') {
        profile = db.prepare('SELECT id, name FROM profiles WHERE id = ?').get(Number(pid)) || null;
        if (profile) accounts = profileAccounts(profile.id);
    }
    req.scope = { mode: 'admin', profile, accounts, minDate: null };
    return next();
}

function requireAdmin(req, res, next) {
    if (!req.scope || req.scope.mode !== 'admin') return res.status(403).json({ success: false, error: 'forbidden' });
    return next();
}

function newShareToken() {
    return crypto.randomBytes(24).toString('base64url');
}

module.exports = { login, resolveScope, requireAdmin, newShareToken, profileAccounts };
