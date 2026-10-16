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
 * | TC-PROD-ALIAS-01 | Invoke list_product via IPC, ToolHandler, and runAgentTurn | Equivalence – Singular alias workflow compatibility | Successfully executes without whitelist blocking | Tool alias DoD |
 * | TC-VAR-N-01 | Create product without specs | Equivalence – Auto default variant | Generates default variant with spec_attributes={} | Happy path |
 * | TC-VAR-N-02 | Add variant with name, sku, and spec_attributes | Equivalence – Variant with spec_attributes | Variant created and attached to product | Happy path |
 * | TC-VAR-N-03 | Update variant SKU and spec_attributes | Equivalence – Update existing variant | Variant updated successfully | Happy path |
 * | TC-VAR-N-04 | Update variant name only | Equivalence – Partial update | Variant name updated, other fields preserved | Happy path |
 * | TC-VAR-B-01 | Add variant with spec_attributes={} | Boundary – Empty spec object | Allowed, saved as {} | Lower bound |
 * | TC-VAR-B-02 | Add variant with whitespace in name/sku | Boundary – Whitespace trimming | Automatically trimmed in store and mock | Normalization |
 * | TC-VAR-B-03 | Add variant with empty name but valid spec_attributes | Boundary – Auto-derived variant name | Generates name from attribute values | Resilient fallback |
 * | TC-VAR-B-04 | Update variant: clear SKU to null/empty | Boundary – Clear optional SKU | SKU set to null | Boundary |
 * | TC-VAR-B-05 | Query product details with multiple variants | Boundary – Collection ordering | Default variant sorted first | Ordering |
 * | TC-VAR-E-01 | Add variant: empty name and empty spec_attributes | Error – Required name or attributes | Throws validation error | Validation |
 * | TC-VAR-E-02 | Add variant: duplicate name in same product | Error – Duplicate variant name | Rejects with duplicate error | Uniqueness guard |
 * | TC-VAR-E-03 | Add variant: nonexistent product_id | Error – Invalid product ID | Rejects with product not found | Relation check |
 * | TC-VAR-E-04 | Update variant: nonexistent variant_id | Error – Invalid variant ID | Rejects with variant not found | Primary key check |
 * | TC-VAR-E-05 | Update variant: duplicate name with another variant in same product | Error – Duplicate variant name | Rejects with duplicate error | Uniqueness guard |
 * | TC-VAR-E-06 | Update variant: empty or whitespace name | Error – Empty name update | Rejects with validation error | Required field |
 * | TC-VAR-E-07 | Cross-tenant add variant: Tenant A to Tenant B | Error – Tenant isolation | Rejects with not found | Multi-tenant security |
 * | TC-VAR-E-08 | Cross-tenant update variant: Tenant A to Tenant B | Error – Tenant isolation | Rejects with not found | Multi-tenant security |
 * | TC-VAR-E-09 | Invalid spec_attributes format (array or non-object) | Error – Malformed JSON/object | Rejects with format error | Schema guard |
 * | TC-UNIT-N-01 | Create variant auto base unit | Equivalence – Auto base unit creation | Base unit created with ratio=1.0 and is_base_unit=true | Auto init |
 * | TC-UNIT-N-02 | Add packaging unit '盒' (ratio: 10, sell_price: 900) | Equivalence – Multi-packaging unit addition | Packaging unit created with ratio and sell_price | Packaging unit |
 * | TC-UNIT-N-03 | Add unit with selling_price parameter | Equivalence – Dual alias compatibility | selling_price properly mapped and stored | Alias compatibility |
 * | TC-UNIT-N-04 | Add unit to non-sellable product (raw material) | Equivalence – Non-sellable unit | Unit created, sell_price defaults to 0 | Non-sellable |
 * | TC-UNIT-N-05 | Update packaging unit name and sell_price | Equivalence – Unit modification | Unit attributes updated successfully | Update action |
 * | TC-UNIT-N-06 | Update unit conversion ratio for packaging unit | Equivalence – Packaging unit ratio adjustment | Conversion ratio updated successfully | Ratio update |
 * | TC-UNIT-N-07 | Switch base unit from existing base to another unit | Equivalence – Base unit reassignment | New base unit gets ratio=1.0 & is_base_unit=true; old base unit unseated | Base reassignment |
 * | TC-UNIT-B-01 | Unit name with leading/trailing whitespaces | Boundary – Whitespace trimming | Automatically trimmed in store and mock | Normalization |
 * | TC-UNIT-B-02 | sell_price = 0.0 for sellable unit | Boundary – Free sample / zero price | Allowed and stored as 0.0 | Lower bound |
 * | TC-UNIT-B-03 | Large conversion ratio and fractional ratio | Boundary – Ratio boundary values | Handled accurately without overflow or truncation | Scale boundary |
 * | TC-UNIT-B-04 | Large sell_price value | Boundary – Large monetary value | Handled accurately | High bound |
 * | TC-UNIT-B-05 | Add unit as base unit when base already exists | Boundary – Add unit preempting base unit | New unit becomes base, existing base becomes non-base | Preemptive base |
 * | TC-UNIT-B-06 | Update unit selling_price via sell_price alias | Boundary – Alias in update payload | selling_price and sell_price both synchronized | Alias in update |
 * | TC-UNIT-E-01 | Add unit with empty unit_name | Error – Empty unit name | Rejects with validation error | Required field |
 * | TC-UNIT-E-02 | Add unit with non-positive conversion_ratio (0) | Error – Zero conversion ratio | Rejects with ratio validation error | Ratio check |
 * | TC-UNIT-E-03 | Add unit with negative conversion_ratio (-5) | Error – Negative conversion ratio | Rejects with ratio validation error | Ratio check |
 * | TC-UNIT-E-04 | Add unit with negative sell_price (-100) | Error – Negative sell price | Rejects with price validation error | Price check |
 * | TC-UNIT-E-05 | Add unit with duplicate unit_name in same variant | Error – Duplicate unit name | Rejects with duplicate unit error | Uniqueness guard |
 * | TC-UNIT-E-06 | Add unit to nonexistent variant_id | Error – Invalid variant ID | Rejects with variant not found | Relation check |
 * | TC-UNIT-E-07 | Update nonexistent unit_id | Error – Invalid unit ID | Rejects with unit not found | Primary key check |
 * | TC-UNIT-E-08 | Update unit with empty unit_name | Error – Empty unit name in update | Rejects with validation error | Required field |
 * | TC-UNIT-E-09 | Update unit to duplicate unit_name with sibling unit | Error – Duplicate unit name in update | Rejects with duplicate unit error | Uniqueness guard |
 * | TC-UNIT-E-10 | Update base unit to have conversion_ratio != 1.0 | Error – Base unit ratio constraint | Rejects or enforces ratio 1.0 | Integrity check |
 * | TC-UNIT-E-11 | Demote base unit when no other base unit exists | Error – Lone base unit demotion | Rejects demotion to preserve variant's base unit | Invariant guard |
 * | TC-SRC-N-01 | Multi-vendor registration with distinct costs for same unit | Equivalence – Multi-vendor support | Both sources registered with distinct pricing | Multi-vendor |
 * | TC-SRC-N-02 | Update supply source purchase cost | Equivalence – Cost update | Cost updated in store and detail | Update action |
 * | TC-SRC-N-03 | Update vendor and toggle primary flag | Equivalence – Vendor & primary update | Vendor and is_primary updated | Relation update |
 * | TC-SRC-N-04 | Support cost alias in add and update | Equivalence – Dual alias compatibility | cost and purchase_cost both synchronized | Alias compatibility |
 * | TC-SRC-N-05 | Primary supply source exclusivity on add and update | Equivalence – Exclusivity & auto-demote | Demotes other sources in same unit so only 1 primary remains | Invariant guard |
 * | TC-SRC-B-01 | Zero purchase cost (0.0) allowed | Boundary – Zero cost | Allowed and stored as 0.0 | Lower bound |
 * | TC-SRC-B-02 | Whitespace trimming on vendor ID and currency | Boundary – Whitespace trimming | Automatically trimmed in store and mock | Normalization |
 * | TC-SRC-E-01 | Negative purchase cost rejected | Error – Negative cost validation | Rejects with validation error | Number validation |
 * | TC-SRC-E-02 | Non-vendor partner cannot be supply source | Error – Non-vendor partner | Rejects with vendor error | Relation check |
 * | TC-SRC-E-03 | Update nonexistent or empty source ID rejected | Error – Invalid source ID | Rejects with not found | Primary key check |
 * | TC-SRC-E-04 | Cross-tenant supply source update rejected | Error – Tenant isolation | Rejects cross-tenant mutation | Security guard |
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
  updateProductVariantAction,
  addProductUnitAction,
  updateProductUnitAction,
  addSupplySourceAction,
  updateSupplySourceAction,
  addBomItemAction,
  resolveCategoryFlags,
  createPartnerAction
} = await import('../src/lib/store.svelte.js');

const {
  createProductToolHandler,
  listProductsToolHandler,
  listProductToolHandler,
  productManagementAgentProfile,
  KNOWN_DOMAINS,
  isKnownDomain,
  runAgentTurn,
  executeConfirmation,
  executeCancellation,
  getAgentProfileForTask
} = await import('../src/lib/workflow/index.js');

const { invoke } = await import('../src/lib/tauri.js');

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

  // Then: BOM item is linked and child product/variant names are populated
  assert.ok(bom.id);
  assert.equal(bom.parent_variant_id, parent.variants[0].id);
  assert.equal(bom.child_variant_id, child.variants[0].id);
  assert.equal(bom.quantity, 3.5);
  assert.equal(bom.child_product_name, child.product.name);
  assert.equal(bom.child_variant_name, child.variants[0].name);

  const detail = await getProductDetailAction(parent.product.id);
  assert.equal(detail.bom_items.length, 1);
  assert.equal(detail.bom_items[0].child_product_name, child.product.name);
  assert.equal(detail.bom_items[0].child_variant_name, child.variants[0].name);
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
  assert.equal(productManagementAgentProfile.tools.length, 3);
  assert.equal(productManagementAgentProfile.toolHandlers.length, 3);
  const toolNames = productManagementAgentProfile.tools.map(t => t?.function?.name);
  assert.ok(toolNames.includes('list_products'));
  assert.ok(toolNames.includes('create_product'));
  assert.ok(toolNames.includes('list_product'));

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
  const uniqueSuffix = `${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const parent = await createProductAction({
    name: `容錯BOM成品_${uniqueSuffix}`,
    category: '自製成品'
  });
  const child = await createProductAction({
    name: `容錯BOM零件_${uniqueSuffix}`,
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

test('TC-PROD-ALIAS-01: list_product alias is fully supported in invoke, toolHandlers, and runAgentTurn workflow', async () => {
  // Given: Active session in tnt_mock_1 with known products
  await ensureAuthenticated();
  await selectTenantAction('tnt_mock_1');

  // When: Calling invoke with singular 'list_product' command
  const singularResult = await invoke('list_product');
  const pluralResult = await invoke('list_products');

  // Then: Both return arrays with identical items
  assert.ok(Array.isArray(singularResult));
  assert.ok(Array.isArray(pluralResult));
  assert.equal(singularResult.length, pluralResult.length);

  // And When: Executing listProductToolHandler directly
  const handlerResult = await listProductToolHandler.execute();
  assert.ok(Array.isArray(handlerResult));
  assert.equal(handlerResult.length, pluralResult.length);

  // And Then: Tool definition name is 'list_product' and formatResult formats list correctly
  assert.equal(listProductToolHandler.definition.function.name, 'list_product');
  const formatted = listProductToolHandler.formatResult(handlerResult);
  assert.ok(typeof formatted === 'string');
  assert.ok(formatted.includes('已為您查詢到'));

  // And When: Simulating AI agent turn calling singular tool 'list_product' (e.g. LLM model output alias)
  const simulatedLlmTurn = await runAgentTurn(
    '請幫我列出商品',
    productManagementAgentProfile,
    { taskId: 'task_m7_product' },
    {
      llmDetector: async () => ({
        tool: 'list_product',
        args: {}
      })
    }
  );

  // Then: The turn succeeds through the harness without being blocked by whitelist security check
  assert.notEqual(simulatedLlmTurn.type, 'error', 'Tool call should not be blocked or rejected as error');
  assert.equal(simulatedLlmTurn.type, 'executed');
  assert.equal(simulatedLlmTurn.toolName, 'list_product');
  assert.ok(Array.isArray(simulatedLlmTurn.result));
  assert.ok(simulatedLlmTurn.content.includes('已為您查詢到'), 'Response should contain formatted product list');
});

// ==========================================
// Issue #139: Specification Variants Test Suite
// ==========================================

test('TC-VAR-N-01: Create product without specs auto-generates default variant with empty spec_attributes', async () => {
  // Given: Unique product info without variants specified
  await ensureAuthenticated();
  const prodName = `變體測試商品_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  // When: Calling createProductAction
  const result = await createProductAction({
    name: prodName,
    category: '轉售商品',
    selling_price: 200
  });

  // Then: Default variant is generated with is_default=true and empty spec_attributes
  assert.ok(result.product.id);
  assert.equal(result.variants.length, 1);
  const defVar = result.variants[0];
  assert.equal(defVar.is_default, true);
  assert.equal(defVar.name, '標準');
  assert.deepEqual(defVar.spec_attributes, {});
});

test('TC-VAR-N-02: Add variant with name, sku, and spec_attributes successfully', async () => {
  // Given: An existing product
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `多規格服飾_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    category: '轉售商品'
  });

  // When: Adding variant with color and size spec_attributes
  const newVar = await addProductVariantAction(
    p.product.id,
    '紅色 / M',
    'CLOTH-RED-M',
    { 顏色: '紅色', 尺寸: 'M' }
  );

  // Then: Variant created with attributes and attached
  assert.ok(newVar.id);
  assert.equal(newVar.product_id, p.product.id);
  assert.equal(newVar.name, '紅色 / M');
  assert.equal(newVar.sku, 'CLOTH-RED-M');
  assert.deepEqual(newVar.spec_attributes, { 顏色: '紅色', 尺寸: 'M' });
  assert.equal(newVar.is_default, false);

  const detail = await getProductDetailAction(p.product.id);
  assert.equal(detail.variants.length, 2);
  const found = detail.variants.find(v => v.id === newVar.id);
  assert.ok(found);
  assert.deepEqual(found.spec_attributes, { 顏色: '紅色', 尺寸: 'M' });
});

test('TC-VAR-N-03: Update variant SKU and spec_attributes', async () => {
  // Given: Product with an added variant
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `運動長褲_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    category: '轉售商品'
  });
  const v = await addProductVariantAction(p.product.id, '黑色 / L', 'PANTS-BLK-L', { 顏色: '黑色', 尺寸: 'L' });

  // When: Updating SKU and spec_attributes
  const updated = await updateProductVariantAction(v.id, {
    sku: 'PANTS-BLK-L-V2',
    spec_attributes: { 顏色: '黑色', 尺寸: 'L', 材質: '聚酯纖維' },
    productId: p.product.id
  });

  // Then: SKU and attributes updated while name is preserved
  assert.equal(updated.id, v.id);
  assert.equal(updated.name, '黑色 / L');
  assert.equal(updated.sku, 'PANTS-BLK-L-V2');
  assert.deepEqual(updated.spec_attributes, { 顏色: '黑色', 尺寸: 'L', 材質: '聚酯纖維' });

  const detail = await getProductDetailAction(p.product.id);
  const reloaded = detail.variants.find(varItem => varItem.id === v.id);
  assert.equal(reloaded.sku, 'PANTS-BLK-L-V2');
  assert.deepEqual(reloaded.spec_attributes, { 顏色: '黑色', 尺寸: 'L', 材質: '聚酯纖維' });
});

test('TC-VAR-N-04: Update variant name only', async () => {
  // Given: Product with a variant
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `手機殼_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    category: '轉售商品'
  });
  const v = await addProductVariantAction(p.product.id, '原色', 'CASE-RAW', { 色系: '透明' });

  // When: Updating name only
  const updated = await updateProductVariantAction(v.id, {
    name: '極致透明原色',
    productId: p.product.id
  });

  // Then: Name is updated, other fields preserved
  assert.equal(updated.name, '極致透明原色');
  assert.equal(updated.sku, 'CASE-RAW');
  assert.deepEqual(updated.spec_attributes, { 色系: '透明' });
});

test('TC-VAR-B-01: Add variant with empty spec_attributes object', async () => {
  // Given: Existing product
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `空屬性商品_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    category: '轉售商品'
  });

  // When: Adding variant with spec_attributes: {}
  const v = await addProductVariantAction(p.product.id, '無軸向規格', 'SKU-NONE', {});

  // Then: Saved with empty spec_attributes
  assert.deepEqual(v.spec_attributes, {});
});

test('TC-VAR-B-02: Whitespace trimming on variant name and SKU', async () => {
  // Given: Product exists
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `空白修剪測試_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    category: '轉售商品'
  });

  // When: Adding variant with leading and trailing whitespaces
  const v = await addProductVariantAction(
    p.product.id,
    '   藍色 / XL   ',
    '   CLOTH-BLU-XL   ',
    { 顏色: '藍色' }
  );

  // Then: Whitespace is trimmed
  assert.equal(v.name, '藍色 / XL');
  assert.equal(v.sku, 'CLOTH-BLU-XL');
});

test('TC-VAR-B-03: Auto-derived variant name when name is empty but spec_attributes has values', async () => {
  // Given: Product exists
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `自動名稱商品_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    category: '轉售商品'
  });

  // When: Adding variant with empty name and spec_attributes
  const v = await addProductVariantAction(
    p.product.id,
    '',
    'AUTO-01',
    { 顏色: '黃色', 尺寸: 'S' }
  );

  // Then: Name is auto-derived from attribute values
  assert.ok(v.name);
  assert.ok(v.name.includes('黃色'));
  assert.ok(v.name.includes('S'));
});

test('TC-VAR-B-04: Update variant: clearing SKU to empty string normalizes to null', async () => {
  // Given: Variant with initial SKU
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `清空SKU商品_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    category: '轉售商品'
  });
  const v = await addProductVariantAction(p.product.id, '規格A', 'SKU-A');

  // When: Updating SKU to empty string
  const updated = await updateProductVariantAction(v.id, {
    sku: '   ',
    productId: p.product.id
  });

  // Then: SKU is normalized to null
  assert.equal(updated.sku, null);
});

test('TC-VAR-B-05: Query product detail preserves variant collection ordering (default first)', async () => {
  // Given: Product with default and two custom variants
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `排序測試商品_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    category: '轉售商品'
  });
  await addProductVariantAction(p.product.id, '變體 1');
  await addProductVariantAction(p.product.id, '變體 2');

  // When: Fetching product detail
  const detail = await getProductDetailAction(p.product.id);

  // Then: 3 variants, and index 0 is default variant
  assert.equal(detail.variants.length, 3);
  assert.equal(detail.variants[0].is_default, true);
  assert.equal(detail.variants[1].is_default, false);
  assert.equal(detail.variants[2].is_default, false);
});

test('TC-VAR-E-01: Add variant: empty name and empty spec_attributes throws error', async () => {
  // Given: Product exists
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `空名稱驗證_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    category: '轉售商品'
  });

  // When & Then: Throws validation error
  await assert.rejects(
    async () => {
      await addProductVariantAction(p.product.id, '   ', undefined, {});
    },
    {
      message: '變體名稱不能為空'
    }
  );
});

test('TC-VAR-E-02: Add variant: duplicate name in same product is rejected', async () => {
  // Given: Product with an existing variant
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `重複名稱商品_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    category: '轉售商品'
  });
  await addProductVariantAction(p.product.id, '紅色');

  // When & Then: Adding another variant with identical name (ignoring case & whitespace)
  await assert.rejects(
    async () => {
      await addProductVariantAction(p.product.id, '  紅色  ');
    },
    /變體「紅色」已存在/
  );
});

test('TC-VAR-E-03: Add variant: nonexistent product_id is rejected', async () => {
  // Given: Nonexistent product ID
  await ensureAuthenticated();

  // When & Then: Rejects with Product not found
  await assert.rejects(
    async () => {
      await addProductVariantAction('prod_nonexistent_9999', '標準');
    },
    /Product not found/
  );
});

test('TC-VAR-E-04: Update variant: nonexistent variant_id is rejected', async () => {
  // Given: Nonexistent variant ID
  await ensureAuthenticated();

  // When & Then: Rejects with Variant not found
  await assert.rejects(
    async () => {
      await updateProductVariantAction('var_nonexistent_9999', { name: '新名稱' });
    },
    /Variant not found/
  );
});

test('TC-VAR-E-05: Update variant: duplicate name with another sibling variant is rejected', async () => {
  // Given: Product with two distinct variants
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `編輯衝突商品_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    category: '轉售商品'
  });
  const v1 = await addProductVariantAction(p.product.id, '紅色');
  const v2 = await addProductVariantAction(p.product.id, '藍色');

  // When & Then: Renaming v2 to v1's name is rejected
  await assert.rejects(
    async () => {
      await updateProductVariantAction(v2.id, { name: '  紅色  ' });
    },
    /變體名稱「紅色」已存在/
  );
});

test('TC-VAR-E-06: Update variant: empty or whitespace name is rejected', async () => {
  // Given: Variant exists
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `空名稱更新商品_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    category: '轉售商品'
  });
  const v = await addProductVariantAction(p.product.id, '規格一');

  // When & Then: Updating name to whitespace throws error
  await assert.rejects(
    async () => {
      await updateProductVariantAction(v.id, { name: '   ' });
    },
    /變體名稱不能為空/
  );
});

test('TC-VAR-E-07: Cross-tenant add variant: Tenant B cannot add variant to Tenant A product', async () => {
  // Given: Product created in Tenant 1
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `租戶A專屬_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    category: '轉售商品'
  });

  // When: Switching to Tenant 2
  await selectTenantAction('tnt_mock_2');

  // Then: Attempting to add variant to Tenant 1's product fails
  await assert.rejects(
    async () => {
      await addProductVariantAction(p.product.id, '惡意規格');
    },
    /Product not found/
  );

  // Restore Tenant 1
  await selectTenantAction('tnt_mock_1');
});

test('TC-VAR-E-08: Cross-tenant update variant: Tenant B cannot update Tenant A variant', async () => {
  // Given: Variant created in Tenant 1
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `租戶A更新保護_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    category: '轉售商品'
  });
  const v = await addProductVariantAction(p.product.id, '規格A');

  // When: Switching to Tenant 2
  await selectTenantAction('tnt_mock_2');

  // Then: Attempting to update Tenant 1's variant fails
  await assert.rejects(
    async () => {
      await updateProductVariantAction(v.id, { name: '竄改名稱' });
    },
    /Variant not found/
  );

  // Restore Tenant 1
  await selectTenantAction('tnt_mock_1');
});

test('TC-VAR-E-09: Invalid spec_attributes format (array or non-object) is rejected', async () => {
  // Given: Product exists
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `格式錯誤測試_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    category: '轉售商品'
  });

  // When & Then: Passing array as spec_attributes throws error
  await assert.rejects(
    async () => {
      await invoke('add_product_variant', {
        product_id: p.product.id,
        name: '陣列屬性變體',
        spec_attributes: ['顏色', '紅']
      });
    },
    /規格屬性必須為 JSON 物件格式/
  );
});

// ==========================================
// Issue #140: Product Units & Pricing Tests (TC-UNIT-*)
// ==========================================

test('TC-UNIT-N-01: Auto-generate base unit when creating product with unit_name & price', async () => {
  // Given: Authenticated tenant user creating resale product
  await ensureAuthenticated();
  const prodName = `單位自動生成_${Date.now()}`;

  // When: Calling createProductAction
  const p = await createProductAction({
    name: prodName,
    category: '轉售商品',
    unit_name: '罐',
    selling_price: 65
  });

  // Then: Default variant has base unit with ratio 1.0, is_base_unit true, and both selling_price & sell_price
  assert.equal(p.units.length, 1);
  assert.equal(p.units[0].unit_name, '罐');
  assert.equal(p.units[0].conversion_ratio, 1.0);
  assert.equal(p.units[0].is_base_unit, true);
  assert.equal(p.units[0].selling_price, 65);
  assert.equal(p.units[0].sell_price, 65);
});

test('TC-UNIT-N-02: Auto-generate base unit when adding a new variant to existing product', async () => {
  // Given: Product created with default variant
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `多變體單位品_${Date.now()}`,
    category: '轉售商品',
    unit_name: '包',
    selling_price: 30
  });

  // When: Adding a new variant "大容量"
  const newVar = await addProductVariantAction(p.product.id, '大容量', 'BIG-001', { 容量: '大' });

  // Then: Querying product detail shows new variant automatically has a base unit
  const detail = await getProductDetailAction(p.product.id);
  const vUnits = detail.units.filter(u => u.variant_id === newVar.id);
  assert.equal(vUnits.length, 1, '新變體應自動具備至少一個基礎單位');
  assert.equal(vUnits[0].unit_name, '包');
  assert.equal(vUnits[0].conversion_ratio, 1.0);
  assert.equal(vUnits[0].is_base_unit, true);
  assert.equal(vUnits[0].selling_price, 30);

  // When: Updating secondary variant's unit price to 88 and adding 3rd variant
  await updateProductUnitAction(vUnits[0].id, { selling_price: 88 });
  const thirdVar = await addProductVariantAction(p.product.id, '特大容量', 'BIG-002', { 容量: '特大' });

  // Then: 3rd variant still inherits base unit price from default variant (30)
  const detail3 = await getProductDetailAction(p.product.id);
  const v3Units = detail3.units.filter(u => u.variant_id === thirdVar.id);
  assert.equal(v3Units.length, 1);
  assert.equal(v3Units[0].selling_price, 30);
});

test('TC-UNIT-N-03: Add secondary packaging unit with ratio > 1 and distinct price', async () => {
  // Given: Product with base unit
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `階層包裝品_${Date.now()}`,
    category: '轉售商品',
    unit_name: '支',
    selling_price: 10
  });
  const varId = p.variants[0].id;

  // When: Adding secondary packaging unit "盒" (ratio 12, price 110)
  const unit = await addProductUnitAction(varId, '盒', 12.0, false, 110.0);

  // Then: Unit is recorded properly with is_base_unit = false
  assert.ok(unit.id);
  assert.equal(unit.unit_name, '盒');
  assert.equal(unit.conversion_ratio, 12.0);
  assert.equal(unit.is_base_unit, false);
  assert.equal(unit.selling_price, 110.0);
  assert.equal(unit.sell_price, 110.0);
});

test('TC-UNIT-N-04: Update unit name, ratio, and sell_price successfully via updateProductUnitAction', async () => {
  // Given: Product with packaging unit
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `單位更新測試品_${Date.now()}`,
    category: '轉售商品',
    unit_name: '個',
    selling_price: 20
  });
  const unit = await addProductUnitAction(p.variants[0].id, '盒', 10.0, false, 190.0);

  // When: Updating unit name to "大盒", ratio to 12.0, price to 220.0
  const updated = await updateProductUnitAction(unit.id, {
    unit_name: '大盒',
    conversion_ratio: 12.0,
    selling_price: 220.0,
    productId: p.product.id
  });

  // Then: All fields are updated properly
  assert.equal(updated.unit_name, '大盒');
  assert.equal(updated.conversion_ratio, 12.0);
  assert.equal(updated.selling_price, 220.0);
  assert.equal(updated.is_base_unit, false);
});

test('TC-UNIT-N-05: Update unit to become base unit (is_base_unit: true), auto-switching previous base unit', async () => {
  // Given: Variant with base unit "個" and secondary unit "盒"
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `基準單位切換品_${Date.now()}`,
    category: '轉售商品',
    unit_name: '個',
    selling_price: 5
  });
  const originalBaseId = p.units[0].id;
  const boxUnit = await addProductUnitAction(p.variants[0].id, '盒', 10.0, false, 45.0);

  // When: Promoting "盒" to base unit
  const updatedBox = await updateProductUnitAction(boxUnit.id, {
    is_base_unit: true,
    productId: p.product.id
  });

  // Then: "盒" becomes base unit with ratio 1.0, and original "個" is demoted to non-base unit
  assert.equal(updatedBox.is_base_unit, true);
  assert.equal(updatedBox.conversion_ratio, 1.0);

  const detail = await getProductDetailAction(p.product.id);
  const oldBase = detail.units.find(u => u.id === originalBaseId);
  assert.equal(oldBase.is_base_unit, false);
});

test('TC-UNIT-N-06: Create packaging unit for non-sellable product (raw_material) without sell_price', async () => {
  // Given: Raw material product (is_sellable = false)
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `原料包裝品_${Date.now()}`,
    category: '原物料',
    unit_name: '公斤'
  });

  // When: Adding packaging unit "袋" (ratio 25) without sell_price
  const unit = await addProductUnitAction(p.variants[0].id, '袋', 25.0, false);

  // Then: Unit created successfully with selling_price 0.0
  assert.equal(unit.unit_name, '袋');
  assert.equal(unit.conversion_ratio, 25.0);
  assert.equal(unit.selling_price, 0.0);
});

test('TC-UNIT-N-07: Resilient field access: accept both sell_price and selling_price', async () => {
  // Given: Product created
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `別名傳參品_${Date.now()}`,
    category: '轉售商品'
  });

  // When: Creating unit using sell_price in invoke directly
  const unit = await invoke('add_product_unit', {
    variant_id: p.variants[0].id,
    unit_name: '打',
    conversion_ratio: 12.0,
    sell_price: 108.0
  });

  // Then: Both sell_price and selling_price fields exist on returned object
  assert.equal(unit.sell_price, 108.0);
  assert.equal(unit.selling_price, 108.0);

  // When: Updating using sell_price
  const updated = await invoke('update_product_unit', {
    unit_id: unit.id,
    sell_price: 115.0
  });

  // Then: Value updated
  assert.equal(updated.selling_price, 115.0);
  assert.equal(updated.sell_price, 115.0);
});

test('TC-UNIT-B-01: Boundary – conversion ratio = 1.0', async () => {
  // Given: Product created
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `比率邊界一品_${Date.now()}`,
    category: '轉售商品'
  });

  // When: Adding unit with ratio exactly 1.0
  const unit = await addProductUnitAction(p.variants[0].id, '組', 1.0, false, 50.0);

  // Then: Exactly 1.0 stored
  assert.equal(unit.conversion_ratio, 1.0);
});

test('TC-UNIT-B-02: Boundary – conversion ratio fractional value 0.001 allowed', async () => {
  // Given: Product created
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `微量比率品_${Date.now()}`,
    category: '轉售商品'
  });

  // When: Adding unit with tiny fraction
  const unit = await addProductUnitAction(p.variants[0].id, '毫克', 0.001, false, 1.0);

  // Then: Precision preserved
  assert.equal(unit.conversion_ratio, 0.001);
});

test('TC-UNIT-B-03: Boundary – selling_price = 0.0 allowed (promotional/sample unit)', async () => {
  // Given: Product created
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `贈品單位測試_${Date.now()}`,
    category: '轉售商品'
  });

  // When: Adding free sample unit with price 0.0
  const unit = await addProductUnitAction(p.variants[0].id, '試用包', 1.0, false, 0.0);

  // Then: Price is 0.0
  assert.equal(unit.selling_price, 0.0);
});

test('TC-UNIT-B-04: Boundary – selling_price = 99999999.99 (large value)', async () => {
  // Given: Product created
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `高價單位測試_${Date.now()}`,
    category: '轉售商品'
  });

  // When: Adding unit with large price
  const unit = await addProductUnitAction(p.variants[0].id, '批', 1000.0, false, 99999999.99);

  // Then: Stored without overflow
  assert.equal(unit.selling_price, 99999999.99);
});

test('TC-UNIT-B-05: Boundary – whitespace trimming on unit_name', async () => {
  // Given: Product created
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `空白清理單位品_${Date.now()}`,
    category: '轉售商品'
  });

  // When: Adding unit with leading/trailing spaces
  const unit = await addProductUnitAction(p.variants[0].id, '   箱   ', 10.0, false, 90.0);

  // Then: Cleaned to '箱'
  assert.equal(unit.unit_name, '箱');
});

test('TC-UNIT-B-06: Boundary – base unit conversion_ratio locked to 1.0', async () => {
  // Given: Product with base unit
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `基準比率約束品_${Date.now()}`,
    category: '轉售商品',
    unit_name: '瓶',
    selling_price: 40
  });
  const baseUnitId = p.units[0].id;

  // When & Then: Attempting to update base unit with ratio != 1.0 throws error
  await assert.rejects(
    async () => {
      await updateProductUnitAction(baseUnitId, { conversion_ratio: 5.0 });
    },
    /基準單位換算比例必須為 1/
  );
});

test('TC-UNIT-E-01: Boundary – empty or whitespace unit_name rejected', async () => {
  // Given: Product created
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `空名稱單位品_${Date.now()}`,
    category: '轉售商品'
  });

  // When & Then: Empty name rejected
  await assert.rejects(
    async () => {
      await addProductUnitAction(p.variants[0].id, '   ', 10.0);
    },
    /單位名稱不能為空/
  );
});

test('TC-UNIT-E-02: Boundary – NULL/undefined unit_name rejected', async () => {
  // Given: Product created
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `無名稱單位品_${Date.now()}`,
    category: '轉售商品'
  });

  // When & Then: Null name rejected
  await assert.rejects(
    async () => {
      await invoke('add_product_unit', {
        variant_id: p.variants[0].id,
        unit_name: null,
        conversion_ratio: 5.0
      });
    },
    /單位名稱不能為空/
  );
});

test('TC-UNIT-E-03: Boundary – conversion_ratio = 0.0 rejected', async () => {
  // Given: Product created
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `零比例品_${Date.now()}`,
    category: '轉售商品'
  });

  // When & Then: Ratio 0 rejected
  await assert.rejects(
    async () => {
      await addProductUnitAction(p.variants[0].id, '組', 0.0);
    },
    /換算比例必須大於 0/
  );
});

test('TC-UNIT-E-04: Boundary – conversion_ratio = -1.0 (negative) rejected', async () => {
  // Given: Product created
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `負比例品_${Date.now()}`,
    category: '轉售商品'
  });

  // When & Then: Negative ratio rejected
  await assert.rejects(
    async () => {
      await addProductUnitAction(p.variants[0].id, '組', -1.0);
    },
    /換算比例必須大於 0/
  );
});

test('TC-UNIT-E-05: Boundary – selling_price = -0.01 / -1.0 (negative) rejected', async () => {
  // Given: Product created
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `負價品_${Date.now()}`,
    category: '轉售商品'
  });

  // When & Then: Negative price rejected
  await assert.rejects(
    async () => {
      await addProductUnitAction(p.variants[0].id, '組', 5.0, false, -0.01);
    },
    /售價不能為負數/
  );
});

test('TC-UNIT-E-06: Error – duplicate unit_name within same variant rejected', async () => {
  // Given: Variant with unit "箱"
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `重複單位品_${Date.now()}`,
    category: '轉售商品'
  });
  await addProductUnitAction(p.variants[0].id, '箱', 10.0, false, 90.0);

  // When & Then: Adding another "箱" or " 箱 " to the same variant throws duplicate error
  await assert.rejects(
    async () => {
      await addProductUnitAction(p.variants[0].id, '  箱  ', 20.0, false, 180.0);
    },
    /單位「箱」已存在/
  );
});

test('TC-UNIT-E-07: Error – update nonexistent unit_id rejected', async () => {
  // Given: Authenticated user
  await ensureAuthenticated();

  // When & Then: Updating nonexistent unit throws error
  await assert.rejects(
    async () => {
      await updateProductUnitAction('unit_nonexistent_9999', { unit_name: '新名' });
    },
    /Product unit not found/
  );
});

test('TC-UNIT-E-08: Error – add unit to nonexistent variant_id rejected', async () => {
  // Given: Authenticated user
  await ensureAuthenticated();

  // When & Then: Adding unit to nonexistent variant throws error
  await assert.rejects(
    async () => {
      await addProductUnitAction('var_nonexistent_9999', '盒', 10.0);
    },
    /Product variant not found/
  );
});

test('TC-UNIT-E-09: Error – demoting the only base unit of a variant rejected', async () => {
  // Given: Variant with only 1 base unit
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `唯一基準約束品_${Date.now()}`,
    category: '轉售商品'
  });
  const baseUnitId = p.units[0].id;

  // When & Then: Demoting only base unit throws error
  await assert.rejects(
    async () => {
      await updateProductUnitAction(baseUnitId, { is_base_unit: false });
    },
    /每個變體至少要有一個基準單位/
  );
});

test('TC-UNIT-E-10: Error – cross-tenant add unit rejected', async () => {
  // Given: Product & variant created in Tenant 1
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `跨租戶新增品_${Date.now()}`,
    category: '轉售商品'
  });
  const varId = p.variants[0].id;

  // When: Switching to Tenant 2
  await selectTenantAction('tnt_mock_2');

  // Then: Tenant 2 cannot add unit to Tenant 1 variant
  await assert.rejects(
    async () => {
      await addProductUnitAction(varId, '惡意單位', 10.0);
    },
    /Product variant not found/
  );

  // Restore Tenant 1
  await selectTenantAction('tnt_mock_1');
});

test('TC-UNIT-E-11: Error – cross-tenant update unit rejected', async () => {
  // Given: Product & unit created in Tenant 1
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `跨租戶更新品_${Date.now()}`,
    category: '轉售商品',
    unit_name: '原單位'
  });
  const unitId = p.units[0].id;

  // When: Switching to Tenant 2
  await selectTenantAction('tnt_mock_2');

  // Then: Tenant 2 cannot update Tenant 1 unit
  await assert.rejects(
    async () => {
      await updateProductUnitAction(unitId, { unit_name: '竄改單位' });
    },
    /Product unit not found/
  );

  // Restore Tenant 1
  await selectTenantAction('tnt_mock_1');
});

test('TC-SRC-N-01: Equivalence – Multi-vendor registration with distinct costs for same unit', async () => {
  // Given: Resale product with default unit, and two vendor partners
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `多商比價品_${Date.now()}`,
    category: '轉售商品'
  });
  const v1 = await createPartnerAction({
    name: `華碩原廠_${Date.now()}`,
    isCustomer: false,
    isVendor: true
  });
  const v2 = await createPartnerAction({
    name: `聯強代理_${Date.now()}`,
    isCustomer: false,
    isVendor: true
  });
  const unitId = p.units[0].id;

  // When: Adding 2 supply sources for the exact same packaging unit
  const src1 = await addSupplySourceAction(unitId, v1.id, 12000.0, 'TWD', true);
  const src2 = await addSupplySourceAction(unitId, v2.id, 12500.0, 'TWD', false);

  // Then: Both sources are registered under the unit with distinct pricing
  assert.ok(src1.id);
  assert.equal(src1.unit_id, unitId);
  assert.equal(src1.vendor_partner_id, v1.id);
  assert.equal(src1.purchase_cost, 12000.0);
  assert.equal(src1.is_primary, true);

  assert.ok(src2.id);
  assert.equal(src2.unit_id, unitId);
  assert.equal(src2.vendor_partner_id, v2.id);
  assert.equal(src2.purchase_cost, 12500.0);
  assert.equal(src2.is_primary, false);

  const detail = await getProductDetailAction(p.product.id);
  assert.equal(detail.supply_sources.length, 2);
});

test('TC-SRC-N-02: Equivalence – Update supply source purchase cost via updateSupplySourceAction', async () => {
  // Given: Product, vendor, and existing supply source
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `成本變更品_${Date.now()}`,
    category: '轉售商品'
  });
  const vendor = await createPartnerAction({
    name: `既有廠商_${Date.now()}`,
    isCustomer: false,
    isVendor: true
  });
  const src = await addSupplySourceAction(p.units[0].id, vendor.id, 100.0, 'TWD', false);

  // When: Updating purchase cost from 100.0 to 88.5
  const updated = await updateSupplySourceAction(src.id, { purchase_cost: 88.5 });

  // Then: Cost is updated in store and detail
  assert.equal(updated.id, src.id);
  assert.equal(updated.purchase_cost, 88.5);

  const detail = await getProductDetailAction(p.product.id);
  const found = detail.supply_sources.find(s => s.id === src.id);
  assert.ok(found);
  assert.equal(found.purchase_cost, 88.5);
});

test('TC-SRC-N-03: Equivalence – Update supply source vendor and toggle primary status', async () => {
  // Given: Product, vendor 1, vendor 2, and existing source
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `換廠測試品_${Date.now()}`,
    category: '轉售商品'
  });
  const v1 = await createPartnerAction({
    name: `原廠A_${Date.now()}`,
    isCustomer: false,
    isVendor: true
  });
  const v2 = await createPartnerAction({
    name: `新廠B_${Date.now()}`,
    isCustomer: false,
    isVendor: true
  });
  const src = await addSupplySourceAction(p.units[0].id, v1.id, 50.0, 'TWD', false);

  // When: Updating vendor to v2 and setting is_primary: true
  const updated = await updateSupplySourceAction(src.id, {
    vendor_partner_id: v2.id,
    is_primary: true,
    currency: 'USD'
  });

  // Then: Vendor and primary status are updated
  assert.equal(updated.vendor_partner_id, v2.id);
  assert.equal(updated.is_primary, true);
  assert.equal(updated.currency, 'USD');

  const detail = await getProductDetailAction(p.product.id);
  const found = detail.supply_sources.find(s => s.id === src.id);
  assert.equal(found.vendor_partner_id, v2.id);
  assert.equal(found.is_primary, true);
});

test('TC-SRC-N-04: Equivalence – Support cost alias in addSupplySourceAction and updateSupplySourceAction', async () => {
  // Given: Product and vendor
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `別名相容品_${Date.now()}`,
    category: '轉售商品'
  });
  const v = await createPartnerAction({
    name: `別名供應商_${Date.now()}`,
    isCustomer: false,
    isVendor: true
  });

  // When: Calling addSupplySourceAction with cost alias in options object
  const src = await addSupplySourceAction({
    unit_id: p.units[0].id,
    vendor_partner_id: v.id,
    cost: 45.0
  });

  // Then: Both cost and purchase_cost are present
  assert.ok(src.id);
  assert.equal(src.cost, 45.0);
  assert.equal(src.purchase_cost, 45.0);

  // When: Calling updateSupplySourceAction with cost alias
  const updated = await updateSupplySourceAction(src.id, { cost: 42.0 });

  // Then: Both cost and purchase_cost reflect 42.0
  assert.equal(updated.cost, 42.0);
  assert.equal(updated.purchase_cost, 42.0);
});

test('TC-SRC-N-05: Equivalence – Single primary supply source exclusivity on add and update', async () => {
  // Given: Product with base unit and 2 vendors
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `唯一主廠測試品_${Date.now()}`,
    category: '轉售商品'
  });
  const unitId = p.units[0].id;
  const v1 = await createPartnerAction({
    name: `主廠A_${Date.now()}`,
    isCustomer: false,
    isVendor: true
  });
  const v2 = await createPartnerAction({
    name: `主廠B_${Date.now()}`,
    isCustomer: false,
    isVendor: true
  });

  // When: Adding first source (v1) with is_primary: true
  const src1 = await addSupplySourceAction(unitId, v1.id, 100.0, 'TWD', true);
  assert.equal(src1.is_primary, true);

  // When: Adding second source (v2) with is_primary: true
  const src2 = await addSupplySourceAction(unitId, v2.id, 95.0, 'TWD', true);
  assert.equal(src2.is_primary, true);

  // Then: First source (src1) is automatically demoted to is_primary: false
  let detail = await getProductDetailAction(p.product.id);
  let s1 = detail.supply_sources.find(s => s.id === src1.id);
  let s2 = detail.supply_sources.find(s => s.id === src2.id);
  assert.equal(s1.is_primary, false);
  assert.equal(s2.is_primary, true);
  assert.equal(detail.supply_sources.filter(s => s.unit_id === unitId && s.is_primary).length, 1);

  // When: Promoting first source (src1) back to is_primary: true via update
  const updated1 = await updateSupplySourceAction(src1.id, { is_primary: true });
  assert.equal(updated1.is_primary, true);

  // Then: Second source (src2) is automatically demoted to is_primary: false
  detail = await getProductDetailAction(p.product.id);
  s1 = detail.supply_sources.find(s => s.id === src1.id);
  s2 = detail.supply_sources.find(s => s.id === src2.id);
  assert.equal(s1.is_primary, true);
  assert.equal(s2.is_primary, false);
  assert.equal(detail.supply_sources.filter(s => s.unit_id === unitId && s.is_primary).length, 1);

  // When: Explicitly setting src1 to is_primary: false
  await updateSupplySourceAction(src1.id, { is_primary: false });
  detail = await getProductDetailAction(p.product.id);
  assert.equal(detail.supply_sources.filter(s => s.unit_id === unitId && s.is_primary).length, 0);
});

test('TC-SRC-B-01: Boundary – Zero purchase cost (0.0) allowed for free item/sample', async () => {
  // Given: Product and vendor
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `零成本品_${Date.now()}`,
    category: '原物料'
  });
  const v = await createPartnerAction({
    name: `贈品商_${Date.now()}`,
    isCustomer: false,
    isVendor: true
  });

  // When: Adding source with cost 0.0
  const src = await addSupplySourceAction(p.units[0].id, v.id, 0.0);

  // Then: 0.0 cost is recorded
  assert.equal(src.purchase_cost, 0.0);

  // When: Updating to 0.0001 (minimal fractional cost)
  const updated = await updateSupplySourceAction(src.id, { purchase_cost: 0.0001 });
  assert.equal(updated.purchase_cost, 0.0001);
});

test('TC-SRC-B-02: Boundary – Whitespace trimming on vendor ID and currency', async () => {
  // Given: Product and vendor
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `修剪測試品_${Date.now()}`,
    category: '轉售商品'
  });
  const v = await createPartnerAction({
    name: `修剪商_${Date.now()}`,
    isCustomer: false,
    isVendor: true
  });

  // When: Adding source with padded currency
  const src = await addSupplySourceAction(p.units[0].id, `  ${v.id}  `, 10.0, '  USD  ');

  // Then: Trimming applied
  assert.equal(src.vendor_partner_id, v.id);
  assert.equal(src.currency, 'USD');
});

test('TC-SRC-E-01: Error – Negative purchase cost rejected in add and update', async () => {
  // Given: Product and vendor
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `負成本測試品_${Date.now()}`,
    category: '轉售商品'
  });
  const v = await createPartnerAction({
    name: `合格商_${Date.now()}`,
    isCustomer: false,
    isVendor: true
  });

  // When / Then: Negative cost on add rejected
  await assert.rejects(
    async () => {
      await addSupplySourceAction(p.units[0].id, v.id, -10.0);
    },
    /採購成本不能為負數/
  );

  const src = await addSupplySourceAction(p.units[0].id, v.id, 10.0);

  // When / Then: Negative cost on update rejected
  await assert.rejects(
    async () => {
      await updateSupplySourceAction(src.id, { purchase_cost: -0.5 });
    },
    /採購成本不能為負數/
  );
});

test('TC-SRC-E-02: Error – Non-vendor partner cannot be bound as supply source', async () => {
  // Given: Partner with isCustomer=true, isVendor=false
  await ensureAuthenticated();
  const p = await createProductAction({
    name: `客戶來源測試品_${Date.now()}`,
    category: '轉售商品'
  });
  const customerOnly = await createPartnerAction({
    name: `純客戶_${Date.now()}`,
    isCustomer: true,
    isVendor: false
  });
  const validVendor = await createPartnerAction({
    name: `有效廠商_${Date.now()}`,
    isCustomer: false,
    isVendor: true
  });

  // When / Then: Adding non-vendor partner rejected
  await assert.rejects(
    async () => {
      await addSupplySourceAction(p.units[0].id, customerOnly.id, 100.0);
    },
    /供應商不存在或無效/
  );

  const src = await addSupplySourceAction(p.units[0].id, validVendor.id, 100.0);

  // When / Then: Updating to non-vendor partner rejected
  await assert.rejects(
    async () => {
      await updateSupplySourceAction(src.id, { vendor_partner_id: customerOnly.id });
    },
    /供應商不存在或無效/
  );
});

test('TC-SRC-E-03: Error – Update nonexistent or empty supply source ID rejected', async () => {
  // Given: Authenticated session
  await ensureAuthenticated();

  // When / Then: Empty source ID rejected
  await assert.rejects(
    async () => {
      await updateSupplySourceAction('   ', { purchase_cost: 50.0 });
    },
    /供應來源 ID 為必填項目/
  );

  // When / Then: Non-existent source ID rejected
  await assert.rejects(
    async () => {
      await updateSupplySourceAction('src_nonexistent_9999', { purchase_cost: 50.0 });
    },
    /供應來源不存在/
  );
});

test('TC-SRC-E-04: Error – Cross-tenant supply source update and vendor binding rejected', async () => {
  // Given: Tenant 1 owns product, unit, vendor, and supply source
  await ensureAuthenticated();
  const p1 = await createProductAction({
    name: `T1來源品_${Date.now()}`,
    category: '轉售商品'
  });
  const v1 = await createPartnerAction({
    name: `T1廠商_${Date.now()}`,
    isCustomer: false,
    isVendor: true
  });
  const src1 = await addSupplySourceAction(p1.units[0].id, v1.id, 100.0);

  // When: Switching to Tenant 2
  await selectTenantAction('tnt_mock_2');

  // Then: Tenant 2 cannot update Tenant 1 supply source
  await assert.rejects(
    async () => {
      await updateSupplySourceAction(src1.id, { purchase_cost: 50.0 });
    },
    /供應來源不存在/
  );

  // Create vendor in Tenant 2
  const v2 = await createPartnerAction({
    name: `T2廠商_${Date.now()}`,
    isCustomer: false,
    isVendor: true
  });

  // Switch back to Tenant 1
  await selectTenantAction('tnt_mock_1');

  // Then: Tenant 1 cannot bind Tenant 2 vendor
  await assert.rejects(
    async () => {
      await updateSupplySourceAction(src1.id, { vendor_partner_id: v2.id });
    },
    /供應商不存在或無效/
  );
});


