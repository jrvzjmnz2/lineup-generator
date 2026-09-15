const mongoose = require('mongoose');

// Stored in DB "lineup", collection "employee_list".
//
// The collection name is pinned explicitly: Mongoose derives a collection from
// the model name by lower-casing and pluralising it, which would give
// "employees" -- not the "employee_list" collection the team created.
//
// Deliberately minimal. This is a roster of names; it is NOT the `login`
// collection (those are accounts with credentials and roles). Extra fields
// (employee number, contact, department) can be added later without touching
// what is already stored.
//
// `team` -- which operational team this person belongs to (e.g. "Timing").
// Already a column in the live employee_list collection; declared here so the
// schema matches what's actually stored, and so GET /admin/employees can
// project it. Not required/enumerated: existing rows may not have it set
// yet, and this isn't the place that decides which teams are valid -- that's
// `server/config/eventTypes.js`, whose type names a "team" value is expected
// to line up with.
const employeeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    team: { type: String, trim: true, default: '' },
  },
  { timestamps: true, collection: 'employee_list' }
);

module.exports = mongoose.model('Employee', employeeSchema);
