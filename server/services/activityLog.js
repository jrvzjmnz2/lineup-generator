const ActivityLog = require('../models/ActivityLog');

// Every action the log knows about, with the label the Activity Log tab shows.
const ACTIONS = {
  'event.create': 'Created event',
  'event.complete': 'Completed event',
  'event.reopen': 'Reopened event',
  'event.delete': 'Deleted event',
  'event.signup': 'Sign-up switch',
  assign: 'Assigned',
  unassign: 'Removed',
  'marshal.optout': 'Opted out',
  'employee.signup': 'Employee sign-up',
  rate: 'Rated',
  exempt: 'Exempted',
  unexempt: 'Revoked exemption',
};

function actorFields(user) {
  if (!user) return { actorName: 'System', actorRole: '' };
  const name = `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.username || 'Unknown';
  return { actorId: user.id, actorName: name, actorRole: user.role || '' };
}

// Records one action. Never throws: a failed log write must not fail the
// request that already succeeded, so errors are only printed.
async function logActivity(req, entry) {
  try {
    await ActivityLog.create({ ...actorFields(req.user), ...entry });
  } catch (err) {
    console.error('Activity log write failed:', err);
  }
}

module.exports = { ACTIONS, logActivity };
