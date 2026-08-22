// Server configuration — non-secret values only.
'use strict';

const path = require('path');

const APP_ROOT = path.join(__dirname, '..');
const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';

module.exports = {
  APP_NAME: 'Virtual Laboratory',
  APP_VERSION: '2.1.0',
  PORT: parseInt(process.env.PORT || '8080', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  IS_PRODUCTION: isProduction,

  // MongoDB Atlas is the production source of truth. The JSON file is retained
  // only as a one-time migration source for existing local data.
  MONGODB_URI: process.env.MONGODB_URI || '',
  MONGODB_DB: process.env.MONGODB_DB || 'virtual_laboratory',
  DATA_FILE: process.env.DATA_FILE || path.join(APP_ROOT, 'data', 'vlab.json'),
  SEED_FILE: process.env.SEED_FILE || path.join(APP_ROOT, 'data', 'seed', 'practicals.json'),
  DATA_DIR: path.join(APP_ROOT, 'data'),

  FRONTEND_DIR: path.join(APP_ROOT, 'frontend'),

  SESSION_NAME: 'vlab_session',
  SESSION_LIFETIME_MS: 8 * 60 * 60 * 1000,

  THEORY_URL: 'https://13-om.github.io/Parse-Lab-/',
  MAX_SOURCE_CODE: 200000,
};
