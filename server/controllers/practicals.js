// Student-facing practical controller (READ ONLY for students).
// There is deliberately NO endpoint here that lets students modify practicals.
'use strict';

const db = require('../db');
const { now } = require('../helpers');

/** GET /api/practicals — list all practicals + the student's progress. */
async function list(req, res) {
  const practicals = await db.find('practicals', {}, { sort: { order: 1, practicalNumber: 1 } });
  const progressMap = {};
  for (const p of await db.find('progress', { userId: req.user.id })) {
    progressMap[p.practicalId] = p;
  }

  const out = practicals.map(p => {
    const pr = progressMap[p._id] || null;
    return {
      _id: p._id,
      practicalNumber: p.practicalNumber,
      title: p.title,
      shortDescription: p.shortDescription || '',
      language: p.language || '',
      order: p.order || 0,
      totalSteps: String(p.sourceCode || '').replace(/\r\n?/g, '\n').split('\n').length,
      progress: pr ? {
        step: parseInt(pr.step, 10) || 0,
        completed: !!pr.completed,
        lastAccessed: pr.lastAccessed || null,
      } : { step: 0, completed: false, lastAccessed: null },
    };
  });
  return res.json({ practicals: out });
}

/** GET /api/practicals/{id} — full practical content for the student. */
async function get(req, res) {
  const p = await db.findOne('practicals', { _id: req.params.id });
  if (!p) return res.status(404).json({ error: 'This practical could not be loaded.' });

  const pr = await db.findOne('progress', { userId: req.user.id, practicalId: p._id });

  // Record a view (lightweight, for admin usage stats).
  await db.update('practicals', { _id: p._id }, { viewCount: (p.viewCount || 0) + 1 });

  return res.json({
    practical: {
      _id: p._id,
      practicalNumber: p.practicalNumber,
      title: p.title,
      shortDescription: p.shortDescription || '',
      aim: p.aim || '',
      objective: p.objective || '',
      theory: p.theory || '',
      algorithm: p.algorithm || '',
      procedure: p.procedure || '',
      sourceCode: p.sourceCode || '',
      language: p.language || '',
      expectedOutput: p.expectedOutput || '',
      simulationData: p.simulationData || { cells: [], initial: {}, steps: [], finalOutput: '' },
      version: p.version || 1,
      progress: pr ? {
        step: parseInt(pr.step, 10) || 0,
        completed: !!pr.completed,
        lastAccessed: pr.lastAccessed || null,
      } : { step: 0, completed: false, lastAccessed: null },
    },
  });
}

module.exports = { list, get };
