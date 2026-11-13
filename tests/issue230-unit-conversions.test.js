import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { invoke } from '../src/lib/tauri.js';

async function setupSeed() {
  await invoke('reset_mock_unit_conversions');
  const wh = await invoke('create_warehouse', { code: `WH-${Date.now()}`, name: '主倉' });
  const prod = await invoke('create_product', {
    name: `原子筆_${Date.now()}`,
    category: '轉售商品',
    unitName: '個',
    sellingPrice: 15
  });
  const pcsUnit = prod.units[0];
  const variantId = prod.variants[0].id;
  const boxUnit = await invoke('add_product_unit', {
    variantId,
    unitName: '盒',
    conversionRatio: 12,
    isBaseUnit: false,
    sellingPrice: 150
  });
  return { wh, prod, pcsUnit, boxUnit, variantId };
}

describe('Issue #230: Unit Conversions (單位轉換單)', () => {
  beforeEach(async () => {
    await invoke('reset_mock_unit_conversions');
  });

  it('TC-UCV-JS-N-01: Create draft unit conversion, list, and post writes two movements with unit_cost=null', async () => {
    // Given: Warehouse and product with 盒 (ratio 12) and 個 (ratio 1), and 2 boxes in stock
    const { wh, pcsUnit, boxUnit } = await setupSeed();
    await invoke('record_opening_inventory_balance', {
      unitId: boxUnit.id,
      warehouseId: wh.id,
      quantity: 2,
      unitCost: 100
    });

    // When: Create draft conversion (1 盒 -> 10 個, intentionally not 12)
    const draft = await invoke('create_unit_conversion', {
      warehouseId: wh.id,
      fromUnitId: boxUnit.id,
      fromQuantity: 1,
      toUnitId: pcsUnit.id,
      toQuantity: 10,
      note: '拆盒零售'
    });

    // Then: Draft is created with UCV- prefix
    assert.ok(draft.conversion_number.startsWith('UCV-'));
    assert.equal(draft.status, 'draft');
    assert.equal(draft.from_quantity, 1);
    assert.equal(draft.to_quantity, 10);

    // When: Post the draft conversion
    const posted = await invoke('post_unit_conversion', { conversionId: draft.id });

    // Then: Status is posted and two inventory_movements are written with unit_cost=null
    assert.equal(posted.status, 'posted');
    assert.ok(posted.posted_at);

    const boxMovs = await invoke('list_inventory_movements', { unitId: boxUnit.id, warehouseId: wh.id });
    const pcsMovs = await invoke('list_inventory_movements', { unitId: pcsUnit.id, warehouseId: wh.id });

    const outMov = boxMovs.find(m => m.reference_id === draft.id);
    const inMov = pcsMovs.find(m => m.reference_id === draft.id);

    assert.ok(outMov);
    assert.equal(outMov.reason, 'unit_conversion_out');
    assert.equal(outMov.quantity_delta, -1);
    assert.equal(outMov.unit_cost, null);

    assert.ok(inMov);
    assert.equal(inMov.reason, 'unit_conversion_in');
    assert.equal(inMov.quantity_delta, 10);
    assert.equal(inMov.unit_cost, null);

    const list = await invoke('list_unit_conversions', { status: 'posted', warehouseId: wh.id });
    assert.ok(list.some(c => c.id === draft.id));
  });

  it('TC-UCV-JS-E-01: Negative stock blocked when source unit has insufficient inventory', async () => {
    // Given: Source unit has 1 box in stock, conversion requests 2 boxes
    const { wh, pcsUnit, boxUnit } = await setupSeed();
    await invoke('record_opening_inventory_balance', {
      unitId: boxUnit.id,
      warehouseId: wh.id,
      quantity: 1,
      unitCost: 100
    });

    const draft = await invoke('create_unit_conversion', {
      warehouseId: wh.id,
      fromUnitId: boxUnit.id,
      fromQuantity: 2,
      toUnitId: pcsUnit.id,
      toQuantity: 24
    });

    // When / Then: Posting fails with insufficient stock error and status stays draft
    await assert.rejects(
      async () => await invoke('post_unit_conversion', { conversionId: draft.id }),
      /庫存.*不足|無法扣除/
    );

    const fetched = await invoke('get_unit_conversion', { conversionId: draft.id });
    assert.equal(fetched.status, 'draft');
  });

  it('TC-UCV-JS-E-02: Reject different variants, same unit, and non-positive quantities', async () => {
    // Given: Product with two variants
    const { wh, prod, pcsUnit, boxUnit } = await setupSeed();
    const v2 = await invoke('add_product_variant', {
      productId: prod.product.id,
      name: '紅色',
      sku: 'PEN-RED'
    });
    const detail2 = await invoke('get_product_detail', { productId: prod.product.id });
    const v2Unit = detail2.units.find(u => u.variant_id === v2.id);

    // When / Then: Different variants rejected
    await assert.rejects(
      async () => await invoke('create_unit_conversion', {
        warehouseId: wh.id,
        fromUnitId: boxUnit.id,
        fromQuantity: 1,
        toUnitId: v2Unit.id,
        toQuantity: 12
      }),
      /同一個商品規格/
    );

    // When / Then: Same unit rejected
    await assert.rejects(
      async () => await invoke('create_unit_conversion', {
        warehouseId: wh.id,
        fromUnitId: boxUnit.id,
        fromQuantity: 1,
        toUnitId: boxUnit.id,
        toQuantity: 1
      }),
      /不可相同/
    );

    // When / Then: Zero quantity rejected
    await assert.rejects(
      async () => await invoke('create_unit_conversion', {
        warehouseId: wh.id,
        fromUnitId: boxUnit.id,
        fromQuantity: 0,
        toUnitId: pcsUnit.id,
        toQuantity: 12
      }),
      /大於 0/
    );
  });

  it('TC-UCV-JS-N-02: Cancel draft conversion prevents posting', async () => {
    // Given: A draft conversion
    const { wh, pcsUnit, boxUnit } = await setupSeed();
    const draft = await invoke('create_unit_conversion', {
      warehouseId: wh.id,
      fromUnitId: boxUnit.id,
      fromQuantity: 1,
      toUnitId: pcsUnit.id,
      toQuantity: 12
    });

    // When: Cancel the draft
    const cancelled = await invoke('cancel_unit_conversion', { conversionId: draft.id });

    // Then: Status is cancelled and cannot be posted
    assert.equal(cancelled.status, 'cancelled');
    assert.ok(cancelled.cancelled_at);
    await assert.rejects(
      async () => await invoke('post_unit_conversion', { conversionId: draft.id }),
      /無法變更為「posted」/
    );
  });
});
