// Event types -- the single source of truth for WHICH FIELDS and WHICH ROLES
// each kind of event has.
//
// ITEMHOUND runs several different operations under one lineup system, and they
// have almost nothing in common: a Timing event needs gun starts, max runners
// and a van; a Fulfillment shift needs a call time and nothing else. Before
// types existed every event carried every field and all nine roles, so most
// cards were mostly blank and the sign-up form offered marshals roles that
// didn't exist on the event they were signing up for.
//
// The rule is STRICT: an event only ever has its own type's fields and its own
// type's roles. Nothing else can be given capacity or assigned. See rolesFor().
//
// Adding a type: append an entry. Adding a role to a type: make sure the role
// also exists in config/roles.js (appended there, never inserted -- saved
// events key their capacity/assignment Maps by role name).
const { ALL_ROLES } = require('./roles');

// On every type, always required. Not listed per-type because there is no
// event without them.
const BASE_FIELDS = ['name', 'date', 'location'];

// Transportation / driver / contact / rate. Only Timing events travel with a
// van and a driver, so only Timing carries these.
const LOGISTICS_FIELDS = ['transpo', 'driver', 'driverNumber', 'rate'];

const EVENT_TYPES = [
  {
    name: 'Kit Claiming',
    fields: ['teamLeader', 'offsiteSupport', 'categories', 'lanes', 'callTime'],
    roles: ['Onsite Support', 'Walk-ins', 'Kit Claiming Staff', 'Tech Support'],
  },
  {
    name: 'Fulfillment',
    fields: ['teamLeader', 'callTime'],
    roles: ['Fulfillment'],
  },
  {
    name: 'Timing',
    fields: ['teamLeader', 'offsiteSupport', 'categories', 'gunstart', 'callTime', 'maxRunners', 'meals'],
    logistics: true,
    roles: ['Operator', 'Spotter', 'Split', 'SLR', 'Head Marshal'],
  },
  {
    name: 'Entractiv',
    fields: ['teamLeader', 'callTime'],
    roles: ['Registration Staff', 'Tech Support', 'Walk-ins'],
  },
  {
    // Same shape as Fulfillment, tracked separately so the two show up as
    // distinct operations on the cards, the sign-up form and the announcement.
    name: 'Bib Production',
    fields: ['teamLeader', 'callTime'],
    roles: ['Bib Production'],
  },
];

// Union of every non-base field any type declares, in a stable display order.
// Used for untyped events and to validate an incoming field name.
const ALL_OPTIONAL_FIELDS = (() => {
  const order = [
    'teamLeader', 'offsiteSupport', 'categories', 'lanes', 'gunstart',
    'callTime', 'maxRunners', 'meals',
  ];
  const seen = new Set(order);
  for (const t of EVENT_TYPES) {
    for (const f of t.fields) if (!seen.has(f)) { order.push(f); seen.add(f); }
  }
  return [...order, ...LOGISTICS_FIELDS];
})();

const EVENT_TYPE_NAMES = EVENT_TYPES.map((t) => t.name);
const BY_NAME = new Map(EVENT_TYPES.map((t) => [t.name, t]));

/** Is this a real event type? Anything falsy is "untyped" (a legacy event). */
function isEventType(name) {
  return typeof name === 'string' && BY_NAME.has(name);
}

function typeConfig(name) {
  return isEventType(name) ? BY_NAME.get(name) : null;
}

/**
 * Every field this type owns, in display order, base fields first.
 *
 * An UNTYPED event gets every field there is. Events saved before types
 * existed have no type and may hold data in any field, so narrowing them
 * would hide values that are already stored. They render as UNTYPED with a
 * picker until someone sets a type on purpose.
 */
function fieldsFor(name) {
  const cfg = typeConfig(name);
  if (!cfg) return [...BASE_FIELDS, ...ALL_OPTIONAL_FIELDS];
  return [...BASE_FIELDS, ...cfg.fields, ...(cfg.logistics ? LOGISTICS_FIELDS : [])];
}

/** Does this type carry the logistics block (transport / driver / rate)? */
function hasLogistics(name) {
  const cfg = typeConfig(name);
  return cfg ? Boolean(cfg.logistics) : true; // untyped: show what it may hold
}

/**
 * The roles this type can line up. Untyped events keep all of them, for the
 * same reason fieldsFor does.
 */
function rolesFor(name) {
  const cfg = typeConfig(name);
  return cfg ? [...cfg.roles] : [...ALL_ROLES];
}

module.exports = {
  EVENT_TYPES,
  EVENT_TYPE_NAMES,
  BASE_FIELDS,
  LOGISTICS_FIELDS,
  ALL_OPTIONAL_FIELDS,
  isEventType,
  typeConfig,
  fieldsFor,
  hasLogistics,
  rolesFor,
};
