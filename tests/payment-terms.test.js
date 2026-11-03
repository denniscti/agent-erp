/**
 * @file payment-terms.test.js
 * @description Test suite for Vendor Payment Terms and Pure Due Date Calculation (Issue #197).
 *
 * ## Test Perspective Table (Equivalence Partitioning & Boundary Values)
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-PT-N-01 | 供應商設定 `type: 'net', days: 30` | Equivalence – 正常設定 net 條件 | 成功建立/更新，回傳對應欄位值 | 供應商正常情境 |
 * | TC-PT-N-02 | 供應商設定 `type: 'month_end', days: 0` | Boundary – month_end 0 天 (當月最後一天) | 成功建立/更新，days 為 0 | 邊界值：0 天 |
 * | TC-PT-N-03 | 供應商設定 `type: 'net', days: 365` | Boundary – 最大天數 365 天 | 成功建立/更新，days 為 365 | 邊界值：365 天 |
 * | TC-PT-N-04 | 建立或更新時兩欄位皆為 null / undefined | Equivalence – 未設定付款條件 | 成功建立/更新，兩欄位存為 NULL | 預設未設定 |
 * | TC-PT-N-05 | 供應商清除原先設定的付款條件 | Equivalence – 清除付款條件 | 成功將兩欄位更新重設為 NULL | 清除功能 |
 * | TC-PT-E-01 | 設定 `type: 'net'`, 但 `days` 為 null / 空 | Equivalence – 僅有 type 無 days (PT-01) | 拋出錯誤：「付款條件類型與天數需同時設定」 | PT-01 驗證 |
 * | TC-PT-E-02 | 設定 `days: 30`, 但 `type` 為 null / 空 | Equivalence – 僅有 days 無 type (PT-01) | 拋出錯誤：「付款條件類型與天數需同時設定」 | PT-01 驗證 |
 * | TC-PT-E-03 | 設定 `type: 'quarterly', days: 30` | Boundary – 非法付款類型 (PT-02) | 拋出錯誤：「付款條件類型需為 net 或 month_end」 | PT-02 類型防護 |
 * | TC-PT-E-04 | 設定 `days: -1` | Boundary – 負數天數 (PT-02) | 拋出錯誤：「付款天數需為 0～365 的整數」 | 邊界值：-1 |
 * | TC-PT-E-05 | 設定 `days: 366` | Boundary – 超過上限天數 (PT-02) | 拋出錯誤：「付款天數需為 0～365 的整數」 | 邊界值：366 |
 * | TC-PT-E-06 | 純客戶（`is_vendor = false`）設定付款條件 | Equivalence – 非供應商限制 (PT-03) | 拋出錯誤：「僅供應商可設定付款條件」 | PT-03 角色防護 |
 * | TC-CALC-N-01 | `calculateDueDate('2026-01-15', 'net', 0)` | Boundary – net 0 天 | 回傳 `'2026-01-15'` | 當日 |
 * | TC-CALC-N-02 | `calculateDueDate('2026-01-15', 'net', 30)` | Equivalence – net 30 天跨月 | 回傳 `'2026-02-14'` | 跨單月 |
 * | TC-CALC-N-03 | `calculateDueDate('2026-01-15', 'month_end', 0)` | Boundary – month_end 0 天 | 回傳 `'2026-01-31'`（當月最後一天） | 當月月底 |
 * | TC-CALC-N-04 | `calculateDueDate('2026-01-15', 'month_end', 30)` | Equivalence – 平年月底跨月加 30 天 | 回傳 `'2026-03-02'`（2026 平年 2 月 28 天） | 驗收標準明確案例 |
 * | TC-CALC-B-01 | `calculateDueDate('2028-01-01', 'month_end', 29)` | Boundary – 閏年 2 月邊界（2028） | 回傳 `'2028-02-29'`（2 月 29 天） | 閏年天數驗證 |
 * | TC-CALC-B-02 | `calculateDueDate('2027-01-01', 'month_end', 29)` | Boundary – 平年 2 月邊界（2027） | 回傳 `'2027-03-01'`（2 月 28 天） | 平年天數對比驗證 |
 * | TC-CALC-B-03 | `calculateDueDate('2026-11-15', 'net', 60)` | Boundary – 跨年度運算（11月 + 60天） | 回傳 `'2027-01-14'` | 跨年邊界 |
 * | TC-CALC-B-04 | `calculateDueDate('2026-05-10', null, null)` | Equivalence – 未設定付款條件 | 回傳 `'2026-05-10'`，提示未設定 | 預設單據日 |
 * | TC-CALC-E-01 | `calculateDueDate('invalid-date', 'net', 30)` | Boundary – 格式無效字串 | 拋出格式錯誤 | 防呆驗證 |
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Polyfill Svelte 5 $state rune for Node.js test environment if not defined
if (typeof globalThis.$state === 'undefined') {
  globalThis.$state = (v) => v;
}

const {
  isLeapYear,
  getDaysInMonth,
  addDays,
  calculateDueDate,
  getPaymentTermsNotice,
  formatDate,
  parseDate
} = await import('../src/lib/paymentTerms.js');

const {
  fetchPartners,
  createPartnerAction,
  updatePartnerAction,
  login
} = await import('../src/lib/store.svelte.js');

// Helper to ensure authenticated state in test suite
async function ensureAuthenticated() {
  await login('admin@example.com', 'password123');
}

// ---------------------------------------------------------------------------
// Pure Function Due Date Calculation Tests
// ---------------------------------------------------------------------------

test('TC-CALC-N-01: calculateDueDate with net 0 days returns document date', () => {
  // Given: Document date '2026-01-15', terms type 'net', 0 days
  const docDate = '2026-01-15';

  // When: calculateDueDate is invoked
  const result = calculateDueDate(docDate, 'net', 0);

  // Then: Returns the exact same document date
  assert.equal(result, '2026-01-15');
});

test('TC-CALC-N-02: calculateDueDate with net 30 days across month boundary', () => {
  // Given: Document date '2026-01-15', terms type 'net', 30 days
  const docDate = '2026-01-15';

  // When: calculateDueDate is invoked (Jan 15 + 30 days = Feb 14)
  const result = calculateDueDate(docDate, 'net', 30);

  // Then: Result is correctly cross-month into February
  assert.equal(result, '2026-02-14');
});

test('TC-CALC-N-03: calculateDueDate with month_end 0 days returns end of document month', () => {
  // Given: Document date '2026-01-15', terms type 'month_end', 0 days
  const docDate = '2026-01-15';

  // When: calculateDueDate is invoked
  const result = calculateDueDate(docDate, 'month_end', 0);

  // Then: Returns the last day of January
  assert.equal(result, '2026-01-31');
});

test('TC-CALC-N-04: calculateDueDate with month_end 30 days in common year (2026)', () => {
  // Given: Document date '2026-01-15', terms type 'month_end', 30 days (2026 is common year, Feb has 28 days)
  const docDate = '2026-01-15';

  // When: calculateDueDate is invoked (2026-01-31 + 30 days = 2026-03-02)
  const result = calculateDueDate(docDate, 'month_end', 30);

  // Then: Result is '2026-03-02' as defined in acceptance criteria
  assert.equal(result, '2026-03-02');
});

test('TC-CALC-B-01: Leap year boundary - 2028-01-01 month_end 29 days lands on 2028-02-29', () => {
  // Given: Document date '2028-01-01' (2028 is leap year, Feb has 29 days), month_end, 29 days
  const docDate = '2028-01-01';

  // When: calculateDueDate is invoked (2028-01-31 + 29 days)
  const result = calculateDueDate(docDate, 'month_end', 29);

  // Then: Exactly lands on leap year February 29th
  assert.equal(result, '2028-02-29');
});

test('TC-CALC-B-02: Common year boundary - 2027-01-01 month_end 29 days lands on 2027-03-01', () => {
  // Given: Document date '2027-01-01' (2027 is common year, Feb has 28 days), month_end, 29 days
  const docDate = '2027-01-01';

  // When: calculateDueDate is invoked (2027-01-31 + 29 days)
  const result = calculateDueDate(docDate, 'month_end', 29);

  // Then: Lands on March 1st because February has 28 days
  assert.equal(result, '2027-03-01');
});

test('TC-CALC-B-03: Cross-year boundary - 2026-11-15 net 60 days lands on 2027-01-14', () => {
  // Given: Document date '2026-11-15', net 60 days
  const docDate = '2026-11-15';

  // When: calculateDueDate is invoked (15 days in Nov + 31 days in Dec + 14 days in Jan = 60 days)
  const result = calculateDueDate(docDate, 'net', 60);

  // Then: Correctly advances to year 2027
  assert.equal(result, '2027-01-14');
});

test('TC-CALC-B-04: Unconfigured payment terms returns document date and prompts warning', () => {
  // Given: Document date '2026-05-10', payment terms unconfigured (null/empty)
  const docDate = '2026-05-10';

  // When: calculateDueDate is invoked with null payment terms
  const result = calculateDueDate(docDate, null, null);
  const notice = getPaymentTermsNotice(null);

  // Then: Due date equals document date, and notice displays prompt
  assert.equal(result, '2026-05-10');
  assert.equal(notice, '此供應商未設定付款條件');
});

test('TC-CALC-E-01: Invalid date format throws parsing error', () => {
  // Given: Invalid date strings
  const invalid1 = '2026/01/15';
  const invalid2 = 'not-a-date';

  // When / Then: parseDate throws descriptive error
  assert.throws(() => parseDate(invalid1), /format/);
  assert.throws(() => parseDate(invalid2), /format/);
});

// ---------------------------------------------------------------------------
// Business Logic and API Validation Tests (PT-01 ~ PT-04)
// ---------------------------------------------------------------------------

test('TC-PT-N-01: Create and update vendor with payment terms successfully', async () => {
  // Given: Authenticated user and new vendor
  await ensureAuthenticated();
  const vendorName = `供應商_PT01_${Date.now()}`;

  // When: createPartnerAction is called with isVendor=true, net 30
  const created = await createPartnerAction({
    name: vendorName,
    isVendor: true,
    isCustomer: false,
    payment_terms_type: 'net',
    payment_terms_days: 30
  });

  // Then: Saved with net 30
  assert.equal(created.is_vendor, true);
  assert.equal(created.payment_terms_type, 'net');
  assert.equal(created.payment_terms_days, 30);

  // When: updatePartnerAction updates to month_end 60
  const updated = await updatePartnerAction({
    id: created.id,
    payment_terms_type: 'month_end',
    payment_terms_days: 60
  });

  // Then: Successfully updated
  assert.equal(updated.payment_terms_type, 'month_end');
  assert.equal(updated.payment_terms_days, 60);
});

test('TC-PT-N-02 & TC-PT-N-03: Boundary values 0 and 365 days succeed', async () => {
  // Given: Authenticated user
  await ensureAuthenticated();

  // When: Creating vendor with month_end 0 days (boundary: 0)
  const v1 = await createPartnerAction({
    name: `廠商_邊界0_${Date.now()}`,
    isVendor: true,
    payment_terms_type: 'month_end',
    payment_terms_days: 0
  });

  // Then: Succeeds with 0 days
  assert.equal(v1.payment_terms_type, 'month_end');
  assert.equal(v1.payment_terms_days, 0);

  // When: Creating vendor with net 365 days (boundary: 365)
  const v2 = await createPartnerAction({
    name: `廠商_邊界365_${Date.now()}`,
    isVendor: true,
    payment_terms_type: 'net',
    payment_terms_days: 365
  });

  // Then: Succeeds with 365 days
  assert.equal(v2.payment_terms_type, 'net');
  assert.equal(v2.payment_terms_days, 365);
});

test('TC-PT-N-04: Default unconfigured payment terms has null values', async () => {
  // Given: Authenticated user
  await ensureAuthenticated();

  // When: Creating vendor without specifying payment terms
  const vendor = await createPartnerAction({
    name: `無條件廠商_${Date.now()}`,
    isVendor: true
  });

  // Then: payment terms fields are null
  assert.equal(vendor.payment_terms_type, null);
  assert.equal(vendor.payment_terms_days, null);
});

test('TC-PT-N-05: Clearing payment terms resets fields to null', async () => {
  // Given: Vendor with existing payment terms
  await ensureAuthenticated();
  const vendor = await createPartnerAction({
    name: `待清空廠商_${Date.now()}`,
    isVendor: true,
    payment_terms_type: 'net',
    payment_terms_days: 30
  });
  assert.equal(vendor.payment_terms_type, 'net');

  // When: updatePartnerAction is called with clear_payment_terms: true
  const cleared = await updatePartnerAction({
    id: vendor.id,
    clear_payment_terms: true
  });

  // Then: payment terms are cleared to null
  assert.equal(cleared.payment_terms_type, null);
  assert.equal(cleared.payment_terms_days, null);
});

test('TC-PT-E-01: PT-01 error when type is specified without days', async () => {
  // Given: Authenticated user
  await ensureAuthenticated();

  // When / Then: createPartnerAction throws PT-01 validation error
  await assert.rejects(
    async () => {
      await createPartnerAction({
        name: `錯誤廠商_缺天數_${Date.now()}`,
        isVendor: true,
        payment_terms_type: 'net'
      });
    },
    /付款條件類型與天數需同時設定/
  );
});

test('TC-PT-E-02: PT-01 error when days is specified without type', async () => {
  // Given: Authenticated user
  await ensureAuthenticated();

  // When / Then: createPartnerAction throws PT-01 validation error
  await assert.rejects(
    async () => {
      await createPartnerAction({
        name: `錯誤廠商_缺類型_${Date.now()}`,
        isVendor: true,
        payment_terms_days: 30
      });
    },
    /付款條件類型與天數需同時設定/
  );
});

test('TC-PT-E-03: PT-02 error when payment terms type is invalid', async () => {
  // Given: Authenticated user
  await ensureAuthenticated();

  // When / Then: createPartnerAction throws PT-02 type error
  await assert.rejects(
    async () => {
      await createPartnerAction({
        name: `錯誤廠商_非法類型_${Date.now()}`,
        isVendor: true,
        payment_terms_type: 'quarterly',
        payment_terms_days: 30
      });
    },
    /付款條件類型需為 net 或 month_end/
  );
});

test('TC-PT-E-04: PT-02 error when days is negative (-1)', async () => {
  // Given: Authenticated user
  await ensureAuthenticated();

  // When / Then: createPartnerAction throws PT-02 days range error
  await assert.rejects(
    async () => {
      await createPartnerAction({
        name: `錯誤廠商_負數天數_${Date.now()}`,
        isVendor: true,
        payment_terms_type: 'net',
        payment_terms_days: -1
      });
    },
    /付款天數需為 0～365 的整數/
  );
});

test('TC-PT-E-05: PT-02 error when days exceeds 365 (366)', async () => {
  // Given: Authenticated user
  await ensureAuthenticated();

  // When / Then: createPartnerAction throws PT-02 days range error
  await assert.rejects(
    async () => {
      await createPartnerAction({
        name: `錯誤廠商_超長天數_${Date.now()}`,
        isVendor: true,
        payment_terms_type: 'net',
        payment_terms_days: 366
      });
    },
    /付款天數需為 0～365 的整數/
  );
});

test('TC-PT-E-06: PT-03 error when non-vendor attempts to configure payment terms', async () => {
  // Given: Customer only (is_vendor = false)
  await ensureAuthenticated();

  // When / Then: Setting payment terms for customer fails with PT-03 error
  await assert.rejects(
    async () => {
      await createPartnerAction({
        name: `純客戶_嘗試設定條件_${Date.now()}`,
        isCustomer: true,
        isVendor: false,
        payment_terms_type: 'net',
        payment_terms_days: 30
      });
    },
    /僅供應商可設定付款條件/
  );

  // When / Then: Updating existing customer with payment terms also fails
  const cust = await createPartnerAction({
    name: `現有純客戶_${Date.now()}`,
    isCustomer: true,
    isVendor: false
  });

  await assert.rejects(
    async () => {
      await updatePartnerAction({
        id: cust.id,
        payment_terms_type: 'net',
        payment_terms_days: 30
      });
    },
    /僅供應商可設定付款條件/
  );
});

