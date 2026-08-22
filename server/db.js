// ============================================================================
// MongoDB Atlas data store.
// MongoDB Atlas is the single shared source of truth for users, practicals,
// progress and activities. The old JSON file is used only for migration.
// ============================================================================
'use strict';

const { MongoClient } = require('mongodb');
const crypto = require('crypto');
const fs = require('fs');

let client = null;
let database = null;
let collections = null;

function newId() {
  return crypto.randomBytes(12).toString('hex');
}

function getCollection(name) {
  if (!collections || !collections[name]) {
    throw new Error('Database is not initialized.');
  }
  return collections[name];
}

function buildFilter(filter = {}) {
  const out = {};
  for (const [key, value] of Object.entries(filter)) {
    if (key === '$or') {
      out.$or = Array.isArray(value) ? value.map(buildFilter) : [];
    } else if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      '$regex' in value
    ) {
      out[key] = { $regex: String(value.$regex), $options: 'i' };
    } else {
      out[key] = value;
    }
  }
  return out;
}

async function load(dataFile) {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || 'virtual_laboratory';

  if (!uri) {
    throw new Error(
      'MONGODB_URI is not configured. Add your MongoDB Atlas connection string to Render Environment Variables.'
    );
  }

  client = new MongoClient(uri, {
    maxPoolSize: 10,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000,
    retryWrites: true,
  });

  await client.connect();
  database = client.db(dbName);
  await database.command({ ping: 1 });

  collections = {
    users: database.collection('users'),
    practicals: database.collection('practicals'),
    progress: database.collection('progress'),
    activities: database.collection('activities'),
    enrollments: database.collection('enrollments'),
    registrationRequests: database.collection('registrationRequests'),
  };

  await Promise.all([
    collections.users.createIndex({ username: 1 }, { unique: true, name: 'uniq_username' }),
    collections.users.createIndex({ email: 1 }, { unique: true, name: 'uniq_email' }),
    collections.progress.createIndex(
      { userId: 1, practicalId: 1 },
      { unique: true, name: 'uniq_user_practical_progress' }
    ),
    collections.activities.createIndex({ createdAt: -1 }, { name: 'activities_createdAt' }),
    collections.activities.createIndex({ userId: 1, createdAt: -1 }, { name: 'activities_user_createdAt' }),
    collections.enrollments.createIndex({ enrollmentNo: 1 }, { unique: true, name: 'uniq_enrollment_number' }),
    collections.enrollments.createIndex({ batch: 1 }, { name: 'enrollments_batch' }),
    collections.registrationRequests.createIndex({ createdAt: -1 }, { name: 'registrationRequests_createdAt' }),
    collections.registrationRequests.createIndex({ status: 1, createdAt: -1 }, { name: 'registrationRequests_status_createdAt' }),
    collections.practicals.createIndex(
      { practicalNumber: 1 },
      { unique: true, name: 'uniq_practical_number' }
    ),
  ]);

  await migrateJsonIfNeeded(dataFile);

  console.log(`MongoDB Atlas connected successfully: ${dbName}`);
  return true;
}

async function migrateJsonIfNeeded(dataFile) {
  if (!dataFile || !fs.existsSync(dataFile)) return;

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  } catch (err) {
    console.warn('JSON migration skipped: invalid JSON file:', err.message);
    return;
  }

  // Migrate each collection independently. This is safer than requiring the
  // entire Atlas database to be empty; an already-created users collection
  // must not prevent practicals or activities from being migrated.
  for (const name of Object.keys(collections)) {
    const source = Array.isArray(parsed[name]) ? parsed[name] : [];
    if (!source.length) continue;

    const target = collections[name];
    const existingCount = await target.countDocuments();
    if (existingCount > 0) continue;

    try {
      await target.insertMany(source, { ordered: false });
      console.log(`Migrated ${source.length} ${name} document(s) from data/vlab.json.`);
    } catch (err) {
      if (err.code !== 11000) {
        console.warn(`Migration of ${name} partially/fully failed:`, err.message);
      }
    }
  }
}

async function findOne(coll, filter) {
  return (await getCollection(coll).findOne(buildFilter(filter))) || null;
}

async function find(coll, filter = {}, opts = {}) {
  const collection = getCollection(coll);
  let cursor = collection.find(buildFilter(filter));
  if (opts.sort) cursor = cursor.sort(opts.sort);
  if (opts.limit) cursor = cursor.limit(opts.limit);
  return cursor.toArray();
}

async function insert(coll, doc) {
  const document = { ...doc };
  if (!document._id) document._id = newId();
  await getCollection(coll).insertOne(document);
  return document._id;
}

async function update(coll, filter, set, opts = {}) {
  const collection = getCollection(coll);
  const result = await collection.updateOne(
    buildFilter(filter),
    { $set: { ...set } },
    opts.upsert ? { upsert: true } : undefined
  );

  if (result.matchedCount || result.modifiedCount || result.upsertedCount) return 1;
  return 0;
}

async function deleteOne(coll, filter) {
  const result = await getCollection(coll).deleteOne(buildFilter(filter));
  return result.deletedCount;
}

async function deleteMany(coll, filter) {
  const result = await getCollection(coll).deleteMany(buildFilter(filter));
  return result.deletedCount;
}

async function count(coll, filter = {}) {
  return getCollection(coll).countDocuments(buildFilter(filter));
}

async function close() {
  if (client) {
    await client.close();
  }
  client = null;
  database = null;
  collections = null;
}

module.exports = {
  load,
  findOne,
  find,
  insert,
  update,
  deleteOne,
  deleteMany,
  count,
  newId,
  close,
};
