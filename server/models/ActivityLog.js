const mongoose = require('mongoose');

// One line of the admin activity log: who did what, to whom, on which event,
// and when. Written by the admin routes (and the marshal opt-out) through
// services/activityLog.js, read by the Activity Log tab.
//
// Names are copied in at the time of the action on purpose. The log has to
// read correctly after the event is deleted or the marshal is renamed, so it
// does not rely on the ids still resolving to anything.
const activityLogSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorName: { type: String, default: '' },
    actorRole: { type: String, default: '' },
    // e.g. "assign", "unassign", "rate", "event.delete" -- see ACTIONS in
    // services/activityLog.js for the full list.
    action: { type: String, required: true },
    eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'Event', default: null },
    eventName: { type: String, default: '' },
    targetName: { type: String, default: '' }, // the marshal / employee acted on
    role: { type: String, default: '' },
    detail: { type: String, default: '' }, // human-readable extra, e.g. "rating 7 -> 9"
  },
  { collection: 'activity_log' }
);

activityLogSchema.index({ at: -1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
