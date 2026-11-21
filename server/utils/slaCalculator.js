// SLA targets in working minutes (1 working day = 9 hours = 540 mins)
const SLA_TARGETS = {
  HIGH:   { responseMins: 120,  resolutionMins: 540 },   // 2 hrs, 1 working day
  MEDIUM: { responseMins: 270,  resolutionMins: 1620 },  // 4.5 hrs (half day), 3 working days
  LOW:    { responseMins: 540,  resolutionMins: 2700 }   // 1 working day, 5 working days (1 week)
};

const WORK_START_MINS = 9 * 60 + 30;  // 09:30 -> 570
const WORK_END_MINS   = 18 * 60 + 30; // 18:30 -> 1110

function isWorkingDay(date, holidaySet) {
  const day = date.getDay(); // 0 = Sun, 6 = Sat
  if (day === 0 || day === 6) return false;
  const isoDate = date.toISOString().slice(0, 10);
  return !holidaySet.has(isoDate);
}

// Add N working minutes to a timestamp, skipping nights, weekends, and holidays
function addWorkingMinutes(startDate, minutesToAdd, holidayDates = []) {
  const holidaySet = new Set(holidayDates);
  let cursor = new Date(startDate.getTime());
  let remaining = Math.round(minutesToAdd);

  while (remaining > 0) {
    if (!isWorkingDay(cursor, holidaySet)) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(9, 30, 0, 0);
      continue;
    }

    const currentMins = cursor.getHours() * 60 + cursor.getMinutes();

    if (currentMins < WORK_START_MINS) {
      cursor.setHours(9, 30, 0, 0);
      continue;
    }

    if (currentMins >= WORK_END_MINS) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(9, 30, 0, 0);
      continue;
    }

    const availableToday = WORK_END_MINS - currentMins;
    if (remaining <= availableToday) {
      cursor = new Date(cursor.getTime() + remaining * 60000);
      remaining = 0;
    } else {
      remaining -= availableToday;
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(9, 30, 0, 0);
    }
  }
  return cursor;
}

// Calculate working minutes elapsed between two dates
function getWorkingMinutesBetween(startDate, endDate, holidayDates = []) {
  if (endDate <= startDate) return 0;
  const holidaySet = new Set(holidayDates);
  let cursor = new Date(startDate.getTime());
  let totalMins = 0;

  while (cursor < endDate) {
    if (!isWorkingDay(cursor, holidaySet)) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(9, 30, 0, 0);
      continue;
    }

    const currentMins = cursor.getHours() * 60 + cursor.getMinutes();
    if (currentMins < WORK_START_MINS) {
      cursor.setHours(9, 30, 0, 0);
      continue;
    }
    if (currentMins >= WORK_END_MINS) {
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(9, 30, 0, 0);
      continue;
    }

    const endOfWorkDay = new Date(cursor);
    endOfWorkDay.setHours(18, 30, 0, 0);

    const segmentEnd = endDate < endOfWorkDay ? endDate : endOfWorkDay;
    totalMins += Math.floor((segmentEnd - cursor) / 60000);

    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(9, 30, 0, 0);
  }
  return totalMins;
}

module.exports = { SLA_TARGETS, addWorkingMinutes, getWorkingMinutesBetween };