const mongoose = require('mongoose');

// Stored in DB "lineup", collection "employee_signup".
//
// One document per employee (from employee_list), written by the shared
// "signup" login's form: the employee picks their own name and ticks the
// exclusive events they want to join. Submitting again for the same name
// replaces the previous picks, the same way a marshal resubmission does.
//
// Create List reads these to put signed-up employees straight into each
// exclusive event's pool card.
const employeeSignupSchema = new mongoose.Schema(
  {
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, unique: true },
    employeeName: { type: String, default: '' }, // copied for the activity log and debugging
    events: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Event' }],
    submittedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: 'employee_signup' }
);

module.exports = mongoose.model('EmployeeSignup', employeeSignupSchema);
