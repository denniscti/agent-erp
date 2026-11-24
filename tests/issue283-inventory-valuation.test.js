/**
 * @file issue283-inventory-valuation.test.js
 * @description Layer 2 automated test suite for Inventory Valuation Report (Issue #283).
 * Conforms to .agent/rules/test-strategy.md and docs/standards/testing-verification.md.
 *
 * ## Test Perspective Table (Equivalence Partitioning & Boundary Values)
 * | Case ID | Input / Precondition | Perspective (Equivalence / Boundary) | Expected Result | Notes |
 * |---|---|---|---|---|
 * | TC-283-UI-N-01 | Default all-warehouses mode, movements recorded | Equivalence – Normal Valuation Load | Report items loaded with quantities, costs, and subtotals | Happy Path |
 * | TC-283-UI-N-02 | Filter valuation report by specific warehouseId | Equivalence – Warehouse Filter Partition | Returns items strictly belonging to target warehouse | Warehouse Filter |
 * | TC-283-UI-N-03 | Multiple warehouses with various items | Equivalence – Subtotals and Grand Total Consistency | Sum of item subtotals equals warehouse subtotal and grand total | Financial Check |
 * | TC-283-UI-B-01 | Item with receipt and full shipment (balance = 0) | Boundary – Zero Stock Exclusion (0) | Zero-balance item is completely excluded from report | DoD Zero Balance |
 * | TC-283-UI-B-02 | Non-existent warehouse filter | Boundary – Empty Result Filter | Returns empty items list and 0 grand total without crash | Nonexistent Wh |
 * | TC-283-UI-ERR-01 | Shipped without receipt (negative quantity, cost = 0) | Error Boundary – Oversold Defense | Throws descriptive error, strictly preventing negative valuation | DoD Defense |
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Polyfill Svelte 5 runes for Node.js test environment if not defined
if (typeof globalThis.$state === 'undefined') {
  globalThis.$state = (v) => v;
}
if (typeof globalThis.$derived === 'undefined') {
  globalThis.$derived = (fn) => (typeof fn === 'function' ? fn() : fn);
}

const { invoke } = await import('../src/lib/tauri.js');
const { appState } = await import('../src/lib/store.svelte.js');
const { loadInventoryValuationAction } = await import('../src/lib/warehouses/store.js');
const { mockInventoryMovements } = await import('../src/lib/warehouses/mocks.js');

async function setupSeedData() {
  const ts = Date.now() + Math.floor(Math.random() * 10000);
  const whA = await invoke('create_warehouse', { code: `WHA-${ts}`, name: '台北主倉' });
  const whB = await invoke('create_warehouse', { code: `WHB-${ts}`, name: '高雄二倉' });

  const prodA = await invoke('create_product', {
    name: `伺服器主機_${ts}`,
    category: '轉售商品',
    unitName: '台',
    sellingPrice: 50000
  });
  const unitA = prodA.units[0];

  const prodB = await invoke('create_product', {
    name: `固態硬碟_${ts}`,
    category: '原物料',
    unitName: '條',
    sellingPrice: 3000
  });
  const unitB = prodB.units[0];

  return { whA, whB, unitA, unitB };
}

describe('Issue #283: Inventory Valuation Report (庫存評價報表)', () => {
  it('TC-283-UI-N-01: Default all-warehouses mode, movements recorded correctly in appState', async () => {
    // Given: whA has 10 units of unitA @ 1000 each (subtotal = 10000)
    const { whA, unitA } = await setupSeedData();
    await invoke('record_opening_inventory_balance', {
      unitId: unitA.id,
      warehouseId: whA.id,
      quantity: 10,
      unitCost: 1000
    });

    // When: Call loadInventoryValuationAction without warehouse filter
    const report = await loadInventoryValuationAction();

    // Then: Report items are saved in appState.inventoryValuationReport and contain accurate valuation
    assert.ok(report);
    assert.equal(report, appState.inventoryValuationReport);

    const item = report.items.find(i => i.unit_id === unitA.id && i.warehouse_id === whA.id);
    assert.ok(item, 'Item should be present in valuation report');
    assert.equal(item.current_quantity, 10);
    assert.equal(item.unit_cost, 1000);
    assert.equal(item.subtotal_cost, 10000);
    assert.ok(report.grand_total_quantity >= 10);
    assert.ok(report.grand_total_cost >= 10000);
  });

  it('TC-283-UI-N-02: Filter valuation report by specific warehouseId', async () => {
    // Given: Stock in whA (10 @ 100 = 1000) and whB (5 @ 200 = 1000)
    const { whA, whB, unitA } = await setupSeedData();
    await invoke('record_opening_inventory_balance', {
      unitId: unitA.id,
      warehouseId: whA.id,
      quantity: 10,
      unitCost: 100
    });
    await invoke('record_opening_inventory_balance', {
      unitId: unitA.id,
      warehouseId: whB.id,
      quantity: 5,
      unitCost: 200
    });

    // When: Filter valuation strictly by whA
    const reportWhA = await loadInventoryValuationAction(whA.id);

    // Then: Only whA items are returned
    assert.ok(reportWhA.items.length >= 1);
    assert.ok(reportWhA.items.every(i => i.warehouse_id === whA.id));
    const whASub = reportWhA.warehouse_subtotals.find(s => s.warehouse_id === whA.id);
    assert.ok(whASub);
    assert.equal(whASub.total_quantity, 10);
    assert.equal(whASub.total_cost, 1000);
  });

  it('TC-283-UI-N-03: Subtotals and Grand Total Consistency across multiple warehouses and items', async () => {
    // Given: whA has unitA (10 @ 100 = 1000) and unitB (20 @ 50 = 1000) -> whA total = 2000
    //        whB has unitA (5 @ 100 = 500) -> whB total = 500
    const { whA, whB, unitA, unitB } = await setupSeedData();
    await invoke('record_opening_inventory_balance', {
      unitId: unitA.id,
      warehouseId: whA.id,
      quantity: 10,
      unitCost: 100
    });
    await invoke('record_opening_inventory_balance', {
      unitId: unitB.id,
      warehouseId: whA.id,
      quantity: 20,
      unitCost: 50
    });
    await invoke('record_opening_inventory_balance', {
      unitId: unitA.id,
      warehouseId: whB.id,
      quantity: 5,
      unitCost: 100
    });

    // When: Load inventory valuation for all warehouses
    const report = await loadInventoryValuationAction();

    // Then: Calculated subtotals match exact mathematical sums
    const whAItems = report.items.filter(i => i.warehouse_id === whA.id);
    const sumWhACost = whAItems.reduce((acc, i) => acc + i.subtotal_cost, 0);
    const sumWhAQty = whAItems.reduce((acc, i) => acc + i.current_quantity, 0);

    const subA = report.warehouse_subtotals.find(s => s.warehouse_id === whA.id);
    assert.ok(subA);
    assert.equal(subA.total_cost, sumWhACost);
    assert.equal(subA.total_quantity, sumWhAQty);

    const totalFromSubtotals = report.warehouse_subtotals.reduce((acc, s) => acc + s.total_cost, 0);
    assert.equal(Math.round(totalFromSubtotals), Math.round(report.grand_total_cost));
  });

  it('TC-283-UI-B-01: Zero-balance item (SUM(quantity_delta) == 0) is excluded from valuation report', async () => {
    // Given: unitA has 5 in, 5 out -> current_quantity = 0. unitB has 5 in @ 100.
    const { whA, unitA, unitB } = await setupSeedData();
    await invoke('record_opening_inventory_balance', {
      unitId: unitA.id,
      warehouseId: whA.id,
      quantity: 5,
      unitCost: 100
    });
    // Create an inventory adjustment to deduct 5
    const adj = await invoke('create_inventory_adjustment', {
      warehouseId: whA.id,
      reasonCode: 'damage',
      note: '損壞報廢',
      initialLines: [{ unitId: unitA.id, quantityDelta: -5 }]
    });
    const adjId = adj.adjustment ? adj.adjustment.id : adj.id;
    await invoke('post_inventory_adjustment', { adjustmentId: adjId });

    // unitB with positive balance
    await invoke('record_opening_inventory_balance', {
      unitId: unitB.id,
      warehouseId: whA.id,
      quantity: 5,
      unitCost: 100
    });

    // When: Load inventory valuation for whA
    const report = await loadInventoryValuationAction(whA.id);

    // Then: unitA is completely excluded from report items; unitB is present
    const itemA = report.items.find(i => i.unit_id === unitA.id);
    const itemB = report.items.find(i => i.unit_id === unitB.id);
    assert.equal(itemA, undefined, 'Zero balance item must not appear in report');
    assert.ok(itemB, 'Positive balance item must appear in report');
    assert.equal(itemB.current_quantity, 5);
  });

  it('TC-283-UI-B-02: Non-existent warehouse filter returns empty report without crashing', async () => {
    // Given: Arbitrary non-existent warehouse id
    // When: Load inventory valuation
    const report = await loadInventoryValuationAction('wh_completely_nonexistent');

    // Then: Returns empty report with 0 totals
    assert.deepEqual(report.items, []);
    assert.deepEqual(report.warehouse_subtotals, []);
    assert.equal(report.grand_total_quantity, 0);
    assert.equal(report.grand_total_cost, 0);
  });

  it('TC-283-UI-ERR-01: Shipped without receipt triggers explicit defensive error rather than negative valuation', async () => {
    // Given: Setup product with only a negative movement (e.g. shipment -10 with no stock/receipt)
    const { whA, unitA } = await setupSeedData();
    mockInventoryMovements.push({
      id: `mov_neg_${Date.now()}`,
      tenant_id: 'tnt_mock_1',
      unit_id: unitA.id,
      warehouse_id: whA.id,
      quantity_delta: -10,
      unit_cost: null,
      reason: 'sales_shipment',
      reference_type: 'sales_order',
      reference_id: 'so_defensive',
      created_by: 'usr_mock_1',
      created_at: Math.floor(Date.now() / 1000)
    });

    // When & Then: Attempting to query inventory valuation triggers explicit error
    await assert.rejects(
      async () => {
        await loadInventoryValuationAction(whA.id);
      },
      (err) => {
        assert.ok(err.message.includes('庫存數量為負數'));
        assert.ok(err.message.includes('未進貨即出貨'));
        assert.ok(err.message.includes('無法計算庫存價值'));
        return true;
      }
    );
  });
});
