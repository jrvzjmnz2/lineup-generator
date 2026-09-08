// Central list of marshal roles used throughout the app.
// Every role gets a +/- slot counter on the "Generate Event" screen, is
// selectable by marshals on the sign-up form (which reads this list over the
// API), is assignable on the lineup card, and appears in the announcement and
// the PDF export.
//
// New roles are APPENDED rather than inserted: existing Event documents store
// their capacities/assignments in a Map keyed by role name, so appending
// leaves saved events untouched and simply shows the new role with 0 slots.
const ROLES_WITH_EVENT_CAPACITY = [
  'Operator',
  'Spotter',
  'Split',
  'SLR',
  'Head Marshal',
  'Tech Support',
  'Kit Claiming Staff',
  'Registration Staff',
  'Fulfillment',
];
const ALL_ROLES = [...ROLES_WITH_EVENT_CAPACITY];

module.exports = {
  ROLES_WITH_EVENT_CAPACITY,
  ALL_ROLES,
};
