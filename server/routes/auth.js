const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    { id: user._id.toString(), username: user.username, role: user.role, firstName: user.firstName, lastName: user.lastName },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// POST /api/auth/register  -- public sign-up, always creates a "marshal" account
router.post('/register', async (req, res) => {
  try {
    const { username, email, gender, contactNumber, firstName, lastName, password, confirmPassword } = req.body;

    const missing = ['username', 'email', 'gender', 'contactNumber', 'firstName', 'lastName', 'password', 'confirmPassword'].filter(
      (field) => !req.body[field] || String(req.body[field]).trim() === ''
    );
    if (missing.length) {
      return res.status(400).json({ error: `Missing required field(s): ${missing.join(', ')}` });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Password and Confirm Password do not match' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await User.findOne({ $or: [{ username: username.trim() }, { email: email.trim().toLowerCase() }] });
    if (existing) {
      return res.status(409).json({ error: 'Username or email is already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      username: username.trim(),
      email: email.trim().toLowerCase(),
      gender,
      contactNumber: contactNumber.trim(),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      passwordHash,
      role: 'marshal',
    });

    const token = signToken(user);
    res.status(201).json({ token, user: { id: user._id, username: user.username, role: user.role, firstName: user.firstName, lastName: user.lastName } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// POST /api/auth/login  -- accepts username OR email in the "username" field
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username/email and password are required' });
    }

    const identifier = String(username).trim();
    const user = await User.findOne({
      $or: [{ username: identifier }, { email: identifier.toLowerCase() }],
    });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signToken(user);
    res.json({ token, user: { id: user._id, username: user.username, role: user.role, firstName: user.firstName, lastName: user.lastName } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

module.exports = router;
