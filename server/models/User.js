const mongoose = require('mongoose');

// Stored in DB "lineup", collection "login"
const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    gender: { type: String, required: true, trim: true },
    contactNumber: { type: String, required: true, trim: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    // Registration (public sign-up) always creates a "marshal" account.
    // "admin" accounts (the employees who build the lineup) are provisioned
    // via the seed script (npm run seed:admin) or promoted directly in the DB.
    role: { type: String, enum: ['marshal', 'admin'], default: 'marshal' },
  },
  { timestamps: true, collection: 'login' }
);

module.exports = mongoose.model('User', userSchema);
