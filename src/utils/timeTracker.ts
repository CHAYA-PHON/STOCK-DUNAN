/**
 * Calculates work hours and OT hours based on schedule and actual check-in/out.
 * Day shift: 08:30 - 17:30
 * Night shift: 20:30 - 05:30 (next day)
 */
export function calculateAttendance(
  checkInStr: string, // "HH:MM"
  checkOutStr: string, // "HH:MM"
  shift: "DAY" | "NIGHT"
): { workHours: number; otHours: number } {
  if (!checkInStr || !checkOutStr) {
    return { workHours: 0, otHours: 0 };
  }

  const [inH, inM] = checkInStr.split(":").map(Number);
  const [outH, outM] = checkOutStr.split(":").map(Number);

  // Parse into minute representation of the day
  let actualIn = inH * 60 + inM;
  let actualOut = outH * 60 + outM;

  const schedIn = shift === "DAY" ? 8 * 60 + 30 : 20 * 60 + 30;
  const schedOut = shift === "DAY" ? 17 * 60 + 30 : 5 * 60 + 30;

  // Handle cross-day overnight shift
  if (shift === "NIGHT") {
    if (actualOut < actualIn) {
      actualOut += 24 * 60; // Crosses midnight
    }
    // Also adjust scheduled out if it's the next day
    // Night shift starts 20:30, ends 05:30 next day (29 * 60 + 30)
  } else {
    // For DAY shift, if checkout is past midnight
    if (actualOut < actualIn) {
      actualOut += 24 * 60;
    }
  }

  const shiftEndMinutes = shift === "DAY" ? schedOut : schedOut + 24 * 60;
  const shiftStartMinutes = schedIn;

  // Standard work hours: max 8 hours if they worked full shift
  // Check if they were present during scheduled hours
  let workHours = 0;
  const effectiveIn = Math.max(actualIn, shiftStartMinutes);
  const effectiveOut = Math.min(actualOut, shiftEndMinutes);

  if (effectiveOut > effectiveIn) {
    const presenceInShift = effectiveOut - effectiveIn;
    // Deduct 1 hour break if they worked through the break (typically between 12:00-13:00 or midnight break)
    // We can assume standard 8 hour work for a completed shift, or proportional
    const totalShiftMinutes = shiftEndMinutes - shiftStartMinutes; // 9 hours (including 1 hr break)
    if (presenceInShift >= totalShiftMinutes - 30) {
      workHours = 8;
    } else {
      // Proportional calculation, minus 1 hr break if they worked > 5 hours
      const rawHrs = presenceInShift / 60;
      workHours = rawHrs > 5 ? Math.max(0, rawHrs - 1) : rawHrs;
      // Round to nearest 0.5 hours
      workHours = Math.round(workHours * 2) / 2;
    }
  }

  // Pre-shift OT: from actualIn to shiftStartMinutes if actualIn is earlier
  let preShiftOT = 0;
  if (actualIn < shiftStartMinutes) {
    const preDiff = shiftStartMinutes - actualIn;
    // Pre-shift OT: Counted immediately. Round down to nearest 30 mins
    preShiftOT = Math.floor(preDiff / 30) * 0.5;
  }

  // Post-shift OT: from shiftEndMinutes to actualOut if actualOut is later
  let postShiftOT = 0;
  if (actualOut > shiftEndMinutes) {
    const postDiff = actualOut - shiftEndMinutes;
    // Post-shift OT: Starts after 30 minutes past shift end. Deduct 30 minutes.
    if (postDiff >= 30) {
      const netPostMinutes = postDiff - 30;
      postShiftOT = Math.floor(netPostMinutes / 30) * 0.5;
    }
  }

  const otHours = preShiftOT + postShiftOT;

  return {
    workHours,
    otHours,
  };
}
