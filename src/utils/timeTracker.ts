/**
 * Calculates work hours and OT hours based on schedule and actual check-in/out.
 * Day shift: 08:30 - 17:30
 * Night shift: 20:30 - 05:30 (next day)
 */
export function calculateAttendance(
  checkInStr: string, // "HH:MM"
  checkOutStr: string, // "HH:MM"
  shift: "DAY" | "NIGHT",
  isHoliday: boolean = false
): {
  workHours: number;
  otHours: number;
  ot1: number;
  ot15: number;
  ot3: number;
} {
  if (!checkInStr || !checkOutStr) {
    return { workHours: 0, otHours: 0, ot1: 0, ot15: 0, ot3: 0 };
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
  } else {
    if (actualOut < actualIn) {
      actualOut += 24 * 60;
    }
  }

  const shiftEndMinutes = shift === "DAY" ? schedOut : schedOut + 24 * 60;
  const shiftStartMinutes = schedIn;

  if (isHoliday) {
    // Holiday OT Calculation:
    // Every hour worked is OT (no regular work hours).
    // First 8 hours of work is OT 1.0.
    // Anything after that is OT 3.0.
    let totalMinutes = actualOut - actualIn;
    if (totalMinutes < 0) totalMinutes += 24 * 60;

    // Deduct 1 hour break if they worked more than 5 hours
    let rawHours = totalMinutes / 60;
    let actualWorkHours = rawHours > 5 ? Math.max(0, rawHours - 1) : rawHours;
    // Round to nearest 0.5 hours
    actualWorkHours = Math.round(actualWorkHours * 2) / 2;

    const ot1 = Math.min(8, actualWorkHours);
    const ot3 = Math.max(0, actualWorkHours - 8);

    return {
      workHours: 0,
      otHours: actualWorkHours,
      ot1,
      ot15: 0,
      ot3,
    };
  } else {
    // Normal Working Day Calculation:
    // Standard work hours: max 8 hours if they worked full shift
    let workHours = 0;
    const effectiveIn = Math.max(actualIn, shiftStartMinutes);
    const effectiveOut = Math.min(actualOut, shiftEndMinutes);

    if (effectiveOut > effectiveIn) {
      const presenceInShift = effectiveOut - effectiveIn;
      const totalShiftMinutes = shiftEndMinutes - shiftStartMinutes; // 9 hours (including 1 hr break)
      if (presenceInShift >= totalShiftMinutes - 30) {
        workHours = 8;
      } else {
        const rawHrs = presenceInShift / 60;
        workHours = rawHrs > 5 ? Math.max(0, rawHrs - 1) : rawHrs;
        workHours = Math.round(workHours * 2) / 2;
      }
    }

    // Pre-shift OT
    let preShiftOT = 0;
    if (actualIn < shiftStartMinutes) {
      const preDiff = shiftStartMinutes - actualIn;
      preShiftOT = Math.floor(preDiff / 30) * 0.5;
    }

    // Post-shift OT
    let postShiftOT = 0;
    if (actualOut > shiftEndMinutes) {
      const postDiff = actualOut - shiftEndMinutes;
      if (postDiff >= 30) {
        const netPostMinutes = postDiff - 30;
        postShiftOT = Math.floor(netPostMinutes / 30) * 0.5;
      }
    }

    const otHours = preShiftOT + postShiftOT;

    return {
      workHours,
      otHours,
      ot1: 0,
      ot15: otHours,
      ot3: 0,
    };
  }
}
