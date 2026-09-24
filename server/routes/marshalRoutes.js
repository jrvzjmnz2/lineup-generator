const express = require('express');
const Marshal = require('../models/Marshal');
const Event = require('../models/Event');
const User = require('../models/User');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ALL_ROLES } = require('../config/roles');
const { EVENT_TYPES, rolesFor, isEventType } = require('../config/eventTypes');

// The label an untyped legacy event is grouped under on the sign-up form.
const UNTYPED_GROUP = 'Other';

const router = express.Router();

// GET /api/marshal/events -- events a marshal can select on the join form
//
// Returns the event type on every event plus the role list for each type, so
// the form can group events by type and offer only the roles that type
// actually has. `roles` (the flat master list) is still sent for the Other
// group -- events saved before types existed can be lined up in anything.
router.get('/events', requireAuth, async (req, res) => {
  const events = await Event.find({ status: 'active' })
    .select('name date endDate location eventType')
    .sort({ date: 1 })
    .lean();

  const groups = EVENT_TYPES.map((t) => ({ name: t.name, roles: rolesFor(t.name) }));
  if (events.some((e) => !e.eventType)) {
    groups.push({ name: UNTYPED_GROUP, roles: [...ALL_ROLES], untyped: true });
  }

  res.json({
    events: events.map((e) => ({ ...e, eventType: e.eventType || null })),
    typeGroups: groups,
    untypedGroup: UNTYPED_GROUP,
    roles: ALL_ROLES,
  });
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
    const { events, roles, rolesByType } = req.body;
    if (!Array.isArray(events)) {
      return res.status(400).json({ error: 'Invalid events selection' });
    }
    // `rolesByType` is what the current form sends. A flat `roles` array is
    // still accepted so a page cached from before this change keeps working;
    // it is treated as applying to every type the marshal picked an event in.
    if (rolesByType !== undefined && (typeof rolesByType !== 'object' || rolesByType === null || Array.isArray(rolesByType))) {
      return res.status(400).json({ error: 'Invalid roles selection' });
    }
    if (rolesByType === undefined && !Array.isArray(roles)) {
      return res.status(400).json({ error: 'Invalid roles selection' });
    }

    let validEventIds = [];
    const finalRolesByType = {};
    let finalRoles = [];

    if (events.length > 0) {
      const validEvents = await Event.find({ _id: { $in: events }, status: 'active' })
        .select('_id eventType')
        .lean();
      validEventIds = validEvents.map((e) => e._id);
      if (validEventIds.length === 0) {
        return res.status(400).json({ error: 'None of the selected events are currently available' });
      }

      // Which types the marshal actually signed up for. Only these need roles,
      // and roles sent for any other type are dropped -- picking Timing roles
      // and then unticking every Timing event should not leave them stored.
      const pickedTypes = new Set(validEvents.map((e) => e.eventType || UNTYPED_GROUP));

      for (const type of pickedTypes) {
        const allowed = isEventType(type) ? rolesFor(type) : ALL_ROLES;
        const requested = rolesByType
          ? (Array.isArray(rolesByType[type]) ? rolesByType[type] : [])
          : roles; // legacy flat payload: the same list against every picked type

        const invalid = requested.filter((r) => !allowed.includes(r));
        if (invalid.length) {
          return res.status(400).json({
            error: `${invalid.join(', ')} ${invalid.length === 1 ? 'is not a role' : 'are not roles'} on ${type} events. Available: ${allowed.join(', ')}`,
          });
        }

        // Every type you signed up for needs at least one role, otherwise the
        // submission says nothing about what you would do at those events.
        const chosen = [...new Set(requested)];
        if (chosen.length === 0) {
          return res.status(400).json({
            error: `Select at least one role for the ${type} event${pickedTypes.size > 1 ? 's' : ''} you picked.`,
          });
        }
        finalRolesByType[type] = chosen;
      }

      finalRoles = [...new Set(Object.values(finalRolesByType).flat())];
    }
    // events.length === 0 -> opting out: everything stays empty.

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
          rolesByType: finalRolesByType,
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
