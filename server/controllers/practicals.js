// Student-facing practical controller (READ ONLY for students).
'use strict';

const db = require('../db');

async function getOrderedPracticals() {
  return db.find('practicals', {}, { sort: { order: 1, practicalNumber: 1 } });
}

async function getUnlockState(userId, practicals) {
  const progressRows = await db.find('progress', { userId });
  const progressMap = {};
  for (const p of progressRows) progressMap[p.practicalId] = p;
  const state = {};
  let previousCompleted = true;
  for (const p of practicals) {
    state[p._id] = previousCompleted;
    previousCompleted = !!progressMap[p._id]?.completed;
  }
  return { progressMap, state };
}

/** GET /api/practicals — list all practicals + the student's progress and lock state. */
async function list(req, res) {
  const practicals = await getOrderedPracticals();
  const { progressMap, state } = await getUnlockState(req.user.id, practicals);
  const isAdmin = req.user.role === 'admin';
  const out = practicals.map(p => {
    const pr = progressMap[p._id] || null;
    const unlocked = isAdmin || !!state[p._id];
    return {
      _id: p._id,
      practicalNumber: p.practicalNumber,
      title: p.title,
      shortDescription: p.shortDescription || '',
      language: p.language || '',
      order: p.order || 0,
      unlocked,
      totalSteps: String(p.sourceCode || '').replace(/\r\n?/g, '\n').split('\n').length,
      progress: pr ? { step: parseInt(pr.step, 10) || 0, completed: !!pr.completed, lastAccessed: pr.lastAccessed || null }
        : { step: 0, completed: false, lastAccessed: null },
    };
  });
  return res.json({ practicals: out });
}

/** GET /api/practicals/{id} — full practical content for the student. */
async function get(req, res) {
  const practicals = await getOrderedPracticals();
  const p = practicals.find(x => x._id === req.params.id);
  if (!p) return res.status(404).json({ error: 'This practical could not be loaded.' });

  if (req.user.role !== 'admin') {
    const { progressMap, state } = await getUnlockState(req.user.id, practicals);
    if (!state[p._id]) {
      const index = practicals.findIndex(x => x._id === p._id);
      const previous = index > 0 ? practicals[index - 1] : null;
      return res.status(403).json({
        error: previous
          ? `Practical ${previous.practicalNumber} must be completed before Practical ${p.practicalNumber}.`
          : 'This practical is currently locked.',
        code: 'PRACTICAL_LOCKED',
        previousPracticalId: previous?._id || null,
        previousPracticalNumber: previous?.practicalNumber || null,
      });
    }
  }

  const pr = await db.findOne('progress', { userId: req.user.id, practicalId: p._id });
  await db.update('practicals', { _id: p._id }, { viewCount: (p.viewCount || 0) + 1 });
  return res.json({
    practical: {
      _id: p._id, practicalNumber: p.practicalNumber, title: p.title, shortDescription: p.shortDescription || '',
      aim: p.aim || '', objective: p.objective || '', theory: p.theory || '', algorithm: p.algorithm || '',
      procedure: p.procedure || '', sourceCode: p.sourceCode || '', language: p.language || '',
      expectedOutput: p.expectedOutput || '', simulationData: p.simulationData || { cells: [], initial: {}, steps: [], finalOutput: '' },
      version: p.version || 1,
      progress: pr ? { step: parseInt(pr.step, 10) || 0, completed: !!pr.completed, lastAccessed: pr.lastAccessed || null }
        : { step: 0, completed: false, lastAccessed: null },
    },
  });
}

module.exports = { list, get };
