// Authentication controller: register, login, logout, me, change-password.
'use strict';

const db = require('../db');
const { now, validPassword } = require('../helpers');
const {
  hashPassword, verifyPassword, createSessionToken, newCsrf,
  setSessionCookie, clearSessionCookie,
} = require('../auth');

async function logActivityFor(action, details, user) {
  await db.insert('activities', {
    userId: user ? user.id : null,
    role: user ? user.role : 'guest',
    name: user ? user.name : 'Guest',
    action, details, createdAt: now(),
  });
}

/** POST /api/auth/register — create a STUDENT account. */
async function register(req, res) {
  const in_ = req.body || {};
  const name = String(in_.name || '').trim();
  const email = String(in_.email || '').trim().toLowerCase();
  const username = String(in_.username || '').trim();
  const pw = String(in_.password || '');
  const enrollment = String(in_.enrollment || '').trim();

  if (name.length < 2) return res.status(400).json({ error: 'Please enter your full name.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3–20 characters (letters, digits, underscore).' });
  }
  if (!validPassword(pw)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters and include a letter and a digit.' });
  }
  if (enrollment !== '' && enrollment.length > 60) return res.status(400).json({ error: 'Enrollment number is too long.' });

  const dup = await db.findOne('users', { $or: [{ username }, { email }] });
  if (dup) return res.status(409).json({ error: 'Username or email is already registered.' });

  let id;
  try {
    id = await db.insert('users', {
      name,
      email,
      username,
      passwordHash: hashPassword(pw),
      role: 'student',
      enrollment,
      mustChangePassword: false,
      createdAt: now(),
      updatedAt: now(),
    });
  } catch (err) {
    // MongoDB's unique indexes are the final protection against two browsers
    // registering the same username/email at the same time.
    if (err && err.code === 11000) {
      return res.status(409).json({ error: 'Username or email is already registered.' });
    }
    throw err;
  }

  await db.insert('activities', {
    userId: id, role: 'student', name,
    action: 'registered',
    details: { userId: id, username },
    createdAt: now(),
  });

  return res.status(201).json({
    message: 'Registration successful. You can now log in.',
    user: { id, name, username, email, role: 'student' },
  });
}

/** POST /api/auth/login — username OR email + password. */
async function login(req, res) {
  const in_ = req.body || {};
  const idf = String(in_.username || '').trim();
  const pw = String(in_.password || '');

  if (idf === '' || pw === '') return res.status(401).json({ error: 'Invalid username or password.' });

  const user = await db.findOne('users', { $or: [{ username: idf }, { email: idf.toLowerCase() }] });
  if (!user || !verifyPassword(pw, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  // Fresh session on every login (prevents session fixation).
  const sessionUserData = {
    id: user._id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
    mustChangePassword: !!user.mustChangePassword,
  };
  const csrf = newCsrf();
  const token = createSessionToken(sessionUserData, csrf);
  setSessionCookie(res, token);

  await db.update('users', { _id: user._id }, { lastLoginAt: now() });
  await db.insert('activities', {
    userId: user._id, role: user.role, name: user.name,
    action: 'login', details: { username: user.username },
    createdAt: now(),
  });

  return res.json({ user: { ...sessionUserData, _id: user._id }, csrf });
}

/** POST /api/auth/logout */
async function logout(req, res) {
  const user = req.user || null;
  if (user) {
    await db.insert('activities', {
      userId: user.id, role: user.role, name: user.name,
      action: 'logout', details: { username: user.username },
      createdAt: now(),
    });
  }
  clearSessionCookie(res);
  return res.json({ message: 'Logged out successfully.' });
}

/** GET /api/auth/me */
async function me(req, res) {
  if (!req.session) {
    return res.status(401).json({ error: 'Not authenticated.', code: 'AUTH_REQUIRED' });
  }
  return res.json({ user: req.user, csrf: req.session.csrf });
}

/** POST /api/auth/change-password — change OWN password. */
async function changePassword(req, res) {
  const in_ = req.body || {};
  const current = String(in_.currentPassword || '');
  const next = String(in_.newPassword || '');

  if (!validPassword(next)) {
    return res.status(400).json({ error: 'New password must be at least 8 characters and include a letter and a digit.' });
  }
  if (current === next) {
    return res.status(400).json({ error: 'New password must be different from the current password.' });
  }

  const user = await db.findOne('users', { _id: req.user.id });
  if (!user || !verifyPassword(current, user.passwordHash)) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }

  await db.update('users', { _id: user._id }, {
    passwordHash: hashPassword(next),
    mustChangePassword: false,
    updatedAt: now(),
  });

  // Re-issue the session so mustChangePassword is cleared in the cookie too.
  const sessionUserData = {
    id: user._id, name: user.name, username: user.username,
    email: user.email, role: user.role, mustChangePassword: false,
  };
  const token = createSessionToken(sessionUserData, req.session.csrf);
  setSessionCookie(res, token);

  await db.insert('activities', {
    userId: user._id, role: user.role, name: user.name,
    action: 'password_changed', details: { username: user.username },
    createdAt: now(),
  });

  return res.json({ message: 'Password changed successfully.' });
}

module.exports = { register, login, logout, me, changePassword };
