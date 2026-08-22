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

/** POST /api/auth/register — create an approved STUDENT account or a faculty approval request. */
async function register(req, res) {
  const in_ = req.body || {};
  const name = String(in_.name || '').trim();
  const email = String(in_.email || '').trim().toLowerCase();
  const username = String(in_.username || '').trim();
  const pw = String(in_.password || '');
  const enrollment = String(in_.enrollment || '').trim().toUpperCase();
  const college = String(in_.college || in_.institution || '').trim();
  const program = String(in_.program || '').trim();
  const batch = String(in_.batch || '').trim();

  if (name.length < 2) return res.status(400).json({ error: 'Please enter your full name.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return res.status(400).json({ error: 'Username must be 3–20 characters (letters, digits, underscore).' });
  if (!validPassword(pw)) return res.status(400).json({ error: 'Password must be at least 8 characters and include a letter and a digit.' });
  if (enrollment === '') return res.status(400).json({ error: 'Enrollment number is required.' });
  if (!/^[A-Z0-9-]{6,30}$/.test(enrollment)) return res.status(400).json({ error: 'Please enter a valid enrollment number.' });

  const dupEnrollment = await db.findOne('users', { enrollment });
  if (dupEnrollment) {
    if (dupEnrollment.accountStatus === 'pending_approval') {
      return res.status(409).json({ error: 'A registration request for this enrollment number is already waiting for faculty approval.' });
    }
    return res.status(409).json({ error: 'This enrollment number is already registered.' });
  }
  const dup = await db.findOne('users', { $or: [{ username }, { email }] });
  if (dup) return res.status(409).json({ error: 'Username or email is already registered.' });

  // Official college list: create an active account immediately.
  const approvedEnrollment = await db.findOne('enrollments', { enrollmentNo: enrollment });
  if (approvedEnrollment) {
    if (approvedEnrollment.status && !['active', 'admitted'].includes(String(approvedEnrollment.status).toLowerCase())) {
      return res.status(403).json({ error: 'This enrollment is not currently eligible for registration.' });
    }
    let id;
    try {
      id = await db.insert('users', {
        name, email, username, passwordHash: hashPassword(pw), role: 'student',
        enrollment, batch: approvedEnrollment.batch || batch, program: approvedEnrollment.program || program,
        college: college || approvedEnrollment.college || '', accountStatus: 'active', mustChangePassword: false,
        createdAt: now(), updatedAt: now(),
      });
    } catch (err) {
      if (err && err.code === 11000) return res.status(409).json({ error: 'Username or email is already registered.' });
      throw err;
    }
    await logActivityFor('registered', { userId: id, username, enrollment, source: 'approved_enrollment' }, { id, role: 'student', name });
    return res.status(201).json({
      message: 'Registration successful. You can now log in.',
      user: { id, name, username, email, role: 'student', enrollment, batch: approvedEnrollment.batch || batch },
    });
  }

  // Not on the official list: create a pending account request. The password is
  // stored only as a secure hash; the account cannot log in until an admin approves it.
  if (college.length < 2) return res.status(400).json({ error: 'Please enter your college/institution name so faculty can review the request.' });
  if (program.length < 2) return res.status(400).json({ error: 'Please enter your program/branch so faculty can review the request.' });

  let id;
  try {
    id = await db.insert('users', {
      name, email, username, passwordHash: hashPassword(pw), role: 'student', enrollment,
      batch, program, college, accountStatus: 'pending_approval', mustChangePassword: false,
      requestedAt: now(), createdAt: now(), updatedAt: now(),
    });
  } catch (err) {
    if (err && err.code === 11000) return res.status(409).json({ error: 'Username, email, or enrollment number is already registered/requested.' });
    throw err;
  }

  await db.insert('registrationRequests', {
    userId: id, name, email, username, enrollment, college, program, batch,
    status: 'pending', createdAt: now(), updatedAt: now(),
  });
  await logActivityFor('registration_requested', { userId: id, username, enrollment, college, program }, { id, role: 'student', name });

  return res.status(202).json({
    message: 'Registration request sent to the faculty administrator. You can log in after it is approved.',
    pending: true,
  });
}

/** POST /api/auth/login — username OR email + password. */
async function login(req, res) {
  const in_ = req.body || {};
  const idf = String(in_.username || '').trim();
  const pw = String(in_.password || '');
  if (idf === '' || pw === '') return res.status(401).json({ error: 'Invalid username or password.' });

  const user = await db.findOne('users', { $or: [{ username: idf }, { email: idf.toLowerCase() }] });
  if (!user || !verifyPassword(pw, user.passwordHash)) return res.status(401).json({ error: 'Invalid username or password.' });

  if (user.role === 'student') {
    if (user.accountStatus === 'pending_approval') return res.status(403).json({ error: 'Your registration is waiting for faculty approval.' });
    if (user.accountStatus === 'rejected') return res.status(403).json({ error: 'Your registration request was rejected by the faculty administrator.' });
    if (user.enrollment) {
      const enrollment = await db.findOne('enrollments', { enrollmentNo: String(user.enrollment).toUpperCase() });
      if (!enrollment || !['active', 'admitted'].includes(String(enrollment.status || 'active').toLowerCase())) {
        return res.status(403).json({ error: 'Your enrollment is not currently active. Please contact the faculty administrator.' });
      }
    }
  }

  const sessionUserData = {
    id: user._id, name: user.name, username: user.username, email: user.email,
    role: user.role, mustChangePassword: !!user.mustChangePassword,
  };
  const csrf = newCsrf();
  const token = createSessionToken(sessionUserData, csrf);
  setSessionCookie(res, token);

  await db.update('users', { _id: user._id }, { lastLoginAt: now() });
  await db.insert('activities', { userId: user._id, role: user.role, name: user.name, action: 'login', details: { username: user.username }, createdAt: now() });
  return res.json({ user: { ...sessionUserData, _id: user._id }, csrf });
}

async function logout(req, res) {
  const user = req.user || null;
  if (user) await db.insert('activities', { userId: user.id, role: user.role, name: user.name, action: 'logout', details: { username: user.username }, createdAt: now() });
  clearSessionCookie(res);
  return res.json({ message: 'Logged out successfully.' });
}

async function me(req, res) {
  if (!req.session) return res.status(401).json({ error: 'Not authenticated.', code: 'AUTH_REQUIRED' });
  return res.json({ user: req.user, csrf: req.session.csrf });
}

async function changePassword(req, res) {
  const in_ = req.body || {};
  const current = String(in_.currentPassword || '');
  const next = String(in_.newPassword || '');
  if (!validPassword(next)) return res.status(400).json({ error: 'New password must be at least 8 characters and include a letter and a digit.' });
  if (current === next) return res.status(400).json({ error: 'New password must be different from the current password.' });
  const user = await db.findOne('users', { _id: req.user.id });
  if (!user || !verifyPassword(current, user.passwordHash)) return res.status(400).json({ error: 'Current password is incorrect.' });
  await db.update('users', { _id: user._id }, { passwordHash: hashPassword(next), mustChangePassword: false, updatedAt: now() });
  const sessionUserData = { id: user._id, name: user.name, username: user.username, email: user.email, role: user.role, mustChangePassword: false };
  const token = createSessionToken(sessionUserData, req.session.csrf);
  setSessionCookie(res, token);
  await db.insert('activities', { userId: user._id, role: user.role, name: user.name, action: 'password_changed', details: { username: user.username }, createdAt: now() });
  return res.json({ message: 'Password changed successfully.' });
}

module.exports = { register, login, logout, me, changePassword };
