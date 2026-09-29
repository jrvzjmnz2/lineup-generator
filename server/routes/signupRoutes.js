const express = require('express');
const mongoose = require('mongoose');
const Event = require('../models/Event');
const Employee = require('../models/Employee');
const EmployeeSignup = require('../models/EmployeeSignup');
const { requireAuth, requireRole } = require('../middleware/auth');
const { logActivity } = require('../services/activityLog');

// The employee sign-up form, used through the shared "signup" login.
// Employees pick their own name from employee_list and tick the EXCLUSIVE
// events they want to join. Only exclusive, active events are offered. The
// marshal sign-up switch does not apply here -- exclusive events start with
// it OFF precisely so marshals don't see them.
const router = express.Router();
router.use(requireAuth, requireRole('signup'));

const EXCLUSIVE_ACTIVE = { status: 'active', exclusive: true };
const isId = (v) => mongoose.Types.ObjectId.isValid(String(v || ''));

// GET /api/signup/options -- employee names and the exclusive events on offer
router.get('/options', async (req, res) => {
  try {
    const [employees, events] = await Promise.all([
      Employee.find().collation({ locale: 'en', strength: 2 }).sort({ name: 1 }).select('_id name team').lean(),
      Event.find(EXCLUSIVE_ACTIVE).select('name date endDate location eventType').sort({ date: 1 }).lean(),
    ]);
    res.json({ employees, events });
  } catch (err) {
    console.error('Signup options error:', err);
    res.status(500).json({ error: 'Could not load the sign-up form.' });
  }
});

// GET /api/signup/employees/:id -- what this employee picked last time (to prefill)
router.get('/employees/:id', async (req, res) => {
  try {
    if (!isId(req.params.id)) return res.status(400).json({ error: 'Pick your name first.' });
    const signup = await EmployeeSignup.findOne({ employeeId: req.params.id }).lean();
    res.json({ events: signup ? signup.events.map(String) : [] });
  } catch (err) {
    console.error('Signup lookup error:', err);
    res.status(500).json({ error: 'Could not load your previous sign-up.' });
  }
});

// POST /api/signup/submit { employeeId, events: [eventId] }
// Replaces the employee's picks. An empty list withdraws them from every
// exclusive event's pool. People an admin already placed in a slot stay
// there -- only the admin removes lineup entries.
router.post('/submit', async (req, res) => {
  try {
    const { employeeId, events } = req.body || {};
    if (!isId(employeeId)) return res.status(400).json({ error: 'Pick your name first.' });
    if (!Array.isArray(events)) return res.status(400).json({ error: 'Invalid events selection' });

    const employee = await Employee.findById(employeeId).lean();
    if (!employee) return res.status(404).json({ error: 'That name is not on the employee list.' });

    const picked = events.filter(isId);
    const valid = picked.length
      ? await Event.find({ _id: { $in: picked }, ...EXCLUSIVE_ACTIVE }).select('_id name').lean()
      : [];
    if (picked.length && valid.length === 0) {
      return res.status(400).json({ error: 'None of the selected events are open any more. Refresh the page.' });
    }

    await EmployeeSignup.findOneAndUpdate(
      { employeeId: employee._id },
      {
        $set: {
          employeeId: employee._id,
          employeeName: employee.name,
          events: valid.map((e) => e._id),
          submittedAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await logActivity(req, {
      action: 'employee.signup',
      targetName: employee.name,
      detail: valid.length ? valid.map((e) => e.name).join(', ') : 'no events',
    });

    res.json({ ok: true, events: valid.map((e) => String(e._id)) });
  } catch (err) {
    console.error('Employee signup error:', err);
    res.status(500).json({ error: 'Could not save your sign-up. Please try again.' });
  }
});

module.exports = router;
