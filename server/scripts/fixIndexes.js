// One-time repair for a class of bug the Google Sign-In migration (2026-08-17)
// can trigger: `username` and `googleId` on the User model were changed to
// `unique: true, sparse: true`, but MongoDB does NOT retroactively rebuild an
// already-existing index just because the Mongoose schema changed -- if the
// index was originally created back when `username` was `required + unique`
// (non-sparse), it stays non-sparse in the database. A non-sparse unique
// index treats a MISSING field as `null`, so the moment a second document
// with no `username` is created (e.g. a brand new Google marshal account),
// MongoDB throws a duplicate-key (E11000) error -- which is exactly the
// generic "Google sign-in failed" error this was reported as.
//
// Model.syncIndexes() drops any index not matching the current schema and
// (re)builds the correct ones. It only touches indexes, never document data.
//
// Usage: node server/scripts/fixIndexes.js
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Marshal = require('../models/Marshal');
const Exemption = require('../models/Exemption');

require('../config/dns').applyDnsServers();

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB_NAME || 'lineup' });
  console.log(`Connected to MongoDB database "${process.env.MONGO_DB_NAME || 'lineup'}"`);

  for (const Model of [User, Marshal, Exemption]) {
    const before = await Model.collection.indexes();
    console.log(`\n${Model.modelName} (collection "${Model.collection.collectionName}") indexes before:`);
    before.forEach((ix) => console.log(`  ${ix.name}: ${JSON.stringify(ix.key)}${ix.unique ? ' unique' : ''}${ix.sparse ? ' sparse' : ''}`));

    const result = await Model.syncIndexes();
    console.log(`Sync result (dropped + recreated as needed): ${JSON.stringify(result)}`);

    const after = await Model.collection.indexes();
    console.log(`${Model.modelName} indexes after:`);
    after.forEach((ix) => console.log(`  ${ix.name}: ${JSON.stringify(ix.key)}${ix.unique ? ' unique' : ''}${ix.sparse ? ' sparse' : ''}`));
  }

  console.log('\nDone. Indexes now match the current schema -- try Google Sign-In again.');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fix indexes failed:', err.message);
  process.exit(1);
});
