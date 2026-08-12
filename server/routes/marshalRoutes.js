const express = require('express');
const Marshal = require('../models/Marshal');
const Event = require('../models/Event');
const User = require('../models/User');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ALL_ROLES } = require('../config/roles');

const router = express.Router();

// GET /api/marshal/events -- events a marshal can select on the join form
router.get('/events', requireAuth, async (req, res) => {
  const events = await Event.find({ status: 'active' }).select('name date location').sort({ date: 1 }).lean();
  res.json({ events, roles: ALL_ROLES });
});

// GET /api/marshal/mine -- the current marshal's existing submission (to prefill the form)
router.get('/mine', requireAuth, requireRole('marshal'), async (req, res) => {
  const submission = await Marshal.findOne({ userId: req.user.id }).lean();
  res.json({ submission });
});

// POST /api/marshal/submit -- create or overwrite the marshal's submission
router.post('/submit', requireAuth, requireRole('marshal'), async (req, res) => {
  try {
    const { events, roles } = req.body;
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: 'Select at least one event' });
    }
    if (!Array.isArray(roles) || roles.length === 0) {
      return res.status(400).json({ error: 'Select at least one role' });
    }
    const invalidRoles = roles.filter((r) => !ALL_ROLES.includes(r));
    if (invalidRoles.length) {
      return res.status(400).json({ error: `Unknown role(s): ${invalidRoles.join(', ')}` });
    }

    const validEvents = await Event.find({ _id: { $in: events }, status: 'active' }).select('_id').lean();
    const validEventIds = validEvents.map((e) => e._id);
    if (validEventIds.length === 0) {
      return res.status(400).json({ error: 'None of the selected events are currently available' });
    }

    const user = await User.findById(req.user.id).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Upsert on userId ensures a second submission overwrites the first --
    // there is never more than one document per marshal. Uses an explicit
    // $set (rather than a bare replacement object) so fields the form
    // doesn't own -- like the employee-set `rating` -- are never touched
    // by a resubmission.
    const submission = await Marshal.findOneAndUpdate(
      { userId: user._id },
      {
        $set: {
          userId: user._id,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          contactNumber: user.contactNumber,
          events: validEventIds,
          roles,
          submittedAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ submission });
  } catch (err) {
    console.error('Marshal submit error:', err);
    res.status(500).json({ error: 'Could not save your submission. Please try again.' });
  }
});

module.exports = router;
