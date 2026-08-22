// Student progress controller — tracks per-practical simulation progress.
'use strict';

const db = require('../db');
const { now } = require('../helpers');

async function getOrderedPracticals() {
  return db.find('practicals', {}, { sort: { order: 1, practicalNumber: 1 } });
}

async function ensureUnlocked(userId, practicalId) {
  const practicals = await getOrderedPracticals();
  const idx = practicals.findIndex(p => p._id === practicalId);
  if (idx < 0) return { ok: false, status: 404, error: 'This practical could not be loaded.' };
  if (idx === 0) return { ok: true, practical: practicals[idx] };
  if (await db.findOne('progress', { userId, practicalId: practicals[idx - 1]._id, completed: true })) {
    return { ok: true, practical: practicals[idx] };
  }
  return { ok: false, status: 403, error: `Complete Practical ${practicals[idx - 1].practicalNumber} before starting Practical ${practicals[idx].practicalNumber}.`, code: 'PRACTICAL_LOCKED' };
}

/** GET /api/progress — the student's progress across all practicals. */
async function list(req, res) {
  const practicals = await getOrderedPracticals();
  const titleMap = {};
  for (const p of practicals) titleMap[p._id] = { title: p.title, practicalNumber: p.practicalNumber, totalSteps: String(p.sourceCode || '').replace(/\r\n?/g, '\n').split('\n').length };
  const rows = (await db.find('progress', { userId: req.user.id }, { sort: { lastAccessed: -1 } })).map(pr => {
    const t = titleMap[pr.practicalId] || {};
    return { practicalId: pr.practicalId, practicalTitle: t.title || 'Unknown practical', practicalNumber: t.practicalNumber || 0,
      totalSteps: t.totalSteps || 0, step: parseInt(pr.step, 10) || 0, completed: !!pr.completed,
      completedAt: pr.completedAt || null, lastAccessed: pr.lastAccessed || null };
  });
  return res.json({ progress: rows });
}

/** POST /api/progress — save simulation position / completion. */
async function save(req, res) {
  const in_ = req.body || {};
  const pid = String(in_.practicalId || '');
  const step = Math.max(0, parseInt(in_.step, 10) || 0);
  const completed = !!in_.completed;
  if (pid === '') return res.status(400).json({ error: 'Missing practical id.' });

  const access = await ensureUnlocked(req.user.id, pid);
  if (!access.ok) return res.status(access.status).json({ error: access.error, code: access.code || undefined });
  const p = access.practical;
  const existing = await db.findOne('progress', { userId: req.user.id, practicalId: pid });
  if (existing?.completed && !completed) return res.status(400).json({ error: 'Completed practical progress cannot be rolled back.' });

  const set = { step, completed, lastAccessed: now(), updatedAt: now() };
  if (completed && !(existing && existing.completed)) {
    set.completedAt = now();
    await db.insert('activities', { userId: req.user.id, role: req.user.role, name: req.user.name,
      action: 'completed_practical', details: { practicalId: pid, practicalNumber: p.practicalNumber, title: p.title }, createdAt: now() });
  }
  await db.update('progress', { userId: req.user.id, practicalId: pid }, set, { upsert: true });
  return res.json({ message: 'Progress saved.', progress: { practicalId: pid, step, completed, ...set } });
}

module.exports = { list, save };
