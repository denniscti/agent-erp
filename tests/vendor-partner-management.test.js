/**
 * @file vendor-partner-management.test.js
 * @description Test suite for Vendor / Partner Management & Identity Overlay (Issue #119).
 *
 * ## Test Perspective Table (Equivalence Partitioning & Boundary Values)
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-VND-N-01 | Name: '日月光半導體', tax_id: null | Equivalence – Normal vendor without tax ID | Created successfully, is_vendor=true, is_customer=false, tax_id is null | Happy path |
 * | TC-VND-N-02 | Name: '欣興電子', tax_id: '11223344' | Equivalence – Normal vendor with tax ID | Created successfully, is_vendor=true, tax_id is '11223344' | Complete fields |
 * | TC-VND-N-03 | Existing customer '台積電', register as vendor | Equivalence – Customer overlay vendor identity | Single record updated with is_vendor=true, retains id and is_customer=true | Identity overlay |
 * | TC-VND-N-04 | Existing vendor '穩懋半導體', register as customer | Equivalence – Vendor overlay customer identity | Single record updated with is_customer=true, retains id and is_vendor=true | Bi-directional overlay |
 * | TC-VND-N-05 | Customer without tax_id, overlay vendor with tax_id | Equivalence – Tax ID merge during overlay | tax_id updated to '22334455', dual flags true | Field merging |
 * | TC-VND-N-06 | Call fetchVendors() | Equivalence – List all vendors | Returns only vendors (is_vendor=true) | Filter verification |
 * | TC-VND-B-01 | Name: "   南亞電路板   " | Boundary – Whitespace trimming | Automatically trimmed to '南亞電路板' | Data normalization |
 * | TC-VND-B-02 | tax_id: "" or "   " | Boundary – Empty tax_id normalization | Normalized to null | Field optionality |
 * | TC-VND-B-03 | Name: "" (empty string) | Boundary – Empty input | Throws validation error: '供應商名稱為必填項目' | Required field check |
 * | TC-VND-B-04 | Name: "    " (whitespace string) | Boundary – Whitespace input | Throws validation error: '供應商名稱為必填項目' | Whitespace prevention |
 * | TC-VND-E-01 | Duplicate vendor name '日月光' | Error – Duplicate vendor registration | Rejects creation with duplicate error message | Uniqueness guard |
 * | TC-VND-E-02 | Duplicate with lower/uppercase 'ase' vs 'ASE' | Error – Case-insensitive duplicate | Rejects creation with duplicate error | Strict duplicate guard |
 * | TC-WF-VND-01 | Regex candidate for '幫我新增供應商 欣興電子 統編 11223344' | Workflow – Candidate extraction | Extracts tool: 'create_vendor', name: '欣興電子', tax_id: '11223344' | Regex extractor |
 * | TC-WF-VND-02 | Workflow harness execution with user approval | Workflow – Two-phase confirmation & execution | Returns pending confirmation card, executes on approval, logs audit | Core harness loop |
 * | TC-WF-VND-03 | Regex candidate for '查詢既有供應商清單' | Workflow – List query extraction | Extracts tool: 'list_vendors' | Regex extractor |
 * | TC-WF-VND-04 | User cancels pending create_vendor confirmation | Workflow – Cancellation flow | Invokes describeCancel and produces friendly message | Cancellation |
 * | TC-WF-VND-05 | Profile manifest compliance | Architecture – Agent Skill authoring standard | Profile contains valid id, domain in KNOWN_DOMAINS, and handlers | Standards compliance |
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
  fetchVendors,
  createPartnerAction,
  createVendorAction
} = await import('../src/lib/store.svelte.js');

const {
  createVendorToolHandler,
  listVendorsToolHandler,
  vendorCreateBasicProfileAgentProfile,
  KNOWN_DOMAINS,
  isKnownDomain,
  runAgentTurn,
  executeConfirmation,
  executeCancellation,
  getAgentProfileForTask
} = await import('../src/lib/workflow/index.js');

test('TC-VND-N-01: Create vendor successfully with name only', async () => {
  // Given: Unique vendor name without tax ID
  const vendorName = `供應商A_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  // When: Call createVendorAction with name only
  const result = await createVendorAction(vendorName);

  // Then: Partner is created with is_vendor=true, is_customer=false, tax_id=null
  assert.ok(result.id, 'Vendor ID should be generated');
  assert.equal(result.name, vendorName);
  assert.equal(result.is_vendor, true);
  assert.equal(result.is_customer, false);
  assert.equal(result.tax_id, null);

  const partners = await fetchPartners();
  const found = partners.find(p => p.id === result.id);
  assert.ok(found, 'New vendor must exist in appState.partners');
  assert.equal(found.name, vendorName);
  assert.equal(found.is_vendor, true);
});

test('TC-VND-N-02: Create vendor with valid tax ID', async () => {
  // Given: Unique vendor name and tax ID
  const vendorName = `供應商B_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const taxId = '11223344';

  // When: Call createVendorAction with object payload
  const result = await createVendorAction({
    name: vendorName,
    taxId
  });

  // Then: Partner is created with tax_id correctly stored
  assert.ok(result.id);
  assert.equal(result.name, vendorName);
  assert.equal(result.is_vendor, true);
  assert.equal(result.is_customer, false);
  assert.equal(result.tax_id, taxId);

  const partners = await fetchPartners();
  const found = partners.find(p => p.id === result.id);
  assert.ok(found);
  assert.equal(found.tax_id, taxId);
});

test('TC-VND-N-03: Existing customer overlay vendor identity without duplicate row', async () => {
  // Given: An existing customer "台積電" (is_customer=true, is_vendor=false)
  const custName = `客戶轉廠商_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const initial = await createPartnerAction({
    name: custName,
    isCustomer: true,
    isVendor: false
  });
  assert.equal(initial.is_customer, true);
  assert.equal(initial.is_vendor, false);

  // When: Registering the same partner name as a vendor
  const overlay = await createVendorAction(custName);

  // Then: The existing record is updated to is_vendor=true while keeping is_customer=true and original id
  assert.equal(overlay.id, initial.id);
  assert.equal(overlay.name, custName);
  assert.equal(overlay.is_customer, true);
  assert.equal(overlay.is_vendor, true);

  const allPartners = await fetchPartners();
  const matches = allPartners.filter(p => p.name === custName);
  assert.equal(matches.length, 1, 'Should NOT create duplicate rows for the same entity');
});

test('TC-VND-N-04: Existing vendor overlay customer identity', async () => {
  // Given: An existing vendor "穩懋" (is_customer=false, is_vendor=true)
  const vendorName = `廠商轉客戶_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const initial = await createVendorAction(vendorName);
  assert.equal(initial.is_customer, false);
  assert.equal(initial.is_vendor, true);

  // When: Registering the same partner name as a customer
  const overlay = await createPartnerAction({
    name: vendorName,
    isCustomer: true
  });

  // Then: Existing record is updated to is_customer=true, retaining is_vendor=true
  assert.equal(overlay.id, initial.id);
  assert.equal(overlay.name, vendorName);
  assert.equal(overlay.is_customer, true);
  assert.equal(overlay.is_vendor, true);
});

test('TC-VND-N-05: Overlay identity updates and merges tax ID', async () => {
  // Given: Existing customer without tax ID
  const partnerName = `華邦電_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const initial = await createPartnerAction(partnerName);
  assert.equal(initial.tax_id, null);

  // When: Overlaying vendor identity with a new tax ID
  const updated = await createVendorAction({
    name: partnerName,
    taxId: '22334455'
  });

  // Then: tax_id is merged and both identities are true
  assert.equal(updated.id, initial.id);
  assert.equal(updated.tax_id, '22334455');
  assert.equal(updated.is_customer, true);
  assert.equal(updated.is_vendor, true);
});

test('TC-VND-N-06: fetchVendors retrieves filtered vendor list', async () => {
  // Given: Create a vendor and fetch
  const name = `專屬廠商_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  await createVendorAction(name);

  // When: Calling fetchVendors()
  const list = await fetchVendors();

  // Then: All returned items must have is_vendor=true
  assert.ok(Array.isArray(list));
  assert.ok(list.length > 0);
  assert.ok(list.every(p => p.is_vendor === true));
  assert.ok(list.some(p => p.name === name));
});

test('TC-VND-N-07: Create dual identity partner directly (customer + vendor)', async () => {
  // Given: Dual identity registration input
  const name = `測試資料3科技股份有限公司_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  // When: Calling createPartnerAction with isCustomer=true and isVendor=true
  const result = await createPartnerAction({
    name,
    isCustomer: true,
    isVendor: true
  });

  // Then: Both flags must be true
  assert.equal(result.name, name);
  assert.equal(result.is_customer, true);
  assert.equal(result.is_vendor, true);

  const all = await fetchPartners();
  const found = all.find(p => p.id === result.id);
  assert.ok(found);
  assert.equal(found.is_customer, true);
  assert.equal(found.is_vendor, true);
});

test('TC-VND-B-01: Whitespace trimming on vendor name', async () => {
  // Given: Vendor name surrounded by whitespace
  const rawName = `   南亞電路板_${Date.now()}_${Math.floor(Math.random() * 10000)}   `;
  const expectedName = rawName.trim();

  // When: Call createVendorAction
  const result = await createVendorAction(rawName);

  // Then: Result name is properly trimmed
  assert.equal(result.name, expectedName);
});

test('TC-VND-B-02: Normalize empty or whitespace tax ID to null', async () => {
  // Given: Vendors with empty and whitespace tax IDs
  const name1 = `廠商_空稅號1_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const name2 = `廠商_空稅號2_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  // When: Call createVendorAction with empty and whitespace tax ID
  const res1 = await createVendorAction({ name: name1, taxId: '' });
  const res2 = await createVendorAction({ name: name2, taxId: '    ' });

  // Then: tax_id is normalized to null
  assert.equal(res1.tax_id, null);
  assert.equal(res2.tax_id, null);
});

test('TC-VND-B-03 & B-04: Empty or whitespace-only vendor name throws validation error', async () => {
  // Given: Empty and whitespace strings
  // When & Then: createVendorAction throws validation error
  await assert.rejects(
    async () => await createVendorAction(''),
    /供應商名稱為必填項目/
  );
  await assert.rejects(
    async () => await createVendorAction('    '),
    /供應商名稱為必填項目/
  );
  await assert.rejects(
    async () => await createVendorAction({ name: '   ' }),
    /供應商名稱為必填項目/
  );
});

test('TC-VND-E-01: Duplicate vendor name is rejected', async () => {
  // Given: An existing vendor
  const vendorName = `日月光半導體_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  await createVendorAction(vendorName);

  // When & Then: Registering vendor again with identical name throws duplicate error
  await assert.rejects(
    async () => await createVendorAction(vendorName),
    new RegExp(`合作夥伴／供應商「${vendorName}」已存在，請使用不同名稱`)
  );
});

test('TC-VND-E-02: Duplicate vendor name with case-insensitivity is rejected', async () => {
  // Given: An existing vendor with uppercase name
  const vendorName = `ase_corp_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  await createVendorAction(vendorName.toUpperCase());

  // When & Then: Creating vendor with lowercase name throws duplicate error
  await assert.rejects(
    async () => await createVendorAction(`  ${vendorName.toLowerCase()}  `),
    new RegExp(`合作夥伴／供應商「${vendorName.toLowerCase()}」已存在，請使用不同名稱`)
  );
});

test('TC-WF-VND-01: createVendorToolHandler extracts candidate name and tax ID from natural text', () => {
  // Given: Natural language messages with vendor name and tax ID
  const msg1 = '請幫我新增供應商 欣興電子 統編 11223344';
  const msg2 = '建立供應商「日月光」';
  const msg3 = '我想新增一個新廠商：聯茂電子 稅號：88990011';

  // When: Calling extractCandidateRegex
  const cand1 = createVendorToolHandler.extractCandidateRegex(msg1);
  const cand2 = createVendorToolHandler.extractCandidateRegex(msg2);
  const cand3 = createVendorToolHandler.extractCandidateRegex(msg3);

  // Then: Correct candidate tools and parameters are extracted
  assert.ok(cand1);
  assert.equal(cand1.tool, 'create_vendor');
  assert.equal(cand1.name, '欣興電子');
  assert.equal(cand1.tax_id, '11223344');

  assert.ok(cand2);
  assert.equal(cand2.tool, 'create_vendor');
  assert.equal(cand2.name, '日月光');

  assert.ok(cand3);
  assert.equal(cand3.tool, 'create_vendor');
  assert.equal(cand3.name, '聯茂電子');
  assert.equal(cand3.tax_id, '88990011');
});

test('TC-WF-VND-02: Workflow harness execution with create_vendor confirmation and approval', async () => {
  // Given: Unique vendor info and workflow harness setup
  const uniqueName = `景碩科技_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const profile = vendorCreateBasicProfileAgentProfile;

  // When: Running agent turn with create vendor message
  const turnResult = await runAgentTurn(
    `幫我新增供應商 ${uniqueName} 統編 99887766`,
    profile,
    { taskId: 'main' }
  );

  // Then: Turn returns pending confirmation card
  assert.ok(turnResult.confirmation, 'Should produce a pending confirmation');
  assert.equal(turnResult.confirmation.toolName, 'create_vendor');
  assert.equal(turnResult.confirmation.args.name, uniqueName);
  assert.equal(turnResult.confirmation.args.tax_id, '99887766');
  assert.ok(turnResult.confirmation.confirmText.includes(uniqueName));
  assert.ok(turnResult.confirmation.confirmText.includes('99887766'));

  // And When: Executing confirmation
  const confirmResult = await executeConfirmation(turnResult.confirmation, {
    taskId: 'main',
    activeTask: null
  });

  // Then: Vendor is created and formatted message is returned
  assert.ok(confirmResult.content.includes(uniqueName));
  assert.ok(confirmResult.content.includes('99887766'));
  assert.ok(confirmResult.toast.includes(uniqueName));

  const partners = await fetchPartners();
  assert.ok(partners.some(p => p.name === uniqueName && p.tax_id === '99887766' && p.is_vendor === true));
});

test('TC-WF-VND-03: listVendorsToolHandler candidate extraction and formatting', async () => {
  // Given: Natural language message for query
  const msg1 = '請問目前系統有哪些供應商清單？';
  const msg2 = '查詢所有廠商';

  // When: Calling extractCandidateRegex
  const cand1 = listVendorsToolHandler.extractCandidateRegex(msg1);
  const cand2 = listVendorsToolHandler.extractCandidateRegex(msg2);

  // Then: list_vendors intent is matched
  assert.ok(cand1);
  assert.equal(cand1.tool, 'list_vendors');
  assert.ok(cand2);
  assert.equal(cand2.tool, 'list_vendors');

  // And When: Formatted with vendor list
  const mockList = [
    { name: '欣興電子', tax_id: '11223344' },
    { name: '日月光', tax_id: null }
  ];
  const formatted = listVendorsToolHandler.formatResult(mockList);

  // Then: Shows total count and names
  assert.ok(formatted.includes('共 2 家'));
  assert.ok(formatted.includes('欣興電子 (統編: 11223344)'));
  assert.ok(formatted.includes('日月光'));
});

test('TC-WF-VND-04: User cancels pending create_vendor confirmation', async () => {
  // Given: A pending confirmation
  const profile = vendorCreateBasicProfileAgentProfile;
  const turnResult = await runAgentTurn(
    '幫我新增供應商 測試取消廠商',
    profile,
    { taskId: 'main' }
  );
  assert.ok(turnResult.confirmation);

  // When: Executing cancellation
  const cancelResult = await executeCancellation(turnResult.confirmation, {
    taskId: 'main'
  });

  // Then: Cancel response message is returned
  assert.ok(cancelResult.content.includes('已取消建立供應商'));
});

test('TC-WF-VND-05: Agent Profile manifest compliance with authoring standards', () => {
  // Given: vendorCreateBasicProfileAgentProfile
  const profile = vendorCreateBasicProfileAgentProfile;

  // Then: id and domain conform to docs/standards/authoring/agent-skill-authoring.md
  assert.equal(profile.id, 'vendor.create_basic_profile');
  assert.equal(profile.domain, 'vendor');
  assert.ok(isKnownDomain(profile.domain), 'Domain must exist in KNOWN_DOMAINS');

  // Tools & Handlers
  assert.ok(Array.isArray(profile.tools));
  assert.equal(profile.tools.length, 2);
  assert.ok(profile.tools.some(t => t.function.name === 'create_vendor'));
  assert.ok(profile.tools.some(t => t.function.name === 'list_vendors'));

  assert.ok(Array.isArray(profile.toolHandlers));
  assert.equal(profile.toolHandlers.length, 2);

  // Fallback and quickAction
  assert.ok(profile.getFallbackMessage());
  assert.ok(profile.quickAction);
  assert.equal(profile.quickAction.defaultTool, 'create_vendor');

  // Registry task resolution
  const resolved = getAgentProfileForTask({ title: '新增供應商基本資料' });
  assert.equal(resolved, profile);
});
