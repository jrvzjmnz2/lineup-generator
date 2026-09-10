const mongoose = require('mongoose');

// Stored in DB "lineup", collection "marshal"
// One document per marshal user. Re-submitting the form overwrites this
// document (upsert on userId) so there is never more than one submission.
const marshalSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    // Marshals sign in with Google now and don't have a username -- kept
    // optional so old records (and the field itself) still work.
    username: { type: String },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true },
    contactNumber: { type: String, required: true },
    // Events the marshal is willing to join (references Event._id)
    events: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Event' }],

    // Roles the marshal is willing to fill, PER EVENT TYPE:
    //   { "Timing": ["Operator", "Spotter"], "Kit Claiming": ["Walk-ins"] }
    //
    // Roles stopped being a single flat choice once events gained types --
    // the types have disjoint role sets, so "I'll be a Spotter" says nothing
    // about what someone would do at a Kit Claiming event. The sign-up form
    // asks per type and this is what it stores.
    rolesByType: {
      type: Map,
      of: [String],
      default: {},
    },

    // The flat union of every role above, kept in step on every submit.
    //
    // Deliberately redundant: it is what the pool-card tooltips and the
    // Marshal List show ("preferred roles"), it is what every submission
    // before types was stored as, and it means nothing that only wants "what
    // is this person willing to do" has to walk the map.
    roles: [{ type: String }],
    submittedAt: { type: Date, default: Date.now },
    // Employee-set performance rating, 1 (low) - 10 (high). Not touched by
    // the marshal's own form submission -- only editable from the Marshal
    // List admin tab, and persists across resubmissions.
    rating: { type: Number, min: 1, max: 10, default: null },
  },
  { timestamps: true, collection: 'marshal' }
);

module.exports = mongoose.model('Marshal', marshalSchema);
