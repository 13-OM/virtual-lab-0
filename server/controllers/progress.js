// Student progress controller — tracks per-practical simulation progress.
'use strict';

const db = require('../db');
const { now } = require('../helpers');

/** GET /api/progress — the student's progress across all practicals. */
async function list(req, res) {
  const practicals = await db.find('practicals', {}, { sort: { order: 1 } });
  const titleMap = {};
  for (const p of practicals) {
    titleMap[p._id] = {
      title: p.title,
      practicalNumber: p.practicalNumber,
      totalSteps: String(p.sourceCode || '').replace(/\r\n?/g, '\n').split('\n').length,
    };
  }

  const rows = (await db.find('progress', { userId: req.user.id }, { sort: { lastAccessed: -1 } })).map(pr => {
    const t = titleMap[pr.practicalId] || {};
    return {
      practicalId: pr.practicalId,
      practicalTitle: t.title || 'Unknown practical',
      practicalNumber: t.practicalNumber || 0,
      totalSteps: t.totalSteps || 0,
      step: parseInt(pr.step, 10) || 0,
      completed: !!pr.completed,
      completedAt: pr.completedAt || null,
      lastAccessed: pr.lastAccessed || null,
    };
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
  const p = await db.findOne('practicals', { _id: pid });
  if (!p) return res.status(404).json({ error: 'This practical could not be loaded.' });

  const existing = await db.findOne('progress', { userId: req.user.id, practicalId: pid });

  const set = {
    step,
    completed,
    lastAccessed: now(),
    updatedAt: now(),
  };
  if (completed && !(existing && existing.completed)) {
    set.completedAt = now();
    await db.insert('activities', {
      userId: req.user.id, role: req.user.role, name: req.user.name,
      action: 'completed_practical',
      details: { practicalId: pid, practicalNumber: p.practicalNumber, title: p.title },
      createdAt: now(),
    });
  }

  await db.update('progress', { userId: req.user.id, practicalId: pid }, set, { upsert: true });
  return res.json({
    message: 'Progress saved.',
    progress: { practicalId: pid, step, completed, ...set },
  });
}

module.exports = { list, save };
