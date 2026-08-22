// ============================================================================
// Database seeder / initializer.
//
// Creates:
//   - default admin account   (admin / Admin@123, must change on first login)
//   - a demo student account  (student / Student@123)
//   - the lab manual practicals from data/seed/practicals.json
//     (upsert by practicalNumber; --force overwrites existing content)
//
// Passwords are hashed with bcrypt — NEVER stored in plain text.
// Usage:  node server/seed.js [--force]
// ============================================================================
'use strict';

const fs = require('fs');
const config = require('./config');
const db = require('./db');
const { now, normalizeSimulation } = require('./helpers');
const { hashPassword } = require('./auth');

const force = process.argv.includes('--force');

(async () => {
console.log('Virtual Laboratory seeder');
console.log('-------------------------');

await db.load(config.DATA_FILE);

// --- 1. default admin --------------------------------------------------------
const admin = await db.findOne('users', { username: 'admin' });
if (admin && !force) {
  console.log('OK  admin account exists (username: admin). Use --force to reset it.');
} else {
  const hash = hashPassword('Admin@123');
  if (admin) {
    await db.update('users', { _id: admin._id }, {
      passwordHash: hash,
      mustChangePassword: true,
      updatedAt: now(),
    });
    console.log('OK  admin password reset (admin / Admin@123) - change required on next login');
  } else {
    await db.insert('users', {
      name: 'Administrator',
      email: 'admin@virtual-lab.local',
      username: 'admin',
      passwordHash: hash,
      role: 'admin',
      enrollment: '',
      mustChangePassword: true,
      createdAt: now(),
      updatedAt: now(),
    });
    console.log('OK  admin account created (admin / Admin@123) - change required on next login');
  }
}

// --- 2. demo student ----------------------------------------------------------
const student = await db.findOne('users', { username: 'student' });
if (!student) {
  await db.insert('users', {
    name: 'Demo Student',
    email: 'student@virtual-lab.local',
    username: 'student',
    passwordHash: hashPassword('Student@123'),
    role: 'student',
    enrollment: 'DEMO-2026',
    mustChangePassword: false,
    createdAt: now(),
    updatedAt: now(),
  });
  console.log('OK  demo student created (student / Student@123)');
} else {
  console.log('OK  demo student exists');
}

// --- 3. practicals from the lab manual ----------------------------------------
if (!fs.existsSync(config.SEED_FILE)) {
  console.error(`WARN seed file not found: ${config.SEED_FILE}`);
  console.error('     Run: node tools/php2json.js backend/seed/*.php (or restore data/seed/practicals.json)');
} else {
  const seed = JSON.parse(fs.readFileSync(config.SEED_FILE, 'utf8'));
  let inserted = 0, updated = 0, skipped = 0;
  for (let i = 0; i < (seed.practicals || []).length; i++) {
    const p = seed.practicals[i];
    const existing = await db.findOne('practicals', { practicalNumber: parseInt(p.practicalNumber, 10) });

    if (existing && !force) {
      skipped++;
      console.log(`OK  practical ${p.practicalNumber} exists - skipped (use --force to overwrite)`);
      continue;
    }

    const doc = {
      practicalNumber: parseInt(p.practicalNumber, 10),
      title: p.title,
      shortDescription: p.shortDescription || '',
      aim: p.aim || '',
      objective: p.objective || '',
      theory: p.theory || '',
      algorithm: p.algorithm || '',
      procedure: p.procedure || '',
      sourceCode: p.sourceCode || '',
      language: p.language || 'Plain text',
      expectedOutput: p.expectedOutput || '',
      simulationData: normalizeSimulation(p.simulationData, p.sourceCode),
      order: p.order || i + 1,
    };

    if (existing) {
      doc.version = (existing.version || 1) + 1;
      doc.viewCount = existing.viewCount || 0;
      doc.history = existing.history || [];
      doc.updatedAt = now();
      doc.updatedBy = 'seeder';
      await db.update('practicals', { _id: existing._id }, doc);
      updated++;
      console.log(`OK  practical ${p.practicalNumber} overwritten with seed content (${p.title.slice(0, 50)})`);
    } else {
      doc.version = 1;
      doc.viewCount = 0;
      doc.history = [];
      doc.createdAt = now();
      doc.updatedAt = now();
      doc.updatedBy = 'seeder';
      await db.insert('practicals', doc);
      inserted++;
      console.log(`OK  practical ${p.practicalNumber} inserted (${p.title.slice(0, 50)})`);
    }
  }
  console.log(`\nDone. ${inserted} inserted, ${updated} updated, ${skipped} skipped.`);
}

console.log(`Data file: ${config.DATA_FILE}`);
console.log('Collections: users, practicals, progress, activities.');
await db.close();

})().catch(err => { console.error('Seeder failed:', err); process.exit(1); });
