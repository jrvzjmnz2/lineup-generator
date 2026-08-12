// Central list of marshal roles used throughout the app.
// All 8 roles get a +/- slot counter on the "Generate Event" screen, and all
// 8 are selectable by marshals on the sign-up form and assignable on the
// lineup card.
const ROLES_WITH_EVENT_CAPACITY = [
  'Operator',
  'Spotter',
  'Split',
  'SLR',
  'Head Marshal',
  'Tech Support',
  'Kit Claiming Staff',
  'Registration Staff',
];
const ALL_ROLES = [...ROLES_WITH_EVENT_CAPACITY];

module.exports = {
  ROLES_WITH_EVENT_CAPACITY,
  ALL_ROLES,
};
