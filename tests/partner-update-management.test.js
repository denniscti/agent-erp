/**
 * @file partner-update-management.test.js
 * @description Test suite for Partner Data Editing, Tax ID Registration/Update, and Duplicate Validation (Issue #147).
 *
 * ## Test Perspective Table (Equivalence Partitioning & Boundary Values)
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-PART-POS-01 | 原夥伴無統編，輸入有效 8 碼統編 | Equivalence – 補登統編 | 成功更新 tax_id，updated_at 更新 | 補登欄位 |
 * | TC-PART-POS-02 | 原夥伴已有舊統編，更新為新統編 | Equivalence – 覆蓋統編 | 成功覆蓋為新統編 | 欄位更新 |
 * | TC-PART-POS-03 | 原名「聯發科」，更新為「聯發科技」 | Equivalence – 修改名稱 | 成功更名，統編與其他欄位維持原值 | 排除未更新欄位異動 |
 * | TC-PART-POS-04 | 輸入名稱及統編帶前後空白 | Equivalence – 空白修剪 | 自動修剪（Trim）後儲存 | 資料正規化 |
 * | TC-PART-POS-05 | 輸入空字串 "" 或純空白 " " | Equivalence – 清空統編 | tax_id 正規化為 NULL | 清空欄位 |
 * | TC-PART-POS-06 | 更新時送出與自身原本相同的名稱或統編 | Equivalence – 排除自身查重 | 不判定為重複，更新成功 | 排除自身 ID |
 * | TC-PART-NEG-01 | 輸入 7 碼數字 1234567 或 9 碼數字 | Equivalence – 統編格式錯誤 | 拋出 8 碼統編格式驗證錯誤 | 格式防護 |
 * | TC-PART-NEG-02 | 輸入 2209913A 或特殊符號 | Equivalence – 統編包含非數字 | 拋出 8 碼統編格式驗證錯誤 | 格式防護 |
 * | TC-PART-NEG-03 | 輸入空字串 "" 作為新名稱 | Equivalence – 名稱為空 | 拋出名稱不能為空錯誤 | 必填防護 |
 * | TC-PART-NEG-04 | 同租戶內已存在同名夥伴（大小寫不敏感） | Equivalence – 名稱重複 (Create) | create_partner 拋出名稱已存在錯誤 | 既有健全性 |
 * | TC-PART-NEG-05 | 同租戶內已有夥伴使用統編 | Equivalence – 統編重複 (Create) | create_partner 拋出統編已存在錯誤 | 補齊建立查重缺口 |
 * | TC-PART-NEG-06 | 更新名稱為同租戶其他夥伴之名稱 | Equivalence – 名稱重複 (Update) | update_partner 拋出名稱已存在錯誤 | 更新查重 |
 * | TC-PART-NEG-07 | 更新統編為同租戶其他夥伴已使用之統編 | Equivalence – 統編重複 (Update) | update_partner 拋出統編已存在錯誤 | 更新查重 |
 * | TC-PART-NEG-08 | 傳入不存在之 partner_id | Equivalence – 查無夥伴 ID | 拋出 Partner not found | 存在性防護 |
 * | TC-PART-BND-01 | 租戶 A 與租戶 B 建立同名夥伴 | Boundary – 跨租戶隔離（同名稱） | 兩租戶各自成功，互不干涉（依賴 #149） | 多租戶隔離 |
 * | TC-PART-BND-02 | 租戶 A 與租戶 B 填寫相同統編 | Boundary – 跨租戶隔離（同統編） | 兩租戶各自成功，互不干涉（依賴 #149） | 多租戶隔離 |
 * | TC-PART-BND-03 | 租戶 A 試圖以 ID 更新租戶 B 的夥伴 | Boundary – 跨租戶枚舉防禦 | 回傳 Partner not found，禁止跨租戶操作 | 橫向越權防禦 |
 * | TC-PART-WF-01 | 輸入「幫台積電補上統編 22099131」 | Workflow – AI 參數抽取與確認 | 正確抽取參數並展示待確認卡片 | 自然語言理解 |
 * | TC-PART-WF-02 | 使用者點擊「取消」或輸入取消 | Workflow – AI 確認卡片取消 | 安全取消，不發起 IPC 更新 | 人在迴圈 |
 * | TC-PART-WF-03 | 多筆夥伴包含關鍵字 vs 完全相符 | Workflow – 精確比對優先與模糊多筆拒絕 | 精確比對命中唯一回傳；模糊命中多筆拋出明確錯誤 | 防誤判核心 |
 * | TC-PART-WF-04 | execute() 傳入同租戶多筆互相包含名稱 | Workflow – 執行前目標唯一性檢驗 | 拋出找到多筆錯誤，拒絕靜默選取首筆 | 防誤判核心 |
 * | TC-PART-WF-05 | 補登統編觸發確認卡片 | Workflow – HITL 卡片呈現 before/after diff | 卡片顯示真實記錄名稱與「目前統編 ➔ 變更後」比對 | HITL 可信賴 |
 * | TC-PART-WF-06 | 夥伴更名觸發確認卡片 | Workflow – HITL 卡片更名比對 | 卡片顯示「原名稱 ➔ 變更後」比對 | HITL 可信賴 |
 * | TC-PART-WF-07 | 對話意圖目標名稱命中同租戶多筆夥伴 | Workflow – 預檢階段攔截模糊歧義 | runAgentTurn 回傳錯誤阻止卡片生成 | 防呆前置攔截 |
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Polyfill Svelte 5 $state rune for Node.js test environment if not defined
if (typeof globalThis.$state === 'undefined') {
  globalThis.$state = (v) => v;
}

const {
  appState,
  fetchPartners,
  createPartnerAction,
  updatePartnerAction,
  login,
  selectTenantAction
} = await import('../src/lib/store.svelte.js');

const {
  matchPartnerTarget,
  updatePartnerToolHandler,
  customerCreateBasicProfileAgentProfile,
  runAgentTurn,
  executeConfirmation,
  executeCancellation
} = await import('../src/lib/workflow/index.js');

const { invoke } = await import('../src/lib/tauri.js');

// Helper to ensure authenticated state in test suite
async function ensureAuthenticated() {
  await login('admin@example.com', 'password123');
}

// Helper to generate distinct 8-digit tax ID that doesn't conflict with pre-seeded mock records
function genTaxId() {
  return String(Math.floor(30000000 + Math.random() * 60000000));
}

test('TC-PART-POS-01: Update tax_id successfully for partner without existing tax_id', async () => {
  // Given: Pre-existing customer without tax ID
  await ensureAuthenticated();
  const custName = `客戶_POS01_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const created = await createPartnerAction(custName);
  assert.equal(created.tax_id, null);

  const newTax = genTaxId();

  // When: updatePartnerAction is called with valid 8-digit tax ID
  const updated = await updatePartnerAction({
    id: created.id,
    taxId: newTax
  });

  // Then: tax_id is successfully updated
  assert.equal(updated.id, created.id);
  assert.equal(updated.name, custName);
  assert.equal(updated.tax_id, newTax);

  const partners = await fetchPartners();
  const found = partners.find(p => p.id === created.id);
  assert.ok(found);
  assert.equal(found.tax_id, newTax);
});

test('TC-PART-POS-02: Overwrite existing tax_id with new valid tax_id', async () => {
  // Given: Partner with old tax ID
  await ensureAuthenticated();
  const custName = `客戶_POS02_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const oldTax = genTaxId();
  const created = await createPartnerAction({
    name: custName,
    taxId: oldTax
  });
  assert.equal(created.tax_id, oldTax);

  const newTax = genTaxId();

  // When: updatePartnerAction overwrites with new tax ID
  const updated = await updatePartnerAction({
    id: created.id,
    taxId: newTax
  });

  // Then: tax_id is replaced with new tax ID
  assert.equal(updated.tax_id, newTax);
  assert.equal(updated.name, custName);
});

test('TC-PART-POS-03: Update name only preserves tax_id and other fields', async () => {
  // Given: Partner with name and tax ID
  await ensureAuthenticated();
  const oldName = `聯發科_${Date.now()}`;
  const newName = `聯發科技_${Date.now()}`;
  const taxId = genTaxId();
  const created = await createPartnerAction({
    name: oldName,
    taxId
  });

  // When: Updating name only (taxId not passed)
  const updated = await updatePartnerAction({
    id: created.id,
    name: newName
  });

  // Then: Name is updated, other fields are unchanged
  assert.equal(updated.name, newName);
  assert.equal(updated.tax_id, taxId);
  assert.equal(updated.is_customer, true);
});

test('TC-PART-POS-04: Whitespace trimming on name and tax_id during update', async () => {
  // Given: Pre-existing partner
  await ensureAuthenticated();
  const baseName = `華碩_${Date.now()}`;
  const created = await createPartnerAction(baseName);
  const taxId = genTaxId();

  // When: Updating with untrimmed name and untrimmed tax ID
  const updated = await updatePartnerAction({
    id: created.id,
    name: `   ${baseName}_更新   `,
    taxId: `   ${taxId}   `
  });

  // Then: Both values are trimmed
  assert.equal(updated.name, `${baseName}_更新`);
  assert.equal(updated.tax_id, taxId);
});

test('TC-PART-POS-05: Clear tax_id by passing empty string or whitespace', async () => {
  // Given: Partner with tax ID
  await ensureAuthenticated();
  const custName = `台積電_POS05_${Date.now()}`;
  const taxId = genTaxId();
  const created = await createPartnerAction({
    name: custName,
    taxId
  });
  assert.equal(created.tax_id, taxId);

  // When: Updating with empty string
  const updatedEmpty = await updatePartnerAction({
    id: created.id,
    taxId: ''
  });

  // Then: tax_id is cleared to null
  assert.equal(updatedEmpty.tax_id, null);

  // When: Resetting tax_id and clearing with whitespace
  const resetTax = genTaxId();
  await updatePartnerAction({ id: created.id, taxId: resetTax });
  const updatedWs = await updatePartnerAction({
    id: created.id,
    taxId: '   '
  });

  // Then: tax_id is normalized to null
  assert.equal(updatedWs.tax_id, null);
});

test('TC-PART-POS-06: Self-exclusion works when updating with same name and tax_id', async () => {
  // Given: Partner with name and tax ID
  await ensureAuthenticated();
  const custName = `宏碁_POS06_${Date.now()}`;
  const taxId = genTaxId();
  const created = await createPartnerAction({
    name: custName,
    taxId
  });

  // When: Updating with same name and same tax ID
  const updated = await updatePartnerAction({
    id: created.id,
    name: custName,
    taxId
  });

  // Then: Update succeeds without triggering duplicate error
  assert.equal(updated.name, custName);
  assert.equal(updated.tax_id, taxId);
});

test('TC-PART-NEG-01: Tax ID format error (7 digits or 9 digits)', async () => {
  // Given: Pre-existing partner
  await ensureAuthenticated();
  const created = await createPartnerAction(`測試_NEG01_${Date.now()}`);

  // When & Then: 7 digits throws validation error
  await assert.rejects(
    async () => {
      await updatePartnerAction({
        id: created.id,
        taxId: '1234567'
      });
    },
    (err) => {
      assert.match(err.message, /8 碼半形數字/);
      return true;
    }
  );

  // When & Then: 9 digits throws validation error
  await assert.rejects(
    async () => {
      await updatePartnerAction({
        id: created.id,
        taxId: '123456789'
      });
    },
    (err) => {
      assert.match(err.message, /8 碼半形數字/);
      return true;
    }
  );
});

test('TC-PART-NEG-02: Tax ID format error (contains letters or symbols)', async () => {
  // Given: Pre-existing partner
  await ensureAuthenticated();
  const created = await createPartnerAction(`測試_NEG02_${Date.now()}`);

  // When & Then: Letters or symbols throw validation error
  await assert.rejects(
    async () => {
      await updatePartnerAction({
        id: created.id,
        taxId: '2209913A'
      });
    },
    (err) => {
      assert.match(err.message, /8 碼半形數字/);
      return true;
    }
  );

  await assert.rejects(
    async () => {
      await updatePartnerAction({
        id: created.id,
        taxId: '22-99131'
      });
    },
    (err) => {
      assert.match(err.message, /8 碼半形數字/);
      return true;
    }
  );
});

test('TC-PART-NEG-03: Empty name validation error on update', async () => {
  // Given: Pre-existing partner
  await ensureAuthenticated();
  const created = await createPartnerAction(`測試_NEG03_${Date.now()}`);

  // When & Then: Empty name or whitespace throws validation error
  await assert.rejects(
    async () => {
      await updatePartnerAction({
        id: created.id,
        name: ''
      });
    },
    (err) => {
      assert.match(err.message, /合作夥伴名稱不能為空/);
      return true;
    }
  );

  await assert.rejects(
    async () => {
      await updatePartnerAction({
        id: created.id,
        name: '   '
      });
    },
    (err) => {
      assert.match(err.message, /合作夥伴名稱不能為空/);
      return true;
    }
  );
});

test('TC-PART-NEG-04: create_partner duplicate name error', async () => {
  // Given: Partner with specific name exists
  await ensureAuthenticated();
  const name = `重複夥伴_NEG04_${Date.now()}`;
  await createPartnerAction(name);

  // When & Then: Creating duplicate name in same tenant is rejected
  await assert.rejects(
    async () => {
      await createPartnerAction(name);
    },
    (err) => {
      assert.match(err.message, /已存在，請使用不同名稱/);
      return true;
    }
  );
});

test('TC-PART-NEG-05: create_partner duplicate tax_id error', async () => {
  // Given: Partner with unique tax_id exists
  await ensureAuthenticated();
  const uniqueTaxId = genTaxId();
  const name1 = `公司A_NEG05_${Date.now()}`;
  const name2 = `公司B_NEG05_${Date.now()}`;
  await createPartnerAction({
    name: name1,
    taxId: uniqueTaxId
  });

  // When & Then: Creating different company with same tax_id is rejected
  await assert.rejects(
    async () => {
      await createPartnerAction({
        name: name2,
        taxId: uniqueTaxId
      });
    },
    (err) => {
      assert.match(err.message, new RegExp(`統一編號「${uniqueTaxId}」已由其他合作夥伴登記`));
      return true;
    }
  );
});

test('TC-PART-NEG-06: update_partner duplicate name error', async () => {
  // Given: Two distinct partners exist
  await ensureAuthenticated();
  const nameA = `公司A_NEG06_${Date.now()}`;
  const nameB = `公司B_NEG06_${Date.now()}`;
  await createPartnerAction(nameA);
  const pB = await createPartnerAction(nameB);

  // When & Then: Renaming company B to company A is rejected
  await assert.rejects(
    async () => {
      await updatePartnerAction({
        id: pB.id,
        name: nameA
      });
    },
    (err) => {
      assert.match(err.message, /已存在，請使用不同名稱/);
      return true;
    }
  );
});

test('TC-PART-NEG-07: update_partner duplicate tax_id error', async () => {
  // Given: Company A with tax ID and Company B without tax ID
  await ensureAuthenticated();
  const uniqueTax = genTaxId();
  const nameA = `公司A_NEG07_${Date.now()}`;
  const nameB = `公司B_NEG07_${Date.now()}`;
  await createPartnerAction({ name: nameA, taxId: uniqueTax });
  const pB = await createPartnerAction(nameB);

  // When & Then: Setting Company B's tax ID to company A's tax ID is rejected
  await assert.rejects(
    async () => {
      await updatePartnerAction({
        id: pB.id,
        taxId: uniqueTax
      });
    },
    (err) => {
      assert.match(err.message, new RegExp(`統一編號「${uniqueTax}」已由其他合作夥伴登記`));
      return true;
    }
  );
});

test('TC-PART-NEG-08: update_partner non-existent partner ID throws not found', async () => {
  // Given: Non-existent partner ID
  await ensureAuthenticated();

  // When & Then: Updating non-existent ID fails with Partner not found
  await assert.rejects(
    async () => {
      await updatePartnerAction({
        id: 'part_nonexistent_9999',
        name: '新名稱'
      });
    },
    (err) => {
      assert.match(err.message, /Partner not found/);
      return true;
    }
  );
});

test('TC-PART-BND-01: Multi-tenant boundary - same partner name in different tenants succeeds', async () => {
  // Given: User switches to tenant 1 and creates partner
  await ensureAuthenticated();
  await selectTenantAction('tnt_mock_1');
  const sharedName = `跨租戶夥伴_BND01_${Date.now()}`;
  const p1 = await createPartnerAction(sharedName);
  assert.ok(p1.id);

  // When: User switches to tenant 2 and creates partner with same name
  await selectTenantAction('tnt_mock_2');
  const p2 = await createPartnerAction(sharedName);

  // Then: Both succeed independently with different IDs
  assert.ok(p2.id);
  assert.notEqual(p1.id, p2.id);
});

test('TC-PART-BND-02: Multi-tenant boundary - same tax_id in different tenants succeeds', async () => {
  // Given: Tenant 1 creates partner with distinct tax ID
  await ensureAuthenticated();
  await selectTenantAction('tnt_mock_1');
  const taxId = genTaxId();
  const p1 = await createPartnerAction({
    name: `租戶1夥伴_${Date.now()}`,
    taxId
  });
  assert.equal(p1.tax_id, taxId);

  // When: Tenant 2 creates partner with same tax ID
  await selectTenantAction('tnt_mock_2');
  const p2 = await createPartnerAction({
    name: `租戶2夥伴_${Date.now()}`,
    taxId
  });

  // Then: Both succeed independently without conflict
  assert.equal(p2.tax_id, taxId);
});

test('TC-PART-BND-03: Multi-tenant boundary - enumeration defense across tenants', async () => {
  // Given: Partner exists in Tenant 1
  await ensureAuthenticated();
  await selectTenantAction('tnt_mock_1');
  const p1 = await createPartnerAction(`租戶1保密夥伴_${Date.now()}`);

  // When: User switches to Tenant 2 and attempts to update Tenant 1's partner ID
  await selectTenantAction('tnt_mock_2');
  await assert.rejects(
    async () => {
      await updatePartnerAction({
        id: p1.id,
        name: '篡改名稱'
      });
    },
    (err) => {
      assert.match(err.message, /Partner not found/);
      return true;
    }
  );
});

test('TC-PART-WF-01: Workflow regex candidate extraction for tax supplement and rename', async () => {
  // Given: Natural language requests
  const textTax1 = '幫台積電補上統編 22099131';
  const textTax2 = '幫台積電設定統編 22099131';
  const textRename = '把客戶聯發科更名為聯發科技';

  // When: Calling extractCandidateRegex
  const cand1 = updatePartnerToolHandler.extractCandidateRegex(textTax1);
  const cand2 = updatePartnerToolHandler.extractCandidateRegex(textTax2);
  const cand3 = updatePartnerToolHandler.extractCandidateRegex(textRename);

  // Then: Extracted tools and parameters match
  assert.ok(cand1);
  assert.equal(cand1.tool, 'update_partner');
  assert.equal(cand1.target_name, '台積電');
  assert.equal(cand1.tax_id, '22099131');

  assert.ok(cand2);
  assert.equal(cand2.tool, 'update_partner');
  assert.equal(cand2.target_name, '台積電');
  assert.equal(cand2.tax_id, '22099131');

  assert.ok(cand3);
  assert.equal(cand3.tool, 'update_partner');
  assert.equal(cand3.target_name, '聯發科');
  assert.equal(cand3.name, '聯發科技');

  // Verify describeConfirmation formatting
  const conf1 = updatePartnerToolHandler.describeConfirmation(cand1);
  assert.match(conf1, /台積電.*設定統編為 22099131/);

  const conf3 = updatePartnerToolHandler.describeConfirmation(cand3);
  assert.match(conf3, /聯發科.*更名為「聯發科技」/);
});

test('TC-PART-WF-02: Workflow execution and cancellation flow', async () => {
  // Given: Pre-existing partner
  await ensureAuthenticated();
  await selectTenantAction('tnt_mock_1');
  const targetName = `工作流夥伴_${Date.now()}`;
  const created = await createPartnerAction(targetName);
  const testTaxId = genTaxId();

  // When: Simulating workflow turn for tax_id update
  const fakeTask = { id: 'task_m3_test', skillId: 'customer.create_basic_profile' };
  const turnResult = await runAgentTurn(
    `幫${targetName}補上統編 ${testTaxId}`,
    customerCreateBasicProfileAgentProfile,
    fakeTask
  );

  // Then: Produces a pending confirmation card
  assert.ok(turnResult.confirmation, 'Should produce a pending confirmation');
  assert.equal(turnResult.confirmation.toolName, 'update_partner');
  assert.equal(turnResult.confirmation.confirmLabel, '確認修改');
  assert.equal(turnResult.confirmation.cancelLabel, '取消');

  // When: User cancels
  const cancelResult = await executeCancellation(turnResult.confirmation, { activeTask: fakeTask });
  assert.ok(cancelResult.content.includes('已取消合作夥伴資料修改'));

  // Verify partner was NOT updated
  const partnersAfterCancel = await fetchPartners();
  const targetAfterCancel = partnersAfterCancel.find(p => p.id === created.id);
  assert.equal(targetAfterCancel.tax_id, null);

  // When: User confirms
  const confirmResult = await executeConfirmation(turnResult.confirmation, { activeTask: fakeTask });
  assert.ok(confirmResult.content.includes('已為您成功更新'));
  assert.ok(confirmResult.content.includes(testTaxId));

  // Verify partner WAS updated
  const partnersAfterConfirm = await fetchPartners();
  const targetAfterConfirm = partnersAfterConfirm.find(p => p.id === created.id);
  assert.equal(targetAfterConfirm.tax_id, testTaxId);
});

test('TC-PART-WF-03: matchPartnerTarget prioritizes exact match and rejects ambiguous substring matches', () => {
  // Given: Partner list with exact match and overlapping substring match
  const partners = [
    { id: 'p1', name: '台積電', tax_id: null },
    { id: 'p2', name: '台積電子公司', tax_id: '12345678' },
    { id: 'p3', name: '聯發科技股份有限公司', tax_id: null },
    { id: 'p4', name: '聯發科技子公司', tax_id: null }
  ];

  // When: Matching exact name '台積電'
  const exact = matchPartnerTarget('台積電', partners);
  // Then: Exactly resolves to p1 because exact match takes precedence over substring
  assert.equal(exact.id, 'p1');
  assert.equal(exact.name, '台積電');

  // When: Matching ambiguous substring '台積' that matches both p1 and p2
  // Then: Throws ambiguous error without silently picking the first element
  assert.throws(
    () => matchPartnerTarget('台積', partners),
    /找到多筆符合「台積」的夥伴，請提供更明確的名稱/
  );

  // When: Matching ambiguous substring '聯發科技' that matches p3 and p4
  // Then: Throws ambiguous error
  assert.throws(
    () => matchPartnerTarget('聯發科技', partners),
    /找到多筆符合「聯發科技」的夥伴，請提供更明確的名稱/
  );

  // When: Matching non-existent partner
  // Then: Throws not found error
  assert.throws(
    () => matchPartnerTarget('鴻海精密', partners),
    /找不到合作夥伴「鴻海精密」/
  );
});

test('TC-PART-WF-04: updatePartnerToolHandler.execute rejects ambiguous matches when multiple overlapping partners exist', async () => {
  // Given: Two overlapping partners created in active tenant
  await ensureAuthenticated();
  await selectTenantAction('tnt_mock_1');
  const baseName = `日月光集團_${Date.now()}`;
  const pA = await createPartnerAction(`${baseName}_半導體`);
  const pB = await createPartnerAction(`${baseName}_測試`);

  // When: Calling updatePartnerToolHandler.execute with ambiguous substring baseName
  // Then: execute() throws error and refuses to silently select one
  await assert.rejects(
    async () => {
      await updatePartnerToolHandler.execute({
        target_name: baseName,
        tax_id: genTaxId()
      });
    },
    /找到多筆符合.*請提供更明確的名稱/
  );

  // And When: Calling with exact full name of pA
  const testTax = genTaxId();
  const updatedA = await updatePartnerToolHandler.execute({
    target_name: `${baseName}_半導體`,
    tax_id: testTax
  });

  // Then: Exact match succeeds
  assert.equal(updatedA.id, pA.id);
  assert.equal(updatedA.tax_id, testTax);
});

test('TC-PART-WF-05: HITL confirmation card resolves actual DB record and displays before/after diff for tax_id', async () => {
  // Given: Existing partner in DB with empty tax_id
  await ensureAuthenticated();
  await selectTenantAction('tnt_mock_1');
  const targetName = `矽品精密_${Date.now()}`;
  const created = await createPartnerAction(targetName);
  assert.equal(created.tax_id, null);
  const newTax = genTaxId();

  // When: Running agent turn to add tax ID
  const fakeTask = { id: 'task_hitl_tax', skillId: 'customer.create_basic_profile' };
  const turnResult = await runAgentTurn(
    `幫${targetName}補上統編 ${newTax}`,
    customerCreateBasicProfileAgentProfile,
    fakeTask
  );

  // Then: Confirmation card displays resolved record and before/after diff
  assert.equal(turnResult.type, 'pending_confirmation');
  assert.ok(turnResult.confirmation);
  assert.equal(turnResult.confirmation.args.id, created.id, 'args.id must be pre-bound to resolved partner ID');
  assert.equal(turnResult.confirmation.args._targetPartner.name, targetName);

  // Verify before/after text in confirmText
  assert.ok(turnResult.content.includes(targetName));
  assert.ok(turnResult.content.includes(`目前統編：未填寫 ➔ 變更後：${newTax}`));
});

test('TC-PART-WF-06: HITL confirmation card displays before/after diff for partner renaming', async () => {
  // Given: Existing partner in DB
  await ensureAuthenticated();
  await selectTenantAction('tnt_mock_1');
  const origName = `瑞昱電子_${Date.now()}`;
  const newName = `瑞昱半導體_${Date.now()}`;
  const created = await createPartnerAction(origName);

  // When: Running agent turn to rename partner
  const fakeTask = { id: 'task_hitl_rename', skillId: 'customer.create_basic_profile' };
  const turnResult = await runAgentTurn(
    `把客戶${origName}更名為${newName}`,
    customerCreateBasicProfileAgentProfile,
    fakeTask
  );

  // Then: Confirmation card displays before/after rename diff
  assert.equal(turnResult.type, 'pending_confirmation');
  assert.ok(turnResult.confirmation);
  assert.equal(turnResult.confirmation.args.id, created.id);
  assert.ok(turnResult.content.includes(`原名稱：${origName} ➔ 變更後：${newName}`));
});

test('TC-PART-WF-07: runAgentTurn returns error when ambiguous target matches multiple partners in pre-check', async () => {
  // Given: Two partners with overlapping substring
  await ensureAuthenticated();
  await selectTenantAction('tnt_mock_1');
  const sharedPrefix = `華碩電腦_${Date.now()}`;
  await createPartnerAction(`${sharedPrefix}_研發`);
  await createPartnerAction(`${sharedPrefix}_行銷`);

  // When: User asks to update using the ambiguous sharedPrefix
  const fakeTask = { id: 'task_hitl_ambig', skillId: 'customer.create_basic_profile' };
  const turnResult = await runAgentTurn(
    `幫${sharedPrefix}補上統編 88888888`,
    customerCreateBasicProfileAgentProfile,
    fakeTask
  );

  // Then: Pre-check fails and returns error turn instead of creating misleading confirmation card
  assert.equal(turnResult.type, 'error');
  assert.match(turnResult.error, /找到多筆符合.*請提供更明確的名稱/);
  assert.match(turnResult.content, /操作前檢查失敗：找到多筆符合/);
});

