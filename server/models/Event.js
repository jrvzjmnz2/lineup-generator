const mongoose = require('mongoose');
const { ALL_ROLES } = require('../config/roles');
const { isWeekendDate, dayName } = require('../config/schedule');

// A role slot holds either a MARSHAL (someone who submitted the sign-up form)
// or an EMPLOYEE (a name from the employee_list roster). Exactly one of the two
// ids is set, and `kind` says which.
//
// Employees are deliberately unconstrained: they can take several roles in one
// event, appear on any event, and the weekend one-event rule does not apply to
// them. See the assign route.
//
// `marshalId` is no longer `required` -- an employee entry has none. Entries
// written before this change have no `kind` field at all, so every read treats
// "not explicitly employee" as a marshal. That keeps existing events working
// with no migration.
const assignmentSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['marshal', 'employee'], default: 'marshal' },
    marshalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Marshal' },
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    name: { type: String, required: true }, // denormalized full name for fast card rendering
    note: { type: String, default: '' }, // e.g. "5KM" category tag shown next to the name
  },
  { _id: false }
);

const eventSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    date: { type: String, required: true }, // stored as entered (e.g. 2026-08-09), formatted on the card
    location: { type: String, required: true, trim: true },
    teamLeader: { type: String, default: '' },
    offsiteSupport: { type: String, default: '' },
    categories: { type: String, default: '' }, // e.g. "42KM|21KM|10KM|5KM"
    gunstart: { type: String, default: '' }, // e.g. "0100AM|0400AM|0430AM|0500AM"
    callTime: { type: String, default: '' },
    maxRunners: { type: String, default: '' },
    meals: { type: String, default: '' },

    // Capacity per role. Keys are role names from ALL_ROLES.
    roleCapacities: {
      type: Map,
      of: Number,
      default: {},
    },

    // Assignments per role. Keys are role names from ALL_ROLES.
    assignments: {
      type: Map,
      of: [assignmentSchema],
      default: {},
    },

    // Logistics filled in once roles are filled
    transpo: { type: String, default: '' },
    driver: { type: String, default: '' },
    driverNumber: { type: String, default: '' },
    rate: { type: String, default: '' },

    status: { type: String, enum: ['active', 'completed'], default: 'active' },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: 'events' }
);

eventSchema.methods.toCard = function () {
  const obj = this.toObject({ getters: true });
  const roleCapacities = {};
  const assignments = {};
  for (const role of ALL_ROLES) {
    roleCapacities[role] = (this.roleCapacities && this.roleCapacities.get(role)) || 0;
    assignments[role] = (this.assignments && this.assignments.get(role)) || [];
  }
  // Derived, never stored: which side of the week this event falls on decides
  // whether the one-event-per-marshal rule applies. Computed here so the
  // frontend reads a flag instead of re-implementing the date logic (and the
  // timezone trap that comes with it).
  return {
    ...obj,
    roleCapacities,
    assignments,
    isWeekend: isWeekendDate(this.date),
    dayName: dayName(this.date),
  };
};

module.exports = mongoose.model('Event', eventSchema);
