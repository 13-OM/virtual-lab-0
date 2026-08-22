// Shared helpers: timestamps, validation, simulation normalization.
'use strict';

/** Current unix timestamp in seconds (matches the previous backend's format). */
function now() {
  return Math.floor(Date.now() / 1000);
}

function validPassword(pw) {
  return typeof pw === 'string'
    && pw.length >= 8
    && /[A-Za-z]/.test(pw)
    && /[0-9]/.test(pw);
}

function publicUser(u) {
  const { passwordHash, ...rest } = u;
  return rest;
}

/**
 * Normalise / validate simulation data. Mirrors the backend contract:
 * ensures a safe, predictable shape and auto-generates one generic step per
 * source line when the admin provided no steps (so every practical is
 * simulatable out of the box).
 */
function normalizeSimulation(raw, sourceCode = '') {
  raw = raw && typeof raw === 'object' ? raw : {};

  const steps = [];
  for (const s of Array.isArray(raw.steps) ? raw.steps : []) {
    if (!s || typeof s !== 'object') continue;
    steps.push({
      line: Math.max(1, parseInt(s.line, 10) || 1),
      what: String(s.what || ''),
      why: String(s.why || ''),
      how: String(s.how || ''),
      result: String(s.result || ''),
      before: s.before && typeof s.before === 'object' ? s.before : {},
      after: s.after && typeof s.after === 'object' ? s.after : {},
      output: String(s.output || ''),
    });
  }

  if (steps.length === 0 && typeof sourceCode === 'string' && sourceCode !== '') {
    sourceCode.split('\n').forEach((line, i) => {
      if (line.trim() === '') return;
      steps.push({
        line: i + 1,
        what: 'Executes: ' + line.trim(),
        why: 'This line is part of the program flow of the practical.',
        how: 'The instruction is processed and its effect is reflected in the program state.',
        result: 'Execution moves to the next instruction.',
        before: {},
        after: {},
        output: '',
      });
    });
  }

  const cells = [];
  for (const c of Array.isArray(raw.cells) ? raw.cells : []) {
    if (c && typeof c === 'object' && c.key !== undefined) {
      cells.push({
        key: String(c.key),
        label: String(c.label || ''),
        kind: String(c.kind || 'text'),
      });
    }
  }

  return {
    cells,
    initial: raw.initial && typeof raw.initial === 'object' ? raw.initial : {},
    steps,
    finalOutput: String(raw.finalOutput || ''),
  };
}

module.exports = { now, validPassword, publicUser, normalizeSimulation };
