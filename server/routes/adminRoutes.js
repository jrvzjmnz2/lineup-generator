const express = require('express');
const Event = require('../models/Event');
const Marshal = require('../models/Marshal');
const Exemption = require('../models/Exemption');
const Employee = require('../models/Employee');
const { renderToBuffer, fileNameFor } = require('../services/marshalListPdf');
const { buildAttendanceWorkbook, attendanceFileName } = require('../services/attendanceSheet');
const { requireAuth, requireRole } = require('../middleware/auth');
const { ALL_ROLES, ROLES_WITH_EVENT_CAPACITY } = require('../config/roles');
const { isWeekendDate, dayName, dayOfWeek, validateWeekdayRange } = require('../config/schedule');
const {
  EVENT_TYPE_NAMES,
  BASE_FIELDS,
  LOGISTICS_FIELDS,
  isEventType,
  fieldsFor,
  rolesFor,
  hasLogistics,
  allowsMultiDay,
} = require('../config/eventTypes');

const router = express.Router();

// All routes here require an authenticated admin (employee) user.
router.use(requireAuth, requireRole('admin'));

// ---------- helpers ----------

// Find where (if anywhere) a marshal is currently assigned across all ACTIVE
// WEEKEND events.
//
// Only weekend events constrain each other. Weekday events are unrestricted,
// so they are skipped here entirely -- a marshal working Wednesday's activation
// is still free for Saturday's race, and the reverse.
//
// The target event is intentionally NOT excluded by default: holding two
// different roles inside one weekend event is still one weekend event too many.
async function findExistingWeekendAssignment(marshalId, excludeEventId = null) {
  const query = { status: 'active' };
  if (excludeEventId) query._id = { $ne: excludeEventId };
  const events = await Event.find(query).lean();
  for (const ev of events) {
    if (!isWeekendDate(ev.date)) continue;
    const assignments = ev.assignments || {};
    for (const role of Object.keys(assignments)) {
      const list = assignments[role] || [];
      // Employee entries have no marshalId, but be explicit: an employee on a
      // weekend event must never make a marshal look booked.
      if (list.some((a) => a.kind !== 'employee' && String(a.marshalId) === String(marshalId))) {
        return { eventId: ev._id, eventName: ev.name, eventDate: ev.date, role };
      }
    }
  }
  return null;
}

// Does this assignment entry refer to the marshal/employee named in the body?
// An entry with no explicit kind is a marshal (pre-existing data).
function matchesAssignee(entry, { marshalId, employeeId }) {
  if (employeeId) {
    return entry.kind === 'employee' && String(entry.employeeId) === String(employeeId);
  }
  return entry.kind !== 'employee' && String(entry.marshalId) === String(marshalId);
}

// Marshal IDs currently exempt from the single-active-event rule, as a Set
// of string ids for fast lookup.
async function getExemptMarshalIdSet() {
  const exemptions = await Exemption.find().lean();
  return new Set(exemptions.map((e) => String(e.marshalId)));
}

// Once no active events remain, the lineup cycle is considered over --
// clear all exemptions so the next round starts clean and an admin must
// re-grant them on purpose. Safe to call after any action that might have
// brought the active-event count to zero (complete, delete).
async function clearExemptionsIfCycleEnded() {
  const activeCount = await Event.countDocuments({ status: 'active' });
  if (activeCount === 0) {
    await Exemption.deleteMany({});
  }
}

// `allowedRoleList` narrows the counters that get created to a specific
// type's own roles (see the event-types feature below). Omitted, it falls
// back to every role that exists -- which is what a legacy/untyped event
// still gets.
function buildDefaultCapacities(roleCounts, allowedRoleList) {
  const capacities = {};
  const roles = allowedRoleList || ROLES_WITH_EVENT_CAPACITY;
  for (const role of roles) {
    capacities[role] = Math.max(0, parseInt(roleCounts && roleCounts[role], 10) || 0);
  }
  return capacities;
}

// Validates the optional `endDate` of a consecutive-day event. Returns
// { endDate } (normalised: '' for a one-day event) or { error }.
function checkEndDate(eventType, startDate, rawEndDate) {
  const end = String(rawEndDate || '').trim();
  if (!end) return { endDate: '' };
  if (!allowsMultiDay(eventType)) {
    return {
      error: eventType
        ? `${eventType} events are one day only — leave the end date empty.`
        : 'Set an event type before giving this event more than one day.',
    };
  }
  const r = validateWeekdayRange(startDate, end);
  return r.error ? { error: r.error } : { endDate: r.endDate };
}

// "9/19/2026" for messages, built from the parts (see config/schedule.js on
// why new Date(str) is avoided).
function shortDate(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : String(dateStr || '');
}

// Who would break the weekend one-event rule if THIS event became a weekend
// event. Used when an edit moves an active event from a weekday onto a
// Saturday/Sunday -- the assign route never saw those placements as weekend
// ones, so nothing checked them. Two ways to clash, same as the assign route:
//   * already on another active weekend event
//   * holding more than one role on this event (fine on a weekday, one weekend
//     event too many once it's a weekend)
// Exempt (star) marshals and employees are never clashes.
async function weekendClashesIfMoved(event) {
  const exemptIds = await getExemptMarshalIdSet();

  const here = new Map(); // marshalId -> { name, roles }
  const assignments = event.assignments || new Map();
  for (const [role, list] of assignments) {
    for (const a of list || []) {
      if (a.kind === 'employee') continue;
      const id = String(a.marshalId);
      if (exemptIds.has(id)) continue;
      if (!here.has(id)) here.set(id, { name: a.name, roles: [] });
      here.get(id).roles.push(role);
    }
  }
  if (!here.size) return [];

  // Every OTHER active weekend event, scanned once.
  const elsewhere = new Map(); // marshalId -> { role, eventName, eventDate }
  const others = await Event.find({ status: 'active', _id: { $ne: event._id } }).lean();
  for (const ev of others) {
    if (!isWeekendDate(ev.date)) continue;
    for (const role of Object.keys(ev.assignments || {})) {
      for (const a of ev.assignments[role] || []) {
        if (a.kind === 'employee') continue;
        const id = String(a.marshalId);
        if (!elsewhere.has(id)) elsewhere.set(id, { role, eventName: ev.name, eventDate: ev.date });
      }
    }
  }

  const clashes = [];
  for (const [id, info] of here) {
    const other = elsewhere.get(id);
    if (other) {
      const when = dayName(other.eventDate);
      clashes.push({ marshalId: id, name: info.name, reason: `already ${other.role} on "${other.eventName}"${when ? `, ${when}` : ''}` });
    } else if (info.roles.length > 1) {
      clashes.push({ marshalId: id, name: info.name, reason: `in ${info.roles.length} roles here: ${info.roles.join(', ')}` });
    }
  }
  return clashes;
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
        if (a.kind === 'employee') continue; // employees have no Marshal List row
        const key = String(a.marshalId);
        if (!map[key]) map[key] = [];
        map[key].push({
          eventId: ev._id,
          eventName: ev.name,
          date: ev.date,
          endDate: ev.endDate || '',
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

// ---------- event types ----------

// GET /api/admin/event-types -- the catalogue Generate Event builds its form
// from: each type's own fields (base fields + its own + logistics, if it has
// any) and roles. This is the single place that table is assembled -- the
// frontend fetches it rather than keeping its own copy, so the two can never
// drift apart.
router.get('/event-types', (req, res) => {
  const types = EVENT_TYPE_NAMES.map((name) => ({
    name,
    fields: fieldsFor(name),
    roles: rolesFor(name),
    hasLogistics: hasLogistics(name),
    multiDay: allowsMultiDay(name),
  }));
  res.json({ types, baseFields: BASE_FIELDS, logisticsFields: LOGISTICS_FIELDS });
});

// ---------- events ----------

// POST /api/admin/events -- "Add Event" from the Generate Event tab
router.post('/events', async (req, res) => {
  try {
    const { eventType, roleCounts } = req.body;

    if (!isEventType(eventType)) {
      return res.status(400).json({
        error: eventType
          ? `Unknown event type "${eventType}". Choose one of: ${EVENT_TYPE_NAMES.join(', ')}`
          : `Select an event type (${EVENT_TYPE_NAMES.join(', ')})`,
      });
    }

    const missing = BASE_FIELDS.filter((f) => !req.body[f] || String(req.body[f]).trim() === '');
    if (missing.length) {
      return res.status(400).json({ error: `Missing required field(s): ${missing.join(', ')}` });
    }

    // Built from the type's own field list, not the raw request body -- so a
    // stale form (or one sending a field this type doesn't have) can't
    // smuggle a value onto the document. Role capacities are narrowed the
    // same way, to this type's own roles only.
    const doc = {
      eventType,
      roleCapacities: buildDefaultCapacities(roleCounts, rolesFor(eventType)),
      assignments: {},
      status: 'active',
    };
    for (const field of fieldsFor(eventType)) {
      const raw = req.body[field];
      doc[field] = typeof raw === 'string' ? raw.trim() : (raw || '');
    }

    // Consecutive days: every type except Timing, weekdays only.
    const endCheck = checkEndDate(eventType, doc.date, req.body.endDate);
    if (endCheck.error) return res.status(400).json({ error: endCheck.error });
    doc.endDate = endCheck.endDate;

    const event = await Event.create(doc);
    res.status(201).json({ event: event.toCard() });
  } catch (err) {
    console.error('Create event error:', err);
    res.status(500).json({ error: 'Could not create event. Please try again.' });
  }
});

// POST /api/admin/events/:id/type -- set the type on an UNTYPED (legacy)
// event. One-way: once a type is set it can't be changed again, because the
// type decides which roles exist, and swapping it under a built lineup is
// exactly how people assigned to a since-removed role would get lost. Seeds
// the new type's roles into roleCapacities at 0 so they render as adjustable
// counters immediately, without disturbing any capacity already set.
router.post('/events/:id/type', async (req, res) => {
  try {
    const { eventType } = req.body;
    if (!isEventType(eventType)) {
      return res.status(400).json({ error: `Unknown event type "${eventType}". Choose one of: ${EVENT_TYPE_NAMES.join(', ')}` });
    }

    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.eventType) {
      return res.status(409).json({
        error: `This event is already a ${event.eventType} event. The type can only be set on an untyped event, since it decides which roles the event has.`,
      });
    }

    event.eventType = eventType;
    if (!event.roleCapacities) event.roleCapacities = new Map();
    for (const role of rolesFor(eventType)) {
      if (!event.roleCapacities.has(role)) event.roleCapacities.set(role, 0);
    }
    await event.save();
    res.json({ event: event.toCard() });
  } catch (err) {
    console.error('Set event type error:', err);
    res.status(500).json({ error: 'Could not set the event type.' });
  }
});

// GET /api/admin/events?status=active|completed&year=YYYY&month=1-12
// year/month are optional -- when both are present (used by the All Events
// tab so it doesn't have to render every completed event ever), only events
// whose `date` (stored "YYYY-MM-DD", always set via a native <input type=date>
// so the format is guaranteed) falls in that calendar month are returned.
router.get('/events', async (req, res) => {
  const status = req.query.status === 'completed' ? 'completed' : 'active';
  const query = { status };

  const year = parseInt(req.query.year, 10);
  const month = parseInt(req.query.month, 10);
  if (Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12) {
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;
    // A consecutive-day event that starts on the 30th and ends on the 2nd
    // belongs to both months, so match on either end of the range.
    query.$or = [
      { date: { $regex: `^${monthPrefix}` } },
      { endDate: { $regex: `^${monthPrefix}` } },
    ];
  }

  const events = await Event.find(query).sort({ date: 1, createdAt: 1 });
  res.json({ events: events.map((e) => e.toCard()) });
});

// GET /api/admin/marshals -- all marshal submissions, used to build the pool on each card.
// Sorted alphabetically by name (case-insensitive) rather than registration
// order, matching the Marshal List tab's sort.
router.get('/marshals', async (req, res) => {
  const marshals = await Marshal.find()
    .collation({ locale: 'en', strength: 2 })
    .sort({ firstName: 1, lastName: 1 })
    .lean();
  res.json({ marshals });
});

// GET /api/admin/employees -- the employee_list roster, for the dropdown at the
// bottom of each event's pool card, and for the Team Lead / Off Site Support
// checklist on Timing events (both the Create List card and Generate Event).
// `team` is projected alongside name/id so the frontend can filter the
// checklist to a specific team without a second endpoint. Sorted the same
// case-insensitive way the marshal lists are.
router.get('/employees', async (req, res) => {
  try {
    const employees = await Employee.find()
      .collation({ locale: 'en', strength: 2 })
      .sort({ name: 1 })
      .select('_id name team')
      .lean();
    res.json({ employees });
  } catch (err) {
    console.error('Employee list error:', err);
    res.status(500).json({ error: 'Could not load the employee list.' });
  }
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

// PUT /api/admin/events/:id -- edit event details / logistics
//
// Limited to the event's own type's fields -- e.g. a Fulfillment event can't
// pick up a stray `gunstart` value even if something sends it. Needs the
// document first (rather than findByIdAndUpdate) so the type is known before
// deciding what's editable. An untyped event still gets every field, same as
// before types existed.
//
// Also the "Edit Event Details" save (name / date / endDate / location):
//   * name, date and location can't be blanked
//   * endDate only on multi-day types, and the range must be weekdays only
//   * moving an ACTIVE event from a weekday onto a weekend is refused (409)
//     if it would double-book anyone -- the 409 carries `clashes`
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);
const BASE_LABELS = { name: 'Event name', date: 'Date', location: 'Location' };

router.put('/events/:id', async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const body = req.body || {};

    for (const f of BASE_FIELDS) {
      if (has(body, f) && String(body[f] == null ? '' : body[f]).trim() === '') {
        return res.status(400).json({ error: `${BASE_LABELS[f] || f} can't be empty.` });
      }
    }

    const nextDate = has(body, 'date') ? String(body.date).trim() : event.date;
    const dateChanged = has(body, 'date') && nextDate !== event.date;
    if (dateChanged && dayOfWeek(nextDate) === null) {
      return res.status(400).json({ error: 'Pick a valid date.' });
    }

    // Re-check the range whenever either end of it moves.
    let nextEnd = event.endDate || '';
    const rangeTouched = has(body, 'endDate') || dateChanged;
    if (rangeTouched) {
      const endCheck = checkEndDate(event.eventType, nextDate, has(body, 'endDate') ? body.endDate : event.endDate);
      if (endCheck.error) return res.status(400).json({ error: endCheck.error });
      nextEnd = endCheck.endDate;
    }

    if (dateChanged && event.status === 'active' && isWeekendDate(nextDate) && !isWeekendDate(event.date)) {
      const clashes = await weekendClashesIfMoved(event);
      if (clashes.length) {
        const who = clashes.map((c) => `${c.name} (${c.reason})`).join('; ');
        return res.status(409).json({
          error: `Can't move "${event.name}" to ${dayName(nextDate)} ${shortDate(nextDate)} — that makes it a weekend event, and ${clashes.length} marshal${clashes.length === 1 ? '' : 's'} would be double-booked: ${who}. Take them off one of the events or \u2605 exempt them first.`,
          clashes,
        });
      }
    }

    const editableFields = fieldsFor(event.eventType);
    for (const field of editableFields) {
      if (has(body, field)) {
        const raw = body[field];
        event[field] = BASE_FIELDS.includes(field) ? String(raw).trim() : raw;
      }
    }
    if (rangeTouched) event.endDate = nextEnd;

    await event.save();
    res.json({ event: event.toCard() });
  } catch (err) {
    console.error('Update event error:', err);
    res.status(500).json({ error: 'Could not update event.' });
  }
});

// POST /api/admin/events/:id/capacity -- adjust a role's slot count on an existing card
//
// Gated on the event's own type: only its roles can be given slots at all.
// (Untyped events still allow every role, same as before types existed.)
router.post('/events/:id/capacity', async (req, res) => {
  try {
    const { role, capacity } = req.body;
    if (!ALL_ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role' });

    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const allowed = rolesFor(event.eventType);
    if (!allowed.includes(role)) {
      return res.status(400).json({
        error: `"${role}" is not a role on ${event.eventType || 'Untyped'} events. Available: ${allowed.join(', ')}`,
      });
    }
    const cap = Math.max(0, parseInt(capacity, 10) || 0);

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

// POST /api/admin/events/:id/assign -- drag a marshal OR an employee into a slot
//
// Send `marshalId` for a marshal, or `employeeId` for someone off the
// employee_list roster. The two differ in what is checked:
//   marshal  -- weekend one-event rule (unless exempt), one slot only
//   employee -- no weekend rule, no cross-event rule, may hold several roles
//               in the same event
// Both are still bound by the role's slot capacity.
router.post('/events/:id/assign', async (req, res) => {
  try {
    const { role, marshalId, employeeId } = req.body;
    if (!ALL_ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role' });
    if (!marshalId && !employeeId) {
      return res.status(400).json({ error: 'Provide either a marshalId or an employeeId' });
    }

    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    if (event.status !== 'active') return res.status(400).json({ error: 'Event is not active' });

    // Gated on the event's own type, same as capacity -- someone can only be
    // placed into a role this event actually offers.
    const allowed = rolesFor(event.eventType);
    if (!allowed.includes(role)) {
      return res.status(400).json({
        error: `"${role}" is not a role on ${event.eventType || 'Untyped'} events. Available: ${allowed.join(', ')}`,
      });
    }

    const currentList = (event.assignments && event.assignments.get(role)) || [];
    const capacity = (event.roleCapacities && event.roleCapacities.get(role)) || 0;
    if (currentList.length >= capacity) {
      return res.status(400).json({ error: `${role} is already full (${capacity} slot${capacity === 1 ? '' : 's'})` });
    }

    const note = (req.body.note || '').trim();
    let entry;

    if (employeeId) {
      const employee = await Employee.findById(employeeId).lean();
      if (!employee) return res.status(404).json({ error: 'Employee not found' });

      // Employees may take several roles in one event, but not the same role
      // twice -- that only ever produces a duplicate line on the lineup.
      const alreadyInThisRole = currentList.some(
        (a) => a.kind === 'employee' && String(a.employeeId) === String(employeeId)
      );
      if (alreadyInThisRole) {
        return res.status(409).json({
          error: `${employee.name} is already in ${role} on this event. Employees can take other roles here, just not this one twice.`,
        });
      }

      entry = {
        kind: 'employee',
        employeeId: employee._id,
        name: String(employee.name || '').trim().toUpperCase(),
        note,
      };
    } else {
      const marshal = await Marshal.findById(marshalId).lean();
      if (!marshal) return res.status(404).json({ error: 'Marshal not found' });

      // Weekend events keep the one-role-one-event restriction; weekday events
      // are unrestricted. A per-cycle exemption bypasses both.
      if (isWeekendDate(event.date)) {
        const exemptIds = await getExemptMarshalIdSet();
        if (!exemptIds.has(String(marshalId))) {
          const existing = await findExistingWeekendAssignment(marshalId);
          if (existing) {
            const when = dayName(existing.eventDate);
            return res.status(409).json({
              error: `${marshal.firstName} ${marshal.lastName} is already assigned to ${existing.role} on "${existing.eventName}"${when ? ` (${when})` : ''}. Weekend events allow one event per marshal \u2014 star them as exempt if they really are working both.`,
            });
          }
        }
      }

      entry = {
        kind: 'marshal',
        marshalId: marshal._id,
        name: `${marshal.firstName} ${marshal.lastName}`.trim().toUpperCase(),
        note,
      };
    }

    if (!event.assignments) event.assignments = new Map();
    event.assignments.set(role, [...currentList, entry]);
    await event.save();

    res.json({ event: event.toCard() });
  } catch (err) {
    console.error('Assign error:', err);
    res.status(500).json({ error: 'Could not assign to that slot.' });
  }
});

// POST /api/admin/events/:id/note -- edit the note shown next to an assigned marshal (e.g. "5KM")
router.post('/events/:id/note', async (req, res) => {
  try {
    const { role, marshalId, employeeId, note } = req.body;
    if (!ALL_ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role' });

    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const currentList = (event.assignments && event.assignments.get(role)) || [];
    const updatedList = currentList.map((a) =>
      matchesAssignee(a, { marshalId, employeeId })
        ? { ...(a.toObject ? a.toObject() : a), note: (note || '').trim() }
        : a
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

// POST /api/admin/events/:id/unassign -- remove a marshal or employee from a slot
router.post('/events/:id/unassign', async (req, res) => {
  try {
    const { role, marshalId, employeeId } = req.body;
    if (!ALL_ROLES.includes(role)) return res.status(400).json({ error: 'Unknown role' });

    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const currentList = (event.assignments && event.assignments.get(role)) || [];
    const updatedList = currentList.filter((a) => !matchesAssignee(a, { marshalId, employeeId }));
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
    await clearExemptionsIfCycleEnded();
    res.json({ event: event.toCard() });
  } catch (err) {
    console.error('Complete event error:', err);
    res.status(500).json({ error: 'Could not complete event.' });
  }
});

// POST /api/admin/events/:id/signup { open: true|false } -- show or hide the
// event on the marshal sign-up form. Lineups and existing submissions are left
// alone; the switch only decides what the form offers from now on.
router.post('/events/:id/signup', async (req, res) => {
  try {
    const { open } = req.body;
    if (typeof open !== 'boolean') return res.status(400).json({ error: 'open must be true or false' });
    const event = await Event.findByIdAndUpdate(req.params.id, { signupOpen: open }, { new: true });
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json({ event: event.toCard() });
  } catch (err) {
    console.error('Sign-up switch error:', err);
    res.status(500).json({ error: 'Could not change the sign-up switch.' });
  }
});

// DELETE /api/admin/events/:id -- permanently remove an event (from either Create List or All Events)
router.delete('/events/:id', async (req, res) => {
  try {
    const event = await Event.findByIdAndDelete(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    // Deleting the event also deletes its assignments, which immediately frees
    // any marshals that were placed on it -- findExistingWeekendAssignment only
    // ever looks at events that still exist and are active.
    await clearExemptionsIfCycleEnded();
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

// ---------- PDF export ----------

// GET /api/admin/events/:id/pdf -- the event's marshal list as a PDF laid out
// like the ITEMHOUND "MARSHALS LIST" spreadsheet template. Works for active
// and completed events alike, so All Events can export too.
//
// The PDF is built into a Buffer before anything is sent: once bytes are
// streamed the status and headers are committed, and a mid-render failure
// would leave the browser with a truncated file instead of an error it can
// show in a toast.
router.get('/events/:id/pdf', async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const card = event.toCard();
    // Only the roles this event's type actually has, plus any off-type role
    // still holding someone from before it had (or was given) a type -- the
    // same list the card itself and the announcement use, so all three agree.
    const roles = [...(card.typeRoles || []), ...(card.extraRoles || [])];
    const buffer = await renderToBuffer(card, roles.length ? roles : ALL_ROLES);
    const name = fileNameFor(card);
    // Quote for the spaces, and add the RFC 5987 form so a non-ASCII event
    // name survives; the plain filename is stripped to ASCII as a fallback.
    const asciiName = name.replace(/[^\x20-\x7E]/g, '_');

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`
    );
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error('PDF export error:', err);
    const missingDep = err && (err.code === 'MODULE_NOT_FOUND' || /pdfkit/i.test(err.message || ''));
    res.status(500).json({
      error: missingDep
        ? 'PDF export needs the pdfkit package. Run "npm install" in the project folder and restart the server.'
        : `Could not build the PDF: ${err.message}`,
    });
  }
});

// ---------- exemptions (per-lineup-cycle) ----------

// GET /api/admin/events/:id/attendance-sheet -- the team's attendance sheet
// template (server/templates/attendance-sheet.xlsx) filled with this event's
// lineup: Event, Date, and one row per assignment (full name + role). Every
// other column is left blank for the day. A consecutive-day event gets one
// sheet per day. Built into a Buffer before anything is sent, like the PDF.
router.get('/events/:id/attendance-sheet', async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Event not found' });

    const card = event.toCard();
    // Same role list, in the same order, as the card, announcement and PDF.
    const roles = [...(card.typeRoles || []), ...(card.extraRoles || [])];
    const buffer = buildAttendanceWorkbook(card, roles.length ? roles : ALL_ROLES);
    const name = attendanceFileName(card);
    const asciiName = name.replace(/[^\x20-\x7E]/g, '_');

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(name)}`
    );
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (err) {
    console.error('Attendance sheet error:', err);
    res.status(500).json({ error: `Could not build the attendance sheet: ${err.message}` });
  }
});

// GET /api/admin/exemptions -- marshalIds currently exempt from the
// single-active-event rule, for this lineup cycle.
router.get('/exemptions', async (req, res) => {
  try {
    const exemptions = await Exemption.find().lean();
    res.json({ marshalIds: exemptions.map((e) => String(e.marshalId)) });
  } catch (err) {
    console.error('List exemptions error:', err);
    res.status(500).json({ error: 'Could not load exemptions.' });
  }
});

// POST /api/admin/exemptions -- manually exempt a marshal for this cycle
router.post('/exemptions', async (req, res) => {
  try {
    const { marshalId } = req.body;
    const marshal = await Marshal.findById(marshalId).lean();
    if (!marshal) return res.status(404).json({ error: 'Marshal not found' });

    await Exemption.updateOne(
      { marshalId },
      { $setOnInsert: { marshalId } },
      { upsert: true }
    );
    res.status(201).json({ ok: true, marshalId: String(marshalId) });
  } catch (err) {
    console.error('Add exemption error:', err);
    res.status(500).json({ error: 'Could not exempt marshal.' });
  }
});

// DELETE /api/admin/exemptions/:marshalId -- revoke an exemption
router.delete('/exemptions/:marshalId', async (req, res) => {
  try {
    await Exemption.deleteOne({ marshalId: req.params.marshalId });
    res.json({ ok: true, marshalId: req.params.marshalId });
  } catch (err) {
    console.error('Remove exemption error:', err);
    res.status(500).json({ error: 'Could not revoke exemption.' });
  }
});

module.exports = router;
