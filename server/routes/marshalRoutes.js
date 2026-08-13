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

// Pulls a marshal out of every role slot they currently occupy across all
// ACTIVE events (Create List). Used when a marshal submits the form with no
// events selected -- i.e. they're opting out entirely.
async function removeMarshalFromAllActiveEvents(marshalId) {
  const events = await Event.find({ status: 'active' });
  const removedFrom = [];
  for (const ev of events) {
    let changed = false;
    for (const role of ALL_ROLES) {
      const list = (ev.assignments && ev.assignments.get(role)) || [];
      const filtered = list.filter((a) => String(a.marshalId) !== String(marshalId));
      if (filtered.length !== list.length) {
        if (!ev.assignments) ev.assignments = new Map();
        ev.assignments.set(role, filtered);
        changed = true;
        removedFrom.push({ eventId: ev._id, eventName: ev.name, role });
      }
    }
    if (changed) await ev.save();
  }
  return removedFrom;
}

// POST /api/marshal/submit -- create or overwrite the marshal's submission.
// Submitting with no events selected is allowed -- it means "I'm not
// available for anything right now", and also pulls the marshal out of any
// role slot they were already placed in on the Create List tab.
router.post('/submit', requireAuth, requireRole('marshal'), async (req, res) => {
  try {
    const { events, roles } = req.body;
    if (!Array.isArray(events)) {
      return res.status(400).json({ error: 'Invalid events selection' });
    }
    if (!Array.isArray(roles)) {
      return res.status(400).json({ error: 'Invalid roles selection' });
    }

    let validEventIds = [];
    let finalRoles = [];

    if (events.length > 0) {
      const validEvents = await Event.find({ _id: { $in: events }, status: 'active' }).select('_id').lean();
      validEventIds = validEvents.map((e) => e._id);
      if (validEventIds.length === 0) {
        return res.status(400).json({ error: 'None of the selected events are currently available' });
      }
      if (roles.length === 0) {
        return res.status(400).json({ error: 'Select at least one role' });
      }
      const invalidRoles = roles.filter((r) => !ALL_ROLES.includes(r));
      if (invalidRoles.length) {
        return res.status(400).json({ error: `Unknown role(s): ${invalidRoles.join(', ')}` });
      }
      finalRoles = roles;
    }
    // events.length === 0 -> opting out: validEventIds and finalRoles stay empty.

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
          roles: finalRoles,
          submittedAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    let removedFrom = [];
    if (validEventIds.length === 0) {
      removedFrom = await removeMarshalFromAllActiveEvents(submission._id);
    }

    res.json({ submission, removedFrom });
  } catch (err) {
    console.error('Marshal submit error:', err);
    res.status(500).json({ error: 'Could not save your submission. Please try again.' });
  }
});

module.exports = router;
