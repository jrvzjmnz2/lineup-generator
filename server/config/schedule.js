// Weekday vs weekend classification for events.
//
// The lineup rules differ by which side of the week an event falls on:
//   * WEEKEND events (Sat/Sun) keep the original restriction -- a marshal may
//     hold at most one role across all active weekend events.
//   * WEEKDAY events (Mon-Fri) are unrestricted -- a marshal can be lined up
//     on as many of them, in as many roles, as needed.
// A weekday assignment never blocks a weekend one, or the reverse: the check
// only ever looks at other weekend events.
//
// TIMEZONE NOTE: Event.date is a plain calendar string ("2026-09-13") written
// by a native <input type="date"> -- there is no time or zone in it. Passing
// that to `new Date()` parses it as UTC midnight, so `getDay()` on a server
// running west of UTC reports the PREVIOUS day and a Saturday event would be
// classified as a Friday. The components are therefore parsed by hand and read
// back with getUTCDay(), which is stable no matter where the server runs.

const SUNDAY = 0;
const SATURDAY = 6;

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Day index 0-6 (Sun-Sat) for a "YYYY-MM-DD" string, or null if unparseable. */
function dayOfWeek(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''));
  if (!m) return null;
  const [, y, mo, d] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (Number.isNaN(dt.getTime())) return null;
  // Guard against rollover from an impossible date like 2026-02-31.
  if (dt.getUTCMonth() !== Number(mo) - 1 || dt.getUTCDate() !== Number(d)) return null;
  return dt.getUTCDay();
}

/**
 * True for Saturday and Sunday.
 * An unparseable or missing date returns FALSE, i.e. it is treated as a
 * weekday and left unrestricted -- the restriction should never be applied on
 * the strength of a date we could not actually read.
 */
function isWeekendDate(dateStr) {
  const day = dayOfWeek(dateStr);
  if (day === null) return false;
  return day === SATURDAY || day === SUNDAY;
}

/** "Saturday", or '' when the date cannot be read. */
function dayName(dateStr) {
  const day = dayOfWeek(dateStr);
  return day === null ? '' : DAY_NAMES[day];
}

module.exports = { dayOfWeek, isWeekendDate, dayName, DAY_NAMES };
