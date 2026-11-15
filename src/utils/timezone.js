/**
 * Timezone utilities for Asia/Karachi (Pakistan Standard Time, UTC+5).
 * Pakistan does not observe Daylight Saving Time (DST).
 * User input and display are in Asia/Karachi; storage is strictly UTC ISO-8601.
 */

const PKT_OFFSET_HOURS = 5;
const PKT_OFFSET_MS = PKT_OFFSET_HOURS * 60 * 60 * 1000;

/**
 * Converts user input (date: YYYY-MM-DD, time: HH:mm) in Asia/Karachi into a UTC ISO string.
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @param {string} timeStr - 'HH:mm' or 'HH:mm:ss'
 * @returns {string} UTC ISO string (e.g., '2026-11-15T09:30:00.000Z')
 */
function karachiToUtc(dateStr, timeStr) {
  if (!dateStr || !timeStr) {
    throw new Error('Both date (YYYY-MM-DD) and time (HH:mm) are required.');
  }

  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!dateMatch) {
    throw new Error('Invalid date format. Expected YYYY-MM-DD.');
  }

  const timeParts = timeStr.trim().split(':');
  if (timeParts.length < 2 || timeParts.length > 3) {
    throw new Error('Invalid time format. Expected HH:mm or HH:mm:ss.');
  }

  const year = parseInt(dateMatch[1], 10);
  const month = parseInt(dateMatch[2], 10) - 1; // 0-indexed
  const day = parseInt(dateMatch[3], 10);
  const hours = parseInt(timeParts[0], 10);
  const minutes = parseInt(timeParts[1], 10);
  const seconds = timeParts.length === 3 ? parseInt(timeParts[2], 10) : 0;

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
    throw new Error('Invalid time values. Hours must be 0-23, minutes 0-59.');
  }

  // Construct UTC timestamp representing Karachi local time minus 5 hours
  const localUtcRepresentation = Date.UTC(year, month, day, hours, minutes, seconds);
  const testDate = new Date(localUtcRepresentation);

  // Validate date overflow (e.g. Feb 31 becoming Mar 3)
  if (
    testDate.getUTCFullYear() !== year ||
    testDate.getUTCMonth() !== month ||
    testDate.getUTCDate() !== day
  ) {
    throw new Error('Invalid calendar date specified.');
  }

  const utcTimestamp = localUtcRepresentation - PKT_OFFSET_MS;
  return new Date(utcTimestamp).toISOString();
}

/**
 * Converts a UTC ISO string into Asia/Karachi date, time, and human-readable components.
 * @param {string|Date} utcInput - UTC ISO string or Date instance
 * @returns {object} { date, time, formatted, isoPkt }
 */
function utcToKarachiParts(utcInput) {
  const dateObj = typeof utcInput === 'string' ? new Date(utcInput) : utcInput;
  if (!dateObj || isNaN(dateObj.getTime())) {
    throw new Error('Invalid UTC date input.');
  }

  // Shift UTC timestamp by +5 hours to obtain local Karachi calendar values
  const pktDate = new Date(dateObj.getTime() + PKT_OFFSET_MS);

  const yyyy = pktDate.getUTCFullYear();
  const mm = String(pktDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(pktDate.getUTCDate()).padStart(2, '0');
  const hh = String(pktDate.getUTCHours()).padStart(2, '0');
  const min = String(pktDate.getUTCMinutes()).padStart(2, '0');
  const ss = String(pktDate.getUTCSeconds()).padStart(2, '0');

  const rawHours = pktDate.getUTCHours();
  const ampm = rawHours >= 12 ? 'PM' : 'AM';
  const displayHours = rawHours % 12 || 12;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthName = monthNames[pktDate.getUTCMonth()];

  const date = `${yyyy}-${mm}-${dd}`;
  const time = `${hh}:${min}`;
  const formatted = `${dd} ${monthName} ${yyyy}, ${String(displayHours).padStart(2, '0')}:${min} ${ampm} PKT`;
  const isoPkt = `${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}+05:00`;

  return {
    date,
    time,
    formatted,
    isoPkt
  };
}

/**
 * Formats a UTC ISO string into human-friendly Asia/Karachi display text.
 * @param {string|Date} utcInput
 * @returns {string} E.g., '15 Nov 2026, 02:30 PM PKT'
 */
function formatKarachiDisplay(utcInput) {
  try {
    return utcToKarachiParts(utcInput).formatted;
  } catch (err) {
    return 'Invalid Date';
  }
}

/**
 * Returns current UTC ISO string.
 */
function nowUtcIso() {
  return new Date().toISOString();
}

/**
 * Checks if a given UTC ISO string is in the past.
 * @param {string} utcIsoString
 * @returns {boolean}
 */
function isPast(utcIsoString) {
  const target = new Date(utcIsoString).getTime();
  return target < Date.now();
}

module.exports = {
  PKT_OFFSET_HOURS,
  PKT_OFFSET_MS,
  karachiToUtc,
  utcToKarachiParts,
  formatKarachiDisplay,
  nowUtcIso,
  isPast
};
