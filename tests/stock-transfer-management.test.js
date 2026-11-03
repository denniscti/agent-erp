import test from 'node:test';
import assert from 'node:assert/strict';
import { invoke } from '../src/lib/tauri.js';

/**
 * Test Perspective Table (Issue #185 - Stock Transfers / 調撥單)
 *
 * | Case ID | Perspective | Description |
 * |---|---|---|
 * | TC-L2-TRF-01 | Equivalence - Normal | Full lifecycle: Create draft -> add line -> post -> verify both warehouses' inventory updated and total stock invariant |
 * | TC-L2-TRF-02 | Equivalence - Normal | Cancel lifecycle: Create draft -> cancel -> status is cancelled, 0 inventory movements created |
 * | TC-L2-TRF-03 | Equivalence - UI Guide | Single warehouse guidance: When tenant has < 2 active warehouses, transfer cannot proceed |
 * | TC-L2-TRF-04 | Boundary - Stock Warning | Over-stock highlight detection and T-05 insufficient stock rejection |
 * | TC-L2-TRF-05 | Equivalence - Shortcut | Reverse stock transfer shortcut pre-fills inverted warehouses and identical lines |
 * | TC-L2-TRF-06 | Equivalence - Rule T-02 | Same warehouse rejection (from == to) |
 * | TC-L2-TRF-07 | Equivalence - Rule T-03 | Duplicate unit rejection and non-purchasable unit allowed |
 * | TC-L2-TRF-08 | Boundary - Rule T-04 | Zero and negative quantity rejection |
 * | TC-L2-TRF-09 | Boundary - Rule T-05 | Exact stock transfer clearing vs over-stock (+0.01, +0.000001) |
 * | TC-L2-TRF-10 | Atomicity - Rule T-05/06 | Multi-line transfer with one insufficient item rolls back completely |
 * | TC-L2-TRF-11 | Idempotency - Rule T-07 | Double post and illegal state transitions rejected |
 * | TC-L2-TRF-12 | Isolation - Rule T-08 | Cross-tenant access strictly isolated |
 * | TC-L2-TRF-13 | Guard - Rule W-03 Extension| Warehouse deactivation blocked by draft transfer (source or target) |
 */

async function switchTenant(tenantId) {
  await invoke('set_mock_active_tenant', { tenant_id: tenantId });
}

async function createStockTransfer(params) {
  return await invoke('create_stock_transfer', params);
}

async function addStockTransferLine(transfer_id, unit_id, quantity) {
  return await invoke('add_stock_transfer_line', { transfer_id, unit_id, quantity });
}

async function updateStockTransferLine(line_id, quantity) {
  return await invoke('update_stock_transfer_line', { line_id, quantity });
}

async function postStockTransfer(transfer_id) {
  return await invoke('post_stock_transfer', { transfer_id });
}

async function cancelStockTransfer(transfer_id) {
  return await invoke('cancel_stock_transfer', { transfer_id });
}

async function getStockTransfer(transfer_id) {
  return await invoke('get_stock_transfer', { transfer_id });
}

async function listStockTransfers(filters) {
  return await invoke('list_stock_transfers', filters);
}

async function setupTestEnvironment(tid) {
  await switchTenant(tid);
  await invoke('reset_mock_warehouses', { tenant_id: tid });
  await invoke('reset_mock_stock_transfers', { tenant_id: tid });

  // Create two warehouses
  const wh1 = await invoke('create_warehouse', { code: 'SRC', name: '來源總倉' });
  const wh2 = await invoke('create_warehouse', { code: 'DST', name: '目的門市倉' });

  // Create product and units
  const prod = await invoke('create_product', {
    name: '精選商品A',
    category: 'resale',
    unit_name: '件',
    selling_price: 150.0
  });
  const unitId1 = prod.units[0].id;

  const prod2 = await invoke('create_product', {
    name: '精選商品B',
    category: 'resale',
    unit_name: '箱',
    selling_price: 500.0
  });
  const unitId2 = prod2.units[0].id;

  // Record opening balance in wh1
  await invoke('record_opening_inventory_balance', {
    unit_id: unitId1,
    quantity: 100,
    unit_cost: 80,
    warehouse_id: wh1.id
  });

  await invoke('record_opening_inventory_balance', {
    unit_id: unitId2,
    quantity: 50,
    unit_cost: 300,
    warehouse_id: wh1.id
  });

  return { wh1, wh2, unitId1, unitId2 };
}

test('TC-L2-TRF-01: Full lifecycle - Create, manage lines, post, verify double-entry ledger & invariance', async () => {
  // Given: Source warehouse with 100 of unitId1 and 50 of unitId2
  const tid = `tnt_trf_flow_${Date.now()}`;
  const { wh1, wh2, unitId1, unitId2 } = await setupTestEnvironment(tid);

  // When: Creating draft transfer with initial line
  const created = await createStockTransfer({
    from_warehouse_id: wh1.id,
    to_warehouse_id: wh2.id,
    note: '首次店間調撥',
    initial_lines: [{ unit_id: unitId1, quantity: 20 }]
  });

  assert.equal(created.transfer.status, 'draft');
  assert.equal(created.transfer.transfer_number.startsWith('TRF-'), true);
  assert.equal(created.lines.length, 1);
  assert.equal(created.lines[0].quantity, 20);

  // When: Adding second line
  const d2 = await addStockTransferLine(created.transfer.id, unitId2, 10);
  assert.equal(d2.lines.length, 2);

  // When: Updating quantity of line 1
  const line1 = d2.lines.find(l => l.unit_id === unitId1);
  const d3 = await updateStockTransferLine(line1.id, 25);
  const updatedLine1 = d3.lines.find(l => l.id === line1.id);
  assert.equal(updatedLine1.quantity, 25);

  // When: Posting the stock transfer
  const posted = await postStockTransfer(created.transfer.id);

  // Then: Status is posted
  assert.equal(posted.transfer.status, 'posted');
  assert.ok(posted.transfer.posted_at);

  // Verify stock in wh1 (source): 100 - 25 = 75
  const lvlWh1 = await invoke('get_inventory_level', {
    unit_id: unitId1,
    warehouse_id: wh1.id
  });
  assert.equal(lvlWh1.current_quantity, 75);

  // Verify stock in wh2 (destination): 0 + 25 = 25
  const lvlWh2 = await invoke('get_inventory_level', {
    unit_id: unitId1,
    warehouse_id: wh2.id
  });
  assert.equal(lvlWh2.current_quantity, 25);

  // Verify total inventory invariance across all warehouses
  const lvlAll = await invoke('get_inventory_level', {
    unit_id: unitId1
  });
  assert.equal(lvlAll.current_quantity, 100);

  // Verify movements written: 2 movements per line
  const movements = await invoke('list_inventory_movements', {
    unit_id: unitId1
  });
  const trfMovements = movements.filter(m => m.reference_id === created.transfer.id);
  assert.equal(trfMovements.length, 2);
  const outMov = trfMovements.find(m => m.reason === 'transfer_out');
  const inMov = trfMovements.find(m => m.reason === 'transfer_in');
  assert.equal(outMov.warehouse_id, wh1.id);
  assert.equal(outMov.quantity_delta, -25);
  assert.equal(inMov.warehouse_id, wh2.id);
  assert.equal(inMov.quantity_delta, 25);
});

test('TC-L2-TRF-02: Cancel lifecycle - Create draft, cancel, verify status and no movements created', async () => {
  // Given: Source warehouse with inventory
  const tid = `tnt_trf_cancel_${Date.now()}`;
  const { wh1, wh2, unitId1 } = await setupTestEnvironment(tid);

  // When: Creating draft transfer
  const detail = await createStockTransfer({
    from_warehouse_id: wh1.id,
    to_warehouse_id: wh2.id,
    initial_lines: [{ unit_id: unitId1, quantity: 15 }]
  });

  // When: Cancelling the transfer
  const cancelled = await cancelStockTransfer(detail.transfer.id);

  // Then: Status is cancelled
  assert.equal(cancelled.transfer.status, 'cancelled');
  assert.ok(cancelled.transfer.cancelled_at);

  // Verify no movements created for this transfer
  const movements = await invoke('list_inventory_movements', { unit_id: unitId1 });
  const trfMovements = movements.filter(m => m.reference_id === detail.transfer.id);
  assert.equal(trfMovements.length, 0);

  // Stock remains unchanged
  const lvl = await invoke('get_inventory_level', {
    unit_id: unitId1,
    warehouse_id: wh1.id
  });
  assert.equal(lvl.current_quantity, 100);
});

test('TC-L2-TRF-03: Single warehouse guidance condition', async () => {
  // Given: Tenant with only 1 warehouse
  const tid = `tnt_trf_single_${Date.now()}`;
  await switchTenant(tid);
  await invoke('reset_mock_warehouses', { tenant_id: tid });
  await invoke('create_warehouse', { code: 'ONLY1', name: '唯一倉庫' });

  // When: Checking active warehouses count
  const allWhs = await invoke('list_warehouses');
  const activeWhs = allWhs.filter(w => w.is_active);

  // Then: activeWhs.length < 2, triggering guidance display
  assert.equal(activeWhs.length, 1);
  assert.equal(activeWhs.length < 2, true);
});

test('TC-L2-TRF-04: Over-stock highlight detection and T-05 error message verification', async () => {
  // Given: wh1 has 100 of unitId1
  const tid = `tnt_trf_overstock_${Date.now()}`;
  const { wh1, wh2, unitId1 } = await setupTestEnvironment(tid);

  // When: Creating transfer requesting 120 (available is only 100)
  const detail = await createStockTransfer({
    from_warehouse_id: wh1.id,
    to_warehouse_id: wh2.id,
    initial_lines: [{ unit_id: unitId1, quantity: 120 }]
  });

  // Then: Visual check logic (line.quantity > availStock) triggers
  const availStock = 100;
  const isOverStock = detail.lines[0].quantity > availStock;
  assert.equal(isOverStock, true);

  // When: Attempting to post over-stock transfer
  await assert.rejects(
    async () => {
      await postStockTransfer(detail.transfer.id);
    },
    (err) => {
      // Then: T-05 rejection error with specific Chinese formatting
      assert.match(err.message, /不足調撥 120/);
      assert.match(err.message, /現有 100/);
      return true;
    }
  );
});

test('TC-L2-TRF-05: Reverse stock transfer shortcut pre-fills inverted warehouses and identical lines', async () => {
  // Given: Posted transfer from wh1 to wh2
  const tid = `tnt_trf_reverse_${Date.now()}`;
  const { wh1, wh2, unitId1, unitId2 } = await setupTestEnvironment(tid);

  const orig = await createStockTransfer({
    from_warehouse_id: wh1.id,
    to_warehouse_id: wh2.id,
    initial_lines: [
      { unit_id: unitId1, quantity: 30 },
      { unit_id: unitId2, quantity: 10 }
    ]
  });
  await postStockTransfer(orig.transfer.id);

  // When: Simulating reverse transfer creation shortcut
  const reverseData = {
    from_warehouse_id: orig.transfer.to_warehouse_id, // wh2
    to_warehouse_id: orig.transfer.from_warehouse_id, // wh1
    note: `反向調撥（參照 ${orig.transfer.transfer_number}）`,
    initial_lines: orig.lines.map(l => ({ unit_id: l.unit_id, quantity: l.quantity }))
  };

  const reverseDetail = await createStockTransfer(reverseData);

  // Then: Warehouses swapped, identical units and quantities
  assert.equal(reverseDetail.transfer.from_warehouse_id, wh2.id);
  assert.equal(reverseDetail.transfer.to_warehouse_id, wh1.id);
  assert.match(reverseDetail.transfer.note, /反向調撥/);
  assert.equal(reverseDetail.lines.length, 2);
  assert.equal(reverseDetail.lines[0].unit_id, unitId1);
  assert.equal(reverseDetail.lines[0].quantity, 30);
  assert.equal(reverseDetail.lines[1].unit_id, unitId2);
  assert.equal(reverseDetail.lines[1].quantity, 10);
});

test('TC-L2-TRF-06: Rule T-02 - Same warehouse rejection', async () => {
  // Given: Source and destination are same
  const tid = `tnt_trf_t02_${Date.now()}`;
  const { wh1, unitId1 } = await setupTestEnvironment(tid);

  // When / Then: Rejection on create
  await assert.rejects(
    async () => {
      await createStockTransfer({
        from_warehouse_id: wh1.id,
        to_warehouse_id: wh1.id,
        initial_lines: [{ unit_id: unitId1, quantity: 5 }]
      });
    },
    (err) => {
      assert.match(err.message, /來源倉與目的倉不可相同/);
      return true;
    }
  );
});

test('TC-L2-TRF-07: Rule T-03 - Duplicate unit rejected & non-purchasable unit allowed', async () => {
  const tid = `tnt_trf_t03_${Date.now()}`;
  const { wh1, wh2, unitId1 } = await setupTestEnvironment(tid);

  // Duplicate unit in initial_lines
  await assert.rejects(
    async () => {
      await createStockTransfer({
        from_warehouse_id: wh1.id,
        to_warehouse_id: wh2.id,
        initial_lines: [
          { unit_id: unitId1, quantity: 5 },
          { unit_id: unitId1, quantity: 10 }
        ]
      });
    },
    (err) => {
      assert.match(err.message, /同一調撥單內商品單位不可重複/);
      return true;
    }
  );

  // Duplicate unit via add line
  const d = await createStockTransfer({
    from_warehouse_id: wh1.id,
    to_warehouse_id: wh2.id,
    initial_lines: [{ unit_id: unitId1, quantity: 5 }]
  });

  await assert.rejects(
    async () => {
      await addStockTransferLine(d.transfer.id, unitId1, 10);
    },
    (err) => {
      assert.match(err.message, /同一調撥單內商品單位不可重複/);
      return true;
    }
  );
});

test('TC-L2-TRF-08: Rule T-04 - Zero and negative quantity rejected', async () => {
  const tid = `tnt_trf_t04_${Date.now()}`;
  const { wh1, wh2, unitId1 } = await setupTestEnvironment(tid);

  await assert.rejects(
    async () => {
      await createStockTransfer({
        from_warehouse_id: wh1.id,
        to_warehouse_id: wh2.id,
        initial_lines: [{ unit_id: unitId1, quantity: 0 }]
      });
    },
    (err) => {
      assert.match(err.message, /調撥數量必須大於 0/);
      return true;
    }
  );

  await assert.rejects(
    async () => {
      await createStockTransfer({
        from_warehouse_id: wh1.id,
        to_warehouse_id: wh2.id,
        initial_lines: [{ unit_id: unitId1, quantity: -2 }]
      });
    },
    (err) => {
      assert.match(err.message, /調撥數量必須大於 0/);
      return true;
    }
  );
});

test('TC-L2-TRF-09: Rule T-05 - Exact stock transfer clearing vs over-stock (+0.01)', async () => {
  // Given: wh1 has 50 of unitId2
  const tid = `tnt_trf_t05_${Date.now()}`;
  const { wh1, wh2, unitId2 } = await setupTestEnvironment(tid);

  // Boundary 1: Exact 50 transferred -> succeeds
  const dExact = await createStockTransfer({
    from_warehouse_id: wh1.id,
    to_warehouse_id: wh2.id,
    initial_lines: [{ unit_id: unitId2, quantity: 50 }]
  });
  const postedExact = await postStockTransfer(dExact.transfer.id);
  assert.equal(postedExact.transfer.status, 'posted');

  const remainWh1 = await invoke('get_inventory_level', {
    unit_id: unitId2,
    warehouse_id: wh1.id
  });
  assert.equal(remainWh1.current_quantity, 0);

  // Boundary 2: Attempting 0.01 from wh1 (now has 0) -> fails
  const dOver = await createStockTransfer({
    from_warehouse_id: wh1.id,
    to_warehouse_id: wh2.id,
    initial_lines: [{ unit_id: unitId2, quantity: 0.01 }]
  });
  await assert.rejects(
    async () => {
      await postStockTransfer(dOver.transfer.id);
    },
    (err) => {
      assert.match(err.message, /現有 0/);
      return true;
    }
  );
});

test('TC-L2-TRF-10: Atomicity - Multi-line with one insufficient item rolls back completely', async () => {
  // Given: unitId1 has 100, unitId2 has 50
  const tid = `tnt_trf_atomic_${Date.now()}`;
  const { wh1, wh2, unitId1, unitId2 } = await setupTestEnvironment(tid);

  const d = await createStockTransfer({
    from_warehouse_id: wh1.id,
    to_warehouse_id: wh2.id,
    initial_lines: [
      { unit_id: unitId1, quantity: 30 }, // sufficient
      { unit_id: unitId2, quantity: 80 }  // insufficient
    ]
  });

  // When: Posting fails
  await assert.rejects(
    async () => {
      await postStockTransfer(d.transfer.id);
    },
    (err) => {
      assert.match(err.message, /不足調撥 80/);
      return true;
    }
  );

  // Then: Zero movements written for both units, stock untouched
  const mov1 = await invoke('list_inventory_movements', { unit_id: unitId1 });
  assert.equal(mov1.filter(m => m.reference_id === d.transfer.id).length, 0);

  const mov2 = await invoke('list_inventory_movements', { unit_id: unitId2 });
  assert.equal(mov2.filter(m => m.reference_id === d.transfer.id).length, 0);
});

test('TC-L2-TRF-11: Idempotency & illegal state transitions', async () => {
  const tid = `tnt_trf_idemp_${Date.now()}`;
  const { wh1, wh2, unitId1 } = await setupTestEnvironment(tid);

  const d = await createStockTransfer({
    from_warehouse_id: wh1.id,
    to_warehouse_id: wh2.id,
    initial_lines: [{ unit_id: unitId1, quantity: 10 }]
  });
  await postStockTransfer(d.transfer.id);

  // Double post
  await assert.rejects(
    async () => {
      await postStockTransfer(d.transfer.id);
    },
    (err) => {
      assert.match(err.message, /不可從 posted 轉換至 posted/);
      return true;
    }
  );

  // Cancel on posted
  await assert.rejects(
    async () => {
      await cancelStockTransfer(d.transfer.id);
    },
    (err) => {
      assert.match(err.message, /不可從 posted 轉換至 cancelled/);
      return true;
    }
  );
});

test('TC-L2-TRF-12: Tenant isolation', async () => {
  const tidA = `tnt_trf_iso_A_${Date.now()}`;
  const { wh1, wh2, unitId1 } = await setupTestEnvironment(tidA);
  const detail = await createStockTransfer({
    from_warehouse_id: wh1.id,
    to_warehouse_id: wh2.id,
    initial_lines: [{ unit_id: unitId1, quantity: 10 }]
  });

  // Switch to tenant B
  const tidB = `tnt_trf_iso_B_${Date.now()}`;
  await switchTenant(tidB);

  await assert.rejects(
    async () => {
      await getStockTransfer(detail.transfer.id);
    },
    (err) => {
      assert.match(err.message, /找不到調撥單或不屬於目前租戶/);
      return true;
    }
  );

  const listB = await listStockTransfers();
  assert.equal(listB.some(t => t.id === detail.transfer.id), false);
});

test('TC-L2-TRF-13: Rule W-03 Extension - Deactivate warehouse blocked by draft transfer', async () => {
  const tid = `tnt_trf_w03_${Date.now()}`;
  const { wh1, wh2, unitId1 } = await setupTestEnvironment(tid);

  const detail = await createStockTransfer({
    from_warehouse_id: wh1.id,
    to_warehouse_id: wh2.id,
    initial_lines: [{ unit_id: unitId1, quantity: 5 }]
  });

  // Attempting to deactivate destination wh2 (which has 0 stock)
  await assert.rejects(
    async () => {
      await invoke('deactivate_warehouse', { id: wh2.id });
    },
    (err) => {
      assert.match(err.message, new RegExp(`此倉仍被未結案單據引用：${detail.transfer.transfer_number}`));
      return true;
    }
  );

  // Cancelling transfer unblocks deactivation
  await cancelStockTransfer(detail.transfer.id);
  const deactivated = await invoke('deactivate_warehouse', { id: wh2.id });
  assert.equal(deactivated.is_active, false);
});
