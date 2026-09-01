const mongoose = require('mongoose');

// A marshal in this collection is exempt from the global "one role, one
// active event at a time" rule -- they can be dragged onto as many active
// events/roles as needed.
//
// Scoped to the CURRENT lineup cycle, not the marshal's profile: the whole
// collection is wiped automatically once zero active events remain (see
// clearExemptionsIfCycleEnded in adminRoutes.js), so an admin has to
// consciously re-grant the exemption for the next round of events rather
// than it silently carrying forward.
const exemptionSchema = new mongoose.Schema(
  {
    marshalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Marshal', required: true, unique: true },
  },
  { timestamps: true, collection: 'exemptions' }
);

module.exports = mongoose.model('Exemption', exemptionSchema);
