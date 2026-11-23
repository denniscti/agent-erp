/**
 * @file issue219-collection-terms.test.js
 * @description Automated test suite for Issue #219: Customer Collection Terms, Invoice Issuance Mode,
 * Business Request Note, and Customer Credit Workspace.
 *
 * ## Test Perspective Table (Equivalence Partitioning & Boundary Values)
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-CT-N-01 | 客戶設定 `type: 'net', days: 30, mode: 'per_order'` | Equivalence – 正常設定 net 條件與逐單開票 | 成功建立/更新，回傳對應欄位值 | 客戶基本正常情境 |
 * | TC-CT-N-02 | 客戶設定 `type: 'month_end', days: 0, mode: 'monthly_consolidated'` | Boundary – month_end 0 天 (當月月底) + 月結彙開 | 成功設定，days=0，mode='monthly_consolidated' | 邊界值：0 天 |
 * | TC-CT-N-03 | 客戶設定 `type: 'net', days: 365` | Boundary – 最大天數 365 天 | 成功設定，days=365 | 邊界值：365 天 |
 * | TC-CT-N-04 | 建立或更新時收款條件皆為 null / undefined | Equivalence – 未設定收款條件 | 欄位為 NULL，invoice_issuance_mode 預設為 per_order | 預設未設定 |
 * | TC-CT-N-05 | 業務填寫 `requested_collection_terms_note` 任意備註文字 | Equivalence – 業務申請備註存檔 | 備註成功存檔，不強制驗證值域 | 業務申請情境 |
 * | TC-CT-N-06 | 財務清除已設定的收款條件 (`clear_collection_terms = true`) | Equivalence – 清除收款條件 | `collection_terms_type` 與 `days` 重設為 NULL | 清除功能 |
 * | TC-CT-N-07 | 雙重身分夥伴（`is_customer=1 && is_vendor=1`）分別設定兩組條件 | Equivalence – 雙重身份互不覆蓋 | 付款條件與收款條件各自獨立更新與持久化，互不覆蓋 | 核心價值驗證 |
 * | TC-CT-E-01 | 設定 `type: 'net'`, 但 `days` 為 null / 空 | Equivalence – CT-01: 僅有 type 無 days | 拋出錯誤：「收款條件類型與天數需同時設定」 | CT-01 驗證 |
 * | TC-CT-E-02 | 設定 `days: 30`, 但 `type` 為 null / 空 | Equivalence – CT-01: 僅有 days 無 type | 拋出錯誤：「收款條件類型與天數需同時設定」 | CT-01 驗證 |
 * | TC-CT-E-03 | 非客戶（純供應商 `is_customer=0`）嘗試設定收款條件 | Equivalence – CT-02: 非客戶設定限制 | 拋出錯誤：「僅客戶可設定收款條件」 | CT-02 角色防護 |
 * | TC-CT-E-04 | 設定 `type: 'quarterly', days: 30` | Boundary – CT-03: 非法收款類型 | 拋出錯誤：「收款條件類型需為 net 或 month_end」 | CT-03 類型驗證 |
 * | TC-CT-E-05 | 設定 `days: -1` | Boundary – CT-04: 負數天數 | 拋出錯誤：「收款天數需為 0～365 的整數」 | 邊界值：-1 |
 * | TC-CT-E-06 | 設定 `days: 366` | Boundary – CT-04: 超過上限天數 | 拋出錯誤：「收款天數需為 0～365 的整數」 | 邊界值：366 |
 * | TC-CT-E-07 | 非客戶（純供應商 `is_customer=0`）嘗試設定開票模式 | Equivalence – CT-05: 非客戶設定限制 | 拋出錯誤：「僅客戶可設定開票模式」 | CT-05 角色防護 |
 * | TC-CT-E-08 | 設定非法開票模式值 `mode: 'yearly'` | Boundary – CT-05: 非法開票模式 | 拋出錯誤：「開票模式需為 per_order 或 monthly_consolidated」 | CT-05 值域驗證 |
 * | TC-CT-B-01 | `invoice_issuance_mode` 傳入 null / undefined / 空字串 | Boundary – CT-06: 開票模式清空回退 | 自動正規化為 `'per_order'` | CT-06 預設回退 |
 * | TC-CALC-SHARED | 驗證後端與前端共用 `calculate_due_date` | Equivalence – 共用邏輯驗證 | 傳入客戶/供應商條件皆能正確推算到期日 | 跨模組共用 |
 * | TC-UI-NOTE-NOTIF | 業務在客戶資料更新備註並存檔 | Equivalence – Layer 2: 站內通知觸發 | 呼叫 `window.__SHELL__.notify`，target 指向 `customer-credit` | 整合情境 |
 * | TC-UI-CREDIT-01 | 財務進入「客戶信用」畫面與通知提示 | Equivalence – Layer 2: 獨立工作區 | 成功解析路由與提示字串；未設定時顯示提示 | 財務工作區 |
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Polyfill Svelte 5 $state rune for Node.js test environment if not defined
if (typeof globalThis.$state === 'undefined') {
  globalThis.$state = (v) => v;
}
if (typeof globalThis.$derived === 'undefined') {
  globalThis.$derived = (fn) => typeof fn === 'function' ? fn() : fn;
}
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const routesPath = path.join(rootDir, 'src/lib/routes.js');
const routesDir = path.dirname(routesPath);
let routesSource = fs.readFileSync(routesPath, 'utf-8');
routesSource = routesSource.replace(/import\s+(\w+)\s+from\s+['"]([^'"]+\.json)['"];/g, (_, varName, relPath) => {
  const jsonContent = fs.readFileSync(path.resolve(routesDir, relPath), 'utf-8');
  return `const ${varName} = ${jsonContent.trim()};`;
});
const routesDataUri = `data:text/javascript;base64,${Buffer.from(routesSource).toString('base64')}`;
const { getRoute } = await import(routesDataUri);

const {
  calculateDueDate,
  getPaymentTermsNotice,
  getCollectionTermsNotice
} = await import('../src/lib/terms.js');

const {
  calculateDueDate: compatCalculateDueDate
} = await import('../src/lib/paymentTerms.js');

const {
  createPartnerAction,
  updatePartnerAction,
  fetchPartners,
  login,
  appState,
  dispatchNotification,
  dismissNotification
} = await import('../src/lib/store.svelte.js');

async function ensureAuthenticated() {
  await login('admin@example.com', 'password123');
}

// ---------------------------------------------------------------------------
// 1. Layer 1: Normal Cases & Functional Behavior
// ---------------------------------------------------------------------------

test('TC-CT-N-01: Create customer with collection terms net 30 and per_order invoice mode', async () => {
  // Given: Authenticated user and customer data with collection terms and invoice mode
  await ensureAuthenticated();
  const name = `客戶_N01_${Date.now()}`;

  // When: Creating partner with customer collection terms
  const partner = await createPartnerAction({
    name,
    is_customer: true,
    is_vendor: false,
    collection_terms_type: 'net',
    collection_terms_days: 30,
    invoice_issuance_mode: 'per_order'
  });

  // Then: Partner is created with collection terms and invoice issuance mode
  assert.equal(partner.is_customer, true);
  assert.equal(partner.collection_terms_type, 'net');
  assert.equal(partner.collection_terms_days, 30);
  assert.equal(partner.invoice_issuance_mode, 'per_order');
});

test('TC-CT-N-02 & TC-CT-N-03: Boundary values 0 days (month_end) and 365 days (net) succeed', async () => {
  // Given: Authenticated user
  await ensureAuthenticated();

  // When: Creating customer with month_end 0 days (boundary: 0) and monthly_consolidated mode
  const c0 = await createPartnerAction({
    name: `客戶_BND0_${Date.now()}`,
    is_customer: true,
    is_vendor: false,
    collection_terms_type: 'month_end',
    collection_terms_days: 0,
    invoice_issuance_mode: 'monthly_consolidated'
  });

  // Then: Boundaries are preserved
  assert.equal(c0.collection_terms_type, 'month_end');
  assert.equal(c0.collection_terms_days, 0);
  assert.equal(c0.invoice_issuance_mode, 'monthly_consolidated');

  // When: Creating customer with net 365 days (boundary: 365)
  const c365 = await createPartnerAction({
    name: `客戶_BND365_${Date.now()}`,
    is_customer: true,
    is_vendor: false,
    collection_terms_type: 'net',
    collection_terms_days: 365
  });

  // Then: Boundary 365 is preserved and invoice mode defaults to per_order (CT-06)
  assert.equal(c365.collection_terms_type, 'net');
  assert.equal(c365.collection_terms_days, 365);
  assert.equal(c365.invoice_issuance_mode, 'per_order');
});

test('TC-CT-N-04: Default unconfigured collection terms has null values and per_order mode', async () => {
  // Given: Authenticated user creating customer without collection terms
  await ensureAuthenticated();
  const name = `客戶_預設_${Date.now()}`;

  // When: Creating partner without specifying collection terms
  const partner = await createPartnerAction({
    name,
    is_customer: true,
    is_vendor: false
  });

  // Then: Collection terms are null and invoice mode is per_order
  assert.equal(partner.collection_terms_type, null);
  assert.equal(partner.collection_terms_days, null);
  assert.equal(partner.requested_collection_terms_note, null);
  assert.equal(partner.invoice_issuance_mode, 'per_order');
});

test('TC-CT-N-05: Business requested collection terms note is preserved as free text', async () => {
  // Given: Customer with requested note from business
  await ensureAuthenticated();
  const name = `客戶_備註_${Date.now()}`;
  const note = '業務反映客戶為上市櫃集團，要求月結 45 天';

  // When: Creating customer with note
  const partner = await createPartnerAction({
    name,
    is_customer: true,
    is_vendor: false,
    requested_collection_terms_note: note
  });

  // Then: Note is preserved exactly
  assert.equal(partner.requested_collection_terms_note, note);
});

test('TC-CT-N-06: Clearing collection terms resets fields to null', async () => {
  // Given: Customer with existing collection terms
  await ensureAuthenticated();
  const partner = await createPartnerAction({
    name: `客戶_清空_${Date.now()}`,
    is_customer: true,
    is_vendor: false,
    collection_terms_type: 'net',
    collection_terms_days: 30
  });

  // When: Updating with clear_collection_terms: true
  const updated = await updatePartnerAction({
    id: partner.id,
    clear_collection_terms: true
  });

  // Then: Collection terms are reset to null
  assert.equal(updated.collection_terms_type, null);
  assert.equal(updated.collection_terms_days, null);
});

test('TC-CT-N-07: Dual identity partner has independent payment terms and collection terms without overwriting', async () => {
  // Given: Partner that is both customer and vendor
  await ensureAuthenticated();
  const partner = await createPartnerAction({
    name: `雙重身分夥伴_${Date.now()}`,
    is_customer: true,
    is_vendor: true,
    payment_terms_type: 'net',
    payment_terms_days: 30,
    collection_terms_type: 'month_end',
    collection_terms_days: 15,
    requested_collection_terms_note: '業務初期洽談備註',
    invoice_issuance_mode: 'monthly_consolidated'
  });

  // Then: Both sets of terms are recorded independently
  assert.equal(partner.payment_terms_type, 'net');
  assert.equal(partner.payment_terms_days, 30);
  assert.equal(partner.collection_terms_type, 'month_end');
  assert.equal(partner.collection_terms_days, 15);
  assert.equal(partner.invoice_issuance_mode, 'monthly_consolidated');

  // When: Updating ONLY collection terms
  const updatedCol = await updatePartnerAction({
    id: partner.id,
    collection_terms_type: 'net',
    collection_terms_days: 60
  });

  // Then: Collection terms updated, vendor payment terms remain unchanged
  assert.equal(updatedCol.collection_terms_type, 'net');
  assert.equal(updatedCol.collection_terms_days, 60);
  assert.equal(updatedCol.payment_terms_type, 'net');
  assert.equal(updatedCol.payment_terms_days, 30);

  // When: Updating ONLY vendor payment terms
  const updatedPay = await updatePartnerAction({
    id: partner.id,
    payment_terms_type: 'month_end',
    payment_terms_days: 45
  });

  // Then: Vendor payment terms updated, customer collection terms remain unchanged
  assert.equal(updatedPay.payment_terms_type, 'month_end');
  assert.equal(updatedPay.payment_terms_days, 45);
  assert.equal(updatedPay.collection_terms_type, 'net');
  assert.equal(updatedPay.collection_terms_days, 60);
});

// ---------------------------------------------------------------------------
// 2. Layer 1: Error & Boundary Cases (CT-01 ~ CT-06)
// ---------------------------------------------------------------------------

test('TC-CT-E-01: CT-01 error when type is specified without days', async () => {
  // Given: Customer setting type without days
  await ensureAuthenticated();

  // When & Then: Throws CT-01 validation error
  await assert.rejects(
    async () => {
      await createPartnerAction({
        name: `錯誤_CT01_${Date.now()}`,
        is_customer: true,
        collection_terms_type: 'net'
      });
    },
    (err) => {
      assert.match(err.message, /收款條件類型與天數需同時設定/);
      return true;
    }
  );
});

test('TC-CT-E-02: CT-01 error when days is specified without type', async () => {
  // Given: Customer setting days without type
  await ensureAuthenticated();

  // When & Then: Throws CT-01 validation error
  await assert.rejects(
    async () => {
      await createPartnerAction({
        name: `錯誤_CT01_days_${Date.now()}`,
        is_customer: true,
        collection_terms_days: 30
      });
    },
    (err) => {
      assert.match(err.message, /收款條件類型與天數需同時設定/);
      return true;
    }
  );
});

test('TC-CT-E-03: CT-02 error when non-customer attempts to set collection terms', async () => {
  // Given: Pure vendor (is_customer = false)
  await ensureAuthenticated();

  // When & Then: Throws CT-02 validation error
  await assert.rejects(
    async () => {
      await createPartnerAction({
        name: `純供應商_非客戶_${Date.now()}`,
        is_customer: false,
        is_vendor: true,
        collection_terms_type: 'net',
        collection_terms_days: 30
      });
    },
    (err) => {
      assert.match(err.message, /僅客戶可設定收款條件/);
      return true;
    }
  );
});

test('TC-CT-E-04: CT-03 error when collection terms type is invalid', async () => {
  // Given: Customer with invalid type
  await ensureAuthenticated();

  // When & Then: Throws CT-03 validation error
  await assert.rejects(
    async () => {
      await createPartnerAction({
        name: `非法類型_${Date.now()}`,
        is_customer: true,
        collection_terms_type: 'quarterly',
        collection_terms_days: 30
      });
    },
    (err) => {
      assert.match(err.message, /收款條件類型需為 net 或 month_end/);
      return true;
    }
  );
});

test('TC-CT-E-05: CT-04 boundary error when days is negative (-1)', async () => {
  // Given: Customer with negative days
  await ensureAuthenticated();

  // When & Then: Throws CT-04 validation error
  await assert.rejects(
    async () => {
      await createPartnerAction({
        name: `負數天數_${Date.now()}`,
        is_customer: true,
        collection_terms_type: 'net',
        collection_terms_days: -1
      });
    },
    (err) => {
      assert.match(err.message, /收款天數需為 0～365 的整數/);
      return true;
    }
  );
});

test('TC-CT-E-06: CT-04 boundary error when days exceeds 365 (366)', async () => {
  // Given: Customer with days = 366
  await ensureAuthenticated();

  // When & Then: Throws CT-04 validation error
  await assert.rejects(
    async () => {
      await createPartnerAction({
        name: `超長天數_${Date.now()}`,
        is_customer: true,
        collection_terms_type: 'net',
        collection_terms_days: 366
      });
    },
    (err) => {
      assert.match(err.message, /收款天數需為 0～365 的整數/);
      return true;
    }
  );
});

test('TC-CT-E-07: CT-05 error when non-customer attempts to set invoice_issuance_mode', async () => {
  // Given: Pure vendor attempting to set invoice_issuance_mode
  await ensureAuthenticated();

  // When & Then: Throws CT-05 error
  await assert.rejects(
    async () => {
      await createPartnerAction({
        name: `純供應商_開票_${Date.now()}`,
        is_customer: false,
        is_vendor: true,
        invoice_issuance_mode: 'per_order'
      });
    },
    (err) => {
      assert.match(err.message, /僅客戶可設定開票模式/);
      return true;
    }
  );
});

test('TC-CT-E-08: CT-05 error when invoice_issuance_mode is invalid value', async () => {
  // Given: Customer setting invalid mode 'yearly'
  await ensureAuthenticated();

  // When & Then: Throws CT-05 error
  await assert.rejects(
    async () => {
      await createPartnerAction({
        name: `非法開票模式_${Date.now()}`,
        is_customer: true,
        invoice_issuance_mode: 'yearly'
      });
    },
    (err) => {
      assert.match(err.message, /開票模式需為 per_order 或 monthly_consolidated/);
      return true;
    }
  );
});

test('TC-CT-B-01: CT-06 empty invoice_issuance_mode defaults or normalizes to per_order', async () => {
  // Given: Customer updated with empty invoice_issuance_mode
  await ensureAuthenticated();
  const customer = await createPartnerAction({
    name: `開票模式回退_${Date.now()}`,
    is_customer: true,
    invoice_issuance_mode: 'monthly_consolidated'
  });
  assert.equal(customer.invoice_issuance_mode, 'monthly_consolidated');

  // When: Updating with empty string
  const updated = await updatePartnerAction({
    id: customer.id,
    invoice_issuance_mode: ''
  });

  // Then: Reverts to per_order (CT-06)
  assert.equal(updated.invoice_issuance_mode, 'per_order');
});

// ---------------------------------------------------------------------------
// 3. Shared Due Date Calculation & Integration
// ---------------------------------------------------------------------------

test('TC-CALC-SHARED: terms.js and paymentTerms.js share identical due date calculations', () => {
  // Given: Document date and conditions
  const docDate = '2026-03-10';

  // When: Calculating with terms.js and paymentTerms.js
  const d1 = calculateDueDate(docDate, 'net', 30);
  const d1Compat = compatCalculateDueDate(docDate, 'net', 30);
  const d2 = calculateDueDate(docDate, 'month_end', 15);
  const d2Compat = compatCalculateDueDate(docDate, 'month_end', 15);

  // Then: Results match exact expected dates
  assert.equal(d1, '2026-04-09');
  assert.equal(d1Compat, '2026-04-09');
  assert.equal(d2, '2026-04-15'); // 2026-03-31 + 15 = 2026-04-15
  assert.equal(d2Compat, '2026-04-15');
});

test('TC-UI-CREDIT-01: Notice helper and route resolution for Customer Credit Workspace', () => {
  // Given: Route key
  const route = getRoute('customer-credit');

  // When & Then: Route resolves correctly to Customer Credit workspace
  assert.equal(route.id, 'customer-credit');
  assert.equal(route.path, '/app/customer-credit');
  assert.equal(route.label, '客戶信用');

  // When & Then: Notice helper displays appropriate reminder
  assert.equal(getCollectionTermsNotice(null), '此客戶未設定收款條件');
  assert.equal(getCollectionTermsNotice('net'), null);
  assert.equal(getPaymentTermsNotice(null), '此供應商未設定付款條件');
});

test('TC-NOTIF-01: window.__SHELL__.notify writes alert notification with action to appState.notifications', () => {
  // Given: Initial notifications state and window.__SHELL__ API adhering to notification_system.md
  assert.ok(globalThis.window.__SHELL__, 'window.__SHELL__ must be defined');
  assert.equal(typeof globalThis.window.__SHELL__.notify, 'function', 'window.__SHELL__.notify must be a function');
  const initialCount = appState.notifications.length;

  // When: Calling window.__SHELL__.notify with Issue #219 alert payload
  const notifId = globalThis.window.__SHELL__.notify({
    type: 'alert',
    title: '客戶收款條件申請',
    message: '測試客戶_123 有新的收款條件申請備註',
    sourceModule: 'partners',
    action: {
      label: '查看客戶信用',
      target: 'customer-credit'
    }
  });

  // Then: Notification is prepended to appState.notifications with action target customer-credit
  assert.ok(notifId, 'notify must return a notification ID');
  assert.equal(appState.notifications.length, initialCount + 1);
  const latest = appState.notifications[0];
  assert.equal(latest.id, notifId);
  assert.equal(latest.title, '客戶收款條件申請');
  assert.equal(latest.type, 'alert');
  assert.equal(latest.sourceModule, 'partners');
  assert.deepEqual(latest.action, { label: '查看客戶信用', target: 'customer-credit' });

  // And When: Calling window.__SHELL__.dismiss(notifId)
  globalThis.window.__SHELL__.dismiss(notifId);

  // Then: Notification is dismissed
  assert.equal(appState.notifications.length, initialCount);
});

test('TC-NOTIF-02: dispatchNotification and dismissNotification correctly add and remove notifications', () => {
  // Given: Clean state
  const prevCount = appState.notifications.length;

  // When: Dispatching notification via store action
  const id = dispatchNotification({
    type: 'warning',
    title: '信用預警',
    message: '客戶即將超過授信額度',
    action: { label: '查看客戶信用', target: 'customer-credit' }
  });

  // Then: appState.notifications has the item
  assert.equal(appState.notifications.length, prevCount + 1);
  assert.equal(appState.notifications[0].id, id);
  assert.equal(appState.notifications[0].type, 'warning');

  // When: Dismissing
  dismissNotification(id);
  assert.equal(appState.notifications.length, prevCount);
});
