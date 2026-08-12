// Creates (or updates) the first admin/employee account, since the public
// registration form only ever creates "marshal" accounts.
//
// Usage: npm run seed:admin
// Reads SEED_ADMIN_USERNAME / SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD from .env
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

// Must run before mongoose tries to resolve the mongodb+srv:// SRV record.
require('../config/dns').applyDnsServers();

async function main() {
  const username = process.env.SEED_ADMIN_USERNAME || 'admin';
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@example.com').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!';

  await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB_NAME || 'lineup' });
  console.log(`Connected to MongoDB database "${process.env.MONGO_DB_NAME || 'lineup'}"`);

  const passwordHash = await bcrypt.hash(password, 10);
  const admin = await User.findOneAndUpdate(
    { username },
    {
      username,
      email,
      gender: 'N/A',
      contactNumber: 'N/A',
      firstName: 'Admin',
      lastName: 'User',
      passwordHash,
      role: 'admin',
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log(`Admin account ready: username="${admin.username}" email="${admin.email}"`);
  console.log('You can now log in with this username and the SEED_ADMIN_PASSWORD from your .env.');
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed admin failed:', err.message);
  process.exit(1);
});
