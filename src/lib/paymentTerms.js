/**
 * @file paymentTerms.js
 * @description Vendor Payment Terms and Due Date Calculation Rules (Issue #197).
 *
 * Requirements:
 * - Pure function for due date calculation, taking and returning YYYY-MM-DD strings.
 * - STRICT CONSTRAINT: No Date/toISOString/toLocaleString. All operations on year/month/day integers.
 * - 'net': due date = document date + N days
 * - 'month_end': due date = document date's month end date + N days
 * - Unconfigured: due date = document date, prompt "此供應商未設定付款條件"
 */

/**
 * Determine if a year is a leap year.
 * Rule: Divisible by 4 and not 100, or divisible by 400.
 * @param {number} year
 * @returns {boolean}
 */
export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

/**
 * Get total days in a given month.
 * @param {number} year
 * @param {number} month 1-12
 * @returns {number}
 */
export function getDaysInMonth(year, month) {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  if (month === 4 || month === 6 || month === 9 || month === 11) {
    return 30;
  }
  return 31;
}

/**
 * Add days to a year/month/day tuple using integer arithmetic.
 * @param {number} year
 * @param {number} month 1-12
 * @param {number} day 1-31
 * @param {number} daysToAdd non-negative integer
 * @returns {{ year: number, month: number, day: number }}
 */
export function addDays(year, month, day, daysToAdd) {
  let y = year;
  let m = month;
  let d = day + daysToAdd;

  while (true) {
    const dim = getDaysInMonth(y, m);
    if (d <= dim) {
      break;
    }
    d -= dim;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }

  return { year: y, month: m, day: d };
}

/**
 * Format year/month/day to YYYY-MM-DD string without using Date.
 * @param {number} year
 * @param {number} month
 * @param {number} day
 * @returns {string}
 */
export function formatDate(year, month, day) {
  const m = month < 10 ? `0${month}` : `${month}`;
  const d = day < 10 ? `0${day}` : `${day}`;
  return `${year}-${m}-${d}`;
}

/**
 * Parse YYYY-MM-DD into integer year, month, day without using Date.
 * @param {string} dateStr
 * @returns {{ year: number, month: number, day: number }}
 */
export function parseDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') {
    throw new Error('Date string must be in YYYY-MM-DD format');
  }
  const trimmed = dateStr.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error('Date string must be in YYYY-MM-DD format');
  }
  const parts = trimmed.split('-');
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error('Invalid date components');
  }
  return { year, month, day };
}

/**
 * Calculate due date based on document date and payment terms.
 * Inputs and output are strictly YYYY-MM-DD strings.
 *
 * Rules:
 * - 'net': due date = document date + N days
 * - 'month_end': due date = document date's month end date + N days
 * - unconfigured (null/empty): due date = document date
 *
 * @param {string} documentDate YYYY-MM-DD
 * @param {string|null|undefined} paymentTermsType 'net' | 'month_end' | null
 * @param {number|string|null|undefined} paymentTermsDays 0-365 integer
 * @returns {string} YYYY-MM-DD
 */
export function calculateDueDate(documentDate, paymentTermsType, paymentTermsDays) {
  if (!documentDate) {
    return '';
  }
  const { year, month, day } = parseDate(documentDate);

  if (!paymentTermsType) {
    return formatDate(year, month, day);
  }

  const days = paymentTermsDays !== undefined && paymentTermsDays !== null && paymentTermsDays !== ''
    ? Number(paymentTermsDays)
    : 0;

  if (paymentTermsType === 'net') {
    const res = addDays(year, month, day, days);
    return formatDate(res.year, res.month, res.day);
  }

  if (paymentTermsType === 'month_end') {
    const endDay = getDaysInMonth(year, month);
    const res = addDays(year, month, endDay, days);
    return formatDate(res.year, res.month, res.day);
  }

  return formatDate(year, month, day);
}

/**
 * Helper to get prompt/warning for payment terms configuration.
 * @param {string|null|undefined} paymentTermsType
 * @returns {string|null}
 */
export function getPaymentTermsNotice(paymentTermsType) {
  if (!paymentTermsType) {
    return '此供應商未設定付款條件';
  }
  return null;
}
