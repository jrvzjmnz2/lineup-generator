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
const employeeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
  },
  { timestamps: true, collection: 'employee_list' }
);

module.exports = mongoose.model('Employee', employeeSchema);
