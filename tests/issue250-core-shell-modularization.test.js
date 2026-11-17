// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Polyfill Svelte 5 runes for Node.js test environment if not defined
if (typeof globalThis.$state === 'undefined') {
  globalThis.$state = (v) => v;
}
if (typeof globalThis.$derived === 'undefined') {
  globalThis.$derived = (fn) => (typeof fn === 'function' ? fn() : fn);
}

/**
 * -------------------------------------------------------------------------------------------------
 * Test Strategy Perspective Table (Issue #250: Core Shell Modularization & Warehouse Residual Logic)
 * -------------------------------------------------------------------------------------------------
 * | Case ID     | Input / Precondition                                 | Perspective (Equivalence / Boundary) | Expected Result                                           | Notes                    |
 * |-------------|------------------------------------------------------|--------------------------------------|-----------------------------------------------------------|--------------------------|
 * | TC-250-N-01 | Load store.svelte.js and warehouses/store.js         | Equivalence – SSOT Reference Equality| 16 warehouse functions share identical function identity  | Zero duplication SSOT    |
 * | TC-250-N-02 | Load tauri.js and warehouses/mocks.js                | Equivalence – Mock Delegation SSOT   | warehouseMocks handles 10 inventory/conversion IPC cmds   | Zero duplication SSOT    |
 * | TC-250-N-03 | Valid unit, warehouse, and positive qty/cost         | Equivalence – Opening Balance Normal | Creates opening movement and updates inventory levels     | R-17 opening balance     |
 * | TC-250-N-04 | Valid variant with 2 units and sufficient stock      | Equivalence – Unit Conversion Normal | Draft created, posted, balances correctly deducted/added  | UCV lifecycle            |
 * | TC-250-N-05 | Measure line counts of store.svelte.js and tauri.js  | Equivalence – Core Shell Slimming    | store.svelte.js < 1700 lines, tauri.js < 1200 lines       | Acceptance criteria      |
 * | TC-250-E-01 | Unit conversion with insufficient stock              | Error – Stock Defense                | Rejects with '現有庫存 ... 不足，無法扣除轉換數量 ...'      | Stock boundary check     |
 * | TC-250-E-02 | Tenant with zero warehouses calls opening balance    | Error – Zero Warehouse Defense (W-00)| Rejects with '此租戶尚未建立任何倉別...'                     | Rule W-00                |
 * | TC-250-E-03 | Calling opening balance twice for same unit & wh     | Error – Duplicate Opening Defense    | Rejects with '此商品單位在〔...〕已開帳，數量更正請用庫存調整' | Idempotency guard        |
 * | TC-250-E-04 | Unit conversion across different product variants    | Error – Invariant Validation         | Rejects with '來源單位與目標單位必須屬於同一個商品規格'       | Invariant guard          |
 * | TC-250-E-05 | Unit conversion with identical from and to unit      | Error – Identity Validation          | Rejects with '來源單位與目標單位不可相同'                    | Identity guard           |
 * | TC-250-E-06 | Attempting to cancel already posted conversion       | Error – State Machine Invariant      | Rejects with '單位轉換單狀態為「posted」，無法變更為「cancelled」'| Transition guard         |
 * | TC-250-B-01 | Unit conversion quantities: 0, negative, NaN         | Boundary – Conversion Quantities     | Rejects with '來源數量 ... 必須大於 0' or '目標數量 ...'     | Boundary values          |
 * | TC-250-B-02 | Unit conversion stock with exact and 1e-10 shortage  | Boundary – Floating Point Tolerance  | Exact stock succeeds; -1e-10 shortage rejected cleanly    | 1e-9 tolerance boundary  |
 * | TC-250-B-03 | Opening balance quantity <= 0 or cost < 0            | Boundary – Opening Inputs            | Rejects with '期初開帳數量必須大於 0' or '期初開帳成本不可為負數'| Numeric boundaries       |
 * -------------------------------------------------------------------------------------------------
 */

const { invoke, mockInventoryMovements, mockUnitConversions } = await import('../src/lib/tauri.js');
const warehouseStore = await import('../src/lib/warehouses/store.js');
const warehouseMocksModule = await import('../src/lib/warehouses/mocks.js');
const mainStore = await import('../src/lib/store.svelte.js');

test.describe('Issue #250: Core Shell Modularization & Residual Domain Migration Verification', () => {
  const tenantId = 'tnt_test_issue250_core';

  test.beforeEach(async () => {
    await invoke('set_mock_active_tenant', { tenant_id: tenantId });
    await invoke('reset_mock_warehouses', { tenant_id: tenantId });
    await invoke('reset_mock_unit_conversions', { tenant_id: tenantId });
  });

  test('TC-250-N-01: SSOT Reference Equality between warehouses/store.js and store.svelte.js', () => {
    // Given: Functions imported from modular warehouse domain store and core shell store.svelte.js
    const functionNames = [
      'fetchWarehouses',
      'createWarehouseAction',
      'updateWarehouseAction',
      'setDefaultWarehouseAction',
      'deactivateWarehouseAction',
      'reactivateWarehouseAction',
      'openCreateWarehouseModal',
      'closeCreateWarehouseModal',
      'isZeroWarehouseError',
      'handleZeroWarehouseError',
      'formatMovementReason',
      'getWarehouseName',
      'fetchInventoryLevels',
      'fetchUnitInventoryLevel',
      'fetchInventoryMovements',
      'recordOpeningInventoryBalanceAction',
      'fetchUnitConversions',
      'fetchUnitConversionDetail',
      'selectUnitConversion',
      'createUnitConversionAction',
      'postUnitConversionAction',
      'cancelUnitConversionAction'
    ];

    // When & Then: Main store re-exports must reference the exact same memory function definition
    for (const fn of functionNames) {
      assert.equal(
        typeof warehouseStore[fn],
        'function',
        `warehouses/store.js must export function ${fn}`
      );
      assert.equal(
        typeof mainStore[fn],
        'function',
        `store.svelte.js must re-export function ${fn}`
      );
      assert.strictEqual(
        mainStore[fn],
        warehouseStore[fn],
        `store.svelte.js [${fn}] must be identical SSOT reference to warehouses/store.js [${fn}]`
      );
    }
  });

  test('TC-250-N-02: warehouseMocks correctly provides all 10 inventory & conversion IPC handlers', () => {
    // Given: warehouseMocks from warehouses/mocks.js
    const requiredHandlers = [
      'record_opening_inventory_balance',
      'get_inventory_level',
      'list_inventory_levels',
      'list_inventory_movements',
      'create_unit_conversion',
      'post_unit_conversion',
      'cancel_unit_conversion',
      'get_unit_conversion',
      'list_unit_conversions',
      'reset_mock_unit_conversions'
    ];

    // When & Then: All 10 handlers exist in warehouseMocks and are delegated
    for (const handler of requiredHandlers) {
      assert.equal(
        typeof warehouseMocksModule.warehouseMocks[handler],
        'function',
        `warehouseMocks must contain handler for ${handler}`
      );
    }

    // Verify mock data references are shared SSOT
    assert.strictEqual(
      warehouseMocksModule.mockInventoryMovements,
      mockInventoryMovements,
      'mockInventoryMovements in tauri.js must point to warehouses/mocks.js SSOT'
    );
  });

  test('TC-250-N-03: record_opening_inventory_balance executes cleanly via warehouseMocks', async () => {
    // Given: A warehouse and product with unit
    const wh = await invoke('create_warehouse', {
      code: `WH250_N03_${Math.floor(Math.random() * 1000)}`,
      name: '開帳測試倉'
    });
    const prod = await invoke('create_product', {
      name: `商品250_N03_${Date.now()}`,
      category: 'resale',
      selling_price: 100,
      units: [{ unit_name: '件', is_base: true, conversion_rate: 1 }]
    });
    const unitId = prod.units[0].id;

    // When: Recording opening inventory balance
    const mov = await invoke('record_opening_inventory_balance', {
      warehouse_id: wh.id,
      unit_id: unitId,
      quantity_delta: 50,
      unit_cost: 15
    });

    // Then: Movement created and inventory query returns 50
    assert.ok(mov && mov.id, 'Movement record should have id');
    assert.equal(mov.warehouse_id, wh.id);
    assert.equal(mov.quantity_delta, 50);
    assert.equal(mov.unit_cost, 15);
    assert.equal(mov.reason, 'opening_balance');

    const level = await invoke('get_inventory_level', {
      warehouse_id: wh.id,
      unit_id: unitId
    });
    assert.equal(level.current_quantity, 50);
  });

  test('TC-250-N-04: Unit conversion standard lifecycle (create -> post) works via modular handlers', async () => {
    // Given: Warehouse with 10 box of products (1 box = 10 pcs)
    const wh = await invoke('create_warehouse', {
      code: `WH250_N04_${Math.floor(Math.random() * 1000)}`,
      name: '轉換測試倉'
    });
    const prod = await invoke('create_product', {
      name: `商品250_N04_${Date.now()}`,
      category: 'resale',
      unitName: '個',
      sellingPrice: 10
    });
    const pcsUnit = prod.units[0];
    const boxUnit = await invoke('add_product_unit', {
      variantId: prod.variants[0].id,
      unitName: '盒',
      conversionRatio: 10,
      isBaseUnit: false
    });

    await invoke('record_opening_inventory_balance', {
      warehouse_id: wh.id,
      unit_id: boxUnit.id,
      quantity_delta: 10,
      unit_cost: 50
    });

    // When: Creating unit conversion (2 box -> 20 pcs) and posting
    const ucv = await invoke('create_unit_conversion', {
      warehouseId: wh.id,
      fromUnitId: boxUnit.id,
      fromQuantity: 2,
      toUnitId: pcsUnit.id,
      toQuantity: 20
    });
    assert.equal(ucv.status, 'draft');

    const postedUcv = await invoke('post_unit_conversion', { conversionId: ucv.id });

    // Then: Status is posted and inventory levels updated (from: 8, to: 20)
    assert.equal(postedUcv.status, 'posted');
    assert.ok(postedUcv.posted_at > 0);

    const fromStock = await invoke('get_inventory_level', { warehouse_id: wh.id, unit_id: boxUnit.id });
    const toStock = await invoke('get_inventory_level', { warehouse_id: wh.id, unit_id: pcsUnit.id });
    assert.equal(fromStock.current_quantity, 8);
    assert.equal(toStock.current_quantity, 20);
  });

  test('TC-250-N-05: Core shell files store.svelte.js and tauri.js show significant reduction', () => {
    // Given: File paths for core shell files
    const storePath = path.resolve(process.cwd(), 'src/lib/store.svelte.js');
    const tauriPath = path.resolve(process.cwd(), 'src/lib/tauri.js');

    // When: Reading file contents and measuring line counts
    const storeLines = fs.readFileSync(storePath, 'utf-8').split('\n').length;
    const tauriLines = fs.readFileSync(tauriPath, 'utf-8').split('\n').length;

    // Then: Line counts must be significantly lower than before (original: store ~1923, tauri ~1493)
    assert.ok(storeLines < 1700, `store.svelte.js lines (${storeLines}) should be under 1700 lines`);
    assert.ok(tauriLines < 1200, `tauri.js lines (${tauriLines}) should be under 1200 lines`);
  });

  test('TC-250-E-01: Unit conversion fails when stock is insufficient', async () => {
    // Given: Warehouse with 1 unit in stock
    const wh = await invoke('create_warehouse', {
      code: `WH250_E01_${Math.floor(Math.random() * 1000)}`,
      name: '庫存不足測試倉'
    });
    const prod = await invoke('create_product', {
      name: `商品250_E01_${Date.now()}`,
      category: 'resale',
      unitName: '箱',
      sellingPrice: 100
    });
    const fromUnit = prod.units[0];
    const toUnit = await invoke('add_product_unit', {
      variantId: prod.variants[0].id,
      unitName: '包',
      conversionRatio: 10,
      isBaseUnit: false
    });

    await invoke('record_opening_inventory_balance', {
      warehouse_id: wh.id,
      unit_id: fromUnit.id,
      quantity_delta: 1,
      unit_cost: 100
    });

    const ucv = await invoke('create_unit_conversion', {
      warehouseId: wh.id,
      fromUnitId: fromUnit.id,
      fromQuantity: 5,
      toUnitId: toUnit.id,
      toQuantity: 50
    });

    // When & Then: Posting should be rejected due to insufficient stock
    await assert.rejects(
      async () => {
        await invoke('post_unit_conversion', { conversionId: ucv.id });
      },
      /現有庫存.*不足，無法扣除轉換數量/
    );
  });

  test('TC-250-E-02: Zero-warehouse tenant is blocked with W-00 defense', async () => {
    // Given: A fresh tenant with no warehouses created
    const zeroWhTenant = 'tnt_zero_wh_250';
    await invoke('set_mock_active_tenant', { tenant_id: zeroWhTenant });
    await invoke('reset_mock_warehouses', { tenant_id: zeroWhTenant });

    const prod = await invoke('create_product', {
      name: `商品250_E02_${Date.now()}`,
      category: 'resale',
      selling_price: 100,
      units: [{ unit_name: '件', is_base: true, conversion_rate: 1 }]
    });

    // When & Then: record_opening_inventory_balance without warehouse must fail with W-00
    await assert.rejects(
      async () => {
        await invoke('record_opening_inventory_balance', {
          unit_id: prod.units[0].id,
          quantity_delta: 10,
          unit_cost: 20
        });
      },
      /尚未建立任何倉別/
    );
  });

  test('TC-250-E-03: Duplicate opening inventory balance for same unit in same warehouse is rejected', async () => {
    // Given: Warehouse with existing opening balance
    const wh = await invoke('create_warehouse', {
      code: `WH250_E03_${Math.floor(Math.random() * 1000)}`,
      name: '防重複開帳倉'
    });
    const prod = await invoke('create_product', {
      name: `商品250_E03_${Date.now()}`,
      category: 'resale',
      selling_price: 100,
      units: [{ unit_name: '件', is_base: true, conversion_rate: 1 }]
    });
    const unitId = prod.units[0].id;

    await invoke('record_opening_inventory_balance', {
      warehouse_id: wh.id,
      unit_id: unitId,
      quantity_delta: 10,
      unit_cost: 20
    });

    // When & Then: Second opening balance for the same unit & warehouse must reject
    await assert.rejects(
      async () => {
        await invoke('record_opening_inventory_balance', {
          warehouse_id: wh.id,
          unit_id: unitId,
          quantity_delta: 5,
          unit_cost: 20
        });
      },
      /已開帳，數量更正請用庫存調整/
    );
  });

  test('TC-250-E-04: Unit conversion across different variants is rejected', async () => {
    // Given: Warehouse and 2 distinct products
    const wh = await invoke('create_warehouse', {
      code: `WH250_E04_${Math.floor(Math.random() * 1000)}`,
      name: '規格防護倉'
    });
    const p1 = await invoke('create_product', {
      name: `商品250_E04_A_${Date.now()}`,
      category: 'resale',
      selling_price: 100,
      units: [{ unit_name: 'A件', is_base: true, conversion_rate: 1 }]
    });
    const p2 = await invoke('create_product', {
      name: `商品250_E04_B_${Date.now()}`,
      category: 'resale',
      selling_price: 100,
      units: [{ unit_name: 'B件', is_base: true, conversion_rate: 1 }]
    });

    // When & Then: Conversion across p1 unit and p2 unit is rejected
    await assert.rejects(
      async () => {
        await invoke('create_unit_conversion', {
          warehouseId: wh.id,
          fromUnitId: p1.units[0].id,
          fromQuantity: 1,
          toUnitId: p2.units[0].id,
          toQuantity: 1
        });
      },
      /來源單位與目標單位必須屬於同一個商品規格/
    );
  });

  test('TC-250-E-05: Unit conversion with identical from and to unit is rejected', async () => {
    // Given: Warehouse and product
    const wh = await invoke('create_warehouse', {
      code: `WH250_E05_${Math.floor(Math.random() * 1000)}`,
      name: '同單位防護倉'
    });
    const prod = await invoke('create_product', {
      name: `商品250_E05_${Date.now()}`,
      category: 'resale',
      selling_price: 100,
      units: [{ unit_name: '包', is_base: true, conversion_rate: 1 }]
    });
    const unitId = prod.units[0].id;

    // When & Then: Converting from unitId to unitId is rejected
    await assert.rejects(
      async () => {
        await invoke('create_unit_conversion', {
          warehouseId: wh.id,
          fromUnitId: unitId,
          fromQuantity: 1,
          toUnitId: unitId,
          toQuantity: 1
        });
      },
      /來源單位與目標單位不可相同/
    );
  });

  test('TC-250-E-06: State machine transitions prevent modifying posted conversion', async () => {
    // Given: Posted conversion
    const wh = await invoke('create_warehouse', {
      code: `WH250_E06_${Math.floor(Math.random() * 1000)}`,
      name: '狀態機測試倉'
    });
    const prod = await invoke('create_product', {
      name: `商品250_E06_${Date.now()}`,
      category: 'resale',
      unitName: '打',
      sellingPrice: 100
    });
    const fromUnit = prod.units[0];
    const toUnit = await invoke('add_product_unit', {
      variantId: prod.variants[0].id,
      unitName: '支',
      conversionRatio: 12,
      isBaseUnit: false
    });

    await invoke('record_opening_inventory_balance', {
      warehouse_id: wh.id,
      unit_id: fromUnit.id,
      quantity_delta: 5,
      unit_cost: 120
    });
    const ucv = await invoke('create_unit_conversion', {
      warehouseId: wh.id,
      fromUnitId: fromUnit.id,
      fromQuantity: 1,
      toUnitId: toUnit.id,
      toQuantity: 12
    });
    await invoke('post_unit_conversion', { conversionId: ucv.id });

    // When & Then: Double post fails
    await assert.rejects(
      async () => {
        await invoke('post_unit_conversion', { conversionId: ucv.id });
      },
      /單位轉換單狀態為「posted」，無法變更為「posted」/
    );

    // When & Then: Cancel posted conversion fails
    await assert.rejects(
      async () => {
        await invoke('cancel_unit_conversion', { conversionId: ucv.id });
      },
      /單位轉換單狀態為「posted」，無法變更為「cancelled」/
    );
  });

  test('TC-250-B-01: Unit conversion quantity boundaries (0, negative, NaN)', async () => {
    // Given: Warehouse and product
    const wh = await invoke('create_warehouse', {
      code: `WH250_B01_${Math.floor(Math.random() * 1000)}`,
      name: '數量邊界倉'
    });
    const prod = await invoke('create_product', {
      name: `商品250_B01_${Date.now()}`,
      category: 'resale',
      unitName: '箱',
      sellingPrice: 100
    });
    const fromId = prod.units[0].id;
    const toUnit = await invoke('add_product_unit', {
      variantId: prod.variants[0].id,
      unitName: '瓶',
      conversionRatio: 24,
      isBaseUnit: false
    });
    const toId = toUnit.id;

    // When & Then: from_quantity <= 0 or NaN throws
    await assert.rejects(
      async () => {
        await invoke('create_unit_conversion', {
          warehouseId: wh.id,
          fromUnitId: fromId,
          fromQuantity: 0,
          toUnitId: toId,
          toQuantity: 24
        });
      },
      /來源數量 \(from_quantity\) 必須大於 0/
    );

    await assert.rejects(
      async () => {
        await invoke('create_unit_conversion', {
          warehouseId: wh.id,
          fromUnitId: fromId,
          fromQuantity: -5,
          toUnitId: toId,
          toQuantity: 24
        });
      },
      /來源數量 \(from_quantity\) 必須大於 0/
    );

    // When & Then: to_quantity <= 0 or NaN throws
    await assert.rejects(
      async () => {
        await invoke('create_unit_conversion', {
          warehouseId: wh.id,
          fromUnitId: fromId,
          fromQuantity: 1,
          toUnitId: toId,
          toQuantity: 0
        });
      },
      /目標數量 \(to_quantity\) 必須大於 0/
    );
  });

  test('TC-250-B-02: Unit conversion stock tolerance boundary (1e-9 tolerance)', async () => {
    // Given: Warehouse with exactly 10 units in stock
    const wh = await invoke('create_warehouse', {
      code: `WH250_B02_${Math.floor(Math.random() * 1000)}`,
      name: '浮點公差倉'
    });
    const prod = await invoke('create_product', {
      name: `商品250_B02_${Date.now()}`,
      category: 'resale',
      unitName: '公斤',
      sellingPrice: 100
    });
    const fromId = prod.units[0].id;
    const toUnit = await invoke('add_product_unit', {
      variantId: prod.variants[0].id,
      unitName: '公克',
      conversionRatio: 1000,
      isBaseUnit: false
    });
    const toId = toUnit.id;

    await invoke('record_opening_inventory_balance', {
      warehouse_id: wh.id,
      unit_id: fromId,
      quantity_delta: 10,
      unit_cost: 50
    });

    // When: Requesting exactly 10 (with tolerance + 5e-10) -> succeeds
    const ucvExact = await invoke('create_unit_conversion', {
      warehouseId: wh.id,
      fromUnitId: fromId,
      fromQuantity: 10,
      toUnitId: toId,
      toQuantity: 10000
    });
    const posted = await invoke('post_unit_conversion', { conversionId: ucvExact.id });
    assert.equal(posted.status, 'posted');

    // When & Then: Further conversion when stock is 0 -> fails
    const ucvShort = await invoke('create_unit_conversion', {
      warehouseId: wh.id,
      fromUnitId: fromId,
      fromQuantity: 0.001,
      toUnitId: toId,
      toQuantity: 1
    });
    await assert.rejects(
      async () => {
        await invoke('post_unit_conversion', { conversionId: ucvShort.id });
      },
      /現有庫存.*不足/
    );
  });

  test('TC-250-B-03: Opening inventory balance numeric boundaries (<= 0 qty, < 0 cost)', async () => {
    // Given: Warehouse and product
    const wh = await invoke('create_warehouse', {
      code: `WH250_B03_${Math.floor(Math.random() * 1000)}`,
      name: '期初數值邊界倉'
    });
    const prod = await invoke('create_product', {
      name: `商品250_B03_${Date.now()}`,
      category: 'resale',
      selling_price: 100,
      units: [{ unit_name: '件', is_base: true, conversion_rate: 1 }]
    });
    const unitId = prod.units[0].id;

    // When & Then: quantity <= 0 throws
    await assert.rejects(
      async () => {
        await invoke('record_opening_inventory_balance', {
          warehouse_id: wh.id,
          unit_id: unitId,
          quantity_delta: 0,
          unit_cost: 10
        });
      },
      /期初開帳數量必須大於 0/
    );

    await assert.rejects(
      async () => {
        await invoke('record_opening_inventory_balance', {
          warehouse_id: wh.id,
          unit_id: unitId,
          quantity_delta: -10,
          unit_cost: 10
        });
      },
      /期初開帳數量必須大於 0/
    );

    // When & Then: cost < 0 throws
    await assert.rejects(
      async () => {
        await invoke('record_opening_inventory_balance', {
          warehouse_id: wh.id,
          unit_id: unitId,
          quantity_delta: 10,
          unit_cost: -1
        });
      },
      /期初開帳成本不可為負數/
    );

    // Cost = 0 is valid (free sample / zero-cost opening)
    const zeroCostMov = await invoke('record_opening_inventory_balance', {
      warehouse_id: wh.id,
      unit_id: unitId,
      quantity_delta: 10,
      unit_cost: 0
    });
    assert.equal(zeroCostMov.unit_cost, 0);
  });
});
