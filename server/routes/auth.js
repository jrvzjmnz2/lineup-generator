const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

function signToken(user) {
  return jwt.sign(
    { id: user._id.toString(), username: user.username, role: user.role, firstName: user.firstName, lastName: user.lastName },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// Shape returned to the frontend for any authenticated user. profileComplete
// is computed on the fly (never stored) so it can never drift out of sync
// with the underlying fields.
function publicUser(user) {
  return {
    id: user._id,
    username: user.username || null,
    email: user.email,
    role: user.role,
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    contactNumber: user.contactNumber || '',
    authProvider: user.authProvider,
    profileComplete: Boolean(user.firstName && user.lastName && user.contactNumber),
  };
}

// GET /api/auth/config -- public, tells the frontend which Google Client ID to use
router.get('/config', (req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID || null });
});

// POST /api/auth/google -- verify a Google ID token, then find-or-create the
// matching marshal account (linking by email if one already exists) and
// issue our own JWT for it.
router.post('/google', async (req, res) => {
  try {
    if (!googleClient) {
      return res.status(500).json({ error: 'Google sign-in is not configured on this server yet.' });
    }
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ error: 'Missing Google credential' });
    }

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
      payload = ticket.getPayload();
    } catch (err) {
      return res.status(401).json({ error: 'Could not verify Google sign-in. Please try again.' });
    }

    if (!payload || payload.email_verified === false) {
      return res.status(401).json({ error: 'Your Google account email is not verified.' });
    }

    const email = String(payload.email).toLowerCase();
    let user = await User.findOne({ googleId: payload.sub });

    if (!user) {
      // Not linked yet -- fall back to matching by email so a pre-existing
      // account (e.g. an old local marshal account) picks up right where it
      // left off instead of ending up duplicated.
      user = await User.findOne({ email });
      if (user) {
        user.googleId = payload.sub;
        if (!user.authProvider || user.authProvider === 'local') {
          // Only flip provider if this account had no password-based login
          // to begin with; admins keep authProvider local either way since
          // they never reach this route in practice.
          if (!user.passwordHash) user.authProvider = 'google';
        }
        if (!user.firstName && payload.given_name) user.firstName = payload.given_name;
        if (!user.lastName && payload.family_name) user.lastName = payload.family_name;
        await user.save();
      }
    }

    if (!user) {
      user = await User.create({
        email,
        googleId: payload.sub,
        authProvider: 'google',
        role: 'marshal',
        firstName: payload.given_name || '',
        lastName: payload.family_name || '',
      });
    }

    const token = signToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error('Google sign-in error:', err);
    res.status(500).json({ error: 'Google sign-in failed. Please try again.' });
  }
});

// POST /api/auth/login -- local accounts only (admin/employee). Username or
// email in the "username" field. Google-only accounts have no passwordHash
// and are cleanly rejected here rather than reaching bcrypt with nothing to compare.
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
    if (!user || !user.passwordHash) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signToken(user);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// GET /api/auth/me -- fresh copy of the current user, used by pages to
// re-check profileComplete rather than trusting stale localStorage state.
router.get('/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: publicUser(user) });
});

// PUT /api/auth/profile -- marshal fills in name + contact number right
// after their first Google sign-in.
router.put('/profile', requireAuth, async (req, res) => {
  try {
    const { firstName, lastName, contactNumber } = req.body;
    const missing = ['firstName', 'lastName', 'contactNumber'].filter(
      (f) => !req.body[f] || String(req.body[f]).trim() === ''
    );
    if (missing.length) {
      return res.status(400).json({ error: `Missing required field(s): ${missing.join(', ')}` });
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        $set: {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          contactNumber: contactNumber.trim(),
        },
      },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Could not save your profile. Please try again.' });
  }
});

module.exports = router;
