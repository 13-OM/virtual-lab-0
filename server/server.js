// ============================================================================
// Virtual Laboratory — Express.js + MongoDB Atlas server.
// Browser(s) -> Express API -> MongoDB Atlas
// The frontend is served from the same origin, so authentication cookies and
// API requests work consistently across Chrome, Edge, Firefox, etc.
// ============================================================================
'use strict';

const path = require('path');
const express = require('express');
const config = require('./config');
const db = require('./db');
const { csrfMiddleware } = require('./auth');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use(csrfMiddleware);
app.use('/api', require('./routes'));

app.use(express.static(config.FRONTEND_DIR, {
  index: 'index.html',
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.sendFile(path.join(config.FRONTEND_DIR, 'index.html'));
  }
  next();
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.use((err, req, res, next) => {
  console.error('[vlab]', err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  if (err && err.status === 400) {
    return res.status(400).json({ error: 'Invalid request body.' });
  }
  return res.status(500).json({ error: 'The server could not complete the request. Please try again.' });
});

let server;

async function start() {
  await db.load(config.DATA_FILE);
  server = app.listen(config.PORT, '0.0.0.0', () => {
    console.log(`Virtual Laboratory running on port ${config.PORT}`);
    console.log(`MongoDB database: ${config.MONGODB_DB}`);
    console.log(`Environment: ${config.NODE_ENV}`);
  });
}

async function shutdown(signal) {
  console.log(`[vlab] ${signal} received; shutting down...`);
  if (server) {
    await new Promise(resolve => server.close(resolve));
  }
  await db.close();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch(async (err) => {
  console.error('[vlab] Database/server startup failed:', err);
  await db.close().catch(() => {});
  process.exit(1);
});
