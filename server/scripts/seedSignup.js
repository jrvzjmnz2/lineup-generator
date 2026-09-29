// Creates (or updates) the shared "signup" login. Employees use it to open
// the employee sign-up form (signup.html), pick their name and choose the
// exclusive events they want to join. It cannot reach the admin pages.
//
// Usage: npm run seed:signup
// Reads SEED_SIGNUP_USERNAME (default "signup") and SEED_SIGNUP_PASSWORD
// (required -- there is no default) from .env or the environment.
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

// Must run before mongoose tries to resolve the mongodb+srv:// SRV record.
require('../config/dns').applyDnsServers();

async function main() {
  const username = process.env.SEED_SIGNUP_USERNAME || 'signup';
  const password = process.env.SEED_SIGNUP_PASSWORD;
  if (!password) throw new Error('Set SEED_SIGNUP_PASSWORD before running this script.');

  await mongoose.connect(process.env.MONGO_URI, { dbName: process.env.MONGO_DB_NAME || 'lineup' });
  console.log(`Connected to MongoDB database "${process.env.MONGO_DB_NAME || 'lineup'}"`);

  const passwordHash = await bcrypt.hash(password, 10);
  const account = await User.findOneAndUpdate(
    { username },
    {
      username,
      // `email` is required and unique on every login; this account has no
      // mailbox, so it gets a placeholder that can never collide with a real one.
      email: `${username}@signup.lineup.local`,
      firstName: 'Employee',
      lastName: 'Sign-up',
      passwordHash,
      authProvider: 'local',
      role: 'signup',
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  console.log(`Sign-up account ready: username="${account.username}"`);
  await mongoose.disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed signup failed:', err.message);
  process.exit(1);
});
