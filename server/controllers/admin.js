// Admin / Faculty controller.
// EVERY method here is mounted behind requireAdmin() — server-side authorization.
'use strict';

const db = require('../db');
const { now, validPassword, normalizeSimulation } = require('../helpers');
const { hashPassword } = require('../auth');

const MAX_HISTORY = 20;

async function logActivityFor(action, details, user) {
  await db.insert('activities', {
    userId: user ? user.id : null,
    role: user ? user.role : 'guest',
    name: user ? user.name : 'Guest',
    action, details, createdAt: now(),
  });
}

// ---------------------------------------------------------------- dashboard

/** GET /api/admin/stats */
async function stats(req, res) {
  const practicals = await db.find('practicals', {}, { sort: { order: 1, practicalNumber: 1 } });
  const usage = await Promise.all(practicals.map(async p => ({
    practicalNumber: p.practicalNumber,
    title: p.title,
    views: p.viewCount || 0,
    started: await db.count('progress', { practicalId: p._id }),
    completed: await db.count('progress', { practicalId: p._id, completed: true }),
  })));

  const activity = await db.find('activities', {}, { sort: { createdAt: -1 }, limit: 10 });

  return res.json({
    stats: {
      practicals: await db.count('practicals'),
      students: await db.count('users', { role: 'student' }),
      completions: await db.count('progress', { completed: true }),
      users: await db.count('users'),
    },
    usage,
    activity,
  });
}

/** GET /api/admin/activities?limit=50 */
async function activities(req, res) {
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const rows = await db.find('activities', {}, { sort: { createdAt: -1 }, limit });
  return res.json({ activities: rows });
}

// ---------------------------------------------------------------- practicals

/** GET /api/admin/practicals?search=... */
async function practicals(req, res) {
  const search = String(req.query.search || '').trim();
  const filter = search === ''
    ? {}
    : { $or: [{ title: { $regex: search } }, { shortDescription: { $regex: search } }] };

  const rows = (await db.find('practicals', filter, { sort: { order: 1, practicalNumber: 1 } })).map(p => ({
    _id: p._id,
    practicalNumber: p.practicalNumber,
    title: p.title,
    language: p.language || '',
    order: p.order || 0,
    version: p.version || 1,
    updatedAt: p.updatedAt || null,
    updatedBy: p.updatedBy || null,
    stepCount: String(p.sourceCode || '').replace(/\r\n?/g, '\n').split('\n').length,
  }));
  return res.json({ practicals: rows });
}

/** GET /api/admin/practicals/{id} — full document (incl. simulation data). */
async function practicalGet(req, res) {
  const p = await db.findOne('practicals', { _id: req.params.id });
  if (!p) return res.status(404).json({ error: 'This practical could not be loaded.' });
  return res.json({ practical: p });
}

/** POST /api/admin/practicals — create (or reorder when body has ids). */
async function practicalCreate(req, res) {
  const in_ = req.body || {};

  // The admin UI reorders via POST {ids:[...]}; keep both verbs working.
  if (Array.isArray(in_.ids)) {
    return reorder(req, res);
  }

  const fields = validatePracticalInput(in_);
  if (fields.error) return res.status(400).json({ error: fields.error });

  const maxRows = await db.find('practicals', {}, { sort: { order: -1 }, limit: 1 });
  const max = maxRows[0] || null;
  const doc = {
    ...fields.value,
    order: (max ? max.order : 0) + 1,
    version: 1,
    viewCount: 0,
    history: [],
    createdAt: now(),
    updatedAt: now(),
    updatedBy: req.user.username,
  };
  const id = await db.insert('practicals', doc);
  await logActivityFor('create_practical', { practicalId: id, practicalNumber: doc.practicalNumber, title: doc.title }, req.user);
  return res.status(201).json({ message: 'Practical created successfully.', _id: id });
}

/** PUT /api/admin/practicals/{id} — with versioning + history snapshot. */
async function practicalUpdate(req, res) {
  const p = await db.findOne('practicals', { _id: req.params.id });
  if (!p) return res.status(404).json({ error: 'This practical could not be loaded.' });

  const in_ = req.body || {};
  const fields = validatePracticalInput(in_);
  if (fields.error) return res.status(400).json({ error: fields.error });

  // Versioning / safety: snapshot previous content (minus history) for restore.
  const { history: _h, _id: _idField, ...snapshot } = p;
  const history = Array.isArray(p.history) ? p.history : [];
  history.push({
    version: p.version || 1,
    snapshot,
    updatedBy: p.updatedBy || null,
    updatedAt: p.updatedAt || now(),
  });
  const trimmedHistory = history.slice(-MAX_HISTORY);

  const doc = {
    ...fields.value,
    version: (p.version || 1) + 1,
    history: trimmedHistory,
    updatedAt: now(),
    updatedBy: req.user.username,
    viewCount: p.viewCount || 0,
  };
  await db.update('practicals', { _id: p._id }, doc);
  await logActivityFor('update_practical', { practicalId: p._id, practicalNumber: doc.practicalNumber, title: doc.title, version: doc.version }, req.user);
  return res.json({ message: 'Practical updated successfully. All students will see the new version.', version: doc.version });
}

/** DELETE /api/admin/practicals/{id} */
async function practicalDelete(req, res) {
  const p = await db.findOne('practicals', { _id: req.params.id });
  if (!p) return res.status(404).json({ error: 'This practical could not be loaded.' });
  await db.deleteOne('practicals', { _id: p._id });
  await db.deleteMany('progress', { practicalId: p._id });
  await logActivityFor('delete_practical', { practicalId: p._id, practicalNumber: p.practicalNumber, title: p.title }, req.user);
  return res.json({ message: 'Practical deleted.' });
}

/** POST|PUT /api/admin/practicals — reorder {ids: [...]} */
async function reorder(req, res) {
  const ids = (req.body && req.body.ids) || [];
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Provide the ordered list of practical ids.' });
  }
  let i = 1;
  for (const pid of ids) {
    if (await db.findOne('practicals', { _id: String(pid) })) {
      await db.update('practicals', { _id: String(pid) }, { order: i++, updatedAt: now() });
    }
  }
  await logActivityFor('reorder_practicals', { count: ids.length }, req.user);
  return res.json({ message: 'Practical order updated.' });
}

/** GET /api/admin/practicals/{id}/history */
async function history(req, res) {
  const p = await db.findOne('practicals', { _id: req.params.id });
  if (!p) return res.status(404).json({ error: 'This practical could not be loaded.' });
  const rows = Array.isArray(p.history) ? p.history : [];
  return res.json({ history: [...rows].reverse() });
}

/** POST /api/admin/practicals/{id}/restore — {version} */
async function restore(req, res) {
  const p = await db.findOne('practicals', { _id: req.params.id });
  if (!p) return res.status(404).json({ error: 'This practical could not be loaded.' });

  const version = parseInt((req.body || {}).version, 10) || 0;
  let snapshot = null;
  for (const h of Array.isArray(p.history) ? p.history : []) {
    if ((h.version || 0) === version) { snapshot = h.snapshot; break; }
  }
  if (!snapshot) return res.status(404).json({ error: 'Version not found in history.' });

  const restored = { ...snapshot };
  restored.version = (p.version || 1) + 1;
  restored.updatedAt = now();
  restored.updatedBy = req.user.username;
  delete restored._id; // _id is immutable

  const { history: _h, _id: _idField, ...currentSnap } = p;
  const history = Array.isArray(p.history) ? p.history : [];
  history.push({
    version: p.version || 1,
    snapshot: currentSnap,
    updatedBy: p.updatedBy || null,
    updatedAt: now(),
  });
  restored.history = history.slice(-MAX_HISTORY);

  await db.update('practicals', { _id: p._id }, restored);
  await logActivityFor('restore_practical', { practicalId: p._id, version, title: restored.title }, req.user);
  return res.json({ message: `Practical restored to version ${version}.` });
}

// ---------------------------------------------------------------- students

/** GET /api/admin/students */
async function students(req, res) {
  const users = await db.find('users', { role: 'student' }, { sort: { createdAt: -1 } });
  const rows = await Promise.all(users.map(async u => ({
    _id: u._id,
    name: u.name,
    email: u.email,
    username: u.username,
    enrollment: u.enrollment || '',
    createdAt: u.createdAt || null,
    lastLoginAt: u.lastLoginAt || null,
    completed: await db.count('progress', { userId: u._id, completed: true }),
  })));
  return res.json({ students: rows });
}

/** GET /api/admin/students/{id}/details — complete student progress/activity overview. */
async function studentDetails(req, res) {
  const u = await db.findOne('users', { _id: req.params.id });
  if (!u || u.role !== 'student') return res.status(404).json({ error: 'Student not found.' });

  const enrollmentNo = String(u.enrollment || '').trim().toUpperCase();
  const enrollment = enrollmentNo ? await db.findOne('enrollments', { enrollmentNo }) : null;
  const practicals = await db.find('practicals', {}, { sort: { order: 1, practicalNumber: 1 } });
  const progressRows = await db.find('progress', { userId: u._id }, { sort: { lastAccessed: -1 } });
  const progressMap = {};
  for (const p of progressRows) progressMap[p.practicalId] = p;

  const practicalProgress = practicals.map((p, index) => {
    const pr = progressMap[p._id] || {};
    return {
      practicalId: p._id,
      practicalNumber: p.practicalNumber,
      title: p.title,
      order: p.order || index + 1,
      step: parseInt(pr.step, 10) || 0,
      totalSteps: String(p.sourceCode || '').replace(/\r\n?/g, '\n').split('\n').length,
      completed: !!pr.completed,
      completedAt: pr.completedAt || null,
      lastAccessed: pr.lastAccessed || null,
    };
  });

  const firstIncomplete = practicalProgress.find(p => !p.completed);
  const completedCount = practicalProgress.filter(p => p.completed).length;
  const currentPractical = firstIncomplete ? {
    practicalNumber: firstIncomplete.practicalNumber,
    title: firstIncomplete.title,
    status: firstIncomplete.step > 0 ? 'in-progress' : 'not-started',
  } : null;

  const activities = await db.find('activities', { userId: u._id }, { sort: { createdAt: -1 }, limit: 50 });

  return res.json({
    student: {
      _id: u._id, name: u.name, username: u.username, email: u.email,
      enrollment: enrollmentNo || '', createdAt: u.createdAt || null, lastLoginAt: u.lastLoginAt || null,
    },
    enrollment: enrollment || null,
    summary: { totalPracticals: practicalProgress.length, completedPracticals: completedCount,
      completionPercent: practicalProgress.length ? Math.round((completedCount / practicalProgress.length) * 100) : 0,
      currentPractical },
    progress: practicalProgress,
    activities,
  });
}

/** POST /api/admin/students/{id}/reset-password — {newPassword} */
async function studentResetPassword(req, res) {
  const pw = String((req.body || {}).newPassword || '');
  if (!validPassword(pw)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters and include a letter and a digit.' });
  }
  const u = await db.findOne('users', { _id: req.params.id });
  if (!u || u.role !== 'student') return res.status(404).json({ error: 'Student not found.' });
  await db.update('users', { _id: u._id }, { passwordHash: hashPassword(pw), updatedAt: now() });
  await logActivityFor('reset_student_password', { studentId: u._id, username: u.username }, req.user);
  return res.json({ message: `Password updated for ${u.name}.` });
}

/** DELETE /api/admin/students/{id} */
async function studentDelete(req, res) {
  const u = await db.findOne('users', { _id: req.params.id });
  if (!u || u.role !== 'student') return res.status(404).json({ error: 'Student not found.' });
  await db.deleteOne('users', { _id: u._id });
  await db.deleteMany('progress', { userId: u._id });
  await logActivityFor('delete_student', { studentId: u._id, username: u.username }, req.user);
  return res.json({ message: `Student ${u.name} removed.` });
}

// ---------------------------------------------------------------- enrollment management

/** GET /api/admin/enrollments?batch=2026 */
async function enrollments(req, res) {
  const batch = String(req.query.batch || '').trim();
  const filter = batch ? { batch: { $regex: batch } } : {};
  const rows = await db.find('enrollments', filter, { sort: { batch: 1, enrollmentNo: 1 } });
  return res.json({ enrollments: rows });
}

/** POST /api/admin/enrollments/import — import official college CSV rows. */
async function importEnrollments(req, res) {
  const rows = Array.isArray(req.body && req.body.rows) ? req.body.rows : [];
  if (!rows.length) return res.status(400).json({ error: 'No enrollment rows were provided.' });
  if (rows.length > 5000) return res.status(400).json({ error: 'A single import can contain at most 5,000 rows.' });

  let added = 0, updated = 0, skipped = 0;
  const errors = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    const enrollmentNo = String(r.enrollmentNo || r.enrollment || r['Enrollment No'] || r['Enrollment Number'] || '').trim().toUpperCase();
    const studentName = String(r.studentName || r.name || r['Student Name'] || '').trim();
    const batch = String(r.batch || r['Academic Batch'] || r['Batch'] || '').trim();
    const program = String(r.program || r['Program'] || '').trim();
    const status = String(r.status || r['Status'] || 'active').trim().toLowerCase() || 'active';

    if (!enrollmentNo) { errors.push(`Row ${i + 2}: enrollment number is missing.`); continue; }
    if (!/^[A-Z0-9-]{6,30}$/.test(enrollmentNo)) { errors.push(`Row ${i + 2}: invalid enrollment number "${enrollmentNo}".`); continue; }
    if (!batch) { errors.push(`Row ${i + 2}: academic batch is missing for ${enrollmentNo}.`); continue; }
    if (!['active', 'admitted', 'alumni', 'inactive'].includes(status)) { errors.push(`Row ${i + 2}: invalid status for ${enrollmentNo}. Use active, admitted, alumni or inactive.`); continue; }

    const existing = await db.findOne('enrollments', { enrollmentNo });
    const doc = {
      enrollmentNo,
      studentName,
      batch,
      program,
      status,
      updatedAt: now(),
      updatedBy: req.user.username,
    };
    if (existing) {
      await db.update('enrollments', { _id: existing._id }, doc);
      updated++;
    } else {
      await db.insert('enrollments', { ...doc, createdAt: now() });
      added++;
    }
  }

  await logActivityFor('import_enrollments', { added, updated, skipped, errors: errors.length }, req.user);
  return res.json({ message: `Enrollment import complete: ${added} added, ${updated} updated.`, added, updated, skipped, errors });
}

/** DELETE /api/admin/enrollments/{id} */
async function enrollmentDelete(req, res) {
  const row = await db.findOne('enrollments', { _id: req.params.id });
  if (!row) return res.status(404).json({ error: 'Enrollment record not found.' });
  await db.deleteOne('enrollments', { _id: row._id });
  await logActivityFor('delete_enrollment', { enrollmentNo: row.enrollmentNo, batch: row.batch }, req.user);
  return res.json({ message: `Enrollment ${row.enrollmentNo} removed from the approved list.` });
}

// ---------------------------------------------------------------- helpers

function validatePracticalInput(in_) {
  const num = parseInt(in_.practicalNumber, 10);
  const title = String(in_.title || '').trim();
  const sourceCode = String(in_.sourceCode || '');

  if (!Number.isFinite(num) || num < 1) return { error: 'Practical number must be a positive integer.' };
  if (title === '') return { error: 'Practical title is required.' };
  if (sourceCode.length > 200000) return { error: 'Source code is too large.' };

  const simData = normalizeSimulation(
    in_.simulationData && typeof in_.simulationData === 'object' ? in_.simulationData : null,
    sourceCode
  );

  return {
    value: {
      practicalNumber: num,
      title,
      shortDescription: String(in_.shortDescription || '').trim(),
      aim: String(in_.aim || ''),
      objective: String(in_.objective || ''),
      theory: String(in_.theory || ''),
      algorithm: String(in_.algorithm || ''),
      procedure: String(in_.procedure || ''),
      sourceCode,
      language: String(in_.language || '').trim() !== '' ? String(in_.language).trim() : 'Plain text',
      expectedOutput: String(in_.expectedOutput || ''),
      simulationData: simData,
    },
  };
}

module.exports = {
  stats, activities, enrollments, importEnrollments, enrollmentDelete,
  practicals, practicalGet, practicalCreate, practicalUpdate, practicalDelete,
  reorder, history, restore,
  students, studentDetails, studentResetPassword, studentDelete,
};
