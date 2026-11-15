const test = require('node:test');
const assert = require('node:assert/strict');
const timezone = require('../src/utils/timezone');

test('Timezone conversion: Asia/Karachi (PKT UTC+5) to UTC ISO', () => {
  // 14:30 in Karachi (UTC+5) is 09:30 UTC
  const utcIso = timezone.karachiToUtc('2026-11-15', '14:30');
  assert.equal(utcIso, '2026-11-15T09:30:00.000Z');

  // Midnight 00:00 in Karachi is 19:00 UTC of previous day
  const midnightUtc = timezone.karachiToUtc('2026-11-15', '00:00');
  assert.equal(midnightUtc, '2026-11-14T19:00:00.000Z');

  // 04:59 AM in Karachi is 23:59 UTC of previous day
  const morningUtc = timezone.karachiToUtc('2026-11-15', '04:59');
  assert.equal(morningUtc, '2026-11-14T23:59:00.000Z');

  // 05:00 AM in Karachi is 00:00 UTC of same day
  const fiveAmUtc = timezone.karachiToUtc('2026-11-15', '05:00');
  assert.equal(fiveAmUtc, '2026-11-15T00:00:00.000Z');
});

test('Timezone conversion: UTC to Asia/Karachi parts and display', () => {
  const utcInput = '2026-11-15T09:30:00.000Z';
  const parts = timezone.utcToKarachiParts(utcInput);

  assert.equal(parts.date, '2026-11-15');
  assert.equal(parts.time, '14:30');
  assert.equal(parts.formatted, '15 Nov 2026, 02:30 PM PKT');
  assert.equal(parts.isoPkt, '2026-11-15T14:30:00+05:00');

  // Across UTC day boundary
  const lateUtc = '2026-11-14T20:15:00.000Z';
  const nextDayParts = timezone.utcToKarachiParts(lateUtc);
  assert.equal(nextDayParts.date, '2026-11-15');
  assert.equal(nextDayParts.time, '01:15');
  assert.equal(nextDayParts.formatted, '15 Nov 2026, 01:15 AM PKT');
});

test('Timezone validation: rejects invalid calendar dates and times', () => {
  // Invalid day for February
  assert.throws(() => {
    timezone.karachiToUtc('2026-02-30', '12:00');
  }, /Invalid calendar date/);

  // Invalid hour 25
  assert.throws(() => {
    timezone.karachiToUtc('2026-11-15', '25:00');
  }, /Invalid time values/);

  // Invalid minute 60
  assert.throws(() => {
    timezone.karachiToUtc('2026-11-15', '12:60');
  }, /Invalid time values/);

  // Malformed date
  assert.throws(() => {
    timezone.karachiToUtc('15-11-2026', '12:00');
  }, /Invalid date format/);
});

test('Timezone isPast check', () => {
  const pastUtc = new Date(Date.now() - 60000).toISOString();
  const futureUtc = new Date(Date.now() + 60000).toISOString();

  assert.equal(timezone.isPast(pastUtc), true);
  assert.equal(timezone.isPast(futureUtc), false);
});
