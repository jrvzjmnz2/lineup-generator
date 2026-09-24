const mongoose = require('mongoose');
const { ALL_ROLES } = require('../config/roles');
const { isWeekendDate, dayName, dayCount } = require('../config/schedule');
const { EVENT_TYPE_NAMES, fieldsFor, rolesFor, hasLogistics, allowsMultiDay } = require('../config/eventTypes');

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
    // Which kind of operation this is. It decides which fields the event
    // carries and which roles it can line up -- see config/eventTypes.js.
    //
    // NULLABLE ON PURPOSE. Every event saved before types existed has none,
    // and those are shown as UNTYPED (all fields, all roles) with a picker to
    // set the type when someone gets round to it, rather than being guessed
    // at by a migration. `null` is in the enum so those documents still
    // validate on save.
    eventType: {
      type: String,
      enum: [...EVENT_TYPE_NAMES, null],
      default: null,
    },

    name: { type: String, required: true, trim: true },
    date: { type: String, required: true }, // stored as entered (e.g. 2026-08-09), formatted on the card
    // Last day of a consecutive-day event, same format as `date`. Empty for a
    // one-day event -- which is every event saved before this existed, so no
    // migration is needed. Only non-Timing types may set it, and the whole
    // range must be weekdays (see validateWeekdayRange in config/schedule.js),
    // so `date` alone still decides weekday vs weekend.
    endDate: { type: String, default: '' },
    location: { type: String, required: true, trim: true },
    teamLeader: { type: String, default: '' },
    offsiteSupport: { type: String, default: '' },
    categories: { type: String, default: '' }, // e.g. "42KM|21KM|10KM|5KM"
    lanes: { type: String, default: '' }, // Kit Claiming: number of claiming lanes
    gunstart: { type: String, default: '' }, // e.g. "0100AM|0400AM|0430AM|0500AM"
    callTime: { type: String, default: '' },
    maxRunners: { type: String, default: '' },
    meals: { type: String, default: '' },

    // Capacity per role. Keys are role names -- in practice only the roles
    // this event's type offers, but stored as a Map so the schema does not
    // have to change when a type does.
    roleCapacities: {
      type: Map,
      of: Number,
      default: {},
    },

    // Assignments per role. Keys are role names, as above.
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
  // The roles this event's TYPE offers. Untyped events get all of them.
  const typeRoles = rolesFor(this.eventType);

  // Roles that still HOLD PEOPLE but are not part of this type.
  //
  // This exists because an event's type can be set after the fact (the picker
  // on untyped cards). An untyped event may already have marshals lined up in
  // roles the new type doesn't offer -- filtering strictly to typeRoles would
  // make those people vanish from the card, the announcement and the PDF while
  // still sitting in the database. So they are surfaced separately and the UI
  // renders them as a marked leftover block. Nothing new can be added to them:
  // the capacity and assign routes only ever accept a role from typeRoles.
  //
  // Assignments, not capacity: a leftover role with slots configured but
  // nobody in it holds no information worth showing, and rendering it would
  // put empty off-type blocks on every retyped card.
  const extraRoles = ALL_ROLES.filter(
    (role) => !typeRoles.includes(role) && assignments[role].length > 0
  );

  // Derived, never stored: which side of the week this event falls on decides
  // whether the one-event-per-marshal rule applies. Computed here so the
  // frontend reads a flag instead of re-implementing the date logic (and the
  // timezone trap that comes with it). The type-derived lists are here for the
  // same reason -- one place decides what an event is made of.
  return {
    ...obj,
    roleCapacities,
    assignments,
    isWeekend: isWeekendDate(this.date),
    dayName: dayName(this.date),
    endDate: this.endDate || '',
    endDayName: this.endDate ? dayName(this.endDate) : '',
    dayCount: dayCount(this.date, this.endDate),
    allowsMultiDay: allowsMultiDay(this.eventType),
    eventType: this.eventType || null,
    typeFields: fieldsFor(this.eventType),
    typeRoles,
    extraRoles,
    hasLogistics: hasLogistics(this.eventType),
  };
};

module.exports = mongoose.model('Event', eventSchema);
