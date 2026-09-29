// One-time fix: puts every existing first/last name on user profiles and
// marshal submissions into Title Case (see utils/names.js). New names are
// already formatted when a profile is saved, so this only cleans up old data.
//
// Usage:
//   npm run format:names            -- dry run, prints what would change
//   npm run format:names -- --apply -- writes the changes
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Marshal = require('../models/Marshal');
const { properName } = require('../utils/names');

// Must run before mongoose tries to resolve the mongodb+srv:// SRV record.
require('../config/dns').applyDnsServers();

const APPLY = process.argv.includes('--apply');

async function fixCollection(Model, label) {
  const docs = await Model.find({}, 'firstName lastName').lean();
  const ops = [];
  for (const d of docs) {
    const firstName = properName(d.firstName);
    const lastName = properName(d.lastName);
    if (firstName === (d.firstName || '') && lastName === (d.lastName || '')) continue;
    console.log(`  ${label}: "${d.firstName || ''} ${d.lastName || ''}" -> "${firstName} ${lastName}"`);
    ops.push({ updateOne: { filter: { _id: d._id }, update: { $set: { firstName, lastName } } } });
  }
  if (APPLY && ops.length) await Model.bulkWrite(ops);
  return { checked: docs.length, changed: ops.length };
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB_NAME || 'lineup' });
  console.log(`Connected to MongoDB database "${process.env.MONGO_DB_NAME || 'lineup'}"`);
  console.log(APPLY ? 'APPLYING changes' : 'DRY RUN (add --apply to write)');

  const users = await fixCollection(User, 'user');
  const marshals = await fixCollection(Marshal, 'marshal');

  console.log(`Users: ${users.changed} of ${users.checked} ${APPLY ? 'updated' : 'would change'}`);
  console.log(`Marshals: ${marshals.changed} of ${marshals.checked} ${APPLY ? 'updated' : 'would change'}`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Format names failed:', err.message);
  process.exit(1);
});
