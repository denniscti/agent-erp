use rusqlite::params;

/// Calculate weighted average cost for a specific unit in a warehouse up to `as_of` timestamp.
///
/// Replays `inventory_movements` in `(tenant_id, unit_id, warehouse_id)` ordered by `created_at ASC, id ASC`.
/// - Inward movement (`quantity_delta > 0` and `unit_cost IS NOT NULL`):
///   `total_cost += qty * unit_cost`, `total_qty += qty`
///   (if existing total_qty < 0, negative quantity is replenished first at incoming unit_cost).
/// - Outward movement (`quantity_delta < 0`):
///   `running_avg = if total_qty > 0 { total_cost / total_qty } else { 0.0 }`
///   `total_cost -= |qty| * running_avg`, `total_qty -= |qty|`
///
/// Returns running weighted average cost at `as_of`. If stock is 0 or negative, returns 0.0.
pub fn calculate_weighted_average_cost(
    conn: &rusqlite::Connection,
    tenant_id: &str,
    unit_id: &str,
    warehouse_id: &str,
    as_of: Option<i64>,
) -> Result<f64, String> {
    let tid = tenant_id.trim();
    if tid.is_empty() {
        return Err("租戶 ID 不能為空".to_string());
    }
    let uid = unit_id.trim();
    if uid.is_empty() {
        return Err("品項單位 ID 不能為空".to_string());
    }
    let wid = warehouse_id.trim();
    if wid.is_empty() {
        return Err("倉庫 ID 不能為空".to_string());
    }

    let mut stmt = conn
        .prepare(
            "SELECT id, quantity_delta, unit_cost, reason, created_at
             FROM inventory_movements
             WHERE tenant_id = ?1 AND unit_id = ?2 AND warehouse_id = ?3
               AND (?4 IS NULL OR created_at <= ?4)
             ORDER BY created_at ASC, id ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![tid, uid, wid, as_of], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, f64>(1)?,
                row.get::<_, Option<f64>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut total_qty: f64 = 0.0;
    let mut total_cost: f64 = 0.0;

    for item in rows {
        let (_id, qty_delta, unit_cost, _reason, _created_at) = item.map_err(|e| e.to_string())?;

        if qty_delta > 0.0 {
            if let Some(cost) = unit_cost {
                if total_qty < 0.0 {
                    let new_qty = total_qty + qty_delta;
                    if new_qty > 0.0 {
                        total_qty = new_qty;
                        total_cost = new_qty * cost;
                    } else {
                        total_qty = new_qty;
                        total_cost = 0.0;
                    }
                } else {
                    total_cost += qty_delta * cost;
                    total_qty += qty_delta;
                }
            }
        } else if qty_delta < 0.0 {
            let running_avg = if total_qty > 1e-9 && total_cost > 0.0 {
                total_cost / total_qty
            } else {
                0.0
            };
            let deduct_qty = qty_delta.abs().min(total_qty.max(0.0));
            total_cost -= deduct_qty * running_avg;
            total_qty -= qty_delta.abs();
            if total_qty <= 1e-9 || total_cost <= 1e-9 {
                total_cost = 0.0;
            }
        }
    }

    let running_avg = if total_qty > 1e-9 && total_cost > 0.0 {
        total_cost / total_qty
    } else {
        0.0
    };

    Ok(running_avg)
}

/// Backfill historical sales shipment movements where unit_cost is NULL.
///
/// Replays movements per `(tenant_id, unit_id, warehouse_id)` group chronologically,
/// setting `unit_cost = running_avg` for each `reason = 'sales_shipment' AND unit_cost IS NULL` movement.
/// Naturally idempotent: movements that already have `unit_cost` are untouched.
pub fn backfill_sales_shipment_unit_cost_impl(
    conn: &mut rusqlite::Connection,
    tenant_id: Option<&str>,
) -> Result<usize, String> {
    if let Some(tid) = tenant_id {
        if tid.trim().is_empty() {
            return Err("租戶 ID 不能為空".to_string());
        }
    }
    let effective_tid = tenant_id.map(|t| t.trim().to_string());

    // 1. Find distinct (tenant_id, unit_id, warehouse_id) groups with uncosted sales_shipment movements
    let groups: Vec<(String, String, String)> = {
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT tenant_id, unit_id, warehouse_id
                 FROM inventory_movements
                 WHERE reason = 'sales_shipment' AND unit_cost IS NULL
                   AND (?1 IS NULL OR tenant_id = ?1)",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![effective_tid], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut res = Vec::new();
        for g in rows {
            res.push(g.map_err(|e| e.to_string())?);
        }
        res
    };

    if groups.is_empty() {
        return Ok(0);
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut updated_count: usize = 0;

    for (tid, uid, wid) in groups {
        let mut stmt = tx
            .prepare(
                "SELECT id, quantity_delta, unit_cost, reason, created_at
                 FROM inventory_movements
                 WHERE tenant_id = ?1 AND unit_id = ?2 AND warehouse_id = ?3
                 ORDER BY created_at ASC, id ASC",
            )
            .map_err(|e| e.to_string())?;

        let movements: Vec<(String, f64, Option<f64>, String, i64)> = stmt
            .query_map(params![tid, uid, wid], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, f64>(1)?,
                    r.get::<_, Option<f64>>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, i64>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let mut total_qty: f64 = 0.0;
        let mut total_cost: f64 = 0.0;

        for (mov_id, qty_delta, unit_cost, reason, _created_at) in movements {
            if qty_delta > 0.0 {
                if let Some(cost) = unit_cost {
                    if total_qty < 0.0 {
                        let new_qty = total_qty + qty_delta;
                        if new_qty > 0.0 {
                            total_qty = new_qty;
                            total_cost = new_qty * cost;
                        } else {
                            total_qty = new_qty;
                            total_cost = 0.0;
                        }
                    } else {
                        total_cost += qty_delta * cost;
                        total_qty += qty_delta;
                    }
                }
            } else if qty_delta < 0.0 {
                let running_avg = if total_qty > 1e-9 && total_cost > 0.0 {
                    total_cost / total_qty
                } else {
                    0.0
                };

                // Backfill if sales_shipment and unit_cost IS NULL
                if reason == "sales_shipment" && unit_cost.is_none() {
                    let affected = tx
                        .execute(
                            "UPDATE inventory_movements SET unit_cost = ?1 WHERE id = ?2 AND unit_cost IS NULL",
                            params![running_avg, mov_id],
                        )
                        .map_err(|e| e.to_string())?;
                    updated_count += affected;
                }

                let deduct_qty = qty_delta.abs().min(total_qty.max(0.0));
                total_cost -= deduct_qty * running_avg;
                total_qty -= qty_delta.abs();
                if total_qty <= 1e-9 || total_cost <= 1e-9 {
                    total_cost = 0.0;
                }
            }
        }
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(updated_count)
}

#[tauri::command]
#[specta::specta]
pub async fn backfill_sales_shipment_unit_cost<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    tenant_id: Option<String>,
) -> Result<usize, String> {
    let db_path = crate::get_db_path(&app);
    let mut conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    backfill_sales_shipment_unit_cost_impl(&mut conn, tenant_id.as_deref())
}

#[tauri::command]
#[specta::specta]
pub async fn get_weighted_average_cost<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    unit_id: String,
    warehouse_id: String,
    as_of: Option<i64>,
) -> Result<f64, String> {
    let db_path = crate::get_db_path(&app);
    let conn = rusqlite::Connection::open(&db_path).map_err(|e| e.to_string())?;
    let active_tid = crate::resolve_active_tenant_id(&conn)?;
    calculate_weighted_average_cost(&conn, &active_tid, &unit_id, &warehouse_id, as_of)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("PRAGMA foreign_keys = ON", []).unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS tenants (
                id TEXT PRIMARY KEY,
                code TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                company_name TEXT NOT NULL DEFAULT ''
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TABLE IF NOT EXISTS inventory_movements (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                unit_id TEXT NOT NULL,
                quantity_delta REAL NOT NULL,
                unit_cost REAL,
                reason TEXT NOT NULL,
                reference_type TEXT NOT NULL,
                reference_id TEXT,
                created_by TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                warehouse_id TEXT
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO tenants (id, code, name, company_name) VALUES ('tnt_test', 'test', 'Test Tenant', 'Test Inc.')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO tenants (id, code, name, company_name) VALUES ('tnt_other', 'other', 'Other Tenant', 'Other Inc.')",
            [],
        )
        .unwrap();

        conn
    }

    fn insert_movement(
        conn: &Connection,
        id: &str,
        tenant_id: &str,
        unit_id: &str,
        warehouse_id: &str,
        quantity_delta: f64,
        unit_cost: Option<f64>,
        reason: &str,
        created_at: i64,
    ) {
        conn.execute(
            "INSERT INTO inventory_movements (
                id, tenant_id, unit_id, warehouse_id, quantity_delta, unit_cost,
                reason, reference_type, reference_id, created_by, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'test', 'ref_1', 'usr_1', ?8)",
            params![
                id,
                tenant_id,
                unit_id,
                warehouse_id,
                quantity_delta,
                unit_cost,
                reason,
                created_at
            ],
        )
        .unwrap();
    }

    // TC-COST-N-01: 單一品項多次進貨與出貨交錯
    #[test]
    fn test_tc_cost_n_01_single_unit_interleaved_movements() {
        // Given: Empty db with multiple interleaved purchase and shipment movements
        let conn = setup_test_db();
        // Day 1: Purchase 10 @ 100
        insert_movement(
            &conn,
            "mov_01",
            "tnt_test",
            "unt_1",
            "wh_1",
            10.0,
            Some(100.0),
            "purchase_receipt",
            1000,
        );
        // Day 2: Purchase 10 @ 120 -> running_avg = (1000 + 1200) / 20 = 110.0
        insert_movement(
            &conn,
            "mov_02",
            "tnt_test",
            "unt_1",
            "wh_1",
            10.0,
            Some(120.0),
            "purchase_receipt",
            2000,
        );
        // Day 3: Shipment 5 -> remaining: total_cost = 2200 - 5 * 110 = 1650, total_qty = 15, avg = 110.0
        insert_movement(
            &conn,
            "mov_03",
            "tnt_test",
            "unt_1",
            "wh_1",
            -5.0,
            None,
            "sales_shipment",
            3000,
        );
        // Day 4: Purchase 5 @ 130 -> running_avg = (1650 + 650) / 20 = 115.0
        insert_movement(
            &conn,
            "mov_04",
            "tnt_test",
            "unt_1",
            "wh_1",
            5.0,
            Some(130.0),
            "purchase_receipt",
            4000,
        );
        // Day 5: Shipment 10 -> remaining: total_cost = 2300 - 10 * 115 = 1150, total_qty = 10, avg = 115.0
        insert_movement(
            &conn,
            "mov_05",
            "tnt_test",
            "unt_1",
            "wh_1",
            -10.0,
            None,
            "sales_shipment",
            5000,
        );

        // When: Calculate weighted average cost as of day 2, day 3, day 4, day 5
        let cost_day2 =
            calculate_weighted_average_cost(&conn, "tnt_test", "unt_1", "wh_1", Some(2500))
                .unwrap();
        let cost_day3 =
            calculate_weighted_average_cost(&conn, "tnt_test", "unt_1", "wh_1", Some(3500))
                .unwrap();
        let cost_day4 =
            calculate_weighted_average_cost(&conn, "tnt_test", "unt_1", "wh_1", Some(4500))
                .unwrap();
        let cost_day5 =
            calculate_weighted_average_cost(&conn, "tnt_test", "unt_1", "wh_1", None).unwrap();

        // Then: Costs reflect moving weighted average accurately at each time
        assert!((cost_day2 - 110.0).abs() < 1e-6);
        assert!((cost_day3 - 110.0).abs() < 1e-6);
        assert!((cost_day4 - 115.0).abs() < 1e-6);
        assert!((cost_day5 - 115.0).abs() < 1e-6);
    }

    // TC-COST-N-02: 多倉別分別進出貨，互不汙染
    #[test]
    fn test_tc_cost_n_02_multi_warehouse_isolation() {
        // Given: Warehouse A receives goods at 100, Warehouse B receives goods at 200
        let conn = setup_test_db();
        insert_movement(
            &conn,
            "mov_wh_a",
            "tnt_test",
            "unt_1",
            "wh_a",
            10.0,
            Some(100.0),
            "purchase_receipt",
            1000,
        );
        insert_movement(
            &conn,
            "mov_wh_b",
            "tnt_test",
            "unt_1",
            "wh_b",
            10.0,
            Some(200.0),
            "purchase_receipt",
            1000,
        );

        // When: Query cost for warehouse A and warehouse B
        let cost_a =
            calculate_weighted_average_cost(&conn, "tnt_test", "unt_1", "wh_a", None).unwrap();
        let cost_b =
            calculate_weighted_average_cost(&conn, "tnt_test", "unt_1", "wh_b", None).unwrap();

        // Then: Costs are strictly isolated between warehouses
        assert!((cost_a - 100.0).abs() < 1e-6);
        assert!((cost_b - 200.0).abs() < 1e-6);
    }

    // TC-COST-N-03: 多租戶分別進出貨，隔離正確
    #[test]
    fn test_tc_cost_n_03_multi_tenant_isolation() {
        // Given: Tenant test receives goods at 50, Tenant other receives goods at 80
        let conn = setup_test_db();
        insert_movement(
            &conn,
            "mov_t1",
            "tnt_test",
            "unt_1",
            "wh_1",
            10.0,
            Some(50.0),
            "purchase_receipt",
            1000,
        );
        insert_movement(
            &conn,
            "mov_t2",
            "tnt_other",
            "unt_1",
            "wh_1",
            10.0,
            Some(80.0),
            "purchase_receipt",
            1000,
        );

        // When: Query cost for each tenant
        let cost_t1 =
            calculate_weighted_average_cost(&conn, "tnt_test", "unt_1", "wh_1", None).unwrap();
        let cost_t2 =
            calculate_weighted_average_cost(&conn, "tnt_other", "unt_1", "wh_1", None).unwrap();

        // Then: Each tenant's calculation is completely isolated
        assert!((cost_t1 - 50.0).abs() < 1e-6);
        assert!((cost_t2 - 80.0).abs() < 1e-6);
    }

    // TC-COST-B-01: 庫存為 0 時發生出貨（防禦性處理）
    #[test]
    fn test_tc_cost_b_01_zero_stock_shipment_defensive() {
        // Given: Stock is 0, then a shipment of 5 occurs
        let conn = setup_test_db();
        insert_movement(
            &conn,
            "mov_out_0",
            "tnt_test",
            "unt_1",
            "wh_1",
            -5.0,
            None,
            "sales_shipment",
            1000,
        );

        // When: Calculate cost as of after the shipment
        let cost =
            calculate_weighted_average_cost(&conn, "tnt_test", "unt_1", "wh_1", None).unwrap();

        // Then: Returns 0.0 without division by zero or NaN
        assert_eq!(cost, 0.0);
    }

    // TC-COST-B-02: 庫存為負時連續發生出貨（防禦性處理）
    #[test]
    fn test_tc_cost_b_02_negative_stock_continuous_shipment_defensive() {
        // Given: Initial shipment creates negative stock -5, second shipment deducts another -5
        let conn = setup_test_db();
        insert_movement(
            &conn,
            "mov_out_1",
            "tnt_test",
            "unt_1",
            "wh_1",
            -5.0,
            None,
            "sales_shipment",
            1000,
        );
        insert_movement(
            &conn,
            "mov_out_2",
            "tnt_test",
            "unt_1",
            "wh_1",
            -5.0,
            None,
            "sales_shipment",
            2000,
        );

        // When: Calculate cost
        let cost =
            calculate_weighted_average_cost(&conn, "tnt_test", "unt_1", "wh_1", None).unwrap();

        // Then: Returns 0.0 safely
        assert_eq!(cost, 0.0);
    }

    // TC-COST-B-03: 負庫存後進貨回補
    #[test]
    fn test_tc_cost_b_03_negative_stock_replenishment_boundary() {
        // Given: Negative stock -5, then incoming purchase of 10 @ 100
        let conn = setup_test_db();
        insert_movement(
            &conn,
            "mov_out_neg",
            "tnt_test",
            "unt_1",
            "wh_1",
            -5.0,
            None,
            "sales_shipment",
            1000,
        );
        insert_movement(
            &conn,
            "mov_in_rep",
            "tnt_test",
            "unt_1",
            "wh_1",
            10.0,
            Some(100.0),
            "purchase_receipt",
            2000,
        );

        // When: Calculate cost after replenishment
        let cost =
            calculate_weighted_average_cost(&conn, "tnt_test", "unt_1", "wh_1", None).unwrap();

        // Then: The remaining 5 units have average unit cost of 100.0
        assert!((cost - 100.0).abs() < 1e-6);
    }

    // TC-COST-B-04: 異動中 unit_cost 為 NULL 之正向異動（如單位轉換入庫）
    #[test]
    fn test_tc_cost_b_04_positive_movement_with_null_cost() {
        // Given: Purchase of 10 @ 50, followed by a positive movement with unit_cost = NULL
        let conn = setup_test_db();
        insert_movement(
            &conn,
            "mov_in_1",
            "tnt_test",
            "unt_1",
            "wh_1",
            10.0,
            Some(50.0),
            "purchase_receipt",
            1000,
        );
        insert_movement(
            &conn,
            "mov_in_null",
            "tnt_test",
            "unt_1",
            "wh_1",
            5.0,
            None,
            "unit_conversion_in",
            2000,
        );

        // When: Calculate cost
        let cost =
            calculate_weighted_average_cost(&conn, "tnt_test", "unt_1", "wh_1", None).unwrap();

        // Then: Positive movement without cost is skipped in total_cost/total_qty calculation
        assert!((cost - 50.0).abs() < 1e-6);
    }

    // TC-COST-B-05: as_of 時間邊界精確包含與排除
    #[test]
    fn test_tc_cost_b_05_as_of_timestamp_exact_and_boundary() {
        // Given: Movements at timestamp 1000 (@100) and 2000 (@200)
        let conn = setup_test_db();
        insert_movement(
            &conn,
            "mov_t1000",
            "tnt_test",
            "unt_1",
            "wh_1",
            10.0,
            Some(100.0),
            "purchase_receipt",
            1000,
        );
        insert_movement(
            &conn,
            "mov_t2000",
            "tnt_test",
            "unt_1",
            "wh_1",
            10.0,
            Some(200.0),
            "purchase_receipt",
            2000,
        );

        // When: Query as_of = 999, as_of = 1000, as_of = 1001, as_of = 2000
        let cost_999 =
            calculate_weighted_average_cost(&conn, "tnt_test", "unt_1", "wh_1", Some(999)).unwrap();
        let cost_1000 =
            calculate_weighted_average_cost(&conn, "tnt_test", "unt_1", "wh_1", Some(1000))
                .unwrap();
        let cost_1001 =
            calculate_weighted_average_cost(&conn, "tnt_test", "unt_1", "wh_1", Some(1001))
                .unwrap();
        let cost_2000 =
            calculate_weighted_average_cost(&conn, "tnt_test", "unt_1", "wh_1", Some(2000))
                .unwrap();

        // Then:
        assert_eq!(cost_999, 0.0);
        assert!((cost_1000 - 100.0).abs() < 1e-6);
        assert!((cost_1001 - 100.0).abs() < 1e-6);
        assert!((cost_2000 - 150.0).abs() < 1e-6);
    }

    // TC-COST-B-06: 查無任何異動紀錄（空資料）
    #[test]
    fn test_tc_cost_b_06_no_movements_returns_zero() {
        // Given: Clean database with no movements
        let conn = setup_test_db();

        // When: Calculate cost for a new unit
        let cost =
            calculate_weighted_average_cost(&conn, "tnt_test", "unt_nonexistent", "wh_1", None)
                .unwrap();

        // Then: Returns 0.0
        assert_eq!(cost, 0.0);
    }

    // TC-COST-ERR-01: 空白 tenant_id
    #[test]
    fn test_tc_cost_err_01_empty_tenant_id() {
        // Given: Empty tenant_id
        let conn = setup_test_db();

        // When: Call calculate_weighted_average_cost
        let err = calculate_weighted_average_cost(&conn, "   ", "unt_1", "wh_1", None).unwrap_err();

        // Then: Returns validation error
        assert!(err.contains("租戶 ID 不能為空"));
    }

    // TC-COST-ERR-02: 空白 unit_id
    #[test]
    fn test_tc_cost_err_02_empty_unit_id() {
        // Given: Empty unit_id
        let conn = setup_test_db();

        // When: Call calculate_weighted_average_cost
        let err = calculate_weighted_average_cost(&conn, "tnt_test", "", "wh_1", None).unwrap_err();

        // Then: Returns validation error
        assert!(err.contains("品項單位 ID 不能為空"));
    }

    // TC-COST-ERR-03: 空白 warehouse_id
    #[test]
    fn test_tc_cost_err_03_empty_warehouse_id() {
        // Given: Empty warehouse_id
        let conn = setup_test_db();

        // When: Call calculate_weighted_average_cost
        let err =
            calculate_weighted_average_cost(&conn, "tnt_test", "unt_1", " \t ", None).unwrap_err();

        // Then: Returns validation error
        assert!(err.contains("倉庫 ID 不能為空"));
    }

    // TC-BF-ERR-01: backfill 空白 tenant_id
    #[test]
    fn test_tc_bf_err_01_empty_tenant_id() {
        // Given: Empty tenant_id string
        let mut conn = setup_test_db();

        // When: Call backfill_sales_shipment_unit_cost_impl
        let err = backfill_sales_shipment_unit_cost_impl(&mut conn, Some(" ")).unwrap_err();

        // Then: Returns validation error
        assert!(err.contains("租戶 ID 不能為空"));
    }

    // TC-BF-N-01: 歷史出貨 unit_cost 為 NULL，成功回填正確時間點之 running_avg
    #[test]
    fn test_tc_bf_n_01_backfill_historical_shipments_with_null_cost() {
        // Given: Receipts and historical shipments with NULL unit_cost
        let mut conn = setup_test_db();
        // Day 1: In 10 @ 100
        insert_movement(
            &conn,
            "mov_p1",
            "tnt_test",
            "unt_1",
            "wh_1",
            10.0,
            Some(100.0),
            "purchase_receipt",
            1000,
        );
        // Day 2: In 10 @ 120 -> running_avg = 110.0
        insert_movement(
            &conn,
            "mov_p2",
            "tnt_test",
            "unt_1",
            "wh_1",
            10.0,
            Some(120.0),
            "purchase_receipt",
            2000,
        );
        // Day 3: Shipment 5 with NULL unit_cost -> should backfill 110.0
        insert_movement(
            &conn,
            "mov_s1",
            "tnt_test",
            "unt_1",
            "wh_1",
            -5.0,
            None,
            "sales_shipment",
            3000,
        );
        // Day 4: In 5 @ 130 -> running_avg = (1650 + 650) / 20 = 115.0
        insert_movement(
            &conn,
            "mov_p3",
            "tnt_test",
            "unt_1",
            "wh_1",
            5.0,
            Some(130.0),
            "purchase_receipt",
            4000,
        );
        // Day 5: Shipment 10 with NULL unit_cost -> should backfill 115.0
        insert_movement(
            &conn,
            "mov_s2",
            "tnt_test",
            "unt_1",
            "wh_1",
            -10.0,
            None,
            "sales_shipment",
            5000,
        );

        // When: Execute backfill
        let updated = backfill_sales_shipment_unit_cost_impl(&mut conn, Some("tnt_test")).unwrap();

        // Then: 2 rows backfilled with their respective running_avg at shipment time
        assert_eq!(updated, 2);

        let cost_s1: Option<f64> = conn
            .query_row(
                "SELECT unit_cost FROM inventory_movements WHERE id = 'mov_s1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let cost_s2: Option<f64> = conn
            .query_row(
                "SELECT unit_cost FROM inventory_movements WHERE id = 'mov_s2'",
                [],
                |r| r.get(0),
            )
            .unwrap();

        assert_eq!(cost_s1.is_some(), true);
        assert!((cost_s1.unwrap() - 110.0).abs() < 1e-6);
        assert_eq!(cost_s2.is_some(), true);
        assert!((cost_s2.unwrap() - 115.0).abs() < 1e-6);
    }

    // TC-BF-N-02: 回填對多倉別分別計算不互相汙染
    #[test]
    fn test_tc_bf_n_02_multi_warehouse_isolation_backfill() {
        // Given: Same unit in wh_1 and wh_2 with different purchase costs and uncosted shipments
        let mut conn = setup_test_db();
        // wh_1: Purchase 10 @ 100, Shipment 5 with NULL unit_cost
        insert_movement(
            &conn,
            "mov_p_wh1",
            "tnt_test",
            "unt_1",
            "wh_1",
            10.0,
            Some(100.0),
            "purchase_receipt",
            1000,
        );
        insert_movement(
            &conn,
            "mov_s_wh1",
            "tnt_test",
            "unt_1",
            "wh_1",
            -5.0,
            None,
            "sales_shipment",
            2000,
        );

        // wh_2: Purchase 10 @ 200, Shipment 4 with NULL unit_cost
        insert_movement(
            &conn,
            "mov_p_wh2",
            "tnt_test",
            "unt_1",
            "wh_2",
            10.0,
            Some(200.0),
            "purchase_receipt",
            1000,
        );
        insert_movement(
            &conn,
            "mov_s_wh2",
            "tnt_test",
            "unt_1",
            "wh_2",
            -4.0,
            None,
            "sales_shipment",
            2000,
        );

        // When: Execute backfill for tenant
        let updated = backfill_sales_shipment_unit_cost_impl(&mut conn, Some("tnt_test")).unwrap();

        // Then: 2 rows backfilled, each warehouse gets its own isolated running average
        assert_eq!(updated, 2);

        let cost_wh1: Option<f64> = conn
            .query_row(
                "SELECT unit_cost FROM inventory_movements WHERE id = 'mov_s_wh1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let cost_wh2: Option<f64> = conn
            .query_row(
                "SELECT unit_cost FROM inventory_movements WHERE id = 'mov_s_wh2'",
                [],
                |r| r.get(0),
            )
            .unwrap();

        assert_eq!(cost_wh1.is_some(), true);
        assert!((cost_wh1.unwrap() - 100.0).abs() < 1e-6);
        assert_eq!(cost_wh2.is_some(), true);
        assert!((cost_wh2.unwrap() - 200.0).abs() < 1e-6);
    }

    // TC-BF-B-01: 已有 unit_cost 的出貨紀錄不被覆寫
    #[test]
    fn test_tc_bf_b_01_existing_unit_cost_not_overwritten() {
        // Given: A shipment that already has unit_cost = 99.0, and another shipment with NULL
        let mut conn = setup_test_db();
        insert_movement(
            &conn,
            "mov_p1",
            "tnt_test",
            "unt_1",
            "wh_1",
            10.0,
            Some(100.0),
            "purchase_receipt",
            1000,
        );
        // Existing unit_cost
        insert_movement(
            &conn,
            "mov_s_preset",
            "tnt_test",
            "unt_1",
            "wh_1",
            -2.0,
            Some(99.0),
            "sales_shipment",
            2000,
        );
        // Uncosted shipment
        insert_movement(
            &conn,
            "mov_s_null",
            "tnt_test",
            "unt_1",
            "wh_1",
            -3.0,
            None,
            "sales_shipment",
            3000,
        );

        // When: Run backfill
        let updated = backfill_sales_shipment_unit_cost_impl(&mut conn, None).unwrap();

        // Then: Only the NULL row is updated (updated == 1), mov_s_preset keeps 99.0
        assert_eq!(updated, 1);

        let preset_cost: f64 = conn
            .query_row(
                "SELECT unit_cost FROM inventory_movements WHERE id = 'mov_s_preset'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!((preset_cost - 99.0).abs() < 1e-6);
    }

    // TC-BF-B-02: 冪等性驗證 - 重複執行不重複計算或更新
    #[test]
    fn test_tc_bf_b_02_idempotent_multiple_runs_no_extra_updates() {
        // Given: One uncosted shipment
        let mut conn = setup_test_db();
        insert_movement(
            &conn,
            "mov_p1",
            "tnt_test",
            "unt_1",
            "wh_1",
            10.0,
            Some(100.0),
            "purchase_receipt",
            1000,
        );
        insert_movement(
            &conn,
            "mov_s1",
            "tnt_test",
            "unt_1",
            "wh_1",
            -5.0,
            None,
            "sales_shipment",
            2000,
        );

        // When: Run backfill first time, then second time
        let first_run = backfill_sales_shipment_unit_cost_impl(&mut conn, None).unwrap();
        let second_run = backfill_sales_shipment_unit_cost_impl(&mut conn, None).unwrap();

        // Then: First run updates 1 row; second run updates 0 rows
        assert_eq!(first_run, 1);
        assert_eq!(second_run, 0);
    }
}
