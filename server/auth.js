// ============================================================================
// Authentication & authorization.
// Passwords are bcrypt hashes. Sessions are signed cookies; the signing secret
// MUST come from SESSION_SECRET in production so restarts/redeploys do not
// unexpectedly invalidate every session.
// ============================================================================
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const config = require('./config');

let SECRET = null;

function secret() {
  if (SECRET) return SECRET;

  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32) {
    SECRET = process.env.SESSION_SECRET;
    return SECRET;
  }

  if (config.IS_PRODUCTION) {
    throw new Error(
      'SESSION_SECRET is required in production. Add a long random SESSION_SECRET environment variable.'
    );
  }

  const file = path.join(config.DATA_DIR, '.secret');
  if (fs.existsSync(file)) {
    SECRET = fs.readFileSync(file, 'utf8').trim();
  } else {
    SECRET = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(config.DATA_DIR, { recursive: true });
    fs.writeFileSync(file, SECRET, { mode: 0o600 });
  }
  return SECRET;
}

function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10);
}

function verifyPassword(pw, hash) {
  try {
    return bcrypt.compareSync(pw, hash);
  } catch {
    return false;
  }
}

function b64u(buf) {
  return Buffer.from(buf).toString('base64url');
}

function sign(payload) {
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function newCsrf() {
  return crypto.randomBytes(24).toString('hex');
}

function createSessionToken(user, csrf) {
  const payload = b64u(JSON.stringify({
    uid: user.id,
    exp: Date.now() + config.SESSION_LIFETIME_MS,
    csrf: csrf || newCsrf(),
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
    mustChangePassword: !!user.mustChangePassword,
  }));
  return sign(payload);
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    try {
      out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      // Ignore malformed cookies.
    }
  }
  return out;
}

function readSession(req) {
  const raw = parseCookies(req)[config.SESSION_NAME];
  if (!raw) return null;

  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;

  const payload = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  let expected;
  try {
    expected = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  } catch {
    return null;
  }

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!data.uid || data.exp < Date.now()) return null;
  return data;
}

function sessionUser(sess) {
  return {
    id: sess.uid,
    name: sess.name,
    username: sess.username,
    email: sess.email,
    role: sess.role,
    mustChangePassword: !!sess.mustChangePassword,
  };
}

function setSessionCookie(res, token) {
  const secure = config.IS_PRODUCTION ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${config.SESSION_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(config.SESSION_LIFETIME_MS / 1000)}${secure}`
  );
}

function clearSessionCookie(res) {
  const secure = config.IS_PRODUCTION ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${config.SESSION_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
  );
}

function requireAuth(req, res, next) {
  const sess = readSession(req);
  if (!sess) {
    return res.status(401).json({ error: 'Authentication required. Please log in.', code: 'AUTH_REQUIRED' });
  }
  req.user = sessionUser(sess);
  req.session = sess;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You do not have permission to perform this action.', code: 'FORBIDDEN' });
    }
    if (req.user.mustChangePassword) {
      return res.status(403).json({ error: 'You must change the default password before continuing.', code: 'PASSWORD_CHANGE_REQUIRED' });
    }
    next();
  });
}

function csrfMiddleware(req, res, next) {
  if (req.method === 'GET') return next();
  if (req.path === '/auth/login' || req.path === '/auth/register') return next();

  const sess = readSession(req);
  if (!sess) return next();

  const token = req.headers['x-csrf-token'] || '';
  const a = Buffer.from(token);
  const b = Buffer.from(sess.csrf || '');
  if (token === '' || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(419).json({ error: 'Invalid or expired session token. Please refresh and try again.', code: 'CSRF_FAILED' });
  }
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSessionToken,
  newCsrf,
  readSession,
  sessionUser,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireAdmin,
  csrfMiddleware,
};
