const mongoose = require('mongoose');

// Stored in DB "lineup", collection "marshal"
// One document per marshal user. Re-submitting the form overwrites this
// document (upsert on userId) so there is never more than one submission.
const marshalSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    username: { type: String, required: true },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true },
    contactNumber: { type: String, required: true },
    // Events the marshal is willing to join (references Event._id)
    events: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Event' }],
    // Roles the marshal is willing to fill (any of the 8 role names)
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
