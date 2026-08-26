const mongoose = require('mongoose');

// Stored in DB "lineup", collection "login"
const userSchema = new mongoose.Schema(
  {
    // Local (admin/employee) accounts have a username + passwordHash.
    // Google-authenticated marshal accounts have a googleId instead, and
    // fill in firstName/lastName/contactNumber right after their first
    // sign-in (see the "profile complete" flow in routes/auth.js).
    username: { type: String, unique: true, sparse: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    gender: { type: String, trim: true },
    contactNumber: { type: String, trim: true },
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    passwordHash: { type: String },
    googleId: { type: String, unique: true, sparse: true },
    authProvider: { type: String, enum: ['local', 'google'], default: 'local' },
    // Local sign-up (legacy) always created a "marshal" account, and every
    // Google sign-up still only ever creates a "marshal" account.
    // "admin" accounts (the employees who build the lineup) are provisioned
    // via the seed script (npm run seed:admin) or promoted directly in the DB.
    role: { type: String, enum: ['marshal', 'admin'], default: 'marshal' },
  },
  { timestamps: true, collection: 'login' }
);

module.exports = mongoose.model('User', userSchema);
