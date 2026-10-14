/**
 * @file product-management.test.js
 * @description Test suite for Product Management Data Model & Agent Skill (Issue #137).
 *
 * ## Test Perspective Table (Equivalence Partitioning & Boundary Values)
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-PROD-N-01 | Name: '智能核心晶片', category: '轉售商品', price: 120 | Equivalence – Normal resale product | Created successfully, is_sellable=true, is_purchasable=true, default variant '標準' | Happy path |
 * | TC-PROD-N-02 | Name: 'AI伺服器機櫃', category: '自製成品', price: 150000 | Equivalence – Normal manufactured product | Created successfully, is_sellable=true, is_purchasable=false | Happy path |
 * | TC-PROD-N-03 | Name: '散熱鋁片', category: '原物料' | Equivalence – Normal raw material | Created successfully, is_sellable=false, is_purchasable=true | Happy path |
 * | TC-PROD-N-04 | fetchProducts with category filter | Equivalence – Filter products | Returns filtered products list | Store action |
 * | TC-PROD-N-05 | Add variant '512GB 灰色' to product | Equivalence – Variant management | Variant created and attached to product | Variant action |
 * | TC-PROD-N-06 | Add unit '箱' (ratio: 24, price: 2200) | Equivalence – Unit & price hierarchy | Unit created with conversion ratio and price | Unit action |
 * | TC-PROD-N-07 | Add vendor supply source with cost 85 to unit | Equivalence – Unit-level supply source linking | Linked to valid vendor partner and sales unit | Supply action |
 * | TC-PROD-N-07B | Add distinct supply costs for different units of same variant | Equivalence – Multi-unit cost hierarchy | Box unit and base unit each have distinct purchase costs | Supply action |
 * | TC-PROD-N-08 | Add BOM item (quantity: 4) to manufactured product | Equivalence – BOM composition | Linked parent and child variants | BOM action |
 * | TC-PROD-B-01 | Name: "   邊界晶片   ", unit: "  片  " | Boundary – Whitespace trimming | Automatically trimmed in store and mock | Data normalization |
 * | TC-PROD-B-02 | selling_price: 0.0 | Boundary – Zero price | Allowed (free item / sample) | Lower bound |
 * | TC-PROD-B-03 | purchase_cost: 0.0 | Boundary – Zero purchase cost | Allowed (free raw material) | Lower bound |
 * | TC-PROD-E-01 | Name: "" or "   " | Error – Empty product name | Throws validation error | Required field |
 * | TC-PROD-E-02 | Category: "invalid_category" | Error – Invalid category | Throws validation error | Enum check |
 * | TC-PROD-E-03 | Duplicate product name in same tenant | Error – Duplicate product name | Rejects creation with error | Uniqueness guard |
 * | TC-PROD-E-04 | selling_price: -50 | Error – Negative price | Throws validation error | Number validation |
 * | TC-PROD-E-05 | conversion_ratio: 0 or -1 | Error – Invalid ratio | Throws validation error | Ratio validation |
 * | TC-PROD-E-06 | purchase_cost: -10 | Error – Negative cost | Throws validation error | Number validation |
 * | TC-PROD-E-07 | Supply source with non-vendor partner | Error – Invalid vendor | Rejects with vendor error | Relationship validation |
 * | TC-PROD-E-08 | Add BOM item to resale product | Error – Non-manufactured product | Rejects with error | Business rule check |
 * | TC-PROD-E-09 | BOM item self reference | Error – Self loop | Rejects with error | Loop prevention |
 * | TC-PROD-E-10 | BOM quantity: 0 or -1 | Error – Invalid quantity | Throws validation error | Quantity check |
 * | TC-PROD-WF-01 | Regex candidate for '新增轉售商品「智能晶片」售價 120' | Workflow – Natural language extraction | Extracts name, category, price | Regex extractor |
 * | TC-PROD-WF-02 | Workflow harness execution with confirmation | Workflow – Two-phase HITL execution | Pending card shown, executes on confirm | Core harness loop |
 * | TC-PROD-WF-03 | Workflow cancellation flow | Workflow – Cancellation handling | Produces cancel guidance message | Cancellation |
 * | TC-PROD-WF-04 | Profile manifest compliance | Architecture – Agent Skill authoring standard | Profile contains valid id, domain, and handlers | Standards compliance |
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Polyfill Svelte 5 $state rune for Node.js test environment if not defined
if (typeof globalThis.$state === 'undefined') {
  globalThis.$state = (v) => v;
}

const {
  appState,
  login,
  selectTenantAction,
  fetchProducts,
  createProductAction,
  getProductDetailAction,
  addProductVariantAction,
  addProductUnitAction,
  addSupplySourceAction,
  addBomItemAction,
  resolveCategoryFlags,
  createPartnerAction
} = await import('../src/lib/store.svelte.js');

const {
  createProductToolHandler,
  listProductsToolHandler,
  productManagementAgentProfile,
  KNOWN_DOMAINS,
  isKnownDomain,
  runAgentTurn,
  executeConfirmation,
  executeCancellation,
  getAgentProfileForTask
} = await import('../src/lib/workflow/index.js');

// Helper to ensure authenticated state
async function ensureAuthenticated() {
  await login('admin@example.com', 'password123');
  await selectTenantAction('tnt_mock_1');
}

test('TC-PROD-N-01: Create resale product successfully with default variant', async () => {
  // Given: Unique resale product info
  await ensureAuthenticated();
  const prodName = `轉售晶片_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  // When: Calling createProductAction
  const result = await createProductAction({
    name: prodName,
    category: '轉售商品',
    sku: 'CHIP-TEST-01',
    unit_name: '顆',
    selling_price: 120
  });

  // Then: Product created with resale flags, default variant and base unit
  assert.ok(result.product.id, 'Product ID should be generated');
  assert.equal(result.product.name, prodName);
  assert.equal(result.product.category, 'resale');
  assert.equal(result.product.is_sellable, true);
  assert.equal(result.product.is_purchasable, true);
  assert.equal(result.variants.length, 1);
  assert.equal(result.variants[0].name, '標準');
  assert.equal(result.variants[0].is_default, true);
  assert.equal(result.units.length, 1);
  assert.equal(result.units[0].unit_name, '顆');
  assert.equal(result.units[0].selling_price, 120);
});

test('TC-PROD-N-02: Create manufactured product successfully', async () => {
  // Given: Unique manufactured product info
  await ensureAuthenticated();
  const prodName = `伺服器機櫃_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  // When: Calling createProductAction
  const result = await createProductAction({
    name: prodName,
    category: '自製成品',
    unit_name: '台',
    selling_price: 150000
  });

  // Then: Product is sellable but not purchasable
  assert.equal(result.product.category, 'manufactured');
  assert.equal(result.product.is_sellable, true);
  assert.equal(result.product.is_purchasable, false);
});

test('TC-PROD-N-03: Create raw material product successfully', async () => {
  // Given: Unique raw material product info
  await ensureAuthenticated();
  const prodName = `散熱鋁片_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  // When: Calling createProductAction
  const result = await createProductAction({
    name: prodName,
    category: '原物料'
  });

  // Then: Product is not sellable but purchasable
  assert.equal(result.product.category, 'raw_material');
  assert.equal(result.product.is_sellable, false);
  assert.equal(result.product.is_purchasable, true);
});

test('TC-PROD-N-04: fetchProducts and filter by category', async () => {
  // Given: Products in store
  await ensureAuthenticated();

  // When: fetchProducts with filterCategory
  const resaleList = await fetchProducts({ filterCategory: 'resale' });

  // Then: All returned products match resale category
  assert.ok(Array.isArray(resaleList));
  assert.ok(resaleList.every(p => p.category === 'resale'));
});

test('TC-PROD-N-05: Add variant to existing product', async () => {
  // Given: Product created
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `多變體晶片_${Date.now()}`,
    category: '轉售商品'
  });

  // When: Adding a variant
  const variant = await addProductVariantAction(p.product.id, '1TB 黑色', 'CHIP-1TB-BLK');

  // Then: Variant is added
  assert.ok(variant.id);
  assert.equal(variant.name, '1TB 黑色');
  assert.equal(variant.is_default, false);
});

test('TC-PROD-N-06: Add packaging unit to variant', async () => {
  // Given: Product created
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `包裝單位產品_${Date.now()}`,
    category: '轉售商品',
    selling_price: 10
  });
  const varId = p.variants[0].id;

  // When: Adding packaging unit (box of 10 for price 90)
  const unit = await addProductUnitAction(varId, '盒', 10.0, false, 90.0);

  // Then: Unit is recorded properly
  assert.ok(unit.id);
  assert.equal(unit.unit_name, '盒');
  assert.equal(unit.conversion_ratio, 10.0);
  assert.equal(unit.selling_price, 90.0);
});

test('TC-PROD-N-07: Add vendor supply source to unit', async () => {
  // Given: Product, sales unit, and vendor partner
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `供應商來源品_${Date.now()}`,
    category: '轉售商品'
  });
  const vendor = await createPartnerAction({
    name: `供應商_${Date.now()}`,
    isCustomer: false,
    isVendor: true
  });
  const unitId = p.units[0].id;

  // When: Adding supply source to base unit
  const src = await addSupplySourceAction(unitId, vendor.id, 80.0, 'TWD', true);

  // Then: Supply source is linked to the sales unit
  assert.ok(src.id);
  assert.equal(src.unit_id, unitId);
  assert.equal(src.vendor_partner_id, vendor.id);
  assert.equal(src.purchase_cost, 80.0);
  assert.equal(src.is_primary, true);
});

test('TC-PROD-N-07B: Add distinct supply costs for different units of same variant', async () => {
  // Given: Product with base unit and an additional box unit
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `多單位成本品_${Date.now()}`,
    category: '轉售商品'
  });
  const vendor = await createPartnerAction({
    name: `階層供應商_${Date.now()}`,
    isCustomer: false,
    isVendor: true
  });
  const baseUnit = p.units[0];
  const boxUnit = await addProductUnitAction(p.variants[0].id, '箱', 12.0, false, 960.0);

  // When: Adding distinct supply costs for single unit vs box unit
  const srcBase = await addSupplySourceAction(baseUnit.id, vendor.id, 70.0, 'TWD', true);
  const srcBox = await addSupplySourceAction(boxUnit.id, vendor.id, 750.0, 'TWD', false);

  // Then: Both supply sources are stored and associated with their respective unit_ids
  assert.equal(srcBase.unit_id, baseUnit.id);
  assert.equal(srcBase.purchase_cost, 70.0);
  assert.equal(srcBox.unit_id, boxUnit.id);
  assert.equal(srcBox.purchase_cost, 750.0);

  const detail = await getProductDetailAction(p.product.id);
  assert.equal(detail.supply_sources.length, 2);
  const foundBase = detail.supply_sources.find(s => s.unit_id === baseUnit.id);
  const foundBox = detail.supply_sources.find(s => s.unit_id === boxUnit.id);
  assert.ok(foundBase);
  assert.equal(foundBase.purchase_cost, 70.0);
  assert.ok(foundBox);
  assert.equal(foundBox.purchase_cost, 750.0);
});

test('TC-PROD-N-08: Add BOM item to manufactured product', async () => {
  // Given: Manufactured parent and raw material child
  await ensureAuthenticated();
  const parent = await createProductAction({
    name: `BOM成品_${Date.now()}`,
    category: '自製成品'
  });
  const child = await createProductAction({
    name: `BOM零件_${Date.now()}`,
    category: '原物料'
  });

  // When: Adding BOM item
  const bom = await addBomItemAction(parent.variants[0].id, child.variants[0].id, 3.5);

  // Then: BOM item is linked
  assert.ok(bom.id);
  assert.equal(bom.parent_variant_id, parent.variants[0].id);
  assert.equal(bom.child_variant_id, child.variants[0].id);
  assert.equal(bom.quantity, 3.5);
});

test('TC-PROD-B-01: Whitespace trimming on name and unit', async () => {
  // Given: Product with leading/trailing whitespace
  await ensureAuthenticated();
  const rawName = `  修剪空白商品_${Date.now()}  `;

  // When: createProductAction
  const result = await createProductAction({
    name: rawName,
    category: '轉售商品',
    unit_name: '  個  '
  });

  // Then: Clean values stored
  assert.equal(result.product.name, rawName.trim());
  assert.equal(result.units[0].unit_name, '個');
});

test('TC-PROD-B-02 & B-03: Selling price and purchase cost of 0.0 allowed', async () => {
  // Given: Free promotional product
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `零元樣品_${Date.now()}`,
    category: '轉售商品',
    selling_price: 0.0
  });

  assert.equal(p.units[0].selling_price, 0.0);

  const vendor = await createPartnerAction({
    name: `免費贈品商_${Date.now()}`,
    isCustomer: false,
    isVendor: true
  });
  const src = await addSupplySourceAction(p.variants[0].id, vendor.id, 0.0);
  assert.equal(src.purchase_cost, 0.0);
});

test('TC-PROD-E-01 & E-02: Empty name and invalid category rejected', async () => {
  await ensureAuthenticated();

  // Empty name
  await assert.rejects(
    async () => {
      await createProductAction({ name: '   ', category: '轉售商品' });
    },
    /商品名稱不能為空/
  );

  // Invalid category
  await assert.rejects(
    async () => {
      await createProductAction({ name: '測試', category: '未知分類' });
    },
    /無效的商品類別/
  );
});

test('TC-PROD-E-03: Duplicate product name rejected', async () => {
  await ensureAuthenticated();
  const name = `重複品名_${Date.now()}`;
  await createProductAction({ name, category: '轉售商品' });

  await assert.rejects(
    async () => {
      await createProductAction({ name: `  ${name}  `, category: '轉售商品' });
    },
    /已存在/
  );
});

test('TC-PROD-E-04: Negative selling price rejected', async () => {
  await ensureAuthenticated();
  await assert.rejects(
    async () => {
      await createProductAction({
        name: `負數售價品_${Date.now()}`,
        category: '轉售商品',
        selling_price: -100
      });
    },
    /售價不能為負數/
  );
});

test('TC-PROD-E-05: Invalid conversion ratio rejected', async () => {
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `比率驗證品_${Date.now()}`,
    category: '轉售商品'
  });

  await assert.rejects(
    async () => {
      await addProductUnitAction(p.variants[0].id, '箱', 0.0);
    },
    /換算比例必須大於 0/
  );
});

test('TC-PROD-E-06: Negative purchase cost rejected', async () => {
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `成本驗證品_${Date.now()}`,
    category: '轉售商品'
  });
  const vendor = await createPartnerAction({
    name: `成本測試商_${Date.now()}`,
    isCustomer: false,
    isVendor: true
  });

  await assert.rejects(
    async () => {
      await addSupplySourceAction(p.variants[0].id, vendor.id, -5.0);
    },
    /採購成本不能為負數/
  );
});

test('TC-PROD-E-07: Non-vendor partner cannot be supply source', async () => {
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `供應商校驗品_${Date.now()}`,
    category: '轉售商品'
  });
  const customer = await createPartnerAction({
    name: `純客戶夥伴_${Date.now()}`,
    isCustomer: true,
    isVendor: false
  });

  await assert.rejects(
    async () => {
      await addSupplySourceAction(p.variants[0].id, customer.id, 50.0);
    },
    /供應商不存在或無效/
  );
});

test('TC-PROD-E-08: Non-manufactured product cannot have BOM', async () => {
  await ensureAuthenticated();
  const resale = await createProductAction({
    name: `轉售品不能有BOM_${Date.now()}`,
    category: '轉售商品'
  });
  const part = await createProductAction({
    name: `零件_${Date.now()}`,
    category: '原物料'
  });

  await assert.rejects(
    async () => {
      await addBomItemAction(resale.variants[0].id, part.variants[0].id, 1.0);
    },
    /非自製成品不可建立 BOM 組成/
  );
});

test('TC-PROD-E-09 & E-10: BOM self reference and non-positive quantity rejected', async () => {
  await ensureAuthenticated();
  const parent = await createProductAction({
    name: `自製品自我引用_${Date.now()}`,
    category: '自製成品'
  });
  const part = await createProductAction({
    name: `自製品零件_${Date.now()}`,
    category: '原物料'
  });

  // Self loop
  await assert.rejects(
    async () => {
      await addBomItemAction(parent.variants[0].id, parent.variants[0].id, 1.0);
    },
    /BOM 子物料不能為自身/
  );

  // Non-positive quantity
  await assert.rejects(
    async () => {
      await addBomItemAction(parent.variants[0].id, part.variants[0].id, 0.0);
    },
    /BOM 用量必須大於 0/
  );
});

test('TC-PROD-WF-01: Candidate extraction regex for natural text', () => {
  // 1. Quoted product with price and category
  const candidate1 = createProductToolHandler.extractCandidateRegex(
    '幫我新增轉售商品「智能核心晶片」售價 120 單位 顆'
  );
  assert.ok(candidate1);
  assert.equal(candidate1.tool, 'create_product');
  assert.equal(candidate1.name, '智能核心晶片');
  assert.equal(candidate1.category, '轉售商品');
  assert.equal(candidate1.selling_price, 120);
  assert.equal(candidate1.unit_name, '顆');

  // 2. Unquoted product
  const candidate2 = createProductToolHandler.extractCandidateRegex(
    '建立自製成品：AI伺服器機櫃 定價：150000'
  );
  assert.ok(candidate2);
  assert.equal(candidate2.name, 'AI伺服器機櫃');
  assert.equal(candidate2.category, '自製成品');
  assert.equal(candidate2.selling_price, 150000);

  // 3. List products query
  const listCandidate = listProductsToolHandler.extractCandidateRegex('請列出目前有哪些商品清單');
  assert.ok(listCandidate);
  assert.equal(listCandidate.tool, 'list_products');
});

test('TC-PROD-WF-02 & WF-03: Workflow harness execution with approval and cancellation', async () => {
  await ensureAuthenticated();
  const prodName = `AI流程商品_${Date.now()}`;

  // When: Running agent turn with natural prompt
  const turnResult = await runAgentTurn(
    `幫我新增轉售商品「${prodName}」售價 990`,
    productManagementAgentProfile,
    { taskId: 'main' }
  );

  // Then: Confirmation card returned
  assert.ok(turnResult.confirmation, 'Should produce a pending confirmation');
  assert.equal(turnResult.confirmation.toolName, 'create_product');
  assert.equal(turnResult.confirmation.args.name, prodName);

  // And When: User executes confirmation
  const confirmResult = await executeConfirmation(turnResult.confirmation, {
    taskId: 'main'
  });
  assert.ok(confirmResult.content.includes(prodName));
  const prodsAfterConfirm = await fetchProducts();
  assert.ok(prodsAfterConfirm.some(p => p.name === prodName), 'Product should exist after confirmation');

  // Cancellation test
  const cancelTurn = await runAgentTurn(
    `建立自製成品「取消測試品」`,
    productManagementAgentProfile,
    { taskId: 'main' }
  );
  assert.ok(cancelTurn.confirmation);
  const cancelResult = await executeCancellation(cancelTurn.confirmation, {
    taskId: 'main'
  });
  assert.ok(cancelResult.content.includes('已取消建立商品'));
  const prodsAfterCancel = await fetchProducts();
  assert.ok(!prodsAfterCancel.some(p => p.name === '取消測試品'), 'Product should not exist after cancellation');
});

test('TC-PROD-WF-04: AgentProfile manifest compliance', () => {
  assert.equal(productManagementAgentProfile.id, 'product.create_basic_profile');
  assert.equal(productManagementAgentProfile.domain, 'product');
  assert.ok(isKnownDomain(productManagementAgentProfile.domain));
  assert.equal(productManagementAgentProfile.tools.length, 2);
  assert.equal(productManagementAgentProfile.toolHandlers.length, 2);

  const taskProfile = getAgentProfileForTask({ title: '建立商品' });
  assert.equal(taskProfile.id, 'product.create_basic_profile');
});

test('TC-PROD-RES-01: Resilient fallback when product_id is passed to addProductUnitAction', async () => {
  // Given: An existing product with default variant
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `容錯單位品_${Date.now()}`,
    category: '轉售商品',
    selling_price: 15
  });

  // When: Calling addProductUnitAction with product_id instead of variant_id
  const unit = await addProductUnitAction(p.product.id, '箱', 24.0, false, 320.0);

  // Then: Fallback resolves to default variant and creates packaging unit
  assert.ok(unit.id);
  assert.equal(unit.unit_name, '箱');
  assert.equal(unit.conversion_ratio, 24.0);
  assert.equal(unit.selling_price, 320.0);

  const detail = await getProductDetailAction(p.product.id);
  assert.ok(detail.units.some(u => u.unit_name === '箱'));
});

test('TC-PROD-RES-02: Resilient fallback when product_id or variant_id is passed to addSupplySourceAction', async () => {
  // Given: An existing product and a vendor
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `容錯來源品_${Date.now()}`,
    category: '轉售商品'
  });
  const vendor = await createPartnerAction({
    name: `容錯供應商_${Date.now()}`,
    isCustomer: false,
    isVendor: true
  });
  const baseUnitId = p.units[0].id;

  // When: Calling addSupplySourceAction with product_id instead of unit_id
  const srcByProd = await addSupplySourceAction(p.product.id, vendor.id, 99.0, 'TWD', false);

  // Then: Fallback resolves to default variant base unit and links supply source
  assert.ok(srcByProd.id);
  assert.equal(srcByProd.unit_id, baseUnitId);
  assert.equal(srcByProd.vendor_partner_id, vendor.id);
  assert.equal(srcByProd.purchase_cost, 99.0);

  // When: Calling addSupplySourceAction with variant_id instead of unit_id
  const vendor2 = await createPartnerAction({
    name: `容錯供應商2_${Date.now()}`,
    isCustomer: false,
    isVendor: true
  });
  const srcByVar = await addSupplySourceAction(p.variants[0].id, vendor2.id, 88.0, 'TWD', false);

  // Then: Fallback resolves to variant base unit as well
  assert.ok(srcByVar.id);
  assert.equal(srcByVar.unit_id, baseUnitId);
  assert.equal(srcByVar.vendor_partner_id, vendor2.id);
  assert.equal(srcByVar.purchase_cost, 88.0);

  const detail = await getProductDetailAction(p.product.id);
  assert.ok(detail.supply_sources.some(s => s.vendor_partner_id === vendor.id));
  assert.ok(detail.supply_sources.some(s => s.vendor_partner_id === vendor2.id));
});

test('TC-PROD-RES-03: Resilient fallback when product_id or synthetic ID is passed to addBomItemAction', async () => {
  // Given: Manufactured parent and raw material child
  await ensureAuthenticated();
  const parent = await createProductAction({
    name: `容錯BOM成品_${Date.now()}`,
    category: '自製成品'
  });
  const child = await createProductAction({
    name: `容錯BOM零件_${Date.now()}`,
    category: '原物料'
  });

  // When: Calling addBomItemAction with product_id for parent and child
  const bom = await addBomItemAction(parent.product.id, child.product.id, 5.0);

  // Then: Both parent and child resolve to their default variants
  assert.ok(bom.id);
  assert.equal(bom.parent_variant_id, parent.variants[0].id);
  assert.equal(bom.child_variant_id, child.variants[0].id);
  assert.equal(bom.quantity, 5.0);

  // And When: Calling with synthetic ID `var_{child.id}_std`
  const bom2 = await addBomItemAction(parent.variants[0].id, `var_${child.product.id}_std`, 2.5);
  assert.ok(bom2.id);
  assert.equal(bom2.child_variant_id, child.variants[0].id);
  assert.equal(bom2.quantity, 2.5);
});
