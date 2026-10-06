/**
 * @file customer-partner-management.test.js
 * @description Test suite for Customer / Partner Management & Agent Skill (Issue #117).
 *
 * ## Test Perspective Table (Equivalence Partitioning & Boundary Values)
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-PTR-N-01 | Name: '台積電', tax_id: null | Equivalence – Normal customer without tax ID | Created successfully, is_customer=true, is_vendor=false, tax_id is null | Happy path |
 * | TC-PTR-N-02 | Name: '聯發科技', tax_id: '12345678' | Equivalence – Normal customer with tax ID | Created successfully, tax_id is '12345678' | Complete fields |
 * | TC-PTR-N-03 | Call fetchPartners() | Equivalence – List all partners | Returns full list of partners and updates appState.partners | Store sync |
 * | TC-PTR-N-04 | is_customer: true, is_vendor: true | Equivalence – Dual identity partner | Both flags are true | TPS2 alignment |
 * | TC-PTR-B-01 | Name: "   華碩電腦   " | Boundary – Whitespace trimming | Automatically trimmed to '華碩電腦' | Data normalization |
 * | TC-PTR-B-02 | tax_id: "" or "   " | Boundary – Empty tax_id normalization | Normalized to null in store and mock | Field optionality |
 * | TC-PTR-B-03 | Name: "" (empty string) | Boundary – Empty input | Throws validation error: '客戶名稱為必填項目' | Required field check |
 * | TC-PTR-B-04 | Name: "    " (whitespace string) | Boundary – Whitespace input | Throws validation error: '客戶名稱為必填項目' | Whitespace prevention |
 * | TC-PTR-E-01 | Duplicate customer name '台積電' | Error – Duplicate partner name | Rejects creation with error message '合作夥伴／客戶「台積電」已存在，請使用不同名稱' | Uniqueness guard |
 * | TC-PTR-E-02 | Duplicate with lower/uppercase 'tsmc' vs 'TSMC' | Error – Case-insensitive duplicate | Rejects creation with duplicate error | Strict duplicate guard |
 * | TC-WF-PTR-01 | Regex candidate for '幫我新增客戶 鴻海科技 統編 22334455' | Workflow – Candidate extraction | Extracts tool: 'create_partner', name: '鴻海科技', tax_id: '22334455' | Regex extractor |
 * | TC-WF-PTR-02 | Workflow harness execution with user approval | Workflow – Two-phase confirmation & execution | Returns pending confirmation card, executes on approval, logs audit | Core harness loop |
 * | TC-WF-PTR-03 | Regex candidate for '查詢既有客戶清單' | Workflow – List query extraction | Extracts tool: 'list_partners' | Regex extractor |
 * | TC-WF-PTR-04 | User cancels pending create_partner confirmation | Workflow – Cancellation flow | Invokes describeCancel and produces friendly message | Cancellation |
 * | TC-WF-PTR-05 | Profile manifest compliance | Architecture – Agent Skill authoring standard | Profile contains valid id, domain in KNOWN_DOMAINS, and handlers | Standards compliance |
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
  createPartnerAction
} = await import('../src/lib/store.svelte.js');

const {
  createPartnerToolHandler,
  listPartnersToolHandler,
  customerCreateBasicProfileAgentProfile,
  KNOWN_DOMAINS,
  isKnownDomain,
  runAgentTurn,
  executeConfirmation,
  executeCancellation,
  getAgentProfileForTask
} = await import('../src/lib/workflow/index.js');

test('TC-PTR-N-01: Create partner successfully with name only', async () => {
  // Given: Unique customer name without tax ID
  const custName = `客戶A_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  // When: Call createPartnerAction with name only
  const result = await createPartnerAction(custName);

  // Then: Partner is created with is_customer=true, is_vendor=false, tax_id=null
  assert.ok(result.id, 'Partner ID should be generated');
  assert.equal(result.name, custName);
  assert.equal(result.is_customer, true);
  assert.equal(result.is_vendor, false);
  assert.equal(result.tax_id, null);

  const partners = await fetchPartners();
  const found = partners.find(p => p.id === result.id);
  assert.ok(found, 'New partner must exist in appState.partners');
  assert.equal(found.name, custName);
});

test('TC-PTR-N-02: Create partner with valid tax ID', async () => {
  // Given: Unique customer name and tax ID
  const custName = `客戶B_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const taxId = '12345678';

  // When: Call createPartnerAction with object payload
  const result = await createPartnerAction({
    name: custName,
    taxId,
    isCustomer: true,
    isVendor: false
  });

  // Then: Partner is created with tax_id correctly stored
  assert.ok(result.id);
  assert.equal(result.name, custName);
  assert.equal(result.tax_id, taxId);

  const partners = await fetchPartners();
  const found = partners.find(p => p.id === result.id);
  assert.ok(found);
  assert.equal(found.tax_id, taxId);
});

test('TC-PTR-N-03: fetchPartners retrieves full list and updates store state', async () => {
  // Given: Pre-existing partner created in store
  const custName = `客戶C_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  await createPartnerAction(custName);

  // When: Call fetchPartners()
  const list = await fetchPartners();

  // Then: Returns an array matching appState.partners
  assert.ok(Array.isArray(list));
  assert.ok(list.length > 0);
  assert.equal(list, appState.partners);
  assert.ok(list.some(p => p.name === custName));
});

test('TC-PTR-N-04: Create dual identity partner (customer + vendor)', async () => {
  // Given: Dual identity partner data
  const name = `綜合夥伴_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  // When: Call createPartnerAction with isCustomer=true, isVendor=true
  const result = await createPartnerAction({
    name,
    isCustomer: true,
    isVendor: true,
    taxId: '87654321'
  });

  // Then: Both flags are true
  assert.equal(result.is_customer, true);
  assert.equal(result.is_vendor, true);
  assert.equal(result.tax_id, '87654321');
});

test('TC-PTR-B-01: Whitespace trimming on partner name', async () => {
  // Given: Partner name surrounded by whitespace
  const rawName = `   廣達電腦_${Date.now()}_${Math.floor(Math.random() * 10000)}   `;
  const expectedName = rawName.trim();

  // When: Call createPartnerAction
  const result = await createPartnerAction(rawName);

  // Then: Result name is properly trimmed
  assert.equal(result.name, expectedName);
});

test('TC-PTR-B-02: Normalize empty or whitespace tax ID to null', async () => {
  // Given: Partners with empty and whitespace tax IDs
  const name1 = `客戶_空稅號1_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const name2 = `客戶_空稅號2_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  // When: Call createPartnerAction with empty and whitespace tax ID
  const res1 = await createPartnerAction({ name: name1, taxId: '' });
  const res2 = await createPartnerAction({ name: name2, taxId: '    ' });

  // Then: tax_id is normalized to null
  assert.equal(res1.tax_id, null);
  assert.equal(res2.tax_id, null);
});

test('TC-PTR-B-03 & B-04: Empty or whitespace-only name throws validation error', async () => {
  // Given: Empty and whitespace strings
  // When & Then: createPartnerAction throws validation error
  await assert.rejects(
    async () => await createPartnerAction(''),
    /客戶名稱為必填項目/
  );
  await assert.rejects(
    async () => await createPartnerAction('    '),
    /客戶名稱為必填項目/
  );
  await assert.rejects(
    async () => await createPartnerAction({ name: '   ' }),
    /客戶名稱為必填項目/
  );
});

test('TC-PTR-E-01: Duplicate customer name is rejected', async () => {
  // Given: An existing customer
  const custName = `宏碁股份有限公司_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  await createPartnerAction(custName);

  // When & Then: Creating partner with identical name throws duplicate error
  await assert.rejects(
    async () => await createPartnerAction(custName),
    new RegExp(`合作夥伴／客戶「${custName}」已存在，請使用不同名稱`)
  );
});

test('TC-PTR-E-02: Duplicate customer name with case-insensitivity is rejected', async () => {
  // Given: An existing customer with uppercase name
  const custName = `acer_corp_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  await createPartnerAction(custName.toUpperCase());

  // When & Then: Creating partner with lowercase name throws duplicate error
  await assert.rejects(
    async () => await createPartnerAction(`  ${custName.toLowerCase()}  `),
    new RegExp(`合作夥伴／客戶「${custName.toLowerCase()}」已存在，請使用不同名稱`)
  );
});

test('TC-WF-PTR-01: createPartnerToolHandler extracts candidate name and tax ID from natural text', () => {
  // Given: Natural language message with customer name and tax ID
  const msg1 = '請幫我新增客戶 鴻海精密 統編 22334455';
  const msg2 = '建立客戶「台積電」';
  const msg3 = '我想新增一個新客戶：聯發科技 稅號：12345678';

  // When: Calling extractCandidateRegex
  const cand1 = createPartnerToolHandler.extractCandidateRegex(msg1);
  const cand2 = createPartnerToolHandler.extractCandidateRegex(msg2);
  const cand3 = createPartnerToolHandler.extractCandidateRegex(msg3);

  // Then: Correct candidate tools and parameters are extracted
  assert.ok(cand1);
  assert.equal(cand1.tool, 'create_partner');
  assert.equal(cand1.name, '鴻海精密');
  assert.equal(cand1.tax_id, '22334455');

  assert.ok(cand2);
  assert.equal(cand2.tool, 'create_partner');
  assert.equal(cand2.name, '台積電');

  assert.ok(cand3);
  assert.equal(cand3.tool, 'create_partner');
  assert.equal(cand3.name, '聯發科技');
  assert.equal(cand3.tax_id, '12345678');
});

test('TC-WF-PTR-02: Workflow harness execution with create_partner confirmation and approval', async () => {
  // Given: Unique customer info and workflow harness setup
  const uniqueName = `英業達_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const profile = customerCreateBasicProfileAgentProfile;

  // When: Running agent turn with create customer message
  const turnResult = await runAgentTurn(
    `幫我新增客戶 ${uniqueName} 統編 55667788`,
    profile,
    { taskId: 'main' }
  );

  // Then: Turn returns pending confirmation card
  assert.ok(turnResult.confirmation, 'Should produce a pending confirmation');
  assert.equal(turnResult.confirmation.toolName, 'create_partner');
  assert.equal(turnResult.confirmation.args.name, uniqueName);
  assert.equal(turnResult.confirmation.args.tax_id, '55667788');
  assert.ok(turnResult.confirmation.confirmText.includes(uniqueName));
  assert.ok(turnResult.confirmation.confirmText.includes('55667788'));

  // And When: Executing confirmation
  const confirmResult = await executeConfirmation(turnResult.confirmation, {
    taskId: 'main',
    activeTask: null
  });

  // Then: Customer is created and formatted message is returned
  assert.ok(confirmResult.content.includes(uniqueName));
  assert.ok(confirmResult.content.includes('55667788'));
  assert.ok(confirmResult.toast.includes(uniqueName));

  const partners = await fetchPartners();
  assert.ok(partners.some(p => p.name === uniqueName && p.tax_id === '55667788'));
});

test('TC-WF-PTR-03: listPartnersToolHandler candidate extraction and formatting', async () => {
  // Given: Natural language message for query
  const msg1 = '請問目前系統有哪些客戶清單？';
  const msg2 = '查詢所有客戶';

  // When: Calling extractCandidateRegex
  const cand1 = listPartnersToolHandler.extractCandidateRegex(msg1);
  const cand2 = listPartnersToolHandler.extractCandidateRegex(msg2);

  // Then: list_partners intent is matched
  assert.ok(cand1);
  assert.equal(cand1.tool, 'list_partners');
  assert.ok(cand2);
  assert.equal(cand2.tool, 'list_partners');

  // And When: Formatted with partners list
  const mockList = [
    { name: '台積電', tax_id: '22099131' },
    { name: '聯發科', tax_id: null }
  ];
  const formatted = listPartnersToolHandler.formatResult(mockList);

  // Then: Shows total count and names
  assert.ok(formatted.includes('共 2 家'));
  assert.ok(formatted.includes('台積電 (統編: 22099131)'));
  assert.ok(formatted.includes('聯發科'));
});

test('TC-WF-PTR-04: User cancels pending create_partner confirmation', async () => {
  // Given: A pending confirmation
  const profile = customerCreateBasicProfileAgentProfile;
  const turnResult = await runAgentTurn(
    '幫我新增客戶 測試取消客戶',
    profile,
    { taskId: 'main' }
  );
  assert.ok(turnResult.confirmation);

  // When: Executing cancellation
  const cancelResult = await executeCancellation(turnResult.confirmation, {
    taskId: 'main'
  });

  // Then: Cancel response message is returned
  assert.ok(cancelResult.content.includes('已取消建立客戶'));
});

test('TC-WF-PTR-05: Agent Profile manifest compliance with authoring standards', () => {
  // Given: customerCreateBasicProfileAgentProfile
  const profile = customerCreateBasicProfileAgentProfile;

  // Then: id and domain conform to docs/standards/authoring/agent-skill-authoring.md
  assert.equal(profile.id, 'customer.create_basic_profile');
  assert.equal(profile.domain, 'customer');
  assert.ok(isKnownDomain(profile.domain), 'Domain must exist in KNOWN_DOMAINS');

  // Tools & Handlers
  assert.ok(Array.isArray(profile.tools));
  assert.equal(profile.tools.length, 2);
  assert.ok(profile.tools.some(t => t.function.name === 'create_partner'));
  assert.ok(profile.tools.some(t => t.function.name === 'list_partners'));

  assert.ok(Array.isArray(profile.toolHandlers));
  assert.equal(profile.toolHandlers.length, 2);

  // Fallback and quickAction
  assert.ok(profile.getFallbackMessage());
  assert.ok(profile.quickAction);
  assert.equal(profile.quickAction.defaultTool, 'create_partner');

  // Registry task resolution
  const resolved = getAgentProfileForTask({ title: '新增客戶基本資料' });
  assert.equal(resolved, profile);
});
