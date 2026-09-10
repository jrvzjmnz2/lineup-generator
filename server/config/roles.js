// Central list of marshal roles used throughout the app.
// A role gets a +/- slot counter on the "Generate Event" screen, is selectable
// by marshals on the sign-up form, is assignable on the lineup card, and
// appears in the announcement and the PDF export -- but only on events whose
// TYPE includes it (config/eventTypes.js). This list says which roles exist;
// the type says which are offered.
//
// New roles are APPENDED rather than inserted: existing Event documents store
// their capacities/assignments in a Map keyed by role name, so appending
// leaves saved events untouched and simply shows the new role with 0 slots.
//
// This is the master list of every role that exists. WHICH of them a given
// event offers is decided by its event type -- see config/eventTypes.js. A
// role must be here before a type can use it.
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
  'Onsite Support',
  'Walk-ins',
  'Bib Production',
];
const ALL_ROLES = [...ROLES_WITH_EVENT_CAPACITY];

module.exports = {
  ROLES_WITH_EVENT_CAPACITY,
  ALL_ROLES,
};
