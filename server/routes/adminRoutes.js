const express = require('express');
const Event = require('../models/Event');
const Marshal = require('../models/Marshal');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ALL_ROLES, ROLES_WITH_EVENT_CAPACITY } = require('../config/roles');

const router = express.Router();

// All routes here require an authenticated admin (employee) user.
router.use(requireAuth, requireRole('admin'));

// ---------- helpers ----------

// Find where (if anywhere) a marshal is currently assigned across all ACTIVE events.
async function findExistingAssignment(marshalId, excludeEventId = null) {
  const query = { status: 'active' };
  if (excludeEventId) query._id = { $ne: excludeEventId };
  const events = await Event.find(query).lean();
  for (const ev of events) {
    const assignments = ev.assignments || {};
    for (const role of Object.keys(assignments)) {
      const list = assignments[role] || [];
      if (list.some((a) => String(a.marshalId) === String(marshalId))) {
        return { eventId: ev._id, eventName: ev.name, role };
      }
    }
  }
  return null;
}

function buildDefaultCapacities(roleCounts) {
  const capacities = {};
  for (const role of ROLES_WITH_EVENT_CAPACITY) {
    capacities[role] = Math.max(0, parseInt(roleCounts && roleCounts[role], 10) || 0);
  }
  return capacities;
}

// Build a marshalId -> [{ eventId, eventName, date, location, role, note, status }] map
// by scanning every event's assignments, regardless of active/completed status.
async function buildAttendanceMap() {
  const events = await Event.find().sort({ date: -1 }).lean();
  const map = {};
  for (const ev of events) {
    const assignments = ev.assignments || {};
    for (const role of Object.keys(assignments)) {
      for (const a of assignments[role] || []) {
        const key = String(a.marshalId);
        if (!map[key]) map[key] = [];
        map[key].push({
          eventId: ev._id,
          eventName: ev.name,
          date: ev.date,
          location: ev.location,
          role,
          note: a.note || '',
          status: ev.status,
        });
      }
    }
  }
  return map;
}

// ---------- events ----------

// POST /api/admin/events -- "Add Event" from the Generate Event tab
router.post('/events', async (req, res) => {
  try {
    const {
      name, date, location, teamLeader, offsiteSupport, categories, gunstart,
      callTime, maxRunners, meals, roleCounts,
    } = req.body;

    const missing = ['name', 'date', 'location'].filter((f) => !req.body[f] || String(req.body[f]).trim() === '');
    if (missing.length) {
      return res.status(400).json({ error: `Missing required field(s): ${missing.join(', ')}` });
    }

    const event = await Event.create({
      name: name.trim(),
      date,
      location: location.trim(),
      teamLeader: teamLeader || '',
      offsiteSupport: offsiteSupport || '',
      categories: categories || '',
      gunstart: gunstart || '',
      callTime: callTime || '',
      maxRunners: maxRunners || '',
      meals: meals || '',
      roleCapacities: buildDefaultCapacities(roleCounts),
      assignments: {},
      status: 'active',
    });

    res.status(201).json({ event: event.toCard() });
  } catch (err) {
    console.error('Create event error:', err);
    res.status(500).json({ error: 'Could not create event. Please try again.' });
  }
});

// GET /api/admin/events?status=active|completed
router.get('/events', async (req, res) => {
  const status = req.query.status === 'completed' ? 'completed' : 'active';
  const events = await Event.find({ status }).sort({ date: 1, createdAt: 1 });
  res.json({ events: events.map((e) => e.toCard()) });
});

// GET /api/admin/marshals -- all marshal submissions, used to build the pool on each card
router.get('/marshals', async (req, res) => {
  const marshals = await Marshal.find().lean();
  res.json({ marshals });
});

// GET /api/admin/marshal-list -- every marshal, their rating, and their full event attendance history
router.get('/marshal-list', async (req, res) => {
  try {
    const [marshals, attendanceMap] = await Promise.all([Marshal.find().collation({ locale: 'en', strength: 2 }).sort({ firstName: 1, lastName: 1 }).lean(), buildAttendanceMap()]);
    const enriched = marshals.map((m) => ({
      ...m,
      eventsAttended: attendanceMap[String(m._id)] || [],
    }));
    res.json({ marshals: enriched });
  } catch (err) {
    console.error('Marshal list error:', err);
    res.status(500).json({ error: 'Could not load marshal list.' });
  }
});

// PUT /api/admin/marshals/:id/rating -- set (or clear) a marshal's 1-10 performance rating
router.put('/marshals/:id/rating', async (req, res) => {
  try {
    const { rating } = req.body;
    let value = null;
    if (rating !== null && rating !== undefined && rating !== '') {
      value = parseInt(rating, 10);
      if (!Number.isInteger(value) || value < 1 || value > 10) {
        return res.status(400).json({ error: 'Rating must be a whole number from 1 to 10' });
      }
    }
    const marshal = await Marshal.findByIdAndUpdate(req.params.id, { $set: { rating: value } }, { new: true }).lean();
    if (!marshal) return res.status(404).json({ error: 'Marshal not found' });
    res.json({ marshal });
  } catch (err) {
    console.error('Rating update error:', err);
    res.status(500).json({ error: 'Could not update rating.' });
  }
});

// PUT /api/admin/events/:id -- edit event details / logistics (always editable)
router.put('/events/:id', async (req, res) => {
  try {
    const editableFields = [
      'name', 'date', 'location', 'teamLeader', 'offsiteSupport', 'categories',
      'gunstart', 'callTime', 'maxRunners', 'meals', 'transpo', 'driver', 'driverNumber', 'rate',
    ];
    const update = {};
    for (const field of editableFields) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        update[field] = req.body[field];
      }
    }
    const event = await Event.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json({ event: event.toCard() });
  } catch (err) {
    console.error('Update event error:', err);
    res.status(500).json({ error: 'Could not update event.' });
  }
});

// POST /api/admin/events/:id/capacity -- adjust a role's slot count on an existing card
router.post('/events/:id/capacity', async (req, res) => {
  try {
    const { role, capacity } = req.body;
    if (!ALL_ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role' });
    const cap = Math.max(0, parseInt(capacity, 10) || 0);

    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const currentFilled = ((event.assignments && event.assignments.get(role)) || []).length;
    if (cap < currentFilled) {
      return res.status(400).json({ error: `Cannot set capacity below the ${currentFilled} marshal(s) already assigned to ${role}` });
    }

    if (!event.roleCapacities) event.roleCapacities = new Map();
    event.roleCapacities.set(role, cap);
    await event.save();
    res.json({ event: event.toCard() });
  } catch (err) {
    console.error('Capacity update error:', err);
    res.status(500).json({ error: 'Could not update capacity.' });
  }
});

// POST /api/admin/events/:id/assign -- drag a marshal into a role slot
router.post('/events/:id/assign', async (req, res) => {
  try {
    const { role, marshalId } = req.body;
    if (!ALL_ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role' });

    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.status !== 'active') return res.status(400).json({ error: 'Event is not active' });

    const marshal = await Marshal.findById(marshalId).lean();
    if (!marshal) return res.status(404).json({ error: 'Marshal not found' });

    // Global uniqueness: a marshal can only hold one role, in one event, at a time.
    const existing = await findExistingAssignment(marshalId);
    if (existing) {
      return res.status(409).json({ error: `${marshal.firstName} ${marshal.lastName} is already assigned to ${existing.role} on "${existing.eventName}"` });
    }

    const capacity = (event.roleCapacities && event.roleCapacities.get(role)) || 0;
    const currentList = (event.assignments && event.assignments.get(role)) || [];
    if (currentList.length >= capacity) {
      return res.status(400).json({ error: `${role} is already full (${capacity} slot${capacity === 1 ? '' : 's'})` });
    }

    const note = (req.body.note || '').trim();
    const name = `${marshal.firstName} ${marshal.lastName}`.trim().toUpperCase();

    if (!event.assignments) event.assignments = new Map();
    const updatedList = [...currentList, { marshalId: marshal._id, name, note }];
    event.assignments.set(role, updatedList);
    await event.save();

    res.json({ event: event.toCard() });
  } catch (err) {
    console.error('Assign error:', err);
    res.status(500).json({ error: 'Could not assign marshal.' });
  }
});

// POST /api/admin/events/:id/note -- edit the note shown next to an assigned marshal (e.g. "5KM")
router.post('/events/:id/note', async (req, res) => {
  try {
    const { role, marshalId, note } = req.body;
    if (!ALL_ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role' });

    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const currentList = (event.assignments && event.assignments.get(role)) || [];
    const updatedList = currentList.map((a) =>
      String(a.marshalId) === String(marshalId) ? { ...a.toObject ? a.toObject() : a, note: (note || '').trim() } : a
    );
    if (!event.assignments) event.assignments = new Map();
    event.assignments.set(role, updatedList);
    await event.save();

    res.json({ event: event.toCard() });
  } catch (err) {
    console.error('Note update error:', err);
    res.status(500).json({ error: 'Could not update note.' });
  }
});

// POST /api/admin/events/:id/unassign -- remove a marshal from a role slot
router.post('/events/:id/unassign', async (req, res) => {
  try {
    const { role, marshalId } = req.body;
    if (!ALL_ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role' });

    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const currentList = (event.assignments && event.assignments.get(role)) || [];
    const updatedList = currentList.filter((a) => String(a.marshalId) !== String(marshalId));
    if (!event.assignments) event.assignments = new Map();
    event.assignments.set(role, updatedList);
    await event.save();

    res.json({ event: event.toCard() });
  } catch (err) {
    console.error('Unassign error:', err);
    res.status(500).json({ error: 'Could not unassign marshal.' });
  }
});

// POST /api/admin/events/:id/complete -- moves the event from Create List to All Events
router.post('/events/:id/complete', async (req, res) => {
  try {
    const event = await Event.findByIdAndUpdate(
      req.params.id,
      { status: 'completed', completedAt: new Date() },
      { new: true }
    );
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json({ event: event.toCard() });
  } catch (err) {
    console.error('Complete event error:', err);
    res.status(500).json({ error: 'Could not complete event.' });
  }
});

// DELETE /api/admin/events/:id -- permanently remove an event (from either Create List or All Events)
router.delete('/events/:id', async (req, res) => {
  try {
    const event = await Event.findByIdAndDelete(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    // Deleting the event also deletes its assignments, which immediately frees
    // any marshals that were placed on it -- findExistingAssignment only ever
    // looks at events that still exist and are active.
    res.json({ ok: true, id: req.params.id });
  } catch (err) {
    console.error('Delete event error:', err);
    res.status(500).json({ error: 'Could not delete event.' });
  }
});

// POST /api/admin/events/:id/reopen -- move a completed event back to the active Create List
router.post('/events/:id/reopen', async (req, res) => {
  try {
    const event = await Event.findByIdAndUpdate(
      req.params.id,
      { status: 'active', completedAt: null },
      { new: true }
    );
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json({ event: event.toCard() });
  } catch (err) {
    console.error('Reopen event error:', err);
    res.status(500).json({ error: 'Could not reopen event.' });
  }
});

module.exports = router;
