/**
 * Shared fee-cycle utilities.
 *
 * Fixes BUG-11/12: month overflow when cycle_day > days-in-month.
 *   new Date(2026, 1 /* Feb *\/, 30) silently rolls over to March 2.
 *   Real-world impact: a fee with cycle_day=31 set in January would compute
 *   Feb 31 → Mar 3, which is wrong. We clamp to the last day of the target month.
 */

export const FREQ_MONTHS: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  annual: 12,
};

export const FREQ_LABELS: Record<string, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  half_yearly: "Half-Yearly",
  annual: "Annual",
};

/** Days in a given month (1-indexed month). Handles leap years. */
export function daysInMonth(year: number, month1Indexed: number): number {
  return new Date(year, month1Indexed, 0).getDate();
}

/**
 * Build a date that never overflows: clamps the day to the last valid day of
 * the target month. e.g. safeDate(2026, 2, 31) → 2026-02-28 (or 29 in leap year).
 */
export function safeDate(year: number, month1Indexed: number, day: number): Date {
  const max = daysInMonth(year, month1Indexed);
  const safeDay = Math.min(Math.max(1, day), max);
  return new Date(year, month1Indexed - 1, safeDay);
}

/**
 * Get the due date for a specific cycle index (0-based) of a plan.
 * cycleIndex 0 = first cycle, 1 = second cycle, etc.
 */
export function getCycleDueDate(
  startMonth: string, // "YYYY-MM"
  cycleDay: number,
  paymentFrequency: string | null,
  cycleIndex: number,
): Date {
  const months = FREQ_MONTHS[paymentFrequency || "monthly"] ?? 1;
  const [sy, sm] = startMonth.split("-").map(Number);
  // Compute target year/month, then clamp day to last valid day of that month.
  const totalMonths = sm - 1 + cycleIndex * months;
  const targetYear = sy + Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1; // 1-indexed
  return safeDate(targetYear, targetMonth, cycleDay);
}
